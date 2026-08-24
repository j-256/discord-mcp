import { randomUUID } from "node:crypto"
import { isAbsolute } from "node:path"

import type {
  ActivityStore,
  RoleConfigurationActivity,
  RoleConfigurationActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildRoleMemberCounts,
  type ModifyGuildRoleInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  RoleConfigurationEvidenceError,
  RoleConfigurationExecutionError,
  RoleConfigurationOperationConflictError,
  RoleConfigurationPlanChangedError,
} from "./errors.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  discordPermissionBitfield,
  discordPermissionNames,
  evaluateGuildMemberPermissions,
  hasGuildPermission,
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
  canonicalPermissionNames,
  DiscordRoleEvidenceError,
  logicalRoleNameKey,
  normalizeDiscordRole,
  normalizeDiscordRoleInventory,
  ROLE_CREATION_HIGH_RISK_PERMISSIONS,
  type NormalizedDiscordRole,
} from "./role-administration-service.js"
import {
  readRoleIconFileSnapshot,
  RoleIconFileError,
  type RoleIconFileReview,
  type RoleIconFileSnapshot,
} from "./role-icon-file.js"
import { assertRoleIconUnicodeEmoji } from "./role-icon.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export const ROLE_CONFIGURATION_REQUEST_FIELDS = [
  "grantPermissions",
  "hoist",
  "mentionable",
  "name",
  "primaryColor",
  "revokePermissions",
  "roleIcon",
  "secondaryColor",
  "tertiaryColor",
] as const

export type RoleConfigurationRequestField = typeof ROLE_CONFIGURATION_REQUEST_FIELDS[number]

export const ROLE_CONFIGURATION_CHANGED_FIELDS = [
  "colors",
  "hoist",
  "mentionable",
  "name",
  "permissions",
  "roleIcon",
] as const

export type RoleConfigurationChangedField = typeof ROLE_CONFIGURATION_CHANGED_FIELDS[number]

export const ROLE_HOLOGRAPHIC_COLORS = Object.freeze({
  primaryColor: 11_127_295,
  secondaryColor: 16_759_788,
  tertiaryColor: 16_761_760,
})

const STATE_UNAVAILABLE = "role-configuration-state-unavailable"
const ENHANCED_ROLE_COLORS_FEATURE = "ENHANCED_ROLE_COLORS"
const ROLE_ICONS_FEATURE = "ROLE_ICONS"
const GUILD_NAME_CHARACTERS = 100
const USERNAME_CHARACTERS = 32
const ROLE_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const ROLE_CONFIGURATION_REQUEST_KEYS = [
  "auditReason",
  "grantPermissions",
  "guildId",
  "hoist",
  "mentionable",
  "name",
  "operationKey",
  "primaryColor",
  "revokePermissions",
  "roleIcon",
  "roleId",
  "secondaryColor",
  "tertiaryColor",
] as const
const ROLE_CONFIGURATION_LOCKS = new Map<string, Promise<RoleConfigurationTargetOutcome>>()
const ROLE_CONFIGURATION_UNCERTAIN_TARGETS = new Set<string>()
const HIGH_RISK_PERMISSION_SET = new Set<DiscordPermissionName>([
  "ADMINISTRATOR",
  ...ROLE_CREATION_HIGH_RISK_PERMISSIONS,
])

type RoleConfigurationTargetOutcome = "settled" | "uncertain"

export interface RoleConfigurationRequest {
  auditReason: string
  grantPermissions?: readonly DiscordPermissionName[]
  guildId: string
  hoist?: boolean
  mentionable?: boolean
  name?: string
  operationKey: string
  primaryColor?: number
  revokePermissions?: readonly DiscordPermissionName[]
  roleIcon?: RoleConfigurationIconRequest
  roleId: string
  secondaryColor?: number | null
  tertiaryColor?: number | null
}

export type RoleConfigurationIconRequest =
  | { kind: "clear" }
  | { filePath: string; kind: "local-image" }
  | { kind: "unicode"; value: string }

export type RoleConfigurationObservedIcon =
  | { kind: "image"; imageHash: string }
  | { kind: "none" }
  | { kind: "unicode"; value: string }

export type RoleConfigurationDesiredIcon =
  | RoleConfigurationObservedIcon
  | {
      contentDigest: string
      kind: "local-image"
    }

export interface NormalizedRoleConfigurationRequest extends RoleConfigurationRequest {
  grantPermissions: DiscordPermissionName[]
  operationKeyHash: string
  requestedFields: RoleConfigurationRequestField[]
  revokePermissions: DiscordPermissionName[]
}

export interface RoleConfigurationChange {
  after: unknown
  before: unknown
  field: RoleConfigurationChangedField
}

export interface RoleConfigurationPermissionEvidence {
  botAdministrator: boolean
  botEffectivePermissionNames: DiscordPermissionName[]
  botEffectivePermissions: string
  botHighestRoleIds: string[]
  botHighestRolePosition: number
  botRoleIds: string[]
  desiredPermissionSubset: boolean
  guildManageRoles: true
  permissionChangeRequired: boolean
  postChangeBotEffectivePermissionNames: DiscordPermissionName[]
  postChangeBotEffectivePermissions: string
  postChangeGuildManageRoles: true
  targetBelowBot: true
  targetHeldByBot: boolean
}

export interface RoleConfigurationPlan {
  applicationId: string
  auditReason: string
  botId: string
  changedFields: RoleConfigurationChangedField[]
  changes: RoleConfigurationChange[]
  createdAt: string
  current: NormalizedDiscordRole
  currentRoleIcon: RoleConfigurationObservedIcon
  desired: NormalizedDiscordRole
  desiredRoleIcon: RoleConfigurationDesiredIcon
  digest: string
  grantedPermissions: DiscordPermissionName[]
  guild: {
    features: string[]
    id: string
    name: string
    ownerId: string
  }
  highRiskGrantedPermissions: DiscordPermissionName[]
  highRiskRevokedPermissions: DiscordPermissionName[]
  memberCount: number
  nameCollisionRoleIds: string[]
  operationKeyHash: string
  permission: RoleConfigurationPermissionEvidence
  privacy: {
    memberIdentities: "not-fetched"
    persistence: "content-free-only"
    rawPayloads: "omitted"
    text: "transient"
  }
  roleIconFile: {
    contentDigest: string
    review: RoleIconFileReview
  } | null
  requestedFields: RoleConfigurationRequestField[]
  requestedGrantPermissions: DiscordPermissionName[]
  requestedRevokePermissions: DiscordPermissionName[]
  revokedPermissions: DiscordPermissionName[]
  risks: string[]
  roleId: string
  schemaVersion: number
  status: "already-current" | "planned"
  warnings: string[]
  verificationMode: "exact" | "response-bound-image-hash"
  writeRequired: boolean
}

export interface RoleConfigurationResult {
  activityId: string | null
  guildId: string
  inventoryMatched: boolean
  memberCount: number
  memberCountsMatched: boolean
  observed: NormalizedDiscordRole
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: boolean
  roleId: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
}

export interface RoleConfigurationServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildMember"
  | "getGuildRole"
  | "getGuildRoleMemberCounts"
  | "getGuildRoles"
  | "modifyGuildRole"
> {}

export interface RoleConfigurationServiceOptions {
  activityStore: ActivityStore
  client: RoleConfigurationServiceClient
  clock?: () => Date
  fileRoots: readonly string[]
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<ScopePolicy, "assertRoleConfigurationAllowed">
  randomId?: () => string
}

interface ValidatedGuild extends DiscordGuild {
  features: string[]
  owner_id: string
}

interface RoleConfigurationState {
  botMember: DiscordGuildMember
  botPermissions: GuildMemberPermissionResult
  counts: DiscordGuildRoleMemberCounts
  guild: ValidatedGuild
  memberCount: number
  permission: RoleConfigurationPermissionEvidence
  roles: NormalizedDiscordRole[]
  target: NormalizedDiscordRole
}

interface BuiltRoleConfigurationPlan {
  expectedCounts: DiscordGuildRoleMemberCounts
  fileSnapshot: RoleIconFileSnapshot | null
  plan: RoleConfigurationPlan
  request: NormalizedRoleConfigurationRequest
  reviewedInventory: NormalizedDiscordRole[]
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

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function assertRoleName(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > DISCORD_LIMITS.roleNameCharacters
    || value.trim() !== value
    || ROLE_NAME_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
    || logicalRoleNameKey(value) === logicalRoleNameKey("@everyone")
  ) {
    throw new RangeError("Discord role-configuration name is invalid or reserved")
  }
}

function assertColor(value: unknown, name: string): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value > DISCORD_LIMITS.roleColor
  ) {
    throw new RangeError(`${name} must be an integer between 0 and ${DISCORD_LIMITS.roleColor}`)
  }
}

function explicitPermissionNames(
  value: readonly DiscordPermissionName[] | undefined,
  name: string,
): DiscordPermissionName[] {
  if (value === undefined) return []
  const result = canonicalPermissionNames(value)
  if (result.length < 1) {
    throw new RangeError(`${name} must contain at least one permission name when provided`)
  }
  return result
}

function normalizeRoleIconRequest(
  value: RoleConfigurationIconRequest,
): RoleConfigurationIconRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord role icon intent must be an exact tagged object")
  }
  const record = value as unknown as Record<string, unknown>
  if (
    value.kind === "clear"
    && Object.keys(record).sort().join("\0") === "kind"
  ) {
    return { kind: "clear" }
  }
  if (
    value.kind === "local-image"
    && Object.keys(record).sort().join("\0") === "filePath\0kind"
    && typeof value.filePath === "string"
    && value.filePath.length > 0
    && value.filePath.length <= CONNECTOR_LIMITS.attachmentPathCharacters
    && value.filePath.trim() === value.filePath
    && !value.filePath.includes("\0")
    && isAbsolute(value.filePath)
  ) {
    return { filePath: value.filePath, kind: "local-image" }
  }
  if (
    value.kind === "unicode"
    && Object.keys(record).sort().join("\0") === "kind\0value"
  ) {
    assertRoleIconUnicodeEmoji(value.value)
    return { kind: "unicode", value: value.value }
  }
  throw new RangeError("Discord role icon intent is invalid")
}

export function normalizeRoleConfigurationRequest(
  request: RoleConfigurationRequest,
): NormalizedRoleConfigurationRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord role-configuration request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, ROLE_CONFIGURATION_REQUEST_KEYS)
    || typeof request.auditReason !== "string"
    || typeof request.operationKey !== "string"
  ) {
    throw new RangeError("Discord role-configuration request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord role-configuration guild ID")
  assertPositiveSnowflake(request.roleId, "Discord role-configuration role ID")
  encodeDiscordAuditReason(request.auditReason)
  const requestedFields = ROLE_CONFIGURATION_REQUEST_FIELDS.filter((field) => (
    Object.hasOwn(record, field)
  ))
  if (requestedFields.length < 1) {
    throw new RangeError("Discord role configuration requires at least one explicit field")
  }
  if (requestedFields.some((field) => record[field] === undefined)) {
    throw new RangeError("Discord role-configuration fields cannot be undefined")
  }
  if (Object.hasOwn(record, "name")) assertRoleName(request.name)
  if (Object.hasOwn(record, "primaryColor")) {
    assertColor(request.primaryColor, "Discord role primary color")
  }
  for (const field of ["secondaryColor", "tertiaryColor"] as const) {
    if (Object.hasOwn(record, field) && request[field] !== null) {
      assertColor(request[field], `Discord role ${field}`)
    }
  }
  if (Object.hasOwn(record, "hoist") && typeof request.hoist !== "boolean") {
    throw new RangeError("Discord role hoist setting must be a boolean")
  }
  if (Object.hasOwn(record, "mentionable") && typeof request.mentionable !== "boolean") {
    throw new RangeError("Discord role mentionable setting must be a boolean")
  }
  const roleIcon = Object.hasOwn(record, "roleIcon")
    ? normalizeRoleIconRequest(request.roleIcon as RoleConfigurationIconRequest)
    : undefined
  const grantPermissions = explicitPermissionNames(
    request.grantPermissions,
    "Discord role permission grants",
  )
  const revokePermissions = explicitPermissionNames(
    request.revokePermissions,
    "Discord role permission revocations",
  )
  if (grantPermissions.includes("ADMINISTRATOR")) {
    throw new RangeError("Discord role configuration never grants ADMINISTRATOR")
  }
  const revokeSet = new Set(revokePermissions)
  const overlap = grantPermissions.find((permission) => revokeSet.has(permission))
  if (overlap) {
    throw new RangeError(`Discord permission ${overlap} cannot be granted and revoked together`)
  }
  return {
    auditReason: request.auditReason,
    grantPermissions,
    guildId: request.guildId,
    ...(Object.hasOwn(record, "hoist") ? { hoist: request.hoist } : {}),
    ...(Object.hasOwn(record, "mentionable") ? { mentionable: request.mentionable } : {}),
    ...(Object.hasOwn(record, "name") ? { name: request.name } : {}),
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    ...(Object.hasOwn(record, "primaryColor")
      ? { primaryColor: request.primaryColor }
      : {}),
    requestedFields,
    revokePermissions,
    ...(roleIcon ? { roleIcon } : {}),
    roleId: request.roleId,
    ...(Object.hasOwn(record, "secondaryColor")
      ? { secondaryColor: request.secondaryColor }
      : {}),
    ...(Object.hasOwn(record, "tertiaryColor")
      ? { tertiaryColor: request.tertiaryColor }
      : {}),
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
    || ROLE_NAME_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
    || !positiveSnowflake(value.owner_id)
    || !Array.isArray(value.features)
    || value.features.length > DISCORD_LIMITS.guildFeatures
    || value.features.some((feature) => (
      typeof feature !== "string"
      || feature.length < 1
      || feature.length > DISCORD_LIMITS.guildFeatureCharacters
      || !/^[A-Z0-9_]+$/u.test(feature)
    ))
    || new Set(value.features).size !== value.features.length
  ) {
    throw new RoleConfigurationEvidenceError(
      "Discord returned invalid role-configuration guild evidence",
    )
  }
  return {
    id: value.id,
    name: value.name,
    owner_id: value.owner_id,
    features: [...value.features].sort(),
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
    || typeof value.user.username !== "string"
    || value.user.username.length < 1
    || value.user.username.length > USERNAME_CHARACTERS
    || ROLE_NAME_CONTROL_PATTERN.test(value.user.username)
    || !validUnicode(value.user.username)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !positiveSnowflake(roleId) || !roleIds.has(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw new RoleConfigurationEvidenceError(
      "Discord returned invalid connector membership evidence for role configuration",
    )
  }
  return {
    roles: [...value.roles].sort(compareSnowflakes),
    user: {
      bot: true,
      id: botId,
      username: value.user.username,
    },
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function exactCounts(
  counts: DiscordGuildRoleMemberCounts,
  roles: readonly NormalizedDiscordRole[],
  guildId: string,
): DiscordGuildRoleMemberCounts {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    throw new RoleConfigurationEvidenceError("Discord returned invalid role member-count evidence")
  }
  const expectedIds = roles
    .map((role) => role.id)
    .filter((roleId) => roleId !== guildId)
    .sort(compareSnowflakes)
  const actualIds = Object.keys(counts)
  if (
    actualIds.length > DISCORD_LIMITS.guildRoles - 1
    || actualIds.some((roleId) => !positiveSnowflake(roleId) || roleId === guildId)
  ) {
    throw new RoleConfigurationEvidenceError(
      "Discord role member-count evidence contains invalid role identities",
    )
  }
  actualIds.sort(compareSnowflakes)
  if (stableString(actualIds) !== stableString(expectedIds)) {
    throw new RoleConfigurationEvidenceError(
      "Discord role member-count evidence does not match the complete role inventory",
    )
  }
  const projected: Record<string, number> = {}
  for (const roleId of actualIds) {
    const count = counts[roleId]
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new RoleConfigurationEvidenceError("Discord returned invalid role member-count evidence")
    }
    projected[roleId] = count
  }
  return projected
}

function rawRoleWithPermissions(
  roles: readonly DiscordRole[],
  roleId: string,
  permissions: string,
): DiscordRole[] {
  return roles.map((role) => role.id === roleId ? { ...role, permissions } : role)
}

function exactPermissions(
  guildId: string,
  member: DiscordGuildMember,
  roles: readonly DiscordRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({
      guildId,
      member,
      roles,
    })
  } catch (error) {
    throw new RoleConfigurationEvidenceError(
      "Discord connector permission evidence is invalid for role configuration",
      { cause: error },
    )
  }
  if (!result.complete) {
    throw new RoleConfigurationEvidenceError(
      `Discord connector permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  return result
}

function colorsValidForGuild(
  role: NormalizedDiscordRole,
  features: readonly string[],
): void {
  const { primaryColor, secondaryColor, tertiaryColor } = role.colors
  if (
    (secondaryColor !== null || tertiaryColor !== null)
    && !features.includes(ENHANCED_ROLE_COLORS_FEATURE)
  ) {
    throw new RoleConfigurationEvidenceError(
      "Discord role gradient colors require the ENHANCED_ROLE_COLORS guild feature",
    )
  }
  if (
    tertiaryColor !== null
    && (
      primaryColor !== ROLE_HOLOGRAPHIC_COLORS.primaryColor
      || secondaryColor !== ROLE_HOLOGRAPHIC_COLORS.secondaryColor
      || tertiaryColor !== ROLE_HOLOGRAPHIC_COLORS.tertiaryColor
    )
  ) {
    throw new RoleConfigurationEvidenceError(
      "Discord role tertiary color requires the documented holographic color triple",
    )
  }
}

function observedRoleIcon(role: NormalizedDiscordRole): RoleConfigurationObservedIcon {
  if (role.icon !== null) return { imageHash: role.icon, kind: "image" }
  if (role.unicodeEmoji !== null) return { kind: "unicode", value: role.unicodeEmoji }
  return { kind: "none" }
}

function plannedRoleIcon(
  current: NormalizedDiscordRole,
  request: NormalizedRoleConfigurationRequest,
  fileSnapshot: RoleIconFileSnapshot | null,
): RoleConfigurationDesiredIcon {
  if (!request.roleIcon) return observedRoleIcon(current)
  if (request.roleIcon.kind === "clear") return { kind: "none" }
  if (request.roleIcon.kind === "unicode") {
    return { kind: "unicode", value: request.roleIcon.value }
  }
  if (!fileSnapshot) {
    throw new RoleConfigurationEvidenceError(
      "Discord role icon image evidence is unavailable",
    )
  }
  return {
    contentDigest: fileSnapshot.contentDigest,
    kind: "local-image",
  }
}

function desiredRole(
  current: NormalizedDiscordRole,
  request: NormalizedRoleConfigurationRequest,
  features: readonly string[],
): NormalizedDiscordRole {
  if (
    request.roleIcon
    && request.roleIcon.kind !== "clear"
    && !features.includes(ROLE_ICONS_FEATURE)
  ) {
    throw new RoleConfigurationEvidenceError(
      "Discord role icons require the ROLE_ICONS guild feature",
    )
  }
  const colors = {
    primaryColor: request.primaryColor ?? current.colors.primaryColor,
    secondaryColor: Object.hasOwn(request, "secondaryColor")
      ? request.secondaryColor as number | null
      : current.colors.secondaryColor,
    tertiaryColor: Object.hasOwn(request, "tertiaryColor")
      ? request.tertiaryColor as number | null
      : current.colors.tertiaryColor,
  }
  const currentBits = BigInt(current.permissions)
  const grantBits = discordPermissionBitfield(request.grantPermissions)
  const revokeBits = discordPermissionBitfield(request.revokePermissions)
  const desiredBits = (currentBits | grantBits) & ~revokeBits
  const desired: NormalizedDiscordRole = {
    ...current,
    colors,
    ...(request.hoist !== undefined ? { hoist: request.hoist } : {}),
    ...(request.mentionable !== undefined ? { mentionable: request.mentionable } : {}),
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.roleIcon?.kind === "clear"
      ? { icon: null, unicodeEmoji: null }
      : request.roleIcon?.kind === "unicode"
        ? { icon: null, unicodeEmoji: request.roleIcon.value }
        : {}),
    permissionNames: discordPermissionNames(desiredBits),
    permissions: desiredBits.toString(),
  }
  colorsValidForGuild(desired, features)
  return desired
}

function permissionValue(role: NormalizedDiscordRole) {
  return {
    names: role.permissionNames,
    permissions: role.permissions,
    unknownPermissionBits: role.unknownPermissionBits,
  }
}

function roleChanges(
  current: NormalizedDiscordRole,
  desired: NormalizedDiscordRole,
  currentIcon: RoleConfigurationObservedIcon,
  desiredIcon: RoleConfigurationDesiredIcon,
): RoleConfigurationChange[] {
  const candidates: RoleConfigurationChange[] = [
    { after: desired.colors, before: current.colors, field: "colors" },
    { after: desired.hoist, before: current.hoist, field: "hoist" },
    { after: desired.mentionable, before: current.mentionable, field: "mentionable" },
    { after: desired.name, before: current.name, field: "name" },
    { after: permissionValue(desired), before: permissionValue(current), field: "permissions" },
    { after: desiredIcon, before: currentIcon, field: "roleIcon" },
  ]
  return candidates.filter(({ after, before }) => stableString(after) !== stableString(before))
}

function roleSnapshot(role: NormalizedDiscordRole) {
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
    permissions: role.permissions,
    position: role.position,
    unicodeEmoji: role.unicodeEmoji,
    unknownFieldCount: role.unknownFieldCount,
    unknownPermissionBits: role.unknownPermissionBits,
  }
}

function inventorySnapshot(roles: readonly NormalizedDiscordRole[]) {
  return [...roles]
    .sort((left, right) => compareSnowflakes(left.id, right.id))
    .map(roleSnapshot)
}

function inventoryWithDesired(
  roles: readonly NormalizedDiscordRole[],
  desired: NormalizedDiscordRole,
): NormalizedDiscordRole[] {
  return roles.map((role) => role.id === desired.id ? desired : role)
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

function actualPermissionDelta(
  current: NormalizedDiscordRole,
  desired: NormalizedDiscordRole,
): { granted: DiscordPermissionName[]; revoked: DiscordPermissionName[] } {
  const currentBits = BigInt(current.permissions)
  const desiredBits = BigInt(desired.permissions)
  return {
    granted: discordPermissionNames(desiredBits & ~currentBits),
    revoked: discordPermissionNames(currentBits & ~desiredBits),
  }
}

function patchInput(
  desired: NormalizedDiscordRole,
  changedFields: readonly RoleConfigurationChangedField[],
  request: NormalizedRoleConfigurationRequest,
  fileSnapshot: RoleIconFileSnapshot | null,
): ModifyGuildRoleInput {
  const fields = new Set(changedFields)
  let roleIcon: ModifyGuildRoleInput["roleIcon"]
  if (fields.has("roleIcon")) {
    if (request.roleIcon?.kind === "clear") {
      roleIcon = { kind: "clear" }
    } else if (request.roleIcon?.kind === "unicode") {
      roleIcon = { kind: "unicode", value: request.roleIcon.value }
    } else if (request.roleIcon?.kind === "local-image" && fileSnapshot) {
      roleIcon = {
        bytes: fileSnapshot.bytes,
        format: fileSnapshot.review.format,
        kind: "image",
      }
    } else {
      throw new RoleConfigurationEvidenceError(
        "Discord role icon mutation evidence is unavailable",
      )
    }
  }
  return {
    ...(fields.has("colors") ? { colors: desired.colors } : {}),
    ...(fields.has("hoist") ? { hoist: desired.hoist } : {}),
    ...(fields.has("mentionable") ? { mentionable: desired.mentionable } : {}),
    ...(fields.has("name") ? { name: desired.name } : {}),
    ...(fields.has("permissions") ? { permissions: desired.permissions } : {}),
    ...(roleIcon ? { roleIcon } : {}),
  }
}

function responseBoundDesiredRole(
  plan: RoleConfigurationPlan,
  response: NormalizedDiscordRole,
): NormalizedDiscordRole | null {
  if (plan.desiredRoleIcon.kind !== "local-image") return plan.desired
  if (response.icon === null || response.unicodeEmoji !== null) return null
  return {
    ...plan.desired,
    icon: response.icon,
    unicodeEmoji: null,
  }
}

function roleMatches(left: NormalizedDiscordRole, right: NormalizedDiscordRole): boolean {
  return stableString(roleSnapshot(left)) === stableString(roleSnapshot(right))
}

function inventoryMatches(
  left: readonly NormalizedDiscordRole[],
  right: readonly NormalizedDiscordRole[],
): boolean {
  return stableString(inventorySnapshot(left)) === stableString(inventorySnapshot(right))
}

function targetLockKey(request: NormalizedRoleConfigurationRequest): string {
  return `${request.guildId}\0${request.roleId}`
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
    roleId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: RoleConfigurationPlan
  request: NormalizedRoleConfigurationRequest
  status: RoleConfigurationActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): RoleConfigurationActivity {
  return {
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "role-configuration",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    requestedFields: [...options.request.requestedFields].sort(),
    roleId: options.request.roleId,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: RoleConfigurationPlan
  request: NormalizedRoleConfigurationRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "role-configuration",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.request.roleId,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof RoleConfigurationExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withRoleLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => RoleConfigurationExecutionError,
): Promise<T> {
  const prior = ROLE_CONFIGURATION_LOCKS.get(key)
    ?? Promise.resolve(
      ROLE_CONFIGURATION_UNCERTAIN_TARGETS.has(key)
        ? "uncertain" as const
        : "settled" as const,
    )
  let release: (outcome: RoleConfigurationTargetOutcome) => void = () => undefined
  const tail = new Promise<RoleConfigurationTargetOutcome>((resolve) => {
    release = resolve
  })
  ROLE_CONFIGURATION_LOCKS.set(key, tail)
  let outcome: RoleConfigurationTargetOutcome = "settled"
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
    if (outcome === "uncertain") ROLE_CONFIGURATION_UNCERTAIN_TARGETS.add(key)
    release(outcome)
    if (ROLE_CONFIGURATION_LOCKS.get(key) === tail) {
      ROLE_CONFIGURATION_LOCKS.delete(key)
    }
  }
}

export class RoleConfigurationService {
  readonly #activityStore: ActivityStore
  readonly #client: RoleConfigurationServiceClient
  readonly #clock: () => Date
  readonly #fileRoots: readonly string[]
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: RoleConfigurationServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: RoleConfigurationServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#fileRoots = [...options.fileRoots]
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    botId: string,
    request: NormalizedRoleConfigurationRequest,
    options: RequestOptions,
  ): Promise<RoleConfigurationState> {
    this.#policy.assertRoleConfigurationAllowed(request.guildId, request.roleId)
    const existingReceipt = await this.#operationStore.get(
      "role-configuration",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new RoleConfigurationOperationConflictError(receiptView(existingReceipt))
    }
    const [guildValue, memberValue, rawRoles, countsValue] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildRoles(request.guildId, options),
      this.#client.getGuildRoleMemberCounts(request.guildId, options),
    ])
    const guild = exactGuild(guildValue, request.guildId)
    let roles: NormalizedDiscordRole[]
    try {
      roles = normalizeDiscordRoleInventory(rawRoles, request.guildId)
    } catch (error) {
      throw new RoleConfigurationEvidenceError(
        "Discord returned invalid role inventory evidence for configuration",
        { cause: error },
      )
    }
    const botMember = exactBotMember(memberValue, botId, roles, request.guildId)
    const counts = exactCounts(countsValue, roles, request.guildId)
    const target = roles.find((role) => role.id === request.roleId)
    if (!target) {
      throw new RoleConfigurationEvidenceError(
        "Discord role-configuration target is absent from the complete role inventory",
      )
    }
    if (
      target.id === request.guildId
      || target.managed
      || target.management.type !== "standard"
    ) {
      throw new RoleConfigurationEvidenceError(
        "Discord role configuration supports only standard unmanaged roles other than @everyone",
      )
    }
    if (target.unknownFieldCount !== 0) {
      throw new RoleConfigurationEvidenceError(
        "Discord role configuration is blocked by unknown target fields",
      )
    }
    colorsValidForGuild(target, guild.features)
    const botPermissions = exactPermissions(request.guildId, botMember, rawRoles)
    if (!hasGuildPermission(botPermissions, "MANAGE_ROLES")) {
      throw new RoleConfigurationEvidenceError(
        "Discord connector lacks guild-level MANAGE_ROLES for role configuration",
      )
    }
    if (botPermissions.highestRolePosition <= target.position) {
      throw new RoleConfigurationEvidenceError(
        "Discord connector highest role must be strictly above the configuration target",
      )
    }
    const memberCount = counts[target.id]
    if (memberCount === undefined) {
      throw new RoleConfigurationEvidenceError(
        "Discord role member-count evidence omitted the configuration target",
      )
    }
    const desired = desiredRole(target, request, guild.features)
    const permissionFieldsRequested = request.requestedFields.includes("grantPermissions")
      || request.requestedFields.includes("revokePermissions")
    const permissionsChange = permissionFieldsRequested
      && desired.permissions !== target.permissions
    if (permissionsChange && target.unknownPermissionBits !== "0") {
      throw new RoleConfigurationEvidenceError(
        "Discord role permission changes are blocked by unknown permission bits",
      )
    }
    const grantableBits = botPermissions.administrator
      ? BigInt(botPermissions.effectivePermissions) | ALL_KNOWN_PERMISSION_BITS
      : BigInt(botPermissions.effectivePermissions)
    const desiredKnownBits = BigInt(desired.permissions) & ALL_KNOWN_PERMISSION_BITS
    const desiredPermissionSubset = (desiredKnownBits & ~grantableBits) === 0n
    if (permissionsChange && !desiredPermissionSubset) {
      throw new RoleConfigurationEvidenceError(
        "Discord connector cannot grant the complete desired role permission set",
      )
    }
    const postChangePermissions = exactPermissions(
      request.guildId,
      botMember,
      rawRoleWithPermissions(rawRoles, target.id, desired.permissions),
    )
    if (!hasGuildPermission(postChangePermissions, "MANAGE_ROLES")) {
      throw new RoleConfigurationEvidenceError(
        "Discord role configuration would remove the connector's MANAGE_ROLES authority",
      )
    }
    return {
      botMember,
      botPermissions,
      counts,
      guild,
      memberCount,
      permission: {
        botAdministrator: botPermissions.administrator,
        botEffectivePermissionNames: botPermissions.effectivePermissionNames,
        botEffectivePermissions: botPermissions.effectivePermissions,
        botHighestRoleIds: botPermissions.highestRoleIds,
        botHighestRolePosition: botPermissions.highestRolePosition,
        botRoleIds: [...botMember.roles].sort(compareSnowflakes),
        desiredPermissionSubset,
        guildManageRoles: true,
        permissionChangeRequired: permissionsChange,
        postChangeBotEffectivePermissionNames: postChangePermissions.effectivePermissionNames,
        postChangeBotEffectivePermissions: postChangePermissions.effectivePermissions,
        postChangeGuildManageRoles: true,
        targetBelowBot: true,
        targetHeldByBot: botMember.roles.includes(target.id),
      },
      roles,
      target,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedRoleConfigurationRequest,
    options: RequestOptions,
  ): Promise<BuiltRoleConfigurationPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(botId, request, options)
    const fileSnapshot = request.roleIcon?.kind === "local-image"
      ? await readRoleIconFileSnapshot({
          filePath: request.roleIcon.filePath,
          planKey: this.#planKey,
          roots: this.#fileRoots,
        })
      : null
    const desired = desiredRole(state.target, request, state.guild.features)
    const currentRoleIcon = observedRoleIcon(state.target)
    const desiredRoleIcon = plannedRoleIcon(state.target, request, fileSnapshot)
    const changes = roleChanges(
      state.target,
      desired,
      currentRoleIcon,
      desiredRoleIcon,
    )
    const changedFields = changes.map(({ field }) => field)
    const delta = actualPermissionDelta(state.target, desired)
    const nameCollisionRoleIds = state.roles
      .filter((role) => (
        role.id !== state.target.id
        && logicalRoleNameKey(role.name) === logicalRoleNameKey(desired.name)
      ))
      .map((role) => role.id)
      .sort(compareSnowflakes)
    const highRiskGrantedPermissions = delta.granted.filter((permission) => (
      HIGH_RISK_PERMISSION_SET.has(permission)
    ))
    const highRiskRevokedPermissions = delta.revoked.filter((permission) => (
      HIGH_RISK_PERMISSION_SET.has(permission)
    ))
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: memberSnapshot(state.botMember),
      counts: state.counts,
      current: roleSnapshot(state.target),
      currentRoleIcon,
      desired: roleSnapshot(desired),
      desiredRoleIcon,
      file: fileSnapshot
        ? {
            binding: fileSnapshot.binding,
            contentDigest: fileSnapshot.contentDigest,
            review: fileSnapshot.review,
          }
        : null,
      guild: {
        features: state.guild.features,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      inventory: inventorySnapshot(state.roles),
      nameCollisionRoleIds,
      permission: state.permission,
      request: {
        auditReason: request.auditReason,
        grantPermissions: request.grantPermissions,
        guildId: request.guildId,
        operationKeyHash: request.operationKeyHash,
        requestedFields: request.requestedFields,
        revokePermissions: request.revokePermissions,
        roleIcon: request.roleIcon ?? null,
        roleId: request.roleId,
      },
    })
    const warnings = [
      `The role is held by ${state.memberCount} guild members; configuration changes affect every holder`,
      ...(state.permission.botAdministrator
        ? ["Discord connector has ADMINISTRATOR; replace it with narrowly scoped MANAGE_ROLES and only the permissions this workflow may grant"]
        : []),
      ...(state.permission.targetHeldByBot
        ? ["The connector holds this target role; the plan includes and preserves post-change MANAGE_ROLES authority"]
        : []),
      ...(desired.mentionable && state.target.mentionable !== desired.mentionable
        ? ["Making this role mentionable can increase notification-abuse risk"]
        : []),
      ...(highRiskGrantedPermissions.length > 0
        ? [`High-risk permissions added: ${highRiskGrantedPermissions.join(", ")}`]
        : []),
      ...(highRiskRevokedPermissions.length > 0
        ? [`High-risk permissions removed: ${highRiskRevokedPermissions.join(", ")}`]
        : []),
      ...(nameCollisionRoleIds.length > 0
        ? [`The desired logical name collides with role IDs: ${nameCollisionRoleIds.join(", ")}`]
        : []),
      ...(delta.granted.length > 0 || delta.revoked.length > 0
        ? ["Guild-level permission changes can alter effective channel access through existing overwrites; use the channel-role access audit for sensitive channels"]
        : []),
      ...(fileSnapshot
        ? ["Discord assigns the role icon hash; verification binds the exact reviewed local bytes before the write, then requires the response hash to repeat in both exact readbacks"]
        : []),
      "Guild and role names are untrusted Discord text and are never persisted by this workflow",
      "Same-role serialization is process-local; do not run multiple connector processes with overlapping role-configuration scope",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const risks = [
      "The PATCH is not automatically retried, so an ambiguous transport outcome remains uncertain",
      "A successful response, exact role GET, complete role inventory, and holder-count readback are all checked against the reviewed state",
      "Role deletion, reordering, @everyone, managed roles, and role membership are outside this workflow",
    ]
    const plan: RoleConfigurationPlan = {
      applicationId,
      auditReason: request.auditReason,
      botId,
      changedFields,
      changes,
      createdAt: this.#clock().toISOString(),
      current: state.target,
      currentRoleIcon,
      desired,
      desiredRoleIcon,
      digest,
      grantedPermissions: delta.granted,
      guild: {
        features: state.guild.features,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      highRiskGrantedPermissions,
      highRiskRevokedPermissions,
      memberCount: state.memberCount,
      nameCollisionRoleIds,
      operationKeyHash: request.operationKeyHash,
      permission: state.permission,
      privacy: {
        memberIdentities: "not-fetched",
        persistence: "content-free-only",
        rawPayloads: "omitted",
        text: "transient",
      },
      roleIconFile: fileSnapshot
        ? {
            contentDigest: fileSnapshot.contentDigest,
            review: fileSnapshot.review,
          }
        : null,
      requestedFields: request.requestedFields,
      requestedGrantPermissions: request.grantPermissions,
      requestedRevokePermissions: request.revokePermissions,
      revokedPermissions: delta.revoked,
      risks,
      roleId: request.roleId,
      schemaVersion: SCHEMA_VERSION,
      status: changes.length === 0 ? "already-current" : "planned",
      warnings,
      verificationMode: fileSnapshot ? "response-bound-image-hash" : "exact",
      writeRequired: changes.length > 0,
    }
    return {
      expectedCounts: state.counts,
      fileSnapshot,
      plan,
      request,
      reviewedInventory: state.roles,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: RoleConfigurationRequest,
    options: RequestOptions = {},
  ): Promise<RoleConfigurationPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeRoleConfigurationRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  execute(
    applicationId: string,
    botId: string,
    request: RoleConfigurationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleConfigurationResult> {
    const normalized = normalizeRoleConfigurationRequest(request)
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord role-configuration plan digest is invalid")
    }
    const key = targetLockKey(normalized)
    return withRoleLock(
      key,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new RoleConfigurationExecutionError(
        "Discord role configuration was blocked because a prior same-role operation ended with an uncertain outcome",
        {
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          roleId: normalized.roleId,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedRoleConfigurationRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<RoleConfigurationResult> {
    let built: BuiltRoleConfigurationPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof RoleConfigurationEvidenceError
        || error instanceof DiscordRoleEvidenceError
        || error instanceof RoleIconFileError
        || error instanceof RangeError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new RoleConfigurationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const {
      expectedCounts,
      fileSnapshot,
      plan,
      reviewedInventory,
    } = built
    if (plan.digest !== expectedDigest) {
      throw new RoleConfigurationPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      roleId: request.roleId,
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        inventoryMatched: true,
        memberCount: plan.memberCount,
        memberCountsMatched: true,
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
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new RoleConfigurationOperationConflictError(receiptView(reservation.receipt))
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
      throw new RoleConfigurationExecutionError(
        "Discord role configuration was blocked because pending activity could not be recorded",
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
    let memberCount = plan.memberCount
    let responseMatched: boolean | null = null
    let readbackMatched: boolean | null = null
    let inventoryMatched: boolean | null = null
    let memberCountsMatched: boolean | null = null
    try {
      const response = normalizeDiscordRole(
        await this.#client.modifyGuildRole(
          request.guildId,
          request.roleId,
          patchInput(plan.desired, plan.changedFields, request, fileSnapshot),
          request.auditReason,
          options,
        ),
        request.guildId,
        request.roleId,
      )
      if (response.unknownFieldCount !== 0) {
        throw new RoleConfigurationEvidenceError(
          "Discord role-configuration response contains unknown fields",
        )
      }
      mutationCompleted = true
      const expectedRole = responseBoundDesiredRole(plan, response)
      responseMatched = expectedRole !== null && roleMatches(response, expectedRole)
      const [exactValue, inventoryValue, countsValue] = await Promise.all([
        this.#client.getGuildRole(request.guildId, request.roleId, options),
        this.#client.getGuildRoles(request.guildId, options),
        this.#client.getGuildRoleMemberCounts(request.guildId, options),
      ])
      const exact = normalizeDiscordRole(exactValue, request.guildId, request.roleId)
      const inventory = normalizeDiscordRoleInventory(inventoryValue, request.guildId)
      const counts = exactCounts(countsValue, inventory, request.guildId)
      const inventoryTarget = inventory.find((role) => role.id === request.roleId)
      if (!inventoryTarget) {
        throw new RoleConfigurationEvidenceError(
          "Discord role-configuration target disappeared during readback",
        )
      }
      observed = exact
      memberCount = counts[request.roleId] as number
      readbackMatched = expectedRole !== null
        && roleMatches(exact, expectedRole)
        && roleMatches(inventoryTarget, expectedRole)
      inventoryMatched = expectedRole !== null
        && inventoryMatches(
          inventory,
          inventoryWithDesired(reviewedInventory, expectedRole),
        )
      memberCountsMatched = stableString(counts) === stableString(expectedCounts)
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
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new RoleConfigurationExecutionError(
        "Discord role configuration did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          inventoryMatched,
          memberCount,
          memberCountsMatched,
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

    const verification = responseMatched
      && readbackMatched
      && inventoryMatched
      && memberCountsMatched
      ? "match"
      : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: RoleConfigurationResult = {
      ...baseResult,
      activityId,
      inventoryMatched: inventoryMatched as boolean,
      memberCount,
      memberCountsMatched: memberCountsMatched as boolean,
      observed,
      readbackMatched: readbackMatched as boolean,
      responseMatched: responseMatched as boolean,
      status,
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
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
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new RoleConfigurationExecutionError(
        "Discord role configuration completed but the operation receipt failed",
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
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new RoleConfigurationExecutionError(
        "Discord role configuration completed but the final activity record failed",
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
