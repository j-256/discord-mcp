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
  DISCORD_SCHEDULED_EVENT_ENTITY_TYPES,
  DISCORD_SCHEDULED_EVENT_STATUSES,
  type DiscordScheduledEventRecurrenceInput,
  type DiscordScheduledEventSummary,
  type DiscordScheduledEventUserSummary,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  PolicyError,
  ScheduledEventEvidenceError,
  ScheduledEventExecutionError,
  ScheduledEventOperationConflictError,
  ScheduledEventPlanChangedError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeScheduledEventChangeRequest,
  ScheduledEventService,
  type ScheduledEventChangeRequest,
  type ScheduledEventServiceOptions,
} from "../src/scheduled-event-service.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OTHER_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const OTHER_USER_ID = "300000000000000002"
const THIRD_USER_ID = "300000000000000003"
const BOT_ROLE_ID = "400000000000000001"
const VOICE_CHANNEL_ID = "500000000000000001"
const STAGE_CHANNEL_ID = "500000000000000002"
const EVENT_ID = "600000000000000001"
const CREATED_EVENT_ID = "600000000000000099"
const AUDIT_REASON = "Reviewed scheduled event change"
const OPERATION_KEY = "scheduled-event-operation-0001"
const NOW = "2026-08-21T12:00:00.000Z"
const START = "2026-09-01T20:00:00.000Z"
const END = "2026-09-01T22:00:00.000Z"
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
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IEND"),
  ])
}

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: id === BOT_ROLE_ID,
    name: id === GUILD_ID ? "@everyone" : `role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(
  id: string,
  type: number,
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: `channel-${id}`,
    permission_overwrites: [],
    type,
  }
}

function scheduledEvent(
  overrides: Partial<DiscordScheduledEventSummary> = {},
): DiscordScheduledEventSummary {
  return {
    channelId: VOICE_CHANNEL_ID,
    creatorUserId: BOT_ID,
    description: "Weekly community call",
    entityId: null,
    entityType: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.voice,
    guildId: GUILD_ID,
    hasCoverImage: false,
    id: EVENT_ID,
    location: null,
    name: "Community call",
    privacyLevel: 2,
    recurrenceRule: null,
    scheduledEndTime: null,
    scheduledStartTime: START,
    status: DISCORD_SCHEDULED_EVENT_STATUSES.scheduled,
    subscriberCount: null,
    ...overrides,
  }
}

function updateRequest(
  overrides: Partial<ScheduledEventChangeRequest> = {},
): ScheduledEventChangeRequest {
  return {
    action: "update",
    auditReason: AUDIT_REASON,
    description: "Updated description",
    eventId: EVENT_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  } as ScheduledEventChangeRequest
}

function policy(options: {
  audit?: boolean
  changes?: boolean
  guildIds?: readonly string[]
  users?: boolean
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowScheduledEventAudit: options.audit ?? true,
    allowScheduledEventChanges: options.changes ?? true,
    allowScheduledEventUserAudit: options.users ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    scheduledEventGuildIds: new Set(options.guildIds || [GUILD_ID]),
  })
}

class MemoryOperationStore implements OperationStore {
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
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
  botMember: DiscordGuildMember
  channels: DiscordChannel[]
  events: DiscordScheduledEventSummary[]
  guildId: string
  mutationError: unknown
  ownerId: string
  preserveDeletion: boolean
  readbackError: unknown
  roles: DiscordRole[]
  users: DiscordScheduledEventUserSummary[]
}

function recurrenceResponse(
  input: DiscordScheduledEventRecurrenceInput,
) {
  return {
    ...input,
    byYearDay: null,
    count: null,
    endTime: null,
  }
}

function fixture(options: {
  fileRoots?: readonly string[]
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.CREATE_EVENTS
    | DISCORD_PERMISSIONS.MANAGE_EVENTS
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.CONNECT
    | DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MUTE_MEMBERS
    | DISCORD_PERMISSIONS.MOVE_MEMBERS
  const state: FixtureState = {
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: [
      channel(VOICE_CHANNEL_ID, 2),
      channel(STAGE_CHANNEL_ID, 13),
    ],
    events: [scheduledEvent()],
    guildId: GUILD_ID,
    mutationError: undefined,
    ownerId: OTHER_USER_ID,
    preserveDeletion: false,
    readbackError: undefined,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, permissions, 10),
    ],
    users: [
      { bot: false, eventId: EVENT_ID, userId: OTHER_USER_ID },
      { bot: true, eventId: EVENT_ID, userId: THIRD_USER_ID },
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const trace: string[] = []
  let mutated = false
  const activityStore: ActivityStore = {
    async append(entry) {
      trace.push(`activity:${entry.status}`)
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(trace)
  const mutate = () => {
    if (state.mutationError) throw state.mutationError
    mutated = true
  }
  const readback = () => {
    if (mutated && state.readbackError) throw state.readbackError
  }
  const client: ScheduledEventServiceOptions["client"] = {
    async createGuildScheduledEvent(_guildId, input) {
      trace.push("write:create")
      mutate()
      const created = scheduledEvent({
        channelId: input.channelId,
        creatorUserId: BOT_ID,
        description: input.description ?? null,
        entityType: input.entityType,
        hasCoverImage: input.cover !== undefined,
        id: CREATED_EVENT_ID,
        location: input.location,
        name: input.name,
        recurrenceRule: input.recurrenceRule
          ? recurrenceResponse(input.recurrenceRule)
          : null,
        scheduledEndTime: input.scheduledEndTime ?? null,
        scheduledStartTime: input.scheduledStartTime,
      })
      state.events.push(created)
      return created
    },
    async deleteGuildScheduledEvent(_guildId, eventId) {
      trace.push("write:delete")
      mutate()
      if (!state.preserveDeletion) {
        state.events = state.events.filter((event) => event.id !== eventId)
      }
    },
    async getGuild() {
      trace.push("read:guild")
      return {
        id: state.guildId,
        name: "Private Guild Name",
        owner_id: state.ownerId,
      }
    },
    async getGuildChannels() {
      trace.push("read:channels")
      return state.channels
    },
    async getGuildMember() {
      trace.push("read:member")
      return state.botMember
    },
    async getGuildRoles() {
      trace.push("read:roles")
      return state.roles
    },
    async getGuildScheduledEvent(_guildId, eventId) {
      trace.push(mutated ? "read:event:readback" : "read:event:get")
      readback()
      const found = state.events.find((event) => event.id === eventId)
      if (!found) {
        throw new DiscordApiError({
          message: "not found",
          method: "GET",
          route: "/scheduled-events/id",
          status: 404,
        })
      }
      return found
    },
    async listGuildScheduledEvents(_guildId, readOptions) {
      trace.push(mutated ? "read:event:list-readback" : "read:event:list")
      readback()
      return state.events.map((event) => ({
        ...event,
        subscriberCount: readOptions?.includeSubscriberCount ? 7 : null,
      }))
    },
    async listGuildScheduledEventUsers(_guildId, eventId, readOptions) {
      trace.push("read:event:users")
      return state.users.filter((user) => (
        user.eventId === eventId
        && (readOptions?.after === undefined || BigInt(user.userId) > BigInt(readOptions.after))
      )).slice(0, readOptions?.limit)
    },
    async modifyGuildScheduledEvent(_guildId, eventId, input) {
      trace.push(input.status === undefined ? "write:update" : "write:transition")
      mutate()
      const index = state.events.findIndex((event) => event.id === eventId)
      const current = state.events[index]
      if (!current) throw new Error("event absent")
      const updated: DiscordScheduledEventSummary = {
        ...current,
        ...(input.channelId !== undefined ? { channelId: input.channelId } : {}),
        ...(input.cover !== undefined
          ? { hasCoverImage: input.cover !== null }
          : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.entityType !== undefined
          ? {
              entityType: input.entityType,
              location: input.location ?? null,
            }
          : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.recurrenceRule !== undefined
          ? {
              recurrenceRule: input.recurrenceRule === null
                ? null
                : recurrenceResponse(input.recurrenceRule),
            }
          : {}),
        ...(input.scheduledEndTime !== undefined
          ? { scheduledEndTime: input.scheduledEndTime }
          : {}),
        ...(input.scheduledStartTime !== undefined
          ? { scheduledStartTime: input.scheduledStartTime }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      }
      state.events[index] = updated
      return updated
    },
  }
  const service = new ScheduledEventService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    fileRoots: options.fileRoots || [],
    operationStore,
    planKey: Buffer.alloc(32, 9),
    policy: options.policy || policy(),
    randomId: () => "scheduled-event-activity-0001",
  })
  return { activities, operationStore, service, state, trace }
}

test("scheduled event requests normalize strict hosting, time, and recurrence", () => {
  const normalized = normalizeScheduledEventChangeRequest({
    action: "create",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    hosting: { entityType: "external", location: "Town Hall" },
    name: "Planning",
    operationKey: OPERATION_KEY,
    recurrence: {
      frequency: "daily",
      weekdays: ["friday", "monday", "thursday", "tuesday", "wednesday"],
    },
    scheduledEndTime: "2026-09-01T17:00:00-05:00",
    scheduledStartTime: "2026-09-01T15:00:00-05:00",
  })

  assert.equal("operationKey" in normalized, false)
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  if (normalized.action !== "create") throw new Error("Expected normalized create")
  assert.equal(normalized.scheduledStartTime, START)
  assert.equal(normalized.scheduledEndTime, END)
  assert.deepEqual(normalized.recurrence, {
    frequency: "daily",
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  })
  assert.throws(
    () => normalizeScheduledEventChangeRequest({
      action: "create",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      hosting: { entityType: "external", location: "Town Hall" },
      name: "Planning",
      operationKey: OPERATION_KEY,
      scheduledStartTime: START,
    }),
    /requires an end time/,
  )
  assert.throws(
    () => normalizeScheduledEventChangeRequest({
      action: "create",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      hosting: { channelId: VOICE_CHANNEL_ID, entityType: "voice" },
      name: "Planning",
      operationKey: OPERATION_KEY,
      recurrence: { frequency: "yearly", month: 2, monthDay: 30 },
      scheduledStartTime: START,
    }),
    /date is invalid/,
  )
})

test("scheduled event reads return privacy-safe access evidence and optional counts", async () => {
  const { service } = fixture()

  const inventory = await service.list(BOT_ID, GUILD_ID, {
    includeSubscriberCount: true,
  })
  const lookup = await service.get(BOT_ID, GUILD_ID, EVENT_ID)

  assert.equal(inventory.events[0]?.event.subscriberCount, 7)
  assert.deepEqual(inventory.events[0]?.access.requiredPermissions, ["VIEW_CHANNEL"])
  assert.equal(lookup.event.subscriberCount, null)
  assert.equal(lookup.privacy.subscriberIdentitiesExposed, false)
  assert.deepEqual(lookup.privacy.omittedFields, [
    "coverImageCdnUrl",
    "coverImageHash",
    "creatorProfile",
    "rawDiscordObject",
    "subscriberProfiles",
  ])
})

test("scheduled event user audit returns ordered ID-and-bot-only pages", async () => {
  const { service, trace } = fixture()

  const result = await service.listUsers(BOT_ID, GUILD_ID, EVENT_ID, { limit: 2 })

  assert.deepEqual(result.users, [
    { bot: false, id: OTHER_USER_ID },
    { bot: true, id: THIRD_USER_ID },
  ])
  assert.deepEqual(result.page, {
    nextAfter: THIRD_USER_ID,
    requestedAfter: null,
    requestedLimit: 2,
    returned: 2,
  })
  assert.equal(result.event.subscriberCount, null)
  assert.deepEqual(result.access.requiredPermissions, ["VIEW_CHANNEL"])
  assert.deepEqual(result.privacy, {
    memberDataRequested: false,
    omittedFields: [
      "avatars",
      "displayNames",
      "memberData",
      "rawDiscordObjects",
      "usernames",
    ],
    persistence: "none",
    profileFieldsProjectedOut: true,
    rawPayloads: "omitted",
    userIdsExposed: true,
  })
  assert.equal(trace.at(-1), "read:event:users")
})

test("scheduled event user audit fails before identity fetch on policy or permission gaps", async () => {
  const disabled = fixture({ policy: policy({ users: false }) })
  await assert.rejects(
    disabled.service.listUsers(BOT_ID, GUILD_ID, EVENT_ID),
    /user audit is disabled/,
  )
  assert.deepEqual(disabled.trace, [])

  const denied = fixture({
    state: {
      roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)],
    },
  })
  await assert.rejects(
    denied.service.listUsers(BOT_ID, GUILD_ID, EVENT_ID),
    /VIEW_CHANNEL/,
  )
  assert.equal(denied.trace.includes("read:event:users"), false)
})

test("scheduled event user audit rejects minimized page drift and supports external events", async () => {
  const malformed = fixture({
    state: {
      users: [
        { bot: false, eventId: EVENT_ID, userId: THIRD_USER_ID },
        { bot: false, eventId: EVENT_ID, userId: OTHER_USER_ID },
      ],
    },
  })
  await assert.rejects(
    malformed.service.listUsers(BOT_ID, GUILD_ID, EVENT_ID, { limit: 2 }),
    /unordered or duplicate/,
  )

  const external = fixture({
    state: {
      events: [scheduledEvent({
        channelId: null,
        entityType: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external,
        location: "Town Hall",
        scheduledEndTime: END,
      })],
      roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)],
    },
  })
  const result = await external.service.listUsers(
    BOT_ID,
    GUILD_ID,
    EVENT_ID,
    { after: OTHER_USER_ID, limit: 2 },
  )
  assert.deepEqual(result.users, [{ bot: true, id: THIRD_USER_ID }])
  assert.deepEqual(result.access.requiredPermissions, [])
  assert.equal(result.access.permissionScope, "guild")
})

test("scheduled event policy separates audit, changes, and exact guild scope", async () => {
  await assert.rejects(
    fixture({ policy: policy({ audit: false }) }).service.list(BOT_ID, GUILD_ID),
    PolicyError,
  )
  await assert.rejects(
    fixture({ policy: policy({ changes: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      updateRequest(),
    ),
    PolicyError,
  )
  await assert.rejects(
    fixture({ policy: policy({ guildIds: [OTHER_GUILD_ID] }) }).service.get(
      BOT_ID,
      GUILD_ID,
      EVENT_ID,
    ),
    PolicyError,
  )
})

test("scheduled event creation binds a local cover and executes after pending audit", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-event-service-"))
  const root = await realpath(temporary)
  try {
    const coverImagePath = join(root, "cover.png")
    await writeFile(coverImagePath, png(1280, 720))
    const { activities, service, trace } = fixture({ fileRoots: [root] })
    const request: ScheduledEventChangeRequest = {
      action: "create",
      auditReason: AUDIT_REASON,
      coverImagePath,
      guildId: GUILD_ID,
      hosting: { entityType: "external", location: "Town Hall" },
      name: "Planning session",
      operationKey: OPERATION_KEY,
      recurrence: { frequency: "weekly", interval: 2, weekday: "tuesday" },
      scheduledEndTime: END,
      scheduledStartTime: START,
    }
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
    const result = await service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )

    assert.equal(plan.file?.review.format, "png")
    assert.equal(plan.permission.current.permissionScope, "guild")
    assert.deepEqual(plan.permission.current.requiredPermissions, ["CREATE_EVENTS"])
    assert.equal(plan.visibleInventory.returned, 1)
    assert.match(plan.visibleInventory.digest || "", /^hmac-sha256:/)
    assert.equal(result.status, "completed")
    assert.equal(result.eventId, CREATED_EVENT_ID)
    assert.deepEqual(trace.slice(-6), [
      "operation:reserve",
      "activity:pending",
      "write:create",
      "read:event:readback",
      "operation:completed",
      "activity:completed",
    ])
    assert.equal(activities.at(-1)?.status, "completed")
    const persisted = JSON.stringify(activities)
    for (const forbidden of [
      "Planning session",
      "Town Hall",
      coverImagePath,
      AUDIT_REASON,
      OPERATION_KEY,
      START,
    ]) {
      assert.equal(persisted.includes(forbidden), false)
    }
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})

test("scheduled event updates require destination authority and detect no-op state", async () => {
  const { service } = fixture()
  const noOpRequest = updateRequest({
    description: "Weekly community call",
  })
  const noOpPlan = await service.plan(APPLICATION_ID, BOT_ID, noOpRequest)
  const noOp = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    noOpRequest,
    noOpPlan.digest,
  )
  assert.equal(noOp.status, "already-current")

  const hostingRequest: ScheduledEventChangeRequest = {
    action: "update",
    auditReason: AUDIT_REASON,
    eventId: EVENT_ID,
    guildId: GUILD_ID,
    hosting: { channelId: STAGE_CHANNEL_ID, entityType: "stage" },
    operationKey: "scheduled-event-operation-0002",
  }
  const hostingPlan = await service.plan(APPLICATION_ID, BOT_ID, hostingRequest)
  assert.equal(hostingPlan.permission.destination?.entityType, "stage")
  assert.deepEqual(hostingPlan.permission.destination?.requiredPermissions, [
    "CREATE_EVENTS",
    "MANAGE_CHANNELS",
    "MUTE_MEMBERS",
    "MOVE_MEMBERS",
  ])
})

test("scheduled event location updates carry the reviewed external end time", async () => {
  const { service } = fixture({
    state: {
      events: [scheduledEvent({
        channelId: null,
        entityType: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external,
        location: "Town Hall",
        scheduledEndTime: END,
      })],
    },
  })
  const request: ScheduledEventChangeRequest = {
    action: "update",
    auditReason: AUDIT_REASON,
    eventId: EVENT_ID,
    guildId: GUILD_ID,
    hosting: { entityType: "external", location: "Community Center" },
    operationKey: OPERATION_KEY,
  }

  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.observed?.location, "Community Center")
  assert.equal(result.observed?.scheduledEndTime, END)
})

test("scheduled event transitions enforce the documented state graph", async () => {
  const request: ScheduledEventChangeRequest = {
    action: "transition",
    auditReason: AUDIT_REASON,
    eventId: EVENT_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    targetStatus: "active",
  }
  const { service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.observed?.status, "active")
  assert.equal(result.status, "completed")

  await assert.rejects(
    fixture().service.plan(APPLICATION_ID, BOT_ID, {
      ...request,
      targetStatus: "completed",
    }),
    /scheduled to completed is invalid/,
  )
})

test("scheduled event deletion verifies exact absence", async () => {
  const request: ScheduledEventChangeRequest = {
    action: "delete",
    auditReason: AUDIT_REASON,
    eventId: EVENT_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
  }
  const { service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.observed, null)
  assert.equal(result.status, "completed")

  const preserved = fixture({ state: { preserveDeletion: true } })
  const preservedPlan = await preserved.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  const drift = await preserved.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    preservedPlan.digest,
  )
  assert.equal(drift.status, "completed-with-drift")
})

test("scheduled event ownership, freshness, and one-shot reservations fail closed", async () => {
  const creatorOnly = DISCORD_PERMISSIONS.CREATE_EVENTS
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.CONNECT
  const owned = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, creatorOnly, 10),
      ],
    },
  })
  const ownedPlan = await owned.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequest(),
  )
  assert.equal(ownedPlan.permission.ownershipRequired, true)

  await assert.rejects(
    fixture({
      state: {
        events: [scheduledEvent({ creatorUserId: OTHER_USER_ID })],
        roles: [
          role(GUILD_ID, 0n, 0),
          role(BOT_ROLE_ID, creatorOnly, 10),
        ],
      },
    }).service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    ScheduledEventEvidenceError,
  )

  const stale = fixture()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, updateRequest())
  stale.state.events[0] = scheduledEvent({ name: "Changed elsewhere" })
  await assert.rejects(
    stale.service.execute(
      APPLICATION_ID,
      BOT_ID,
      updateRequest(),
      plan.digest,
    ),
    ScheduledEventPlanChangedError,
  )

  const reserved = fixture()
  const reservedPlan = await reserved.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequest(),
  )
  await reserved.service.execute(
    APPLICATION_ID,
    BOT_ID,
    updateRequest(),
    reservedPlan.digest,
  )
  await assert.rejects(
    reserved.service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    ScheduledEventOperationConflictError,
  )
})

test("scheduled event execution distinguishes determinate rejection from uncertainty", async () => {
  const rejected = fixture({
    state: {
      mutationError: new DiscordApiError({
        code: 50013,
        message: "missing permissions",
        method: "PATCH",
        route: "/scheduled-events/id",
        status: 403,
      }),
    },
  })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequest(),
  )
  await assert.rejects(
    rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      updateRequest(),
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ScheduledEventExecutionError
      && (error.result as { status: string }).status === "failed"
    ),
  )

  const uncertain = fixture({ state: { mutationError: new Error("socket reset") } })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequest(),
  )
  await assert.rejects(
    uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      updateRequest(),
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ScheduledEventExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
})
