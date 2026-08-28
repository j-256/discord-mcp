import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type {
  DiscordGuildMemberVoiceUpdate,
  DiscordVoiceStateSummary,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  MemberVoiceExecutionError,
  MemberVoiceOperationConflictError,
  MemberVoicePlanChangedError,
} from "../src/errors.js"
import {
  MemberVoiceService,
  normalizeMemberVoiceChangeRequest,
  type MemberVoiceChangeRequest,
  type MemberVoiceServiceOptions,
} from "../src/member-voice-service.js"
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
const USER_ID = "500000000000000001"
const USER_ROLE_ID = "500000000000000002"
const SOURCE_ID = "600000000000000001"
const DESTINATION_ID = "600000000000000002"
const OPERATION_KEY = "member-voice-operation-0001"
const AUDIT_REASON = "Reviewed voice support change"
const NOW = "2026-08-22T12:00:00.000Z"

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

function channel(
  id: string,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: `private-voice-${id}`,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.voice,
    ...overrides,
  }
}

function voice(
  channelId = SOURCE_ID,
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
    userId: USER_ID,
    ...overrides,
  }
}

function moveRequest(
  overrides: Partial<MemberVoiceChangeRequest> = {},
): MemberVoiceChangeRequest {
  return {
    action: "move",
    auditReason: AUDIT_REASON,
    destinationChannelId: DESTINATION_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    userId: USER_ID,
    ...overrides,
  } as MemberVoiceChangeRequest
}

function policy(options: {
  allowAudit?: boolean
  allowChanges?: boolean
  channels?: readonly string[]
  protectedUsers?: readonly string[]
} = {}): ScopePolicy {
  const channels = options.channels ?? [SOURCE_ID, DESTINATION_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(channels),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowMemberVoiceAudit: options.allowAudit ?? true,
    allowMemberVoiceChanges: options.allowChanges ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    memberVoiceChannelIds: new Set(channels),
    memberVoiceGuildIds: new Set([GUILD_ID]),
    mentionUserIds: new Set(),
    protectedUserIds: new Set(options.protectedUsers ?? []),
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
  botMember: DiscordGuildMember
  channels: Map<string, DiscordChannel>
  guildName: string
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  ownerId: string
  readbackError: unknown
  responseOverride: DiscordGuildMemberVoiceUpdate | null
  roles: DiscordRole[]
  targetMember: DiscordGuildMember
  voice: DiscordVoiceStateSummary | null
  voiceMissingError: DiscordApiError
}

function discordError(status: number, code?: number): DiscordApiError {
  return new DiscordApiError({
    ...(code === undefined ? {} : { code }),
    message: "Discord request failed",
    method: "GET",
    route: "/redacted",
    status,
  })
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const everyonePermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.CONNECT
  const botPermissions = DISCORD_PERMISSIONS.MOVE_MEMBERS
    | DISCORD_PERMISSIONS.MUTE_MEMBERS
    | DISCORD_PERMISSIONS.DEAFEN_MEMBERS
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: new Map([
      [SOURCE_ID, channel(SOURCE_ID)],
      [DESTINATION_ID, channel(DESTINATION_ID)],
    ]),
    guildName: "Private Guild Name",
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    ownerId: OWNER_ID,
    readbackError: undefined,
    responseOverride: null,
    roles: [
      role(GUILD_ID, everyonePermissions, 0),
      role(USER_ROLE_ID, 0n, 2),
      role(BOT_ROLE_ID, botPermissions, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ],
    targetMember: {
      roles: [USER_ROLE_ID],
      user: { id: USER_ID, username: "target-user" },
    },
    voice: voice(),
    voiceMissingError: discordError(404, 10065),
    ...options.state,
  }
  const events: string[] = []
  const activities: ActivityEntry[] = []
  let activityCalls = 0
  let mutations = 0
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
  const client: MemberVoiceServiceOptions["client"] = {
    async getChannel(channelId) {
      events.push(`read:channel:${channelId}`)
      const value = state.channels.get(channelId)
      if (!value) throw discordError(404, 10003)
      return value
    },
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: state.guildName, owner_id: state.ownerId }
    },
    async getGuildMember(_guildId, userId) {
      events.push(`read:member:${userId}`)
      return userId === BOT_ID ? state.botMember : state.targetMember
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async getGuildVoiceState() {
      events.push("read:voice")
      if (mutations > 0 && state.readbackError) throw state.readbackError
      if (!state.voice) throw state.voiceMissingError
      return state.voice
    },
    async modifyGuildMemberVoice(_guildId, userId, input) {
      mutations += 1
      events.push(`write:${Object.keys(input)[0]}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      const before = state.voice || voice(SOURCE_ID)
      if ("channelId" in input) {
        state.voice = input.channelId === null
          ? null
          : { ...before, channelId: input.channelId }
      } else if ("mute" in input) {
        state.voice = { ...before, mute: input.mute }
      } else {
        state.voice = { ...before, deaf: input.deaf }
      }
      return state.responseOverride || {
        deaf: state.voice?.deaf ?? false,
        mute: state.voice?.mute ?? false,
        unknownFieldCount: 0,
        userId,
      }
    },
  }
  const service = new MemberVoiceService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(11),
    policy: options.policy || policy(),
    randomId: () => "member-voice-activity-0001",
  })
  return {
    activities,
    activityStore,
    client,
    events,
    get mutations() {
      return mutations
    },
    operationStore,
    service,
    state,
  }
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof MemberVoiceExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("member voice normalization enforces the exact action union", () => {
  const normalized = normalizeMemberVoiceChangeRequest(moveRequest())
  assert.equal(normalized.action, "move")
  assert.equal(normalized.destinationChannelId, DESTINATION_ID)
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)

  assert.throws(
    () => normalizeMemberVoiceChangeRequest({
      ...moveRequest(),
      enabled: true,
    } as MemberVoiceChangeRequest),
    /one destination channel ID/,
  )
  assert.throws(
    () => normalizeMemberVoiceChangeRequest({
      ...moveRequest(),
      action: "disconnect",
    } as MemberVoiceChangeRequest),
    /accepts no action-specific fields/,
  )
  assert.throws(
    () => normalizeMemberVoiceChangeRequest({
      ...moveRequest(),
      action: "set-server-mute",
      destinationChannelId: undefined,
    } as unknown as MemberVoiceChangeRequest),
    /mute or deafen accepts one enabled field/,
  )
})

test("member voice audit returns one minimized exact state without enumeration", async () => {
  const target = fixture({ state: {
    voice: voice(SOURCE_ID, { deaf: true, mute: true, unknownFieldCount: 2 }),
  } })
  const result = await target.service.get(APPLICATION_ID, BOT_ID, GUILD_ID, USER_ID)
  assert.equal(result.status, "ok")
  assert.equal(result.state.channel?.id, SOURCE_ID)
  assert.equal(result.state.serverMuted, true)
  assert.equal(result.state.serverDeafened, true)
  assert.equal(result.permission?.allowed, true)
  assert.equal(
    result.permission?.requiredPermissions.join(","),
    "VIEW_CHANNEL,CONNECT",
  )
  assert.equal(result.privacy.enumeration, "none")
  assert.ok(result.privacy.omittedFields.includes("session ID"))
  assert.equal(Object.hasOwn(result.state, "sessionId"), false)
  assert.equal(Object.hasOwn(result.state, "selfStream"), false)
  assert.equal(Object.hasOwn(result.state, "selfVideo"), false)
})

test("member voice audit does not require write-only target hierarchy evidence", async () => {
  const target = fixture()
  const tiedRoleId = "500000000000000003"
  target.state.roles.push(role(tiedRoleId, 1n << 80n, 2))
  target.state.targetMember.roles.push(tiedRoleId)

  const audit = await target.service.get(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    USER_ID,
  )
  assert.equal(audit.status, "ok")
  assert.equal(audit.state.channel?.id, SOURCE_ID)

  await assert.rejects(
    target.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    /target member permission evidence is incomplete or unknown/,
  )
})

test("member voice plans discard unknown overwrite values and canonicalize order", async () => {
  const target = fixture()
  const privateOverwrite: DiscordPermissionOverwrite & {
    future_private_value: string
  } = {
    allow: "0",
    deny: "0",
    future_private_value: "first",
    id: GUILD_ID,
    type: 0,
  }
  target.state.channels.set(SOURCE_ID, channel(SOURCE_ID, {
    permission_overwrites: [
      { allow: "0", deny: "0", id: USER_ID, type: 1 },
      privateOverwrite,
    ],
  }))
  const first = await target.service.plan(APPLICATION_ID, BOT_ID, moveRequest())
  privateOverwrite.future_private_value = "second"
  const source = target.state.channels.get(SOURCE_ID)
  assert.ok(source?.permission_overwrites)
  source.permission_overwrites.reverse()
  const second = await target.service.plan(APPLICATION_ID, BOT_ID, moveRequest())

  assert.equal(first.digest, second.digest)
  assert.doesNotMatch(JSON.stringify(first), /first|future_private_value/)
  assert.doesNotMatch(JSON.stringify(second), /second|future_private_value/)
})

test("member voice move executes one reviewed PATCH and records content-free outcomes", async () => {
  const target = fixture()
  const request = moveRequest()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.status, "planned")
  assert.equal(plan.state.channel?.id, SOURCE_ID)
  assert.equal(plan.destination?.id, DESTINATION_ID)
  assert.deepEqual(plan.permission?.requiredPermissions, [
    "VIEW_CHANNEL",
    "CONNECT",
    "MOVE_MEMBERS",
  ])
  assert.deepEqual(plan.destinationTargetPermission?.requiredPermissions, [
    "VIEW_CHANNEL",
    "CONNECT",
  ])

  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.observed.channel?.id, DESTINATION_ID)
  assert.equal(target.mutations, 1)
  assert.deepEqual(target.events.slice(-6), [
    "operation:reserve",
    "activity:pending",
    "write:channelId",
    "read:voice",
    "operation:completed",
    "activity:completed",
  ])
  const durable = JSON.stringify({
    activities: target.activities,
    receipt: target.operationStore.lastReceipt,
  })
  assert.doesNotMatch(durable, new RegExp(`${SOURCE_ID}|${DESTINATION_ID}`))
  assert.doesNotMatch(durable, /Private Guild Name|target-user|Reviewed voice support/)
  assert.doesNotMatch(durable, new RegExp(OPERATION_KEY))
  assert.match(durable, new RegExp(USER_ID))
})

test("member voice supports mute, deafen, disconnect, and record-free no-ops", async () => {
  for (const [request, field] of [
    [{
      action: "set-server-mute",
      auditReason: AUDIT_REASON,
      enabled: true,
      guildId: GUILD_ID,
      operationKey: `${OPERATION_KEY}-mute`,
      userId: USER_ID,
    }, "mute"],
    [{
      action: "set-server-deafen",
      auditReason: AUDIT_REASON,
      enabled: true,
      guildId: GUILD_ID,
      operationKey: `${OPERATION_KEY}-deafen`,
      userId: USER_ID,
    }, "deaf"],
    [{
      action: "disconnect",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: `${OPERATION_KEY}-disconnect`,
      userId: USER_ID,
    }, "channelId"],
  ] as const) {
    const target = fixture()
    const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
    const result = await target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    )
    assert.equal(result.status, "completed")
    assert.ok(target.events.includes(`write:${field}`))
  }

  const sameChannel = fixture()
  const sameRequest = moveRequest({ destinationChannelId: SOURCE_ID })
  const samePlan = await sameChannel.service.plan(APPLICATION_ID, BOT_ID, sameRequest)
  const sameResult = await sameChannel.service.execute(
    APPLICATION_ID,
    BOT_ID,
    sameRequest,
    samePlan.digest,
  )
  assert.equal(sameResult.status, "already-current")
  assert.equal(sameChannel.mutations, 0)
  assert.equal(sameChannel.activities.length, 0)
  assert.equal(sameChannel.operationStore.lastReceipt, undefined)

  const disconnected = fixture({ state: { voice: null } })
  const disconnectRequest = {
    action: "disconnect",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: `${OPERATION_KEY}-noop`,
    userId: USER_ID,
  } as const
  const disconnectedPlan = await disconnected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    disconnectRequest,
  )
  assert.equal(disconnectedPlan.status, "already-current")
})

test("member voice treats only error code 10065 as disconnected", async () => {
  const disconnected = fixture({ state: { voice: null } })
  const result = await disconnected.service.get(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    USER_ID,
  )
  assert.equal(result.state.connected, false)
  assert.equal(result.state.serverMuted, null)

  const generic404 = fixture({ state: {
    voice: null,
    voiceMissingError: discordError(404, 10003),
  } })
  await assert.rejects(
    generic404.service.get(APPLICATION_ID, BOT_ID, GUILD_ID, USER_ID),
    (error: unknown) => error instanceof DiscordApiError && error.code === 10003,
  )
})

test("member voice keeps Stage participants read-only and enforces target safety", async () => {
  const stage = fixture({ state: {
    channels: new Map([
      [SOURCE_ID, channel(SOURCE_ID, { type: DISCORD_CHANNEL_TYPES.stageVoice })],
      [DESTINATION_ID, channel(DESTINATION_ID)],
    ]),
  } })
  const audit = await stage.service.get(APPLICATION_ID, BOT_ID, GUILD_ID, USER_ID)
  assert.equal(audit.state.channel?.type, "stage")
  await assert.rejects(
    stage.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    /Stage participants are read-only/,
  )

  const protectedTarget = fixture({ policy: policy({ protectedUsers: [USER_ID] }) })
  await assert.rejects(
    protectedTarget.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    /protected from administration/,
  )

  const administrator = fixture()
  const targetRole = administrator.state.roles.find(({ id }) => id === USER_ROLE_ID)
  assert.ok(targetRole)
  targetRole.permissions = DISCORD_PERMISSIONS.ADMINISTRATOR.toString()
  await assert.rejects(
    administrator.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    /cannot target an administrator/,
  )

  const hierarchy = fixture()
  const lowBotRole = hierarchy.state.roles.find(({ id }) => id === BOT_ROLE_ID)
  assert.ok(lowBotRole)
  lowBotRole.position = 1
  await assert.rejects(
    hierarchy.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    /strictly below/,
  )
})

test("member voice blocks incomplete permissions and exact channel scope escapes", async () => {
  const auditMissingConnect = fixture()
  const everyoneRole = auditMissingConnect.state.roles.find(({ id }) => id === GUILD_ID)
  assert.ok(everyoneRole)
  everyoneRole.permissions = DISCORD_PERMISSIONS.VIEW_CHANNEL.toString()
  await assert.rejects(
    auditMissingConnect.service.get(APPLICATION_ID, BOT_ID, GUILD_ID, USER_ID),
    /lacks complete required channel permissions/,
  )

  const missingPermission = fixture()
  const botRole = missingPermission.state.roles.find(({ id }) => id === BOT_ROLE_ID)
  assert.ok(botRole)
  botRole.permissions = DISCORD_PERMISSIONS.MUTE_MEMBERS.toString()
  await assert.rejects(
    missingPermission.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    /lacks complete required channel permissions/,
  )

  const outOfScope = fixture({ policy: policy({ channels: [SOURCE_ID] }) })
  await assert.rejects(
    outOfScope.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    /outside the configured channel scope/,
  )

  const targetDenied = fixture({ state: {
    channels: new Map([
      [SOURCE_ID, channel(SOURCE_ID)],
      [DESTINATION_ID, channel(DESTINATION_ID, { permission_overwrites: [{
        allow: "0",
        deny: DISCORD_PERMISSIONS.CONNECT.toString(),
        id: USER_ID,
        type: 1,
      }] })],
    ]),
  } })
  await assert.rejects(
    targetDenied.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    /target member destination lacks complete required channel permissions/,
  )
})

test("member voice rejects stale plans and one-shot key reuse", async () => {
  const changed = fixture()
  const plan = await changed.service.plan(APPLICATION_ID, BOT_ID, moveRequest())
  changed.state.voice = voice(SOURCE_ID, { mute: true })
  await assert.rejects(
    changed.service.execute(APPLICATION_ID, BOT_ID, moveRequest(), plan.digest),
    MemberVoicePlanChangedError,
  )
  assert.equal(changed.mutations, 0)

  const reused = fixture()
  const reusedPlan = await reused.service.plan(APPLICATION_ID, BOT_ID, moveRequest())
  await reused.service.execute(APPLICATION_ID, BOT_ID, moveRequest(), reusedPlan.digest)
  await assert.rejects(
    reused.service.plan(APPLICATION_ID, BOT_ID, moveRequest()),
    MemberVoiceOperationConflictError,
  )
})

test("member voice distinguishes known refusals from uncertain outcomes and quarantines", async () => {
  const refused = fixture({ state: { mutationError: discordError(403, 50013) } })
  const refusedPlan = await refused.service.plan(APPLICATION_ID, BOT_ID, moveRequest())
  await assert.rejects(
    refused.service.execute(APPLICATION_ID, BOT_ID, moveRequest(), refusedPlan.digest),
    (error: unknown) => executionResult(error).status === "failed",
  )
  assert.equal(refused.operationStore.lastReceipt?.status, "failed")

  const uncertain = fixture({ state: { mutationError: discordError(429, 0) } })
  const firstRequest = moveRequest({ operationKey: `${OPERATION_KEY}-uncertain` })
  const firstPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  await assert.rejects(
    uncertain.service.execute(APPLICATION_ID, BOT_ID, firstRequest, firstPlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )
  uncertain.state.mutationError = undefined
  const secondRequest = moveRequest({ operationKey: `${OPERATION_KEY}-blocked` })
  await assert.rejects(
    uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      secondRequest,
      firstPlan.digest,
    ),
    (error: unknown) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(uncertain.mutations, 1)
})

test("member voice reports valid uncontrolled changes as drift", async () => {
  const target = fixture({ state: {
    responseOverride: {
      deaf: true,
      mute: false,
      unknownFieldCount: 0,
      userId: USER_ID,
    },
  } })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, moveRequest())
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    moveRequest(),
    plan.digest,
  )
  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")
})

test("member voice makes malformed readback and receipt failure uncertain", async () => {
  const readback = fixture({ state: { readbackError: new Error("network lost") } })
  const readbackPlan = await readback.service.plan(
    APPLICATION_ID,
    BOT_ID,
    moveRequest(),
  )
  await assert.rejects(
    readback.service.execute(APPLICATION_ID, BOT_ID, moveRequest(), readbackPlan.digest),
    (error: unknown) => executionResult(error).status === "uncertain",
  )

  const receipt = fixture()
  const receiptPlan = await receipt.service.plan(
    APPLICATION_ID,
    BOT_ID,
    moveRequest(),
  )
  receipt.operationStore.finishFailure = new Error("disk full")
  await assert.rejects(
    receipt.service.execute(APPLICATION_ID, BOT_ID, moveRequest(), receiptPlan.digest),
    (error: unknown) => executionResult(error).status
      === "completed-operation-record-failed",
  )
})
