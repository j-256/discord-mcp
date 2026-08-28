import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type {
  DiscordChannelMetadata,
  DiscordVoiceStateSummary,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  GatewayVoiceChannelStatusError,
  VoiceChannelStatusEvidenceError,
  VoiceChannelStatusExecutionError,
  VoiceChannelStatusPlanChangedError,
} from "../src/errors.js"
import type {
  GatewayVoiceChannelStatusSnapshot,
  GatewayVoiceChannelStatusSource,
  GatewayVoiceChannelStatusUpdate,
} from "../src/gateway-voice-channel-status.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"
import {
  normalizeVoiceChannelStatusChangeRequest,
  VoiceChannelStatusService,
  type VoiceChannelStatusChangeRequest,
  type VoiceChannelStatusServiceClient,
} from "../src/voice-channel-status-service.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const CHANNEL_ID = "500000000000000001"
const OTHER_CHANNEL_ID = "500000000000000002"
const OPERATION_KEY = "voice-status-operation-0001"
const AUDIT_REASON = "Reviewed voice status / case 42"
const PRIVATE_CURRENT = "Private current status"
const PRIVATE_DESIRED = "Private desired status"
const PRIVATE_DRIFT = "Private external status"
const NOW = "2026-08-24T12:00:00.000Z"

function role(
  id: string,
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
    icon: null,
    id,
    managed: false,
    mentionable: false,
    name: id === GUILD_ID ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
    ...overrides,
  }
}

function metadata(
  overrides: Partial<DiscordChannelMetadata> = {},
): DiscordChannelMetadata {
  return {
    bitrate: 96_000,
    defaultAutoArchiveDuration: null,
    defaultThreadRateLimitPerUser: null,
    guildId: GUILD_ID,
    id: CHANNEL_ID,
    name: "Private voice channel",
    nsfw: false,
    parentId: null,
    permissionOverwrites: [],
    position: 1,
    rateLimitPerUser: 0,
    rtcRegion: null,
    topic: null,
    type: DISCORD_CHANNEL_TYPES.voice,
    unknownFieldCount: 0,
    userLimit: 0,
    videoQualityMode: 1,
    ...overrides,
  }
}

function voiceState(
  channelId: string | null,
  overrides: Partial<DiscordVoiceStateSummary> = {},
): DiscordVoiceStateSummary {
  return {
    channelId,
    deaf: false,
    guildId: GUILD_ID,
    mute: false,
    selfDeaf: false,
    selfMute: false,
    suppressed: false,
    unknownFieldCount: 0,
    userId: BOT_ID,
    ...overrides,
  }
}

function discordError(status: number, code?: number): DiscordApiError {
  return new DiscordApiError({
    ...(code === undefined ? {} : { code }),
    message: "Discord request failed",
    method: "PUT",
    route: "/channels/{channel.id}/voice-status",
    status,
  })
}

function policy(options: {
  allowChanges?: boolean
  channelIds?: readonly string[]
} = {}): ScopePolicy {
  const channelIds = options.channelIds ?? [CHANNEL_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(channelIds),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowChannelMetadataChanges: options.allowChanges ?? true,
    allowDeletions: false,
    allowInteractions: false,
    channelMetadataIds: new Set(channelIds),
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

function request(
  overrides: Partial<VoiceChannelStatusChangeRequest> = {},
): VoiceChannelStatusChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    status: PRIVATE_DESIRED,
    ...overrides,
  }
}

class MemoryOperationStore implements OperationStore {
  failFinish = false
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()
  reserveCalls = 0

  constructor(events: string[]) {
    this.events = events
  }

  #key(kind: string, hash: string): string {
    return `${kind}:${hash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.failFinish) throw new Error("operation receipt unavailable")
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), structuredClone(receipt))
  }

  async get(kind: OperationReceipt["kind"], hash: string) {
    const value = this.receipts.get(this.#key(kind, hash))
    return value ? structuredClone(value) : undefined
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.reserveCalls += 1
    this.events.push("operation:reserve")
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: structuredClone(existing) }
    this.receipts.set(key, structuredClone(receipt))
    return { created: true, receipt: structuredClone(receipt) }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  botMember: DiscordGuildMember
  botVoice: DiscordVoiceStateSummary | null
  botVoiceError: unknown
  currentStatus: string | null
  driftStatus: string | null | undefined
  gatewayEnabled: boolean
  gatewayReadError: unknown
  guildOwnerId: string
  metadata: DiscordChannelMetadata
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  permissions: bigint
  waitMode: "reject" | "resolve"
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const defaultPermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.SET_VOICE_CHANNEL_STATUS
    | DISCORD_PERMISSIONS.MANAGE_CHANNELS
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    botVoice: voiceState(OTHER_CHANNEL_ID),
    botVoiceError: undefined,
    currentStatus: PRIVATE_CURRENT,
    driftStatus: undefined,
    gatewayEnabled: true,
    gatewayReadError: undefined,
    guildOwnerId: OWNER_ID,
    metadata: metadata(),
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    permissions: defaultPermissions,
    waitMode: "resolve",
    ...options.state,
  }
  const events: string[] = []
  const activities: ActivityEntry[] = []
  let activityCalls = 0
  let gatewayReads = 0
  let mutations = 0
  let sequence = 10
  let waiter: {
    reject: (error: unknown) => void
    resolve: (update: GatewayVoiceChannelStatusUpdate) => void
  } | undefined
  const operationStore = new MemoryOperationStore(events)
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) throw new Error("activity unavailable")
      activities.push(structuredClone(entry))
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const snapshot = (): GatewayVoiceChannelStatusSnapshot => ({
    channelId: CHANNEL_ID,
    evidence: {
      discardedChannelEntries: 1,
      responseUnknownFieldCount: 0,
      returnedChannelEntries: 2,
      statusRepresentation: state.currentStatus === null ? "null" : "value",
      targetUnknownFieldCount: 0,
    },
    freshness: {
      gatewaySequence: sequence++,
      observedAt: "2026-08-24T12:00:01.000Z",
      requestedAt: "2026-08-24T12:00:00.000Z",
      source: "gateway-request-channel-info",
    },
    guildId: GUILD_ID,
    privacy: {
      nonTargetStatusText: "discarded-before-projection",
      persistence: "none",
      rawPayloads: "omitted",
      text: "transient-untrusted",
    },
    schemaVersion: 1,
    status: state.currentStatus,
  })
  const gateway: GatewayVoiceChannelStatusSource = {
    get voiceChannelStatusEnabled() {
      return state.gatewayEnabled
    },
    async getVoiceChannelStatus(guildId, channelId) {
      gatewayReads += 1
      events.push("gateway:read")
      assert.equal(guildId, GUILD_ID)
      assert.equal(channelId, CHANNEL_ID)
      if (mutations > 0 && state.gatewayReadError) throw state.gatewayReadError
      return snapshot()
    },
    waitForVoiceChannelStatusUpdate(guildId, channelId, requestOptions) {
      events.push("gateway:subscribe")
      assert.equal(guildId, GUILD_ID)
      assert.equal(channelId, CHANNEL_ID)
      if (state.waitMode === "reject") {
        return Promise.reject(new GatewayVoiceChannelStatusError("settlement unavailable"))
      }
      return new Promise((resolve, reject) => {
        waiter = { reject, resolve }
        requestOptions?.signal?.addEventListener("abort", () => {
          reject(new GatewayVoiceChannelStatusError("settlement cancelled"))
        }, { once: true })
      })
    },
  }
  const client: VoiceChannelStatusServiceClient = {
    async getCurrentUserVoiceState() {
      events.push("read:voice-state")
      if (state.botVoiceError) throw state.botVoiceError
      if (!state.botVoice) throw discordError(404, 10065)
      return structuredClone(state.botVoice)
    },
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: "Private guild", owner_id: state.guildOwnerId }
    },
    async getGuildChannelMetadata() {
      events.push("read:metadata")
      return structuredClone(state.metadata)
    },
    async getGuildMember() {
      events.push("read:member")
      return structuredClone(state.botMember)
    },
    async getGuildRoles() {
      events.push("read:roles")
      return [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, state.permissions, 1, {
          managed: true,
          tags: { bot_id: BOT_ID },
        }),
      ]
    },
    async setVoiceChannelStatus(channelId, status, auditReason) {
      mutations += 1
      events.push("write:status")
      assert.equal(channelId, CHANNEL_ID)
      assert.equal(auditReason, AUDIT_REASON)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      waiter?.resolve({
        channelId: CHANNEL_ID,
        freshness: {
          gatewaySequence: sequence++,
          observedAt: "2026-08-24T12:00:02.000Z",
          source: "gateway-voice-channel-status-update",
        },
        guildId: GUILD_ID,
        status,
        unknownFieldCount: 0,
      })
      state.currentStatus = state.driftStatus === undefined ? status : state.driftStatus
    },
  }
  const service = new VoiceChannelStatusService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    gateway,
    operationStore,
    planKey: new Uint8Array(32).fill(13),
    policy: options.policy ?? policy(),
    randomId: () => "voice-status-activity-1",
  })
  return {
    activities,
    events,
    get gatewayReads() {
      return gatewayReads
    },
    get mutations() {
      return mutations
    },
    operationStore,
    service,
    state,
  }
}

test("voice channel status request normalization is exact and unambiguous", () => {
  const normalized = normalizeVoiceChannelStatusChangeRequest(request())
  assert.deepEqual(Object.keys(normalized).sort(), [
    "auditReason",
    "channelId",
    "guildId",
    "operationKeyHash",
    "status",
  ])
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(normalizeVoiceChannelStatusChangeRequest(request({ status: null })).status, null)

  for (const invalid of [
    { ...request(), extra: true },
    { ...request(), status: undefined },
    request({ status: "" }),
    request({ status: " surrounding " }),
    request({ status: "line\nbreak" }),
    request({ status: "x".repeat(501) }),
    request({ status: "\ud800" }),
    request({ guildId: "invalid" }),
    request({ auditReason: " " }),
    request({ operationKey: "invalid key" }),
  ]) {
    assert.throws(
      () => normalizeVoiceChannelStatusChangeRequest(invalid as VoiceChannelStatusChangeRequest),
    )
  }
})

test("voice channel status read exposes exact target evidence without another channel ID", async () => {
  const value = fixture()
  const result = await value.service.get(BOT_ID, GUILD_ID, CHANNEL_ID)

  assert.equal(result.current.status, PRIVATE_CURRENT)
  assert.equal(result.botConnection, "other")
  assert.equal(result.permission.manageChannelsRequired, true)
  assert.deepEqual(result.permission.requiredPermissions, [
    "VIEW_CHANNEL",
    "SET_VOICE_CHANNEL_STATUS",
    "MANAGE_CHANNELS",
  ])
  assert.equal(result.privacy.nonTargetChannelIdsExposed, false)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(OTHER_CHANNEL_ID))
})

test("voice channel status rejects Stage, policy, and disabled Gateway targets before broad evidence", async () => {
  const stage = fixture({
    state: { metadata: metadata({ type: DISCORD_CHANNEL_TYPES.stageVoice }) },
  })
  await assert.rejects(
    stage.service.get(BOT_ID, GUILD_ID, CHANNEL_ID),
    VoiceChannelStatusEvidenceError,
  )
  assert.equal(stage.gatewayReads, 0)
  assert.deepEqual(stage.events, ["read:metadata"])

  const outside = fixture({ policy: policy({ channelIds: [] }) })
  await assert.rejects(
    outside.service.get(BOT_ID, GUILD_ID, CHANNEL_ID),
    /channel-metadata changes require an explicit channel allowlist/,
  )
  assert.equal(outside.gatewayReads, 0)

  const disabled = fixture({ state: { gatewayEnabled: false } })
  await assert.rejects(
    disabled.service.get(BOT_ID, GUILD_ID, CHANNEL_ID),
    /Gateway voice-channel status evidence is disabled/,
  )
  assert.equal(disabled.gatewayReads, 0)
})

test("voice channel status proves Discord's conditional permission rule", async () => {
  const connected = fixture({
    state: {
      botVoice: voiceState(CHANNEL_ID),
      permissions: DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.SET_VOICE_CHANNEL_STATUS,
    },
  })
  const connectedResult = await connected.service.get(BOT_ID, GUILD_ID, CHANNEL_ID)
  assert.equal(connectedResult.botConnection, "target")
  assert.equal(connectedResult.permission.manageChannelsRequired, false)
  assert.deepEqual(connectedResult.permission.requiredPermissions, [
    "VIEW_CHANNEL",
    "SET_VOICE_CHANNEL_STATUS",
  ])

  const disconnected = fixture({
    state: {
      botVoice: null,
      permissions: DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.SET_VOICE_CHANNEL_STATUS,
    },
  })
  await assert.rejects(
    disconnected.service.get(BOT_ID, GUILD_ID, CHANNEL_ID),
    /MANAGE_CHANNELS/,
  )

  const missingStatusPermission = fixture({
    state: {
      botVoice: voiceState(CHANNEL_ID),
      permissions: DISCORD_PERMISSIONS.VIEW_CHANNEL,
    },
  })
  await assert.rejects(
    missingStatusPermission.service.get(BOT_ID, GUILD_ID, CHANNEL_ID),
    /SET_VOICE_CHANNEL_STATUS/,
  )
})

test("voice channel status plans are freshness-stable but bind meaningful state", async () => {
  const value = fixture()
  const first = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  const second = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(first.digest, second.digest)
  assert.notEqual(first.current.freshness.gatewaySequence, second.current.freshness.gatewaySequence)
  assert.equal(first.writeRequired, true)
  assert.equal(value.operationStore.reserveCalls, 0)
  assert.deepEqual(value.activities, [])

  value.state.currentStatus = "Changed before execution"
  const changed = await value.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ operationKey: "voice-status-operation-0002" }),
  )
  assert.notEqual(changed.digest, first.digest)
})

test("voice channel status no-op execution is record-free", async () => {
  const value = fixture({ state: { currentStatus: PRIVATE_DESIRED } })
  const plan = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  const result = await value.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(result.verification, "not-required")
  assert.equal(value.mutations, 0)
  assert.equal(value.operationStore.reserveCalls, 0)
  assert.deepEqual(value.activities, [])
  assert.equal(value.events.includes("gateway:subscribe"), false)
})

test("voice channel status executes once, settles by event, and verifies a fresh match", async () => {
  const value = fixture()
  const plan = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  value.events.length = 0
  const result = await value.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.equal(result.settlementEvent, "matched")
  assert.equal(result.observed.status, PRIVATE_DESIRED)
  assert.equal(value.mutations, 1)
  assert.deepEqual(value.events.slice(-6), [
    "activity:pending",
    "gateway:subscribe",
    "write:status",
    "gateway:read",
    "operation:completed",
    "activity:completed",
  ])
  const durable = JSON.stringify({
    activities: value.activities,
    receipts: [...value.operationStore.receipts.values()],
  })
  for (const privateText of [PRIVATE_CURRENT, PRIVATE_DESIRED, AUDIT_REASON]) {
    assert.equal(durable.includes(privateText), false)
  }
})

test("voice channel status records successful fresh drift without retrying", async () => {
  const value = fixture({ state: { driftStatus: PRIVATE_DRIFT } })
  const plan = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  const result = await value.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")
  assert.equal(result.settlementEvent, "matched")
  assert.equal(result.observed.status, PRIVATE_DRIFT)
  assert.equal(value.mutations, 1)
  assert.equal(value.activities.at(-1)?.status, "completed-with-drift")
})

test("voice channel status classifies a known 4xx as failed without quarantining", async () => {
  const value = fixture({ state: { mutationError: discordError(403, 50013) } })
  const plan = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    value.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert(error instanceof VoiceChannelStatusExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )
  assert.equal(value.mutations, 1)
  assert.equal(value.activities.at(-1)?.status, "failed")

  value.state.mutationError = undefined
  const nextRequest = request({ operationKey: "voice-status-operation-after-4xx" })
  const nextPlan = await value.service.plan(APPLICATION_ID, BOT_ID, nextRequest)
  const result = await value.service.execute(
    APPLICATION_ID,
    BOT_ID,
    nextRequest,
    nextPlan.digest,
  )
  assert.equal(result.status, "completed")
})

test("voice channel status quarantines ambiguous readback without persisting text", async () => {
  const value = fixture({
    state: { gatewayReadError: new GatewayVoiceChannelStatusError("readback unavailable") },
  })
  const plan = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    value.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert(error instanceof VoiceChannelStatusExecutionError)
      const result = error.result as { error: string; status: string }
      assert.equal(result.status, "uncertain")
      assert.equal(result.error, "GatewayVoiceChannelStatusError")
      assert.equal(JSON.stringify(result).includes(PRIVATE_DESIRED), false)
      return true
    },
  )
  assert.equal(value.activities.at(-1)?.status, "uncertain")
  const durable = JSON.stringify({
    activities: value.activities,
    receipts: [...value.operationStore.receipts.values()],
  })
  assert.equal(durable.includes(PRIVATE_DESIRED), false)
  assert.equal(durable.includes(AUDIT_REASON), false)

  value.state.gatewayReadError = undefined
  const nextRequest = request({ operationKey: "voice-status-operation-after-uncertain" })
  await assert.rejects(
    value.service.execute(
      APPLICATION_ID,
      BOT_ID,
      nextRequest,
      "hmac-sha256:" + "0".repeat(64),
    ),
    (error: unknown) => {
      assert(error instanceof VoiceChannelStatusExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-prior-uncertain")
      return true
    },
  )
  assert.equal(value.mutations, 1)
})

test("voice channel status maps arbitrary error names to fixed durable categories", async () => {
  const injected = new Error("Private transport failure")
  injected.name = PRIVATE_DESIRED
  const value = fixture({ state: { mutationError: injected } })
  const plan = await value.service.plan(APPLICATION_ID, BOT_ID, request())

  await assert.rejects(
    value.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert(error instanceof VoiceChannelStatusExecutionError)
      assert.deepEqual(
        {
          error: (error.result as { error: string }).error,
          status: (error.result as { status: string }).status,
        },
        { error: "UnknownError", status: "uncertain" },
      )
      return true
    },
  )
  const durable = JSON.stringify({
    activities: value.activities,
    receipts: [...value.operationStore.receipts.values()],
  })
  assert.equal(durable.includes(PRIVATE_DESIRED), false)
  assert.equal(durable.includes("Private transport failure"), false)
})

test("voice channel status detects plan drift before reservation", async () => {
  const value = fixture()
  const plan = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  value.state.currentStatus = "Changed before execution"
  await assert.rejects(
    value.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    VoiceChannelStatusPlanChangedError,
  )
  assert.equal(value.mutations, 0)
  assert.equal(value.operationStore.reserveCalls, 0)
  assert.deepEqual(value.activities, [])
})

test("voice channel status blocks mutation when pending audit cannot be recorded", async () => {
  const value = fixture({ state: { activityFailureAt: 1 } })
  const plan = await value.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    value.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert(error instanceof VoiceChannelStatusExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(value.mutations, 0)
})

test("voice channel status serializes concurrent exact-channel execution", async () => {
  let releaseMutation: () => void = () => undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let mutationStarted: () => void = () => undefined
  const started = new Promise<void>((resolve) => {
    mutationStarted = resolve
  })
  const value = fixture({ state: { mutationGate, mutationStarted } })
  const firstRequest = request({ operationKey: "voice-status-concurrent-1" })
  const secondRequest = request({
    operationKey: "voice-status-concurrent-2",
    status: "Second requested status",
  })
  const firstPlan = await value.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  const secondPlan = await value.service.plan(APPLICATION_ID, BOT_ID, secondRequest)
  const firstExecution = value.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await started
  const secondExecution = value.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(value.mutations, 1)
  releaseMutation()
  assert.equal((await firstExecution).status, "completed")
  await assert.rejects(secondExecution, VoiceChannelStatusPlanChangedError)
  assert.equal(value.mutations, 1)
})
