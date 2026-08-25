import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  WebhookChangeActivity,
  WebhookChangeActivityStatus,
  WebhookCreationActivity,
  WebhookCreationActivityStatus,
  WebhookDeletionActivity,
  WebhookDeletionActivityStatus,
} from "./activity-log.js"
import {
  CHANNEL_TYPE_NAMES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type CreateWebhookInput,
  type DiscordClient,
  type DiscordWebhookSummary,
  type ModifyWebhookInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  WebhookChangeExecutionError,
  WebhookChangeOperationConflictError,
  WebhookChangePlanChangedError,
  WebhookCreationExecutionError,
  WebhookCreationOperationConflictError,
  WebhookCreationPlanChangedError,
  WebhookDeletionExecutionError,
  WebhookDeletionOperationConflictError,
  WebhookDeletionPlanChangedError,
  WebhookEvidenceError,
} from "./errors.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateBotChannelPermissions,
  type BotChannelPermissionResult,
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
  DiscordRole,
  RequestOptions,
} from "./types.js"
import type { WebhookCredentialStore } from "./webhook-credential-store.js"

export const WEBHOOK_TYPES = Object.freeze({
  application: 3,
  channelFollower: 2,
  incoming: 1,
})

export const WEBHOOK_OMITTED_FIELDS = Object.freeze([
  "avatar",
  "sourceChannel",
  "sourceGuild",
  "token",
  "unknownRawFields",
  "url",
  "userProfile",
] as const)

export type WebhookType = "application" | "channel-follower" | "incoming"

const DISCORD_EPOCH_MS = 1_420_070_400_000n
const STATE_UNAVAILABLE = "webhook-state-unavailable"
const REQUIRED_PERMISSIONS = ["MANAGE_WEBHOOKS", "VIEW_CHANNEL"] as const
const WEBHOOK_FORBIDDEN_NAME_PATTERN = /(?:clyde|discord)/iu
const WEBHOOK_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const WEBHOOK_REPEATED_WHITESPACE_PATTERN = /\s{2,}/u
const WEBHOOK_TYPE_NAMES: Readonly<Record<number, WebhookType>> = Object.freeze({
  [WEBHOOK_TYPES.application]: "application",
  [WEBHOOK_TYPES.channelFollower]: "channel-follower",
  [WEBHOOK_TYPES.incoming]: "incoming",
})
type WebhookTargetOutcome = "settled" | "uncertain"
const WEBHOOK_TARGET_LOCKS = new Map<string, Promise<WebhookTargetOutcome>>()

export interface WebhookDeletionRequest {
  auditReason: string
  channelId: string
  operationKey: string
  webhookId: string
}

export interface WebhookCreationRequest {
  auditReason: string
  channelId: string
  name: string
  operationKey: string
}

export interface NormalizedWebhookCreationRequest extends WebhookCreationRequest {
  operationKeyHash: string
}

export interface WebhookChangeRequest {
  auditReason: string
  channelId: string
  destinationChannelId?: string
  name?: string
  operationKey: string
  webhookId: string
}

export interface NormalizedWebhookChangeRequest extends WebhookChangeRequest {
  operationKeyHash: string
  requestedFields: WebhookChangeField[]
}

export const WEBHOOK_CHANGE_FIELDS = ["channelId", "name"] as const
export type WebhookChangeField = typeof WEBHOOK_CHANGE_FIELDS[number]

export interface NormalizedWebhookDeletionRequest extends WebhookDeletionRequest {
  operationKeyHash: string
}

export interface ProjectedWebhook {
  applicationId: string | null
  channelId: string
  createdAt: string
  creatorUserId: string | null
  guildId: string
  name: string | null
  type: WebhookType
  webhookId: string
}

export interface WebhookPrivacyProjection {
  credentialsProjectedOut: true
  omittedFields: typeof WEBHOOK_OMITTED_FIELDS
}

export interface WebhookPermissionEvidence {
  administrator: boolean
  confidence: "complete"
  effectivePermissions: string
  manageWebhooks: true
  permissionSourceChannelId: string
  viewChannel: true
}

export interface WebhookChannelProjection {
  guildId: string
  id: string
  name: string
  parentId: string | null
  type: number
  typeName: string
}

export interface WebhookInventoryResult {
  channel: WebhookChannelProjection
  guild: {
    id: string
    name: string
  }
  page: {
    returned: number
    safetyLimit: number
  }
  permission: WebhookPermissionEvidence
  privacy: WebhookPrivacyProjection
  schemaVersion: number
  status: "ok"
  webhooks: ProjectedWebhook[]
}

export interface WebhookLookupResult extends Omit<
  WebhookInventoryResult,
  "page" | "webhooks"
> {
  webhook: ProjectedWebhook
}

export interface WebhookDeletionPlan {
  action: "delete"
  applicationId: string
  auditReason: string
  botId: string
  channel: WebhookChannelProjection
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  permission: WebhookPermissionEvidence
  privacy: WebhookPrivacyProjection
  schemaVersion: number
  status: "planned"
  target: ProjectedWebhook
  warnings: string[]
}

export interface WebhookDeletionResult {
  activityId: string
  channelId: string
  credentialCleanup: "failed" | "not-attempted" | "not-configured" | "not-present" | "removed"
  guildId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  verifiedAbsent: boolean
  webhookId: string
}

export interface WebhookAdministrationEndpoint {
  channel: WebhookChannelProjection
  inventory: {
    returned: number
    safetyLimit: number
  }
  permission: WebhookPermissionEvidence
  webhooks: ProjectedWebhook[]
}

export interface WebhookCreationPlan {
  action: "create"
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  desired: {
    channelId: string
    name: string
    type: "incoming"
  }
  digest: string
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  privacy: WebhookPrivacyProjection
  risks: string[]
  schemaVersion: number
  source: WebhookAdministrationEndpoint
  status: "planned"
  warnings: string[]
}

export interface WebhookCreationResult {
  activityId: string
  channelId: string
  credentialStored: true
  created: ProjectedWebhook
  guildId: string
  inventoryMatched: boolean
  observed: ProjectedWebhook | null
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: true
  schemaVersion: number
  status: "completed" | "completed-with-drift"
}

export interface WebhookChangePlan {
  action: "update"
  applicationId: string
  auditReason: string
  botId: string
  changedFields: WebhookChangeField[]
  createdAt: string
  current: ProjectedWebhook
  desired: ProjectedWebhook
  destination: WebhookAdministrationEndpoint | null
  digest: string
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  privacy: WebhookPrivacyProjection
  requestedFields: WebhookChangeField[]
  risks: string[]
  schemaVersion: number
  source: WebhookAdministrationEndpoint
  status: "already-current" | "planned"
  warnings: string[]
  writeRequired: boolean
}

export interface WebhookChangeResult {
  activityId: string | null
  channelId: string
  destinationChannelId: string
  guildId: string
  inventoryMatched: boolean
  observed: ProjectedWebhook | null
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: boolean
  schemaVersion: number
  sourceTargetAbsent: boolean
  status: "already-current" | "completed" | "completed-with-drift"
  webhookId: string
}

export interface WebhookServiceClient extends Pick<
  DiscordClient,
  | "createWebhook"
  | "deleteWebhook"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "listChannelWebhooks"
  | "modifyWebhook"
> {}

export interface WebhookServiceOptions {
  activityStore: ActivityStore
  client: WebhookServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
  credentialStore?: Pick<WebhookCredentialStore, "remove" | "write">
}

interface WebhookStateEvidence {
  botMember: DiscordGuildMember
  channel: DiscordChannel
  guild: DiscordGuild
  guildId: string
  permissions: BotChannelPermissionResult & { confidence: "complete" }
  roles: DiscordRole[]
  webhooks: ProjectedWebhook[]
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

export function normalizeWebhookDeletionRequest(
  request: WebhookDeletionRequest,
): NormalizedWebhookDeletionRequest {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord webhook deletion request must be an object")
  }
  assertSnowflake(request.channelId, "Discord webhook channel ID")
  assertSnowflake(request.webhookId, "Discord webhook ID")
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord webhook deletion audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    channelId: request.channelId,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    webhookId: request.webhookId,
  }
}

export function normalizeWebhookName(value: unknown): string {
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > DISCORD_LIMITS.webhookNameCharacters
    || value !== value.trim()
    || WEBHOOK_REPEATED_WHITESPACE_PATTERN.test(value)
    || WEBHOOK_NAME_CONTROL_PATTERN.test(value)
    || WEBHOOK_FORBIDDEN_NAME_PATTERN.test(value)
  ) {
    throw new RangeError("Discord webhook name is invalid")
  }
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError("Discord webhook name must contain valid Unicode", {
      cause: error,
    })
  }
  return value
}

export function normalizeWebhookCreationRequest(
  request: WebhookCreationRequest,
): NormalizedWebhookCreationRequest {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord webhook creation request must be an object")
  }
  assertSnowflake(request.channelId, "Discord webhook channel ID")
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord webhook creation audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    channelId: request.channelId,
    name: normalizeWebhookName(request.name),
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

export function normalizeWebhookChangeRequest(
  request: WebhookChangeRequest,
): NormalizedWebhookChangeRequest {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord webhook change request must be an object")
  }
  assertSnowflake(request.channelId, "Discord webhook source channel ID")
  assertSnowflake(request.webhookId, "Discord webhook ID")
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord webhook change audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  let name: string | undefined
  if (request.name !== undefined) {
    name = normalizeWebhookName(request.name)
  }
  let destinationChannelId: string | undefined
  if (request.destinationChannelId !== undefined) {
    assertSnowflake(
      request.destinationChannelId,
      "Discord webhook destination channel ID",
    )
    destinationChannelId = request.destinationChannelId
  }
  const requestedFields = WEBHOOK_CHANGE_FIELDS.filter((field) => (
    field === "channelId"
      ? destinationChannelId !== undefined
      : name !== undefined
  ))
  if (requestedFields.length === 0) {
    throw new RangeError(
      "Discord webhook change requires a name or destination channel ID",
    )
  }
  return {
    auditReason: request.auditReason,
    channelId: request.channelId,
    ...(destinationChannelId !== undefined ? { destinationChannelId } : {}),
    ...(name !== undefined ? { name } : {}),
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    requestedFields,
    webhookId: request.webhookId,
  }
}

function exactChannel(channel: DiscordChannel, channelId: string): DiscordChannel {
  if (
    !channel
    || typeof channel !== "object"
    || Array.isArray(channel)
    || channel.id !== channelId
    || !Number.isSafeInteger(channel.type)
    || typeof channel.guild_id !== "string"
    || typeof channel.name !== "string"
    || channel.name.length < 1
    || channel.name.length > DISCORD_LIMITS.channelNameCharacters
    || /[\u0000-\u001F\u007F]/u.test(channel.name)
    || (
      channel.parent_id !== undefined
      && channel.parent_id !== null
      && typeof channel.parent_id !== "string"
    )
    || (
      channel.permission_overwrites !== undefined
      && (
        !Array.isArray(channel.permission_overwrites)
        || channel.permission_overwrites.length
          > DISCORD_LIMITS.channelPermissionOverwrites
      )
    )
  ) {
    throw new WebhookEvidenceError("Discord returned invalid webhook channel evidence")
  }
  assertSnowflakeEvidence(channel.guild_id, "webhook channel guild ID")
  if (channel.parent_id !== undefined && channel.parent_id !== null) {
    assertSnowflakeEvidence(channel.parent_id, "webhook channel parent ID")
  }
  assertValidUnicodeEvidence(channel.name, "webhook channel name")
  return channel
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || guild.name.length > DISCORD_LIMITS.channelNameCharacters
    || /[\u0000-\u001F\u007F]/u.test(guild.name)
  ) {
    throw new WebhookEvidenceError("Discord returned invalid webhook guild evidence")
  }
  assertValidUnicodeEvidence(guild.name, "webhook guild name")
  return guild
}

function exactBotMember(
  member: DiscordGuildMember,
  botId: string,
): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(member.roles).size !== member.roles.length
    || member.roles.some((roleId) => !validSnowflake(roleId))
    || !member.user
    || member.user.id !== botId
    || member.user.bot !== true
  ) {
    throw new WebhookEvidenceError("Discord returned invalid webhook bot-member evidence")
  }
  return member
}

function webhookCreatedAt(webhookId: string): string {
  const milliseconds = (BigInt(webhookId) >> 22n) + DISCORD_EPOCH_MS
  const createdAt = new Date(Number(milliseconds))
  if (Number.isNaN(createdAt.getTime())) {
    throw new WebhookEvidenceError("Discord returned an invalid webhook creation identity")
  }
  return createdAt.toISOString()
}

function projectedWebhook(
  webhook: DiscordWebhookSummary,
  channelId: string,
  guildId: string,
): ProjectedWebhook {
  if (!webhook || typeof webhook !== "object") {
    throw new WebhookEvidenceError("Discord returned an invalid webhook inventory item")
  }
  assertSnowflakeEvidence(webhook.id, "webhook ID")
  if (webhook.channelId !== channelId || webhook.guildId !== guildId) {
    throw new WebhookEvidenceError("Discord returned webhook inventory outside the requested channel")
  }
  if (webhook.applicationId !== null) {
    assertSnowflakeEvidence(webhook.applicationId, "webhook application ID")
  }
  if (webhook.creatorUserId !== null) {
    assertSnowflakeEvidence(webhook.creatorUserId, "webhook creator ID")
  }
  if (
    webhook.name !== null
    && (
      typeof webhook.name !== "string"
      || [...webhook.name].length < 1
      || [...webhook.name].length > DISCORD_LIMITS.webhookNameCharacters
      || /[\u0000-\u001F\u007F]/u.test(webhook.name)
    )
  ) {
    throw new WebhookEvidenceError("Discord returned an invalid webhook name")
  }
  if (webhook.name !== null) {
    assertValidUnicodeEvidence(webhook.name, "webhook name")
  }
  const type = WEBHOOK_TYPE_NAMES[webhook.type]
  if (!type) {
    throw new WebhookEvidenceError("Discord returned an unsupported webhook type")
  }
  return {
    applicationId: webhook.applicationId,
    channelId,
    createdAt: webhookCreatedAt(webhook.id),
    creatorUserId: webhook.creatorUserId,
    guildId,
    name: webhook.name,
    type,
    webhookId: webhook.id,
  }
}

function assertSnowflakeEvidence(value: unknown, description: string): asserts value is string {
  try {
    assertSnowflake(value, `Discord ${description}`)
  } catch (error) {
    throw new WebhookEvidenceError(`Discord returned an invalid ${description}`, {
      cause: error,
    })
  }
}

function assertValidUnicodeEvidence(value: string, description: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new WebhookEvidenceError(`Discord returned an invalid ${description}`, {
      cause: error,
    })
  }
}

function projectChannel(
  channel: DiscordChannel,
  guildId: string,
): WebhookChannelProjection {
  const typeName = CHANNEL_TYPE_NAMES[
    channel.type as keyof typeof CHANNEL_TYPE_NAMES
  ]
  if (!typeName || channel.guild_id !== guildId || typeof channel.name !== "string") {
    throw new WebhookEvidenceError("Discord returned invalid webhook channel evidence")
  }
  return {
    guildId,
    id: channel.id,
    name: channel.name,
    parentId: channel.parent_id ?? null,
    type: channel.type,
    typeName,
  }
}

function exactWebhookInventory(
  inventory: readonly DiscordWebhookSummary[],
  channelId: string,
  guildId: string,
): ProjectedWebhook[] {
  if (
    !Array.isArray(inventory)
    || inventory.length > DISCORD_LIMITS.webhooksPerChannel
  ) {
    throw new WebhookEvidenceError("Discord returned an invalid channel webhook inventory")
  }
  const seen = new Set<string>()
  const projected = inventory.map((webhook) => {
    const normalized = projectedWebhook(webhook, channelId, guildId)
    if (seen.has(normalized.webhookId)) {
      throw new WebhookEvidenceError("Discord returned duplicate webhooks in one channel inventory")
    }
    seen.add(normalized.webhookId)
    return normalized
  })
  return projected.sort((left, right) => {
    const leftId = BigInt(left.webhookId)
    const rightId = BigInt(right.webhookId)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

function privacyProjection(): WebhookPrivacyProjection {
  return {
    credentialsProjectedOut: true,
    omittedFields: WEBHOOK_OMITTED_FIELDS,
  }
}

function relevantRoleSnapshot(
  roles: readonly DiscordRole[],
  roleIds: readonly string[],
) {
  const relevant = new Set(roleIds)
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

function overwriteSnapshot(channel: DiscordChannel) {
  return (channel.permission_overwrites || [])
    .map((overwrite) => ({
      allow: overwrite.allow ?? "0",
      deny: overwrite.deny ?? "0",
      id: overwrite.id,
      type: overwrite.type,
    }))
    .sort((left, right) => (
      left.id.localeCompare(right.id) || left.type - right.type
    ))
}

function hasPermission(
  result: BotChannelPermissionResult,
  permission: typeof REQUIRED_PERMISSIONS[number],
): boolean {
  return result.effectivePermissionNames.includes(permission)
}

function permissionEvidence(
  permissions: BotChannelPermissionResult & { confidence: "complete" },
): WebhookPermissionEvidence {
  return {
    administrator: permissions.administrator,
    confidence: "complete",
    effectivePermissions: permissions.effectivePermissions,
    manageWebhooks: true,
    permissionSourceChannelId: permissions.permissionSourceChannelId,
    viewChannel: true,
  }
}

function administrationEndpoint(
  state: WebhookStateEvidence,
): WebhookAdministrationEndpoint {
  return {
    channel: projectChannel(state.channel, state.guildId),
    inventory: {
      returned: state.webhooks.length,
      safetyLimit: DISCORD_LIMITS.webhooksPerChannel,
    },
    permission: permissionEvidence(state.permissions),
    webhooks: state.webhooks,
  }
}

function stateDigestSnapshot(state: WebhookStateEvidence) {
  return {
    botMember: {
      roles: [...state.botMember.roles].sort(),
      userId: state.botMember.user?.id ?? null,
    },
    channel: {
      guildId: state.guildId,
      id: state.channel.id,
      name: state.channel.name,
      overwrites: overwriteSnapshot(state.channel),
      parentId: state.channel.parent_id ?? null,
      type: state.channel.type,
    },
    guild: {
      id: state.guildId,
      name: state.guild.name,
    },
    permissions: state.permissions.effectivePermissions,
    roles: relevantRoleSnapshot(state.roles, state.permissions.appliedRoleIds),
    webhooks: state.webhooks,
  }
}

function sameWebhookInventory(
  left: readonly ProjectedWebhook[],
  right: readonly ProjectedWebhook[],
): boolean {
  return stableString(left) === stableString(right)
}

function sortedWebhookInventory(
  inventory: readonly ProjectedWebhook[],
): ProjectedWebhook[] {
  return [...inventory].sort((left, right) => {
    const leftId = BigInt(left.webhookId)
    const rightId = BigInt(right.webhookId)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
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
    webhookId: receipt.resourceId,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: WebhookDeletionPlan
  request: NormalizedWebhookDeletionRequest
  status: WebhookDeletionActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): WebhookDeletionActivity {
  return {
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "webhook-deletion",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
    webhookId: options.request.webhookId,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: WebhookDeletionPlan
  request: NormalizedWebhookDeletionRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "webhook-deletion",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.webhookId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function creationActivityEntry(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: WebhookCreationPlan
  request: NormalizedWebhookCreationRequest
  status: WebhookCreationActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
  webhookId?: string | null
}): WebhookCreationActivity {
  return {
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "webhook-creation",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
    webhookId: options.webhookId ?? null,
  }
}

function creationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: WebhookCreationPlan
  request: NormalizedWebhookCreationRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
  webhookId?: string | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "webhook-creation",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" || options.status === "uncertain"
      ? options.webhookId ?? null
      : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function changeActivityEntry(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: WebhookChangePlan
  request: NormalizedWebhookChangeRequest
  status: WebhookChangeActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): WebhookChangeActivity {
  return {
    channelId: options.request.channelId,
    destinationChannelId: options.request.destinationChannelId ?? null,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "webhook-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
    webhookId: options.request.webhookId,
  }
}

function changeReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: WebhookChangePlan
  request: NormalizedWebhookChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "webhook-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.request.webhookId,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(
      error instanceof WebhookChangeExecutionError
      || error instanceof WebhookCreationExecutionError
      || error instanceof WebhookDeletionExecutionError
    )
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withTargetLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => Error,
): Promise<T> {
  const prior = WEBHOOK_TARGET_LOCKS.get(key)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: WebhookTargetOutcome) => void = () => undefined
  const tail = new Promise<WebhookTargetOutcome>((resolve) => {
    release = resolve
  })
  WEBHOOK_TARGET_LOCKS.set(key, tail)
  let outcome: WebhookTargetOutcome = "settled"
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
    if (WEBHOOK_TARGET_LOCKS.get(key) === tail) {
      WEBHOOK_TARGET_LOCKS.delete(key)
    }
  }
}

export class WebhookService {
  readonly #activityStore: ActivityStore
  readonly #client: WebhookServiceClient
  readonly #clock: () => Date
  readonly #credentialStore: Pick<WebhookCredentialStore, "remove" | "write"> | undefined
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: WebhookServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#credentialStore = options.credentialStore
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    botId: string,
    channelId: string,
    mode: "audit" | "delete",
    options: RequestOptions,
    operationKeyHash?: string,
  ): Promise<WebhookStateEvidence> {
    assertSnowflake(botId, "Discord connector bot ID")
    assertSnowflake(channelId, "Discord webhook channel ID")
    if (mode === "delete") {
      this.#policy.assertChannelWebhookIdDeletable(channelId)
    } else {
      this.#policy.assertChannelWebhookIdAuditable(channelId)
    }
    const channel = exactChannel(
      await this.#client.getChannel(channelId, options),
      channelId,
    )
    const guildId = mode === "delete"
      ? this.#policy.assertChannelWebhookDeletable(channel)
      : this.#policy.assertChannelWebhookAuditable(channel)
    if (operationKeyHash) {
      const existingReceipt = await this.#operationStore.get(
        "webhook-deletion",
        operationKeyHash,
      )
      if (existingReceipt) {
        throw new WebhookDeletionOperationConflictError(receiptView(existingReceipt))
      }
    }
    const [guild, botMember, roles, inventory] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.listChannelWebhooks(channelId, options),
    ])
    exactGuild(guild, guildId)
    exactBotMember(botMember, botId)
    if (!Array.isArray(roles) || roles.length > DISCORD_LIMITS.guildRoles) {
      throw new WebhookEvidenceError("Discord returned an invalid webhook role inventory")
    }
    const webhooks = exactWebhookInventory(inventory, channelId, guildId)
    let permissions: BotChannelPermissionResult
    try {
      permissions = evaluateBotChannelPermissions({
        botId,
        channel,
        guildId,
        member: botMember,
        permissionChannel: channel,
        roles,
      })
    } catch (error) {
      throw new WebhookEvidenceError(
        "Discord connector bot webhook permission evidence is invalid",
        { cause: error },
      )
    }
    if (permissions.confidence !== "complete") {
      throw new WebhookEvidenceError(
        "Discord connector bot webhook permission evidence is incomplete",
      )
    }
    for (const permission of REQUIRED_PERMISSIONS) {
      if (!hasPermission(permissions, permission)) {
        throw new WebhookEvidenceError(
          `Discord connector bot lacks channel-level ${permission}`,
        )
      }
    }
    return {
      botMember,
      channel,
      guild,
      guildId,
      permissions: permissions as BotChannelPermissionResult & { confidence: "complete" },
      roles,
      webhooks,
    }
  }

  async list(
    botId: string,
    channelId: string,
    options: RequestOptions = {},
  ): Promise<WebhookInventoryResult> {
    const state = await this.#state(botId, channelId, "audit", options)
    return {
      channel: projectChannel(state.channel, state.guildId),
      guild: {
        id: state.guildId,
        name: state.guild.name,
      },
      page: {
        returned: state.webhooks.length,
        safetyLimit: DISCORD_LIMITS.webhooksPerChannel,
      },
      permission: permissionEvidence(state.permissions),
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      webhooks: state.webhooks,
    }
  }

  async get(
    botId: string,
    channelId: string,
    webhookId: string,
    options: RequestOptions = {},
  ): Promise<WebhookLookupResult> {
    assertSnowflake(webhookId, "Discord webhook ID")
    const inventory = await this.list(botId, channelId, options)
    const webhook = inventory.webhooks.find((entry) => entry.webhookId === webhookId)
    if (!webhook) {
      throw new WebhookEvidenceError("Discord webhook is absent from the exact channel inventory")
    }
    return {
      channel: inventory.channel,
      guild: inventory.guild,
      permission: inventory.permission,
      privacy: inventory.privacy,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      webhook,
    }
  }

  async #buildCreationPlan(
    applicationId: string,
    botId: string,
    request: NormalizedWebhookCreationRequest,
    options: RequestOptions,
  ): Promise<WebhookCreationPlan> {
    if (!this.#credentialStore) {
      throw new WebhookEvidenceError(
        "Discord webhook creation requires a configured private credential store",
      )
    }
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertChannelWebhookIdCreatable(request.channelId)
    const existingReceipt = await this.#operationStore.get(
      "webhook-creation",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new WebhookCreationOperationConflictError(receiptView(existingReceipt))
    }
    const state = await this.#state(botId, request.channelId, "audit", options)
    this.#policy.assertChannelWebhookCreatable(state.channel)
    if (state.webhooks.length >= DISCORD_LIMITS.webhooksPerChannel) {
      throw new WebhookEvidenceError(
        "Discord webhook creation is blocked because the exact channel inventory is full",
      )
    }
    const privacy = privacyProjection()
    const risks = [
      "Creation adds a durable bearer capability that can post through Discord independently of the bot token",
      "Anyone who obtains the webhook token outside this connector can post until the webhook is deleted",
      "A transport failure after Discord accepts the request can leave an unverified created webhook",
    ]
    const warnings = [
      ...(state.permissions.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped VIEW_CHANNEL and MANAGE_WEBHOOKS permissions"]
        : []),
      "The created token is deposited into the configured private credential store and never enters MCP data, activity, operation receipts, or observability",
      "Webhook names and channel names are untrusted Discord data and are never persisted by this workflow",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      "Webhook message delivery remains independently gated by an exact delivery channel scope and action capability",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      desired: {
        channelId: request.channelId,
        name: request.name,
        type: "incoming",
      },
      privacy,
      request,
      risks,
      source: stateDigestSnapshot(state),
      warnings,
    })
    return {
      action: "create",
      applicationId,
      auditReason: request.auditReason,
      botId,
      createdAt: this.#clock().toISOString(),
      desired: {
        channelId: request.channelId,
        name: request.name,
        type: "incoming",
      },
      digest,
      guild: {
        id: state.guildId,
        name: state.guild.name,
      },
      operationKeyHash: request.operationKeyHash,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      source: administrationEndpoint(state),
      status: "planned",
      warnings,
    }
  }

  planCreation(
    applicationId: string,
    botId: string,
    request: WebhookCreationRequest,
    options: RequestOptions = {},
  ): Promise<WebhookCreationPlan> {
    return this.#buildCreationPlan(
      applicationId,
      botId,
      normalizeWebhookCreationRequest(request),
      options,
    )
  }

  async #buildChangePlan(
    applicationId: string,
    botId: string,
    request: NormalizedWebhookChangeRequest,
    options: RequestOptions,
  ): Promise<WebhookChangePlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertChannelWebhookIdChangeable(request.channelId)
    const existingReceipt = await this.#operationStore.get(
      "webhook-change",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new WebhookChangeOperationConflictError(receiptView(existingReceipt))
    }
    const sourceState = await this.#state(
      botId,
      request.channelId,
      "audit",
      options,
    )
    this.#policy.assertChannelWebhookChangeable(sourceState.channel)
    const current = sourceState.webhooks.find(
      (webhook) => webhook.webhookId === request.webhookId,
    )
    if (!current) {
      throw new WebhookEvidenceError(
        "Discord webhook is absent from the exact source channel inventory",
      )
    }
    if (current.type !== "incoming") {
      throw new WebhookEvidenceError(
        "Discord webhook changes are limited to Incoming webhooks",
      )
    }
    const destinationChannelId = request.destinationChannelId
      ?? request.channelId
    let destinationState = sourceState
    if (destinationChannelId !== request.channelId) {
      this.#policy.assertChannelWebhookIdChangeable(destinationChannelId)
      destinationState = await this.#state(
        botId,
        destinationChannelId,
        "audit",
        options,
      )
      this.#policy.assertChannelWebhookChangeable(destinationState.channel)
      if (destinationState.guildId !== sourceState.guildId) {
        throw new WebhookEvidenceError(
          "Discord webhook moves must stay within the exact source guild",
        )
      }
      if (destinationState.webhooks.some(
        (webhook) => webhook.webhookId === request.webhookId,
      )) {
        throw new WebhookEvidenceError(
          "Discord returned the same webhook in both source and destination inventories",
        )
      }
      if (destinationState.webhooks.length >= DISCORD_LIMITS.webhooksPerChannel) {
        throw new WebhookEvidenceError(
          "Discord webhook move is blocked because the destination inventory is full",
        )
      }
    }
    const desired: ProjectedWebhook = {
      ...current,
      channelId: destinationChannelId,
      name: request.name ?? current.name,
    }
    const changedFields = WEBHOOK_CHANGE_FIELDS.filter((field) => (
      field === "channelId"
        ? desired.channelId !== current.channelId
        : desired.name !== current.name
    ))
    const privacy = privacyProjection()
    const risks = [
      ...(changedFields.includes("channelId")
        ? [
            "Moving a webhook redirects future deliveries made with its existing token to the destination channel",
            "External systems can continue using the same bearer credential after the move",
          ]
        : []),
      "Another administrator can change or delete the webhook during the final non-atomic inventory-to-mutation window",
    ]
    const warnings = [
      ...(sourceState.permissions.administrator || destinationState.permissions.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped VIEW_CHANNEL and MANAGE_WEBHOOKS permissions"]
        : []),
      "Webhook tokens, execution URLs, avatars, creator profiles, source objects, and raw payloads are omitted from MCP data, activity, operation receipts, and observability; any private credential file remains unchanged",
      "Guild, channel, and webhook names are untrusted Discord data and are never persisted by this workflow",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      desired,
      destination: destinationChannelId === request.channelId
        ? null
        : stateDigestSnapshot(destinationState),
      privacy,
      request,
      risks,
      source: stateDigestSnapshot(sourceState),
      warnings,
    })
    return {
      action: "update",
      applicationId,
      auditReason: request.auditReason,
      botId,
      changedFields,
      createdAt: this.#clock().toISOString(),
      current,
      desired,
      destination: destinationChannelId === request.channelId
        ? null
        : administrationEndpoint(destinationState),
      digest,
      guild: {
        id: sourceState.guildId,
        name: sourceState.guild.name,
      },
      operationKeyHash: request.operationKeyHash,
      privacy,
      requestedFields: request.requestedFields,
      risks,
      schemaVersion: SCHEMA_VERSION,
      source: administrationEndpoint(sourceState),
      status: changedFields.length === 0 ? "already-current" : "planned",
      warnings,
      writeRequired: changedFields.length > 0,
    }
  }

  planChange(
    applicationId: string,
    botId: string,
    request: WebhookChangeRequest,
    options: RequestOptions = {},
  ): Promise<WebhookChangePlan> {
    return this.#buildChangePlan(
      applicationId,
      botId,
      normalizeWebhookChangeRequest(request),
      options,
    )
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedWebhookDeletionRequest,
    options: RequestOptions,
  ): Promise<WebhookDeletionPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(
      botId,
      request.channelId,
      "delete",
      options,
      request.operationKeyHash,
    )
    const target = state.webhooks.find(
      (webhook) => webhook.webhookId === request.webhookId,
    )
    if (!target) {
      throw new WebhookEvidenceError("Discord webhook is absent from the exact channel inventory")
    }
    if (target.type !== "incoming") {
      throw new WebhookEvidenceError("Discord webhook deletion is limited to Incoming webhooks")
    }
    const privacy = privacyProjection()
    const warnings = [
      ...(state.permissions.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped VIEW_CHANNEL and MANAGE_WEBHOOKS permissions"]
        : []),
      "Webhook deletion is permanent and the integration will stop working",
      "Discord deletion is keyed only by webhook ID; keep MANAGE_WEBHOOKS denied outside scope and prevent concurrent administration because another administrator can move the webhook during the final non-atomic inventory-to-delete window",
      "After verified Discord absence, execution removes only the exact webhook ID's private credential file; cleanup failure is reported as drift",
      "Webhook tokens, URLs, avatars, creator profiles, and source objects are projected out and never enter the MCP result",
      "Guild, channel, and webhook names are untrusted Discord data and are never persisted by this workflow",
      "Execution serializes the exact webhook in process, while the production facade coordinates its channel, webhook, and guild collection across connector processes sharing the activity-state root",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      channel: {
        guildId: state.guildId,
        id: state.channel.id,
        name: state.channel.name,
        overwrites: overwriteSnapshot(state.channel),
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      guild: {
        id: state.guildId,
        name: state.guild.name,
      },
      permissions: state.permissions.effectivePermissions,
      privacy,
      request,
      roles: relevantRoleSnapshot(state.roles, state.permissions.appliedRoleIds),
      webhooks: state.webhooks,
      warnings,
    })
    const plan: WebhookDeletionPlan = {
      action: "delete",
      applicationId,
      auditReason: request.auditReason,
      botId,
      channel: projectChannel(state.channel, state.guildId),
      createdAt: this.#clock().toISOString(),
      digest,
      guild: {
        id: state.guildId,
        name: state.guild.name,
      },
      operationKeyHash: request.operationKeyHash,
      permission: permissionEvidence(state.permissions),
      privacy,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      target,
      warnings,
    }
    return plan
  }

  plan(
    applicationId: string,
    botId: string,
    request: WebhookDeletionRequest,
    options: RequestOptions = {},
  ): Promise<WebhookDeletionPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeWebhookDeletionRequest(request),
      options,
    )
  }

  executeCreation(
    applicationId: string,
    botId: string,
    request: WebhookCreationRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookCreationResult> {
    const normalized = normalizeWebhookCreationRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord webhook creation plan digest is invalid")
    }
    return withTargetLock(
      `channel:${normalized.channelId}`,
      () => this.#executeCreationNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new WebhookCreationExecutionError(
        "Discord webhook creation was blocked because a prior same-channel operation ended with an uncertain outcome",
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

  async #executeCreationNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedWebhookCreationRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<WebhookCreationResult> {
    let plan: WebhookCreationPlan
    try {
      plan = await this.#buildCreationPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof WebhookEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new WebhookCreationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new WebhookCreationPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: plan.guild.id,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(creationReceipt({
      activityId,
      guildId: plan.guild.id,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new WebhookCreationOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(creationActivityEntry({
        activityId,
        guildId: plan.guild.id,
        plan,
        request,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(creationReceipt({
          activityId,
          error: safeErrorCode(error),
          guildId: plan.guild.id,
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new WebhookCreationExecutionError(
        "Discord webhook creation was blocked because pending activity could not be recorded",
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

    let created: ProjectedWebhook | null = null
    let credentialStored = false
    let inventoryMatched: boolean | null = null
    let observed: ProjectedWebhook | null = null
    let readbackMatched: boolean | null = null
    try {
      const input: CreateWebhookInput = { name: request.name }
      if (!this.#credentialStore) {
        throw new WebhookEvidenceError(
          "Discord webhook creation requires a configured private credential store",
        )
      }
      const response = await this.#client.createWebhook(
        request.channelId,
        input,
        async (webhook, token) => {
          created = projectedWebhook(webhook, request.channelId, plan.guild.id)
          await this.#credentialStore?.write(webhook.id, token)
          credentialStored = true
        },
        request.auditReason,
        options,
      )
      created ??= projectedWebhook(response, request.channelId, plan.guild.id)
      if (!credentialStored) {
        throw new WebhookEvidenceError(
          "Discord webhook creation did not confirm private credential custody",
        )
      }
      if (created.type !== "incoming" || created.name !== request.name) {
        throw new WebhookEvidenceError(
          "Discord returned webhook creation state that does not match the request",
        )
      }
      const readback = exactWebhookInventory(
        await this.#client.listChannelWebhooks(request.channelId, options),
        request.channelId,
        plan.guild.id,
      )
      observed = readback.find(
        (webhook) => webhook.webhookId === created?.webhookId,
      ) ?? null
      readbackMatched = observed !== null
        && stableString(observed) === stableString(created)
      inventoryMatched = sameWebhookInventory(
        readback,
        sortedWebhookInventory([...plan.source.webhooks, created]),
      )
    } catch (error) {
      const status = created === null
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(creationReceipt({
          activityId,
          error: errorCode,
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          webhookId: created?.webhookId ?? null,
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(creationActivityEntry({
          activityId,
          error: errorCode,
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          webhookId: created?.webhookId ?? null,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new WebhookCreationExecutionError(
        "Discord webhook creation did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          inventoryMatched,
          observed,
          operationRecordError,
          readbackMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
          webhookId: created?.webhookId ?? null,
        },
        { cause: error },
      )
    }

    const verification = readbackMatched && inventoryMatched ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: WebhookCreationResult = {
      ...baseResult,
      activityId,
      credentialStored: true,
      created,
      inventoryMatched,
      observed,
      readbackMatched,
      responseMatched: true,
      status,
    }
    try {
      await this.#operationStore.finish(creationReceipt({
        activityId,
        guildId: plan.guild.id,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
        webhookId: created.webhookId,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(creationActivityEntry({
          activityId,
          error: safeErrorCode(error),
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
          webhookId: created.webhookId,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new WebhookCreationExecutionError(
        "Discord webhook creation completed but the operation receipt failed",
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
      await this.#activityStore.append(creationActivityEntry({
        activityId,
        guildId: plan.guild.id,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
        webhookId: created.webhookId,
      }))
    } catch (error) {
      throw new WebhookCreationExecutionError(
        "Discord webhook creation completed but the final activity record failed",
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

  executeChange(
    applicationId: string,
    botId: string,
    request: WebhookChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookChangeResult> {
    const normalized = normalizeWebhookChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord webhook change plan digest is invalid")
    }
    return withTargetLock(
      `webhook:${normalized.webhookId}`,
      () => this.#executeChangeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new WebhookChangeExecutionError(
        "Discord webhook change was blocked because a prior same-target operation ended with an uncertain outcome",
        {
          channelId: normalized.channelId,
          destinationChannelId: normalized.destinationChannelId
            ?? normalized.channelId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
          webhookId: normalized.webhookId,
        },
      ),
    )
  }

  async #executeChangeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedWebhookChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<WebhookChangeResult> {
    let plan: WebhookChangePlan
    try {
      plan = await this.#buildChangePlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof WebhookEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new WebhookChangePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new WebhookChangePlanChangedError(expectedDigest, plan.digest)
    }
    const destinationChannelId = plan.desired.channelId
    const baseResult = {
      channelId: request.channelId,
      destinationChannelId,
      guildId: plan.guild.id,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      webhookId: request.webhookId,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        inventoryMatched: true,
        observed: plan.current,
        readbackMatched: true,
        responseMatched: false,
        sourceTargetAbsent: false,
        status: "already-current",
      }
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(changeReceipt({
      activityId,
      guildId: plan.guild.id,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new WebhookChangeOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(changeActivityEntry({
        activityId,
        guildId: plan.guild.id,
        plan,
        request,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(changeReceipt({
          activityId,
          error: safeErrorCode(error),
          guildId: plan.guild.id,
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new WebhookChangeExecutionError(
        "Discord webhook change was blocked because pending activity could not be recorded",
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

    let inventoryMatched: boolean | null = null
    let mutationAccepted = false
    let observed: ProjectedWebhook | null = null
    let readbackMatched: boolean | null = null
    let responseMatched = false
    let sourceTargetAbsent: boolean | null = null
    try {
      const input: ModifyWebhookInput = {
        ...(plan.changedFields.includes("channelId")
          ? { channelId: destinationChannelId }
          : {}),
        ...(plan.changedFields.includes("name") && plan.desired.name !== null
          ? { name: plan.desired.name }
          : {}),
      }
      const response = await this.#client.modifyWebhook(
        request.webhookId,
        input,
        request.auditReason,
        options,
      )
      mutationAccepted = true
      const projected = projectedWebhook(
        response,
        destinationChannelId,
        plan.guild.id,
      )
      responseMatched = stableString(projected) === stableString(plan.desired)
      if (!responseMatched) {
        throw new WebhookEvidenceError(
          "Discord returned webhook metadata that does not match the requested change",
        )
      }
      const [sourceReadback, destinationReadback] = await Promise.all([
        this.#client.listChannelWebhooks(request.channelId, options),
        destinationChannelId === request.channelId
          ? Promise.resolve(null)
          : this.#client.listChannelWebhooks(destinationChannelId, options),
      ])
      const sourceInventory = exactWebhookInventory(
        sourceReadback,
        request.channelId,
        plan.guild.id,
      )
      const destinationInventory = destinationReadback === null
        ? sourceInventory
        : exactWebhookInventory(
            destinationReadback,
            destinationChannelId,
            plan.guild.id,
          )
      observed = destinationInventory.find(
        (webhook) => webhook.webhookId === request.webhookId,
      ) ?? null
      readbackMatched = observed !== null
        && stableString(observed) === stableString(plan.desired)
      if (destinationChannelId === request.channelId) {
        sourceTargetAbsent = false
        const expected = sortedWebhookInventory(plan.source.webhooks.map(
          (webhook) => webhook.webhookId === request.webhookId
            ? plan.desired
            : webhook,
        ))
        inventoryMatched = sameWebhookInventory(sourceInventory, expected)
      } else {
        sourceTargetAbsent = !sourceInventory.some(
          (webhook) => webhook.webhookId === request.webhookId,
        )
        const expectedSource = plan.source.webhooks.filter(
          (webhook) => webhook.webhookId !== request.webhookId,
        )
        const expectedDestination = sortedWebhookInventory([
          ...(plan.destination?.webhooks ?? []),
          plan.desired,
        ])
        inventoryMatched = sourceTargetAbsent
          && sameWebhookInventory(sourceInventory, expectedSource)
          && sameWebhookInventory(destinationInventory, expectedDestination)
      }
    } catch (error) {
      const status = !mutationAccepted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(changeReceipt({
          activityId,
          error: errorCode,
          guildId: plan.guild.id,
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
        await this.#activityStore.append(changeActivityEntry({
          activityId,
          error: errorCode,
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new WebhookChangeExecutionError(
        "Discord webhook change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          inventoryMatched,
          observed,
          operationRecordError,
          readbackMatched,
          responseMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          sourceTargetAbsent,
          status,
        },
        { cause: error },
      )
    }

    const verification = readbackMatched && inventoryMatched ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: WebhookChangeResult = {
      ...baseResult,
      activityId,
      inventoryMatched,
      observed,
      readbackMatched,
      responseMatched,
      sourceTargetAbsent,
      status,
    }
    try {
      await this.#operationStore.finish(changeReceipt({
        activityId,
        guildId: plan.guild.id,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(changeActivityEntry({
          activityId,
          error: safeErrorCode(error),
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new WebhookChangeExecutionError(
        "Discord webhook change completed but the operation receipt failed",
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
      await this.#activityStore.append(changeActivityEntry({
        activityId,
        guildId: plan.guild.id,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new WebhookChangeExecutionError(
        "Discord webhook change completed but the final activity record failed",
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

  execute(
    applicationId: string,
    botId: string,
    request: WebhookDeletionRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<WebhookDeletionResult> {
    const normalized = normalizeWebhookDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord webhook deletion plan digest is invalid")
    }
    return withTargetLock(
      `webhook:${normalized.webhookId}`,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new WebhookDeletionExecutionError(
        "Discord webhook deletion was blocked because a prior same-target operation ended with an uncertain outcome",
        {
          channelId: normalized.channelId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
          webhookId: normalized.webhookId,
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedWebhookDeletionRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<WebhookDeletionResult> {
    let plan: WebhookDeletionPlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof WebhookEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new WebhookDeletionPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new WebhookDeletionPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: plan.guild.id,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      webhookId: request.webhookId,
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: plan.guild.id,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new WebhookDeletionOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        guildId: plan.guild.id,
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
          guildId: plan.guild.id,
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new WebhookDeletionExecutionError(
        "Discord webhook deletion was blocked because pending activity could not be recorded",
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
    let verifiedAbsent: boolean | null = null
    try {
      await this.#client.deleteWebhook(
        request.webhookId,
        request.auditReason,
        options,
      )
      mutationCompleted = true
      const observed = exactWebhookInventory(
        await this.#client.listChannelWebhooks(request.channelId, options),
        request.channelId,
        plan.guild.id,
      )
      verifiedAbsent = !observed.some(
        (webhook) => webhook.webhookId === request.webhookId,
      )
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
          guildId: plan.guild.id,
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
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new WebhookDeletionExecutionError(
        "Discord webhook deletion did not complete with a verified successful outcome",
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
        { cause: error },
      )
    }

    let credentialCleanup: WebhookDeletionResult["credentialCleanup"] = "not-attempted"
    if (verifiedAbsent) {
      if (!this.#credentialStore) {
        credentialCleanup = "not-configured"
      } else {
        try {
          credentialCleanup = await this.#credentialStore.remove(request.webhookId)
            ? "removed"
            : "not-present"
        } catch {
          credentialCleanup = "failed"
        }
      }
    }
    const verification = verifiedAbsent && credentialCleanup !== "failed"
      ? "match"
      : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: WebhookDeletionResult = {
      ...baseResult,
      activityId,
      credentialCleanup,
      status,
      verifiedAbsent,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: plan.guild.id,
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
          guildId: plan.guild.id,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new WebhookDeletionExecutionError(
        "Discord webhook deletion completed but the operation receipt failed",
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
        guildId: plan.guild.id,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new WebhookDeletionExecutionError(
        "Discord webhook deletion completed but the final activity record failed",
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
