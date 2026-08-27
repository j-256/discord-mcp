import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import type {
  ApplicationEntitlementAuditResult,
  ApplicationEntitlementInspectionRecord,
  ApplicationEntitlementInspectionResult,
} from "../src/application-monetization-audit-service.js"
import {
  ApplicationEntitlementService,
  fulfillmentReferenceHash,
  normalizeApplicationEntitlementConsumptionRequest,
  normalizeApplicationTestEntitlementChangeRequest,
  type ApplicationEntitlementConsumptionRequest,
  type ApplicationTestEntitlementChangeRequest,
} from "../src/application-entitlement-service.js"
import type { ApplicationSkuAuditResult } from "../src/application-sku-audit-service.js"
import type { ApplicationEntitlementBeneficiary } from "../src/discord-client.js"
import {
  ApplicationEntitlementEvidenceError,
  ApplicationEntitlementExecutionError,
  ApplicationEntitlementPlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import {
  operationKeyHash,
  type ApplicationEntitlementOperationReceipt,
  type ApplicationEntitlementOperationStore,
  type ApplicationOperationReceipt,
  type ApplicationOperationReservation,
  type GuildOperationKind,
  type OperationReceipt,
  type OperationReservation,
} from "../src/operation-store.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordApplication,
  DiscordApplicationEntitlement,
} from "../src/types.js"
import { fixtureApplicationSkuAudit } from "./application-sku-audit-fixture.js"

const APPLICATION_ID = "500000000000000001"
const BOT_ID = "600000000000000001"
const GUILD_ID = "700000000000000001"
const USER_ID = "800000000000000001"
const SKU_ID = "900000000000000001"
const ENTITLEMENT_ID = "910000000000000001"
const CREATE_OPERATION_KEY = "entitlement-create-operation-0001"
const DELETE_OPERATION_KEY = "entitlement-delete-operation-0001"
const CONSUME_OPERATION_KEY = "entitlement-consume-operation-0001"
const FULFILLMENT_REFERENCE = "order-fulfillment-reference-0001"
const NOW = "2026-08-27T12:00:00.000Z"

function application(): DiscordApplication {
  return { description: "Connector", id: APPLICATION_ID, name: "Connector" }
}

function beneficiaryId(beneficiary: ApplicationEntitlementBeneficiary): string {
  return beneficiary.type === "guild" ? beneficiary.guildId : beneficiary.userId
}

function record(overrides: Partial<ApplicationEntitlementInspectionRecord> = {}): ApplicationEntitlementInspectionRecord {
  return {
    consumed: false,
    deleted: false,
    endsAt: null,
    id: ENTITLEMENT_ID,
    skuId: SKU_ID,
    startsAt: null,
    type: "application-subscription",
    unknownFieldCount: 0,
    ...overrides,
  }
}

function skuAudit(options: {
  beneficiaryType?: "guild" | "user"
  purpose?: "consume" | "test"
} = {}): ApplicationSkuAuditResult {
  const audit = fixtureApplicationSkuAudit({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
  })
  const selected = audit.records[0]!
  selected.id = SKU_ID
  const purpose = options.purpose ?? "test"
  const beneficiaryType = options.beneficiaryType ?? "guild"
  if (purpose === "consume") {
    selected.flags.guildSubscription = false
    selected.flags.purchaseScope = "unspecified"
    selected.flags.userSubscription = false
    selected.type = { code: 3, name: "consumable" }
  } else if (beneficiaryType === "user") {
    selected.flags.guildSubscription = false
    selected.flags.purchaseScope = "user"
    selected.flags.userSubscription = true
  }
  return audit
}

function policy(): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowApplicationEntitlementConsumption: true,
    allowApplicationMonetizationAudit: false,
    allowApplicationTestEntitlementChanges: true,
    allowDeletions: false,
    allowInteractions: false,
    applicationConsumableEntitlementSkuIds: new Set([SKU_ID]),
    applicationConsumableEntitlementUserIds: new Set([USER_ID]),
    applicationMonetizationSkuIds: new Set([SKU_ID]),
    applicationTestEntitlementGuildIds: new Set([GUILD_ID]),
    applicationTestEntitlementSkuIds: new Set([SKU_ID]),
    applicationTestEntitlementUserIds: new Set([USER_ID]),
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

class MemoryEntitlementOperationStore implements ApplicationEntitlementOperationStore {
  readonly receipts = new Map<string, ApplicationOperationReceipt>()

  #key(kind: string, hash: string): string {
    return `${kind}\0${hash}`
  }

  async finish(_receipt: OperationReceipt): Promise<void> {
    throw new Error("Unexpected guild operation receipt")
  }

  async get(
    _kind: GuildOperationKind,
    _hash: string,
  ): Promise<OperationReceipt | undefined> {
    throw new Error("Unexpected guild operation receipt")
  }

  async reserve(_receipt: OperationReceipt): Promise<OperationReservation> {
    throw new Error("Unexpected guild operation receipt")
  }

  async getApplication(kind: ApplicationOperationReceipt["kind"], hash: string) {
    return this.receipts.get(this.#key(kind, hash))
  }

  async reserveApplication(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation> {
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }

  async checkpointApplicationEntitlement(
    receipt: ApplicationEntitlementOperationReceipt,
  ): Promise<void> {
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), receipt)
  }

  async finishApplication(receipt: ApplicationOperationReceipt): Promise<void> {
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), receipt)
  }
}

interface FixtureState {
  createCalls: number
  deleteCalls: number
  consumeCalls: number
  records: ApplicationEntitlementInspectionRecord[]
}

function fixture(options: {
  beneficiary?: ApplicationEntitlementBeneficiary
  createError?: unknown
  initialRecords?: ApplicationEntitlementInspectionRecord[]
  sku?: ApplicationSkuAuditResult
} = {}) {
  const beneficiary = options.beneficiary ?? { guildId: GUILD_ID, type: "guild" as const }
  const selectedSku = options.sku ?? skuAudit({ beneficiaryType: beneficiary.type })
  const state: FixtureState = {
    consumeCalls: 0,
    createCalls: 0,
    deleteCalls: 0,
    records: [...(options.initialRecords ?? [])],
  }
  const activities: ActivityEntry[] = []
  const activityStore: ActivityStore = {
    async append(entry) {
      activities.push(entry)
    },
    async list() {
      return { entries: [...activities], file: "memory", skippedLines: 0 }
    },
  }
  const store = new MemoryEntitlementOperationStore()
  const monetizationAuditService = {
    async auditEntitlements(
      _application: DiscordApplication,
      _botId: string,
      requestedBeneficiary: ApplicationEntitlementBeneficiary,
    ): Promise<ApplicationEntitlementAuditResult> {
      const records = state.records
        .filter((entry) => !entry.deleted)
        .map(({ deleted: _deleted, ...entry }) => entry)
      return {
        application: { botId: BOT_ID, id: APPLICATION_ID },
        beneficiary: {
          id: beneficiaryId(requestedBeneficiary),
          type: requestedBeneficiary.type,
        },
        evidence: {
          unknownFields: 0,
          unknownTypes: 0,
        },
        inventory: {
          completeness: "bounded-present-access-page",
          projectionComplete: true,
          skuIds: [SKU_ID],
        },
        page: {
          boundaryIds: {
            first: records[0]?.id ?? null,
            last: records.at(-1)?.id ?? null,
          },
          cursor: { after: null, before: null },
          possibleMore: false,
          requestedLimit: 100,
          returned: records.length,
        },
        privacy: {
          omitted: [],
          persistence: "none",
          rawPayloads: "omitted",
          unknownFields: "counts-only",
        },
        records,
        schemaVersion: 1,
        status: "ok",
        warnings: [],
      }
    },
    async inspectEntitlement(
      _application: DiscordApplication,
      _botId: string,
      requestedBeneficiary: ApplicationEntitlementBeneficiary,
      entitlementId: string,
    ): Promise<ApplicationEntitlementInspectionResult> {
      const entitlement = state.records.find((entry) => entry.id === entitlementId)
      if (!entitlement) {
        throw new DiscordApiError({
          message: "request failed",
          method: "GET",
          route: "/applications/{application.id}/entitlements/{entitlement.id}",
          status: 404,
        })
      }
      return {
        application: { botId: BOT_ID, id: APPLICATION_ID },
        beneficiary: {
          id: beneficiaryId(requestedBeneficiary),
          type: requestedBeneficiary.type,
        },
        entitlement,
        evidence: {
          projectionComplete: true,
          unknownFields: 0,
          unknownSkuFlagBits: 0,
          unknownSkuFields: 0,
          unknownSkuType: false,
          unknownType: false,
        },
        privacy: {
          omitted: [],
          persistence: "none",
          rawPayloads: "omitted",
          unknownFields: "counts-only",
        },
        schemaVersion: 1,
        sku: {
          available: true,
          id: SKU_ID,
          purchaseScope: selectedSku.records[0]!.flags.purchaseScope,
          type: selectedSku.records[0]!.type.name,
        },
        status: "ok",
        warnings: [],
      }
    },
  }
  const client = {
    async createApplicationTestEntitlement(
      _applicationId: string,
      input: { beneficiary: ApplicationEntitlementBeneficiary; skuId: string },
    ): Promise<DiscordApplicationEntitlement> {
      state.createCalls += 1
      if (options.createError !== undefined) throw options.createError
      state.records = [record()]
      return {
        application_id: APPLICATION_ID,
        consumed: false,
        deleted: false,
        ...(input.beneficiary.type === "guild"
          ? { guild_id: input.beneficiary.guildId, user_id: USER_ID }
          : { user_id: input.beneficiary.userId }),
        id: ENTITLEMENT_ID,
        sku_id: input.skuId,
        type: 8,
      }
    },
    async deleteApplicationTestEntitlement() {
      state.deleteCalls += 1
      state.records = state.records.map((entry) => ({ ...entry, deleted: true }))
    },
    async consumeApplicationEntitlement() {
      state.consumeCalls += 1
      state.records = state.records.map((entry) => ({ ...entry, consumed: true }))
    },
  }
  const service = new ApplicationEntitlementService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    monetizationAuditService,
    operationStore: store,
    planKey: new Uint8Array(32).fill(7),
    policy: policy(),
    randomId: () => "entitlement-activity-0001",
  })
  return {
    activities,
    beneficiary,
    monetizationAuditService,
    selectedSku,
    service,
    state,
    store,
  }
}

function createRequest(): ApplicationTestEntitlementChangeRequest {
  return {
    action: "create",
    auditReason: "Create one reviewed subscription test entitlement",
    beneficiary: { guildId: GUILD_ID, type: "guild" },
    operationKey: CREATE_OPERATION_KEY,
    skuId: SKU_ID,
  }
}

function deleteRequest(): ApplicationTestEntitlementChangeRequest {
  return {
    acknowledgeIrreversibleDeletion: true,
    action: "delete",
    auditReason: "Delete the connector-created test entitlement",
    beneficiary: { guildId: GUILD_ID, type: "guild" },
    creationOperationKey: CREATE_OPERATION_KEY,
    entitlementId: ENTITLEMENT_ID,
    operationKey: DELETE_OPERATION_KEY,
    skuId: SKU_ID,
  }
}

function consumptionRequest(): ApplicationEntitlementConsumptionRequest {
  return {
    acknowledgeExternalFulfillment: true,
    auditReason: "Consume after durable external fulfillment",
    entitlementId: ENTITLEMENT_ID,
    fulfillmentReference: FULFILLMENT_REFERENCE,
    operationKey: CONSUME_OPERATION_KEY,
    skuId: SKU_ID,
    userId: USER_ID,
  }
}

test("application entitlement requests hash one-shot and fulfillment references", () => {
  const create = normalizeApplicationTestEntitlementChangeRequest(createRequest())
  const deletion = normalizeApplicationTestEntitlementChangeRequest(deleteRequest())
  const consume = normalizeApplicationEntitlementConsumptionRequest(consumptionRequest())
  assert.equal(create.operationKeyHash, operationKeyHash(CREATE_OPERATION_KEY))
  assert.equal(deletion.action, "delete-test")
  if (deletion.action !== "delete-test") throw new Error("Expected delete request")
  assert.equal(deletion.acknowledgeIrreversibleDeletion, true)
  assert.equal(
    consume.fulfillmentReferenceHash,
    fulfillmentReferenceHash(FULFILLMENT_REFERENCE),
  )
  assert.doesNotMatch(JSON.stringify(consume), new RegExp(FULFILLMENT_REFERENCE, "u"))
  assert.throws(
    () => normalizeApplicationTestEntitlementChangeRequest({
      ...deleteRequest(),
      acknowledgeIrreversibleDeletion: false,
    } as unknown as ApplicationTestEntitlementChangeRequest),
    /acknowledgeIrreversibleDeletion=true/u,
  )
  assert.throws(
    () => normalizeApplicationEntitlementConsumptionRequest({
      ...consumptionRequest(),
      acknowledgeExternalFulfillment: false as true,
    }),
    /acknowledgeExternalFulfillment=true/u,
  )
})

test("reviewed test entitlement creation checkpoints the exact returned identity", async () => {
  const { activities, selectedSku, service, state, store } = fixture()
  const plan = await service.planTestEntitlementChange(
    application(),
    BOT_ID,
    selectedSku,
    createRequest(),
  )
  assert.equal(plan.status, "planned")
  assert.equal(plan.writeRequired, true)

  const result = await service.executeTestEntitlementChange(
    application(),
    BOT_ID,
    selectedSku,
    createRequest(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.entitlementId, ENTITLEMENT_ID)
  assert.equal(state.createCalls, 1)
  assert.deepEqual(
    activities.map((entry) => entry.kind === "application-entitlement-change"
      ? `${entry.stage}:${entry.status}:${entry.entitlementId}`
      : "unexpected"),
    [
      "reserved:pending:null",
      `target-known:pending:${ENTITLEMENT_ID}`,
      `terminal:completed:${ENTITLEMENT_ID}`,
    ],
  )
  const receipt = await store.getApplication(
    "application-entitlement-change",
    operationKeyHash(CREATE_OPERATION_KEY),
  )
  assert.equal(receipt?.resourceId, ENTITLEMENT_ID)
  assert.equal(receipt?.status, "completed")
  const durable = JSON.stringify({ activities, receipt })
  assert.doesNotMatch(durable, /Create one reviewed/u)
  assert.doesNotMatch(durable, new RegExp(CREATE_OPERATION_KEY, "u"))
  assert.doesNotMatch(durable, /Server supporter|server-supporter/u)
})

test("test entitlement deletion requires and consumes matching creation proof", async () => {
  const { selectedSku, service, state } = fixture()
  await assert.rejects(
    service.planTestEntitlementChange(
      application(),
      BOT_ID,
      selectedSku,
      deleteRequest(),
    ),
    ApplicationEntitlementEvidenceError,
  )

  const createPlan = await service.planTestEntitlementChange(
    application(),
    BOT_ID,
    selectedSku,
    createRequest(),
  )
  await service.executeTestEntitlementChange(
    application(),
    BOT_ID,
    selectedSku,
    createRequest(),
    createPlan.digest,
  )
  const deletePlan = await service.planTestEntitlementChange(
    application(),
    BOT_ID,
    selectedSku,
    deleteRequest(),
  )
  assert.equal(deletePlan.acknowledgeIrreversibleDeletion, true)
  assert.equal(deletePlan.creationReceipt?.verified, true)

  const result = await service.executeTestEntitlementChange(
    application(),
    BOT_ID,
    selectedSku,
    deleteRequest(),
    deletePlan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(state.deleteCalls, 1)
  assert.equal(state.records[0]?.deleted, true)
})

test("consumption binds fulfillment intent and verifies exact consumed readback", async () => {
  const initial = record({
    endsAt: "2026-09-27T12:00:00.000Z",
    startsAt: "2026-07-27T12:00:00.000Z",
    type: "purchase",
  })
  const selectedSku = skuAudit({ beneficiaryType: "user", purpose: "consume" })
  const { activities, service, state, store } = fixture({
    beneficiary: { type: "user", userId: USER_ID },
    initialRecords: [initial],
    sku: selectedSku,
  })
  const plan = await service.planEntitlementConsumption(
    application(),
    BOT_ID,
    selectedSku,
    consumptionRequest(),
  )
  assert.equal(plan.status, "planned")
  assert.equal(plan.fulfillmentReferenceHash, fulfillmentReferenceHash(FULFILLMENT_REFERENCE))

  const result = await service.executeEntitlementConsumption(
    application(),
    BOT_ID,
    selectedSku,
    consumptionRequest(),
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(state.consumeCalls, 1)
  assert.equal(state.records[0]?.consumed, true)
  const receipt = await store.getApplication(
    "application-entitlement-change",
    operationKeyHash(CONSUME_OPERATION_KEY),
  )
  const durable = JSON.stringify({ activities, receipt })
  assert.match(durable, new RegExp(fulfillmentReferenceHash(FULFILLMENT_REFERENCE), "u"))
  assert.doesNotMatch(durable, new RegExp(FULFILLMENT_REFERENCE, "u"))
  assert.doesNotMatch(durable, /Consume after durable/u)
})

test("already entitled and already consumed outcomes remain record-free", async () => {
  const entitled = fixture({ initialRecords: [record()] })
  const createPlan = await entitled.service.planTestEntitlementChange(
    application(),
    BOT_ID,
    entitled.selectedSku,
    createRequest(),
  )
  const createResult = await entitled.service.executeTestEntitlementChange(
    application(),
    BOT_ID,
    entitled.selectedSku,
    createRequest(),
    createPlan.digest,
  )
  assert.equal(createResult.status, "already-entitled")
  assert.equal(createResult.activityId, null)
  assert.equal(entitled.activities.length, 0)

  const selectedSku = skuAudit({ beneficiaryType: "user", purpose: "consume" })
  const consumed = fixture({
    beneficiary: { type: "user", userId: USER_ID },
    initialRecords: [record({ consumed: true, type: "purchase" })],
    sku: selectedSku,
  })
  const consumePlan = await consumed.service.planEntitlementConsumption(
    application(),
    BOT_ID,
    selectedSku,
    consumptionRequest(),
  )
  const consumeResult = await consumed.service.executeEntitlementConsumption(
    application(),
    BOT_ID,
    selectedSku,
    consumptionRequest(),
    consumePlan.digest,
  )
  assert.equal(consumeResult.status, "already-consumed")
  assert.equal(consumeResult.activityId, null)
  assert.equal(consumed.activities.length, 0)
})

test("execution rejects stale plans before entitlement mutation", async () => {
  const { selectedSku, service, state } = fixture()
  const plan = await service.planTestEntitlementChange(
    application(),
    BOT_ID,
    selectedSku,
    createRequest(),
  )
  state.records = [record()]
  await assert.rejects(
    service.executeTestEntitlementChange(
      application(),
      BOT_ID,
      selectedSku,
      createRequest(),
      plan.digest,
    ),
    ApplicationEntitlementPlanChangedError,
  )
  assert.equal(state.createCalls, 0)
})

test("consumption fails closed for incompatible lifecycle evidence", async () => {
  const selectedSku = skuAudit({ beneficiaryType: "user", purpose: "consume" })
  const { service } = fixture({
    beneficiary: { type: "user", userId: USER_ID },
    initialRecords: [record({ consumed: null, type: "developer-gift" })],
    sku: selectedSku,
  })
  await assert.rejects(
    service.planEntitlementConsumption(
      application(),
      BOT_ID,
      selectedSku,
      consumptionRequest(),
    ),
    ApplicationEntitlementEvidenceError,
  )
})

test("ambiguous mutation failures are quarantined without automatic retry", async () => {
  const built = fixture()
  const service = new ApplicationEntitlementService({
    activityStore: {
      async append(entry) {
        built.activities.push(entry)
      },
      async list() {
        return { entries: built.activities, file: "memory", skippedLines: 0 }
      },
    },
    client: {
      async createApplicationTestEntitlement() {
        built.state.createCalls += 1
        throw new TypeError("private network failure")
      },
      async deleteApplicationTestEntitlement() {},
      async consumeApplicationEntitlement() {},
    },
    clock: () => new Date(NOW),
    monetizationAuditService: built.monetizationAuditService,
    operationStore: built.store,
    planKey: new Uint8Array(32).fill(7),
    policy: policy(),
    randomId: () => "uncertain-entitlement-activity-0001",
  })
  const plan = await service.planTestEntitlementChange(
    application(),
    BOT_ID,
    built.selectedSku,
    createRequest(),
  )
  await assert.rejects(
    service.executeTestEntitlementChange(
      application(),
      BOT_ID,
      built.selectedSku,
      createRequest(),
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationEntitlementExecutionError
      && (error.result as { status?: unknown }).status === "uncertain"
      && !JSON.stringify(error.result).includes("private network failure")
    ),
  )
  await assert.rejects(
    service.executeTestEntitlementChange(
      application(),
      BOT_ID,
      built.selectedSku,
      createRequest(),
      plan.digest,
    ),
    /blocked after an uncertain/u,
  )
  assert.equal(built.state.createCalls, 1)
})

test("rate-limited mutations remain uncertain and preserve retry guidance", async () => {
  const built = fixture({
    createError: new DiscordApiError({
      message: "request failed",
      method: "POST",
      retryAfterMs: 12_345,
      route: "/applications/{application.id}/entitlements",
      status: 429,
    }),
  })
  const plan = await built.service.planTestEntitlementChange(
    application(),
    BOT_ID,
    built.selectedSku,
    createRequest(),
  )
  await assert.rejects(
    built.service.executeTestEntitlementChange(
      application(),
      BOT_ID,
      built.selectedSku,
      createRequest(),
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationEntitlementExecutionError
      && (error.result as { retryAfterMs?: unknown }).retryAfterMs === 12_345
      && (error.result as { status?: unknown }).status === "uncertain"
    ),
  )
  await assert.rejects(
    built.service.executeTestEntitlementChange(
      application(),
      BOT_ID,
      built.selectedSku,
      createRequest(),
      plan.digest,
    ),
    /blocked after an uncertain/u,
  )
  assert.equal(built.state.createCalls, 1)
})
