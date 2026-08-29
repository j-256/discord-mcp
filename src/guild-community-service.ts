import { createHash, randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GuildCommunityActivity,
  GuildCommunityActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_COMMUNITY_CHANGE_FIELDS,
  SCHEMA_VERSION,
  type GuildCommunityChangeField,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type ModifyGuildCommunityInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  GuildCommunityEvidenceError,
  GuildCommunityExecutionError,
  GuildCommunityOperationConflictError,
  GuildCommunityPlanChangedError,
} from "./errors.js"
import type { GatewayChannelLayoutSource } from "./gateway-channel-layout.js"
import {
  collectGuildChannelEvidence,
  GuildChannelEvidenceError,
  type GuildChannelEvidence,
  type GuildChannelEvidenceView,
} from "./guild-channel-evidence.js"
import { stableString } from "./normalize.js"
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

const STATE_UNAVAILABLE = "guild-community-state-unavailable"
const COMMUNITY_FEATURE = "COMMUNITY"
const GUILD_FEATURE_PATTERN = /^[A-Z0-9_]+$/u
const HASH_PREFIX = "sha256:"
const REQUEST_KEYS = [
  "acknowledgeCommunityEnablement",
  "auditReason",
  "guildId",
  "operationKey",
  "publicUpdatesChannelId",
  "rulesChannelId",
  "safetyAlertsChannelId",
] as const
const COMMUNITY_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.text,
])
const LOCAL_CONSTRAINTS = Object.freeze({
  channelTypes: [...COMMUNITY_CHANNEL_TYPES].sort((left, right) => left - right),
  communityDisablement: false,
  featureEditing: "add-community-only",
  guildAllowlist: CONNECTOR_LIMITS.guildCommunityGuildAllowlist,
  requiredAcknowledgement: true,
  rulesAndPublicUpdatesMustDiffer: true,
  supportedFields: [...GUILD_COMMUNITY_CHANGE_FIELDS],
})

type GuildCommunityTargetOutcome = "settled" | "uncertain"
const GUILD_COMMUNITY_LOCKS = new Map<string, Promise<GuildCommunityTargetOutcome>>()

export interface GuildCommunityChangeRequest {
  acknowledgeCommunityEnablement: true
  auditReason: string
  guildId: string
  operationKey: string
  publicUpdatesChannelId: string
  rulesChannelId: string
  safetyAlertsChannelId: string | null
}

export interface NormalizedGuildCommunityChangeRequest {
  acknowledgeCommunityEnablement: true
  auditReason: string
  guildId: string
  operationKeyHash: string
  publicUpdatesChannelId: string
  rulesChannelId: string
  safetyAlertsChannelId: string | null
}

export interface GuildCommunityAccessEvidence {
  appliedRoleIds: string[]
  authorizedForEnablement: boolean
  authorizedForRoutingChange: boolean
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  manageGuild: boolean
  unknownPermissionBitsPresent: false
  warnings: string[]
}

export interface GuildCommunityChannelReferenceView {
  channelId: string
  direct: true
  everyoneCanSend: boolean | null
  everyoneCanView: boolean | null
  exists: true
  parentId: string | null
  type: number
  unknownPermissionBitsPresent: false | null
}

export interface GuildCommunityConfigurationView {
  communityEnabled: boolean
  featureCount: number
  featureDigest: string
  issues: string[]
  publicUpdatesChannel: GuildCommunityChannelReferenceView | null
  publicUpdatesChannelId: string | null
  rulesChannel: GuildCommunityChannelReferenceView | null
  rulesChannelId: string | null
  safetyAlertsChannel: GuildCommunityChannelReferenceView | null
  safetyAlertsChannelId: string | null
  stateDigest: string
}

export interface GuildCommunityPrivacyProjection {
  auditReasons: "not-persisted"
  channelNamesAndTopics: "omitted"
  featureValues: "digests-only"
  guildPresentation: "omitted"
  memberProfiles: "omitted"
  persistence: "content-free-identifiers-and-digests-only"
  rawPayloads: "omitted"
  roleNames: "omitted"
}

export interface GuildCommunityVerificationBoundary {
  automaticRetry: false
  featureRemoval: false
  freshApiReadback: true
  gatewayLayoutContinuity: true
  mutationResponse: true
  rollback: "not-automatic"
}

export interface GuildCommunityAuditResult {
  access: GuildCommunityAccessEvidence
  applicationId: string
  botId: string
  configuration: GuildCommunityConfigurationView
  guildId: string
  inventory: GuildChannelEvidenceView
  localConstraints: typeof LOCAL_CONSTRAINTS
  privacy: GuildCommunityPrivacyProjection
  schemaVersion: number
  status: "ok"
  verificationBoundary: GuildCommunityVerificationBoundary
  warnings: string[]
}

export interface GuildCommunityChangePlan {
  access: GuildCommunityAccessEvidence
  acknowledgeCommunityEnablement: true
  applicationId: string
  auditReason: string
  botId: string
  changedFields: GuildCommunityChangeField[]
  createdAt: string
  current: GuildCommunityConfigurationView
  desired: GuildCommunityConfigurationView
  digest: string
  enablementRequired: boolean
  guildId: string
  inventory: GuildChannelEvidenceView
  localConstraints: typeof LOCAL_CONSTRAINTS
  operationKeyHash: string
  preservedFeatureCount: number
  preservedFeatureDigest: string
  privacy: GuildCommunityPrivacyProjection
  requiredPermission: "ADMINISTRATOR" | "MANAGE_GUILD"
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verificationBoundary: GuildCommunityVerificationBoundary
  warnings: string[]
  writeRequired: boolean
}

export interface GuildCommunityChangeResult {
  activityId: string | null
  changedFields: GuildCommunityChangeField[]
  enablementRequired: boolean
  guildId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed"
  verification: "match" | "not-required"
  warnings: string[]
}

export interface GuildCommunityServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "modifyGuildCommunity"
> {}

export interface GuildCommunityServiceOptions {
  activityStore: ActivityStore
  client: GuildCommunityServiceClient
  clock?: () => Date
  layoutSource: GatewayChannelLayoutSource
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertGuildCommunityAuditable"
    | "assertGuildCommunityChangeable"
  >
  randomId?: () => string
}

interface ValidatedGuildCommunity {
  features: string[]
  id: string
  ownerId: string
  publicUpdatesChannelId: string | null
  rulesChannelId: string | null
  safetyAlertsChannelId: string | null
}

interface ValidatedRole {
  id: string
  managed: boolean
  name: string
  permissions: string
  position: number
}

interface ValidatedBotMember {
  pending: false
  roles: string[]
}

interface ValidatedChannel extends DiscordChannel {
  guild_id: string
  id: string
  parent_id: string | null
  permission_overwrites: DiscordPermissionOverwrite[]
  position: number
  type: number
}

interface GuildCommunityState {
  access: GuildCommunityAccessEvidence
  botMember: ValidatedBotMember
  channelEvidence: GuildChannelEvidence<ValidatedChannel>
  configuration: GuildCommunityConfigurationView
  guild: ValidatedGuildCommunity
  priorReceipt: OperationReceipt | null
  roles: ValidatedRole[]
}

interface BuiltGuildCommunityPlan {
  desiredFeatures: string[]
  desiredRequest: NormalizedGuildCommunityChangeRequest
  plan: GuildCommunityChangePlan
  state: GuildCommunityState
}

function evidenceError(
  message: string,
  options?: ErrorOptions,
): GuildCommunityEvidenceError {
  return new GuildCommunityEvidenceError(message, options)
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

function contentFreeDigest(domain: string, value: unknown): string {
  return `${HASH_PREFIX}${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(stableString(value))
    .digest("hex")}`
}

function featureDigest(features: readonly string[]): string {
  return contentFreeDigest(
    "discord-mcp-guild-community-features.v1",
    [...features].sort(),
  )
}

function stateDigest(guild: ValidatedGuildCommunity): string {
  return contentFreeDigest("discord-mcp-guild-community-state.v1", {
    featureDigest: featureDigest(guild.features),
    featureCount: guild.features.length,
    publicUpdatesChannelId: guild.publicUpdatesChannelId,
    rulesChannelId: guild.rulesChannelId,
    safetyAlertsChannelId: guild.safetyAlertsChannelId,
  })
}

export function assertGuildCommunityAuditInput(guildId: string): void {
  assertPositiveSnowflake(guildId, "Discord guild Community guild ID")
}

export function normalizeGuildCommunityChangeRequest(
  request: GuildCommunityChangeRequest,
): NormalizedGuildCommunityChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild Community change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, REQUEST_KEYS)
    || Object.keys(record).length !== REQUEST_KEYS.length
    || request.acknowledgeCommunityEnablement !== true
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
    || typeof request.publicUpdatesChannelId !== "string"
    || typeof request.rulesChannelId !== "string"
    || !(request.safetyAlertsChannelId === null
      || typeof request.safetyAlertsChannelId === "string")
  ) {
    throw new RangeError("Discord guild Community change request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord guild Community guild ID")
  assertPositiveSnowflake(
    request.rulesChannelId,
    "Discord guild Community rules channel ID",
  )
  assertPositiveSnowflake(
    request.publicUpdatesChannelId,
    "Discord guild Community public-updates channel ID",
  )
  if (request.safetyAlertsChannelId !== null) {
    assertPositiveSnowflake(
      request.safetyAlertsChannelId,
      "Discord guild Community safety-alerts channel ID",
    )
  }
  if (request.rulesChannelId === request.publicUpdatesChannelId) {
    throw new RangeError(
      "Discord guild Community rules and public-updates channels must be distinct",
    )
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    acknowledgeCommunityEnablement: true,
    auditReason: request.auditReason,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
    publicUpdatesChannelId: request.publicUpdatesChannelId,
    rulesChannelId: request.rulesChannelId,
    safetyAlertsChannelId: request.safetyAlertsChannelId,
  }
}

function exactNullableSnowflake(value: unknown, label: string): string | null {
  if (value === null) return null
  if (!positiveSnowflake(value)) {
    throw evidenceError(`Discord returned invalid ${label} evidence`)
  }
  return value
}

function exactGuildCommunity(
  value: DiscordGuild,
  guildId: string,
): ValidatedGuildCommunity {
  const record = value as unknown as Record<string, unknown>
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
    || !Object.hasOwn(record, "rules_channel_id")
    || !Object.hasOwn(record, "public_updates_channel_id")
    || !Object.hasOwn(record, "safety_alerts_channel_id")
  ) {
    throw evidenceError("Discord returned incomplete or invalid guild Community evidence")
  }
  return {
    features: [...value.features].sort(),
    id: guildId,
    ownerId: value.owner_id,
    publicUpdatesChannelId: exactNullableSnowflake(
      value.public_updates_channel_id,
      "guild Community public-updates channel",
    ),
    rulesChannelId: exactNullableSnowflake(
      value.rules_channel_id,
      "guild Community rules channel",
    ),
    safetyAlertsChannelId: exactNullableSnowflake(
      value.safety_alerts_channel_id,
      "guild Community safety-alerts channel",
    ),
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
    || !(value.pending === undefined || value.pending === false)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw evidenceError("Discord returned incomplete or mismatched guild Community bot evidence")
  }
  return {
    pending: false,
    roles: [...value.roles].sort(compareSnowflakes),
  }
}

function validRoleName(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && [...value].length <= DISCORD_LIMITS.roleNameCharacters
    && !/[\u0000-\u001F\u007F]/u.test(value)
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded guild Community role inventory")
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
      throw evidenceError("Discord returned invalid or duplicate guild Community role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid guild Community role permissions", {
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
    throw evidenceError("Discord returned invalid guild Community @everyone role evidence")
  }
  return roles.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactOverwrites(
  value: unknown,
  roleIds: ReadonlySet<string>,
): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord returned incomplete guild Community channel overwrite evidence")
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw evidenceError("Discord returned invalid guild Community channel overwrite evidence")
    }
    const overwrite = entry as DiscordPermissionOverwrite
    if (
      !positiveSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || (overwrite.type === 0 && !roleIds.has(overwrite.id))
      || seen.has(`${overwrite.type}:${overwrite.id}`)
    ) {
      throw evidenceError("Discord returned contradictory guild Community channel overwrites")
    }
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(
        overwrite.allow ?? "0",
        "guild Community overwrite allow",
      )
      deny = parseDiscordPermissionBits(
        overwrite.deny ?? "0",
        "guild Community overwrite deny",
      )
    } catch (error) {
      throw evidenceError("Discord returned invalid guild Community overwrite bits", {
        cause: error,
      })
    }
    if ((allow & deny) !== 0n) {
      throw evidenceError("Discord returned overlapping guild Community overwrite bits")
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
    throw evidenceError("Discord returned an invalid bounded guild Community channel inventory")
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
      || !Number.isSafeInteger(channel.type)
      || channel.type < 0
      || !Number.isSafeInteger(channel.position)
      || (channel.position as number) < 0
      || !(channel.parent_id === undefined || channel.parent_id === null
        || positiveSnowflake(channel.parent_id))
      || ids.has(channel.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate guild Community channel evidence")
    }
    ids.add(channel.id)
    return {
      ...channel,
      guild_id: guildId,
      parent_id: channel.parent_id ?? null,
      permission_overwrites: exactOverwrites(channel.permission_overwrites, roleIds),
      position: channel.position as number,
    } as ValidatedChannel
  })
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]))
  for (const channel of channels) {
    if (channel.type === DISCORD_CHANNEL_TYPES.category && channel.parent_id !== null) {
      throw evidenceError("Discord returned a parented guild Community category")
    }
    if (channel.parent_id !== null) {
      const parent = channelsById.get(channel.parent_id)
      if (!parent || parent.type !== DISCORD_CHANNEL_TYPES.category) {
        throw evidenceError("Discord returned incomplete guild Community channel hierarchy evidence")
      }
    }
  }
  return channels.sort((left, right) => compareSnowflakes(left.id, right.id))
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
    throw evidenceError("Discord returned invalid guild Community permission evidence", {
      cause: error,
    })
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete guild Community permission evidence")
  }
  if (unknownDiscordPermissionBits(BigInt(result.effectivePermissions)) !== 0n) {
    throw evidenceError("Discord returned unknown guild Community bot permission bits")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): GuildCommunityAccessEvidence {
  const manageGuild = hasGuildPermission(permissions, "MANAGE_GUILD")
  return {
    appliedRoleIds: permissions.appliedRoleIds,
    authorizedForEnablement: botIsGuildOwner || permissions.administrator,
    authorizedForRoutingChange: botIsGuildOwner || manageGuild,
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    effectivePermissionNames: permissions.effectivePermissionNames,
    manageGuild,
    unknownPermissionBitsPresent: false,
    warnings: permissions.warnings,
  }
}

function channelReferenceView(
  channelId: string,
  kind: "administrative" | "rules",
  guild: ValidatedGuildCommunity,
  roles: readonly ValidatedRole[],
  evidence: GuildChannelEvidence<ValidatedChannel>,
): GuildCommunityChannelReferenceView {
  const layout = evidence.layout.channels.find((entry) => entry.channelId === channelId)
  const channel = evidence.channels.find((entry) => entry.id === channelId)
  if (!layout || layout.obfuscated || !channel) {
    throw evidenceError(
      "Discord guild Community routing references a channel without trusted current evidence",
    )
  }
  if (!COMMUNITY_CHANNEL_TYPES.has(channel.type)) {
    throw evidenceError(
      "Discord guild Community routing requires a direct text or announcement channel",
    )
  }
  if (kind === "administrative") {
    return {
      channelId,
      direct: true,
      everyoneCanSend: null,
      everyoneCanView: null,
      exists: true,
      parentId: channel.parent_id,
      type: channel.type,
      unknownPermissionBitsPresent: null,
    }
  }
  let result: ReturnType<typeof evaluatePrincipalPermissions>
  try {
    result = evaluatePrincipalPermissions({
      channel,
      guildId: guild.id,
      guildOwnerId: guild.ownerId,
      permissionChannel: channel,
      requestedPermissions: ["SEND_MESSAGES", "VIEW_CHANNEL"],
      roles,
      subject: { id: guild.id, kind: "role" },
    })
  } catch (error) {
    throw evidenceError("Discord returned invalid guild Community rules access evidence", {
      cause: error,
    })
  }
  if (result.confidence !== "complete") {
    throw evidenceError("Discord returned incomplete guild Community rules access evidence")
  }
  if (result.unknownPermissionBits !== "0") {
    throw evidenceError("Discord returned unknown guild Community rules permission bits")
  }
  const effective = new Set(result.effectivePermissionNames)
  return {
    channelId,
    direct: true,
    everyoneCanSend: effective.has("SEND_MESSAGES")
      && !result.ineffectivePermissions.includes("SEND_MESSAGES"),
    everyoneCanView: effective.has("VIEW_CHANNEL")
      && !result.ineffectivePermissions.includes("VIEW_CHANNEL"),
    exists: true,
    parentId: channel.parent_id,
    type: channel.type,
    unknownPermissionBitsPresent: false,
  }
}

function configurationView(
  guild: ValidatedGuildCommunity,
  roles: readonly ValidatedRole[],
  evidence: GuildChannelEvidence<ValidatedChannel>,
): GuildCommunityConfigurationView {
  const communityEnabled = guild.features.includes(COMMUNITY_FEATURE)
  if (communityEnabled && (
    guild.rulesChannelId === null
    || guild.publicUpdatesChannelId === null
  )) {
    throw evidenceError("Discord returned incomplete enabled guild Community routing evidence")
  }
  const rulesChannel = guild.rulesChannelId === null
    ? null
    : channelReferenceView(guild.rulesChannelId, "rules", guild, roles, evidence)
  const publicUpdatesChannel = guild.publicUpdatesChannelId === null
    ? null
    : channelReferenceView(
        guild.publicUpdatesChannelId,
        "administrative",
        guild,
        roles,
        evidence,
      )
  const safetyAlertsChannel = guild.safetyAlertsChannelId === null
    ? null
    : channelReferenceView(
        guild.safetyAlertsChannelId,
        "administrative",
        guild,
        roles,
        evidence,
      )
  const issues: string[] = []
  if (rulesChannel?.everyoneCanView === false) {
    issues.push("The configured rules channel is not visible to @everyone")
  }
  if (rulesChannel?.everyoneCanSend === true) {
    issues.push("The configured rules channel allows @everyone to send messages")
  }
  if (
    guild.rulesChannelId !== null
    && guild.rulesChannelId === guild.publicUpdatesChannelId
  ) {
    issues.push("The configured rules and public-updates channels are identical")
  }
  return {
    communityEnabled,
    featureCount: guild.features.length,
    featureDigest: featureDigest(guild.features),
    issues,
    publicUpdatesChannel,
    publicUpdatesChannelId: guild.publicUpdatesChannelId,
    rulesChannel,
    rulesChannelId: guild.rulesChannelId,
    safetyAlertsChannel,
    safetyAlertsChannelId: guild.safetyAlertsChannelId,
    stateDigest: stateDigest(guild),
  }
}

function desiredGuild(
  current: ValidatedGuildCommunity,
  request: NormalizedGuildCommunityChangeRequest,
): ValidatedGuildCommunity {
  return {
    ...current,
    features: [...new Set([...current.features, COMMUNITY_FEATURE])].sort(),
    publicUpdatesChannelId: request.publicUpdatesChannelId,
    rulesChannelId: request.rulesChannelId,
    safetyAlertsChannelId: request.safetyAlertsChannelId,
  }
}

function changedFields(
  current: ValidatedGuildCommunity,
  desired: ValidatedGuildCommunity,
): GuildCommunityChangeField[] {
  const fields: GuildCommunityChangeField[] = []
  if (!current.features.includes(COMMUNITY_FEATURE)) fields.push("communityEnabled")
  if (current.publicUpdatesChannelId !== desired.publicUpdatesChannelId) {
    fields.push("publicUpdatesChannelId")
  }
  if (current.rulesChannelId !== desired.rulesChannelId) fields.push("rulesChannelId")
  if (current.safetyAlertsChannelId !== desired.safetyAlertsChannelId) {
    fields.push("safetyAlertsChannelId")
  }
  return fields.sort()
}

function privacyProjection(): GuildCommunityPrivacyProjection {
  return {
    auditReasons: "not-persisted",
    channelNamesAndTopics: "omitted",
    featureValues: "digests-only",
    guildPresentation: "omitted",
    memberProfiles: "omitted",
    persistence: "content-free-identifiers-and-digests-only",
    rawPayloads: "omitted",
    roleNames: "omitted",
  }
}

function verificationBoundary(): GuildCommunityVerificationBoundary {
  return {
    automaticRetry: false,
    featureRemoval: false,
    freshApiReadback: true,
    gatewayLayoutContinuity: true,
    mutationResponse: true,
    rollback: "not-automatic",
  }
}

function assertDesiredSafe(configuration: GuildCommunityConfigurationView): void {
  if (configuration.rulesChannel?.everyoneCanView !== true) {
    throw evidenceError("Discord guild Community rules channel must be visible to @everyone")
  }
  if (
    configuration.rulesChannelId === null
    || configuration.publicUpdatesChannelId === null
  ) {
    throw evidenceError("Discord guild Community desired routing must be complete")
  }
  if (configuration.rulesChannelId === configuration.publicUpdatesChannelId) {
    throw evidenceError(
      "Discord guild Community rules and public-updates channels must be distinct",
    )
  }
}

function planWarnings(
  access: GuildCommunityAccessEvidence,
  desired: GuildCommunityConfigurationView,
  enablementRequired: boolean,
  alreadyCurrent: boolean,
): string[] {
  const warnings = [...access.warnings]
  if (alreadyCurrent) {
    warnings.push("The requested guild Community state already matches Discord")
  }
  if (enablementRequired) {
    warnings.push(
      "Community enablement requires broad ADMINISTRATOR authority; remove that grant after this frontier completes",
    )
  } else if (access.botAdministrator && !access.botIsGuildOwner) {
    warnings.push(
      "The connector bot has ADMINISTRATOR; routing-only Community changes need only MANAGE_GUILD",
    )
  }
  if (desired.rulesChannel?.everyoneCanSend === true) {
    warnings.push("The selected rules channel allows @everyone to send messages")
  }
  return [...new Set(warnings)].sort()
}

function planRisks(enablementRequired: boolean): string[] {
  const risks = [
    "Discord administrative and safety notices will be routed to the selected exact channels",
    "The selected rules channel becomes the guild's member-facing rules destination",
  ]
  if (enablementRequired) {
    risks.push(
      "The guild will gain Discord's COMMUNITY feature and may become subject to Community server requirements",
    )
  }
  return risks.sort()
}

function transportInput(built: BuiltGuildCommunityPlan): ModifyGuildCommunityInput {
  return {
    features: [...built.desiredFeatures],
    publicUpdatesChannelId: built.desiredRequest.publicUpdatesChannelId,
    rulesChannelId: built.desiredRequest.rulesChannelId,
    safetyAlertsChannelId: built.desiredRequest.safetyAlertsChannelId,
  }
}

function assertVerifiedOutcome(
  observed: ValidatedGuildCommunity,
  baselineFeatures: readonly string[],
  request: NormalizedGuildCommunityChangeRequest,
): void {
  if (
    !observed.features.includes(COMMUNITY_FEATURE)
    || baselineFeatures.some((feature) => !observed.features.includes(feature))
    || observed.publicUpdatesChannelId !== request.publicUpdatesChannelId
    || observed.rulesChannelId !== request.rulesChannelId
    || observed.safetyAlertsChannelId !== request.safetyAlertsChannelId
  ) {
    throw evidenceError(
      "Discord guild Community mutation did not preserve features and exact routing",
    )
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
  plan: GuildCommunityChangePlan
  request: NormalizedGuildCommunityChangeRequest
  status: GuildCommunityActivityStatus
  timestamp: string
  verification?: "match" | null
}): GuildCommunityActivity {
  return {
    changedFields: [...options.plan.changedFields],
    enablementRequired: options.plan.enablementRequired,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "guild-community-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    publicUpdatesChannelId: options.request.publicUpdatesChannelId,
    rulesChannelId: options.request.rulesChannelId,
    safetyAlertsChannelId: options.request.safetyAlertsChannelId,
    schemaVersion: SCHEMA_VERSION,
    stateDigest: options.plan.current.stateDigest,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: GuildCommunityChangePlan
  request: NormalizedGuildCommunityChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "guild-community-change",
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
    !(error instanceof GuildCommunityExecutionError)
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
  priorUncertainError: () => GuildCommunityExecutionError,
): Promise<T> {
  const prior = GUILD_COMMUNITY_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: GuildCommunityTargetOutcome) => void = () => undefined
  const tail = new Promise<GuildCommunityTargetOutcome>((resolve) => {
    release = resolve
  })
  GUILD_COMMUNITY_LOCKS.set(guildId, tail)
  let outcome: GuildCommunityTargetOutcome = "settled"
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
    if (outcome === "settled" && GUILD_COMMUNITY_LOCKS.get(guildId) === tail) {
      GUILD_COMMUNITY_LOCKS.delete(guildId)
    }
  }
}

export class GuildCommunityService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildCommunityServiceClient
  readonly #clock: () => Date
  readonly #layoutSource: GatewayChannelLayoutSource
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: GuildCommunityServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: GuildCommunityServiceOptions) {
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
  ): Promise<GuildCommunityState> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord guild Community guild ID")
    if (mode === "change") this.#policy.assertGuildCommunityChangeable(guildId)
    else this.#policy.assertGuildCommunityAuditable(guildId)
    let priorReceipt: OperationReceipt | null = null
    if (operationKeyHashValue) {
      priorReceipt = await this.#operationStore.get(
        "guild-community-change",
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
        throw new GuildCommunityOperationConflictError(receiptView(priorReceipt))
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
          `Discord guild Community channel evidence is incomplete: ${error.message}`,
        )
      }
      throw error
    }
    if (!supportingEvidence) {
      throw evidenceError("Discord guild Community supporting evidence is unavailable")
    }
    const guild = exactGuildCommunity(supportingEvidence.guild, guildId)
    const botMember = exactBotMember(supportingEvidence.member, guildId, botId)
    const roles = exactRoles(supportingEvidence.roles, guildId)
    const channels = exactChannels(rawChannelEvidence.channels, guildId, roles)
    const channelEvidence: GuildChannelEvidence<ValidatedChannel> = {
      channels,
      layout: rawChannelEvidence.layout,
      view: rawChannelEvidence.view,
    }
    const permissions = completePermissions(botMember, guildId, roles)
    const access = accessEvidence(permissions, guild.ownerId === botId)
    return {
      access,
      botMember,
      channelEvidence,
      configuration: configurationView(guild, roles, channelEvidence),
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
  ): Promise<GuildCommunityAuditResult> {
    assertGuildCommunityAuditInput(guildId)
    const state = await this.#state(applicationId, botId, guildId, "audit", options)
    const warnings = [...state.access.warnings]
    if (!state.configuration.communityEnabled) {
      warnings.push("Discord Community is not enabled for this guild")
    }
    if (!state.access.authorizedForRoutingChange) {
      warnings.push("The connector bot lacks MANAGE_GUILD authority for routing changes")
    }
    if (!state.access.authorizedForEnablement) {
      warnings.push("The connector bot lacks ADMINISTRATOR authority for Community enablement")
    }
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
      warnings: [...new Set(warnings)].sort(),
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    desiredRequest: NormalizedGuildCommunityChangeRequest,
    options: RequestOptions,
    allowCompletedReceipt = false,
  ): Promise<BuiltGuildCommunityPlan> {
    const state = await this.#state(
      applicationId,
      botId,
      desiredRequest.guildId,
      "change",
      options,
      desiredRequest.operationKeyHash,
      allowCompletedReceipt,
    )
    const enablementRequired = !state.configuration.communityEnabled
    if (enablementRequired && !state.access.authorizedForEnablement) {
      throw evidenceError(
        "Discord Community enablement requires guild ownership or complete ADMINISTRATOR authority",
      )
    }
    if (!enablementRequired && !state.access.authorizedForRoutingChange) {
      throw evidenceError(
        "Discord Community routing changes require guild ownership or complete MANAGE_GUILD authority",
      )
    }
    const desiredState = desiredGuild(state.guild, desiredRequest)
    const desired = configurationView(desiredState, state.roles, state.channelEvidence)
    assertDesiredSafe(desired)
    const changed = changedFields(state.guild, desiredState)
    const privacy = privacyProjection()
    const boundary = verificationBoundary()
    const warnings = planWarnings(
      state.access,
      desired,
      enablementRequired,
      changed.length === 0,
    )
    const risks = planRisks(enablementRequired)
    const requiredPermission = enablementRequired ? "ADMINISTRATOR" : "MANAGE_GUILD"
    const evidence = {
      access: state.access,
      botMemberRoleIds: [...state.botMember.roles],
      channels: state.channelEvidence.channels.map((channel) => ({
        id: channel.id,
        parentId: channel.parent_id,
        permissionOverwrites: channel.permission_overwrites,
        position: channel.position,
        type: channel.type,
      })),
      currentStateDigest: state.configuration.stateDigest,
      desiredStateDigest: desired.stateDigest,
      guild: {
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
      acknowledgeCommunityEnablement: true,
      applicationId,
      botId,
      changedFields: changed,
      desiredRequest,
      domain: "discord-mcp-guild-community-change-plan.v1",
      enablementRequired,
      evidence,
      localConstraints: LOCAL_CONSTRAINTS,
      privacy,
      requiredPermission,
      risks,
      verificationBoundary: boundary,
      warnings,
    })
    const plan: GuildCommunityChangePlan = {
      access: state.access,
      acknowledgeCommunityEnablement: true,
      applicationId,
      auditReason: desiredRequest.auditReason,
      botId,
      changedFields: changed,
      createdAt: this.#clock().toISOString(),
      current: state.configuration,
      desired,
      digest,
      enablementRequired,
      guildId: desiredRequest.guildId,
      inventory: state.channelEvidence.view,
      localConstraints: LOCAL_CONSTRAINTS,
      operationKeyHash: desiredRequest.operationKeyHash,
      preservedFeatureCount: state.configuration.featureCount,
      preservedFeatureDigest: state.configuration.featureDigest,
      privacy,
      requiredPermission,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: changed.length === 0 ? "already-current" : "planned",
      verificationBoundary: boundary,
      warnings,
      writeRequired: changed.length > 0,
    }
    if (state.priorReceipt && plan.writeRequired) {
      throw new GuildCommunityOperationConflictError(
        receiptView(state.priorReceipt),
      )
    }
    return {
      desiredFeatures: desiredState.features,
      desiredRequest,
      plan,
      state,
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildCommunityChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildCommunityChangePlan> {
    const desired = normalizeGuildCommunityChangeRequest(request)
    return (await this.#buildPlan(applicationId, botId, desired, options)).plan
  }

  async reconcilePlan(
    applicationId: string,
    botId: string,
    request: GuildCommunityChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildCommunityChangePlan> {
    const desired = normalizeGuildCommunityChangeRequest(request)
    return (
      await this.#buildPlan(applicationId, botId, desired, options, true)
    ).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: GuildCommunityChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildCommunityChangeResult> {
    const desired = normalizeGuildCommunityChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild Community plan digest is invalid")
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
      () => new GuildCommunityExecutionError(
        "Discord guild Community change was blocked because a prior same-guild operation ended without a durable outcome",
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
    desired: NormalizedGuildCommunityChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildCommunityChangeResult> {
    let built: BuiltGuildCommunityPlan
    try {
      built = await this.#buildPlan(applicationId, botId, desired, options)
    } catch (error) {
      if (
        error instanceof GuildCommunityEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GuildCommunityPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan } = built
    if (plan.digest !== expectedDigest) {
      throw new GuildCommunityPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      changedFields: [...plan.changedFields],
      enablementRequired: plan.enablementRequired,
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
      throw new GuildCommunityOperationConflictError(receiptView(reservation.receipt))
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
      throw new GuildCommunityExecutionError(
        "Discord guild Community change was blocked because pending activity could not be recorded",
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
    try {
      mutationStarted = true
      const response = await this.#client.modifyGuildCommunity(
        desired.guildId,
        transportInput(built),
        desired.auditReason,
        options,
      )
      mutationReturned = true
      assertVerifiedOutcome(
        exactGuildCommunity(response, desired.guildId),
        built.state.guild.features,
        desired,
      )
      const readback = await this.#state(
        applicationId,
        botId,
        desired.guildId,
        "audit",
        options,
      )
      assertVerifiedOutcome(readback.guild, built.state.guild.features, desired)
      assertDesiredSafe(readback.configuration)
    } catch (error) {
      const definiteMutationRefusal = mutationStarted
        && !mutationReturned
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
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
      throw new GuildCommunityExecutionError(
        "Discord guild Community change did not complete with a verified successful outcome",
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

    const result: GuildCommunityChangeResult = {
      ...baseResult,
      activityId,
      status: "completed",
      verification: "match",
      warnings: plan.warnings,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request: desired,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
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
      throw new GuildCommunityExecutionError(
        "Discord guild Community change completed but the operation receipt failed",
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
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new GuildCommunityExecutionError(
        "Discord guild Community change completed but the final activity record failed",
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
