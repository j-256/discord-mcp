import assert from "node:assert/strict"
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  ApplicationEmojiService,
  normalizeApplicationEmojiChangeRequest,
  type ApplicationEmojiChangeRequest,
  type ApplicationEmojiServiceOptions,
} from "../src/application-emoji-service.js"
import type { DiscordApplicationEmojiSummary } from "../src/discord-client.js"
import {
  ApplicationEmojiEvidenceError,
  ApplicationEmojiExecutionError,
  ApplicationEmojiOperationConflictError,
  ApplicationEmojiPlanChangedError,
  DiscordApiError,
  PolicyError,
} from "../src/errors.js"
import type {
  ApplicationOperationReceipt,
  ApplicationOperationReservation,
  ApplicationOperationStore,
  GuildOperationKind,
  OperationReceipt,
  OperationReservation,
} from "../src/operation-store.js"
import { ScopePolicy } from "../src/policy.js"

const APPLICATION_ID = "100000000000000001"
const OTHER_APPLICATION_ID = "100000000000000002"
const SCHEMA_DRIFT_APPLICATION_ID = "100000000000000003"
const RECEIPT_FAILURE_APPLICATION_ID = "100000000000000004"
const BOT_ID = "200000000000000001"
const EMOJI_ID = "300000000000000001"
const OTHER_EMOJI_ID = "300000000000000002"
const CREATED_EMOJI_ID = "300000000000000099"
const OPERATION_KEY = "application-emoji-operation-0001"
const NOW = "2026-08-23T12:00:00.000Z"
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    u32(data.byteLength),
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ])
}

function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IEND"),
  ])
}

function emoji(
  overrides: Partial<DiscordApplicationEmojiSummary> = {},
): DiscordApplicationEmojiSummary {
  return {
    animated: false,
    available: true,
    id: EMOJI_ID,
    managed: false,
    name: "wave",
    requiresColons: true,
    unknownFieldCount: 0,
    uploaderProjectedOut: true,
    ...overrides,
  }
}

function renameRequest(
  overrides: Partial<ApplicationEmojiChangeRequest> = {},
): ApplicationEmojiChangeRequest {
  return {
    action: "rename",
    emojiId: EMOJI_ID,
    name: "hello",
    operationKey: OPERATION_KEY,
    ...overrides,
  } as ApplicationEmojiChangeRequest
}

function policy(options: {
  audit?: boolean
  changes?: boolean
  roots?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(),
    allowAdministration: false,
    allowApplicationEmojiAudit: options.audit ?? true,
    allowApplicationEmojiChanges: options.changes ?? true,
    allowDeletions: false,
    allowInteractions: false,
    applicationEmojiRoots: options.roots ?? [],
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

class MemoryApplicationOperationStore implements ApplicationOperationStore {
  readonly applicationReceipts = new Map<string, ApplicationOperationReceipt>()
  readonly events: string[]
  finishFailure: unknown

  constructor(events: string[]) {
    this.events = events
  }

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

  async finishApplication(receipt: ApplicationOperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.applicationReceipts.set(
      this.#key(receipt.kind, receipt.operationKeyHash),
      receipt,
    )
  }

  async getApplication(kind: "application-emoji-change", hash: string) {
    return this.applicationReceipts.get(this.#key(kind, hash))
  }

  async reserveApplication(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation> {
    this.events.push("operation:reserve")
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.applicationReceipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.applicationReceipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  applicationId: string
  createdEmojiId: string
  emojis: DiscordApplicationEmojiSummary[]
  inventoryUnknownFieldCount: number
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  preserveDeletion: boolean
  readbackError: unknown
  readbackEmojiOverrides: Partial<DiscordApplicationEmojiSummary>
}

function fixture(options: {
  fileRoots?: readonly string[]
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    applicationId: APPLICATION_ID,
    createdEmojiId: CREATED_EMOJI_ID,
    emojis: [emoji()],
    inventoryUnknownFieldCount: 0,
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    preserveDeletion: false,
    readbackError: undefined,
    readbackEmojiOverrides: {},
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutated = false
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
  const mutate = async (event: string) => {
    events.push(event)
    state.mutationStarted?.()
    if (state.mutationGate) await state.mutationGate
    if (state.mutationError) throw state.mutationError
    mutated = true
  }
  const readback = () => {
    if (mutated && state.readbackError) throw state.readbackError
  }
  const client: ApplicationEmojiServiceOptions["client"] = {
    async createApplicationEmoji(applicationId, input) {
      assert.equal(applicationId, state.applicationId)
      await mutate("write:create")
      const created = emoji({
        animated: input.format === "gif",
        id: state.createdEmojiId,
        name: input.name,
      })
      state.emojis.push(created)
      return created
    },
    async deleteApplicationEmoji(applicationId, emojiId) {
      assert.equal(applicationId, state.applicationId)
      await mutate("write:delete")
      if (!state.preserveDeletion) {
        state.emojis = state.emojis.filter((entry) => entry.id !== emojiId)
      }
    },
    async getApplicationEmoji(applicationId, emojiId) {
      assert.equal(applicationId, state.applicationId)
      events.push(mutated ? "read:get:readback" : "read:get")
      readback()
      const found = state.emojis.find((entry) => entry.id === emojiId)
      if (!found) throw new Error("emoji absent")
      return mutated
        ? { ...found, ...state.readbackEmojiOverrides }
        : found
    },
    async listApplicationEmojis(applicationId) {
      assert.equal(applicationId, state.applicationId)
      events.push(mutated ? "read:list:readback" : "read:list")
      readback()
      return {
        items: state.emojis.map((entry) => ({ ...entry })),
        unknownFieldCount: state.inventoryUnknownFieldCount,
      }
    },
    async modifyApplicationEmoji(applicationId, emojiId, input) {
      assert.equal(applicationId, state.applicationId)
      await mutate("write:rename")
      const index = state.emojis.findIndex((entry) => entry.id === emojiId)
      const current = state.emojis[index]
      if (!current) throw new Error("emoji absent")
      const updated = { ...current, name: input.name }
      state.emojis[index] = updated
      return updated
    },
  }
  const service = new ApplicationEmojiService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    fileRoots: options.fileRoots ?? [],
    operationStore,
    planKey: Buffer.alloc(32, 9),
    policy: options.policy ?? policy(
      options.fileRoots === undefined ? {} : { roots: options.fileRoots },
    ),
    randomId: () => "application-emoji-activity-0001",
  })
  return { activities, events, operationStore, service, state }
}

test("application emoji requests are exact and discard raw operation keys", () => {
  for (const request of [
    {
      action: "create",
      filePath: "/safe/wave.png",
      name: "wave",
      operationKey: OPERATION_KEY,
    },
    renameRequest(),
    {
      acknowledgeGlobalImpact: true,
      action: "delete",
      emojiId: EMOJI_ID,
      operationKey: OPERATION_KEY,
    },
  ] as ApplicationEmojiChangeRequest[]) {
    const normalized = normalizeApplicationEmojiChangeRequest(request)
    assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
    assert.doesNotMatch(JSON.stringify(normalized), new RegExp(OPERATION_KEY))
  }
  assert.throws(
    () => normalizeApplicationEmojiChangeRequest(renameRequest({ name: "bad-name" })),
    /2-32 ASCII/,
  )
  assert.throws(
    () => normalizeApplicationEmojiChangeRequest({
      action: "delete",
      acknowledgeGlobalImpact: false,
      emojiId: EMOJI_ID,
      operationKey: OPERATION_KEY,
    } as unknown as ApplicationEmojiChangeRequest),
    /acknowledgeGlobalImpact=true/,
  )
  assert.throws(
    () => normalizeApplicationEmojiChangeRequest({
      ...renameRequest(),
      applicationId: OTHER_APPLICATION_ID,
    } as unknown as ApplicationEmojiChangeRequest),
    /invalid/,
  )
})

test("application emoji reads are identity-bound and privacy projected", async () => {
  const { service } = fixture()
  const inventory = await service.list(APPLICATION_ID, BOT_ID)
  const lookup = await service.get(APPLICATION_ID, BOT_ID, EMOJI_ID)

  assert.equal(inventory.applicationId, APPLICATION_ID)
  assert.equal(inventory.botId, BOT_ID)
  assert.deepEqual(inventory.emojis, [lookup.emoji])
  assert.equal(inventory.page.safetyLimit, 2_000)
  assert.equal(inventory.privacy.privateFieldsProjectedOut, true)
  assert.ok(inventory.privacy.omittedFields.includes("uploaderId"))
  assert.doesNotMatch(JSON.stringify(inventory), /uploader.*300000000000000001/i)

  const disabled = fixture({ policy: policy({ audit: false, changes: false }) })
  await assert.rejects(
    () => disabled.service.list(APPLICATION_ID, BOT_ID),
    PolicyError,
  )
})

test("application emoji planning binds complete inventory and rejects ambiguous evidence", async () => {
  const exact = fixture()
  const plan = await exact.service.plan(APPLICATION_ID, BOT_ID, renameRequest())
  assert.equal(plan.action, "rename")
  assert.equal(plan.effect, "change")
  assert.equal(plan.existing?.name, "wave")
  assert.equal(plan.desired?.name, "hello")
  assert.match(plan.inventory.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(plan.verification.imageBytesReadableAfterWrite, false)
  assert.match(plan.risks.join("\n"), /application-wide collection/)

  exact.state.emojis[0] = emoji({ name: "hello" })
  const noOp = await exact.service.plan(APPLICATION_ID, BOT_ID, renameRequest())
  assert.equal(noOp.status, "already-current")
  assert.equal(noOp.writeRequired, false)

  const unknown = fixture({ state: { inventoryUnknownFieldCount: 1 } })
  await assert.rejects(
    () => unknown.service.plan(APPLICATION_ID, BOT_ID, renameRequest()),
    ApplicationEmojiEvidenceError,
  )
  const managed = fixture({ state: { emojis: [emoji({ managed: true })] } })
  await assert.rejects(
    () => managed.service.plan(APPLICATION_ID, BOT_ID, renameRequest()),
    ApplicationEmojiEvidenceError,
  )
  const colliding = fixture({
    state: {
      emojis: [
        emoji(),
        emoji({ id: OTHER_EMOJI_ID, name: "hello" }),
      ],
    },
  })
  await assert.rejects(
    () => colliding.service.plan(APPLICATION_ID, BOT_ID, renameRequest()),
    /rename name collides/,
  )
})

test("application emoji rename reserves, audits, mutates once, and verifies exact metadata", async () => {
  const { activities, events, operationStore, service } = fixture()
  const request = renameRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  events.length = 0
  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.observed?.name, "hello")
  assert.deepEqual(events, [
    "read:list",
    "operation:reserve",
    "activity:pending",
    "write:rename",
    "read:get:readback",
    "operation:completed",
    "activity:completed",
  ])
  const serialized = JSON.stringify({
    activities,
    receipts: [...operationStore.applicationReceipts.values()],
  })
  assert.doesNotMatch(serialized, /hello|wave/)
  assert.doesNotMatch(serialized, new RegExp(OPERATION_KEY))
})

test("application emoji absent deletion is a record-free no-op", async () => {
  const { activities, events, operationStore, service } = fixture({
    state: { emojis: [] },
  })
  const request: ApplicationEmojiChangeRequest = {
    acknowledgeGlobalImpact: true,
    action: "delete",
    emojiId: EMOJI_ID,
    operationKey: OPERATION_KEY,
  }
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "already-absent")
  assert.equal(result.activityId, null)
  assert.deepEqual(activities, [])
  assert.equal(operationStore.applicationReceipts.size, 0)
  assert.doesNotMatch(events.join("\n"), /write:/)
})

test("application emoji execution rejects changed inventory and spent keys", async () => {
  const changed = fixture()
  const request = renameRequest()
  const plan = await changed.service.plan(APPLICATION_ID, BOT_ID, request)
  changed.state.emojis.push(emoji({
    id: "300000000000000002",
    name: "second",
  }))
  await assert.rejects(
    () => changed.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    ApplicationEmojiPlanChangedError,
  )

  const spent = fixture()
  const spentPlan = await spent.service.plan(APPLICATION_ID, BOT_ID, request)
  await spent.operationStore.reserveApplication({
    activityId: "prior-activity",
    applicationId: APPLICATION_ID,
    error: null,
    kind: "application-emoji-change",
    operationKeyHash: spentPlan.operationKeyHash,
    planDigest: spentPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    () => spent.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      spentPlan.digest,
    ),
    ApplicationEmojiOperationConflictError,
  )
})

test("application emoji uncertain readback quarantines the application in-process", async () => {
  let releaseMutation: () => void = () => undefined
  let markMutationStarted: () => void = () => undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const mutationStarted = new Promise<void>((resolve) => {
    markMutationStarted = resolve
  })
  const { service, state } = fixture({
    state: {
      applicationId: OTHER_APPLICATION_ID,
      mutationGate,
      mutationStarted: markMutationStarted,
      readbackError: new Error("readback unavailable"),
    },
  })
  const firstRequest = renameRequest({
    operationKey: "application-emoji-uncertain-0001",
  })
  const firstPlan = await service.plan(
    OTHER_APPLICATION_ID,
    BOT_ID,
    firstRequest,
  )
  const secondRequest = renameRequest({
    name: "again",
    operationKey: "application-emoji-uncertain-0002",
  })
  const secondPlan = await service.plan(
    OTHER_APPLICATION_ID,
    BOT_ID,
    secondRequest,
  )
  const firstExecution = service.execute(
    OTHER_APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await mutationStarted
  const secondExecution = service.execute(
    OTHER_APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation()
  await assert.rejects(
    () => firstExecution,
    (error: unknown) => (
      error instanceof ApplicationEmojiExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )

  state.readbackError = undefined
  await assert.rejects(
    () => secondExecution,
    (error: unknown) => (
      error instanceof ApplicationEmojiExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
})

test("application emoji schema-drift readback is uncertain", async () => {
  const { service } = fixture({
    state: {
      applicationId: SCHEMA_DRIFT_APPLICATION_ID,
      readbackEmojiOverrides: { unknownFieldCount: 1 },
    },
  })
  const request = renameRequest({
    operationKey: "application-emoji-schema-drift-0001",
  })
  const plan = await service.plan(
    SCHEMA_DRIFT_APPLICATION_ID,
    BOT_ID,
    request,
  )

  await assert.rejects(
    () => service.execute(
      SCHEMA_DRIFT_APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof ApplicationEmojiExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
})

test("application emoji receipt-finalization failure blocks queued application work", async () => {
  let releaseMutation: () => void = () => undefined
  let markMutationStarted: () => void = () => undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const mutationStarted = new Promise<void>((resolve) => {
    markMutationStarted = resolve
  })
  const { operationStore, service } = fixture({
    state: {
      applicationId: RECEIPT_FAILURE_APPLICATION_ID,
      mutationGate,
      mutationStarted: markMutationStarted,
    },
  })
  operationStore.finishFailure = new Error("operation receipt unavailable")
  const firstRequest = renameRequest({
    operationKey: "application-emoji-receipt-failure-0001",
  })
  const firstPlan = await service.plan(
    RECEIPT_FAILURE_APPLICATION_ID,
    BOT_ID,
    firstRequest,
  )
  const secondRequest = renameRequest({
    name: "again",
    operationKey: "application-emoji-receipt-failure-0002",
  })
  const secondPlan = await service.plan(
    RECEIPT_FAILURE_APPLICATION_ID,
    BOT_ID,
    secondRequest,
  )
  const firstExecution = service.execute(
    RECEIPT_FAILURE_APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await mutationStarted
  const secondExecution = service.execute(
    RECEIPT_FAILURE_APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation()

  await assert.rejects(
    () => firstExecution,
    (error: unknown) => (
      error instanceof ApplicationEmojiExecutionError
      && (error.result as { status?: string }).status
        === "completed-operation-record-failed"
    ),
  )
  await assert.rejects(
    () => secondExecution,
    (error: unknown) => (
      error instanceof ApplicationEmojiExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
})

test("application emoji creation reads only a canonical owned local image", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-application-emoji-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "wave.png")
  await writeFile(filePath, png(32, 32), { mode: 0o600 })
  const { activities, operationStore, service } = fixture({ fileRoots: [root] })
  const request: ApplicationEmojiChangeRequest = {
    action: "create",
    filePath,
    name: "fresh_wave",
    operationKey: "application-emoji-create-0001",
  }
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.file?.review.canonicalPath, filePath)
  assert.equal(plan.file?.review.format, "png")
  assert.equal(plan.file?.review.width, 32)
  assert.equal(plan.file?.review.height, 32)

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.emojiId, CREATED_EMOJI_ID)
  assert.equal(result.status, "completed")
  const persisted = JSON.stringify({
    activities,
    receipts: [...operationStore.applicationReceipts.values()],
  })
  assert.doesNotMatch(persisted, /fresh_wave|wave\.png|image\/png/)
})

test("application emoji mutation 4xx failures are terminal without false success", async () => {
  const { activities, operationStore, service } = fixture({
    state: {
      mutationError: new DiscordApiError({
        code: 50_035,
        message: "rejected",
        method: "PATCH",
        route: "/applications/:id/emojis/:id",
        status: 400,
      }),
    },
  })
  const request = renameRequest({
    operationKey: "application-emoji-failed-0001",
  })
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof ApplicationEmojiExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(activities.at(-1)?.status, "failed")
  assert.equal(
    [...operationStore.applicationReceipts.values()].at(-1)?.status,
    "failed",
  )
})
