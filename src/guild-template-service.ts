import {
  createHmac,
  randomUUID,
} from "node:crypto"

import type {
  ActivityStore,
  GuildTemplateActivity,
  GuildTemplateActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_TEMPLATE_LIMITS,
  GUILD_TEMPLATE_REFERENCE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildTemplateSummary,
  type ModifyGuildTemplateInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  GuildTemplateEvidenceError,
  GuildTemplateExecutionError,
  GuildTemplateOperationConflictError,
  GuildTemplatePlanChangedError,
} from "./errors.js"
import type { GatewayChannelLayoutSource } from "./gateway-channel-layout.js"
import {
  collectGuildChannelEvidence,
  GuildChannelEvidenceError,
  type GuildChannelEvidenceView,
} from "./guild-channel-evidence.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
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
import { ROLE_CREATION_HIGH_RISK_PERMISSIONS } from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export const GUILD_TEMPLATE_ACTIONS = [
  "create",
  "delete",
  "synchronize",
  "update-metadata",
] as const

export type GuildTemplateAction = typeof GUILD_TEMPLATE_ACTIONS[number]

export interface GuildTemplateChangeRequest {
  action: GuildTemplateAction
  auditReason: string
  description?: string | null
  guildId: string
  name?: string
  operationKey: string
  templateRef?: string
}

interface NormalizedGuildTemplateChangeRequest {
  action: GuildTemplateAction
  auditReason: string
  description?: string | null
  guildId: string
  name?: string
  operationKeyHash: string
  templateRef?: string
}

export interface GuildTemplateAccessEvidence {
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

export interface GuildTemplateStructure {
  channels: {
    announcement: number
    category: number
    directory: number
    forum: number
    media: number
    nsfw: number
    stage: number
    text: number
    threads: number
    total: number
    unknown: number
    voice: number
  }
  permissionOverwrites: {
    memberTargets: number
    roleTargets: number
    total: number
    unknownTargets: number
  }
  roles: {
    privileged: number
    riskyPermissionClasses: number
    total: number
    unknownPermissionBitfields: number
  }
  unknownFields: number
}

export interface ProjectedGuildTemplate {
  createdAt: string
  creatorUserId: string
  isDirty: boolean | null
  metadata: {
    descriptionCharacters: number | null
    nameCharacters: number
  }
  structure: GuildTemplateStructure
  templateRef: string
  unknownFieldCount: number
  updatedAt: string
  usageCount: number
}

export interface GuildTemplatePrivacyProjection {
  capabilities: "opaque-process-local-references"
  omittedFields: readonly [
    "code",
    "useUrl",
    "name",
    "description",
    "creatorProfile",
    "guildName",
    "roleNames",
    "channelNames",
    "channelTopics",
    "iconHashes",
    "serializedSourceGuild",
    "rawPayloads",
  ]
  persistence: "content-free-activity-only"
  rawPayloads: "omitted"
}

export interface GuildTemplateInventoryResult {
  access: GuildTemplateAccessEvidence
  applicationId: string
  botId: string
  channelEvidence: GuildChannelEvidenceView
  guild: {
    id: string
  }
  inventory: {
    returned: number
    safetyLimit: number
  }
  limitations: string[]
  liveStructure: GuildTemplateStructure
  privacy: GuildTemplatePrivacyProjection
  schemaVersion: number
  status: "ok"
  templates: ProjectedGuildTemplate[]
}

export interface GuildTemplateDrift {
  ambiguousChannelIdentities: number
  ambiguousRoleIdentities: number
  channelComparisonComplete: boolean
  channelSettingsChanged: number
  channelsAddedSinceSnapshot: number
  channelsMissingFromGuild: number
  roleSettingsChanged: number
  rolesAddedSinceSnapshot: number
  rolesMissingFromGuild: number
}

export interface GuildTemplateChangePlan {
  access: GuildTemplateAccessEvidence
  action: GuildTemplateAction
  applicationId: string
  auditReason: string
  botId: string
  channelEvidence: GuildChannelEvidenceView
  createdAt: string
  desiredMetadata: {
    description: string | null | undefined
    name: string | undefined
  } | null
  digest: string
  drift: GuildTemplateDrift | null
  guild: {
    id: string
  }
  inventory: {
    returned: number
    safetyLimit: number
  }
  liveStructure: GuildTemplateStructure
  mutation: "create" | "delete" | "none" | "synchronize" | "update-metadata"
  operationKeyHash: string
  privacy: GuildTemplatePrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  target: ProjectedGuildTemplate | null
  warnings: string[]
}

export interface GuildTemplateChangeResult {
  action: GuildTemplateAction
  activityId: string | null
  guildId: string
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  schemaVersion: number
  status: "already-current" | "completed"
  templateRef: string | null
}

export interface GuildTemplateServiceClient extends Pick<
  DiscordClient,
  | "createGuildTemplate"
  | "deleteGuildTemplate"
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "listGuildTemplates"
  | "modifyGuildTemplate"
  | "syncGuildTemplate"
> {}

export interface GuildTemplateServiceOptions {
  activityStore: ActivityStore
  client: GuildTemplateServiceClient
  clock?: () => Date
  layoutSource: GatewayChannelLayoutSource
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    "assertGuildTemplateAuditable" | "assertGuildTemplateChangeable"
  >
  randomId?: () => string
}

interface ValidatedRole {
  color: number
  hoist: boolean
  id: string
  managed: boolean
  mentionable: boolean
  name: string
  permissions: string
  position: number
}

interface NormalizedRole {
  identity: string
  settings: string
}

interface NormalizedChannel {
  identity: string
  settings: string
}

interface ParsedStructure {
  channels: NormalizedChannel[]
  roles: NormalizedRole[]
  view: GuildTemplateStructure
}

interface PrivateTemplate {
  projected: ProjectedGuildTemplate
  raw: DiscordGuildTemplateSummary
  snapshot: Record<string, unknown>
  structure: ParsedStructure
}

interface GuildTemplateState {
  access: GuildTemplateAccessEvidence
  channelEvidence: GuildChannelEvidenceView
  channels: DiscordChannel[]
  guild: DiscordGuild & { owner_id: string }
  inventoryDigest: string
  liveStructure: ParsedStructure
  roles: ValidatedRole[]
  templates: PrivateTemplate[]
}

interface BuiltPlan {
  plan: GuildTemplateChangePlan
  state: GuildTemplateState
  target: PrivateTemplate | null
}

type TargetOutcome = "settled" | "uncertain"

interface TargetLockState {
  tails: Map<string, Promise<TargetOutcome>>
  uncertainTargets: Set<string>
}

const STATE_UNAVAILABLE = "guild-template-state-unavailable"
const TEMPLATE_REFERENCE_PREFIX = "tref_hmac_sha256_"
const TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const TEMPLATE_URL_PATTERN = /(?:discord\.new\/|discord(?:app)?\.com\/template\/)/iu
const PRIVACY_OMITTED_FIELDS = [
  "code",
  "useUrl",
  "name",
  "description",
  "creatorProfile",
  "guildName",
  "roleNames",
  "channelNames",
  "channelTopics",
  "iconHashes",
  "serializedSourceGuild",
  "rawPayloads",
] as const
const HIGH_RISK_PERMISSIONS: ReadonlySet<DiscordPermissionName> = new Set([
  "ADMINISTRATOR",
  "CREATE_INSTANT_INVITE",
  ...ROLE_CREATION_HIGH_RISK_PERMISSIONS,
])
const KNOWN_CHANNEL_TYPES: ReadonlySet<number> = new Set(
  Object.values(DISCORD_CHANNEL_TYPES),
)
const TEMPLATE_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "afk_channel_id",
  "afk_timeout",
  "channels",
  "default_message_notifications",
  "description",
  "explicit_content_filter",
  "icon_hash",
  "id",
  "name",
  "preferred_locale",
  "roles",
  "system_channel_flags",
  "system_channel_id",
  "verification_level",
])
const TEMPLATE_ROLE_KEYS: ReadonlySet<string> = new Set([
  "color",
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
const TEMPLATE_CHANNEL_KEYS: ReadonlySet<string> = new Set([
  "available_tags",
  "bitrate",
  "default_auto_archive_duration",
  "default_forum_layout",
  "default_reaction_emoji",
  "default_sort_order",
  "default_thread_rate_limit_per_user",
  "flags",
  "id",
  "name",
  "nsfw",
  "parent_id",
  "permission_overwrites",
  "position",
  "rate_limit_per_user",
  "topic",
  "type",
  "user_limit",
  "video_quality_mode",
])
const TEMPLATE_OVERWRITE_KEYS: ReadonlySet<string> = new Set([
  "allow",
  "deny",
  "id",
  "type",
])
const DRIFT_ROLE_KEYS = [
  "color",
  "hoist",
  "mentionable",
  "permissions",
] as const
const DRIFT_CHANNEL_KEYS = [
  "bitrate",
  "default_auto_archive_duration",
  "default_forum_layout",
  "default_sort_order",
  "default_thread_rate_limit_per_user",
  "flags",
  "nsfw",
  "position",
  "rate_limit_per_user",
  "topic",
  "type",
  "user_limit",
  "video_quality_mode",
] as const
const MAX_JSON_DEPTH = 12
const MAX_JSON_NODES = 50_000
const MAX_JSON_STRING_CHARACTERS = 16_384

class GuildTemplateStateError extends GuildTemplateEvidenceError {}

function evidenceError(message: string): GuildTemplateStateError {
  return new GuildTemplateStateError(message)
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

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
}

function validText(value: unknown, maximum: number, minimum = 1): value is string {
  if (
    typeof value !== "string"
    || [...value].length < minimum
    || [...value].length > maximum
    || value.trim() !== value
    || TEXT_CONTROL_PATTERN.test(value)
  ) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

export function normalizeGuildTemplateChangeRequest(
  request: GuildTemplateChangeRequest,
): NormalizedGuildTemplateChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild-template change request must be an object")
  }
  if (!GUILD_TEMPLATE_ACTIONS.includes(request.action)) {
    throw new RangeError("Discord guild-template action is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord guild-template guild ID")
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord guild-template audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  if (TEMPLATE_URL_PATTERN.test(request.auditReason)) {
    throw new RangeError("Discord guild-template audit reason must not contain a template URL")
  }
  const baseKeys = ["action", "auditReason", "guildId", "operationKey"] as const
  if (request.action === "create") {
    if (
      !exactKeys(request, [...baseKeys, "description", "name"])
      || !validText(request.name, GUILD_TEMPLATE_LIMITS.nameCharacters)
      || !(
        request.description === null
        || validText(request.description, GUILD_TEMPLATE_LIMITS.descriptionCharacters, 0)
      )
    ) {
      throw new RangeError("Discord guild-template creation request fields are invalid")
    }
  } else if (request.action === "update-metadata") {
    const keys = Object.keys(request)
    if (
      keys.some((key) => ![
        ...baseKeys,
        "description",
        "name",
        "templateRef",
      ].includes(key as typeof baseKeys[number]))
      || !keys.includes("templateRef")
      || request.name === undefined && request.description === undefined
      || request.name !== undefined
        && !validText(request.name, GUILD_TEMPLATE_LIMITS.nameCharacters)
      || request.description !== undefined
        && request.description !== null
        && !validText(request.description, GUILD_TEMPLATE_LIMITS.descriptionCharacters, 0)
    ) {
      throw new RangeError("Discord guild-template metadata request fields are invalid")
    }
  } else if (!exactKeys(request, [...baseKeys, "templateRef"])) {
    throw new RangeError("Discord guild-template target request fields are invalid")
  }
  if (
    request.action !== "create"
    && (
      typeof request.templateRef !== "string"
      || !GUILD_TEMPLATE_REFERENCE_PATTERN.test(request.templateRef)
    )
  ) {
    throw new RangeError(
      "Discord guild-template reference is invalid or belongs to another process",
    )
  }
  return {
    action: request.action,
    auditReason: request.auditReason,
    ...(request.description !== undefined
      ? { description: request.description }
      : {}),
    guildId: request.guildId,
    ...(request.name !== undefined ? { name: request.name } : {}),
    operationKeyHash: operationKeyHash(request.operationKey),
    ...(request.templateRef !== undefined
      ? { templateRef: request.templateRef }
      : {}),
  }
}

export function assertGuildTemplateListInput(guildId: string): void {
  assertPositiveSnowflake(guildId, "Discord guild-template guild ID")
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError(message)
  }
  return value as Record<string, unknown>
}

function assertBoundedJson(value: unknown): void {
  let nodes = 0
  const visit = (item: unknown, depth: number): void => {
    nodes += 1
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw evidenceError("Discord guild-template snapshot exceeds local structural bounds")
    }
    if (typeof item === "string" && [...item].length > MAX_JSON_STRING_CHARACTERS) {
      throw evidenceError("Discord guild-template snapshot contains oversized text")
    }
    if (Array.isArray(item)) {
      if (item.length > MAX_JSON_NODES) {
        throw evidenceError("Discord guild-template snapshot contains an oversized array")
      }
      for (const entry of item) visit(entry, depth + 1)
      return
    }
    if (item && typeof item === "object") {
      const entries = Object.entries(item as Record<string, unknown>)
      if (
        entries.length > MAX_JSON_NODES
        || entries.some(([key]) => key.length > 128 || TEXT_CONTROL_PATTERN.test(key))
      ) {
        throw evidenceError("Discord guild-template snapshot contains invalid object keys")
      }
      for (const [, entry] of entries) visit(entry, depth + 1)
    }
  }
  visit(value, 0)
}

function placeholderId(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null
  if (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
  ) return String(value)
  if (
    typeof value === "string"
    && /^(0|[1-9][0-9]*)$/u.test(value)
    && value.length <= 20
  ) return value
  throw evidenceError("Discord guild-template snapshot contains an invalid placeholder ID")
}

function permissionBits(value: unknown, description: string): string {
  if (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
  ) return String(value)
  if (typeof value !== "string") {
    throw evidenceError(`Discord guild-template snapshot contains invalid ${description}`)
  }
  try {
    return parseDiscordPermissionBits(value, description).toString()
  } catch (error) {
    throw new GuildTemplateStateError(
      `Discord guild-template snapshot contains invalid ${description}`,
      { cause: error },
    )
  }
}

function hmacHex(key: Uint8Array, domain: string, payload: string): string {
  return createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(payload)
    .digest("hex")
}

function templateReference(key: Uint8Array, guildId: string, code: string): string {
  return `${TEMPLATE_REFERENCE_PREFIX}${hmacHex(
    key,
    "guildcontrol-guild-template-reference.v1",
    `${guildId}\0${code}`,
  )}`
}

function identityFingerprint(
  key: Uint8Array,
  kind: "channel" | "role",
  values: readonly unknown[],
): string {
  return hmacHex(
    key,
    `guildcontrol-guild-template-${kind}-identity.v1`,
    stableString(values),
  )
}

function channelCounts(types: readonly number[]) {
  const count = (type: number) => types.filter((value) => value === type).length
  return {
    announcement: count(DISCORD_CHANNEL_TYPES.announcement),
    category: count(DISCORD_CHANNEL_TYPES.category),
    directory: count(DISCORD_CHANNEL_TYPES.directory),
    forum: count(DISCORD_CHANNEL_TYPES.forum),
    media: count(DISCORD_CHANNEL_TYPES.media),
    nsfw: 0,
    stage: count(DISCORD_CHANNEL_TYPES.stageVoice),
    text: count(DISCORD_CHANNEL_TYPES.text),
    threads: types.filter((value) => ([
      DISCORD_CHANNEL_TYPES.announcementThread,
      DISCORD_CHANNEL_TYPES.privateThread,
      DISCORD_CHANNEL_TYPES.publicThread,
    ] as readonly number[]).includes(value)).length,
    total: types.length,
    unknown: types.filter((value) => !KNOWN_CHANNEL_TYPES.has(value)).length,
    voice: count(DISCORD_CHANNEL_TYPES.voice),
  }
}

function structureView(options: {
  channelTypes: number[]
  memberOverwrites: number
  nsfwChannels: number
  privilegedRoles: number
  roleOverwrites: number
  roles: number
  riskyPermissionClasses: Set<DiscordPermissionName>
  unknownFields: number
  unknownPermissionBitfields: number
  unknownTargetOverwrites: number
}): GuildTemplateStructure {
  return {
    channels: {
      ...channelCounts(options.channelTypes),
      nsfw: options.nsfwChannels,
    },
    permissionOverwrites: {
      memberTargets: options.memberOverwrites,
      roleTargets: options.roleOverwrites,
      total: options.memberOverwrites
        + options.roleOverwrites
        + options.unknownTargetOverwrites,
      unknownTargets: options.unknownTargetOverwrites,
    },
    roles: {
      privileged: options.privilegedRoles,
      riskyPermissionClasses: options.riskyPermissionClasses.size,
      total: options.roles,
      unknownPermissionBitfields: options.unknownPermissionBitfields,
    },
    unknownFields: options.unknownFields,
  }
}

function parseTemplateStructure(
  source: Record<string, unknown>,
  planKey: Uint8Array,
): ParsedStructure {
  assertBoundedJson(source)
  const rawRoles = source.roles
  const rawChannels = source.channels
  if (
    !Array.isArray(rawRoles)
    || rawRoles.length < 1
    || rawRoles.length > DISCORD_LIMITS.guildRoles
    || !Array.isArray(rawChannels)
    || rawChannels.length > DISCORD_LIMITS.guildChannels
  ) {
    throw evidenceError("Discord guild-template snapshot has invalid role or channel bounds")
  }
  let unknownFields = Object.keys(source)
    .filter((key) => !TEMPLATE_TOP_LEVEL_KEYS.has(key)).length
  let privilegedRoles = 0
  let unknownPermissionBitfields = 0
  const riskyPermissionClasses = new Set<DiscordPermissionName>()
  const roleNamesById = new Map<string, string>()
  const roles: NormalizedRole[] = []
  for (const value of rawRoles) {
    const role = record(value, "Discord guild-template snapshot contains an invalid role")
    const id = placeholderId(role.id) as string
    if (
      roleNamesById.has(id)
      || !validText(role.name, DISCORD_LIMITS.roleNameCharacters)
      || !(role.color === undefined || (
        Number.isSafeInteger(role.color)
        && (role.color as number) >= 0
        && (role.color as number) <= 0xFFFFFF
      ))
      || !(role.hoist === undefined || typeof role.hoist === "boolean")
      || !(role.managed === undefined || typeof role.managed === "boolean")
      || !(role.mentionable === undefined || typeof role.mentionable === "boolean")
      || !(role.position === undefined || (
        Number.isSafeInteger(role.position)
        && (role.position as number) >= 0
      ))
    ) {
      throw evidenceError("Discord guild-template snapshot contains invalid or duplicate roles")
    }
    const permissions = permissionBits(role.permissions, "role permissions")
    roleNamesById.set(id, role.name)
    unknownFields += Object.keys(role).filter((key) => !TEMPLATE_ROLE_KEYS.has(key)).length
    const names = discordPermissionNames(BigInt(permissions))
    const risky = names.filter((name) => HIGH_RISK_PERMISSIONS.has(name))
    if (risky.length > 0) privilegedRoles += 1
    for (const name of risky) riskyPermissionClasses.add(name)
    if (unknownDiscordPermissionBits(BigInt(permissions)) !== 0n) {
      unknownPermissionBitfields += 1
    }
    if (role.managed !== true) {
      roles.push({
        identity: identityFingerprint(planKey, "role", [role.name]),
        settings: stableString({
          color: role.color ?? 0,
          hoist: role.hoist ?? false,
          mentionable: role.mentionable ?? false,
          permissions,
        }),
      })
    }
  }
  if (roleNamesById.get("0") !== "@everyone") {
    throw evidenceError("Discord guild-template snapshot lacks its @everyone placeholder role")
  }
  const channelNamesById = new Map<string, { name: string; type: number }>()
  const rawChannelRecords = rawChannels.map((value) => {
    const channel = record(
      value,
      "Discord guild-template snapshot contains an invalid channel",
    )
    const id = placeholderId(channel.id) as string
    if (
      channelNamesById.has(id)
      || !validText(channel.name, DISCORD_LIMITS.channelNameCharacters)
      || !Number.isSafeInteger(channel.type)
      || (channel.type as number) < 0
    ) {
      throw evidenceError("Discord guild-template snapshot contains invalid or duplicate channels")
    }
    channelNamesById.set(id, {
      name: channel.name,
      type: channel.type as number,
    })
    return { channel, id }
  })
  let memberOverwrites = 0
  let roleOverwrites = 0
  let unknownTargetOverwrites = 0
  let overwriteCount = 0
  let nsfwChannels = 0
  const channels: NormalizedChannel[] = []
  for (const { channel } of rawChannelRecords) {
    unknownFields += Object.keys(channel)
      .filter((key) => !TEMPLATE_CHANNEL_KEYS.has(key)).length
    if (channel.nsfw === true) nsfwChannels += 1
    const parentId = placeholderId(channel.parent_id ?? null, true)
    if (parentId !== null && !channelNamesById.has(parentId)) {
      throw evidenceError("Discord guild-template snapshot references an absent parent channel")
    }
    const overwrites = channel.permission_overwrites ?? []
    if (!Array.isArray(overwrites)) {
      throw evidenceError("Discord guild-template snapshot contains invalid overwrites")
    }
    overwriteCount += overwrites.length
    if (overwriteCount > GUILD_TEMPLATE_LIMITS.snapshotPermissionOverwrites) {
      throw evidenceError("Discord guild-template snapshot contains too many overwrites")
    }
    const normalizedOverwrites = overwrites.map((value) => {
      const overwrite = record(
        value,
        "Discord guild-template snapshot contains an invalid overwrite",
      )
      unknownFields += Object.keys(overwrite)
        .filter((key) => !TEMPLATE_OVERWRITE_KEYS.has(key)).length
      const targetId = placeholderId(overwrite.id) as string
      const type = overwrite.type
      if (!Number.isSafeInteger(type) || (type as number) < 0) {
        throw evidenceError("Discord guild-template snapshot contains an invalid overwrite type")
      }
      if (type === 0) roleOverwrites += 1
      else if (type === 1) memberOverwrites += 1
      else unknownTargetOverwrites += 1
      const roleName = type === 0 ? roleNamesById.get(targetId) : undefined
      if (type === 0 && !roleName) {
        throw evidenceError("Discord guild-template snapshot overwrite references an absent role")
      }
      const allow = permissionBits(overwrite.allow ?? "0", "overwrite allow permissions")
      const deny = permissionBits(overwrite.deny ?? "0", "overwrite deny permissions")
      if ((BigInt(allow) & BigInt(deny)) !== 0n) {
        throw evidenceError("Discord guild-template snapshot overwrite allows and denies the same permission")
      }
      return {
        allow,
        deny,
        target: type === 0
          ? identityFingerprint(planKey, "role", [roleName])
          : hmacHex(
              planKey,
              "guildcontrol-guild-template-overwrite-target.v1",
              `${String(type)}\0${targetId}`,
            ),
        type,
      }
    }).sort((left, right) => stableString(left).localeCompare(stableString(right)))
    const settings = Object.fromEntries(
      DRIFT_CHANNEL_KEYS.map((key) => [key, channel[key] ?? null]),
    )
    channels.push({
      identity: identityFingerprint(
        planKey,
        "channel",
        [channel.type, channel.name],
      ),
      settings: stableString({
        ...settings,
        overwrites: normalizedOverwrites,
        parent: parentId === null
          ? null
          : identityFingerprint(
              planKey,
              "channel",
              [
                channelNamesById.get(parentId)?.type,
                channelNamesById.get(parentId)?.name,
              ],
            ),
      }),
    })
  }
  return {
    channels,
    roles,
    view: structureView({
      channelTypes: rawChannelRecords.map(({ channel }) => channel.type as number),
      memberOverwrites,
      nsfwChannels,
      privilegedRoles,
      roleOverwrites,
      roles: rawRoles.length,
      riskyPermissionClasses,
      unknownFields,
      unknownPermissionBitfields,
      unknownTargetOverwrites,
    }),
  }
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
    throw evidenceError("Discord returned incomplete or mismatched guild-template guild evidence")
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
    throw evidenceError("Discord returned incomplete or mismatched guild-template bot evidence")
  }
  return value
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded guild-template role inventory")
  }
  const roles: ValidatedRole[] = []
  const ids = new Set<string>()
  for (const role of value) {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || !validText(role.name, DISCORD_LIMITS.roleNameCharacters)
      || typeof role.managed !== "boolean"
      || !(role.color === undefined || (
        Number.isSafeInteger(role.color)
        && (role.color as number) >= 0
        && (role.color as number) <= 0xFFFFFF
      ))
      || !(role.hoist === undefined || typeof role.hoist === "boolean")
      || !(role.mentionable === undefined || typeof role.mentionable === "boolean")
      || !Number.isInteger(role.position)
      || role.position < 0
      || ids.has(role.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate guild-template role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw new GuildTemplateStateError(
        "Discord returned invalid guild-template role permissions",
        { cause: error },
      )
    }
    ids.add(role.id)
    roles.push({
      color: role.color ?? 0,
      hoist: role.hoist ?? false,
      id: role.id,
      managed: role.managed,
      mentionable: role.mentionable ?? false,
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
    throw evidenceError("Discord returned invalid guild-template @everyone role evidence")
  }
  return roles.sort((left, right) => left.id.localeCompare(right.id))
}

function exactChannels(
  value: readonly DiscordChannel[],
  guildId: string,
  roles: readonly ValidatedRole[],
): DiscordChannel[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildChannels) {
    throw evidenceError("Discord returned an invalid bounded guild-template channel inventory")
  }
  assertBoundedJson(value)
  const ids = new Set<string>()
  let overwriteCount = 0
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
      || !Number.isSafeInteger(channel.position)
      || (channel.position as number) < 0
      || !(channel.parent_id === undefined || channel.parent_id === null || (
        typeof channel.parent_id === "string"
        && positiveSnowflake(channel.parent_id)
      ))
      || !(channel.permission_overwrites === undefined
        || Array.isArray(channel.permission_overwrites))
      || ids.has(channel.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate guild-template channel evidence")
    }
    ids.add(channel.id)
  }
  const roleIds = new Set(roles.map(({ id }) => id))
  for (const channel of value) {
    const seenOverwrites = new Set<string>()
    const overwrites = channel.permission_overwrites ?? []
    overwriteCount += overwrites.length
    if (overwriteCount > GUILD_TEMPLATE_LIMITS.snapshotPermissionOverwrites) {
      throw evidenceError("Discord returned too many live guild-template permission overwrites")
    }
    for (const overwrite of overwrites) {
      if (
        !overwrite
        || typeof overwrite !== "object"
        || Array.isArray(overwrite)
        || !positiveSnowflake(overwrite.id)
        || overwrite.type !== 0 && overwrite.type !== 1
        || seenOverwrites.has(overwrite.id)
        || overwrite.type === 0 && !roleIds.has(overwrite.id)
      ) {
        throw evidenceError("Discord returned invalid guild-template channel overwrite evidence")
      }
      const allow = permissionBits(
        overwrite.allow ?? "0",
        "live overwrite allow permissions",
      )
      const deny = permissionBits(
        overwrite.deny ?? "0",
        "live overwrite deny permissions",
      )
      if ((BigInt(allow) & BigInt(deny)) !== 0n) {
        throw evidenceError("Discord returned a guild-template overwrite with conflicting permissions")
      }
      seenOverwrites.add(overwrite.id)
    }
  }
  return [...value].sort((left, right) => left.id.localeCompare(right.id))
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
    throw new GuildTemplateStateError(
      "Discord returned invalid guild-template permission evidence",
      { cause: error },
    )
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete guild-template permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): GuildTemplateAccessEvidence {
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

function liveStructure(
  roles: readonly ValidatedRole[],
  channels: readonly DiscordChannel[],
  planKey: Uint8Array,
): ParsedStructure {
  const riskyPermissionClasses = new Set<DiscordPermissionName>()
  let privilegedRoles = 0
  let unknownPermissionBitfields = 0
  const normalizedRoles = roles.flatMap((role) => {
    const permissions = BigInt(role.permissions)
    const risky = discordPermissionNames(permissions)
      .filter((name) => HIGH_RISK_PERMISSIONS.has(name))
    if (risky.length > 0) privilegedRoles += 1
    for (const name of risky) riskyPermissionClasses.add(name)
    if (unknownDiscordPermissionBits(permissions) !== 0n) {
      unknownPermissionBitfields += 1
    }
    const raw = role as unknown as Record<string, unknown>
    if (role.managed) return []
    return [{
      identity: identityFingerprint(planKey, "role", [role.name]),
      settings: stableString(Object.fromEntries(
        DRIFT_ROLE_KEYS.map((key) => [key, raw[key] ?? null]),
      )),
    }]
  })
  const roleNames = new Map(roles.map((role) => [role.id, role.name]))
  const channelNames = new Map(channels.map((channel) => [
    channel.id,
    { name: channel.name as string, type: channel.type },
  ]))
  let memberOverwrites = 0
  let roleOverwrites = 0
  let unknownTargetOverwrites = 0
  let nsfwChannels = 0
  const unknownFields = 0
  const normalizedChannels = channels.map((channel) => {
    const raw = channel as unknown as Record<string, unknown>
    if (channel.nsfw === true) nsfwChannels += 1
    const overwrites = channel.permission_overwrites ?? []
    const normalizedOverwrites = overwrites.map((overwrite: DiscordPermissionOverwrite) => {
      if (overwrite.type === 0) roleOverwrites += 1
      else if (overwrite.type === 1) memberOverwrites += 1
      else unknownTargetOverwrites += 1
      const roleName = overwrite.type === 0 ? roleNames.get(overwrite.id) : undefined
      return {
        allow: permissionBits(overwrite.allow ?? "0", "live overwrite allow permissions"),
        deny: permissionBits(overwrite.deny ?? "0", "live overwrite deny permissions"),
        target: overwrite.type === 0 && roleName
          ? identityFingerprint(planKey, "role", [roleName])
          : hmacHex(
              planKey,
              "guildcontrol-guild-template-overwrite-target.v1",
              `${overwrite.type}\0${overwrite.id}`,
            ),
        type: overwrite.type,
      }
    }).sort((left, right) => stableString(left).localeCompare(stableString(right)))
    const parent = channel.parent_id
      ? channelNames.get(channel.parent_id)
      : undefined
    return {
      identity: identityFingerprint(
        planKey,
        "channel",
        [channel.type, channel.name],
      ),
      settings: stableString({
        ...Object.fromEntries(DRIFT_CHANNEL_KEYS.map((key) => [key, raw[key] ?? null])),
        overwrites: normalizedOverwrites,
        parent: parent
          ? identityFingerprint(planKey, "channel", [parent.type, parent.name])
          : null,
      }),
    }
  })
  return {
    channels: normalizedChannels,
    roles: normalizedRoles,
    view: structureView({
      channelTypes: channels.map(({ type }) => type),
      memberOverwrites,
      nsfwChannels,
      privilegedRoles,
      roleOverwrites,
      roles: roles.length,
      riskyPermissionClasses,
      unknownFields,
      unknownPermissionBitfields,
      unknownTargetOverwrites,
    }),
  }
}

function privacyProjection(): GuildTemplatePrivacyProjection {
  return {
    capabilities: "opaque-process-local-references",
    omittedFields: PRIVACY_OMITTED_FIELDS,
    persistence: "content-free-activity-only",
    rawPayloads: "omitted",
  }
}

function privateSnapshot(template: DiscordGuildTemplateSummary): Record<string, unknown> {
  return {
    code: template.code,
    createdAt: template.createdAt,
    creatorId: template.creatorId,
    description: template.description,
    isDirty: template.isDirty,
    name: template.name,
    serializedSourceGuild: template.serializedSourceGuild,
    sourceGuildId: template.sourceGuildId,
    unknownFieldCount: template.unknownFieldCount,
    updatedAt: template.updatedAt,
    usageCount: template.usageCount,
  }
}

function projectedTemplate(
  raw: DiscordGuildTemplateSummary,
  structure: ParsedStructure,
  guildId: string,
  planKey: Uint8Array,
): ProjectedGuildTemplate {
  if (raw.sourceGuildId !== guildId) {
    throw evidenceError("Discord returned a guild template for another source guild")
  }
  return {
    createdAt: raw.createdAt,
    creatorUserId: raw.creatorId,
    isDirty: raw.isDirty,
    metadata: {
      descriptionCharacters: raw.description === null
        ? null
        : [...raw.description].length,
      nameCharacters: [...raw.name].length,
    },
    structure: structure.view,
    templateRef: templateReference(planKey, guildId, raw.code),
    unknownFieldCount: raw.unknownFieldCount,
    updatedAt: raw.updatedAt,
    usageCount: raw.usageCount,
  }
}

function parseTemplate(
  raw: DiscordGuildTemplateSummary,
  guildId: string,
  planKey: Uint8Array,
): PrivateTemplate {
  const structure = parseTemplateStructure(raw.serializedSourceGuild, planKey)
  return {
    projected: projectedTemplate(raw, structure, guildId, planKey),
    raw,
    snapshot: privateSnapshot(raw),
    structure,
  }
}

function driftItems(
  template: readonly { identity: string; settings: string }[],
  live: readonly { identity: string; settings: string }[],
) {
  const group = (items: readonly { identity: string; settings: string }[]) => {
    const result = new Map<string, string[]>()
    for (const item of items) {
      const existing = result.get(item.identity) ?? []
      existing.push(item.settings)
      result.set(item.identity, existing)
    }
    return result
  }
  const expected = group(template)
  const actual = group(live)
  let added = 0
  let ambiguous = 0
  let changed = 0
  let missing = 0
  const identities = new Set([...expected.keys(), ...actual.keys()])
  for (const identity of identities) {
    const left = expected.get(identity) ?? []
    const right = actual.get(identity) ?? []
    if (left.length > 1 || right.length > 1) {
      ambiguous += Math.max(left.length, right.length)
      continue
    }
    if (left.length === 0) added += 1
    else if (right.length === 0) missing += 1
    else if (left[0] !== right[0]) changed += 1
  }
  return { added, ambiguous, changed, missing }
}

function templateDrift(
  template: ParsedStructure,
  live: ParsedStructure,
  channelComparisonComplete: boolean,
): GuildTemplateDrift {
  const channels = driftItems(template.channels, live.channels)
  const roles = driftItems(template.roles, live.roles)
  return {
    ambiguousChannelIdentities: channels.ambiguous,
    ambiguousRoleIdentities: roles.ambiguous,
    channelComparisonComplete,
    channelSettingsChanged: channels.changed,
    channelsAddedSinceSnapshot: channels.added,
    channelsMissingFromGuild: channels.missing,
    roleSettingsChanged: roles.changed,
    rolesAddedSinceSnapshot: roles.added,
    rolesMissingFromGuild: roles.missing,
  }
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    resourceId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  return name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128) || "UnknownError"
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: GuildTemplateChangePlan
  status: GuildTemplateActivityStatus
  templateRef?: string | null
  timestamp: string
  verification?: "drift" | "match" | null
}): GuildTemplateActivity {
  return {
    action: options.plan.action,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    id: options.activityId,
    kind: "guild-template-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    templateRef: options.templateRef === undefined
      ? options.plan.target?.templateRef ?? null
      : options.templateRef,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: GuildTemplateChangePlan
  resourceId?: string | null
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    kind: "guild-template-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.resourceId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (!(error instanceof GuildTemplateExecutionError)) return false
  if (!error.result || typeof error.result !== "object" || Array.isArray(error.result)) {
    return false
  }
  const status = (error.result as Record<string, unknown>).status
  return status === "uncertain" || status === "completed-record-failed"
}

async function withTargetLock<T>(
  state: TargetLockState,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => GuildTemplateExecutionError,
): Promise<T> {
  const prior = state.tails.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: TargetOutcome) => void = () => undefined
  const tail = new Promise<TargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(key, tail)
  let outcome: TargetOutcome = "settled"
  try {
    await prior
    if (state.uncertainTargets.has(key)) {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (uncertainExecution(error)) {
      outcome = "uncertain"
      state.uncertainTargets.add(key)
    }
    throw error
  } finally {
    release(outcome)
    if (state.tails.get(key) === tail) state.tails.delete(key)
  }
}

function limitations(): string[] {
  return [
    "Guild templates create future guilds from snapshots and are not backups of a live guild",
    "Templates do not preserve original IDs, members, messages, audit history, integrations, or application-owned resources",
    "Discord may omit unsupported channel types, managed roles, and guild features from the serialized snapshot",
    "Template codes and use URLs are reusable capabilities and are intentionally never returned",
  ]
}

function inventoryView(state: GuildTemplateState) {
  return {
    returned: state.templates.length,
    safetyLimit: GUILD_TEMPLATE_LIMITS.inventory,
  }
}

function desiredMetadata(
  request: NormalizedGuildTemplateChangeRequest,
): GuildTemplateChangePlan["desiredMetadata"] {
  if (request.action !== "create" && request.action !== "update-metadata") {
    return null
  }
  return {
    description: request.description,
    name: request.name,
  }
}

function metadataMatches(
  raw: DiscordGuildTemplateSummary,
  request: NormalizedGuildTemplateChangeRequest,
): boolean {
  return (request.name === undefined || raw.name === request.name)
    && (request.description === undefined || raw.description === request.description)
}

function sortedSnapshots(templates: readonly PrivateTemplate[]): Record<string, unknown>[] {
  return templates
    .map(({ snapshot }) => snapshot)
    .sort((left, right) => String(left.code).localeCompare(String(right.code)))
}

export class GuildTemplateService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildTemplateServiceClient
  readonly #clock: () => Date
  readonly #layoutSource: GatewayChannelLayoutSource
  readonly #lockState: TargetLockState = {
    tails: new Map(),
    uncertainTargets: new Set(),
  }
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: GuildTemplateServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: GuildTemplateServiceOptions) {
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
    botId: string,
    guildId: string,
    mode: "audit" | "change",
    options: RequestOptions,
    operationKeyHashValue?: string,
  ): Promise<GuildTemplateState> {
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord guild-template guild ID")
    if (mode === "change") {
      this.#policy.assertGuildTemplateChangeable(guildId)
    } else {
      this.#policy.assertGuildTemplateAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "guild-template-change",
        operationKeyHashValue,
      )
      if (receipt) {
        throw new GuildTemplateOperationConflictError(receiptView(receipt))
      }
    }
    let supportingEvidence: {
      guild: DiscordGuild
      member: DiscordGuildMember
      roles: DiscordRole[]
      templates: DiscordGuildTemplateSummary[]
    } | undefined
    let channelEvidence
    try {
      channelEvidence = await collectGuildChannelEvidence({
        guildId,
        layoutSource: this.#layoutSource,
        readChannels: async () => {
          const [guild, member, roles, channels, templates] = await Promise.all([
            this.#client.getGuild(guildId, options),
            this.#client.getGuildMember(guildId, botId, options),
            this.#client.getGuildRoles(guildId, options),
            this.#client.getGuildChannels(guildId, options),
            this.#client.listGuildTemplates(guildId, options),
          ])
          supportingEvidence = { guild, member, roles, templates }
          return channels
        },
      })
    } catch (error) {
      if (error instanceof GuildChannelEvidenceError) {
        throw evidenceError(
          `Discord guild-template channel evidence is incomplete: ${error.message}`,
        )
      }
      throw error
    }
    if (!supportingEvidence) {
      throw evidenceError("Discord guild-template supporting evidence is unavailable")
    }
    const {
      guild: rawGuild,
      member: rawMember,
      roles: rawRoles,
      templates: rawTemplates,
    } = supportingEvidence
    const rawChannels = channelEvidence.channels
    const guild = exactGuild(rawGuild, guildId)
    const member = exactBotMember(rawMember, guildId, botId)
    const roles = exactRoles(rawRoles, guildId)
    const channels = exactChannels(rawChannels, guildId, roles)
    const permissions = completePermissions(member, guildId, roles)
    const botIsGuildOwner = guild.owner_id === botId
    if (!botIsGuildOwner && !hasGuildPermission(permissions, "MANAGE_GUILD")) {
      throw evidenceError("Discord connector bot lacks guild-level MANAGE_GUILD")
    }
    if (
      !Array.isArray(rawTemplates)
      || rawTemplates.length > GUILD_TEMPLATE_LIMITS.inventory
    ) {
      throw evidenceError("Discord returned an invalid bounded guild-template inventory")
    }
    const templates = rawTemplates
      .map((template) => parseTemplate(template, guildId, this.#planKey))
      .sort((left, right) => (
        left.projected.templateRef.localeCompare(right.projected.templateRef)
      ))
    if (
      new Set(templates.map(({ projected }) => projected.templateRef)).size
      !== templates.length
    ) {
      throw evidenceError("Discord returned duplicate guild-template capabilities")
    }
    if (
      mode === "change"
      && templates.some(({ raw }) => raw.unknownFieldCount > 0)
    ) {
      throw evidenceError(
        "Discord guild-template inventory contains future top-level fields that block changes",
      )
    }
    const access = accessEvidence(permissions, botIsGuildOwner)
    const live = liveStructure(roles, channels, this.#planKey)
    const inventoryDigest = reviewedPlanDigest(this.#planKey, {
      access,
      botMemberRoleIds: [...member.roles].sort(),
      channelEvidence: channelEvidence.view,
      channels,
      domain: "guildcontrol-guild-template-inventory.v1",
      guild: {
        id: guild.id,
        name: guild.name,
        ownerId: guild.owner_id,
      },
      liveStructure: live,
      roles,
      templates: sortedSnapshots(templates),
    })
    return {
      access,
      channelEvidence: channelEvidence.view,
      channels,
      guild,
      inventoryDigest,
      liveStructure: live,
      roles,
      templates,
    }
  }

  async list(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildTemplateInventoryResult> {
    assertGuildTemplateListInput(guildId)
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(botId, guildId, "audit", options)
    return {
      access: state.access,
      applicationId,
      botId,
      channelEvidence: state.channelEvidence,
      guild: {
        id: state.guild.id,
      },
      inventory: inventoryView(state),
      limitations: limitations(),
      liveStructure: state.liveStructure.view,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      templates: state.templates.map(({ projected }) => projected),
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedGuildTemplateChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(
      botId,
      request.guildId,
      "change",
      options,
      request.operationKeyHash,
    )
    const target = request.templateRef
      ? state.templates.find(({ projected }) => (
          projected.templateRef === request.templateRef
        )) ?? null
      : null
    if (request.action !== "create" && !target) {
      throw evidenceError(
        "Discord guild-template reference is absent or expired for this process",
      )
    }
    if (target && request.auditReason.includes(target.raw.code)) {
      throw evidenceError("Discord guild-template audit reason must not contain the target code")
    }
    const drift = target
      ? templateDrift(
          target.structure,
          state.liveStructure,
          state.channelEvidence.metadataCoverage === "complete",
        )
      : null
    let mutation: GuildTemplateChangePlan["mutation"] = request.action
    if (
      request.action === "update-metadata"
      && target
      && metadataMatches(target.raw, request)
    ) mutation = "none"
    if (
      request.action === "synchronize"
      && target?.raw.isDirty === false
    ) mutation = "none"
    const privacy = privacyProjection()
    const capturesLiveSnapshot = request.action === "create"
      || request.action === "synchronize"
    if (capturesLiveSnapshot && state.channelEvidence.obfuscatedChannelCount > 0) {
      throw evidenceError(
        "Discord guild-template creation and synchronization require complete live channel metadata",
      )
    }
    const capturableLiveRoles = state.roles.filter(({ managed }) => !managed)
    const liveSnapshotHasPrivilegedRoles = capturableLiveRoles.some(({ permissions }) => (
      discordPermissionNames(BigInt(permissions))
        .some((name) => HIGH_RISK_PERMISSIONS.has(name))
    ))
    const liveSnapshotHasUnknownPermissionBits = capturableLiveRoles.some(
      ({ permissions }) => unknownDiscordPermissionBits(BigInt(permissions)) !== 0n,
    )
    const risks = [
      ...(request.action === "create"
        ? [
            "Creation exposes a new reusable guild-template capability in Discord",
            "Concurrent guild administration can change the snapshot captured by Discord",
          ]
        : []),
      ...(request.action === "synchronize"
        ? [
            "Synchronization irreversibly replaces the selected template snapshot",
            "Concurrent guild administration can change the snapshot captured by Discord",
          ]
        : []),
      ...(request.action === "update-metadata"
        ? ["Metadata changes alter how the reusable template capability is presented"]
        : []),
      ...(request.action === "delete"
        ? ["Deletion permanently revokes the selected template capability"]
        : []),
      ...(target?.projected.structure.roles.privileged
        ? ["The template snapshot contains one or more roles with high-risk permissions"]
        : []),
      ...(target?.projected.structure.channels.unknown
        ? ["The template snapshot contains channel types outside the known projection"]
        : []),
      ...(target?.projected.structure.unknownFields
        ? ["The template snapshot contains future fields that are digest-bound but not interpreted"]
        : []),
      ...(capturesLiveSnapshot && liveSnapshotHasPrivilegedRoles
        ? ["The live guild contains standard roles with high-risk permissions that Discord may capture"]
        : []),
      ...(capturesLiveSnapshot && liveSnapshotHasUnknownPermissionBits
        ? ["The live guild contains standard roles with unknown permission bits that Discord may capture"]
        : []),
      ...(capturesLiveSnapshot && state.liveStructure.view.channels.unknown
        ? ["The live guild contains channel types outside the known projection that Discord may omit or capture"]
        : []),
    ]
    const warnings = [
      ...limitations(),
      "The complete template inventory and continuity-stable live guild evidence are freshness-bound",
      ...(state.channelEvidence.metadataCoverage === "complete"
        ? []
        : ["Live channel structure and channel drift are visibility-bounded; metadata updates and deletion remain exact"]),
      "Count-only structural drift is advisory because Discord's serialized guild snapshot is partial",
      "Template codes, use URLs, names, descriptions, channel text, and role names never enter persistent state",
      "Opaque template references are process-local and expire when the connector restarts",
      "Discord does not document audit-log-reason support for template endpoints, so the reason is review-bound but not sent",
      "Discord exposes no conditional snapshot mutation, so prevent concurrent guild administration during creation or synchronization",
      "One non-retried mutation is allowed after durable reservation and pending activity",
      ...(state.access.botAdministrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped MANAGE_GUILD"]
        : []),
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      channelEvidence: state.channelEvidence,
      desiredMetadata: desiredMetadata(request),
      domain: "guildcontrol-guild-template-change-plan.v1",
      drift,
      inventoryDigest: state.inventoryDigest,
      liveStructure: state.liveStructure.view,
      mutation,
      privacy,
      request,
      risks,
      target: target?.projected ?? null,
      warnings,
    })
    const plan: GuildTemplateChangePlan = {
      access: state.access,
      action: request.action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      channelEvidence: state.channelEvidence,
      createdAt: this.#clock().toISOString(),
      desiredMetadata: desiredMetadata(request),
      digest,
      drift,
      guild: {
        id: state.guild.id,
      },
      inventory: inventoryView(state),
      liveStructure: state.liveStructure.view,
      mutation,
      operationKeyHash: request.operationKeyHash,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: mutation === "none" ? "already-current" : "planned",
      target: target?.projected ?? null,
      warnings,
    }
    return { plan, state, target }
  }

  plan(
    applicationId: string,
    botId: string,
    request: GuildTemplateChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildTemplateChangePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeGuildTemplateChangeRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  execute(
    applicationId: string,
    botId: string,
    request: GuildTemplateChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildTemplateChangeResult> {
    const normalized = normalizeGuildTemplateChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild-template plan digest is invalid")
    }
    return withTargetLock(
      this.#lockState,
      normalized.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new GuildTemplateExecutionError(
        "Discord guild-template change was blocked because a prior guild-template operation ended with an uncertain outcome",
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
    applicationId: string,
    botId: string,
    request: NormalizedGuildTemplateChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildTemplateChangeResult> {
    let built: BuiltPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof GuildTemplateEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GuildTemplatePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state, target } = built
    if (plan.digest !== expectedDigest) {
      throw new GuildTemplatePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: request.action,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.mutation === "none") {
      return {
        ...baseResult,
        activityId: null,
        readbackMatched: true,
        status: "already-current",
        templateRef: target?.projected.templateRef ?? null,
      }
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new GuildTemplateOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      const category = safeErrorCode(error)
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: category,
          plan,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch {}
      throw new GuildTemplateExecutionError(
        "Discord guild-template change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: category,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let mutationStarted = false
    let mutationAcknowledged = false
    let returned: DiscordGuildTemplateSummary | null = null
    let templateRef = target?.projected.templateRef ?? null
    try {
      mutationStarted = true
      if (plan.mutation === "create") {
        returned = await this.#client.createGuildTemplate(
          request.guildId,
          {
            description: request.description as string | null,
            name: request.name as string,
          },
          options,
        )
      } else if (plan.mutation === "synchronize") {
        if (!target) throw evidenceError("Discord guild-template synchronization lost its target")
        returned = await this.#client.syncGuildTemplate(
          request.guildId,
          target.raw.code,
          options,
        )
      } else if (plan.mutation === "update-metadata") {
        if (!target) throw evidenceError("Discord guild-template metadata update lost its target")
        const input: ModifyGuildTemplateInput = {
          ...(request.description !== undefined
            ? { description: request.description }
            : {}),
          ...(request.name !== undefined ? { name: request.name } : {}),
        }
        returned = await this.#client.modifyGuildTemplate(
          request.guildId,
          target.raw.code,
          input,
          options,
        )
      } else {
        if (!target) throw evidenceError("Discord guild-template deletion lost its target")
        returned = await this.#client.deleteGuildTemplate(
          request.guildId,
          target.raw.code,
          options,
        )
      }
      mutationAcknowledged = true
      const returnedTemplate = parseTemplate(returned, request.guildId, this.#planKey)
      templateRef = returnedTemplate.projected.templateRef
      if (
        (plan.mutation === "create" || plan.mutation === "synchronize")
        && returnedTemplate.raw.isDirty !== false
      ) {
        throw evidenceError("Discord returned a guild-template snapshot that is not clean")
      }
      if (
        plan.mutation !== "create"
        && templateRef !== target?.projected.templateRef
      ) {
        throw evidenceError("Discord returned another guild-template capability")
      }
      if (
        (plan.mutation === "create" || plan.mutation === "update-metadata")
        && !metadataMatches(returned, request)
      ) {
        throw evidenceError("Discord returned mismatched guild-template metadata")
      }
      const observed = await this.#state(botId, request.guildId, "audit", options)
      const expectedSnapshots = sortedSnapshots(state.templates)
      if (plan.mutation === "create") {
        expectedSnapshots.push(returnedTemplate.snapshot)
      } else if (plan.mutation === "delete") {
        const index = expectedSnapshots.findIndex((entry) => (
          entry.code === target?.raw.code
        ))
        if (index < 0) throw evidenceError("Discord guild-template deletion lost its snapshot")
        expectedSnapshots.splice(index, 1)
      } else {
        const index = expectedSnapshots.findIndex((entry) => (
          entry.code === target?.raw.code
        ))
        if (index < 0) throw evidenceError("Discord guild-template change lost its snapshot")
        expectedSnapshots[index] = returnedTemplate.snapshot
      }
      expectedSnapshots.sort((left, right) => (
        String(left.code).localeCompare(String(right.code))
      ))
      if (
        stableString(sortedSnapshots(observed.templates))
        !== stableString(expectedSnapshots)
      ) {
        throw evidenceError(
          "Discord guild-template readback changed the full inventory unexpectedly",
        )
      }
      const observedTarget = observed.templates.find(({ projected }) => (
        projected.templateRef === templateRef
      ))
      if (plan.mutation === "delete") {
        if (observedTarget) {
          throw evidenceError("Discord guild-template deletion readback retained the target")
        }
      } else if (
        !observedTarget
        || stableString(observedTarget.snapshot)
          !== stableString(returnedTemplate.snapshot)
      ) {
        throw evidenceError("Discord guild-template readback did not match the response")
      }
    } catch (error) {
      const knownRejected = mutationStarted
        && !mutationAcknowledged
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 408
        && error.status !== 429
      const status = knownRejected ? "failed" : "uncertain"
      const category = safeErrorCode(error)
      let recordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: category,
          plan,
          resourceId: templateRef,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (recordFailure) {
        recordError = safeErrorCode(recordFailure)
      }
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: category,
          plan,
          status,
          templateRef,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (recordFailure) {
        recordError = recordError ?? safeErrorCode(recordFailure)
      }
      throw new GuildTemplateExecutionError(
        status === "uncertain"
          ? "Discord guild-template change has an uncertain outcome and must not be retried"
          : "Discord rejected the guild-template change before applying it",
        {
          ...baseResult,
          activityId,
          error: category,
          recordError,
          status,
          templateRef,
        },
        { cause: error },
      )
    }

    let recordError: string | null = null
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        resourceId: templateRef,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      recordError = safeErrorCode(error)
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        status: "completed",
        templateRef,
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      recordError = recordError ?? safeErrorCode(error)
    }
    if (recordError) {
      throw new GuildTemplateExecutionError(
        "Discord guild-template change completed but durable completion recording failed",
        {
          ...baseResult,
          activityId,
          error: recordError,
          status: "completed-record-failed",
          templateRef,
        },
      )
    }
    return {
      ...baseResult,
      activityId,
      readbackMatched: true,
      status: "completed",
      templateRef,
    }
  }
}
