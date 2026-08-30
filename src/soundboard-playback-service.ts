import {
  createHmac,
  randomUUID,
} from "node:crypto"

import type {
  ActivityStore,
  SoundboardPlaybackActivity,
  SoundboardPlaybackActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordChannelMetadata,
  DiscordClient,
  DiscordSoundboardSoundSummary,
  DiscordVoiceStateSummary,
} from "./discord-client.js"
import {
  DiscordApiError,
  SoundboardPlaybackEvidenceError,
  SoundboardPlaybackExecutionError,
  SoundboardPlaybackOperationConflictError,
} from "./errors.js"
import {
  DisabledGatewaySoundboardEffectSource,
  type GatewaySoundboardEffectEvidence,
  type GatewaySoundboardEffectSource,
} from "./gateway-soundboard-effect.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  DISCORD_PERMISSIONS,
  evaluateBotChannelPermissions,
  type BotChannelPermissionResult,
  type DiscordPermissionName,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import { reviewedPlanDigest } from "./reviewed-plan.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const CHECK_REQUEST_KEYS = [
  "channelId",
  "soundId",
  "sourceGuildId",
] as const
const PLAY_REQUEST_KEYS = [
  ...CHECK_REQUEST_KEYS,
  "operationKey",
] as const
const REQUIRED_PERMISSIONS = [
  "VIEW_CHANNEL",
  "CONNECT",
  "SPEAK",
  "USE_SOUNDBOARD",
] as const satisfies readonly DiscordPermissionName[]

export interface SoundboardPlaybackCheckRequest {
  channelId: string
  soundId: string
  sourceGuildId: string | null
}

export interface SoundboardPlaybackRequest extends SoundboardPlaybackCheckRequest {
  operationKey: string
}

export interface NormalizedSoundboardPlaybackRequest extends SoundboardPlaybackRequest {
  operationKeyHash: string
}

export interface SoundboardPlaybackPermissionEvidence {
  administrator: boolean
  appliedRoleIds: string[]
  confidence: "complete"
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  permissionSourceChannelId: string
  requiredPermissionNames: DiscordPermissionName[]
}

export interface SoundboardPlaybackReadiness {
  applicationId: string
  botId: string
  channel: {
    guildId: string
    id: string
    type: typeof DISCORD_CHANNEL_TYPES.voice
  }
  checkedAt: string
  permission: SoundboardPlaybackPermissionEvidence
  privacy: {
    activityRecords: "content-free"
    channelNames: "omitted"
    rawPayloads: "omitted"
    soundNames: "transient"
    voiceProfiles: "omitted"
  }
  schemaVersion: number
  sound: {
    available: true
    id: string
    name: string
    sourceGuildId: string | null
    unknownFieldCount: number
  }
  status: "ready"
  voice: {
    channelId: string
    deaf: false
    guildId: string
    mute: false
    selfDeaf: false
    selfMute: boolean
    suppressed: false
    unknownFieldCount: number
    userId: string
  }
}

export interface SoundboardPlaybackResult {
  activityId: string
  channelId: string
  gatewayEvidence: GatewaySoundboardEffectEvidence | null
  guildId: string
  localReplay: boolean
  operationKeyHash: string
  requestDigest: string
  schemaVersion: number
  soundId: string
  sourceGuildId: string | null
  status: "completed"
  verification: "gateway-match" | "response-only" | "verified-local-replay"
}

export interface SoundboardPlaybackServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "getCurrentUserVoiceState"
    | "getGuildChannelMetadata"
    | "getGuildMember"
    | "getGuildRoles"
    | "getGuildSoundboardSound"
    | "listDefaultSoundboardSounds"
    | "sendSoundboardSound"
  >
  clock?: () => Date
  gateway?: GatewaySoundboardEffectSource
  intentKey: Uint8Array
  limiter: InteractionLimiter
  operationStore: OperationStore
  policy: Pick<
    ScopePolicy,
    | "assertSoundboardPlaybackChannel"
    | "assertSoundboardPlaybackChannelIdAllowed"
    | "assertSoundboardPlaybackSourceGuildAllowed"
  >
  randomId?: () => string
}

interface PlaybackState {
  channel: DiscordChannel
  guildId: string
  permission: SoundboardPlaybackPermissionEvidence
  sound: DiscordSoundboardSoundSummary
  voice: DiscordVoiceStateSummary
}

function validSnowflake(value: unknown): value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) return false
  try {
    const parsed = BigInt(value)
    return parsed > 0n && parsed <= DISCORD_SNOWFLAKE_MAX
  } catch {
    return false
  }
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (!validSnowflake(value)) {
    throw new RangeError(`${description} must be an exact positive Discord snowflake`)
  }
}

function assertExactKeys(
  value: unknown,
  keys: readonly string[],
  description: string,
): asserts value is Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    throw new RangeError(`${description} must contain only its documented fields`)
  }
}

export function normalizeSoundboardPlaybackCheckRequest(
  request: SoundboardPlaybackCheckRequest,
): SoundboardPlaybackCheckRequest {
  assertExactKeys(request, CHECK_REQUEST_KEYS, "Discord soundboard playback check")
  assertSnowflake(request.channelId, "Discord soundboard playback channel ID")
  assertSnowflake(request.soundId, "Discord soundboard playback sound ID")
  if (request.sourceGuildId !== null) {
    assertSnowflake(request.sourceGuildId, "Discord soundboard playback source guild ID")
  }
  return {
    channelId: request.channelId,
    soundId: request.soundId,
    sourceGuildId: request.sourceGuildId,
  }
}

export function normalizeSoundboardPlaybackRequest(
  request: SoundboardPlaybackRequest,
): NormalizedSoundboardPlaybackRequest {
  assertExactKeys(request, PLAY_REQUEST_KEYS, "Discord soundboard playback request")
  const check = normalizeSoundboardPlaybackCheckRequest({
    channelId: request.channelId,
    soundId: request.soundId,
    sourceGuildId: request.sourceGuildId,
  })
  return {
    ...check,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

export function soundboardPlaybackIntentKey(token: string): Uint8Array {
  if (typeof token !== "string" || !token.trim()) {
    throw new RangeError("Discord soundboard playback intent requires a non-empty secret")
  }
  return createHmac("sha256", token)
    .update("guildcontrol-soundboard-playback-intent-key.v1\0")
    .digest()
}

export function soundboardPlaybackRequestDigest(
  key: Uint8Array,
  applicationId: string,
  botId: string,
  request: NormalizedSoundboardPlaybackRequest,
): string {
  assertSnowflake(applicationId, "Discord connector application ID")
  assertSnowflake(botId, "Discord connector bot ID")
  return reviewedPlanDigest(key, {
    applicationId,
    botId,
    domain: "guildcontrol-soundboard-playback-request.v1",
    request: {
      channelId: request.channelId,
      operationKeyHash: request.operationKeyHash,
      soundId: request.soundId,
      sourceGuildId: request.sourceGuildId,
    },
  })
}

function channelFromMetadata(metadata: DiscordChannelMetadata): DiscordChannel {
  if (
    !metadata
    || typeof metadata !== "object"
    || Array.isArray(metadata)
    || !validSnowflake(metadata.id)
    || !validSnowflake(metadata.guildId)
    || metadata.type !== DISCORD_CHANNEL_TYPES.voice
    || !Array.isArray(metadata.permissionOverwrites)
    || !Number.isSafeInteger(metadata.unknownFieldCount)
    || metadata.unknownFieldCount < 0
  ) {
    throw new SoundboardPlaybackEvidenceError(
      "Discord returned invalid soundboard playback channel evidence",
    )
  }
  return {
    guild_id: metadata.guildId,
    id: metadata.id,
    parent_id: metadata.parentId,
    permission_overwrites: metadata.permissionOverwrites,
    type: metadata.type,
  }
}

function exactMember(value: DiscordGuildMember, botId: string): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.user?.id !== botId
    || value.user.bot !== true
    || !Array.isArray(value.roles)
    || value.roles.some((roleId) => !validSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw new SoundboardPlaybackEvidenceError(
      "Discord returned invalid connector membership for soundboard playback",
    )
  }
  return value
}

function exactRoles(
  value: DiscordRole[],
  guildId: string,
  member: DiscordGuildMember,
): DiscordRole[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > DISCORD_LIMITS.guildRoles
    || !value.some((role) => role?.id === guildId)
    || value.some((role) => (
      !role
      || typeof role !== "object"
      || !validSnowflake(role.id)
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(role.permissions)
      || !Number.isSafeInteger(role.position)
    ))
    || new Set(value.map((role) => role.id)).size !== value.length
  ) {
    throw new SoundboardPlaybackEvidenceError(
      "Discord returned invalid bounded role evidence for soundboard playback",
    )
  }
  const roleIds = new Set(value.map((role) => role.id))
  if (member.roles.some((roleId) => !roleIds.has(roleId))) {
    throw new SoundboardPlaybackEvidenceError(
      "Discord soundboard playback member evidence references an absent role",
    )
  }
  return value
}

function permissionEvidence(
  result: BotChannelPermissionResult,
  external: boolean,
): SoundboardPlaybackPermissionEvidence {
  const requiredPermissionNames: DiscordPermissionName[] = [
    ...REQUIRED_PERMISSIONS,
    ...(external ? ["USE_EXTERNAL_SOUNDS" as const] : []),
  ]
  const effective = BigInt(result.effectivePermissions)
  const missing = requiredPermissionNames.filter((name) => (
    (effective & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
  ))
  if (result.confidence !== "complete" || missing.length > 0) {
    throw new SoundboardPlaybackEvidenceError(
      `Discord connector soundboard playback permission evidence is incomplete or missing: ${missing.join(", ") || "unknown evidence"}`,
    )
  }
  return {
    administrator: result.administrator,
    appliedRoleIds: [...result.appliedRoleIds],
    confidence: "complete",
    effectivePermissionNames: [...result.effectivePermissionNames],
    effectivePermissions: result.effectivePermissions,
    permissionSourceChannelId: result.permissionSourceChannelId,
    requiredPermissionNames,
  }
}

function exactVoice(
  value: DiscordVoiceStateSummary,
  guildId: string,
  channelId: string,
  botId: string,
): DiscordVoiceStateSummary & {
  channelId: string
  deaf: false
  guildId: string
  mute: false
  selfDeaf: false
  suppressed: false
} {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.guildId !== guildId
    || value.channelId !== channelId
    || value.userId !== botId
    || typeof value.selfMute !== "boolean"
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
    || value.deaf !== false
    || value.selfDeaf !== false
    || value.mute !== false
    || value.suppressed !== false
  ) {
    throw new SoundboardPlaybackEvidenceError(
      "Discord connector bot must be connected to the exact target voice channel without mute, deaf, or suppression",
    )
  }
  return value as DiscordVoiceStateSummary & {
    channelId: string
    deaf: false
    guildId: string
    mute: false
    selfDeaf: false
    suppressed: false
  }
}

function exactSound(
  value: DiscordSoundboardSoundSummary,
  soundId: string,
  sourceGuildId: string | null,
): DiscordSoundboardSoundSummary & { available: true } {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== soundId
    || value.guildId !== sourceGuildId
    || value.available !== true
    || typeof value.name !== "string"
    || value.name.length < 1
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
  ) {
    throw new SoundboardPlaybackEvidenceError(
      "Discord soundboard playback requires an exact available sound",
    )
  }
  return value as DiscordSoundboardSoundSummary & { available: true }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  return name.replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, 128) || "UnknownError"
}

function deterministicFailure(error: unknown): boolean {
  return error instanceof DiscordApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    requestDigest: receipt.planDigest,
    resourceId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  operationKeyHash: string
  requestDigest: string
  resourceId?: string | null
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "soundboard-playback",
    operationKeyHash: options.operationKeyHash,
    planDigest: options.requestDigest,
    resourceId: options.resourceId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function activityEntry(options: {
  activityId: string
  channelId: string
  error?: string | null
  guildId: string
  operationKeyHash: string
  requestDigest: string
  soundId: string
  sourceGuildId: string | null
  status: SoundboardPlaybackActivityStatus
  timestamp: string
  verification?: "gateway-match" | "response-only" | null
}): SoundboardPlaybackActivity {
  return {
    channelId: options.channelId,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "soundboard-playback",
    operationKeyHash: options.operationKeyHash,
    requestDigest: options.requestDigest,
    schemaVersion: SCHEMA_VERSION,
    soundId: options.soundId,
    sourceGuildId: options.sourceGuildId,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

export class SoundboardPlaybackService {
  readonly #activityStore: ActivityStore
  readonly #client: SoundboardPlaybackServiceOptions["client"]
  readonly #clock: () => Date
  readonly #gateway: GatewaySoundboardEffectSource
  readonly #intentKey: Uint8Array
  readonly #limiter: InteractionLimiter
  readonly #operationStore: OperationStore
  readonly #policy: SoundboardPlaybackServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: SoundboardPlaybackServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#gateway = options.gateway || new DisabledGatewaySoundboardEffectSource()
    this.#intentKey = options.intentKey
    this.#limiter = options.limiter
    this.#operationStore = options.operationStore
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  requestDigest(
    applicationId: string,
    botId: string,
    request: SoundboardPlaybackRequest,
  ): string {
    return soundboardPlaybackRequestDigest(
      this.#intentKey,
      applicationId,
      botId,
      normalizeSoundboardPlaybackRequest(request),
    )
  }

  #assertRequestPolicy(request: SoundboardPlaybackCheckRequest): void {
    this.#policy.assertSoundboardPlaybackChannelIdAllowed(request.channelId)
    if (request.sourceGuildId !== null) {
      this.#policy.assertSoundboardPlaybackSourceGuildAllowed(request.sourceGuildId)
    }
  }

  async #replay(
    request: NormalizedSoundboardPlaybackRequest,
    requestDigest: string,
  ): Promise<SoundboardPlaybackResult | undefined> {
    const existing = await this.#operationStore.get(
      "soundboard-playback",
      request.operationKeyHash,
    )
    if (!existing) return undefined
    if (
      existing.status === "completed"
      && existing.planDigest === requestDigest
      && existing.resourceId === request.channelId
      && existing.verification === "match"
    ) {
      return {
        activityId: existing.activityId,
        channelId: request.channelId,
        gatewayEvidence: null,
        guildId: existing.guildId,
        localReplay: true,
        operationKeyHash: request.operationKeyHash,
        requestDigest,
        schemaVersion: SCHEMA_VERSION,
        soundId: request.soundId,
        sourceGuildId: request.sourceGuildId,
        status: "completed",
        verification: "verified-local-replay",
      }
    }
    throw new SoundboardPlaybackOperationConflictError(receiptView(existing))
  }

  async replay(
    applicationId: string,
    botId: string,
    request: SoundboardPlaybackRequest,
  ): Promise<SoundboardPlaybackResult | undefined> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const normalized = normalizeSoundboardPlaybackRequest(request)
    this.#assertRequestPolicy(normalized)
    const requestDigest = soundboardPlaybackRequestDigest(
      this.#intentKey,
      applicationId,
      botId,
      normalized,
    )
    return this.#replay(normalized, requestDigest)
  }

  async #state(
    botId: string,
    request: SoundboardPlaybackCheckRequest,
    options: RequestOptions,
  ): Promise<PlaybackState> {
    this.#assertRequestPolicy(request)
    const metadata = await this.#client.getGuildChannelMetadata(request.channelId, options)
    const channel = channelFromMetadata(metadata)
    const guildId = this.#policy.assertSoundboardPlaybackChannel(channel)
    const [memberValue, rolesValue, voiceValue, soundValue] = await Promise.all([
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getCurrentUserVoiceState(guildId, botId, options),
      request.sourceGuildId === null
        ? this.#client.listDefaultSoundboardSounds(options).then((sounds) => (
            sounds.find((sound) => sound.id === request.soundId)
          ))
        : this.#client.getGuildSoundboardSound(
            request.sourceGuildId,
            request.soundId,
            options,
          ),
    ])
    if (!soundValue) {
      throw new SoundboardPlaybackEvidenceError(
        "Discord default soundboard inventory does not contain the exact requested sound",
      )
    }
    const member = exactMember(memberValue, botId)
    const roles = exactRoles(rolesValue, guildId, member)
    const rawPermission = evaluateBotChannelPermissions({
      botId,
      channel,
      guildId,
      member,
      permissionChannel: channel,
      roles,
    })
    const external = request.sourceGuildId !== null
      && request.sourceGuildId !== guildId
    return {
      channel,
      guildId,
      permission: permissionEvidence(rawPermission, external),
      sound: exactSound(soundValue, request.soundId, request.sourceGuildId),
      voice: exactVoice(voiceValue, guildId, request.channelId, botId),
    }
  }

  async check(
    applicationId: string,
    botId: string,
    request: SoundboardPlaybackCheckRequest,
    options: RequestOptions = {},
  ): Promise<SoundboardPlaybackReadiness> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const normalized = normalizeSoundboardPlaybackCheckRequest(request)
    const state = await this.#state(botId, normalized, options)
    const sound = exactSound(state.sound, normalized.soundId, normalized.sourceGuildId)
    const voice = exactVoice(
      state.voice,
      state.guildId,
      normalized.channelId,
      botId,
    )
    return {
      applicationId,
      botId,
      channel: {
        guildId: state.guildId,
        id: normalized.channelId,
        type: DISCORD_CHANNEL_TYPES.voice,
      },
      checkedAt: this.#clock().toISOString(),
      permission: state.permission,
      privacy: {
        activityRecords: "content-free",
        channelNames: "omitted",
        rawPayloads: "omitted",
        soundNames: "transient",
        voiceProfiles: "omitted",
      },
      schemaVersion: SCHEMA_VERSION,
      sound: {
        available: true,
        id: sound.id,
        name: sound.name,
        sourceGuildId: normalized.sourceGuildId,
        unknownFieldCount: sound.unknownFieldCount,
      },
      status: "ready",
      voice: {
        channelId: voice.channelId,
        deaf: false,
        guildId: state.guildId,
        mute: false,
        selfDeaf: false,
        selfMute: voice.selfMute,
        suppressed: false,
        unknownFieldCount: voice.unknownFieldCount,
        userId: botId,
      },
    }
  }

  async play(
    applicationId: string,
    botId: string,
    request: SoundboardPlaybackRequest,
    options: RequestOptions = {},
  ): Promise<SoundboardPlaybackResult> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const normalized = normalizeSoundboardPlaybackRequest(request)
    this.#assertRequestPolicy(normalized)
    const requestDigest = soundboardPlaybackRequestDigest(
      this.#intentKey,
      applicationId,
      botId,
      normalized,
    )
    const replay = await this.#replay(normalized, requestDigest)
    if (replay) return replay

    const state = await this.#state(botId, normalized, options)
    this.#limiter.reserve(normalized.channelId, "durable")
    const activityId = this.#randomId()
    const baseResult = {
      activityId,
      channelId: normalized.channelId,
      guildId: state.guildId,
      operationKeyHash: normalized.operationKeyHash,
      requestDigest,
      schemaVersion: SCHEMA_VERSION,
      soundId: normalized.soundId,
      sourceGuildId: normalized.sourceGuildId,
    }
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: state.guildId,
      operationKeyHash: normalized.operationKeyHash,
      requestDigest,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new SoundboardPlaybackOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        ...baseResult,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          guildId: state.guildId,
          operationKeyHash: normalized.operationKeyHash,
          requestDigest,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new SoundboardPlaybackExecutionError(
        "Discord soundboard playback was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    const evidenceAbort = new AbortController()
    const forwardAbort = () => evidenceAbort.abort()
    options.signal?.addEventListener("abort", forwardAbort, { once: true })
    const gatewayEvidencePromise = this.#gateway.soundboardPlaybackEventsEnabled
      ? this.#gateway.waitForSoundboardPlaybackEvent(
          state.guildId,
          normalized.channelId,
          botId,
          normalized.soundId,
          { signal: evidenceAbort.signal },
        ).then((evidence) => evidence).catch(() => null)
      : Promise.resolve(null)

    try {
      await this.#client.sendSoundboardSound(
        normalized.channelId,
        normalized.soundId,
        normalized.sourceGuildId ?? undefined,
        options,
      )
    } catch (error) {
      evidenceAbort.abort()
      options.signal?.removeEventListener("abort", forwardAbort)
      const status = deterministicFailure(error) ? "failed" : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          guildId: state.guildId,
          operationKeyHash: normalized.operationKeyHash,
          requestDigest,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          ...baseResult,
          error: errorCode,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new SoundboardPlaybackExecutionError(
        "Discord soundboard playback did not complete with a verified successful response",
        {
          ...baseResult,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const gatewayEvidence = await gatewayEvidencePromise
    options.signal?.removeEventListener("abort", forwardAbort)
    const verification = gatewayEvidence ? "gateway-match" : "response-only"
    const result: SoundboardPlaybackResult = {
      ...baseResult,
      gatewayEvidence,
      localReplay: false,
      status: "completed",
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: state.guildId,
        operationKeyHash: normalized.operationKeyHash,
        requestDigest,
        resourceId: normalized.channelId,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          ...baseResult,
          status: "completed",
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new SoundboardPlaybackExecutionError(
        "Discord soundboard playback completed but the operation receipt failed",
        {
          ...result,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
        },
        { cause: error },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        ...baseResult,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new SoundboardPlaybackExecutionError(
        "Discord soundboard playback completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
        { cause: error },
      )
    }
    return result
  }
}
