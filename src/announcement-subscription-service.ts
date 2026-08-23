import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  AnnouncementSubscriptionActivity,
  AnnouncementSubscriptionActivityStatus,
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
  type DiscordClient,
  type DiscordWebhookSummary,
} from "./discord-client.js"
import {
  AnnouncementSubscriptionEvidenceError,
  AnnouncementSubscriptionExecutionError,
  AnnouncementSubscriptionOperationConflictError,
  AnnouncementSubscriptionPlanChangedError,
  DiscordApiError,
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
  DiscordRole,
  RequestOptions,
} from "./types.js"
import { WEBHOOK_TYPES } from "./webhook-service.js"

const DISCORD_EPOCH_MS = 1_420_070_400_000n
const STATE_UNAVAILABLE = "announcement-subscription-state-unavailable"
const SOURCE_REQUIRED_PERMISSIONS = ["VIEW_CHANNEL"] as const
const TARGET_REQUIRED_PERMISSIONS = ["MANAGE_WEBHOOKS", "VIEW_CHANNEL"] as const
const WEBHOOK_TYPE_NAMES = Object.freeze({
  [WEBHOOK_TYPES.application]: "application",
  [WEBHOOK_TYPES.channelFollower]: "channel-follower",
  [WEBHOOK_TYPES.incoming]: "incoming",
})
const PRIVACY_OMISSIONS = Object.freeze([
  "applicationMetadata",
  "creatorProfile",
  "followerSourceChannelName",
  "followerSourceGuildIcon",
  "followerSourceGuildName",
  "messageData",
  "unrelatedWebhookIdentifiers",
  "unknownRawFields",
  "webhookAvatar",
  "webhookName",
  "webhookToken",
  "webhookUrl",
] as const)

type SubscriptionTargetOutcome = "settled" | "uncertain"
const SUBSCRIPTION_TARGET_LOCKS = new Map<
  string,
  Promise<SubscriptionTargetOutcome>
>()

export type AnnouncementSubscriptionAction = "subscribe" | "unsubscribe"

export interface AnnouncementSubscribeRequest {
  action: "subscribe"
  auditReason: string
  operationKey: string
  sourceChannelId: string
  targetChannelId: string
  webhookId?: never
}

export interface AnnouncementUnsubscribeRequest {
  action: "unsubscribe"
  auditReason: string
  operationKey: string
  sourceChannelId?: never
  targetChannelId: string
  webhookId: string
}

export type AnnouncementSubscriptionRequest =
  | AnnouncementSubscribeRequest
  | AnnouncementUnsubscribeRequest

export type NormalizedAnnouncementSubscriptionRequest =
  | AnnouncementSubscribeRequest & { operationKeyHash: string }
  | AnnouncementUnsubscribeRequest & { operationKeyHash: string }

export interface AnnouncementSubscriptionChannelProjection {
  guildId: string
  id: string
  name: string
  parentId: string | null
  type: number
  typeName: string
}

export interface AnnouncementSubscriptionPermissionEvidence {
  administrator: boolean
  confidence: "complete"
  effectivePermissions: string
  manageWebhooks: boolean
  permissionSourceChannelId: string
  viewChannel: true
}

export type AnnouncementSubscriptionWebhookType =
  | "application"
  | "channel-follower"
  | "incoming"

export interface AnnouncementSubscriptionWebhookSnapshot {
  createdAt: string
  sourceChannelId: string | null
  sourceGuildId: string | null
  sourceIdentity: "available" | "not-applicable" | "redacted" | "unavailable"
  type: AnnouncementSubscriptionWebhookType
  webhookId: string
}

export interface AnnouncementSubscriptionProjection extends
  AnnouncementSubscriptionWebhookSnapshot {
  sourceIdentity: "available" | "redacted" | "unavailable"
  type: "channel-follower"
}

export interface AnnouncementSubscriptionPrivacyProjection {
  credentialsProjectedOut: true
  messageDataAccessed: false
  omittedFields: typeof PRIVACY_OMISSIONS
}

export interface AnnouncementSubscriptionTargetEndpoint {
  channel: AnnouncementSubscriptionChannelProjection
  guild: {
    id: string
    name: string
  }
  inventory: {
    channelFollowers: number
    safetyLimit: number
    totalWebhooks: number
  }
  permission: AnnouncementSubscriptionPermissionEvidence
  subscriptions: AnnouncementSubscriptionProjection[]
}

export interface AnnouncementSubscriptionSourceEndpoint {
  channel: AnnouncementSubscriptionChannelProjection
  guild: {
    id: string
    name: string
  }
  permission: AnnouncementSubscriptionPermissionEvidence
}

export interface AnnouncementSubscriptionInventoryResult {
  privacy: AnnouncementSubscriptionPrivacyProjection
  schemaVersion: number
  status: "ok"
  target: AnnouncementSubscriptionTargetEndpoint
}

export interface AnnouncementSubscriptionPlan {
  action: AnnouncementSubscriptionAction
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  current: AnnouncementSubscriptionProjection | null
  desired: {
    subscribed: boolean
  }
  digest: string
  operationKeyHash: string
  privacy: AnnouncementSubscriptionPrivacyProjection
  risks: string[]
  schemaVersion: number
  source: AnnouncementSubscriptionSourceEndpoint | null
  status: "already-current" | "planned"
  target: AnnouncementSubscriptionTargetEndpoint
  warnings: string[]
  writeRequired: boolean
}

export interface AnnouncementSubscriptionResult {
  action: AnnouncementSubscriptionAction
  activityId: string | null
  inventoryMatched: boolean
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  responseMatched: boolean | null
  schemaVersion: number
  sourceChannelId: string | null
  sourceGuildId: string | null
  status: "already-current" | "completed" | "completed-with-drift"
  targetChannelId: string
  targetGuildId: string
  verifiedAbsent: boolean
  webhookId: string
}

export interface AnnouncementSubscriptionServiceClient {
  deleteWebhook: DiscordClient["deleteWebhook"]
  followAnnouncementChannel: DiscordClient["followAnnouncementChannel"]
  getChannel: DiscordClient["getChannel"]
  getGuild: DiscordClient["getGuild"]
  getGuildMember: DiscordClient["getGuildMember"]
  getGuildRoles: DiscordClient["getGuildRoles"]
  listChannelWebhooks: DiscordClient["listChannelWebhooks"]
}

export interface AnnouncementSubscriptionServiceOptions {
  activityStore: ActivityStore
  client: AnnouncementSubscriptionServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface GuildEvidence {
  botMember: DiscordGuildMember
  guild: DiscordGuild
  roles: DiscordRole[]
}

interface SourceState extends GuildEvidence {
  channel: DiscordChannel
  guildId: string
  permissions: BotChannelPermissionResult & { confidence: "complete" }
}

interface TargetState extends GuildEvidence {
  channel: DiscordChannel
  guildId: string
  permissions: BotChannelPermissionResult & { confidence: "complete" }
  webhooks: AnnouncementSubscriptionWebhookSnapshot[]
}

interface AnnouncementSubscriptionPlanningState {
  plan: AnnouncementSubscriptionPlan
  targetInventory: AnnouncementSubscriptionWebhookSnapshot[]
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
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

export function normalizeAnnouncementSubscriptionRequest(
  request: AnnouncementSubscriptionRequest,
): NormalizedAnnouncementSubscriptionRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord announcement subscription request must be an object")
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError(
      "Discord announcement subscription audit reason must be a string",
    )
  }
  encodeDiscordAuditReason(request.auditReason)
  assertSnowflake(
    request.targetChannelId,
    "Discord announcement subscription target channel ID",
  )
  if (request.action === "subscribe") {
    if (!hasOnlyKeys(request as unknown as Record<string, unknown>, [
      "action",
      "auditReason",
      "operationKey",
      "sourceChannelId",
      "targetChannelId",
    ])) {
      throw new RangeError("Discord subscribe request must be an exact object")
    }
    assertSnowflake(
      request.sourceChannelId,
      "Discord announcement subscription source channel ID",
    )
    return {
      ...request,
      operationKeyHash: operationKeyHash(request.operationKey),
    }
  }
  if (request.action === "unsubscribe") {
    if (!hasOnlyKeys(request as unknown as Record<string, unknown>, [
      "action",
      "auditReason",
      "operationKey",
      "targetChannelId",
      "webhookId",
    ])) {
      throw new RangeError("Discord unsubscribe request must be an exact object")
    }
    assertSnowflake(
      request.webhookId,
      "Discord announcement subscription webhook ID",
    )
    return {
      ...request,
      operationKeyHash: operationKeyHash(request.operationKey),
    }
  }
  throw new RangeError(
    "Discord announcement subscription action must be subscribe or unsubscribe",
  )
}

function evidenceError(message: string, cause?: unknown): AnnouncementSubscriptionEvidenceError {
  return new AnnouncementSubscriptionEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function exactChannel(channel: DiscordChannel, channelId: string): DiscordChannel {
  if (
    !channel
    || typeof channel !== "object"
    || Array.isArray(channel)
    || channel.id !== channelId
    || typeof channel.guild_id !== "string"
    || !Number.isSafeInteger(channel.type)
    || typeof channel.name !== "string"
    || [...channel.name].length < 1
    || [...channel.name].length > DISCORD_LIMITS.channelNameCharacters
    || /[\u0000-\u001F\u007F]/u.test(channel.name)
    || !(
      channel.parent_id === undefined
      || channel.parent_id === null
      || typeof channel.parent_id === "string"
    )
    || !(
      channel.permission_overwrites === undefined
      || Array.isArray(channel.permission_overwrites)
    )
    || (channel.permission_overwrites?.length ?? 0)
      > DISCORD_LIMITS.channelPermissionOverwrites
  ) throw evidenceError("Discord returned invalid announcement subscription channel evidence")
  try {
    assertSnowflake(channel.guild_id, "Discord announcement subscription guild ID")
    if (typeof channel.parent_id === "string") {
      assertSnowflake(
        channel.parent_id,
        "Discord announcement subscription parent channel ID",
      )
    }
    encodeURIComponent(channel.name)
  } catch (error) {
    throw evidenceError(
      "Discord returned invalid announcement subscription channel evidence",
      error,
    )
  }
  return channel
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || [...guild.name].length < 1
    || /[\u0000-\u001F\u007F]/u.test(guild.name)
  ) throw evidenceError("Discord returned invalid announcement subscription guild evidence")
  try {
    encodeURIComponent(guild.name)
  } catch (error) {
    throw evidenceError(
      "Discord returned invalid announcement subscription guild evidence",
      error,
    )
  }
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
  ) throw evidenceError("Discord returned invalid announcement subscription bot evidence")
  return member
}

function exactRoles(roles: readonly DiscordRole[]): DiscordRole[] {
  if (!Array.isArray(roles) || roles.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned invalid announcement subscription role evidence")
  }
  const seen = new Set<string>()
  for (const role of roles) {
    if (
      !role
      || typeof role !== "object"
      || !validSnowflake(role.id)
      || seen.has(role.id)
    ) throw evidenceError("Discord returned invalid announcement subscription role evidence")
    seen.add(role.id)
  }
  return [...roles]
}

function webhookCreatedAt(webhookId: string): string {
  const milliseconds = (BigInt(webhookId) >> 22n) + DISCORD_EPOCH_MS
  const createdAt = new Date(Number(milliseconds))
  if (Number.isNaN(createdAt.getTime())) {
    throw evidenceError("Discord returned invalid announcement subscription webhook identity")
  }
  return createdAt.toISOString()
}

function projectWebhook(
  webhook: DiscordWebhookSummary,
  channelId: string,
  guildId: string,
): AnnouncementSubscriptionWebhookSnapshot {
  if (
    !webhook
    || typeof webhook !== "object"
    || !validSnowflake(webhook.id)
    || webhook.channelId !== channelId
    || webhook.guildId !== guildId
  ) throw evidenceError("Discord returned webhook evidence outside the subscription target")
  const type = WEBHOOK_TYPE_NAMES[webhook.type as keyof typeof WEBHOOK_TYPE_NAMES]
  if (!type) throw evidenceError("Discord returned an unsupported webhook type")
  const sourceAvailable = webhook.sourceChannelId !== null
    && webhook.sourceGuildId !== null
  const sourceUnavailable = webhook.sourceChannelId === null
    && webhook.sourceGuildId === null
  if (!sourceAvailable && !sourceUnavailable) {
    throw evidenceError("Discord returned partial Channel Follower source identity")
  }
  if (sourceAvailable && (
    !validSnowflake(webhook.sourceChannelId)
    || !validSnowflake(webhook.sourceGuildId)
  )) throw evidenceError("Discord returned invalid Channel Follower source identity")
  if (type !== "channel-follower" && !sourceUnavailable) {
    throw evidenceError("Discord returned source identity for a non-follower webhook")
  }
  return {
    createdAt: webhookCreatedAt(webhook.id),
    sourceChannelId: sourceAvailable ? webhook.sourceChannelId : null,
    sourceGuildId: sourceAvailable ? webhook.sourceGuildId : null,
    sourceIdentity: type !== "channel-follower"
      ? "not-applicable"
      : sourceAvailable
        ? "available"
        : "unavailable",
    type,
    webhookId: webhook.id,
  }
}

function projectInventory(
  inventory: readonly DiscordWebhookSummary[],
  channelId: string,
  guildId: string,
): AnnouncementSubscriptionWebhookSnapshot[] {
  if (!Array.isArray(inventory) || inventory.length > DISCORD_LIMITS.webhooksPerChannel) {
    throw evidenceError("Discord returned invalid announcement subscription webhook inventory")
  }
  const seen = new Set<string>()
  const projected = inventory.map((webhook) => {
    const entry = projectWebhook(webhook, channelId, guildId)
    if (seen.has(entry.webhookId)) {
      throw evidenceError("Discord returned duplicate webhook IDs in the target inventory")
    }
    seen.add(entry.webhookId)
    return entry
  })
  return sortInventory(projected)
}

function sortInventory(
  inventory: readonly AnnouncementSubscriptionWebhookSnapshot[],
): AnnouncementSubscriptionWebhookSnapshot[] {
  return [...inventory].sort((left, right) => {
    const leftId = BigInt(left.webhookId)
    const rightId = BigInt(right.webhookId)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

function subscriptionProjection(
  webhook: AnnouncementSubscriptionWebhookSnapshot,
): AnnouncementSubscriptionProjection {
  if (webhook.type !== "channel-follower" || webhook.sourceIdentity === "not-applicable") {
    throw evidenceError("Discord webhook is not an announcement subscription")
  }
  return webhook as AnnouncementSubscriptionProjection
}

function subscriptions(
  webhooks: readonly AnnouncementSubscriptionWebhookSnapshot[],
): AnnouncementSubscriptionProjection[] {
  return webhooks
    .filter((webhook) => webhook.type === "channel-follower")
    .map(subscriptionProjection)
}

function privacyProjection(): AnnouncementSubscriptionPrivacyProjection {
  return {
    credentialsProjectedOut: true,
    messageDataAccessed: false,
    omittedFields: PRIVACY_OMISSIONS,
  }
}

function projectChannel(
  channel: DiscordChannel,
  guildId: string,
): AnnouncementSubscriptionChannelProjection {
  const typeName = CHANNEL_TYPE_NAMES[
    channel.type as keyof typeof CHANNEL_TYPE_NAMES
  ]
  if (!typeName || channel.guild_id !== guildId) {
    throw evidenceError("Discord returned invalid announcement subscription channel evidence")
  }
  return {
    guildId,
    id: channel.id,
    name: channel.name as string,
    parentId: channel.parent_id ?? null,
    type: channel.type,
    typeName,
  }
}

function hasPermission(
  result: BotChannelPermissionResult,
  permission: DiscordPermissionName,
): boolean {
  return result.effectivePermissionNames.includes(permission)
}

function permissionEvidence(
  permissions: BotChannelPermissionResult & { confidence: "complete" },
): AnnouncementSubscriptionPermissionEvidence {
  return {
    administrator: permissions.administrator,
    confidence: "complete",
    effectivePermissions: permissions.effectivePermissions,
    manageWebhooks: hasPermission(permissions, "MANAGE_WEBHOOKS"),
    permissionSourceChannelId: permissions.permissionSourceChannelId,
    viewChannel: true,
  }
}

function evaluatePermissions(
  botId: string,
  channel: DiscordChannel,
  guildId: string,
  evidence: GuildEvidence,
  required: readonly DiscordPermissionName[],
  label: "source" | "target",
): BotChannelPermissionResult & { confidence: "complete" } {
  let permissions: BotChannelPermissionResult
  try {
    permissions = evaluateBotChannelPermissions({
      botId,
      channel,
      guildId,
      member: evidence.botMember,
      permissionChannel: channel,
      roles: evidence.roles,
    })
  } catch (error) {
    throw evidenceError(
      `Discord connector bot announcement subscription ${label} permission evidence is invalid`,
      error,
    )
  }
  if (permissions.confidence !== "complete") {
    throw evidenceError(
      `Discord connector bot announcement subscription ${label} permission evidence is incomplete`,
    )
  }
  for (const permission of required) {
    if (!hasPermission(permissions, permission)) {
      throw evidenceError(
        `Discord connector bot lacks channel-level ${permission} in the subscription ${label}`,
      )
    }
  }
  return permissions as BotChannelPermissionResult & { confidence: "complete" }
}

function targetEndpoint(state: TargetState): AnnouncementSubscriptionTargetEndpoint {
  const followerWebhooks = subscriptions(state.webhooks)
  return {
    channel: projectChannel(state.channel, state.guildId),
    guild: {
      id: state.guildId,
      name: state.guild.name,
    },
    inventory: {
      channelFollowers: followerWebhooks.length,
      safetyLimit: DISCORD_LIMITS.webhooksPerChannel,
      totalWebhooks: state.webhooks.length,
    },
    permission: permissionEvidence(state.permissions),
    subscriptions: followerWebhooks,
  }
}

function sourceEndpoint(state: SourceState): AnnouncementSubscriptionSourceEndpoint {
  return {
    channel: projectChannel(state.channel, state.guildId),
    guild: {
      id: state.guildId,
      name: state.guild.name,
    },
    permission: permissionEvidence(state.permissions),
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
  return (channel.permission_overwrites ?? [])
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

function endpointDigestSnapshot(
  state: SourceState | TargetState,
) {
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
    ...("webhooks" in state ? { webhooks: state.webhooks } : {}),
  }
}

function sameInventory(
  left: readonly AnnouncementSubscriptionWebhookSnapshot[],
  right: readonly AnnouncementSubscriptionWebhookSnapshot[],
): boolean {
  return stableString(left) === stableString(right)
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
  plan: AnnouncementSubscriptionPlan
  request: NormalizedAnnouncementSubscriptionRequest
  status: AnnouncementSubscriptionActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
  webhookId?: string | null
}): AnnouncementSubscriptionActivity {
  const sourceChannelId = options.request.action === "subscribe"
    ? options.request.sourceChannelId
    : options.plan.current?.sourceChannelId ?? null
  const sourceGuildId = options.request.action === "subscribe"
    ? options.plan.source?.guild.id ?? null
    : options.plan.current?.sourceGuildId ?? null
  return {
    action: options.request.action,
    error: options.error ?? null,
    guildId: options.plan.target.guild.id,
    id: options.activityId,
    kind: "announcement-subscription",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    sourceChannelId,
    sourceGuildId,
    status: options.status,
    targetChannelId: options.request.targetChannelId,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
    webhookId: options.webhookId
      ?? (options.request.action === "unsubscribe" ? options.request.webhookId : null),
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: AnnouncementSubscriptionPlan
  request: NormalizedAnnouncementSubscriptionRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
  webhookId?: string | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.target.guild.id,
    kind: "announcement-subscription",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" || options.status === "uncertain"
      ? options.webhookId
        ?? (options.request.action === "unsubscribe" ? options.request.webhookId : null)
      : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof AnnouncementSubscriptionExecutionError)
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
  const prior = SUBSCRIPTION_TARGET_LOCKS.get(key)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: SubscriptionTargetOutcome) => void = () => undefined
  const tail = new Promise<SubscriptionTargetOutcome>((resolve) => {
    release = resolve
  })
  SUBSCRIPTION_TARGET_LOCKS.set(key, tail)
  let outcome: SubscriptionTargetOutcome = "settled"
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
    if (SUBSCRIPTION_TARGET_LOCKS.get(key) === tail) {
      SUBSCRIPTION_TARGET_LOCKS.delete(key)
    }
  }
}

export class AnnouncementSubscriptionService {
  readonly #activityStore: ActivityStore
  readonly #client: AnnouncementSubscriptionServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: AnnouncementSubscriptionServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  #projectInventory(
    inventory: readonly DiscordWebhookSummary[],
    channelId: string,
    guildId: string,
  ): AnnouncementSubscriptionWebhookSnapshot[] {
    return projectInventory(inventory, channelId, guildId).map((webhook) => {
      if (
        webhook.type !== "channel-follower"
        || webhook.sourceIdentity !== "available"
      ) return webhook
      if (webhook.sourceChannelId === null || webhook.sourceGuildId === null) {
        throw evidenceError("Discord returned inconsistent Channel Follower source identity")
      }
      if (
        this.#policy.guildAllowed(webhook.sourceGuildId)
        && this.#policy.channelIdReadable(webhook.sourceChannelId)
      ) return webhook
      return {
        ...webhook,
        sourceChannelId: null,
        sourceGuildId: null,
        sourceIdentity: "redacted",
      }
    })
  }

  async #guildEvidence(
    botId: string,
    guildId: string,
    options: RequestOptions,
  ): Promise<GuildEvidence> {
    const [guild, botMember, roles] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    return {
      botMember: exactBotMember(botMember, botId),
      guild: exactGuild(guild, guildId),
      roles: exactRoles(roles),
    }
  }

  async #targetState(
    botId: string,
    targetChannelId: string,
    mode: "audit" | "change",
    options: RequestOptions,
  ): Promise<TargetState> {
    assertSnowflake(botId, "Discord connector bot ID")
    if (mode === "change") {
      this.#policy.assertAnnouncementSubscriptionTargetIdChangeable(targetChannelId)
    } else {
      this.#policy.assertAnnouncementSubscriptionTargetIdAuditable(targetChannelId)
    }
    const channel = exactChannel(
      await this.#client.getChannel(targetChannelId, options),
      targetChannelId,
    )
    const guildId = mode === "change"
      ? this.#policy.assertAnnouncementSubscriptionTargetChangeable(channel)
      : this.#policy.assertAnnouncementSubscriptionTargetAuditable(channel)
    const [guildEvidence, inventory] = await Promise.all([
      this.#guildEvidence(botId, guildId, options),
      this.#client.listChannelWebhooks(targetChannelId, options),
    ])
    const permissions = evaluatePermissions(
      botId,
      channel,
      guildId,
      guildEvidence,
      TARGET_REQUIRED_PERMISSIONS,
      "target",
    )
    return {
      ...guildEvidence,
      channel,
      guildId,
      permissions,
      webhooks: this.#projectInventory(inventory, targetChannelId, guildId),
    }
  }

  async #subscribeState(
    botId: string,
    sourceChannelId: string,
    targetChannelId: string,
    options: RequestOptions,
  ): Promise<{ source: SourceState; target: TargetState }> {
    assertSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertAnnouncementSubscriptionSourceIdChangeable(sourceChannelId)
    this.#policy.assertAnnouncementSubscriptionTargetIdChangeable(targetChannelId)
    const [rawSource, rawTarget] = await Promise.all([
      this.#client.getChannel(sourceChannelId, options),
      this.#client.getChannel(targetChannelId, options),
    ])
    const sourceChannel = exactChannel(rawSource, sourceChannelId)
    const targetChannel = exactChannel(rawTarget, targetChannelId)
    const sourceGuildId = this.#policy
      .assertAnnouncementSubscriptionSourceChangeable(sourceChannel)
    const targetGuildId = this.#policy
      .assertAnnouncementSubscriptionTargetChangeable(targetChannel)
    const targetInventoryPromise = this.#client.listChannelWebhooks(
      targetChannelId,
      options,
    )
    let sourceGuildEvidence: GuildEvidence
    let targetGuildEvidence: GuildEvidence
    if (sourceGuildId === targetGuildId) {
      const shared = await this.#guildEvidence(botId, sourceGuildId, options)
      sourceGuildEvidence = shared
      targetGuildEvidence = shared
    } else {
      [sourceGuildEvidence, targetGuildEvidence] = await Promise.all([
        this.#guildEvidence(botId, sourceGuildId, options),
        this.#guildEvidence(botId, targetGuildId, options),
      ])
    }
    const inventory = await targetInventoryPromise
    const sourcePermissions = evaluatePermissions(
      botId,
      sourceChannel,
      sourceGuildId,
      sourceGuildEvidence,
      SOURCE_REQUIRED_PERMISSIONS,
      "source",
    )
    const targetPermissions = evaluatePermissions(
      botId,
      targetChannel,
      targetGuildId,
      targetGuildEvidence,
      TARGET_REQUIRED_PERMISSIONS,
      "target",
    )
    return {
      source: {
        ...sourceGuildEvidence,
        channel: sourceChannel,
        guildId: sourceGuildId,
        permissions: sourcePermissions,
      },
      target: {
        ...targetGuildEvidence,
        channel: targetChannel,
        guildId: targetGuildId,
        permissions: targetPermissions,
        webhooks: this.#projectInventory(
          inventory,
          targetChannelId,
          targetGuildId,
        ),
      },
    }
  }

  async list(
    botId: string,
    targetChannelId: string,
    options: RequestOptions = {},
  ): Promise<AnnouncementSubscriptionInventoryResult> {
    const target = await this.#targetState(botId, targetChannelId, "audit", options)
    return {
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      target: targetEndpoint(target),
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedAnnouncementSubscriptionRequest,
    options: RequestOptions,
  ): Promise<AnnouncementSubscriptionPlanningState> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const existingReceipt = await this.#operationStore.get(
      "announcement-subscription",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new AnnouncementSubscriptionOperationConflictError(
        receiptView(existingReceipt),
      )
    }
    if (request.action === "subscribe") {
      const state = await this.#subscribeState(
        botId,
        request.sourceChannelId,
        request.targetChannelId,
        options,
      )
      const followerWebhooks = subscriptions(state.target.webhooks)
      if (followerWebhooks.some((entry) => entry.sourceIdentity !== "available")) {
        throw evidenceError(
          "Discord announcement subscription creation is blocked because an existing Channel Follower webhook has unavailable source identity or policy-redacted source identity",
        )
      }
      const matches = followerWebhooks.filter(
        (entry) => entry.sourceChannelId === request.sourceChannelId,
      )
      if (matches.length > 1) {
        throw evidenceError(
          "Discord target channel already has duplicate subscriptions for the requested source",
        )
      }
      if (
        matches.length === 0
        && state.target.webhooks.length >= DISCORD_LIMITS.webhooksPerChannel
      ) {
        throw evidenceError(
          "Discord announcement subscription creation is blocked because the target webhook inventory is full",
        )
      }
      const current = matches[0] ?? null
      const writeRequired = current === null
      const digest = reviewedPlanDigest(this.#planKey, {
        action: request.action,
        applicationId,
        botId,
        current,
        request,
        source: endpointDigestSnapshot(state.source),
        target: endpointDigestSnapshot(state.target),
        writeRequired,
      })
      return {
        plan: {
          action: "subscribe",
          applicationId,
          auditReason: request.auditReason,
          botId,
          createdAt: this.#clock().toISOString(),
          current,
          desired: { subscribed: true },
          digest,
          operationKeyHash: request.operationKeyHash,
          privacy: privacyProjection(),
          risks: [
            "Subscription creates a durable target webhook that relays every future published source announcement until removed",
            "The source and target may belong to different guilds with independent administrators and retention expectations",
            "A transport failure after Discord accepts the request can leave an unverified subscription",
          ],
          schemaVersion: SCHEMA_VERSION,
          source: sourceEndpoint(state.source),
          status: writeRequired ? "planned" : "already-current",
          target: targetEndpoint(state.target),
          warnings: [
            ...(state.source.guildId !== state.target.guildId
              ? ["This subscription crosses guild boundaries"]
              : []),
            ...(state.source.permissions.administrator
              ? ["Discord connector bot has ADMINISTRATOR in the source guild; replace it with narrowly scoped VIEW_CHANNEL permission"]
              : []),
            ...(state.target.permissions.administrator
              ? ["Discord connector bot has ADMINISTRATOR in the target guild; replace it with narrowly scoped VIEW_CHANNEL and MANAGE_WEBHOOKS permissions"]
              : []),
            "Removing the created subscription requires a separate exact reviewed unsubscribe action",
            "Discord names are untrusted transient display data and are never persisted by this workflow",
            "The MCP facade durably coordinates exact targets; direct service consumers must provide equivalent cross-process exclusion",
            "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
          ],
          writeRequired,
        },
        targetInventory: state.target.webhooks,
      }
    }

    const target = await this.#targetState(
      botId,
      request.targetChannelId,
      "change",
      options,
    )
    const currentRaw = target.webhooks.find(
      (entry) => entry.webhookId === request.webhookId,
    )
    if (!currentRaw) {
      throw evidenceError(
        "Discord announcement subscription webhook is absent from the exact target inventory",
      )
    }
    if (currentRaw.type !== "channel-follower") {
      throw evidenceError(
        "Discord announcement unsubscription requires an exact Channel Follower webhook",
      )
    }
    const current = subscriptionProjection(currentRaw)
    const digest = reviewedPlanDigest(this.#planKey, {
      action: request.action,
      applicationId,
      botId,
      current,
      request,
      target: endpointDigestSnapshot(target),
      writeRequired: true,
    })
    return {
      plan: {
        action: "unsubscribe",
        applicationId,
        auditReason: request.auditReason,
        botId,
        createdAt: this.#clock().toISOString(),
        current,
        desired: { subscribed: false },
        digest,
        operationKeyHash: request.operationKeyHash,
        privacy: privacyProjection(),
        risks: [
          "Unsubscription permanently deletes the exact Channel Follower webhook and stops future announcement delivery",
          "Messages already delivered through the subscription are not removed",
          "A transport failure after Discord accepts the deletion can leave an uncertain outcome",
        ],
        schemaVersion: SCHEMA_VERSION,
        source: null,
        status: "planned",
        target: targetEndpoint(target),
        warnings: [
          ...(current.sourceIdentity === "unavailable"
            ? ["Discord no longer exposes the source guild or channel identity for this exact subscription"]
            : []),
          ...(current.sourceIdentity === "redacted"
            ? ["The source guild and channel identity for this exact subscription is outside local read scope"]
            : []),
          ...(target.permissions.administrator
            ? ["Discord connector bot has ADMINISTRATOR in the target guild; replace it with narrowly scoped VIEW_CHANNEL and MANAGE_WEBHOOKS permissions"]
            : []),
          "Restoring delivery requires a separate reviewed subscribe action and creates a different webhook ID",
          "Discord names are untrusted transient display data and are never persisted by this workflow",
          "The MCP facade durably coordinates exact targets; direct service consumers must provide equivalent cross-process exclusion",
          "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
        ],
        writeRequired: true,
      },
      targetInventory: target.webhooks,
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: AnnouncementSubscriptionRequest,
    options: RequestOptions = {},
  ): Promise<AnnouncementSubscriptionPlan> {
    const planning = await this.#buildPlan(
      applicationId,
      botId,
      normalizeAnnouncementSubscriptionRequest(request),
      options,
    )
    return planning.plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: AnnouncementSubscriptionRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<AnnouncementSubscriptionResult> {
    const normalized = normalizeAnnouncementSubscriptionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord announcement subscription plan digest is invalid")
    }
    return withTargetLock(
      `channel:${normalized.targetChannelId}`,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new AnnouncementSubscriptionExecutionError(
        "Discord announcement subscription change was blocked because a prior same-target operation ended with an uncertain outcome",
        {
          action: normalized.action,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
          targetChannelId: normalized.targetChannelId,
          webhookId: normalized.action === "unsubscribe"
            ? normalized.webhookId
            : null,
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedAnnouncementSubscriptionRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<AnnouncementSubscriptionResult> {
    let plan: AnnouncementSubscriptionPlan
    let targetInventory: AnnouncementSubscriptionWebhookSnapshot[]
    try {
      const planning = await this.#buildPlan(applicationId, botId, request, options)
      plan = planning.plan
      targetInventory = planning.targetInventory
    } catch (error) {
      if (
        error instanceof AnnouncementSubscriptionEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new AnnouncementSubscriptionPlanChangedError(
          expectedDigest,
          STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new AnnouncementSubscriptionPlanChangedError(
        expectedDigest,
        plan.digest,
      )
    }
    const sourceChannelId = request.action === "subscribe"
      ? request.sourceChannelId
      : plan.current?.sourceChannelId ?? null
    const sourceGuildId = request.action === "subscribe"
      ? plan.source?.guild.id ?? null
      : plan.current?.sourceGuildId ?? null
    const baseResult = {
      action: request.action,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      sourceChannelId,
      sourceGuildId,
      targetChannelId: request.targetChannelId,
      targetGuildId: plan.target.guild.id,
    }
    if (!plan.writeRequired && plan.current) {
      return {
        ...baseResult,
        activityId: null,
        inventoryMatched: true,
        readbackMatched: true,
        responseMatched: null,
        status: "already-current",
        verifiedAbsent: false,
        webhookId: plan.current.webhookId,
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
      throw new AnnouncementSubscriptionOperationConflictError(
        receiptView(reservation.receipt),
      )
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
      throw new AnnouncementSubscriptionExecutionError(
        "Discord announcement subscription change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
          webhookId: request.action === "unsubscribe" ? request.webhookId : null,
        },
        { cause: error },
      )
    }

    let inventoryMatched: boolean | null = null
    let mutationAccepted = false
    let readbackMatched: boolean | null = null
    let responseMatched: boolean | null = null
    let verifiedAbsent: boolean | null = null
    let webhookId = request.action === "unsubscribe" ? request.webhookId : null
    try {
      if (request.action === "subscribe") {
        const response = await this.#client.followAnnouncementChannel(
          request.sourceChannelId,
          request.targetChannelId,
          request.auditReason,
          options,
        )
        mutationAccepted = true
        webhookId = response.webhookId
        responseMatched = response.sourceChannelId === request.sourceChannelId
        if (!responseMatched || !validSnowflake(webhookId)) {
          throw evidenceError(
            "Discord returned announcement subscription state that does not match the request",
          )
        }
        const readback = this.#projectInventory(
          await this.#client.listChannelWebhooks(request.targetChannelId, options),
          request.targetChannelId,
          plan.target.guild.id,
        )
        const observed = readback.find((entry) => entry.webhookId === webhookId)
        readbackMatched = observed?.type === "channel-follower"
          && observed.sourceChannelId === request.sourceChannelId
          && observed.sourceGuildId === plan.source?.guild.id
        if (!readbackMatched || !observed) {
          throw evidenceError(
            "Discord announcement subscription could not be verified in target readback",
          )
        }
        inventoryMatched = sameInventory(
          readback,
          sortInventory([...targetInventory, observed]),
        )
        verifiedAbsent = false
      } else {
        await this.#client.deleteWebhook(
          request.webhookId,
          request.auditReason,
          options,
        )
        mutationAccepted = true
        const readback = this.#projectInventory(
          await this.#client.listChannelWebhooks(request.targetChannelId, options),
          request.targetChannelId,
          plan.target.guild.id,
        )
        verifiedAbsent = !readback.some(
          (entry) => entry.webhookId === request.webhookId,
        )
        readbackMatched = verifiedAbsent
        responseMatched = null
        if (!verifiedAbsent) {
          throw evidenceError(
            "Discord announcement subscription remained in target readback after deletion",
          )
        }
        inventoryMatched = sameInventory(
          readback,
          targetInventory.filter(
            (entry) => entry.webhookId !== request.webhookId,
          ),
        )
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
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          webhookId,
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
          webhookId,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AnnouncementSubscriptionExecutionError(
        "Discord announcement subscription change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          inventoryMatched,
          operationRecordError,
          readbackMatched,
          responseMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
          verifiedAbsent,
          webhookId,
        },
        { cause: error },
      )
    }

    if (!webhookId) {
      throw evidenceError("Discord announcement subscription webhook identity is unavailable")
    }
    const verification = inventoryMatched ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: AnnouncementSubscriptionResult = {
      ...baseResult,
      activityId,
      inventoryMatched: inventoryMatched === true,
      readbackMatched: readbackMatched === true,
      responseMatched,
      status,
      verifiedAbsent: verifiedAbsent === true,
      webhookId,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
        webhookId,
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
          webhookId,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AnnouncementSubscriptionExecutionError(
        "Discord announcement subscription change completed but the operation receipt failed",
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
        webhookId,
      }))
    } catch (error) {
      throw new AnnouncementSubscriptionExecutionError(
        "Discord announcement subscription change completed but the final activity record failed",
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
