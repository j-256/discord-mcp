import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  RoleCreationActivity,
  RoleCreationActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type CreateGuildRoleInput,
  type DiscordClient,
} from "./discord-client.js"
import {
  DiscordApiError,
  RoleCreationExecutionError,
  RoleCreationOperationConflictError,
  RoleCreationPlanChangedError,
  errorMessage,
} from "./errors.js"
import {
  assertGuildScaffoldAuthority,
  type GuildScaffoldAuthority,
} from "./guild-scaffold-authority.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  DISCORD_PERMISSION_NAMES,
  discordPermissionBitfield,
  discordPermissionNames,
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
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  DiscordRoleTags,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "role-creation-state-unavailable"
const ROLE_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const ROLE_CREATION_TARGET_LOCKS = new Map<
  string,
  Promise<RoleCreationTargetOutcome>
>()
const PERMISSION_ORDER = new Map(
  DISCORD_PERMISSION_NAMES.map((name, index) => [name, index]),
)
const ROLE_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "color",
  "colors",
  "flags",
  "hoist",
  "icon",
  "id",
  "managed",
  "mentionable",
  "name",
  "permissions",
  "position",
  "tags",
  "unicode_emoji",
])
const ROLE_COLOR_KEYS: ReadonlySet<string> = new Set([
  "primary_color",
  "secondary_color",
  "tertiary_color",
])
const ROLE_TAG_KEYS: ReadonlySet<string> = new Set([
  "available_for_purchase",
  "bot_id",
  "guild_connections",
  "integration_id",
  "premium_subscriber",
  "subscription_listing_id",
])

export const ROLE_CREATION_HIGH_RISK_PERMISSIONS = Object.freeze([
  "BAN_MEMBERS",
  "BYPASS_SLOWMODE",
  "CREATE_EVENTS",
  "CREATE_GUILD_EXPRESSIONS",
  "DEAFEN_MEMBERS",
  "KICK_MEMBERS",
  "MANAGE_CHANNELS",
  "MANAGE_EVENTS",
  "MANAGE_GUILD",
  "MANAGE_GUILD_EXPRESSIONS",
  "MANAGE_MESSAGES",
  "MANAGE_NICKNAMES",
  "MANAGE_ROLES",
  "MANAGE_THREADS",
  "MANAGE_WEBHOOKS",
  "MENTION_EVERYONE",
  "MODERATE_MEMBERS",
  "MOVE_MEMBERS",
  "MUTE_MEMBERS",
  "PIN_MESSAGES",
  "SET_VOICE_CHANNEL_STATUS",
  "VIEW_AUDIT_LOG",
  "VIEW_CREATOR_MONETIZATION_ANALYTICS",
] satisfies readonly DiscordPermissionName[])

const HIGH_RISK_PERMISSION_SET = new Set<DiscordPermissionName>(
  ROLE_CREATION_HIGH_RISK_PERMISSIONS,
)

type RoleCreationTargetOutcome = "settled" | "uncertain"
type RoleCreationAuthority = "direct" | "guild-scaffold"

export type RoleManagementType =
  | "bot"
  | "everyone"
  | "integration"
  | "linked"
  | "managed"
  | "premium"
  | "purchasable"
  | "standard"
  | "subscription"

export interface NormalizedDiscordRole {
  colors: {
    primaryColor: number
    secondaryColor: number | null
    tertiaryColor: number | null
  }
  flags: number
  hoist: boolean
  icon: string | null
  id: string
  managed: boolean
  management: {
    id: string | null
    type: RoleManagementType
  }
  mentionable: boolean
  name: string
  permissionNames: DiscordPermissionName[]
  permissions: string
  position: number
  unicodeEmoji: string | null
  unknownFieldCount: number
  unknownPermissionBits: string
}

export interface RoleCreationRequest {
  auditReason: string
  guildId: string
  hoist?: boolean
  mentionable?: boolean
  name: string
  operationKey: string
  permissions?: readonly DiscordPermissionName[]
  primaryColor?: number
}

export interface NormalizedRoleCreationRequest {
  auditReason: string
  guildId: string
  hoist: boolean
  mentionable: boolean
  name: string
  operationKey: string
  operationKeyHash: string
  permissionBits: string
  permissions: DiscordPermissionName[]
  primaryColor: number
}

export interface RoleCreationPlan {
  action: "create" | "none"
  auditReason: string
  createdAt: string
  digest: string
  existingRole: NormalizedDiscordRole | null
  guild: {
    features: string[]
    id: string
    name: string
    ownerId: string
  }
  highRiskPermissions: DiscordPermissionName[]
  operationKeyHash: string
  permission: {
    botAdministrator: boolean
    botEffectivePermissionNames: DiscordPermissionName[]
    botEffectivePermissions: string
    botHighestRoleIds: string[]
    botHighestRolePosition: number
    guildManageRoles: boolean
    requestedSubset: boolean
  }
  schemaVersion: number
  status: "already-current" | "planned"
  target: {
    hoist: boolean
    mentionable: boolean
    name: string
    permissionBits: string
    permissions: DiscordPermissionName[]
    primaryColor: number
  }
  visibleInventory: {
    guildLimit: number
    guildRoles: number
  }
  warnings: string[]
}

export interface RoleCreationResult {
  activityId: string | null
  guildId: string
  observed: NormalizedDiscordRole
  operationKeyHash: string
  planDigest: string
  roleId: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
}

export interface RoleAdministrationServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "createGuildRole"
    | "getGuild"
    | "getGuildMember"
    | "getGuildRole"
    | "getGuildRoles"
  >
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface RoleCreationState {
  botMember: DiscordGuildMember
  botPermissions: GuildMemberPermissionResult
  candidates: NormalizedDiscordRole[]
  exactRole: NormalizedDiscordRole | null
  guild: DiscordGuild
  guildFeatures: string[]
  roles: NormalizedDiscordRole[]
}

export class DiscordRoleEvidenceError extends Error {
  override name = "DiscordRoleEvidenceError"
}

class RoleCreationStateError extends Error {
  override name = "RoleCreationStateError"
}

class RoleCreationResponseIdentityError extends Error {
  override name = "RoleCreationResponseIdentityError"
}

function assertValidUnicode(value: string, name: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${name} contains invalid Unicode`, { cause: error })
  }
}

export function canonicalPermissionNames(
  value: readonly DiscordPermissionName[] | undefined,
): DiscordPermissionName[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new RangeError("Discord role permissions must be an array")
  }
  const known = new Set<DiscordPermissionName>(DISCORD_PERMISSION_NAMES)
  const result: DiscordPermissionName[] = []
  const seen = new Set<DiscordPermissionName>()
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== "string" || !known.has(entry as DiscordPermissionName)) {
      throw new RangeError("Discord role permissions contain an unknown permission name")
    }
    const permission = entry as DiscordPermissionName
    if (seen.has(permission)) {
      throw new RangeError(`Discord permission ${permission} is duplicated`)
    }
    seen.add(permission)
    result.push(permission)
  }
  return result.sort((left, right) => (
    (PERMISSION_ORDER.get(left) as number) - (PERMISSION_ORDER.get(right) as number)
  ))
}

export function normalizeRoleCreationRequest(
  request: RoleCreationRequest,
): NormalizedRoleCreationRequest {
  if (
    typeof request.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(request.guildId)
  ) {
    throw new RangeError("Discord role creation requires an exact guild snowflake")
  }
  if (
    typeof request.name !== "string"
    || request.name.length < 1
    || request.name.length > DISCORD_LIMITS.roleNameCharacters
    || request.name.trim() !== request.name
    || ROLE_NAME_CONTROL_PATTERN.test(request.name)
  ) {
    throw new RangeError(
      `Discord role name must contain 1-${DISCORD_LIMITS.roleNameCharacters} characters without surrounding whitespace or controls`,
    )
  }
  assertValidUnicode(request.name, "Discord role name")
  if (logicalRoleNameKey(request.name) === logicalRoleNameKey("@everyone")) {
    throw new RangeError("Discord role creation cannot target the reserved @everyone role")
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord role creation audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  if (request.hoist !== undefined && typeof request.hoist !== "boolean") {
    throw new RangeError("Discord role hoist setting must be a boolean")
  }
  if (
    request.mentionable !== undefined
    && typeof request.mentionable !== "boolean"
  ) {
    throw new RangeError("Discord role mentionable setting must be a boolean")
  }
  const primaryColor = request.primaryColor ?? 0
  if (
    !Number.isInteger(primaryColor)
    || primaryColor < 0
    || primaryColor > DISCORD_LIMITS.roleColor
  ) {
    throw new RangeError(
      `Discord role primary color must be an integer between 0 and ${DISCORD_LIMITS.roleColor}`,
    )
  }
  const permissions = canonicalPermissionNames(request.permissions)
  if (permissions.includes("ADMINISTRATOR")) {
    throw new RangeError("Discord role creation never grants ADMINISTRATOR")
  }
  return {
    auditReason: request.auditReason,
    guildId: request.guildId,
    hoist: request.hoist ?? false,
    mentionable: request.mentionable ?? false,
    name: request.name,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    permissionBits: discordPermissionBitfield(permissions).toString(),
    permissions,
    primaryColor,
  }
}

export function logicalRoleNameKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/gu, " ")
    .trim()
}

function validColor(value: unknown): value is number {
  return Number.isInteger(value)
    && (value as number) >= 0
    && (value as number) <= DISCORD_LIMITS.roleColor
}

function validNullableColor(value: unknown): value is number | null {
  return value === null || validColor(value)
}

function validNullableString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0)
}

function hasOwn(value: object, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, name)
}

function assertRoleTags(tags: DiscordRoleTags | undefined): number {
  if (tags === undefined) return 0
  if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
    throw new DiscordRoleEvidenceError("Discord role tags are invalid")
  }
  for (const field of ["bot_id", "integration_id", "subscription_listing_id"] as const) {
    const value = tags[field]
    if (value !== undefined && !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
      throw new DiscordRoleEvidenceError("Discord role tags contain an invalid snowflake")
    }
  }
  for (const field of [
    "available_for_purchase",
    "guild_connections",
    "premium_subscriber",
  ] as const) {
    if (hasOwn(tags, field) && tags[field] !== null) {
      throw new DiscordRoleEvidenceError("Discord role tags contain an invalid Boolean tag")
    }
  }
  return Object.keys(tags).filter((field) => !ROLE_TAG_KEYS.has(field)).length
}

function roleManagement(
  role: DiscordRole,
  guildId: string,
): NormalizedDiscordRole["management"] {
  if (role.id === guildId) return { id: null, type: "everyone" }
  const tags = role.tags
  if (tags?.bot_id) return { id: tags.bot_id, type: "bot" }
  if (tags?.integration_id) return { id: tags.integration_id, type: "integration" }
  if (tags?.subscription_listing_id) {
    return { id: tags.subscription_listing_id, type: "subscription" }
  }
  if (hasOwn(tags || {}, "premium_subscriber")) return { id: null, type: "premium" }
  if (hasOwn(tags || {}, "available_for_purchase")) {
    return { id: null, type: "purchasable" }
  }
  if (hasOwn(tags || {}, "guild_connections")) return { id: null, type: "linked" }
  if (role.managed) return { id: null, type: "managed" }
  return { id: null, type: "standard" }
}

export function normalizeDiscordRole(
  role: DiscordRole,
  guildId: string,
  expectedRoleId?: string,
): NormalizedDiscordRole {
  if (
    !role
    || typeof role !== "object"
    || typeof role.id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(role.id)
    || (expectedRoleId !== undefined && role.id !== expectedRoleId)
    || typeof role.name !== "string"
    || role.name.length < 1
    || role.name.length > DISCORD_LIMITS.roleNameCharacters
    || ROLE_NAME_CONTROL_PATTERN.test(role.name)
    || typeof role.managed !== "boolean"
    || typeof role.hoist !== "boolean"
    || typeof role.mentionable !== "boolean"
    || !Number.isInteger(role.position)
    || role.position < 0
    || !Number.isInteger(role.flags)
    || (role.flags as number) < 0
    || !validNullableString(role.icon ?? null)
    || !validNullableString(role.unicode_emoji ?? null)
    || (
      (role.icon ?? null) !== null
      && (role.unicode_emoji ?? null) !== null
    )
  ) {
    throw new DiscordRoleEvidenceError("Discord returned incomplete or invalid role evidence")
  }
  try {
    assertValidUnicode(role.name, "Discord returned role name")
    if (role.unicode_emoji) {
      assertValidUnicode(role.unicode_emoji, "Discord returned role emoji")
    }
  } catch (error) {
    throw new DiscordRoleEvidenceError(
      "Discord returned invalid Unicode in role evidence",
      { cause: error },
    )
  }
  const unknownTagFieldCount = assertRoleTags(role.tags)
  const colors = role.colors
  if (colors !== undefined && (!colors || typeof colors !== "object" || Array.isArray(colors))) {
    throw new DiscordRoleEvidenceError("Discord returned invalid role color evidence")
  }
  const primaryColor = colors?.primary_color ?? role.color
  const secondaryColor = colors?.secondary_color ?? null
  const tertiaryColor = colors?.tertiary_color ?? null
  if (
    !validColor(primaryColor)
    || !validNullableColor(secondaryColor)
    || !validNullableColor(tertiaryColor)
    || (role.color !== undefined && role.color !== primaryColor)
  ) {
    throw new DiscordRoleEvidenceError("Discord returned invalid role color evidence")
  }
  const unknownColorFieldCount = colors === undefined
    ? 0
    : Object.keys(colors).filter((field) => !ROLE_COLOR_KEYS.has(field)).length
  let permissionBits: bigint
  try {
    permissionBits = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
  } catch (error) {
    throw new DiscordRoleEvidenceError("Discord returned invalid role permission evidence", {
      cause: error,
    })
  }
  const management = roleManagement(role, guildId)
  if (management.type !== "standard" && management.type !== "everyone" && !role.managed) {
    throw new DiscordRoleEvidenceError("Discord role tags conflict with its managed state")
  }
  return {
    colors: {
      primaryColor,
      secondaryColor,
      tertiaryColor,
    },
    flags: role.flags as number,
    hoist: role.hoist,
    icon: role.icon ?? null,
    id: role.id,
    managed: role.managed,
    management,
    mentionable: role.mentionable,
    name: role.name,
    permissionNames: discordPermissionNames(permissionBits),
    permissions: permissionBits.toString(),
    position: role.position,
    unicodeEmoji: role.unicode_emoji ?? null,
    unknownFieldCount: Object.keys(role as unknown as Record<string, unknown>)
      .filter((field) => !ROLE_RESPONSE_KEYS.has(field)).length
      + unknownColorFieldCount
      + unknownTagFieldCount,
    unknownPermissionBits: unknownDiscordPermissionBits(permissionBits).toString(),
  }
}

function compareSnowflakesDescending(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  if (leftId === rightId) return 0
  return leftId > rightId ? -1 : 1
}

export function normalizeDiscordRoleInventory(
  roles: readonly DiscordRole[],
  guildId: string,
): NormalizedDiscordRole[] {
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > DISCORD_LIMITS.guildRoles) {
    throw new DiscordRoleEvidenceError("Discord returned an invalid bounded role inventory")
  }
  const normalized = roles.map((role) => normalizeDiscordRole(role, guildId))
  const ids = new Set<string>()
  for (const role of normalized) {
    if (ids.has(role.id)) {
      throw new DiscordRoleEvidenceError("Discord returned duplicate role IDs")
    }
    ids.add(role.id)
  }
  const everyone = normalized.filter((role) => role.id === guildId)
  if (
    everyone.length !== 1
    || everyone[0]?.position !== 0
    || everyone[0]?.name !== "@everyone"
    || everyone[0]?.managed
  ) {
    throw new DiscordRoleEvidenceError("Discord returned invalid @everyone role evidence")
  }
  return normalized.sort((left, right) => (
    right.position - left.position
    || compareSnowflakesDescending(left.id, right.id)
  ))
}

function targetLockKey(request: NormalizedRoleCreationRequest): string {
  return `${request.guildId}\0${logicalRoleNameKey(request.name)}`
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof RoleCreationExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withTargetLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => RoleCreationExecutionError,
): Promise<T> {
  const prior = ROLE_CREATION_TARGET_LOCKS.get(key)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: RoleCreationTargetOutcome) => void = () => undefined
  const tail = new Promise<RoleCreationTargetOutcome>((resolve) => {
    release = resolve
  })
  ROLE_CREATION_TARGET_LOCKS.set(key, tail)
  let outcome: RoleCreationTargetOutcome = "settled"
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
    if (ROLE_CREATION_TARGET_LOCKS.get(key) === tail) {
      ROLE_CREATION_TARGET_LOCKS.delete(key)
    }
  }
}

function exactMember(
  member: DiscordGuildMember,
  botId: string,
): DiscordGuildMember {
  if (!member.user || member.user.id !== botId) {
    throw new RoleCreationStateError(
      "Discord returned a different connector bot member than requested",
    )
  }
  return member
}

export function roleMatchesRequest(
  role: NormalizedDiscordRole,
  request: NormalizedRoleCreationRequest,
): boolean {
  return !role.managed
    && role.name === request.name
    && role.permissions === request.permissionBits
    && role.colors.primaryColor === request.primaryColor
    && role.colors.secondaryColor === null
    && role.colors.tertiaryColor === null
    && role.hoist === request.hoist
    && role.mentionable === request.mentionable
}

function roleSnapshot(roles: readonly NormalizedDiscordRole[]) {
  return [...roles]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((role) => ({
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
    }))
}

function assertCompletePermissions(
  result: GuildMemberPermissionResult,
  request: NormalizedRoleCreationRequest,
): void {
  if (!result.complete) {
    throw new RoleCreationStateError(
      `Discord connector bot permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  if (!hasGuildPermission(result, "MANAGE_ROLES")) {
    throw new RoleCreationStateError("Discord connector bot lacks guild-level MANAGE_ROLES")
  }
  if (result.highestRolePosition <= 0 || result.highestRoleIds.length < 1) {
    throw new RoleCreationStateError(
      "Discord connector bot has no role above @everyone for role creation",
    )
  }
  const effective = BigInt(result.effectivePermissions)
  const grantable = result.administrator
    ? effective | ALL_KNOWN_PERMISSION_BITS
    : effective
  const requested = BigInt(request.permissionBits)
  const unavailable = requested & ~grantable
  if (unavailable !== 0n) {
    const names = discordPermissionNames(unavailable)
    throw new RoleCreationStateError(
      `Discord connector bot cannot grant requested permissions: ${names.join(", ") || unavailable.toString()}`,
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
    roleId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function createInput(
  request: NormalizedRoleCreationRequest,
): CreateGuildRoleInput {
  return {
    hoist: request.hoist,
    mentionable: request.mentionable,
    name: request.name,
    permissions: request.permissionBits,
    primaryColor: request.primaryColor,
  }
}

function assertCreatedStructure(
  role: DiscordRole,
  expectedId?: string,
): void {
  if (
    typeof role.id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(role.id)
    || (expectedId !== undefined && role.id !== expectedId)
    || role.managed !== false
  ) {
    throw new RoleCreationResponseIdentityError(
      "Discord returned a different or managed created role",
    )
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: RoleCreationPlan
  request: NormalizedRoleCreationRequest
  roleId?: string | null
  status: RoleCreationActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): RoleCreationActivity {
  return {
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "role-create",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    roleId: options.roleId ?? null,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: RoleCreationPlan
  request: NormalizedRoleCreationRequest
  roleId?: string | null
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "role-creation",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.roleId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

export class RoleAdministrationService {
  readonly #activityStore: ActivityStore
  readonly #client: RoleAdministrationServiceOptions["client"]
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: RoleAdministrationServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    botId: string,
    request: NormalizedRoleCreationRequest,
    authority: RoleCreationAuthority,
    options: RequestOptions,
  ): Promise<RoleCreationState> {
    if (authority === "guild-scaffold") {
      this.#policy.assertGuildScaffoldAllowed(request.guildId)
    } else {
      this.#policy.assertRoleCreationAllowed(request.guildId)
    }
    const existingReceipt = await this.#operationStore.get(
      "role-creation",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new RoleCreationOperationConflictError(receiptView(existingReceipt))
    }

    const [guild, botMember, rawRoles] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildRoles(request.guildId, options),
    ])
    if (
      guild.id !== request.guildId
      || typeof guild.name !== "string"
      || guild.name.length < 1
      || typeof guild.owner_id !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(guild.owner_id)
      || (guild.features !== undefined && (
        !Array.isArray(guild.features)
        || guild.features.some((feature) => typeof feature !== "string")
        || new Set(guild.features).size !== guild.features.length
      ))
    ) {
      throw new RoleCreationStateError(
        "Discord returned incomplete or mismatched role-creation guild evidence",
      )
    }
    exactMember(botMember, botId)
    let roles: NormalizedDiscordRole[]
    try {
      roles = normalizeDiscordRoleInventory(rawRoles, request.guildId)
    } catch (error) {
      throw new RoleCreationStateError(
        `Discord role inventory evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }

    let botPermissions: GuildMemberPermissionResult
    try {
      botPermissions = evaluateGuildMemberPermissions({
        guildId: request.guildId,
        member: botMember,
        roles: rawRoles,
      })
    } catch (error) {
      throw new RoleCreationStateError(
        `Discord connector bot permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    assertCompletePermissions(botPermissions, request)

    const requestedNameKey = logicalRoleNameKey(request.name)
    const candidates = roles.filter((role) => logicalRoleNameKey(role.name) === requestedNameKey)
    if (candidates.length > 1) {
      throw new RoleCreationStateError(
        "Discord role creation target is ambiguous at the reviewed logical name",
      )
    }
    const candidate = candidates[0]
    if (candidate?.managed) {
      throw new RoleCreationStateError(
        "Discord role creation conflicts with a managed role at the reviewed logical name",
      )
    }
    if (candidate && !roleMatchesRequest(candidate, request)) {
      throw new RoleCreationStateError(
        "Discord role creation conflicts with an existing role at the reviewed logical name",
      )
    }
    const exactRole = candidate || null
    if (!exactRole && roles.length >= DISCORD_LIMITS.guildRoles) {
      throw new RoleCreationStateError(
        `Discord guild role count has reached the ${DISCORD_LIMITS.guildRoles}-role limit`,
      )
    }

    return {
      botMember,
      botPermissions,
      candidates,
      exactRole,
      guild,
      guildFeatures: [...(guild.features || [])].sort(),
      roles,
    }
  }

  async #planNormalized(
    botId: string,
    request: NormalizedRoleCreationRequest,
    authority: RoleCreationAuthority,
    options: RequestOptions,
  ): Promise<RoleCreationPlan> {
    const state = await this.#state(botId, request, authority, options)
    const action = state.exactRole ? "none" : "create"
    const reviewedRequest = {
      auditReason: request.auditReason,
      guildId: request.guildId,
      hoist: request.hoist,
      mentionable: request.mentionable,
      name: request.name,
      operationKeyHash: request.operationKeyHash,
      permissionBits: request.permissionBits,
      permissions: request.permissions,
      primaryColor: request.primaryColor,
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      action,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      botPermissions: {
        administrator: state.botPermissions.administrator,
        effectivePermissions: state.botPermissions.effectivePermissions,
        highestRoleIds: state.botPermissions.highestRoleIds,
        highestRolePosition: state.botPermissions.highestRolePosition,
      },
      candidates: roleSnapshot(state.candidates),
      guild: {
        features: state.guildFeatures,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      request: reviewedRequest,
      roleLimit: DISCORD_LIMITS.guildRoles,
      roles: roleSnapshot(state.roles),
    })
    const highRiskPermissions = request.permissions.filter((permission) => (
      HIGH_RISK_PERMISSION_SET.has(permission)
    ))
    return {
      action,
      auditReason: request.auditReason,
      createdAt: this.#clock().toISOString(),
      digest,
      existingRole: state.exactRole,
      guild: {
        features: state.guildFeatures,
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id as string,
      },
      highRiskPermissions,
      operationKeyHash: request.operationKeyHash,
      permission: {
        botAdministrator: state.botPermissions.administrator,
        botEffectivePermissionNames: state.botPermissions.effectivePermissionNames,
        botEffectivePermissions: state.botPermissions.effectivePermissions,
        botHighestRoleIds: state.botPermissions.highestRoleIds,
        botHighestRolePosition: state.botPermissions.highestRolePosition,
        guildManageRoles: hasGuildPermission(state.botPermissions, "MANAGE_ROLES"),
        requestedSubset: true,
      },
      schemaVersion: SCHEMA_VERSION,
      status: action === "create" ? "planned" : "already-current",
      target: {
        hoist: request.hoist,
        mentionable: request.mentionable,
        name: request.name,
        permissionBits: request.permissionBits,
        permissions: request.permissions,
        primaryColor: request.primaryColor,
      },
      visibleInventory: {
        guildLimit: DISCORD_LIMITS.guildRoles,
        guildRoles: state.roles.length,
      },
      warnings: [
        ...(state.botPermissions.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped MANAGE_ROLES and only the permissions this workflow may grant"]
          : []),
        ...(request.mentionable
          ? ["This role will be mentionable by members allowed to mention roles; review notification abuse risk"]
          : []),
        ...(highRiskPermissions.length > 0
          ? [`Requested high-risk permissions: ${highRiskPermissions.join(", ")}`]
          : []),
        "Discord creates the role at its default bottom position; this workflow never moves it",
        "Same-target serialization is process-local; do not run multiple connector processes with overlapping role-creation scope",
        "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
        "This workflow never edits, assigns, moves, deletes, rolls back, adds icons, or creates gradient roles",
      ],
    }
  }

  async plan(
    botId: string,
    request: RoleCreationRequest,
    options: RequestOptions = {},
  ): Promise<RoleCreationPlan> {
    return this.#planNormalized(
      botId,
      normalizeRoleCreationRequest(request),
      "direct",
      options,
    )
  }

  async planForGuildScaffold(
    authority: GuildScaffoldAuthority,
    botId: string,
    request: RoleCreationRequest,
    options: RequestOptions = {},
  ): Promise<RoleCreationPlan> {
    assertGuildScaffoldAuthority(authority)
    return this.#planNormalized(
      botId,
      normalizeRoleCreationRequest(request),
      "guild-scaffold",
      options,
    )
  }

  async execute(
    botId: string,
    request: RoleCreationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleCreationResult> {
    const normalized = normalizeRoleCreationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord role creation plan digest is invalid")
    }
    return withTargetLock(
      targetLockKey(normalized),
      () => this.#executeNormalized(
        botId,
        normalized,
        expectedDigest,
        "direct",
        options,
      ),
      () => new RoleCreationExecutionError(
        "Discord role creation was blocked because a concurrent creation at the same logical target ended with an uncertain outcome",
        {
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async executeForGuildScaffold(
    authority: GuildScaffoldAuthority,
    botId: string,
    request: RoleCreationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleCreationResult> {
    assertGuildScaffoldAuthority(authority)
    const normalized = normalizeRoleCreationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord role creation plan digest is invalid")
    }
    return withTargetLock(
      targetLockKey(normalized),
      () => this.#executeNormalized(
        botId,
        normalized,
        expectedDigest,
        "guild-scaffold",
        options,
      ),
      () => new RoleCreationExecutionError(
        "Discord scaffold role creation was blocked because a concurrent creation at the same logical target ended with an uncertain outcome",
        {
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
    botId: string,
    normalized: NormalizedRoleCreationRequest,
    expectedDigest: string,
    authority: RoleCreationAuthority,
    options: RequestOptions,
  ): Promise<RoleCreationResult> {
    let plan: RoleCreationPlan
    try {
      plan = await this.#planNormalized(botId, normalized, authority, options)
    } catch (error) {
      if (
        error instanceof RoleCreationStateError
        || error instanceof RoleCreationResponseIdentityError
        || error instanceof DiscordRoleEvidenceError
        || (error instanceof DiscordApiError && error.status === 404)
      ) {
        throw new RoleCreationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new RoleCreationPlanChangedError(expectedDigest, plan.digest)
    }
    if (plan.action === "none" && plan.existingRole) {
      return {
        activityId: null,
        guildId: normalized.guildId,
        observed: plan.existingRole,
        operationKeyHash: normalized.operationKeyHash,
        planDigest: plan.digest,
        roleId: plan.existingRole.id,
        schemaVersion: SCHEMA_VERSION,
        status: "already-current",
      }
    }

    const activityId = this.#randomId()
    const pendingReceipt = operationReceipt({
      activityId,
      plan,
      request: normalized,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    })
    const reservation = await this.#operationStore.reserve(pendingReceipt)
    if (!reservation.created) {
      throw new RoleCreationOperationConflictError(receiptView(reservation.receipt))
    }

    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: normalized,
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
          request: normalized,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new RoleCreationExecutionError(
        "Discord role creation was blocked because pending activity could not be recorded",
        {
          activityId,
          error: safeErrorCode(error),
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          operationRecordError,
          planDigest: plan.digest,
          roleId: null,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let roleId: string | null = null
    let observed: NormalizedDiscordRole | null = null
    try {
      const created = await this.#client.createGuildRole(
        normalized.guildId,
        createInput(normalized),
        normalized.auditReason,
        options,
      )
      if (
        created
        && typeof created.id === "string"
        && DISCORD_SNOWFLAKE_PATTERN.test(created.id)
      ) roleId = created.id
      assertCreatedStructure(created)
      normalizeDiscordRole(created, normalized.guildId, created.id)
      const readback = await this.#client.getGuildRole(
        normalized.guildId,
        created.id,
        options,
      )
      assertCreatedStructure(readback, created.id)
      observed = normalizeDiscordRole(readback, normalized.guildId, created.id)
    } catch (error) {
      const status = roleId === null
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
          request: normalized,
          roleId,
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
          request: normalized,
          roleId,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new RoleCreationExecutionError(
        "Discord role creation did not complete with a verified successful outcome",
        {
          activityId,
          activityRecordError,
          error: errorCode,
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          operationRecordError,
          planDigest: plan.digest,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          roleId,
          schemaVersion: SCHEMA_VERSION,
          status,
        },
        { cause: error },
      )
    }

    const verification = roleMatchesRequest(observed, normalized) ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: RoleCreationResult = {
      activityId,
      guildId: normalized.guildId,
      observed,
      operationKeyHash: normalized.operationKeyHash,
      planDigest: plan.digest,
      roleId: observed.id,
      schemaVersion: SCHEMA_VERSION,
      status,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request: normalized,
        roleId: observed.id,
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
          request: normalized,
          roleId: observed.id,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new RoleCreationExecutionError(
        "Discord role creation completed but the operation receipt failed",
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
        request: normalized,
        roleId: observed.id,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new RoleCreationExecutionError(
        "Discord role creation completed but the final activity record failed",
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
