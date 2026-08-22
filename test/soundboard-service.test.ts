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
import type {
  DiscordGuildEmojiSummary,
  DiscordSoundboardSoundSummary,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  PolicyError,
  SoundboardEvidenceError,
  SoundboardExecutionError,
  SoundboardOperationConflictError,
  SoundboardPlanChangedError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeSoundboardChangeRequest,
  SoundboardService,
  type SoundboardChangeRequest,
  type SoundboardServiceOptions,
  type UpdateSoundboardSoundRequest,
} from "../src/soundboard-service.js"
import type { DiscordGuildMember, DiscordRole } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OTHER_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const OTHER_USER_ID = "300000000000000002"
const BOT_ROLE_ID = "400000000000000001"
const CUSTOM_EMOJI_ID = "500000000000000001"
const SOUND_ID = "600000000000000001"
const CREATED_SOUND_ID = "600000000000000099"
const AUDIT_REASON = "Reviewed soundboard change"
const OPERATION_KEY = "soundboard-operation-0001"
const NOW = "2026-08-21T12:00:00.000Z"

function mp3Frame(): Buffer {
  const bitrateKbps = 128
  const sampleRate = 44_100
  const frame = Buffer.alloc(Math.floor((144 * bitrateKbps * 1_000) / sampleRate))
  frame[0] = 0xFF
  frame[1] = 0xFB
  frame[2] = 0x90
  return frame
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

function sound(
  overrides: Partial<DiscordSoundboardSoundSummary> = {},
): DiscordSoundboardSoundSummary {
  return {
    available: true,
    creatorUserId: BOT_ID,
    emojiId: null,
    emojiName: "🔔",
    guildId: GUILD_ID,
    id: SOUND_ID,
    name: "Alert",
    unknownFieldCount: 0,
    volume: 0.8,
    ...overrides,
  }
}

function customEmoji(
  overrides: Partial<DiscordGuildEmojiSummary> = {},
): DiscordGuildEmojiSummary {
  return {
    animated: false,
    available: true,
    creatorUserId: BOT_ID,
    id: CUSTOM_EMOJI_ID,
    managed: false,
    name: "bell",
    requiresColons: true,
    roleIds: [],
    ...overrides,
  }
}

function updateRequest(
  overrides: Omit<Partial<UpdateSoundboardSoundRequest>, "name"> & {
    name?: string | undefined
  } = {},
): SoundboardChangeRequest {
  return {
    action: "update",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    name: "Updated Alert",
    operationKey: OPERATION_KEY,
    soundId: SOUND_ID,
    ...overrides,
  } as SoundboardChangeRequest
}

function policy(options: {
  audit?: boolean
  changes?: boolean
  guildIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowSoundboardAudit: options.audit ?? true,
    allowSoundboardChanges: options.changes ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    soundboardGuildIds: new Set(options.guildIds || [GUILD_ID]),
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
  customEmoji: DiscordGuildEmojiSummary
  defaults: DiscordSoundboardSoundSummary[]
  guildId: string
  guildName: string
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  ownerId: string
  preserveDeletion: boolean
  readbackError: unknown
  roles: DiscordRole[]
  sounds: DiscordSoundboardSoundSummary[]
}

function fixture(options: {
  fileRoots?: readonly string[]
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS
    | DISCORD_PERMISSIONS.MANAGE_GUILD_EXPRESSIONS
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    customEmoji: customEmoji(),
    defaults: [sound({
      creatorUserId: null,
      emojiName: "🦆",
      guildId: null,
      id: "1",
      name: "Quack",
      volume: 1,
    })],
    guildId: GUILD_ID,
    guildName: "Private Guild Name",
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    ownerId: OTHER_USER_ID,
    preserveDeletion: false,
    readbackError: undefined,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, permissions, 10),
    ],
    sounds: [sound()],
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
      if (state.activityFailureAt === activityCalls) throw new Error("activity unavailable")
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(events)
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
  const client: SoundboardServiceOptions["client"] = {
    async createGuildSoundboardSound(_guildId, input) {
      await mutate("write:sound:create")
      const created = sound({
        creatorUserId: BOT_ID,
        emojiId: input.emojiId,
        emojiName: input.emojiName,
        id: CREATED_SOUND_ID,
        name: input.name,
        volume: input.volume,
      })
      state.sounds.push(created)
      return created
    },
    async deleteGuildSoundboardSound(_guildId, soundId) {
      await mutate("write:sound:delete")
      if (!state.preserveDeletion) {
        state.sounds = state.sounds.filter((entry) => entry.id !== soundId)
      }
    },
    async getGuild() {
      events.push("read:guild")
      return {
        id: state.guildId,
        name: state.guildName,
        owner_id: state.ownerId,
      }
    },
    async getGuildEmoji(_guildId, emojiId) {
      events.push("read:emoji")
      if (state.customEmoji.id !== emojiId) {
        throw new DiscordApiError({
          message: "missing",
          method: "GET",
          route: "/guilds/200/emojis/500",
          status: 404,
        })
      }
      return state.customEmoji
    },
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async getGuildSoundboardSound(_guildId, soundId) {
      events.push(mutated ? "read:sound:readback" : "read:sound:get")
      readback()
      const found = state.sounds.find((entry) => entry.id === soundId)
      if (!found) {
        throw new DiscordApiError({
          message: "missing",
          method: "GET",
          route: `/guilds/200/soundboard-sounds/${soundId}`,
          status: 404,
        })
      }
      return found
    },
    async listDefaultSoundboardSounds() {
      events.push("read:defaults")
      return state.defaults
    },
    async listGuildSoundboardSounds() {
      events.push("read:sounds")
      return state.sounds
    },
    async modifyGuildSoundboardSound(_guildId, soundId, input) {
      await mutate("write:sound:update")
      const index = state.sounds.findIndex((entry) => entry.id === soundId)
      const current = state.sounds[index]
      if (!current) throw new Error("sound absent")
      const updated = {
        ...current,
        ...(input.emojiId !== undefined ? { emojiId: input.emojiId } : {}),
        ...(input.emojiName !== undefined ? { emojiName: input.emojiName } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.volume !== undefined && input.volume !== null
          ? { volume: input.volume }
          : {}),
      }
      state.sounds[index] = updated
      return updated
    },
  }
  const service = new SoundboardService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    fileRoots: options.fileRoots || [],
    operationStore,
    planKey: Buffer.alloc(32, 8),
    policy: options.policy || policy(),
    randomId: () => "soundboard-activity-0001",
  })
  return { activities, events, operationStore, service, state }
}

test("soundboard requests normalize tagged emoji choices without retaining operation keys", () => {
  const requests: SoundboardChangeRequest[] = [{
    action: "create",
    auditReason: AUDIT_REASON,
    emoji: { emojiName: "🔔", kind: "unicode" },
    filePath: "/safe/alert.mp3",
    guildId: GUILD_ID,
    name: "New Alert",
    operationKey: OPERATION_KEY,
    volume: 0.75,
  }, {
    action: "update",
    auditReason: AUDIT_REASON,
    emoji: { emojiId: CUSTOM_EMOJI_ID, kind: "custom" },
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    soundId: SOUND_ID,
  }, {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    soundId: SOUND_ID,
  }]

  for (const request of requests) {
    const normalized = normalizeSoundboardChangeRequest(request)
    assert.equal("operationKey" in normalized, false)
    assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  }
  assert.throws(
    () => normalizeSoundboardChangeRequest(updateRequest({ name: "Not NFC e\u0301" })),
    /NFC/,
  )
  assert.throws(
    () => normalizeSoundboardChangeRequest(updateRequest({
      emoji: { emojiName: "two 🔔", kind: "unicode" },
      name: undefined,
    })),
    /one Unicode emoji grapheme/,
  )
  assert.throws(
    () => normalizeSoundboardChangeRequest(updateRequest({ name: undefined })),
    /must contain a name, volume, or emoji/,
  )
})

test("soundboard reads expose bounded privacy-safe default and guild inventories", async () => {
  const { service } = fixture()
  const defaults = await service.listDefaults()
  const guild = await service.listGuild(BOT_ID, GUILD_ID)
  const lookup = await service.getGuild(BOT_ID, GUILD_ID, SOUND_ID)

  assert.equal(defaults.sounds[0]?.guildId, null)
  assert.equal(guild.page.returned, 1)
  assert.equal(guild.permission.manageGuildExpressions, true)
  assert.equal(lookup.sound.soundId, SOUND_ID)
  assert.deepEqual(guild.privacy.omittedFields, [
    "audioBytes",
    "cdnUrl",
    "creatorProfile",
    "rawDiscordObject",
  ])
})

test("soundboard policy separates audit, mutation, and exact guild scope", async () => {
  const auditOnly = fixture({ policy: policy({ changes: false }) }).service
  await auditOnly.listDefaults()
  await auditOnly.listGuild(BOT_ID, GUILD_ID)
  await assert.rejects(
    auditOnly.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    PolicyError,
  )

  const disabled = fixture({ policy: policy({ audit: false, changes: false }) }).service
  await assert.rejects(disabled.listDefaults(), PolicyError)
  await assert.rejects(disabled.listGuild(BOT_ID, GUILD_ID), PolicyError)
  await assert.rejects(
    fixture({ policy: policy({ guildIds: [OTHER_GUILD_ID] }) }).service
      .listGuild(BOT_ID, GUILD_ID),
    PolicyError,
  )
})

test("soundboard create binds validated audio and writes only after pending activity", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-soundboard-service-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "alert.mp3")
  await writeFile(filePath, Buffer.concat([mp3Frame(), mp3Frame()]))
  const { activities, events, operationStore, service } = fixture({ fileRoots: [root] })
  const request: SoundboardChangeRequest = {
    action: "create",
    auditReason: AUDIT_REASON,
    emoji: { emojiName: "🚨", kind: "unicode" },
    filePath,
    guildId: GUILD_ID,
    name: "New Alert",
    operationKey: OPERATION_KEY,
    volume: 0.75,
  }

  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.effect, "change")
  assert.equal(plan.desired?.soundId, null)
  assert.equal(plan.file?.review.canonicalPath, filePath)
  assert.equal(plan.file?.review.format, "mp3")
  assert.match(plan.file?.contentDigest || "", /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  const result = await service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)
  assert.equal(result.status, "completed")
  assert.equal(result.soundId, CREATED_SOUND_ID)
  assert.deepEqual(events.slice(-6), [
    "operation:reserve",
    "activity:pending",
    "write:sound:create",
    "read:sound:readback",
    "operation:completed",
    "activity:completed",
  ])
  assert.equal(activities.at(-1)?.status, "completed")
  const receipt = await operationStore.get(
    "guild-soundboard-change",
    plan.operationKeyHash,
  )
  assert.equal(receipt?.resourceId, CREATED_SOUND_ID)
  assert.equal(receipt?.verification, "match")
})

test("soundboard update verifies custom emoji identity and exact ownership", async () => {
  const createOnly = DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS
  const owned = fixture({
    state: {
      roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, createOnly, 10)],
    },
  })
  const request = updateRequest({
    emoji: { emojiId: CUSTOM_EMOJI_ID, kind: "custom" },
    name: undefined,
  })
  const plan = await owned.service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.customEmoji?.emojiId, CUSTOM_EMOJI_ID)
  assert.equal(plan.permission.ownershipRequired, true)
  const result = await owned.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)
  assert.equal(result.status, "completed")
  assert.deepEqual(result.observed?.emoji, {
    emojiId: CUSTOM_EMOJI_ID,
    kind: "custom",
  })

  const foreign = fixture({
    state: {
      roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, createOnly, 10)],
      sounds: [sound({ creatorUserId: OTHER_USER_ID })],
    },
  })
  await assert.rejects(
    foreign.service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    /lacks authority over this sound/,
  )
})

test("soundboard no-op update and already-absent delete reserve nothing", async () => {
  const noOp = fixture()
  const noOpRequest = updateRequest({ name: "Alert" })
  const noOpPlan = await noOp.service.plan(APPLICATION_ID, BOT_ID, noOpRequest)
  const noOpResult = await noOp.service.execute(
    APPLICATION_ID,
    BOT_ID,
    noOpRequest,
    noOpPlan.digest,
  )
  assert.equal(noOpPlan.effect, "none")
  assert.equal(noOpResult.status, "already-current")
  assert.equal(noOp.events.some((event) => event.startsWith("write:")), false)
  assert.equal(noOp.events.includes("operation:reserve"), false)

  const absent = fixture({ state: { sounds: [] } })
  const deleteRequest: SoundboardChangeRequest = {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    soundId: SOUND_ID,
  }
  const deletePlan = await absent.service.plan(APPLICATION_ID, BOT_ID, deleteRequest)
  const deleteResult = await absent.service.execute(
    APPLICATION_ID,
    BOT_ID,
    deleteRequest,
    deletePlan.digest,
  )
  assert.equal(deletePlan.effect, "none")
  assert.equal(deleteResult.status, "already-current")
  assert.equal(deleteResult.observed, null)
  assert.equal(absent.events.includes("operation:reserve"), false)
})

test("soundboard delete requires exact 404 absence and reports surviving drift", async () => {
  const removed = fixture()
  const request: SoundboardChangeRequest = {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    soundId: SOUND_ID,
  }
  const plan = await removed.service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await removed.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)
  assert.equal(result.status, "completed")
  assert.equal(result.observed, null)
  assert.equal(removed.events.includes("read:sound:readback"), true)

  const drifted = fixture({ state: { preserveDeletion: true } })
  const driftPlan = await drifted.service.plan(APPLICATION_ID, BOT_ID, request)
  const drift = await drifted.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    driftPlan.digest,
  )
  assert.equal(drift.status, "completed-with-drift")
  assert.equal(drift.observed?.soundId, SOUND_ID)
  assert.equal(drifted.activities.at(-1)?.status, "completed-with-drift")
})

test("soundboard planning blocks unknown fields, name conflicts, and missing permissions", async () => {
  await assert.rejects(
    fixture({ state: { sounds: [sound({ unknownFieldCount: 1 })] } }).service
      .plan(APPLICATION_ID, BOT_ID, updateRequest()),
    /unknown soundboard fields/,
  )
  await assert.rejects(
    fixture({
      state: {
        sounds: [sound(), sound({ id: CREATED_SOUND_ID, name: "UPDATED ALERT" })],
      },
    }).service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    /conflicts with an existing normalized name/,
  )
  await assert.rejects(
    fixture({
      state: { roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)] },
    }).service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    /lacks authority over this sound/,
  )
})

test("soundboard execution rejects stale plans and reserved operation keys", async () => {
  const stale = fixture()
  const request = updateRequest()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, request)
  stale.state.sounds[0] = sound({ name: "Changed" })
  await assert.rejects(
    stale.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    SoundboardPlanChangedError,
  )
  assert.equal(stale.events.some((event) => event.startsWith("write:")), false)

  const conflict = fixture()
  const conflictPlan = await conflict.service.plan(APPLICATION_ID, BOT_ID, request)
  await conflict.operationStore.reserve({
    activityId: "existing-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "guild-soundboard-change",
    operationKeyHash: conflictPlan.operationKeyHash,
    planDigest: conflictPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    conflict.service.execute(APPLICATION_ID, BOT_ID, request, conflictPlan.digest),
    SoundboardOperationConflictError,
  )
})

test("soundboard creation detects changed local audio before reservation", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-soundboard-replan-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "planned.mp3")
  await writeFile(filePath, mp3Frame())
  const { events, service } = fixture({ fileRoots: [root] })
  const request: SoundboardChangeRequest = {
    action: "create",
    auditReason: AUDIT_REASON,
    emoji: { kind: "none" },
    filePath,
    guildId: GUILD_ID,
    name: "Planned Sound",
    operationKey: OPERATION_KEY,
    volume: 1,
  }
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  await writeFile(filePath, "not audio")

  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    SoundboardPlanChangedError,
  )
  assert.equal(events.includes("operation:reserve"), false)
  assert.equal(events.some((event) => event.startsWith("write:")), false)
})

test("soundboard execution classifies deterministic rejection and uncertain readback", async () => {
  const deterministic = fixture({
    state: {
      mutationError: new DiscordApiError({
        code: 50013,
        message: "missing permissions",
        method: "PATCH",
        route: "/guilds/200/soundboard-sounds/600",
        status: 403,
      }),
    },
  })
  const request = updateRequest()
  const plan = await deterministic.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    deterministic.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof SoundboardExecutionError
      && (error.result as { status: string }).status === "failed"
    ),
  )

  const uncertain = fixture({ state: { readbackError: new Error("readback unavailable") } })
  const uncertainPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    uncertain.service.execute(APPLICATION_ID, BOT_ID, request, uncertainPlan.digest),
    (error: unknown) => (
      error instanceof SoundboardExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  const receipt = await uncertain.operationStore.get(
    "guild-soundboard-change",
    uncertainPlan.operationKeyHash,
  )
  assert.equal(receipt?.status, "uncertain")
  assert.equal(uncertain.activities.at(-1)?.status, "uncertain")
})

test("soundboard execution blocks mutation when pending activity cannot be recorded", async () => {
  const blocked = fixture({ state: { activityFailureAt: 1 } })
  const request = updateRequest()
  const plan = await blocked.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    blocked.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof SoundboardExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(blocked.events.some((event) => event.startsWith("write:")), false)
})

test("soundboard execution preserves uncertainty when receipt finalization fails", async () => {
  const completed = fixture()
  const request = updateRequest()
  const plan = await completed.service.plan(APPLICATION_ID, BOT_ID, request)
  completed.operationStore.finishFailure = new Error("operation store unavailable")

  await assert.rejects(
    completed.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof SoundboardExecutionError
      && (error.result as { status: string }).status === "completed-operation-record-failed"
    ),
  )
  assert.equal(completed.activities.at(-1)?.status, "uncertain")
  assert.equal(completed.events.filter((event) => event.startsWith("write:")).length, 1)
})

test("soundboard execution blocks queued and later same-guild work after uncertainty", async () => {
  let releaseMutation: () => void = () => undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let reportMutationStarted: () => void = () => undefined
  const mutationStarted = new Promise<void>((resolve) => {
    reportMutationStarted = resolve
  })
  const queued = fixture({
    state: {
      mutationGate,
      mutationStarted: reportMutationStarted,
      readbackError: new Error("readback unavailable"),
    },
  })
  const firstRequest = updateRequest()
  const secondRequest = updateRequest({
    name: "Second Alert",
    operationKey: "soundboard-operation-0002",
  })
  const firstPlan = await queued.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  const secondPlan = await queued.service.plan(APPLICATION_ID, BOT_ID, secondRequest)

  const firstExecution = queued.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await mutationStarted
  const secondExecution = queued.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation()

  await assert.rejects(
    firstExecution,
    (error: unknown) => (
      error instanceof SoundboardExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  await assert.rejects(
    secondExecution,
    (error: unknown) => (
      error instanceof SoundboardExecutionError
      && (error.result as { status: string }).status === "blocked-prior-uncertain"
    ),
  )
  await assert.rejects(
    queued.service.execute(
      APPLICATION_ID,
      BOT_ID,
      updateRequest({
        name: "Third Alert",
        operationKey: "soundboard-operation-0003",
      }),
      secondPlan.digest,
    ),
    (error: unknown) => (
      error instanceof SoundboardExecutionError
      && (error.result as { status: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(queued.events.filter((event) => event.startsWith("write:")).length, 1)
})

test("soundboard exact reads reject mismatched and malformed evidence", async () => {
  await assert.rejects(
    fixture({ state: { guildId: OTHER_GUILD_ID } }).service
      .listGuild(BOT_ID, GUILD_ID),
    SoundboardEvidenceError,
  )
  await assert.rejects(
    fixture({ state: { sounds: [sound({ creatorUserId: "invalid" })] } }).service
      .listGuild(BOT_ID, GUILD_ID),
    SoundboardEvidenceError,
  )
})
