import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ChannelDeletionActivity,
  ChannelDeletionActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordAutoModerationRuleSummary,
  type DiscordClient,
  type DiscordGuildOnboarding,
  type DiscordGuildWelcomeScreen,
  type DiscordGuildWidgetSettings,
  type DiscordInviteSummary,
  type DiscordScheduledEventSummary,
  type DiscordStageInstanceSummary,
  type DiscordWebhookSummary,
} from "./discord-client.js"
import {
  ChannelDeletionEvidenceError,
  ChannelDeletionExecutionError,
  ChannelDeletionOperationConflictError,
  ChannelDeletionPlanChangedError,
  ChannelDeletionVerificationTimeoutError,
  DiscordApiError,
} from "./errors.js"
import type {
  GatewayChannelLayoutSnapshot,
  GatewayChannelLayoutSource,
} from "./gateway-channel-layout.js"
import {
  collectGuildChannelEvidence,
  exactGatewayChannelLayout,
  GuildChannelEvidenceError,
  type GuildChannelHttpEvidenceMode,
} from "./guild-channel-evidence.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  discordPermissionNames,
  evaluateBotChannelPermissions,
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  parseDiscordPermissionBits,
  type BotChannelPermissionResult,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import {
  DiscordRoleEvidenceError,
  normalizeDiscordRoleInventory,
  type NormalizedDiscordRole,
} from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
  DiscordThreadList,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "channel-deletion-state-unavailable"
const CHANNEL_DELETION_LOCKS = new Map<string, Promise<ChannelDeletionTargetOutcome>>()
const CHANNEL_DELETION_UNCERTAIN_GUILDS = new Set<string>()
const CHANNEL_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const DEFAULT_VERIFICATION_TIMEOUT_MS = 10_000
const MAX_VERIFICATION_TIMEOUT_MS = 60_000
const COMMUNITY_FEATURE = "COMMUNITY"
const AUTOMOD_FEATURE = "AUTO_MODERATION"
const TARGET_CHANNEL_KEYS: ReadonlySet<string> = new Set([
  "applied_tags",
  "application_id",
  "available_tags",
  "bitrate",
  "default_auto_archive_duration",
  "default_forum_layout",
  "default_reaction_emoji",
  "default_sort_order",
  "default_tag_setting",
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
const SUPPORTED_TARGET_TYPES: ReadonlyMap<number, ChannelDeletionTargetKind> = new Map([
  [DISCORD_CHANNEL_TYPES.category, "category"],
  [DISCORD_CHANNEL_TYPES.forum, "forum"],
  [DISCORD_CHANNEL_TYPES.media, "media"],
  [DISCORD_CHANNEL_TYPES.stageVoice, "stage"],
  [DISCORD_CHANNEL_TYPES.text, "text"],
  [DISCORD_CHANNEL_TYPES.voice, "voice"],
])
const THREAD_CAPABLE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const WEBHOOK_CAPABLE_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const VOICE_TARGET_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
])
const PRIVACY_OMISSIONS = Object.freeze([
  "auditReason",
  "channelContent",
  "dependencyIdentifiers",
  "hiddenChannelMetadata",
  "inviteCodes",
  "memberIdentities",
  "permissionOverwrites",
  "rawOperationKey",
  "rawPayloads",
  "threadMemberData",
  "voiceOccupancy",
  "webhookCredentials",
] as const)

type ChannelDeletionTargetOutcome = "settled" | "uncertain"
export type ChannelDeletionTargetKind =
  | "category"
  | "forum"
  | "media"
  | "stage"
  | "text"
  | "voice"

export type ChannelDeletionBlockerKind =
  | "active-thread"
  | "automod-reference"
  | "category-child"
  | "guild-reference"
  | "invite"
  | "onboarding-reference"
  | "private-archived-thread"
  | "public-archived-thread"
  | "scheduled-event"
  | "stage-instance"
  | "webhook"
  | "welcome-screen-reference"
  | "widget-reference"

export interface ChannelDeletionRequest {
  acknowledgeIrreversibleContentLoss: true
  auditReason: string
  channelId: string
  guildId: string
  operationKey: string
}

export interface NormalizedChannelDeletionRequest extends ChannelDeletionRequest {
  operationKeyHash: string
}

export interface ChannelDeletionTarget {
  id: string
  kind: ChannelDeletionTargetKind
  lastMessagePresent: boolean
  name: string
  overwriteCount: number
  parentChannelId: string | null
  rawPosition: number
  type: number
  unknownFieldCount: number
}

export interface ChannelDeletionBlocker {
  count: number
  kind: ChannelDeletionBlockerKind
}

export interface ChannelDeletionDependencyEvidence {
  blockerCount: number
  digest: string
  references: {
    activeThreads: number
    automod: number
    categoryChildren: number
    guild: number
    invites: number
    onboarding: number
    privateArchivedThreads: number
    publicArchivedThreads: number
    scheduledEvents: number
    stageInstances: number
    webhooks: number
    welcomeScreen: number
    widget: number
  }
}

export interface ChannelDeletionPermissionEvidence {
  administrator: boolean
  confidence: "complete"
  guildEffectivePermissionNames: DiscordPermissionName[]
  guildEffectivePermissions: string
  guildManageGuild: boolean
  requiredTargetPermissions: DiscordPermissionName[]
  targetEffectivePermissionNames: DiscordPermissionName[]
  targetEffectivePermissions: string
}

export interface ChannelDeletionPrivacyProjection {
  channelText: "transient-untrusted"
  hiddenMetadataReturned: false
  omittedFields: typeof PRIVACY_OMISSIONS
  persistence: "content-free-only"
}

export interface ChannelDeletionReadiness {
  applicationId: string
  blockers: ChannelDeletionBlocker[]
  botId: string
  dependencies: ChannelDeletionDependencyEvidence
  evidenceDigest: string
  guild: {
    id: string
    name: string
    ownerId: string
  }
  httpEvidenceMode: GuildChannelHttpEvidenceMode
  layout: {
    channelCount: number
    obfuscatedChannels: number
    revision: number
    updatedAt: string
  }
  permission: ChannelDeletionPermissionEvidence
  privacy: ChannelDeletionPrivacyProjection
  ready: boolean
  risks: string[]
  schemaVersion: number
  status: "blocked" | "ready"
  target: ChannelDeletionTarget
  warnings: string[]
}

export interface ChannelDeletionPlan extends Omit<
  ChannelDeletionReadiness,
  "evidenceDigest" | "ready" | "status"
> {
  acknowledgeIrreversibleContentLoss: true
  auditReason: string
  createdAt: string
  digest: string
  operationKeyHash: string
  status: "blocked" | "planned"
  writeRequired: boolean
}

export interface ChannelDeletionResult {
  activityId: string | null
  addedChannelCount: number
  baselineChannelCount: number
  baselineLayoutRevision: number
  blockerCount: number
  channelId: string
  guildId: string
  observedChannelCount: number | null
  observedLayoutRevision: number | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "blocked" | "completed" | "completed-with-drift"
  targetKind: ChannelDeletionTargetKind
  verification: "drift" | "match" | "not-required"
}

export interface ChannelDeletionServiceClient extends Pick<
  DiscordClient,
  | "deleteGuildChannel"
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildOnboarding"
  | "getGuildRoles"
  | "getGuildWelcomeScreen"
  | "getGuildWidgetSettings"
  | "getStageInstance"
  | "listActiveGuildThreads"
  | "listChannelWebhooks"
  | "listGuildAutoModerationRules"
  | "listGuildInvites"
  | "listGuildScheduledEvents"
  | "listPrivateArchivedThreads"
  | "listPublicArchivedThreads"
> {}

export interface ChannelDeletionServiceOptions {
  activityStore: ActivityStore
  client: ChannelDeletionServiceClient
  clock?: () => Date
  layoutSource: GatewayChannelLayoutSource
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    "assertChannelDeletionAllowed" | "assertChannelDeletionAuditable"
  >
  randomId?: () => string
  verificationTimeoutMs?: number
}

interface ValidatedGuild extends DiscordGuild {
  afk_channel_id: string | null
  features: string[]
  owner_id: string
  public_updates_channel_id: string | null
  rules_channel_id: string | null
  safety_alerts_channel_id: string | null
  system_channel_id: string | null
  widget_channel_id: string | null
}

interface DependencyInventory {
  activeThreadIds: string[]
  automodRuleIds: string[]
  categoryChildIds: string[]
  guildReferenceNames: string[]
  inviteReferences: string[]
  onboardingReferences: string[]
  privateArchivedThreadIds: string[]
  publicArchivedThreadIds: string[]
  scheduledEventIds: string[]
  stageInstanceIds: string[]
  webhookIds: string[]
  welcomeScreenReferences: string[]
  widgetReferences: string[]
}

interface SupportingEvidence {
  botMember: DiscordGuildMember
  dependencies: DependencyInventory
  guild: ValidatedGuild
  guildPermission: GuildMemberPermissionResult
  roles: NormalizedDiscordRole[]
  target: ChannelDeletionTarget
  targetChannel: DiscordChannel
  targetPermission: BotChannelPermissionResult
}

interface ChannelDeletionState extends SupportingEvidence {
  httpEvidenceMode: GuildChannelHttpEvidenceMode
  layout: GatewayChannelLayoutSnapshot
}

interface BuiltChannelDeletionPlan {
  baselineLayout: GatewayChannelLayoutSnapshot
  plan: ChannelDeletionPlan
  request: NormalizedChannelDeletionRequest
  targetEvidence: ChannelDeletionTargetEvidence
}

interface ChannelDeletionTargetEvidence {
  id: string
  lastMessageId: string | null
  name: string
  parentChannelId: string | null
  permissionOverwrites: DiscordPermissionOverwrite[]
  position: number
  type: number
}

interface DeletionVerification {
  addedChannelCount: number
  snapshot: GatewayChannelLayoutSnapshot
  verification: "drift" | "match"
}

interface LayoutVerificationWatch {
  arm(): void
  close(): void
  latest(): GatewayChannelLayoutSnapshot | null
  wait(signal?: AbortSignal): Promise<DeletionVerification>
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function snowflake(value: unknown): string | undefined {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    return undefined
  }
  const parsed = BigInt(value)
  return parsed >= 1n && parsed <= DISCORD_SNOWFLAKE_MAX ? value : undefined
}

function assertSnowflake(value: unknown, name: string): asserts value is string {
  if (!snowflake(value)) throw new RangeError(`${name} must be a Discord snowflake`)
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function canonicalIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareSnowflakes)
}

function evidenceError(message: string, cause?: unknown): ChannelDeletionEvidenceError {
  return new ChannelDeletionEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

export function normalizeChannelDeletionRequest(
  request: ChannelDeletionRequest,
): NormalizedChannelDeletionRequest {
  if (
    !request
    || typeof request !== "object"
    || Array.isArray(request)
    || !hasOnlyKeys(request as unknown as Record<string, unknown>, [
      "acknowledgeIrreversibleContentLoss",
      "auditReason",
      "channelId",
      "guildId",
      "operationKey",
    ])
    || request.acknowledgeIrreversibleContentLoss !== true
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) throw new RangeError("Discord channel-deletion request must be an exact acknowledged object")
  assertSnowflake(request.guildId, "Discord channel-deletion guild ID")
  assertSnowflake(request.channelId, "Discord channel-deletion channel ID")
  encodeDiscordAuditReason(request.auditReason)
  return {
    ...request,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function exactNullableSnowflake(value: unknown, name: string): string | null {
  if (value === null) return null
  const id = snowflake(value)
  if (!id) throw evidenceError(`Discord returned invalid ${name} evidence`)
  return id
}

function exactGuild(value: DiscordGuild, guildId: string): ValidatedGuild {
  const record = recordValue(value)
  const ownerId = snowflake(value?.owner_id)
  if (
    !record
    || value.id !== guildId
    || typeof value.name !== "string"
    || value.name.length < 1
    || value.name.length > DISCORD_LIMITS.guildNameCharacters
    || CHANNEL_NAME_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
    || !ownerId
    || !Array.isArray(value.features)
    || value.features.some((feature) => typeof feature !== "string" || !feature)
    || new Set(value.features).size !== value.features.length
    || !("afk_channel_id" in record)
    || !("system_channel_id" in record)
    || !("rules_channel_id" in record)
    || !("public_updates_channel_id" in record)
    || !("safety_alerts_channel_id" in record)
    || !("widget_channel_id" in record)
  ) throw evidenceError("Discord returned invalid channel-deletion guild evidence")
  return {
    ...value,
    afk_channel_id: exactNullableSnowflake(value.afk_channel_id, "guild AFK channel"),
    features: [...value.features].sort(),
    owner_id: ownerId,
    public_updates_channel_id: exactNullableSnowflake(
      value.public_updates_channel_id,
      "guild public-updates channel",
    ),
    rules_channel_id: exactNullableSnowflake(value.rules_channel_id, "guild rules channel"),
    safety_alerts_channel_id: exactNullableSnowflake(
      value.safety_alerts_channel_id,
      "guild safety-alerts channel",
    ),
    system_channel_id: exactNullableSnowflake(value.system_channel_id, "guild system channel"),
    widget_channel_id: exactNullableSnowflake(value.widget_channel_id, "guild widget channel"),
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
  ) throw evidenceError("Discord returned invalid connector membership for channel deletion")
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

function exactOverwrites(value: unknown): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord returned invalid channel-deletion overwrite evidence")
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    const record = recordValue(entry)
    const id = snowflake(record?.id)
    if (
      !record
      || !Object.keys(record).every((key) => OVERWRITE_KEYS.has(key))
      || !id
      || seen.has(id)
      || (record.type !== 0 && record.type !== 1)
      || typeof record.allow !== "string"
      || typeof record.deny !== "string"
    ) throw evidenceError("Discord returned invalid channel-deletion overwrite evidence")
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(record.allow, "channel overwrite allow")
      deny = parseDiscordPermissionBits(record.deny, "channel overwrite deny")
    } catch (error) {
      throw evidenceError("Discord returned invalid channel-deletion overwrite evidence", error)
    }
    if ((allow & deny) !== 0n) {
      throw evidenceError("Discord returned overlapping channel-deletion overwrite evidence")
    }
    seen.add(id)
    return {
      allow: record.allow,
      deny: record.deny,
      id,
      type: record.type,
    }
  }).sort((left, right) => compareSnowflakes(left.id, right.id) || left.type - right.type)
}

function exactTargetChannel(
  value: DiscordChannel | undefined,
  guildId: string,
  channelId: string,
): { channel: DiscordChannel; target: ChannelDeletionTarget } {
  const record = recordValue(value)
  const unknownFieldCount = record
    ? Object.keys(record).filter((key) => !TARGET_CHANNEL_KEYS.has(key)).length
    : 0
  const kind = typeof value?.type === "number"
    ? SUPPORTED_TARGET_TYPES.get(value.type)
    : undefined
  let parentChannelId: string | null = null
  if (value?.parent_id !== undefined && value.parent_id !== null) {
    const parsedParentId = snowflake(value.parent_id)
    if (!parsedParentId) {
      throw evidenceError("Discord returned invalid channel-deletion parent evidence")
    }
    parentChannelId = parsedParentId
  }
  const lastMessageId = value?.last_message_id === undefined
    || value.last_message_id === null
    ? null
    : snowflake(value.last_message_id)
  if (
    !record
    || value?.id !== channelId
    || value.guild_id !== guildId
    || !kind
    || !Number.isSafeInteger(value.type)
    || !Number.isSafeInteger(value.position)
    || (value.position as number) < 0
    || typeof value.name !== "string"
    || value.name.length < 1
    || value.name.length > DISCORD_LIMITS.channelNameCharacters
    || CHANNEL_NAME_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
    || !(value.parent_id === undefined || value.parent_id === null || parentChannelId)
    || !(value.last_message_id === undefined || value.last_message_id === null || lastMessageId)
    || (value.type === DISCORD_CHANNEL_TYPES.category && parentChannelId !== null)
    || unknownFieldCount !== 0
  ) throw evidenceError("Discord returned invalid or unsupported channel-deletion target evidence")
  const permissionOverwrites = exactOverwrites(value.permission_overwrites)
  const channel = {
    ...value,
    parent_id: parentChannelId,
    permission_overwrites: permissionOverwrites,
  }
  return {
    channel,
    target: {
      id: channelId,
      kind,
      lastMessagePresent: lastMessageId !== null,
      name: value.name,
      overwriteCount: permissionOverwrites.length,
      parentChannelId,
      rawPosition: value.position as number,
      type: value.type,
      unknownFieldCount,
    },
  }
}

function targetEvidenceSnapshot(
  channel: DiscordChannel,
  target: ChannelDeletionTarget,
): ChannelDeletionTargetEvidence {
  return {
    id: target.id,
    lastMessageId: channel.last_message_id ?? null,
    name: target.name,
    parentChannelId: target.parentChannelId,
    permissionOverwrites: channel.permission_overwrites ?? [],
    position: target.rawPosition,
    type: target.type,
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
    throw evidenceError("Discord connector channel-deletion permission evidence is invalid", error)
  }
  if (!result.complete) {
    throw evidenceError(
      `Discord connector channel-deletion permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  return result
}

function exactTargetPermissions(options: {
  botId: string
  channel: DiscordChannel
  guildId: string
  member: DiscordGuildMember
  roles: readonly DiscordRole[]
}): BotChannelPermissionResult {
  let result: BotChannelPermissionResult
  try {
    result = evaluateBotChannelPermissions({
      botId: options.botId,
      channel: options.channel,
      guildId: options.guildId,
      member: options.member,
      permissionChannel: options.channel,
      roles: options.roles,
    })
  } catch (error) {
    throw evidenceError("Discord target channel permission evidence is invalid", error)
  }
  if (result.confidence !== "complete") {
    throw evidenceError(
      `Discord target channel permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  if (result.unknownPermissionBits !== "0") {
    throw evidenceError("Discord target channel permission evidence contains unknown bits")
  }
  return result
}

function requiredTargetPermissions(type: number): DiscordPermissionName[] {
  const permissions: DiscordPermissionName[] = ["VIEW_CHANNEL", "MANAGE_CHANNELS"]
  if (THREAD_CAPABLE_TYPES.has(type)) {
    permissions.push("READ_MESSAGE_HISTORY", "MANAGE_THREADS")
  }
  if (WEBHOOK_CAPABLE_TYPES.has(type)) permissions.push("MANAGE_WEBHOOKS")
  return permissions
}

function assertPermissions(
  guildPermission: GuildMemberPermissionResult,
  targetPermission: BotChannelPermissionResult,
  type: number,
): void {
  if (!hasGuildPermission(guildPermission, "MANAGE_GUILD")) {
    throw evidenceError("Discord connector lacks guild-level MANAGE_GUILD for channel deletion")
  }
  const required = requiredTargetPermissions(type)
  const missing = required.filter((permission) => (
    !targetPermission.effectivePermissionNames.includes(permission)
  ))
  if (missing.length > 0) {
    throw evidenceError(
      `Discord connector lacks complete target channel permissions: ${missing.join(", ")}`,
    )
  }
}

function exactThreadIds(
  value: DiscordThreadList,
  options: {
    allowOtherParents: boolean
    guildId: string
    name: string
    parentChannelId: string
  },
): string[] {
  const record = recordValue(value)
  if (
    !record
    || !Array.isArray(value.threads)
    || value.threads.length > DISCORD_LIMITS.guildChannels
    || !(value.has_more === undefined || typeof value.has_more === "boolean")
    || !(value.members === undefined || Array.isArray(value.members))
  ) throw evidenceError(`Discord returned invalid ${options.name} evidence`)
  const ids: string[] = []
  const seen = new Set<string>()
  for (const thread of value.threads) {
    const threadRecord = recordValue(thread)
    const id = snowflake(threadRecord?.id)
    const parentId = snowflake(threadRecord?.parent_id)
    if (
      !threadRecord
      || !id
      || seen.has(id)
      || !parentId
      || !(thread.type === DISCORD_CHANNEL_TYPES.announcementThread
        || thread.type === DISCORD_CHANNEL_TYPES.privateThread
        || thread.type === DISCORD_CHANNEL_TYPES.publicThread)
      || !(thread.guild_id === undefined || thread.guild_id === options.guildId)
    ) throw evidenceError(`Discord returned invalid ${options.name} evidence`)
    seen.add(id)
    if (parentId === options.parentChannelId) {
      ids.push(id)
    } else if (!options.allowOtherParents) {
      throw evidenceError(`Discord returned another channel's ${options.name} evidence`)
    }
  }
  if (ids.length === 0 && value.has_more === true) {
    throw evidenceError(`Discord returned incomplete empty ${options.name} evidence`)
  }
  return canonicalIds(ids)
}

function guildReferences(guild: ValidatedGuild, channelId: string): string[] {
  return [
    ["afk", guild.afk_channel_id],
    ["public-updates", guild.public_updates_channel_id],
    ["rules", guild.rules_channel_id],
    ["safety-alerts", guild.safety_alerts_channel_id],
    ["system", guild.system_channel_id],
    ["widget", guild.widget_channel_id],
  ].flatMap(([name, id]) => id === channelId ? [name as string] : [])
}

function onboardingReferences(
  onboarding: DiscordGuildOnboarding | null,
  channelId: string,
): string[] {
  if (!onboarding) return []
  const references = onboarding.defaultChannelIds
    .flatMap((id, index) => id === channelId ? [`default:${index}`] : [])
  for (const [promptIndex, prompt] of onboarding.prompts.entries()) {
    for (const [optionIndex, option] of prompt.options.entries()) {
      option.channelIds.forEach((id, channelIndex) => {
        if (id === channelId) {
          references.push(`prompt:${promptIndex}:option:${optionIndex}:channel:${channelIndex}`)
        }
      })
    }
  }
  return references.sort()
}

function welcomeScreenReferences(
  welcomeScreen: DiscordGuildWelcomeScreen | null,
  channelId: string,
): string[] {
  if (!welcomeScreen) return []
  return welcomeScreen.welcomeChannels
    .flatMap((channel, index) => channel.channelId === channelId ? [`channel:${index}`] : [])
}

function automodReferences(
  rules: readonly DiscordAutoModerationRuleSummary[],
  channelId: string,
): string[] {
  const references: string[] = []
  for (const rule of rules) {
    if (rule.exemptChannelIds.includes(channelId)) references.push(rule.id)
    if (rule.actions.some((action) => action.type === 2 && action.channelId === channelId)) {
      references.push(rule.id)
    }
  }
  return canonicalIds(references)
}

function dependencyBlockers(inventory: DependencyInventory): ChannelDeletionBlocker[] {
  const candidates: readonly [ChannelDeletionBlockerKind, number][] = [
    ["active-thread", inventory.activeThreadIds.length],
    ["automod-reference", inventory.automodRuleIds.length],
    ["category-child", inventory.categoryChildIds.length],
    ["guild-reference", inventory.guildReferenceNames.length],
    ["invite", inventory.inviteReferences.length],
    ["onboarding-reference", inventory.onboardingReferences.length],
    ["private-archived-thread", inventory.privateArchivedThreadIds.length],
    ["public-archived-thread", inventory.publicArchivedThreadIds.length],
    ["scheduled-event", inventory.scheduledEventIds.length],
    ["stage-instance", inventory.stageInstanceIds.length],
    ["webhook", inventory.webhookIds.length],
    ["welcome-screen-reference", inventory.welcomeScreenReferences.length],
    ["widget-reference", inventory.widgetReferences.length],
  ]
  return candidates.flatMap(([kind, count]) => count > 0 ? [{ count, kind }] : [])
}

function dependencyCounts(
  inventory: DependencyInventory,
): ChannelDeletionDependencyEvidence["references"] {
  return {
    activeThreads: inventory.activeThreadIds.length,
    automod: inventory.automodRuleIds.length,
    categoryChildren: inventory.categoryChildIds.length,
    guild: inventory.guildReferenceNames.length,
    invites: inventory.inviteReferences.length,
    onboarding: inventory.onboardingReferences.length,
    privateArchivedThreads: inventory.privateArchivedThreadIds.length,
    publicArchivedThreads: inventory.publicArchivedThreadIds.length,
    scheduledEvents: inventory.scheduledEventIds.length,
    stageInstances: inventory.stageInstanceIds.length,
    webhooks: inventory.webhookIds.length,
    welcomeScreen: inventory.welcomeScreenReferences.length,
    widget: inventory.widgetReferences.length,
  }
}

function privacyProjection(): ChannelDeletionPrivacyProjection {
  return {
    channelText: "transient-untrusted",
    hiddenMetadataReturned: false,
    omittedFields: PRIVACY_OMISSIONS,
    persistence: "content-free-only",
  }
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

function permissionSnapshot(result: BotChannelPermissionResult) {
  return {
    administrator: result.administrator,
    appliedRoleIds: result.appliedRoleIds,
    basePermissions: result.basePermissions,
    confidence: result.confidence,
    effectivePermissions: result.effectivePermissions,
    permissionSourceChannelId: result.permissionSourceChannelId,
    unknownPermissionBits: result.unknownPermissionBits,
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

function activityEntry(options: {
  activityId: string
  error?: string | null
  observedRevision?: number | null
  plan: ChannelDeletionPlan
  request: NormalizedChannelDeletionRequest
  status: ChannelDeletionActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): ChannelDeletionActivity {
  const counts = options.plan.dependencies.references
  const dependencyCount = Object.values(counts).reduce((total, value) => total + value, 0)
  return {
    baselineChannelCount: options.plan.layout.channelCount,
    baselineRevision: options.plan.layout.revision,
    channelId: options.request.channelId,
    dependencyCount,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "channel-deletion",
    observedRevision: options.observedRevision ?? null,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    targetKind: options.plan.target.kind,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: ChannelDeletionPlan
  request: NormalizedChannelDeletionRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "channel-deletion",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" || options.status === "uncertain"
      ? options.request.channelId
      : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    channelId: receipt.resourceId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof ChannelDeletionExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
    || error.result.status === "completed-operation-record-failed"
}

async function withGuildLock<T>(
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ChannelDeletionExecutionError,
): Promise<T> {
  const prior = CHANNEL_DELETION_LOCKS.get(guildId) ?? Promise.resolve(
    CHANNEL_DELETION_UNCERTAIN_GUILDS.has(guildId)
      ? "uncertain" as const
      : "settled" as const,
  )
  let release: (outcome: ChannelDeletionTargetOutcome) => void = () => undefined
  const tail = new Promise<ChannelDeletionTargetOutcome>((resolve) => {
    release = resolve
  })
  CHANNEL_DELETION_LOCKS.set(guildId, tail)
  let outcome: ChannelDeletionTargetOutcome = "settled"
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
    if (outcome === "uncertain") CHANNEL_DELETION_UNCERTAIN_GUILDS.add(guildId)
    release(outcome)
    if (CHANNEL_DELETION_LOCKS.get(guildId) === tail) {
      CHANNEL_DELETION_LOCKS.delete(guildId)
    }
  }
}

function exactLayout(
  value: GatewayChannelLayoutSnapshot,
  guildId: string,
): GatewayChannelLayoutSnapshot {
  try {
    return exactGatewayChannelLayout(value, guildId)
  } catch (error) {
    throw evidenceError("Discord Gateway channel-deletion layout evidence is invalid", error)
  }
}

function deletionVerification(
  baseline: GatewayChannelLayoutSnapshot,
  observed: GatewayChannelLayoutSnapshot,
  channelId: string,
): DeletionVerification | null {
  if (observed.revision <= baseline.revision) return null
  const observedById = new Map(observed.channels.map((channel) => [channel.channelId, channel]))
  if (observedById.has(channelId)) return null
  for (const channel of baseline.channels) {
    if (channel.channelId === channelId) continue
    const candidate = observedById.get(channel.channelId)
    if (
      !candidate
      || candidate.type !== channel.type
      || candidate.parentChannelId !== channel.parentChannelId
      || candidate.obfuscated !== channel.obfuscated
    ) return null
  }
  const baselineIds = new Set(baseline.channels.map((channel) => channel.channelId))
  const addedChannelCount = observed.channels.filter((channel) => (
    !baselineIds.has(channel.channelId)
  )).length
  return {
    addedChannelCount,
    snapshot: observed,
    verification: addedChannelCount > 0 ? "drift" : "match",
  }
}

function layoutVerificationWatch(options: {
  baseline: GatewayChannelLayoutSnapshot
  channelId: string
  guildId: string
  source: GatewayChannelLayoutSource
  timeoutMs: number
}): LayoutVerificationWatch {
  let armed = false
  let closed = false
  let latest: GatewayChannelLayoutSnapshot | null = null
  let matched: DeletionVerification | null = null
  let notify: (() => void) | null = null
  const inspect = () => {
    if (closed) return
    try {
      const candidate = exactLayout(
        options.source.getChannelLayout(options.guildId),
        options.guildId,
      )
      if (candidate.revision <= options.baseline.revision) return
      latest = candidate
      if (armed) {
        matched = deletionVerification(options.baseline, candidate, options.channelId)
        if (matched) notify?.()
      }
    } catch {}
  }
  const unsubscribe = options.source.subscribeChannelLayouts((guildId) => {
    if (guildId === options.guildId) inspect()
  })
  inspect()
  return {
    arm() {
      if (closed || armed) {
        throw evidenceError("Discord channel-deletion verification watch is not armable")
      }
      const current = exactLayout(
        options.source.getChannelLayout(options.guildId),
        options.guildId,
      )
      if (
        current.revision !== options.baseline.revision
        || stableString(current.channels) !== stableString(options.baseline.channels)
      ) throw evidenceError("Discord channel layout changed before deletion")
      armed = true
    },
    close() {
      if (closed) return
      closed = true
      unsubscribe()
    },
    latest() {
      return latest
    },
    wait(signal?: AbortSignal) {
      inspect()
      if (matched) return Promise.resolve(matched)
      return new Promise<DeletionVerification>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let abort: () => void = () => undefined
        const finish = (result?: DeletionVerification) => {
          if (timer !== undefined) clearTimeout(timer)
          signal?.removeEventListener("abort", abort)
          notify = null
          if (result) resolve(result)
          else reject(new ChannelDeletionVerificationTimeoutError(
            "Discord channel-deletion Gateway verification did not complete",
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

function assertDeletedResponse(
  value: DiscordChannel,
  guildId: string,
  expected: ChannelDeletionTargetEvidence,
): void {
  const returned = exactTargetChannel(value, guildId, expected.id)
  if (
    stableString(targetEvidenceSnapshot(returned.channel, returned.target))
    !== stableString(expected)
  ) throw evidenceError("Discord returned changed channel evidence after exact deletion")
}

export class ChannelDeletionService {
  readonly #activityStore: ActivityStore
  readonly #client: ChannelDeletionServiceClient
  readonly #clock: () => Date
  readonly #layoutSource: GatewayChannelLayoutSource
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ChannelDeletionServiceOptions["policy"]
  readonly #randomId: () => string
  readonly #verificationTimeoutMs: number

  constructor(options: ChannelDeletionServiceOptions) {
    const verificationTimeoutMs = options.verificationTimeoutMs
      ?? DEFAULT_VERIFICATION_TIMEOUT_MS
    if (
      !Number.isSafeInteger(verificationTimeoutMs)
      || verificationTimeoutMs < 1
      || verificationTimeoutMs > MAX_VERIFICATION_TIMEOUT_MS
    ) throw new RangeError("Discord channel-deletion verification timeout is invalid")
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

  async #dependencies(options: {
    channel: DiscordChannel
    guild: ValidatedGuild
    layout: GatewayChannelLayoutSnapshot
    requestOptions: RequestOptions
  }): Promise<DependencyInventory> {
    const channelId = options.channel.id
    const guildId = options.guild.id
    const community = options.guild.features.includes(COMMUNITY_FEATURE)
    const automod = options.guild.features.includes(AUTOMOD_FEATURE)
    const threadCapable = THREAD_CAPABLE_TYPES.has(options.channel.type)
    const webhookCapable = WEBHOOK_CAPABLE_TYPES.has(options.channel.type)
    const stage = options.channel.type === DISCORD_CHANNEL_TYPES.stageVoice
    const onboardingPromise = community
      ? this.#client.getGuildOnboarding(guildId, options.requestOptions)
      : Promise.resolve(null)
    const welcomeScreenPromise = community
      ? this.#client.getGuildWelcomeScreen(guildId, options.requestOptions)
      : Promise.resolve(null)
    const automodPromise = automod
      ? this.#client.listGuildAutoModerationRules(guildId, options.requestOptions)
      : Promise.resolve([])
    const publicThreadsPromise = threadCapable
      ? this.#client.listPublicArchivedThreads(channelId, {
          limit: DISCORD_LIMITS.archivedThreads,
          ...options.requestOptions,
        })
      : Promise.resolve(null)
    const privateThreadsPromise = options.channel.type === DISCORD_CHANNEL_TYPES.text
      ? this.#client.listPrivateArchivedThreads(channelId, {
          limit: DISCORD_LIMITS.archivedThreads,
          ...options.requestOptions,
        })
      : Promise.resolve(null)
    const webhookPromise = webhookCapable
      ? this.#client.listChannelWebhooks(channelId, options.requestOptions)
      : Promise.resolve([])
    const stagePromise = stage
      ? this.#client.getStageInstance(channelId, options.requestOptions)
        .catch((error: unknown) => {
          if (error instanceof DiscordApiError && error.status === 404) return null
          throw error
        })
      : Promise.resolve(null)
    let onboarding: DiscordGuildOnboarding | null
    let welcomeScreen: DiscordGuildWelcomeScreen | null
    let rules: DiscordAutoModerationRuleSummary[]
    let events: DiscordScheduledEventSummary[]
    let invites: DiscordInviteSummary[]
    let activeThreads: DiscordThreadList
    let publicThreads: DiscordThreadList | null
    let privateThreads: DiscordThreadList | null
    let webhooks: DiscordWebhookSummary[]
    let widget: DiscordGuildWidgetSettings
    let stageInstance: DiscordStageInstanceSummary | null
    try {
      [
        onboarding,
        welcomeScreen,
        rules,
        events,
        invites,
        activeThreads,
        publicThreads,
        privateThreads,
        webhooks,
        widget,
        stageInstance,
      ] = await Promise.all([
        onboardingPromise,
        welcomeScreenPromise,
        automodPromise,
        this.#client.listGuildScheduledEvents(guildId, options.requestOptions),
        this.#client.listGuildInvites(guildId, options.requestOptions),
        this.#client.listActiveGuildThreads(guildId, options.requestOptions),
        publicThreadsPromise,
        privateThreadsPromise,
        webhookPromise,
        this.#client.getGuildWidgetSettings(guildId, options.requestOptions),
        stagePromise,
      ])
    } catch (error) {
      throw evidenceError("Discord channel-deletion dependency evidence is unavailable", error)
    }
    if (!Array.isArray(events) || !Array.isArray(invites) || !Array.isArray(rules)
      || !Array.isArray(webhooks)) {
      throw evidenceError("Discord returned invalid channel-deletion dependency inventories")
    }
    if (onboarding && (
      onboarding.unknownEnumCount !== 0
      || onboarding.unknownFieldCount !== 0
    )) throw evidenceError("Discord returned unknown onboarding dependency evidence")
    if (welcomeScreen && (
      welcomeScreen.unknownFieldCount !== 0
      || welcomeScreen.welcomeChannels.some((channel) => channel.unknownFieldCount !== 0)
    )) throw evidenceError("Discord returned unknown Welcome Screen dependency evidence")
    if (widget.unknownFieldCount !== 0) {
      throw evidenceError("Discord returned unknown widget dependency evidence")
    }
    if (stageInstance && stageInstance.unknownFieldCount !== 0) {
      throw evidenceError("Discord returned unknown Stage-instance dependency evidence")
    }
    const activeThreadIds = exactThreadIds(
      activeThreads,
      {
        allowOtherParents: true,
        guildId,
        name: "active-thread inventory",
        parentChannelId: channelId,
      },
    )
    const publicArchivedThreadIds = publicThreads
      ? exactThreadIds(
          publicThreads,
          {
            allowOtherParents: false,
            guildId,
            name: "public archived-thread inventory",
            parentChannelId: channelId,
          },
        )
      : []
    const privateArchivedThreadIds = privateThreads
      ? exactThreadIds(
          privateThreads,
          {
            allowOtherParents: false,
            guildId,
            name: "private archived-thread inventory",
            parentChannelId: channelId,
          },
        )
      : []
    const webhookIds = canonicalIds(webhooks.flatMap((webhook) => {
      if (webhook.channelId === channelId && webhook.guildId === guildId) return [webhook.id]
      if (webhook.channelId === null || webhook.guildId === null) {
        throw evidenceError("Discord returned incomplete channel webhook identity evidence")
      }
      throw evidenceError("Discord returned another channel's webhook in an exact inventory")
    }))
    const scheduledEventIds = canonicalIds(events.flatMap((event) => {
      if (event.guildId !== guildId) {
        throw evidenceError("Discord returned another guild's scheduled event")
      }
      return event.channelId === channelId ? [event.id] : []
    }))
    const inviteReferences = invites.flatMap((invite) => {
      if (invite.guildId !== null && invite.guildId !== guildId) {
        throw evidenceError("Discord returned another guild's invite")
      }
      return invite.channelId === channelId ? [invite.code] : []
    }).sort()
    if (widget.channelId !== null && !snowflake(widget.channelId)) {
      throw evidenceError("Discord returned invalid widget channel evidence")
    }
    if (stageInstance && (
      stageInstance.channelId !== channelId
      || stageInstance.guildId !== guildId
    )) throw evidenceError("Discord returned another Stage instance")
    return {
      activeThreadIds,
      automodRuleIds: automodReferences(rules, channelId),
      categoryChildIds: options.channel.type === DISCORD_CHANNEL_TYPES.category
        ? canonicalIds(options.layout.channels.flatMap((channel) => (
            channel.parentChannelId === channelId ? [channel.channelId] : []
          )))
        : [],
      guildReferenceNames: guildReferences(options.guild, channelId),
      inviteReferences,
      onboardingReferences: onboardingReferences(onboarding, channelId),
      privateArchivedThreadIds,
      publicArchivedThreadIds,
      scheduledEventIds,
      stageInstanceIds: stageInstance ? [stageInstance.id] : [],
      webhookIds,
      welcomeScreenReferences: welcomeScreenReferences(welcomeScreen, channelId),
      widgetReferences: widget.channelId === channelId ? ["authenticated-widget"] : [],
    }
  }

  async #state(
    botId: string,
    guildId: string,
    channelId: string,
    options: RequestOptions,
  ): Promise<ChannelDeletionState> {
    if (!this.#layoutSource.layoutEnabled) {
      throw evidenceError("Discord Gateway channel-deletion layout is disabled")
    }
    let supporting: SupportingEvidence | undefined
    try {
      const channelEvidence = await collectGuildChannelEvidence({
        guildId,
        layoutSource: this.#layoutSource,
        readChannels: async () => {
          const [guildValue, memberValue, rawRoles, channels] = await Promise.all([
            this.#client.getGuild(guildId, options),
            this.#client.getGuildMember(guildId, botId, options),
            this.#client.getGuildRoles(guildId, options),
            this.#client.getGuildChannels(guildId, options),
          ])
          const guild = exactGuild(guildValue, guildId)
          let roles: NormalizedDiscordRole[]
          try {
            roles = normalizeDiscordRoleInventory(rawRoles, guildId)
          } catch (error) {
            throw evidenceError("Discord returned invalid channel-deletion role evidence", error)
          }
          if (roles.some((role) => (
            role.unknownFieldCount !== 0
            || role.unknownPermissionBits !== "0"
          ))) throw evidenceError("Discord returned unknown channel-deletion role evidence")
          const botMember = exactBotMember(memberValue, botId, roles, guildId)
          const guildPermission = exactGuildPermissions(guildId, botMember, rawRoles)
          const selected = exactTargetChannel(
            channels.find((channel) => channel.id === channelId),
            guildId,
            channelId,
          )
          const targetPermission = exactTargetPermissions({
            botId,
            channel: selected.channel,
            guildId,
            member: botMember,
            roles: rawRoles,
          })
          assertPermissions(guildPermission, targetPermission, selected.channel.type)
          const layout = exactLayout(
            this.#layoutSource.getChannelLayout(guildId),
            guildId,
          )
          const layoutTarget = layout.channels.find((channel) => channel.channelId === channelId)
          if (
            !layoutTarget
            || layoutTarget.obfuscated
            || layoutTarget.type !== selected.channel.type
            || layoutTarget.parentChannelId !== selected.target.parentChannelId
            || layoutTarget.position !== selected.target.rawPosition
          ) throw evidenceError("Discord target channel does not match the complete Gateway layout")
          const dependencies = await this.#dependencies({
            channel: selected.channel,
            guild,
            layout,
            requestOptions: options,
          })
          supporting = {
            botMember,
            dependencies,
            guild,
            guildPermission,
            roles,
            target: selected.target,
            targetChannel: selected.channel,
            targetPermission,
          }
          return channels
        },
      })
      if (!supporting) {
        throw evidenceError("Discord channel-deletion supporting evidence is unavailable")
      }
      const target = channelEvidence.layout.channels.find((channel) => (
        channel.channelId === channelId
      ))
      if (
        !target
        || target.obfuscated
        || target.type !== supporting.target.type
        || target.parentChannelId !== supporting.target.parentChannelId
      ) throw evidenceError("Discord target channel changed during evidence collection")
      return {
        ...supporting,
        httpEvidenceMode: channelEvidence.view.httpMode,
        layout: channelEvidence.layout,
      }
    } catch (error) {
      if (error instanceof ChannelDeletionEvidenceError) throw error
      if (error instanceof GuildChannelEvidenceError) {
        throw evidenceError(
          `Discord channel-deletion evidence is incomplete: ${error.message}`,
          error,
        )
      }
      throw evidenceError("Discord channel-deletion evidence collection failed", error)
    }
  }

  #readiness(
    applicationId: string,
    botId: string,
    state: ChannelDeletionState,
  ): ChannelDeletionReadiness {
    const blockers = dependencyBlockers(state.dependencies)
    const references = dependencyCounts(state.dependencies)
    const dependencyDigest = reviewedPlanDigest(this.#planKey, {
      dependencies: state.dependencies,
      guildId: state.guild.id,
      targetChannelId: state.target.id,
    })
    const evidenceDigest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: memberSnapshot(state.botMember),
      dependencies: state.dependencies,
      guild: {
        features: state.guild.features,
        id: state.guild.id,
        ownerId: state.guild.owner_id,
      },
      guildPermission: state.guildPermission,
      httpEvidenceMode: state.httpEvidenceMode,
      layout: state.layout,
      roles: rolesSnapshot(state.roles),
      target: state.target,
      targetChannel: targetEvidenceSnapshot(state.targetChannel, state.target),
      targetPermission: permissionSnapshot(state.targetPermission),
    })
    const requiredPermissions = requiredTargetPermissions(state.target.type)
    const warnings = [
      "The target channel name is untrusted Discord text and is never persisted by this workflow",
      "Message content is not fetched or counted; channel deletion can destroy an unbounded history",
      ...(state.target.lastMessagePresent
        ? ["Discord reports a last-message reference, confirming that the target may contain history"]
        : ["The absence of a last-message reference does not prove that the target has no history"]),
      ...(state.layout.channels.some((channel) => channel.obfuscated)
        ? ["The complete guild layout contains obfuscated channels whose metadata remains hidden"]
        : []),
      ...(state.guildPermission.administrator
        ? ["Discord connector has ADMINISTRATOR; replace it with narrowly scoped permissions"]
        : []),
      ...(VOICE_TARGET_TYPES.has(state.target.type)
        ? ["Voice and Stage occupant enumeration is unavailable; verify that the target is empty in Discord because deletion may disconnect active participants"]
        : []),
      "Discord exposes no conditional channel deletion, so external same-guild administration can race the reviewed write",
    ]
    const risks = [
      "Guild channel deletion is irreversible and can permanently destroy an unbounded message history",
      "The DELETE is sent once without automatic retry, rollback, or dependent-resource cleanup",
      "A transport ambiguity, response mismatch, topology contradiction, or Gateway timeout is uncertain and quarantines the guild channel collection",
      "The operation key is one-shot and cannot be retried after reservation, including after uncertainty",
    ]
    return {
      applicationId,
      blockers,
      botId,
      dependencies: {
        blockerCount: blockers.length,
        digest: dependencyDigest,
        references,
      },
      evidenceDigest,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      httpEvidenceMode: state.httpEvidenceMode,
      layout: {
        channelCount: state.layout.channels.length,
        obfuscatedChannels: state.layout.channels.filter((channel) => channel.obfuscated).length,
        revision: state.layout.revision,
        updatedAt: state.layout.updatedAt as string,
      },
      permission: {
        administrator: state.guildPermission.administrator,
        confidence: "complete",
        guildEffectivePermissionNames: discordPermissionNames(
          BigInt(state.guildPermission.effectivePermissions),
        ),
        guildEffectivePermissions: state.guildPermission.effectivePermissions,
        guildManageGuild: hasGuildPermission(state.guildPermission, "MANAGE_GUILD"),
        requiredTargetPermissions: requiredPermissions,
        targetEffectivePermissionNames: state.targetPermission.effectivePermissionNames,
        targetEffectivePermissions: state.targetPermission.effectivePermissions,
      },
      privacy: privacyProjection(),
      ready: blockers.length === 0,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: blockers.length === 0 ? "ready" : "blocked",
      target: state.target,
      warnings,
    }
  }

  async audit(
    applicationId: string,
    botId: string,
    guildId: string,
    channelId: string,
    options: RequestOptions = {},
  ): Promise<ChannelDeletionReadiness> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    assertSnowflake(guildId, "Discord channel-deletion guild ID")
    assertSnowflake(channelId, "Discord channel-deletion channel ID")
    this.#policy.assertChannelDeletionAuditable(guildId, channelId)
    return this.#readiness(
      applicationId,
      botId,
      await this.#state(botId, guildId, channelId, options),
    )
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedChannelDeletionRequest,
    options: RequestOptions,
  ): Promise<BuiltChannelDeletionPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertChannelDeletionAllowed(request.guildId, request.channelId)
    const existingReceipt = await this.#operationStore.get(
      "channel-deletion",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new ChannelDeletionOperationConflictError(receiptView(existingReceipt))
    }
    const state = await this.#state(botId, request.guildId, request.channelId, options)
    const readiness = this.#readiness(applicationId, botId, state)
    const digest = reviewedPlanDigest(this.#planKey, {
      acknowledgeIrreversibleContentLoss: request.acknowledgeIrreversibleContentLoss,
      auditReason: request.auditReason,
      evidenceDigest: readiness.evidenceDigest,
      operationKeyHash: request.operationKeyHash,
    })
    const {
      evidenceDigest: _evidenceDigest,
      ready: _ready,
      status: _readinessStatus,
      ...shared
    } = readiness
    const plan: ChannelDeletionPlan = {
      ...shared,
      acknowledgeIrreversibleContentLoss: true,
      auditReason: request.auditReason,
      createdAt: this.#clock().toISOString(),
      digest,
      operationKeyHash: request.operationKeyHash,
      status: readiness.ready ? "planned" : "blocked",
      writeRequired: readiness.ready,
    }
    return {
      baselineLayout: state.layout,
      plan,
      request,
      targetEvidence: targetEvidenceSnapshot(state.targetChannel, state.target),
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: ChannelDeletionRequest,
    options: RequestOptions = {},
  ): Promise<ChannelDeletionPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeChannelDeletionRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  execute(
    applicationId: string,
    botId: string,
    request: ChannelDeletionRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelDeletionResult> {
    const normalized = normalizeChannelDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord channel-deletion plan digest is invalid")
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
      () => new ChannelDeletionExecutionError(
        "Discord channel deletion was blocked because a prior same-guild operation ended uncertain",
        {
          channelId: normalized.channelId,
          guildId: normalized.guildId,
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
    request: NormalizedChannelDeletionRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ChannelDeletionResult> {
    let built: BuiltChannelDeletionPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ChannelDeletionEvidenceError
        || error instanceof DiscordRoleEvidenceError
        || error instanceof RangeError
        || error instanceof DiscordApiError && error.status === 404
      ) throw new ChannelDeletionPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      throw error
    }
    const { baselineLayout, plan, targetEvidence } = built
    if (plan.digest !== expectedDigest) {
      throw new ChannelDeletionPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      baselineChannelCount: plan.layout.channelCount,
      baselineLayoutRevision: plan.layout.revision,
      blockerCount: plan.blockers.length,
      channelId: request.channelId,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      targetKind: plan.target.kind,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        addedChannelCount: 0,
        observedChannelCount: null,
        observedLayoutRevision: null,
        status: "blocked",
        verification: "not-required",
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ChannelDeletionOperationConflictError(receiptView(reservation.receipt))
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
      throw new ChannelDeletionExecutionError(
        "Discord channel deletion was blocked because pending activity could not be recorded",
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

    let mutationAccepted = false
    let mutationStarted = false
    let verification: DeletionVerification | null = null
    let watch: LayoutVerificationWatch | undefined
    try {
      watch = layoutVerificationWatch({
        baseline: baselineLayout,
        channelId: request.channelId,
        guildId: request.guildId,
        source: this.#layoutSource,
        timeoutMs: this.#verificationTimeoutMs,
      })
      watch.arm()
      mutationStarted = true
      const deleted = await this.#client.deleteGuildChannel(
        request.channelId,
        request.auditReason,
        options,
      )
      mutationAccepted = true
      assertDeletedResponse(deleted, request.guildId, targetEvidence)
      verification = await watch.wait(options.signal)
    } catch (error) {
      const latest = watch?.latest() ?? null
      const settled = !mutationStarted || (
        !mutationAccepted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
      )
      const status = settled ? "failed" : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
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
          error: errorCode,
          observedRevision: latest?.revision ?? null,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ChannelDeletionExecutionError(
        "Discord channel deletion did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          observedChannelCount: latest?.channels.length ?? null,
          observedLayoutRevision: latest?.revision ?? null,
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

    const completedStatus = verification.verification === "drift"
      ? "completed-with-drift" as const
      : "completed" as const
    const result: ChannelDeletionResult = {
      ...baseResult,
      activityId,
      addedChannelCount: verification.addedChannelCount,
      observedChannelCount: verification.snapshot.channels.length,
      observedLayoutRevision: verification.snapshot.revision,
      status: completedStatus,
      verification: verification.verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: verification.verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: safeErrorCode(error),
          observedRevision: verification.snapshot.revision,
          plan,
          request,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ChannelDeletionExecutionError(
        "Discord channel deletion completed but the operation receipt failed",
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
        observedRevision: verification.snapshot.revision,
        plan,
        request,
        status: completedStatus,
        timestamp: this.#clock().toISOString(),
        verification: verification.verification,
      }))
    } catch (error) {
      throw new ChannelDeletionExecutionError(
        "Discord channel deletion completed but the final activity record failed",
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
