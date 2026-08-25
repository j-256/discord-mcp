import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import type { ApplicationPostureRequirements } from "../src/application-posture.js"
import {
  ApplicationIntentService,
  normalizeApplicationIntentEnablementRequest,
  type ApplicationIntentEnablementRequest,
  type ApplicationIntentServiceOptions,
} from "../src/application-intent-service.js"
import { DISCORD_APPLICATION_FLAGS } from "../src/constants.js"
import {
  ApplicationIntentEvidenceError,
  ApplicationIntentExecutionError,
  ApplicationIntentOperationConflictError,
  ApplicationIntentPlanChangedError,
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
import type { DiscordApplication } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const OPERATION_KEY = "application-intent-operation-0001"
const REVIEW_REASON = "Enable the member directory selected in schema-v2 policy"
const NOW = "2026-08-24T12:00:00.000Z"
const UNKNOWN_FLAG = 1n << 40n

const REQUIREMENTS: ApplicationPostureRequirements = {
  guildMembersIntentRequired: true,
  messageContentIntent: "recommended",
  nativeInteractionIngressRequired: false,
}

function request(
  overrides: Partial<ApplicationIntentEnablementRequest> = {},
): ApplicationIntentEnablementRequest {
  return {
    acknowledgePrivilegeExpansion: true,
    intent: "guild-members",
    operationKey: OPERATION_KEY,
    reviewReason: REVIEW_REASON,
    ...overrides,
  }
}

function policy(enabled = true): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(),
    allowAdministration: false,
    allowApplicationIntentChanges: enabled,
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
  applicationId: string
  flags: bigint | null
  numericFlags: number | undefined
  mutationError: unknown
  readbackError: unknown
  responseFlags: bigint | null
  readbackFlags: bigint | null
}

function fixture(options: {
  enabled?: boolean
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    applicationId: APPLICATION_ID,
    flags: UNKNOWN_FLAG | DISCORD_APPLICATION_FLAGS.gatewayPresenceLimited,
    numericFlags: 0,
    mutationError: undefined,
    readbackError: undefined,
    responseFlags: null,
    readbackFlags: null,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutated = false
  let outgoingFlags: number | null = null
  const application = (flags: bigint | null): DiscordApplication => ({
    bot: {
      bot: true,
      discriminator: "0000",
      id: BOT_ID,
      username: "connector",
    },
    description: "private application text",
    ...(flags === null ? {} : { flags_new: flags.toString(10) }),
    ...(state.numericFlags === undefined ? {} : { flags: state.numericFlags }),
    id: state.applicationId,
    name: "private application name",
  })
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
  const client: ApplicationIntentServiceOptions["client"] = {
    async getCurrentApplication() {
      events.push(mutated ? "read:readback" : "read:plan")
      if (mutated && state.readbackError) throw state.readbackError
      const flags = mutated
        ? state.readbackFlags ?? state.flags
        : state.flags
      return application(flags)
    },
    async modifyCurrentApplicationFlags(input) {
      events.push("write:flags")
      outgoingFlags = input.flags
      if (state.mutationError) throw state.mutationError
      mutated = true
      state.flags = (state.flags ?? 0n) | BigInt(input.flags)
      return application(state.responseFlags ?? state.flags)
    },
  }
  const service = new ApplicationIntentService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: Buffer.alloc(32, 7),
    policy: policy(options.enabled ?? true),
    randomId: () => "application-intent-activity-0001",
  })
  return {
    activities,
    events,
    operationStore,
    outgoingFlags: () => outgoingFlags,
    service,
    state,
  }
}

test("application intent requests are exact, acknowledged, and ephemeral", () => {
  const normalized = normalizeApplicationIntentEnablementRequest(request())
  assert.equal(normalized.intent, "guild-members")
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(normalized), new RegExp(OPERATION_KEY))

  assert.throws(
    () => normalizeApplicationIntentEnablementRequest({
      ...request(),
      acknowledgePrivilegeExpansion: false,
    } as unknown as ApplicationIntentEnablementRequest),
    /acknowledgement/,
  )
  assert.throws(
    () => normalizeApplicationIntentEnablementRequest({
      ...request(),
      applicationId: APPLICATION_ID,
    } as unknown as ApplicationIntentEnablementRequest),
    /acknowledgement/,
  )
  assert.throws(
    () => normalizeApplicationIntentEnablementRequest(request({ reviewReason: " \n" })),
    /review reason/,
  )
})

test("planning binds authoritative flags and preserves the exact limited mask", async () => {
  const current = fixture()
  const plan = await current.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request(),
  )

  assert.equal(plan.effect, "change")
  assert.equal(plan.policyRequirement, "required")
  assert.deepEqual(plan.current, {
    enabled: false,
    evidenceSource: "flags-new",
    fullAuthorization: false,
    limitedToggle: false,
  })
  assert.equal(plan.desired.method, "limited-application-flag")
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(plan), /109951|private application|Enable the member/)

  const numericFlags = fixture({
    state: {
      flags: null,
      numericFlags: Number(DISCORD_APPLICATION_FLAGS.gatewayPresenceLimited),
    },
  })
  const numericPlan = await numericFlags.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request({ operationKey: "application-intent-operation-numeric-flags" }),
  )
  assert.equal(numericPlan.current.evidenceSource, "flags")

  const result = await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request(),
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(
    current.outgoingFlags(),
    Number(
      DISCORD_APPLICATION_FLAGS.gatewayPresenceLimited
      | DISCORD_APPLICATION_FLAGS.gatewayGuildMembersLimited,
    ),
  )
  assert.deepEqual(current.events.slice(-7), [
    "read:plan",
    "operation:reserve",
    "activity:pending",
    "write:flags",
    "read:readback",
    "operation:completed",
    "activity:completed",
  ])
  assert.equal(current.activities.length, 2)
  assert.doesNotMatch(
    JSON.stringify(current.activities),
    /private application|Enable the member|application-intent-operation-0001|109951/,
  )
})

test("planning permits only policy-required or recommended targets", async () => {
  const disabled = fixture({ enabled: false })
  await assert.rejects(
    () => disabled.service.plan(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request(),
    ),
    PolicyError,
  )

  const unrelated = fixture()
  await assert.rejects(
    () => unrelated.service.plan(
      APPLICATION_ID,
      BOT_ID,
      { ...REQUIREMENTS, guildMembersIntentRequired: false },
      request(),
    ),
    PolicyError,
  )
  await assert.rejects(
    () => unrelated.service.plan(
      APPLICATION_ID,
      BOT_ID,
      { ...REQUIREMENTS, messageContentIntent: "not-required" },
      request({ intent: "message-content" }),
    ),
    PolicyError,
  )

  const recommended = await unrelated.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request({ intent: "message-content" }),
  )
  assert.equal(recommended.policyRequirement, "recommended")
})

test("an already enabled full or limited intent is a record-free no-op", async () => {
  for (const flag of [
    DISCORD_APPLICATION_FLAGS.gatewayGuildMembers,
    DISCORD_APPLICATION_FLAGS.gatewayGuildMembersLimited,
  ]) {
    const current = fixture({ state: { flags: flag } })
    const plan = await current.service.plan(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request(),
    )
    const result = await current.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request(),
      plan.digest,
    )
    assert.equal(plan.status, "already-current")
    assert.equal(result.status, "already-current")
    assert.equal(current.outgoingFlags(), null)
    assert.deepEqual(current.activities, [])
    assert.equal(current.operationStore.receipts.size, 0)
  }
})

test("changed or invalid flag evidence blocks mutation", async () => {
  const changed = fixture()
  const plan = await changed.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request(),
  )
  changed.state.flags! |= DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited
  await assert.rejects(
    () => changed.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request(),
      plan.digest,
    ),
    ApplicationIntentPlanChangedError,
  )
  assert.equal(changed.outgoingFlags(), null)

  const missing = fixture({ state: { flags: null, numericFlags: undefined } })
  await assert.rejects(
    () => missing.service.plan(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request(),
    ),
    ApplicationIntentEvidenceError,
  )
})

test("one-shot conflicts and pending audit failure block the write", async () => {
  const conflict = fixture()
  const plan = await conflict.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request(),
  )
  const normalized = normalizeApplicationIntentEnablementRequest(request())
  conflict.operationStore.receipts.set(
    `application-intent-enablement\0${normalized.operationKeyHash}`,
    {
      activityId: "prior-activity",
      applicationId: APPLICATION_ID,
      error: null,
      kind: "application-intent-enablement",
      operationKeyHash: normalized.operationKeyHash,
      planDigest: plan.digest,
      resourceId: null,
      schemaVersion: 1,
      status: "pending",
      timestamp: NOW,
      verification: null,
    },
  )
  await assert.rejects(
    () => conflict.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request(),
      plan.digest,
    ),
    ApplicationIntentOperationConflictError,
  )
  assert.equal(conflict.outgoingFlags(), null)

  const auditFailure = fixture({ state: { activityFailureAt: 1 } })
  const auditPlan = await auditFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request({ operationKey: "application-intent-operation-audit" }),
  )
  await assert.rejects(
    () => auditFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request({ operationKey: "application-intent-operation-audit" }),
      auditPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationIntentExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(auditFailure.outgoingFlags(), null)
})

test("known rejection is failed while response or readback ambiguity is uncertain", async () => {
  const rejected = fixture({
    state: {
      mutationError: new DiscordApiError({
        message: "Discord rejected the request",
        method: "PATCH",
        route: "/applications/@me",
        status: 403,
      }),
    },
  })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request({ operationKey: "application-intent-operation-rejected" }),
  )
  await assert.rejects(
    () => rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request({ operationKey: "application-intent-operation-rejected" }),
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationIntentExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(rejected.activities.at(-1)?.status, "failed")

  const rateLimited = fixture({
    state: {
      mutationError: new DiscordApiError({
        message: "Discord rate limited the request",
        method: "PATCH",
        retryAfterMs: 1_000,
        route: "/applications/@me",
        status: 429,
      }),
    },
  })
  const rateLimitedPlan = await rateLimited.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request({ operationKey: "application-intent-operation-rate-limited" }),
  )
  await assert.rejects(
    () => rateLimited.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request({ operationKey: "application-intent-operation-rate-limited" }),
      rateLimitedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationIntentExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(rateLimited.activities.at(-1)?.status, "failed")

  const drift = fixture({ state: { responseFlags: 0n } })
  const driftPlan = await drift.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request({ operationKey: "application-intent-operation-drift" }),
  )
  await assert.rejects(
    () => drift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request({ operationKey: "application-intent-operation-drift" }),
      driftPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationIntentExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal(drift.activities.at(-1)?.status, "uncertain")
})

test("verified writes fail closed when durable finalization cannot complete", async () => {
  const receiptFailure = fixture()
  const receiptPlan = await receiptFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request({ operationKey: "application-intent-operation-receipt-failure" }),
  )
  receiptFailure.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    () => receiptFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request({ operationKey: "application-intent-operation-receipt-failure" }),
      receiptPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationIntentExecutionError
      && (error.result as { status?: string }).status
        === "completed-operation-record-failed"
    ),
  )
  assert.equal(receiptFailure.outgoingFlags() === null, false)
  assert.equal(receiptFailure.activities.at(-1)?.status, "uncertain")

  const activityFailure = fixture({ state: { activityFailureAt: 2 } })
  const activityPlan = await activityFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    REQUIREMENTS,
    request({ operationKey: "application-intent-operation-activity-failure" }),
  )
  await assert.rejects(
    () => activityFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      REQUIREMENTS,
      request({ operationKey: "application-intent-operation-activity-failure" }),
      activityPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationIntentExecutionError
      && (error.result as { status?: string }).status
        === "completed-audit-failed"
    ),
  )
  const completedReceipt = [...activityFailure.operationStore.receipts.values()][0]
  assert.equal(completedReceipt?.status, "completed")
  assert.equal(completedReceipt?.verification, "match")
})
