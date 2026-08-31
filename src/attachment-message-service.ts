import {
  createHash,
  randomUUID,
} from "node:crypto"
import { basename, isAbsolute } from "node:path"

import type {
  ActivityStore,
  AttachmentMessageActivity,
  AttachmentMessageActivityStatus,
} from "./activity-log.js"
import {
  readAttachmentFileSnapshot,
  AttachmentFileError,
  type AttachmentFileReview,
  type AttachmentFileSnapshot,
} from "./attachment-file.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  CreateAttachmentMessageInput,
  DiscordClient,
} from "./discord-client.js"
import {
  AttachmentMessageExecutionError,
  AttachmentMessageOperationConflictError,
  AttachmentMessagePlanChangedError,
  DiscordApiError,
  InteractionIdentityError,
} from "./errors.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  assertDiscordBotMessage,
  assertDiscordMessageContent,
  assertDiscordMessageIdentity,
  assertDiscordReplyReference,
  assertDiscordSnowflake,
  canonicalDiscordNotificationUserIds,
  discordAllowedMentions,
  discordReviewedNotificationAuthorization,
  type DiscordNotificationAuthorization,
} from "./message-safety.js"
import { discordMessageUrl } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  DISCORD_PERMISSIONS,
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
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
  DiscordThreadMember,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "attachment-message-state-unavailable"
const ATTACHMENT_DESCRIPTION_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const ATTACHMENT_FILENAME_CONTROL_OR_SEPARATOR_PATTERN = /[\\/\u0000-\u001F\u007F]/u
const ATTACHMENT_CHANNEL_TYPES = new Set<number>([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
  DISCORD_CHANNEL_TYPES.text,
])
const THREAD_CHANNEL_TYPES = new Set<number>([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const ATTACHMENT_REPLY_MESSAGE_TYPES = new Set<number>([0, 19])

export interface AttachmentMessageRequest {
  channelId: string
  content?: string
  description?: string
  filePath: string
  filename?: string
  notifyReplyAuthor?: boolean
  notifyUserIds?: readonly string[]
  operationKey: string
  replyToMessageId?: string
}

export interface NormalizedAttachmentMessageRequest {
  channelId: string
  content: string | null
  description: string | null
  filePath: string
  filename: string
  notifyReplyAuthor: boolean
  notifyUserIds: string[]
  operationKey: string
  operationKeyHash: string
  replyToMessageId: string | null
}

export interface AttachmentMessagePlan {
  channel: {
    guildId: string
    id: string
    parentId: string | null
    type: number
  }
  createdAt: string
  digest: string
  file: AttachmentFileReview & {
    description: string | null
    filename: string
    maxBytes: number
  }
  notificationAuthorization: DiscordNotificationAuthorization
  notificationUserIds: string[]
  notifyReplyAuthor: boolean
  operationKeyHash: string
  permission: {
    administrator: boolean
    confidence: "complete"
    effectivePermissionNames: DiscordPermissionName[]
    effectivePermissions: string
    permissionSourceChannelId: string
    privateThreadAccess: "lookup-succeeded" | "not-applicable"
    requiredPermissionNames: DiscordPermissionName[]
  }
  reply: {
    authorId: string
    messageId: string
  } | null
  schemaVersion: number
  status: "planned"
  target: {
    content: string | null
    description: string | null
    filename: string
  }
  warnings: string[]
}

export interface AttachmentMessageResult {
  activityId: string
  attachment: {
    descriptionPresent: boolean
    filename: string
    sizeBytes: number
  }
  channelId: string
  guildId: string
  messageId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "completed"
  url: string
}

export interface AttachmentMessageServiceOptions {
  activityStore: ActivityStore
  attachmentMaxBytes: number
  attachmentRoots: readonly string[]
  client: Pick<
    DiscordClient,
    | "createAttachmentMessage"
    | "getChannel"
    | "getGuildMember"
    | "getGuildRoles"
    | "getMessage"
    | "getThreadMember"
  >
  clock?: () => Date
  limiter: InteractionLimiter
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface AttachmentMessageState {
  channel: DiscordChannel
  file: AttachmentFileSnapshot
  guildId: string
  member: DiscordGuildMember
  notificationAuthorization: DiscordNotificationAuthorization
  parent: DiscordChannel | null
  permission: BotChannelPermissionResult
  privateThreadMember: DiscordThreadMember | null
  reply: DiscordMessage | null
  roles: DiscordRole[]
}

class AttachmentMessageStateError extends Error {
  override name = "AttachmentMessageStateError"
}

function assertValidUnicode(value: string, name: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${name} contains invalid Unicode`, { cause: error })
  }
}

function normalizedFilename(filePath: string, value: string | undefined): string {
  const filename = value ?? basename(filePath)
  if (
    typeof filename !== "string"
    || filename.length < 1
    || filename.length > DISCORD_LIMITS.attachmentFilenameCharacters
    || filename.trim() !== filename
    || filename === "."
    || filename === ".."
    || ATTACHMENT_FILENAME_CONTROL_OR_SEPARATOR_PATTERN.test(filename)
  ) {
    throw new RangeError("Discord attachment filename is invalid")
  }
  assertValidUnicode(filename, "Discord attachment filename")
  return filename
}

function normalizedDescription(value: string | undefined): string | null {
  if (value === undefined) return null
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > DISCORD_LIMITS.attachmentDescriptionCharacters
    || ATTACHMENT_DESCRIPTION_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `Discord attachment description must contain 1-${DISCORD_LIMITS.attachmentDescriptionCharacters} characters without unsupported controls`,
    )
  }
  assertValidUnicode(value, "Discord attachment description")
  return value
}

export function normalizeAttachmentMessageRequest(
  request: AttachmentMessageRequest,
): NormalizedAttachmentMessageRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord attachment request must be an object")
  }
  assertDiscordSnowflake(request.channelId, "Discord attachment channel ID")
  if (
    typeof request.filePath !== "string"
    || !isAbsolute(request.filePath)
    || !request.filePath
    || request.filePath.length > CONNECTOR_LIMITS.attachmentPathCharacters
    || request.filePath.trim() !== request.filePath
    || request.filePath.includes("\0")
  ) {
    throw new RangeError("Discord attachment path must be one exact absolute path")
  }
  assertValidUnicode(request.filePath, "Discord attachment path")
  const content = request.content ?? null
  if (content !== null) assertDiscordMessageContent(content)
  const replyToMessageId = request.replyToMessageId ?? null
  if (replyToMessageId !== null) {
    assertDiscordSnowflake(replyToMessageId, "Discord attachment reply message ID")
  }
  if (
    request.notifyReplyAuthor !== undefined
    && typeof request.notifyReplyAuthor !== "boolean"
  ) {
    throw new RangeError("Discord reply-author notification must be a boolean")
  }
  if (request.notifyReplyAuthor && replyToMessageId === null) {
    throw new RangeError("Discord reply-author notification requires a reply target")
  }
  const notifyUserIds = canonicalDiscordNotificationUserIds(
    content ?? "",
    request.notifyUserIds,
  )
  return {
    channelId: request.channelId,
    content,
    description: normalizedDescription(request.description),
    filePath: request.filePath,
    filename: normalizedFilename(request.filePath, request.filename),
    notifyReplyAuthor: request.notifyReplyAuthor ?? false,
    notifyUserIds,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    replyToMessageId,
  }
}

export function attachmentMessageNonce(
  channelId: string,
  operationKey: string,
): string {
  return createHash("sha256")
    .update("guildcontrol-attachment-message.v1\0")
    .update(channelId)
    .update("\0")
    .update(operationKey)
    .digest("base64url")
    .slice(0, DISCORD_LIMITS.messageNonceCharacters)
}

function channelSnapshot(channel: DiscordChannel) {
  return {
    guildId: channel.guild_id ?? null,
    id: channel.id,
    parentId: channel.parent_id ?? null,
    permissionOverwrites: channel.permission_overwrites ?? null,
    threadMetadata: channel.thread_metadata
      ? {
          archiveTimestamp: channel.thread_metadata.archive_timestamp ?? null,
          archived: channel.thread_metadata.archived ?? null,
          autoArchiveDuration: channel.thread_metadata.auto_archive_duration ?? null,
          locked: channel.thread_metadata.locked ?? null,
        }
      : null,
    type: channel.type,
  }
}

function roleSnapshot(roles: readonly DiscordRole[]) {
  return roles
    .map((role) => ({
      id: role.id,
      managed: role.managed,
      permissions: role.permissions,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function requiredPermissions(channel: DiscordChannel): DiscordPermissionName[] {
  return [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    "ATTACH_FILES",
    THREAD_CHANNEL_TYPES.has(channel.type)
      ? "SEND_MESSAGES_IN_THREADS"
      : "SEND_MESSAGES",
  ]
}

function assertCompletePermissions(
  permission: BotChannelPermissionResult,
  channel: DiscordChannel,
): DiscordPermissionName[] {
  if (permission.confidence !== "complete") {
    throw new AttachmentMessageStateError(
      `Discord connector bot permission evidence is incomplete: ${permission.warnings.join("; ")}`,
    )
  }
  const required = requiredPermissions(channel)
  const effective = BigInt(permission.effectivePermissions)
  const missing = permission.administrator
    ? []
    : required.filter((name) => (
      (effective & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
    ))
  if (missing.length > 0) {
    throw new AttachmentMessageStateError(
      `Discord connector bot lacks attachment permissions: ${missing.join(", ")}`,
    )
  }
  return required
}

function exactChannel(
  channel: DiscordChannel,
  channelId: string,
): DiscordChannel {
  if (
    channel.id !== channelId
    || typeof channel.guild_id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(channel.guild_id)
    || !ATTACHMENT_CHANNEL_TYPES.has(channel.type)
  ) {
    throw new AttachmentMessageStateError(
      "Discord returned a mismatched or unsupported attachment channel",
    )
  }
  if (THREAD_CHANNEL_TYPES.has(channel.type)) {
    const metadata = channel.thread_metadata
    if (
      !channel.parent_id
      || !DISCORD_SNOWFLAKE_PATTERN.test(channel.parent_id)
      || !metadata
      || metadata.archived !== false
      || metadata.locked !== false
      || typeof metadata.archive_timestamp !== "string"
      || Number.isNaN(Date.parse(metadata.archive_timestamp))
      || !Number.isSafeInteger(metadata.auto_archive_duration)
    ) {
      throw new AttachmentMessageStateError(
        "Discord attachment messages require an active unlocked thread with complete lifecycle evidence",
      )
    }
  }
  return channel
}

function parentTypeMatches(threadType: number, parentType: number): boolean {
  if (threadType === DISCORD_CHANNEL_TYPES.announcementThread) {
    return parentType === DISCORD_CHANNEL_TYPES.announcement
  }
  if (threadType === DISCORD_CHANNEL_TYPES.privateThread) {
    return parentType === DISCORD_CHANNEL_TYPES.text
  }
  return parentType === DISCORD_CHANNEL_TYPES.forum
    || parentType === DISCORD_CHANNEL_TYPES.media
    || parentType === DISCORD_CHANNEL_TYPES.text
}

function exactPrivateThreadMember(
  member: DiscordThreadMember,
  threadId: string,
  botId: string,
): DiscordThreadMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || member.id !== threadId
    || member.user_id !== botId
    || !Number.isSafeInteger(member.flags)
    || member.flags < 0
    || typeof member.join_timestamp !== "string"
    || Number.isNaN(Date.parse(member.join_timestamp))
  ) {
    throw new AttachmentMessageStateError(
      "Discord returned mismatched attachment private-thread membership evidence",
    )
  }
  return member
}

function exactMember(member: DiscordGuildMember, botId: string): DiscordGuildMember {
  if (!member.user || member.user.id !== botId || !member.user.bot) {
    throw new AttachmentMessageStateError(
      "Discord returned a different connector bot member than requested",
    )
  }
  return member
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
  messageId?: string | null
  plan: AttachmentMessagePlan
  request: NormalizedAttachmentMessageRequest
  status: AttachmentMessageActivityStatus
  timestamp: string
  verification?: "match" | null
}): AttachmentMessageActivity {
  return {
    channelId: options.request.channelId,
    error: options.error ?? null,
    guildId: options.plan.channel.guildId,
    id: options.activityId,
    kind: "attachment-message-send",
    messageId: options.messageId ?? null,
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    replyToMessageId: options.request.replyToMessageId,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  messageId?: string | null
  plan: AttachmentMessagePlan
  request: NormalizedAttachmentMessageRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.channel.guildId,
    kind: "attachment-message",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.messageId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function createInput(
  request: NormalizedAttachmentMessageRequest,
  state: AttachmentMessageState,
): CreateAttachmentMessageInput {
  return {
    allowedMentions: discordAllowedMentions(
      request.notifyUserIds,
      request.notifyReplyAuthor,
    ),
    bytes: state.file.bytes,
    ...(request.content !== null ? { content: request.content } : {}),
    ...(request.description !== null ? { description: request.description } : {}),
    filename: request.filename,
    nonce: attachmentMessageNonce(request.channelId, request.operationKey),
    ...(request.replyToMessageId !== null
      ? {
          reply: {
            guildId: state.guildId,
            messageId: request.replyToMessageId,
          },
        }
      : {}),
  }
}

function assertExactAttachmentMessage(
  message: DiscordMessage,
  botId: string,
  request: NormalizedAttachmentMessageRequest,
  state: AttachmentMessageState,
  messageId: string,
  requireNonce: boolean,
): void {
  assertDiscordMessageIdentity(
    message,
    request.channelId,
    state.guildId,
    messageId,
  )
  assertDiscordBotMessage(message, botId)
  assertDiscordReplyReference(
    message,
    request.channelId,
    state.guildId,
    request.replyToMessageId ?? undefined,
  )
  const attachment = message.attachments?.[0]
  const expectedNonce = attachmentMessageNonce(request.channelId, request.operationKey)
  if (
    message.content !== (request.content ?? "")
    || (
      message.nonce !== expectedNonce
      && (requireNonce || message.nonce !== undefined)
    )
    || !Array.isArray(message.attachments)
    || message.attachments.length !== 1
    || !attachment
    || !DISCORD_SNOWFLAKE_PATTERN.test(attachment.id)
    || attachment.filename !== request.filename
    || attachment.size !== state.file.review.sizeBytes
    || (attachment.description ?? null) !== request.description
  ) {
    throw new InteractionIdentityError(
      "Discord returned attachment message state that does not match the reviewed send",
    )
  }
}

export class AttachmentMessageService {
  readonly #activityStore: ActivityStore
  readonly #attachmentMaxBytes: number
  readonly #attachmentRoots: readonly string[]
  readonly #client: AttachmentMessageServiceOptions["client"]
  readonly #clock: () => Date
  readonly #limiter: InteractionLimiter
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: AttachmentMessageServiceOptions) {
    this.#activityStore = options.activityStore
    this.#attachmentMaxBytes = options.attachmentMaxBytes
    this.#attachmentRoots = options.attachmentRoots
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#limiter = options.limiter
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    botId: string,
    request: NormalizedAttachmentMessageRequest,
    options: RequestOptions,
  ): Promise<AttachmentMessageState> {
    const existingReceipt = await this.#operationStore.get(
      "attachment-message",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new AttachmentMessageOperationConflictError(receiptView(existingReceipt))
    }

    const channel = exactChannel(
      await this.#client.getChannel(request.channelId, options),
      request.channelId,
    )
    const guildId = this.#policy.assertChannelAttachmentAllowed(channel)
    let parent: DiscordChannel | null = null
    if (THREAD_CHANNEL_TYPES.has(channel.type)) {
      if (!channel.parent_id) {
        throw new AttachmentMessageStateError("Discord attachment thread omitted its parent ID")
      }
      parent = await this.#client.getChannel(channel.parent_id, options)
      if (
        parent.id !== channel.parent_id
        || parent.guild_id !== guildId
        || THREAD_CHANNEL_TYPES.has(parent.type)
        || !parentTypeMatches(channel.type, parent.type)
        || !Array.isArray(parent.permission_overwrites)
      ) {
        throw new AttachmentMessageStateError(
          "Discord returned a mismatched attachment thread parent",
        )
      }
      if (this.#policy.assertChannelReadable(parent) !== guildId) {
        throw new AttachmentMessageStateError(
          "Discord attachment thread parent belongs to another guild",
        )
      }
    }

    const [member, roles, privateThreadMember, reply, file] = await Promise.all([
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      channel.type === DISCORD_CHANNEL_TYPES.privateThread
        ? this.#client.getThreadMember(channel.id, botId, options)
        : Promise.resolve(null),
      request.replyToMessageId
        ? this.#client.getMessage(request.channelId, request.replyToMessageId, options)
        : Promise.resolve(null),
      readAttachmentFileSnapshot({
        filePath: request.filePath,
        maxBytes: this.#attachmentMaxBytes,
        planKey: this.#planKey,
        roots: this.#attachmentRoots,
      }),
    ])
    exactMember(member, botId)
    if (privateThreadMember) {
      exactPrivateThreadMember(privateThreadMember, channel.id, botId)
    }
    if (!Array.isArray(roles) || roles.length < 1 || roles.length > DISCORD_LIMITS.guildRoles) {
      throw new AttachmentMessageStateError("Discord returned an invalid bounded role inventory")
    }
    const permission = evaluateBotChannelPermissions({
      botId,
      channel,
      guildId,
      member,
      permissionChannel: parent || channel,
      roles,
    })
    assertCompletePermissions(permission, channel)
    if (reply) {
      assertDiscordMessageIdentity(
        reply,
        request.channelId,
        guildId,
        request.replyToMessageId ?? undefined,
      )
      if (!ATTACHMENT_REPLY_MESSAGE_TYPES.has(reply.type)) {
        throw new AttachmentMessageStateError(
          "Discord attachment reply target is not a regular or reply message",
        )
      }
      if (request.notifyReplyAuthor) {
        assertDiscordSnowflake(reply.author.id, "Discord attachment reply author ID")
      }
    }
    const notificationAuthorization = discordReviewedNotificationAuthorization(
      request.notifyUserIds,
      this.#policy,
      reply && request.notifyReplyAuthor ? reply.author.id : undefined,
    )
    return {
      channel,
      file,
      guildId,
      member,
      notificationAuthorization,
      parent,
      permission,
      privateThreadMember,
      reply,
      roles,
    }
  }

  #planFromState(
    botId: string,
    request: NormalizedAttachmentMessageRequest,
    state: AttachmentMessageState,
  ): AttachmentMessagePlan {
    const required = requiredPermissions(state.channel)
    const digest = reviewedPlanDigest(this.#planKey, {
      botId,
      channel: channelSnapshot(state.channel),
      file: {
        binding: state.file.binding,
        contentDigest: state.file.contentDigest,
        review: state.file.review,
      },
      member: {
        roles: [...state.member.roles].sort(),
        userId: state.member.user?.id ?? null,
      },
      notificationAuthorization: state.notificationAuthorization,
      parent: state.parent ? channelSnapshot(state.parent) : null,
      permission: {
        administrator: state.permission.administrator,
        confidence: state.permission.confidence,
        effectivePermissions: state.permission.effectivePermissions,
        permissionSourceChannelId: state.permission.permissionSourceChannelId,
      },
      privateThreadMember: state.privateThreadMember
        ? {
            flags: state.privateThreadMember.flags,
            id: state.privateThreadMember.id,
            joinedAt: state.privateThreadMember.join_timestamp,
            userId: state.privateThreadMember.user_id,
          }
        : null,
      reply: state.reply
        ? {
            authorId: state.reply.author.id,
            channelId: state.reply.channel_id,
            guildId: state.reply.guild_id ?? null,
            id: state.reply.id,
            type: state.reply.type,
          }
        : null,
      request: {
        channelId: request.channelId,
        content: request.content,
        description: request.description,
        filePath: request.filePath,
        filename: request.filename,
        notifyReplyAuthor: request.notifyReplyAuthor,
        notifyUserIds: request.notifyUserIds,
        operationKeyHash: request.operationKeyHash,
        replyToMessageId: request.replyToMessageId,
      },
      requiredPermissions: required,
      roles: roleSnapshot(state.roles),
    })
    return {
      channel: {
        guildId: state.guildId,
        id: state.channel.id,
        parentId: state.channel.parent_id ?? null,
        type: state.channel.type,
      },
      createdAt: this.#clock().toISOString(),
      digest,
      file: {
        ...state.file.review,
        description: request.description,
        filename: request.filename,
        maxBytes: this.#attachmentMaxBytes,
      },
      notificationAuthorization: state.notificationAuthorization,
      notificationUserIds: request.notifyUserIds,
      notifyReplyAuthor: request.notifyReplyAuthor,
      operationKeyHash: request.operationKeyHash,
      permission: {
        administrator: state.permission.administrator,
        confidence: "complete",
        effectivePermissionNames: state.permission.effectivePermissionNames,
        effectivePermissions: state.permission.effectivePermissions,
        permissionSourceChannelId: state.permission.permissionSourceChannelId,
        privateThreadAccess: state.permission.privateThreadAccess,
        requiredPermissionNames: required,
      },
      reply: state.reply
        ? {
            authorId: state.reply.author.id,
            messageId: state.reply.id,
          }
        : null,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      target: {
        content: request.content,
        description: request.description,
        filename: request.filename,
      },
      warnings: [
        ...(state.permission.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with the exact channel permissions listed in this plan"]
          : []),
        "The reviewed operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
        "Execution uploads the fresh in-memory file snapshot once without automatic retry or rollback",
        "The activity log and operation receipt never store the path, filename, description, file size or digest, message content, attachment URL, or raw operation key",
      ],
    }
  }

  async #prepare(
    botId: string,
    request: NormalizedAttachmentMessageRequest,
    options: RequestOptions,
  ): Promise<{ plan: AttachmentMessagePlan; state: AttachmentMessageState }> {
    const state = await this.#state(botId, request, options)
    return { plan: this.#planFromState(botId, request, state), state }
  }

  async plan(
    botId: string,
    request: AttachmentMessageRequest,
    options: RequestOptions = {},
  ): Promise<AttachmentMessagePlan> {
    return (await this.#prepare(
      botId,
      normalizeAttachmentMessageRequest(request),
      options,
    )).plan
  }

  async execute(
    botId: string,
    request: AttachmentMessageRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<AttachmentMessageResult> {
    const normalized = normalizeAttachmentMessageRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord attachment message plan digest is invalid")
    }
    let prepared: { plan: AttachmentMessagePlan; state: AttachmentMessageState }
    try {
      prepared = await this.#prepare(botId, normalized, options)
    } catch (error) {
      if (
        error instanceof AttachmentFileError
        || error instanceof AttachmentMessageStateError
        || error instanceof InteractionIdentityError
        || (error instanceof DiscordApiError && error.status === 404)
      ) {
        throw new AttachmentMessagePlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = prepared
    if (plan.digest !== expectedDigest) {
      throw new AttachmentMessagePlanChangedError(expectedDigest, plan.digest)
    }

    this.#limiter.reserve(normalized.channelId)
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request: normalized,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new AttachmentMessageOperationConflictError(receiptView(reservation.receipt))
    }

    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: normalized,
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
          request: normalized,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new AttachmentMessageExecutionError(
        "Discord attachment message was blocked because pending activity could not be recorded",
        {
          activityId,
          channelId: normalized.channelId,
          error: safeErrorCode(error),
          guildId: state.guildId,
          messageId: null,
          operationKeyHash: normalized.operationKeyHash,
          operationRecordError,
          planDigest: plan.digest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let messageId: string | null = null
    try {
      const created = await this.#client.createAttachmentMessage(
        normalized.channelId,
        createInput(normalized, state),
        options,
      )
      if (
        created
        && typeof created.id === "string"
        && DISCORD_SNOWFLAKE_PATTERN.test(created.id)
      ) messageId = created.id
      assertExactAttachmentMessage(
        created,
        botId,
        normalized,
        state,
        created.id,
        true,
      )
      const readback = await this.#client.getMessage(
        normalized.channelId,
        created.id,
        options,
      )
      assertExactAttachmentMessage(
        readback,
        botId,
        normalized,
        state,
        created.id,
        false,
      )
    } catch (error) {
      const status = messageId === null
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
          messageId,
          plan,
          request: normalized,
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
          messageId,
          plan,
          request: normalized,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AttachmentMessageExecutionError(
        "Discord attachment message did not complete with a verified successful outcome",
        {
          activityId,
          activityRecordError,
          channelId: normalized.channelId,
          error: errorCode,
          guildId: state.guildId,
          messageId,
          operationKeyHash: normalized.operationKeyHash,
          operationRecordError,
          planDigest: plan.digest,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          schemaVersion: SCHEMA_VERSION,
          status,
        },
        { cause: error },
      )
    }

    if (messageId === null) {
      throw new AttachmentMessageExecutionError(
        "Discord attachment message completed without an exact message ID",
        {
          activityId,
          channelId: normalized.channelId,
          guildId: state.guildId,
          messageId: null,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: plan.digest,
          schemaVersion: SCHEMA_VERSION,
          status: "uncertain",
        },
      )
    }
    const result: AttachmentMessageResult = {
      activityId,
      attachment: {
        descriptionPresent: normalized.description !== null,
        filename: normalized.filename,
        sizeBytes: state.file.review.sizeBytes,
      },
      channelId: normalized.channelId,
      guildId: state.guildId,
      messageId,
      operationKeyHash: normalized.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      url: discordMessageUrl(state.guildId, normalized.channelId, messageId),
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        messageId,
        plan,
        request: normalized,
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
          messageId,
          plan,
          request: normalized,
          status: "completed",
          timestamp: this.#clock().toISOString(),
          verification: "match",
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AttachmentMessageExecutionError(
        "Discord attachment message completed but the operation receipt failed",
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
        messageId,
        plan,
        request: normalized,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new AttachmentMessageExecutionError(
        "Discord attachment message completed but the final activity record failed",
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
