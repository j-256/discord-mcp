import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type {
  CreateStageInstanceInput,
  DiscordStageInstanceSummary,
  ModifyStageInstanceInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  InteractionRateLimitError,
  PolicyError,
  StageInstanceEvidenceError,
  StageInstanceExecutionError,
  StageInstanceOperationConflictError,
  StageInstancePlanChangedError,
} from "../src/errors.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeStageInstanceChangeRequest,
  StageInstanceService,
  type StageInstanceChangeRequest,
  type StageInstanceServiceOptions,
} from "../src/stage-instance-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OTHER_GUILD_ID = "200000000000000002"
const CHANNEL_ID = "300000000000000001"
const OTHER_CHANNEL_ID = "300000000000000002"
const STAGE_ID = "400000000000000001"
const CREATED_STAGE_ID = "400000000000000002"
const BOT_ID = "500000000000000001"
const OWNER_ID = "600000000000000001"
const BOT_ROLE_ID = "700000000000000001"
const SCHEDULED_EVENT_ID = "800000000000000001"
const OPERATION_KEY = "stage-instance-operation-0001"
const NOW = "2026-08-21T20:30:00.000Z"

const STAGE_PERMISSIONS = DISCORD_PERMISSIONS.VIEW_CHANNEL
  | DISCORD_PERMISSIONS.CONNECT
  | DISCORD_PERMISSIONS.MANAGE_CHANNELS
  | DISCORD_PERMISSIONS.MUTE_MEMBERS
  | DISCORD_PERMISSIONS.MOVE_MEMBERS
  | DISCORD_PERMISSIONS.MENTION_EVERYONE

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: id === BOT_ROLE_ID,
    name: id === GUILD_ID ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position,
  }
}

function stageChannel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "Town hall",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.stageVoice,
    ...overrides,
  }
}

function stage(
  overrides: Partial<DiscordStageInstanceSummary> = {},
): DiscordStageInstanceSummary {
  return {
    channelId: CHANNEL_ID,
    discoverableDisabled: true,
    guildId: GUILD_ID,
    id: STAGE_ID,
    privacyLevel: 2,
    scheduledEventId: null,
    topic: "Town hall",
    unknownFieldCount: 0,
    ...overrides,
  }
}

function startRequest(
  overrides: Partial<StageInstanceChangeRequest> = {},
): StageInstanceChangeRequest {
  return {
    action: "start",
    auditReason: "Reviewed Stage start",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    topic: "Town hall",
    ...overrides,
  } as StageInstanceChangeRequest
}

function updateRequest(
  overrides: Partial<StageInstanceChangeRequest> = {},
): StageInstanceChangeRequest {
  return {
    action: "update",
    auditReason: "Reviewed Stage update",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    topic: "Questions",
    ...overrides,
  } as StageInstanceChangeRequest
}

function endRequest(
  overrides: Partial<StageInstanceChangeRequest> = {},
): StageInstanceChangeRequest {
  return {
    action: "end",
    auditReason: "Reviewed Stage end",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  } as StageInstanceChangeRequest
}

function policy(options: {
  audit?: boolean
  changes?: boolean
  notifications?: boolean
  stageChannelIds?: readonly string[]
} = {}): ScopePolicy {
  const stageChannelIds = options.stageChannelIds || [CHANNEL_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(stageChannelIds),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowStageInstanceAudit: options.audit ?? true,
    allowStageInstanceChanges: options.changes ?? true,
    allowStageStartNotifications: options.notifications ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    stageChannelIds: new Set(stageChannelIds),
  })
}

class MemoryOperationStore implements OperationStore {
  finishCompletedFailure: unknown
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (receipt.status === "completed" && this.finishCompletedFailure) {
      throw this.finishCompletedFailure
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
  activities: ActivityEntry[]
  activityFailureAt: number | null
  botMember: DiscordGuildMember
  channel: DiscordChannel
  createInput: CreateStageInstanceInput | null
  current: DiscordStageInstanceSummary | null
  deleteReason: string | null
  events: string[]
  guild: DiscordGuild
  modifyInput: ModifyStageInstanceInput | null
  mutationApplied: boolean
  mutationError: unknown
  mutationErrorAfterApply: boolean
  operationStore: MemoryOperationStore
  readback: DiscordStageInstanceSummary | null | undefined
  readbackError: unknown
  roles: DiscordRole[]
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected Stage request",
    method: "POST",
    route: "/stage-instances",
    status,
  })
}

function fixture(options: {
  client?: Partial<StageInstanceServiceOptions["client"]>
  limiter?: InteractionLimiter
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}): { service: StageInstanceService; state: FixtureState } {
  const events: string[] = []
  const activities: ActivityEntry[] = []
  const state: FixtureState = {
    activities,
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channel: stageChannel(),
    createInput: null,
    current: null,
    deleteReason: null,
    events,
    guild: { id: GUILD_ID, name: "Private guild", owner_id: OWNER_ID },
    modifyInput: null,
    mutationApplied: false,
    mutationError: null,
    mutationErrorAfterApply: false,
    operationStore: new MemoryOperationStore(events),
    readback: undefined,
    readbackError: null,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, STAGE_PERMISSIONS, 1),
    ],
    ...options.state,
  }
  const activityStore: ActivityStore = {
    async append(entry) {
      events.push(`activity:${entry.status}`)
      if (
        state.activityFailureAt !== null
        && activities.length === state.activityFailureAt
      ) throw new Error("activity unavailable")
      activities.push(entry)
    },
    async list() {
      return { entries: [...activities], file: "/test/activity.jsonl", skippedLines: 0 }
    },
  }
  const applyMutation = (next: DiscordStageInstanceSummary | null): void => {
    state.mutationApplied = true
    state.current = next
  }
  const client: StageInstanceServiceOptions["client"] = {
    async createStageInstance(input, auditReason) {
      events.push("discord:create-stage")
      state.createInput = input
      const response = stage({
        id: CREATED_STAGE_ID,
        topic: input.topic,
      })
      if (state.mutationErrorAfterApply) applyMutation(response)
      if (state.mutationError) throw state.mutationError
      applyMutation(response)
      assert.equal(auditReason, "Reviewed Stage start")
      return response
    },
    async deleteStageInstance(_channelId, auditReason) {
      events.push("discord:delete-stage")
      state.deleteReason = auditReason
      if (state.mutationErrorAfterApply) applyMutation(null)
      if (state.mutationError) throw state.mutationError
      applyMutation(null)
    },
    async getChannel() {
      events.push("discord:get-channel")
      return state.channel
    },
    async getGuild() {
      events.push("discord:get-guild")
      return state.guild
    },
    async getGuildMember() {
      events.push("discord:get-member")
      return state.botMember
    },
    async getGuildRoles() {
      events.push("discord:get-roles")
      return state.roles
    },
    async getStageInstance() {
      events.push("discord:get-stage")
      if (state.mutationApplied && state.readbackError) throw state.readbackError
      const value = state.mutationApplied && state.readback !== undefined
        ? state.readback
        : state.current
      if (value === null) throw apiError(404)
      return value
    },
    async modifyStageInstance(_channelId, input, auditReason) {
      events.push("discord:modify-stage")
      state.modifyInput = input
      const response = stage({
        id: state.current?.id ?? STAGE_ID,
        topic: input.topic,
      })
      if (state.mutationErrorAfterApply) applyMutation(response)
      if (state.mutationError) throw state.mutationError
      applyMutation(response)
      assert.equal(auditReason, "Reviewed Stage update")
      return response
    },
  }
  Object.assign(client, options.client)
  return {
    service: new StageInstanceService({
      activityStore,
      client,
      clock: () => new Date(NOW),
      limiter: options.limiter || new InteractionLimiter({
        maxWritesPerMinute: 10,
        minWriteIntervalMs: 0,
      }),
      operationStore: state.operationStore,
      planKey: Uint8Array.from({ length: 32 }, () => 17),
      policy: options.policy || policy(),
      randomId: () => "activity-stage-1",
    }),
    state,
  }
}

test("Stage request normalization rejects cross-action fields and hashes one-shot keys", () => {
  const normalized = normalizeStageInstanceChangeRequest(startRequest({
    sendStartNotification: true,
  }))
  assert.deepEqual(normalized, {
    action: "start",
    auditReason: "Reviewed Stage start",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKeyHash: normalized.operationKeyHash,
    sendStartNotification: true,
    topic: "Town hall",
  })
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.throws(
    () => normalizeStageInstanceChangeRequest({
      ...endRequest(),
      topic: "Not allowed",
    } as StageInstanceChangeRequest),
    /accepts no content fields/,
  )
  assert.throws(
    () => normalizeStageInstanceChangeRequest(startRequest({ topic: " " })),
    /topic/,
  )
  assert.throws(
    () => normalizeStageInstanceChangeRequest(startRequest({
      guildId: OTHER_GUILD_ID,
      operationKey: "short",
    })),
    /operation key/,
  )
})

test("Stage reads expose bounded active or inactive state without persisting content", async () => {
  const inactiveFixture = fixture()
  const inactive = await inactiveFixture.service.get(BOT_ID, GUILD_ID, CHANNEL_ID)
  assert.equal(inactive.status, "inactive")
  assert.equal(inactive.instance, null)
  assert.deepEqual(inactive.access.requiredPermissions, ["VIEW_CHANNEL"])

  inactiveFixture.state.current = stage({
    privacyLevel: 1,
    scheduledEventId: SCHEDULED_EVENT_ID,
    unknownFieldCount: 1,
  })
  const active = await inactiveFixture.service.get(BOT_ID, GUILD_ID, CHANNEL_ID)
  assert.equal(active.status, "active")
  assert.equal(active.instance?.privacyLevel, "public-deprecated")
  assert.equal(active.instance?.scheduledEventId, SCHEDULED_EVENT_ID)
  assert.equal(active.instance?.unknownFieldCount, 1)
  assert.equal(inactiveFixture.state.activities.length, 0)

  const inventory = await inactiveFixture.service.list(BOT_ID)
  assert.deepEqual(inventory.page, {
    active: 1,
    configured: 1,
    inactive: 0,
    returned: 1,
    safetyLimit: 25,
  })
})

test("Stage inventory shares guild evidence only within one bounded read", async () => {
  let channelReads = 0
  let guildReads = 0
  let memberReads = 0
  let roleReads = 0
  let stageReads = 0
  const { service } = fixture({
    client: {
      async getChannel(channelId) {
        channelReads += 1
        return stageChannel({ id: channelId })
      },
      async getGuild() {
        guildReads += 1
        return { id: GUILD_ID, name: "Private guild", owner_id: OWNER_ID }
      },
      async getGuildMember() {
        memberReads += 1
        return {
          roles: [BOT_ROLE_ID],
          user: { bot: true, id: BOT_ID, username: "connector" },
        }
      },
      async getGuildRoles() {
        roleReads += 1
        return [
          role(GUILD_ID, 0n, 0),
          role(BOT_ROLE_ID, STAGE_PERMISSIONS, 1),
        ]
      },
      async getStageInstance(channelId) {
        stageReads += 1
        return stage({
          channelId,
          id: channelId === CHANNEL_ID ? STAGE_ID : CREATED_STAGE_ID,
        })
      },
    },
    policy: policy({ stageChannelIds: [OTHER_CHANNEL_ID, CHANNEL_ID] }),
  })

  for (let call = 1; call <= 2; call += 1) {
    const inventory = await service.list(BOT_ID)
    assert.deepEqual(
      inventory.entries.map((entry) => entry.channel.id),
      [CHANNEL_ID, OTHER_CHANNEL_ID],
    )
    assert.equal(inventory.page.active, 2)
    assert.equal(channelReads, call * 2)
    assert.equal(stageReads, call * 2)
    assert.equal(guildReads, call)
    assert.equal(memberReads, call)
    assert.equal(roleReads, call)
  }
})

test("Stage policy rejects disabled, unlisted, mismatched, and non-Stage reads before widening scope", async () => {
  const disabled = fixture({ policy: policy({ audit: false }) })
  await assert.rejects(
    disabled.service.get(BOT_ID, GUILD_ID, CHANNEL_ID),
    PolicyError,
  )
  assert.equal(disabled.state.events.length, 0)

  const unlisted = fixture({
    policy: policy({ stageChannelIds: [OTHER_CHANNEL_ID] }),
  })
  await assert.rejects(
    unlisted.service.get(BOT_ID, GUILD_ID, CHANNEL_ID),
    PolicyError,
  )
  assert.equal(unlisted.state.events.length, 0)

  const mismatched = fixture()
  await assert.rejects(
    mismatched.service.get(BOT_ID, OTHER_GUILD_ID, CHANNEL_ID),
    StageInstanceEvidenceError,
  )
  const wrongType = fixture({
    state: { channel: stageChannel({ type: DISCORD_CHANNEL_TYPES.voice }) },
  })
  await assert.rejects(
    wrongType.service.get(BOT_ID, GUILD_ID, CHANNEL_ID),
    StageInstanceEvidenceError,
  )
})

test("Stage plans enforce exact lifecycle transitions and deterministic no-ops", async () => {
  const inactive = fixture()
  const startPlan = await inactive.service.plan(
    APPLICATION_ID,
    BOT_ID,
    startRequest(),
  )
  assert.equal(startPlan.effect, "create")
  assert.equal(startPlan.writeRequired, true)
  assert.equal(startPlan.desired?.id, null)
  assert.deepEqual(startPlan.permission.requiredPermissions, [
    "VIEW_CHANNEL",
    "CONNECT",
    "MANAGE_CHANNELS",
    "MUTE_MEMBERS",
    "MOVE_MEMBERS",
  ])

  const inactiveEnd = await inactive.service.plan(
    APPLICATION_ID,
    BOT_ID,
    endRequest({ operationKey: "stage-instance-operation-0002" }),
  )
  assert.equal(inactiveEnd.effect, "none")
  assert.equal(inactiveEnd.status, "already-current")

  const active = fixture({ state: { current: stage() } })
  const sameStart = await active.service.plan(
    APPLICATION_ID,
    BOT_ID,
    startRequest(),
  )
  assert.equal(sameStart.effect, "none")
  const sameUpdate = await active.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequest({ topic: "Town hall" }),
  )
  assert.equal(sameUpdate.effect, "none")
  const update = await active.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequest(),
  )
  assert.equal(update.effect, "update")
  const end = await active.service.plan(
    APPLICATION_ID,
    BOT_ID,
    endRequest(),
  )
  assert.equal(end.effect, "delete")

  await assert.rejects(
    active.service.plan(
      APPLICATION_ID,
      BOT_ID,
      startRequest({ topic: "Different topic" }),
    ),
    /must be updated/,
  )
  await assert.rejects(
    inactive.service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    /inactive.*cannot be updated/i,
  )
})

test("Stage writes reject deprecated, linked, unknown, and unauthorized notification state", async () => {
  for (const current of [
    stage({ privacyLevel: 1 }),
    stage({ scheduledEventId: SCHEDULED_EVENT_ID }),
    stage({ unknownFieldCount: 1 }),
  ]) {
    const { service } = fixture({ state: { current } })
    await assert.rejects(
      service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
      StageInstanceEvidenceError,
    )
  }

  const notificationDisabled = fixture({
    policy: policy({ notifications: false }),
  })
  await assert.rejects(
    notificationDisabled.service.plan(
      APPLICATION_ID,
      BOT_ID,
      startRequest({ sendStartNotification: true }),
    ),
    PolicyError,
  )
  assert.equal(notificationDisabled.state.events.length, 0)

  const missingMentionPermission = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, STAGE_PERMISSIONS & ~DISCORD_PERMISSIONS.MENTION_EVERYONE, 1),
      ],
    },
  })
  await assert.rejects(
    missingMentionPermission.service.plan(
      APPLICATION_ID,
      BOT_ID,
      startRequest({ sendStartNotification: true }),
    ),
    /MENTION_EVERYONE/,
  )
})

test("Stage start executes only after reservation and pending content-free activity", async () => {
  const { service, state } = fixture()
  const request = startRequest({ sendStartNotification: true })
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  state.events.length = 0

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.stageInstanceId, CREATED_STAGE_ID)
  assert.deepEqual(state.createInput, {
    channelId: CHANNEL_ID,
    sendStartNotification: true,
    topic: "Town hall",
  })
  const lifecycle = state.events.filter((entry) => (
    entry.startsWith("operation:")
    || entry.startsWith("activity:")
    || entry.startsWith("discord:create")
  ))
  assert.deepEqual(lifecycle, [
    "operation:reserve",
    "activity:pending",
    "discord:create-stage",
    "operation:completed",
    "activity:completed",
  ])
  assert.deepEqual(state.activities.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  const persisted = JSON.stringify({
    activities: state.activities,
    receipts: [...state.operationStore.receipts.values()],
  })
  assert.doesNotMatch(persisted, /Town hall|Reviewed Stage start|stage-instance-operation/)
})

test("Stage start notifications share the interaction budget without blocking silent starts", async () => {
  const limiter = new InteractionLimiter({
    clock: () => 0,
    maxWritesPerMinute: 1,
    minWriteIntervalMs: 0,
  })
  limiter.reserve(OTHER_CHANNEL_ID)

  const notified = fixture({ limiter })
  const notifiedRequest = startRequest({ sendStartNotification: true })
  const notifiedPlan = await notified.service.plan(
    APPLICATION_ID,
    BOT_ID,
    notifiedRequest,
  )
  notified.state.events.length = 0
  await assert.rejects(
    notified.service.execute(
      APPLICATION_ID,
      BOT_ID,
      notifiedRequest,
      notifiedPlan.digest,
    ),
    InteractionRateLimitError,
  )
  assert.doesNotMatch(
    notified.state.events.join("\n"),
    /activity:|discord:create-stage|operation:/,
  )

  const silent = fixture({ limiter })
  const silentRequest = startRequest({ sendStartNotification: false })
  const silentPlan = await silent.service.plan(
    APPLICATION_ID,
    BOT_ID,
    silentRequest,
  )
  const result = await silent.service.execute(
    APPLICATION_ID,
    BOT_ID,
    silentRequest,
    silentPlan.digest,
  )
  assert.equal(result.status, "completed")
})

test("Stage update and end report coherent post-write drift without rollback", async () => {
  const updateFixture = fixture({
    state: {
      current: stage(),
      readback: stage({ topic: "Concurrent moderator topic" }),
    },
  })
  const updatePlan = await updateFixture.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequest(),
  )
  const updateResult = await updateFixture.service.execute(
    APPLICATION_ID,
    BOT_ID,
    updateRequest(),
    updatePlan.digest,
  )
  assert.equal(updateResult.status, "completed-with-drift")
  assert.equal(updateResult.observed?.topic, "Concurrent moderator topic")

  const endFixture = fixture({
    state: {
      current: stage(),
      readback: stage({ id: CREATED_STAGE_ID, topic: "Replacement session" }),
    },
  })
  const endPlan = await endFixture.service.plan(
    APPLICATION_ID,
    BOT_ID,
    endRequest(),
  )
  const endResult = await endFixture.service.execute(
    APPLICATION_ID,
    BOT_ID,
    endRequest(),
    endPlan.digest,
  )
  assert.equal(endResult.status, "completed-with-drift")
  assert.equal(endResult.stageInstanceId, STAGE_ID)
  assert.equal(endResult.observed?.id, CREATED_STAGE_ID)
})

test("Stage execution rejects stale plans and one-shot operation conflicts", async () => {
  const stale = fixture()
  const request = startRequest()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, request)
  stale.state.current = stage({ topic: "Another session" })
  await assert.rejects(
    stale.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    StageInstancePlanChangedError,
  )

  const conflict = fixture()
  const conflictPlan = await conflict.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  const normalized = normalizeStageInstanceChangeRequest(request)
  conflict.state.operationStore.receipts.set(
    `stage-instance-change:${normalized.operationKeyHash}`,
    {
      activityId: "prior-stage-activity",
      error: null,
      guildId: GUILD_ID,
      kind: "stage-instance-change",
      operationKeyHash: normalized.operationKeyHash,
      planDigest: conflictPlan.digest,
      resourceId: STAGE_ID,
      schemaVersion: 1,
      status: "completed",
      timestamp: NOW,
      verification: "match",
    },
  )
  await assert.rejects(
    conflict.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      conflictPlan.digest,
    ),
    StageInstanceOperationConflictError,
  )
})

test("Ambiguous Stage writes quarantine only the exact channel for the process", async () => {
  const ambiguous = fixture({
    state: {
      mutationError: new Error("network unavailable"),
      mutationErrorAfterApply: true,
    },
  })
  const start = startRequest()
  const startPlan = await ambiguous.service.plan(APPLICATION_ID, BOT_ID, start)
  await assert.rejects(
    ambiguous.service.execute(APPLICATION_ID, BOT_ID, start, startPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof StageInstanceExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  ambiguous.state.mutationError = null
  ambiguous.state.mutationErrorAfterApply = false
  ambiguous.state.readback = undefined
  const update = updateRequest({
    operationKey: "stage-instance-operation-0002",
  })
  const updatePlan = await ambiguous.service.plan(
    APPLICATION_ID,
    BOT_ID,
    update,
  )
  const before = ambiguous.state.events.length
  await assert.rejects(
    ambiguous.service.execute(
      APPLICATION_ID,
      BOT_ID,
      update,
      updatePlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof StageInstanceExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
  assert.equal(
    ambiguous.state.events.slice(before).some((entry) => entry === "discord:modify-stage"),
    false,
  )
})

test("Definitive Stage rejection does not quarantine a later fresh operation", async () => {
  const rejected = fixture({ state: { mutationError: apiError(400) } })
  const firstRequest = startRequest()
  const firstPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
  )
  await assert.rejects(
    rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      firstRequest,
      firstPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof StageInstanceExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )

  rejected.state.mutationError = null
  const secondRequest = startRequest({
    operationKey: "stage-instance-operation-0002",
  })
  const secondPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
  )
  const result = await rejected.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  assert.equal(result.status, "completed")
})

test("Stage execution blocks before Discord when pending activity cannot be recorded", async () => {
  const blocked = fixture({ state: { activityFailureAt: 0 } })
  const request = startRequest()
  const plan = await blocked.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    blocked.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof StageInstanceExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-audit-failed",
      )
      return true
    },
  )
  assert.equal(blocked.state.createInput, null)
})

test("Stage operation-receipt failure records uncertainty and quarantines the channel", async () => {
  const broken = fixture()
  broken.state.operationStore.finishCompletedFailure = new Error("receipt unavailable")
  const request = startRequest()
  const plan = await broken.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    broken.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof StageInstanceExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-operation-record-failed",
      )
      return true
    },
  )
  assert.equal(broken.state.activities.at(-1)?.status, "uncertain")

  const update = updateRequest({
    operationKey: "stage-instance-operation-0002",
  })
  const updatePlan = await broken.service.plan(APPLICATION_ID, BOT_ID, update)
  await assert.rejects(
    broken.service.execute(
      APPLICATION_ID,
      BOT_ID,
      update,
      updatePlan.digest,
    ),
    /prior same-channel operation ended uncertainly/,
  )
})
