import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  AnnouncementCrosspostActivity,
  AnnouncementCrosspostActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_MESSAGE_TYPES,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  AnnouncementCrosspostExecutionError,
  AnnouncementCrosspostOperationConflictError,
  AnnouncementCrosspostPlanChangedError,
  DiscordApiError,
  errorMessage,
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
  deletionPreview,
  deletionSnapshot,
  discordMessageUrl,
  normalizeChannel,
  stableString,
} from "./normalize.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export type MessageContentIntentStatus = "disabled" | "enabled" | "unknown"

const STATE_UNAVAILABLE = "announcement-crosspost-state-unavailable"
const BASE_REQUIRED_PERMISSIONS = [
  "READ_MESSAGE_HISTORY",
  "SEND_MESSAGES",
  "VIEW_CHANNEL",
] as const
type AnnouncementCrosspostTargetOutcome = "settled" | "uncertain"
const ANNOUNCEMENT_CROSSPOST_TARGET_LOCKS = new Map<
  string,
  Promise<AnnouncementCrosspostTargetOutcome>
>()

export interface AnnouncementCrosspostRequest {
  channelId: string
  messageId: string
  operationKey: string
}

export interface NormalizedAnnouncementCrosspostRequest
  extends AnnouncementCrosspostRequest {
  operationKeyHash: string
}

export interface AnnouncementCrosspostPlan {
  action: "crosspost" | "none"
  applicationId: string
  botId: string
  channel: ReturnType<typeof normalizeChannel>
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  message: ReturnType<typeof deletionPreview> & {
    crossposted: boolean
    flags: number
    jumpUrl: string
    type: number
  }
  messageContentIntent: "enabled"
  operationKeyHash: string
  permission: {
    administrator: boolean
    authorship: "connector-bot" | "other"
    canReadMessages: true
    confidence: "complete"
    effectivePermissions: string
    manageMessages: boolean
    permissionSourceChannelId: string
    readMessageHistory: boolean
    sendMessages: boolean
    viewChannel: boolean
  }
  schemaVersion: number
  status: "already-crossposted" | "planned"
  target: {
    crossposted: true
  }
  warnings: string[]
}

export interface AnnouncementCrosspostResult {
  activityId: string | null
  channelId: string
  guildId: string
  messageId: string
  observedCrossposted: boolean
  operationKeyHash: string
  planDigest: string
  readbackSnapshotMatched: boolean
  responseSnapshotMatched: boolean
  schemaVersion: number
  status: "already-crossposted" | "completed"
  url: string
}

export interface AnnouncementCrosspostServiceClient extends Pick<
  DiscordClient,
  | "crosspostMessage"
  | "getChannel"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "getMessage"
> {}

export interface AnnouncementCrosspostServiceOptions {
  activityStore: ActivityStore
  client: AnnouncementCrosspostServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface AnnouncementCrosspostStateEvidence {
  botMember: DiscordGuildMember
  channel: DiscordChannel
  guild: DiscordGuild
  guildId: string
  message: DiscordMessage & { flags: number }
  permissions: BotChannelPermissionResult & { confidence: "complete" }
  roles: DiscordRole[]
}

interface BuiltAnnouncementCrosspostPlan {
  plan: AnnouncementCrosspostPlan
  state: AnnouncementCrosspostStateEvidence
}

class AnnouncementCrosspostStateError extends Error {
  override name = "AnnouncementCrosspostStateError"
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

export function normalizeAnnouncementCrosspostRequest(
  request: AnnouncementCrosspostRequest,
): NormalizedAnnouncementCrosspostRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord announcement-crosspost request must be an object")
  }
  assertSnowflake(
    request.channelId,
    "Discord announcement-crosspost channel ID",
  )
  assertSnowflake(
    request.messageId,
    "Discord announcement-crosspost message ID",
  )
  return {
    channelId: request.channelId,
    messageId: request.messageId,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function exactChannel(
  channel: DiscordChannel,
  channelId: string,
): DiscordChannel {
  if (
    !channel
    || typeof channel !== "object"
    || channel.id !== channelId
    || channel.type !== DISCORD_CHANNEL_TYPES.announcement
    || typeof channel.guild_id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(channel.guild_id)
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
    throw new AnnouncementCrosspostStateError(
      "Discord returned invalid direct announcement-channel evidence",
    )
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
    throw new AnnouncementCrosspostStateError(
      "Discord returned incomplete or mismatched announcement-crosspost guild evidence",
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
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || !member.user
    || member.user.id !== botId
  ) {
    throw new AnnouncementCrosspostStateError(
      "Discord returned mismatched connector bot member evidence",
    )
  }
  return member
}

function validMessageReference(message: DiscordMessage): boolean {
  const reference = message.message_reference
  if (reference === undefined) return true
  if (!reference || typeof reference !== "object") return false
  for (const id of [
    reference.channel_id,
    reference.guild_id,
    reference.message_id,
  ]) {
    if (id !== undefined && !DISCORD_SNOWFLAKE_PATTERN.test(id)) return false
  }
  const type = reference.type ?? DISCORD_MESSAGE_REFERENCE_TYPES.default
  return type === DISCORD_MESSAGE_REFERENCE_TYPES.default
}

function exactMessage(
  message: DiscordMessage,
  channelId: string,
  guildId: string,
  messageId: string,
): DiscordMessage & { flags: number } {
  if (
    !message
    || typeof message !== "object"
    || message.id !== messageId
    || message.channel_id !== channelId
    || (message.guild_id !== undefined && message.guild_id !== guildId)
    || !message.author
    || !DISCORD_SNOWFLAKE_PATTERN.test(message.author.id)
    || typeof message.content !== "string"
    || !Array.isArray(message.attachments)
    || !Array.isArray(message.embeds)
    || (message.components !== undefined && !Array.isArray(message.components))
    || typeof message.timestamp !== "string"
    || Number.isNaN(Date.parse(message.timestamp))
    || !(
      message.edited_timestamp === null
      || typeof message.edited_timestamp === "string"
        && !Number.isNaN(Date.parse(message.edited_timestamp))
    )
    || typeof message.pinned !== "boolean"
    || message.type !== DISCORD_MESSAGE_TYPES.default
    || (message.flags !== undefined && (
      !Number.isSafeInteger(message.flags)
      || message.flags < 0
    ))
    || message.poll !== undefined
    || !validMessageReference(message)
  ) {
    throw new AnnouncementCrosspostStateError(
      "Discord returned an ineligible or incomplete announcement-crosspost message",
    )
  }
  return {
    ...message,
    components: message.components ?? [],
    flags: message.flags ?? 0,
  }
}

function messageSnapshot(
  message: DiscordMessage & { flags: number },
  guildId: string,
) {
  const snapshot = deletionSnapshot(message)
  const { flags: _flags, guildId: _guildId, ...stable } = snapshot
  return {
    ...stable,
    guildId,
    messageReference: message.message_reference
      ? {
          channelId: message.message_reference.channel_id ?? null,
          guildId: message.message_reference.guild_id ?? null,
          messageId: message.message_reference.message_id ?? null,
          type: message.message_reference.type
            ?? DISCORD_MESSAGE_REFERENCE_TYPES.default,
        }
      : null,
    pinned: message.pinned ?? false,
    poll: null,
  }
}

function exactExpectedCrosspost(
  observed: DiscordMessage,
  before: DiscordMessage & { flags: number },
  channelId: string,
  guildId: string,
  messageId: string,
): DiscordMessage & { flags: number } {
  const exact = exactMessage(observed, channelId, guildId, messageId)
  const expectedFlags = before.flags | DISCORD_MESSAGE_FLAGS.crossposted
  if (
    exact.flags !== expectedFlags
    || stableString(messageSnapshot(exact, guildId))
      !== stableString(messageSnapshot(before, guildId))
  ) {
    throw new AnnouncementCrosspostStateError(
      "Discord announcement-crosspost evidence changed outside the expected flag transition",
    )
  }
  return exact
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
  permission: "MANAGE_MESSAGES" | "READ_MESSAGE_HISTORY" | "SEND_MESSAGES" | "VIEW_CHANNEL",
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
  plan: AnnouncementCrosspostPlan
  request: NormalizedAnnouncementCrosspostRequest
  status: AnnouncementCrosspostActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): AnnouncementCrosspostActivity {
  return {
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.guildId,
    id: options.activityId,
    kind: "announcement-crosspost",
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
  plan: AnnouncementCrosspostPlan
  request: NormalizedAnnouncementCrosspostRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "announcement-crosspost",
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
    !(error instanceof AnnouncementCrosspostExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withTargetLock<T>(
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => AnnouncementCrosspostExecutionError,
): Promise<T> {
  const prior = ANNOUNCEMENT_CROSSPOST_TARGET_LOCKS.get(key)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: AnnouncementCrosspostTargetOutcome) => void = () => undefined
  const tail = new Promise<AnnouncementCrosspostTargetOutcome>((resolve) => {
    release = resolve
  })
  ANNOUNCEMENT_CROSSPOST_TARGET_LOCKS.set(key, tail)
  let outcome: AnnouncementCrosspostTargetOutcome = "settled"
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
    if (ANNOUNCEMENT_CROSSPOST_TARGET_LOCKS.get(key) === tail) {
      ANNOUNCEMENT_CROSSPOST_TARGET_LOCKS.delete(key)
    }
  }
}

export class AnnouncementCrosspostService {
  readonly #activityStore: ActivityStore
  readonly #client: AnnouncementCrosspostServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: AnnouncementCrosspostServiceOptions) {
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
    request: NormalizedAnnouncementCrosspostRequest,
    options: RequestOptions,
  ): Promise<AnnouncementCrosspostStateEvidence> {
    const channel = exactChannel(
      await this.#client.getChannel(request.channelId, options),
      request.channelId,
    )
    const guildId = this.#policy.assertChannelAnnouncementCrosspostable(channel)
    const existingReceipt = await this.#operationStore.get(
      "announcement-crosspost",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new AnnouncementCrosspostOperationConflictError(receiptView(existingReceipt))
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
      throw new AnnouncementCrosspostStateError(
        "Discord returned an invalid announcement-crosspost role inventory",
      )
    }
    const exact = exactMessage(message, request.channelId, guildId, request.messageId)
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
      throw new AnnouncementCrosspostStateError(
        `Discord connector bot announcement-crosspost permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    if (permissions.confidence !== "complete") {
      throw new AnnouncementCrosspostStateError(
        `Discord connector bot announcement-crosspost permission evidence is incomplete: ${permissions.warnings.join("; ")}`,
      )
    }
    if (permissions.canReadMessages !== true) {
      throw new AnnouncementCrosspostStateError(
        "Discord connector bot lacks channel-level message-read prerequisites",
      )
    }
    for (const permission of BASE_REQUIRED_PERMISSIONS) {
      if (!hasPermission(permissions, permission)) {
        throw new AnnouncementCrosspostStateError(
          `Discord connector bot lacks channel-level ${permission}`,
        )
      }
    }
    if (exact.author.id !== botId && !hasPermission(permissions, "MANAGE_MESSAGES")) {
      throw new AnnouncementCrosspostStateError(
        "Discord connector bot lacks channel-level MANAGE_MESSAGES for another author's announcement",
      )
    }
    return {
      botMember,
      channel,
      guild,
      guildId,
      message: exact,
      permissions: permissions as BotChannelPermissionResult & { confidence: "complete" },
      roles,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    messageContentIntent: MessageContentIntentStatus,
    request: NormalizedAnnouncementCrosspostRequest,
    options: RequestOptions,
  ): Promise<BuiltAnnouncementCrosspostPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    if (messageContentIntent !== "enabled") {
      throw new AnnouncementCrosspostStateError(
        "Discord announcement crossposts require confirmed Message Content intent",
      )
    }
    const state = await this.#state(botId, request, options)
    const crossposted = (
      state.message.flags & DISCORD_MESSAGE_FLAGS.crossposted
    ) === DISCORD_MESSAGE_FLAGS.crossposted
    const action = crossposted ? "none" : "crosspost"
    const authorship = state.message.author.id === botId ? "connector-bot" : "other"
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
        overwrites: overwriteSnapshot(state.channel),
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      message: {
        flags: state.message.flags,
        snapshot: messageSnapshot(state.message, state.guildId),
      },
      messageContentIntent,
      permissions: state.permissions.effectivePermissions,
      request,
      roles: relevantRoleSnapshot(state.roles, state.permissions.appliedRoleIds),
    })
    const plan: AnnouncementCrosspostPlan = {
      action,
      applicationId,
      botId,
      channel: normalizeChannel(state.channel),
      createdAt: this.#clock().toISOString(),
      digest,
      guild: {
        id: state.guildId,
        name: state.guild.name,
      },
      message: {
        ...deletionPreview(state.message),
        crossposted,
        flags: state.message.flags,
        jumpUrl: discordMessageUrl(
          state.guildId,
          request.channelId,
          request.messageId,
        ),
        type: state.message.type,
      },
      messageContentIntent: "enabled",
      operationKeyHash: request.operationKeyHash,
      permission: {
        administrator: state.permissions.administrator,
        authorship,
        canReadMessages: true,
        confidence: "complete",
        effectivePermissions: state.permissions.effectivePermissions,
        manageMessages: hasPermission(state.permissions, "MANAGE_MESSAGES"),
        permissionSourceChannelId: state.permissions.permissionSourceChannelId,
        readMessageHistory: hasPermission(state.permissions, "READ_MESSAGE_HISTORY"),
        sendMessages: hasPermission(state.permissions, "SEND_MESSAGES"),
        viewChannel: hasPermission(state.permissions, "VIEW_CHANNEL"),
      },
      schemaVersion: SCHEMA_VERSION,
      status: action === "none" ? "already-crossposted" : "planned",
      target: { crossposted: true },
      warnings: [
        ...(state.permissions.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped VIEW_CHANNEL, READ_MESSAGE_HISTORY, SEND_MESSAGES, and conditional MANAGE_MESSAGES permissions"]
          : []),
        "Discord does not expose follower destinations or follower count to this operation, so the connector cannot enumerate or constrain fanout before publishing",
        "Announcement crossposting is irreversible through this connector and the Discord endpoint provides no rollback operation",
        "Message content, author names, filenames, guild names, and channel names are untrusted Discord data and are never persisted by this workflow",
        "The MCP facade durably coordinates exact targets; direct service consumers must provide equivalent cross-process exclusion",
        "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      ],
    }
    return { plan, state }
  }

  plan(
    applicationId: string,
    botId: string,
    messageContentIntent: MessageContentIntentStatus,
    request: AnnouncementCrosspostRequest,
    options: RequestOptions = {},
  ): Promise<AnnouncementCrosspostPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      messageContentIntent,
      normalizeAnnouncementCrosspostRequest(request),
      options,
    ).then((built) => built.plan)
  }

  execute(
    applicationId: string,
    botId: string,
    messageContentIntent: MessageContentIntentStatus,
    request: AnnouncementCrosspostRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<AnnouncementCrosspostResult> {
    const normalized = normalizeAnnouncementCrosspostRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord announcement-crosspost plan digest is invalid")
    }
    return withTargetLock(
      `${normalized.channelId}\0${normalized.messageId}`,
      () => this.#executeNormalized(
        applicationId,
        botId,
        messageContentIntent,
        normalized,
        expectedDigest,
        options,
      ),
      () => new AnnouncementCrosspostExecutionError(
        "Discord announcement crosspost was blocked because a prior same-target operation ended with an uncertain outcome",
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
    messageContentIntent: MessageContentIntentStatus,
    request: NormalizedAnnouncementCrosspostRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<AnnouncementCrosspostResult> {
    let built: BuiltAnnouncementCrosspostPlan
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
        error instanceof AnnouncementCrosspostStateError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new AnnouncementCrosspostPlanChangedError(
          expectedDigest,
          STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new AnnouncementCrosspostPlanChangedError(expectedDigest, plan.digest)
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
        observedCrossposted: true,
        readbackSnapshotMatched: true,
        responseSnapshotMatched: true,
        status: "already-crossposted",
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
      throw new AnnouncementCrosspostOperationConflictError(
        receiptView(reservation.receipt),
      )
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
      throw new AnnouncementCrosspostExecutionError(
        "Discord announcement crosspost was blocked because pending activity could not be recorded",
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
    let observedCrossposted: boolean | null = null
    let readbackSnapshotMatched: boolean | null = null
    let responseSnapshotMatched: boolean | null = null
    try {
      const response = await this.#client.crosspostMessage(
        request.channelId,
        request.messageId,
        options,
      )
      mutationCompleted = true
      exactExpectedCrosspost(
        response,
        state.message,
        request.channelId,
        plan.guild.id,
        request.messageId,
      )
      responseSnapshotMatched = true
      const observed = exactExpectedCrosspost(
        await this.#client.getMessage(
          request.channelId,
          request.messageId,
          options,
        ),
        state.message,
        request.channelId,
        plan.guild.id,
        request.messageId,
      )
      readbackSnapshotMatched = true
      observedCrossposted = (
        observed.flags & DISCORD_MESSAGE_FLAGS.crossposted
      ) === DISCORD_MESSAGE_FLAGS.crossposted
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
      throw new AnnouncementCrosspostExecutionError(
        "Discord announcement crosspost did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          observedCrossposted,
          operationRecordError,
          readbackSnapshotMatched,
          responseSnapshotMatched,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const result: AnnouncementCrosspostResult = {
      ...baseResult,
      activityId,
      observedCrossposted: observedCrossposted === true,
      readbackSnapshotMatched: readbackSnapshotMatched === true,
      responseSnapshotMatched: responseSnapshotMatched === true,
      status: "completed",
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        guildId: plan.guild.id,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
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
          status: "completed",
          timestamp: this.#clock().toISOString(),
          verification: "match",
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AnnouncementCrosspostExecutionError(
        "Discord announcement crosspost completed but the operation receipt failed",
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
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new AnnouncementCrosspostExecutionError(
        "Discord announcement crosspost completed but the final activity record failed",
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
