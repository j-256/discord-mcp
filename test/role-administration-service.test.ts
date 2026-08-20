import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  DiscordApiError,
  RoleCreationExecutionError,
  RoleCreationOperationConflictError,
  RoleCreationPlanChangedError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeDiscordRoleInventory,
  normalizeRoleCreationRequest,
  RoleAdministrationService,
  type RoleAdministrationServiceOptions,
  type RoleCreationRequest,
} from "../src/role-administration-service.js"
import type {
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const OWNER_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const CREATED_ROLE_ID = "500000000000000001"
const AUDIT_REASON = "Reviewed support role creation"
const OPERATION_KEY = "role-create-operation-0001"
const NOW = "2026-08-20T00:00:00.000Z"

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
    id,
    icon: null,
    managed: false,
    mentionable: false,
    name,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
    ...overrides,
  }
}

function createdRole(overrides: Partial<DiscordRole> = {}): DiscordRole {
  return role(
    CREATED_ROLE_ID,
    "Support",
    DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.SEND_MESSAGES,
    1,
    { color: 3_447_003, colors: {
      primary_color: 3_447_003,
      secondary_color: null,
      tertiary_color: null,
    }, ...overrides },
  )
}

function request(overrides: Partial<RoleCreationRequest> = {}): RoleCreationRequest {
  return {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    name: "Support",
    operationKey: OPERATION_KEY,
    permissions: ["SEND_MESSAGES", "VIEW_CHANNEL"],
    primaryColor: 3_447_003,
    ...overrides,
  }
}

function policy(options: { enabled?: boolean; guildIds?: readonly string[] } = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowRoleCreation: options.enabled ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    roleCreationGuildIds: new Set(options.guildIds || [GUILD_ID]),
  })
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  receipt: OperationReceipt | undefined

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipt = receipt
  }

  async get(): Promise<OperationReceipt | undefined> {
    return this.receipt
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("operation:reserve")
    if (this.receipt) return { created: false, receipt: this.receipt }
    this.receipt = receipt
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  addCreatedToRoles: boolean
  botMember: DiscordGuildMember
  createError: unknown
  createGate: Promise<void> | null
  createStarted: (() => void) | null
  created: DiscordRole
  guildId: string
  guildName: string
  ownerId: string
  readback: DiscordRole
  readbackError: unknown
  roles: DiscordRole[]
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const botPermissions = DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.SEND_MESSAGES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const state: FixtureState = {
    activityFailureAt: null,
    addCreatedToRoles: false,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    createError: undefined,
    createGate: null,
    createStarted: null,
    created: createdRole(),
    guildId: GUILD_ID,
    guildName: "Private Guild Name",
    ownerId: OWNER_ID,
    readback: createdRole(),
    readbackError: undefined,
    roles: [
      role(GUILD_ID, "@everyone", 0n, 0),
      role(BOT_ROLE_ID, "connector", botPermissions, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
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
  const client: RoleAdministrationServiceOptions["client"] = {
    async createGuildRole(_guildId, _input, _reason) {
      events.push("write:create")
      state.createStarted?.()
      if (state.createGate) await state.createGate
      if (state.createError) throw state.createError
      if (
        state.addCreatedToRoles
        && !state.roles.some((entry) => entry.id === state.created.id)
      ) state.roles.push(state.created)
      return state.created
    },
    async getGuild() {
      events.push("read:guild")
      return {
        features: [],
        id: state.guildId,
        name: state.guildName,
        owner_id: state.ownerId,
      }
    },
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
    },
    async getGuildRole() {
      events.push("read:created")
      if (state.readbackError) throw state.readbackError
      return state.readback
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
  }
  const service = new RoleAdministrationService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(9),
    policy: options.policy || policy(),
    randomId: () => "activity-0001",
  })
  return {
    activityStore,
    activities,
    client,
    events,
    operationStore,
    service,
    state,
  }
}

function siblingService(
  target: ReturnType<typeof fixture>,
  operationStore: OperationStore,
): RoleAdministrationService {
  return new RoleAdministrationService({
    activityStore: target.activityStore,
    client: target.client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(9),
    policy: policy(),
    randomId: () => "activity-sibling",
  })
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof RoleCreationExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("role creation normalization uses named permissions and blocks administrator", () => {
  const normalized = normalizeRoleCreationRequest(request())
  assert.deepEqual(normalized.permissions, ["VIEW_CHANNEL", "SEND_MESSAGES"])
  assert.equal(
    normalized.permissionBits,
    (DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.SEND_MESSAGES).toString(),
  )
  assert.equal(normalized.hoist, false)
  assert.equal(normalized.mentionable, false)
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.throws(
    () => normalizeRoleCreationRequest(request({ permissions: ["ADMINISTRATOR"] })),
    /never grants ADMINISTRATOR/,
  )
  assert.throws(
    () => normalizeRoleCreationRequest(request({ permissions: ["VIEW_CHANNEL", "VIEW_CHANNEL"] })),
    /duplicated/,
  )
  assert.throws(
    () => normalizeRoleCreationRequest(request({ name: " @everyone" })),
    /surrounding whitespace/,
  )
  assert.throws(
    () => normalizeRoleCreationRequest(request({ name: "@everyone" })),
    /reserved/,
  )
  assert.throws(
    () => normalizeRoleCreationRequest(request({ primaryColor: 0x1_00_00_00 })),
    /between 0 and/,
  )
})

test("role inventory is bounded, current, and exposes permission evidence", () => {
  const unknownBit = 1n << 60n
  const inventory = normalizeDiscordRoleInventory([
    role(GUILD_ID, "@everyone", 0n, 0),
    role(BOT_ROLE_ID, "connector", DISCORD_PERMISSIONS.MANAGE_ROLES | unknownBit, 10, {
      managed: true,
      tags: { bot_id: BOT_ID },
    }),
  ], GUILD_ID)
  assert.equal(inventory[0]?.id, BOT_ROLE_ID)
  assert.deepEqual(inventory[0]?.permissionNames, ["MANAGE_ROLES"])
  assert.equal(inventory[0]?.unknownPermissionBits, unknownBit.toString())
  assert.deepEqual(inventory[0]?.management, { id: BOT_ID, type: "bot" })

  assert.throws(
    () => normalizeDiscordRoleInventory([
      role(GUILD_ID, "@everyone", 0n, 0),
      role(GUILD_ID, "duplicate", 0n, 1),
    ], GUILD_ID),
    /duplicate role IDs/,
  )
  assert.throws(
    () => normalizeDiscordRoleInventory([
      role(GUILD_ID, "wrong", 0n, 0),
    ], GUILD_ID),
    /@everyone/,
  )
  const missingColor = role(GUILD_ID, "@everyone", 0n, 0)
  delete missingColor.color
  delete missingColor.colors
  assert.throws(
    () => normalizeDiscordRoleInventory([missingColor], GUILD_ID),
    /color evidence/,
  )
})

test("role creation plans bind complete evidence and return an exact no-op", async () => {
  const plannedFixture = fixture()
  const first = await plannedFixture.service.plan(BOT_ID, request())
  const second = await plannedFixture.service.plan(BOT_ID, request())
  assert.equal(first.status, "planned")
  assert.equal(first.action, "create")
  assert.equal(first.digest, second.digest)
  assert.equal(first.permission.guildManageRoles, true)
  assert.equal(first.permission.requestedSubset, true)
  assert.equal(first.permission.botHighestRolePosition, 10)
  assert.equal(first.visibleInventory.guildRoles, 2)
  assert.match(first.warnings.join(" "), /default bottom position/)

  plannedFixture.state.roles.push(role(
    "600000000000000001",
    "unrelated",
    0n,
    1,
  ))
  const changed = await plannedFixture.service.plan(BOT_ID, request())
  assert.notEqual(changed.digest, first.digest)

  const currentFixture = fixture({ state: { roles: [
    ...fixture().state.roles,
    createdRole(),
  ] } })
  const current = await currentFixture.service.plan(BOT_ID, request())
  const result = await currentFixture.service.execute(BOT_ID, request(), current.digest)
  assert.equal(current.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.roleId, CREATED_ROLE_ID)
  assert.equal(result.activityId, null)
  assert.equal(currentFixture.events.includes("write:create"), false)
  assert.equal(currentFixture.operationStore.receipt, undefined)
})

test("role creation plans surface administrator, mention, and high-risk permission warnings", async () => {
  const target = fixture({ state: { roles: [
    role(GUILD_ID, "@everyone", 0n, 0),
    role(BOT_ROLE_ID, "connector", DISCORD_PERMISSIONS.ADMINISTRATOR, 10, {
      managed: true,
      tags: { bot_id: BOT_ID },
    }),
  ] } })

  const plan = await target.service.plan(BOT_ID, request({
    mentionable: true,
    permissions: ["BAN_MEMBERS"],
  }))

  assert.match(plan.warnings.join("\n"), /has ADMINISTRATOR/)
  assert.match(plan.warnings.join("\n"), /mentionable/)
  assert.match(plan.warnings.join("\n"), /high-risk permissions: BAN_MEMBERS/)
})

test("role creation planning fails closed on collisions, capacity, and authority", async () => {
  const conflict = fixture()
  conflict.state.roles.push(role(
    CREATED_ROLE_ID,
    "support",
    DISCORD_PERMISSIONS.VIEW_CHANNEL,
    1,
  ))
  await assert.rejects(
    conflict.service.plan(BOT_ID, request()),
    /conflicts with an existing role/,
  )

  const managed = fixture()
  managed.state.roles.push(role(CREATED_ROLE_ID, "Support", 0n, 1, {
    managed: true,
    tags: { integration_id: "700000000000000001" },
  }))
  await assert.rejects(managed.service.plan(BOT_ID, request()), /managed role/)

  const insufficient = fixture()
  await assert.rejects(
    insufficient.service.plan(BOT_ID, request({ permissions: ["BAN_MEMBERS"] })),
    /cannot grant requested permissions/,
  )

  const noManageRoles = fixture({ state: { roles: [
    role(GUILD_ID, "@everyone", 0n, 0),
    role(BOT_ROLE_ID, "connector", DISCORD_PERMISSIONS.VIEW_CHANNEL, 10, {
      managed: true,
      tags: { bot_id: BOT_ID },
    }),
  ] } })
  await assert.rejects(noManageRoles.service.plan(BOT_ID, request()), /lacks guild-level/)

  const noHierarchy = fixture({ state: {
    botMember: { roles: [], user: { bot: true, id: BOT_ID, username: "connector" } },
    roles: [role(
      GUILD_ID,
      "@everyone",
      DISCORD_PERMISSIONS.MANAGE_ROLES
        | DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.SEND_MESSAGES,
      0,
    )],
  } })
  await assert.rejects(noHierarchy.service.plan(BOT_ID, request()), /no role above/)

  const capacity = fixture()
  for (let index = 0; index < 248; index += 1) {
    capacity.state.roles.push(role(
      (800000000000000000n + BigInt(index)).toString(),
      `role-${index}`,
      0n,
      1,
    ))
  }
  await assert.rejects(capacity.service.plan(BOT_ID, request()), /250-role limit/)
})

test("role creation policy is independently disabled and exact-guild scoped", async () => {
  await assert.rejects(
    fixture({ policy: policy({ enabled: false }) }).service.plan(BOT_ID, request()),
    /role creation is disabled/,
  )
  await assert.rejects(
    fixture({ policy: policy({ guildIds: ["999000000000000001"] }) }).service.plan(
      BOT_ID,
      request(),
    ),
    /outside the role creation scope/,
  )
})

test("role creation reserves, audits, writes once, and persists no role content", async () => {
  const target = fixture()
  const plan = await target.service.plan(BOT_ID, request())
  const result = await target.service.execute(BOT_ID, request(), plan.digest)
  assert.equal(result.status, "completed")
  assert.equal(result.roleId, CREATED_ROLE_ID)
  assert.deepEqual(target.events.slice(-6), [
    "operation:reserve",
    "activity:pending",
    "write:create",
    "read:created",
    "operation:completed",
    "activity:completed",
  ])
  assert.equal(target.events.at(-1), "activity:completed")
  assert.equal(target.activities.length, 2)
  const durable = JSON.stringify({
    activities: target.activities,
    receipt: target.operationStore.receipt,
  })
  assert.doesNotMatch(durable, /Support/)
  assert.doesNotMatch(durable, /Reviewed support/)
  assert.doesNotMatch(durable, /VIEW_CHANNEL|SEND_MESSAGES/)
  assert.doesNotMatch(durable, new RegExp(OPERATION_KEY))
  assert.equal(target.operationStore.receipt?.kind, "role-creation")
})

test("role creation refuses changed plans and spent operation keys", async () => {
  const changed = fixture()
  const plan = await changed.service.plan(BOT_ID, request())
  changed.state.guildName = "Changed Guild"
  await assert.rejects(
    changed.service.execute(BOT_ID, request(), plan.digest),
    RoleCreationPlanChangedError,
  )
  assert.equal(changed.events.includes("write:create"), false)

  const spent = fixture()
  const spentPlan = await spent.service.plan(BOT_ID, request())
  spent.operationStore.receipt = {
    activityId: "prior-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "role-creation",
    operationKeyHash: spentPlan.operationKeyHash,
    planDigest: spentPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  }
  await assert.rejects(
    spent.service.plan(BOT_ID, request()),
    RoleCreationOperationConflictError,
  )
})

test("role creation serializes same-target writes and blocks after uncertainty", async () => {
  let releaseCreate: () => void = () => undefined
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve
  })
  let signalStarted: () => void = () => undefined
  const createStarted = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  const target = fixture({ state: {
    addCreatedToRoles: true,
    createGate,
    createStarted: signalStarted,
  } })
  const firstPlan = await target.service.plan(BOT_ID, request())
  const siblingStore = new MemoryOperationStore(target.events)
  const sibling = siblingService(target, siblingStore)
  const siblingRequest = request({ operationKey: "role-create-operation-0002" })
  const siblingPlan = await sibling.plan(BOT_ID, siblingRequest)
  const firstExecution = target.service.execute(BOT_ID, request(), firstPlan.digest)
  await createStarted
  const siblingExecution = sibling.execute(BOT_ID, siblingRequest, siblingPlan.digest)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(target.events.filter((entry) => entry === "write:create").length, 1)
  releaseCreate()
  assert.equal((await firstExecution).status, "completed")
  await assert.rejects(siblingExecution, RoleCreationPlanChangedError)
  assert.equal(target.events.filter((entry) => entry === "write:create").length, 1)

  const uncertain = fixture({ state: {
    createError: new Error("network disconnected"),
  } })
  const uncertainPlan = await uncertain.service.plan(BOT_ID, request())
  const uncertainSibling = siblingService(
    uncertain,
    new MemoryOperationStore(uncertain.events),
  )
  const secondRequest = request({ operationKey: "role-create-operation-0003" })
  const secondPlan = await uncertainSibling.plan(BOT_ID, secondRequest)
  const first = uncertain.service.execute(BOT_ID, request(), uncertainPlan.digest)
  const second = uncertainSibling.execute(BOT_ID, secondRequest, secondPlan.digest)
  await assert.rejects(first, (error) => executionResult(error).status === "uncertain")
  await assert.rejects(
    second,
    (error) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(uncertain.events.filter((entry) => entry === "write:create").length, 1)
})

test("role creation blocks on pending audit failure and classifies external outcomes", async () => {
  const auditFailure = fixture({ state: { activityFailureAt: 1 } })
  const auditPlan = await auditFailure.service.plan(BOT_ID, request())
  await assert.rejects(
    auditFailure.service.execute(BOT_ID, request(), auditPlan.digest),
    (error) => executionResult(error).status === "blocked-audit-failed",
  )
  assert.equal(auditFailure.events.includes("write:create"), false)

  const rejected = fixture({ state: {
    createError: new DiscordApiError({
      code: 50_013,
      message: "missing permissions",
      method: "POST",
      route: `/guilds/${GUILD_ID}/roles`,
      status: 403,
    }),
  } })
  const rejectedPlan = await rejected.service.plan(BOT_ID, request())
  await assert.rejects(
    rejected.service.execute(BOT_ID, request(), rejectedPlan.digest),
    (error) => executionResult(error).status === "failed",
  )
  assert.equal(rejected.operationStore.receipt?.status, "failed")

  const readback = fixture({ state: { readbackError: new Error("connection reset") } })
  const readbackPlan = await readback.service.plan(BOT_ID, request())
  await assert.rejects(
    readback.service.execute(BOT_ID, request(), readbackPlan.digest),
    (error) => {
      const result = executionResult(error)
      return result.status === "uncertain" && result.roleId === CREATED_ROLE_ID
    },
  )
  assert.equal(readback.operationStore.receipt?.status, "uncertain")
})

test("role creation reports verified drift without retry or rollback", async () => {
  const target = fixture({ state: {
    readback: createdRole({ mentionable: true }),
  } })
  const plan = await target.service.plan(BOT_ID, request())
  const result = await target.service.execute(BOT_ID, request(), plan.digest)
  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.observed.mentionable, true)
  assert.equal(target.events.filter((entry) => entry === "write:create").length, 1)
  assert.equal(target.operationStore.receipt?.verification, "drift")
  assert.equal(target.activities.at(-1)?.status, "completed-with-drift")
})

test("role creation reports completed local receipt and activity failures", async () => {
  const receiptFailure = fixture()
  const receiptPlan = await receiptFailure.service.plan(BOT_ID, request())
  receiptFailure.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    receiptFailure.service.execute(BOT_ID, request(), receiptPlan.digest),
    (error) => {
      const result = executionResult(error)
      return result.status === "completed-operation-record-failed"
        && result.roleId === CREATED_ROLE_ID
    },
  )
  assert.equal(
    receiptFailure.events.filter((entry) => entry === "write:create").length,
    1,
  )
  assert.equal(receiptFailure.activities.at(-1)?.status, "completed")

  const activityFailure = fixture({ state: { activityFailureAt: 2 } })
  const activityPlan = await activityFailure.service.plan(BOT_ID, request())
  await assert.rejects(
    activityFailure.service.execute(BOT_ID, request(), activityPlan.digest),
    (error) => executionResult(error).status === "completed-audit-failed",
  )
  assert.equal(
    activityFailure.events.filter((entry) => entry === "write:create").length,
    1,
  )
  assert.equal(activityFailure.operationStore.receipt?.status, "completed")
})
