import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GuildSettingsActivity,
  GuildSettingsActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_AFK_TIMEOUT_SECONDS,
  GUILD_DEFAULT_MESSAGE_NOTIFICATIONS,
  GUILD_EXPLICIT_CONTENT_FILTERS,
  GUILD_SETTINGS_FIELDS,
  GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK,
  GUILD_SYSTEM_NOTIFICATION_SUPPRESSIONS,
  GUILD_VERIFICATION_LEVELS,
  SCHEMA_VERSION,
  type GuildAfkTimeoutSeconds,
  type GuildDefaultMessageNotifications,
  type GuildExplicitContentFilter,
  type GuildSettingsField,
  type GuildSystemNotificationSuppression,
  type GuildVerificationLevel,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type ModifyGuildSettingsInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  GuildSettingsEvidenceError,
  GuildSettingsExecutionError,
  GuildSettingsOperationConflictError,
  GuildSettingsPlanChangedError,
} from "./errors.js"
import type { GatewayChannelLayoutSource } from "./gateway-channel-layout.js"
import {
  collectGuildChannelEvidence,
  GuildChannelEvidenceError,
  type GuildChannelEvidence,
  type GuildChannelEvidenceView,
} from "./guild-channel-evidence.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  parseDiscordPermissionBits,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
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
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "guild-settings-state-unavailable"
const GUILD_FEATURE_PATTERN = /^[A-Z0-9_]+$/u
const REQUEST_KEYS = [
  "afkChannelId",
  "afkTimeoutSeconds",
  "auditReason",
  "defaultMessageNotifications",
  "explicitContentFilter",
  "guildId",
  "operationKey",
  "premiumProgressBarEnabled",
  "suppressedSystemNotifications",
  "systemChannelId",
  "verificationLevel",
] as const
const AFK_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.voice,
])
const SYSTEM_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.text,
])
const SYSTEM_NOTIFICATION_BITS = Object.freeze({
  "guild-reminders": 1 << 2,
  "join-notification-replies": 1 << 3,
  "join-notifications": 1 << 0,
  "premium-subscriptions": 1 << 1,
  "role-subscription-purchase-notification-replies": 1 << 5,
  "role-subscription-purchase-notifications": 1 << 4,
} satisfies Record<GuildSystemNotificationSuppression, number>)
const LOCAL_CONSTRAINTS = Object.freeze({
  afkChannelTypes: [...AFK_CHANNEL_TYPES].sort((left, right) => left - right),
  afkTimeoutSeconds: [...GUILD_AFK_TIMEOUT_SECONDS],
  defaultMessageNotifications: [...GUILD_DEFAULT_MESSAGE_NOTIFICATIONS],
  explicitContentFilters: [...GUILD_EXPLICIT_CONTENT_FILTERS],
  guildAllowlist: CONNECTOR_LIMITS.guildSettingsGuildAllowlist,
  supportedFields: [...GUILD_SETTINGS_FIELDS],
  systemChannelTypes: [...SYSTEM_CHANNEL_TYPES].sort((left, right) => left - right),
  systemNotificationSuppressions: [...GUILD_SYSTEM_NOTIFICATION_SUPPRESSIONS],
  verificationLevels: [...GUILD_VERIFICATION_LEVELS],
})

type GuildSettingsTargetOutcome = "settled" | "uncertain"
const GUILD_SETTINGS_LOCKS = new Map<string, Promise<GuildSettingsTargetOutcome>>()

export interface GuildSettingsChangeRequest {
  afkChannelId?: string | null
  afkTimeoutSeconds?: GuildAfkTimeoutSeconds
  auditReason: string
  defaultMessageNotifications?: GuildDefaultMessageNotifications
  explicitContentFilter?: GuildExplicitContentFilter
  guildId: string
  operationKey: string
  premiumProgressBarEnabled?: boolean
  suppressedSystemNotifications?: readonly GuildSystemNotificationSuppression[]
  systemChannelId?: string | null
  verificationLevel?: GuildVerificationLevel
}

export interface NormalizedGuildSettingsChangeRequest {
  afkChannelId?: string | null
  afkTimeoutSeconds?: GuildAfkTimeoutSeconds
  auditReason: string
  defaultMessageNotifications?: GuildDefaultMessageNotifications
  explicitContentFilter?: GuildExplicitContentFilter
  guildId: string
  operationKeyHash: string
  premiumProgressBarEnabled?: boolean
  requestedFields: GuildSettingsField[]
  suppressedSystemNotifications?: GuildSystemNotificationSuppression[]
  systemChannelId?: string | null
  verificationLevel?: GuildVerificationLevel
}

export interface GuildSettingsAccessEvidence {
  appliedRoleIds: string[]
  authorizedForChange: boolean
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageGuild: boolean
  requiredPermission: "MANAGE_GUILD"
  unknownPermissionBits: string
  warnings: string[]
}

export interface GuildSettingsChannelReferenceView {
  channelId: string
  eligible: boolean
  exists: boolean
  metadata: "missing" | "obfuscated" | "trusted"
  parentId: string | null
  type: number | null
}

export interface GuildSettingsConfigurationView {
  afkChannel: GuildSettingsChannelReferenceView | null
  afkChannelId: string | null
  afkTimeoutSeconds: GuildAfkTimeoutSeconds
  defaultMessageNotifications: GuildDefaultMessageNotifications
  explicitContentFilter: GuildExplicitContentFilter
  issues: string[]
  premiumProgressBarEnabled: boolean
  suppressedSystemNotifications: GuildSystemNotificationSuppression[]
  systemChannel: GuildSettingsChannelReferenceView | null
  systemChannelId: string | null
  unknownSystemChannelFlagsPresent: boolean
  verificationLevel: GuildVerificationLevel
}

export interface GuildSettingsPrivacyProjection {
  channelNames: "omitted"
  guildPresentation: "omitted"
  memberData: "omitted"
  persistence: "none"
  rawPayloads: "omitted"
  roleNames: "omitted"
  unknownValues: "bit-presence-only"
}

export type GuildSettingsEffect =
  | "noise-increasing"
  | "noise-reducing"
  | "presentation-change"
  | "routing-change"
  | "strengthening"
  | "suppression-increase"
  | "suppression-mixed"
  | "suppression-reduction"
  | "timeout-change"
  | "weakening"

export interface GuildSettingsFieldEffect {
  effect: GuildSettingsEffect
  field: GuildSettingsField
}

export interface GuildSettingsVerificationBoundary {
  automaticRetry: false
  freshApiReadback: true
  gatewayLayoutContinuity: true
  mutationResponse: true
  rollback: "not-automatic"
}

export interface GuildSettingsAuditResult {
  access: GuildSettingsAccessEvidence
  applicationId: string
  botId: string
  configuration: GuildSettingsConfigurationView
  guildId: string
  inventory: GuildChannelEvidenceView
  localConstraints: typeof LOCAL_CONSTRAINTS
  privacy: GuildSettingsPrivacyProjection
  schemaVersion: number
  status: "ok"
  verificationBoundary: GuildSettingsVerificationBoundary
}

export interface GuildSettingsChangePlan {
  access: GuildSettingsAccessEvidence
  applicationId: string
  auditReason: string
  botId: string
  changedFields: GuildSettingsField[]
  createdAt: string
  current: GuildSettingsConfigurationView
  desired: GuildSettingsConfigurationView
  digest: string
  effects: GuildSettingsFieldEffect[]
  guildId: string
  inventory: GuildChannelEvidenceView
  localConstraints: typeof LOCAL_CONSTRAINTS
  operationKeyHash: string
  privacy: GuildSettingsPrivacyProjection
  requestedFields: GuildSettingsField[]
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verificationBoundary: GuildSettingsVerificationBoundary
  warnings: string[]
  writeRequired: boolean
}

export interface GuildSettingsChangeResult {
  activityId: string | null
  driftFields: GuildSettingsField[]
  guildId: string
  operationKeyHash: string
  planDigest: string
  requestedFields: GuildSettingsField[]
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
  warnings: string[]
}

export interface GuildSettingsServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "modifyGuildSettings"
> {}

export interface GuildSettingsServiceOptions {
  activityStore: ActivityStore
  client: GuildSettingsServiceClient
  clock?: () => Date
  layoutSource: GatewayChannelLayoutSource
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertGuildSettingsAuditable"
    | "assertGuildSettingsChangeable"
  >
  randomId?: () => string
}

interface ValidatedGuildSettings {
  features: string[]
  id: string
  ownerId: string
  settings: GuildSettingsSnapshot
}

interface ValidatedRole {
  id: string
  managed: boolean
  name: string
  permissions: string
  position: number
}

interface ValidatedBotMember {
  roles: string[]
}

interface ValidatedChannel {
  guild_id: string
  id: string
  parent_id: string | null
  position: number
  type: number
}

interface GuildSettingsSnapshot {
  afkChannelId: string | null
  afkTimeoutSeconds: GuildAfkTimeoutSeconds
  defaultMessageNotifications: 0 | 1
  explicitContentFilter: 0 | 1 | 2
  premiumProgressBarEnabled: boolean
  suppressedSystemNotifications: number
  systemChannelId: string | null
  verificationLevel: 0 | 1 | 2 | 3 | 4
}

interface GuildSettingsState {
  access: GuildSettingsAccessEvidence
  botMember: ValidatedBotMember
  channelEvidence: GuildChannelEvidence<ValidatedChannel>
  configuration: GuildSettingsConfigurationView
  guild: ValidatedGuildSettings
  priorReceipt: OperationReceipt | null
  roles: ValidatedRole[]
}

interface BuiltGuildSettingsPlan {
  desiredRequest: NormalizedGuildSettingsChangeRequest
  desiredSnapshot: GuildSettingsSnapshot
  plan: GuildSettingsChangePlan
  state: GuildSettingsState
}

function evidenceError(
  message: string,
  options?: ErrorOptions,
): GuildSettingsEvidenceError {
  return new GuildSettingsEvidenceError(message, options)
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
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

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function requestedFields(record: Record<string, unknown>): GuildSettingsField[] {
  return GUILD_SETTINGS_FIELDS
    .filter((field) => Object.hasOwn(record, field))
    .sort()
}

export function assertGuildSettingsGetInput(guildId: string): void {
  assertPositiveSnowflake(guildId, "Discord guild-settings guild ID")
}

export function normalizeGuildSettingsChangeRequest(
  request: GuildSettingsChangeRequest,
): NormalizedGuildSettingsChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild-settings change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, REQUEST_KEYS)
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) {
    throw new RangeError("Discord guild-settings change request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord guild-settings guild ID")
  const fields = requestedFields(record)
  if (fields.length < 1) {
    throw new RangeError("Discord guild-settings change request must select at least one field")
  }
  for (const field of ["afkChannelId", "systemChannelId"] as const) {
    if (!Object.hasOwn(record, field)) continue
    const value = request[field]
    if (!(value === null || typeof value === "string")) {
      throw new RangeError(`Discord guild-settings ${field} is invalid`)
    }
    if (typeof value === "string") {
      assertPositiveSnowflake(value, `Discord guild-settings ${field}`)
    }
  }
  if (
    Object.hasOwn(record, "afkTimeoutSeconds")
    && !GUILD_AFK_TIMEOUT_SECONDS.includes(request.afkTimeoutSeconds as never)
  ) {
    throw new RangeError("Discord guild-settings AFK timeout is invalid")
  }
  if (
    Object.hasOwn(record, "defaultMessageNotifications")
    && !GUILD_DEFAULT_MESSAGE_NOTIFICATIONS.includes(
      request.defaultMessageNotifications as never,
    )
  ) {
    throw new RangeError("Discord guild-settings notification default is invalid")
  }
  if (
    Object.hasOwn(record, "explicitContentFilter")
    && !GUILD_EXPLICIT_CONTENT_FILTERS.includes(request.explicitContentFilter as never)
  ) {
    throw new RangeError("Discord guild-settings content filter is invalid")
  }
  if (
    Object.hasOwn(record, "premiumProgressBarEnabled")
    && typeof request.premiumProgressBarEnabled !== "boolean"
  ) {
    throw new RangeError("Discord guild-settings premium progress bar value is invalid")
  }
  let suppressions: GuildSystemNotificationSuppression[] | undefined
  if (Object.hasOwn(record, "suppressedSystemNotifications")) {
    if (!Array.isArray(request.suppressedSystemNotifications)) {
      throw new RangeError("Discord guild-settings notification suppressions are invalid")
    }
    suppressions = [...request.suppressedSystemNotifications]
    if (
      suppressions.length > GUILD_SYSTEM_NOTIFICATION_SUPPRESSIONS.length
      || suppressions.some((value) => (
        typeof value !== "string"
        || !(GUILD_SYSTEM_NOTIFICATION_SUPPRESSIONS as readonly string[]).includes(value)
      ))
      || new Set(suppressions).size !== suppressions.length
    ) {
      throw new RangeError("Discord guild-settings notification suppressions are invalid")
    }
    suppressions.sort()
  }
  if (
    Object.hasOwn(record, "verificationLevel")
    && !GUILD_VERIFICATION_LEVELS.includes(request.verificationLevel as never)
  ) {
    throw new RangeError("Discord guild-settings verification level is invalid")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    ...(Object.hasOwn(record, "afkChannelId")
      ? { afkChannelId: request.afkChannelId }
      : {}),
    ...(Object.hasOwn(record, "afkTimeoutSeconds")
      ? { afkTimeoutSeconds: request.afkTimeoutSeconds }
      : {}),
    auditReason: request.auditReason,
    ...(Object.hasOwn(record, "defaultMessageNotifications")
      ? { defaultMessageNotifications: request.defaultMessageNotifications }
      : {}),
    ...(Object.hasOwn(record, "explicitContentFilter")
      ? { explicitContentFilter: request.explicitContentFilter }
      : {}),
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
    ...(Object.hasOwn(record, "premiumProgressBarEnabled")
      ? { premiumProgressBarEnabled: request.premiumProgressBarEnabled }
      : {}),
    requestedFields: fields,
    ...(suppressions ? { suppressedSystemNotifications: suppressions } : {}),
    ...(Object.hasOwn(record, "systemChannelId")
      ? { systemChannelId: request.systemChannelId }
      : {}),
    ...(Object.hasOwn(record, "verificationLevel")
      ? { verificationLevel: request.verificationLevel }
      : {}),
  }
}

function exactNullableSnowflake(value: unknown, label: string): string | null {
  if (value === null) return null
  if (!positiveSnowflake(value)) {
    throw evidenceError(`Discord returned invalid ${label} evidence`)
  }
  return value
}

function exactGuildSettings(value: DiscordGuild, guildId: string): ValidatedGuildSettings {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !positiveSnowflake(value.owner_id)
    || !Array.isArray(value.features)
    || value.features.length > DISCORD_LIMITS.guildFeatures
    || new Set(value.features).size !== value.features.length
    || value.features.some((feature) => (
      typeof feature !== "string"
      || feature.length < 1
      || feature.length > DISCORD_LIMITS.guildFeatureCharacters
      || !GUILD_FEATURE_PATTERN.test(feature)
    ))
    || ![0, 1, 2, 3, 4].includes(value.verification_level as number)
    || ![0, 1].includes(value.default_message_notifications as number)
    || ![0, 1, 2].includes(value.explicit_content_filter as number)
    || !GUILD_AFK_TIMEOUT_SECONDS.includes(value.afk_timeout as never)
    || typeof value.premium_progress_bar_enabled !== "boolean"
    || !Number.isSafeInteger(value.system_channel_flags)
    || (value.system_channel_flags as number) < 0
  ) {
    throw evidenceError("Discord returned incomplete or invalid guild-settings evidence")
  }
  return {
    features: [...value.features].sort(),
    id: guildId,
    ownerId: value.owner_id,
    settings: {
      afkChannelId: exactNullableSnowflake(
        value.afk_channel_id,
        "guild-settings AFK channel",
      ),
      afkTimeoutSeconds: value.afk_timeout as GuildAfkTimeoutSeconds,
      defaultMessageNotifications: value.default_message_notifications as 0 | 1,
      explicitContentFilter: value.explicit_content_filter as 0 | 1 | 2,
      premiumProgressBarEnabled: value.premium_progress_bar_enabled,
      suppressedSystemNotifications: value.system_channel_flags as number,
      systemChannelId: exactNullableSnowflake(
        value.system_channel_id,
        "guild-settings system channel",
      ),
      verificationLevel: value.verification_level as 0 | 1 | 2 | 3 | 4,
    },
  }
}

function exactBotMember(
  value: DiscordGuildMember,
  guildId: string,
  botId: string,
): ValidatedBotMember {
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
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw evidenceError("Discord returned incomplete or mismatched guild-settings bot evidence")
  }
  return { roles: [...value.roles].sort(compareSnowflakes) }
}

function validRoleName(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && [...value].length <= DISCORD_LIMITS.roleNameCharacters
    && !/[\u0000-\u001F\u007F]/u.test(value)
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded guild-settings role inventory")
  }
  const ids = new Set<string>()
  const roles = value.map((role) => {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || !validRoleName(role.name)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || ids.has(role.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate guild-settings role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid guild-settings role permissions", {
        cause: error,
      })
    }
    ids.add(role.id)
    return {
      id: role.id,
      managed: role.managed,
      name: role.name,
      permissions: permissions.toString(),
      position: role.position,
    }
  })
  const everyone = roles.find((role) => role.id === guildId)
  if (!everyone || everyone.name !== "@everyone" || everyone.managed || everyone.position !== 0) {
    throw evidenceError("Discord returned invalid guild-settings @everyone role evidence")
  }
  return roles.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactChannels(
  value: readonly DiscordChannel[],
  guildId: string,
): ValidatedChannel[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildChannels) {
    throw evidenceError("Discord returned an invalid bounded guild-settings channel inventory")
  }
  const ids = new Set<string>()
  return value.map((channel) => {
    if (
      !channel
      || typeof channel !== "object"
      || Array.isArray(channel)
      || !positiveSnowflake(channel.id)
      || channel.guild_id !== guildId
      || !Number.isSafeInteger(channel.type)
      || channel.type < 0
      || !Number.isSafeInteger(channel.position)
      || (channel.position as number) < 0
      || !(channel.parent_id === null || positiveSnowflake(channel.parent_id))
      || ids.has(channel.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate guild-settings channel evidence")
    }
    ids.add(channel.id)
    return {
      guild_id: guildId,
      id: channel.id,
      parent_id: channel.parent_id,
      position: channel.position as number,
      type: channel.type,
    }
  }).sort((left, right) => compareSnowflakes(left.id, right.id))
}

function completePermissions(
  member: ValidatedBotMember,
  guildId: string,
  roles: readonly ValidatedRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError("Discord returned invalid guild-settings permission evidence", {
      cause: error,
    })
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete guild-settings permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): GuildSettingsAccessEvidence {
  const manageGuild = hasGuildPermission(permissions, "MANAGE_GUILD")
  return {
    appliedRoleIds: permissions.appliedRoleIds,
    authorizedForChange: botIsGuildOwner || manageGuild,
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    effectivePermissionNames: permissions.effectivePermissionNames,
    effectivePermissions: permissions.effectivePermissions,
    manageGuild,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(permissions.effectivePermissions),
    ).toString(),
    warnings: permissions.warnings,
  }
}

function channelReferenceView(
  channelId: string,
  expectedTypes: ReadonlySet<number>,
  evidence: GuildChannelEvidence<ValidatedChannel>,
): GuildSettingsChannelReferenceView {
  const channel = evidence.channels.find((candidate) => candidate.id === channelId)
  const layout = evidence.layout.channels.find((candidate) => candidate.channelId === channelId)
  if (!layout) {
    return {
      channelId,
      eligible: false,
      exists: false,
      metadata: "missing",
      parentId: null,
      type: null,
    }
  }
  if (!channel || layout.obfuscated) {
    return {
      channelId,
      eligible: false,
      exists: true,
      metadata: "obfuscated",
      parentId: layout.parentChannelId,
      type: layout.type,
    }
  }
  return {
    channelId,
    eligible: expectedTypes.has(channel.type),
    exists: true,
    metadata: "trusted",
    parentId: channel.parent_id,
    type: channel.type,
  }
}

function knownSuppressions(mask: number): GuildSystemNotificationSuppression[] {
  return GUILD_SYSTEM_NOTIFICATION_SUPPRESSIONS
    .filter((name) => (mask & SYSTEM_NOTIFICATION_BITS[name]) !== 0)
    .sort()
}

function suppressionMask(values: readonly GuildSystemNotificationSuppression[]): number {
  return values.reduce((mask, name) => mask | SYSTEM_NOTIFICATION_BITS[name], 0)
}

function hasUnknownSuppressionBits(mask: number): boolean {
  return (BigInt(mask) & ~BigInt(GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK)) !== 0n
}

function configurationView(
  snapshot: GuildSettingsSnapshot,
  evidence: GuildChannelEvidence<ValidatedChannel>,
): GuildSettingsConfigurationView {
  const afkChannel = snapshot.afkChannelId === null
    ? null
    : channelReferenceView(snapshot.afkChannelId, AFK_CHANNEL_TYPES, evidence)
  const systemChannel = snapshot.systemChannelId === null
    ? null
    : channelReferenceView(snapshot.systemChannelId, SYSTEM_CHANNEL_TYPES, evidence)
  const unknownFlagsPresent = hasUnknownSuppressionBits(
    snapshot.suppressedSystemNotifications,
  )
  const issues: string[] = []
  if (afkChannel && !afkChannel.eligible) {
    issues.push(
      afkChannel.exists
        ? "The configured AFK channel lacks trusted eligible voice-channel evidence"
        : "The configured AFK channel is absent from complete layout evidence",
    )
  }
  if (systemChannel && !systemChannel.eligible) {
    issues.push(
      systemChannel.exists
        ? "The configured system channel lacks trusted eligible text-channel evidence"
        : "The configured system channel is absent from complete layout evidence",
    )
  }
  if (unknownFlagsPresent) {
    issues.push("The system-channel flag bitfield contains unknown future bits")
  }
  return {
    afkChannel,
    afkChannelId: snapshot.afkChannelId,
    afkTimeoutSeconds: snapshot.afkTimeoutSeconds,
    defaultMessageNotifications:
      GUILD_DEFAULT_MESSAGE_NOTIFICATIONS[snapshot.defaultMessageNotifications],
    explicitContentFilter: GUILD_EXPLICIT_CONTENT_FILTERS[snapshot.explicitContentFilter],
    issues,
    premiumProgressBarEnabled: snapshot.premiumProgressBarEnabled,
    suppressedSystemNotifications: knownSuppressions(snapshot.suppressedSystemNotifications),
    systemChannel,
    systemChannelId: snapshot.systemChannelId,
    unknownSystemChannelFlagsPresent: unknownFlagsPresent,
    verificationLevel: GUILD_VERIFICATION_LEVELS[snapshot.verificationLevel],
  }
}

function privacyProjection(): GuildSettingsPrivacyProjection {
  return {
    channelNames: "omitted",
    guildPresentation: "omitted",
    memberData: "omitted",
    persistence: "none",
    rawPayloads: "omitted",
    roleNames: "omitted",
    unknownValues: "bit-presence-only",
  }
}

function verificationBoundary(): GuildSettingsVerificationBoundary {
  return {
    automaticRetry: false,
    freshApiReadback: true,
    gatewayLayoutContinuity: true,
    mutationResponse: true,
    rollback: "not-automatic",
  }
}

function desiredSnapshot(
  current: GuildSettingsSnapshot,
  desired: NormalizedGuildSettingsChangeRequest,
): GuildSettingsSnapshot {
  return {
    afkChannelId: desired.afkChannelId !== undefined
      ? desired.afkChannelId
      : current.afkChannelId,
    afkTimeoutSeconds: desired.afkTimeoutSeconds
      ?? current.afkTimeoutSeconds,
    defaultMessageNotifications: desired.defaultMessageNotifications === undefined
      ? current.defaultMessageNotifications
      : GUILD_DEFAULT_MESSAGE_NOTIFICATIONS.indexOf(desired.defaultMessageNotifications) as 0 | 1,
    explicitContentFilter: desired.explicitContentFilter === undefined
      ? current.explicitContentFilter
      : GUILD_EXPLICIT_CONTENT_FILTERS.indexOf(desired.explicitContentFilter) as 0 | 1 | 2,
    premiumProgressBarEnabled: desired.premiumProgressBarEnabled
      ?? current.premiumProgressBarEnabled,
    suppressedSystemNotifications: desired.suppressedSystemNotifications === undefined
      ? current.suppressedSystemNotifications
      : suppressionMask(desired.suppressedSystemNotifications),
    systemChannelId: desired.systemChannelId !== undefined
      ? desired.systemChannelId
      : current.systemChannelId,
    verificationLevel: desired.verificationLevel === undefined
      ? current.verificationLevel
      : GUILD_VERIFICATION_LEVELS.indexOf(desired.verificationLevel) as 0 | 1 | 2 | 3 | 4,
  }
}

function fieldMatches(
  left: GuildSettingsSnapshot,
  right: GuildSettingsSnapshot,
  field: GuildSettingsField,
): boolean {
  return left[field] === right[field]
}

function changedFields(
  current: GuildSettingsSnapshot,
  desired: GuildSettingsSnapshot,
  requested: readonly GuildSettingsField[],
): GuildSettingsField[] {
  return requested.filter((field) => !fieldMatches(current, desired, field)).sort()
}

function assertDesiredSafe(
  current: GuildSettingsSnapshot,
  request: NormalizedGuildSettingsChangeRequest,
  desired: GuildSettingsConfigurationView,
): void {
  if (
    request.requestedFields.includes("suppressedSystemNotifications")
    && hasUnknownSuppressionBits(current.suppressedSystemNotifications)
  ) {
    throw evidenceError(
      "Discord guild-settings system notifications cannot be changed while unknown flag bits exist",
    )
  }
  if (
    request.requestedFields.includes("afkChannelId")
    && desired.afkChannel !== null
    && !desired.afkChannel.eligible
  ) {
    throw evidenceError("Discord guild-settings desired AFK channel is not an exact eligible voice channel")
  }
  if (
    request.requestedFields.includes("systemChannelId")
    && desired.systemChannel !== null
    && !desired.systemChannel.eligible
  ) {
    throw evidenceError(
      "Discord guild-settings desired system channel is not an exact eligible text channel",
    )
  }
}

function effects(
  current: GuildSettingsSnapshot,
  desired: GuildSettingsSnapshot,
  fields: readonly GuildSettingsField[],
): GuildSettingsFieldEffect[] {
  return fields.map((field): GuildSettingsFieldEffect => {
    if (field === "verificationLevel" || field === "explicitContentFilter") {
      return {
        effect: desired[field] > current[field] ? "strengthening" : "weakening",
        field,
      }
    }
    if (field === "defaultMessageNotifications") {
      return {
        effect: desired[field] > current[field] ? "noise-reducing" : "noise-increasing",
        field,
      }
    }
    if (field === "suppressedSystemNotifications") {
      const before = knownSuppressions(current[field])
      const after = knownSuppressions(desired[field])
      const added = after.some((value) => !before.includes(value))
      const removed = before.some((value) => !after.includes(value))
      return {
        effect: added && removed
          ? "suppression-mixed"
          : added
            ? "suppression-increase"
            : "suppression-reduction",
        field,
      }
    }
    if (field === "afkTimeoutSeconds") return { effect: "timeout-change", field }
    if (field === "premiumProgressBarEnabled") {
      return { effect: "presentation-change", field }
    }
    return { effect: "routing-change", field }
  })
}

function planRisks(fieldEffects: readonly GuildSettingsFieldEffect[]): string[] {
  const risks = new Set<string>()
  for (const { effect } of fieldEffects) {
    if (effect === "weakening") {
      risks.add("One or more requested fields reduce guild verification or content filtering")
    } else if (effect === "noise-increasing") {
      risks.add("The default notification policy will expose members to more message notifications")
    } else if (effect.startsWith("suppression-")) {
      risks.add("System notice visibility will change for guild members")
    } else if (effect === "routing-change") {
      risks.add("Discord-managed guild behavior will be routed to a different channel or disabled")
    } else if (effect === "timeout-change") {
      risks.add("Idle voice members may be moved on a different schedule")
    } else if (effect === "presentation-change") {
      risks.add("The guild boost progress presentation will change")
    }
  }
  return [...risks].sort()
}

function planWarnings(
  desired: GuildSettingsConfigurationView,
  changed: readonly GuildSettingsField[],
): string[] {
  const warnings = [...desired.issues]
  if (changed.includes("afkTimeoutSeconds") && desired.afkChannelId === null) {
    warnings.push("The AFK timeout has no routing effect while the AFK channel is disabled")
  }
  if (
    changed.includes("suppressedSystemNotifications")
    && desired.systemChannelId === null
  ) {
    warnings.push(
      "System notification suppressions have no delivery effect while the system channel is disabled",
    )
  }
  return [...new Set(warnings)].sort()
}

function transportInput(
  desired: GuildSettingsSnapshot,
  fields: readonly GuildSettingsField[],
): ModifyGuildSettingsInput {
  const selected = new Set(fields)
  return {
    ...(selected.has("afkChannelId") ? { afkChannelId: desired.afkChannelId } : {}),
    ...(selected.has("afkTimeoutSeconds")
      ? { afkTimeoutSeconds: desired.afkTimeoutSeconds }
      : {}),
    ...(selected.has("defaultMessageNotifications")
      ? { defaultMessageNotifications: desired.defaultMessageNotifications }
      : {}),
    ...(selected.has("explicitContentFilter")
      ? { explicitContentFilter: desired.explicitContentFilter }
      : {}),
    ...(selected.has("premiumProgressBarEnabled")
      ? { premiumProgressBarEnabled: desired.premiumProgressBarEnabled }
      : {}),
    ...(selected.has("suppressedSystemNotifications")
      ? { suppressedSystemNotifications: desired.suppressedSystemNotifications }
      : {}),
    ...(selected.has("systemChannelId")
      ? { systemChannelId: desired.systemChannelId }
      : {}),
    ...(selected.has("verificationLevel")
      ? { verificationLevel: desired.verificationLevel }
      : {}),
  }
}

function driftFields(
  response: GuildSettingsSnapshot,
  readback: GuildSettingsSnapshot,
  desired: GuildSettingsSnapshot,
  fields: readonly GuildSettingsField[],
): GuildSettingsField[] {
  return fields.filter((field) => (
    !fieldMatches(response, desired, field)
    || !fieldMatches(readback, desired, field)
  )).sort()
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
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: GuildSettingsChangePlan
  request: NormalizedGuildSettingsChangeRequest
  status: GuildSettingsActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): GuildSettingsActivity {
  return {
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "guild-settings-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    requestedFields: [...options.request.requestedFields],
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: GuildSettingsChangePlan
  request: NormalizedGuildSettingsChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "guild-settings-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.guildId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function executionBlocksGuild(error: unknown): boolean {
  if (
    !(error instanceof GuildSettingsExecutionError)
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
  priorUncertainError: () => GuildSettingsExecutionError,
): Promise<T> {
  const prior = GUILD_SETTINGS_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: GuildSettingsTargetOutcome) => void = () => undefined
  const tail = new Promise<GuildSettingsTargetOutcome>((resolve) => {
    release = resolve
  })
  GUILD_SETTINGS_LOCKS.set(guildId, tail)
  let outcome: GuildSettingsTargetOutcome = "settled"
  try {
    if (await prior === "uncertain") {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksGuild(error)) outcome = "uncertain"
    throw error
  } finally {
    release(outcome)
    if (outcome === "settled" && GUILD_SETTINGS_LOCKS.get(guildId) === tail) {
      GUILD_SETTINGS_LOCKS.delete(guildId)
    }
  }
}

export class GuildSettingsService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildSettingsServiceClient
  readonly #clock: () => Date
  readonly #layoutSource: GatewayChannelLayoutSource
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: GuildSettingsServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: GuildSettingsServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#layoutSource = options.layoutSource
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    applicationId: string,
    botId: string,
    guildId: string,
    mode: "audit" | "change",
    options: RequestOptions,
    operationKeyHashValue?: string,
    allowCompletedReceipt = false,
  ): Promise<GuildSettingsState> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord guild-settings guild ID")
    if (mode === "change") this.#policy.assertGuildSettingsChangeable(guildId)
    else this.#policy.assertGuildSettingsAuditable(guildId)
    let priorReceipt: OperationReceipt | null = null
    if (operationKeyHashValue) {
      priorReceipt = await this.#operationStore.get(
        "guild-settings-change",
        operationKeyHashValue,
      ) ?? null
      if (
        priorReceipt
        && !(
          allowCompletedReceipt
          && priorReceipt.status === "completed"
          && priorReceipt.verification === "match"
          && priorReceipt.guildId === guildId
          && priorReceipt.resourceId === guildId
        )
      ) {
        throw new GuildSettingsOperationConflictError(receiptView(priorReceipt))
      }
    }
    let supportingEvidence: {
      guild: DiscordGuild
      member: DiscordGuildMember
      roles: DiscordRole[]
    } | undefined
    let rawChannelEvidence: GuildChannelEvidence
    try {
      rawChannelEvidence = await collectGuildChannelEvidence({
        guildId,
        layoutSource: this.#layoutSource,
        readChannels: async () => {
          const [guild, member, roles, channels] = await Promise.all([
            this.#client.getGuild(guildId, options),
            this.#client.getGuildMember(guildId, botId, options),
            this.#client.getGuildRoles(guildId, options),
            this.#client.getGuildChannels(guildId, options),
          ])
          supportingEvidence = { guild, member, roles }
          return channels
        },
      })
    } catch (error) {
      if (error instanceof GuildChannelEvidenceError) {
        throw evidenceError(
          `Discord guild-settings channel evidence is incomplete: ${error.message}`,
        )
      }
      throw error
    }
    if (!supportingEvidence) {
      throw evidenceError("Discord guild-settings supporting evidence is unavailable")
    }
    const guild = exactGuildSettings(supportingEvidence.guild, guildId)
    const botMember = exactBotMember(supportingEvidence.member, guildId, botId)
    const roles = exactRoles(supportingEvidence.roles, guildId)
    const channels = exactChannels(rawChannelEvidence.channels, guildId)
    const channelEvidence: GuildChannelEvidence<ValidatedChannel> = {
      channels,
      layout: rawChannelEvidence.layout,
      view: rawChannelEvidence.view,
    }
    const permissions = completePermissions(botMember, guildId, roles)
    const access = accessEvidence(permissions, guild.ownerId === botId)
    if (!access.authorizedForChange) {
      throw evidenceError(
        "Discord connector bot requires guild ownership or complete MANAGE_GUILD authority for guild settings",
      )
    }
    return {
      access,
      botMember,
      channelEvidence,
      configuration: configurationView(guild.settings, channelEvidence),
      guild,
      priorReceipt,
      roles,
    }
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildSettingsAuditResult> {
    assertGuildSettingsGetInput(guildId)
    const state = await this.#state(applicationId, botId, guildId, "audit", options)
    return {
      access: state.access,
      applicationId,
      botId,
      configuration: state.configuration,
      guildId,
      inventory: state.channelEvidence.view,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      verificationBoundary: verificationBoundary(),
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    desiredRequest: NormalizedGuildSettingsChangeRequest,
    options: RequestOptions,
    allowCompletedReceipt = false,
  ): Promise<BuiltGuildSettingsPlan> {
    const state = await this.#state(
      applicationId,
      botId,
      desiredRequest.guildId,
      "change",
      options,
      desiredRequest.operationKeyHash,
      allowCompletedReceipt,
    )
    const desiredState = desiredSnapshot(state.guild.settings, desiredRequest)
    const desiredView = configurationView(desiredState, state.channelEvidence)
    assertDesiredSafe(state.guild.settings, desiredRequest, desiredView)
    const changed = changedFields(
      state.guild.settings,
      desiredState,
      desiredRequest.requestedFields,
    )
    const fieldEffects = effects(state.guild.settings, desiredState, changed)
    const privacy = privacyProjection()
    const boundary = verificationBoundary()
    const risks = planRisks(fieldEffects)
    const warnings = changed.length === 0
      ? [
          ...desiredView.issues,
          "The requested guild-settings fields already match Discord",
        ]
      : planWarnings(desiredView, changed)
    const evidence = {
      access: state.access,
      botMemberRoleIds: [...state.botMember.roles],
      channels: state.channelEvidence.channels.map((channel) => ({
        id: channel.id,
        parentId: channel.parent_id,
        position: channel.position,
        type: channel.type,
      })),
      current: state.guild.settings,
      desired: desiredState,
      guild: {
        features: [...state.guild.features],
        id: state.guild.id,
        ownerId: state.guild.ownerId,
      },
      inventory: state.channelEvidence.view,
      layoutRevision: state.channelEvidence.layout.revision,
      roles: state.roles.map((role) => ({
        id: role.id,
        managed: role.managed,
        permissions: role.permissions,
        position: role.position,
      })),
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      changedFields: changed,
      desiredRequest,
      domain: "guildcontrol-guild-settings-change-plan.v1",
      effects: fieldEffects,
      evidence,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy,
      risks,
      verificationBoundary: boundary,
      warnings,
    })
    const plan: GuildSettingsChangePlan = {
      access: state.access,
      applicationId,
      auditReason: desiredRequest.auditReason,
      botId,
      changedFields: changed,
      createdAt: this.#clock().toISOString(),
      current: state.configuration,
      desired: desiredView,
      digest,
      effects: fieldEffects,
      guildId: desiredRequest.guildId,
      inventory: state.channelEvidence.view,
      localConstraints: LOCAL_CONSTRAINTS,
      operationKeyHash: desiredRequest.operationKeyHash,
      privacy,
      requestedFields: [...desiredRequest.requestedFields],
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: changed.length === 0 ? "already-current" : "planned",
      verificationBoundary: boundary,
      warnings,
      writeRequired: changed.length > 0,
    }
    if (state.priorReceipt && plan.writeRequired) {
      throw new GuildSettingsOperationConflictError(
        receiptView(state.priorReceipt),
      )
    }
    return { desiredRequest, desiredSnapshot: desiredState, plan, state }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildSettingsChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildSettingsChangePlan> {
    const desired = normalizeGuildSettingsChangeRequest(request)
    return (await this.#buildPlan(applicationId, botId, desired, options)).plan
  }

  async reconcilePlan(
    applicationId: string,
    botId: string,
    request: GuildSettingsChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildSettingsChangePlan> {
    const desired = normalizeGuildSettingsChangeRequest(request)
    return (
      await this.#buildPlan(applicationId, botId, desired, options, true)
    ).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: GuildSettingsChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildSettingsChangeResult> {
    const desired = normalizeGuildSettingsChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild-settings plan digest is invalid")
    }
    return withGuildLock(
      desired.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        desired,
        expectedDigest,
        options,
      ),
      () => new GuildSettingsExecutionError(
        "Discord guild-settings change was blocked because a prior same-guild operation ended without a durable outcome",
        {
          guildId: desired.guildId,
          operationKeyHash: desired.operationKeyHash,
          planDigest: expectedDigest,
          requestedFields: desired.requestedFields,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    desired: NormalizedGuildSettingsChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildSettingsChangeResult> {
    let built: BuiltGuildSettingsPlan
    try {
      built = await this.#buildPlan(applicationId, botId, desired, options)
    } catch (error) {
      if (
        error instanceof GuildSettingsEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GuildSettingsPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan } = built
    if (plan.digest !== expectedDigest) {
      throw new GuildSettingsPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      guildId: desired.guildId,
      operationKeyHash: desired.operationKeyHash,
      planDigest: plan.digest,
      requestedFields: [...desired.requestedFields],
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        driftFields: [],
        status: "already-current",
        verification: "not-required",
        warnings: plan.warnings,
      }
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request: desired,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new GuildSettingsOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: desired,
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
          request: desired,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new GuildSettingsExecutionError(
        "Discord guild-settings change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
      )
    }

    let mutationStarted = false
    let mutationReturned = false
    let responseSnapshot: GuildSettingsSnapshot | null = null
    let readbackSnapshot: GuildSettingsSnapshot | null = null
    try {
      mutationStarted = true
      responseSnapshot = exactGuildSettings(
        await this.#client.modifyGuildSettings(
          desired.guildId,
          transportInput(built.desiredSnapshot, plan.changedFields),
          desired.auditReason,
          options,
        ),
        desired.guildId,
      ).settings
      mutationReturned = true
      const readback = await this.#state(
        applicationId,
        botId,
        desired.guildId,
        "audit",
        options,
      )
      readbackSnapshot = readback.guild.settings
      const desiredView = configurationView(
        built.desiredSnapshot,
        readback.channelEvidence,
      )
      assertDesiredSafe(readback.guild.settings, desired, desiredView)
    } catch (error) {
      const definiteMutationRefusal = mutationStarted
        && !mutationReturned
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
      const status = mutationStarted && !definiteMutationRefusal
        ? "uncertain"
        : "failed"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request: desired,
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
          plan,
          request: desired,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new GuildSettingsExecutionError(
        "Discord guild-settings change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          responseReturned: mutationReturned,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const observedDrift = driftFields(
      responseSnapshot,
      readbackSnapshot,
      built.desiredSnapshot,
      plan.changedFields,
    )
    const verification = observedDrift.length === 0 ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const warnings = verification === "match"
      ? plan.warnings
      : [
          ...plan.warnings,
          "Discord returned or read back a different value for at least one requested field",
        ]
    const result: GuildSettingsChangeResult = {
      ...baseResult,
      activityId,
      driftFields: observedDrift,
      status,
      verification,
      warnings,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request: desired,
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
          plan,
          request: desired,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new GuildSettingsExecutionError(
        "Discord guild-settings change completed but the operation receipt failed",
        {
          ...result,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
        },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: desired,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new GuildSettingsExecutionError(
        "Discord guild-settings change completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
      )
    }
    return result
  }
}
