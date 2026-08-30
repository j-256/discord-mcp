import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  WidgetSettingsActivity,
  WidgetSettingsActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildWidgetSettings,
  type ModifyGuildWidgetSettingsInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  WidgetSettingsEvidenceError,
  WidgetSettingsExecutionError,
  WidgetSettingsOperationConflictError,
  WidgetSettingsPlanChangedError,
} from "./errors.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  evaluatePrincipalPermissions,
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
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "widget-settings-state-unavailable"
const GUILD_NAME_CHARACTERS = 100
const GUILD_FEATURE_PATTERN = /^[A-Z0-9_]+$/u
const MAX_PROJECTED_UNKNOWN_FIELDS = 256
const REQUEST_KEYS = [
  "auditReason",
  "channelId",
  "enabled",
  "guildId",
  "operationKey",
] as const
const SUPPORTED_WIDGET_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const GUILD_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  ...SUPPORTED_WIDGET_CHANNEL_TYPES,
  DISCORD_CHANNEL_TYPES.category,
  DISCORD_CHANNEL_TYPES.directory,
])
const LOCAL_CONSTRAINTS = Object.freeze({
  guildAllowlist: CONNECTOR_LIMITS.widgetSettingsGuildAllowlist,
  supportedChannelTypes: [...SUPPORTED_WIDGET_CHANNEL_TYPES].sort((left, right) => left - right),
})

type WidgetSettingsTargetOutcome = "settled" | "uncertain"
const WIDGET_SETTINGS_GUILD_LOCKS = new Map<
  string,
  Promise<WidgetSettingsTargetOutcome>
>()

export interface WidgetSettingsChangeRequest {
  auditReason: string
  channelId: string | null
  enabled: boolean
  guildId: string
  operationKey: string
}

export interface NormalizedWidgetSettingsChangeRequest {
  auditReason: string
  channelId: string | null
  enabled: boolean
  guildId: string
  operationKeyHash: string
}

export interface WidgetSettingsAccessEvidence {
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

export interface WidgetChannelReferenceView {
  ageRestricted: boolean | null
  channelId: string
  direct: boolean
  everyoneCanCreateInvites: boolean | null
  everyoneCanView: boolean | null
  exists: boolean
  parentId: string | null
  type: number | null
  unknownPermissionBits: string | null
}

export interface WidgetSettingsConfigurationView {
  channel: WidgetChannelReferenceView | null
  channelId: string | null
  changeBlockedReasons: string[]
  enabled: boolean
  issues: string[]
  unknownFieldCount: number
}

export interface WidgetSettingsGuildCrossCheck {
  channelIdObserved: boolean
  enabledObserved: boolean
  status: "match" | "partial-match" | "unavailable"
}

export interface WidgetPublicExposureView {
  anonymousInviteGenerationPotential: boolean
  anonymousWidgetDataPotential: boolean
  anonymousWidgetFetched: false
  anonymousWidgetImageFetched: false
  manualPrivateProfileRestorationMayBeRequired: boolean
  privateProfileStateObserved: false
  serverProfileVisibility: "not-verifiable" | "public-by-widget"
}

export interface WidgetSettingsPrivacyProjection {
  anonymousEndpoints: "not-called"
  channelNames: "omitted"
  invites: "omitted"
  memberAndPresenceData: "omitted"
  persistence: "none"
  rawPayloads: "omitted"
  unknownFields: "counts-only"
}

export interface WidgetSettingsAuditResult {
  access: WidgetSettingsAccessEvidence
  applicationId: string
  botId: string
  configuration: WidgetSettingsConfigurationView
  guild: { id: string; name: string }
  guildCrossCheck: WidgetSettingsGuildCrossCheck
  localConstraints: typeof LOCAL_CONSTRAINTS
  privacy: WidgetSettingsPrivacyProjection
  publicExposure: WidgetPublicExposureView
  schemaVersion: number
  status: "ok"
  verificationBoundary: WidgetSettingsVerificationBoundary
}

export interface WidgetSettingsChangeDiff {
  channelChanged: boolean
  enabledChanged: boolean
}

export interface WidgetSettingsPublicExposureAuthorization {
  required: boolean
  satisfied: boolean
}

export interface WidgetSettingsVerificationBoundary {
  anonymousWidgetReadbackPerformed: false
  apiReadback: true
  freshNonMemberReviewRecommended: boolean
  privateProfileRestorationVerified: false
  privateProfileStateObserved: false
}

export interface WidgetSettingsChangePlan {
  access: WidgetSettingsAccessEvidence
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  current: WidgetSettingsConfigurationView
  desired: WidgetSettingsConfigurationView
  diff: WidgetSettingsChangeDiff
  digest: string
  guild: { id: string; name: string }
  guildCrossCheck: WidgetSettingsGuildCrossCheck
  localConstraints: typeof LOCAL_CONSTRAINTS
  operationKeyHash: string
  privacy: WidgetSettingsPrivacyProjection
  publicExposureAuthorization: WidgetSettingsPublicExposureAuthorization
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verificationBoundary: WidgetSettingsVerificationBoundary
  warnings: string[]
  writeRequired: boolean
}

export interface WidgetSettingsChangeResult {
  activityId: string | null
  guildId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
  warnings: string[]
}

export interface WidgetSettingsServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "getGuildWidgetSettings"
  | "modifyGuildWidgetSettings"
> {}

export interface WidgetSettingsServiceOptions {
  activityStore: ActivityStore
  client: WidgetSettingsServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertGuildWidgetPublicExposureChangeable"
    | "assertGuildWidgetSettingsAuditable"
    | "assertGuildWidgetSettingsChangeable"
  >
  randomId?: () => string
}

interface ValidatedGuild extends DiscordGuild {
  features: string[]
  owner_id: string
}

interface ValidatedRole {
  id: string
  managed: boolean
  name: string
  permissions: string
  position: number
}

interface ValidatedChannel extends DiscordChannel {
  guild_id: string
  name: string
  parent_id: string | null
  permission_overwrites: DiscordPermissionOverwrite[]
}

interface ValidatedBotMember {
  roles: string[]
}

interface WidgetSettingsState {
  access: WidgetSettingsAccessEvidence
  botMember: ValidatedBotMember
  channels: ValidatedChannel[]
  configuration: WidgetSettingsConfigurationView
  guild: ValidatedGuild
  guildCrossCheck: WidgetSettingsGuildCrossCheck
  roles: ValidatedRole[]
  settings: DiscordGuildWidgetSettings
}

interface BuiltWidgetSettingsPlan {
  desired: NormalizedWidgetSettingsChangeRequest
  plan: WidgetSettingsChangePlan
  state: WidgetSettingsState
}

function evidenceError(
  message: string,
  options?: ErrorOptions,
): WidgetSettingsEvidenceError {
  return new WidgetSettingsEvidenceError(message, options)
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

function validText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || [...value].length > maximum
    || value.trim() !== value
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

export function assertWidgetSettingsGetInput(guildId: string): void {
  assertPositiveSnowflake(guildId, "Discord widget-settings guild ID")
}

export function normalizeWidgetSettingsChangeRequest(
  request: WidgetSettingsChangeRequest,
): NormalizedWidgetSettingsChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord widget-settings change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, REQUEST_KEYS)
    || typeof request.enabled !== "boolean"
    || !(request.channelId === null || typeof request.channelId === "string")
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) {
    throw new RangeError("Discord widget-settings change request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord widget-settings guild ID")
  if (typeof request.channelId === "string") {
    assertPositiveSnowflake(request.channelId, "Discord widget channel ID")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    channelId: request.channelId,
    enabled: request.enabled,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function exactGuild(value: DiscordGuild, guildId: string): ValidatedGuild {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !validText(value.name, GUILD_NAME_CHARACTERS)
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
  ) {
    throw evidenceError("Discord returned incomplete or mismatched widget-settings guild evidence")
  }
  const record = value as unknown as Record<string, unknown>
  if (
    Object.hasOwn(record, "widget_enabled")
    && typeof record.widget_enabled !== "boolean"
  ) {
    throw evidenceError("Discord returned invalid guild widget-enabled evidence")
  }
  if (
    Object.hasOwn(record, "widget_channel_id")
    && !(record.widget_channel_id === null || positiveSnowflake(record.widget_channel_id))
  ) {
    throw evidenceError("Discord returned invalid guild widget-channel evidence")
  }
  return {
    features: [...value.features],
    id: value.id,
    name: value.name,
    owner_id: value.owner_id,
    ...(Object.hasOwn(record, "widget_channel_id")
      ? { widget_channel_id: value.widget_channel_id ?? null }
      : {}),
    ...(Object.hasOwn(record, "widget_enabled")
      ? { widget_enabled: value.widget_enabled }
      : {}),
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
    throw evidenceError("Discord returned incomplete or mismatched widget-settings bot evidence")
  }
  return { roles: [...value.roles].sort(compareSnowflakes) }
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded widget-settings role inventory")
  }
  const ids = new Set<string>()
  const roles = value.map((role) => {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || !validText(role.name, DISCORD_LIMITS.roleNameCharacters)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || ids.has(role.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate widget-settings role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid widget-settings role permissions", {
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
  if (
    !everyone
    || everyone.name !== "@everyone"
    || everyone.managed
    || everyone.position !== 0
  ) {
    throw evidenceError("Discord returned invalid widget-settings @everyone role evidence")
  }
  return roles.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactOverwrites(
  value: unknown,
  roleIds: ReadonlySet<string>,
): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord returned incomplete widget channel overwrite evidence")
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw evidenceError("Discord returned invalid widget channel overwrite evidence")
    }
    const overwrite = entry as DiscordPermissionOverwrite
    if (
      !positiveSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || (overwrite.type === 0 && !roleIds.has(overwrite.id))
      || seen.has(`${overwrite.type}:${overwrite.id}`)
    ) {
      throw evidenceError("Discord returned contradictory widget channel overwrites")
    }
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(overwrite.allow ?? "0", "widget overwrite allow")
      deny = parseDiscordPermissionBits(overwrite.deny ?? "0", "widget overwrite deny")
    } catch (error) {
      throw evidenceError("Discord returned invalid widget overwrite bits", { cause: error })
    }
    if ((allow & deny) !== 0n) {
      throw evidenceError("Discord returned overlapping widget overwrite bits")
    }
    seen.add(`${overwrite.type}:${overwrite.id}`)
    return {
      allow: allow.toString(),
      deny: deny.toString(),
      id: overwrite.id,
      type: overwrite.type,
    }
  })
}

function exactChannels(
  value: readonly DiscordChannel[],
  guildId: string,
  roles: readonly ValidatedRole[],
): ValidatedChannel[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildChannels) {
    throw evidenceError("Discord returned an invalid bounded widget channel inventory")
  }
  const roleIds = new Set(roles.map((role) => role.id))
  const ids = new Set<string>()
  const channels = value.map((channel) => {
    if (
      !channel
      || typeof channel !== "object"
      || Array.isArray(channel)
      || !positiveSnowflake(channel.id)
      || channel.guild_id !== guildId
      || !GUILD_CHANNEL_TYPES.has(channel.type)
      || !validText(channel.name, DISCORD_LIMITS.channelNameCharacters)
      || !(channel.parent_id === undefined || channel.parent_id === null
        || positiveSnowflake(channel.parent_id))
      || !(channel.nsfw === undefined || typeof channel.nsfw === "boolean")
      || ids.has(channel.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate widget channel evidence")
    }
    ids.add(channel.id)
    return {
      guild_id: guildId,
      id: channel.id,
      name: channel.name,
      ...(typeof channel.nsfw === "boolean" ? { nsfw: channel.nsfw } : {}),
      parent_id: channel.parent_id ?? null,
      permission_overwrites: exactOverwrites(channel.permission_overwrites, roleIds),
      type: channel.type,
    } as ValidatedChannel
  })
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]))
  for (const channel of channels) {
    if (channel.type === DISCORD_CHANNEL_TYPES.category && channel.parent_id !== null) {
      throw evidenceError("Discord returned a parented widget channel category")
    }
    if (channel.parent_id !== null) {
      const parent = channelsById.get(channel.parent_id)
      if (!parent || parent.type !== DISCORD_CHANNEL_TYPES.category) {
        throw evidenceError("Discord returned incomplete widget channel hierarchy evidence")
      }
    }
  }
  return channels.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactSettings(value: DiscordGuildWidgetSettings): DiscordGuildWidgetSettings {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof value.enabled !== "boolean"
    || !(value.channelId === null || positiveSnowflake(value.channelId))
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
    || value.unknownFieldCount > MAX_PROJECTED_UNKNOWN_FIELDS
  ) {
    throw evidenceError("Discord returned invalid authenticated widget-settings evidence")
  }
  return {
    channelId: value.channelId,
    enabled: value.enabled,
    unknownFieldCount: value.unknownFieldCount,
  }
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
    throw evidenceError("Discord returned invalid widget-settings permission evidence", {
      cause: error,
    })
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete widget-settings permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): WidgetSettingsAccessEvidence {
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
  channelsById: ReadonlyMap<string, ValidatedChannel>,
  guild: ValidatedGuild,
  roles: readonly ValidatedRole[],
): WidgetChannelReferenceView {
  const channel = channelsById.get(channelId)
  if (!channel) {
    return {
      ageRestricted: null,
      channelId,
      direct: false,
      everyoneCanCreateInvites: null,
      everyoneCanView: null,
      exists: false,
      parentId: null,
      type: null,
      unknownPermissionBits: null,
    }
  }
  const direct = SUPPORTED_WIDGET_CHANNEL_TYPES.has(channel.type)
  if (!direct) {
    return {
      ageRestricted: channel.nsfw ?? null,
      channelId,
      direct: false,
      everyoneCanCreateInvites: null,
      everyoneCanView: null,
      exists: true,
      parentId: channel.parent_id,
      type: channel.type,
      unknownPermissionBits: null,
    }
  }
  let result: ReturnType<typeof evaluatePrincipalPermissions>
  try {
    result = evaluatePrincipalPermissions({
      channel,
      guildId: guild.id,
      guildOwnerId: guild.owner_id,
      permissionChannel: channel,
      requestedPermissions: ["CREATE_INSTANT_INVITE", "VIEW_CHANNEL"],
      roles,
      subject: { id: guild.id, kind: "role" },
    })
  } catch (error) {
    throw evidenceError("Discord returned invalid widget channel permission evidence", {
      cause: error,
    })
  }
  if (result.confidence !== "complete") {
    throw evidenceError("Discord returned incomplete widget channel permission evidence")
  }
  const effective = new Set(result.effectivePermissionNames)
  return {
    ageRestricted: channel.nsfw ?? null,
    channelId,
    direct: true,
    everyoneCanCreateInvites: effective.has("CREATE_INSTANT_INVITE"),
    everyoneCanView: effective.has("VIEW_CHANNEL")
      && !result.ineffectivePermissions.includes("VIEW_CHANNEL"),
    exists: true,
    parentId: channel.parent_id,
    type: channel.type,
    unknownPermissionBits: result.unknownPermissionBits,
  }
}

function guildCrossCheck(
  guild: ValidatedGuild,
  settings: DiscordGuildWidgetSettings,
): WidgetSettingsGuildCrossCheck {
  const record = guild as unknown as Record<string, unknown>
  const enabledObserved = Object.hasOwn(record, "widget_enabled")
  const channelIdObserved = Object.hasOwn(record, "widget_channel_id")
  if (enabledObserved && record.widget_enabled !== settings.enabled) {
    throw evidenceError("Discord guild and widget-settings enabled evidence disagree")
  }
  if (channelIdObserved && record.widget_channel_id !== settings.channelId) {
    throw evidenceError("Discord guild and widget-settings channel evidence disagree")
  }
  return {
    channelIdObserved,
    enabledObserved,
    status: enabledObserved && channelIdObserved
      ? "match"
      : enabledObserved || channelIdObserved
        ? "partial-match"
        : "unavailable",
  }
}

function configurationView(
  settings: DiscordGuildWidgetSettings,
  guild: ValidatedGuild,
  roles: readonly ValidatedRole[],
  channels: readonly ValidatedChannel[],
): WidgetSettingsConfigurationView {
  const issues: string[] = []
  const changeBlockedReasons: string[] = []
  if (settings.unknownFieldCount > 0) {
    issues.push("unknown-fields")
    changeBlockedReasons.push("unknown-fields")
  }
  const channel = settings.channelId === null
    ? null
    : channelReferenceView(
        settings.channelId,
        new Map(channels.map((entry) => [entry.id, entry])),
        guild,
        roles,
      )
  if (channel && !channel.exists) issues.push("missing-channel")
  if (channel?.exists && !channel.direct) issues.push("unsupported-channel")
  if (channel?.direct && channel.everyoneCanView !== true) {
    issues.push("channel-hidden-from-everyone")
  }
  if (channel?.unknownPermissionBits !== null && channel?.unknownPermissionBits !== "0") {
    issues.push("unknown-channel-permission-bits")
  }
  return {
    channel,
    channelId: settings.channelId,
    changeBlockedReasons: [...new Set(changeBlockedReasons)].sort(),
    enabled: settings.enabled,
    issues: [...new Set(issues)].sort(),
    unknownFieldCount: settings.unknownFieldCount,
  }
}

function publicExposure(settings: {
  channelId: string | null
  enabled: boolean
}): WidgetPublicExposureView {
  return {
    anonymousInviteGenerationPotential: settings.enabled && settings.channelId !== null,
    anonymousWidgetDataPotential: settings.enabled,
    anonymousWidgetFetched: false,
    anonymousWidgetImageFetched: false,
    manualPrivateProfileRestorationMayBeRequired: !settings.enabled,
    privateProfileStateObserved: false,
    serverProfileVisibility: settings.enabled ? "public-by-widget" : "not-verifiable",
  }
}

function privacyProjection(): WidgetSettingsPrivacyProjection {
  return {
    anonymousEndpoints: "not-called",
    channelNames: "omitted",
    invites: "omitted",
    memberAndPresenceData: "omitted",
    persistence: "none",
    rawPayloads: "omitted",
    unknownFields: "counts-only",
  }
}

function verificationBoundary(
  desired: { enabled: boolean },
): WidgetSettingsVerificationBoundary {
  return {
    anonymousWidgetReadbackPerformed: false,
    apiReadback: true,
    freshNonMemberReviewRecommended: desired.enabled,
    privateProfileRestorationVerified: false,
    privateProfileStateObserved: false,
  }
}

function settingsAuthoritative(settings: DiscordGuildWidgetSettings): boolean {
  return settings.unknownFieldCount === 0
}

function settingsMatch(
  settings: DiscordGuildWidgetSettings,
  desired: NormalizedWidgetSettingsChangeRequest,
): boolean {
  return settingsAuthoritative(settings)
    && settings.enabled === desired.enabled
    && settings.channelId === desired.channelId
}

function changeDiff(
  current: DiscordGuildWidgetSettings,
  desired: NormalizedWidgetSettingsChangeRequest,
): WidgetSettingsChangeDiff {
  return {
    channelChanged: current.channelId !== desired.channelId,
    enabledChanged: current.enabled !== desired.enabled,
  }
}

function publicExposureAuthorizationRequired(
  current: DiscordGuildWidgetSettings,
  desired: NormalizedWidgetSettingsChangeRequest,
  writeRequired: boolean,
): boolean {
  return writeRequired && (
    desired.enabled
    || desired.channelId !== null && desired.channelId !== current.channelId
  )
}

function assertDesiredStateSafe(
  state: WidgetSettingsState,
  desiredView: WidgetSettingsConfigurationView,
): void {
  if (!state.access.authorizedForChange) {
    throw evidenceError("Discord connector bot lacks complete widget-settings authority")
  }
  if (state.access.unknownPermissionBits !== "0") {
    throw evidenceError("Discord widget-settings authority contains unknown permission bits")
  }
  if (state.configuration.changeBlockedReasons.length > 0) {
    throw evidenceError("Discord widget settings contain unknown state that blocks replacement")
  }
  if (desiredView.channel === null) return
  if (
    !desiredView.channel.exists
    || !desiredView.channel.direct
    || desiredView.channel.everyoneCanView !== true
    || desiredView.channel.unknownPermissionBits !== "0"
  ) {
    throw evidenceError(
      "Discord widget channel must be a supported direct channel visible to @everyone with complete permission evidence",
    )
  }
}

function planRisks(
  diff: WidgetSettingsChangeDiff,
  desired: NormalizedWidgetSettingsChangeRequest,
): string[] {
  const risks = [
    "The write replaces the complete authenticated widget-settings state",
    "The operation is intentionally not retried after the PATCH begins",
  ]
  if (desired.enabled) {
    risks.push("Enabling or retaining the widget makes the Server Profile public outside the guild")
    risks.push("Anonymous widget reads may expose public channel and presence-oriented data")
  } else if (diff.enabledChanged) {
    risks.push("Disabling the widget does not automatically restore Private Profile")
  }
  if (desired.channelId !== null) {
    risks.push("Anonymous widget reads may generate an invite for the configured channel")
  }
  if (diff.channelChanged) {
    risks.push(desired.channelId === null
      ? "The widget invite channel will be cleared"
      : "The widget invite channel will change")
  }
  return risks
}

function planWarnings(
  access: WidgetSettingsAccessEvidence,
  desired: NormalizedWidgetSettingsChangeRequest,
): string[] {
  return [
    ...access.warnings,
    "Anonymous widget JSON and image endpoints are not called during verification",
    desired.enabled
      ? "A fresh non-member review is recommended after enabling public widget exposure"
      : "Private Profile may require manual restoration in Discord Server Settings",
  ]
}

function transportInput(
  desired: NormalizedWidgetSettingsChangeRequest,
): ModifyGuildWidgetSettingsInput {
  return {
    channelId: desired.channelId,
    enabled: desired.enabled,
  }
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
  plan: WidgetSettingsChangePlan
  request: NormalizedWidgetSettingsChangeRequest
  status: WidgetSettingsActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): WidgetSettingsActivity {
  return {
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "widget-settings-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: WidgetSettingsChangePlan
  request: NormalizedWidgetSettingsChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "widget-settings-change",
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
    !(error instanceof WidgetSettingsExecutionError)
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
  priorUncertainError: () => WidgetSettingsExecutionError,
): Promise<T> {
  const prior = WIDGET_SETTINGS_GUILD_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: WidgetSettingsTargetOutcome) => void = () => undefined
  const tail = new Promise<WidgetSettingsTargetOutcome>((resolve) => {
    release = resolve
  })
  WIDGET_SETTINGS_GUILD_LOCKS.set(guildId, tail)
  let outcome: WidgetSettingsTargetOutcome = "settled"
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
    if (
      outcome === "settled"
      && WIDGET_SETTINGS_GUILD_LOCKS.get(guildId) === tail
    ) {
      WIDGET_SETTINGS_GUILD_LOCKS.delete(guildId)
    }
  }
}

export class WidgetSettingsService {
  readonly #activityStore: ActivityStore
  readonly #client: WidgetSettingsServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: WidgetSettingsServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: WidgetSettingsServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
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
  ): Promise<WidgetSettingsState> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord widget-settings guild ID")
    if (mode === "change") {
      this.#policy.assertGuildWidgetSettingsChangeable(guildId)
    } else {
      this.#policy.assertGuildWidgetSettingsAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "widget-settings-change",
        operationKeyHashValue,
      )
      if (receipt) throw new WidgetSettingsOperationConflictError(receiptView(receipt))
    }
    const [rawGuild, rawBotMember, rawRoles, rawChannels] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getGuildChannels(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawBotMember, guildId, botId)
    const roles = exactRoles(rawRoles, guildId)
    const channels = exactChannels(rawChannels, guildId, roles)
    const permissions = completePermissions(botMember, guildId, roles)
    const access = accessEvidence(permissions, guild.owner_id === botId)
    if (!access.authorizedForChange) {
      throw evidenceError(
        "Discord connector bot requires guild ownership or complete MANAGE_GUILD authority for widget settings",
      )
    }
    const settings = exactSettings(
      await this.#client.getGuildWidgetSettings(guildId, options),
    )
    const crossCheck = guildCrossCheck(guild, settings)
    return {
      access,
      botMember,
      channels,
      configuration: configurationView(settings, guild, roles, channels),
      guild,
      guildCrossCheck: crossCheck,
      roles,
      settings,
    }
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<WidgetSettingsAuditResult> {
    assertWidgetSettingsGetInput(guildId)
    const state = await this.#state(
      applicationId,
      botId,
      guildId,
      "audit",
      options,
    )
    return {
      access: state.access,
      applicationId,
      botId,
      configuration: state.configuration,
      guild: { id: state.guild.id, name: state.guild.name },
      guildCrossCheck: state.guildCrossCheck,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy: privacyProjection(),
      publicExposure: publicExposure(state.settings),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      verificationBoundary: verificationBoundary(state.settings),
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    desired: NormalizedWidgetSettingsChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltWidgetSettingsPlan> {
    const state = await this.#state(
      applicationId,
      botId,
      desired.guildId,
      "change",
      options,
      desired.operationKeyHash,
    )
    const desiredSettings: DiscordGuildWidgetSettings = {
      channelId: desired.channelId,
      enabled: desired.enabled,
      unknownFieldCount: 0,
    }
    const desiredView = configurationView(
      desiredSettings,
      state.guild,
      state.roles,
      state.channels,
    )
    assertDesiredStateSafe(state, desiredView)
    const writeRequired = !settingsMatch(state.settings, desired)
    const authorizationRequired = publicExposureAuthorizationRequired(
      state.settings,
      desired,
      writeRequired,
    )
    if (authorizationRequired) {
      this.#policy.assertGuildWidgetPublicExposureChangeable(desired.guildId)
    }
    const diff = changeDiff(state.settings, desired)
    const privacy = privacyProjection()
    const warnings = writeRequired
      ? planWarnings(state.access, desired)
      : ["The complete desired widget-settings state already matches Discord"]
    const risks = writeRequired ? planRisks(diff, desired) : []
    const boundary = verificationBoundary(desired)
    const exposureAuthorization = {
      required: authorizationRequired,
      satisfied: true,
    }
    const evidence = {
      access: state.access,
      botMemberRoleIds: [...state.botMember.roles].sort(compareSnowflakes),
      channels: state.channels.map((channel) => ({
        ageRestricted: channel.nsfw ?? null,
        id: channel.id,
        parentId: channel.parent_id,
        permissionOverwrites: channel.permission_overwrites,
        type: channel.type,
      })),
      guild: {
        features: [...state.guild.features].sort(),
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
        widgetChannelId: Object.hasOwn(state.guild, "widget_channel_id")
          ? state.guild.widget_channel_id ?? null
          : null,
        widgetChannelIdObserved: Object.hasOwn(state.guild, "widget_channel_id"),
        widgetEnabled: Object.hasOwn(state.guild, "widget_enabled")
          ? state.guild.widget_enabled ?? null
          : null,
        widgetEnabledObserved: Object.hasOwn(state.guild, "widget_enabled"),
      },
      roles: state.roles.map((role) => ({
        id: role.id,
        managed: role.managed,
        permissions: role.permissions,
        position: role.position,
      })),
      settings: state.settings,
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      desired,
      domain: "guildcontrol-widget-settings-change-plan.v1",
      evidence,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy,
      publicExposureAuthorization: exposureAuthorization,
      risks,
      verificationBoundary: boundary,
      warnings,
    })
    const plan: WidgetSettingsChangePlan = {
      access: state.access,
      applicationId,
      auditReason: desired.auditReason,
      botId,
      createdAt: this.#clock().toISOString(),
      current: state.configuration,
      desired: desiredView,
      diff,
      digest,
      guild: { id: state.guild.id, name: state.guild.name },
      guildCrossCheck: state.guildCrossCheck,
      localConstraints: LOCAL_CONSTRAINTS,
      operationKeyHash: desired.operationKeyHash,
      privacy,
      publicExposureAuthorization: exposureAuthorization,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: writeRequired ? "planned" : "already-current",
      verificationBoundary: boundary,
      warnings,
      writeRequired,
    }
    return { desired, plan, state }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: WidgetSettingsChangeRequest,
    options: RequestOptions = {},
  ): Promise<WidgetSettingsChangePlan> {
    const desired = normalizeWidgetSettingsChangeRequest(request)
    return (await this.#buildPlan(applicationId, botId, desired, options)).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: WidgetSettingsChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<WidgetSettingsChangeResult> {
    const desired = normalizeWidgetSettingsChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord widget-settings plan digest is invalid")
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
      () => new WidgetSettingsExecutionError(
        "Discord widget-settings change was blocked because a prior same-guild operation ended without a durable outcome",
        {
          guildId: desired.guildId,
          operationKeyHash: desired.operationKeyHash,
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
    desired: NormalizedWidgetSettingsChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<WidgetSettingsChangeResult> {
    let built: BuiltWidgetSettingsPlan
    try {
      built = await this.#buildPlan(applicationId, botId, desired, options)
    } catch (error) {
      if (
        error instanceof WidgetSettingsEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new WidgetSettingsPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new WidgetSettingsPlanChangedError(expectedDigest, plan.digest)
    }
    const resultWarnings = desired.enabled
      ? ["Fresh non-member review is recommended for the public widget and Server Profile"]
      : ["Private Profile restoration may still require a manual Server Settings change"]
    const baseResult = {
      guildId: desired.guildId,
      operationKeyHash: desired.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      warnings: resultWarnings,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        status: "already-current",
        verification: "not-required",
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
      throw new WidgetSettingsOperationConflictError(receiptView(reservation.receipt))
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
      throw new WidgetSettingsExecutionError(
        "Discord widget-settings change was blocked because pending activity could not be recorded",
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
    let responseMatches = false
    let readbackMatches = false
    try {
      mutationStarted = true
      const response = exactSettings(await this.#client.modifyGuildWidgetSettings(
        desired.guildId,
        transportInput(desired),
        desired.auditReason,
        options,
      ))
      mutationReturned = true
      if (!settingsAuthoritative(response)) {
        throw evidenceError("Discord returned ambiguous widget-settings mutation evidence")
      }
      const responseView = configurationView(
        response,
        state.guild,
        state.roles,
        state.channels,
      )
      if (responseView.channel !== null && (
        !responseView.channel.exists
        || !responseView.channel.direct
        || responseView.channel.everyoneCanView !== true
        || responseView.channel.unknownPermissionBits !== "0"
      )) {
        throw evidenceError("Discord returned unsafe widget-settings mutation evidence")
      }
      responseMatches = settingsMatch(response, desired)
      const readback = await this.#state(
        applicationId,
        botId,
        desired.guildId,
        "audit",
        options,
      )
      assertDesiredStateSafe(readback, readback.configuration)
      assertDesiredStateSafe(
        readback,
        configurationView({
          channelId: desired.channelId,
          enabled: desired.enabled,
          unknownFieldCount: 0,
        }, readback.guild, readback.roles, readback.channels),
      )
      readbackMatches = settingsMatch(readback.settings, desired)
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
      throw new WidgetSettingsExecutionError(
        "Discord widget-settings change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          responseMatches,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = responseMatches && readbackMatches ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: WidgetSettingsChangeResult = {
      ...baseResult,
      activityId,
      status,
      verification,
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
      throw new WidgetSettingsExecutionError(
        "Discord widget-settings change completed but the operation receipt failed",
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
      throw new WidgetSettingsExecutionError(
        "Discord widget-settings change completed but the final activity record failed",
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
