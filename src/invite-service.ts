import {
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto"

import type {
  ActivityStore,
  InviteCreationActivity,
  InviteCreationActivityStatus,
  InviteDeletionActivity,
  InviteDeletionActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_INVITE_URL_PATTERN,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  INVITE_CURSOR_PATTERN,
  INVITE_LIMITS,
  INVITE_REFERENCE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type CreateChannelInviteInput,
  type DiscordClient,
  type DiscordDeletedInviteSummary,
  type DiscordInviteIdentitySummary,
  type DiscordInviteSummary,
} from "./discord-client.js"
import {
  DiscordApiError,
  InviteCreationExecutionError,
  InviteCreationOperationConflictError,
  InviteCreationPlanChangedError,
  InviteDeletionExecutionError,
  InviteDeletionOperationConflictError,
  InviteDeletionPlanChangedError,
  InviteEvidenceError,
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
  discordPermissionNames,
  evaluateBotChannelPermissions,
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  parseDiscordPermissionBits,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type BotChannelPermissionResult,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  type PrivateCapabilityFileReservation,
  type PrivateCapabilityFileSystem,
  type PrivateCapabilityTargetReview,
  DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM,
  PrivateCapabilityFileError,
  reservePrivateCapabilityFile,
  reviewPrivateCapabilityTarget,
} from "./private-capability-file.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import { ROLE_CREATION_HIGH_RISK_PERMISSIONS } from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const INVITE_GUEST_FLAG = 1
const INVITE_REFERENCE_PREFIX = "iref_hmac_sha256_"
const INVITE_CURSOR_PREFIX = "icur_hmac_sha256_"
const STATE_UNAVAILABLE = "invite-state-unavailable"
const CREATION_STATE_UNAVAILABLE = "invite-creation-state-unavailable"
const DISCORD_INVITE_BASE_URL = "https://discord.gg"
const INVITE_CAPABILITY_FILE_SCHEMA_VERSION = 1
const INVITE_CREATION_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const INVITE_CREATION_REQUIRED_PERMISSIONS = Object.freeze([
  "CREATE_INSTANT_INVITE",
  "VIEW_CHANNEL",
] as const satisfies readonly DiscordPermissionName[])
const HIGH_RISK_ROLE_PERMISSIONS: ReadonlySet<DiscordPermissionName> = new Set([
  "ADMINISTRATOR",
  "CREATE_INSTANT_INVITE",
  ...ROLE_CREATION_HIGH_RISK_PERMISSIONS,
])

export const INVITE_OMITTED_FIELDS = Object.freeze([
  "approximateCounts",
  "code",
  "guildObject",
  "guildScheduledEvent",
  "inviterProfile",
  "rawDiscordObject",
  "roleNames",
  "roleVisuals",
  "stageInstance",
  "targetApplicationMetadata",
  "targetUserProfile",
  "url",
] as const)

type InviteTargetOutcome = "settled" | "uncertain"

export interface InviteListOptions extends RequestOptions {
  cursor?: string
  limit?: number
}

export interface InviteDeletionRequest {
  auditReason: string
  guildId: string
  inviteRef: string
  operationKey: string
}

export interface NormalizedInviteDeletionRequest extends InviteDeletionRequest {
  operationKeyHash: string
}

export interface InviteChannelProjection {
  id: string
  name: string
  type: number
}

export interface InviteGrantedRoleProjection {
  highRiskPermissions: DiscordPermissionName[]
  permissionNames: DiscordPermissionName[]
  permissions: string
  roleId: string
  unknownPermissionBits: string
}

export interface ProjectedInvite {
  channel: InviteChannelProjection
  createdAt: string
  expiresAt: string | null
  flags: {
    guest: boolean
    raw: number
    unknownBits: string
  }
  inviteRef: string
  inviterUserId: string | null
  maxAgeSeconds: number
  maxUses: number
  riskFlags: string[]
  roles: InviteGrantedRoleProjection[]
  target: {
    id: string
    kind: "embedded-application" | "stream"
  } | null
  temporaryMembership: boolean
  uses: number
}

export interface InviteAccessEvidence {
  appliedRoleIds: string[]
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageGuild: true
  requiredPermission: "MANAGE_GUILD"
  unknownPermissionBits: string
}

export interface InvitePrivacyProjection {
  capabilitiesProjectedOut: true
  omittedFields: typeof INVITE_OMITTED_FIELDS
  persistence: "none"
  rawPayloads: "omitted"
}

export interface InviteInventoryResult {
  access: InviteAccessEvidence
  applicationId: string
  botId: string
  guild: {
    id: string
    name: string
  }
  invites: ProjectedInvite[]
  page: {
    cursor: string | null
    hasMore: boolean
    nextCursor: string | null
    requestedLimit: number
    returned: number
    safetyLimit: number
  }
  privacy: InvitePrivacyProjection
  schemaVersion: number
  status: "ok"
}

export interface InviteLookupResult extends Omit<
  InviteInventoryResult,
  "invites" | "page"
> {
  invite: ProjectedInvite
}

export interface InviteDeletionPlan {
  access: InviteAccessEvidence
  action: "delete"
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  privacy: InvitePrivacyProjection
  schemaVersion: number
  status: "planned"
  target: ProjectedInvite
  visibleInventory: {
    channelLimit: number
    channels: number
    inviteLimit: number
    invites: number
    roleLimit: number
    roles: number
  }
  warnings: string[]
}

export interface InviteDeletionResult {
  activityId: string
  channelId: string
  guildId: string
  inviteRef: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  verifiedAbsent: boolean
}

export interface InviteCreationRequest {
  acknowledgeBearerCapability: true
  auditReason: string
  channelId: string
  guildId: string
  maxAgeSeconds: number
  maxUses: number
  operationKey: string
  outputFile: string
  temporaryMembership: boolean
}

export interface NormalizedInviteCreationRequest extends InviteCreationRequest {
  operationKeyHash: string
}

export interface InviteCreationAccessEvidence {
  appliedRoleIds: string[]
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  createInstantInvite: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  requiredPermissions: typeof INVITE_CREATION_REQUIRED_PERMISSIONS
  unknownPermissionBits: string
  viewChannel: true
}

export interface InviteCreationPlan {
  access: InviteCreationAccessEvidence
  action: "create"
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  delivery: {
    format: "discord-invite-capability.v1"
    outputFile: string
    review: PrivateCapabilityTargetReview
  }
  digest: string
  guild: {
    id: string
    name: string
  }
  intent: CreateChannelInviteInput & { unique: true }
  operationKeyHash: string
  privacy: {
    capabilityDelivery: "private-file-only"
    mcpResult: "credential-free"
    persistence: "content-free-lifecycle-only"
    rawDiscordPayloads: "omitted"
  }
  schemaVersion: number
  status: "planned"
  target: InviteChannelProjection & {
    permissionOverwriteCount: number
  }
  visibleInventory: {
    channelLimit: number
    channels: number
    roleLimit: number
    roles: number
  }
  warnings: string[]
}

export interface InviteCreationResult {
  activityId: string
  capabilityFileWritten: true
  channelId: string
  guildId: string
  inviteRef: string
  operationKeyHash: string
  outputFile: string
  planDigest: string
  schemaVersion: number
  status: "completed"
  verified: true
}

export interface InviteServiceClient extends Pick<
  DiscordClient,
  | "createChannelInvite"
  | "deleteInvite"
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "getInvite"
  | "listGuildInvites"
> {}

export interface InviteServiceOptions {
  activityStore: ActivityStore
  capabilityRoots?: readonly string[]
  client: InviteServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertGuildInviteAuditable"
    | "assertGuildInviteCreatable"
    | "assertGuildInviteDeletable"
  >
  privateFileSystem?: PrivateCapabilityFileSystem
  randomId?: () => string
}

interface ValidatedRole {
  id: string
  managed: boolean
  name: string
  permissions: string
  position: number
}

interface InviteState {
  access: InviteAccessEvidence
  botMember: DiscordGuildMember
  channels: InviteChannelProjection[]
  guild: DiscordGuild & { owner_id: string }
  inventoryDigest: string
  projected: ProjectedInvite[]
  rawByReference: ReadonlyMap<string, DiscordInviteSummary>
  roles: ValidatedRole[]
}

interface InviteCreationState {
  access: InviteCreationAccessEvidence
  channel: DiscordChannel & {
    guild_id: string
    name: string
    permission_overwrites: DiscordPermissionOverwrite[]
  }
  channels: InviteChannelProjection[]
  guild: DiscordGuild & { owner_id: string }
  roles: ValidatedRole[]
}

interface PrivateInviteCreationPlan {
  plan: InviteCreationPlan
  request: NormalizedInviteCreationRequest
}

interface PrivateInviteDeletionPlan {
  code: string
  plan: InviteDeletionPlan
}

interface InviteCursorPayload {
  guildId: string
  inventoryDigest: string
  offset: number
  version: 1
}

function evidenceError(message: string): InviteEvidenceError {
  return new InviteEvidenceError(message)
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

function assertInviteReference(value: unknown): asserts value is string {
  if (typeof value !== "string" || !INVITE_REFERENCE_PATTERN.test(value)) {
    throw new RangeError("Discord invite reference is invalid or belongs to another process")
  }
}

export function assertInviteListInput(
  guildId: string,
  options: InviteListOptions,
): void {
  assertPositiveSnowflake(guildId, "Discord invite-audit guild ID")
  if (
    options.limit !== undefined
    && (
      !Number.isInteger(options.limit)
      || options.limit < 1
      || options.limit > INVITE_LIMITS.listPage
    )
  ) {
    throw new RangeError(
      `Discord invite-audit limit must be an integer between 1 and ${INVITE_LIMITS.listPage}`,
    )
  }
  if (
    options.cursor !== undefined
    && (
      options.cursor.length > INVITE_LIMITS.cursorCharacters
      || !INVITE_CURSOR_PATTERN.test(options.cursor)
    )
  ) {
    throw new RangeError("Discord invite-audit cursor is invalid or expired")
  }
}

export function assertInviteGetInput(guildId: string, inviteRef: string): void {
  assertPositiveSnowflake(guildId, "Discord invite-audit guild ID")
  assertInviteReference(inviteRef)
}

export function normalizeInviteDeletionRequest(
  request: InviteDeletionRequest,
): NormalizedInviteDeletionRequest {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord invite deletion request must be an object")
  }
  assertPositiveSnowflake(request.guildId, "Discord invite deletion guild ID")
  assertInviteReference(request.inviteRef)
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord invite deletion audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  if (DISCORD_INVITE_URL_PATTERN.test(request.auditReason)) {
    throw new RangeError("Discord invite deletion audit reason must not contain an invite URL")
  }
  return {
    auditReason: request.auditReason,
    guildId: request.guildId,
    inviteRef: request.inviteRef,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

const INVITE_CREATION_REQUEST_KEYS: ReadonlySet<string> = new Set([
  "acknowledgeBearerCapability",
  "auditReason",
  "channelId",
  "guildId",
  "maxAgeSeconds",
  "maxUses",
  "operationKey",
  "outputFile",
  "temporaryMembership",
])

export function normalizeInviteCreationRequest(
  request: InviteCreationRequest,
): NormalizedInviteCreationRequest {
  if (
    !request
    || typeof request !== "object"
    || Array.isArray(request)
    || Object.keys(request).some((key) => !INVITE_CREATION_REQUEST_KEYS.has(key))
    || Object.keys(request).length !== INVITE_CREATION_REQUEST_KEYS.size
  ) {
    throw new RangeError("Discord invite creation request must be one exact object")
  }
  assertPositiveSnowflake(request.guildId, "Discord invite-creation guild ID")
  assertPositiveSnowflake(request.channelId, "Discord invite-creation channel ID")
  if (request.acknowledgeBearerCapability !== true) {
    throw new RangeError(
      "Discord invite creation requires explicit bearer-capability acknowledgement",
    )
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord invite-creation audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  if (DISCORD_INVITE_URL_PATTERN.test(request.auditReason)) {
    throw new RangeError("Discord invite-creation audit reason must not contain an invite URL")
  }
  if (
    !Number.isInteger(request.maxAgeSeconds)
    || request.maxAgeSeconds < INVITE_LIMITS.minAgeSeconds
    || request.maxAgeSeconds > INVITE_LIMITS.maxAgeSeconds
  ) {
    throw new RangeError(
      `Discord invite lifetime must be an integer between ${INVITE_LIMITS.minAgeSeconds} and ${INVITE_LIMITS.maxAgeSeconds} seconds`,
    )
  }
  if (
    !Number.isInteger(request.maxUses)
    || request.maxUses < 1
    || request.maxUses > INVITE_LIMITS.maxUses
  ) {
    throw new RangeError(
      `Discord invite use limit must be an integer between 1 and ${INVITE_LIMITS.maxUses}`,
    )
  }
  if (typeof request.temporaryMembership !== "boolean") {
    throw new RangeError(
      "Discord invite creation requires explicit temporary-membership intent",
    )
  }
  if (typeof request.outputFile !== "string") {
    throw new RangeError("Discord invite capability output file must be a string")
  }
  return {
    ...request,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function validText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > maximum
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function canonicalInviteTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value
}

function exactGuild(
  value: DiscordGuild,
  guildId: string,
): DiscordGuild & { owner_id: string } {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !validText(value.name, DISCORD_LIMITS.channelNameCharacters)
    || !positiveSnowflake(value.owner_id)
  ) {
    throw evidenceError("Discord returned incomplete or mismatched invite guild evidence")
  }
  return value as DiscordGuild & { owner_id: string }
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
    throw evidenceError("Discord returned incomplete or mismatched invite bot evidence")
  }
  return value
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded invite role inventory")
  }
  const roles: ValidatedRole[] = []
  const roleIds = new Set<string>()
  for (const role of value) {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || !validText(role.name, DISCORD_LIMITS.roleNameCharacters)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || roleIds.has(role.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate invite role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw new InviteEvidenceError("Discord returned invalid invite role permissions", {
        cause: error,
      })
    }
    roleIds.add(role.id)
    roles.push({
      id: role.id,
      managed: role.managed,
      name: role.name,
      permissions: permissions.toString(),
      position: role.position,
    })
  }
  const everyone = roles.find((role) => role.id === guildId)
  if (
    !everyone
    || everyone.name !== "@everyone"
    || everyone.managed
    || everyone.position !== 0
  ) {
    throw evidenceError("Discord returned invalid invite @everyone role evidence")
  }
  return roles.sort((left, right) => left.id.localeCompare(right.id))
}

function exactChannels(
  value: readonly DiscordChannel[],
  guildId: string,
): InviteChannelProjection[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildChannels) {
    throw evidenceError("Discord returned an invalid bounded invite channel inventory")
  }
  const channels: InviteChannelProjection[] = []
  const ids = new Set<string>()
  for (const channel of value) {
    if (
      !channel
      || typeof channel !== "object"
      || Array.isArray(channel)
      || !positiveSnowflake(channel.id)
      || channel.guild_id !== guildId
      || !validText(channel.name, DISCORD_LIMITS.channelNameCharacters)
      || !Number.isSafeInteger(channel.type)
      || channel.type < 0
      || ids.has(channel.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate invite channel evidence")
    }
    ids.add(channel.id)
    channels.push({
      id: channel.id,
      name: channel.name,
      type: channel.type,
    })
  }
  return channels.sort((left, right) => left.id.localeCompare(right.id))
}

const INVITE_OVERWRITE_KEYS: ReadonlySet<string> = new Set([
  "allow",
  "deny",
  "id",
  "type",
])

function exactInviteCreationChannel(
  value: readonly DiscordChannel[],
  guildId: string,
  channelId: string,
  roles: readonly ValidatedRole[],
): InviteCreationState["channel"] {
  const channel = value.find((entry) => entry.id === channelId)
  if (
    !channel
    || channel.guild_id !== guildId
    || !INVITE_CREATION_CHANNEL_TYPES.has(channel.type)
    || !validText(channel.name, DISCORD_LIMITS.channelNameCharacters)
    || !Array.isArray(channel.permission_overwrites)
    || channel.permission_overwrites.length > DISCORD_LIMITS.channelPermissionOverwrites
  ) {
    throw evidenceError(
      "Discord invite creation requires one supported direct guild channel with complete overwrite evidence",
    )
  }
  const rolesById = new Set(roles.map((role) => role.id))
  const seen = new Set<string>()
  const permissionOverwrites = channel.permission_overwrites.map((overwrite) => {
    if (
      !overwrite
      || typeof overwrite !== "object"
      || Array.isArray(overwrite)
      || Object.keys(overwrite).some((key) => !INVITE_OVERWRITE_KEYS.has(key))
      || Object.keys(overwrite).length !== INVITE_OVERWRITE_KEYS.size
      || !positiveSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || typeof overwrite.allow !== "string"
      || typeof overwrite.deny !== "string"
      || (overwrite.type === 0 && !rolesById.has(overwrite.id))
    ) {
      throw evidenceError("Discord returned invalid invite-creation overwrite evidence")
    }
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(overwrite.allow, "invite-creation overwrite allow")
      deny = parseDiscordPermissionBits(overwrite.deny, "invite-creation overwrite deny")
    } catch (error) {
      throw new InviteEvidenceError(
        "Discord returned invalid invite-creation overwrite permissions",
        { cause: error },
      )
    }
    if ((allow & deny) !== 0n) {
      throw evidenceError("Discord returned contradictory invite-creation overwrites")
    }
    const key = `${overwrite.type}:${overwrite.id}`
    if (seen.has(key)) {
      throw evidenceError("Discord returned duplicate invite-creation overwrites")
    }
    seen.add(key)
    return {
      allow: allow.toString(),
      deny: deny.toString(),
      id: overwrite.id,
      type: overwrite.type,
    }
  }).sort((left, right) => (
    left.type - right.type || left.id.localeCompare(right.id)
  ))
  return {
    ...channel,
    guild_id: guildId,
    name: channel.name,
    permission_overwrites: permissionOverwrites,
  }
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
    throw new InviteEvidenceError("Discord returned invalid invite permission evidence", {
      cause: error,
    })
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete invite permission evidence")
  }
  return result
}

function inviteCreationAccessEvidence(
  botId: string,
  guild: DiscordGuild & { owner_id: string },
  member: DiscordGuildMember,
  roles: readonly ValidatedRole[],
  channel: InviteCreationState["channel"],
): InviteCreationAccessEvidence {
  let permissions: BotChannelPermissionResult
  try {
    permissions = evaluateBotChannelPermissions({
      botId,
      channel,
      guildId: guild.id,
      member,
      permissionChannel: channel,
      roles,
    })
  } catch (error) {
    throw new InviteEvidenceError(
      "Discord returned invalid invite-creation permission evidence",
      { cause: error },
    )
  }
  if (permissions.confidence !== "complete") {
    throw evidenceError("Discord returned incomplete invite-creation permission evidence")
  }
  const botIsGuildOwner = guild.owner_id === botId
  const effectivePermissions = botIsGuildOwner
    ? (ALL_KNOWN_PERMISSION_BITS | BigInt(permissions.effectivePermissions)).toString()
    : permissions.effectivePermissions
  const effectivePermissionNames = botIsGuildOwner
    ? [...DISCORD_PERMISSION_NAMES]
    : [...permissions.effectivePermissionNames]
  for (const permission of INVITE_CREATION_REQUIRED_PERMISSIONS) {
    if (!effectivePermissionNames.includes(permission)) {
      throw evidenceError(
        `Discord connector bot lacks channel-level ${permission} for invite creation`,
      )
    }
  }
  return {
    appliedRoleIds: [...permissions.appliedRoleIds].sort(),
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    createInstantInvite: true,
    effectivePermissionNames,
    effectivePermissions,
    requiredPermissions: INVITE_CREATION_REQUIRED_PERMISSIONS,
    unknownPermissionBits: permissions.unknownPermissionBits,
    viewChannel: true,
  }
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): InviteAccessEvidence {
  return {
    appliedRoleIds: permissions.appliedRoleIds,
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    effectivePermissionNames: permissions.effectivePermissionNames,
    effectivePermissions: permissions.effectivePermissions,
    manageGuild: true,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(permissions.effectivePermissions),
    ).toString(),
  }
}

function privacyProjection(): InvitePrivacyProjection {
  return {
    capabilitiesProjectedOut: true,
    omittedFields: INVITE_OMITTED_FIELDS,
    persistence: "none",
    rawPayloads: "omitted",
  }
}

function hmacHex(key: Uint8Array, domain: string, payload: string): string {
  return createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(payload)
    .digest("hex")
}

function createInviteReference(
  key: Uint8Array,
  guildId: string,
  code: string,
): string {
  return `${INVITE_REFERENCE_PREFIX}${hmacHex(
    key,
    "discord-mcp-invite-reference.v1",
    `${guildId}\0${code}`,
  )}`
}

function roleProjection(
  roleId: string,
  guildId: string,
  rolesById: ReadonlyMap<string, ValidatedRole>,
): InviteGrantedRoleProjection {
  const role = rolesById.get(roleId)
  if (!role || roleId === guildId) {
    throw evidenceError("Discord invite references an absent or invalid granted role")
  }
  const bits = BigInt(role.permissions)
  const permissionNames = discordPermissionNames(bits)
  return {
    highRiskPermissions: permissionNames.filter((name) => (
      HIGH_RISK_ROLE_PERMISSIONS.has(name)
    )),
    permissionNames,
    permissions: bits.toString(),
    roleId,
    unknownPermissionBits: unknownDiscordPermissionBits(bits).toString(),
  }
}

function projectedInvite(
  invite: DiscordInviteSummary,
  guildId: string,
  channelsById: ReadonlyMap<string, InviteChannelProjection>,
  rolesById: ReadonlyMap<string, ValidatedRole>,
  planKey: Uint8Array,
): ProjectedInvite {
  if (
    !invite
    || typeof invite !== "object"
    || Array.isArray(invite)
    || invite.type !== 0
    || invite.guildId !== guildId
    || !positiveSnowflake(invite.channelId)
    || !validText(invite.code, INVITE_LIMITS.codeCharacters)
    || !canonicalInviteTimestamp(invite.createdAt)
    || !(invite.expiresAt === null || canonicalInviteTimestamp(invite.expiresAt))
    || invite.expiresAt !== null && Date.parse(invite.expiresAt) < Date.parse(invite.createdAt)
    || !Number.isSafeInteger(invite.flags)
    || invite.flags < 0
    || !(invite.inviterUserId === null || positiveSnowflake(invite.inviterUserId))
    || !Number.isSafeInteger(invite.maxAge)
    || invite.maxAge < 0
    || invite.maxAge > INVITE_LIMITS.maxAgeSeconds
    || (invite.maxAge === 0) !== (invite.expiresAt === null)
    || !Number.isSafeInteger(invite.maxUses)
    || invite.maxUses < 0
    || invite.maxUses > INVITE_LIMITS.maxUses
    || !Array.isArray(invite.roleIds)
    || invite.roleIds.length > INVITE_LIMITS.roleIds
    || invite.roleIds.some((roleId) => !positiveSnowflake(roleId))
    || new Set(invite.roleIds).size !== invite.roleIds.length
    || !(invite.targetApplicationId === null || positiveSnowflake(invite.targetApplicationId))
    || !(invite.targetType === null || invite.targetType === 1 || invite.targetType === 2)
    || !(invite.targetUserId === null || positiveSnowflake(invite.targetUserId))
    || typeof invite.temporary !== "boolean"
    || !Number.isSafeInteger(invite.uses)
    || invite.uses < 0
    || invite.uses > invite.maxUses && invite.maxUses !== 0
  ) {
    throw evidenceError("Discord returned contradictory guild invite evidence")
  }
  const channel = channelsById.get(invite.channelId)
  if (!channel) {
    throw evidenceError("Discord invite references a channel outside the visible guild inventory")
  }
  const roles = invite.roleIds
    .map((roleId) => roleProjection(roleId, guildId, rolesById))
    .sort((left, right) => left.roleId.localeCompare(right.roleId))
  let target: ProjectedInvite["target"] = null
  if (invite.targetType === 1) {
    if (!invite.targetUserId || invite.targetApplicationId) {
      throw evidenceError("Discord returned contradictory stream invite evidence")
    }
    target = { id: invite.targetUserId, kind: "stream" }
  } else if (invite.targetType === 2) {
    if (!invite.targetApplicationId || invite.targetUserId) {
      throw evidenceError("Discord returned contradictory application invite evidence")
    }
    target = { id: invite.targetApplicationId, kind: "embedded-application" }
  } else if (
    invite.targetType !== null
    || invite.targetUserId !== null
    || invite.targetApplicationId !== null
  ) {
    throw evidenceError("Discord returned an unknown or contradictory invite target")
  }
  const unknownBits = (BigInt(invite.flags) & ~BigInt(INVITE_GUEST_FLAG)).toString()
  const guest = (invite.flags & INVITE_GUEST_FLAG) === INVITE_GUEST_FLAG
  const riskFlags = [
    ...(invite.uses > 0 ? ["already-used"] : []),
    ...(guest ? ["guest-access"] : []),
    ...(roles.length > 0 ? ["role-grant"] : []),
    ...(roles.some((role) => role.highRiskPermissions.length > 0)
      ? ["high-risk-role-grant"]
      : []),
    ...(roles.some((role) => role.unknownPermissionBits !== "0")
      ? ["unknown-role-permissions"]
      : []),
    ...(invite.expiresAt === null || invite.maxAge === 0 ? ["non-expiring"] : []),
    ...(invite.maxUses === 0 ? ["unlimited-use"] : []),
    ...(invite.temporary ? ["temporary-membership"] : []),
    ...(target ? ["targeted"] : []),
    ...(unknownBits !== "0" ? ["unknown-flags"] : []),
  ].sort()
  return {
    channel,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    flags: {
      guest,
      raw: invite.flags,
      unknownBits,
    },
    inviteRef: createInviteReference(planKey, guildId, invite.code),
    inviterUserId: invite.inviterUserId,
    maxAgeSeconds: invite.maxAge,
    maxUses: invite.maxUses,
    riskFlags,
    roles,
    target,
    temporaryMembership: invite.temporary,
    uses: invite.uses,
  }
}

function cursorSignature(
  key: Uint8Array,
  encodedPayload: string,
): string {
  return hmacHex(key, "discord-mcp-invite-cursor.v1", encodedPayload)
}

function encodeCursor(key: Uint8Array, payload: InviteCursorPayload): string {
  const encoded = Buffer.from(stableString(payload), "utf8").toString("base64url")
  const cursor = `${INVITE_CURSOR_PREFIX}${encoded}.${cursorSignature(key, encoded)}`
  if (cursor.length > INVITE_LIMITS.cursorCharacters) {
    throw evidenceError("Discord invite cursor exceeded its local safety bound")
  }
  return cursor
}

function decodeCursor(
  key: Uint8Array,
  cursor: string,
  guildId: string,
): InviteCursorPayload {
  if (!INVITE_CURSOR_PATTERN.test(cursor) || cursor.length > INVITE_LIMITS.cursorCharacters) {
    throw new RangeError("Discord invite-audit cursor is invalid or expired")
  }
  const separator = cursor.lastIndexOf(".")
  const encoded = cursor.slice(INVITE_CURSOR_PREFIX.length, separator)
  const signature = cursor.slice(separator + 1)
  const expected = cursorSignature(key, encoded)
  const signatureBytes = Buffer.from(signature, "hex")
  const expectedBytes = Buffer.from(expected, "hex")
  if (
    signatureBytes.length !== expectedBytes.length
    || !timingSafeEqual(signatureBytes, expectedBytes)
  ) {
    throw new RangeError("Discord invite-audit cursor is invalid or expired")
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown
  } catch {
    throw new RangeError("Discord invite-audit cursor is invalid or expired")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord invite-audit cursor is invalid or expired")
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== [
      "guildId",
      "inventoryDigest",
      "offset",
      "version",
    ].join("\0")
    || record.version !== 1
    || record.guildId !== guildId
    || typeof record.inventoryDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.inventoryDigest)
    || !Number.isSafeInteger(record.offset)
    || (record.offset as number) < 1
    || (record.offset as number) > INVITE_LIMITS.inventory
  ) {
    throw new RangeError("Discord invite-audit cursor is invalid or expired")
  }
  return record as unknown as InviteCursorPayload
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
    inviteRef: receipt.resourceId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: InviteDeletionPlan
  request: NormalizedInviteDeletionRequest
  status: InviteDeletionActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): InviteDeletionActivity {
  return {
    channelId: options.plan.target.channel.id,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    inviteRef: options.request.inviteRef,
    kind: "invite-deletion",
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
  guildId: string
  plan: InviteDeletionPlan
  request: NormalizedInviteDeletionRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "invite-deletion",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.inviteRef : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function inviteCreationActivityEntry(options: {
  activityId: string
  capabilityFileWritten?: boolean
  error?: string | null
  inviteRef?: string | null
  plan: InviteCreationPlan
  request: NormalizedInviteCreationRequest
  status: InviteCreationActivityStatus
  timestamp: string
  verification?: "match" | null
}): InviteCreationActivity {
  return {
    capabilityFileWritten: options.capabilityFileWritten ?? false,
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    inviteRef: options.inviteRef ?? null,
    kind: "invite-creation",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function inviteCreationOperationReceipt(options: {
  activityId: string
  error?: string | null
  inviteRef?: string | null
  plan: InviteCreationPlan
  request: NormalizedInviteCreationRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "invite-creation",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.inviteRef ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function assertCreatedInvite(
  invite: DiscordInviteSummary,
  botId: string,
  request: NormalizedInviteCreationRequest,
): void {
  if (
    invite.type !== 0
    || invite.guildId !== request.guildId
    || invite.channelId !== request.channelId
    || invite.inviterUserId !== botId
    || invite.maxAge !== request.maxAgeSeconds
    || invite.maxUses !== request.maxUses
    || invite.temporary !== request.temporaryMembership
    || invite.uses !== 0
    || invite.flags !== 0
    || invite.roleIds.length !== 0
    || invite.targetApplicationId !== null
    || invite.targetType !== null
    || invite.targetUserId !== null
    || invite.unknownFieldCount !== undefined
    || !canonicalInviteTimestamp(invite.createdAt)
    || !canonicalInviteTimestamp(invite.expiresAt)
    || Date.parse(invite.expiresAt) - Date.parse(invite.createdAt)
      !== request.maxAgeSeconds * 1_000
  ) {
    throw evidenceError("Discord returned mismatched invite-creation evidence")
  }
}

function assertInviteVerification(
  observed: DiscordInviteIdentitySummary,
  invite: DiscordInviteSummary,
  request: NormalizedInviteCreationRequest,
): void {
  if (
    observed.type !== 0
    || observed.guildId !== request.guildId
    || observed.channelId !== request.channelId
    || observed.code !== invite.code
  ) {
    throw evidenceError("Discord returned mismatched exact invite verification evidence")
  }
}

function inviteCapabilityContent(
  invite: DiscordInviteSummary,
  request: NormalizedInviteCreationRequest,
): string {
  return `${JSON.stringify({
    channelId: request.channelId,
    code: invite.code,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    guildId: request.guildId,
    kind: "discord-invite-capability",
    maxAgeSeconds: request.maxAgeSeconds,
    maxUses: request.maxUses,
    schemaVersion: INVITE_CAPABILITY_FILE_SCHEMA_VERSION,
    temporaryMembership: request.temporaryMembership,
    url: `${DISCORD_INVITE_BASE_URL}/${encodeURIComponent(invite.code)}`,
  }, null, 2)}\n`
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof InviteDeletionExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

function uncertainInviteCreationExecution(error: unknown): boolean {
  if (
    !(error instanceof InviteCreationExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  const status = error.result.status
  return typeof status === "string" && (
    status === "uncertain"
    || status.startsWith("completed-")
  )
}

async function withTargetLock<T>(
  locks: Map<string, Promise<InviteTargetOutcome>>,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => InviteDeletionExecutionError,
): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: InviteTargetOutcome) => void = () => undefined
  const tail = new Promise<InviteTargetOutcome>((resolve) => {
    release = resolve
  })
  locks.set(key, tail)
  let outcome: InviteTargetOutcome = "settled"
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
    release(outcome)
    if (outcome === "settled" && locks.get(key) === tail) locks.delete(key)
  }
}

async function withInviteCreationTargetLock<T>(
  locks: Map<string, Promise<InviteTargetOutcome>>,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => InviteCreationExecutionError,
): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: InviteTargetOutcome) => void = () => undefined
  const tail = new Promise<InviteTargetOutcome>((resolve) => {
    release = resolve
  })
  locks.set(key, tail)
  let outcome: InviteTargetOutcome = "settled"
  try {
    if (await prior === "uncertain") {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (uncertainInviteCreationExecution(error)) outcome = "uncertain"
    throw error
  } finally {
    release(outcome)
    if (outcome === "settled" && locks.get(key) === tail) locks.delete(key)
  }
}

export class InviteService {
  readonly #activityStore: ActivityStore
  readonly #capabilityRoots: readonly string[]
  readonly #client: InviteServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: InviteServiceOptions["policy"]
  readonly #privateFileSystem: PrivateCapabilityFileSystem
  readonly #randomId: () => string
  readonly #creationTargetLocks = new Map<string, Promise<InviteTargetOutcome>>()
  readonly #targetLocks = new Map<string, Promise<InviteTargetOutcome>>()

  constructor(options: InviteServiceOptions) {
    this.#activityStore = options.activityStore
    this.#capabilityRoots = options.capabilityRoots ?? []
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#privateFileSystem = options.privateFileSystem
      ?? DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM
    this.#randomId = options.randomId || randomUUID
  }

  async #creationState(
    botId: string,
    request: NormalizedInviteCreationRequest,
    options: RequestOptions,
  ): Promise<InviteCreationState> {
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertGuildInviteCreatable(request.guildId, request.channelId)
    const receipt = await this.#operationStore.get(
      "invite-creation",
      request.operationKeyHash,
    )
    if (receipt) {
      throw new InviteCreationOperationConflictError(receiptView(receipt))
    }
    const [rawGuild, rawBotMember, rawRoles, rawChannels] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildRoles(request.guildId, options),
      this.#client.getGuildChannels(request.guildId, options),
    ])
    const guild = exactGuild(rawGuild, request.guildId)
    const botMember = exactBotMember(rawBotMember, request.guildId, botId)
    const roles = exactRoles(rawRoles, request.guildId)
    const channels = exactChannels(rawChannels, request.guildId)
    const channel = exactInviteCreationChannel(
      rawChannels,
      request.guildId,
      request.channelId,
      roles,
    )
    const access = inviteCreationAccessEvidence(
      botId,
      guild,
      botMember,
      roles,
      channel,
    )
    return { access, channel, channels, guild, roles }
  }

  async #buildCreationPlan(
    applicationId: string,
    botId: string,
    request: NormalizedInviteCreationRequest,
    options: RequestOptions,
  ): Promise<PrivateInviteCreationPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const [state, targetReview] = await Promise.all([
      this.#creationState(botId, request, options),
      reviewPrivateCapabilityTarget(
        request.outputFile,
        this.#capabilityRoots,
        this.#privateFileSystem,
      ),
    ])
    const delivery: InviteCreationPlan["delivery"] = {
      format: "discord-invite-capability.v1",
      outputFile: request.outputFile,
      review: targetReview,
    }
    const intent: InviteCreationPlan["intent"] = {
      maxAgeSeconds: request.maxAgeSeconds,
      maxUses: request.maxUses,
      temporaryMembership: request.temporaryMembership,
      unique: true,
    }
    const privacy: InviteCreationPlan["privacy"] = {
      capabilityDelivery: "private-file-only",
      mcpResult: "credential-free",
      persistence: "content-free-lifecycle-only",
      rawDiscordPayloads: "omitted",
    }
    const target: InviteCreationPlan["target"] = {
      id: state.channel.id,
      name: state.channel.name,
      permissionOverwriteCount: state.channel.permission_overwrites.length,
      type: state.channel.type,
    }
    const visibleInventory = {
      channelLimit: DISCORD_LIMITS.guildChannels,
      channels: state.channels.length,
      roleLimit: DISCORD_LIMITS.guildRoles,
      roles: state.roles.length,
    }
    const warnings = [
      ...(state.access.botAdministrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with channel-scoped VIEW_CHANNEL and CREATE_INSTANT_INVITE"]
        : []),
      ...(state.access.botIsGuildOwner
        ? ["Discord connector bot owns the guild and therefore bypasses narrower channel permission controls"]
        : []),
      "The created invite is a bearer capability; anyone who obtains the private file can use it within the reviewed limits",
      "The connector exclusively creates one private file and never returns the invite code or URL through MCP",
      "The output target must remain absent, canonical, process-owned, and inside the configured private root until execution",
      "Invite creation performs one non-retried Discord mutation and cannot be rolled back automatically",
      "A file-write or verification failure after Discord accepts the request leaves an uncertain outcome that must be inspected manually",
      "The one-shot operation key cannot be reused after reservation, including after an uncertain outcome",
      "Same-channel serialization is process-local; do not run overlapping invite creation in multiple connector processes",
      "Temporary-membership behavior remains subject to Discord's member and role lifecycle",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      access: state.access,
      applicationId,
      botId,
      delivery,
      domain: "discord-mcp-invite-creation-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      intent,
      operationKeyHash: request.operationKeyHash,
      privacy,
      request: {
        acknowledgeBearerCapability: request.acknowledgeBearerCapability,
        auditReason: request.auditReason,
        channelId: request.channelId,
        guildId: request.guildId,
        outputFile: request.outputFile,
      },
      target,
      visibleInventory,
      warnings,
    })
    return {
      plan: {
        access: state.access,
        action: "create",
        applicationId,
        auditReason: request.auditReason,
        botId,
        createdAt: this.#clock().toISOString(),
        delivery,
        digest,
        guild: { id: state.guild.id, name: state.guild.name },
        intent,
        operationKeyHash: request.operationKeyHash,
        privacy,
        schemaVersion: SCHEMA_VERSION,
        status: "planned",
        target,
        visibleInventory,
        warnings,
      },
      request,
    }
  }

  async planCreation(
    applicationId: string,
    botId: string,
    request: InviteCreationRequest,
    options: RequestOptions = {},
  ): Promise<InviteCreationPlan> {
    return (await this.#buildCreationPlan(
      applicationId,
      botId,
      normalizeInviteCreationRequest(request),
      options,
    )).plan
  }

  executeCreation(
    applicationId: string,
    botId: string,
    request: InviteCreationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<InviteCreationResult> {
    const normalized = normalizeInviteCreationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord invite-creation plan digest is invalid")
    }
    const lockKey = `${normalized.guildId}:${normalized.channelId}`
    return withInviteCreationTargetLock(
      this.#creationTargetLocks,
      lockKey,
      () => this.#executeCreationNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new InviteCreationExecutionError(
        "Discord invite creation was blocked because a prior same-channel operation ended with an uncertain outcome",
        {
          capabilityFileWritten: false,
          channelId: normalized.channelId,
          guildId: normalized.guildId,
          inviteRef: null,
          operationKeyHash: normalized.operationKeyHash,
          outputFile: normalized.outputFile,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeCreationNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedInviteCreationRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<InviteCreationResult> {
    let privatePlan: PrivateInviteCreationPlan
    try {
      privatePlan = await this.#buildCreationPlan(
        applicationId,
        botId,
        request,
        options,
      )
    } catch (error) {
      if (
        error instanceof InviteEvidenceError
        || error instanceof PrivateCapabilityFileError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new InviteCreationPlanChangedError(
          expectedDigest,
          CREATION_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { plan } = privatePlan
    if (plan.digest !== expectedDigest) {
      throw new InviteCreationPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      capabilityFileWritten: false,
      channelId: request.channelId,
      guildId: request.guildId,
      inviteRef: null as string | null,
      operationKeyHash: request.operationKeyHash,
      outputFile: request.outputFile,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(
      inviteCreationOperationReceipt({
        activityId,
        plan,
        request,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }),
    )
    if (!reservation.created) {
      throw new InviteCreationOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(inviteCreationActivityEntry({
        activityId,
        plan,
        request,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(inviteCreationOperationReceipt({
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
      throw new InviteCreationExecutionError(
        "Discord invite creation was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
      )
    }

    let capabilityFile: PrivateCapabilityFileReservation | undefined
    let capabilityFileWritten = false
    let inviteRef: string | null = null
    let mutationDispatched = false
    try {
      capabilityFile = await reservePrivateCapabilityFile(
        request.outputFile,
        this.#capabilityRoots,
        this.#privateFileSystem,
      )
      mutationDispatched = true
      const invite = await this.#client.createChannelInvite(
        request.channelId,
        {
          maxAgeSeconds: request.maxAgeSeconds,
          maxUses: request.maxUses,
          temporaryMembership: request.temporaryMembership,
        },
        request.auditReason,
        options,
      )
      assertCreatedInvite(invite, botId, request)
      inviteRef = createInviteReference(this.#planKey, request.guildId, invite.code)
      await capabilityFile.write(inviteCapabilityContent(invite, request))
      capabilityFileWritten = true
      const observed = await this.#client.getInvite(invite.code, options)
      assertInviteVerification(observed, invite, request)
    } catch (error) {
      const definiteFailure = !mutationDispatched || (
        inviteRef === null
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
      )
      const status = definiteFailure ? "failed" : "uncertain"
      const errorCode = safeErrorCode(error)
      const capabilityFileDiscarded = capabilityFileWritten
        ? false
        : await capabilityFile?.discard().catch(() => false) ?? true
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(inviteCreationOperationReceipt({
          activityId,
          error: errorCode,
          inviteRef: status === "uncertain" ? inviteRef : null,
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
        await this.#activityStore.append(inviteCreationActivityEntry({
          activityId,
          capabilityFileWritten,
          error: errorCode,
          inviteRef: status === "uncertain" ? inviteRef : null,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new InviteCreationExecutionError(
        "Discord invite creation did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          capabilityFileDiscarded,
          capabilityFileWritten,
          error: errorCode,
          inviteRef,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
      )
    }

    if (!capabilityFileWritten || inviteRef === null) {
      throw new InviteCreationExecutionError(
        "Discord invite creation reached an invalid local terminal state",
        {
          ...baseResult,
          activityId,
          status: "uncertain",
        },
      )
    }
    const result: InviteCreationResult = {
      activityId,
      capabilityFileWritten: true,
      channelId: request.channelId,
      guildId: request.guildId,
      inviteRef,
      operationKeyHash: request.operationKeyHash,
      outputFile: request.outputFile,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      verified: true,
    }
    try {
      await this.#operationStore.finish(inviteCreationOperationReceipt({
        activityId,
        inviteRef,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(inviteCreationActivityEntry({
          activityId,
          capabilityFileWritten: true,
          error: safeErrorCode(error),
          inviteRef,
          plan,
          request,
          status: "completed",
          timestamp: this.#clock().toISOString(),
          verification: "match",
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new InviteCreationExecutionError(
        "Discord invite creation completed but the operation receipt failed",
        {
          ...result,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
        },
      )
    }
    try {
      await this.#activityStore.append(inviteCreationActivityEntry({
        activityId,
        capabilityFileWritten: true,
        inviteRef,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new InviteCreationExecutionError(
        "Discord invite creation completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
      )
    }
    return result
  }

  async #state(
    botId: string,
    guildId: string,
    mode: "audit" | "delete",
    options: RequestOptions,
    operationKeyHashValue?: string,
  ): Promise<InviteState> {
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord invite-audit guild ID")
    if (mode === "delete") {
      this.#policy.assertGuildInviteDeletable(guildId)
    } else {
      this.#policy.assertGuildInviteAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "invite-deletion",
        operationKeyHashValue,
      )
      if (receipt) {
        throw new InviteDeletionOperationConflictError(receiptView(receipt))
      }
    }
    const [rawGuild, rawBotMember, rawRoles, rawChannels, rawInvites] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getGuildChannels(guildId, options),
      this.#client.listGuildInvites(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawBotMember, guildId, botId)
    const roles = exactRoles(rawRoles, guildId)
    const channels = exactChannels(rawChannels, guildId)
    const permissions = completePermissions(botMember, guildId, roles)
    const botIsGuildOwner = guild.owner_id === botId
    if (!botIsGuildOwner && !hasGuildPermission(permissions, "MANAGE_GUILD")) {
      throw evidenceError("Discord connector bot lacks guild-level MANAGE_GUILD")
    }
    if (!Array.isArray(rawInvites) || rawInvites.length > INVITE_LIMITS.inventory) {
      throw evidenceError("Discord returned an invalid bounded guild invite inventory")
    }
    const channelsById = new Map(channels.map((channel) => [channel.id, channel]))
    const rolesById = new Map(roles.map((role) => [role.id, role]))
    const rawByReference = new Map<string, DiscordInviteSummary>()
    const projected = rawInvites.map((invite) => {
      const value = projectedInvite(
        invite,
        guildId,
        channelsById,
        rolesById,
        this.#planKey,
      )
      if (rawByReference.has(value.inviteRef)) {
        throw evidenceError("Discord returned duplicate guild invite capabilities")
      }
      rawByReference.set(value.inviteRef, invite)
      return value
    }).sort((left, right) => left.inviteRef.localeCompare(right.inviteRef))
    const access = accessEvidence(permissions, botIsGuildOwner)
    const inventoryDigest = reviewedPlanDigest(this.#planKey, {
      access,
      botMemberRoleIds: [...botMember.roles].sort(),
      channels,
      domain: "discord-mcp-invite-inventory.v1",
      guild: {
        id: guild.id,
        name: guild.name,
        ownerId: guild.owner_id,
      },
      invites: projected,
      roles: roles.map((role) => ({
        id: role.id,
        managed: role.managed,
        permissions: role.permissions,
        position: role.position,
      })),
    })
    return {
      access,
      botMember,
      channels,
      guild,
      inventoryDigest,
      projected,
      rawByReference,
      roles,
    }
  }

  async list(
    applicationId: string,
    botId: string,
    guildId: string,
    options: InviteListOptions = {},
  ): Promise<InviteInventoryResult> {
    assertInviteListInput(guildId, options)
    assertPositiveSnowflake(applicationId, "Discord invite-audit application ID")
    assertPositiveSnowflake(botId, "Discord invite-audit bot ID")
    const cursor = options.cursor
      ? decodeCursor(this.#planKey, options.cursor, guildId)
      : undefined
    const state = await this.#state(botId, guildId, "audit", options)
    if (cursor && cursor.inventoryDigest !== state.inventoryDigest) {
      throw evidenceError("Discord invite inventory changed; restart pagination")
    }
    const offset = cursor?.offset ?? 0
    if (offset > state.projected.length) {
      throw evidenceError("Discord invite cursor is outside the fresh inventory")
    }
    const limit = options.limit ?? INVITE_LIMITS.listPageDefault
    const invites = state.projected.slice(offset, offset + limit)
    const nextOffset = offset + invites.length
    const hasMore = nextOffset < state.projected.length
    return {
      access: state.access,
      applicationId,
      botId,
      guild: { id: state.guild.id, name: state.guild.name },
      invites,
      page: {
        cursor: options.cursor ?? null,
        hasMore,
        nextCursor: hasMore
          ? encodeCursor(this.#planKey, {
              guildId,
              inventoryDigest: state.inventoryDigest,
              offset: nextOffset,
              version: 1,
            })
          : null,
        requestedLimit: limit,
        returned: invites.length,
        safetyLimit: INVITE_LIMITS.inventory,
      },
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    inviteRef: string,
    options: RequestOptions = {},
  ): Promise<InviteLookupResult> {
    assertInviteGetInput(guildId, inviteRef)
    assertPositiveSnowflake(applicationId, "Discord invite-audit application ID")
    assertPositiveSnowflake(botId, "Discord invite-audit bot ID")
    const state = await this.#state(botId, guildId, "audit", options)
    const invite = state.projected.find((entry) => entry.inviteRef === inviteRef)
    if (!invite) {
      throw evidenceError("Discord invite reference is absent or expired for this process")
    }
    return {
      access: state.access,
      applicationId,
      botId,
      guild: { id: state.guild.id, name: state.guild.name },
      invite,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedInviteDeletionRequest,
    options: RequestOptions,
  ): Promise<PrivateInviteDeletionPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(
      botId,
      request.guildId,
      "delete",
      options,
      request.operationKeyHash,
    )
    const target = state.projected.find((invite) => invite.inviteRef === request.inviteRef)
    const raw = state.rawByReference.get(request.inviteRef)
    if (!target || !raw) {
      throw evidenceError("Discord invite reference is absent or expired for this process")
    }
    if (
      request.auditReason.includes(raw.code)
    ) {
      throw evidenceError("Discord invite deletion audit reason must not contain the target invite code")
    }
    const privacy = privacyProjection()
    const visibleInventory = {
      channelLimit: DISCORD_LIMITS.guildChannels,
      channels: state.channels.length,
      inviteLimit: INVITE_LIMITS.inventory,
      invites: state.projected.length,
      roleLimit: DISCORD_LIMITS.guildRoles,
      roles: state.roles.length,
    }
    const warnings = [
      ...(state.access.botAdministrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped MANAGE_GUILD"]
        : []),
      "Invite deletion permanently revokes the selected access capability",
      "Invite deletion does not remove members or roles granted by earlier uses",
      "The invite code and URL are projected out and never enter the MCP result or persistent state",
      "Opaque invite references are process-local and expire when the connector restarts",
      "Guild, channel, and untrusted Discord text are never persisted by this workflow",
      "Same-target serialization is process-local; do not run overlapping invite-deletion scope in multiple connector processes",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      "Discord deletes by secret code after a non-atomic inventory read; prevent concurrent invite administration during execution",
    ]
    const requestProjection = {
      auditReason: request.auditReason,
      guildId: request.guildId,
      inviteRef: request.inviteRef,
      operationKeyHash: request.operationKeyHash,
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      domain: "discord-mcp-invite-deletion-plan.v1",
      inventoryDigest: state.inventoryDigest,
      privacy,
      request: requestProjection,
      target,
      visibleInventory,
      warnings,
    })
    return {
      code: raw.code,
      plan: {
        access: state.access,
        action: "delete",
        applicationId,
        auditReason: request.auditReason,
        botId,
        createdAt: this.#clock().toISOString(),
        digest,
        guild: { id: state.guild.id, name: state.guild.name },
        operationKeyHash: request.operationKeyHash,
        privacy,
        schemaVersion: SCHEMA_VERSION,
        status: "planned",
        target,
        visibleInventory,
        warnings,
      },
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: InviteDeletionRequest,
    options: RequestOptions = {},
  ): Promise<InviteDeletionPlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      normalizeInviteDeletionRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: InviteDeletionRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<InviteDeletionResult> {
    const normalized = normalizeInviteDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord invite deletion plan digest is invalid")
    }
    return withTargetLock(
      this.#targetLocks,
      normalized.inviteRef,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new InviteDeletionExecutionError(
        "Discord invite deletion was blocked because a prior same-target operation ended with an uncertain outcome",
        {
          guildId: normalized.guildId,
          inviteRef: normalized.inviteRef,
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
    request: NormalizedInviteDeletionRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<InviteDeletionResult> {
    let privatePlan: PrivateInviteDeletionPlan
    try {
      privatePlan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof InviteEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new InviteDeletionPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { code, plan } = privatePlan
    if (plan.digest !== expectedDigest) {
      throw new InviteDeletionPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: plan.target.channel.id,
      guildId: request.guildId,
      inviteRef: request.inviteRef,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
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
      throw new InviteDeletionOperationConflictError(receiptView(reservation.receipt))
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
      throw new InviteDeletionExecutionError(
        "Discord invite deletion was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
      )
    }

    let mutationCompleted = false
    let verifiedAbsent: boolean | null = null
    try {
      const deleted = await this.#client.deleteInvite(
        code,
        request.auditReason,
        options,
      )
      mutationCompleted = true
      this.#assertDeletedResponse(deleted, plan.target, request.guildId)
      const observed = await this.#state(botId, request.guildId, "audit", options)
      verifiedAbsent = !observed.rawByReference.has(request.inviteRef)
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
      throw new InviteDeletionExecutionError(
        "Discord invite deletion did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
          verifiedAbsent,
        },
      )
    }

    const verification = verifiedAbsent ? "match" : "drift"
    const status = verifiedAbsent ? "completed" : "completed-with-drift"
    const result: InviteDeletionResult = {
      ...baseResult,
      activityId,
      status,
      verifiedAbsent,
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
      throw new InviteDeletionExecutionError(
        "Discord invite deletion completed but the operation receipt failed",
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
        guildId: request.guildId,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new InviteDeletionExecutionError(
        "Discord invite deletion completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
      )
    }
    return result
  }

  #assertDeletedResponse(
    deleted: DiscordDeletedInviteSummary,
    target: ProjectedInvite,
    guildId: string,
  ): void {
    if (
      deleted.type !== 0
      || deleted.guildId !== guildId
      || deleted.channelId !== target.channel.id
      || createInviteReference(this.#planKey, guildId, deleted.code) !== target.inviteRef
    ) {
      throw evidenceError("Discord returned mismatched invite deletion evidence")
    }
  }
}
