import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ForumTagActivity,
  ForumTagActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  FORUM_TAG_ACTIONS,
  SCHEMA_VERSION,
  type ForumTagAction,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordForumTagState,
  type DiscordForumTagSummary,
  type ModifyForumTagInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  ForumTagEvidenceError,
  ForumTagExecutionError,
  ForumTagOperationConflictError,
  ForumTagPlanChangedError,
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
  evaluateBotChannelPermissions,
  parseDiscordPermissionBits,
  type BotChannelPermissionResult,
  type DiscordPermissionName,
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

const STATE_UNAVAILABLE = "forum-tag-state-unavailable"
const GUILD_NAME_CHARACTERS = 100
const USERNAME_CHARACTERS = 32
const TAG_TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const EMOJI_CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007F]/u
const EMOJI_CODE_POINT_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3)/u
const BASE_REQUEST_KEYS = [
  "action",
  "auditReason",
  "channelId",
  "guildId",
  "operationKey",
] as const
const CREATE_REQUEST_KEYS = [
  ...BASE_REQUEST_KEYS,
  "moderated",
  "name",
  "unicodeEmoji",
] as const
const UPDATE_REQUEST_KEYS = [
  ...BASE_REQUEST_KEYS,
  "moderated",
  "name",
  "tagId",
  "unicodeEmoji",
] as const
const DELETE_REQUEST_KEYS = [...BASE_REQUEST_KEYS, "tagId"] as const
const PROJECTED_STATE_KEYS = [
  "flags",
  "guildId",
  "id",
  "permissionOverwriteUnknownFieldCount",
  "permissionOverwrites",
  "tags",
  "type",
  "unknownFieldCount",
] as const
const PROJECTED_TAG_KEYS = [
  "emojiId",
  "emojiName",
  "id",
  "moderated",
  "name",
  "unknownFieldCount",
] as const
const LOCAL_LIMITS = Object.freeze({
  customEmojiIntroduction: false,
  forumTags: DISCORD_LIMITS.forumAvailableTags,
  mediaChannels: false,
  nameCharacters: DISCORD_LIMITS.forumTagNameCharacters,
  reorder: false,
})

interface ForumTagChangeBase {
  action: ForumTagAction
  auditReason: string
  channelId: string
  guildId: string
  operationKey: string
}

export interface CreateForumTagRequest extends ForumTagChangeBase {
  action: "create"
  moderated?: boolean
  name: string
  unicodeEmoji?: string | null
}

export interface UpdateForumTagRequest extends ForumTagChangeBase {
  action: "update-metadata"
  moderated?: boolean
  name?: string
  tagId: string
  unicodeEmoji?: string | null
}

export interface DeleteForumTagRequest extends ForumTagChangeBase {
  action: "delete"
  tagId: string
}

export type ForumTagChangeRequest =
  | CreateForumTagRequest
  | DeleteForumTagRequest
  | UpdateForumTagRequest

interface NormalizedForumTagChangeBase {
  action: ForumTagAction
  auditReason: string
  channelId: string
  guildId: string
  operationKeyHash: string
}

export interface NormalizedCreateForumTagRequest
  extends NormalizedForumTagChangeBase {
  action: "create"
  moderated: boolean
  name: string
  unicodeEmoji: string | null
}

export interface NormalizedUpdateForumTagRequest
  extends NormalizedForumTagChangeBase {
  action: "update-metadata"
  moderated?: boolean
  name?: string
  requestedFields: Array<"moderated" | "name" | "unicodeEmoji">
  tagId: string
  unicodeEmoji?: string | null
}

export interface NormalizedDeleteForumTagRequest
  extends NormalizedForumTagChangeBase {
  action: "delete"
  tagId: string
}

export type NormalizedForumTagChangeRequest =
  | NormalizedCreateForumTagRequest
  | NormalizedDeleteForumTagRequest
  | NormalizedUpdateForumTagRequest

export type ForumTagEmojiView =
  | { emojiId: string; kind: "custom" }
  | { kind: "none" }
  | { kind: "unicode"; unicodeEmoji: string }

export interface ForumTagView {
  emoji: ForumTagEmojiView
  id: string
  moderated: boolean
  name: string
  position: number
  unknownFieldCount: number
}

export interface PlannedForumTagView {
  emoji: ForumTagEmojiView
  id: string | null
  moderated: boolean
  name: string
  position: number
  unknownFieldCount: number
}

export interface ForumTagAccessEvidence {
  appliedRoleIds: string[]
  authorizedForChange: boolean
  botAdministrator: boolean
  botGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageChannels: boolean
  requiredPermissions: DiscordPermissionName[]
  unknownPermissionBits: string
  viewChannel: true
}

export interface ForumTagInventoryView {
  returned: number
  safetyLimit: number
  unknownTagFields: number
}

export interface ForumTagPrivacyProjection {
  persistence: "content-free-activity-only"
  rawPayloads: "omitted"
  tagText: "included-in-transient-results"
  unknownFields: "counts-only"
}

export interface ForumTagObservedState {
  channel: {
    flags: number
    guildId: string
    id: string
    permissionOverwriteUnknownFieldCount: number
    type: number
    unknownFieldCount: number
  }
  inventory: ForumTagInventoryView
  tags: ForumTagView[]
}

export interface ForumTagAuditResult extends ForumTagObservedState {
  access: ForumTagAccessEvidence
  applicationId: string
  botId: string
  limitations: string[]
  privacy: ForumTagPrivacyProjection
  schemaVersion: number
  status: "ok"
}

export interface ForumTagChangePlan {
  access: ForumTagAccessEvidence
  action: ForumTagAction
  applicationId: string
  auditReason: string
  botId: string
  channel: ForumTagObservedState["channel"]
  createdAt: string
  currentInventory: ForumTagInventoryView
  currentTags: ForumTagView[]
  desiredInventory: ForumTagInventoryView
  desiredTags: PlannedForumTagView[]
  digest: string
  guild: { id: string }
  impact: {
    activeThreadsEnumerated: false
    tagUsage: "not-applicable" | "unknown-unavailable"
  }
  localLimits: typeof LOCAL_LIMITS
  mutation: "create" | "delete" | "none" | "update-metadata"
  operationKeyHash: string
  privacy: ForumTagPrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  target: ForumTagView | null
  warnings: string[]
  writeRequired: boolean
}

export interface ForumTagChangeResult {
  action: ForumTagAction
  activityId: string | null
  channelId: string
  guildId: string
  observed: ForumTagObservedState
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: boolean
  schemaVersion: number
  status: "already-current" | "completed"
  tagId: string
  verification: "match" | "not-required"
}

export interface ForumTagServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildForumTags"
  | "getGuildMember"
  | "getGuildRoles"
  | "modifyGuildForumTags"
> {}

export interface ForumTagServiceOptions {
  activityStore: ActivityStore
  client: ForumTagServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    | "assertForumTagAuditConfigured"
    | "assertForumTagAuditable"
    | "assertForumTagChangeConfigured"
    | "assertForumTagChangeable"
  >
  randomId?: () => string
}

interface ValidatedGuild extends DiscordGuild {
  owner_id: string
}

interface ForumTagState {
  access: ForumTagAccessEvidence
  forum: DiscordForumTagState
  guild: ValidatedGuild
  member: DiscordGuildMember
  roles: DiscordRole[]
}

interface PlannedForumTag {
  emojiId: string | null
  emojiName: string | null
  id: string | null
  moderated: boolean
  name: string
  unknownFieldCount: number
}

interface PlannedForumState extends Omit<DiscordForumTagState, "tags"> {
  tags: PlannedForumTag[]
}

interface DesiredChange {
  desired: PlannedForumState
  mutation: ForumTagChangePlan["mutation"]
  target: DiscordForumTagSummary | null
  targetTagId: string
}

interface BuiltPlan {
  desired: PlannedForumState
  plan: ForumTagChangePlan
  state: ForumTagState
  targetTagId: string
}

type TargetOutcome = "settled" | "uncertain"

interface TargetLockState {
  tails: Map<string, Promise<TargetOutcome>>
  uncertainTargets: Set<string>
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

export function assertForumTagChannelId(channelId: string): void {
  assertPositiveSnowflake(channelId, "Discord forum-tag channel ID")
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function assertRequestedName(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || [...value].length > DISCORD_LIMITS.forumTagNameCharacters
    || TAG_TEXT_CONTROL_PATTERN.test(value)
    || value.normalize("NFC") !== value
    || !validUnicode(value)
  ) {
    throw new RangeError(
      `Discord forum-tag name must contain 0-${DISCORD_LIMITS.forumTagNameCharacters} NFC characters without controls`,
    )
  }
}

function assertReturnedName(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || [...value].length > DISCORD_LIMITS.forumTagNameCharacters
    || TAG_TEXT_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new ForumTagEvidenceError("Discord returned invalid forum-tag name evidence")
  }
}

function validEmoji(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.interactionEmojiCharacters
    || EMOJI_CONTROL_OR_SPACE_PATTERN.test(value)
    || !validUnicode(value)
  ) return false
  const graphemes = [
    ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value),
  ]
  return graphemes.length === 1 && EMOJI_CODE_POINT_PATTERN.test(value)
}

export function isForumTagUnicodeEmoji(value: string): boolean {
  return validEmoji(value) && value.normalize("NFC") === value
}

function assertRequestedEmoji(value: unknown): asserts value is string | null {
  if (value !== null && (
    typeof value !== "string" || !isForumTagUnicodeEmoji(value)
  )) {
    throw new RangeError("Discord forum-tag Unicode emoji must be null or one NFC emoji grapheme")
  }
}

function assertBaseRequest(
  record: Record<string, unknown>,
): asserts record is Record<string, unknown> & {
  action: ForumTagAction
  auditReason: string
  channelId: string
  guildId: string
  operationKey: string
} {
  if (
    !FORUM_TAG_ACTIONS.includes(record.action as ForumTagAction)
    || typeof record.auditReason !== "string"
    || typeof record.operationKey !== "string"
  ) {
    throw new RangeError("Discord forum-tag change request is invalid")
  }
  assertPositiveSnowflake(record.channelId, "Discord forum-tag channel ID")
  assertPositiveSnowflake(record.guildId, "Discord forum-tag guild ID")
  encodeDiscordAuditReason(record.auditReason)
}

export function normalizeForumTagChangeRequest(
  request: ForumTagChangeRequest,
): NormalizedForumTagChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord forum-tag change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  assertBaseRequest(record)
  const base = {
    auditReason: record.auditReason,
    channelId: record.channelId,
    guildId: record.guildId,
    operationKeyHash: operationKeyHash(record.operationKey),
  }
  if (record.action === "create") {
    if (
      !onlyKeys(record, CREATE_REQUEST_KEYS)
      || !Object.hasOwn(record, "name")
      || Object.hasOwn(record, "moderated") && typeof record.moderated !== "boolean"
      || Object.hasOwn(record, "unicodeEmoji") && record.unicodeEmoji === undefined
    ) {
      throw new RangeError("Discord forum-tag creation request is invalid")
    }
    assertRequestedName(record.name)
    if (Object.hasOwn(record, "unicodeEmoji")) {
      assertRequestedEmoji(record.unicodeEmoji)
    }
    return {
      ...base,
      action: "create",
      moderated: (record.moderated as boolean | undefined) ?? false,
      name: record.name,
      unicodeEmoji: (record.unicodeEmoji as string | null | undefined) ?? null,
    }
  }
  if (record.action === "update-metadata") {
    const requestedFields = (["name", "moderated", "unicodeEmoji"] as const)
      .filter((field) => Object.hasOwn(record, field))
    if (
      !onlyKeys(record, UPDATE_REQUEST_KEYS)
      || !positiveSnowflake(record.tagId)
      || requestedFields.length < 1
      || requestedFields.some((field) => record[field] === undefined)
      || Object.hasOwn(record, "moderated") && typeof record.moderated !== "boolean"
    ) {
      throw new RangeError("Discord forum-tag metadata update request is invalid")
    }
    if (Object.hasOwn(record, "name")) assertRequestedName(record.name)
    if (Object.hasOwn(record, "unicodeEmoji")) {
      assertRequestedEmoji(record.unicodeEmoji)
    }
    return {
      ...base,
      action: "update-metadata",
      ...(Object.hasOwn(record, "moderated")
        ? { moderated: record.moderated as boolean }
        : {}),
      ...(Object.hasOwn(record, "name") ? { name: record.name as string } : {}),
      requestedFields,
      tagId: record.tagId,
      ...(Object.hasOwn(record, "unicodeEmoji")
        ? { unicodeEmoji: record.unicodeEmoji as string | null }
        : {}),
    }
  }
  if (!onlyKeys(record, DELETE_REQUEST_KEYS) || !positiveSnowflake(record.tagId)) {
    throw new RangeError("Discord forum-tag deletion request is invalid")
  }
  return {
    ...base,
    action: "delete",
    tagId: record.tagId,
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function exactOverwrites(value: unknown): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw new ForumTagEvidenceError("Discord returned invalid forum permission-overwrite evidence")
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ForumTagEvidenceError(
        "Discord returned invalid forum permission-overwrite evidence",
      )
    }
    const record = entry as Record<string, unknown>
    if (
      !onlyKeys(record, ["allow", "deny", "id", "type"])
      || !positiveSnowflake(record.id)
      || record.type !== 0 && record.type !== 1
      || typeof record.allow !== "string"
      || typeof record.deny !== "string"
      || seen.has(record.id)
    ) {
      throw new ForumTagEvidenceError(
        "Discord returned invalid forum permission-overwrite evidence",
      )
    }
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(record.allow, `forum overwrite ${record.id} allow`)
      deny = parseDiscordPermissionBits(record.deny, `forum overwrite ${record.id} deny`)
    } catch (error) {
      throw new ForumTagEvidenceError(
        "Discord returned invalid forum permission-overwrite bits",
        { cause: error },
      )
    }
    if ((allow & deny) !== 0n) {
      throw new ForumTagEvidenceError(
        "Discord returned overlapping forum permission-overwrite bits",
      )
    }
    seen.add(record.id)
    return {
      allow: record.allow,
      deny: record.deny,
      id: record.id,
      type: record.type,
    }
  }).sort((left, right) => compareSnowflakes(left.id, right.id) || left.type - right.type)
}

function exactTag(value: unknown): DiscordForumTagSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ForumTagEvidenceError("Discord returned invalid forum-tag evidence")
  }
  const record = value as Record<string, unknown>
  if (
    !onlyKeys(record, PROJECTED_TAG_KEYS)
    || !positiveSnowflake(record.id)
    || typeof record.moderated !== "boolean"
    || !Number.isSafeInteger(record.unknownFieldCount)
    || (record.unknownFieldCount as number) < 0
    || !(record.emojiId === null || positiveSnowflake(record.emojiId))
    || !(record.emojiName === null || validEmoji(record.emojiName))
    || record.emojiId !== null && record.emojiName !== null
  ) {
    throw new ForumTagEvidenceError("Discord returned invalid forum-tag evidence")
  }
  assertReturnedName(record.name)
  return {
    emojiId: record.emojiId,
    emojiName: record.emojiName,
    id: record.id,
    moderated: record.moderated,
    name: record.name,
    unknownFieldCount: record.unknownFieldCount as number,
  }
}

function exactForumState(
  value: DiscordForumTagState,
  channelId: string,
): DiscordForumTagState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ForumTagEvidenceError("Discord returned invalid forum-tag state evidence")
  }
  const record = value as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, PROJECTED_STATE_KEYS)
    || value.id !== channelId
    || !positiveSnowflake(value.id)
    || !positiveSnowflake(value.guildId)
    || value.type !== DISCORD_CHANNEL_TYPES.forum
    || !Number.isSafeInteger(value.flags)
    || value.flags < 0
    || !Number.isSafeInteger(value.permissionOverwriteUnknownFieldCount)
    || value.permissionOverwriteUnknownFieldCount < 0
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
    || !Array.isArray(value.tags)
    || value.tags.length > DISCORD_LIMITS.forumAvailableTags
  ) {
    throw new ForumTagEvidenceError("Discord returned invalid forum-tag state evidence")
  }
  const tags = value.tags.map(exactTag)
  if (new Set(tags.map(({ id }) => id)).size !== tags.length) {
    throw new ForumTagEvidenceError("Discord returned duplicate forum-tag IDs")
  }
  return {
    flags: value.flags,
    guildId: value.guildId,
    id: value.id,
    permissionOverwriteUnknownFieldCount: value.permissionOverwriteUnknownFieldCount,
    permissionOverwrites: exactOverwrites(value.permissionOverwrites),
    tags,
    type: value.type,
    unknownFieldCount: value.unknownFieldCount,
  }
}

function forumChannel(forum: DiscordForumTagState): DiscordChannel {
  return {
    available_tags: forum.tags.map((tag) => ({
      emoji_id: tag.emojiId,
      emoji_name: tag.emojiName,
      id: tag.id,
      moderated: tag.moderated,
      name: tag.name,
    })),
    flags: forum.flags,
    guild_id: forum.guildId,
    id: forum.id,
    parent_id: null,
    permission_overwrites: forum.permissionOverwrites,
    type: forum.type,
  }
}

function emojiView(tag: Pick<PlannedForumTag, "emojiId" | "emojiName">): ForumTagEmojiView {
  if (tag.emojiId !== null) return { emojiId: tag.emojiId, kind: "custom" }
  if (tag.emojiName !== null) {
    return { kind: "unicode", unicodeEmoji: tag.emojiName }
  }
  return { kind: "none" }
}

function tagView(tag: DiscordForumTagSummary, position: number): ForumTagView {
  return {
    emoji: emojiView(tag),
    id: tag.id,
    moderated: tag.moderated,
    name: tag.name,
    position,
    unknownFieldCount: tag.unknownFieldCount,
  }
}

function plannedTagView(tag: PlannedForumTag, position: number): PlannedForumTagView {
  return {
    emoji: emojiView(tag),
    id: tag.id,
    moderated: tag.moderated,
    name: tag.name,
    position,
    unknownFieldCount: tag.unknownFieldCount,
  }
}

function inventoryView(tags: readonly Pick<PlannedForumTag, "unknownFieldCount">[]) {
  return {
    returned: tags.length,
    safetyLimit: DISCORD_LIMITS.forumAvailableTags,
    unknownTagFields: tags.reduce((sum, tag) => sum + tag.unknownFieldCount, 0),
  }
}

function observedState(forum: DiscordForumTagState): ForumTagObservedState {
  return {
    channel: {
      flags: forum.flags,
      guildId: forum.guildId,
      id: forum.id,
      permissionOverwriteUnknownFieldCount: forum.permissionOverwriteUnknownFieldCount,
      type: forum.type,
      unknownFieldCount: forum.unknownFieldCount,
    },
    inventory: inventoryView(forum.tags),
    tags: forum.tags.map(tagView),
  }
}

function privacyProjection(): ForumTagPrivacyProjection {
  return {
    persistence: "content-free-activity-only",
    rawPayloads: "omitted",
    tagText: "included-in-transient-results",
    unknownFields: "counts-only",
  }
}

function limitations(): string[] {
  return [
    "Only stable GUILD_FORUM channels are supported; media channels are excluded",
    "Discord exposes no conditional available-tag update, so external same-channel changes can race a reviewed mutation",
    "Discord exposes no bounded tag-use count; deletion impact on existing posts is not enumerated",
    "The workflow preserves existing custom emoji IDs but only accepts Unicode emoji for new or changed emoji metadata",
    "Raw full-array replacement, tag reordering, fuzzy matching, automatic retry, and rollback are not exposed",
  ]
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
    || TAG_TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
    || !positiveSnowflake(value.owner_id)
  ) {
    throw new ForumTagEvidenceError("Discord returned invalid forum-tag guild evidence")
  }
  return { id: value.id, name: value.name, owner_id: value.owner_id }
}

function exactMember(
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
    || typeof value.user.username !== "string"
    || value.user.username.length < 1
    || value.user.username.length > USERNAME_CHARACTERS
    || TAG_TEXT_CONTROL_PATTERN.test(value.user.username)
    || !validUnicode(value.user.username)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw new ForumTagEvidenceError("Discord returned invalid connector membership evidence")
  }
  return {
    roles: [...value.roles],
    user: {
      bot: true,
      id: botId,
      username: value.user.username,
    },
  }
}

function exactRoles(
  value: DiscordRole[],
  guildId: string,
  memberRoleIds: readonly string[],
): DiscordRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw new ForumTagEvidenceError("Discord returned invalid forum-tag role evidence")
  }
  const seen = new Set<string>()
  const roles = value.map((role) => {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || typeof role.name !== "string"
      || role.name.length < 1
      || role.name.length > DISCORD_LIMITS.roleNameCharacters
      || TAG_TEXT_CONTROL_PATTERN.test(role.name)
      || !validUnicode(role.name)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || seen.has(role.id)
    ) {
      throw new ForumTagEvidenceError("Discord returned invalid forum-tag role evidence")
    }
    try {
      parseDiscordPermissionBits(role.permissions, `forum-tag role ${role.id}`)
    } catch (error) {
      throw new ForumTagEvidenceError(
        "Discord returned invalid forum-tag role permissions",
        { cause: error },
      )
    }
    seen.add(role.id)
    return {
      id: role.id,
      managed: role.managed,
      name: role.name,
      permissions: role.permissions,
      position: role.position,
    }
  })
  for (const roleId of [guildId, ...memberRoleIds]) {
    if (!seen.has(roleId)) {
      throw new ForumTagEvidenceError(
        `Discord forum-tag role evidence omitted role ${roleId}`,
      )
    }
  }
  return roles.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function accessEvidence(
  botId: string,
  guildOwnerId: string,
  forum: DiscordForumTagState,
  member: DiscordGuildMember,
  roles: readonly DiscordRole[],
  mode: "audit" | "change",
): ForumTagAccessEvidence {
  if (forum.permissionOverwriteUnknownFieldCount > 0) {
    throw new ForumTagEvidenceError(
      "Discord forum permission-overwrite evidence contains unknown fields",
    )
  }
  let result: BotChannelPermissionResult
  try {
    const channel = forumChannel(forum)
    result = evaluateBotChannelPermissions({
      botId,
      channel,
      guildId: forum.guildId,
      member,
      permissionChannel: channel,
      roles,
    })
  } catch (error) {
    throw new ForumTagEvidenceError(
      "Discord returned invalid forum-tag permission evidence",
      { cause: error },
    )
  }
  if (result.confidence !== "complete") {
    throw new ForumTagEvidenceError(
      `Discord forum-tag permission evidence is incomplete: ${result.warnings.join("; ")}`,
    )
  }
  const botGuildOwner = botId === guildOwnerId
  const effectivePermissions = botGuildOwner
    ? (ALL_KNOWN_PERMISSION_BITS | BigInt(result.effectivePermissions)).toString()
    : result.effectivePermissions
  const effectivePermissionNames = botGuildOwner
    ? [...DISCORD_PERMISSION_NAMES]
    : [...result.effectivePermissionNames]
  const viewChannel = effectivePermissionNames.includes("VIEW_CHANNEL")
  const manageChannels = effectivePermissionNames.includes("MANAGE_CHANNELS")
  if (!viewChannel || mode === "change" && !manageChannels) {
    throw new ForumTagEvidenceError(
      mode === "change"
        ? "Discord connector lacks VIEW_CHANNEL or MANAGE_CHANNELS for this forum"
        : "Discord connector lacks VIEW_CHANNEL for this forum",
    )
  }
  return {
    appliedRoleIds: [...result.appliedRoleIds].sort(compareSnowflakes),
    authorizedForChange: manageChannels,
    botAdministrator: result.administrator,
    botGuildOwner,
    complete: true,
    effectivePermissionNames,
    effectivePermissions,
    manageChannels,
    requiredPermissions: mode === "change"
      ? ["MANAGE_CHANNELS", "VIEW_CHANNEL"]
      : ["VIEW_CHANNEL"],
    unknownPermissionBits: result.unknownPermissionBits,
    viewChannel: true,
  }
}

function stateSnapshot(forum: DiscordForumTagState) {
  return {
    flags: forum.flags,
    guildId: forum.guildId,
    id: forum.id,
    permissionOverwriteUnknownFieldCount: forum.permissionOverwriteUnknownFieldCount,
    permissionOverwrites: forum.permissionOverwrites,
    tags: forum.tags.map((tag) => ({ ...tag })),
    type: forum.type,
    unknownFieldCount: forum.unknownFieldCount,
  }
}

function plannedStateSnapshot(forum: PlannedForumState) {
  return {
    flags: forum.flags,
    guildId: forum.guildId,
    id: forum.id,
    permissionOverwriteUnknownFieldCount: forum.permissionOverwriteUnknownFieldCount,
    permissionOverwrites: forum.permissionOverwrites,
    tags: forum.tags.map((tag) => ({ ...tag })),
    type: forum.type,
    unknownFieldCount: forum.unknownFieldCount,
  }
}

function semanticTagMatch(
  tag: DiscordForumTagSummary,
  desired: Pick<PlannedForumTag, "emojiId" | "emojiName" | "moderated" | "name">,
): boolean {
  return tag.emojiId === desired.emojiId
    && tag.emojiName === desired.emojiName
    && tag.moderated === desired.moderated
    && tag.name === desired.name
}

function desiredChange(
  current: DiscordForumTagState,
  request: NormalizedForumTagChangeRequest,
): DesiredChange {
  if (request.action === "create") {
    const requestedTag: PlannedForumTag = {
      emojiId: null,
      emojiName: request.unicodeEmoji,
      id: null,
      moderated: request.moderated,
      name: request.name,
      unknownFieldCount: 0,
    }
    const matches = current.tags.filter((tag) => semanticTagMatch(tag, requestedTag))
    if (matches.length > 1) {
      throw new ForumTagEvidenceError(
        "Discord forum-tag creation is ambiguous because multiple exact matches exist",
      )
    }
    if (matches.length === 1) {
      return {
        desired: { ...current, tags: current.tags.map((tag) => ({ ...tag })) },
        mutation: "none",
        target: matches[0] as DiscordForumTagSummary,
        targetTagId: (matches[0] as DiscordForumTagSummary).id,
      }
    }
    if (current.tags.length >= DISCORD_LIMITS.forumAvailableTags) {
      throw new ForumTagEvidenceError("Discord forum-tag inventory is already at capacity")
    }
    return {
      desired: {
        ...current,
        tags: [...current.tags.map((tag) => ({ ...tag })), requestedTag],
      },
      mutation: "create",
      target: null,
      targetTagId: "",
    }
  }
  const targetIndex = current.tags.findIndex(({ id }) => id === request.tagId)
  if (targetIndex < 0) {
    throw new ForumTagEvidenceError("Discord forum-tag target is absent")
  }
  const target = current.tags[targetIndex] as DiscordForumTagSummary
  if (request.action === "delete") {
    return {
      desired: {
        ...current,
        tags: current.tags
          .filter(({ id }) => id !== request.tagId)
          .map((tag) => ({ ...tag })),
      },
      mutation: "delete",
      target,
      targetTagId: target.id,
    }
  }
  const desiredTarget: PlannedForumTag = {
    ...target,
    ...(request.moderated !== undefined ? { moderated: request.moderated } : {}),
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(Object.hasOwn(request, "unicodeEmoji")
      ? { emojiId: null, emojiName: request.unicodeEmoji as string | null }
      : {}),
  }
  const tags = current.tags.map((tag, index) => (
    index === targetIndex ? desiredTarget : { ...tag }
  ))
  return {
    desired: { ...current, tags },
    mutation: semanticTagMatch(target, desiredTarget) ? "none" : "update-metadata",
    target,
    targetTagId: target.id,
  }
}

function mutationInput(desired: PlannedForumState): ModifyForumTagInput[] {
  return desired.tags.map((tag) => ({
    emojiId: tag.emojiId,
    emojiName: tag.emojiName,
    ...(tag.id === null ? {} : { id: tag.id }),
    moderated: tag.moderated,
    name: tag.name,
  }))
}

function roleSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
    managed: role.managed,
    name: role.name,
    permissions: role.permissions,
    position: role.position,
  }))
}

function memberSnapshot(member: DiscordGuildMember) {
  return {
    roles: [...member.roles].sort(compareSnowflakes),
    user: { bot: member.user?.bot, id: member.user?.id },
  }
}

function resolveDesiredState(
  desired: PlannedForumState,
  response: DiscordForumTagState,
  prior: DiscordForumTagState,
  fallbackTagId: string,
): { state: DiscordForumTagState; tagId: string } {
  const missingIndexes = desired.tags.flatMap((tag, index) => (
    tag.id === null ? [index] : []
  ))
  if (missingIndexes.length === 0) {
    return {
      state: desired as DiscordForumTagState,
      tagId: fallbackTagId,
    }
  }
  if (missingIndexes.length !== 1 || response.tags.length !== desired.tags.length) {
    throw new ForumTagEvidenceError("Discord returned an invalid forum-tag creation response")
  }
  const index = missingIndexes[0] as number
  const responseTag = response.tags[index]
  if (!responseTag || prior.tags.some(({ id }) => id === responseTag.id)) {
    throw new ForumTagEvidenceError("Discord returned an invalid created forum-tag ID")
  }
  return {
    state: {
      ...desired,
      tags: desired.tags.map((tag, tagIndex) => ({
        ...tag,
        id: tagIndex === index ? responseTag.id : tag.id as string,
      })),
    },
    tagId: responseTag.id,
  }
}

function stateMatches(
  observed: DiscordForumTagState,
  expected: DiscordForumTagState,
): boolean {
  return stableString(stateSnapshot(observed)) === stableString(stateSnapshot(expected))
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
  plan: ForumTagChangePlan
  status: ForumTagActivityStatus
  tagId?: string | null
  timestamp: string
  verification?: "match" | null
}): ForumTagActivity {
  return {
    action: options.plan.action,
    channelId: options.plan.channel.id,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    id: options.activityId,
    kind: "forum-tag-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    tagId: options.tagId === undefined
      ? options.plan.target?.id ?? null
      : options.tagId,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: ForumTagChangePlan
  status: OperationReceipt["status"]
  tagId?: string | null
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    kind: "forum-tag-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.tagId ?? null : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (!(error instanceof ForumTagExecutionError)) return false
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
  priorUncertainError: () => ForumTagExecutionError,
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

export class ForumTagService {
  readonly #activityStore: ActivityStore
  readonly #client: ForumTagServiceClient
  readonly #clock: () => Date
  readonly #lockState: TargetLockState = {
    tails: new Map(),
    uncertainTargets: new Set(),
  }
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ForumTagServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: ForumTagServiceOptions) {
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
    channelId: string,
    expectedGuildId: string | null,
    mode: "audit" | "change",
    options: RequestOptions,
    operationKeyHashValue?: string,
  ): Promise<ForumTagState> {
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertForumTagChannelId(channelId)
    if (mode === "change") {
      this.#policy.assertForumTagChangeConfigured(channelId)
    } else {
      this.#policy.assertForumTagAuditConfigured(channelId)
    }
    const forum = exactForumState(
      await this.#client.getGuildForumTags(channelId, options),
      channelId,
    )
    const guildId = mode === "change"
      ? this.#policy.assertForumTagChangeable(forumChannel(forum))
      : this.#policy.assertForumTagAuditable(forumChannel(forum))
    if (
      guildId !== forum.guildId
      || expectedGuildId !== null && expectedGuildId !== forum.guildId
    ) {
      throw new ForumTagEvidenceError(
        "Discord forum-tag channel belongs to a different guild than requested",
      )
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "forum-tag-change",
        operationKeyHashValue,
      )
      if (receipt) throw new ForumTagOperationConflictError(receiptView(receipt))
    }
    const [guildValue, memberValue, rolesValue] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guild = exactGuild(guildValue, guildId)
    const member = exactMember(memberValue, guildId, botId)
    const roles = exactRoles(rolesValue, guildId, member.roles)
    return {
      access: accessEvidence(botId, guild.owner_id, forum, member, roles, mode),
      forum,
      guild,
      member,
      roles,
    }
  }

  async audit(
    applicationId: string,
    botId: string,
    channelId: string,
    options: RequestOptions = {},
  ): Promise<ForumTagAuditResult> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(botId, channelId, null, "audit", options)
    return {
      ...observedState(state.forum),
      access: state.access,
      applicationId,
      botId,
      limitations: limitations(),
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedForumTagChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(
      botId,
      request.channelId,
      request.guildId,
      "change",
      options,
      request.operationKeyHash,
    )
    const change = desiredChange(state.forum, request)
    const currentInventory = inventoryView(state.forum.tags)
    const desiredInventory = inventoryView(change.desired.tags)
    if (change.mutation !== "none" && currentInventory.unknownTagFields > 0) {
      throw new ForumTagEvidenceError(
        "Discord forum-tag inventory contains future tag fields that block full-array replacement",
      )
    }
    const risks = [
      "Discord accepts forum tags only as a full available_tags array; every untouched tag is preserved exactly and freshness-bound",
      "Discord exposes no conditional update, so external same-channel administration can race the reviewed replacement",
      "The PATCH is sent once without automatic retry; an ambiguous outcome quarantines later same-channel changes",
      ...(request.action === "delete"
        ? [
            "Discord does not expose a bounded tag-use count, so deletion impact on existing posts is unknown",
          ]
        : []),
      ...(request.action === "create"
        ? ["Creation consumes one of the forum's bounded available-tag slots"]
        : []),
    ]
    const warnings = [
      ...limitations(),
      "The complete ordered tag inventory, channel flags, permission overwrites, guild membership, and roles are freshness-bound",
      "Tag names and Unicode emoji are untrusted Discord text and are never persisted by this workflow",
      "Same-channel serialization is process-local; avoid overlapping forum-tag scope across connector processes",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      ...(state.access.botAdministrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped channel permissions"]
        : []),
      ...(request.action === "create" && request.name.length === 0
        ? ["The requested forum tag has an empty visible name"]
        : []),
    ]
    const privacy = privacyProjection()
    const digest = reviewedPlanDigest(this.#planKey, {
      access: state.access,
      applicationId,
      botId,
      channel: stateSnapshot(state.forum),
      desired: plannedStateSnapshot(change.desired),
      domain: "guildcontrol-forum-tag-change-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      localLimits: LOCAL_LIMITS,
      member: memberSnapshot(state.member),
      mutation: change.mutation,
      privacy,
      request,
      risks,
      roles: roleSnapshot(state.roles),
      warnings,
    })
    const current = observedState(state.forum)
    const targetIndex = change.target
      ? state.forum.tags.findIndex(({ id }) => id === change.target?.id)
      : -1
    const plan: ForumTagChangePlan = {
      access: state.access,
      action: request.action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      channel: current.channel,
      createdAt: this.#clock().toISOString(),
      currentInventory,
      currentTags: current.tags,
      desiredInventory,
      desiredTags: change.desired.tags.map(plannedTagView),
      digest,
      guild: { id: state.guild.id },
      impact: {
        activeThreadsEnumerated: false,
        tagUsage: request.action === "delete"
          ? "unknown-unavailable"
          : "not-applicable",
      },
      localLimits: LOCAL_LIMITS,
      mutation: change.mutation,
      operationKeyHash: request.operationKeyHash,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: change.mutation === "none" ? "already-current" : "planned",
      target: change.target && targetIndex >= 0
        ? tagView(change.target, targetIndex)
        : null,
      warnings,
      writeRequired: change.mutation !== "none",
    }
    return {
      desired: change.desired,
      plan,
      state,
      targetTagId: change.targetTagId,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: ForumTagChangeRequest,
    options: RequestOptions = {},
  ): Promise<ForumTagChangePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeForumTagChangeRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  execute(
    applicationId: string,
    botId: string,
    request: ForumTagChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ForumTagChangeResult> {
    const normalized = normalizeForumTagChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord forum-tag plan digest is invalid")
    }
    return withTargetLock(
      this.#lockState,
      normalized.channelId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new ForumTagExecutionError(
        "Discord forum-tag change was blocked because a prior same-channel operation ended with an uncertain outcome",
        {
          channelId: normalized.channelId,
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
    request: NormalizedForumTagChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ForumTagChangeResult> {
    let built: BuiltPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ForumTagEvidenceError
        || error instanceof RangeError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ForumTagPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { desired, plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new ForumTagPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: request.action,
      channelId: request.channelId,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        observed: observedState(state.forum),
        readbackMatched: true,
        responseMatched: true,
        status: "already-current",
        tagId: built.targetTagId,
        verification: "not-required",
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
      throw new ForumTagOperationConflictError(receiptView(reservation.receipt))
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
      throw new ForumTagExecutionError(
        "Discord forum-tag change was blocked because pending activity could not be recorded",
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
    let observed = observedState(state.forum)
    let readbackMatched: boolean | null = null
    let responseMatched: boolean | null = null
    let tagId = built.targetTagId
    try {
      mutationStarted = true
      const responseValue = await this.#client.modifyGuildForumTags(
        request.channelId,
        mutationInput(desired),
        request.auditReason,
        options,
      )
      mutationAcknowledged = true
      const response = exactForumState(responseValue, request.channelId)
      if (response.guildId !== request.guildId) {
        throw new ForumTagEvidenceError(
          "Discord forum-tag response changed guild identity",
        )
      }
      const resolved = resolveDesiredState(
        desired,
        response,
        state.forum,
        built.targetTagId,
      )
      tagId = resolved.tagId
      responseMatched = stateMatches(response, resolved.state)
      if (!responseMatched) {
        throw new ForumTagEvidenceError(
          "Discord forum-tag response changed the reviewed ordered inventory",
        )
      }
      const readback = exactForumState(
        await this.#client.getGuildForumTags(request.channelId, options),
        request.channelId,
      )
      if (readback.guildId !== request.guildId) {
        throw new ForumTagEvidenceError(
          "Discord forum-tag readback changed guild identity",
        )
      }
      observed = observedState(readback)
      readbackMatched = stateMatches(readback, resolved.state)
      if (!readbackMatched) {
        throw new ForumTagEvidenceError(
          "Discord forum-tag readback changed the reviewed ordered inventory",
        )
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
          timestamp: this.#clock().toISOString(),
        }))
      } catch (recordFailure) {
        recordError = recordError ?? safeErrorCode(recordFailure)
      }
      throw new ForumTagExecutionError(
        status === "uncertain"
          ? "Discord forum-tag change has an uncertain outcome and must not be retried"
          : "Discord rejected the forum-tag change before applying it",
        {
          ...baseResult,
          activityId,
          error: category,
          observed,
          readbackMatched,
          recordError,
          responseMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
          tagId: request.action === "create" ? null : built.targetTagId,
        },
        { cause: error },
      )
    }

    const result: ForumTagChangeResult = {
      ...baseResult,
      activityId,
      observed,
      readbackMatched: true,
      responseMatched: true,
      status: "completed",
      tagId,
      verification: "match",
    }
    let recordError: string | null = null
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        status: "completed",
        tagId,
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
        tagId,
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      recordError = recordError ?? safeErrorCode(error)
    }
    if (recordError) {
      throw new ForumTagExecutionError(
        "Discord forum-tag change completed but durable completion recording failed",
        {
          ...result,
          error: recordError,
          status: "completed-record-failed",
        },
      )
    }
    return result
  }
}
