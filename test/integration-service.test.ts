import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { DISCORD_LIMITS } from "../src/constants.js"
import type { DiscordGuildIntegrationSummary } from "../src/discord-client.js"
import {
  DiscordApiError,
  IntegrationDeletionExecutionError,
  IntegrationDeletionOperationConflictError,
  IntegrationDeletionPlanChangedError,
  IntegrationEvidenceError,
  PolicyError,
} from "../src/errors.js"
import {
  IntegrationService,
  normalizeIntegrationDeletionRequest,
  type IntegrationDeletionRequest,
  type IntegrationServiceOptions,
} from "../src/integration-service.js"
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
const OTHER_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const OWNER_ID = "300000000000000002"
const BOT_ROLE_ID = "400000000000000001"
const INTEGRATION_ID = "500000000000000001"
const OTHER_INTEGRATION_ID = "500000000000000002"
const TARGET_APPLICATION_ID = "600000000000000001"
const ASSOCIATED_BOT_ID = "700000000000000001"
const OPERATION_KEY = "integration-deletion-operation-0001"
const AUDIT_REASON = "Reviewed integration cleanup / case 42"
const NOW = "2026-08-22T00:00:00.000Z"

function role(
  guildId: string,
  id: string,
  permissions: bigint,
  position: number,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === guildId ? "@everyone" : "private-connector-role",
    permissions: permissions.toString(),
    position,
  }
}

function integration(
  id = INTEGRATION_ID,
  overrides: Partial<DiscordGuildIntegrationSummary> = {},
): DiscordGuildIntegrationSummary {
  return {
    accountPresent: true,
    applicationId: id === INTEGRATION_ID ? TARGET_APPLICATION_ID : null,
    associatedBotUserId: id === INTEGRATION_ID ? ASSOCIATED_BOT_ID : null,
    enableEmoticons: null,
    enabled: true,
    expireBehavior: null,
    expireGracePeriod: null,
    id,
    knownScopes: id === INTEGRATION_ID ? ["bot", "identify"] : [],
    linkedUserPresent: false,
    revoked: null,
    roleId: null,
    subscriberCount: null,
    syncedAt: null,
    syncing: null,
    type: id === INTEGRATION_ID ? "discord" : "twitch",
    unknownFieldCounts: {
      account: 0,
      application: 0,
      bot: 0,
      integration: 0,
      user: 0,
    },
    unknownScopeCount: 0,
    ...overrides,
  }
}

function request(
  overrides: Partial<IntegrationDeletionRequest> = {},
): IntegrationDeletionRequest {
  return {
    acknowledgeAssociatedBotKicked: true,
    acknowledgeAssociatedWebhooksRemoved: true,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    integrationId: INTEGRATION_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function policy(options: {
  audit?: boolean
  deletions?: boolean
  guildId?: string
  guildIds?: readonly string[]
  integrationIds?: readonly string[]
  protectedUserIds?: readonly string[]
} = {}): ScopePolicy {
  const guildId = options.guildId || GUILD_ID
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([guildId]),
    allowAdministration: false,
    allowDeletions: false,
    allowIntegrationAudit: options.audit ?? true,
    allowIntegrationDeletions: options.deletions ?? true,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    integrationGuildIds: new Set(options.guildIds || [guildId]),
    integrationIds: new Set(options.integrationIds || [INTEGRATION_ID]),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(options.protectedUserIds || []),
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
  associatedBotMember: DiscordGuildMember | null
  botMember: DiscordGuildMember
  deleted: boolean
  guildName: string
  inventory: DiscordGuildIntegrationSummary[]
  mutationDriftsOther: boolean
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  mutationUpdatesState: boolean
  readbackError: unknown
  roles: DiscordRole[]
}

function fixture(options: {
  guildId?: string
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const guildId = options.guildId || GUILD_ID
  const state: FixtureState = {
    activityFailureAt: null,
    associatedBotMember: {
      roles: [],
      user: { bot: true, id: ASSOCIATED_BOT_ID, username: "private-associated-bot" },
    },
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "private-connector" },
    },
    deleted: false,
    guildName: "Private Guild Name",
    inventory: [integration(), integration(OTHER_INTEGRATION_ID)],
    mutationDriftsOther: false,
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    mutationUpdatesState: true,
    readbackError: undefined,
    roles: [
      role(guildId, guildId, 0n, 0),
      role(guildId, BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 10),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutationCompleted = false
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
  const client: IntegrationServiceOptions["client"] = {
    async deleteGuildIntegration(requestGuildId, integrationId, reason) {
      assert.equal(requestGuildId, guildId)
      assert.equal(integrationId, INTEGRATION_ID)
      events.push(`write:delete:${reason}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      if (state.mutationUpdatesState) state.deleted = true
      if (state.mutationDriftsOther) {
        state.inventory = state.inventory.map((entry) => (
          entry.id === OTHER_INTEGRATION_ID
            ? { ...entry, enabled: !entry.enabled }
            : entry
        ))
      }
    },
    async getGuild(requestGuildId) {
      events.push("read:guild")
      return { id: requestGuildId, name: state.guildName, owner_id: OWNER_ID }
    },
    async getGuildMember(_requestGuildId, userId) {
      events.push(userId === BOT_ID ? "read:connector-member" : "read:associated-member")
      if (userId === BOT_ID) return state.botMember
      if (userId === ASSOCIATED_BOT_ID && state.associatedBotMember) {
        return state.associatedBotMember
      }
      throw new DiscordApiError({
        message: "Discord member not found",
        method: "GET",
        route: "/guilds/{guild.id}/members/{user.id}",
        status: 404,
      })
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async listGuildIntegrations() {
      events.push(mutationCompleted ? "read:readback" : "read:integrations")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return state.deleted
        ? state.inventory.filter((entry) => entry.id !== INTEGRATION_ID)
        : state.inventory
    },
  }
  const service = new IntegrationService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: options.policy || policy({ guildId }),
    randomId: () => "activity-0001",
  })
  return { activities, events, operationStore, service, state }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected integration deletion",
    method: "DELETE",
    route: `/guilds/${GUILD_ID}/integrations/${INTEGRATION_ID}`,
    status,
  })
}

test("integration deletion normalization is strict and hashes the operation key", () => {
  const normalized = normalizeIntegrationDeletionRequest(request())
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(normalized.operationKeyHash.includes(OPERATION_KEY), false)
  assert.throws(
    () => normalizeIntegrationDeletionRequest(request({ guildId: "bad" })),
    /guild ID/,
  )
  assert.throws(
    () => normalizeIntegrationDeletionRequest(request({ integrationId: "0" })),
    /integration ID/,
  )
  assert.throws(
    () => normalizeIntegrationDeletionRequest(request({ auditReason: " " })),
    /blank/,
  )
  assert.throws(
    () => normalizeIntegrationDeletionRequest(request({ operationKey: "short" })),
    /operation key/,
  )
  assert.throws(
    () => normalizeIntegrationDeletionRequest({
      ...request(),
      unexpected: true,
    } as IntegrationDeletionRequest),
    /exact fields/,
  )
})

test("integration inventory exposes complete access and privacy-safe evidence", async () => {
  const setup = fixture()

  const listed = await setup.service.list(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(listed.status, "ok")
  assert.equal(listed.access.manageGuild, true)
  assert.equal(listed.access.requiredPermission, "MANAGE_GUILD")
  assert.equal(listed.page.inventoryComplete, true)
  assert.equal(listed.page.returned, 2)
  assert.equal(listed.page.safetyLimit, DISCORD_LIMITS.guildIntegrations)
  assert.equal(listed.privacy.persistence, "none")
  assert.equal(listed.privacy.rawPayloads, "omitted")
  assert.deepEqual(listed.integrations.map(({ id }) => id), [
    INTEGRATION_ID,
    OTHER_INTEGRATION_ID,
  ])
  assert.doesNotMatch(
    JSON.stringify(listed.integrations),
    /private|name|description|avatar|external/i,
  )
  assert.deepEqual(setup.activities, [])
})

test("integration policy, permissions, and destructive allowlists fail closed", async () => {
  const disabled = fixture({
    policy: policy({ audit: false, deletions: false }),
  })
  await assert.rejects(
    () => disabled.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    PolicyError,
  )

  const deletionDisabled = fixture({
    policy: policy({ audit: true, deletions: false }),
  })
  await assert.rejects(
    () => deletionDisabled.service.plan(APPLICATION_ID, BOT_ID, request()),
    /integration deletion is disabled/,
  )

  const wrongGuild = fixture({
    policy: policy({ guildIds: [OTHER_GUILD_ID] }),
  })
  await assert.rejects(
    () => wrongGuild.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /outside the integration scope/,
  )

  const wrongIntegration = fixture({
    policy: policy({ integrationIds: [OTHER_INTEGRATION_ID] }),
  })
  await assert.rejects(
    () => wrongIntegration.service.plan(APPLICATION_ID, BOT_ID, request()),
    /outside the integration deletion scope/,
  )

  const missingPermission = fixture({
    state: {
      roles: [
        role(GUILD_ID, GUILD_ID, 0n, 0),
        role(GUILD_ID, BOT_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 10),
      ],
    },
  })
  await assert.rejects(
    () => missingPermission.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /MANAGE_GUILD/,
  )
})

test("integration plans require understood complete evidence and side-effect acknowledgments", async () => {
  const webhooks = fixture()
  await assert.rejects(
    () => webhooks.service.plan(APPLICATION_ID, BOT_ID, request({
      acknowledgeAssociatedWebhooksRemoved: false,
    })),
    /acknowledging associated webhook removal/,
  )

  const botKick = fixture()
  await assert.rejects(
    () => botKick.service.plan(APPLICATION_ID, BOT_ID, request({
      acknowledgeAssociatedBotKicked: false,
    })),
    /acknowledging the associated bot kick/,
  )

  for (const target of [
    integration(INTEGRATION_ID, { type: "unknown" }),
    integration(INTEGRATION_ID, { unknownScopeCount: 1 }),
    integration(INTEGRATION_ID, {
      unknownFieldCounts: {
        account: 0,
        application: 0,
        bot: 0,
        integration: 1,
        user: 0,
      },
    }),
  ]) {
    const setup = fixture({
      state: { inventory: [target, integration(OTHER_INTEGRATION_ID)] },
    })
    await assert.rejects(
      () => setup.service.plan(APPLICATION_ID, BOT_ID, request()),
      /fully understood inventory evidence/,
    )
  }

  const subscription = fixture({
    state: {
      inventory: [
        integration(INTEGRATION_ID, { type: "guild_subscription" }),
        integration(OTHER_INTEGRATION_ID),
      ],
    },
  })
  await assert.rejects(
    () => subscription.service.plan(APPLICATION_ID, BOT_ID, request()),
    /audit-only/,
  )

  const ambiguousInventory = Array.from(
    { length: DISCORD_LIMITS.guildIntegrations },
    (_, index) => integration(String(500000000000000001n + BigInt(index)), {
      applicationId: null,
      associatedBotUserId: null,
      knownScopes: [],
      type: "twitch",
    }),
  )
  const ambiguous = fixture({ state: { inventory: ambiguousInventory } })
  await assert.rejects(
    () => ambiguous.service.plan(APPLICATION_ID, BOT_ID, request()),
    /ambiguous at the endpoint safety limit/,
  )
})

test("integration plans protect connector and configured bot identities", async () => {
  const ownApplication = fixture({
    state: {
      inventory: [
        integration(INTEGRATION_ID, { applicationId: APPLICATION_ID }),
        integration(OTHER_INTEGRATION_ID),
      ],
    },
  })
  await assert.rejects(
    () => ownApplication.service.plan(APPLICATION_ID, BOT_ID, request()),
    /cannot delete its own integration/,
  )

  const ownBot = fixture({
    state: {
      inventory: [
        integration(INTEGRATION_ID, { associatedBotUserId: BOT_ID }),
        integration(OTHER_INTEGRATION_ID),
      ],
    },
  })
  await assert.rejects(
    () => ownBot.service.plan(APPLICATION_ID, BOT_ID, request()),
    /cannot delete its own integration/,
  )

  const protectedBot = fixture({
    policy: policy({ protectedUserIds: [ASSOCIATED_BOT_ID] }),
  })
  await assert.rejects(
    () => protectedBot.service.plan(APPLICATION_ID, BOT_ID, request()),
    /protected from administration/,
  )
})

test("integration plans bind inventory, identity, permissions, membership, and privacy", async () => {
  const setup = fixture()
  const first = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  const second = await setup.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(first.digest, second.digest)
  assert.equal(first.target.id, INTEGRATION_ID)
  assert.equal(first.target.associatedBotUserId, ASSOCIATED_BOT_ID)
  assert.equal(first.associatedBotMembership.present, true)
  assert.equal(first.acknowledgments.associatedBotKicked, true)
  assert.equal(first.acknowledgments.associatedWebhooksRemoved, true)
  assert.equal(first.access.manageGuild, true)
  assert.equal(first.operationKeyHash.includes(OPERATION_KEY), false)
  assert.match(first.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.match(first.warnings.join("\n"), /associated webhooks/)
  assert.match(first.warnings.join("\n"), /associated bot/)

  setup.state.inventory[0] = integration(INTEGRATION_ID, { enabled: false })
  const inventoryChanged = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  assert.notEqual(inventoryChanged.digest, first.digest)

  setup.state.associatedBotMember = null
  const membershipChanged = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  assert.notEqual(membershipChanged.digest, inventoryChanged.digest)
  assert.equal(membershipChanged.associatedBotMembership.present, false)
})

test("integration deletion reserves, journals, mutates once, and verifies all survivors", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  setup.events.length = 0

  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.targetApplicationId, TARGET_APPLICATION_ID)
  assert.equal(result.verifiedAbsent, true)
  assert.equal(result.verifiedUnchanged, true)
  assert.equal(
    setup.events.filter((entry) => entry.startsWith("write:delete")).length,
    1,
  )
  assert.deepEqual(setup.events, [
    "read:guild",
    "read:connector-member",
    "read:roles",
    "read:integrations",
    "read:associated-member",
    "operation:reserve",
    "activity:pending",
    `write:delete:${AUDIT_REASON}`,
    "read:guild",
    "read:connector-member",
    "read:roles",
    "read:readback",
    "operation:completed",
    "activity:completed",
  ])
  assert.equal(setup.operationStore.lastReceipt?.kind, "integration-deletion")
  assert.equal(setup.operationStore.lastReceipt?.resourceId, INTEGRATION_ID)
  assert.equal(setup.operationStore.lastReceipt?.verification, "match")
  assert.deepEqual(setup.activities.map(({ status }) => status), [
    "pending",
    "completed",
  ])
  const persisted = JSON.stringify({
    activities: setup.activities,
    receipt: setup.operationStore.lastReceipt,
  })
  for (const value of [AUDIT_REASON, OPERATION_KEY, "Private Guild Name"]) {
    assert.equal(persisted.includes(value), false)
  }
})

test("integration deletion rejects stale plans and spent operation keys", async () => {
  const stale = fixture()
  const stalePlan = await stale.service.plan(APPLICATION_ID, BOT_ID, request())
  stale.state.inventory[0] = integration(INTEGRATION_ID, { revoked: true })
  await assert.rejects(
    () => stale.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      stalePlan.digest,
    ),
    IntegrationDeletionPlanChangedError,
  )
  assert.equal(stale.events.some((entry) => entry.startsWith("write:")), false)

  const spent = fixture()
  const plan = await spent.service.plan(APPLICATION_ID, BOT_ID, request())
  await spent.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest)
  await assert.rejects(
    () => spent.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    IntegrationDeletionOperationConflictError,
  )
})

test("integration deletion blocks writes when pending activity cannot be recorded", async () => {
  const setup = fixture({ state: { activityFailureAt: 1 } })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())

  await assert.rejects(
    () => setup.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => (
      error instanceof IntegrationDeletionExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(setup.events.some((entry) => entry.startsWith("write:")), false)
  assert.equal(setup.operationStore.lastReceipt?.status, "failed")
})

test("integration deletion classifies rejected and unverifiable outcomes conservatively", async () => {
  const rejected = fixture({ state: { mutationError: apiError(403) } })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  await assert.rejects(
    () => rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof IntegrationDeletionExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(rejected.operationStore.lastReceipt?.status, "failed")

  for (const [guildId, state] of [
    ["200000000000000011", { mutationError: new Error("socket closed") }],
    ["200000000000000012", { readbackError: new Error("readback failed") }],
    ["200000000000000013", { mutationUpdatesState: false }],
    ["200000000000000014", { mutationDriftsOther: true }],
  ] as const) {
    const setup = fixture({ guildId, state })
    const scopedRequest = request({ guildId })
    const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, scopedRequest)
    await assert.rejects(
      () => setup.service.execute(
        APPLICATION_ID,
        BOT_ID,
        scopedRequest,
        plan.digest,
      ),
      (error: unknown) => (
        error instanceof IntegrationDeletionExecutionError
        && (error.result as { status?: string }).status === "uncertain"
      ),
    )
    assert.equal(setup.operationStore.lastReceipt?.status, "uncertain")
  }
})

test("an uncertain integration deletion quarantines later writes across its guild", async () => {
  const guildId = "200000000000000021"
  let startMutation: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    startMutation = resolve
  })
  let releaseMutation: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const setup = fixture({
    guildId,
    policy: policy({
      guildId,
      integrationIds: [INTEGRATION_ID, OTHER_INTEGRATION_ID],
    }),
    state: {
      mutationError: new Error("uncertain transport"),
      mutationGate: gate,
      mutationStarted: () => startMutation?.(),
    },
  })
  const firstRequest = request({ guildId })
  const secondRequest = request({
    acknowledgeAssociatedBotKicked: false,
    guildId,
    integrationId: OTHER_INTEGRATION_ID,
    operationKey: "integration-deletion-operation-0002",
  })
  const firstPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  const secondPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, secondRequest)
  const first = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await started
  const second = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation?.()

  await assert.rejects(first, IntegrationDeletionExecutionError)
  await assert.rejects(
    second,
    (error: unknown) => (
      error instanceof IntegrationDeletionExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(
    setup.events.filter((entry) => entry.startsWith("write:delete")).length,
    1,
  )
})

test("a completed deletion with an unfinalized receipt quarantines its guild", async () => {
  const guildId = "200000000000000031"
  const setup = fixture({
    guildId,
    policy: policy({
      guildId,
      integrationIds: [INTEGRATION_ID, OTHER_INTEGRATION_ID],
    }),
  })
  const firstRequest = request({ guildId })
  const firstPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  setup.operationStore.finishFailure = new Error("operation receipt unavailable")

  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      firstRequest,
      firstPlan.digest,
    ),
    (error: unknown) => (
      error instanceof IntegrationDeletionExecutionError
      && (error.result as { status?: string }).status
        === "completed-operation-record-failed"
    ),
  )

  setup.operationStore.finishFailure = undefined
  const secondRequest = request({
    acknowledgeAssociatedBotKicked: false,
    guildId,
    integrationId: OTHER_INTEGRATION_ID,
    operationKey: "integration-deletion-operation-0003",
  })
  const secondPlan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
  )
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      secondRequest,
      secondPlan.digest,
    ),
    (error: unknown) => (
      error instanceof IntegrationDeletionExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(
    setup.events.filter((entry) => entry.startsWith("write:delete")).length,
    1,
  )
})

test("integration service rejects malformed projected evidence before deletion", async () => {
  const setup = fixture({
    state: {
      inventory: [{
        ...integration(),
        privateName: "must-not-pass",
      } as DiscordGuildIntegrationSummary],
    },
  })
  await assert.rejects(
    () => setup.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    IntegrationEvidenceError,
  )
  assert.equal(setup.events.some((entry) => entry.startsWith("write:")), false)
})
