import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ChannelCloneActivity,
  ChannelCloneActivityStatus,
} from "./activity-log.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  DISCORD_PERMISSIONS,
  discordPermissionNames,
  evaluateBotChannelPermissions,
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  parseDiscordPermissionBits,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import {
  CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_FORUM_LAYOUTS,
  DISCORD_FORUM_SORT_ORDERS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_VIDEO_QUALITY_MODES,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type CreateGuildChannelInput,
  type CreateGuildChannelPermissionOverwriteInput,
  type DiscordClient,
} from "./discord-client.js"
import {
  ChannelCloneEvidenceError,
  ChannelCloneExecutionError,
  ChannelCloneOperationConflictError,
  ChannelClonePlanChangedError,
  ChannelCloneVerificationTimeoutError,
  DiscordApiError,
} from "./errors.js"
import type {
  GatewayChannelLayoutEntry,
  GatewayChannelLayoutSnapshot,
  GatewayChannelLayoutSource,
} from "./gateway-channel-layout.js"
import {
  collectGuildChannelEvidence,
  exactGatewayChannelLayout,
  GuildChannelEvidenceError,
  type GuildChannelEvidence,
  type GuildChannelHttpEvidenceMode,
} from "./guild-channel-evidence.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import {
  normalizeDiscordRoleInventory,
  type NormalizedDiscordRole,
} from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "channel-clone-state-unavailable"
const CHANNEL_CLONE_LOCKS = new Map<string, Promise<ChannelCloneTargetOutcome>>()
const CHANNEL_CLONE_UNCERTAIN_GUILDS = new Set<string>()
const DEFAULT_VERIFICATION_TIMEOUT_MS = 10_000
const MAX_VERIFICATION_TIMEOUT_MS = 60_000
const DEFAULT_AUTO_ARCHIVE_DURATION = 1_440
const CHANNEL_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const CHANNEL_TOPIC_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const UNICODE_EMOJI_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u
const SUPPORTED_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.category,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const TYPE_NAMES: Readonly<Record<number, ChannelCloneType>> = Object.freeze({
  [DISCORD_CHANNEL_TYPES.announcement]: "announcement",
  [DISCORD_CHANNEL_TYPES.category]: "category",
  [DISCORD_CHANNEL_TYPES.forum]: "forum",
  [DISCORD_CHANNEL_TYPES.media]: "media",
  [DISCORD_CHANNEL_TYPES.stageVoice]: "stage",
  [DISCORD_CHANNEL_TYPES.text]: "text",
  [DISCORD_CHANNEL_TYPES.voice]: "voice",
})
const TOPIC_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const VOICE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
])
const SLOWMODE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const NSFW_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const THREAD_DEFAULT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const TAG_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
])
const FLAG_MASKS: ReadonlyMap<number, number> = new Map([
  [DISCORD_CHANNEL_TYPES.text, DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
  [DISCORD_CHANNEL_TYPES.voice, DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
  [DISCORD_CHANNEL_TYPES.announcement, DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
  [DISCORD_CHANNEL_TYPES.forum,
    DISCORD_CHANNEL_FLAGS.requireTag | DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
  [DISCORD_CHANNEL_TYPES.media,
    DISCORD_CHANNEL_FLAGS.requireTag
      | DISCORD_CHANNEL_FLAGS.hideMediaDownloadOptions
      | DISCORD_CHANNEL_FLAGS.isSpoilerChannel],
])
const CHANNEL_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "applied_tags",
  "application_id",
  "available_tags",
  "bitrate",
  "default_auto_archive_duration",
  "default_forum_layout",
  "default_reaction_emoji",
  "default_sort_order",
  "default_thread_rate_limit_per_user",
  "flags",
  "guild_id",
  "icon",
  "id",
  "last_message_id",
  "last_pin_timestamp",
  "managed",
  "member",
  "member_count",
  "message_count",
  "name",
  "nsfw",
  "owner_id",
  "parent_id",
  "permission_overwrites",
  "permissions",
  "position",
  "rate_limit_per_user",
  "recipients",
  "rtc_region",
  "thread_metadata",
  "topic",
  "total_message_sent",
  "type",
  "user_limit",
  "video_quality_mode",
])
const OVERWRITE_KEYS: ReadonlySet<string> = new Set([
  "allow",
  "deny",
  "id",
  "type",
])
const TAG_KEYS: ReadonlySet<string> = new Set([
  "emoji_id",
  "emoji_name",
  "id",
  "moderated",
  "name",
])
const REACTION_KEYS: ReadonlySet<string> = new Set([
  "emoji_id",
  "emoji_name",
])
const REQUEST_KEYS: ReadonlySet<string> = new Set([
  "auditReason",
  "guildId",
  "name",
  "operationKey",
  "sourceChannelId",
])
const PRIVACY_OMISSIONS = Object.freeze([
  "auditReason",
  "childResources",
  "hiddenChannelMetadata",
  "memberProfiles",
  "messages",
  "rawOperationKey",
  "rawPayloads",
] as const)

type ChannelCloneTargetOutcome = "settled" | "uncertain"
export type ChannelCloneType =
  | "announcement"
  | "category"
  | "forum"
  | "media"
  | "stage"
  | "text"
  | "voice"

export interface ChannelCloneRequest {
  auditReason: string
  guildId: string
  name?: string
  operationKey: string
  sourceChannelId: string
}

export interface NormalizedChannelCloneRequest {
  auditReason: string
  guildId: string
  name: string | null
  operationKey: string
  operationKeyHash: string
  sourceChannelId: string
}

export interface ChannelCloneTagState {
  emojiId: string | null
  emojiName: string | null
  id: string
  moderated: boolean
  name: string
}

export interface ChannelCloneState {
  availableTags: ChannelCloneTagState[] | null
  bitrate: number | null
  defaultAutoArchiveDuration: number | null
  defaultForumLayout: number | null
  defaultReactionEmoji: {
    emojiId: string | null
    emojiName: string | null
  } | null
  defaultSortOrder: number | null
  defaultThreadRateLimitPerUser: number | null
  flags: number
  guildId: string
  id: string
  name: string
  nsfw: boolean | null
  parentId: string | null
  permissionOverwrites: CreateGuildChannelPermissionOverwriteInput[]
  position: number
  rateLimitPerUser: number | null
  rtcRegion: string | null
  topic: string | null
  type: number
  typeName: ChannelCloneType
  userLimit: number | null
  videoQualityMode: number | null
}

export interface ChannelClonePlan {
  applicationId: string
  auditReason: string
  botId: string
  capacity: {
    guildChannels: number
    guildLimit: number
    parentChildren: number | null
    parentLimit: number | null
  }
  createdAt: string
  digest: string
  evidence: {
    httpMode: GuildChannelHttpEvidenceMode
    layoutRevision: number
    layoutUpdatedAt: string
    obfuscatedChannels: number
  }
  guild: {
    features: string[]
    id: string
    name: string
    ownerId: string
    premiumTier: number
  }
  operationKeyHash: string
  parent: {
    id: string
    name: string
  } | null
  permission: {
    administrator: boolean
    guildEffectivePermissionNames: DiscordPermissionName[]
    guildEffectivePermissions: string
    guildManageChannels: boolean
    sourceEffectivePermissionNames: DiscordPermissionName[]
    sourceEffectivePermissions: string
    sourceViewChannel: boolean
  }
  privacy: {
    channelMetadata: "transient-untrusted"
    hiddenMetadataReturned: false
    omittedFields: readonly string[]
    persistence: "content-free-only"
  }
  risks: string[]
  schemaVersion: number
  source: ChannelCloneState
  status: "planned"
  target: {
    payload: CreateGuildChannelInput
    placement: "discord-default"
    regeneratedTagIds: boolean
  }
  warnings: string[]
}

export interface ChannelCloneResult {
  activityId: string
  baselineLayoutRevision: number
  createdChannelId: string
  guildId: string
  observedLayoutRevision: number
  operationKeyHash: string
  parentId: string | null
  planDigest: string
  schemaVersion: number
  sourceChannelId: string
  status: "completed"
  tagIdMap: Array<{
    createdTagId: string
    sourceTagId: string
  }>
  type: number
  typeName: ChannelCloneType
  verification: "match"
}

export interface ChannelCloneServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "createGuildChannel"
    | "getChannel"
    | "getGuild"
    | "getGuildChannels"
    | "getGuildMember"
    | "getGuildRoles"
  >
  clock?: () => Date
  layoutSource: GatewayChannelLayoutSource
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<ScopePolicy, "assertChannelCloneAuditable" | "assertChannelCloneable" | "assertChannelReadable">
  randomId?: () => string
  verificationTimeoutMs?: number
}

interface ValidatedGuild extends DiscordGuild {
  features: string[]
  owner_id: string
  premium_tier: number
}

interface ChannelCloneEvidenceState {
  botMember: DiscordGuildMember
  guild: ValidatedGuild
  guildPermissions: GuildMemberPermissionResult
  httpMode: GuildChannelHttpEvidenceMode
  layout: GatewayChannelLayoutSnapshot
  parent: { id: string; name: string } | null
  parentChildren: number | null
  roles: NormalizedDiscordRole[]
  source: ChannelCloneState
  sourcePermissions: ReturnType<typeof evaluateBotChannelPermissions>
}

interface BuiltChannelClonePlan {
  plan: ChannelClonePlan
  state: ChannelCloneEvidenceState
}

interface CloneLayoutWatch {
  arm(): void
  close(): void
  expect(channelId: string, parentId: string | null, type: number): void
  latest(): GatewayChannelLayoutSnapshot | null
  wait(signal?: AbortSignal): Promise<GatewayChannelLayoutSnapshot>
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key))
}

function snowflake(value: unknown): string | undefined {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) return undefined
  const parsed = BigInt(value)
  return parsed >= 1n && parsed <= DISCORD_SNOWFLAKE_MAX ? value : undefined
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function evidenceError(message: string, cause?: unknown): ChannelCloneEvidenceError {
  return new ChannelCloneEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function assertName(value: unknown, description: string): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > DISCORD_LIMITS.channelNameCharacters
    || value.trim() !== value
    || CHANNEL_NAME_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw new RangeError(`${description} is invalid`)
}

export function normalizeChannelCloneRequest(
  request: ChannelCloneRequest,
): NormalizedChannelCloneRequest {
  const record = recordValue(request)
  if (
    !record
    || !hasOnlyKeys(record, REQUEST_KEYS)
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
    || !snowflake(request.guildId)
    || !snowflake(request.sourceChannelId)
  ) throw new RangeError("Discord channel-clone request must be an exact object with snowflake IDs")
  if (request.name !== undefined) assertName(request.name, "Discord cloned channel name")
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    guildId: request.guildId,
    name: request.name ?? null,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    sourceChannelId: request.sourceChannelId,
  }
}

function exactInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  description: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw evidenceError(`Discord returned invalid ${description}`)
  }
  return value as number
}

function exactTopic(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== "string"
    || value.length > DISCORD_LIMITS.channelTopicCharacters
    || CHANNEL_TOPIC_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw evidenceError("Discord returned channel text that cannot be cloned atomically")
  return value
}

function exactRtcRegion(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > DISCORD_LIMITS.voiceRegionIdCharacters
    || CHANNEL_NAME_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw evidenceError("Discord returned an invalid channel voice region")
  return value
}

function exactEmojiName(value: unknown, description: string): string | null {
  if (value === null) return null
  const segments = typeof value === "string"
    ? [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
    : []
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 100
    || /[\u0000-\u0020\u007F]/u.test(value)
    || !validUnicode(value)
    || segments.length !== 1
    || segments[0]?.segment !== value
    || !UNICODE_EMOJI_PATTERN.test(value)
  ) throw evidenceError(`Discord returned invalid ${description}`)
  return value
}

function exactDefaultReaction(value: unknown): ChannelCloneState["defaultReactionEmoji"] {
  if (value === undefined || value === null) return null
  const record = recordValue(value)
  if (!record || !hasOnlyKeys(record, REACTION_KEYS)) {
    throw evidenceError("Discord returned invalid channel default-reaction evidence")
  }
  const emojiId = record.emoji_id === null ? null : snowflake(record.emoji_id)
  const emojiName = exactEmojiName(record.emoji_name ?? null, "default reaction emoji")
  if (
    (record.emoji_id !== undefined && record.emoji_id !== null && !emojiId)
    || (emojiId === undefined || emojiId === null) === (emojiName === null)
  ) {
    throw evidenceError("Discord returned a default reaction without exactly one emoji")
  }
  return {
    emojiId: emojiId ?? null,
    emojiName,
  }
}

function exactTags(value: unknown): ChannelCloneTagState[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.forumAvailableTags) {
    throw evidenceError("Discord returned an invalid available-tag inventory")
  }
  const ids = new Set<string>()
  return value.map((candidate) => {
    const record = recordValue(candidate)
    const id = snowflake(record?.id)
    if (
      !record
      || !hasOnlyKeys(record, TAG_KEYS)
      || !id
      || ids.has(id)
      || typeof record.name !== "string"
      || [...record.name].length > DISCORD_LIMITS.forumTagNameCharacters
      || CHANNEL_NAME_CONTROL_PATTERN.test(record.name)
      || !validUnicode(record.name)
      || typeof record.moderated !== "boolean"
    ) throw evidenceError("Discord returned invalid available-tag evidence")
    const emojiId = record.emoji_id === null ? null : snowflake(record.emoji_id)
    const emojiName = exactEmojiName(record.emoji_name ?? null, "available-tag emoji")
    if (
      (record.emoji_id !== undefined && record.emoji_id !== null && !emojiId)
      || (emojiId !== null && emojiId !== undefined && emojiName !== null)
    ) throw evidenceError("Discord returned conflicting available-tag emoji evidence")
    ids.add(id)
    return {
      emojiId: emojiId ?? null,
      emojiName,
      id,
      moderated: record.moderated,
      name: record.name,
    }
  })
}

function exactOverwrites(value: unknown): CreateGuildChannelPermissionOverwriteInput[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord returned an invalid channel overwrite inventory")
  }
  const ids = new Set<string>()
  return value.map((candidate) => {
    const record = recordValue(candidate)
    const id = snowflake(record?.id)
    if (
      !record
      || !hasOnlyKeys(record, OVERWRITE_KEYS)
      || !id
      || ids.has(id)
      || (record.type !== 0 && record.type !== 1)
      || typeof record.allow !== "string"
      || typeof record.deny !== "string"
    ) throw evidenceError("Discord returned invalid channel overwrite evidence")
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(record.allow, "channel-clone overwrite allow")
      deny = parseDiscordPermissionBits(record.deny, "channel-clone overwrite deny")
    } catch (error) {
      throw evidenceError("Discord returned invalid channel overwrite bitfields", error)
    }
    if (
      (allow & deny) !== 0n
      || unknownDiscordPermissionBits(allow | deny) !== 0n
    ) throw evidenceError("Discord channel clone cannot safely preserve overwrite permission bits")
    ids.add(id)
    return {
      allow: allow.toString(),
      deny: deny.toString(),
      id,
      type: record.type as 0 | 1,
    }
  }).sort((left, right) => (
    compareSnowflakes(left.id, right.id) || left.type - right.type
  ))
}

function neutralInteger(value: unknown): boolean {
  return value === undefined || value === null || value === 0
}

function exactChannelState(value: DiscordChannel, guildId: string): ChannelCloneState {
  const record = recordValue(value)
  const id = snowflake(record?.id)
  const type = record?.type
  const parentId = record?.parent_id === undefined || record.parent_id === null
    ? null
    : snowflake(record.parent_id)
  if (
    !record
    || !hasOnlyKeys(record, CHANNEL_RESPONSE_KEYS)
    || !id
    || record.guild_id !== guildId
    || !Number.isSafeInteger(type)
    || !SUPPORTED_TYPES.has(type as number)
    || !(record.parent_id === undefined || record.parent_id === null || parentId)
    || !Number.isSafeInteger(record.position)
    || (record.position as number) < 0
    || !(record.managed === undefined || record.managed === false)
    || (record.application_id !== undefined && record.application_id !== null)
  ) throw evidenceError("Discord returned channel evidence that is not safely cloneable")
  try {
    assertName(record.name, "Discord source channel name")
  } catch (error) {
    throw evidenceError("Discord returned an invalid source channel name", error)
  }
  const channelType = type as number
  if (channelType === DISCORD_CHANNEL_TYPES.category && parentId !== null) {
    throw evidenceError("Discord returned a parented category source")
  }
  const overwrites = exactOverwrites(record.permission_overwrites)
  const flags = record.flags === undefined
    ? 0
    : exactInteger(record.flags, 0, Number.MAX_SAFE_INTEGER, "channel flags")
  const allowedFlags = FLAG_MASKS.get(channelType) ?? 0
  if ((BigInt(flags) & ~BigInt(allowedFlags)) !== 0n) {
    throw evidenceError("Discord source channel has flags that cannot be cloned safely")
  }
  const nsfw = NSFW_TYPES.has(channelType)
    ? (record.nsfw === undefined ? false : record.nsfw as boolean)
    : null
  if (
    (NSFW_TYPES.has(channelType) && typeof nsfw !== "boolean")
    || (!NSFW_TYPES.has(channelType) && record.nsfw !== undefined && record.nsfw !== false)
    || (nsfw === true && (
      BigInt(flags) & BigInt(DISCORD_CHANNEL_FLAGS.isSpoilerChannel)
    ) !== 0n)
  ) throw evidenceError("Discord source channel has an unsupported age-restriction state")
  const topic = TOPIC_TYPES.has(channelType) ? exactTopic(record.topic) : null
  if (!TOPIC_TYPES.has(channelType) && record.topic !== undefined && record.topic !== null) {
    throw evidenceError("Discord source channel has an inapplicable topic")
  }
  const rateLimitPerUser = SLOWMODE_TYPES.has(channelType)
    ? exactInteger(record.rate_limit_per_user ?? 0, 0, DISCORD_LIMITS.channelRateLimitSeconds, "channel slowmode")
    : null
  if (!SLOWMODE_TYPES.has(channelType) && !neutralInteger(record.rate_limit_per_user)) {
    throw evidenceError("Discord source channel has an inapplicable slowmode")
  }
  const defaultAutoArchiveDuration = THREAD_DEFAULT_TYPES.has(channelType)
    ? exactInteger(
        record.default_auto_archive_duration ?? DEFAULT_AUTO_ARCHIVE_DURATION,
        0,
        CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS.at(-1) as number,
        "default auto-archive duration",
      )
    : null
  if (
    defaultAutoArchiveDuration !== null
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(defaultAutoArchiveDuration)
  ) throw evidenceError("Discord source channel has an unsupported auto-archive duration")
  if (
    !THREAD_DEFAULT_TYPES.has(channelType)
    && record.default_auto_archive_duration !== undefined
    && record.default_auto_archive_duration !== null
  ) throw evidenceError("Discord source channel has an inapplicable auto-archive duration")
  const defaultThreadRateLimitPerUser = THREAD_DEFAULT_TYPES.has(channelType)
    ? exactInteger(
        record.default_thread_rate_limit_per_user ?? 0,
        0,
        DISCORD_LIMITS.channelRateLimitSeconds,
        "default thread slowmode",
      )
    : null
  if (
    !THREAD_DEFAULT_TYPES.has(channelType)
    && !neutralInteger(record.default_thread_rate_limit_per_user)
  ) throw evidenceError("Discord source channel has an inapplicable thread slowmode")
  const bitrate = VOICE_TYPES.has(channelType)
    ? exactInteger(
        record.bitrate,
        DISCORD_LIMITS.channelBitrateMinimum,
        DISCORD_LIMITS.voiceChannelBitrateMaximum,
        "channel bitrate",
      )
    : null
  if (!VOICE_TYPES.has(channelType) && record.bitrate !== undefined) {
    throw evidenceError("Discord source channel has an inapplicable bitrate")
  }
  const userLimit = VOICE_TYPES.has(channelType)
    ? exactInteger(
        record.user_limit ?? 0,
        0,
        channelType === DISCORD_CHANNEL_TYPES.voice
          ? DISCORD_LIMITS.voiceChannelUserLimit
          : DISCORD_LIMITS.stageChannelUserLimit,
        "channel user limit",
      )
    : null
  if (!VOICE_TYPES.has(channelType) && !neutralInteger(record.user_limit)) {
    throw evidenceError("Discord source channel has an inapplicable user limit")
  }
  const rtcRegion = VOICE_TYPES.has(channelType) ? exactRtcRegion(record.rtc_region) : null
  if (!VOICE_TYPES.has(channelType) && record.rtc_region !== undefined && record.rtc_region !== null) {
    throw evidenceError("Discord source channel has an inapplicable voice region")
  }
  const videoQualityMode = VOICE_TYPES.has(channelType)
    ? exactInteger(
        record.video_quality_mode ?? DISCORD_VIDEO_QUALITY_MODES.auto,
        DISCORD_VIDEO_QUALITY_MODES.auto,
        DISCORD_VIDEO_QUALITY_MODES.full,
        "channel video quality mode",
      )
    : null
  if (!VOICE_TYPES.has(channelType) && !neutralInteger(record.video_quality_mode)) {
    throw evidenceError("Discord source channel has an inapplicable video quality mode")
  }
  const availableTags = TAG_TYPES.has(channelType)
    ? exactTags(record.available_tags)
    : null
  if (
    !TAG_TYPES.has(channelType)
    && record.available_tags !== undefined
    && (!Array.isArray(record.available_tags) || record.available_tags.length > 0)
  ) throw evidenceError("Discord source channel has inapplicable available tags")
  const defaultReactionEmoji = TAG_TYPES.has(channelType)
    ? exactDefaultReaction(record.default_reaction_emoji)
    : null
  if (
    !TAG_TYPES.has(channelType)
    && record.default_reaction_emoji !== undefined
    && record.default_reaction_emoji !== null
  ) throw evidenceError("Discord source channel has an inapplicable default reaction")
  const defaultSortOrder = TAG_TYPES.has(channelType)
    ? (record.default_sort_order === undefined || record.default_sort_order === null
        ? null
        : exactInteger(
            record.default_sort_order,
            DISCORD_FORUM_SORT_ORDERS.latestActivity,
            DISCORD_FORUM_SORT_ORDERS.creationDate,
            "default forum sort order",
          ))
    : null
  if (
    !TAG_TYPES.has(channelType)
    && record.default_sort_order !== undefined
    && record.default_sort_order !== null
  ) throw evidenceError("Discord source channel has an inapplicable default sort order")
  const defaultForumLayout = channelType === DISCORD_CHANNEL_TYPES.forum
    ? exactInteger(
        record.default_forum_layout ?? DISCORD_FORUM_LAYOUTS.notSet,
        DISCORD_FORUM_LAYOUTS.notSet,
        DISCORD_FORUM_LAYOUTS.gallery,
        "default forum layout",
      )
    : null
  if (
    channelType !== DISCORD_CHANNEL_TYPES.forum
    && !neutralInteger(record.default_forum_layout)
  ) throw evidenceError("Discord source channel has an inapplicable forum layout")
  return {
    availableTags,
    bitrate,
    defaultAutoArchiveDuration,
    defaultForumLayout,
    defaultReactionEmoji,
    defaultSortOrder,
    defaultThreadRateLimitPerUser,
    flags,
    guildId,
    id,
    name: record.name as string,
    nsfw,
    parentId: parentId ?? null,
    permissionOverwrites: overwrites,
    position: record.position as number,
    rateLimitPerUser,
    rtcRegion,
    topic,
    type: channelType,
    typeName: TYPE_NAMES[channelType] as ChannelCloneType,
    userLimit,
    videoQualityMode,
  }
}

function clonePayload(source: ChannelCloneState, name: string): CreateGuildChannelInput {
  const payload: CreateGuildChannelInput = {
    name,
    permissionOverwrites: source.permissionOverwrites.map((overwrite) => ({ ...overwrite })),
    type: source.type,
  }
  if (source.parentId !== null) payload.parentId = source.parentId
  if (TOPIC_TYPES.has(source.type)) payload.topic = source.topic
  if (VOICE_TYPES.has(source.type)) {
    payload.bitrate = source.bitrate as number
    payload.rtcRegion = source.rtcRegion
    payload.userLimit = source.userLimit as number
    payload.videoQualityMode = source.videoQualityMode as number
  }
  if (SLOWMODE_TYPES.has(source.type)) {
    payload.rateLimitPerUser = source.rateLimitPerUser as number
  }
  if (NSFW_TYPES.has(source.type)) payload.nsfw = source.nsfw as boolean
  if (THREAD_DEFAULT_TYPES.has(source.type)) {
    payload.defaultAutoArchiveDuration = source.defaultAutoArchiveDuration as number
    payload.defaultThreadRateLimitPerUser = source.defaultThreadRateLimitPerUser as number
  }
  if (TAG_TYPES.has(source.type)) {
    payload.availableTags = (source.availableTags ?? []).map((tag) => ({
      emojiId: tag.emojiId,
      emojiName: tag.emojiName,
      moderated: tag.moderated,
      name: tag.name,
    }))
    payload.defaultReactionEmoji = source.defaultReactionEmoji
      ? { ...source.defaultReactionEmoji }
      : null
    payload.defaultSortOrder = source.defaultSortOrder
  }
  if (source.type === DISCORD_CHANNEL_TYPES.forum) {
    payload.defaultForumLayout = source.defaultForumLayout as number
  }
  if (FLAG_MASKS.has(source.type)) payload.flags = source.flags
  return payload
}

function exactGuild(value: DiscordGuild, guildId: string): ValidatedGuild {
  const record = recordValue(value)
  const ownerId = snowflake(record?.owner_id)
  if (
    !record
    || record.id !== guildId
    || !ownerId
    || typeof record.name !== "string"
    || record.name.length < 1
    || record.name.length > DISCORD_LIMITS.channelNameCharacters
    || CHANNEL_NAME_CONTROL_PATTERN.test(record.name)
    || !validUnicode(record.name)
    || !Array.isArray(record.features)
    || record.features.length > DISCORD_LIMITS.guildFeatures
    || record.features.some((feature) => (
      typeof feature !== "string"
      || feature.length < 1
      || feature.length > DISCORD_LIMITS.guildFeatureCharacters
      || CHANNEL_NAME_CONTROL_PATTERN.test(feature)
      || !validUnicode(feature)
    ))
    || new Set(record.features).size !== record.features.length
    || !Number.isSafeInteger(record.premium_tier)
    || (record.premium_tier as number) < 0
    || (record.premium_tier as number) > 3
  ) throw evidenceError("Discord returned invalid channel-clone guild evidence")
  return {
    ...value,
    features: [...record.features as string[]].sort(),
    owner_id: ownerId,
    premium_tier: record.premium_tier as number,
  }
}

function exactBotMember(
  value: DiscordGuildMember,
  botId: string,
  roles: readonly NormalizedDiscordRole[],
  guildId: string,
): DiscordGuildMember {
  const roleIds = new Set(roles.map((role) => role.id))
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !value.user
    || value.user.id !== botId
    || value.user.bot !== true
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !snowflake(roleId) || !roleIds.has(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) throw evidenceError("Discord returned invalid connector membership for channel cloning")
  return {
    ...value,
    roles: [...value.roles].sort(compareSnowflakes),
    user: {
      bot: true,
      id: botId,
      username: typeof value.user.username === "string" ? value.user.username : "connector",
    },
  }
}

function exactGuildPermissions(
  guildId: string,
  member: DiscordGuildMember,
  roles: readonly DiscordRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError("Discord connector channel-clone permission evidence is invalid", error)
  }
  if (!result.complete) {
    throw evidenceError(
      `Discord connector channel-clone permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  return result
}

function maximumVoiceBitrate(guild: ValidatedGuild): number {
  if (guild.premium_tier >= 3 || guild.features.includes("VIP_REGIONS")) {
    return DISCORD_LIMITS.voiceChannelBitrateMaximum
  }
  if (guild.premium_tier === 2) return 256_000
  if (guild.premium_tier === 1) return 128_000
  return 96_000
}

function assertSourceAuthority(options: {
  guild: ValidatedGuild
  guildPermissions: GuildMemberPermissionResult
  roles: readonly NormalizedDiscordRole[]
  source: ChannelCloneState
}): void {
  if (!hasGuildPermission(options.guildPermissions, "MANAGE_CHANNELS")) {
    throw evidenceError("Discord connector bot lacks guild-level MANAGE_CHANNELS for cloning")
  }
  const rolesById = new Set(options.roles.map((role) => role.id))
  let overwritePermissions = 0n
  for (const overwrite of options.source.permissionOverwrites) {
    if (overwrite.type === 0 && !rolesById.has(overwrite.id)) {
      throw evidenceError("Discord channel-clone overwrite references a missing role")
    }
    overwritePermissions |= BigInt(overwrite.allow) | BigInt(overwrite.deny)
  }
  if (
    (overwritePermissions & DISCORD_PERMISSIONS.MANAGE_ROLES) !== 0n
    && !options.guildPermissions.administrator
  ) throw evidenceError("Discord channel clone with MANAGE_ROLES overwrites requires ADMINISTRATOR")
  const available = options.guildPermissions.administrator
    ? ALL_KNOWN_PERMISSION_BITS
    : BigInt(options.guildPermissions.effectivePermissions)
  if ((overwritePermissions & ~available) !== 0n) {
    throw evidenceError("Discord connector bot lacks permissions present in source overwrites")
  }
  if (
    options.source.type === DISCORD_CHANNEL_TYPES.announcement
    && !options.guild.features.includes("NEWS")
  ) throw evidenceError("Discord guild lacks the NEWS feature required to clone announcement channels")
  if (
    options.source.type === DISCORD_CHANNEL_TYPES.voice
    && (options.source.bitrate as number) > maximumVoiceBitrate(options.guild)
  ) throw evidenceError("Discord source voice bitrate exceeds the guild's observed boost limit")
  if (
    options.source.type === DISCORD_CHANNEL_TYPES.stageVoice
    && (options.source.bitrate as number) > DISCORD_LIMITS.stageChannelBitrateMaximum
  ) throw evidenceError("Discord source Stage bitrate exceeds the documented limit")
}

function exactParent(
  channels: readonly DiscordChannel[],
  parentId: string | null,
  guildId: string,
): { id: string; name: string } | null {
  if (parentId === null) return null
  const matches = channels.filter((channel) => channel.id === parentId)
  const parent = matches[0]
  if (
    matches.length !== 1
    || !parent
    || parent.guild_id !== guildId
    || parent.type !== DISCORD_CHANNEL_TYPES.category
  ) throw evidenceError("Discord channel-clone parent metadata is unavailable")
  try {
    assertName(parent.name, "Discord source parent name")
  } catch (error) {
    throw evidenceError("Discord returned an invalid channel-clone parent", error)
  }
  return { id: parentId, name: parent.name as string }
}

function rolesSnapshot(roles: readonly NormalizedDiscordRole[]) {
  return [...roles]
    .sort((left, right) => compareSnowflakes(left.id, right.id))
    .map((role) => ({
      id: role.id,
      managed: role.managed,
      permissions: role.permissions,
      position: role.position,
      unknownFieldCount: role.unknownFieldCount,
      unknownPermissionBits: role.unknownPermissionBits,
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

function requestSnapshot(request: NormalizedChannelCloneRequest) {
  return {
    auditReason: request.auditReason,
    guildId: request.guildId,
    name: request.name,
    operationKeyHash: request.operationKeyHash,
    sourceChannelId: request.sourceChannelId,
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, 128)
  return normalized || "UnknownError"
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    createdChannelId: receipt.resourceId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function operationReceipt(options: {
  activityId: string
  createdChannelId?: string | null
  error?: string | null
  plan: ChannelClonePlan
  request: NormalizedChannelCloneRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "channel-clone",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.createdChannelId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function activityEntry(options: {
  activityId: string
  createdChannelId?: string | null
  error?: string | null
  observedRevision?: number | null
  plan: ChannelClonePlan
  request: NormalizedChannelCloneRequest
  status: ChannelCloneActivityStatus
  timestamp: string
  verification?: "match" | null
}): ChannelCloneActivity {
  return {
    baselineRevision: options.plan.evidence.layoutRevision,
    channelType: options.plan.source.type,
    createdChannelId: options.createdChannelId ?? null,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "channel-clone",
    observedRevision: options.observedRevision ?? null,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    sourceChannelId: options.request.sourceChannelId,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof ChannelCloneExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  const status = (error.result as { status?: unknown }).status
  return status === "uncertain" || status === "completed-operation-record-failed"
}

async function withGuildLock<T>(
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ChannelCloneExecutionError,
): Promise<T> {
  const prior = CHANNEL_CLONE_LOCKS.get(guildId) ?? Promise.resolve(
    CHANNEL_CLONE_UNCERTAIN_GUILDS.has(guildId)
      ? "uncertain" as const
      : "settled" as const,
  )
  let release: (outcome: ChannelCloneTargetOutcome) => void = () => undefined
  const tail = new Promise<ChannelCloneTargetOutcome>((resolve) => {
    release = resolve
  })
  CHANNEL_CLONE_LOCKS.set(guildId, tail)
  let outcome: ChannelCloneTargetOutcome = "settled"
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
    if (outcome === "uncertain") CHANNEL_CLONE_UNCERTAIN_GUILDS.add(guildId)
    release(outcome)
    if (CHANNEL_CLONE_LOCKS.get(guildId) === tail) {
      CHANNEL_CLONE_LOCKS.delete(guildId)
    }
  }
}

function sameBaselineTopology(
  baseline: GatewayChannelLayoutSnapshot,
  observed: GatewayChannelLayoutSnapshot,
): boolean {
  if (observed.channels.length !== baseline.channels.length + 1) return false
  const observedById = new Map(observed.channels.map((channel) => [channel.channelId, channel]))
  if (!baseline.channels.every((channel) => {
    const candidate = observedById.get(channel.channelId)
    return candidate
      && candidate.type === channel.type
      && candidate.parentChannelId === channel.parentChannelId
      && candidate.obfuscated === channel.obfuscated
  })) return false
  const baselineIds = new Set(baseline.channels.map((channel) => channel.channelId))
  const observedBaseline = observed.channels.filter((channel) => (
    baselineIds.has(channel.channelId)
  ))
  const baselineOrders = cloneLayoutGroupOrders(baseline.channels)
  const observedOrders = cloneLayoutGroupOrders(observedBaseline)
  if (baselineOrders.size !== observedOrders.size) return false
  return [...baselineOrders].every(([key, channelIds]) => (
    stableString(observedOrders.get(key)) === stableString(channelIds)
  ))
}

type CloneLayoutFamily = "category" | "text" | "unsupported" | "voice"

function cloneLayoutFamily(type: number): CloneLayoutFamily {
  if (type === DISCORD_CHANNEL_TYPES.category) return "category"
  if (TOPIC_TYPES.has(type)) return "text"
  if (VOICE_TYPES.has(type)) return "voice"
  return "unsupported"
}

function cloneLayoutGroupKey(channel: GatewayChannelLayoutEntry): string {
  const family = cloneLayoutFamily(channel.type)
  return `${channel.parentChannelId ?? "top"}\0${family}\0${
    family === "unsupported" ? channel.type : "supported"
  }`
}

function cloneLayoutGroupOrders(
  channels: readonly GatewayChannelLayoutEntry[],
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, GatewayChannelLayoutEntry[]>()
  for (const channel of channels) {
    const key = cloneLayoutGroupKey(channel)
    const entries = grouped.get(key) ?? []
    entries.push(channel)
    grouped.set(key, entries)
  }
  return new Map([...grouped].map(([key, entries]) => [
    key,
    entries.sort((left, right) => (
      left.position - right.position || compareSnowflakes(left.channelId, right.channelId)
    )).map((channel) => channel.channelId),
  ]))
}

function matchingCloneLayout(
  baseline: GatewayChannelLayoutSnapshot,
  observed: GatewayChannelLayoutSnapshot,
  expected: { channelId: string; parentId: string | null; type: number },
): boolean {
  if (
    observed.revision <= baseline.revision
    || baseline.channels.some((channel) => channel.channelId === expected.channelId)
    || !sameBaselineTopology(baseline, observed)
  ) {
    return false
  }
  const created = observed.channels.find((channel) => channel.channelId === expected.channelId)
  return created?.type === expected.type
    && created.parentChannelId === expected.parentId
    && created.obfuscated === false
}

function cloneLayoutWatch(options: {
  baseline: GatewayChannelLayoutSnapshot
  guildId: string
  source: GatewayChannelLayoutSource
  timeoutMs: number
}): CloneLayoutWatch {
  let armed = false
  let closed = false
  let expected: { channelId: string; parentId: string | null; type: number } | null = null
  let latest: GatewayChannelLayoutSnapshot | null = null
  let matched: GatewayChannelLayoutSnapshot | null = null
  let notify: (() => void) | null = null
  const inspect = () => {
    if (closed) return
    try {
      const candidate = exactGatewayChannelLayout(
        options.source.getChannelLayout(options.guildId),
        options.guildId,
      )
      if (candidate.revision <= options.baseline.revision) return
      latest = candidate
      if (armed && expected && matchingCloneLayout(options.baseline, candidate, expected)) {
        matched = candidate
        notify?.()
      }
    } catch {}
  }
  const unsubscribe = options.source.subscribeChannelLayouts((guildId) => {
    if (guildId === options.guildId) inspect()
  })
  inspect()
  return {
    arm() {
      if (closed || armed) throw evidenceError("Discord channel-clone verification watch is not armable")
      const current = exactGatewayChannelLayout(
        options.source.getChannelLayout(options.guildId),
        options.guildId,
      )
      if (
        current.revision !== options.baseline.revision
        || stableString(current.channels) !== stableString(options.baseline.channels)
      ) throw evidenceError("Discord channel layout changed before clone mutation")
      armed = true
    },
    close() {
      if (closed) return
      closed = true
      unsubscribe()
    },
    expect(channelId, parentId, type) {
      if (!armed || expected) throw evidenceError("Discord channel-clone expectation is not settable")
      expected = { channelId, parentId, type }
      inspect()
    },
    latest() {
      return latest
    },
    wait(signal) {
      inspect()
      if (matched) return Promise.resolve(matched)
      return new Promise<GatewayChannelLayoutSnapshot>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let abort: () => void = () => undefined
        const finish = (snapshot?: GatewayChannelLayoutSnapshot) => {
          if (timer !== undefined) clearTimeout(timer)
          signal?.removeEventListener("abort", abort)
          notify = null
          if (snapshot) resolve(snapshot)
          else reject(new ChannelCloneVerificationTimeoutError(
              "Discord channel-clone Gateway verification did not complete",
          ))
        }
        abort = () => finish()
        notify = () => finish(matched ?? undefined)
        if (signal?.aborted) {
          finish()
          return
        }
        signal?.addEventListener("abort", abort, { once: true })
        timer = setTimeout(() => finish(), options.timeoutMs)
        inspect()
        if (matched) finish(matched)
      })
    },
  }
}

function exactCreatedState(
  value: DiscordChannel,
  plan: ChannelClonePlan,
  expectedId?: string,
): ChannelCloneState {
  const state = exactChannelState(value, plan.guild.id)
  if (
    (expectedId !== undefined && state.id !== expectedId)
    || state.id === plan.source.id
    || state.type !== plan.source.type
    || state.parentId !== plan.source.parentId
    || stableString(clonePayload(state, state.name))
      !== stableString(plan.target.payload)
  ) throw evidenceError("Discord returned a created channel that does not match the clone plan")
  return state
}

function tagIdMap(
  source: ChannelCloneState,
  created: ChannelCloneState,
): ChannelCloneResult["tagIdMap"] {
  const sourceTags = source.availableTags ?? []
  const createdTags = created.availableTags ?? []
  if (sourceTags.length !== createdTags.length) {
    throw evidenceError("Discord regenerated an unexpected channel tag inventory")
  }
  const sourceTagIds = new Set(sourceTags.map((tag) => tag.id))
  return sourceTags.map((tag, index) => {
    const createdTag = createdTags[index]
    if (!createdTag) throw evidenceError("Discord omitted a regenerated channel tag")
    if (sourceTagIds.has(createdTag.id)) {
      throw evidenceError("Discord did not regenerate a channel-local tag ID")
    }
    return {
      createdTagId: createdTag.id,
      sourceTagId: tag.id,
    }
  })
}

function postCloneEvidence(
  baseline: GatewayChannelLayoutSnapshot,
  evidence: GuildChannelEvidence,
  plan: ChannelClonePlan,
  createdChannelId: string,
): {
  created: ChannelCloneState
  source: ChannelCloneState
} {
  if (
    !matchingCloneLayout(
      baseline,
      evidence.layout,
      {
        channelId: createdChannelId,
        parentId: plan.source.parentId,
        type: plan.source.type,
      },
    )
  ) {
    throw evidenceError("Discord post-clone channel topology is contradictory")
  }
  const sourceRaw = evidence.channels.filter((channel) => channel.id === plan.source.id)
  const createdRaw = evidence.channels.filter((channel) => channel.id === createdChannelId)
  if (sourceRaw.length !== 1 || createdRaw.length !== 1) {
    throw evidenceError("Discord post-clone HTTP evidence omitted the source or created channel")
  }
  const source = exactChannelState(sourceRaw[0] as DiscordChannel, plan.guild.id)
  if (stableString({ ...source, position: plan.source.position }) !== stableString(plan.source)) {
    throw evidenceError("Discord source channel changed during clone execution")
  }
  return {
    created: exactCreatedState(createdRaw[0] as DiscordChannel, plan, createdChannelId),
    source,
  }
}

export class ChannelCloneService {
  readonly #activityStore: ActivityStore
  readonly #client: ChannelCloneServiceOptions["client"]
  readonly #clock: () => Date
  readonly #layoutSource: GatewayChannelLayoutSource
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ChannelCloneServiceOptions["policy"]
  readonly #randomId: () => string
  readonly #verificationTimeoutMs: number

  constructor(options: ChannelCloneServiceOptions) {
    const verificationTimeoutMs = options.verificationTimeoutMs
      ?? DEFAULT_VERIFICATION_TIMEOUT_MS
    if (
      !Number.isSafeInteger(verificationTimeoutMs)
      || verificationTimeoutMs < 1
      || verificationTimeoutMs > MAX_VERIFICATION_TIMEOUT_MS
    ) throw new RangeError("Discord channel-clone verification timeout is invalid")
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#layoutSource = options.layoutSource
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
    this.#verificationTimeoutMs = verificationTimeoutMs
  }

  async #state(
    botId: string,
    request: NormalizedChannelCloneRequest,
    options: RequestOptions,
  ): Promise<ChannelCloneEvidenceState> {
    if (!this.#layoutSource.layoutEnabled) {
      throw evidenceError("Discord Gateway channel-clone layout is disabled")
    }
    let supportingEvidence: {
      guild: DiscordGuild
      member: DiscordGuildMember
      roles: DiscordRole[]
    } | undefined
    let channelEvidence: GuildChannelEvidence
    try {
      channelEvidence = await collectGuildChannelEvidence({
        guildId: request.guildId,
        layoutSource: this.#layoutSource,
        readChannels: async () => {
          const [guild, member, roles, channels] = await Promise.all([
            this.#client.getGuild(request.guildId, options),
            this.#client.getGuildMember(request.guildId, botId, options),
            this.#client.getGuildRoles(request.guildId, options),
            this.#client.getGuildChannels(request.guildId, options),
          ])
          supportingEvidence = { guild, member, roles }
          return channels
        },
      })
    } catch (error) {
      if (error instanceof GuildChannelEvidenceError) {
        throw evidenceError(
          `Discord channel-clone evidence is incomplete: ${error.message}`,
          error,
        )
      }
      throw error
    }
    if (!supportingEvidence) {
      throw evidenceError("Discord channel-clone supporting evidence is unavailable")
    }
    const guild = exactGuild(supportingEvidence.guild, request.guildId)
    let roles: NormalizedDiscordRole[]
    try {
      roles = normalizeDiscordRoleInventory(supportingEvidence.roles, request.guildId)
    } catch (error) {
      throw evidenceError("Discord returned invalid channel-clone role evidence", error)
    }
    const botMember = exactBotMember(
      supportingEvidence.member,
      botId,
      roles,
      request.guildId,
    )
    const guildPermissions = exactGuildPermissions(
      request.guildId,
      botMember,
      supportingEvidence.roles,
    )
    const sourceLayout = channelEvidence.layout.channels.filter((channel) => (
      channel.channelId === request.sourceChannelId
    ))
    if (sourceLayout.length !== 1 || sourceLayout[0]?.obfuscated) {
      throw evidenceError("Discord channel-clone source is absent or obfuscated")
    }
    const sourceCandidates = channelEvidence.channels.filter((channel) => (
      channel.id === request.sourceChannelId
    ))
    if (sourceCandidates.length !== 1) {
      throw evidenceError("Discord channel-clone source metadata is unavailable")
    }
    const sourceRaw = sourceCandidates[0] as DiscordChannel
    this.#policy.assertChannelReadable(sourceRaw)
    const source = exactChannelState(sourceRaw, request.guildId)
    const parent = exactParent(
      channelEvidence.channels,
      source.parentId,
      request.guildId,
    )
    const parentChildren = source.parentId === null
      ? null
      : channelEvidence.layout.channels.filter((channel) => (
          channel.parentChannelId === source.parentId
        )).length
    if (channelEvidence.layout.channels.length >= DISCORD_LIMITS.guildChannels) {
      throw evidenceError("Discord guild channel capacity is exhausted")
    }
    if (
      parentChildren !== null
      && parentChildren >= DISCORD_LIMITS.categoryChannels
    ) throw evidenceError("Discord source category child capacity is exhausted")
    let sourcePermissions: ReturnType<typeof evaluateBotChannelPermissions>
    try {
      sourcePermissions = evaluateBotChannelPermissions({
        botId,
        channel: sourceRaw,
        guildId: request.guildId,
        member: botMember,
        permissionChannel: sourceRaw,
        roles: supportingEvidence.roles,
      })
    } catch (error) {
      throw evidenceError("Discord source channel permission evidence is invalid", error)
    }
    if (sourcePermissions.confidence !== "complete") {
      throw evidenceError(
        `Discord source channel permission evidence is incomplete: ${sourcePermissions.warnings.join("; ")}`,
      )
    }
    if (!sourcePermissions.effectivePermissionNames.includes("VIEW_CHANNEL")) {
      throw evidenceError("Discord connector bot lacks VIEW_CHANNEL on the clone source")
    }
    assertSourceAuthority({
      guild,
      guildPermissions,
      roles,
      source,
    })
    return {
      botMember,
      guild,
      guildPermissions,
      httpMode: channelEvidence.view.httpMode,
      layout: channelEvidence.layout,
      parent,
      parentChildren,
      roles,
      source,
      sourcePermissions,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedChannelCloneRequest,
    mode: "audit" | "change",
    options: RequestOptions,
  ): Promise<BuiltChannelClonePlan> {
    if (mode === "change") {
      this.#policy.assertChannelCloneable(request.guildId, request.sourceChannelId)
    } else {
      this.#policy.assertChannelCloneAuditable(request.guildId, request.sourceChannelId)
    }
    if (!snowflake(applicationId) || !snowflake(botId)) {
      throw new RangeError("Discord channel cloning requires pinned application and bot IDs")
    }
    const existingReceipt = await this.#operationStore.get(
      "channel-clone",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new ChannelCloneOperationConflictError(receiptView(existingReceipt))
    }
    const state = await this.#state(botId, request, options)
    const targetName = request.name ?? state.source.name
    const payload = clonePayload(state.source, targetName)
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: memberSnapshot(state.botMember),
      guild: {
        features: state.guild.features,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
        premiumTier: state.guild.premium_tier,
      },
      guildPermissions: state.guildPermissions.effectivePermissions,
      httpMode: state.httpMode,
      layout: state.layout,
      parent: state.parent,
      parentChildren: state.parentChildren,
      payload,
      request: requestSnapshot(request),
      roles: rolesSnapshot(state.roles),
      source: state.source,
      sourcePermissions: state.sourcePermissions.effectivePermissions,
    })
    const obfuscatedChannels = state.layout.channels.filter((channel) => (
      channel.obfuscated
    )).length
    const plan: ChannelClonePlan = {
      applicationId,
      auditReason: request.auditReason,
      botId,
      capacity: {
        guildChannels: state.layout.channels.length,
        guildLimit: DISCORD_LIMITS.guildChannels,
        parentChildren: state.parentChildren,
        parentLimit: state.parent ? DISCORD_LIMITS.categoryChannels : null,
      },
      createdAt: this.#clock().toISOString(),
      digest,
      evidence: {
        httpMode: state.httpMode,
        layoutRevision: state.layout.revision,
        layoutUpdatedAt: state.layout.updatedAt as string,
        obfuscatedChannels,
      },
      guild: {
        features: state.guild.features,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
        premiumTier: state.guild.premium_tier,
      },
      operationKeyHash: request.operationKeyHash,
      parent: state.parent,
      permission: {
        administrator: state.guildPermissions.administrator,
        guildEffectivePermissionNames: discordPermissionNames(
          BigInt(state.guildPermissions.effectivePermissions),
        ),
        guildEffectivePermissions: state.guildPermissions.effectivePermissions,
        guildManageChannels: hasGuildPermission(
          state.guildPermissions,
          "MANAGE_CHANNELS",
        ),
        sourceEffectivePermissionNames: state.sourcePermissions.effectivePermissionNames,
        sourceEffectivePermissions: state.sourcePermissions.effectivePermissions,
        sourceViewChannel: state.sourcePermissions.effectivePermissionNames
          .includes("VIEW_CHANNEL"),
      },
      privacy: {
        channelMetadata: "transient-untrusted",
        hiddenMetadataReturned: false,
        omittedFields: PRIVACY_OMISSIONS,
        persistence: "content-free-only",
      },
      risks: [
        "Discord creates a new channel ID; forum and media tag IDs are regenerated",
        "Discord chooses default placement because source position is intentionally omitted",
        "Duplicate channel names are valid and are not treated as a conflict or no-op",
        "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
        "Messages, threads, pins, webhooks, followers, invites, and live voice state are not cloned",
      ],
      schemaVersion: SCHEMA_VERSION,
      source: state.source,
      status: "planned",
      target: {
        payload,
        placement: "discord-default",
        regeneratedTagIds: TAG_TYPES.has(state.source.type),
      },
      warnings: [
        ...(state.guildPermissions.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with narrower guild permissions where source overwrites permit"]
          : []),
        ...(obfuscatedChannels > 0
          ? [`The complete layout contains ${obfuscatedChannels} obfuscated channel IDs whose metadata remains hidden`]
          : []),
        "Success requires one exact HTTP readback and a newer complete Gateway layout containing exactly one added channel",
        "Same-guild and same-parent cloning preserves exact overwrite target IDs without enumerating member profiles",
      ],
    }
    return { plan, state }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: ChannelCloneRequest,
    options: RequestOptions = {},
  ): Promise<ChannelClonePlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      normalizeChannelCloneRequest(request),
      "audit",
      options,
    )).plan
  }

  async execute(
    applicationId: string,
    botId: string,
    request: ChannelCloneRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelCloneResult> {
    const normalized = normalizeChannelCloneRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord channel-clone plan digest is invalid")
    }
    return withGuildLock(
      normalized.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ChannelCloneExecutionError(
        "Discord channel cloning was blocked because a prior clone in this guild ended with an uncertain outcome",
        {
          activityId: null,
          createdChannelId: null,
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          sourceChannelId: normalized.sourceChannelId,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedChannelCloneRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ChannelCloneResult> {
    let built: BuiltChannelClonePlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, "change", options)
    } catch (error) {
      if (
        error instanceof ChannelCloneEvidenceError
        || (error instanceof DiscordApiError && error.status === 404)
      ) throw new ChannelClonePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new ChannelClonePlanChangedError(expectedDigest, plan.digest)
    }
    const activityId = this.#randomId()
    const baseResult = {
      baselineLayoutRevision: plan.evidence.layoutRevision,
      createdChannelId: null,
      guildId: request.guildId,
      observedLayoutRevision: null,
      operationKeyHash: request.operationKeyHash,
      parentId: plan.source.parentId,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      sourceChannelId: request.sourceChannelId,
      type: plan.source.type,
      typeName: plan.source.typeName,
    }
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ChannelCloneOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
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
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ChannelCloneExecutionError(
        "Discord channel cloning was blocked because pending activity could not be recorded",
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

    let createdChannelId: string | null = null
    let mutationStarted = false
    let observedLayoutRevision: number | null = null
    let createdState: ChannelCloneState | null = null
    let mapping: ChannelCloneResult["tagIdMap"] = []
    let watch: CloneLayoutWatch | undefined
    try {
      watch = cloneLayoutWatch({
        baseline: state.layout,
        guildId: request.guildId,
        source: this.#layoutSource,
        timeoutMs: this.#verificationTimeoutMs,
      })
      watch.arm()
      mutationStarted = true
      const response = await this.#client.createGuildChannel(
        request.guildId,
        plan.target.payload,
        request.auditReason,
        options,
      )
      if (snowflake(response?.id)) createdChannelId = response.id
      createdState = exactCreatedState(response, plan)
      createdChannelId = createdState.id
      watch.expect(createdChannelId, plan.source.parentId, plan.source.type)
      const observedLayout = await watch.wait(options.signal)
      observedLayoutRevision = observedLayout.revision
      const [exactCreated, evidence] = await Promise.all([
        this.#client.getChannel(createdChannelId, options),
        collectGuildChannelEvidence({
          guildId: request.guildId,
          layoutSource: this.#layoutSource,
          readChannels: () => this.#client.getGuildChannels(request.guildId, options),
        }),
      ])
      const readback = exactCreatedState(exactCreated, plan, createdChannelId)
      const post = postCloneEvidence(
        state.layout,
        evidence,
        plan,
        createdChannelId,
      )
      if (stableString(readback) !== stableString(post.created)) {
        throw evidenceError("Discord exact and inventory clone readback disagree")
      }
      createdState = readback
      observedLayoutRevision = evidence.layout.revision
      mapping = tagIdMap(plan.source, readback)
    } catch (error) {
      const latest = watch?.latest() ?? null
      if (latest) observedLayoutRevision = latest.revision
      const settled = !mutationStarted || (
        createdChannelId === null
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
      )
      const status = settled ? "failed" : "uncertain"
      if (settled) observedLayoutRevision = null
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          createdChannelId: settled ? null : createdChannelId,
          error: errorCode,
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
          createdChannelId: settled ? null : createdChannelId,
          error: errorCode,
          observedRevision: observedLayoutRevision,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ChannelCloneExecutionError(
        "Discord channel cloning did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          createdChannelId,
          error: errorCode,
          observedLayoutRevision,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    } finally {
      watch?.close()
    }

    const result: ChannelCloneResult = {
      activityId,
      baselineLayoutRevision: plan.evidence.layoutRevision,
      createdChannelId: createdChannelId as string,
      guildId: request.guildId,
      observedLayoutRevision: observedLayoutRevision as number,
      operationKeyHash: request.operationKeyHash,
      parentId: createdState?.parentId ?? plan.source.parentId,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      sourceChannelId: request.sourceChannelId,
      status: "completed",
      tagIdMap: mapping,
      type: plan.source.type,
      typeName: plan.source.typeName,
      verification: "match",
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        createdChannelId: result.createdChannelId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          createdChannelId: result.createdChannelId,
          error: safeErrorCode(error),
          observedRevision: result.observedLayoutRevision,
          plan,
          request,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ChannelCloneExecutionError(
        "Discord channel cloning completed but the operation receipt failed",
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
        createdChannelId: result.createdChannelId,
        observedRevision: result.observedLayoutRevision,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new ChannelCloneExecutionError(
        "Discord channel cloning completed but the final activity record failed",
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
