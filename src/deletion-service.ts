import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  DeletionActivity,
  DeletionActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
} from "./discord-client.js"
import {
  DeletionExecutionError,
  DeletionOperationConflictError,
  DeletionPlanChangedError,
  DiscordApiError,
} from "./errors.js"
import {
  deletionPreview,
  deletionSnapshot,
  discordMessageUrl,
} from "./normalize.js"
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
  DiscordMessage,
  DiscordRole,
  DiscordThreadMember,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "message-deletion-state-unavailable"
const AUTO_MODERATION_ACTION_MESSAGE_TYPE = 24
const DISCORD_EPOCH_MS = 1_420_070_400_000n
const MAX_MESSAGE_ATTACHMENTS = 10
const SNOWFLAKE_TIMESTAMP_SHIFT = 22n
const ISO_8601_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
const DELETABLE_MESSAGE_TYPES: ReadonlySet<number> = new Set([
  0,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  22,
  23,
  AUTO_MODERATION_ACTION_MESSAGE_TYPE,
  25,
  26,
  27,
  28,
  29,
  31,
  32,
  36,
  37,
  38,
  39,
  44,
  46,
])
const DELETION_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const THREAD_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const THREAD_PARENT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])
const VOICE_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
])

export interface DeletionRequest {
  auditReason: string
  channelId: string
  messageIds: readonly string[]
  operationKey: string
}

export type DeletionMessageContentIntent = "disabled" | "enabled" | "unknown"

export interface NormalizedDeletionRequest {
  auditReason: string
  channelId: string
  messageIds: string[]
  operationKeyHash: string
}

export interface DeletionOperation {
  kind: "bulk" | "individual"
  messageIds: string[]
}

export interface DeletionPermissionEvidence {
  administrator: boolean
  canReadMessages: true
  confidence: "complete"
  connect: boolean | null
  effectivePermissions: string
  manageMessages: boolean
  permissionSourceChannelId: string
  privateThreadAccess: "lookup-succeeded" | "not-applicable"
  readMessageHistory: true
  requiredPermissionNames: Array<
    "CONNECT" | "MANAGE_MESSAGES" | "READ_MESSAGE_HISTORY" | "VIEW_CHANNEL"
  >
  viewChannel: true
}

export interface DeletionPlan {
  application: {
    id: string
    messageContentIntent: DeletionMessageContentIntent
  }
  auditReason: string
  bot: {
    id: string
  }
  channel: {
    id: string
    name: string | null
    parentId: string | null
    type: number
  }
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  messageIds: string[]
  messages: Array<ReturnType<typeof deletionPreview> & {
    type: number
    url: string
  }>
  operationKeyHash: string
  operations: DeletionOperation[]
  permission: DeletionPermissionEvidence
  privacy: {
    persistence: "content-free"
    previews: "transient-untrusted"
  }
  schemaVersion: number
  status: "planned"
  warnings: string[]
}

export interface DeletionResult {
  activityId: string
  channelId: string
  deletedMessageIds: string[]
  guildId: string
  observedAbsentMessageIds: string[]
  operationKeyHash: string
  planDigest: string
  remainingMessageIds: []
  schemaVersion: number
  status: "completed" | "completed-with-drift"
  verifiedAbsent: true
}

export interface DeletionServiceClient extends Pick<
  DiscordClient,
  | "bulkDeleteMessages"
  | "deleteMessage"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "getMessage"
  | "getThreadMember"
> {}

export interface DeletionServiceOptions {
  activityStore: ActivityStore
  client: DeletionServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface DeletionState {
  botMember: DiscordGuildMember
  channel: DiscordChannel
  guild: DiscordGuild
  guildId: string
  messages: DiscordMessage[]
  operations: DeletionOperation[]
  permissionChannel: DiscordChannel
  permissions: BotChannelPermissionResult & { confidence: "complete" }
  roles: DiscordRole[]
}

interface BuiltDeletionPlan {
  plan: DeletionPlan
  state: DeletionState
}

interface DeletionObservation {
  absentMessageIds: string[]
  presentMessageIds: string[]
}

class DeletionEvidenceError extends Error {
  override name = "DeletionEvidenceError"
}

function evidenceError(message: string, cause?: unknown): DeletionEvidenceError {
  return new DeletionEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, description: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${description} must be an exact positive Discord snowflake`)
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && ISO_8601_TIMESTAMP_PATTERN.test(value)
    && !Number.isNaN(Date.parse(value))
}

function validText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > maximum
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function validOptionalText(value: unknown, maximum: number): boolean {
  if (value === undefined || value === null) return true
  if (typeof value !== "string" || [...value].length > maximum) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function validAttachments(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value) || value.length > MAX_MESSAGE_ATTACHMENTS) return false
  return value.every((attachment) => (
    attachment
    && typeof attachment === "object"
    && !Array.isArray(attachment)
    && positiveSnowflake(attachment.id)
    && validText(
      attachment.filename,
      DISCORD_LIMITS.attachmentFilenameCharacters,
    )
    && Number.isSafeInteger(attachment.size)
    && attachment.size >= 0
    && validOptionalText(
      attachment.description,
      DISCORD_LIMITS.attachmentDescriptionCharacters,
    )
    && validOptionalText(attachment.content_type, 255)
  ))
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  if (leftValue < rightValue) return -1
  if (leftValue > rightValue) return 1
  return 0
}

export function normalizeMessageIds(messageIds: readonly string[]): string[] {
  if (
    !Array.isArray(messageIds)
    || messageIds.length < 1
    || messageIds.length > DISCORD_LIMITS.deletionMessages
  ) {
    throw new RangeError(
      `Discord deletion requires between 1 and ${DISCORD_LIMITS.deletionMessages} message IDs`,
    )
  }
  if (messageIds.some((messageId) => !positiveSnowflake(messageId))) {
    throw new RangeError("Discord deletion message IDs must be exact positive snowflakes")
  }
  const normalized = [...messageIds].sort(compareSnowflakes)
  if (new Set(normalized).size !== normalized.length) {
    throw new RangeError("Discord deletion message IDs must be unique")
  }
  return normalized
}

export function normalizeDeletionRequest(
  request: DeletionRequest,
): NormalizedDeletionRequest {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord message deletion request must be an object")
  }
  assertPositiveSnowflake(request.channelId, "Discord deletion channel ID")
  if (typeof request.auditReason !== "string" || request.auditReason.trim().length < 1) {
    throw new RangeError("Discord deletion audit reason must not be blank")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    channelId: request.channelId,
    messageIds: normalizeMessageIds(request.messageIds),
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function messageTime(message: DiscordMessage): number {
  const timestamp = Date.parse(message.timestamp)
  if (Number.isNaN(timestamp)) {
    throw evidenceError(`Discord message ${message.id} has an invalid timestamp`)
  }
  return timestamp
}

function messageSnowflakeTime(message: DiscordMessage): number {
  return Number((BigInt(message.id) >> SNOWFLAKE_TIMESTAMP_SHIFT) + DISCORD_EPOCH_MS)
}

export function deletionOperations(
  messages: readonly DiscordMessage[],
  now: Date,
  bulkAllowed = true,
): DeletionOperation[] {
  const bulkCutoff = now.getTime()
    - DISCORD_LIMITS.bulkDeleteAgeMs
    + DISCORD_LIMITS.bulkDeleteSafetyMarginMs
  const recent: string[] = []
  const individual: string[] = []
  for (const message of messages) {
    const oldestCreationEvidence = Math.min(
      messageTime(message),
      messageSnowflakeTime(message),
    )
    if (bulkAllowed && oldestCreationEvidence >= bulkCutoff) recent.push(message.id)
    else individual.push(message.id)
  }

  const operations: DeletionOperation[] = []
  if (recent.length >= 2) {
    operations.push({ kind: "bulk", messageIds: recent.sort(compareSnowflakes) })
  } else {
    individual.push(...recent)
  }
  if (individual.length > 0) {
    operations.push({
      kind: "individual",
      messageIds: individual.sort(compareSnowflakes),
    })
  }
  return operations
}

function exactChannel(
  channel: DiscordChannel,
  channelId: string,
  description: string,
  allowedTypes: ReadonlySet<number> = DELETION_CHANNEL_TYPES,
): DiscordChannel {
  if (
    !channel
    || typeof channel !== "object"
    || Array.isArray(channel)
    || channel.id !== channelId
    || !Number.isSafeInteger(channel.type)
    || !allowedTypes.has(channel.type)
    || !positiveSnowflake(channel.guild_id)
    || !validText(channel.name, DISCORD_LIMITS.channelNameCharacters)
    || (
      channel.parent_id !== undefined
      && channel.parent_id !== null
      && !positiveSnowflake(channel.parent_id)
    )
    || (
      channel.permission_overwrites !== undefined
      && !Array.isArray(channel.permission_overwrites)
    )
  ) {
    throw evidenceError(`Discord returned invalid ${description} channel evidence`)
  }
  return channel
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || !validText(guild.name, DISCORD_LIMITS.channelNameCharacters)
  ) {
    throw evidenceError("Discord returned invalid deletion guild evidence")
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
    || member.roles.some((roleId) => !positiveSnowflake(roleId))
    || !member.user
    || member.user.id !== botId
    || member.user.bot !== true
  ) {
    throw evidenceError("Discord returned invalid connector bot deletion member evidence")
  }
  return member
}

function exactRoles(value: readonly DiscordRole[], guildId: string): DiscordRole[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded deletion role inventory")
  }
  const ids = new Set<string>()
  const roles = value.map((role) => {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || !validText(role.name, DISCORD_LIMITS.roleNameCharacters)
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/.test(role.permissions)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || ids.has(role.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate deletion role evidence")
    }
    ids.add(role.id)
    return role
  })
  const everyone = roles.find((role) => role.id === guildId)
  if (
    !everyone
    || everyone.name !== "@everyone"
    || everyone.managed
    || everyone.position !== 0
  ) {
    throw evidenceError("Discord returned invalid deletion @everyone role evidence")
  }
  return [...roles].sort((left, right) => left.id.localeCompare(right.id))
}

function exactPrivateThreadMember(
  member: DiscordThreadMember,
  threadId: string,
  botId: string,
): void {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || member.id !== threadId
    || member.user_id !== botId
    || !Number.isSafeInteger(member.flags)
    || member.flags < 0
    || !validTimestamp(member.join_timestamp)
  ) {
    throw evidenceError("Discord returned mismatched private-thread deletion membership evidence")
  }
}

function exactMessage(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId: string,
): DiscordMessage {
  if (
    !message
    || typeof message !== "object"
    || Array.isArray(message)
    || message.id !== messageId
    || message.channel_id !== channelId
    || (message.guild_id !== undefined && message.guild_id !== guildId)
    || !message.author
    || !positiveSnowflake(message.author.id)
    || !validText(message.author.username, DISCORD_LIMITS.channelNameCharacters)
    || (
      message.author.bot !== undefined
      && typeof message.author.bot !== "boolean"
    )
    || (
      message.author.global_name !== undefined
      && message.author.global_name !== null
      && !validText(message.author.global_name, DISCORD_LIMITS.channelNameCharacters)
    )
    || typeof message.content !== "string"
    || !Array.isArray(message.attachments)
    || !validAttachments(message.attachments)
    || (message.components !== undefined && !Array.isArray(message.components))
    || !Array.isArray(message.embeds)
    || (
      message.edited_timestamp !== undefined
      && message.edited_timestamp !== null
      && !validTimestamp(message.edited_timestamp)
    )
    || (
      message.flags !== undefined
      && (!Number.isSafeInteger(message.flags) || message.flags < 0)
    )
    || !validTimestamp(message.timestamp)
    || !Number.isSafeInteger(message.type)
    || !DELETABLE_MESSAGE_TYPES.has(message.type)
  ) {
    throw evidenceError("Discord returned incomplete, mismatched, or non-deletable message evidence")
  }
  return message
}

function relevantRoleSnapshot(
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

function overwriteSnapshot(channel: DiscordChannel) {
  return (channel.permission_overwrites || [])
    .map((overwrite) => ({
      allow: overwrite.allow,
      deny: overwrite.deny,
      id: overwrite.id,
      type: overwrite.type,
    }))
    .sort((left, right) => (
      left.type - right.type || left.id.localeCompare(right.id)
    ))
}

function hasPermission(
  result: BotChannelPermissionResult,
  permission: "CONNECT" | "MANAGE_MESSAGES" | "READ_MESSAGE_HISTORY" | "VIEW_CHANNEL",
): boolean {
  return result.effectivePermissionNames.includes(permission)
}

function requiredPermissionNames(
  channel: DiscordChannel,
  messages: readonly DiscordMessage[],
  botId: string,
  bulk: boolean,
): DeletionPermissionEvidence["requiredPermissionNames"] {
  const required: DeletionPermissionEvidence["requiredPermissionNames"] = [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
  ]
  if (VOICE_CHANNEL_TYPES.has(channel.type)) required.push("CONNECT")
  if (
    bulk
    || messages.some((message) => (
      message.author.id !== botId
      || message.type === AUTO_MODERATION_ACTION_MESSAGE_TYPE
    ))
  ) {
    required.push("MANAGE_MESSAGES")
  }
  return required
}

function permissionEvidence(
  permissions: BotChannelPermissionResult,
  required: DeletionPermissionEvidence["requiredPermissionNames"],
): DeletionPermissionEvidence {
  return {
    administrator: permissions.administrator,
    canReadMessages: true,
    confidence: "complete",
    connect: required.includes("CONNECT")
      ? hasPermission(permissions, "CONNECT")
      : null,
    effectivePermissions: permissions.effectivePermissions,
    manageMessages: hasPermission(permissions, "MANAGE_MESSAGES"),
    permissionSourceChannelId: permissions.permissionSourceChannelId,
    privateThreadAccess: permissions.privateThreadAccess,
    readMessageHistory: true,
    requiredPermissionNames: required,
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
    channelId: receipt.resourceId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  deletedMessageIds?: readonly string[]
  error?: string | null
  failedMessageId?: string | null
  guildId: string
  observedAbsentMessageIds?: readonly string[]
  observedPresentMessageIds?: readonly string[]
  plan: DeletionPlan
  request: NormalizedDeletionRequest
  status: DeletionActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): DeletionActivity {
  return {
    channelId: options.request.channelId,
    deletedMessageIds: [...(options.deletedMessageIds || [])],
    error: options.error ?? null,
    failedMessageId: options.failedMessageId ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "message-deletion",
    messageIds: [...options.request.messageIds],
    observedAbsentMessageIds: [...(options.observedAbsentMessageIds || [])],
    observedPresentMessageIds: [...(options.observedPresentMessageIds || [])],
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    strategies: options.plan.operations.map((operation) => (
      `${operation.kind}:${operation.messageIds.length}`
    )),
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: DeletionPlan
  request: NormalizedDeletionRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "message-deletion",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.channelId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function settledClientFailure(error: unknown): boolean {
  return error instanceof DiscordApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429
}

export class DeletionService {
  readonly #activityStore: ActivityStore
  readonly #client: DeletionServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: DeletionServiceOptions) {
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
    request: NormalizedDeletionRequest,
    options: RequestOptions,
  ): Promise<DeletionState> {
    const channel = exactChannel(
      await this.#client.getChannel(request.channelId, options),
      request.channelId,
      "deletion target",
    )
    const guildId = this.#policy.assertChannelDeletable(channel)
    const existingReceipt = await this.#operationStore.get(
      "message-deletion",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new DeletionOperationConflictError(receiptView(existingReceipt))
    }

    let permissionChannel = channel
    if (THREAD_TYPES.has(channel.type)) {
      if (!channel.parent_id) {
        throw evidenceError("Discord deletion target thread omitted its parent channel ID")
      }
      permissionChannel = exactChannel(
        await this.#client.getChannel(channel.parent_id, options),
        channel.parent_id,
        "deletion permission source",
        THREAD_PARENT_TYPES,
      )
      if (
        permissionChannel.guild_id !== guildId
        || THREAD_TYPES.has(permissionChannel.type)
        || !THREAD_PARENT_TYPES.has(permissionChannel.type)
      ) {
        throw evidenceError("Discord returned an invalid deletion permission source")
      }
      if (channel.type === DISCORD_CHANNEL_TYPES.privateThread) {
        exactPrivateThreadMember(
          await this.#client.getThreadMember(channel.id, botId, options),
          channel.id,
          botId,
        )
      }
    }

    const [rawGuild, rawBotMember, rawRoles] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawBotMember, botId)
    const roles = exactRoles(rawRoles, guildId)
    const messages: DiscordMessage[] = []
    for (const messageId of request.messageIds) {
      messages.push(exactMessage(
        await this.#client.getMessage(request.channelId, messageId, options),
        request.channelId,
        guildId,
        messageId,
      ))
    }
    messages.sort((left, right) => compareSnowflakes(left.id, right.id))

    let permissions: BotChannelPermissionResult
    try {
      permissions = evaluateBotChannelPermissions({
        botId,
        channel,
        guildId,
        member: botMember,
        permissionChannel,
        roles,
      })
    } catch (error) {
      throw evidenceError("Discord returned invalid deletion permission evidence", error)
    }
    if (permissions.confidence !== "complete") {
      throw evidenceError(
        `Discord returned incomplete deletion permission evidence: ${permissions.warnings.join("; ")}`,
      )
    }
    if (permissions.canReadMessages !== true) {
      throw evidenceError("Discord connector bot lacks channel-level message-read prerequisites")
    }
    for (const permission of ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"] as const) {
      if (!hasPermission(permissions, permission)) {
        throw evidenceError(`Discord connector bot lacks channel-level ${permission}`)
      }
    }
    if (VOICE_CHANNEL_TYPES.has(channel.type) && !hasPermission(permissions, "CONNECT")) {
      throw evidenceError("Discord connector bot lacks channel-level CONNECT")
    }

    const manageMessages = hasPermission(permissions, "MANAGE_MESSAGES")
    if (
      !manageMessages
      && messages.some((message) => (
        message.author.id !== botId
        || message.type === AUTO_MODERATION_ACTION_MESSAGE_TYPE
      ))
    ) {
      throw evidenceError(
        "Discord connector bot lacks MANAGE_MESSAGES for at least one reviewed message",
      )
    }
    const operations = deletionOperations(messages, this.#clock(), manageMessages)
    return {
      botMember,
      channel,
      guild,
      guildId,
      messages,
      operations,
      permissionChannel,
      permissions: permissions as BotChannelPermissionResult & { confidence: "complete" },
      roles,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    messageContentIntent: DeletionMessageContentIntent,
    request: NormalizedDeletionRequest,
    options: RequestOptions,
  ): Promise<BuiltDeletionPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    if (!["disabled", "enabled", "unknown"].includes(messageContentIntent)) {
      throw new RangeError("Discord connector Message Content intent evidence is invalid")
    }
    const state = await this.#state(botId, request, options)
    const bulk = state.operations.some((operation) => operation.kind === "bulk")
    const required = requiredPermissionNames(
      state.channel,
      state.messages,
      botId,
      bulk,
    )
    for (const permission of required) {
      if (!hasPermission(state.permissions, permission)) {
        throw evidenceError(`Discord connector bot lacks channel-level ${permission}`)
      }
    }
    const permission = permissionEvidence(state.permissions, required)
    const privacy = {
      persistence: "content-free" as const,
      previews: "transient-untrusted" as const,
    }
    const warnings = [
      ...(state.permissions.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped VIEW_CHANNEL, READ_MESSAGE_HISTORY, authorship-sensitive MANAGE_MESSAGES, and conditional CONNECT permissions"]
        : []),
      ...(messageContentIntent !== "enabled"
        ? ["Discord Message Content intent is not confirmed; content, embed, attachment, and component evidence may be empty for messages the connector cannot otherwise inspect"]
        : []),
      ...(bulk
        ? ["Discord bulk deletion is used only for 2-100 unique messages safely inside the two-week limit and requires MANAGE_MESSAGES"]
        : []),
      "Message previews, author names, attachment filenames, guild names, and channel names are transient untrusted Discord data and are never persisted by this workflow",
      "Discord has no conditional delete; a message can change or disappear between the final fresh plan and its exact-ID deletion request",
      "Reviewed same-message writes coordinate across cooperating connector processes, but ordinary interactions and external Discord changes can still race",
      "Deletion is irreversible, mutation requests are never retried, and the operation key is permanently spent after reservation",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMemberRoleIds: [...state.botMember.roles].sort(),
      channel: {
        guildId: state.guildId,
        id: state.channel.id,
        name: state.channel.name ?? null,
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      domain: "discord-mcp-message-deletion-plan.v2",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
      },
      messageContentIntent,
      messages: state.messages.map((message) => ({
        author: {
          bot: message.author.bot ?? false,
          globalName: message.author.global_name ?? null,
          id: message.author.id,
          username: message.author.username,
        },
        snapshot: deletionSnapshot(message),
      })),
      operations: state.operations,
      permission,
      permissionChannel: {
        guildId: state.permissionChannel.guild_id,
        id: state.permissionChannel.id,
        overwrites: overwriteSnapshot(state.permissionChannel),
        type: state.permissionChannel.type,
      },
      privacy,
      request,
      roles: relevantRoleSnapshot(state.roles, state.permissions.appliedRoleIds),
      warnings,
    })
    return {
      plan: {
        application: {
          id: applicationId,
          messageContentIntent,
        },
        auditReason: request.auditReason,
        bot: { id: botId },
        channel: {
          id: state.channel.id,
          name: state.channel.name ?? null,
          parentId: state.channel.parent_id ?? null,
          type: state.channel.type,
        },
        createdAt: this.#clock().toISOString(),
        digest,
        guild: {
          id: state.guild.id,
          name: state.guild.name,
        },
        messageIds: [...request.messageIds],
        messages: state.messages.map((message) => ({
          ...deletionPreview(message),
          type: message.type,
          url: discordMessageUrl(state.guildId, state.channel.id, message.id),
        })),
        operationKeyHash: request.operationKeyHash,
        operations: state.operations,
        permission,
        privacy,
        schemaVersion: SCHEMA_VERSION,
        status: "planned",
        warnings,
      },
      state,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    messageContentIntent: DeletionMessageContentIntent,
    request: DeletionRequest,
    options: RequestOptions = {},
  ): Promise<DeletionPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      messageContentIntent,
      normalizeDeletionRequest(request),
      options,
    ).then((built) => built.plan)
  }

  async #observe(
    guildId: string,
    request: NormalizedDeletionRequest,
    options: RequestOptions,
  ): Promise<DeletionObservation> {
    const absentMessageIds: string[] = []
    const presentMessageIds: string[] = []
    for (const messageId of request.messageIds) {
      try {
        exactMessage(
          await this.#client.getMessage(request.channelId, messageId, options),
          request.channelId,
          guildId,
          messageId,
        )
        presentMessageIds.push(messageId)
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 404) {
          absentMessageIds.push(messageId)
          continue
        }
        throw error
      }
    }
    return { absentMessageIds, presentMessageIds }
  }

  async #finishFailure(options: {
    activityId: string
    deletedMessageIds: readonly string[]
    error: unknown
    failedMessageId: string | null
    guildId: string
    observation: DeletionObservation | null
    plan: DeletionPlan
    request: NormalizedDeletionRequest
    status: "failed" | "partial" | "uncertain"
  }): Promise<never> {
    const errorCode = safeErrorCode(options.error)
    let operationRecordError: string | null = null
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId: options.activityId,
        error: errorCode,
        guildId: options.guildId,
        plan: options.plan,
        request: options.request,
        status: options.status === "uncertain" ? "uncertain" : "failed",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (receiptError) {
      operationRecordError = safeErrorCode(receiptError)
    }
    let activityRecordError: string | null = null
    try {
      await this.#activityStore.append(activityEntry({
        activityId: options.activityId,
        deletedMessageIds: options.deletedMessageIds,
        error: errorCode,
        failedMessageId: options.failedMessageId,
        guildId: options.guildId,
        ...(options.observation
          ? {
              observedAbsentMessageIds: options.observation.absentMessageIds,
              observedPresentMessageIds: options.observation.presentMessageIds,
            }
          : {}),
        plan: options.plan,
        request: options.request,
        status: options.status,
        timestamp: this.#clock().toISOString(),
      }))
    } catch (activityError) {
      activityRecordError = safeErrorCode(activityError)
    }
    throw new DeletionExecutionError(
      options.status === "uncertain"
        ? "Discord message deletion did not complete with an observable terminal state"
        : "Discord message deletion did not remove every reviewed target",
      {
        activityId: options.activityId,
        activityRecordError,
        channelId: options.request.channelId,
        deletedMessageIds: [...options.deletedMessageIds],
        error: errorCode,
        failedMessageId: options.failedMessageId,
        guildId: options.guildId,
        observedAbsentMessageIds: [...(options.observation?.absentMessageIds || [])],
        operationKeyHash: options.request.operationKeyHash,
        operationRecordError,
        planDigest: options.plan.digest,
        remainingMessageIds: [...(options.observation?.presentMessageIds || [])],
        retryAfterMs: options.error instanceof DiscordApiError
          ? options.error.retryAfterMs ?? null
          : null,
        schemaVersion: SCHEMA_VERSION,
        status: options.status,
        verifiedAbsent: false,
      },
      { cause: options.error },
    )
  }

  async execute(
    applicationId: string,
    botId: string,
    messageContentIntent: DeletionMessageContentIntent,
    requestValue: DeletionRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<DeletionResult> {
    const request = normalizeDeletionRequest(requestValue)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord message deletion plan digest is invalid")
    }
    let built: BuiltDeletionPlan
    try {
      built = await this.#buildPlan(
        applicationId,
        botId,
        messageContentIntent,
        request,
        options,
      )
    } catch (error) {
      if (
        error instanceof DeletionEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new DeletionPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new DeletionPlanChangedError(expectedDigest, plan.digest)
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      guildId: state.guildId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new DeletionOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        guildId: state.guildId,
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
          guildId: state.guildId,
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new DeletionExecutionError(
        "Discord message deletion was blocked because pending activity could not be recorded",
        {
          activityId,
          channelId: request.channelId,
          deletedMessageIds: [],
          error: safeErrorCode(error),
          guildId: state.guildId,
          observedAbsentMessageIds: [],
          operationKeyHash: request.operationKeyHash,
          operationRecordError,
          planDigest: plan.digest,
          remainingMessageIds: [...request.messageIds],
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-audit-failed",
          verifiedAbsent: false,
        },
        { cause: error },
      )
    }

    const deletedMessageIds: string[] = []
    let failedMessageId: string | null = null
    let mutationError: unknown = null
    try {
      for (const operation of plan.operations) {
        if (operation.kind === "bulk") {
          await this.#client.bulkDeleteMessages(
            request.channelId,
            operation.messageIds,
            request.auditReason,
            options,
          )
          deletedMessageIds.push(...operation.messageIds)
          continue
        }
        for (const messageId of operation.messageIds) {
          failedMessageId = messageId
          await this.#client.deleteMessage(
            request.channelId,
            messageId,
            request.auditReason,
            options,
          )
          deletedMessageIds.push(messageId)
          failedMessageId = null
        }
      }
    } catch (error) {
      mutationError = error
    }

    let observation: DeletionObservation
    try {
      observation = await this.#observe(state.guildId, request, options)
    } catch (error) {
      return this.#finishFailure({
        activityId,
        deletedMessageIds,
        error,
        failedMessageId,
        guildId: state.guildId,
        observation: null,
        plan,
        request,
        status: "uncertain",
      })
    }

    if (observation.presentMessageIds.length > 0) {
      const ambiguous = mutationError !== null && !settledClientFailure(mutationError)
      const status = ambiguous
        ? "uncertain"
        : observation.absentMessageIds.length > 0
          ? "partial"
          : "failed"
      return this.#finishFailure({
        activityId,
        deletedMessageIds,
        error: mutationError || new DeletionEvidenceError("DeletionTargetRemained"),
        failedMessageId,
        guildId: state.guildId,
        observation,
        plan,
        request,
        status,
      })
    }

    const verification = mutationError === null ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: DeletionResult = {
      activityId,
      channelId: request.channelId,
      deletedMessageIds,
      guildId: state.guildId,
      observedAbsentMessageIds: observation.absentMessageIds,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      remainingMessageIds: [],
      schemaVersion: SCHEMA_VERSION,
      status,
      verifiedAbsent: true,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: state.guildId,
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
          deletedMessageIds,
          error: safeErrorCode(error),
          guildId: state.guildId,
          observedAbsentMessageIds: observation.absentMessageIds,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new DeletionExecutionError(
        "Discord messages were deleted but the operation receipt failed",
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
        deletedMessageIds,
        error: mutationError === null ? null : safeErrorCode(mutationError),
        guildId: state.guildId,
        observedAbsentMessageIds: observation.absentMessageIds,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new DeletionExecutionError(
        "Discord messages were deleted but the final activity record failed",
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
