import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  ChannelPermissionOverwriteService,
  normalizeChannelPermissionOverwriteRequest,
  normalizeChannelPermissionSyncRequest,
  type ChannelPermissionOverwriteRequest,
  type ChannelPermissionOverwriteServiceOptions,
  type ChannelPermissionSyncRequest,
} from "../src/channel-permission-overwrite-service.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import {
  ChannelPermissionOverwriteExecutionError,
  ChannelPermissionOverwriteOperationConflictError,
  ChannelPermissionOverwritePlanChangedError,
  ChannelPermissionSyncExecutionError,
  ChannelPermissionSyncOperationConflictError,
  ChannelPermissionSyncPlanChangedError,
  DiscordApiError,
  PolicyError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const TARGET_ROLE_ID = "400000000000000002"
const TARGET_USER_ID = "500000000000000001"
const TARGET_USER_ROLE_ID = "400000000000000003"
const CHANNEL_ID = "600000000000000001"
const PARENT_ID = "600000000000000002"
const OPERATION_KEY = "permission-overwrite-operation-0001"
const AUDIT_REASON = "Reviewed private-channel access / case 42"
const SYNC_OPERATION_KEY = "permission-sync-operation-0001"
const NOW = "2026-08-21T00:00:00.000Z"

const BOT_PERMISSIONS = DISCORD_PERMISSIONS.VIEW_CHANNEL
  | DISCORD_PERMISSIONS.MANAGE_CHANNELS
  | DISCORD_PERMISSIONS.MANAGE_ROLES
  | DISCORD_PERMISSIONS.SEND_MESSAGES
  | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY

function role(
  id: string,
  permissions: bigint,
  position: number,
  name = id,
): DiscordRole {
  return {
    id,
    managed: false,
    name,
    permissions: permissions.toString(),
    position,
  }
}

function overwrite(
  id: string,
  type: 0 | 1,
  allow = 0n,
  deny = 0n,
): DiscordPermissionOverwrite {
  return {
    allow: allow.toString(),
    deny: deny.toString(),
    id,
    type,
  }
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-channel-name",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function request(
  overrides: Partial<ChannelPermissionOverwriteRequest> = {},
): ChannelPermissionOverwriteRequest {
  return {
    auditReason: AUDIT_REASON,
    changes: [{ permission: "SEND_MESSAGES", state: "deny" }],
    channelId: CHANNEL_ID,
    mode: "update",
    operationKey: OPERATION_KEY,
    targetId: TARGET_ROLE_ID,
    targetType: "role",
    ...overrides,
  } as ChannelPermissionOverwriteRequest
}

function syncRequest(
  overrides: Partial<ChannelPermissionSyncRequest> = {},
): ChannelPermissionSyncRequest {
  return {
    acknowledgeConcurrentPermissionChangesStopped: true,
    acknowledgeFutureParentPropagation: true,
    acknowledgeOverwriteReplacement: true,
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    operationKey: SYNC_OPERATION_KEY,
    ...overrides,
  } as ChannelPermissionSyncRequest
}

function policy(options: {
  channels?: readonly string[]
  enabled?: boolean
  protectedUsers?: readonly string[]
  readChannels?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(options.readChannels || [CHANNEL_ID, PARENT_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowPermissionOverwrites: options.enabled ?? true,
    allowPermissionSyncs: options.enabled ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    permissionOverwriteChannelIds: new Set(options.channels || [CHANNEL_ID]),
    permissionSyncChannelIds: new Set(options.channels || [CHANNEL_ID]),
    protectedUserIds: new Set(options.protectedUsers || []),
  })
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  async get(
    kind: OperationReceipt["kind"],
    hash: string,
  ): Promise<OperationReceipt | undefined> {
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
  channel: DiscordChannel
  guildOwnerId: string
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  mutationUpdatesState: boolean
  parent: DiscordChannel
  readbackError: unknown
  readbackStarted: (() => void) | null
  roles: DiscordRole[]
  targetMember: DiscordGuildMember
}

function fixture(options: {
  clock?: () => Date
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channel: channel(),
    guildOwnerId: OWNER_ID,
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    mutationUpdatesState: true,
    parent: channel({
      id: PARENT_ID,
      permission_overwrites: [],
      type: DISCORD_CHANNEL_TYPES.category,
    }),
    readbackError: undefined,
    readbackStarted: null,
    roles: [
      role(GUILD_ID, 0n, 0, "@everyone"),
      role(BOT_ROLE_ID, BOT_PERMISSIONS, 20, "connector"),
      role(TARGET_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 10, "reviewers"),
      role(TARGET_USER_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 5, "member"),
    ],
    targetMember: {
      roles: [TARGET_USER_ROLE_ID],
      user: { bot: false, id: TARGET_USER_ID, username: "private-user-name" },
    },
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
  const client: ChannelPermissionOverwriteServiceOptions["client"] = {
    async deleteChannelPermissionOverwrite(channelId, targetId, reason) {
      events.push(`write:delete:${channelId}:${targetId}:${reason}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      if (state.mutationUpdatesState && state.channel.permission_overwrites) {
        state.channel.permission_overwrites = state.channel.permission_overwrites.filter(
          (value) => value.id !== targetId,
        )
      }
    },
    async editChannelPermissionOverwrite(channelId, targetId, input, reason) {
      events.push(`write:put:${channelId}:${targetId}:${reason}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      if (state.mutationUpdatesState && state.channel.permission_overwrites) {
        state.channel.permission_overwrites = [
          ...state.channel.permission_overwrites.filter((value) => value.id !== targetId),
          overwrite(targetId, input.type, BigInt(input.allow), BigInt(input.deny)),
        ]
      }
    },
    async replaceChannelPermissionOverwrites(channelId, overwrites, reason) {
      events.push(`write:sync:${channelId}:${reason}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      if (state.mutationUpdatesState) {
        state.channel.permission_overwrites = overwrites.map((value) => ({ ...value }))
      }
      return { ...state.channel }
    },
    async getChannel(channelId) {
      events.push(`read:channel:${channelId}${mutationCompleted ? ":readback" : ""}`)
      if (mutationCompleted && state.readbackError) throw state.readbackError
      if (mutationCompleted) state.readbackStarted?.()
      return channelId === PARENT_ID ? state.parent : state.channel
    },
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: "Private Guild Name", owner_id: state.guildOwnerId }
    },
    async getGuildMember(_guildId, userId) {
      events.push(`read:member:${userId}`)
      return userId === BOT_ID ? state.botMember : state.targetMember
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
  }
  const service = new ChannelPermissionOverwriteService({
    activityStore,
    client,
    clock: options.clock || (() => new Date(NOW)),
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: options.policy || policy(),
    randomId: () => "activity-0001",
  })
  return {
    activities,
    events,
    operationStore,
    service,
    state,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected the permission overwrite",
    method: "PUT",
    route: `/channels/${CHANNEL_ID}/permissions/${TARGET_ROLE_ID}`,
    status,
  })
}

function permissionSyncFixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  return fixture({
    ...(options.policy ? { policy: options.policy } : {}),
    state: {
      channel: channel({
        parent_id: PARENT_ID,
        permission_overwrites: [overwrite(
          TARGET_ROLE_ID,
          0,
          0n,
          DISCORD_PERMISSIONS.SEND_MESSAGES,
        )],
      }),
      parent: channel({
        id: PARENT_ID,
        parent_id: null,
        permission_overwrites: [overwrite(
          TARGET_ROLE_ID,
          0,
          DISCORD_PERMISSIONS.VIEW_CHANNEL,
        )],
        type: DISCORD_CHANNEL_TYPES.category,
      }),
      ...options.state,
    },
  })
}

test("permission-sync normalization requires an exact request and all literal acknowledgments", () => {
  const normalized = normalizeChannelPermissionSyncRequest(syncRequest())

  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(normalized.acknowledgeFutureParentPropagation, true)
  assert.throws(
    () => normalizeChannelPermissionSyncRequest(syncRequest({
      acknowledgeOverwriteReplacement: false as true,
    })),
    /complete overwrite replacement/,
  )
  assert.throws(
    () => normalizeChannelPermissionSyncRequest({
      ...syncRequest(),
      extra: true,
    } as ChannelPermissionSyncRequest),
    /only the documented fields/,
  )
})

test("permission-sync plan exposes the complete structural delta without fetching member profiles", async () => {
  const setup = permissionSyncFixture()

  const plan = await setup.service.planSync(
    APPLICATION_ID,
    BOT_ID,
    syncRequest(),
  )

  assert.equal(plan.action, "replace")
  assert.equal(plan.status, "planned")
  assert.equal(plan.parent.id, PARENT_ID)
  assert.deepEqual(plan.overwriteCounts, {
    changed: 1,
    currentChild: 1,
    parent: 1,
  })
  assert.equal(plan.changes[0]?.targetId, TARGET_ROLE_ID)
  assert.equal(plan.changes[0]?.roleName, "reviewers")
  assert.equal(plan.authority.currentChild.manageChannels, true)
  assert.equal(plan.authority.prospectiveChild.manageRoles, true)
  assert.deepEqual(plan.privacy, {
    memberProfilesFetched: false,
    persistedOverwriteTargets: false,
    targetImpactAnalysis: "structural-only",
  })
  assert.equal(setup.events.includes(`read:member:${TARGET_USER_ID}`), false)
})

test("permission-sync rejects changed protected-member overwrites without fetching a profile", async () => {
  const setup = permissionSyncFixture({
    policy: policy({ protectedUsers: [TARGET_USER_ID] }),
    state: {
      channel: channel({
        parent_id: PARENT_ID,
        permission_overwrites: [overwrite(
          TARGET_USER_ID,
          1,
          0n,
          DISCORD_PERMISSIONS.VIEW_CHANNEL,
        )],
      }),
    },
  })

  await assert.rejects(
    setup.service.planSync(APPLICATION_ID, BOT_ID, syncRequest()),
    PolicyError,
  )
  assert.equal(setup.events.includes(`read:member:${TARGET_USER_ID}`), false)
})

test("permission-sync no-op proves an already synchronized child without reserving the key", async () => {
  const parentOverwrites = [overwrite(
    TARGET_ROLE_ID,
    0,
    DISCORD_PERMISSIONS.VIEW_CHANNEL,
  )]
  const setup = permissionSyncFixture({
    state: {
      channel: channel({
        parent_id: PARENT_ID,
        permission_overwrites: parentOverwrites.map((value) => ({ ...value })),
      }),
      parent: channel({
        id: PARENT_ID,
        permission_overwrites: parentOverwrites,
        type: DISCORD_CHANNEL_TYPES.category,
      }),
    },
  })
  const requestValue = syncRequest()
  const plan = await setup.service.planSync(APPLICATION_ID, BOT_ID, requestValue)

  const result = await setup.service.executeSync(
    APPLICATION_ID,
    BOT_ID,
    requestValue,
    plan.digest,
  )

  assert.equal(plan.status, "already-synchronized")
  assert.equal(result.status, "already-synchronized")
  assert.equal(result.activityId, null)
  assert.equal(setup.events.some((event) => event.startsWith("operation:")), false)
  assert.equal(setup.events.some((event) => event.startsWith("write:")), false)
})

test("permission-sync records pending state before one write and verifies exact synchronization", async () => {
  const setup = permissionSyncFixture()
  const requestValue = syncRequest()
  const plan = await setup.service.planSync(APPLICATION_ID, BOT_ID, requestValue)

  const result = await setup.service.executeSync(
    APPLICATION_ID,
    BOT_ID,
    requestValue,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.responseMatched, true)
  assert.equal(result.synchronized, true)
  assert.equal(result.parentBaselineMatched, true)
  assert.equal(result.evidenceMatched, true)
  const pendingIndex = setup.events.indexOf("activity:pending")
  const writeIndex = setup.events.findIndex((event) => event.startsWith("write:sync:"))
  assert.ok(pendingIndex >= 0)
  assert.ok(writeIndex > pendingIndex)
  assert.equal(setup.events.filter((event) => event.startsWith("write:sync:")).length, 1)
  assert.equal(setup.activities.length, 2)
  const serialized = JSON.stringify(setup.activities)
  assert.equal(serialized.includes(TARGET_ROLE_ID), false)
  assert.equal(serialized.includes("reviewers"), false)
  assert.equal(serialized.includes(AUDIT_REASON), false)
})

test("permission-sync reports completed-with-drift after exact sync when support evidence changes", async () => {
  const setup = permissionSyncFixture()
  setup.state.readbackStarted = () => {
    setup.state.roles = setup.state.roles.map((value) => (
      value.id === TARGET_ROLE_ID
        ? { ...value, name: "renamed-reviewers" }
        : value
    ))
  }
  const requestValue = syncRequest()
  const plan = await setup.service.planSync(APPLICATION_ID, BOT_ID, requestValue)

  const result = await setup.service.executeSync(
    APPLICATION_ID,
    BOT_ID,
    requestValue,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.synchronized, true)
  assert.equal(result.responseMatched, true)
  assert.equal(result.parentBaselineMatched, true)
  assert.equal(result.evidenceMatched, false)
  assert.equal(setup.activities.at(-1)?.status, "completed-with-drift")
})

test("permission-sync rejects a stale parent snapshot before reserving or writing", async () => {
  const setup = permissionSyncFixture()
  const requestValue = syncRequest()
  const plan = await setup.service.planSync(APPLICATION_ID, BOT_ID, requestValue)
  setup.state.parent.permission_overwrites = []

  await assert.rejects(
    setup.service.executeSync(
      APPLICATION_ID,
      BOT_ID,
      requestValue,
      plan.digest,
    ),
    ChannelPermissionSyncPlanChangedError,
  )
  assert.equal(setup.events.some((event) => event.startsWith("operation:")), false)
  assert.equal(setup.events.some((event) => event.startsWith("write:")), false)
})

test("permission-sync quarantines a response that does not prove the reviewed replacement", async () => {
  const setup = permissionSyncFixture({
    state: { mutationUpdatesState: false },
  })
  const requestValue = syncRequest()
  const plan = await setup.service.planSync(APPLICATION_ID, BOT_ID, requestValue)

  await assert.rejects(
    setup.service.executeSync(
      APPLICATION_ID,
      BOT_ID,
      requestValue,
      plan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ChannelPermissionSyncExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(setup.events.filter((event) => event.startsWith("write:sync:")).length, 1)
})

test("permission-sync treats a pre-response rate limit as uncertain and never retries", async () => {
  const setup = permissionSyncFixture({
    state: { mutationError: apiError(429) },
  })
  const requestValue = syncRequest()
  const plan = await setup.service.planSync(APPLICATION_ID, BOT_ID, requestValue)

  await assert.rejects(
    setup.service.executeSync(
      APPLICATION_ID,
      BOT_ID,
      requestValue,
      plan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ChannelPermissionSyncExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(setup.events.filter((event) => event.startsWith("write:sync:")).length, 1)
})

test("permission-sync rejects unknown parent permission bits and spent operation keys", async () => {
  const unknownSetup = permissionSyncFixture({
    state: {
      parent: channel({
        id: PARENT_ID,
        permission_overwrites: [overwrite(TARGET_ROLE_ID, 0, 1n << 63n)],
        type: DISCORD_CHANNEL_TYPES.category,
      }),
    },
  })
  await assert.rejects(
    unknownSetup.service.planSync(APPLICATION_ID, BOT_ID, syncRequest()),
    /unknown to this build/,
  )

  const setup = permissionSyncFixture()
  const requestValue = syncRequest()
  const plan = await setup.service.planSync(APPLICATION_ID, BOT_ID, requestValue)
  await setup.service.executeSync(
    APPLICATION_ID,
    BOT_ID,
    requestValue,
    plan.digest,
  )
  await assert.rejects(
    setup.service.planSync(APPLICATION_ID, BOT_ID, requestValue),
    ChannelPermissionSyncOperationConflictError,
  )
})

test("permission-overwrite normalization canonicalizes named deltas and hashes the operation key", () => {
  const normalized = normalizeChannelPermissionOverwriteRequest(request({
    changes: [
      { permission: "VIEW_CHANNEL", state: "allow" },
      { permission: "SEND_MESSAGES", state: "deny" },
    ],
  }))

  assert.deepEqual(normalized.changes, [
    { permission: "VIEW_CHANNEL", state: "allow" },
    { permission: "SEND_MESSAGES", state: "deny" },
  ])
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(normalized).includes(OPERATION_KEY), true)
  assert.throws(
    () => normalizeChannelPermissionOverwriteRequest(request({ channelId: "bad" })),
    /channel ID/,
  )
  assert.throws(
    () => normalizeChannelPermissionOverwriteRequest(request({
      changes: [
        { permission: "VIEW_CHANNEL", state: "allow" },
        { permission: "VIEW_CHANNEL", state: "deny" },
      ],
    })),
    /duplicated/,
  )
  assert.throws(
    () => normalizeChannelPermissionOverwriteRequest(request({
      changes: undefined,
    } as never)),
    /between 1 and/,
  )
  assert.throws(
    () => normalizeChannelPermissionOverwriteRequest(request({
      changes: [{ permission: "SEND_MESSAGES", state: "other" as "deny" }],
    })),
    /state/,
  )
})

test("permission-overwrite inventory is deterministic, bounded, and thread-aware", async () => {
  const unknown = 1n << 63n
  const setup = fixture({
    state: {
      channel: channel({
        permission_overwrites: [
          overwrite(TARGET_USER_ID, 1, unknown, 0n),
          overwrite(TARGET_ROLE_ID, 0, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0n),
        ],
      }),
    },
  })

  const first = await setup.service.list(CHANNEL_ID, { limit: 1 })
  assert.equal(first.overwrites[0]?.targetId, TARGET_ROLE_ID)
  assert.equal(first.page.hasMore, true)
  assert.equal(first.page.nextAfterTargetId, TARGET_ROLE_ID)
  const second = await setup.service.list(CHANNEL_ID, {
    afterTargetId: TARGET_ROLE_ID,
    limit: 1,
  })
  assert.equal(second.overwrites[0]?.unknownAllow, unknown.toString())
  assert.deepEqual(setup.activities, [])

  const inherited = fixture({
    state: {
      channel: channel({
        parent_id: PARENT_ID,
        type: DISCORD_CHANNEL_TYPES.publicThread,
      }),
      parent: channel({
        id: PARENT_ID,
        permission_overwrites: [overwrite(TARGET_ROLE_ID, 0)],
      }),
    },
  })
  const inheritedResult = await inherited.service.list(CHANNEL_ID)
  assert.equal(inheritedResult.inherited, true)
  assert.equal(inheritedResult.sourceChannel.id, PARENT_ID)
  await assert.rejects(
    () => inherited.service.list(CHANNEL_ID, { afterTargetId: TARGET_USER_ID }),
    /cursor must identify an overwrite/,
  )
})

test("permission-overwrite plans bind exact evidence and preserve unspecified bits", async () => {
  const setup = fixture({
    state: {
      channel: channel({
        parent_id: PARENT_ID,
        permission_overwrites: [
          overwrite(TARGET_ROLE_ID, 0, DISCORD_PERMISSIONS.VIEW_CHANNEL),
        ],
      }),
      parent: channel({
        id: PARENT_ID,
        permission_overwrites: [
          overwrite(TARGET_ROLE_ID, 0, DISCORD_PERMISSIONS.VIEW_CHANNEL),
        ],
        type: DISCORD_CHANNEL_TYPES.category,
      }),
    },
  })

  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.action, "put")
  assert.deepEqual(plan.desiredOverwrite?.allowPermissions, ["VIEW_CHANNEL"])
  assert.deepEqual(plan.desiredOverwrite?.denyPermissions, ["SEND_MESSAGES"])
  assert.equal(plan.parentSync.before, true)
  assert.equal(plan.parentSync.after, false)
  assert.equal(plan.botPermission.manageRolesAfter, true)
  assert.equal(plan.targetAccess.impacts[0]?.permission, "SEND_MESSAGES")
  assert.equal(plan.targetAccess.impacts[0]?.after, "denied")
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  setup.state.channel.permission_overwrites = [
    overwrite(TARGET_ROLE_ID, 0, DISCORD_PERMISSIONS.VIEW_CHANNEL, DISCORD_PERMISSIONS.SEND_MESSAGES),
  ]
  const changed = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ operationKey: "permission-overwrite-operation-0002" }),
  )
  assert.notEqual(changed.digest, plan.digest)
})

test("permission-overwrite plans evaluate before and after access at one instant", async () => {
  let clockCalls = 0
  const setup = fixture({
    clock: () => new Date(clockCalls++ === 0
      ? "2026-08-21T00:00:00.000Z"
      : "2026-08-21T00:00:01.000Z"),
    state: {
      roles: [
        role(GUILD_ID, 0n, 0, "@everyone"),
        role(BOT_ROLE_ID, BOT_PERMISSIONS, 20, "connector"),
        role(TARGET_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 10, "reviewers"),
        role(
          TARGET_USER_ROLE_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.SEND_MESSAGES,
          5,
          "member",
        ),
      ],
      targetMember: {
        communication_disabled_until: "2026-08-21T00:00:00.500Z",
        roles: [TARGET_USER_ROLE_ID],
        user: { bot: false, id: TARGET_USER_ID, username: "private-user-name" },
      },
    },
  })

  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request({
    changes: [{ permission: "SEND_MESSAGES", state: "allow" }],
    targetId: TARGET_USER_ID,
    targetType: "member",
  }))

  assert.equal(plan.targetAccess.impacts[0]?.before, "denied")
  assert.equal(plan.targetAccess.impacts[0]?.after, "denied")
})

test("permission-overwrite planning fails closed on scope, unknown bits, authority, and lockout", async () => {
  await assert.rejects(
    () => fixture({ policy: policy({ enabled: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    PolicyError,
  )
  await assert.rejects(
    () => fixture({
      state: {
        channel: channel({
          permission_overwrites: [overwrite(TARGET_ROLE_ID, 0, 1n << 63n)],
        }),
      },
    }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown to this build/,
  )
  await assert.rejects(
    () => fixture({
      state: {
        roles: [
          role(GUILD_ID, 0n, 0),
          role(
            BOT_ROLE_ID,
            DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_ROLES,
            20,
          ),
          role(TARGET_ROLE_ID, 0n, 10),
          role(TARGET_USER_ROLE_ID, 0n, 5),
        ],
      },
    }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /cannot send overwrite permissions/,
  )
  await assert.rejects(
    () => fixture().service.plan(APPLICATION_ID, BOT_ID, request({
      changes: [{ permission: "MANAGE_ROLES", state: "deny" }],
      targetId: BOT_ROLE_ID,
    })),
    /lacks prospective channel-level MANAGE_ROLES/,
  )
  await assert.rejects(
    () => fixture({
      policy: policy({ protectedUsers: [TARGET_USER_ID] }),
    }).service.plan(APPLICATION_ID, BOT_ID, request({
      targetId: TARGET_USER_ID,
      targetType: "member",
    })),
    PolicyError,
  )
})

test("explicit delete can remove unknown bits with a prominent warning", async () => {
  const setup = fixture({
    state: {
      channel: channel({
        permission_overwrites: [overwrite(TARGET_ROLE_ID, 0, 1n << 63n)],
      }),
    },
  })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request({
    changes: undefined,
    mode: "delete",
  } as never))

  assert.equal(plan.action, "delete")
  assert.equal(plan.desiredOverwrite, null)
  assert.match(plan.warnings.join(" "), /unknown to this connector build/)
})

test("permission-overwrite execution journals before one write and verifies the full set", async () => {
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
  assert.equal(result.targetMatched, true)
  assert.equal(result.overwriteSetMatched, true)
  const reserveIndex = setup.events.indexOf("operation:reserve")
  const pendingIndex = setup.events.indexOf("activity:pending")
  const writeIndex = setup.events.findIndex((event) => event.startsWith("write:put:"))
  assert.equal(reserveIndex >= 0 && reserveIndex < pendingIndex, true)
  assert.equal(pendingIndex < writeIndex, true)
  assert.equal(setup.events.filter((event) => event.startsWith("write:")).length, 1)
  assert.equal(setup.activities.length, 2)
  const persisted = JSON.stringify(setup.activities)
  assert.equal(persisted.includes(AUDIT_REASON), false)
  assert.equal(persisted.includes("SEND_MESSAGES"), false)
  assert.equal(persisted.includes(OPERATION_KEY), false)
})

test("permission-overwrite execution rejects stale plans and spent operation keys", async () => {
  const stale = fixture()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, request())
  stale.state.channel.permission_overwrites = [
    overwrite(TARGET_ROLE_ID, 0, DISCORD_PERMISSIONS.VIEW_CHANNEL),
  ]
  await assert.rejects(
    () => stale.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    ChannelPermissionOverwritePlanChangedError,
  )
  assert.equal(stale.events.some((event) => event.startsWith("write:")), false)

  const spent = fixture()
  const spentPlan = await spent.service.plan(APPLICATION_ID, BOT_ID, request())
  await spent.service.execute(APPLICATION_ID, BOT_ID, request(), spentPlan.digest)
  await assert.rejects(
    () => spent.service.plan(APPLICATION_ID, BOT_ID, request()),
    ChannelPermissionOverwriteOperationConflictError,
  )
})

test("permission-overwrite execution distinguishes rejected, uncertain, and drifting outcomes", async () => {
  const rejected = fixture({ state: { mutationError: apiError(403) } })
  const rejectedPlan = await rejected.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    () => rejected.service.execute(APPLICATION_ID, BOT_ID, request(), rejectedPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof ChannelPermissionOverwriteExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )

  const uncertain = fixture({ state: { readbackError: new Error("network unavailable") } })
  const uncertainPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, request({
    operationKey: "permission-overwrite-operation-0002",
  }))
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request({ operationKey: "permission-overwrite-operation-0002" }),
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ChannelPermissionOverwriteExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  const drift = fixture({ state: { mutationUpdatesState: false } })
  const driftPlan = await drift.service.plan(APPLICATION_ID, BOT_ID, request({
    operationKey: "permission-overwrite-operation-0003",
  }))
  const driftResult = await drift.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request({ operationKey: "permission-overwrite-operation-0003" }),
    driftPlan.digest,
  )
  assert.equal(driftResult.status, "completed-with-drift")
  assert.equal(driftResult.targetMatched, false)
})

test("same-channel changes serialize and stop a queued operation after uncertainty", async () => {
  let startMutation: (() => void) | undefined
  let releaseMutation: (() => void) | undefined
  const mutationStarted = new Promise<void>((resolve) => {
    startMutation = resolve
  })
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const setup = fixture({
    state: {
      mutationGate,
      mutationStarted: () => startMutation?.(),
      readbackError: new Error("readback unavailable"),
    },
  })
  const firstRequest = request({ operationKey: "permission-overwrite-operation-0004" })
  const secondRequest = request({
    changes: [{ permission: "READ_MESSAGE_HISTORY", state: "deny" }],
    operationKey: "permission-overwrite-operation-0005",
  })
  const firstPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  const secondPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, secondRequest)
  const firstExecution = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await mutationStarted
  const secondExecution = setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation?.()
  await assert.rejects(firstExecution, ChannelPermissionOverwriteExecutionError)
  await assert.rejects(
    secondExecution,
    (error: unknown) => {
      assert.ok(error instanceof ChannelPermissionOverwriteExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
  assert.equal(setup.events.filter((event) => event.startsWith("write:")).length, 1)
})
