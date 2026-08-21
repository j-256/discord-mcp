import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  MessagePinActivity,
  MessagePinActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type MessagePinPageOptions,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  MessagePinExecutionError,
  MessagePinOperationConflictError,
  MessagePinPlanChangedError,
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
import {
  deletionSnapshot,
  deletionPreview,
  discordMessageUrl,
  normalizeChannel,
  normalizeMessage,
  stableString,
} from "./normalize.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordMessagePinPage,
  DiscordRole,
  DiscordThreadMember,
  RequestOptions,
} from "./types.js"

export const MESSAGE_PIN_STATES = ["pinned", "unpinned"] as const

export type MessagePinState = typeof MESSAGE_PIN_STATES[number]

const STATE_UNAVAILABLE = "message-pin-state-unavailable"
const ISO_8601_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
const REQUIRED_PERMISSIONS = [
  "PIN_MESSAGES",
  "READ_MESSAGE_HISTORY",
  "VIEW_CHANNEL",
] as const
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
const PIN_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
type MessagePinTargetOutcome = "settled" | "uncertain"
const MESSAGE_PIN_TARGET_LOCKS = new Map<string, Promise<MessagePinTargetOutcome>>()

export interface MessagePinRequest {
  auditReason: string
  channelId: string
  desiredState: MessagePinState
  messageId: string
  operationKey: string
}

export interface NormalizedMessagePinRequest extends MessagePinRequest {
  desiredPinned: boolean
  operationKeyHash: string
}

export interface MessagePinPlan {
  action: "change" | "none"
  applicationId: string
  auditReason: string
  botId: string
  channel: ReturnType<typeof normalizeChannel>
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  message: ReturnType<typeof deletionPreview> & {
    jumpUrl: string
    pinned: boolean
    type: number
  }
  operationKeyHash: string
  permission: {
    administrator: boolean
    canReadMessages: true
    confidence: "complete"
    effectivePermissions: string
    permissionSourceChannelId: string
    pinMessages: boolean
    privateThreadAccess: "lookup-succeeded" | "not-applicable"
    readMessageHistory: boolean
    viewChannel: boolean
  }
  schemaVersion: number
  status: "already-current" | "planned"
  target: {
    desiredState: MessagePinState
    pinned: boolean
  }
  warnings: string[]
}

export interface MessagePinResult {
  activityId: string | null
  channelId: string
  guildId: string
  messageSnapshotMatched: boolean
  messageId: string
  observedPinned: boolean
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  url: string
}

export interface MessagePinListResult {
  channel: ReturnType<typeof normalizeChannel>
  guildId: string
  page: {
    hasMore: boolean
    nextCursor: string | null
    requestedLimit: number
    returned: number
  }
  pins: Array<{
    message: ReturnType<typeof normalizeMessage>
    pinnedAt: string
  }>
  schemaVersion: number
  status: "ok"
}

export interface MessagePinServiceClient extends Pick<
  DiscordClient,
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "getMessage"
  | "getThreadMember"
  | "listMessagePins"
  | "pinMessage"
  | "unpinMessage"
> {}

export interface MessagePinServiceOptions {
  activityStore: ActivityStore
  client: MessagePinServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface MessagePinStateEvidence {
  botMember: DiscordGuildMember
  channel: DiscordChannel
  guild: DiscordGuild
  guildId: string
  message: DiscordMessage & { pinned: boolean }
  permissionChannel: DiscordChannel
  permissions: BotChannelPermissionResult & { confidence: "complete" }
  roles: DiscordRole[]
}

interface BuiltMessagePinPlan {
  plan: MessagePinPlan
  state: MessagePinStateEvidence
}

class MessagePinStateError extends Error {
  override name = "MessagePinStateError"
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

export function normalizeMessagePinRequest(
  request: MessagePinRequest,
): NormalizedMessagePinRequest {
  if (!request || typeof request !== "object") {
    throw new RangeError("Discord message pin request must be an object")
  }
  assertSnowflake(request.channelId, "Discord message pin channel ID")
  assertSnowflake(request.messageId, "Discord message pin message ID")
  if (!MESSAGE_PIN_STATES.includes(request.desiredState)) {
    throw new RangeError("Discord message pin desired state is not supported")
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord message pin audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    auditReason: request.auditReason,
    channelId: request.channelId,
    desiredPinned: request.desiredState === "pinned",
    desiredState: request.desiredState,
    messageId: request.messageId,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function exactChannel(
  channel: DiscordChannel,
  channelId: string,
  description: string,
): DiscordChannel {
  if (
    !channel
    || typeof channel !== "object"
    || channel.id !== channelId
    || !Number.isSafeInteger(channel.type)
    || (!PIN_CHANNEL_TYPES.has(channel.type) && description === "pin target")
    || (
      channel.guild_id !== undefined
      && !DISCORD_SNOWFLAKE_PATTERN.test(channel.guild_id)
    )
    || (
      channel.parent_id !== undefined
      && channel.parent_id !== null
      && !DISCORD_SNOWFLAKE_PATTERN.test(channel.parent_id)
    )
    || (
      channel.permission_overwrites !== undefined
      && !Array.isArray(channel.permission_overwrites)
    )
  ) {
    throw new MessagePinStateError(`Discord returned invalid ${description} channel evidence`)
  }
  return channel
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !guild
    || typeof guild !== "object"
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
  ) {
    throw new MessagePinStateError("Discord returned incomplete or mismatched pin guild evidence")
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
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || !member.user
    || member.user.id !== botId
  ) {
    throw new MessagePinStateError("Discord returned mismatched connector bot member evidence")
  }
  return member
}

function exactPrivateThreadMember(
  member: DiscordThreadMember,
  threadId: string,
  botId: string,
): void {
  if (
    !member
    || typeof member !== "object"
    || member.id !== threadId
    || member.user_id !== botId
    || !Number.isSafeInteger(member.flags)
    || member.flags < 0
    || typeof member.join_timestamp !== "string"
    || Number.isNaN(Date.parse(member.join_timestamp))
  ) {
    throw new MessagePinStateError("Discord returned mismatched private-thread membership evidence")
  }
}

function exactMessage(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId: string,
): DiscordMessage & { pinned: boolean } {
  if (
    !message
    || typeof message !== "object"
    || message.id !== messageId
    || message.channel_id !== channelId
    || (message.guild_id !== undefined && message.guild_id !== guildId)
    || !message.author
    || !DISCORD_SNOWFLAKE_PATTERN.test(message.author.id)
    || typeof message.content !== "string"
    || typeof message.timestamp !== "string"
    || Number.isNaN(Date.parse(message.timestamp))
    || !Number.isSafeInteger(message.type)
    || typeof message.pinned !== "boolean"
  ) {
    throw new MessagePinStateError("Discord returned incomplete or mismatched message pin evidence")
  }
  return message as DiscordMessage & { pinned: boolean }
}

function exactPinPage(
  page: DiscordMessagePinPage,
  channelId: string,
  guildId: string,
  limit: number,
): Array<{ message: DiscordMessage & { pinned: boolean }; pinnedAt: string }> {
  if (
    !page
    || typeof page !== "object"
    || typeof page.has_more !== "boolean"
    || !Array.isArray(page.items)
    || page.items.length > limit
    || (page.has_more && page.items.length === 0)
  ) {
    throw new MessagePinStateError("Discord returned an invalid message pin page")
  }
  const seen = new Set<string>()
  return page.items.map((item) => {
    if (
      !item
      || typeof item !== "object"
      || typeof item.pinned_at !== "string"
      || !ISO_8601_TIMESTAMP_PATTERN.test(item.pinned_at)
      || Number.isNaN(Date.parse(item.pinned_at))
      || !item.message
      || typeof item.message.id !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(item.message.id)
    ) {
      throw new MessagePinStateError("Discord returned an invalid message pin item")
    }
    if (seen.has(item.message.id)) {
      throw new MessagePinStateError("Discord returned duplicate messages in one pin page")
    }
    seen.add(item.message.id)
    const message = exactMessage(
      item.message,
      channelId,
      guildId,
      item.message.id,
    )
    if (!message.pinned) {
      throw new MessagePinStateError("Discord pin page contained a message not marked pinned")
    }
    return { message, pinnedAt: item.pinned_at }
  })
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
    messageId: receipt.resourceId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  guildId: string
  plan: MessagePinPlan
  request: NormalizedMessagePinRequest
  status: MessagePinActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): MessagePinActivity {
  return {
    channelId: options.request.channelId,
    desiredState: options.request.desiredState,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "message-pin",
    messageId: options.request.messageId,
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
  guildId: string
  plan: MessagePinPlan
  request: NormalizedMessagePinRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "message-pin",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.messageId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof MessagePinExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withTargetLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => MessagePinExecutionError,
): Promise<T> {
  const prior = MESSAGE_PIN_TARGET_LOCKS.get(key)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: MessagePinTargetOutcome) => void = () => undefined
  const tail = new Promise<MessagePinTargetOutcome>((resolve) => {
    release = resolve
  })
  MESSAGE_PIN_TARGET_LOCKS.set(key, tail)
  let outcome: MessagePinTargetOutcome = "settled"
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
    if (MESSAGE_PIN_TARGET_LOCKS.get(key) === tail) {
      MESSAGE_PIN_TARGET_LOCKS.delete(key)
    }
  }
}

export class MessagePinService {
  readonly #activityStore: ActivityStore
  readonly #client: MessagePinServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: MessagePinServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async list(
    channelId: string,
    options: MessagePinPageOptions = {},
  ): Promise<MessagePinListResult> {
    assertSnowflake(channelId, "Discord message pin channel ID")
    const limit = options.limit ?? DISCORD_LIMITS.channelPins
    if (!Number.isInteger(limit) || limit < 1 || limit > DISCORD_LIMITS.channelPins) {
      throw new RangeError(
        `Discord message pin page limit must be an integer between 1 and ${DISCORD_LIMITS.channelPins}`,
      )
    }
    if (
      options.before !== undefined
      && (
        !ISO_8601_TIMESTAMP_PATTERN.test(options.before)
        || Number.isNaN(Date.parse(options.before))
      )
    ) {
      throw new RangeError("Discord message pin cursor must be an ISO 8601 timestamp")
    }
    const channel = exactChannel(
      await this.#client.getChannel(channelId, options),
      channelId,
      "pin target",
    )
    const guildId = this.#policy.assertChannelReadable(channel)
    const page = await this.#client.listMessagePins(channelId, {
      ...(options.before ? { before: options.before } : {}),
      limit,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    const pins = exactPinPage(page, channelId, guildId, limit)
    return {
      channel: normalizeChannel(channel),
      guildId,
      page: {
        hasMore: page.has_more,
        nextCursor: page.has_more
          ? pins[pins.length - 1]?.pinnedAt ?? null
          : null,
        requestedLimit: limit,
        returned: pins.length,
      },
      pins: pins.map((pin) => ({
        message: normalizeMessage(pin.message, guildId),
        pinnedAt: pin.pinnedAt,
      })),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #state(
    botId: string,
    request: NormalizedMessagePinRequest,
    options: RequestOptions,
  ): Promise<MessagePinStateEvidence> {
    const channel = exactChannel(
      await this.#client.getChannel(request.channelId, options),
      request.channelId,
      "pin target",
    )
    const guildId = this.#policy.assertChannelPinManageable(channel)
    const existingReceipt = await this.#operationStore.get(
      "message-pin",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new MessagePinOperationConflictError(receiptView(existingReceipt))
    }

    let permissionChannel = channel
    if (THREAD_TYPES.has(channel.type)) {
      if (!channel.parent_id) {
        throw new MessagePinStateError("Discord pin target thread omitted its parent channel ID")
      }
      permissionChannel = exactChannel(
        await this.#client.getChannel(channel.parent_id, options),
        channel.parent_id,
        "pin permission source",
      )
      if (
        permissionChannel.guild_id !== guildId
        || THREAD_TYPES.has(permissionChannel.type)
        || !THREAD_PARENT_TYPES.has(permissionChannel.type)
      ) {
        throw new MessagePinStateError("Discord returned an invalid pin permission source")
      }
      if (channel.type === DISCORD_CHANNEL_TYPES.privateThread) {
        exactPrivateThreadMember(
          await this.#client.getThreadMember(channel.id, botId, options),
          channel.id,
          botId,
        )
      }
    }

    const [guild, botMember, roles, message] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getMessage(request.channelId, request.messageId, options),
    ])
    exactGuild(guild, guildId)
    exactBotMember(botMember, botId)
    if (!Array.isArray(roles) || roles.length > DISCORD_LIMITS.guildRoles) {
      throw new MessagePinStateError("Discord returned an invalid pin role inventory")
    }
    const exact = exactMessage(message, request.channelId, guildId, request.messageId)
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
      throw new MessagePinStateError(
        `Discord connector bot pin permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    if (permissions.confidence !== "complete") {
      throw new MessagePinStateError(
        `Discord connector bot pin permission evidence is incomplete: ${permissions.warnings.join("; ")}`,
      )
    }
    if (permissions.canReadMessages !== true) {
      throw new MessagePinStateError(
        "Discord connector bot lacks channel-level message-read prerequisites",
      )
    }
    for (const permission of REQUIRED_PERMISSIONS) {
      if (!hasPermission(permissions, permission)) {
        throw new MessagePinStateError(
          `Discord connector bot lacks channel-level ${permission}`,
        )
      }
    }
    return {
      botMember,
      channel,
      guild,
      guildId,
      message: exact,
      permissionChannel,
      permissions: permissions as BotChannelPermissionResult & { confidence: "complete" },
      roles,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedMessagePinRequest,
    options: RequestOptions,
  ): Promise<BuiltMessagePinPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(botId, request, options)
    const action = state.message.pinned === request.desiredPinned ? "none" : "change"
    const digest = reviewedPlanDigest(this.#planKey, {
      action,
      applicationId,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      channel: {
        guildId: state.guildId,
        id: state.channel.id,
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      message: {
        snapshot: deletionSnapshot(state.message),
        pinned: state.message.pinned,
      },
      permissionChannel: {
        guildId: state.permissionChannel.guild_id ?? state.guildId,
        id: state.permissionChannel.id,
        overwrites: overwriteSnapshot(state.permissionChannel),
        type: state.permissionChannel.type,
      },
      permissions: state.permissions.effectivePermissions,
      request,
      roles: relevantRoleSnapshot(state.roles, state.permissions.appliedRoleIds),
    })
    const preview = deletionPreview(state.message)
    const plan: MessagePinPlan = {
      action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      channel: normalizeChannel(state.channel),
      createdAt: this.#clock().toISOString(),
      digest,
      guild: {
        id: state.guildId,
        name: state.guild.name,
      },
      message: {
        ...preview,
        jumpUrl: discordMessageUrl(
          state.guildId,
          request.channelId,
          request.messageId,
        ),
        pinned: state.message.pinned,
        type: state.message.type,
      },
      operationKeyHash: request.operationKeyHash,
      permission: {
        administrator: state.permissions.administrator,
        canReadMessages: true,
        confidence: "complete",
        effectivePermissions: state.permissions.effectivePermissions,
        permissionSourceChannelId: state.permissions.permissionSourceChannelId,
        pinMessages: hasPermission(state.permissions, "PIN_MESSAGES"),
        privateThreadAccess: state.permissions.privateThreadAccess,
        readMessageHistory: hasPermission(state.permissions, "READ_MESSAGE_HISTORY"),
        viewChannel: hasPermission(state.permissions, "VIEW_CHANNEL"),
      },
      schemaVersion: SCHEMA_VERSION,
      status: action === "none" ? "already-current" : "planned",
      target: {
        desiredState: request.desiredState,
        pinned: request.desiredPinned,
      },
      warnings: [
        ...(state.permissions.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped VIEW_CHANNEL, READ_MESSAGE_HISTORY, and PIN_MESSAGES permissions"]
          : []),
        "Message content, author names, filenames, guild names, and channel names are untrusted Discord data and are never persisted by this workflow",
        "Same-target serialization is process-local; do not run multiple connector processes with overlapping pin-management scope",
        "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      ],
    }
    return { plan, state }
  }

  async #planNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedMessagePinRequest,
    options: RequestOptions,
  ): Promise<MessagePinPlan> {
    return (await this.#buildPlan(applicationId, botId, request, options)).plan
  }

  plan(
    applicationId: string,
    botId: string,
    request: MessagePinRequest,
    options: RequestOptions = {},
  ): Promise<MessagePinPlan> {
    return this.#planNormalized(
      applicationId,
      botId,
      normalizeMessagePinRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: MessagePinRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<MessagePinResult> {
    const normalized = normalizeMessagePinRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord message pin plan digest is invalid")
    }
    return withTargetLock(
      `${normalized.channelId}\0${normalized.messageId}`,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new MessagePinExecutionError(
        "Discord message pin change was blocked because a prior same-target operation ended with an uncertain outcome",
        {
          channelId: normalized.channelId,
          messageId: normalized.messageId,
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
    request: NormalizedMessagePinRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<MessagePinResult> {
    let built: BuiltMessagePinPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof MessagePinStateError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new MessagePinPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new MessagePinPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      channelId: request.channelId,
      guildId: plan.guild.id,
      messageId: request.messageId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      url: discordMessageUrl(plan.guild.id, request.channelId, request.messageId),
    }
    if (plan.action === "none") {
      return {
        ...baseResult,
        activityId: null,
        messageSnapshotMatched: true,
        observedPinned: plan.message.pinned,
        status: "already-current",
      }
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
      throw new MessagePinOperationConflictError(receiptView(reservation.receipt))
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
      throw new MessagePinExecutionError(
        "Discord message pin change was blocked because pending activity could not be recorded",
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
    let messageSnapshotMatched: boolean | null = null
    let observedPinned: boolean | null = null
    try {
      if (request.desiredPinned) {
        await this.#client.pinMessage(
          request.channelId,
          request.messageId,
          request.auditReason,
          options,
        )
      } else {
        await this.#client.unpinMessage(
          request.channelId,
          request.messageId,
          request.auditReason,
          options,
        )
      }
      mutationCompleted = true
      const observed = exactMessage(
        await this.#client.getMessage(request.channelId, request.messageId, options),
        request.channelId,
        plan.guild.id,
        request.messageId,
      )
      observedPinned = observed.pinned
      messageSnapshotMatched = stableString(deletionSnapshot(observed))
        === stableString(deletionSnapshot(state.message))
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
      throw new MessagePinExecutionError(
        "Discord message pin change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          messageSnapshotMatched,
          observedPinned,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = observedPinned === request.desiredPinned
      && messageSnapshotMatched
      ? "match"
      : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: MessagePinResult = {
      ...baseResult,
      activityId,
      messageSnapshotMatched,
      observedPinned,
      status,
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
      throw new MessagePinExecutionError(
        "Discord message pin change completed but the operation receipt failed",
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
      throw new MessagePinExecutionError(
        "Discord message pin change completed but the final activity record failed",
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
