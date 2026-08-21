import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  StageInstanceActivity,
  StageInstanceActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
  STAGE_INSTANCE_ACTIONS,
  type StageInstanceAction,
} from "./constants.js"
import {
  DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS,
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordStageInstanceSummary,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  StageInstanceEvidenceError,
  StageInstanceExecutionError,
  StageInstanceOperationConflictError,
  StageInstancePlanChangedError,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  DISCORD_PERMISSIONS,
  evaluateBotChannelPermissions,
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

export const STAGE_INSTANCE_OMITTED_FIELDS = Object.freeze([
  "audienceState",
  "rawDiscordObject",
  "scheduledEventObject",
  "speakerState",
] as const)

const STAGE_READ_PERMISSIONS = Object.freeze([
  "VIEW_CHANNEL",
] as const satisfies readonly DiscordPermissionName[])

const STAGE_CHANGE_PERMISSIONS = Object.freeze([
  "VIEW_CHANNEL",
  "CONNECT",
  "MANAGE_CHANNELS",
  "MUTE_MEMBERS",
  "MOVE_MEMBERS",
] as const satisfies readonly DiscordPermissionName[])

const STAGE_INVENTORY_CONCURRENCY = 4
const STAGE_STATE_UNAVAILABLE = "stage-instance-state-unavailable"
const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

interface StageInstanceRequestBase {
  action: StageInstanceAction
  auditReason: string
  channelId: string
  guildId: string
  operationKey: string
}

export interface StartStageInstanceRequest extends StageInstanceRequestBase {
  action: "start"
  sendStartNotification?: boolean
  topic: string
}

export interface UpdateStageInstanceRequest extends StageInstanceRequestBase {
  action: "update"
  topic: string
}

export interface EndStageInstanceRequest extends StageInstanceRequestBase {
  action: "end"
}

export type StageInstanceChangeRequest =
  | EndStageInstanceRequest
  | StartStageInstanceRequest
  | UpdateStageInstanceRequest

interface NormalizedStageInstanceRequestBase {
  action: StageInstanceAction
  auditReason: string
  channelId: string
  guildId: string
  operationKeyHash: string
}

export type NormalizedStageInstanceChangeRequest =
  | (NormalizedStageInstanceRequestBase & {
      action: "end"
    })
  | (NormalizedStageInstanceRequestBase & {
      action: "start"
      sendStartNotification: boolean
      topic: string
    })
  | (NormalizedStageInstanceRequestBase & {
      action: "update"
      topic: string
    })

export interface ProjectedStageInstance {
  channelId: string
  discoverableDisabled: boolean
  guildId: string
  id: string
  privacyLevel: "guild-only" | "public-deprecated"
  scheduledEventId: string | null
  topic: string
  unknownFieldCount: number
}

export interface PlannedStageInstance {
  channelId: string
  guildId: string
  id: string | null
  privacyLevel: "guild-only"
  scheduledEventId: null
  topic: string
}

export interface StageInstancePermissionEvidence {
  administrator: boolean
  appliedRoleIds: string[]
  confidence: "complete"
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  guildOwner: boolean
  missingPermissions: []
  requiredPermissions: DiscordPermissionName[]
  unknownPermissionBits: string
  warnings: string[]
}

export interface StageInstancePrivacyProjection {
  omittedFields: typeof STAGE_INSTANCE_OMITTED_FIELDS
  rawPayloadExposed: false
  speakerIdentitiesExposed: false
  topicPersisted: false
}

export interface StageInstanceLookupResult {
  access: StageInstancePermissionEvidence
  channel: {
    guildId: string
    id: string
    name: string
    type: "stage"
  }
  guild: {
    id: string
    name: string
  }
  instance: ProjectedStageInstance | null
  privacy: StageInstancePrivacyProjection
  schemaVersion: number
  status: "active" | "inactive"
}

export interface StageInstanceInventoryResult {
  entries: StageInstanceLookupResult[]
  page: {
    active: number
    configured: number
    inactive: number
    returned: number
    safetyLimit: number
  }
  privacy: StageInstancePrivacyProjection
  schemaVersion: number
  status: "ok"
}

export interface StageInstancePlan {
  action: StageInstanceAction
  applicationId: string
  auditReason: string
  botId: string
  channel: {
    guildId: string
    id: string
    name: string
    type: "stage"
  }
  createdAt: string
  desired: PlannedStageInstance | null
  digest: string
  effect: "create" | "delete" | "none" | "update"
  existing: ProjectedStageInstance | null
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  permission: StageInstancePermissionEvidence
  privacy: StageInstancePrivacyProjection
  schemaVersion: number
  status: "already-current" | "planned"
  warnings: string[]
  writeRequired: boolean
}

export interface StageInstanceResult {
  action: StageInstanceAction
  activityId: string | null
  channelId: string
  guildId: string
  observed: ProjectedStageInstance | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  stageInstanceId: string | null
  status: "already-current" | "completed" | "completed-with-drift"
}

export interface StageInstanceServiceClient extends Pick<
  DiscordClient,
  | "createStageInstance"
  | "deleteStageInstance"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "getStageInstance"
  | "modifyStageInstance"
> {}

export interface StageInstanceServiceOptions {
  activityStore: ActivityStore
  client: StageInstanceServiceClient
  clock?: () => Date
  limiter: InteractionLimiter
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface StageEvidenceState {
  botMember: DiscordGuildMember
  channel: DiscordChannel & { guild_id: string; name: string }
  current: ProjectedStageInstance | null
  guild: DiscordGuild & { name: string; owner_id: string }
  permission: StageInstancePermissionEvidence
  roles: DiscordRole[]
}

interface StageGuildEvidenceState {
  botMember: DiscordGuildMember
  guild: DiscordGuild & { name: string; owner_id: string }
  roles: DiscordRole[]
}

type StageGuildEvidenceCache = Map<string, Promise<StageGuildEvidenceState>>

interface StageLockState {
  tails: Map<string, Promise<"settled" | "uncertain">>
  uncertainChannels: Set<string>
}

const STAGE_LOCKS = new WeakMap<OperationStore, StageLockState>()

function stageLocks(operationStore: OperationStore): StageLockState {
  let state = STAGE_LOCKS.get(operationStore)
  if (!state) {
    state = {
      tails: new Map(),
      uncertainChannels: new Set(),
    }
    STAGE_LOCKS.set(operationStore, state)
  }
  return state
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

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function assertTopic(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || [...value].length > DISCORD_LIMITS.stageTopicCharacters
    || !value.trim()
    || TEXT_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError(
      `Discord Stage topic must contain 1-${DISCORD_LIMITS.stageTopicCharacters} nonblank characters without unsupported controls`,
    )
  }
}

const BASE_REQUEST_KEYS = [
  "action",
  "auditReason",
  "channelId",
  "guildId",
  "operationKey",
] as const

export function normalizeStageInstanceChangeRequest(
  request: StageInstanceChangeRequest,
): NormalizedStageInstanceChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord Stage-instance change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !STAGE_INSTANCE_ACTIONS.includes(record.action as StageInstanceAction)
    || !BASE_REQUEST_KEYS.every((key) => record[key] !== undefined)
  ) {
    throw new RangeError("Discord Stage-instance change request has missing fields")
  }
  assertSnowflake(request.guildId, "Discord Stage-instance guild ID")
  assertSnowflake(request.channelId, "Discord Stage-instance channel ID")
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord Stage-instance audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  const base: NormalizedStageInstanceRequestBase = {
    action: request.action,
    auditReason: request.auditReason,
    channelId: request.channelId,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
  if (request.action === "end") {
    if (!onlyKeys(record, BASE_REQUEST_KEYS)) {
      throw new RangeError("Discord Stage ending accepts no content fields")
    }
    return { ...base, action: "end" }
  }
  assertTopic(request.topic)
  if (request.action === "update") {
    if (!onlyKeys(record, [...BASE_REQUEST_KEYS, "topic"])) {
      throw new RangeError("Discord Stage update accepts only one exact topic")
    }
    return { ...base, action: "update", topic: request.topic }
  }
  if (!onlyKeys(record, [
    ...BASE_REQUEST_KEYS,
    "sendStartNotification",
    "topic",
  ])) {
    throw new RangeError("Discord Stage start contains unsupported fields")
  }
  if (
    request.sendStartNotification !== undefined
    && typeof request.sendStartNotification !== "boolean"
  ) {
    throw new RangeError("Discord Stage start notification setting must be a boolean")
  }
  return {
    ...base,
    action: "start",
    sendStartNotification: request.sendStartNotification ?? false,
    topic: request.topic,
  }
}

function exactGuild(
  guild: DiscordGuild,
  guildId: string,
): DiscordGuild & { name: string; owner_id: string } {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || !validSnowflake(guild.owner_id)
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || guild.name.length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(guild.name)
    || !validUnicode(guild.name)
  ) {
    throw new StageInstanceEvidenceError(
      "Discord returned invalid Stage-instance guild evidence",
    )
  }
  return guild as DiscordGuild & { name: string; owner_id: string }
}

function exactBotMember(
  member: DiscordGuildMember,
  botId: string,
): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || member.user?.id !== botId
    || member.user.bot !== true
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(member.roles).size !== member.roles.length
    || member.roles.some((roleId) => !validSnowflake(roleId))
  ) {
    throw new StageInstanceEvidenceError(
      "Discord returned invalid Stage-instance bot-member evidence",
    )
  }
  return member
}

function exactRoles(
  roles: readonly DiscordRole[],
  guildId: string,
  member: DiscordGuildMember,
): DiscordRole[] {
  if (
    !Array.isArray(roles)
    || roles.length < 1
    || roles.length > DISCORD_LIMITS.guildRoles
  ) {
    throw new StageInstanceEvidenceError(
      "Discord returned an invalid Stage-instance role inventory",
    )
  }
  const roleIds = new Set<string>()
  for (const role of roles) {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !validSnowflake(role.id)
      || roleIds.has(role.id)
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(role.permissions)
      || !Number.isInteger(role.position)
      || role.position < 0
      || typeof role.managed !== "boolean"
      || typeof role.name !== "string"
      || role.name.length < 1
      || role.name.length > DISCORD_LIMITS.roleNameCharacters
      || TEXT_CONTROL_PATTERN.test(role.name)
      || !validUnicode(role.name)
    ) {
      throw new StageInstanceEvidenceError(
        "Discord returned malformed or duplicate Stage-instance role evidence",
      )
    }
    roleIds.add(role.id)
  }
  if (!roleIds.has(guildId)) {
    throw new StageInstanceEvidenceError(
      "Discord Stage-instance role evidence omitted the guild @everyone role",
    )
  }
  if (member.roles.some((roleId) => !roleIds.has(roleId))) {
    throw new StageInstanceEvidenceError(
      "Discord Stage-instance bot member references an unknown role",
    )
  }
  return [...roles]
}

function exactOverwrites(
  overwrites: unknown,
  roleIds: ReadonlySet<string>,
): DiscordPermissionOverwrite[] {
  if (
    !Array.isArray(overwrites)
    || overwrites.length > DISCORD_LIMITS.channelPermissionOverwrites
  ) {
    throw new StageInstanceEvidenceError(
      "Discord Stage channel omitted or exceeded its permission overwrite inventory",
    )
  }
  const targets = new Set<string>()
  for (const value of overwrites as readonly unknown[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new StageInstanceEvidenceError(
        "Discord returned an invalid Stage-channel permission overwrite",
      )
    }
    const overwrite = value as Partial<DiscordPermissionOverwrite>
    const key = `${overwrite.type}:${overwrite.id}`
    if (
      !validSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || typeof overwrite.allow !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(overwrite.allow)
      || typeof overwrite.deny !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(overwrite.deny)
      || (BigInt(overwrite.allow) & BigInt(overwrite.deny)) !== 0n
      || targets.has(key)
      || (overwrite.type === 0 && !roleIds.has(overwrite.id))
    ) {
      throw new StageInstanceEvidenceError(
        "Discord returned malformed, contradictory, duplicate, or unknown Stage-channel overwrite evidence",
      )
    }
    targets.add(key)
  }
  return [...overwrites] as DiscordPermissionOverwrite[]
}

function exactChannel(
  channel: DiscordChannel,
  channelId: string,
  expectedGuildId: string | null,
): DiscordChannel & { guild_id: string; name: string } {
  if (
    !channel
    || typeof channel !== "object"
    || Array.isArray(channel)
    || channel.id !== channelId
    || !validSnowflake(channel.id)
    || !validSnowflake(channel.guild_id)
    || (expectedGuildId !== null && channel.guild_id !== expectedGuildId)
    || channel.type !== DISCORD_CHANNEL_TYPES.stageVoice
    || typeof channel.name !== "string"
    || channel.name.length < 1
    || channel.name.length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(channel.name)
    || !validUnicode(channel.name)
  ) {
    throw new StageInstanceEvidenceError(
      "Discord returned a mismatched, malformed, or unsupported Stage channel",
    )
  }
  return channel as DiscordChannel & { guild_id: string; name: string }
}

function projectStageInstance(
  instance: DiscordStageInstanceSummary,
  guildId: string,
  channelId: string,
): ProjectedStageInstance {
  if (
    !instance
    || typeof instance !== "object"
    || Array.isArray(instance)
    || !validSnowflake(instance.id)
    || instance.guildId !== guildId
    || instance.channelId !== channelId
    || typeof instance.discoverableDisabled !== "boolean"
    || (
      instance.privacyLevel !== DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS.public
      && instance.privacyLevel !== DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS.guildOnly
    )
    || !(instance.scheduledEventId === null || validSnowflake(instance.scheduledEventId))
    || !Number.isSafeInteger(instance.unknownFieldCount)
    || instance.unknownFieldCount < 0
  ) {
    throw new StageInstanceEvidenceError(
      "Discord returned mismatched or invalid Stage-instance evidence",
    )
  }
  try {
    assertTopic(instance.topic)
  } catch (error) {
    throw new StageInstanceEvidenceError(
      "Discord returned an invalid Stage-instance topic",
      { cause: error },
    )
  }
  return {
    channelId,
    discoverableDisabled: instance.discoverableDisabled,
    guildId,
    id: instance.id,
    privacyLevel: instance.privacyLevel
      === DISCORD_STAGE_INSTANCE_PRIVACY_LEVELS.guildOnly
      ? "guild-only"
      : "public-deprecated",
    scheduledEventId: instance.scheduledEventId,
    topic: instance.topic,
    unknownFieldCount: instance.unknownFieldCount,
  }
}

function privacyProjection(): StageInstancePrivacyProjection {
  return {
    omittedFields: STAGE_INSTANCE_OMITTED_FIELDS,
    rawPayloadExposed: false,
    speakerIdentitiesExposed: false,
    topicPersisted: false,
  }
}

function permissionEvidence(
  state: {
    botId: string
    channel: DiscordChannel
    guildId: string
    guildOwnerId: string
    member: DiscordGuildMember
    roles: readonly DiscordRole[]
  },
  requiredPermissions: readonly DiscordPermissionName[],
): StageInstancePermissionEvidence {
  let evaluated
  try {
    evaluated = evaluateBotChannelPermissions({
      botId: state.botId,
      channel: state.channel,
      guildId: state.guildId,
      member: state.member,
      permissionChannel: state.channel,
      roles: state.roles,
    })
  } catch (error) {
    throw new StageInstanceEvidenceError(
      `Discord Stage-instance permission evidence is invalid: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  if (evaluated.confidence !== "complete") {
    throw new StageInstanceEvidenceError(
      "Discord Stage-instance permission evidence is incomplete",
    )
  }
  const guildOwner = state.guildOwnerId === state.botId
  const effective = BigInt(evaluated.effectivePermissions)
  const missingPermissions = evaluated.administrator || guildOwner
    ? []
    : requiredPermissions.filter((name) => (
        (effective & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
      ))
  if (missingPermissions.length > 0) {
    throw new StageInstanceEvidenceError(
      `Discord connector bot lacks Stage-instance permissions: ${missingPermissions.join(", ")}`,
    )
  }
  return {
    administrator: evaluated.administrator,
    appliedRoleIds: [...evaluated.appliedRoleIds],
    confidence: "complete",
    effectivePermissionNames: [...evaluated.effectivePermissionNames],
    effectivePermissions: evaluated.effectivePermissions,
    guildOwner,
    missingPermissions: [],
    requiredPermissions: [...requiredPermissions],
    unknownPermissionBits: evaluated.unknownPermissionBits,
    warnings: [...evaluated.warnings],
  }
}

function changePermissions(
  request: NormalizedStageInstanceChangeRequest,
): DiscordPermissionName[] {
  return [
    ...STAGE_CHANGE_PERMISSIONS,
    ...(request.action === "start" && request.sendStartNotification
      ? ["MENTION_EVERYONE" as const]
      : []),
  ]
}

async function getOptionalStageInstance(
  client: StageInstanceServiceClient,
  guildId: string,
  channelId: string,
  options: RequestOptions,
): Promise<ProjectedStageInstance | null> {
  try {
    return projectStageInstance(
      await client.getStageInstance(channelId, options),
      guildId,
      channelId,
    )
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404) return null
    throw error
  }
}

function assertWritableStageState(instance: ProjectedStageInstance | null): void {
  if (instance === null) return
  if (instance.unknownFieldCount !== 0) {
    throw new StageInstanceEvidenceError(
      "Discord returned unknown Stage-instance fields, so lifecycle writes are blocked",
    )
  }
  if (instance.privacyLevel !== "guild-only") {
    throw new StageInstanceEvidenceError(
      "Deprecated public Stage instances are read-only through this connector",
    )
  }
  if (instance.scheduledEventId !== null) {
    throw new StageInstanceEvidenceError(
      "Scheduled-event-linked Stage instances are read-only through this connector",
    )
  }
}

function channelView(channel: StageEvidenceState["channel"]) {
  return {
    guildId: channel.guild_id,
    id: channel.id,
    name: channel.name,
    type: "stage" as const,
  }
}

function guildView(guild: StageEvidenceState["guild"]) {
  return { id: guild.id, name: guild.name }
}

function channelSnapshot(channel: StageEvidenceState["channel"]) {
  return {
    guildId: channel.guild_id,
    id: channel.id,
    name: channel.name,
    parentId: channel.parent_id ?? null,
    permissionOverwrites: channel.permission_overwrites,
    type: channel.type,
  }
}

function roleSnapshot(
  roles: readonly DiscordRole[],
  appliedRoleIds: readonly string[],
  guildId: string,
) {
  const relevant = new Set([...appliedRoleIds, guildId])
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

function matchesDesiredStage(
  observed: ProjectedStageInstance | null,
  desired: PlannedStageInstance | null,
  expectedId: string | null,
): boolean {
  if (desired === null) return observed === null
  return observed !== null
    && (expectedId === null || observed.id === expectedId)
    && observed.channelId === desired.channelId
    && observed.guildId === desired.guildId
    && observed.privacyLevel === "guild-only"
    && observed.scheduledEventId === null
    && observed.topic === desired.topic
    && observed.unknownFieldCount === 0
}

function validateWriteResponse(
  response: DiscordStageInstanceSummary,
  desired: PlannedStageInstance,
  expectedId: string | null,
): ProjectedStageInstance {
  const projected = projectStageInstance(
    response,
    desired.guildId,
    desired.channelId,
  )
  assertWritableStageState(projected)
  if (
    (expectedId !== null && projected.id !== expectedId)
    || !matchesDesiredStage(projected, desired, expectedId)
  ) {
    throw new StageInstanceEvidenceError(
      "Discord returned a Stage-instance write response that differs from the exact request",
    )
  }
  return projected
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
    stageInstanceId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: StageInstancePlan
  request: NormalizedStageInstanceChangeRequest
  stageInstanceId?: string | null
  status: StageInstanceActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): StageInstanceActivity {
  return {
    action: options.request.action,
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "stage-instance-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    stageInstanceId: options.stageInstanceId ?? null,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: StageInstancePlan
  request: NormalizedStageInstanceChangeRequest
  stageInstanceId?: string | null
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "stage-instance-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.stageInstanceId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function executionBlocksChannel(error: unknown): boolean {
  if (
    !(error instanceof StageInstanceExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["completed-operation-record-failed", "uncertain"]
    .includes(String(error.result.status))
}

async function withChannelLock<T>(
  locks: StageLockState,
  channelId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => StageInstanceExecutionError,
): Promise<T> {
  const prior = locks.tails.get(channelId)
    ?? Promise.resolve(
      locks.uncertainChannels.has(channelId)
        ? "uncertain" as const
        : "settled" as const,
    )
  let release: (outcome: "settled" | "uncertain") => void = () => undefined
  const tail = new Promise<"settled" | "uncertain">((resolve) => {
    release = resolve
  })
  locks.tails.set(channelId, tail)
  let outcome: "settled" | "uncertain" = "settled"
  try {
    if (await prior === "uncertain" || locks.uncertainChannels.has(channelId)) {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksChannel(error)) {
      outcome = "uncertain"
      locks.uncertainChannels.add(channelId)
    }
    throw error
  } finally {
    release(outcome)
    if (locks.tails.get(channelId) === tail) {
      locks.tails.delete(channelId)
    }
  }
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results = new Array<U>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index] as T)
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      () => worker(),
    ),
  )
  return results
}

export class StageInstanceService {
  readonly #activityStore: ActivityStore
  readonly #client: StageInstanceServiceClient
  readonly #clock: () => Date
  readonly #limiter: InteractionLimiter
  readonly #locks: StageLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: StageInstanceServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#limiter = options.limiter
    this.#locks = stageLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #guildEvidence(
    botId: string,
    guildId: string,
    options: RequestOptions,
  ): Promise<StageGuildEvidenceState> {
    const [rawGuild, rawMember, rawRoles] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, botId)
    return {
      botMember,
      guild,
      roles: exactRoles(rawRoles, guildId, botMember),
    }
  }

  async #evidence(
    botId: string,
    channelId: string,
    expectedGuildId: string | null,
    mode: "audit" | "change",
    options: RequestOptions,
    request?: NormalizedStageInstanceChangeRequest,
    guildEvidenceCache?: StageGuildEvidenceCache,
  ): Promise<StageEvidenceState> {
    assertSnowflake(botId, "Discord connector bot ID")
    assertSnowflake(channelId, "Discord Stage-instance channel ID")
    if (expectedGuildId !== null) {
      assertSnowflake(expectedGuildId, "Discord Stage-instance guild ID")
    }
    if (mode === "change") {
      if (!request) {
        throw new TypeError("Discord Stage-instance change evidence requires a request")
      }
      this.#policy.assertStageInstanceChannelIdChangeAllowed(
        channelId,
        request.action === "start" && request.sendStartNotification,
      )
      const receipt = await this.#operationStore.get(
        "stage-instance-change",
        request.operationKeyHash,
      )
      if (receipt) {
        throw new StageInstanceOperationConflictError(receiptView(receipt))
      }
    } else {
      this.#policy.assertStageInstanceChannelIdAuditable(channelId)
    }

    const channel = exactChannel(
      await this.#client.getChannel(channelId, options),
      channelId,
      expectedGuildId,
    )
    const guildId = mode === "change"
      ? this.#policy.assertStageInstanceChangeAllowed(
          channel,
          request?.action === "start" && request.sendStartNotification,
        )
      : this.#policy.assertStageInstanceAuditable(channel)
    if (expectedGuildId !== null && guildId !== expectedGuildId) {
      throw new StageInstanceEvidenceError(
        "Discord Stage channel belongs to another guild",
      )
    }

    let guildEvidence = guildEvidenceCache?.get(guildId)
    if (!guildEvidence) {
      guildEvidence = this.#guildEvidence(botId, guildId, options)
      guildEvidenceCache?.set(guildId, guildEvidence)
    }
    const [shared, current] = await Promise.all([
      guildEvidence,
      getOptionalStageInstance(this.#client, guildId, channelId, options),
    ])
    exactOverwrites(
      channel.permission_overwrites,
      new Set(shared.roles.map((role) => role.id)),
    )
    const permission = permissionEvidence(
      {
        botId,
        channel,
        guildId,
        guildOwnerId: shared.guild.owner_id,
        member: shared.botMember,
        roles: shared.roles,
      },
      mode === "change" && request
        ? changePermissions(request)
        : STAGE_READ_PERMISSIONS,
    )
    return {
      botMember: shared.botMember,
      channel,
      current,
      guild: shared.guild,
      permission,
      roles: shared.roles,
    }
  }

  #lookupResult(state: StageEvidenceState): StageInstanceLookupResult {
    return {
      access: state.permission,
      channel: channelView(state.channel),
      guild: guildView(state.guild),
      instance: state.current,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: state.current === null ? "inactive" : "active",
    }
  }

  async get(
    botId: string,
    guildId: string,
    channelId: string,
    options: RequestOptions = {},
  ): Promise<StageInstanceLookupResult> {
    assertSnowflake(guildId, "Discord Stage-instance guild ID")
    return this.#lookupResult(await this.#evidence(
      botId,
      channelId,
      guildId,
      "audit",
      options,
    ))
  }

  async list(
    botId: string,
    options: RequestOptions = {},
  ): Promise<StageInstanceInventoryResult> {
    assertSnowflake(botId, "Discord connector bot ID")
    const channelIds = this.#policy.stageInstanceAuditChannelIds()
    const guildEvidenceCache: StageGuildEvidenceCache = new Map()
    const entries = await mapWithConcurrency(
      channelIds,
      STAGE_INVENTORY_CONCURRENCY,
      async (channelId) => this.#lookupResult(await this.#evidence(
        botId,
        channelId,
        null,
        "audit",
        options,
        undefined,
        guildEvidenceCache,
      )),
    )
    const active = entries.filter((entry) => entry.status === "active").length
    return {
      entries,
      page: {
        active,
        configured: channelIds.length,
        inactive: entries.length - active,
        returned: entries.length,
        safetyLimit: CONNECTOR_LIMITS.stageInstanceChannels,
      },
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedStageInstanceChangeRequest,
    options: RequestOptions,
  ): Promise<StageInstancePlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#evidence(
      botId,
      request.channelId,
      request.guildId,
      "change",
      options,
      request,
    )
    assertWritableStageState(state.current)

    let desired: PlannedStageInstance | null
    let effect: StageInstancePlan["effect"]
    if (request.action === "start") {
      if (state.current !== null) {
        if (request.sendStartNotification) {
          throw new StageInstanceEvidenceError(
            "An active Discord Stage cannot be restarted to send another notification",
          )
        }
        if (state.current.topic !== request.topic) {
          throw new StageInstanceEvidenceError(
            "An active Discord Stage must be updated rather than started again",
          )
        }
        desired = {
          channelId: request.channelId,
          guildId: request.guildId,
          id: state.current.id,
          privacyLevel: "guild-only",
          scheduledEventId: null,
          topic: request.topic,
        }
        effect = "none"
      } else {
        desired = {
          channelId: request.channelId,
          guildId: request.guildId,
          id: null,
          privacyLevel: "guild-only",
          scheduledEventId: null,
          topic: request.topic,
        }
        effect = "create"
      }
    } else if (request.action === "update") {
      if (state.current === null) {
        throw new StageInstanceEvidenceError(
          "An inactive Discord Stage cannot be updated",
        )
      }
      desired = {
        channelId: request.channelId,
        guildId: request.guildId,
        id: state.current.id,
        privacyLevel: "guild-only",
        scheduledEventId: null,
        topic: request.topic,
      }
      effect = state.current.topic === request.topic ? "none" : "update"
    } else {
      desired = null
      effect = state.current === null ? "none" : "delete"
    }

    const now = this.#clock()
    if (Number.isNaN(now.getTime())) {
      throw new StageInstanceEvidenceError(
        "Discord Stage-instance planning clock is invalid",
      )
    }
    const warnings = [
      ...(state.permission.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped Stage permissions"]
        : []),
      ...(request.action === "start" && request.sendStartNotification
        ? ["Starting this Stage requests Discord's guild-wide start notification and requires MENTION_EVERYONE"]
        : []),
      ...(request.action === "end" && state.current !== null
        ? ["Ending permanently closes the exact active Stage instance"]
        : []),
      "Discord can automatically close a Stage after no speakers remain",
      "Stage topics are untrusted Discord data and are never persisted by this workflow",
      "Stage-instance serialization is process-local; do not run connector processes with overlapping Stage-channel scope",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const requestSnapshot = { ...request }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      channel: channelSnapshot(state.channel),
      desired,
      existing: state.current,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      permission: state.permission,
      request: requestSnapshot,
      roles: roleSnapshot(
        state.roles,
        state.permission.appliedRoleIds,
        request.guildId,
      ),
      warnings,
    })
    return {
      action: request.action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      channel: channelView(state.channel),
      createdAt: now.toISOString(),
      desired,
      digest,
      effect,
      existing: state.current,
      guild: guildView(state.guild),
      operationKeyHash: request.operationKeyHash,
      permission: state.permission,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: effect === "none" ? "already-current" : "planned",
      warnings,
      writeRequired: effect !== "none",
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: StageInstanceChangeRequest,
    options: RequestOptions = {},
  ): Promise<StageInstancePlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeStageInstanceChangeRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: StageInstanceChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<StageInstanceResult> {
    const normalized = normalizeStageInstanceChangeRequest(request)
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord Stage-instance plan digest is invalid")
    }
    return withChannelLock(
      this.#locks,
      normalized.channelId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new StageInstanceExecutionError(
        "Discord Stage-instance change was blocked because a prior same-channel operation ended uncertainly",
        {
          action: normalized.action,
          channelId: normalized.channelId,
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
    request: NormalizedStageInstanceChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<StageInstanceResult> {
    let plan: StageInstancePlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof StageInstanceEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new StageInstancePlanChangedError(
          expectedDigest,
          STAGE_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new StageInstancePlanChangedError(expectedDigest, plan.digest)
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
        observed: plan.existing,
        stageInstanceId: plan.existing?.id ?? null,
        status: "already-current",
      }
    }

    if (request.action === "start" && request.sendStartNotification) {
      this.#limiter.reserve(request.channelId)
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
      throw new StageInstanceOperationConflictError(receiptView(reservation.receipt))
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
      throw new StageInstanceExecutionError(
        "Discord Stage-instance change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          stageInstanceId: null,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let mutationAttempted = false
    let observed: ProjectedStageInstance | null = null
    let stageInstanceId = plan.existing?.id ?? null
    try {
      if (request.action === "start") {
        mutationAttempted = true
        const response = await this.#client.createStageInstance(
          {
            channelId: request.channelId,
            sendStartNotification: request.sendStartNotification,
            topic: request.topic,
          },
          request.auditReason,
          options,
        )
        if (validSnowflake(response?.id)) stageInstanceId = response.id
        validateWriteResponse(response, plan.desired!, null)
        observed = await getOptionalStageInstance(
          this.#client,
          request.guildId,
          request.channelId,
          options,
        )
      } else if (request.action === "update") {
        mutationAttempted = true
        const response = await this.#client.modifyStageInstance(
          request.channelId,
          { topic: request.topic },
          request.auditReason,
          options,
        )
        validateWriteResponse(response, plan.desired!, stageInstanceId)
        observed = await getOptionalStageInstance(
          this.#client,
          request.guildId,
          request.channelId,
          options,
        )
      } else {
        mutationAttempted = true
        await this.#client.deleteStageInstance(
          request.channelId,
          request.auditReason,
          options,
        )
        observed = await getOptionalStageInstance(
          this.#client,
          request.guildId,
          request.channelId,
          options,
        )
      }
      assertWritableStageState(observed)
    } catch (error) {
      const confirmedRejected = mutationAttempted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
      const status = !mutationAttempted || confirmedRejected
        ? "failed" as const
        : "uncertain" as const
      const terminalStageInstanceId = status === "failed" ? null : stageInstanceId
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request,
          stageInstanceId: terminalStageInstanceId,
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
          stageInstanceId: terminalStageInstanceId,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new StageInstanceExecutionError(
        "Discord Stage-instance change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          stageInstanceId: terminalStageInstanceId,
          status,
        },
        { cause: error },
      )
    }

    if (stageInstanceId === null) {
      throw new StageInstanceExecutionError(
        "Discord Stage-instance change returned no exact resource identity",
        {
          ...baseResult,
          activityId,
          stageInstanceId: null,
          status: "uncertain",
        },
      )
    }
    const expectedObservedId = request.action === "end"
      ? null
      : stageInstanceId
    const matched = matchesDesiredStage(
      observed,
      plan.desired,
      expectedObservedId,
    )
    const verification = matched ? "match" as const : "drift" as const
    const status = matched
      ? "completed" as const
      : "completed-with-drift" as const
    const result: StageInstanceResult = {
      ...baseResult,
      activityId,
      observed,
      stageInstanceId,
      status,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        stageInstanceId,
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
          stageInstanceId,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new StageInstanceExecutionError(
        "Discord Stage-instance change completed but the operation receipt failed",
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
        stageInstanceId,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new StageInstanceExecutionError(
        "Discord Stage-instance change completed but the final activity record failed",
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
