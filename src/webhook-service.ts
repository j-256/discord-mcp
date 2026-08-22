import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
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
  type DiscordClient,
  type DiscordWebhookSummary,
} from "./discord-client.js"
import {
  DiscordApiError,
  WebhookDeletionExecutionError,
  WebhookDeletionOperationConflictError,
  WebhookDeletionPlanChangedError,
  WebhookEvidenceError,
} from "./errors.js"
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
  guildId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  verifiedAbsent: boolean
  webhookId: string
}

export interface WebhookServiceClient extends Pick<
  DiscordClient,
  | "deleteWebhook"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "listChannelWebhooks"
> {}

export interface WebhookServiceOptions {
  activityStore: ActivityStore
  client: WebhookServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
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

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof WebhookDeletionExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withTargetLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => WebhookDeletionExecutionError,
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
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: WebhookServiceOptions) {
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
      "Webhook tokens, URLs, avatars, creator profiles, and source objects are projected out and never enter the MCP result",
      "Guild, channel, and webhook names are untrusted Discord data and are never persisted by this workflow",
      "Same-target serialization is process-local; do not run multiple connector processes with overlapping webhook-deletion scope",
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
      normalized.webhookId,
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

    const verification = verifiedAbsent ? "match" : "drift"
    const status = verifiedAbsent ? "completed" : "completed-with-drift"
    const result: WebhookDeletionResult = {
      ...baseResult,
      activityId,
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
