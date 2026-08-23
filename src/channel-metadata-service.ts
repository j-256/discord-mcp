import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ChannelMetadataActivity,
  ChannelMetadataActivityStatus,
} from "./activity-log.js"
import {
  CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_VIDEO_QUALITY_MODES,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordChannelMetadata,
  type DiscordClient,
  type DiscordVoiceRegion,
  type ModifyChannelMetadataInput,
} from "./discord-client.js"
import {
  ChannelMetadataEvidenceError,
  ChannelMetadataExecutionError,
  ChannelMetadataOperationConflictError,
  ChannelMetadataPlanChangedError,
  DiscordApiError,
  errorMessage,
} from "./errors.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  DISCORD_PERMISSION_NAMES,
  evaluateBotChannelPermissions,
  parseDiscordPermissionBits,
  type BotChannelPermissionResult,
  type DiscordPermissionName,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export const CHANNEL_METADATA_FIELD_NAMES = [
  "bitrate",
  "defaultAutoArchiveDuration",
  "defaultThreadRateLimitPerUser",
  "name",
  "nsfw",
  "rateLimitPerUser",
  "rtcRegion",
  "topic",
  "userLimit",
  "videoQualityMode",
] as const

export type ChannelMetadataFieldName = typeof CHANNEL_METADATA_FIELD_NAMES[number]

const STATE_UNAVAILABLE = "channel-metadata-state-unavailable"
const GUILD_NAME_CHARACTERS = 100
const USERNAME_CHARACTERS = 32
const CHANNEL_METADATA_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const CHANNEL_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const CHANNEL_METADATA_REQUEST_KEYS = [
  "auditReason",
  "bitrate",
  "channelId",
  "defaultAutoArchiveDuration",
  "defaultThreadRateLimitPerUser",
  "guildId",
  "name",
  "nsfw",
  "operationKey",
  "rateLimitPerUser",
  "rtcRegion",
  "topic",
  "userLimit",
  "videoQualityMode",
] as const
const PROJECTED_METADATA_KEYS = [
  "bitrate",
  "defaultAutoArchiveDuration",
  "defaultThreadRateLimitPerUser",
  "guildId",
  "id",
  "name",
  "nsfw",
  "parentId",
  "permissionOverwrites",
  "position",
  "rateLimitPerUser",
  "rtcRegion",
  "topic",
  "type",
  "unknownFieldCount",
  "userLimit",
  "videoQualityMode",
] as const
const METADATA_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.category,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const TOPIC_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const NSFW_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const RATE_LIMIT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const AUTO_ARCHIVE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const THREAD_RATE_LIMIT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const VOICE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
])
export const CHANNEL_METADATA_VIDEO_QUALITY_MODES = [
  "automatic",
  "full",
] as const
export type ChannelMetadataVideoQualityMode =
  typeof CHANNEL_METADATA_VIDEO_QUALITY_MODES[number]
const CHANNEL_METADATA_LOCAL_LIMITS = Object.freeze({
  bitrateMinimum: DISCORD_LIMITS.channelBitrateMinimum,
  defaultAutoArchiveDurations: [...CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS],
  nameCharacters: DISCORD_LIMITS.channelNameCharacters,
  rateLimitSeconds: DISCORD_LIMITS.channelRateLimitSeconds,
  stageBitrateMaximum: DISCORD_LIMITS.stageChannelBitrateMaximum,
  stageUserLimit: DISCORD_LIMITS.stageChannelUserLimit,
  standardTopicCharacters: DISCORD_LIMITS.channelTopicCharacters,
  forumAndMediaTopicCharacters: DISCORD_LIMITS.forumChannelTopicCharacters,
  videoQualityModes: [...CHANNEL_METADATA_VIDEO_QUALITY_MODES],
  voiceBitrateMaximum: DISCORD_LIMITS.voiceChannelBitrateMaximum,
  voiceUserLimit: DISCORD_LIMITS.voiceChannelUserLimit,
})

type ChannelMetadataTargetOutcome = "settled" | "uncertain"
const CHANNEL_METADATA_LOCKS = new Map<string, Promise<ChannelMetadataTargetOutcome>>()
const CHANNEL_METADATA_UNCERTAIN_CHANNELS = new Set<string>()

export interface ChannelMetadataChangeRequest {
  auditReason: string
  bitrate?: number
  channelId: string
  defaultAutoArchiveDuration?: number
  defaultThreadRateLimitPerUser?: number
  guildId: string
  name?: string
  nsfw?: boolean
  operationKey: string
  rateLimitPerUser?: number
  rtcRegion?: string | null
  topic?: string | null
  userLimit?: number
  videoQualityMode?: ChannelMetadataVideoQualityMode
}

export interface NormalizedChannelMetadataChangeRequest
  extends ChannelMetadataChangeRequest {
  operationKeyHash: string
  requestedFields: ChannelMetadataFieldName[]
}

export interface ChannelMetadataView {
  applicableFields: ChannelMetadataFieldName[]
  bitrate: number | null
  defaultAutoArchiveDuration: number | null
  defaultThreadRateLimitPerUser: number | null
  guildId: string
  id: string
  name: string
  nsfw: boolean | null
  parentId: string | null
  permissionOverwriteCount: number
  position: number
  rateLimitPerUser: number | null
  rtcRegion: string | null
  topic: string | null
  type: number
  unknownFieldCount: number
  userLimit: number | null
  videoQualityMode: ChannelMetadataVideoQualityMode | null
}

export interface ChannelMetadataReadResult {
  metadata: ChannelMetadataView
  privacy: {
    persistence: "none"
    rawPayloads: "omitted"
    text: "included"
    unknownFields: "counts-only"
  }
  schemaVersion: number
  status: "ok"
}

export interface ChannelMetadataAccessEvidence {
  appliedRoleIds: string[]
  authorizedForChange: true
  botAdministrator: boolean
  botGuildOwner: boolean
  connect: true | null
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageChannels: true
  requiredChangePermissions: DiscordPermissionName[]
  unknownPermissionBits: string
  viewChannel: true
}

export type ChannelMetadataRtcRegionValidation =
  | { kind: "not-requested" }
  | { kind: "automatic" }
  | {
      inventoryCount: number
      inventoryDigest: string
      kind: "available"
      selected: DiscordVoiceRegion
    }

export interface ChannelMetadataVoiceSettingsEvidence {
  bitrateMaximum: number
  guildPremiumTier: number
  guildVipRegions: boolean
  rtcRegionValidation: ChannelMetadataRtcRegionValidation
  userLimitMaximum: number
}

export interface ChannelMetadataChange {
  after: boolean | number | string | null
  before: boolean | number | string | null
  field: ChannelMetadataFieldName
}

export interface ChannelMetadataChangePlan {
  access: ChannelMetadataAccessEvidence
  applicationId: string
  auditReason: string
  botId: string
  changedFields: ChannelMetadataFieldName[]
  changes: ChannelMetadataChange[]
  createdAt: string
  current: ChannelMetadataView
  desired: ChannelMetadataView
  digest: string
  guild: {
    id: string
    name: string
  }
  localLimits: typeof CHANNEL_METADATA_LOCAL_LIMITS
  operationKeyHash: string
  privacy: ChannelMetadataReadResult["privacy"]
  requestedFields: ChannelMetadataFieldName[]
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  warnings: string[]
  voiceSettings: ChannelMetadataVoiceSettingsEvidence | null
  writeRequired: boolean
}

export interface ChannelMetadataChangeResult {
  activityId: string | null
  channelId: string
  guildId: string
  observed: ChannelMetadataView
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: boolean
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
}

export interface ChannelMetadataServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildChannelMetadata"
  | "getGuildMember"
  | "getGuildRoles"
  | "listGuildVoiceRegions"
  | "modifyGuildChannelMetadata"
> {}

export interface ChannelMetadataServiceOptions {
  activityStore: ActivityStore
  client: ChannelMetadataServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<ScopePolicy, "assertChannelMetadataChangeAllowed" | "assertChannelReadable">
  randomId?: () => string
}

interface ValidatedGuild extends DiscordGuild {
  features: string[]
  owner_id: string
  premium_tier: number
}

interface ChannelMetadataState {
  access: ChannelMetadataAccessEvidence
  botMember: DiscordGuildMember
  guild: ValidatedGuild
  metadata: DiscordChannelMetadata
  regions: DiscordVoiceRegion[] | null
  roles: DiscordRole[]
}

interface BuiltChannelMetadataPlan {
  plan: ChannelMetadataChangePlan
  request: NormalizedChannelMetadataChangeRequest
  state: ChannelMetadataState
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, name: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${name} must be a positive Discord snowflake`)
  }
}

export function assertChannelMetadataChannelId(channelId: string): void {
  assertPositiveSnowflake(channelId, "Discord channel metadata ID")
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function assertName(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > DISCORD_LIMITS.channelNameCharacters
    || value.trim() !== value
    || CHANNEL_NAME_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError("Discord channel metadata name is invalid")
  }
}

function assertTopic(value: unknown): asserts value is string | null {
  if (value === null) return
  if (
    typeof value !== "string"
    || value.length > DISCORD_LIMITS.forumChannelTopicCharacters
    || (value.length > 0 && value.trim() !== value)
    || CHANNEL_METADATA_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError("Discord channel metadata topic is invalid")
  }
}

function assertRateLimit(value: unknown, name: string): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value > DISCORD_LIMITS.channelRateLimitSeconds
  ) {
    throw new RangeError(
      `${name} must be an integer between 0 and ${DISCORD_LIMITS.channelRateLimitSeconds}`,
    )
  }
}

function assertIntegerRange(
  value: unknown,
  minimum: number,
  maximum: number,
  name: string,
): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < minimum
    || value > maximum
  ) throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)
}

function assertRtcRegion(value: unknown): asserts value is string | null {
  if (value === null) return
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > DISCORD_LIMITS.voiceRegionIdCharacters
    || value.trim() !== value
    || CHANNEL_NAME_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw new RangeError("Discord channel metadata voice region is invalid")
}

export function normalizeChannelMetadataChangeRequest(
  request: ChannelMetadataChangeRequest,
): NormalizedChannelMetadataChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord channel metadata change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, CHANNEL_METADATA_REQUEST_KEYS)
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) {
    throw new RangeError("Discord channel metadata change request is invalid")
  }
  assertPositiveSnowflake(request.channelId, "Discord channel metadata ID")
  assertPositiveSnowflake(request.guildId, "Discord channel metadata guild ID")
  encodeDiscordAuditReason(request.auditReason)
  const requestedFields = CHANNEL_METADATA_FIELD_NAMES.filter((field) => (
    Object.hasOwn(record, field)
  ))
  if (requestedFields.length < 1) {
    throw new RangeError("Discord channel metadata change requires at least one explicit field")
  }
  if (requestedFields.some((field) => record[field] === undefined)) {
    throw new RangeError("Discord channel metadata fields cannot be undefined")
  }
  if (Object.hasOwn(record, "name")) assertName(request.name)
  if (Object.hasOwn(record, "topic")) assertTopic(request.topic)
  if (Object.hasOwn(record, "nsfw") && typeof request.nsfw !== "boolean") {
    throw new RangeError("Discord channel metadata NSFW setting must be a boolean")
  }
  if (Object.hasOwn(record, "rateLimitPerUser")) {
    assertRateLimit(request.rateLimitPerUser, "Discord channel metadata slowmode seconds")
  }
  if (Object.hasOwn(record, "bitrate")) {
    assertIntegerRange(
      request.bitrate,
      DISCORD_LIMITS.channelBitrateMinimum,
      DISCORD_LIMITS.voiceChannelBitrateMaximum,
      "Discord channel metadata bitrate",
    )
  }
  if (Object.hasOwn(record, "userLimit")) {
    assertIntegerRange(
      request.userLimit,
      0,
      DISCORD_LIMITS.stageChannelUserLimit,
      "Discord channel metadata user limit",
    )
  }
  if (Object.hasOwn(record, "rtcRegion")) assertRtcRegion(request.rtcRegion)
  if (
    Object.hasOwn(record, "videoQualityMode")
    && !(CHANNEL_METADATA_VIDEO_QUALITY_MODES as readonly unknown[])
      .includes(request.videoQualityMode)
  ) throw new RangeError("Discord channel metadata video quality mode is unsupported")
  if (Object.hasOwn(record, "defaultThreadRateLimitPerUser")) {
    assertRateLimit(
      request.defaultThreadRateLimitPerUser,
      "Discord channel metadata default thread slowmode seconds",
    )
  }
  if (
    Object.hasOwn(record, "defaultAutoArchiveDuration")
    && (
      typeof request.defaultAutoArchiveDuration !== "number"
      || !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
        .includes(request.defaultAutoArchiveDuration)
    )
  ) {
    throw new RangeError("Discord channel metadata default auto-archive duration is unsupported")
  }
  return {
    auditReason: request.auditReason,
    ...(Object.hasOwn(record, "bitrate") ? { bitrate: request.bitrate } : {}),
    channelId: request.channelId,
    ...(Object.hasOwn(record, "defaultAutoArchiveDuration")
      ? { defaultAutoArchiveDuration: request.defaultAutoArchiveDuration }
      : {}),
    ...(Object.hasOwn(record, "defaultThreadRateLimitPerUser")
      ? { defaultThreadRateLimitPerUser: request.defaultThreadRateLimitPerUser }
      : {}),
    guildId: request.guildId,
    ...(Object.hasOwn(record, "name") ? { name: request.name } : {}),
    ...(Object.hasOwn(record, "nsfw") ? { nsfw: request.nsfw } : {}),
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    ...(Object.hasOwn(record, "rateLimitPerUser")
      ? { rateLimitPerUser: request.rateLimitPerUser }
      : {}),
    ...(Object.hasOwn(record, "rtcRegion") ? { rtcRegion: request.rtcRegion } : {}),
    requestedFields,
    ...(Object.hasOwn(record, "topic")
      ? { topic: request.topic === "" ? null : request.topic }
      : {}),
    ...(Object.hasOwn(record, "userLimit") ? { userLimit: request.userLimit } : {}),
    ...(Object.hasOwn(record, "videoQualityMode")
      ? { videoQualityMode: request.videoQualityMode }
      : {}),
  }
}

function applicableFields(type: number): ChannelMetadataFieldName[] {
  return CHANNEL_METADATA_FIELD_NAMES.filter((field) => {
    if (field === "name") return true
    if (field === "topic") return TOPIC_TYPES.has(type)
    if (field === "nsfw") return NSFW_TYPES.has(type)
    if (field === "rateLimitPerUser") return RATE_LIMIT_TYPES.has(type)
    if (field === "defaultAutoArchiveDuration") return AUTO_ARCHIVE_TYPES.has(type)
    if (field === "defaultThreadRateLimitPerUser") return THREAD_RATE_LIMIT_TYPES.has(type)
    return VOICE_TYPES.has(type)
  })
}

function exactOverwrites(value: unknown): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw new ChannelMetadataEvidenceError("Discord returned invalid channel overwrite evidence")
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ChannelMetadataEvidenceError("Discord returned invalid channel overwrite evidence")
    }
    const record = entry as Record<string, unknown>
    if (
      !onlyKeys(record, ["allow", "deny", "id", "type"])
      || !positiveSnowflake(record.id)
      || (record.type !== 0 && record.type !== 1)
      || typeof record.allow !== "string"
      || typeof record.deny !== "string"
      || seen.has(record.id)
    ) {
      throw new ChannelMetadataEvidenceError("Discord returned invalid channel overwrite evidence")
    }
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(record.allow, `channel overwrite ${record.id} allow`)
      deny = parseDiscordPermissionBits(record.deny, `channel overwrite ${record.id} deny`)
    } catch (error) {
      throw new ChannelMetadataEvidenceError(
        "Discord returned invalid channel overwrite evidence",
        { cause: error },
      )
    }
    if ((allow & deny) !== 0n) {
      throw new ChannelMetadataEvidenceError("Discord returned overlapping channel overwrite bits")
    }
    seen.add(record.id)
    return {
      allow: record.allow,
      deny: record.deny,
      id: record.id,
      type: record.type,
    }
  }).sort((left, right) => compareSnowflakes(left.id, right.id) || left.type - right.type)
}

function exactMetadata(
  value: DiscordChannelMetadata,
  channelId: string,
): DiscordChannelMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChannelMetadataEvidenceError("Discord returned invalid channel metadata evidence")
  }
  const record = value as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, PROJECTED_METADATA_KEYS)
    || value.id !== channelId
    || !positiveSnowflake(value.id)
    || !positiveSnowflake(value.guildId)
    || !METADATA_TYPES.has(value.type)
    || !Number.isInteger(value.position)
    || value.position < 0
    || !(value.parentId === null || positiveSnowflake(value.parentId))
    || !Number.isInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
  ) {
    throw new ChannelMetadataEvidenceError("Discord returned invalid channel metadata evidence")
  }
  try {
    assertName(value.name)
  } catch (error) {
    throw new ChannelMetadataEvidenceError(
      "Discord returned invalid channel name evidence",
      { cause: error },
    )
  }
  const applicable = new Set(applicableFields(value.type))
  if (
    (applicable.has("topic")
      ? !(value.topic === null || typeof value.topic === "string")
      : value.topic !== null)
    || (applicable.has("nsfw")
      ? typeof value.nsfw !== "boolean"
      : value.nsfw !== null)
    || (applicable.has("rateLimitPerUser")
      ? typeof value.rateLimitPerUser !== "number"
      : value.rateLimitPerUser !== null)
    || (applicable.has("defaultAutoArchiveDuration")
      ? !(value.defaultAutoArchiveDuration === null || (
          typeof value.defaultAutoArchiveDuration === "number"
          && (CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
            .includes(value.defaultAutoArchiveDuration)
        ))
      : value.defaultAutoArchiveDuration !== null)
    || (applicable.has("defaultThreadRateLimitPerUser")
      ? typeof value.defaultThreadRateLimitPerUser !== "number"
      : value.defaultThreadRateLimitPerUser !== null)
    || (applicable.has("bitrate")
      ? !(typeof value.bitrate === "number"
        && Number.isInteger(value.bitrate)
        && value.bitrate >= DISCORD_LIMITS.channelBitrateMinimum
        && value.bitrate <= (
          value.type === DISCORD_CHANNEL_TYPES.stageVoice
            ? DISCORD_LIMITS.stageChannelBitrateMaximum
            : DISCORD_LIMITS.voiceChannelBitrateMaximum
        ))
      : value.bitrate !== null)
    || (applicable.has("userLimit")
      ? !(typeof value.userLimit === "number"
        && Number.isInteger(value.userLimit)
        && value.userLimit >= 0
        && value.userLimit <= (
          value.type === DISCORD_CHANNEL_TYPES.stageVoice
            ? DISCORD_LIMITS.stageChannelUserLimit
            : DISCORD_LIMITS.voiceChannelUserLimit
        ))
      : value.userLimit !== null)
    || (applicable.has("rtcRegion")
      ? !(value.rtcRegion === null || typeof value.rtcRegion === "string")
      : value.rtcRegion !== null)
    || (applicable.has("videoQualityMode")
      ? !(
          value.videoQualityMode === DISCORD_VIDEO_QUALITY_MODES.auto
          || value.videoQualityMode === DISCORD_VIDEO_QUALITY_MODES.full
        )
      : value.videoQualityMode !== null)
  ) {
    throw new ChannelMetadataEvidenceError("Discord returned invalid type-specific channel metadata")
  }
  if (value.rtcRegion !== null) {
    try {
      assertRtcRegion(value.rtcRegion)
    } catch (error) {
      throw new ChannelMetadataEvidenceError(
        "Discord returned invalid channel voice-region evidence",
        { cause: error },
      )
    }
  }
  if (value.topic !== null) {
    const maximum = value.type === DISCORD_CHANNEL_TYPES.forum
        || value.type === DISCORD_CHANNEL_TYPES.media
      ? DISCORD_LIMITS.forumChannelTopicCharacters
      : DISCORD_LIMITS.channelTopicCharacters
    if (
      value.topic.length > maximum
      || CHANNEL_METADATA_CONTROL_PATTERN.test(value.topic)
      || !validUnicode(value.topic)
    ) {
      throw new ChannelMetadataEvidenceError("Discord returned invalid channel topic evidence")
    }
  }
  if (value.rateLimitPerUser !== null) {
    try {
      assertRateLimit(value.rateLimitPerUser, "Discord channel metadata slowmode evidence")
    } catch (error) {
      throw new ChannelMetadataEvidenceError(
        "Discord returned invalid channel slowmode evidence",
        { cause: error },
      )
    }
  }
  if (value.defaultThreadRateLimitPerUser !== null) {
    try {
      assertRateLimit(
        value.defaultThreadRateLimitPerUser,
        "Discord channel metadata default thread slowmode evidence",
      )
    } catch (error) {
      throw new ChannelMetadataEvidenceError(
        "Discord returned invalid default thread slowmode evidence",
        { cause: error },
      )
    }
  }
  return {
    ...value,
    permissionOverwrites: exactOverwrites(value.permissionOverwrites),
  }
}

function metadataChannel(metadata: DiscordChannelMetadata): DiscordChannel {
  return {
    ...(metadata.bitrate !== null ? { bitrate: metadata.bitrate } : {}),
    default_auto_archive_duration: metadata.defaultAutoArchiveDuration,
    default_thread_rate_limit_per_user: metadata.defaultThreadRateLimitPerUser,
    guild_id: metadata.guildId,
    id: metadata.id,
    name: metadata.name,
    ...(metadata.nsfw !== null ? { nsfw: metadata.nsfw } : {}),
    parent_id: metadata.parentId,
    permission_overwrites: metadata.permissionOverwrites,
    position: metadata.position,
    rate_limit_per_user: metadata.rateLimitPerUser,
    rtc_region: metadata.rtcRegion,
    topic: metadata.topic,
    type: metadata.type,
    ...(metadata.userLimit !== null ? { user_limit: metadata.userLimit } : {}),
    ...(metadata.videoQualityMode !== null
      ? { video_quality_mode: metadata.videoQualityMode }
      : {}),
  }
}

function videoQualityModeName(
  value: number | null,
): ChannelMetadataVideoQualityMode | null {
  if (value === null) return null
  return value === DISCORD_VIDEO_QUALITY_MODES.auto ? "automatic" : "full"
}

function metadataView(metadata: DiscordChannelMetadata): ChannelMetadataView {
  return {
    applicableFields: applicableFields(metadata.type),
    bitrate: metadata.bitrate,
    defaultAutoArchiveDuration: metadata.defaultAutoArchiveDuration,
    defaultThreadRateLimitPerUser: metadata.defaultThreadRateLimitPerUser,
    guildId: metadata.guildId,
    id: metadata.id,
    name: metadata.name,
    nsfw: metadata.nsfw,
    parentId: metadata.parentId,
    permissionOverwriteCount: metadata.permissionOverwrites.length,
    position: metadata.position,
    rateLimitPerUser: metadata.rateLimitPerUser,
    rtcRegion: metadata.rtcRegion,
    topic: metadata.topic,
    type: metadata.type,
    unknownFieldCount: metadata.unknownFieldCount,
    userLimit: metadata.userLimit,
    videoQualityMode: videoQualityModeName(metadata.videoQualityMode),
  }
}

function exactGuild(value: DiscordGuild, guildId: string): ValidatedGuild {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || typeof value.name !== "string"
    || value.name.length < 1
    || value.name.length > GUILD_NAME_CHARACTERS
    || CHANNEL_NAME_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
    || !positiveSnowflake(value.owner_id)
    || !Array.isArray(value.features)
    || value.features.length > DISCORD_LIMITS.guildFeatures
    || value.features.some((feature) => (
      typeof feature !== "string"
      || feature.length < 1
      || feature.length > DISCORD_LIMITS.guildFeatureCharacters
      || CHANNEL_NAME_CONTROL_PATTERN.test(feature)
      || !validUnicode(feature)
    ))
    || new Set(value.features).size !== value.features.length
    || !Number.isSafeInteger(value.premium_tier)
    || (value.premium_tier as number) < 0
    || (value.premium_tier as number) > 3
  ) {
    throw new ChannelMetadataEvidenceError("Discord returned invalid channel metadata guild evidence")
  }
  return {
    features: [...value.features].sort(),
    id: value.id,
    name: value.name,
    owner_id: value.owner_id,
    premium_tier: value.premium_tier as number,
  }
}

function exactVoiceRegions(value: DiscordVoiceRegion[]): DiscordVoiceRegion[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.voiceRegions) {
    throw new ChannelMetadataEvidenceError("Discord returned invalid voice-region inventory")
  }
  const keys = [
    "custom",
    "deprecated",
    "id",
    "name",
    "optimal",
    "unknownFieldCount",
  ] as const
  const seen = new Set<string>()
  return value.map((region) => {
    if (
      !region
      || typeof region !== "object"
      || Array.isArray(region)
      || !onlyKeys(region as unknown as Record<string, unknown>, keys)
      || typeof region.id !== "string"
      || region.id.length < 1
      || region.id.length > DISCORD_LIMITS.voiceRegionIdCharacters
      || region.id.trim() !== region.id
      || CHANNEL_NAME_CONTROL_PATTERN.test(region.id)
      || !validUnicode(region.id)
      || typeof region.name !== "string"
      || region.name.length < 1
      || region.name.length > DISCORD_LIMITS.voiceRegionNameCharacters
      || region.name.trim() !== region.name
      || CHANNEL_NAME_CONTROL_PATTERN.test(region.name)
      || !validUnicode(region.name)
      || typeof region.custom !== "boolean"
      || typeof region.deprecated !== "boolean"
      || typeof region.optimal !== "boolean"
      || !Number.isSafeInteger(region.unknownFieldCount)
      || region.unknownFieldCount < 0
      || seen.has(region.id)
    ) throw new ChannelMetadataEvidenceError("Discord returned invalid voice-region inventory")
    seen.add(region.id)
    return { ...region }
  }).sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ))
}

function maximumVoiceBitrate(guild: ValidatedGuild): number {
  if (guild.premium_tier >= 3 || guild.features.includes("VIP_REGIONS")) {
    return DISCORD_LIMITS.voiceChannelBitrateMaximum
  }
  if (guild.premium_tier === 2) return 256_000
  if (guild.premium_tier === 1) return 128_000
  return 96_000
}

function exactMember(
  value: DiscordGuildMember,
  guildId: string,
  botId: string,
): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !value.user
    || value.user.id !== botId
    || value.user.bot !== true
    || typeof value.user.username !== "string"
    || value.user.username.length < 1
    || value.user.username.length > USERNAME_CHARACTERS
    || CHANNEL_NAME_CONTROL_PATTERN.test(value.user.username)
    || !validUnicode(value.user.username)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw new ChannelMetadataEvidenceError("Discord returned invalid connector membership evidence")
  }
  return {
    roles: [...value.roles],
    user: {
      bot: true,
      id: botId,
      username: value.user.username,
    },
  }
}

function exactRoles(
  value: DiscordRole[],
  guildId: string,
  memberRoleIds: readonly string[],
): DiscordRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw new ChannelMetadataEvidenceError("Discord returned invalid channel metadata role evidence")
  }
  const seen = new Set<string>()
  const roles = value.map((role) => {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || typeof role.name !== "string"
      || role.name.length < 1
      || role.name.length > DISCORD_LIMITS.roleNameCharacters
      || CHANNEL_NAME_CONTROL_PATTERN.test(role.name)
      || !validUnicode(role.name)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || seen.has(role.id)
    ) {
      throw new ChannelMetadataEvidenceError("Discord returned invalid channel metadata role evidence")
    }
    try {
      parseDiscordPermissionBits(role.permissions, `channel metadata role ${role.id}`)
    } catch (error) {
      throw new ChannelMetadataEvidenceError(
        "Discord returned invalid channel metadata role permission evidence",
        { cause: error },
      )
    }
    seen.add(role.id)
    return {
      id: role.id,
      managed: role.managed,
      name: role.name,
      permissions: role.permissions,
      position: role.position,
    }
  })
  for (const roleId of [guildId, ...memberRoleIds]) {
    if (!seen.has(roleId)) {
      throw new ChannelMetadataEvidenceError(
        `Discord channel metadata role evidence omitted role ${roleId}`,
      )
    }
  }
  return roles.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function accessEvidence(
  botId: string,
  guildOwnerId: string,
  metadata: DiscordChannelMetadata,
  member: DiscordGuildMember,
  roles: readonly DiscordRole[],
): ChannelMetadataAccessEvidence {
  let result: BotChannelPermissionResult
  try {
    const channel = metadataChannel(metadata)
    result = evaluateBotChannelPermissions({
      botId,
      channel,
      guildId: metadata.guildId,
      member,
      permissionChannel: channel,
      roles,
    })
  } catch (error) {
    throw new ChannelMetadataEvidenceError(
      `Discord channel metadata permission evidence is invalid: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  if (result.confidence !== "complete") {
    throw new ChannelMetadataEvidenceError(
      `Discord channel metadata permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  const botGuildOwner = botId === guildOwnerId
  const effectivePermissions = botGuildOwner
    ? (ALL_KNOWN_PERMISSION_BITS | BigInt(result.effectivePermissions)).toString()
    : result.effectivePermissions
  const effectivePermissionNames = botGuildOwner
    ? [...DISCORD_PERMISSION_NAMES]
    : [...result.effectivePermissionNames]
  const viewChannel = effectivePermissionNames.includes("VIEW_CHANNEL")
  const manageChannels = effectivePermissionNames.includes("MANAGE_CHANNELS")
  const voiceLike = metadata.type === DISCORD_CHANNEL_TYPES.voice
    || metadata.type === DISCORD_CHANNEL_TYPES.stageVoice
  const connect = voiceLike ? effectivePermissionNames.includes("CONNECT") : null
  if (!viewChannel || !manageChannels || connect === false) {
    throw new ChannelMetadataEvidenceError(
      "Discord connector lacks complete effective channel-metadata authority for this channel",
    )
  }
  return {
    appliedRoleIds: [...result.appliedRoleIds].sort(compareSnowflakes),
    authorizedForChange: true,
    botAdministrator: result.administrator,
    botGuildOwner,
    connect: connect as true | null,
    effectivePermissionNames,
    effectivePermissions,
    manageChannels: true,
    requiredChangePermissions: [
      "MANAGE_CHANNELS",
      "VIEW_CHANNEL",
      ...(voiceLike ? ["CONNECT" as const] : []),
    ],
    unknownPermissionBits: result.unknownPermissionBits,
    viewChannel: true,
  }
}

function roleSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
    managed: role.managed,
    name: role.name,
    permissions: role.permissions,
    position: role.position,
  }))
}

function memberSnapshot(member: DiscordGuildMember) {
  return {
    roles: [...member.roles].sort(compareSnowflakes),
    user: {
      bot: member.user?.bot,
      id: member.user?.id,
    },
  }
}

function metadataSnapshot(metadata: DiscordChannelMetadata) {
  return {
    ...metadataView(metadata),
    permissionOverwrites: metadata.permissionOverwrites,
  }
}

function desiredMetadata(
  current: DiscordChannelMetadata,
  request: NormalizedChannelMetadataChangeRequest,
): DiscordChannelMetadata {
  const applicable = new Set(applicableFields(current.type))
  for (const field of request.requestedFields) {
    if (!applicable.has(field)) {
      throw new RangeError(
        `Discord channel type ${current.type} does not support metadata field ${field}`,
      )
    }
  }
  if (
    request.topic !== undefined
    && request.topic !== null
    && request.topic.length > (
      current.type === DISCORD_CHANNEL_TYPES.forum
        || current.type === DISCORD_CHANNEL_TYPES.media
        ? DISCORD_LIMITS.forumChannelTopicCharacters
        : DISCORD_LIMITS.channelTopicCharacters
    )
  ) {
    throw new RangeError("Discord channel metadata topic exceeds this channel type's limit")
  }
  return {
    ...current,
    ...(request.bitrate !== undefined ? { bitrate: request.bitrate } : {}),
    ...(request.defaultAutoArchiveDuration !== undefined
      ? { defaultAutoArchiveDuration: request.defaultAutoArchiveDuration }
      : {}),
    ...(request.defaultThreadRateLimitPerUser !== undefined
      ? { defaultThreadRateLimitPerUser: request.defaultThreadRateLimitPerUser }
      : {}),
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.nsfw !== undefined ? { nsfw: request.nsfw } : {}),
    ...(request.rateLimitPerUser !== undefined
      ? { rateLimitPerUser: request.rateLimitPerUser }
      : {}),
    ...(Object.hasOwn(request, "rtcRegion")
      ? { rtcRegion: request.rtcRegion as string | null }
      : {}),
    ...(Object.hasOwn(request, "topic") ? { topic: request.topic as string | null } : {}),
    ...(request.userLimit !== undefined ? { userLimit: request.userLimit } : {}),
    ...(request.videoQualityMode !== undefined
      ? {
          videoQualityMode: request.videoQualityMode === "automatic"
            ? DISCORD_VIDEO_QUALITY_MODES.auto
            : DISCORD_VIDEO_QUALITY_MODES.full,
        }
      : {}),
  }
}

function voiceSettingsEvidence(options: {
  guild: ValidatedGuild
  metadata: DiscordChannelMetadata
  planKey: Uint8Array
  regions: DiscordVoiceRegion[] | null
  request: NormalizedChannelMetadataChangeRequest
}): ChannelMetadataVoiceSettingsEvidence | null {
  if (!VOICE_TYPES.has(options.metadata.type)) return null
  const bitrateMaximum = options.metadata.type === DISCORD_CHANNEL_TYPES.stageVoice
    ? DISCORD_LIMITS.stageChannelBitrateMaximum
    : maximumVoiceBitrate(options.guild)
  const userLimitMaximum = options.metadata.type === DISCORD_CHANNEL_TYPES.stageVoice
    ? DISCORD_LIMITS.stageChannelUserLimit
    : DISCORD_LIMITS.voiceChannelUserLimit
  if (options.request.bitrate !== undefined && options.request.bitrate > bitrateMaximum) {
    throw new RangeError(
      `Discord channel metadata bitrate exceeds the current ${bitrateMaximum} bps limit`,
    )
  }
  if (options.request.userLimit !== undefined && options.request.userLimit > userLimitMaximum) {
    throw new RangeError(
      `Discord channel metadata user limit exceeds the current ${userLimitMaximum} limit`,
    )
  }
  let rtcRegionValidation: ChannelMetadataRtcRegionValidation = {
    kind: "not-requested",
  }
  if (Object.hasOwn(options.request, "rtcRegion")) {
    if (options.request.rtcRegion === null) {
      rtcRegionValidation = { kind: "automatic" }
    } else {
      if (!options.regions) {
        throw new ChannelMetadataEvidenceError(
          "Discord voice-region inventory is unavailable for the requested selection",
        )
      }
      const matches = options.regions.filter(({ id }) => id === options.request.rtcRegion)
      const selected = matches[0]
      if (matches.length !== 1 || !selected) {
        throw new RangeError(
          "Discord channel metadata voice region is not available to this guild",
        )
      }
      if (selected.deprecated) {
        throw new RangeError("Discord channel metadata voice region is deprecated")
      }
      rtcRegionValidation = {
        inventoryCount: options.regions.length,
        inventoryDigest: reviewedPlanDigest(options.planKey, {
          guildId: options.metadata.guildId,
          kind: "channel-metadata-voice-regions",
          regions: options.regions,
        }),
        kind: "available",
        selected: { ...selected },
      }
    }
  }
  return {
    bitrateMaximum,
    guildPremiumTier: options.guild.premium_tier,
    guildVipRegions: options.guild.features.includes("VIP_REGIONS"),
    rtcRegionValidation,
    userLimitMaximum,
  }
}

function fieldValue(
  metadata: DiscordChannelMetadata,
  field: ChannelMetadataFieldName,
): boolean | number | string | null {
  if (field === "videoQualityMode") return videoQualityModeName(metadata.videoQualityMode)
  return metadata[field]
}

function metadataChanges(
  current: DiscordChannelMetadata,
  desired: DiscordChannelMetadata,
  fields: readonly ChannelMetadataFieldName[],
): ChannelMetadataChange[] {
  return fields.flatMap((field) => {
    const before = fieldValue(current, field)
    const after = fieldValue(desired, field)
    return stableString(before) === stableString(after)
      ? []
      : [{ after, before, field }]
  })
}

function patchInput(
  desired: DiscordChannelMetadata,
  fields: readonly ChannelMetadataFieldName[],
): ModifyChannelMetadataInput {
  const fieldSet = new Set(fields)
  return {
    ...(fieldSet.has("bitrate") ? { bitrate: desired.bitrate as number } : {}),
    ...(fieldSet.has("defaultAutoArchiveDuration")
      ? { defaultAutoArchiveDuration: desired.defaultAutoArchiveDuration as number }
      : {}),
    ...(fieldSet.has("defaultThreadRateLimitPerUser")
      ? { defaultThreadRateLimitPerUser: desired.defaultThreadRateLimitPerUser as number }
      : {}),
    ...(fieldSet.has("name") ? { name: desired.name } : {}),
    ...(fieldSet.has("nsfw") ? { nsfw: desired.nsfw as boolean } : {}),
    ...(fieldSet.has("rateLimitPerUser")
      ? { rateLimitPerUser: desired.rateLimitPerUser as number }
      : {}),
    ...(fieldSet.has("rtcRegion") ? { rtcRegion: desired.rtcRegion } : {}),
    ...(fieldSet.has("topic") ? { topic: desired.topic } : {}),
    ...(fieldSet.has("userLimit") ? { userLimit: desired.userLimit as number } : {}),
    ...(fieldSet.has("videoQualityMode")
      ? { videoQualityMode: desired.videoQualityMode as number }
      : {}),
  }
}

function metadataMatches(
  observed: DiscordChannelMetadata,
  desired: DiscordChannelMetadata,
): boolean {
  return stableString(metadataSnapshot(observed)) === stableString(metadataSnapshot(desired))
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "UnknownError"
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    resourceId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: ChannelMetadataChangePlan
  request: NormalizedChannelMetadataChangeRequest
  status: ChannelMetadataActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): ChannelMetadataActivity {
  return {
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "channel-metadata-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    requestedFields: [...options.request.requestedFields].sort(),
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: ChannelMetadataChangePlan
  request: NormalizedChannelMetadataChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "channel-metadata-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.channelId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof ChannelMetadataExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withChannelLock<T>(
  channelId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ChannelMetadataExecutionError,
): Promise<T> {
  const prior = CHANNEL_METADATA_LOCKS.get(channelId)
    ?? Promise.resolve(
      CHANNEL_METADATA_UNCERTAIN_CHANNELS.has(channelId)
        ? "uncertain" as const
        : "settled" as const,
    )
  let release: (outcome: ChannelMetadataTargetOutcome) => void = () => undefined
  const tail = new Promise<ChannelMetadataTargetOutcome>((resolve) => {
    release = resolve
  })
  CHANNEL_METADATA_LOCKS.set(channelId, tail)
  let outcome: ChannelMetadataTargetOutcome = "settled"
  try {
    if (await prior === "uncertain") {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (uncertainExecution(error)) outcome = "uncertain"
    throw error
  } finally {
    if (outcome === "uncertain") CHANNEL_METADATA_UNCERTAIN_CHANNELS.add(channelId)
    release(outcome)
    if (CHANNEL_METADATA_LOCKS.get(channelId) === tail) {
      CHANNEL_METADATA_LOCKS.delete(channelId)
    }
  }
}

export class ChannelMetadataService {
  readonly #activityStore: ActivityStore
  readonly #client: ChannelMetadataServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ChannelMetadataServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: ChannelMetadataServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async get(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<ChannelMetadataReadResult> {
    assertChannelMetadataChannelId(channelId)
    const metadata = exactMetadata(
      await this.#client.getGuildChannelMetadata(channelId, options),
      channelId,
    )
    this.#policy.assertChannelReadable(metadataChannel(metadata))
    return {
      metadata: metadataView(metadata),
      privacy: {
        persistence: "none",
        rawPayloads: "omitted",
        text: "included",
        unknownFields: "counts-only",
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #state(
    botId: string,
    request: NormalizedChannelMetadataChangeRequest,
    options: RequestOptions,
  ): Promise<ChannelMetadataState> {
    const metadata = exactMetadata(
      await this.#client.getGuildChannelMetadata(request.channelId, options),
      request.channelId,
    )
    const guildId = this.#policy.assertChannelMetadataChangeAllowed(
      metadataChannel(metadata),
    )
    if (guildId !== request.guildId || metadata.guildId !== request.guildId) {
      throw new ChannelMetadataEvidenceError(
        "Discord channel metadata belongs to a different guild than requested",
      )
    }
    const existingReceipt = await this.#operationStore.get(
      "channel-metadata-change",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new ChannelMetadataOperationConflictError(receiptView(existingReceipt))
    }
    const [guildValue, memberValue, rolesValue, regionsValue] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      VOICE_TYPES.has(metadata.type) && typeof request.rtcRegion === "string"
        ? this.#client.listGuildVoiceRegions(guildId, options)
        : Promise.resolve(null),
    ])
    const guild = exactGuild(guildValue, guildId)
    const botMember = exactMember(memberValue, guildId, botId)
    const roles = exactRoles(rolesValue, guildId, botMember.roles)
    return {
      access: accessEvidence(botId, guild.owner_id, metadata, botMember, roles),
      botMember,
      guild,
      metadata,
      regions: regionsValue === null ? null : exactVoiceRegions(regionsValue),
      roles,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedChannelMetadataChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltChannelMetadataPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(botId, request, options)
    const desired = desiredMetadata(state.metadata, request)
    const voiceSettings = voiceSettingsEvidence({
      guild: state.guild,
      metadata: state.metadata,
      planKey: this.#planKey,
      regions: state.regions,
      request,
    })
    const changes = metadataChanges(state.metadata, desired, request.requestedFields)
    const changedFields = changes.map(({ field }) => field)
    const warnings = [
      ...(request.requestedFields.includes("name")
        ? ["Renaming a channel can disrupt user navigation, links by name, and operational conventions"]
        : []),
      ...(request.requestedFields.includes("nsfw")
        ? ["Changing the NSFW setting changes the client access warning and age-gating behavior"]
        : []),
      ...(request.requestedFields.some((field) => (
        field === "rateLimitPerUser" || field === "defaultThreadRateLimitPerUser"
      ))
        ? ["Slowmode changes affect how frequently members can send messages"]
        : []),
      ...(request.requestedFields.includes("bitrate")
        ? ["Bitrate changes affect voice quality and network use for active and future participants"]
        : []),
      ...(request.requestedFields.includes("userLimit")
        ? ["User-limit changes can prevent additional members from joining a voice or Stage channel"]
        : []),
      ...(request.requestedFields.includes("rtcRegion")
        ? ["Voice-region changes can interrupt or degrade an active call; null restores Discord's automatic selection"]
        : []),
      ...(request.requestedFields.includes("videoQualityMode")
        ? ["Video-quality changes affect camera resolution and bandwidth for active and future participants"]
        : []),
      "Channel, guild, and voice-region text is untrusted Discord data and is never persisted by this workflow",
      "Same-channel serialization is process-local; do not run multiple connector processes with overlapping channel-metadata scope",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const risks = [
      "The PATCH is not automatically retried, so an ambiguous transport outcome remains uncertain",
      "A successful response and a fresh GET are both checked against the complete reviewed metadata snapshot",
      "Voice-setting limits and explicit region availability are rebound from fresh guild evidence before execution",
      "Deletion, channel moves, type conversion, overwrite replacement, and forum-tag replacement are outside this workflow",
    ]
    const currentView = metadataView(state.metadata)
    const desiredView = metadataView(desired)
    const digest = reviewedPlanDigest(this.#planKey, {
      access: state.access,
      applicationId,
      auditReason: request.auditReason,
      botId,
      botMember: memberSnapshot(state.botMember),
      current: metadataSnapshot(state.metadata),
      desired: metadataSnapshot(desired),
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      localLimits: CHANNEL_METADATA_LOCAL_LIMITS,
      operationKeyHash: request.operationKeyHash,
      requestedFields: request.requestedFields,
      roles: roleSnapshot(state.roles),
      voiceSettings,
    })
    const plan: ChannelMetadataChangePlan = {
      access: state.access,
      applicationId,
      auditReason: request.auditReason,
      botId,
      changedFields,
      changes,
      createdAt: this.#clock().toISOString(),
      current: currentView,
      desired: desiredView,
      digest,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
      },
      localLimits: CHANNEL_METADATA_LOCAL_LIMITS,
      operationKeyHash: request.operationKeyHash,
      privacy: {
        persistence: "none",
        rawPayloads: "omitted",
        text: "included",
        unknownFields: "counts-only",
      },
      requestedFields: request.requestedFields,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: changes.length === 0 ? "already-current" : "planned",
      warnings,
      voiceSettings,
      writeRequired: changes.length > 0,
    }
    return { plan, request, state }
  }

  plan(
    applicationId: string,
    botId: string,
    request: ChannelMetadataChangeRequest,
    options: RequestOptions = {},
  ): Promise<ChannelMetadataChangePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeChannelMetadataChangeRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  execute(
    applicationId: string,
    botId: string,
    request: ChannelMetadataChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelMetadataChangeResult> {
    const normalized = normalizeChannelMetadataChangeRequest(request)
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord channel metadata plan digest is invalid")
    }
    return withChannelLock(
      normalized.channelId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ChannelMetadataExecutionError(
        "Discord channel metadata change was blocked because a prior same-channel operation ended with an uncertain outcome",
        {
          channelId: normalized.channelId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedChannelMetadataChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ChannelMetadataChangeResult> {
    let built: BuiltChannelMetadataPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ChannelMetadataEvidenceError
        || error instanceof RangeError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ChannelMetadataPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new ChannelMetadataPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        observed: plan.current,
        readbackMatched: true,
        responseMatched: true,
        status: "already-current",
        verification: "not-required",
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: request.guildId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ChannelMetadataOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        guildId: request.guildId,
        plan,
        request,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          guildId: request.guildId,
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ChannelMetadataExecutionError(
        "Discord channel metadata change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let mutationCompleted = false
    let observed = plan.current
    let responseMatched: boolean | null = null
    let readbackMatched: boolean | null = null
    try {
      const response = exactMetadata(
        await this.#client.modifyGuildChannelMetadata(
          request.channelId,
          patchInput(desiredMetadata(state.metadata, request), plan.changedFields),
          request.auditReason,
          options,
        ),
        request.channelId,
      )
      mutationCompleted = true
      if (response.guildId !== request.guildId) {
        throw new ChannelMetadataEvidenceError(
          "Discord channel metadata response changed guild identity",
        )
      }
      responseMatched = metadataMatches(response, desiredMetadata(state.metadata, request))
      const readback = exactMetadata(
        await this.#client.getGuildChannelMetadata(request.channelId, options),
        request.channelId,
      )
      if (readback.guildId !== request.guildId) {
        throw new ChannelMetadataEvidenceError(
          "Discord channel metadata readback changed guild identity",
        )
      }
      observed = metadataView(readback)
      readbackMatched = metadataMatches(readback, desiredMetadata(state.metadata, request))
    } catch (error) {
      const status = !mutationCompleted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          guildId: request.guildId,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: errorCode,
          guildId: request.guildId,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ChannelMetadataExecutionError(
        "Discord channel metadata change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          observed,
          operationRecordError,
          readbackMatched,
          responseMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = responseMatched && readbackMatched ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: ChannelMetadataChangeResult = {
      ...baseResult,
      activityId,
      observed,
      readbackMatched: readbackMatched as boolean,
      responseMatched: responseMatched as boolean,
      status,
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: request.guildId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: safeErrorCode(error),
          guildId: request.guildId,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ChannelMetadataExecutionError(
        "Discord channel metadata change completed but the operation receipt failed",
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
        activityId,
        guildId: request.guildId,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new ChannelMetadataExecutionError(
        "Discord channel metadata change completed but the final activity record failed",
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
