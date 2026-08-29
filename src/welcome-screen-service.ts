import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  WelcomeScreenActivity,
  WelcomeScreenActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
  WELCOME_SCREEN_LIMITS,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildEmojiSummary,
  type DiscordGuildWelcomeScreen,
  type ModifyGuildWelcomeScreenInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  WelcomeScreenEvidenceError,
  WelcomeScreenExecutionError,
  WelcomeScreenOperationConflictError,
  WelcomeScreenPlanChangedError,
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

const STATE_UNAVAILABLE = "welcome-screen-state-unavailable"
const COMMUNITY_GUILD_FEATURE = "COMMUNITY"
const WELCOME_SCREEN_ENABLED_GUILD_FEATURE = "WELCOME_SCREEN_ENABLED"
const GUILD_NAME_CHARACTERS = 100
const GUILD_FEATURE_PATTERN = /^[A-Z0-9_]+$/u
const TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const EMOJI_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u
const SUPPORTED_WELCOME_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const GUILD_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  ...SUPPORTED_WELCOME_CHANNEL_TYPES,
  DISCORD_CHANNEL_TYPES.category,
  DISCORD_CHANNEL_TYPES.directory,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
])
const REQUEST_KEYS = [
  "auditReason",
  "channels",
  "description",
  "enabled",
  "guildId",
  "operationKey",
] as const
const CHANNEL_REQUEST_KEYS = ["channelId", "description", "emoji"] as const
const NONE_EMOJI_KEYS = ["kind"] as const
const CUSTOM_EMOJI_KEYS = ["emojiId", "kind"] as const
const UNICODE_EMOJI_KEYS = ["kind", "unicode"] as const
const LOCAL_LIMITS = Object.freeze({
  channelDescriptionCharacters: WELCOME_SCREEN_LIMITS.channelDescriptionCharacters,
  channels: WELCOME_SCREEN_LIMITS.channels,
  descriptionCharacters: WELCOME_SCREEN_LIMITS.descriptionCharacters,
})

type WelcomeScreenTargetOutcome = "settled" | "uncertain"
const WELCOME_SCREEN_GUILD_LOCKS = new Map<
  string,
  Promise<WelcomeScreenTargetOutcome>
>()

export type WelcomeScreenEmojiRequest =
  | { emojiId: string; kind: "custom" }
  | { kind: "none" }
  | { kind: "unicode"; unicode: string }

export interface WelcomeScreenChannelRequest {
  channelId: string
  description: string
  emoji: WelcomeScreenEmojiRequest
}

export interface WelcomeScreenChangeRequest {
  auditReason: string
  channels: readonly WelcomeScreenChannelRequest[]
  description: string | null
  enabled: boolean
  guildId: string
  operationKey: string
}

export interface NormalizedWelcomeScreenChangeRequest {
  auditReason: string
  channels: WelcomeScreenChannelRequest[]
  description: string | null
  enabled: boolean
  guildId: string
  operationKeyHash: string
}

export interface WelcomeScreenAccessEvidence {
  appliedRoleIds: string[]
  authorizedForChange: boolean
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageGuild: boolean
  requiredChangePermission: "MANAGE_GUILD"
  unknownPermissionBits: string
  warnings: string[]
}

export interface WelcomeScreenChannelReferenceView {
  channelId: string
  direct: boolean
  everyoneCanView: boolean | null
  exists: boolean
  parentId: string | null
  type: number | null
}

export interface WelcomeScreenEmojiView {
  animated: boolean | null
  available: boolean | null
  customEmojiId: string | null
  healthy: boolean
  kind: "custom" | "none" | "unicode"
  restrictedRoleIds: string[]
  unicode: string | null
}

export interface WelcomeScreenChannelView {
  channel: WelcomeScreenChannelReferenceView
  description: string | null
  descriptionCharacters: number
  emoji: WelcomeScreenEmojiView
}

export interface WelcomeScreenConfigurationView {
  available: boolean
  channels: WelcomeScreenChannelView[]
  communityGuild: boolean
  description: string | null
  descriptionCharacters: number | null
  enabled: boolean
  issues: string[]
  replacementBlockedReasons: string[]
  textIncluded: boolean
  unknownFieldCount: number
}

export interface WelcomeScreenPrivacyProjection {
  persistence: "none"
  rawPayloads: "omitted"
  text: "included" | "omitted"
  unknownFields: "counts-only"
}

export interface WelcomeScreenAuditResult {
  access: WelcomeScreenAccessEvidence
  applicationId: string
  botId: string
  configuration: WelcomeScreenConfigurationView
  guild: { id: string; name: string }
  localLimits: typeof LOCAL_LIMITS
  privacy: WelcomeScreenPrivacyProjection
  schemaVersion: number
  status: "ok"
  verificationBoundary: {
    apiReadback: true
    freshNonStaffClientCheckRecommended: boolean
    memberExperienceVerified: false
  }
}

export interface WelcomeScreenChangeDiff {
  channelEntriesAdded: number
  channelEntriesModified: number
  channelEntriesMoved: number
  channelEntriesRemoved: number
  descriptionChanged: boolean
  emojiChanges: number
  enabledChanged: boolean
  textChanges: number
}

export interface WelcomeScreenChangePlan {
  access: WelcomeScreenAccessEvidence
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  current: WelcomeScreenConfigurationView
  desired: WelcomeScreenConfigurationView
  diff: WelcomeScreenChangeDiff
  digest: string
  guild: { id: string; name: string }
  localLimits: typeof LOCAL_LIMITS
  operationKeyHash: string
  privacy: WelcomeScreenPrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verificationBoundary: WelcomeScreenAuditResult["verificationBoundary"]
  warnings: string[]
  writeRequired: boolean
}

export interface WelcomeScreenChangeResult {
  activityId: string | null
  guildId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
}

export interface WelcomeScreenServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "getGuildWelcomeScreen"
  | "listGuildEmojis"
  | "modifyGuildWelcomeScreen"
> {}

export interface WelcomeScreenServiceOptions {
  activityStore: ActivityStore
  client: WelcomeScreenServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    "assertGuildWelcomeScreenAuditable" | "assertGuildWelcomeScreenChangeable"
  >
  randomId?: () => string
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

interface WelcomeScreenState {
  access: WelcomeScreenAccessEvidence
  botMember: DiscordGuildMember
  channels: ValidatedChannel[]
  configuration: WelcomeScreenConfigurationView
  emojis: DiscordGuildEmojiSummary[]
  guild: DiscordGuild & { features: string[]; owner_id: string }
  priorReceipt: OperationReceipt | null
  roles: ValidatedRole[]
  screen: DiscordGuildWelcomeScreen | null
}

interface BuiltWelcomeScreenPlan {
  desired: NormalizedWelcomeScreenChangeRequest
  plan: WelcomeScreenChangePlan
  state: WelcomeScreenState & { screen: DiscordGuildWelcomeScreen }
}

function evidenceError(
  message: string,
  options?: ErrorOptions,
): WelcomeScreenEvidenceError {
  return new WelcomeScreenEvidenceError(message, options)
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

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function validText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string"
    && (allowEmpty || value.length > 0)
    && [...value].length <= maximum
    && (value.length === 0 || value.trim() === value)
    && value.normalize("NFC") === value
    && !TEXT_CONTROL_PATTERN.test(value)
    && validUnicode(value)
}

function assertInputText(
  value: unknown,
  maximum: number,
  name: string,
): asserts value is string {
  if (!validText(value, maximum)) throw new RangeError(`${name} is invalid`)
}

export function isWelcomeScreenUnicodeEmoji(value: string): boolean {
  if (!validText(value, CONNECTOR_LIMITS.interactionEmojiCharacters)) return false
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
  return segments.length === 1
    && segments[0]?.segment === value
    && EMOJI_PATTERN.test(value)
}

function normalizeEmoji(value: unknown): WelcomeScreenEmojiRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord Welcome Screen emoji must be an exact object")
  }
  const record = value as Record<string, unknown>
  if (record.kind === "none") {
    if (!onlyKeys(record, NONE_EMOJI_KEYS)) {
      throw new RangeError("Discord Welcome Screen empty emoji fields are invalid")
    }
    return { kind: "none" }
  }
  if (record.kind === "custom") {
    if (!onlyKeys(record, CUSTOM_EMOJI_KEYS)) {
      throw new RangeError("Discord Welcome Screen custom emoji fields are invalid")
    }
    assertPositiveSnowflake(record.emojiId, "Discord Welcome Screen custom emoji ID")
    return { emojiId: record.emojiId, kind: "custom" }
  }
  if (
    record.kind === "unicode"
    && onlyKeys(record, UNICODE_EMOJI_KEYS)
    && typeof record.unicode === "string"
    && isWelcomeScreenUnicodeEmoji(record.unicode)
  ) {
    return { kind: "unicode", unicode: record.unicode }
  }
  throw new RangeError("Discord Welcome Screen Unicode emoji must be one emoji grapheme")
}

export function assertWelcomeScreenGetInput(guildId: string, includeText: boolean): void {
  assertPositiveSnowflake(guildId, "Discord Welcome Screen guild ID")
  if (typeof includeText !== "boolean") {
    throw new RangeError("Discord Welcome Screen includeText must be a boolean")
  }
}

export function normalizeWelcomeScreenChangeRequest(
  request: WelcomeScreenChangeRequest,
): NormalizedWelcomeScreenChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord Welcome Screen change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, REQUEST_KEYS)
    || typeof request.enabled !== "boolean"
    || !(request.description === null || typeof request.description === "string")
    || !Array.isArray(request.channels)
    || request.channels.length > WELCOME_SCREEN_LIMITS.channels
  ) {
    throw new RangeError("Discord Welcome Screen change request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord Welcome Screen guild ID")
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord Welcome Screen audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  if (request.description !== null) {
    assertInputText(
      request.description,
      WELCOME_SCREEN_LIMITS.descriptionCharacters,
      "Discord Welcome Screen description",
    )
  }
  const channelIds = new Set<string>()
  const channels = request.channels.map((channel) => {
    if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
      throw new RangeError("Discord Welcome Screen channel must be an exact object")
    }
    const channelRecord = channel as unknown as Record<string, unknown>
    if (!onlyKeys(channelRecord, CHANNEL_REQUEST_KEYS)) {
      throw new RangeError("Discord Welcome Screen channel fields are invalid")
    }
    assertPositiveSnowflake(channel.channelId, "Discord Welcome Screen channel ID")
    if (channelIds.has(channel.channelId)) {
      throw new RangeError("Discord Welcome Screen channel IDs must be unique")
    }
    channelIds.add(channel.channelId)
    assertInputText(
      channel.description,
      WELCOME_SCREEN_LIMITS.channelDescriptionCharacters,
      "Discord Welcome Screen channel description",
    )
    return {
      channelId: channel.channelId,
      description: channel.description,
      emoji: normalizeEmoji(channel.emoji),
    }
  })
  return {
    auditReason: request.auditReason,
    channels,
    description: request.description,
    enabled: request.enabled,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function exactGuild(
  value: DiscordGuild,
  guildId: string,
): DiscordGuild & { features: string[]; owner_id: string } {
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
    throw evidenceError("Discord returned incomplete or mismatched Welcome Screen guild evidence")
  }
  return value as DiscordGuild & { features: string[]; owner_id: string }
}

function exactBotMember(
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
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw evidenceError("Discord returned incomplete or mismatched Welcome Screen bot evidence")
  }
  return value
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded Welcome Screen role inventory")
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
      throw evidenceError("Discord returned invalid or duplicate Welcome Screen role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid Welcome Screen role permissions", {
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
    throw evidenceError("Discord returned invalid Welcome Screen @everyone role evidence")
  }
  return roles.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactOverwrites(
  value: unknown,
  roleIds: ReadonlySet<string>,
): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord returned incomplete Welcome Screen channel overwrite evidence")
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw evidenceError("Discord returned invalid Welcome Screen channel overwrite evidence")
    }
    const overwrite = entry as DiscordPermissionOverwrite
    if (
      !positiveSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || (overwrite.type === 0 && !roleIds.has(overwrite.id))
      || seen.has(`${overwrite.type}:${overwrite.id}`)
    ) {
      throw evidenceError("Discord returned contradictory Welcome Screen channel overwrites")
    }
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(overwrite.allow ?? "0", "Welcome Screen overwrite allow")
      deny = parseDiscordPermissionBits(overwrite.deny ?? "0", "Welcome Screen overwrite deny")
    } catch (error) {
      throw evidenceError("Discord returned invalid Welcome Screen overwrite bits", {
        cause: error,
      })
    }
    if ((allow & deny) !== 0n) {
      throw evidenceError("Discord returned overlapping Welcome Screen overwrite bits")
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
    throw evidenceError("Discord returned an invalid bounded Welcome Screen channel inventory")
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
      || ids.has(channel.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate Welcome Screen channel evidence")
    }
    ids.add(channel.id)
    return {
      ...channel,
      guild_id: guildId,
      name: channel.name,
      parent_id: channel.parent_id ?? null,
      permission_overwrites: exactOverwrites(channel.permission_overwrites, roleIds),
    } as ValidatedChannel
  })
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]))
  for (const channel of channels) {
    if (channel.type === DISCORD_CHANNEL_TYPES.category && channel.parent_id !== null) {
      throw evidenceError("Discord returned a parented Welcome Screen category")
    }
    if (channel.parent_id !== null) {
      const parent = channelsById.get(channel.parent_id)
      if (!parent || parent.type !== DISCORD_CHANNEL_TYPES.category) {
        throw evidenceError("Discord returned incomplete Welcome Screen channel hierarchy evidence")
      }
    }
  }
  return channels.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactEmojis(
  value: readonly DiscordGuildEmojiSummary[],
  roles: readonly ValidatedRole[],
): DiscordGuildEmojiSummary[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildEmojis) {
    throw evidenceError("Discord returned an invalid bounded Welcome Screen emoji inventory")
  }
  const roleIds = new Set(roles.map((role) => role.id))
  const ids = new Set<string>()
  return value.map((emoji) => {
    const rawRoleIds: unknown = emoji?.roleIds
    if (
      !emoji
      || typeof emoji !== "object"
      || Array.isArray(emoji)
      || !positiveSnowflake(emoji.id)
      || !validText(emoji.name, DISCORD_LIMITS.emojiNameCharacters)
      || typeof emoji.animated !== "boolean"
      || typeof emoji.available !== "boolean"
      || typeof emoji.managed !== "boolean"
      || !(emoji.creatorUserId === null || positiveSnowflake(emoji.creatorUserId))
      || typeof emoji.requiresColons !== "boolean"
      || !Array.isArray(rawRoleIds)
      || rawRoleIds.length > DISCORD_LIMITS.guildRoles
      || rawRoleIds.some((roleId: unknown) => (
        !positiveSnowflake(roleId) || !roleIds.has(roleId)
      ))
      || new Set(rawRoleIds).size !== rawRoleIds.length
      || ids.has(emoji.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate Welcome Screen emoji evidence")
    }
    ids.add(emoji.id)
    const exactRoleIds = rawRoleIds as string[]
    return {
      ...emoji,
      roleIds: [...exactRoleIds].sort(compareSnowflakes),
    }
  }).sort((left, right) => compareSnowflakes(left.id, right.id))
}

function completePermissions(
  member: DiscordGuildMember,
  guildId: string,
  roles: readonly ValidatedRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError("Discord returned invalid Welcome Screen permission evidence", {
      cause: error,
    })
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete Welcome Screen permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): WelcomeScreenAccessEvidence {
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
    requiredChangePermission: "MANAGE_GUILD",
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(permissions.effectivePermissions),
    ).toString(),
    warnings: permissions.warnings,
  }
}

function everyoneCanView(
  channel: ValidatedChannel,
  guild: DiscordGuild & { owner_id: string },
  roles: readonly ValidatedRole[],
): boolean {
  let result: ReturnType<typeof evaluatePrincipalPermissions>
  try {
    result = evaluatePrincipalPermissions({
      channel,
      guildId: guild.id,
      guildOwnerId: guild.owner_id,
      permissionChannel: channel,
      requestedPermissions: ["VIEW_CHANNEL"],
      roles,
      subject: { id: guild.id, kind: "role" },
    })
  } catch (error) {
    throw evidenceError("Discord returned invalid Welcome Screen channel permission evidence", {
      cause: error,
    })
  }
  if (result.confidence !== "complete") {
    throw evidenceError("Discord returned incomplete Welcome Screen channel permission evidence")
  }
  return !result.missingPermissions.includes("VIEW_CHANNEL")
    && !result.ineffectivePermissions.includes("VIEW_CHANNEL")
}

function channelReferenceView(
  channelId: string,
  channelsById: ReadonlyMap<string, ValidatedChannel>,
  guild: DiscordGuild & { owner_id: string },
  roles: readonly ValidatedRole[],
): WelcomeScreenChannelReferenceView {
  const channel = channelsById.get(channelId)
  if (!channel) {
    return {
      channelId,
      direct: false,
      everyoneCanView: null,
      exists: false,
      parentId: null,
      type: null,
    }
  }
  const direct = SUPPORTED_WELCOME_CHANNEL_TYPES.has(channel.type)
  return {
    channelId,
    direct,
    everyoneCanView: direct ? everyoneCanView(channel, guild, roles) : null,
    exists: true,
    parentId: channel.parent_id,
    type: channel.type,
  }
}

function remoteEmojiView(
  emojiId: string | null,
  emojiName: string | null,
  emojisById: ReadonlyMap<string, DiscordGuildEmojiSummary>,
  includeText: boolean,
): WelcomeScreenEmojiView {
  if (emojiId !== null) {
    const emoji = emojisById.get(emojiId)
    return {
      animated: emoji?.animated ?? null,
      available: emoji?.available ?? null,
      customEmojiId: emojiId,
      healthy: Boolean(emoji && emoji.available && emoji.name === emojiName),
      kind: "custom",
      restrictedRoleIds: emoji?.roleIds ?? [],
      unicode: null,
    }
  }
  if (emojiName !== null) {
    return {
      animated: false,
      available: true,
      customEmojiId: null,
      healthy: isWelcomeScreenUnicodeEmoji(emojiName),
      kind: "unicode",
      restrictedRoleIds: [],
      unicode: includeText ? emojiName : null,
    }
  }
  return {
    animated: null,
    available: null,
    customEmojiId: null,
    healthy: true,
    kind: "none",
    restrictedRoleIds: [],
    unicode: null,
  }
}

function desiredEmojiView(
  emoji: WelcomeScreenEmojiRequest,
  emojisById: ReadonlyMap<string, DiscordGuildEmojiSummary>,
): WelcomeScreenEmojiView {
  if (emoji.kind === "custom") {
    const inventory = emojisById.get(emoji.emojiId)
    return {
      animated: inventory?.animated ?? null,
      available: inventory?.available ?? null,
      customEmojiId: emoji.emojiId,
      healthy: Boolean(inventory?.available),
      kind: "custom",
      restrictedRoleIds: inventory?.roleIds ?? [],
      unicode: null,
    }
  }
  if (emoji.kind === "unicode") {
    return {
      animated: false,
      available: true,
      customEmojiId: null,
      healthy: isWelcomeScreenUnicodeEmoji(emoji.unicode),
      kind: "unicode",
      restrictedRoleIds: [],
      unicode: emoji.unicode,
    }
  }
  return {
    animated: null,
    available: null,
    customEmojiId: null,
    healthy: true,
    kind: "none",
    restrictedRoleIds: [],
    unicode: null,
  }
}

function privacyProjection(includeText: boolean): WelcomeScreenPrivacyProjection {
  return {
    persistence: "none",
    rawPayloads: "omitted",
    text: includeText ? "included" : "omitted",
    unknownFields: "counts-only",
  }
}

function unavailableConfiguration(
  guild: DiscordGuild & { features: string[] },
  includeText: boolean,
  reason: string,
): WelcomeScreenConfigurationView {
  return {
    available: false,
    channels: [],
    communityGuild: guild.features.includes(COMMUNITY_GUILD_FEATURE),
    description: null,
    descriptionCharacters: null,
    enabled: guild.features.includes(WELCOME_SCREEN_ENABLED_GUILD_FEATURE),
    issues: [reason],
    replacementBlockedReasons: ["screen-unavailable"],
    textIncluded: includeText,
    unknownFieldCount: 0,
  }
}

function remoteConfigurationView(
  screen: DiscordGuildWelcomeScreen,
  guild: DiscordGuild & { features: string[]; owner_id: string },
  roles: readonly ValidatedRole[],
  channels: readonly ValidatedChannel[],
  emojis: readonly DiscordGuildEmojiSummary[],
  includeText: boolean,
): WelcomeScreenConfigurationView {
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]))
  const emojisById = new Map(emojis.map((emoji) => [emoji.id, emoji]))
  const issues: string[] = []
  const replacementBlockedReasons: string[] = []
  let unknownFieldCount = screen.unknownFieldCount
  if (screen.unknownFieldCount > 0) {
    issues.push("unknown-fields")
    replacementBlockedReasons.push("unknown-fields")
  }
  const projectedChannels = screen.welcomeChannels.map((entry) => {
    unknownFieldCount += entry.unknownFieldCount
    if (entry.unknownFieldCount > 0) {
      issues.push(`unknown-channel-fields:${entry.channelId}`)
      replacementBlockedReasons.push("unknown-fields")
    }
    const channel = channelReferenceView(entry.channelId, channelsById, guild, roles)
    const emoji = remoteEmojiView(entry.emojiId, entry.emojiName, emojisById, includeText)
    if (!channel.exists) issues.push(`missing-channel:${entry.channelId}`)
    if (channel.exists && !channel.direct) issues.push(`unsupported-channel:${entry.channelId}`)
    if (channel.direct && channel.everyoneCanView !== true) {
      issues.push(`non-public-channel:${entry.channelId}`)
    }
    if (!emoji.healthy) issues.push(`unhealthy-emoji:${entry.channelId}`)
    if (emoji.restrictedRoleIds.length > 0) {
      issues.push(`role-restricted-emoji:${entry.channelId}`)
    }
    return {
      channel,
      description: includeText ? entry.description : null,
      descriptionCharacters: [...entry.description].length,
      emoji,
    }
  })
  return {
    available: true,
    channels: projectedChannels,
    communityGuild: guild.features.includes(COMMUNITY_GUILD_FEATURE),
    description: includeText ? screen.description : null,
    descriptionCharacters: screen.description === null
      ? null
      : [...screen.description].length,
    enabled: guild.features.includes(WELCOME_SCREEN_ENABLED_GUILD_FEATURE),
    issues: [...new Set(issues)].sort(),
    replacementBlockedReasons: [...new Set(replacementBlockedReasons)].sort(),
    textIncluded: includeText,
    unknownFieldCount,
  }
}

function desiredConfigurationView(
  desired: NormalizedWelcomeScreenChangeRequest,
  state: WelcomeScreenState,
): WelcomeScreenConfigurationView {
  const channelsById = new Map(state.channels.map((channel) => [channel.id, channel]))
  const emojisById = new Map(state.emojis.map((emoji) => [emoji.id, emoji]))
  return {
    available: true,
    channels: desired.channels.map((entry) => ({
      channel: channelReferenceView(
        entry.channelId,
        channelsById,
        state.guild,
        state.roles,
      ),
      description: entry.description,
      descriptionCharacters: [...entry.description].length,
      emoji: desiredEmojiView(entry.emoji, emojisById),
    })),
    communityGuild: state.guild.features.includes(COMMUNITY_GUILD_FEATURE),
    description: desired.description,
    descriptionCharacters: desired.description === null
      ? null
      : [...desired.description].length,
    enabled: desired.enabled,
    issues: [],
    replacementBlockedReasons: [],
    textIncluded: true,
    unknownFieldCount: 0,
  }
}

function assertDesiredStateSafe(
  state: WelcomeScreenState & { screen: DiscordGuildWelcomeScreen },
  desiredView: WelcomeScreenConfigurationView,
): void {
  if (!state.access.authorizedForChange) {
    throw evidenceError("Discord connector bot lacks complete Welcome Screen change authority")
  }
  if (!state.guild.features.includes(COMMUNITY_GUILD_FEATURE)) {
    throw evidenceError("Discord Welcome Screen changes require the COMMUNITY guild feature")
  }
  if (state.configuration.replacementBlockedReasons.length > 0) {
    throw evidenceError(
      "Discord Welcome Screen contains unknown state that blocks complete replacement",
    )
  }
  for (const entry of desiredView.channels) {
    if (
      !entry.channel.exists
      || !entry.channel.direct
      || entry.channel.everyoneCanView !== true
    ) {
      throw evidenceError(
        "Discord Welcome Screen channels must be supported and visible to @everyone",
      )
    }
    if (!entry.emoji.healthy) {
      throw evidenceError("Discord Welcome Screen emoji evidence is unavailable or unsafe")
    }
    if (entry.emoji.restrictedRoleIds.length > 0) {
      throw evidenceError("Discord Welcome Screen custom emojis must be visible to @everyone")
    }
  }
}

function screenAuthoritative(screen: DiscordGuildWelcomeScreen): boolean {
  return screen.unknownFieldCount === 0
    && screen.welcomeChannels.every((entry) => entry.unknownFieldCount === 0)
}

function remoteEmojiMatchesDesired(
  emojiId: string | null,
  emojiName: string | null,
  desired: WelcomeScreenEmojiRequest,
): boolean {
  if (desired.kind === "none") return emojiId === null && emojiName === null
  if (desired.kind === "custom") return emojiId === desired.emojiId
  return emojiId === null && emojiName === desired.unicode
}

function screenSemanticallyMatches(
  screen: DiscordGuildWelcomeScreen,
  enabled: boolean,
  desired: NormalizedWelcomeScreenChangeRequest,
): boolean {
  if (
    !screenAuthoritative(screen)
    || enabled !== desired.enabled
    || screen.description !== desired.description
    || screen.welcomeChannels.length !== desired.channels.length
  ) {
    return false
  }
  return desired.channels.every((expected, index) => {
    const observed = screen.welcomeChannels[index]
    return Boolean(
      observed
      && observed.channelId === expected.channelId
      && observed.description === expected.description
      && remoteEmojiMatchesDesired(observed.emojiId, observed.emojiName, expected.emoji),
    )
  })
}

function channelIdentity(entry: {
  channelId: string
  description: string
  emoji: WelcomeScreenEmojiRequest
}): string {
  return JSON.stringify(entry)
}

function remoteChannelIdentity(
  entry: DiscordGuildWelcomeScreen["welcomeChannels"][number],
): string {
  const emoji: WelcomeScreenEmojiRequest = entry.emojiId !== null
    ? { emojiId: entry.emojiId, kind: "custom" }
    : entry.emojiName !== null
      ? { kind: "unicode", unicode: entry.emojiName }
      : { kind: "none" }
  return channelIdentity({
    channelId: entry.channelId,
    description: entry.description,
    emoji,
  })
}

function changeDiff(
  current: DiscordGuildWelcomeScreen,
  currentEnabled: boolean,
  desired: NormalizedWelcomeScreenChangeRequest,
): WelcomeScreenChangeDiff {
  const currentByChannel = new Map(
    current.welcomeChannels.map((entry) => [entry.channelId, entry]),
  )
  const desiredByChannel = new Map(
    desired.channels.map((entry) => [entry.channelId, entry]),
  )
  let channelEntriesModified = 0
  let channelEntriesMoved = 0
  let emojiChanges = 0
  let textChanges = current.description === desired.description ? 0 : 1
  for (let index = 0; index < desired.channels.length; index += 1) {
    const entry = desired.channels[index]
    if (!entry) continue
    const observed = currentByChannel.get(entry.channelId)
    if (!observed) continue
    if (remoteChannelIdentity(observed) !== channelIdentity(entry)) {
      channelEntriesModified += 1
    }
    if (observed.description !== entry.description) textChanges += 1
    if (!remoteEmojiMatchesDesired(observed.emojiId, observed.emojiName, entry.emoji)) {
      emojiChanges += 1
    }
    if (current.welcomeChannels[index]?.channelId !== entry.channelId) {
      channelEntriesMoved += 1
    }
  }
  return {
    channelEntriesAdded: desired.channels.filter(
      (entry) => !currentByChannel.has(entry.channelId),
    ).length,
    channelEntriesModified,
    channelEntriesMoved,
    channelEntriesRemoved: current.welcomeChannels.filter(
      (entry) => !desiredByChannel.has(entry.channelId),
    ).length,
    descriptionChanged: current.description !== desired.description,
    emojiChanges,
    enabledChanged: currentEnabled !== desired.enabled,
    textChanges,
  }
}

function planRisks(
  diff: WelcomeScreenChangeDiff,
  desired: NormalizedWelcomeScreenChangeRequest,
): string[] {
  const risks = [
    "The write replaces the complete Welcome Screen configuration",
    "The operation is intentionally not retried after the PATCH begins",
  ]
  if (diff.enabledChanged) {
    risks.push(desired.enabled
      ? "The Welcome Screen will become visible to joining members"
      : "The Welcome Screen will be disabled for joining members")
  }
  if (diff.channelEntriesRemoved > 0) {
    risks.push("One or more existing Welcome Screen channel entries will be removed")
  }
  return risks
}

function planWarnings(access: WelcomeScreenAccessEvidence): string[] {
  return [
    ...access.warnings,
    "API readback cannot prove the final non-staff member experience",
  ]
}

function transportInput(
  desired: NormalizedWelcomeScreenChangeRequest,
  state: WelcomeScreenState,
): ModifyGuildWelcomeScreenInput {
  const emojisById = new Map(state.emojis.map((emoji) => [emoji.id, emoji]))
  return {
    description: desired.description,
    enabled: desired.enabled,
    welcomeChannels: desired.channels.map((entry) => {
      if (entry.emoji.kind === "custom") {
        const emoji = emojisById.get(entry.emoji.emojiId)
        if (!emoji) {
          throw evidenceError("Discord Welcome Screen custom emoji evidence disappeared")
        }
        return {
          channelId: entry.channelId,
          description: entry.description,
          emojiId: emoji.id,
          emojiName: emoji.name,
        }
      }
      return {
        channelId: entry.channelId,
        description: entry.description,
        emojiId: null,
        emojiName: entry.emoji.kind === "unicode" ? entry.emoji.unicode : null,
      }
    }),
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
  plan: WelcomeScreenChangePlan
  request: NormalizedWelcomeScreenChangeRequest
  status: WelcomeScreenActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): WelcomeScreenActivity {
  return {
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "welcome-screen-change",
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
  plan: WelcomeScreenChangePlan
  request: NormalizedWelcomeScreenChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "welcome-screen-change",
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
    !(error instanceof WelcomeScreenExecutionError)
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
  priorUncertainError: () => WelcomeScreenExecutionError,
): Promise<T> {
  const prior = WELCOME_SCREEN_GUILD_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: WelcomeScreenTargetOutcome) => void = () => undefined
  const tail = new Promise<WelcomeScreenTargetOutcome>((resolve) => {
    release = resolve
  })
  WELCOME_SCREEN_GUILD_LOCKS.set(guildId, tail)
  let outcome: WelcomeScreenTargetOutcome = "settled"
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
      && WELCOME_SCREEN_GUILD_LOCKS.get(guildId) === tail
    ) {
      WELCOME_SCREEN_GUILD_LOCKS.delete(guildId)
    }
  }
}

export class WelcomeScreenService {
  readonly #activityStore: ActivityStore
  readonly #client: WelcomeScreenServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: WelcomeScreenServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: WelcomeScreenServiceOptions) {
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
    includeText: boolean,
    options: RequestOptions,
    operationKeyHashValue?: string,
    allowCompletedReceipt = false,
  ): Promise<WelcomeScreenState> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord Welcome Screen guild ID")
    if (mode === "change") {
      this.#policy.assertGuildWelcomeScreenChangeable(guildId)
    } else {
      this.#policy.assertGuildWelcomeScreenAuditable(guildId)
    }
    let priorReceipt: OperationReceipt | null = null
    if (operationKeyHashValue) {
      priorReceipt = await this.#operationStore.get(
        "welcome-screen-change",
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
        throw new WelcomeScreenOperationConflictError(receiptView(priorReceipt))
      }
    }
    const [rawGuild, rawBotMember, rawRoles, rawChannels, rawEmojis] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getGuildChannels(guildId, options),
      this.#client.listGuildEmojis(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawBotMember, guildId, botId)
    const roles = exactRoles(rawRoles, guildId)
    const channels = exactChannels(rawChannels, guildId, roles)
    const emojis = exactEmojis(rawEmojis, roles)
    const permissions = completePermissions(botMember, guildId, roles)
    const access = accessEvidence(permissions, guild.owner_id === botId)
    const communityGuild = guild.features.includes(COMMUNITY_GUILD_FEATURE)
    const enabled = guild.features.includes(WELCOME_SCREEN_ENABLED_GUILD_FEATURE)
    if (mode === "change" && !access.authorizedForChange) {
      throw evidenceError(
        "Discord connector bot requires guild ownership or complete MANAGE_GUILD authority",
      )
    }
    if (mode === "change" && !communityGuild) {
      throw evidenceError("Discord Welcome Screen changes require the COMMUNITY guild feature")
    }
    let screen: DiscordGuildWelcomeScreen | null = null
    let unavailableReason = "community-feature-absent"
    if (communityGuild && (enabled || access.authorizedForChange)) {
      const observed = await this.#client.getGuildWelcomeScreen(guildId, options)
      if (observed === null && enabled) {
        throw evidenceError("Discord returned no enabled Welcome Screen evidence")
      }
      screen = observed ?? {
        description: null,
        unknownFieldCount: 0,
        welcomeChannels: [],
      }
    } else if (communityGuild) {
      unavailableReason = "disabled-screen-requires-manage-guild"
    }
    const configuration = screen
      ? remoteConfigurationView(screen, guild, roles, channels, emojis, includeText)
      : unavailableConfiguration(guild, includeText, unavailableReason)
    return {
      access,
      botMember,
      channels,
      configuration,
      emojis,
      guild,
      priorReceipt,
      roles,
      screen,
    }
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    includeText = false,
    options: RequestOptions = {},
  ): Promise<WelcomeScreenAuditResult> {
    assertWelcomeScreenGetInput(guildId, includeText)
    const state = await this.#state(
      applicationId,
      botId,
      guildId,
      "audit",
      includeText,
      options,
    )
    return {
      access: state.access,
      applicationId,
      botId,
      configuration: state.configuration,
      guild: { id: state.guild.id, name: state.guild.name },
      localLimits: LOCAL_LIMITS,
      privacy: privacyProjection(includeText),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      verificationBoundary: {
        apiReadback: true,
        freshNonStaffClientCheckRecommended: state.configuration.enabled,
        memberExperienceVerified: false,
      },
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    desired: NormalizedWelcomeScreenChangeRequest,
    options: RequestOptions,
    allowCompletedReceipt = false,
  ): Promise<BuiltWelcomeScreenPlan> {
    const state = await this.#state(
      applicationId,
      botId,
      desired.guildId,
      "change",
      true,
      options,
      desired.operationKeyHash,
      allowCompletedReceipt,
    )
    if (!state.screen) {
      throw evidenceError("Discord Welcome Screen state is unavailable for replacement")
    }
    const exactState = state as WelcomeScreenState & { screen: DiscordGuildWelcomeScreen }
    const desiredView = desiredConfigurationView(desired, exactState)
    assertDesiredStateSafe(exactState, desiredView)
    const currentEnabled = exactState.guild.features.includes(
      WELCOME_SCREEN_ENABLED_GUILD_FEATURE,
    )
    const writeRequired = !screenSemanticallyMatches(
      exactState.screen,
      currentEnabled,
      desired,
    )
    const diff = changeDiff(exactState.screen, currentEnabled, desired)
    const privacy = privacyProjection(true)
    const warnings = writeRequired
      ? planWarnings(exactState.access)
      : ["The complete desired Welcome Screen already matches Discord"]
    const risks = writeRequired ? planRisks(diff, desired) : []
    const verificationBoundary = {
      apiReadback: true as const,
      freshNonStaffClientCheckRecommended: desired.enabled,
      memberExperienceVerified: false as const,
    }
    const evidence = {
      access: exactState.access,
      botMemberRoleIds: [...exactState.botMember.roles].sort(compareSnowflakes),
      channels: exactState.channels.map((channel) => ({
        id: channel.id,
        parentId: channel.parent_id,
        permissionOverwrites: channel.permission_overwrites,
        type: channel.type,
      })),
      emojis: exactState.emojis.map((emoji) => ({
        animated: emoji.animated,
        available: emoji.available,
        id: emoji.id,
        managed: emoji.managed,
        name: emoji.name,
        roleIds: emoji.roleIds,
      })),
      guild: {
        features: [...exactState.guild.features].sort(),
        id: exactState.guild.id,
        name: exactState.guild.name,
        ownerId: exactState.guild.owner_id,
      },
      screen: exactState.screen,
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      desired,
      domain: "discord-mcp-welcome-screen-change-plan.v1",
      evidence,
      localLimits: LOCAL_LIMITS,
      privacy,
      risks,
      verificationBoundary,
      warnings,
    })
    const plan: WelcomeScreenChangePlan = {
      access: exactState.access,
      applicationId,
      auditReason: desired.auditReason,
      botId,
      createdAt: this.#clock().toISOString(),
      current: exactState.configuration,
      desired: desiredView,
      diff,
      digest,
      guild: { id: exactState.guild.id, name: exactState.guild.name },
      localLimits: LOCAL_LIMITS,
      operationKeyHash: desired.operationKeyHash,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: writeRequired ? "planned" : "already-current",
      verificationBoundary,
      warnings,
      writeRequired,
    }
    if (state.priorReceipt && plan.writeRequired) {
      throw new WelcomeScreenOperationConflictError(
        receiptView(state.priorReceipt),
      )
    }
    return { desired, plan, state: exactState }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: WelcomeScreenChangeRequest,
    options: RequestOptions = {},
  ): Promise<WelcomeScreenChangePlan> {
    const desired = normalizeWelcomeScreenChangeRequest(request)
    return (await this.#buildPlan(applicationId, botId, desired, options)).plan
  }

  async reconcilePlan(
    applicationId: string,
    botId: string,
    request: WelcomeScreenChangeRequest,
    options: RequestOptions = {},
  ): Promise<WelcomeScreenChangePlan> {
    const desired = normalizeWelcomeScreenChangeRequest(request)
    return (
      await this.#buildPlan(applicationId, botId, desired, options, true)
    ).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: WelcomeScreenChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<WelcomeScreenChangeResult> {
    const desired = normalizeWelcomeScreenChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord Welcome Screen plan digest is invalid")
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
      () => new WelcomeScreenExecutionError(
        "Discord Welcome Screen change was blocked because a prior same-guild operation ended without a durable outcome",
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
    desired: NormalizedWelcomeScreenChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<WelcomeScreenChangeResult> {
    let built: BuiltWelcomeScreenPlan
    try {
      built = await this.#buildPlan(applicationId, botId, desired, options)
    } catch (error) {
      if (
        error instanceof WelcomeScreenEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new WelcomeScreenPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new WelcomeScreenPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      guildId: desired.guildId,
      operationKeyHash: desired.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
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
      throw new WelcomeScreenOperationConflictError(receiptView(reservation.receipt))
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
      throw new WelcomeScreenExecutionError(
        "Discord Welcome Screen change was blocked because pending activity could not be recorded",
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
      const input = transportInput(desired, state)
      mutationStarted = true
      const response = await this.#client.modifyGuildWelcomeScreen(
        desired.guildId,
        input,
        desired.auditReason,
        options,
      )
      mutationReturned = true
      if (!screenAuthoritative(response)) {
        throw evidenceError("Discord returned ambiguous Welcome Screen mutation evidence")
      }
      responseMatches = screenSemanticallyMatches(response, desired.enabled, desired)
      const readback = await this.#state(
        applicationId,
        botId,
        desired.guildId,
        "audit",
        true,
        options,
      )
      if (!readback.screen) {
        throw evidenceError("Discord Welcome Screen readback was unavailable")
      }
      const exactReadback = readback as WelcomeScreenState & {
        screen: DiscordGuildWelcomeScreen
      }
      if (!screenAuthoritative(exactReadback.screen)) {
        throw evidenceError("Discord returned ambiguous Welcome Screen readback evidence")
      }
      assertDesiredStateSafe(
        exactReadback,
        desiredConfigurationView(desired, exactReadback),
      )
      readbackMatches = screenSemanticallyMatches(
        exactReadback.screen,
        exactReadback.guild.features.includes(WELCOME_SCREEN_ENABLED_GUILD_FEATURE),
        desired,
      )
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
      throw new WelcomeScreenExecutionError(
        "Discord Welcome Screen change did not complete with a verified successful outcome",
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
    const result: WelcomeScreenChangeResult = {
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
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new WelcomeScreenExecutionError(
        "Discord Welcome Screen change completed but the operation receipt failed",
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
      throw new WelcomeScreenExecutionError(
        "Discord Welcome Screen change completed but the final activity record failed",
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
