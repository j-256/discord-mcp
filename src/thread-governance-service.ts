import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ThreadGovernanceActivity,
  ThreadGovernanceActivityStatus,
} from "./activity-log.js"
import {
  CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  MEMBER_DIRECTORY_LIMITS,
  SCHEMA_VERSION,
  THREAD_CHANGE_ACTIONS,
  type ThreadChangeAction,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordThreadStateSummary,
  type ModifyThreadStateInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  ThreadGovernanceEvidenceError,
  ThreadGovernanceExecutionError,
  ThreadGovernanceOperationConflictError,
  ThreadGovernancePlanChangedError,
} from "./errors.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  DISCORD_PERMISSIONS,
  evaluateGuildMemberPermissions,
  evaluatePrincipalPermissions,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
  type PrincipalPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import { normalizeDiscordRoleInventory } from "./role-administration-service.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
  DiscordThreadMember,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "thread-governance-state-unavailable"
const TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const THREAD_OMITTED_FIELDS = Object.freeze([
  "applied tags",
  "current-user membership object",
  "flags",
  "last-message ID",
  "member count",
  "message count",
  "permission summary",
  "thread timestamps",
  "total message count",
  "unknown field values",
])
const BASE_REQUEST_KEYS = [
  "action",
  "auditReason",
  "guildId",
  "operationKey",
  "threadId",
] as const
const THREAD_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const PARENT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])

type ThreadTargetOutcome = "settled" | "uncertain"

interface ThreadLockState {
  tails: Map<string, Promise<ThreadTargetOutcome>>
  uncertainTargets: Set<string>
}

const THREAD_GOVERNANCE_LOCKS = new WeakMap<OperationStore, ThreadLockState>()

function threadGovernanceLocks(operationStore: OperationStore): ThreadLockState {
  let state = THREAD_GOVERNANCE_LOCKS.get(operationStore)
  if (!state) {
    state = { tails: new Map(), uncertainTargets: new Set() }
    THREAD_GOVERNANCE_LOCKS.set(operationStore, state)
  }
  return state
}

interface ThreadChangeRequestBase {
  action: ThreadChangeAction
  auditReason: string
  guildId: string
  operationKey: string
  threadId: string
}

export type ThreadChangeRequest = ThreadChangeRequestBase & (
  | { action: "add-member"; userId: string }
  | { action: "archive" }
  | { action: "join" }
  | { action: "leave" }
  | { action: "lock" }
  | { action: "remove-member"; userId: string }
  | { action: "rename"; name: string }
  | { action: "set-auto-archive-duration"; autoArchiveDuration: number }
  | { action: "set-invitable"; enabled: boolean }
  | { action: "set-slowmode"; rateLimitPerUser: number }
  | { action: "unarchive" }
  | { action: "unlock" }
)

interface NormalizedThreadChangeRequestBase {
  action: ThreadChangeAction
  auditReason: string
  guildId: string
  operationKeyHash: string
  threadId: string
}

export type NormalizedThreadChangeRequest = NormalizedThreadChangeRequestBase & (
  | { action: "add-member"; userId: string }
  | { action: "archive" }
  | { action: "join" }
  | { action: "leave" }
  | { action: "lock" }
  | { action: "remove-member"; userId: string }
  | { action: "rename"; name: string }
  | { action: "set-auto-archive-duration"; autoArchiveDuration: number }
  | { action: "set-invitable"; enabled: boolean }
  | { action: "set-slowmode"; rateLimitPerUser: number }
  | { action: "unarchive" }
  | { action: "unlock" }
)

export interface ThreadStateView {
  archived: boolean
  autoArchiveDuration: number
  guildId: string
  id: string
  invitable: boolean | null
  locked: boolean
  name: string
  ownerId: string
  parentId: string
  rateLimitPerUser: number
  type: "announcement" | "private" | "public"
  unknownFieldCount: number
  unknownMetadataFieldCount: number
}

export interface ThreadMembershipView {
  isMember: boolean
  joinedAt: string | null
  unknownFieldCount: number
  userId: string
}

export interface ThreadGovernancePermissionEvidence {
  administrator: boolean
  allowed: boolean
  appliedRoleIds: string[]
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  guildOwner: boolean
  missingPermissions: DiscordPermissionName[]
  requestedPermissions: DiscordPermissionName[]
  unknownPermissionBits: "0"
  warnings: string[]
}

export interface ThreadPrivacyProjection {
  embeddedGuildMembers: "never-requested"
  enumeration: "none"
  omittedFields: readonly string[]
  persistence: "content-free-outcomes-only"
  rawPayloadExposed: false
}

export interface ThreadStateAuditResult {
  applicationId: string
  botId: string
  connectorMembership: ThreadMembershipView
  guild: { id: string; name: string; ownerId: string }
  parent: { id: string; name: string; type: number }
  permission: ThreadGovernancePermissionEvidence
  privacy: ThreadPrivacyProjection
  schemaVersion: number
  status: "ok"
  thread: ThreadStateView
  warnings: string[]
}

export interface ThreadMembershipAuditResult extends ThreadStateAuditResult {
  member: { id: string; username: string }
  membership: ThreadMembershipView
  targetPermission: ThreadGovernancePermissionEvidence
}

export interface ThreadChangePlan extends Omit<ThreadStateAuditResult, "status"> {
  action: ThreadChangeAction
  auditReason: string
  authorizationBasis: "already-current" | "connector-owner" | "manage-threads" | "member-send" | "self-membership"
  createdAt: string
  desired: {
    field: "archived" | "autoArchiveDuration" | "invitable" | "locked" | "membership" | "name" | "rateLimitPerUser"
    value: boolean | number | string
  }
  digest: string
  member: { id: string; username: string } | null
  membership: ThreadMembershipView | null
  operationKeyHash: string
  risks: string[]
  status: "already-current" | "planned"
  targetPermission: ThreadGovernancePermissionEvidence | null
  warnings: string[]
  writeRequired: boolean
}

export type ThreadGovernanceDriftField =
  | "archived"
  | "auto-archive-duration"
  | "invitable"
  | "locked"
  | "name"
  | "rate-limit-per-user"

export interface ThreadChangeResult {
  action: ThreadChangeAction
  activityId: string | null
  driftFields: ThreadGovernanceDriftField[]
  guildId: string
  observedMembership: ThreadMembershipView | null
  observedThread: ThreadStateView
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  targetUserId: string | null
  threadId: string
  verification: "drift" | "match" | "not-required"
}

export interface ThreadGovernanceServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    | "addThreadMember"
    | "getChannel"
    | "getGuild"
    | "getGuildMember"
    | "getGuildRoles"
    | "getThreadMember"
    | "getThreadState"
    | "joinThread"
    | "leaveThread"
    | "modifyThreadState"
    | "removeThreadMember"
  >
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface ParentEvidence extends DiscordChannel {
  guild_id: string
  name: string
  permission_overwrites: DiscordPermissionOverwrite[]
}

interface ExactMember extends DiscordGuildMember {
  user: NonNullable<DiscordGuildMember["user"]>
}

interface ThreadEvidenceState {
  botMember: ExactMember
  connectorMembership: DiscordThreadMember | null
  connectorPermission: ThreadGovernancePermissionEvidence
  guild: DiscordGuild & { name: string; owner_id: string }
  parent: ParentEvidence
  roles: DiscordRole[]
  targetMember: ExactMember | null
  targetMembership: DiscordThreadMember | null
  targetPermission: ThreadGovernancePermissionEvidence | null
  thread: DiscordThreadStateSummary
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (!validSnowflake(value)) {
    throw new RangeError(`${description} must be a positive Discord snowflake`)
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

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function normalizedName(value: unknown): string {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || value.length < 1
    || [...value].length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError("Discord thread name is invalid")
  }
  return value
}

export function normalizeThreadChangeRequest(
  request: ThreadChangeRequest,
): NormalizedThreadChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord thread change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (!THREAD_CHANGE_ACTIONS.includes(record.action as ThreadChangeAction)) {
    throw new RangeError("Discord thread action is unsupported")
  }
  const action = record.action as ThreadChangeAction
  assertSnowflake(record.guildId, "Discord thread-governance guild ID")
  assertSnowflake(record.threadId, "Discord thread-governance thread ID")
  if (typeof record.auditReason !== "string") {
    throw new RangeError("Discord thread-governance audit reason must be a string")
  }
  encodeDiscordAuditReason(record.auditReason)
  const base = {
    auditReason: record.auditReason,
    guildId: record.guildId,
    operationKeyHash: operationKeyHash(record.operationKey as string),
    threadId: record.threadId,
  }
  if (action === "rename") {
    if (!onlyKeys(record, [...BASE_REQUEST_KEYS, "name"])) {
      throw new RangeError("Discord thread rename accepts one name field")
    }
    return { ...base, action: "rename", name: normalizedName(record.name) }
  }
  if (action === "set-auto-archive-duration") {
    if (!onlyKeys(record, [...BASE_REQUEST_KEYS, "autoArchiveDuration"])) {
      throw new RangeError("Discord thread auto-archive change accepts one duration field")
    }
    if (!(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly unknown[]).includes(
      record.autoArchiveDuration,
    )) {
      throw new RangeError("Discord thread auto-archive duration is unsupported")
    }
    return {
      ...base,
      action: "set-auto-archive-duration",
      autoArchiveDuration: record.autoArchiveDuration as number,
    }
  }
  if (action === "set-slowmode") {
    if (
      !onlyKeys(record, [...BASE_REQUEST_KEYS, "rateLimitPerUser"])
      || typeof record.rateLimitPerUser !== "number"
      || !Number.isSafeInteger(record.rateLimitPerUser)
      || record.rateLimitPerUser < 0
      || record.rateLimitPerUser > DISCORD_LIMITS.channelRateLimitSeconds
    ) {
      throw new RangeError("Discord thread slowmode must be an integer between 0 and 21600")
    }
    return {
      ...base,
      action: "set-slowmode",
      rateLimitPerUser: record.rateLimitPerUser,
    }
  }
  if (action === "set-invitable") {
    if (
      !onlyKeys(record, [...BASE_REQUEST_KEYS, "enabled"])
      || typeof record.enabled !== "boolean"
    ) {
      throw new RangeError("Discord thread invitation change accepts one enabled boolean")
    }
    return { ...base, action: "set-invitable", enabled: record.enabled }
  }
  if (action === "add-member" || action === "remove-member") {
    if (!onlyKeys(record, [...BASE_REQUEST_KEYS, "userId"])) {
      throw new RangeError("Discord thread membership change accepts one user ID")
    }
    assertSnowflake(record.userId, "Discord thread-governance member user ID")
    return action === "add-member"
      ? { ...base, action: "add-member", userId: record.userId }
      : { ...base, action: "remove-member", userId: record.userId }
  }
  if (!onlyKeys(record, BASE_REQUEST_KEYS)) {
    throw new RangeError("Discord thread lifecycle action accepts no action-specific fields")
  }
  return { ...base, action }
}

export function assertThreadAuditInput(guildId: string, threadId: string): void {
  assertSnowflake(guildId, "Discord thread-governance guild ID")
  assertSnowflake(threadId, "Discord thread-governance thread ID")
}

export function assertThreadMembershipInput(
  guildId: string,
  threadId: string,
  userId: string,
): void {
  assertThreadAuditInput(guildId, threadId)
  assertSnowflake(userId, "Discord thread-governance member user ID")
}

function evidenceError(message: string, cause?: unknown): ThreadGovernanceEvidenceError {
  return new ThreadGovernanceEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function exactGuild(
  value: DiscordGuild,
  guildId: string,
): DiscordGuild & { name: string; owner_id: string } {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !validSnowflake(value.owner_id)
    || typeof value.name !== "string"
    || value.name.length < 1
    || [...value.name].length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
  ) {
    throw evidenceError("Discord returned invalid thread-governance guild evidence")
  }
  return value as DiscordGuild & { name: string; owner_id: string }
}

function exactMember(
  value: DiscordGuildMember,
  userId: string,
  requireBot: boolean,
): ExactMember {
  const username = value?.user?.username
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.user?.id !== userId
    || (requireBot && value.user.bot !== true)
    || typeof username !== "string"
    || username.length < 1
    || [...username].length > MEMBER_DIRECTORY_LIMITS.nameCharacters
    || TEXT_CONTROL_PATTERN.test(username)
    || !validUnicode(username)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.some((roleId) => !validSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
    || (value.pending !== undefined && typeof value.pending !== "boolean")
  ) {
    throw evidenceError("Discord returned invalid or mismatched thread member evidence")
  }
  return value as ExactMember
}

function exactRoles(
  values: readonly DiscordRole[],
  guildId: string,
  members: readonly DiscordGuildMember[],
): DiscordRole[] {
  try {
    normalizeDiscordRoleInventory(values, guildId)
  } catch (error) {
    throw evidenceError(
      `Discord thread-governance role evidence is invalid: ${errorMessage(error)}`,
      error,
    )
  }
  const ids = new Set(values.map((role) => role.id))
  for (const member of members) {
    if (member.roles.some((roleId) => !ids.has(roleId))) {
      throw evidenceError("Discord thread-governance evidence references an unknown role")
    }
  }
  return [...values]
}

function exactOverwrites(
  value: unknown,
  roleIds: ReadonlySet<string>,
): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord thread parent omitted complete overwrite evidence")
  }
  const seen = new Set<string>()
  const projected: DiscordPermissionOverwrite[] = []
  for (const item of value as readonly unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw evidenceError("Discord returned malformed thread parent overwrite evidence")
    }
    const overwrite = item as Partial<DiscordPermissionOverwrite>
    const key = `${overwrite.type}:${overwrite.id}`
    if (
      !validSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || typeof overwrite.allow !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(overwrite.allow)
      || typeof overwrite.deny !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(overwrite.deny)
      || (BigInt(overwrite.allow) & BigInt(overwrite.deny)) !== 0n
      || seen.has(key)
      || (overwrite.type === 0 && !roleIds.has(overwrite.id))
    ) {
      throw evidenceError("Discord returned invalid, duplicate, or unresolved thread parent overwrite evidence")
    }
    seen.add(key)
    projected.push({
      allow: overwrite.allow,
      deny: overwrite.deny,
      id: overwrite.id,
      type: overwrite.type,
    } as DiscordPermissionOverwrite)
  }
  return projected.sort((left, right) => {
    const leftId = BigInt(left.id)
    const rightId = BigInt(right.id)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : left.type - right.type
  })
}

function exactThreadState(
  value: DiscordThreadStateSummary,
  guildId: string,
  threadId: string,
): DiscordThreadStateSummary {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== threadId
    || value.guildId !== guildId
    || !validSnowflake(value.parentId)
    || !validSnowflake(value.ownerId)
    || !THREAD_TYPES.has(value.type)
    || typeof value.name !== "string"
    || value.name.length < 1
    || [...value.name].length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
    || typeof value.archived !== "boolean"
    || typeof value.locked !== "boolean"
    || !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(value.autoArchiveDuration)
    || !Number.isSafeInteger(value.rateLimitPerUser)
    || value.rateLimitPerUser < 0
    || value.rateLimitPerUser > DISCORD_LIMITS.channelRateLimitSeconds
    || (value.type === DISCORD_CHANNEL_TYPES.privateThread
      ? typeof value.invitable !== "boolean"
      : value.invitable !== null)
    || !Number.isSafeInteger(value.unknownFieldCount)
    || value.unknownFieldCount < 0
    || !Number.isSafeInteger(value.unknownMetadataFieldCount)
    || value.unknownMetadataFieldCount < 0
  ) {
    throw evidenceError("Discord returned invalid or mismatched thread state")
  }
  return value
}

function exactParent(
  value: DiscordChannel,
  thread: DiscordThreadStateSummary,
  roleIds: ReadonlySet<string>,
): ParentEvidence {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== thread.parentId
    || value.guild_id !== thread.guildId
    || !PARENT_TYPES.has(value.type)
    || typeof value.name !== "string"
    || value.name.length < 1
    || [...value.name].length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(value.name)
    || !validUnicode(value.name)
  ) {
    throw evidenceError("Discord returned a mismatched or unsupported thread parent")
  }
  const relationshipValid = thread.type === DISCORD_CHANNEL_TYPES.privateThread
    ? value.type === DISCORD_CHANNEL_TYPES.text
    : thread.type === DISCORD_CHANNEL_TYPES.announcementThread
      ? value.type === DISCORD_CHANNEL_TYPES.announcement
      : value.type === DISCORD_CHANNEL_TYPES.text
        || value.type === DISCORD_CHANNEL_TYPES.forum
        || value.type === DISCORD_CHANNEL_TYPES.media
  if (!relationshipValid) {
    throw evidenceError("Discord returned a mismatched or unsupported thread parent")
  }
  return {
    ...value,
    permission_overwrites: exactOverwrites(value.permission_overwrites, roleIds),
  } as ParentEvidence
}

function exactThreadMember(
  value: DiscordThreadMember,
  threadId: string,
  userId: string,
): DiscordThreadMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== threadId
    || value.user_id !== userId
    || typeof value.join_timestamp !== "string"
    || Number.isNaN(Date.parse(value.join_timestamp))
    || typeof value.flags !== "number"
    || !Number.isSafeInteger(value.flags)
    || value.flags < 0
    || value.member !== undefined
    || !Number.isSafeInteger(value.unknown_field_count ?? 0)
    || (value.unknown_field_count ?? 0) < 0
  ) {
    throw evidenceError("Discord returned invalid or mismatched exact thread membership")
  }
  return value
}

async function optionalThreadMember(
  client: ThreadGovernanceServiceOptions["client"],
  threadId: string,
  userId: string,
  options: RequestOptions,
): Promise<DiscordThreadMember | null> {
  try {
    return exactThreadMember(
      await client.getThreadMember(threadId, userId, options),
      threadId,
      userId,
    )
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return null
    throw error
  }
}

function permissionEvidence(
  options: {
    guildId: string
    guildOwnerId: string
    member: DiscordGuildMember
    parent: ParentEvidence
    roles: readonly DiscordRole[]
    subjectId: string
  },
  requestedPermissions: readonly DiscordPermissionName[],
  requireAllowed: boolean,
  description: string,
): ThreadGovernancePermissionEvidence {
  let result: PrincipalPermissionResult
  try {
    result = evaluatePrincipalPermissions({
      channel: options.parent,
      guildId: options.guildId,
      guildOwnerId: options.guildOwnerId,
      permissionChannel: options.parent,
      requestedPermissions,
      roles: options.roles,
      subject: {
        id: options.subjectId,
        kind: "member",
        member: options.member,
      },
    })
  } catch (error) {
    throw evidenceError(`Discord ${description} permission evidence is invalid`, error)
  }
  if (
    result.confidence !== "complete"
    || result.allowed === null
    || result.unknownPermissionBits !== "0"
    || result.ineffectivePermissions.length > 0
    || (requireAllowed && result.allowed !== true)
  ) {
    throw evidenceError(`Discord ${description} lacks complete required channel permissions`)
  }
  return {
    administrator: result.administrator,
    allowed: result.allowed,
    appliedRoleIds: [...result.appliedRoleIds],
    effectivePermissionNames: [...result.effectivePermissionNames],
    effectivePermissions: result.effectivePermissions,
    guildOwner: result.guildOwner,
    missingPermissions: [...result.missingPermissions],
    requestedPermissions: [...requestedPermissions],
    unknownPermissionBits: "0",
    warnings: [...result.warnings],
  }
}

function guildPermissions(
  member: DiscordGuildMember,
  roles: readonly DiscordRole[],
  guildId: string,
  description: string,
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError(`Discord ${description} guild permission evidence is invalid`, error)
  }
  if (!result.complete || unknownDiscordPermissionBits(BigInt(result.effectivePermissions)) !== 0n) {
    throw evidenceError(`Discord ${description} guild permission evidence is incomplete or unknown`)
  }
  return result
}

function hasPermission(
  permission: ThreadGovernancePermissionEvidence,
  name: DiscordPermissionName,
): boolean {
  if (permission.administrator) return true
  return (BigInt(permission.effectivePermissions) & DISCORD_PERMISSIONS[name])
    === DISCORD_PERMISSIONS[name]
}

function threadTypeName(type: number): ThreadStateView["type"] {
  if (type === DISCORD_CHANNEL_TYPES.announcementThread) return "announcement"
  if (type === DISCORD_CHANNEL_TYPES.privateThread) return "private"
  return "public"
}

function threadView(thread: DiscordThreadStateSummary): ThreadStateView {
  return {
    archived: thread.archived,
    autoArchiveDuration: thread.autoArchiveDuration,
    guildId: thread.guildId,
    id: thread.id,
    invitable: thread.invitable,
    locked: thread.locked,
    name: thread.name,
    ownerId: thread.ownerId,
    parentId: thread.parentId,
    rateLimitPerUser: thread.rateLimitPerUser,
    type: threadTypeName(thread.type),
    unknownFieldCount: thread.unknownFieldCount,
    unknownMetadataFieldCount: thread.unknownMetadataFieldCount,
  }
}

function membershipView(
  userId: string,
  membership: DiscordThreadMember | null,
): ThreadMembershipView {
  return {
    isMember: membership !== null,
    joinedAt: membership?.join_timestamp ?? null,
    unknownFieldCount: membership?.unknown_field_count ?? 0,
    userId,
  }
}

function privacyProjection(): ThreadPrivacyProjection {
  return {
    embeddedGuildMembers: "never-requested",
    enumeration: "none",
    omittedFields: THREAD_OMITTED_FIELDS,
    persistence: "content-free-outcomes-only",
    rawPayloadExposed: false,
  }
}

function rolesSnapshot(roles: readonly DiscordRole[]) {
  return roles.map((role) => ({
    id: role.id,
    managed: role.managed,
    permissions: role.permissions,
    position: role.position,
  })).sort((left, right) => left.id.localeCompare(right.id))
}

function parentSnapshot(parent: ParentEvidence) {
  return {
    guildId: parent.guild_id,
    id: parent.id,
    name: parent.name,
    permissionOverwrites: parent.permission_overwrites,
    type: parent.type,
  }
}

function targetUserId(request: NormalizedThreadChangeRequest): string | null {
  return "userId" in request ? request.userId : null
}

function selfMembershipAction(request: NormalizedThreadChangeRequest): boolean {
  return request.action === "join" || request.action === "leave"
}

function membershipUserId(
  request: NormalizedThreadChangeRequest,
  botId: string,
): string | null {
  if ("userId" in request) return request.userId
  return selfMembershipAction(request) ? botId : null
}

function desiredState(request: NormalizedThreadChangeRequest): ThreadChangePlan["desired"] {
  if (request.action === "rename") return { field: "name", value: request.name }
  if (request.action === "archive") return { field: "archived", value: true }
  if (request.action === "unarchive") return { field: "archived", value: false }
  if (request.action === "lock") return { field: "locked", value: true }
  if (request.action === "unlock") return { field: "locked", value: false }
  if (request.action === "set-auto-archive-duration") {
    return { field: "autoArchiveDuration", value: request.autoArchiveDuration }
  }
  if (request.action === "set-slowmode") {
    return { field: "rateLimitPerUser", value: request.rateLimitPerUser }
  }
  if (request.action === "set-invitable") {
    return { field: "invitable", value: request.enabled }
  }
  return {
    field: "membership",
    value: request.action === "add-member" || request.action === "join",
  }
}

function writeRequired(
  request: NormalizedThreadChangeRequest,
  thread: DiscordThreadStateSummary,
  membership: DiscordThreadMember | null,
): boolean {
  if (request.action === "rename") return thread.name !== request.name
  if (request.action === "archive") return !thread.archived
  if (request.action === "unarchive") return thread.archived
  if (request.action === "lock") return !thread.locked
  if (request.action === "unlock") return thread.locked
  if (request.action === "set-auto-archive-duration") {
    return thread.autoArchiveDuration !== request.autoArchiveDuration
  }
  if (request.action === "set-slowmode") {
    return thread.rateLimitPerUser !== request.rateLimitPerUser
  }
  if (request.action === "set-invitable") return thread.invitable !== request.enabled
  if (request.action === "add-member" || request.action === "join") {
    return membership === null
  }
  return membership !== null
}

function authorizationBasis(
  request: NormalizedThreadChangeRequest,
  state: ThreadEvidenceState,
  requiresWrite: boolean,
): ThreadChangePlan["authorizationBasis"] {
  if (!requiresWrite) return "already-current"
  const managesThreads = hasPermission(state.connectorPermission, "MANAGE_THREADS")
  const ownsThread = state.thread.ownerId === state.botMember.user.id
  const connectorIsMember = state.connectorMembership !== null
  const canSend = hasPermission(state.connectorPermission, "SEND_MESSAGES_IN_THREADS")
  if (request.action !== "unarchive" && state.thread.archived) {
    throw evidenceError("Discord thread must be active before this change")
  }
  if (request.action === "join" || request.action === "leave") {
    if (
      state.thread.type === DISCORD_CHANNEL_TYPES.privateThread
      && !managesThreads
    ) {
      throw evidenceError(
        "Discord private-thread self-membership changes require MANAGE_THREADS for complete access and readback evidence",
      )
    }
    return managesThreads ? "manage-threads" : "self-membership"
  }
  if (
    (request.action === "add-member" || request.action === "remove-member")
    && state.thread.locked
  ) {
    throw evidenceError("Discord membership changes require an unlocked active thread")
  }
  if (
    request.action === "rename"
    || request.action === "archive"
    || request.action === "set-auto-archive-duration"
  ) {
    if (managesThreads) return "manage-threads"
    throw evidenceError("Discord thread change requires MANAGE_THREADS")
  }
  if (request.action === "unarchive") {
    if (!connectorIsMember || !canSend) {
      throw evidenceError("Discord thread unarchive requires exact connector membership and SEND_MESSAGES_IN_THREADS")
    }
    if (state.thread.locked) {
      if (managesThreads) return "manage-threads"
      throw evidenceError("Discord locked thread unarchive requires MANAGE_THREADS")
    }
    return "member-send"
  }
  if (
    request.action === "lock"
    || request.action === "unlock"
    || request.action === "set-slowmode"
    || request.action === "set-invitable"
  ) {
    if (!managesThreads) {
      throw evidenceError("Discord thread change requires MANAGE_THREADS")
    }
    return "manage-threads"
  }
  if (request.action === "add-member") {
    if (!canSend || (!connectorIsMember && !managesThreads)) {
      throw evidenceError("Discord thread member add requires SEND_MESSAGES_IN_THREADS and membership or MANAGE_THREADS")
    }
    if (
      state.thread.type === DISCORD_CHANNEL_TYPES.privateThread
      && state.thread.invitable === false
      && !managesThreads
    ) {
      throw evidenceError("Discord non-invitable private thread requires MANAGE_THREADS")
    }
    if (state.targetPermission?.allowed !== true) {
      throw evidenceError("Discord target member cannot view the thread parent")
    }
    return managesThreads ? "manage-threads" : "member-send"
  }
  if (managesThreads) return "manage-threads"
  if (state.thread.type === DISCORD_CHANNEL_TYPES.privateThread && ownsThread) {
    return "connector-owner"
  }
  throw evidenceError("Discord thread member removal requires MANAGE_THREADS or private-thread ownership")
}

function actionWarnings(
  request: NormalizedThreadChangeRequest,
  state: ThreadEvidenceState,
): string[] {
  return [
    ...(state.connectorPermission.administrator
      ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped thread permissions"]
      : []),
    ...(state.thread.unknownFieldCount > 0
      ? [`Discord thread contains ${state.thread.unknownFieldCount} unknown top-level fields whose values were discarded`]
      : []),
    ...(state.connectorMembership && (state.connectorMembership.unknown_field_count ?? 0) > 0
      ? ["Discord connector membership contains unknown fields whose values were discarded"]
      : []),
    ...(state.targetMembership && (state.targetMembership.unknown_field_count ?? 0) > 0
      ? ["Discord target membership contains unknown fields whose values were discarded"]
      : []),
    ...(request.action === "add-member"
      || request.action === "join"
      || request.action === "leave"
      || request.action === "remove-member"
      ? ["Discord does not document an audit-log reason header for thread-member endpoints; the reviewed reason is recorded only in the transient plan"]
      : []),
    ...(request.action === "leave" && state.thread.type === DISCORD_CHANNEL_TYPES.privateThread
      ? ["Leaving removes the connector's explicit private-thread membership; MANAGE_THREADS is required so exact post-write evidence remains available"]
      : []),
    "Same-thread serialization and uncertainty quarantine are process-local",
    "The operation key is one-shot and cannot be retried after reservation",
    "This workflow performs one exact non-retried Discord write and never rolls back",
  ]
}

function actionRisks(
  request: NormalizedThreadChangeRequest,
  write: boolean,
): string[] {
  if (!write) return []
  const effect = request.action === "add-member"
    ? "The exact member will gain access to and notifications from the reviewed thread"
    : request.action === "join"
      ? "The connector bot will gain explicit membership in the reviewed thread"
      : request.action === "leave"
        ? "The connector bot will lose explicit membership in the reviewed thread and may receive fewer thread notifications"
        : request.action === "remove-member"
          ? "The exact member will lose explicit membership in the reviewed thread"
          : request.action === "archive"
            ? "The reviewed thread will become archived and ordinary activity will stop"
            : request.action === "unarchive"
              ? "The reviewed thread will become active and resume ordinary activity"
              : request.action === "lock"
                ? "The reviewed thread will restrict non-moderator activity"
                : request.action === "unlock"
                  ? "The reviewed thread will permit ordinary member activity again"
                  : "One reviewed thread metadata field will change immediately"
  return [
    effect,
    "A transport or readback failure after dispatch creates an uncertain outcome that blocks later same-thread changes in this process",
  ]
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/gu, "").slice(0, 128)
  return normalized || "UnknownError"
}

function targetKey(guildId: string, threadId: string): string {
  return `${guildId}\0${threadId}`
}

function executionBlocksTarget(error: unknown): boolean {
  if (
    !(error instanceof ThreadGovernanceExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
    || error.result.status === "completed-operation-record-failed"
}

function priorUncertainError(
  request: NormalizedThreadChangeRequest,
  planDigest: string | null,
): ThreadGovernanceExecutionError {
  return new ThreadGovernanceExecutionError(
    "Discord thread change was blocked because a prior same-thread operation ended without a durable outcome",
    {
      action: request.action,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest,
      schemaVersion: SCHEMA_VERSION,
      status: "blocked-prior-uncertain",
      targetUserId: targetUserId(request),
      threadId: request.threadId,
    },
  )
}

async function withTargetLock<T>(
  state: ThreadLockState,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ThreadGovernanceExecutionError,
): Promise<T> {
  const prior = state.tails.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: ThreadTargetOutcome) => void = () => undefined
  const tail = new Promise<ThreadTargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(key, tail)
  let outcome: ThreadTargetOutcome = "settled"
  try {
    await prior
    if (state.uncertainTargets.has(key)) {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksTarget(error)) {
      outcome = "uncertain"
      state.uncertainTargets.add(key)
    }
    throw error
  } finally {
    release(outcome)
    if (state.tails.get(key) === tail) state.tails.delete(key)
  }
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    threadId: receipt.resourceId,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: ThreadChangePlan
  request: NormalizedThreadChangeRequest
  status: ThreadGovernanceActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): ThreadGovernanceActivity {
  return {
    action: options.request.action,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "thread-governance-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    targetUserId: targetUserId(options.request),
    threadId: options.request.threadId,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: ThreadChangePlan
  request: NormalizedThreadChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "thread-governance-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.request.threadId,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function mutationInput(request: NormalizedThreadChangeRequest): ModifyThreadStateInput | null {
  if (request.action === "rename") return { name: request.name }
  if (request.action === "archive") return { archived: true }
  if (request.action === "unarchive") return { archived: false }
  if (request.action === "lock") return { locked: true }
  if (request.action === "unlock") return { locked: false }
  if (request.action === "set-auto-archive-duration") {
    return { autoArchiveDuration: request.autoArchiveDuration }
  }
  if (request.action === "set-slowmode") {
    return { rateLimitPerUser: request.rateLimitPerUser }
  }
  if (request.action === "set-invitable") return { invitable: request.enabled }
  return null
}

function controlledStateMatches(
  thread: DiscordThreadStateSummary,
  request: NormalizedThreadChangeRequest,
): boolean {
  if (request.action === "rename") return thread.name === request.name
  if (request.action === "archive") return thread.archived
  if (request.action === "unarchive") return !thread.archived
  if (request.action === "lock") return thread.locked
  if (request.action === "unlock") return !thread.locked
  if (request.action === "set-auto-archive-duration") {
    return thread.autoArchiveDuration === request.autoArchiveDuration
  }
  if (request.action === "set-slowmode") {
    return thread.rateLimitPerUser === request.rateLimitPerUser
  }
  if (request.action === "set-invitable") return thread.invitable === request.enabled
  return true
}

function threadDrift(
  before: DiscordThreadStateSummary,
  after: DiscordThreadStateSummary,
  request: NormalizedThreadChangeRequest,
): ThreadGovernanceDriftField[] {
  const controlled = desiredState(request).field
  const drift: ThreadGovernanceDriftField[] = []
  if (controlled !== "name" && before.name !== after.name) drift.push("name")
  if (controlled !== "archived" && before.archived !== after.archived) drift.push("archived")
  if (controlled !== "locked" && before.locked !== after.locked) drift.push("locked")
  if (
    controlled !== "autoArchiveDuration"
    && before.autoArchiveDuration !== after.autoArchiveDuration
  ) drift.push("auto-archive-duration")
  if (controlled !== "invitable" && before.invitable !== after.invitable) {
    drift.push("invitable")
  }
  if (
    controlled !== "rateLimitPerUser"
    && before.rateLimitPerUser !== after.rateLimitPerUser
  ) drift.push("rate-limit-per-user")
  return drift
}

export class ThreadGovernanceService {
  readonly #activityStore: ActivityStore
  readonly #client: ThreadGovernanceServiceOptions["client"]
  readonly #clock: () => Date
  readonly #locks: ThreadLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: ThreadGovernanceServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#locks = threadGovernanceLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #evidence(
    applicationId: string,
    botId: string,
    guildId: string,
    threadId: string,
    options: RequestOptions,
    request?: NormalizedThreadChangeRequest,
    requestedUserId?: string,
  ): Promise<ThreadEvidenceState> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    assertThreadAuditInput(guildId, threadId)
    if (request) {
      this.#policy.assertThreadChangeAllowed(guildId, threadId)
      const receipt = await this.#operationStore.get(
        "thread-governance-change",
        request.operationKeyHash,
      )
      if (receipt) throw new ThreadGovernanceOperationConflictError(receiptView(receipt))
    } else {
      this.#policy.assertThreadAuditable(guildId, threadId)
    }
    const userId = requestedUserId ?? (request ? targetUserId(request) : null)
    if (userId) this.#policy.assertThreadMemberUserAllowed(userId)
    if (request && userId === botId) {
      throw evidenceError("Discord thread governance cannot add or remove the connector bot")
    }
    const [rawGuild, rawBotMember, rawRoles, rawThread, rawTargetMember] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getThreadState(threadId, options),
      userId
        ? this.#client.getGuildMember(guildId, userId, options)
        : Promise.resolve(null),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactMember(rawBotMember, botId, true)
    const targetMember = rawTargetMember ? exactMember(rawTargetMember, userId as string, false) : null
    const roles = exactRoles(
      rawRoles,
      guildId,
      targetMember ? [botMember, targetMember] : [botMember],
    )
    const thread = exactThreadState(rawThread, guildId, threadId)
    const roleIds = new Set(roles.map((role) => role.id))
    const rawParent = await this.#client.getChannel(thread.parentId, options)
    const parent = exactParent(rawParent, thread, roleIds)
    const parentGuildId = this.#policy.assertChannelReadable(parent)
    if (parentGuildId !== guildId) {
      throw evidenceError("Discord thread parent belongs to another guild")
    }
    const connectorPermission = permissionEvidence({
      guildId,
      guildOwnerId: guild.owner_id,
      member: botMember,
      parent,
      roles,
      subjectId: botId,
    }, ["VIEW_CHANNEL"], true, "connector bot")
    const targetPermission = targetMember
      ? permissionEvidence({
          guildId,
          guildOwnerId: guild.owner_id,
          member: targetMember,
          parent,
          roles,
          subjectId: targetMember.user.id,
        }, ["VIEW_CHANNEL"], false, "target member")
      : null
    const [connectorMembership, targetMembership] = await Promise.all([
      optionalThreadMember(this.#client, threadId, botId, options),
      userId
        ? optionalThreadMember(this.#client, threadId, userId, options)
        : Promise.resolve(null),
    ])
    return {
      botMember,
      connectorMembership,
      connectorPermission,
      guild,
      parent,
      roles,
      targetMember,
      targetMembership,
      targetPermission,
      thread,
    }
  }

  #auditResult(
    applicationId: string,
    botId: string,
    state: ThreadEvidenceState,
  ): ThreadStateAuditResult {
    return {
      applicationId,
      botId,
      connectorMembership: membershipView(botId, state.connectorMembership),
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      parent: { id: state.parent.id, name: state.parent.name, type: state.parent.type },
      permission: state.connectorPermission,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      thread: threadView(state.thread),
      warnings: [
        ...(state.connectorPermission.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped thread permissions"]
          : []),
        ...(state.thread.unknownFieldCount > 0
          ? [`Discord thread contains ${state.thread.unknownFieldCount} unknown top-level fields whose values were discarded`]
          : []),
        ...(state.thread.unknownMetadataFieldCount > 0
          ? ["Discord thread metadata contains unknown fields, so changes are blocked"]
          : []),
        "This exact lookup never enumerates thread members",
      ],
    }
  }

  async getState(
    applicationId: string,
    botId: string,
    guildId: string,
    threadId: string,
    options: RequestOptions = {},
  ): Promise<ThreadStateAuditResult> {
    const state = await this.#evidence(
      applicationId,
      botId,
      guildId,
      threadId,
      options,
    )
    return this.#auditResult(applicationId, botId, state)
  }

  async getMembership(
    applicationId: string,
    botId: string,
    guildId: string,
    threadId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<ThreadMembershipAuditResult> {
    assertThreadMembershipInput(guildId, threadId, userId)
    const state = await this.#evidence(
      applicationId,
      botId,
      guildId,
      threadId,
      options,
      undefined,
      userId,
    )
    if (!state.targetMember || !state.targetPermission) {
      throw evidenceError("Discord thread membership audit omitted target evidence")
    }
    return {
      ...this.#auditResult(applicationId, botId, state),
      member: { id: userId, username: state.targetMember.user.username },
      membership: membershipView(userId, state.targetMembership),
      targetPermission: state.targetPermission,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedThreadChangeRequest,
    options: RequestOptions,
  ): Promise<ThreadChangePlan> {
    const state = await this.#evidence(
      applicationId,
      botId,
      request.guildId,
      request.threadId,
      options,
      request,
    )
    if (state.thread.unknownMetadataFieldCount > 0) {
      throw evidenceError("Discord returned unknown thread metadata fields, so changes are blocked")
    }
    if (request.action === "set-invitable" && state.thread.type !== DISCORD_CHANNEL_TYPES.privateThread) {
      throw evidenceError("Discord invitation policy is available only on private threads")
    }
    const membership = request.action === "add-member" || request.action === "remove-member"
      ? state.targetMembership
      : selfMembershipAction(request)
        ? state.connectorMembership
        : null
    const requiresWrite = writeRequired(request, state.thread, membership)
    if (requiresWrite && request.action === "add-member") {
      if (!state.targetMember || !state.targetPermission) {
        throw evidenceError("Discord thread member add omitted target evidence")
      }
      if (state.targetMember.pending) {
        throw evidenceError("Discord pending guild members cannot be added to a thread")
      }
    }
    if (requiresWrite && request.action === "remove-member") {
      if (!state.targetMember) {
        throw evidenceError("Discord thread member removal omitted target evidence")
      }
      const userId = request.userId
      this.#policy.assertUserNotProtected(userId)
      if (userId === state.guild.owner_id) {
        throw evidenceError("Discord thread member removal cannot target the guild owner")
      }
      if (guildPermissions(
        state.targetMember,
        state.roles,
        request.guildId,
        "target member",
      ).administrator) {
        throw evidenceError("Discord thread member removal cannot target an administrator")
      }
    }
    const basis = authorizationBasis(request, state, requiresWrite)
    const warnings = actionWarnings(request, state)
    const risks = actionRisks(request, requiresWrite)
    const desired = desiredState(request)
    const privacy = privacyProjection()
    const currentThread = threadView(state.thread)
    const controlledMembershipUserId = membershipUserId(request, botId)
    const currentMembership = controlledMembershipUserId
      ? membershipView(controlledMembershipUserId, membership)
      : null
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      authorizationBasis: basis,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user.id,
      },
      connectorMembership: membershipView(botId, state.connectorMembership),
      connectorPermission: state.connectorPermission,
      desired,
      domain: "discord-mcp-thread-governance-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      membership: currentMembership,
      parent: parentSnapshot(state.parent),
      privacy,
      request,
      risks,
      roles: rolesSnapshot(state.roles),
      targetMember: state.targetMember
        ? {
            pending: state.targetMember.pending ?? false,
            roles: [...state.targetMember.roles].sort(),
            userId: state.targetMember.user.id,
            username: state.targetMember.user.username,
          }
        : null,
      targetPermission: state.targetPermission,
      thread: currentThread,
      warnings,
    })
    return {
      action: request.action,
      applicationId,
      auditReason: request.auditReason,
      authorizationBasis: basis,
      botId,
      connectorMembership: membershipView(botId, state.connectorMembership),
      createdAt: this.#clock().toISOString(),
      desired,
      digest,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      member: state.targetMember
        ? { id: state.targetMember.user.id, username: state.targetMember.user.username }
        : null,
      membership: currentMembership,
      operationKeyHash: request.operationKeyHash,
      parent: { id: state.parent.id, name: state.parent.name, type: state.parent.type },
      permission: state.connectorPermission,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: requiresWrite ? "planned" : "already-current",
      targetPermission: state.targetPermission,
      thread: currentThread,
      warnings,
      writeRequired: requiresWrite,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: ThreadChangeRequest,
    options: RequestOptions = {},
  ): Promise<ThreadChangePlan> {
    const normalized = normalizeThreadChangeRequest(request)
    if (this.#locks.uncertainTargets.has(targetKey(normalized.guildId, normalized.threadId))) {
      throw priorUncertainError(normalized, null)
    }
    return this.#buildPlan(
      applicationId,
      botId,
      normalized,
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: ThreadChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ThreadChangeResult> {
    const normalized = normalizeThreadChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord thread-governance plan digest is invalid")
    }
    const key = targetKey(normalized.guildId, normalized.threadId)
    return withTargetLock(
      this.#locks,
      key,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => priorUncertainError(normalized, expectedDigest),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedThreadChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ThreadChangeResult> {
    let plan: ThreadChangePlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ThreadGovernanceEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ThreadGovernancePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new ThreadGovernancePlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: request.action,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      targetUserId: targetUserId(request),
      threadId: request.threadId,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        driftFields: [],
        observedMembership: plan.membership,
        observedThread: plan.thread,
        status: "already-current",
        verification: "not-required",
      }
    }
    const before = exactThreadState({
      archived: plan.thread.archived,
      autoArchiveDuration: plan.thread.autoArchiveDuration,
      guildId: plan.thread.guildId,
      id: plan.thread.id,
      invitable: plan.thread.invitable,
      locked: plan.thread.locked,
      name: plan.thread.name,
      ownerId: plan.thread.ownerId,
      parentId: plan.thread.parentId,
      rateLimitPerUser: plan.thread.rateLimitPerUser,
      type: plan.thread.type === "announcement"
        ? DISCORD_CHANNEL_TYPES.announcementThread
        : plan.thread.type === "private"
          ? DISCORD_CHANNEL_TYPES.privateThread
          : DISCORD_CHANNEL_TYPES.publicThread,
      unknownFieldCount: plan.thread.unknownFieldCount,
      unknownMetadataFieldCount: plan.thread.unknownMetadataFieldCount,
    }, request.guildId, request.threadId)
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new ThreadGovernanceOperationConflictError(receiptView(reservation.receipt))
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
      throw new ThreadGovernanceExecutionError(
        "Discord thread change was blocked because pending activity could not be recorded",
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

    let mutationStarted = false
    let mutationReturned = false
    let observedThread: DiscordThreadStateSummary | null = null
    let observedMembership: DiscordThreadMember | null = null
    let driftFields: ThreadGovernanceDriftField[] = []
    try {
      mutationStarted = true
      const input = mutationInput(request)
      if (input) {
        const response = exactThreadState(
          await this.#client.modifyThreadState(
            request.threadId,
            input,
            request.auditReason,
            options,
          ),
          request.guildId,
          request.threadId,
        )
        mutationReturned = true
        if (response.parentId !== before.parentId || response.ownerId !== before.ownerId) {
          throw evidenceError("Discord thread PATCH response changed immutable identity evidence")
        }
        if (!controlledStateMatches(response, request)) {
          throw evidenceError("Discord thread PATCH response did not prove the controlled state")
        }
        driftFields = threadDrift(before, response, request)
      } else if (request.action === "add-member") {
        await this.#client.addThreadMember(request.threadId, request.userId, options)
        mutationReturned = true
      } else if (request.action === "join") {
        await this.#client.joinThread(request.threadId, options)
        mutationReturned = true
      } else if (request.action === "leave") {
        await this.#client.leaveThread(request.threadId, options)
        mutationReturned = true
      } else if (request.action === "remove-member") {
        await this.#client.removeThreadMember(request.threadId, request.userId, options)
        mutationReturned = true
      }
      observedThread = exactThreadState(
        await this.#client.getThreadState(request.threadId, options),
        request.guildId,
        request.threadId,
      )
      if (
        observedThread.parentId !== before.parentId
        || observedThread.ownerId !== before.ownerId
        || observedThread.type !== before.type
        || observedThread.unknownMetadataFieldCount > 0
      ) {
        throw evidenceError("Discord thread readback changed identity or introduced unknown lifecycle evidence")
      }
      this.#policy.assertThreadChangeAllowed(request.guildId, request.threadId)
      if (input && !controlledStateMatches(observedThread, request)) {
        throw evidenceError("Discord thread readback did not match the controlled state")
      }
      driftFields = [...new Set([
        ...driftFields,
        ...threadDrift(before, observedThread, request),
      ])]
      const readbackUserId = membershipUserId(request, botId)
      if (readbackUserId) {
        observedMembership = await optionalThreadMember(
          this.#client,
          request.threadId,
          readbackUserId,
          options,
        )
        if (
          ((request.action === "add-member" || request.action === "join")
            && observedMembership === null)
          || ((request.action === "leave" || request.action === "remove-member")
            && observedMembership !== null)
        ) {
          throw evidenceError("Discord thread membership readback did not match the controlled state")
        }
      }
    } catch (error) {
      const definiteMutationRefusal = mutationStarted
        && !mutationReturned
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
      const status = definiteMutationRefusal ? "failed" : "uncertain"
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
      throw new ThreadGovernanceExecutionError(
        "Discord thread change did not complete with a verified successful outcome",
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
        },
        { cause: error },
      )
    }

    if (!observedThread) {
      throw new ThreadGovernanceExecutionError(
        "Discord thread change omitted verified readback",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    const verification = driftFields.length > 0 ? "drift" : "match"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const observedMembershipUserId = membershipUserId(request, botId)
    const result: ThreadChangeResult = {
      ...baseResult,
      activityId,
      driftFields,
      observedMembership: observedMembershipUserId
        ? membershipView(observedMembershipUserId, observedMembership)
        : null,
      observedThread: threadView(observedThread),
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
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ThreadGovernanceExecutionError(
        "Discord thread change completed but the operation receipt failed",
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
      throw new ThreadGovernanceExecutionError(
        "Discord thread change completed but the final activity record failed",
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
