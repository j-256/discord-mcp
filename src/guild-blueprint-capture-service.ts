import { createHash } from "node:crypto"

import {
  assertGuildChannelInventory,
  logicalChannelNameKey,
  normalizeChannelCreationRequest,
} from "./channel-administration-service.js"
import {
  projectAutoModerationRuleInventory,
  type ProjectedAutoModerationRule,
} from "./automod-service.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_AFK_TIMEOUT_SECONDS,
  GUILD_DEFAULT_MESSAGE_NOTIFICATIONS,
  GUILD_EXPLICIT_CONTENT_FILTERS,
  GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK,
  GUILD_SYSTEM_NOTIFICATION_SUPPRESSIONS,
  GUILD_VERIFICATION_LEVELS,
  IDEMPOTENCY_KEY_PATTERN,
  SCHEMA_VERSION,
  type GuildSystemNotificationSuppression,
} from "./constants.js"
import {
  DISCORD_ONBOARDING_MODES,
  DISCORD_ONBOARDING_PROMPT_TYPES,
  encodeDiscordAuditReason,
  type DiscordAutoModerationRuleSummary,
  type DiscordClient,
  type DiscordGuildOnboarding,
  type DiscordGuildWelcomeScreen,
} from "./discord-client.js"
import {
  projectGuildProfile,
  type DiscordGuildProfile,
} from "./guild-profile.js"
import {
  type GuildBlueprintAutoModerationActionInput,
  type GuildBlueprintAutoModerationRuleInput,
  type GuildBlueprintChannelReference,
  type GuildBlueprintCommunityInput,
  type GuildBlueprintOnboardingInput,
  type GuildBlueprintOnboardingPromptInput,
  type GuildBlueprintRequest,
  type GuildBlueprintRoleReference,
  type GuildBlueprintWelcomeScreenInput,
  normalizeGuildBlueprintRequest,
} from "./guild-blueprint-service.js"
import {
  createGuildRecoveryAttestation,
  createGuildRecoveryAttestationKey,
  guildRecoveryTargetStateDigest,
  type GuildRecoveryAttestedBinding,
  type GuildRecoveryResourceType,
} from "./guild-recovery-attestation.js"
import type {
  GuildCommunityAuditResult,
  GuildCommunityChannelReferenceView,
} from "./guild-community-service.js"
import { stableString } from "./normalize.js"
import type { OnboardingEmojiRequest } from "./onboarding-service.js"
import { operationKeyHash } from "./operation-store.js"
import type { ScopePolicy } from "./policy.js"
import {
  logicalRoleNameKey,
  normalizeDiscordRoleInventory,
  normalizeRoleCreationRequest,
  type NormalizedDiscordRole,
} from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const CAPTURE_REQUEST_KEYS = Object.freeze([
  "auditReason",
  "guildId",
  "operationKey",
] as const)
const CAPTURE_DIGEST_PREFIX = "sha256:"
const COMMUNITY_FEATURE = "COMMUNITY"
const WELCOME_SCREEN_ENABLED_FEATURE = "WELCOME_SCREEN_ENABLED"
const SUPPORTED_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.category,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.text,
])
const CHANNEL_CAPTURE_RESPONSE_KEYS: ReadonlySet<string> = new Set([
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
const SYSTEM_NOTIFICATION_BITS = Object.freeze({
  "guild-reminders": 1 << 2,
  "join-notification-replies": 1 << 3,
  "join-notifications": 1 << 0,
  "premium-subscriptions": 1 << 1,
  "role-subscription-purchase-notification-replies": 1 << 5,
  "role-subscription-purchase-notifications": 1 << 4,
} satisfies Record<GuildSystemNotificationSuppression, number>)

export type GuildBlueprintCaptureStatus =
  | "blocked"
  | "changed-during-capture"
  | "ready"
  | "review-required"

export type GuildBlueprintCaptureFindingCode =
  | "AUTOMOD_UNKNOWN_EVIDENCE"
  | "BLUEPRINT_RESOURCE_LIMIT"
  | "BLUEPRINT_VALIDATION_FAILED"
  | "CAPTURE_CHANGED"
  | "CHANNEL_AMBIGUOUS_NAME"
  | "CHANNEL_FORUM_CONFIGURATION_OMITTED"
  | "CHANNEL_ORDER_OMITTED"
  | "CHANNEL_PARENT_OMITTED"
  | "CHANNEL_PERMISSION_OVERWRITES_OMITTED"
  | "CHANNEL_UNREPRESENTABLE"
  | "CHANNEL_UNSUPPORTED_TYPE"
  | "CHANNEL_UNKNOWN_EVIDENCE"
  | "COMMUNITY_EVIDENCE_OMITTED"
  | "CHANNEL_REFERENCE_UNRESOLVED"
  | "EXACT_CHANNEL_REFERENCE_RETAINED"
  | "EXACT_ROLE_REFERENCE_RETAINED"
  | "ONBOARDING_UNKNOWN_EVIDENCE"
  | "ONBOARDING_UNKNOWN_ENUM"
  | "ROLE_ADMINISTRATOR_OMITTED"
  | "ROLE_AMBIGUOUS_NAME"
  | "ROLE_COSMETICS_OMITTED"
  | "ROLE_MANAGED_OMITTED"
  | "ROLE_ORDER_OMITTED"
  | "ROLE_UNREPRESENTABLE"
  | "ROLE_REFERENCE_UNRESOLVED"
  | "ROLE_UNKNOWN_EVIDENCE"
  | "ROLE_UNKNOWN_PERMISSION_BITS"
  | "SCAFFOLD_BELOW_MINIMUM"
  | "SETTINGS_UNKNOWN_ENUM"
  | "SETTINGS_UNKNOWN_SYSTEM_FLAGS"
  | "WELCOME_SCREEN_UNAVAILABLE"
  | "WELCOME_SCREEN_UNKNOWN_EVIDENCE"

export interface GuildBlueprintCaptureFinding {
  code: GuildBlueprintCaptureFindingCode
  message: string
  resourceId: string | null
  resourceType: "auto-moderation" | "capture" | "channel" | "community" | "role"
}

export interface GuildBlueprintCaptureRequest {
  auditReason: string
  guildId: string
  operationKey: string
}

export interface NormalizedGuildBlueprintCaptureRequest
  extends GuildBlueprintCaptureRequest {
  operationKeyHash: string
}

export interface GuildBlueprintCaptureCoverage {
  autoModerationRules: {
    captured: number
    returned: number
    visibility: "connector-visible"
  }
  channels: {
    captured: number
    returned: number
    visibility: "discord-and-policy-bounded"
  }
  community: {
    captured: boolean
    evidence: "complete" | "incomplete" | "unavailable"
    liveEnabled: boolean | null
  }
  domains: readonly [
    "structure",
    "profile",
    "settings",
    "community",
    "welcome-screen",
    "onboarding",
    "auto-moderation",
  ]
  exactChannelReferences: number
  exactRoleReferences: number
  roles: {
    captured: number
    returned: number
  }
}

export interface GuildBlueprintCapturePrivacy {
  activityPersistence: "none"
  attachments: "not-read"
  autoModerationExecutionEvents: "not-read"
  components: "not-read"
  memberProfiles: "connector-bot-identity-only"
  messageContent: "not-read"
  rawPayloads: "omitted"
  recoveryAttestations: "transient-process-bound"
  returnedText: "transient-caller-retained"
  serverPersistence: "none"
  webhooks: "not-read"
}

export interface GuildBlueprintCaptureLimitations {
  atomicSnapshot: false
  completeBackup: false
  crossGuildPortable: false
  messageRecovery: false
  originalIdRestoration: false
  rollback: false
}

interface GuildBlueprintCaptureBaseResult {
  applicationId: string
  botId: string
  captureWindow: {
    completedAt: string
    passes: 2
    startedAt: string
    stable: boolean
  }
  guildId: string
  limitations: GuildBlueprintCaptureLimitations
  operationKeyHash: string
  privacy: GuildBlueprintCapturePrivacy
  schemaVersion: number
  freshPlanRequired: true
  status: GuildBlueprintCaptureStatus
}

export interface GuildBlueprintCaptureChangedResult
  extends GuildBlueprintCaptureBaseResult {
  blockers: readonly [GuildBlueprintCaptureFinding]
  blueprint: null
  captureDigest: null
  coverage: null
  omissions: readonly []
  recoveryBindings: GuildRecoveryAttestedBinding[]
  nextAction: "retry-capture"
  plannerReady: false
  status: "changed-during-capture"
}

export interface GuildBlueprintCaptureBlockedResult
  extends GuildBlueprintCaptureBaseResult {
  blockers: GuildBlueprintCaptureFinding[]
  blueprint: null
  captureDigest: null
  coverage: GuildBlueprintCaptureCoverage
  omissions: GuildBlueprintCaptureFinding[]
  recoveryBindings: GuildRecoveryAttestedBinding[]
  nextAction: "resolve-blockers-and-recapture"
  plannerReady: false
  status: "blocked"
}

export interface GuildBlueprintCaptureReadyResult
  extends GuildBlueprintCaptureBaseResult {
  blockers: readonly []
  blueprint: GuildBlueprintRequest
  captureDigest: string
  coverage: GuildBlueprintCaptureCoverage
  omissions: GuildBlueprintCaptureFinding[]
  recoveryBindings: GuildRecoveryAttestedBinding[]
  nextAction: "retain-blueprint-and-plan" | "review-or-edit-omissions-before-plan"
  plannerReady: true
  status: "ready" | "review-required"
}

export type GuildBlueprintCaptureResult =
  | GuildBlueprintCaptureBlockedResult
  | GuildBlueprintCaptureChangedResult
  | GuildBlueprintCaptureReadyResult

interface GuildBlueprintCapturePass {
  autoModerationRules: DiscordAutoModerationRuleSummary[]
  channels: DiscordChannel[]
  community: GuildBlueprintCaptureCommunityEvidence
  guild: DiscordGuild
  onboarding: DiscordGuildOnboarding
  profile: DiscordGuildProfile
  roles: DiscordRole[]
  welcomeScreen: DiscordGuildWelcomeScreen | null
}

type GuildBlueprintCaptureCommunityEvidence =
  | { audit: GuildCommunityAuditResult; status: "available" }
  | { status: "unavailable" }

interface ValidatedGuildSettings {
  afkChannelId: string | null
  afkTimeoutSeconds: typeof GUILD_AFK_TIMEOUT_SECONDS[number]
  defaultMessageNotifications: typeof GUILD_DEFAULT_MESSAGE_NOTIFICATIONS[number] | null
  explicitContentFilter: typeof GUILD_EXPLICIT_CONTENT_FILTERS[number] | null
  features: string[]
  premiumProgressBarEnabled: boolean
  rawEnums: {
    defaultMessageNotifications: number
    explicitContentFilter: number
    verificationLevel: number
  }
  rawSystemChannelFlags: number
  suppressedSystemNotifications: GuildSystemNotificationSuppression[] | null
  systemChannelId: string | null
  unknownSystemFlags: boolean
  verificationLevel: typeof GUILD_VERIFICATION_LEVELS[number] | null
}

interface ProjectedCapturePass {
  bindings: GuildBlueprintCaptureBindingSource[]
  blockers: GuildBlueprintCaptureFinding[]
  blueprint: GuildBlueprintRequest | null
  coverage: GuildBlueprintCaptureCoverage
  omissions: GuildBlueprintCaptureFinding[]
  source: unknown
}

interface GuildBlueprintCaptureBindingSource {
  blueprintKey: string
  omissionCodes: string[]
  resourceId: string
  resourceType: GuildRecoveryResourceType
  targetStateDigest: string
}

export interface GuildBlueprintCaptureServiceOptions {
  client: Pick<
    DiscordClient,
    | "getGuild"
    | "getGuildChannels"
    | "getGuildOnboarding"
    | "getGuildRoles"
    | "getGuildWelcomeScreen"
    | "listGuildAutoModerationRules"
  >
  clock?: () => Date
  community: {
    get(
      applicationId: string,
      botId: string,
      guildId: string,
      options?: RequestOptions,
    ): Promise<GuildCommunityAuditResult>
  }
  policy: ScopePolicy
  recoveryAttestationKey?: Uint8Array
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  message: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError(message)
  }
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) throw new RangeError(message)
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

export function normalizeGuildBlueprintCaptureRequest(
  request: GuildBlueprintCaptureRequest,
): NormalizedGuildBlueprintCaptureRequest {
  exactObject(
    request,
    CAPTURE_REQUEST_KEYS,
    "Discord guild blueprint capture request must be an exact object",
  )
  if (!positiveSnowflake(request.guildId)) {
    throw new RangeError("Discord guild blueprint capture requires an exact guild snowflake")
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord guild blueprint capture audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  if (
    typeof request.operationKey !== "string"
    || request.operationKey.length < CONNECTOR_LIMITS.idempotencyKeyMinimumCharacters
    || request.operationKey.length > CONNECTOR_LIMITS.idempotencyKeyCharacters
    || !IDEMPOTENCY_KEY_PATTERN.test(request.operationKey)
  ) {
    throw new RangeError(
      `Discord guild blueprint capture operation key must be ${CONNECTOR_LIMITS.idempotencyKeyMinimumCharacters}-${CONNECTOR_LIMITS.idempotencyKeyCharacters} safe ASCII characters`,
    )
  }
  return {
    auditReason: request.auditReason,
    guildId: request.guildId,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function finding(
  code: GuildBlueprintCaptureFindingCode,
  message: string,
  resourceType: GuildBlueprintCaptureFinding["resourceType"] = "capture",
  resourceId: string | null = null,
): GuildBlueprintCaptureFinding {
  return { code, message, resourceId, resourceType }
}

function nullableSnowflake(value: unknown, description: string): string | null {
  if (value === null) return null
  if (!positiveSnowflake(value)) {
    throw new RangeError(`Discord returned invalid ${description}`)
  }
  return value
}

function validateGuildSettings(
  guild: DiscordGuild,
  guildId: string,
): ValidatedGuildSettings {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || !Array.isArray(guild.features)
    || guild.features.length > DISCORD_LIMITS.guildFeatures
    || guild.features.some((feature) => (
      typeof feature !== "string"
      || feature.length < 1
      || feature.length > DISCORD_LIMITS.guildFeatureCharacters
      || !/^[A-Z0-9_]+$/u.test(feature)
    ))
    || new Set(guild.features).size !== guild.features.length
    || !Number.isInteger(guild.verification_level)
    || !Number.isInteger(guild.default_message_notifications)
    || !Number.isInteger(guild.explicit_content_filter)
    || !(GUILD_AFK_TIMEOUT_SECONDS as readonly number[]).includes(
      guild.afk_timeout as number,
    )
    || typeof guild.premium_progress_bar_enabled !== "boolean"
    || !Number.isSafeInteger(guild.system_channel_flags)
    || (guild.system_channel_flags as number) < 0
  ) {
    throw new RangeError("Discord returned incomplete guild-settings capture evidence")
  }
  const verificationLevel = GUILD_VERIFICATION_LEVELS[
    guild.verification_level as number
  ] ?? null
  const defaultMessageNotifications = GUILD_DEFAULT_MESSAGE_NOTIFICATIONS[
    guild.default_message_notifications as number
  ] ?? null
  const explicitContentFilter = GUILD_EXPLICIT_CONTENT_FILTERS[
    guild.explicit_content_filter as number
  ] ?? null
  const systemFlags = guild.system_channel_flags as number
  const unknownSystemFlags = (
    BigInt(systemFlags) & ~BigInt(GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK)
  ) !== 0n
  return {
    afkChannelId: nullableSnowflake(
      guild.afk_channel_id,
      "guild blueprint AFK channel evidence",
    ),
    afkTimeoutSeconds: guild.afk_timeout as typeof GUILD_AFK_TIMEOUT_SECONDS[number],
    defaultMessageNotifications,
    explicitContentFilter,
    features: [...guild.features].sort(),
    premiumProgressBarEnabled: guild.premium_progress_bar_enabled,
    rawEnums: {
      defaultMessageNotifications: guild.default_message_notifications as number,
      explicitContentFilter: guild.explicit_content_filter as number,
      verificationLevel: guild.verification_level as number,
    },
    rawSystemChannelFlags: systemFlags,
    suppressedSystemNotifications: unknownSystemFlags
      ? null
      : GUILD_SYSTEM_NOTIFICATION_SUPPRESSIONS
        .filter((name) => (systemFlags & SYSTEM_NOTIFICATION_BITS[name]) !== 0)
        .sort(),
    systemChannelId: nullableSnowflake(
      guild.system_channel_id,
      "guild blueprint system channel evidence",
    ),
    unknownSystemFlags,
    verificationLevel,
  }
}

function roleKey(roleId: string): string {
  return `role-${roleId}`
}

function channelKey(channelId: string): string {
  return `channel-${channelId}`
}

function autoModerationRuleKey(ruleId: string): string {
  return `automod-${ruleId}`
}

function channelKind(type: number): "category" | "forum" | "text" | null {
  if (type === DISCORD_CHANNEL_TYPES.category) return "category"
  if (type === DISCORD_CHANNEL_TYPES.forum) return "forum"
  if (type === DISCORD_CHANNEL_TYPES.text) return "text"
  return null
}

function channelSort(left: DiscordChannel, right: DiscordChannel): number {
  const leftCategory = left.type === DISCORD_CHANNEL_TYPES.category ? 0 : 1
  const rightCategory = right.type === DISCORD_CHANNEL_TYPES.category ? 0 : 1
  return leftCategory - rightCategory
    || (left.position ?? Number.MAX_SAFE_INTEGER)
      - (right.position ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id)
}

function roleSort(left: NormalizedDiscordRole, right: NormalizedDiscordRole): number {
  return left.position - right.position || left.id.localeCompare(right.id)
}

function boundedArrayLength(
  value: unknown,
  maximum: number,
  description: string,
): number {
  if (value === undefined) return 0
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RangeError(`Discord returned invalid ${description}`)
  }
  return value.length
}

function assertChannelCaptureBounds(channel: DiscordChannel): void {
  if (
    (channel.position !== undefined && (
      !Number.isSafeInteger(channel.position)
      || channel.position < 0
    ))
    || (channel.flags !== undefined && (
      !Number.isSafeInteger(channel.flags)
      || channel.flags < 0
    ))
  ) {
    throw new RangeError("Discord returned invalid bounded channel capture evidence")
  }
  boundedArrayLength(
    channel.available_tags,
    DISCORD_LIMITS.forumAvailableTags,
    "forum-tag capture evidence",
  )
  boundedArrayLength(
    channel.permission_overwrites,
    DISCORD_LIMITS.channelPermissionOverwrites,
    "channel-overwrite capture evidence",
  )
}

function sourceChannelProjection(channel: DiscordChannel): unknown {
  return {
    availableTagCount: boundedArrayLength(
      channel.available_tags,
      DISCORD_LIMITS.forumAvailableTags,
      "forum-tag capture evidence",
    ),
    defaultAutoArchiveDuration: channel.default_auto_archive_duration ?? null,
    defaultForumLayout: channel.default_forum_layout ?? null,
    defaultReactionPresent: channel.default_reaction_emoji != null,
    defaultSortOrder: channel.default_sort_order ?? null,
    defaultThreadRateLimitPerUser: channel.default_thread_rate_limit_per_user ?? null,
    flags: channel.flags ?? 0,
    id: channel.id,
    name: channel.name ?? null,
    nsfw: channel.nsfw ?? false,
    parentId: channel.parent_id ?? null,
    permissionOverwriteCount: boundedArrayLength(
      channel.permission_overwrites,
      DISCORD_LIMITS.channelPermissionOverwrites,
      "channel-overwrite capture evidence",
    ),
    position: channel.position ?? null,
    rateLimitPerUser: channel.rate_limit_per_user ?? 0,
    topic: channel.topic ?? null,
    type: channel.type,
    unknownFieldCount: channelUnknownFieldCount(channel),
  }
}

export function guildBlueprintChannelRecoveryStateDigest(
  channel: DiscordChannel,
): string {
  return guildRecoveryTargetStateDigest(sourceChannelProjection(channel))
}

function referenceForChannel(
  channelId: string,
  capturedKeys: ReadonlyMap<string, string>,
  exactReferences: Set<string>,
): GuildBlueprintChannelReference {
  const key = capturedKeys.get(channelId)
  if (key) return { key, kind: "scaffold" }
  exactReferences.add(channelId)
  return { channelId, kind: "exact" }
}

function referenceForRole(
  roleId: string,
  capturedKeys: ReadonlyMap<string, string>,
  exactReferences: Set<string>,
): GuildBlueprintRoleReference {
  const key = capturedKeys.get(roleId)
  if (key) return { key, kind: "scaffold" }
  exactReferences.add(roleId)
  return { kind: "exact", roleId }
}

function capturedAutoModerationAction(
  action: ProjectedAutoModerationRule["actions"][number],
  capturedChannelKeys: ReadonlyMap<string, string>,
  exactChannelReferences: Set<string>,
): GuildBlueprintAutoModerationActionInput {
  if (action.type === "send-alert-message") {
    return {
      channel: referenceForChannel(
        action.channelId,
        capturedChannelKeys,
        exactChannelReferences,
      ),
      type: "send-alert-message",
    }
  }
  if (action.type === "block-message") {
    return {
      ...(action.customMessage === null
        ? {}
        : { customMessage: action.customMessage }),
      type: "block-message",
    }
  }
  if (action.type === "timeout") return { ...action }
  return { type: "block-member-interaction" }
}

function capturedAutoModerationRule(
  rule: ProjectedAutoModerationRule,
  capturedChannelKeys: ReadonlyMap<string, string>,
  capturedRoleKeys: ReadonlyMap<string, string>,
  exactChannelReferences: Set<string>,
  exactRoleReferences: Set<string>,
): GuildBlueprintAutoModerationRuleInput {
  return {
    actions: rule.actions.map((action) => capturedAutoModerationAction(
      action,
      capturedChannelKeys,
      exactChannelReferences,
    )),
    enabled: rule.enabled,
    exemptChannels: rule.exemptChannelIds.map((channelId) => referenceForChannel(
      channelId,
      capturedChannelKeys,
      exactChannelReferences,
    )),
    exemptRoles: rule.exemptRoleIds.map((roleId) => referenceForRole(
      roleId,
      capturedRoleKeys,
      exactRoleReferences,
    )),
    key: autoModerationRuleKey(rule.ruleId),
    name: rule.name,
    ruleId: rule.ruleId,
    trigger: rule.trigger,
  }
}

function unresolvedReferenceFinding(
  id: string,
  type: "channel" | "role",
): GuildBlueprintCaptureFinding {
  return finding(
    type === "channel"
      ? "CHANNEL_REFERENCE_UNRESOLVED"
      : "ROLE_REFERENCE_UNRESOLVED",
    `A ${type} reference was not present in the bounded live inventory and cannot be retained safely`,
    type,
    positiveSnowflake(id) ? id : null,
  )
}

function welcomeEmoji(
  emojiId: string | null,
  emojiName: string | null,
): GuildBlueprintWelcomeScreenInput["channels"][number]["emoji"] {
  if (emojiId) return { emojiId, kind: "custom" }
  if (emojiName) return { kind: "unicode", unicode: emojiName }
  return { kind: "none" }
}

function onboardingEmoji(
  value: DiscordGuildOnboarding["prompts"][number]["options"][number]["emoji"],
): OnboardingEmojiRequest | null {
  if (!value) return null
  if (value.id) return { guildEmojiId: value.id, kind: "guild" }
  if (value.name) return { kind: "unicode", unicode: value.name }
  return null
}

function channelForumConfigurationPresent(channel: DiscordChannel): boolean {
  return boundedArrayLength(
    channel.available_tags,
    DISCORD_LIMITS.forumAvailableTags,
    "forum-tag capture evidence",
  ) > 0
    || channel.default_forum_layout !== undefined
    || channel.default_reaction_emoji != null
    || channel.default_sort_order != null
    || (channel.default_thread_rate_limit_per_user ?? 0) !== 0
    || ((channel.flags ?? 0) & DISCORD_CHANNEL_FLAGS.requireTag) !== 0
}

function channelUnknownFieldCount(channel: DiscordChannel): number {
  return Object.keys(channel as unknown as Record<string, unknown>)
    .filter((field) => !CHANNEL_CAPTURE_RESPONSE_KEYS.has(field)).length
}

function canonicalRoleProjection(role: NormalizedDiscordRole): unknown {
  return {
    colors: role.colors,
    flags: role.flags,
    hoist: role.hoist,
    icon: role.icon,
    id: role.id,
    managed: role.managed,
    management: role.management,
    mentionable: role.mentionable,
    name: role.name,
    permissionNames: role.permissionNames,
    permissions: role.permissions,
    position: role.position,
    unicodeEmoji: role.unicodeEmoji,
    unknownFieldCount: role.unknownFieldCount,
    unknownPermissionBits: role.unknownPermissionBits,
  }
}

export function guildBlueprintRoleRecoveryStateDigest(
  role: NormalizedDiscordRole,
): string {
  return guildRecoveryTargetStateDigest(canonicalRoleProjection(role))
}

function communityChannelSourceProjection(
  view: GuildCommunityChannelReferenceView | null,
): unknown {
  if (view === null) return null
  return {
    channelId: view.channelId,
    direct: view.direct,
    everyoneCanSend: view.everyoneCanSend,
    everyoneCanView: view.everyoneCanView,
    exists: view.exists,
    parentId: view.parentId,
    type: view.type,
    unknownPermissionBitsPresent: view.unknownPermissionBitsPresent,
  }
}

function communitySourceProjection(
  evidence: GuildBlueprintCaptureCommunityEvidence,
): unknown {
  if (evidence.status === "unavailable") return { status: "unavailable" }
  const configuration = evidence.audit.configuration
  return {
    applicationId: evidence.audit.applicationId,
    botId: evidence.audit.botId,
    configuration: {
      communityEnabled: configuration.communityEnabled,
      featureCount: configuration.featureCount,
      featureDigest: configuration.featureDigest,
      publicUpdatesChannel: communityChannelSourceProjection(
        configuration.publicUpdatesChannel,
      ),
      publicUpdatesChannelId: configuration.publicUpdatesChannelId,
      rulesChannel: communityChannelSourceProjection(configuration.rulesChannel),
      rulesChannelId: configuration.rulesChannelId,
      safetyAlertsChannel: communityChannelSourceProjection(
        configuration.safetyAlertsChannel,
      ),
      safetyAlertsChannelId: configuration.safetyAlertsChannelId,
      stateDigest: configuration.stateDigest,
    },
    guildId: evidence.audit.guildId,
    schemaVersion: evidence.audit.schemaVersion,
    status: evidence.audit.status,
  }
}

function communityChannelEvidenceMatches(
  channelId: string,
  view: GuildCommunityChannelReferenceView | null,
  rulesChannel: boolean,
): boolean {
  return view !== null
    && view.channelId === channelId
    && view.direct === true
    && view.exists === true
    && (
      view.type === DISCORD_CHANNEL_TYPES.text
      || view.type === DISCORD_CHANNEL_TYPES.announcement
    )
    && (rulesChannel
      ? view.everyoneCanView === true
        && view.unknownPermissionBitsPresent === false
      : view.unknownPermissionBitsPresent === null)
}

function completeCommunityConfiguration(
  audit: GuildCommunityAuditResult,
): boolean {
  const configuration = audit.configuration
  return configuration.communityEnabled === true
    && positiveSnowflake(configuration.rulesChannelId)
    && positiveSnowflake(configuration.publicUpdatesChannelId)
    && configuration.rulesChannelId !== configuration.publicUpdatesChannelId
    && communityChannelEvidenceMatches(
      configuration.rulesChannelId,
      configuration.rulesChannel,
      true,
    )
    && communityChannelEvidenceMatches(
      configuration.publicUpdatesChannelId,
      configuration.publicUpdatesChannel,
      false,
    )
    && (
      configuration.safetyAlertsChannelId === null
        ? configuration.safetyAlertsChannel === null
        : positiveSnowflake(configuration.safetyAlertsChannelId)
          && communityChannelEvidenceMatches(
            configuration.safetyAlertsChannelId,
            configuration.safetyAlertsChannel,
            false,
          )
    )
}

function projectPass(
  pass: GuildBlueprintCapturePass,
  request: NormalizedGuildBlueprintCaptureRequest,
  applicationId: string,
  botId: string,
): ProjectedCapturePass {
  const blockers: GuildBlueprintCaptureFinding[] = []
  const omissions: GuildBlueprintCaptureFinding[] = []
  const settings = validateGuildSettings(pass.guild, request.guildId)
  if (pass.profile.id !== request.guildId || pass.onboarding.guildId !== request.guildId) {
    throw new RangeError("Discord returned mismatched guild blueprint capture evidence")
  }
  if (
    pass.community.status === "available"
    && (
      pass.community.audit.applicationId !== applicationId
      || pass.community.audit.botId !== botId
      || pass.community.audit.guildId !== request.guildId
      || pass.community.audit.schemaVersion !== SCHEMA_VERSION
      || pass.community.audit.status !== "ok"
    )
  ) {
    throw new RangeError(
      "Discord returned mismatched guild Community capture evidence",
    )
  }
  const roles = normalizeDiscordRoleInventory(pass.roles, request.guildId)
  assertGuildChannelInventory(pass.channels, request.guildId)
  for (const channel of pass.channels) assertChannelCaptureBounds(channel)
  const channels = [...pass.channels].sort(channelSort)
  const autoModerationRules = projectAutoModerationRuleInventory(
    pass.autoModerationRules,
    request.guildId,
  )
  for (const rule of pass.autoModerationRules) {
    if ((rule.unknownFieldCount ?? 0) > 0) {
      blockers.push(finding(
        "AUTOMOD_UNKNOWN_EVIDENCE",
        "An AutoMod rule with unknown response fields cannot be captured as complete policy",
        "auto-moderation",
        rule.id,
      ))
    }
  }
  const returnedChannelIds = new Set(channels.map((channel) => channel.id))
  const returnedRoleIds = new Set(roles.map((role) => role.id))
  const unresolvedChannelIds = new Set<string>()
  const unresolvedRoleIds = new Set<string>()
  const requireChannelReference = (channelId: string | null): void => {
    if (
      channelId !== null
      && !returnedChannelIds.has(channelId)
      && !unresolvedChannelIds.has(channelId)
    ) {
      unresolvedChannelIds.add(channelId)
      blockers.push(unresolvedReferenceFinding(channelId, "channel"))
    }
  }
  const requireRoleReference = (roleId: string): void => {
    if (!returnedRoleIds.has(roleId) && !unresolvedRoleIds.has(roleId)) {
      unresolvedRoleIds.add(roleId)
      blockers.push(unresolvedReferenceFinding(roleId, "role"))
    }
  }
  requireChannelReference(settings.afkChannelId)
  requireChannelReference(settings.systemChannelId)
  for (const entry of pass.welcomeScreen?.welcomeChannels ?? []) {
    requireChannelReference(entry.channelId)
  }
  for (const channelId of pass.onboarding.defaultChannelIds) {
    requireChannelReference(channelId)
  }
  for (const prompt of pass.onboarding.prompts) {
    for (const option of prompt.options) {
      for (const channelId of option.channelIds) requireChannelReference(channelId)
      for (const roleId of option.roleIds) requireRoleReference(roleId)
    }
  }
  for (const rule of autoModerationRules) {
    for (const channelId of rule.exemptChannelIds) requireChannelReference(channelId)
    for (const roleId of rule.exemptRoleIds) requireRoleReference(roleId)
    for (const action of rule.actions) {
      if (action.type === "send-alert-message") {
        requireChannelReference(action.channelId)
      }
    }
  }
  if (
    settings.verificationLevel === null
    || settings.defaultMessageNotifications === null
    || settings.explicitContentFilter === null
  ) {
    blockers.push(finding(
      "SETTINGS_UNKNOWN_ENUM",
      "Discord returned a guild-settings enum that the blueprint contract cannot represent",
    ))
  }

  const roleNameCounts = new Map<string, number>()
  for (const role of roles) {
    if (role.id === request.guildId) continue
    const key = logicalRoleNameKey(role.name)
    roleNameCounts.set(key, (roleNameCounts.get(key) ?? 0) + 1)
  }
  const roleCandidates: NormalizedDiscordRole[] = []
  for (const role of [...roles].sort(roleSort)) {
    if (role.id === request.guildId) continue
    if (role.managed || role.management.type !== "standard") {
      omissions.push(finding(
        "ROLE_MANAGED_OMITTED",
        "Managed Discord roles are not recreated by guild blueprints",
        "role",
        role.id,
      ))
      continue
    }
    if (role.unknownFieldCount > 0) {
      omissions.push(finding(
        "ROLE_UNKNOWN_EVIDENCE",
        "A standard role with unknown response fields is not recreated without understanding their semantics",
        "role",
        role.id,
      ))
      continue
    }
    if ((roleNameCounts.get(logicalRoleNameKey(role.name)) ?? 0) > 1) {
      blockers.push(finding(
        "ROLE_AMBIGUOUS_NAME",
        "A standard role has a logical name collision that the additive planner cannot resolve safely",
        "role",
        role.id,
      ))
      continue
    }
    if (role.unknownPermissionBits !== "0") {
      omissions.push(finding(
        "ROLE_UNKNOWN_PERMISSION_BITS",
        "A role with unknown permission bits cannot be recreated without guessing authority",
        "role",
        role.id,
      ))
      continue
    }
    if (role.permissionNames.includes("ADMINISTRATOR")) {
      omissions.push(finding(
        "ROLE_ADMINISTRATOR_OMITTED",
        "Guild blueprints never recreate a role that grants ADMINISTRATOR",
        "role",
        role.id,
      ))
      continue
    }
    try {
      normalizeRoleCreationRequest({
        auditReason: request.auditReason,
        guildId: request.guildId,
        hoist: role.hoist,
        mentionable: role.mentionable,
        name: role.name,
        operationKey: request.operationKey,
        permissions: role.permissionNames,
        primaryColor: role.colors.primaryColor,
      })
      roleCandidates.push(role)
    } catch {
      omissions.push(finding(
        "ROLE_UNREPRESENTABLE",
        "A standard role cannot be represented by the strict guild blueprint schema",
        "role",
        role.id,
      ))
    }
  }
  const selectedRoles = roleCandidates.slice(0, CONNECTOR_LIMITS.scaffoldRoles)
  for (const role of roleCandidates.slice(CONNECTOR_LIMITS.scaffoldRoles)) {
    omissions.push(finding(
      "BLUEPRINT_RESOURCE_LIMIT",
      "A role is outside the bounded guild blueprint scaffold capacity",
      "role",
      role.id,
    ))
  }
  const selectedRoleKeys = new Map(
    selectedRoles.map((role) => [role.id, roleKey(role.id)] as const),
  )
  const scaffoldRoles = selectedRoles.map((role) => ({
    hoist: role.hoist,
    key: selectedRoleKeys.get(role.id) as string,
    mentionable: role.mentionable,
    name: role.name,
    permissions: role.permissionNames,
    primaryColor: role.colors.primaryColor,
  }))
  if (selectedRoles.length > 1) {
    omissions.push(finding(
      "ROLE_ORDER_OMITTED",
      "Guild blueprints do not preserve role ordering",
      "role",
    ))
  }
  for (const role of selectedRoles) {
    if (
      role.icon !== null
      || role.unicodeEmoji !== null
      || role.colors.secondaryColor !== null
      || role.colors.tertiaryColor !== null
      || role.flags !== 0
    ) {
      omissions.push(finding(
        "ROLE_COSMETICS_OMITTED",
        "Role icons, Unicode emoji, flags, and multi-color cosmetics are outside the guild blueprint scaffold",
        "role",
        role.id,
      ))
    }
  }

  const channelNameCounts = new Map<string, number>()
  for (const channel of channels) {
    if (!SUPPORTED_CHANNEL_TYPES.has(channel.type) || typeof channel.name !== "string") continue
    const key = `${channel.parent_id ?? ""}\0${logicalChannelNameKey(channel.name)}`
    channelNameCounts.set(key, (channelNameCounts.get(key) ?? 0) + 1)
  }
  const channelCandidates: DiscordChannel[] = []
  for (const channel of channels) {
    const kind = channelKind(channel.type)
    if (!kind) {
      omissions.push(finding(
        "CHANNEL_UNSUPPORTED_TYPE",
        "This Discord channel type is outside the additive guild blueprint scaffold",
        "channel",
        channel.id,
      ))
      continue
    }
    if (channelUnknownFieldCount(channel) > 0) {
      omissions.push(finding(
        "CHANNEL_UNKNOWN_EVIDENCE",
        "A supported channel with unknown response fields is not recreated without understanding their semantics",
        "channel",
        channel.id,
      ))
      continue
    }
    const logicalName = `${channel.parent_id ?? ""}\0${logicalChannelNameKey(channel.name as string)}`
    if ((channelNameCounts.get(logicalName) ?? 0) > 1) {
      blockers.push(finding(
        "CHANNEL_AMBIGUOUS_NAME",
        "A supported channel has a logical name collision that the additive planner cannot resolve safely",
        "channel",
        channel.id,
      ))
      continue
    }
    if (
      kind !== "category"
      && channel.default_auto_archive_duration == null
    ) {
      omissions.push(finding(
        "CHANNEL_UNREPRESENTABLE",
        "A channel without a representable default archive duration cannot be captured exactly",
        "channel",
        channel.id,
      ))
      continue
    }
    try {
      normalizeChannelCreationRequest({
        auditReason: request.auditReason,
        ...(kind === "category"
          ? {}
          : {
              defaultAutoArchiveDuration: channel.default_auto_archive_duration as number,
              nsfw: channel.nsfw ?? false,
              rateLimitPerUser: channel.rate_limit_per_user ?? 0,
              ...(channel.topic == null ? {} : { topic: channel.topic }),
            }),
        guildId: request.guildId,
        kind,
        name: channel.name as string,
        operationKey: request.operationKey,
      })
      channelCandidates.push(channel)
    } catch {
      omissions.push(finding(
        "CHANNEL_UNREPRESENTABLE",
        "A supported channel cannot be represented by the strict guild blueprint schema",
        "channel",
        channel.id,
      ))
    }
  }
  const remainingCapacity = Math.max(
    0,
    CONNECTOR_LIMITS.scaffoldSteps - selectedRoles.length,
  )
  const channelCapacity = Math.min(
    CONNECTOR_LIMITS.scaffoldChannels,
    remainingCapacity,
  )
  const initiallySelectedChannels = channelCandidates.slice(0, channelCapacity)
  const initiallySelectedChannelIds = new Set(
    initiallySelectedChannels.map((channel) => channel.id),
  )
  const selectedChannels: DiscordChannel[] = []
  for (const channel of initiallySelectedChannels) {
    const parentId = channel.parent_id ?? null
    if (parentId && !initiallySelectedChannelIds.has(parentId)) {
      omissions.push(finding(
        "CHANNEL_PARENT_OMITTED",
        "A channel whose parent is outside the captured scaffold cannot be recreated without flattening it",
        "channel",
        channel.id,
      ))
      continue
    }
    selectedChannels.push(channel)
  }
  for (const channel of channelCandidates.slice(channelCapacity)) {
    omissions.push(finding(
      "BLUEPRINT_RESOURCE_LIMIT",
      "A channel is outside the bounded guild blueprint scaffold capacity",
      "channel",
      channel.id,
    ))
  }
  const selectedChannelKeys = new Map(
    selectedChannels.map((channel) => [channel.id, channelKey(channel.id)] as const),
  )
  const scaffoldChannels = selectedChannels.map((channel) => {
    const kind = channelKind(channel.type) as "category" | "forum" | "text"
    return {
      ...(kind === "category"
        ? {}
        : {
            defaultAutoArchiveDuration: channel.default_auto_archive_duration as number,
            nsfw: channel.nsfw ?? false,
            rateLimitPerUser: channel.rate_limit_per_user ?? 0,
            ...(channel.topic == null ? {} : { topic: channel.topic }),
          }),
      key: selectedChannelKeys.get(channel.id) as string,
      kind,
      name: channel.name as string,
      ...(channel.parent_id
        ? { parentKey: selectedChannelKeys.get(channel.parent_id) as string }
        : {}),
    }
  })
  if (selectedChannels.length > 1) {
    omissions.push(finding(
      "CHANNEL_ORDER_OMITTED",
      "Guild blueprints do not preserve channel ordering",
      "channel",
    ))
  }
  for (const channel of selectedChannels) {
    if ((channel.permission_overwrites?.length ?? 0) > 0) {
      omissions.push(finding(
        "CHANNEL_PERMISSION_OVERWRITES_OMITTED",
        "Channel permission overwrites remain outside the guild blueprint scaffold",
        "channel",
        channel.id,
      ))
    }
    if (
      channel.type === DISCORD_CHANNEL_TYPES.forum
      && channelForumConfigurationPresent(channel)
    ) {
      omissions.push(finding(
        "CHANNEL_FORUM_CONFIGURATION_OMITTED",
        "Forum tags, default reaction, layout, sort order, flags, and thread slowmode are outside the guild blueprint scaffold",
        "channel",
        channel.id,
      ))
    }
  }

  if (scaffoldRoles.length + scaffoldChannels.length < 2) {
    blockers.push(finding(
      "SCAFFOLD_BELOW_MINIMUM",
      "The live representable structure is below the guild blueprint scaffold minimum",
    ))
  }

  const exactChannelReferences = new Set<string>()
  const exactRoleReferences = new Set<string>()
  let community: GuildBlueprintCommunityInput | undefined
  let communityCoverage: GuildBlueprintCaptureCoverage["community"]
  if (pass.community.status === "unavailable") {
    communityCoverage = {
      captured: false,
      evidence: "unavailable",
      liveEnabled: null,
    }
    omissions.push(finding(
      "COMMUNITY_EVIDENCE_OMITTED",
      "Guild Community state could not be proven from complete trusted routing evidence and was omitted",
      "community",
    ))
  } else if (
    pass.community.audit.configuration.communityEnabled
      !== settings.features.includes(COMMUNITY_FEATURE)
  ) {
    communityCoverage = {
      captured: false,
      evidence: "incomplete",
      liveEnabled: pass.community.audit.configuration.communityEnabled,
    }
    omissions.push(finding(
      "COMMUNITY_EVIDENCE_OMITTED",
      "Guild Community feature and routing evidence disagreed within the capture pass and was omitted",
      "community",
    ))
  } else if (!pass.community.audit.configuration.communityEnabled) {
    communityCoverage = {
      captured: false,
      evidence: "complete",
      liveEnabled: false,
    }
  } else if (!completeCommunityConfiguration(pass.community.audit)) {
    communityCoverage = {
      captured: false,
      evidence: "incomplete",
      liveEnabled: true,
    }
    omissions.push(finding(
      "COMMUNITY_EVIDENCE_OMITTED",
      "Enabled Guild Community routing was incomplete or unsafe to reproduce and was omitted",
      "community",
    ))
  } else {
    const configuration = pass.community.audit.configuration
    community = {
      acknowledgeCommunityEnablement: true,
      publicUpdatesChannel: referenceForChannel(
        configuration.publicUpdatesChannelId as string,
        selectedChannelKeys,
        exactChannelReferences,
      ),
      rulesChannel: referenceForChannel(
        configuration.rulesChannelId as string,
        selectedChannelKeys,
        exactChannelReferences,
      ),
      safetyAlertsChannel: configuration.safetyAlertsChannelId === null
        ? null
        : referenceForChannel(
            configuration.safetyAlertsChannelId,
            selectedChannelKeys,
            exactChannelReferences,
          ),
    }
    communityCoverage = {
      captured: true,
      evidence: "complete",
      liveEnabled: true,
    }
  }
  const autoModerationRuleInputs = autoModerationRules.map((rule) => (
    capturedAutoModerationRule(
      rule,
      selectedChannelKeys,
      selectedRoleKeys,
      exactChannelReferences,
      exactRoleReferences,
    )
  ))
  const settingsInput = (
    settings.verificationLevel === null
    || settings.defaultMessageNotifications === null
    || settings.explicitContentFilter === null
  ) ? null : {
    afkChannel: settings.afkChannelId === null
      ? null
      : referenceForChannel(
          settings.afkChannelId,
          new Map(),
          exactChannelReferences,
        ) as Extract<GuildBlueprintChannelReference, { kind: "exact" }>,
    afkTimeoutSeconds: settings.afkTimeoutSeconds,
    defaultMessageNotifications: settings.defaultMessageNotifications,
    explicitContentFilter: settings.explicitContentFilter,
    premiumProgressBarEnabled: settings.premiumProgressBarEnabled,
    ...(settings.suppressedSystemNotifications === null
      ? {}
      : { suppressedSystemNotifications: settings.suppressedSystemNotifications }),
    systemChannel: settings.systemChannelId === null
      ? null
      : referenceForChannel(
          settings.systemChannelId,
          selectedChannelKeys,
          exactChannelReferences,
        ),
    verificationLevel: settings.verificationLevel,
  }
  if (settings.unknownSystemFlags) {
    omissions.push(finding(
      "SETTINGS_UNKNOWN_SYSTEM_FLAGS",
      "Unknown system-channel flag bits are preserved by omitting the suppression field from the captured blueprint",
    ))
  }

  let welcomeScreen: GuildBlueprintWelcomeScreenInput | undefined
  if (pass.welcomeScreen === null) {
    omissions.push(finding(
      "WELCOME_SCREEN_UNAVAILABLE",
      "Discord did not expose a Welcome Screen to capture",
    ))
  } else {
    welcomeScreen = {
      channels: pass.welcomeScreen.welcomeChannels.map((entry) => ({
        channel: referenceForChannel(
          entry.channelId,
          selectedChannelKeys,
          exactChannelReferences,
        ),
        description: entry.description,
        emoji: welcomeEmoji(entry.emojiId, entry.emojiName),
      })),
      description: pass.welcomeScreen.description,
      enabled: settings.features.includes(WELCOME_SCREEN_ENABLED_FEATURE),
    }
    if (
      pass.welcomeScreen.unknownFieldCount > 0
      || pass.welcomeScreen.welcomeChannels.some((entry) => entry.unknownFieldCount > 0)
    ) {
      omissions.push(finding(
        "WELCOME_SCREEN_UNKNOWN_EVIDENCE",
        "Unknown Welcome Screen fields are count-only and are not copied into the blueprint",
      ))
    }
  }

  const onboardingMode = pass.onboarding.mode === DISCORD_ONBOARDING_MODES.default
    ? "default" as const
    : pass.onboarding.mode === DISCORD_ONBOARDING_MODES.advanced
      ? "advanced" as const
      : null
  if (onboardingMode === null) {
    blockers.push(finding(
      "ONBOARDING_UNKNOWN_ENUM",
      "Discord returned an onboarding mode that the blueprint contract cannot represent",
    ))
  }
  const onboardingPrompts: GuildBlueprintOnboardingPromptInput[] = []
  for (const prompt of pass.onboarding.prompts) {
    const type = prompt.type === DISCORD_ONBOARDING_PROMPT_TYPES.multipleChoice
      ? "multiple-choice" as const
      : prompt.type === DISCORD_ONBOARDING_PROMPT_TYPES.dropdown
        ? "dropdown" as const
        : null
    if (type === null) {
      blockers.push(finding(
        "ONBOARDING_UNKNOWN_ENUM",
        "Discord returned an onboarding prompt type that the blueprint contract cannot represent",
      ))
      continue
    }
    onboardingPrompts.push({
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map((option) => ({
        channels: option.channelIds.map((channelId) => referenceForChannel(
          channelId,
          selectedChannelKeys,
          exactChannelReferences,
        )),
        description: option.description,
        emoji: onboardingEmoji(option.emoji),
        optionId: option.id,
        roles: option.roleIds.map((roleId) => referenceForRole(
          roleId,
          selectedRoleKeys,
          exactRoleReferences,
        )),
        title: option.title,
      })),
      promptId: prompt.id,
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type,
    })
  }
  if (pass.onboarding.unknownEnumCount > 0 || pass.onboarding.unknownFieldCount > 0) {
    if (pass.onboarding.unknownEnumCount > 0) {
      blockers.push(finding(
        "ONBOARDING_UNKNOWN_ENUM",
        "Unknown onboarding enum values prevent a safe complete blueprint projection",
      ))
    }
    if (pass.onboarding.unknownFieldCount > 0) {
      omissions.push(finding(
        "ONBOARDING_UNKNOWN_EVIDENCE",
        "Unknown onboarding fields are count-only and are not copied into the blueprint",
      ))
    }
  }
  const onboarding: GuildBlueprintOnboardingInput | undefined = onboardingMode === null
    ? undefined
    : {
        defaultChannels: pass.onboarding.defaultChannelIds.map((channelId) => (
          referenceForChannel(
            channelId,
            selectedChannelKeys,
            exactChannelReferences,
          )
        )),
        enabled: pass.onboarding.enabled,
        mode: onboardingMode,
        prompts: onboardingPrompts,
      }

  for (const channelId of [...exactChannelReferences].sort()) {
    omissions.push(finding(
      "EXACT_CHANNEL_REFERENCE_RETAINED",
      "A blueprint reference remains bound to one existing channel ID and is not portable after deletion",
      "channel",
      channelId,
    ))
  }
  for (const roleId of [...exactRoleReferences].sort()) {
    omissions.push(finding(
      "EXACT_ROLE_REFERENCE_RETAINED",
      "A blueprint reference remains bound to one existing role ID and is not portable after deletion",
      "role",
      roleId,
    ))
  }

  const coverage: GuildBlueprintCaptureCoverage = {
    autoModerationRules: {
      captured: autoModerationRuleInputs.length,
      returned: autoModerationRules.length,
      visibility: "connector-visible",
    },
    channels: {
      captured: selectedChannels.length,
      returned: channels.length,
      visibility: "discord-and-policy-bounded",
    },
    community: communityCoverage,
    domains: [
      "structure",
      "profile",
      "settings",
      "community",
      "welcome-screen",
      "onboarding",
      "auto-moderation",
    ],
    exactChannelReferences: exactChannelReferences.size,
    exactRoleReferences: exactRoleReferences.size,
    roles: {
      captured: selectedRoles.length,
      returned: roles.length,
    },
  }

  let blueprint: GuildBlueprintRequest | null = null
  if (blockers.length === 0 && settingsInput !== null) {
    const candidate: GuildBlueprintRequest = {
      auditReason: request.auditReason,
      ...(autoModerationRuleInputs.length === 0
        ? {}
        : { autoModerationRules: autoModerationRuleInputs }),
      ...(community === undefined ? {} : { community }),
      guildId: request.guildId,
      ...(onboarding === undefined ? {} : { onboarding }),
      operationKey: request.operationKey,
      profile: {
        description: pass.profile.description,
        name: pass.profile.name,
      },
      scaffold: {
        channels: scaffoldChannels,
        roles: scaffoldRoles,
        stepLimit: CONNECTOR_LIMITS.scaffoldStepLimit,
      },
      settings: settingsInput,
      ...(welcomeScreen === undefined ? {} : { welcomeScreen }),
    }
    try {
      const {
        operationKeyHash: _operationKeyHash,
        ...normalizedBlueprint
      } = normalizeGuildBlueprintRequest(candidate)
      blueprint = normalizedBlueprint
    } catch {
      blockers.push(finding(
        "BLUEPRINT_VALIDATION_FAILED",
        "The captured live state does not form one valid strict guild blueprint input without approximation",
      ))
    }
  }

  const bindingOmissionCodes = (
    resourceType: GuildRecoveryResourceType,
    resourceId: string,
  ): string[] => [...new Set(omissions
    .filter((omission) => (
      omission.resourceType === resourceType
      && (omission.resourceId === null || omission.resourceId === resourceId)
    ))
    .map((omission) => omission.code))].sort()
  const bindings: GuildBlueprintCaptureBindingSource[] = [
    ...selectedRoles.map((role) => ({
      blueprintKey: selectedRoleKeys.get(role.id) as string,
      omissionCodes: bindingOmissionCodes("role", role.id),
      resourceId: role.id,
      resourceType: "role" as const,
      targetStateDigest: guildBlueprintRoleRecoveryStateDigest(role),
    })),
    ...selectedChannels.map((channel) => ({
      blueprintKey: selectedChannelKeys.get(channel.id) as string,
      omissionCodes: bindingOmissionCodes("channel", channel.id),
      resourceId: channel.id,
      resourceType: "channel" as const,
      targetStateDigest: guildBlueprintChannelRecoveryStateDigest(channel),
    })),
  ].sort((left, right) => (
    left.resourceType.localeCompare(right.resourceType)
    || left.resourceId.localeCompare(right.resourceId)
  ))

  return {
    bindings,
    blockers,
    blueprint,
    coverage,
    omissions,
    source: {
      autoModerationRules,
      channels: channels.map(sourceChannelProjection),
      community: communitySourceProjection(pass.community),
      guild: settings,
      onboarding: pass.onboarding,
      profile: pass.profile,
      roles: roles.map(canonicalRoleProjection),
      welcomeScreen: pass.welcomeScreen,
    },
  }
}

function captureDigest(
  projected: ProjectedCapturePass,
  operationKeyHashValue: string,
): string {
  const blueprint = projected.blueprint === null
    ? null
    : (({ operationKey: _operationKey, ...retained }) => ({
        ...retained,
        operationKeyHash: operationKeyHashValue,
      }))(projected.blueprint)
  const digest = createHash("sha256")
    .update("guildcontrol-guild-blueprint-capture.v1\0")
    .update(stableString({
      blueprint,
      coverage: projected.coverage,
      omissions: projected.omissions,
      source: projected.source,
    }))
    .digest("hex")
  return `${CAPTURE_DIGEST_PREFIX}${digest}`
}

const PRIVACY: GuildBlueprintCapturePrivacy = Object.freeze({
  activityPersistence: "none",
  attachments: "not-read",
  autoModerationExecutionEvents: "not-read",
  components: "not-read",
  memberProfiles: "connector-bot-identity-only",
  messageContent: "not-read",
  rawPayloads: "omitted",
  recoveryAttestations: "transient-process-bound",
  returnedText: "transient-caller-retained",
  serverPersistence: "none",
  webhooks: "not-read",
})
const LIMITATIONS: GuildBlueprintCaptureLimitations = Object.freeze({
  atomicSnapshot: false,
  completeBackup: false,
  crossGuildPortable: false,
  messageRecovery: false,
  originalIdRestoration: false,
  rollback: false,
})

export class GuildBlueprintCaptureService {
  readonly #client: GuildBlueprintCaptureServiceOptions["client"]
  readonly #clock: () => Date
  readonly #community: GuildBlueprintCaptureServiceOptions["community"]
  readonly #policy: ScopePolicy
  readonly #recoveryAttestationKey: Uint8Array

  constructor(options: GuildBlueprintCaptureServiceOptions) {
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#community = options.community
    this.#policy = options.policy
    this.#recoveryAttestationKey = new Uint8Array(
      options.recoveryAttestationKey ?? createGuildRecoveryAttestationKey(),
    )
  }

  assertCaptureAllowed(request: GuildBlueprintCaptureRequest): void {
    const normalized = normalizeGuildBlueprintCaptureRequest(request)
    this.#policy.assertGuildAllowed(normalized.guildId)
    this.#policy.assertGuildProfileAuditable(normalized.guildId)
    this.#policy.assertGuildSettingsAuditable(normalized.guildId)
    this.#policy.assertGuildCommunityAuditable(normalized.guildId)
    this.#policy.assertGuildWelcomeScreenAuditable(normalized.guildId)
    this.#policy.assertGuildOnboardingAuditable(normalized.guildId)
    this.#policy.assertAutomodAuditable(normalized.guildId)
  }

  async #pass(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions,
  ): Promise<GuildBlueprintCapturePass> {
    const [
      guild,
      roles,
      channels,
      onboarding,
      welcomeScreen,
      autoModerationRules,
      community,
    ] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getGuildChannels(guildId, options),
      this.#client.getGuildOnboarding(guildId, options),
      this.#client.getGuildWelcomeScreen(guildId, options),
      this.#client.listGuildAutoModerationRules(guildId, options),
      this.#community.get(applicationId, botId, guildId, options)
        .then((audit): GuildBlueprintCaptureCommunityEvidence => ({
          audit,
          status: "available",
        }))
        .catch((error): GuildBlueprintCaptureCommunityEvidence => {
          if (options.signal?.aborted) throw error
          return { status: "unavailable" }
        }),
    ])
    return {
      autoModerationRules,
      channels: this.#policy.filterChannels(channels),
      community,
      guild,
      onboarding,
      profile: projectGuildProfile(guild, guildId),
      roles,
      welcomeScreen,
    }
  }

  async capture(
    applicationId: string,
    botId: string,
    request: GuildBlueprintCaptureRequest,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintCaptureResult> {
    if (!positiveSnowflake(applicationId) || !positiveSnowflake(botId)) {
      throw new RangeError("Discord guild blueprint capture requires exact application and bot identities")
    }
    const normalized = normalizeGuildBlueprintCaptureRequest(request)
    this.assertCaptureAllowed(request)

    const startedAt = this.#clock().toISOString()
    const first = projectPass(
      await this.#pass(applicationId, botId, normalized.guildId, options),
      normalized,
      applicationId,
      botId,
    )
    const second = projectPass(
      await this.#pass(applicationId, botId, normalized.guildId, options),
      normalized,
      applicationId,
      botId,
    )
    const completedAt = this.#clock().toISOString()
    const base = {
      applicationId,
      botId,
      captureWindow: {
        completedAt,
        passes: 2 as const,
        startedAt,
        stable: true,
      },
      guildId: normalized.guildId,
      freshPlanRequired: true as const,
      limitations: LIMITATIONS,
      operationKeyHash: normalized.operationKeyHash,
      privacy: PRIVACY,
      schemaVersion: SCHEMA_VERSION,
    }
    if (stableString(first.source) !== stableString(second.source)) {
      return {
        ...base,
        blockers: [finding(
          "CAPTURE_CHANGED",
          "Discord blueprint source state changed between the two capture passes",
        )],
        blueprint: null,
        captureDigest: null,
        captureWindow: { ...base.captureWindow, stable: false },
        coverage: null,
        nextAction: "retry-capture",
        omissions: [],
        plannerReady: false,
        recoveryBindings: [],
        status: "changed-during-capture",
      }
    }
    if (second.blueprint === null || second.blockers.length > 0) {
      return {
        ...base,
        blockers: second.blockers,
        blueprint: null,
        captureDigest: null,
        coverage: second.coverage,
        nextAction: "resolve-blockers-and-recapture",
        omissions: second.omissions,
        plannerReady: false,
        recoveryBindings: [],
        status: "blocked",
      }
    }
    const digest = captureDigest(second, normalized.operationKeyHash)
    const recoveryBindings = second.bindings.map((binding) => (
      createGuildRecoveryAttestation(this.#recoveryAttestationKey, {
        applicationId,
        blueprintKey: binding.blueprintKey,
        botId,
        captureDigest: digest,
        capturedAt: completedAt,
        guildId: normalized.guildId,
        omissionCodes: binding.omissionCodes,
        resourceId: binding.resourceId,
        resourceType: binding.resourceType,
        targetStateDigest: binding.targetStateDigest,
      })
    ))
    return {
      ...base,
      blockers: [],
      blueprint: second.blueprint,
      captureDigest: digest,
      coverage: second.coverage,
      nextAction: second.omissions.length === 0
        ? "retain-blueprint-and-plan"
        : "review-or-edit-omissions-before-plan",
      omissions: second.omissions,
      plannerReady: true,
      recoveryBindings,
      status: second.omissions.length === 0 ? "ready" : "review-required",
    }
  }
}
