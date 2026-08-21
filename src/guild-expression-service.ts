import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GuildExpressionActivity,
  GuildExpressionActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildEmojiSummary,
  type DiscordGuildStickerSummary,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  GuildExpressionEvidenceError,
  GuildExpressionExecutionError,
  GuildExpressionOperationConflictError,
  GuildExpressionPlanChangedError,
} from "./errors.js"
import {
  GuildExpressionFileError,
  readGuildExpressionFileSnapshot,
  type GuildExpressionFileReview,
  type GuildExpressionFileSnapshot,
} from "./guild-expression-file.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  hasGuildPermission,
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
  RequestOptions,
} from "./types.js"

export const GUILD_EXPRESSION_OMITTED_FIELDS = Object.freeze([
  "cdnUrl",
  "imageBytes",
  "rawDiscordObject",
  "uploaderProfile",
] as const)

const EXPRESSION_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const GUILD_FEATURE_PATTERN = /^[A-Z0-9_]+$/u
const STATE_UNAVAILABLE = "guild-expression-state-unavailable"
const EXPRESSION_TARGET_LOCKS = new Map<string, Promise<ExpressionTargetOutcome>>()
const STICKER_FORMAT_TYPES = Object.freeze({
  apng: 2,
  gif: 4,
  lottie: 3,
  png: 1,
})

type ExpressionTargetOutcome = "settled" | "uncertain"
export type GuildExpressionAction = "create" | "delete" | "update"
export type GuildExpressionKind = "emoji" | "sticker"

interface GuildExpressionRequestBase {
  action: GuildExpressionAction
  auditReason: string
  guildId: string
  kind: GuildExpressionKind
  operationKey: string
}

export interface CreateGuildEmojiRequest extends GuildExpressionRequestBase {
  action: "create"
  filePath: string
  kind: "emoji"
  name: string
  roleIds?: readonly string[]
}

export interface UpdateGuildEmojiRequest extends GuildExpressionRequestBase {
  action: "update"
  expressionId: string
  kind: "emoji"
  name?: string
  roleIds?: readonly string[]
}

export interface DeleteGuildEmojiRequest extends GuildExpressionRequestBase {
  action: "delete"
  expressionId: string
  kind: "emoji"
}

export interface CreateGuildStickerRequest extends GuildExpressionRequestBase {
  action: "create"
  description: string
  filePath: string
  kind: "sticker"
  name: string
  tags: string
}

export interface UpdateGuildStickerRequest extends GuildExpressionRequestBase {
  action: "update"
  description?: string | null
  expressionId: string
  kind: "sticker"
  name?: string
  tags?: string
}

export interface DeleteGuildStickerRequest extends GuildExpressionRequestBase {
  action: "delete"
  expressionId: string
  kind: "sticker"
}

export type GuildExpressionChangeRequest =
  | CreateGuildEmojiRequest
  | CreateGuildStickerRequest
  | DeleteGuildEmojiRequest
  | DeleteGuildStickerRequest
  | UpdateGuildEmojiRequest
  | UpdateGuildStickerRequest

interface NormalizedRequestBase {
  action: GuildExpressionAction
  auditReason: string
  guildId: string
  kind: GuildExpressionKind
  operationKeyHash: string
}

export type NormalizedGuildExpressionChangeRequest =
  | (Omit<CreateGuildEmojiRequest, keyof GuildExpressionRequestBase | "roleIds"> & NormalizedRequestBase & {
      action: "create"
      kind: "emoji"
      roleIds: string[]
    })
  | (Omit<UpdateGuildEmojiRequest, keyof GuildExpressionRequestBase | "roleIds"> & NormalizedRequestBase & {
      action: "update"
      kind: "emoji"
      roleIds?: string[]
    })
  | (Omit<DeleteGuildEmojiRequest, keyof GuildExpressionRequestBase> & NormalizedRequestBase & {
      action: "delete"
      kind: "emoji"
    })
  | (Omit<CreateGuildStickerRequest, keyof GuildExpressionRequestBase> & NormalizedRequestBase & {
      action: "create"
      kind: "sticker"
    })
  | (Omit<UpdateGuildStickerRequest, keyof GuildExpressionRequestBase> & NormalizedRequestBase & {
      action: "update"
      kind: "sticker"
    })
  | (Omit<DeleteGuildStickerRequest, keyof GuildExpressionRequestBase> & NormalizedRequestBase & {
      action: "delete"
      kind: "sticker"
    })

export interface ProjectedGuildEmoji {
  animated: boolean
  available: boolean
  creatorUserId: string | null
  expressionId: string
  kind: "emoji"
  managed: boolean
  name: string
  requiresColons: boolean
  roleIds: string[]
}

export interface ProjectedGuildSticker {
  available: boolean
  creatorUserId: string | null
  description: string | null
  expressionId: string
  formatType: number
  guildId: string
  kind: "sticker"
  name: string
  tags: string
}

export type ProjectedGuildExpression = ProjectedGuildEmoji | ProjectedGuildSticker
export type PlannedGuildExpression =
  | (Omit<ProjectedGuildEmoji, "expressionId"> & { expressionId: string | null })
  | (Omit<ProjectedGuildSticker, "expressionId"> & { expressionId: string | null })

export interface GuildExpressionPermissionEvidence {
  administrator: boolean
  confidence: "complete"
  createGuildExpressions: boolean
  effectivePermissions: string
  guildOwner: boolean
  manageGuildExpressions: boolean
  ownershipRequired: boolean
}

export interface GuildExpressionPrivacyProjection {
  omittedFields: typeof GUILD_EXPRESSION_OMITTED_FIELDS
  privateFieldsProjectedOut: true
}

export interface GuildExpressionInventoryResult {
  expressions: ProjectedGuildExpression[]
  guild: {
    id: string
    name: string
  }
  kind: GuildExpressionKind
  page: {
    returned: number
    safetyLimit: number
  }
  permission: GuildExpressionPermissionEvidence
  privacy: GuildExpressionPrivacyProjection
  schemaVersion: number
  status: "ok"
}

export interface GuildExpressionLookupResult extends Omit<
  GuildExpressionInventoryResult,
  "expressions" | "page"
> {
  expression: ProjectedGuildExpression
}

export interface GuildExpressionPlan {
  action: GuildExpressionAction
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  desired: PlannedGuildExpression | null
  digest: string
  effect: "change" | "none"
  existing: ProjectedGuildExpression | null
  file: {
    contentDigest: string
    review: GuildExpressionFileReview
  } | null
  guild: {
    id: string
    name: string
  }
  kind: GuildExpressionKind
  operationKeyHash: string
  permission: GuildExpressionPermissionEvidence
  privacy: GuildExpressionPrivacyProjection
  schemaVersion: number
  status: "already-current" | "planned"
  visibleInventory: {
    returned: number
    safetyLimit: number
  }
  warnings: string[]
}

export interface GuildExpressionResult {
  action: GuildExpressionAction
  activityId: string | null
  expressionId: string
  guildId: string
  kind: GuildExpressionKind
  observed: ProjectedGuildExpression | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
}

export interface GuildExpressionServiceClient extends Pick<
  DiscordClient,
  | "createGuildEmoji"
  | "createGuildSticker"
  | "deleteGuildEmoji"
  | "deleteGuildSticker"
  | "getGuild"
  | "getGuildEmoji"
  | "getGuildMember"
  | "getGuildRoles"
  | "getGuildSticker"
  | "listGuildEmojis"
  | "listGuildStickers"
  | "modifyGuildEmoji"
  | "modifyGuildSticker"
> {}

export interface GuildExpressionServiceOptions {
  activityStore: ActivityStore
  client: GuildExpressionServiceClient
  clock?: () => Date
  fileRoots: readonly string[]
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface GuildExpressionState {
  botMember: DiscordGuildMember
  guild: DiscordGuild & { owner_id: string }
  inventory: ProjectedGuildExpression[]
  permission: GuildExpressionPermissionEvidence
  rawRoles: DiscordRole[]
}

interface BuiltGuildExpressionPlan {
  fileSnapshot: GuildExpressionFileSnapshot | null
  plan: GuildExpressionPlan
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function validSnowflake(value: unknown): value is string {
  try {
    assertSnowflake(value, "Discord ID")
    return true
  } catch {
    return false
  }
}

function assertValidUnicode(value: string, description: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${description} contains invalid Unicode`, { cause: error })
  }
}

function assertExpressionName(name: unknown, kind: GuildExpressionKind): asserts name is string {
  const maximum = kind === "emoji"
    ? DISCORD_LIMITS.emojiNameCharacters
    : DISCORD_LIMITS.stickerNameCharacters
  if (
    typeof name !== "string"
    || name.length < 2
    || name.length > maximum
    || name.trim() !== name
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(name)
    || (kind === "emoji" && !/^[A-Za-z0-9_]+$/u.test(name))
  ) {
    throw new RangeError(
      kind === "emoji"
        ? `Discord emoji name must contain 2-${maximum} ASCII letters, digits, or underscores`
        : `Discord sticker name must contain 2-${maximum} trimmed characters without controls`,
    )
  }
  assertValidUnicode(name, `Discord ${kind} name`)
}

function assertStickerDescription(
  description: unknown,
): asserts description is string | null {
  if (description === null) return
  if (
    typeof description !== "string"
    || description.length === 1
    || description.length > DISCORD_LIMITS.stickerDescriptionCharacters
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(description)
  ) {
    throw new RangeError(
      `Discord sticker description must be empty or contain 2-${DISCORD_LIMITS.stickerDescriptionCharacters} characters without controls`,
    )
  }
  assertValidUnicode(description, "Discord sticker description")
}

function assertStickerTags(tags: unknown): asserts tags is string {
  if (
    typeof tags !== "string"
    || tags.length < 1
    || tags.length > DISCORD_LIMITS.stickerTagCharacters
    || !tags.trim()
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(tags)
  ) {
    throw new RangeError(
      `Discord sticker tags must contain 1-${DISCORD_LIMITS.stickerTagCharacters} characters without controls`,
    )
  }
  assertValidUnicode(tags, "Discord sticker tags")
}

function normalizedRoleIds(value: unknown): string[] {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.guildRoles
    || new Set(value).size !== value.length
    || value.some((roleId) => !validSnowflake(roleId))
  ) {
    throw new RangeError("Discord emoji role IDs must be a bounded unique snowflake array")
  }
  return [...value].sort()
}

export function normalizeGuildExpressionChangeRequest(
  request: GuildExpressionChangeRequest,
): NormalizedGuildExpressionChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild expression change request must be an object")
  }
  assertSnowflake(request.guildId, "Discord guild expression guild ID")
  if (request.kind !== "emoji" && request.kind !== "sticker") {
    throw new RangeError("Discord guild expression kind must be emoji or sticker")
  }
  if (!(["create", "delete", "update"] as const).includes(request.action)) {
    throw new RangeError("Discord guild expression action must be create, update, or delete")
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord guild expression audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  const base = {
    action: request.action,
    auditReason: request.auditReason,
    guildId: request.guildId,
    kind: request.kind,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
  if (request.action === "delete") {
    assertSnowflake(request.expressionId, `Discord ${request.kind} ID`)
    return { ...base, action: "delete", expressionId: request.expressionId } as NormalizedGuildExpressionChangeRequest
  }
  if (request.kind === "emoji" && request.action === "create") {
    assertExpressionName(request.name, "emoji")
    if (typeof request.filePath !== "string") {
      throw new RangeError("Discord emoji creation requires one local file path")
    }
    return {
      ...base,
      action: "create",
      filePath: request.filePath,
      kind: "emoji",
      name: request.name,
      roleIds: normalizedRoleIds(request.roleIds ?? []),
    }
  }
  if (request.kind === "emoji") {
    assertSnowflake(request.expressionId, "Discord emoji ID")
    if (request.name === undefined && request.roleIds === undefined) {
      throw new RangeError("Discord emoji update must contain a name or role IDs")
    }
    if (request.name !== undefined) assertExpressionName(request.name, "emoji")
    return {
      ...base,
      action: "update",
      expressionId: request.expressionId,
      kind: "emoji",
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.roleIds !== undefined
        ? { roleIds: normalizedRoleIds(request.roleIds) }
        : {}),
    }
  }
  if (request.action === "create") {
    assertExpressionName(request.name, "sticker")
    if (typeof request.description !== "string") {
      throw new RangeError("Discord sticker creation description must be a string")
    }
    assertStickerDescription(request.description)
    assertStickerTags(request.tags)
    if (typeof request.filePath !== "string") {
      throw new RangeError("Discord sticker creation requires one local file path")
    }
    return {
      ...base,
      action: "create",
      description: request.description,
      filePath: request.filePath,
      kind: "sticker",
      name: request.name,
      tags: request.tags,
    }
  }
  assertSnowflake(request.expressionId, "Discord sticker ID")
  if (
    request.name === undefined
    && request.description === undefined
    && request.tags === undefined
  ) {
    throw new RangeError("Discord sticker update must contain a name, description, or tags")
  }
  if (request.name !== undefined) assertExpressionName(request.name, "sticker")
  if (request.description !== undefined) assertStickerDescription(request.description)
  if (request.tags !== undefined) assertStickerTags(request.tags)
  return {
    ...base,
    action: "update",
    expressionId: request.expressionId,
    kind: "sticker",
    ...(request.description !== undefined ? { description: request.description } : {}),
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.tags !== undefined ? { tags: request.tags } : {}),
  }
}

function exactGuild(
  guild: DiscordGuild,
  guildId: string,
): DiscordGuild & { owner_id: string } {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || guild.name.length > DISCORD_LIMITS.channelNameCharacters
    || EXPRESSION_TEXT_CONTROL_PATTERN.test(guild.name)
    || !validSnowflake(guild.owner_id)
  ) {
    throw new GuildExpressionEvidenceError(
      "Discord returned invalid guild expression guild evidence",
    )
  }
  try {
    assertValidUnicode(guild.name, "Discord guild name")
  } catch (error) {
    throw new GuildExpressionEvidenceError(
      "Discord returned invalid guild expression guild evidence",
      { cause: error },
    )
  }
  return guild as DiscordGuild & { owner_id: string }
}

function exactBotMember(member: DiscordGuildMember, botId: string): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(member.roles).size !== member.roles.length
    || member.roles.some((roleId) => !validSnowflake(roleId))
    || member.user?.id !== botId
    || member.user.bot !== true
  ) {
    throw new GuildExpressionEvidenceError(
      "Discord returned invalid guild expression bot-member evidence",
    )
  }
  return member
}

function exactRoles(roles: readonly DiscordRole[], guildId: string): DiscordRole[] {
  if (
    !Array.isArray(roles)
    || roles.length < 1
    || roles.length > DISCORD_LIMITS.guildRoles
  ) {
    throw new GuildExpressionEvidenceError(
      "Discord returned an invalid guild expression role inventory",
    )
  }
  const seen = new Set<string>()
  for (const role of roles) {
    if (
      !role
      || typeof role !== "object"
      || !validSnowflake(role.id)
      || seen.has(role.id)
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(role.permissions)
      || !Number.isInteger(role.position)
      || role.position < 0
      || typeof role.managed !== "boolean"
    ) {
      throw new GuildExpressionEvidenceError(
        "Discord returned an invalid guild expression role inventory",
      )
    }
    seen.add(role.id)
  }
  if (!seen.has(guildId)) {
    throw new GuildExpressionEvidenceError(
      "Discord guild expression role inventory omitted the @everyone role",
    )
  }
  return [...roles]
}

function projectedEmoji(emoji: DiscordGuildEmojiSummary): ProjectedGuildEmoji {
  if (
    !emoji
    || typeof emoji !== "object"
    || !validSnowflake(emoji.id)
    || typeof emoji.animated !== "boolean"
    || typeof emoji.available !== "boolean"
    || typeof emoji.managed !== "boolean"
    || typeof emoji.requiresColons !== "boolean"
    || !(emoji.creatorUserId === null || validSnowflake(emoji.creatorUserId))
  ) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild emoji")
  }
  try {
    assertExpressionName(emoji.name, "emoji")
  } catch (error) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild emoji", {
      cause: error,
    })
  }
  let roleIds: string[]
  try {
    roleIds = normalizedRoleIds(emoji.roleIds)
  } catch (error) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild emoji", {
      cause: error,
    })
  }
  return {
    animated: emoji.animated,
    available: emoji.available,
    creatorUserId: emoji.creatorUserId,
    expressionId: emoji.id,
    kind: "emoji",
    managed: emoji.managed,
    name: emoji.name,
    requiresColons: emoji.requiresColons,
    roleIds,
  }
}

function projectedSticker(
  sticker: DiscordGuildStickerSummary,
  guildId: string,
): ProjectedGuildSticker {
  if (
    !sticker
    || typeof sticker !== "object"
    || !validSnowflake(sticker.id)
    || sticker.guildId !== guildId
    || typeof sticker.available !== "boolean"
    || !(sticker.creatorUserId === null || validSnowflake(sticker.creatorUserId))
    || ![1, 2, 3, 4].includes(sticker.formatType)
    || sticker.type !== 2
  ) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild sticker")
  }
  try {
    assertExpressionName(sticker.name, "sticker")
    assertStickerDescription(sticker.description)
    assertStickerTags(sticker.tags)
  } catch (error) {
    throw new GuildExpressionEvidenceError("Discord returned an invalid guild sticker", {
      cause: error,
    })
  }
  return {
    available: sticker.available,
    creatorUserId: sticker.creatorUserId,
    description: sticker.description,
    expressionId: sticker.id,
    formatType: sticker.formatType,
    guildId,
    kind: "sticker",
    name: sticker.name,
    tags: sticker.tags,
  }
}

function exactInventory(
  kind: GuildExpressionKind,
  inventory: readonly (DiscordGuildEmojiSummary | DiscordGuildStickerSummary)[],
  guildId: string,
): ProjectedGuildExpression[] {
  const limit = kind === "emoji"
    ? DISCORD_LIMITS.guildEmojis
    : DISCORD_LIMITS.guildStickers
  if (!Array.isArray(inventory) || inventory.length > limit) {
    throw new GuildExpressionEvidenceError(
      `Discord returned an invalid guild ${kind} inventory`,
    )
  }
  const seen = new Set<string>()
  const projected = inventory.map((entry) => (
    kind === "emoji"
      ? projectedEmoji(entry as DiscordGuildEmojiSummary)
      : projectedSticker(entry as DiscordGuildStickerSummary, guildId)
  ))
  for (const expression of projected) {
    if (seen.has(expression.expressionId)) {
      throw new GuildExpressionEvidenceError(
        `Discord returned duplicate ${kind} IDs in one guild inventory`,
      )
    }
    seen.add(expression.expressionId)
  }
  return projected.sort((left, right) => {
    const leftId = BigInt(left.expressionId)
    const rightId = BigInt(right.expressionId)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

function permissionEvidence(
  permissions: GuildMemberPermissionResult,
  guildOwner: boolean,
): GuildExpressionPermissionEvidence {
  return {
    administrator: permissions.administrator,
    confidence: "complete",
    createGuildExpressions: guildOwner
      || hasGuildPermission(permissions, "CREATE_GUILD_EXPRESSIONS"),
    effectivePermissions: permissions.effectivePermissions,
    guildOwner,
    manageGuildExpressions: guildOwner
      || hasGuildPermission(permissions, "MANAGE_GUILD_EXPRESSIONS"),
    ownershipRequired: !guildOwner
      && !hasGuildPermission(permissions, "MANAGE_GUILD_EXPRESSIONS"),
  }
}

function privacyProjection(): GuildExpressionPrivacyProjection {
  return {
    omittedFields: GUILD_EXPRESSION_OMITTED_FIELDS,
    privateFieldsProjectedOut: true,
  }
}

function roleSnapshot(
  roles: readonly DiscordRole[],
  appliedRoleIds: readonly string[],
) {
  const relevant = new Set(appliedRoleIds)
  return roles
    .filter((role) => relevant.has(role.id))
    .map((role) => ({
      id: role.id,
      managed: role.managed,
      permissions: role.permissions,
      position: role.position,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function expressionNameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-US")
}

function assertLottieStickerGuildEligible(
  guild: DiscordGuild,
): void {
  const features = guild.features
  if (
    !Array.isArray(features)
    || features.length > DISCORD_LIMITS.guildFeatures
    || new Set(features).size !== features.length
    || features.some((feature) => (
      typeof feature !== "string"
      || feature.length < 1
      || feature.length > DISCORD_LIMITS.guildFeatureCharacters
      || !GUILD_FEATURE_PATTERN.test(feature)
    ))
  ) {
    throw new GuildExpressionEvidenceError(
      "Discord returned incomplete Lottie sticker guild-feature evidence",
    )
  }
  if (!features.includes("VERIFIED") && !features.includes("PARTNERED")) {
    throw new GuildExpressionEvidenceError(
      "Discord Lottie stickers require a VERIFIED or PARTNERED guild feature",
    )
  }
}

function sameExpression(
  left: PlannedGuildExpression,
  right: PlannedGuildExpression,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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
    expressionId: receipt.resourceId,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function targetId(request: NormalizedGuildExpressionChangeRequest): string | null {
  return request.action === "create" ? null : request.expressionId
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  expressionId?: string | null
  plan: GuildExpressionPlan
  request: NormalizedGuildExpressionChangeRequest
  status: GuildExpressionActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): GuildExpressionActivity {
  return {
    action: options.request.action,
    error: options.error ?? null,
    expressionId: options.expressionId === undefined
      ? targetId(options.request)
      : options.expressionId,
    expressionKind: options.request.kind,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "guild-expression-change",
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
  expressionId?: string | null
  plan: GuildExpressionPlan
  request: NormalizedGuildExpressionChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "guild-expression-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.expressionId ?? targetId(options.request),
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof GuildExpressionExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withGuildLock<T>(
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => GuildExpressionExecutionError,
): Promise<T> {
  const prior = EXPRESSION_TARGET_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: ExpressionTargetOutcome) => void = () => undefined
  const tail = new Promise<ExpressionTargetOutcome>((resolve) => {
    release = resolve
  })
  EXPRESSION_TARGET_LOCKS.set(guildId, tail)
  let outcome: ExpressionTargetOutcome = "settled"
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
    if (EXPRESSION_TARGET_LOCKS.get(guildId) === tail) {
      EXPRESSION_TARGET_LOCKS.delete(guildId)
    }
  }
}

export class GuildExpressionService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildExpressionServiceClient
  readonly #clock: () => Date
  readonly #fileRoots: readonly string[]
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: GuildExpressionServiceOptions) {
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
    guildId: string,
    kind: GuildExpressionKind,
    mode: "audit" | "change",
    options: RequestOptions,
    operationKeyHashValue?: string,
  ): Promise<GuildExpressionState> {
    assertSnowflake(botId, "Discord connector bot ID")
    assertSnowflake(guildId, "Discord guild expression guild ID")
    if (mode === "change") {
      this.#policy.assertGuildExpressionChangeAllowed(guildId)
    } else {
      this.#policy.assertGuildExpressionAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "guild-expression-change",
        operationKeyHashValue,
      )
      if (receipt) throw new GuildExpressionOperationConflictError(receiptView(receipt))
    }
    const inventoryPromise = kind === "emoji"
      ? this.#client.listGuildEmojis(guildId, options)
      : this.#client.listGuildStickers(guildId, options)
    const [rawGuild, rawMember, rawRoles, rawInventory] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      inventoryPromise,
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, botId)
    const roles = exactRoles(rawRoles, guildId)
    let permissions: GuildMemberPermissionResult
    try {
      permissions = evaluateGuildMemberPermissions({
        guildId,
        member: botMember,
        roles,
      })
    } catch (error) {
      throw new GuildExpressionEvidenceError(
        `Discord connector bot guild expression permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    if (!permissions.complete) {
      throw new GuildExpressionEvidenceError(
        "Discord connector bot guild expression permission evidence is incomplete",
      )
    }
    return {
      botMember,
      guild,
      inventory: exactInventory(kind, rawInventory, guildId),
      permission: permissionEvidence(permissions, guild.owner_id === botId),
      rawRoles: roles,
    }
  }

  async list(
    botId: string,
    guildId: string,
    kind: GuildExpressionKind,
    options: RequestOptions = {},
  ): Promise<GuildExpressionInventoryResult> {
    if (kind !== "emoji" && kind !== "sticker") {
      throw new RangeError("Discord guild expression kind must be emoji or sticker")
    }
    const state = await this.#state(botId, guildId, kind, "audit", options)
    return {
      expressions: state.inventory,
      guild: { id: guildId, name: state.guild.name },
      kind,
      page: {
        returned: state.inventory.length,
        safetyLimit: kind === "emoji"
          ? DISCORD_LIMITS.guildEmojis
          : DISCORD_LIMITS.guildStickers,
      },
      permission: state.permission,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async get(
    botId: string,
    guildId: string,
    kind: GuildExpressionKind,
    expressionId: string,
    options: RequestOptions = {},
  ): Promise<GuildExpressionLookupResult> {
    assertSnowflake(expressionId, `Discord ${kind} ID`)
    const inventory = await this.list(botId, guildId, kind, options)
    const expression = inventory.expressions.find(
      (entry) => entry.expressionId === expressionId,
    )
    if (!expression) {
      throw new GuildExpressionEvidenceError(
        `Discord ${kind} is absent from the exact guild inventory`,
      )
    }
    return {
      expression,
      guild: inventory.guild,
      kind,
      permission: inventory.permission,
      privacy: inventory.privacy,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  #assertChangeAuthority(
    request: NormalizedGuildExpressionChangeRequest,
    state: GuildExpressionState,
    existing: ProjectedGuildExpression | null,
  ): void {
    if (request.action === "create") {
      if (!state.permission.createGuildExpressions) {
        throw new GuildExpressionEvidenceError(
          "Discord connector bot lacks CREATE_GUILD_EXPRESSIONS, which Discord requires for expression creation",
        )
      }
      return
    }
    if (!existing) {
      throw new GuildExpressionEvidenceError(
        `Discord ${request.kind} is absent from the exact guild inventory`,
      )
    }
    if (existing.kind === "emoji" && existing.managed) {
      throw new GuildExpressionEvidenceError("Discord managed emojis cannot be changed")
    }
    if (state.permission.manageGuildExpressions) return
    if (
      state.permission.createGuildExpressions
      && existing.creatorUserId !== null
      && existing.creatorUserId === state.botMember.user?.id
    ) return
    throw new GuildExpressionEvidenceError(
      `Discord connector bot lacks authority over this ${request.kind}; MANAGE_GUILD_EXPRESSIONS or bot ownership with CREATE_GUILD_EXPRESSIONS is required`,
    )
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedGuildExpressionChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltGuildExpressionPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(
      botId,
      request.guildId,
      request.kind,
      "change",
      options,
      request.operationKeyHash,
    )
    const existing = request.action === "create"
      ? null
      : state.inventory.find((entry) => entry.expressionId === request.expressionId) ?? null
    this.#assertChangeAuthority(request, state, existing)
    const planPermission = {
      ...state.permission,
      ownershipRequired: request.action !== "create"
        && state.permission.ownershipRequired,
    }

    const rolesById = new Set(state.rawRoles.map((role) => role.id))
    if (request.kind === "emoji" && "roleIds" in request && request.roleIds) {
      const missing = request.roleIds.filter((roleId) => !rolesById.has(roleId))
      if (missing.length > 0) {
        throw new GuildExpressionEvidenceError(
          "Discord emoji role restriction references a role absent from the exact guild inventory",
        )
      }
    }

    if (request.action === "create") {
      const limit = request.kind === "emoji"
        ? DISCORD_LIMITS.guildEmojis
        : DISCORD_LIMITS.guildStickers
      if (state.inventory.length >= limit) {
        throw new GuildExpressionEvidenceError(
          `Discord ${request.kind} inventory reached the local ${limit}-item safety limit`,
        )
      }
      const nameKey = expressionNameKey(request.name)
      if (state.inventory.some((entry) => expressionNameKey(entry.name) === nameKey)) {
        throw new GuildExpressionEvidenceError(
          `Discord ${request.kind} creation conflicts with an existing normalized name`,
        )
      }
    } else if (
      request.action === "update"
      && request.name !== undefined
      && state.inventory.some((entry) => (
        entry.expressionId !== request.expressionId
        && expressionNameKey(entry.name) === expressionNameKey(request.name!)
      ))
    ) {
      throw new GuildExpressionEvidenceError(
        `Discord ${request.kind} update conflicts with an existing normalized name`,
      )
    }

    let fileSnapshot: GuildExpressionFileSnapshot | null = null
    if (request.action === "create") {
      fileSnapshot = await readGuildExpressionFileSnapshot({
        filePath: request.filePath,
        kind: request.kind,
        planKey: this.#planKey,
        roots: this.#fileRoots,
      })
      if (request.kind === "sticker" && fileSnapshot.review.format === "lottie") {
        assertLottieStickerGuildEligible(state.guild)
      }
    }

    let desired: PlannedGuildExpression | null
    if (request.action === "delete") {
      desired = null
    } else if (request.kind === "emoji" && request.action === "create") {
      desired = {
        animated: fileSnapshot!.review.animated,
        available: true,
        creatorUserId: botId,
        expressionId: null,
        kind: "emoji",
        managed: false,
        name: request.name,
        requiresColons: true,
        roleIds: request.roleIds,
      }
    } else if (request.kind === "sticker" && request.action === "create") {
      desired = {
        available: true,
        creatorUserId: botId,
        description: request.description,
        expressionId: null,
        formatType: STICKER_FORMAT_TYPES[fileSnapshot!.review.format as keyof typeof STICKER_FORMAT_TYPES],
        guildId: request.guildId,
        kind: "sticker",
        name: request.name,
        tags: request.tags,
      }
    } else if (request.kind === "emoji" && request.action === "update") {
      const emoji = existing as ProjectedGuildEmoji
      desired = {
        ...emoji,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.roleIds !== undefined ? { roleIds: request.roleIds } : {}),
      }
    } else {
      const sticker = existing as ProjectedGuildSticker
      const update = request as Extract<NormalizedGuildExpressionChangeRequest, {
        action: "update"
        kind: "sticker"
      }>
      desired = {
        ...sticker,
        ...(update.description !== undefined ? { description: update.description } : {}),
        ...(update.name !== undefined ? { name: update.name } : {}),
        ...(update.tags !== undefined ? { tags: update.tags } : {}),
      }
    }
    const effect = request.action === "update"
      && existing !== null
      && desired !== null
      && sameExpression(existing, desired)
      ? "none"
      : "change"
    const privacy = privacyProjection()
    const warnings = [
      ...(state.permission.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped guild-expression permissions"]
        : []),
      ...(planPermission.ownershipRequired
        ? ["The change relies on Discord's bot-ownership rule and will be rejected if fresh creator evidence changes"]
        : []),
      ...(request.action === "create"
        ? ["Discord tier-specific expression slots are enforced by Discord after the bounded local inventory check"]
        : []),
      ...(request.kind === "sticker"
        && request.action === "create"
        && fileSnapshot?.review.format === "lottie"
        ? ["The fresh guild feature inventory confirms eligibility for Lottie sticker upload"]
        : []),
      "Expression image bytes and CDN URLs cannot be read back; verification covers stable metadata and exact identity only",
      "Guild and expression names, descriptions, and tags are untrusted Discord data and are never persisted by this workflow",
      "Guild-expression serialization is process-local; do not run connector processes with overlapping guild-expression scope",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const reviewedRequest = {
      ...request,
      ...(request.action === "create" ? { filePath: request.filePath } : {}),
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      desired,
      existing,
      file: fileSnapshot
        ? {
            binding: fileSnapshot.binding,
            contentDigest: fileSnapshot.contentDigest,
            review: fileSnapshot.review,
          }
        : null,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      inventory: state.inventory,
      permission: planPermission,
      request: reviewedRequest,
      roles: roleSnapshot(state.rawRoles, state.botMember.roles.concat(request.guildId)),
      warnings,
    })
    return {
      fileSnapshot,
      plan: {
        action: request.action,
        applicationId,
        auditReason: request.auditReason,
        botId,
        createdAt: this.#clock().toISOString(),
        desired,
        digest,
        effect,
        existing,
        file: fileSnapshot
          ? {
              contentDigest: fileSnapshot.contentDigest,
              review: fileSnapshot.review,
            }
          : null,
        guild: { id: request.guildId, name: state.guild.name },
        kind: request.kind,
        operationKeyHash: request.operationKeyHash,
        permission: planPermission,
        privacy,
        schemaVersion: SCHEMA_VERSION,
        status: effect === "none" ? "already-current" : "planned",
        visibleInventory: {
          returned: state.inventory.length,
          safetyLimit: request.kind === "emoji"
            ? DISCORD_LIMITS.guildEmojis
            : DISCORD_LIMITS.guildStickers,
        },
        warnings,
      },
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildExpressionChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildExpressionPlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      normalizeGuildExpressionChangeRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: GuildExpressionChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildExpressionResult> {
    const normalized = normalizeGuildExpressionChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild expression plan digest is invalid")
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
      () => new GuildExpressionExecutionError(
        "Discord guild expression change was blocked because a prior same-guild operation ended with an uncertain outcome",
        {
          action: normalized.action,
          guildId: normalized.guildId,
          kind: normalized.kind,
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
    request: NormalizedGuildExpressionChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildExpressionResult> {
    let built: BuiltGuildExpressionPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof GuildExpressionEvidenceError
        || error instanceof GuildExpressionFileError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GuildExpressionPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { fileSnapshot, plan } = built
    if (plan.digest !== expectedDigest) {
      throw new GuildExpressionPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: request.action,
      guildId: request.guildId,
      kind: request.kind,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.effect === "none") {
      const existing = plan.existing as ProjectedGuildExpression
      return {
        ...baseResult,
        activityId: null,
        expressionId: existing.expressionId,
        observed: existing,
        status: "already-current",
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
      throw new GuildExpressionOperationConflictError(receiptView(reservation.receipt))
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
      throw new GuildExpressionExecutionError(
        "Discord guild expression change was blocked because pending activity could not be recorded",
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

    let expressionId = targetId(request)
    let mutationCompleted = false
    let observed: ProjectedGuildExpression | null = null
    try {
      if (request.kind === "emoji" && request.action === "create") {
        const created = await this.#client.createGuildEmoji(request.guildId, {
          bytes: fileSnapshot!.bytes,
          format: fileSnapshot!.review.format as "avif" | "gif" | "jpeg" | "png" | "webp",
          name: request.name,
          roleIds: request.roleIds,
        }, request.auditReason, options)
        mutationCompleted = true
        assertSnowflake(created.id, "Created Discord emoji ID")
        expressionId = created.id
        observed = projectedEmoji(await this.#client.getGuildEmoji(
          request.guildId,
          created.id,
          options,
        ))
      } else if (request.kind === "sticker" && request.action === "create") {
        const created = await this.#client.createGuildSticker(request.guildId, {
          bytes: fileSnapshot!.bytes,
          description: request.description,
          format: fileSnapshot!.review.format as "apng" | "gif" | "lottie" | "png",
          name: request.name,
          tags: request.tags,
        }, request.auditReason, options)
        mutationCompleted = true
        assertSnowflake(created.id, "Created Discord sticker ID")
        expressionId = created.id
        observed = projectedSticker(await this.#client.getGuildSticker(
          request.guildId,
          created.id,
          options,
        ), request.guildId)
      } else if (request.kind === "emoji" && request.action === "update") {
        await this.#client.modifyGuildEmoji(request.guildId, request.expressionId, {
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(request.roleIds !== undefined ? { roleIds: request.roleIds } : {}),
        }, request.auditReason, options)
        mutationCompleted = true
        observed = projectedEmoji(await this.#client.getGuildEmoji(
          request.guildId,
          request.expressionId,
          options,
        ))
      } else if (request.kind === "sticker" && request.action === "update") {
        await this.#client.modifyGuildSticker(request.guildId, request.expressionId, {
          ...(request.description !== undefined ? { description: request.description } : {}),
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(request.tags !== undefined ? { tags: request.tags } : {}),
        }, request.auditReason, options)
        mutationCompleted = true
        observed = projectedSticker(await this.#client.getGuildSticker(
          request.guildId,
          request.expressionId,
          options,
        ), request.guildId)
      } else if (request.kind === "emoji") {
        await this.#client.deleteGuildEmoji(
          request.guildId,
          request.expressionId,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        const inventory = exactInventory(
          "emoji",
          await this.#client.listGuildEmojis(request.guildId, options),
          request.guildId,
        )
        observed = inventory.find(
          (entry) => entry.expressionId === request.expressionId,
        ) ?? null
      } else {
        await this.#client.deleteGuildSticker(
          request.guildId,
          request.expressionId,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        const inventory = exactInventory(
          "sticker",
          await this.#client.listGuildStickers(request.guildId, options),
          request.guildId,
        )
        observed = inventory.find(
          (entry) => entry.expressionId === request.expressionId,
        ) ?? null
      }
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
          expressionId,
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
          expressionId,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new GuildExpressionExecutionError(
        "Discord guild expression change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          expressionId,
          observed,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    if (!expressionId) {
      throw new GuildExpressionExecutionError(
        "Discord guild expression change returned no exact resource identity",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    let matched: boolean
    if (request.action === "delete") {
      matched = observed === null
    } else {
      const desired = plan.desired as PlannedGuildExpression
      matched = observed !== null && sameExpression(
        { ...desired, expressionId },
        observed,
      )
    }
    const verification = matched ? "match" : "drift"
    const status = matched ? "completed" : "completed-with-drift"
    const result: GuildExpressionResult = {
      ...baseResult,
      activityId,
      expressionId,
      observed,
      status,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        expressionId,
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
          expressionId,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new GuildExpressionExecutionError(
        "Discord guild expression change completed but the operation receipt failed",
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
        expressionId,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new GuildExpressionExecutionError(
        "Discord guild expression change completed but the final activity record failed",
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
