import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
  GuildCommunityActivity,
} from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type { ModifyGuildCommunityInput } from "../src/discord-client.js"
import {
  DiscordApiError,
  GuildCommunityEvidenceError,
  GuildCommunityExecutionError,
  GuildCommunityOperationConflictError,
  GuildCommunityPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import type {
  GatewayChannelLayoutSnapshot,
  GatewayChannelLayoutSource,
} from "../src/gateway-channel-layout.js"
import {
  GuildCommunityService,
  normalizeGuildCommunityChangeRequest,
  type GuildCommunityChangeRequest,
  type GuildCommunityServiceOptions,
} from "../src/guild-community-service.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const SECOND_GUILD_ID = "200000000000000002"
const THIRD_GUILD_ID = "200000000000000003"
const FOURTH_GUILD_ID = "200000000000000004"
const FIFTH_GUILD_ID = "200000000000000005"
const OWNER_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const BOT_ROLE_ID = "500000000000000001"
const RULES_CHANNEL_ID = "600000000000000001"
const UPDATES_CHANNEL_ID = "600000000000000002"
const SAFETY_CHANNEL_ID = "600000000000000003"
const CATEGORY_ID = "600000000000000004"
const VOICE_CHANNEL_ID = "600000000000000005"
const AUDIT_REASON = "Reviewed Community routing"
const OPERATION_KEY = "guild-community-operation-0001"
const NOW = "2026-08-26T00:00:00.000Z"

function role(
  id: string,
  permissions: bigint,
  position: number,
  guildId = GUILD_ID,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === guildId ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(
  id: string,
  type: number,
  position: number,
  guildId = GUILD_ID,
  parentId: string | null = null,
): DiscordChannel {
  return {
    guild_id: guildId,
    id,
    name: `private-channel-${id}`,
    parent_id: parentId,
    permission_overwrites: [],
    position,
    type,
  }
}

interface CommunityState {
  features: string[]
  publicUpdatesChannelId: string | null
  rulesChannelId: string | null
  safetyAlertsChannelId: string | null
}

function disabledCommunity(): CommunityState {
  return {
    features: ["NEWS"],
    publicUpdatesChannelId: null,
    rulesChannelId: null,
    safetyAlertsChannelId: null,
  }
}

function enabledCommunity(): CommunityState {
  return {
    features: ["COMMUNITY", "NEWS"],
    publicUpdatesChannelId: UPDATES_CHANNEL_ID,
    rulesChannelId: RULES_CHANNEL_ID,
    safetyAlertsChannelId: SAFETY_CHANNEL_ID,
  }
}

function guild(
  guildId: string,
  ownerId: string,
  state: CommunityState,
): DiscordGuild {
  return {
    features: [...state.features],
    id: guildId,
    name: "Private Guild",
    owner_id: ownerId,
    public_updates_channel_id: state.publicUpdatesChannelId,
    rules_channel_id: state.rulesChannelId,
    safety_alerts_channel_id: state.safetyAlertsChannelId,
  }
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
  activityFailureAt: number | null
  botMember: DiscordGuildMember
  channels: DiscordChannel[]
  community: CommunityState
  layoutObfuscatedIds: Set<string>
  layoutRevision: number
  mutationError: unknown
  mutationUpdatesState: boolean
  ownerId: string
  readbackError: unknown
  responseFeatures: string[] | null
  responsePublicUpdatesChannelId: string | null | undefined
  responseRulesChannelId: string | null | undefined
  responseSafetyAlertsChannelId: string | null | undefined
  roles: DiscordRole[]
}

class FixtureLayoutSource implements GatewayChannelLayoutSource {
  readonly #guildId: string
  readonly #state: FixtureState
  readonly layoutEnabled = true

  constructor(guildId: string, state: FixtureState) {
    this.#guildId = guildId
    this.#state = state
  }

  getChannelLayout(guildId: string): GatewayChannelLayoutSnapshot {
    assert.equal(guildId, this.#guildId)
    return {
      channels: this.#state.channels.map((entry) => ({
        channelId: entry.id,
        obfuscated: this.#state.layoutObfuscatedIds.has(entry.id),
        parentChannelId: entry.parent_id ?? null,
        position: entry.position ?? 0,
        type: entry.type,
      })),
      complete: true,
      guildId,
      reason: null,
      revision: this.#state.layoutRevision,
      schemaVersion: 1,
      state: "ready",
      updatedAt: NOW,
    }
  }

  getChannelLayoutStatus() {
    return {
      channels: { obfuscated: 0, retained: this.#state.channels.length },
      enabled: true,
      guilds: {
        invalidated: 0,
        pending: 0,
        ready: 1,
        resuming: 0,
        scoped: 1,
        unavailable: 0,
      },
      invalidations: 0,
      schemaVersion: 1,
      updates: 1,
    }
  }

  subscribeChannelLayouts() {
    return () => undefined
  }
}

function applyInput(input: ModifyGuildCommunityInput, target: CommunityState): void {
  target.features = [...input.features]
  target.publicUpdatesChannelId = input.publicUpdatesChannelId
  target.rulesChannelId = input.rulesChannelId
  target.safetyAlertsChannelId = input.safetyAlertsChannelId
}

function fixture(options: {
  allowAudit?: boolean
  allowChanges?: boolean
  guildId?: string
  state?: Partial<FixtureState>
} = {}) {
  const guildId = options.guildId ?? GUILD_ID
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      pending: false,
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: [
      channel(RULES_CHANNEL_ID, DISCORD_CHANNEL_TYPES.text, 0, guildId),
      channel(UPDATES_CHANNEL_ID, DISCORD_CHANNEL_TYPES.announcement, 1, guildId),
      channel(SAFETY_CHANNEL_ID, DISCORD_CHANNEL_TYPES.text, 2, guildId),
      channel(CATEGORY_ID, DISCORD_CHANNEL_TYPES.category, 3, guildId),
      channel(VOICE_CHANNEL_ID, DISCORD_CHANNEL_TYPES.voice, 4, guildId),
    ],
    community: disabledCommunity(),
    layoutObfuscatedIds: new Set(),
    layoutRevision: 1,
    mutationError: undefined,
    mutationUpdatesState: true,
    ownerId: OWNER_ID,
    readbackError: undefined,
    responseFeatures: null,
    responsePublicUpdatesChannelId: undefined,
    responseRulesChannelId: undefined,
    responseSafetyAlertsChannelId: undefined,
    roles: [
      role(guildId, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0, guildId),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, 1, guildId),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const writes: ModifyGuildCommunityInput[] = []
  const reasons: string[] = []
  let activityCalls = 0
  let mutationCompleted = false
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) throw new Error("activity unavailable")
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(events)
  const policy: GuildCommunityServiceOptions["policy"] = {
    assertGuildCommunityAuditable(candidate) {
      if (!(options.allowAudit ?? true) || candidate !== guildId) {
        throw new PolicyError("Discord guild Community audit is outside scope")
      }
    },
    assertGuildCommunityChangeable(candidate) {
      if (!(options.allowChanges ?? true) || candidate !== guildId) {
        throw new PolicyError("Discord guild Community change is outside scope")
      }
    },
  }
  const client: GuildCommunityServiceOptions["client"] = {
    async getGuild() {
      events.push(mutationCompleted ? "read:readback-guild" : "read:guild")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return guild(guildId, state.ownerId, state.community)
    },
    async getGuildChannels() {
      events.push("read:channels")
      return structuredClone(state.channels)
    },
    async getGuildMember() {
      events.push("read:member")
      return structuredClone(state.botMember)
    },
    async getGuildRoles() {
      events.push("read:roles")
      return structuredClone(state.roles)
    },
    async modifyGuildCommunity(candidate, input, reason) {
      assert.equal(candidate, guildId)
      events.push("write:guild-community")
      writes.push(structuredClone(input))
      reasons.push(reason)
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      const response = structuredClone(state.community)
      applyInput(input, response)
      if (state.responseFeatures !== null) {
        response.features = [...state.responseFeatures]
      }
      if (state.responsePublicUpdatesChannelId !== undefined) {
        response.publicUpdatesChannelId = state.responsePublicUpdatesChannelId
      }
      if (state.responseRulesChannelId !== undefined) {
        response.rulesChannelId = state.responseRulesChannelId
      }
      if (state.responseSafetyAlertsChannelId !== undefined) {
        response.safetyAlertsChannelId = state.responseSafetyAlertsChannelId
      }
      if (state.mutationUpdatesState) applyInput(input, state.community)
      return guild(guildId, state.ownerId, response)
    },
  }
  const service = new GuildCommunityService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    layoutSource: new FixtureLayoutSource(guildId, state),
    operationStore,
    planKey: new Uint8Array(32).fill(31),
    policy,
    randomId: () => `activity-guild-community-${guildId}`,
  })
  return {
    activities,
    events,
    operationStore,
    reasons,
    service,
    state,
    writes,
  }
}

function request(
  overrides: Partial<GuildCommunityChangeRequest> = {},
): GuildCommunityChangeRequest {
  return {
    acknowledgeCommunityEnablement: true,
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    publicUpdatesChannelId: UPDATES_CHANNEL_ID,
    rulesChannelId: RULES_CHANNEL_ID,
    safetyAlertsChannelId: SAFETY_CHANNEL_ID,
    ...overrides,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected guild Community change",
    method: "PATCH",
    route: "/guilds/{guild.id}",
    status,
  })
}

test("guild Community normalization requires one exact acknowledged target state", () => {
  const normalized = normalizeGuildCommunityChangeRequest(request({
    safetyAlertsChannelId: UPDATES_CHANNEL_ID,
  }))
  assert.equal(normalized.acknowledgeCommunityEnablement, true)
  assert.equal(normalized.safetyAlertsChannelId, UPDATES_CHANNEL_ID)
  assert.equal(normalized.operationKeyHash.includes(OPERATION_KEY), false)

  assert.throws(
    () => normalizeGuildCommunityChangeRequest({
      ...request(),
      acknowledgeCommunityEnablement: false,
    } as unknown as GuildCommunityChangeRequest),
    /request is invalid/,
  )
  assert.throws(
    () => normalizeGuildCommunityChangeRequest({
      ...request(),
      future: true,
    } as unknown as GuildCommunityChangeRequest),
    /request is invalid/,
  )
  assert.throws(
    () => normalizeGuildCommunityChangeRequest(request({
      publicUpdatesChannelId: RULES_CHANNEL_ID,
    })),
    /must be distinct/,
  )
  assert.throws(
    () => normalizeGuildCommunityChangeRequest(request({ rulesChannelId: "bad" })),
    /positive Discord snowflake/,
  )
  assert.throws(
    () => normalizeGuildCommunityChangeRequest(request({ operationKey: "short" })),
    /operation key/,
  )
})

test("guild Community audit reports absent authority without requiring write access", async () => {
  const audited = fixture({
    allowChanges: false,
    state: {
      roles: [
        role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
        role(BOT_ROLE_ID, 0n, 1),
      ],
    },
  })
  const result = await audited.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(result.status, "ok")
  assert.equal(result.configuration.communityEnabled, false)
  assert.equal(result.configuration.featureCount, 1)
  assert.match(result.configuration.featureDigest, /^sha256:[a-f0-9]{64}$/)
  assert.match(result.configuration.stateDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(result.access.authorizedForEnablement, false)
  assert.equal(result.access.authorizedForRoutingChange, false)
  assert.equal(result.warnings.some((entry) => entry.includes("ADMINISTRATOR")), true)
  assert.equal(JSON.stringify(result).includes("NEWS"), false)
  assert.equal(JSON.stringify(result).includes("private-channel"), false)
  assert.equal(JSON.stringify(result).includes("private-role"), false)
})

test("guild Community enablement plans preserve features under Administrator", async () => {
  const planned = fixture()
  const plan = await planned.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(plan.status, "planned")
  assert.equal(plan.enablementRequired, true)
  assert.equal(plan.requiredPermission, "ADMINISTRATOR")
  assert.deepEqual(plan.changedFields, [
    "communityEnabled",
    "publicUpdatesChannelId",
    "rulesChannelId",
    "safetyAlertsChannelId",
  ])
  assert.equal(plan.current.communityEnabled, false)
  assert.equal(plan.desired.communityEnabled, true)
  assert.equal(plan.desired.rulesChannel?.everyoneCanView, true)
  assert.equal(plan.desired.rulesChannel?.everyoneCanSend, false)
  assert.equal(plan.preservedFeatureCount, 1)
  assert.equal(plan.warnings.some((entry) => entry.includes("remove that grant")), true)
  assert.equal(JSON.stringify(plan).includes("NEWS"), false)
})

test("guild Community routing-only plans require MANAGE_GUILD, not Administrator", async () => {
  const planned = fixture({
    state: {
      community: {
        ...enabledCommunity(),
        safetyAlertsChannelId: null,
      },
      roles: [
        role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 1),
      ],
    },
  })
  const plan = await planned.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(plan.enablementRequired, false)
  assert.equal(plan.requiredPermission, "MANAGE_GUILD")
  assert.deepEqual(plan.changedFields, ["safetyAlertsChannelId"])
  assert.equal(plan.access.botAdministrator, false)

  const denied = fixture({
    state: {
      community: enabledCommunity(),
      roles: [
        role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
        role(BOT_ROLE_ID, 0n, 1),
      ],
    },
  })
  await assert.rejects(
    denied.service.plan(APPLICATION_ID, BOT_ID, request()),
    /MANAGE_GUILD authority/,
  )
})

test("guild Community planning fails closed on unsafe channel evidence", async () => {
  const hidden = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, 1),
      ],
    },
  })
  await assert.rejects(
    hidden.service.plan(APPLICATION_ID, BOT_ID, request()),
    /visible to @everyone/,
  )

  const obfuscated = fixture({
    state: { layoutObfuscatedIds: new Set([RULES_CHANNEL_ID]) },
  })
  await assert.rejects(
    obfuscated.service.plan(APPLICATION_ID, BOT_ID, request()),
    GuildCommunityEvidenceError,
  )

  const wrongType = fixture()
  wrongType.state.channels = wrongType.state.channels.map((entry) => (
    entry.id === RULES_CHANNEL_ID
      ? { ...entry, type: DISCORD_CHANNEL_TYPES.voice }
      : entry
  ))
  await assert.rejects(
    wrongType.service.plan(APPLICATION_ID, BOT_ID, request()),
    /direct text or announcement/,
  )

  const pending = fixture({
    state: { botMember: { ...fixture().state.botMember, pending: true } },
  })
  await assert.rejects(
    pending.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    /bot evidence/,
  )
})

test("an already-current guild Community request is a record-free no-op", async () => {
  const current = fixture({ state: { community: enabledCommunity() } })
  const plan = await current.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(plan.status, "already-current")
  const result = await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )
  assert.deepEqual(result.changedFields, [])
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(current.writes.length, 0)
  assert.equal(current.activities.length, 0)
  assert.equal(current.events.includes("operation:reserve"), false)
})

test("guild Community execution journals before one exact write and verifies readback", async () => {
  const executed = fixture()
  const desired = request()
  const plan = await executed.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await executed.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.deepEqual(executed.writes, [{
    features: ["COMMUNITY", "NEWS"],
    publicUpdatesChannelId: UPDATES_CHANNEL_ID,
    rulesChannelId: RULES_CHANNEL_ID,
    safetyAlertsChannelId: SAFETY_CHANNEL_ID,
  }])
  assert.deepEqual(executed.reasons, [AUDIT_REASON])
  const reserveIndex = executed.events.indexOf("operation:reserve")
  const pendingIndex = executed.events.indexOf("activity:pending")
  const writeIndex = executed.events.indexOf("write:guild-community")
  const readbackIndex = executed.events.indexOf("read:readback-guild")
  assert.equal(reserveIndex >= 0, true)
  assert.equal(pendingIndex > reserveIndex, true)
  assert.equal(writeIndex > pendingIndex, true)
  assert.equal(readbackIndex > writeIndex, true)
  assert.deepEqual(executed.activities.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  const persisted = JSON.stringify(executed.activities)
  assert.equal(persisted.includes(AUDIT_REASON), false)
  assert.equal(persisted.includes(OPERATION_KEY), false)
  assert.equal(persisted.includes("NEWS"), false)
  const terminal = executed.activities[1] as GuildCommunityActivity
  assert.equal(terminal.verification, "match")
  assert.match(terminal.stateDigest, /^sha256:[a-f0-9]{64}$/)
})

test("guild Community execution rejects stale plans and one-shot conflicts", async () => {
  const stale = fixture()
  const desired = request()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, desired)
  stale.state.community.features.push("ANIMATED_BANNER")
  await assert.rejects(
    stale.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    GuildCommunityPlanChangedError,
  )
  assert.equal(stale.writes.length, 0)

  const conflicting = fixture()
  const conflictPlan = await conflicting.service.plan(APPLICATION_ID, BOT_ID, desired)
  await conflicting.operationStore.reserve({
    activityId: "existing-community-operation",
    error: null,
    guildId: GUILD_ID,
    kind: "guild-community-change",
    operationKeyHash: conflictPlan.operationKeyHash,
    planDigest: conflictPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    conflicting.service.execute(APPLICATION_ID, BOT_ID, desired, conflictPlan.digest),
    GuildCommunityOperationConflictError,
  )
  assert.equal(conflicting.writes.length, 0)
})

test("pending guild Community activity failure blocks mutation", async () => {
  const blocked = fixture({ state: { activityFailureAt: 1 } })
  const desired = request()
  const plan = await blocked.service.plan(APPLICATION_ID, BOT_ID, desired)
  await assert.rejects(
    blocked.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildCommunityExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(blocked.writes.length, 0)
})

test("known guild Community refusal settles while rate limiting is uncertain", async () => {
  const refused = fixture({
    guildId: SECOND_GUILD_ID,
    state: { mutationError: apiError(403) },
  })
  const refusedRequest = request({
    guildId: SECOND_GUILD_ID,
    operationKey: "guild-community-refusal-operation",
  })
  const refusedPlan = await refused.service.plan(
    APPLICATION_ID,
    BOT_ID,
    refusedRequest,
  )
  await assert.rejects(
    refused.service.execute(
      APPLICATION_ID,
      BOT_ID,
      refusedRequest,
      refusedPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildCommunityExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )

  const limited = fixture({
    guildId: THIRD_GUILD_ID,
    state: { mutationError: apiError(429) },
  })
  const limitedRequest = request({
    guildId: THIRD_GUILD_ID,
    operationKey: "guild-community-rate-limit-operation",
  })
  const limitedPlan = await limited.service.plan(
    APPLICATION_ID,
    BOT_ID,
    limitedRequest,
  )
  await assert.rejects(
    limited.service.execute(
      APPLICATION_ID,
      BOT_ID,
      limitedRequest,
      limitedPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildCommunityExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(limited.writes.length, 1)
})

test("feature loss or unreadable guild Community readback is uncertain and quarantined", async () => {
  const lost = fixture({
    guildId: FOURTH_GUILD_ID,
    state: { responseFeatures: ["COMMUNITY"] },
  })
  const lostRequest = request({
    guildId: FOURTH_GUILD_ID,
    operationKey: "guild-community-feature-loss-operation",
  })
  const lostPlan = await lost.service.plan(APPLICATION_ID, BOT_ID, lostRequest)
  await assert.rejects(
    lost.service.execute(APPLICATION_ID, BOT_ID, lostRequest, lostPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildCommunityExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  const followerRequest = request({
    guildId: FOURTH_GUILD_ID,
    operationKey: "guild-community-feature-loss-follower",
  })
  await assert.rejects(
    lost.service.execute(
      APPLICATION_ID,
      BOT_ID,
      followerRequest,
      lostPlan.digest,
    ),
    /prior same-guild operation ended without a durable outcome/,
  )
  assert.equal(lost.writes.length, 1)

  const unreadable = fixture({
    guildId: FIFTH_GUILD_ID,
    state: { readbackError: new Error("readback unavailable") },
  })
  const unreadableRequest = request({
    guildId: FIFTH_GUILD_ID,
    operationKey: "guild-community-readback-operation",
  })
  const unreadablePlan = await unreadable.service.plan(
    APPLICATION_ID,
    BOT_ID,
    unreadableRequest,
  )
  await assert.rejects(
    unreadable.service.execute(
      APPLICATION_ID,
      BOT_ID,
      unreadableRequest,
      unreadablePlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildCommunityExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
})
