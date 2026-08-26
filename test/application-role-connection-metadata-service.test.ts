import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  applicationRoleConnectionMetadataSchemaBody,
  type ApplicationRoleConnectionMetadataDefinition,
} from "../src/application-role-connection-metadata-definition.js"
import { DISCORD_LOCALES } from "../src/constants.js"
import {
  ApplicationRoleConnectionMetadataService,
  normalizeApplicationRoleConnectionMetadataChangeRequest,
  type ApplicationRoleConnectionMetadataChangeRequest,
  type ApplicationRoleConnectionMetadataServiceOptions,
} from "../src/application-role-connection-metadata-service.js"
import {
  ApplicationRoleConnectionMetadataEvidenceError,
  ApplicationRoleConnectionMetadataExecutionError,
  ApplicationRoleConnectionMetadataOperationConflictError,
  ApplicationRoleConnectionMetadataPlanChangedError,
  DiscordApiError,
  PolicyError,
} from "../src/errors.js"
import type {
  ApplicationOperationKind,
  ApplicationOperationReceipt,
  ApplicationOperationReservation,
  ApplicationOperationStore,
  GuildOperationKind,
  OperationReceipt,
  OperationReservation,
} from "../src/operation-store.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordApplication,
  DiscordApplicationRoleConnectionMetadata,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const OPERATION_KEY = "linked-role-schema-operation-0001"
const NOW = "2026-08-25T16:00:00.000Z"

function definition(
  overrides: Partial<ApplicationRoleConnectionMetadataDefinition> = {},
): ApplicationRoleConnectionMetadataDefinition {
  return {
    description: "Minimum completed reviews",
    descriptionLocalizations: [],
    key: "review_count",
    name: "Review count",
    nameLocalizations: [],
    type: "integer-greater-than-or-equal",
    ...overrides,
  }
}

function replaceRequest(
  overrides: Partial<ApplicationRoleConnectionMetadataChangeRequest> = {},
): ApplicationRoleConnectionMetadataChangeRequest {
  return {
    acknowledgeGlobalReplacement: true,
    action: "replace",
    operationKey: OPERATION_KEY,
    records: [definition()],
    ...overrides,
  } as ApplicationRoleConnectionMetadataChangeRequest
}

function clearRequest(operationKey = OPERATION_KEY): ApplicationRoleConnectionMetadataChangeRequest {
  return {
    acknowledgeSchemaClearance: true,
    action: "clear",
    operationKey,
  }
}

function application(overrides: Partial<DiscordApplication> = {}): DiscordApplication {
  return {
    bot: {
      bot: true,
      discriminator: "0000",
      id: BOT_ID,
      username: "connector",
    },
    description: "private application text",
    id: APPLICATION_ID,
    name: "private application name",
    role_connections_verification_url: "https://private.example.test/linked-role",
    ...overrides,
  }
}

function policy(enabled = true): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(),
    allowAdministration: false,
    allowApplicationRoleConnectionMetadataChanges: enabled,
    allowDeletions: false,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

class MemoryApplicationOperationStore implements ApplicationOperationStore {
  readonly events: string[]
  readonly receipts = new Map<string, ApplicationOperationReceipt>()
  finishFailure: unknown

  constructor(events: string[]) {
    this.events = events
  }

  #key(kind: ApplicationOperationKind, hash: string): string {
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

  async finishApplication(receipt: ApplicationOperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), receipt)
  }

  async getApplication(kind: ApplicationOperationKind, hash: string) {
    return this.receipts.get(this.#key(kind, hash))
  }

  async reserveApplication(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation> {
    this.events.push("operation:reserve")
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  current: DiscordApplicationRoleConnectionMetadata[]
  mutationError: unknown
  readbackError: unknown
  response: DiscordApplicationRoleConnectionMetadata[] | null
}

function fixture(options: {
  enabled?: boolean
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    current: applicationRoleConnectionMetadataSchemaBody([definition()]),
    mutationError: undefined,
    readbackError: undefined,
    response: null,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutated = false
  let writes = 0
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
  const operationStore = new MemoryApplicationOperationStore(events)
  const client: ApplicationRoleConnectionMetadataServiceOptions["client"] = {
    async listApplicationRoleConnectionMetadata() {
      events.push(mutated ? "read:readback" : "read:plan")
      if (mutated && state.readbackError) throw state.readbackError
      return structuredClone(state.current)
    },
    async replaceApplicationRoleConnectionMetadata(_applicationId, input) {
      events.push("write:schema")
      writes += 1
      if (state.mutationError) throw state.mutationError
      mutated = true
      state.current = structuredClone([...input])
      return structuredClone(state.response ?? state.current)
    },
  }
  const service = new ApplicationRoleConnectionMetadataService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: Buffer.alloc(32, 11),
    policy: policy(options.enabled ?? true),
    randomId: () => "linked-role-metadata-activity-0001",
  })
  return {
    activities,
    events,
    operationStore,
    service,
    state,
    writes: () => writes,
  }
}

test("linked-role metadata requests are exact, acknowledged, and content-free after normalization", () => {
  const normalized = normalizeApplicationRoleConnectionMetadataChangeRequest(replaceRequest())
  assert.equal(normalized.action, "replace")
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  assert.doesNotMatch(JSON.stringify(normalized), new RegExp(OPERATION_KEY, "u"))

  assert.equal(
    normalizeApplicationRoleConnectionMetadataChangeRequest(clearRequest()).action,
    "clear",
  )
  const invalid: unknown[] = [
    { ...replaceRequest(), acknowledgeGlobalReplacement: false },
    { ...replaceRequest(), applicationId: APPLICATION_ID },
    { ...replaceRequest(), records: [] },
    { action: "clear", operationKey: OPERATION_KEY },
    { ...clearRequest(), records: [] },
    { action: "future", operationKey: OPERATION_KEY },
  ]
  for (const request of invalid) {
    assert.throws(
      () => normalizeApplicationRoleConnectionMetadataChangeRequest(
        request as ApplicationRoleConnectionMetadataChangeRequest,
      ),
      RangeError,
    )
  }

  const oversizedRecords = Array.from({ length: 5 }, (_, index) => definition({
    description: "D".repeat(200),
    descriptionLocalizations: DISCORD_LOCALES.map((locale) => ({
      locale,
      value: "\u{1F512}".repeat(200),
    })),
    key: `oversized_${index}`,
    name: "N".repeat(100),
    nameLocalizations: DISCORD_LOCALES.map((locale) => ({
      locale,
      value: "\u{1F512}".repeat(100),
    })),
  }))
  assert.throws(
    () => normalizeApplicationRoleConnectionMetadataChangeRequest(
      replaceRequest({ records: oversizedRecords }),
    ),
    /request-size bound/u,
  )
})

test("linked-role metadata planning binds the complete schema and count-only diff", async () => {
  const current = fixture({
    state: {
      current: applicationRoleConnectionMetadataSchemaBody([
        definition(),
        definition({ key: "verified", name: "Verified", type: "boolean-equal" }),
      ]),
    },
  })
  const desired = [
    definition({ name: "Completed reviews" }),
    definition({ key: "member_days", name: "Member days", type: "integer-greater-than-or-equal" }),
  ]
  const plan = await current.service.plan(
    application(),
    BOT_ID,
    replaceRequest({ records: desired }),
  )

  assert.equal(plan.status, "planned")
  assert.equal(plan.effect, "change")
  assert.equal(plan.acknowledgement, "application-wide-replacement")
  assert.deepEqual(plan.diff, {
    added: 1,
    changed: 1,
    removed: 1,
    reordered: false,
    unchanged: 0,
  })
  assert.equal(plan.current.length, 2)
  assert.deepEqual(plan.desired, desired)
  assert.equal(plan.verificationEndpointConfigured, true)
  assert.match(plan.currentSchemaDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.match(plan.desiredSchemaDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/u)
  assert.doesNotMatch(JSON.stringify(plan), /private application|private\.example/u)

  const withoutEndpoint = await current.service.plan(
    application({ role_connections_verification_url: null }),
    BOT_ID,
    replaceRequest({ operationKey: "linked-role-no-endpoint", records: desired }),
  )
  assert.equal(withoutEndpoint.verificationEndpointConfigured, false)
  assert.match(withoutEndpoint.warnings.join("\n"), /no linked-role verification endpoint/u)
})

test("linked-role metadata execution records content-free evidence before one exact write", async () => {
  const current = fixture()
  const desired = [definition({ name: "Completed reviews" })]
  const requested = replaceRequest({ records: desired })
  const plan = await current.service.plan(application(), BOT_ID, requested)
  const result = await current.service.execute(
    application(),
    BOT_ID,
    requested,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.deepEqual(result.observed, desired)
  assert.equal(current.writes(), 1)
  assert.deepEqual(current.events.slice(-7), [
    "read:plan",
    "operation:reserve",
    "activity:pending",
    "write:schema",
    "read:readback",
    "operation:completed",
    "activity:completed",
  ])
  assert.equal(current.activities.length, 2)
  const durable = JSON.stringify(current.activities)
  assert.doesNotMatch(durable, /Completed reviews|Minimum completed reviews|review_count/u)
  assert.doesNotMatch(durable, new RegExp(OPERATION_KEY, "u"))
  assert.match(durable, /application-role-connection-metadata-change/u)
})

test("linked-role metadata no-ops and empty clearance reserve nothing", async () => {
  const unchanged = fixture()
  const unchangedPlan = await unchanged.service.plan(
    application(),
    BOT_ID,
    replaceRequest(),
  )
  const unchangedResult = await unchanged.service.execute(
    application(),
    BOT_ID,
    replaceRequest(),
    unchangedPlan.digest,
  )
  assert.equal(unchangedPlan.status, "already-current")
  assert.equal(unchangedResult.status, "already-current")
  assert.equal(unchanged.writes(), 0)
  assert.deepEqual(unchanged.activities, [])
  assert.equal(unchanged.operationStore.receipts.size, 0)

  const empty = fixture({ state: { current: [] } })
  const emptyPlan = await empty.service.plan(application(), BOT_ID, clearRequest())
  const emptyResult = await empty.service.execute(
    application(),
    BOT_ID,
    clearRequest(),
    emptyPlan.digest,
  )
  assert.equal(emptyPlan.status, "already-empty")
  assert.equal(emptyResult.status, "already-empty")
  assert.equal(empty.writes(), 0)
})

test("linked-role metadata planning fails closed on policy, identity, and future evidence", async () => {
  const disabled = fixture({ enabled: false })
  await assert.rejects(
    disabled.service.plan(application(), BOT_ID, replaceRequest()),
    PolicyError,
  )

  const wrongBot = fixture()
  await assert.rejects(
    wrongBot.service.plan(
      application({ bot: { bot: true, discriminator: "0000", id: "300", username: "other" } }),
      BOT_ID,
      replaceRequest(),
    ),
    ApplicationRoleConnectionMetadataEvidenceError,
  )

  const future = fixture({
    state: {
      current: [{
        ...applicationRoleConnectionMetadataSchemaBody([definition()])[0]!,
        future: "private-future-value",
      }] as unknown as DiscordApplicationRoleConnectionMetadata[],
    },
  })
  await assert.rejects(
    future.service.plan(application(), BOT_ID, replaceRequest()),
    (error: unknown) => (
      error instanceof ApplicationRoleConnectionMetadataEvidenceError
      && !error.message.includes("private-future-value")
    ),
  )
})

test("linked-role metadata execution rejects stale plans, spent keys, and audit failure", async () => {
  const stale = fixture()
  const stalePlan = await stale.service.plan(application(), BOT_ID, replaceRequest({
    records: [definition({ name: "Completed reviews" })],
  }))
  stale.state.current = applicationRoleConnectionMetadataSchemaBody([
    definition({ key: "verified", name: "Verified", type: "boolean-equal" }),
  ])
  await assert.rejects(
    stale.service.execute(
      application(),
      BOT_ID,
      replaceRequest({ records: [definition({ name: "Completed reviews" })] }),
      stalePlan.digest,
    ),
    ApplicationRoleConnectionMetadataPlanChangedError,
  )
  assert.equal(stale.writes(), 0)

  const conflict = fixture()
  const conflictRequest = replaceRequest({
    operationKey: "linked-role-conflict",
    records: [definition({ name: "Completed reviews" })],
  })
  const conflictPlan = await conflict.service.plan(application(), BOT_ID, conflictRequest)
  const normalized = normalizeApplicationRoleConnectionMetadataChangeRequest(conflictRequest)
  conflict.operationStore.receipts.set(
    `application-role-connection-metadata-change\0${normalized.operationKeyHash}`,
    {
      activityId: "prior-activity",
      applicationId: APPLICATION_ID,
      error: null,
      kind: "application-role-connection-metadata-change",
      operationKeyHash: normalized.operationKeyHash,
      planDigest: conflictPlan.digest,
      resourceId: null,
      schemaVersion: 1,
      status: "pending",
      timestamp: NOW,
      verification: null,
    },
  )
  await assert.rejects(
    conflict.service.execute(application(), BOT_ID, conflictRequest, conflictPlan.digest),
    ApplicationRoleConnectionMetadataOperationConflictError,
  )
  assert.equal(conflict.writes(), 0)

  const auditFailure = fixture({ state: { activityFailureAt: 1 } })
  const auditRequest = replaceRequest({
    operationKey: "linked-role-audit-failure",
    records: [definition({ name: "Completed reviews" })],
  })
  const auditPlan = await auditFailure.service.plan(application(), BOT_ID, auditRequest)
  await assert.rejects(
    auditFailure.service.execute(application(), BOT_ID, auditRequest, auditPlan.digest),
    (error: unknown) => (
      error instanceof ApplicationRoleConnectionMetadataExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(auditFailure.writes(), 0)
})

test("linked-role metadata distinguishes rejection from uncertain response and readback", async () => {
  const rejected = fixture({
    state: {
      mutationError: new DiscordApiError({
        message: "Discord rejected the request",
        method: "PUT",
        route: "/applications/{application.id}/role-connections/metadata",
        status: 403,
      }),
    },
  })
  const rejectedRequest = replaceRequest({
    operationKey: "linked-role-rejected",
    records: [definition({ name: "Completed reviews" })],
  })
  const rejectedPlan = await rejected.service.plan(application(), BOT_ID, rejectedRequest)
  await assert.rejects(
    rejected.service.execute(application(), BOT_ID, rejectedRequest, rejectedPlan.digest),
    (error: unknown) => (
      error instanceof ApplicationRoleConnectionMetadataExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(rejected.activities.at(-1)?.status, "failed")

  const rateLimited = fixture({
    state: {
      mutationError: new DiscordApiError({
        message: "Discord rate limited the request",
        method: "PUT",
        retryAfterMs: 1_000,
        route: "/applications/{application.id}/role-connections/metadata",
        status: 429,
      }),
    },
  })
  const rateRequest = replaceRequest({
    operationKey: "linked-role-rate-limited",
    records: [definition({ name: "Completed reviews" })],
  })
  const ratePlan = await rateLimited.service.plan(application(), BOT_ID, rateRequest)
  await assert.rejects(
    rateLimited.service.execute(application(), BOT_ID, rateRequest, ratePlan.digest),
    (error: unknown) => (
      error instanceof ApplicationRoleConnectionMetadataExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )

  const responseDrift = fixture({
    state: {
      response: applicationRoleConnectionMetadataSchemaBody([
        definition({ key: "unexpected", name: "Unexpected" }),
      ]),
    },
  })
  const driftRequest = replaceRequest({
    operationKey: "linked-role-response-drift",
    records: [definition({ name: "Completed reviews" })],
  })
  const driftPlan = await responseDrift.service.plan(application(), BOT_ID, driftRequest)
  await assert.rejects(
    responseDrift.service.execute(application(), BOT_ID, driftRequest, driftPlan.digest),
    (error: unknown) => (
      error instanceof ApplicationRoleConnectionMetadataExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal(responseDrift.activities.at(-1)?.status, "uncertain")

  const readback = fixture({ state: { readbackError: new Error("private readback") } })
  const readbackRequest = replaceRequest({
    operationKey: "linked-role-readback-failure",
    records: [definition({ name: "Completed reviews" })],
  })
  const readbackPlan = await readback.service.plan(application(), BOT_ID, readbackRequest)
  await assert.rejects(
    readback.service.execute(application(), BOT_ID, readbackRequest, readbackPlan.digest),
    (error: unknown) => (
      error instanceof ApplicationRoleConnectionMetadataExecutionError
      && (error.result as { status?: string }).status === "uncertain"
      && !JSON.stringify(error.result).includes("private readback")
    ),
  )
})

test("linked-role metadata verified writes fail closed when durable finalization fails", async () => {
  const receiptFailure = fixture()
  const request = replaceRequest({
    operationKey: "linked-role-receipt-failure",
    records: [definition({ name: "Completed reviews" })],
  })
  const plan = await receiptFailure.service.plan(application(), BOT_ID, request)
  receiptFailure.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    receiptFailure.service.execute(application(), BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof ApplicationRoleConnectionMetadataExecutionError
      && (error.result as { status?: string }).status
        === "completed-operation-record-failed"
    ),
  )
  assert.equal(receiptFailure.writes(), 1)
  assert.equal(receiptFailure.activities.at(-1)?.status, "uncertain")

  const activityFailure = fixture({ state: { activityFailureAt: 2 } })
  const activityRequest = replaceRequest({
    operationKey: "linked-role-activity-failure",
    records: [definition({ name: "Completed reviews" })],
  })
  const activityPlan = await activityFailure.service.plan(
    application(),
    BOT_ID,
    activityRequest,
  )
  await assert.rejects(
    activityFailure.service.execute(
      application(),
      BOT_ID,
      activityRequest,
      activityPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationRoleConnectionMetadataExecutionError
      && (error.result as { status?: string }).status === "completed-audit-failed"
    ),
  )
  const completedReceipt = [...activityFailure.operationStore.receipts.values()][0]
  assert.equal(completedReceipt?.status, "completed")
  assert.equal(completedReceipt?.verification, "match")
})
