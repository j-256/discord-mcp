import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type {
  DiscordChannelMetadata,
  DiscordSoundboardSoundSummary,
  DiscordVoiceStateSummary,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  SoundboardPlaybackEvidenceError,
  SoundboardPlaybackExecutionError,
  SoundboardPlaybackOperationConflictError,
} from "../src/errors.js"
import type {
  GatewaySoundboardEffectEvidence,
  GatewaySoundboardEffectSource,
} from "../src/gateway-soundboard-effect.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeSoundboardPlaybackRequest,
  SoundboardPlaybackService,
  soundboardPlaybackIntentKey,
  type SoundboardPlaybackRequest,
  type SoundboardPlaybackServiceOptions,
} from "../src/soundboard-playback-service.js"
import type {
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const SOURCE_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const CHANNEL_ID = "500000000000000001"
const OTHER_CHANNEL_ID = "500000000000000002"
const DEFAULT_SOUND_ID = "1"
const CUSTOM_SOUND_ID = "600000000000000001"
const OPERATION_KEY = "soundboard-playback-0001"
const NOW = "2026-08-28T12:00:00.000Z"

const PLAYBACK_PERMISSIONS = DISCORD_PERMISSIONS.VIEW_CHANNEL
  | DISCORD_PERMISSIONS.CONNECT
  | DISCORD_PERMISSIONS.SPEAK
  | DISCORD_PERMISSIONS.USE_SOUNDBOARD
  | DISCORD_PERMISSIONS.USE_EXTERNAL_SOUNDS

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: id === BOT_ROLE_ID,
    name: id === GUILD_ID ? "@everyone" : "Private bot role",
    permissions: permissions.toString(),
    position,
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

function voice(
  overrides: Partial<DiscordVoiceStateSummary> = {},
): DiscordVoiceStateSummary {
  return {
    channelId: CHANNEL_ID,
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

function sound(
  sourceGuildId: string | null,
  soundId: string,
  overrides: Partial<DiscordSoundboardSoundSummary> = {},
): DiscordSoundboardSoundSummary {
  return {
    available: true,
    creatorUserId: sourceGuildId === null ? null : BOT_ID,
    emojiId: null,
    emojiName: "🔔",
    guildId: sourceGuildId,
    id: soundId,
    name: sourceGuildId === null ? "Default chime" : "Custom chime",
    unknownFieldCount: 0,
    volume: 0.8,
    ...overrides,
  }
}

function request(
  overrides: Partial<SoundboardPlaybackRequest> = {},
): SoundboardPlaybackRequest {
  return {
    channelId: CHANNEL_ID,
    operationKey: OPERATION_KEY,
    soundId: DEFAULT_SOUND_ID,
    sourceGuildId: null,
    ...overrides,
  }
}

function playbackPolicy(options: {
  channelIds?: readonly string[]
  sourceGuildIds?: readonly string[]
} = {}): ScopePolicy {
  const channelIds = options.channelIds ?? [CHANNEL_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(channelIds),
    allowedGuildIds: new Set([GUILD_ID, SOURCE_GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowSoundboardPlayback: true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    soundboardPlaybackChannelIds: new Set(channelIds),
    soundboardPlaybackSourceGuildIds: new Set(
      options.sourceGuildIds ?? [GUILD_ID, SOURCE_GUILD_ID],
    ),
  })
}

class MemoryOperationStore implements OperationStore {
  readonly events: string[]
  finishError: unknown = null
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`receipt:${receipt.status}`)
    if (this.finishError) throw this.finishError
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  async get(kind: OperationReceipt["kind"], hash: string) {
    return this.receipts.get(`${kind}:${hash}`)
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("receipt:pending")
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

class MemoryActivityStore implements ActivityStore {
  readonly entries: ActivityEntry[] = []
  readonly events: string[]
  failAt: number | null = null

  constructor(events: string[]) {
    this.events = events
  }

  async append(entry: ActivityEntry): Promise<void> {
    this.events.push(`activity:${entry.status}`)
    if (this.failAt === this.entries.length) throw new Error("Activity unavailable")
    this.entries.push(entry)
  }

  async list() {
    return { entries: [...this.entries], file: "memory", skippedLines: 0 }
  }
}

class PlaybackGateway implements GatewaySoundboardEffectSource {
  soundboardPlaybackEventsEnabled = true
  waiter: {
    channelId: string
    guildId: string
    resolve: (value: GatewaySoundboardEffectEvidence) => void
    soundId: string
    userId: string
  } | null = null

  waitForSoundboardPlaybackEvent(
    guildId: string,
    channelId: string,
    userId: string,
    soundId: string,
  ): Promise<GatewaySoundboardEffectEvidence> {
    return new Promise((resolve) => {
      this.waiter = { channelId, guildId, resolve, soundId, userId }
    })
  }

  corroborate(): void {
    const waiter = this.waiter
    if (!waiter) throw new Error("No pending Gateway waiter")
    waiter.resolve({
      channelId: waiter.channelId,
      freshness: {
        gatewaySequence: 42,
        observedAt: NOW,
        source: "gateway-voice-channel-effect-send",
      },
      guildId: waiter.guildId,
      privacy: {
        nonTargetEvents: "discarded",
        persistence: "none",
        rawPayloads: "omitted",
      },
      schemaVersion: 1,
      soundId: waiter.soundId,
      unknownFieldCount: 0,
      userId: waiter.userId,
    })
  }
}

interface Fixture {
  activity: MemoryActivityStore
  calls: string[]
  client: SoundboardPlaybackServiceOptions["client"]
  events: string[]
  gateway: PlaybackGateway
  operation: MemoryOperationStore
  roles: DiscordRole[]
  service: SoundboardPlaybackService
  state: {
    metadata: DiscordChannelMetadata
    sendError: unknown
    voice: DiscordVoiceStateSummary
  }
}

function fixture(options: {
  gatewayEnabled?: boolean
  permissions?: bigint
  policy?: ScopePolicy
} = {}): Fixture {
  const events: string[] = []
  const calls: string[] = []
  const activity = new MemoryActivityStore(events)
  const operation = new MemoryOperationStore(events)
  const gateway = new PlaybackGateway()
  gateway.soundboardPlaybackEventsEnabled = options.gatewayEnabled ?? true
  const roles = [
    role(GUILD_ID, 0n, 0),
    role(BOT_ROLE_ID, options.permissions ?? PLAYBACK_PERMISSIONS, 1),
  ]
  const state = {
    metadata: metadata(),
    sendError: null as unknown,
    voice: voice(),
  }
  const member: DiscordGuildMember = {
    roles: [BOT_ROLE_ID],
    user: { bot: true, id: BOT_ID, username: "Private bot" },
  }
  const client: SoundboardPlaybackServiceOptions["client"] = {
    async getCurrentUserVoiceState() {
      calls.push("voice")
      return state.voice
    },
    async getGuildChannelMetadata() {
      calls.push("channel")
      return state.metadata
    },
    async getGuildMember() {
      calls.push("member")
      return member
    },
    async getGuildRoles() {
      calls.push("roles")
      return roles
    },
    async getGuildSoundboardSound(sourceGuildId, soundId) {
      calls.push("custom-sound")
      return sound(sourceGuildId, soundId)
    },
    async listDefaultSoundboardSounds() {
      calls.push("default-sounds")
      return [sound(null, DEFAULT_SOUND_ID)]
    },
    async sendSoundboardSound(channelId, soundId, sourceGuildId) {
      events.push("discord:send")
      calls.push(`send:${channelId}:${soundId}:${sourceGuildId ?? "default"}`)
      if (state.sendError) throw state.sendError
      if (gateway.soundboardPlaybackEventsEnabled) gateway.corroborate()
    },
  }
  const service = new SoundboardPlaybackService({
    activityStore: activity,
    client,
    clock: () => new Date(NOW),
    gateway,
    intentKey: soundboardPlaybackIntentKey("private-test-token"),
    limiter: new InteractionLimiter({
      clock: () => Date.parse(NOW),
      maxWritesPerMinute: 10,
      minWriteIntervalMs: 0,
    }),
    operationStore: operation,
    policy: options.policy ?? playbackPolicy(),
    randomId: () => "soundboard-playback-activity-1",
  })
  return { activity, calls, client, events, gateway, operation, roles, service, state }
}

test("soundboard playback normalization is strict and request-bound", () => {
  const normalized = normalizeSoundboardPlaybackRequest(request())
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  assert.throws(
    () => normalizeSoundboardPlaybackRequest({
      ...request(),
      extra: true,
    } as SoundboardPlaybackRequest),
    /documented fields/,
  )
  assert.throws(
    () => normalizeSoundboardPlaybackRequest(request({ sourceGuildId: "invalid" })),
    /source guild ID/,
  )
})

test("readiness proves exact default and external custom sound access", async () => {
  const first = fixture()
  const ready = await first.service.check(
    APPLICATION_ID,
    BOT_ID,
    {
      channelId: CHANNEL_ID,
      soundId: DEFAULT_SOUND_ID,
      sourceGuildId: null,
    },
  )
  assert.equal(ready.status, "ready")
  assert.deepEqual(ready.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "CONNECT",
    "SPEAK",
    "USE_SOUNDBOARD",
  ])
  assert.equal(ready.sound.name, "Default chime")
  assert.doesNotMatch(JSON.stringify(ready.channel), /Private voice/u)

  const second = fixture()
  const external = await second.service.check(
    APPLICATION_ID,
    BOT_ID,
    {
      channelId: CHANNEL_ID,
      soundId: CUSTOM_SOUND_ID,
      sourceGuildId: SOURCE_GUILD_ID,
    },
  )
  assert.equal(
    external.permission.requiredPermissionNames.at(-1),
    "USE_EXTERNAL_SOUNDS",
  )
  assert.ok(second.calls.includes("custom-sound"))
})

test("readiness fails closed before playback on scope, voice, sound, and permission gaps", async () => {
  const outside = fixture()
  await assert.rejects(
    () => outside.service.check(APPLICATION_ID, BOT_ID, {
      channelId: OTHER_CHANNEL_ID,
      soundId: DEFAULT_SOUND_ID,
      sourceGuildId: null,
    }),
    /outside the soundboard playback scope/,
  )
  assert.equal(outside.calls.length, 0)

  const muted = fixture()
  muted.state.voice = voice({ mute: true })
  await assert.rejects(
    () => muted.service.check(APPLICATION_ID, BOT_ID, {
      channelId: CHANNEL_ID,
      soundId: DEFAULT_SOUND_ID,
      sourceGuildId: null,
    }),
    SoundboardPlaybackEvidenceError,
  )

  const missingPermission = fixture({
    permissions: PLAYBACK_PERMISSIONS & ~DISCORD_PERMISSIONS.SPEAK,
  })
  await assert.rejects(
    () => missingPermission.service.check(APPLICATION_ID, BOT_ID, {
      channelId: CHANNEL_ID,
      soundId: DEFAULT_SOUND_ID,
      sourceGuildId: null,
    }),
    /SPEAK/,
  )

  const unavailable = fixture()
  unavailable.client.listDefaultSoundboardSounds = async () => [
    sound(null, DEFAULT_SOUND_ID, { available: false }),
  ]
  await assert.rejects(
    () => unavailable.service.check(APPLICATION_ID, BOT_ID, {
      channelId: CHANNEL_ID,
      soundId: DEFAULT_SOUND_ID,
      sourceGuildId: null,
    }),
    /exact available sound/,
  )
})

test("playback journals before one non-retried write and accepts exact Gateway corroboration", async () => {
  const current = fixture()
  const result = await current.service.play(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  assert.equal(result.status, "completed")
  assert.equal(result.verification, "gateway-match")
  assert.equal(result.localReplay, false)
  assert.equal(result.gatewayEvidence?.freshness.gatewaySequence, 42)
  assert.deepEqual(current.events, [
    "receipt:pending",
    "activity:pending",
    "discord:send",
    "receipt:completed",
    "activity:completed",
  ])
  assert.deepEqual(
    current.activity.entries.map((entry) => entry.kind),
    ["soundboard-playback", "soundboard-playback"],
  )
  assert.doesNotMatch(JSON.stringify(current.activity.entries), /Default chime|Private/u)
})

test("strict REST success completes without Gateway and exact replay performs no Discord reads", async () => {
  const current = fixture({ gatewayEnabled: false })
  const first = await current.service.play(APPLICATION_ID, BOT_ID, request())
  assert.equal(first.verification, "response-only")
  const callCount = current.calls.length
  const second = await current.service.play(APPLICATION_ID, BOT_ID, request())
  assert.equal(second.verification, "verified-local-replay")
  assert.equal(second.localReplay, true)
  assert.equal(current.calls.length, callCount)

  await assert.rejects(
    () => current.service.play(
      APPLICATION_ID,
      BOT_ID,
      request({ soundId: "2" }),
    ),
    SoundboardPlaybackOperationConflictError,
  )
})

test("deterministic rejection fails while ambiguous playback quarantines the operation", async () => {
  for (const [status, expected] of [
    [403, "failed"],
    [429, "uncertain"],
    [500, "uncertain"],
  ] as const) {
    const current = fixture({ gatewayEnabled: false })
    current.state.sendError = new DiscordApiError({
      message: "Private Discord failure",
      method: "POST",
      route: "/channels/{channel.id}/send-soundboard-sound",
      status,
    })
    await assert.rejects(
      () => current.service.play(APPLICATION_ID, BOT_ID, request()),
      (error: unknown) => {
        assert.ok(error instanceof SoundboardPlaybackExecutionError)
        assert.equal((error.result as { status: string }).status, expected)
        return true
      },
    )
    assert.equal(current.activity.entries.at(-1)?.status, expected)
    assert.equal([...current.operation.receipts.values()][0]?.status, expected)
    await assert.rejects(
      () => current.service.play(APPLICATION_ID, BOT_ID, request()),
      SoundboardPlaybackOperationConflictError,
    )
  }
})

test("pending activity failure blocks playback and burns the reserved one-shot key", async () => {
  const current = fixture()
  current.activity.failAt = 0
  await assert.rejects(
    () => current.service.play(APPLICATION_ID, BOT_ID, request()),
    /pending activity could not be recorded/,
  )
  assert.ok(!current.events.includes("discord:send"))
  assert.equal([...current.operation.receipts.values()][0]?.status, "failed")
})

test("completed playback reports terminal receipt and activity record failures exactly", async () => {
  const receiptFailure = fixture({ gatewayEnabled: false })
  receiptFailure.operation.finishError = new Error("Receipt unavailable")
  await assert.rejects(
    () => receiptFailure.service.play(APPLICATION_ID, BOT_ID, request()),
    (error: unknown) => {
      assert.ok(error instanceof SoundboardPlaybackExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-operation-record-failed",
      )
      return true
    },
  )
  assert.equal(receiptFailure.activity.entries.at(-1)?.status, "completed")
  assert.equal([...receiptFailure.operation.receipts.values()][0]?.status, "pending")

  const activityFailure = fixture({ gatewayEnabled: false })
  activityFailure.activity.failAt = 1
  await assert.rejects(
    () => activityFailure.service.play(APPLICATION_ID, BOT_ID, request()),
    (error: unknown) => {
      assert.ok(error instanceof SoundboardPlaybackExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-audit-failed",
      )
      return true
    },
  )
  assert.equal([...activityFailure.operation.receipts.values()][0]?.status, "completed")
  assert.equal(activityFailure.activity.entries.at(-1)?.status, "pending")
})
