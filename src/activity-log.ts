import {
  chmod,
  mkdir,
  open,
  stat,
} from "node:fs/promises"
import { dirname } from "node:path"

import {
  CHANNEL_CREATION_KINDS,
  CONNECTOR_LIMITS,
  CONTENT_FREE_ERROR_PATTERN,
  CONTENT_FREE_IDENTIFIER_PATTERN,
  DISCORD_SNOWFLAKE_PATTERN,
  MEMBER_MODERATION_ACTIONS,
  SCHEMA_VERSION,
  type ChannelCreationKind,
  type MemberModerationAction,
} from "./constants.js"
import { AuditLogError, errorMessage } from "./errors.js"
import { OPERATION_KEY_HASH_PATTERN } from "./operation-store.js"
import { REVIEWED_PLAN_DIGEST_PATTERN } from "./reviewed-plan.js"

const MAX_ACTIVITY_READ_BYTES = 1_048_576

export type DeletionActivityStatus = "completed" | "failed" | "partial" | "pending"

export interface DeletionActivity {
  channelId: string
  deletedMessageIds: string[]
  error: string | null
  failedMessageId: string | null
  guildId: string
  id: string
  kind: "message-deletion"
  messageIds: string[]
  planDigest: string
  schemaVersion: number
  status: DeletionActivityStatus
  strategies: string[]
  timestamp: string
}

export type InteractionActivityKind = "message-edit" | "message-send" | "reaction-add"
export type InteractionActivityStatus = "completed" | "failed" | "noop" | "pending" | "uncertain"

export interface InteractionActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: InteractionActivityKind
  messageId: string | null
  nonce: string | null
  replyToMessageId: string | null
  schemaVersion: number
  status: InteractionActivityStatus
  timestamp: string
}

export type MemberModerationActivityAction = MemberModerationAction
export type MemberModerationActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface MemberModerationActivity {
  action: MemberModerationActivityAction
  deleteMessageSeconds: number | null
  durationMinutes: number | null
  error: string | null
  guildId: string
  id: string
  kind: "member-moderation"
  planDigest: string
  schemaVersion: number
  status: MemberModerationActivityStatus
  timeoutUntil: string | null
  timestamp: string
  userId: string
}

export type ChannelCreationActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ChannelCreationActivity {
  channelId: string | null
  channelKind: ChannelCreationKind
  error: string | null
  guildId: string
  id: string
  kind: "channel-create"
  operationKeyHash: string
  parentId: string | null
  planDigest: string
  schemaVersion: number
  status: ChannelCreationActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type RoleCreationActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface RoleCreationActivity {
  error: string | null
  guildId: string
  id: string
  kind: "role-create"
  operationKeyHash: string
  planDigest: string
  roleId: string | null
  schemaVersion: number
  status: RoleCreationActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type AttachmentMessageActivityStatus =
  | "completed"
  | "failed"
  | "pending"
  | "uncertain"

export interface AttachmentMessageActivity {
  channelId: string
  error: string | null
  guildId: string
  id: string
  kind: "attachment-message-send"
  messageId: string | null
  operationKeyHash: string
  planDigest: string
  replyToMessageId: string | null
  schemaVersion: number
  status: AttachmentMessageActivityStatus
  timestamp: string
  verification: "match" | null
}

export type ForumPostActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface ForumPostActivity {
  error: string | null
  guildId: string
  id: string
  kind: "forum-post-create"
  messageId: string | null
  operationKeyHash: string
  parentChannelId: string
  planDigest: string
  schemaVersion: number
  status: ForumPostActivityStatus
  threadId: string | null
  timestamp: string
  verification: "drift" | "match" | null
}

export type MessagePinActivityStatus =
  | "completed"
  | "completed-with-drift"
  | "failed"
  | "pending"
  | "uncertain"

export interface MessagePinActivity {
  channelId: string
  desiredState: "pinned" | "unpinned"
  error: string | null
  guildId: string
  id: string
  kind: "message-pin"
  messageId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: MessagePinActivityStatus
  timestamp: string
  verification: "drift" | "match" | null
}

export type ActivityEntry =
  | AttachmentMessageActivity
  | ChannelCreationActivity
  | DeletionActivity
  | ForumPostActivity
  | InteractionActivity
  | MemberModerationActivity
  | MessagePinActivity
  | RoleCreationActivity

export interface ActivityList {
  entries: ActivityEntry[]
  file: string
  skippedLines: number
}

export interface ActivityStore {
  append(entry: ActivityEntry): Promise<void>
  list(limit?: number): Promise<ActivityList>
}

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > CONNECTOR_LIMITS.activityEntries) {
    throw new AuditLogError(
      `Activity limit must be between 1 and ${CONNECTOR_LIMITS.activityEntries}`,
    )
  }
  return limit
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function parseDeletionActivity(value: unknown): DeletionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || ![undefined, "message-deletion"].includes(record.kind as string | undefined)
    || typeof record.id !== "string"
    || typeof record.timestamp !== "string"
    || !["completed", "failed", "partial", "pending"].includes(String(record.status))
    || typeof record.channelId !== "string"
    || typeof record.guildId !== "string"
    || typeof record.planDigest !== "string"
    || !stringArray(record.messageIds)
    || !stringArray(record.deletedMessageIds)
    || !stringArray(record.strategies)
    || !(record.error === null || typeof record.error === "string")
    || !(record.failedMessageId === null || typeof record.failedMessageId === "string")
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    deletedMessageIds: [...record.deletedMessageIds],
    error: record.error,
    failedMessageId: record.failedMessageId,
    guildId: record.guildId,
    id: record.id,
    kind: "message-deletion",
    messageIds: [...record.messageIds],
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as DeletionActivityStatus,
    strategies: [...record.strategies],
    timestamp: record.timestamp,
  }
}

function parseInteractionActivity(value: unknown): InteractionActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || typeof record.id !== "string"
    || typeof record.timestamp !== "string"
    || !["message-edit", "message-send", "reaction-add"].includes(String(record.kind))
    || !["completed", "failed", "noop", "pending", "uncertain"].includes(String(record.status))
    || typeof record.channelId !== "string"
    || typeof record.guildId !== "string"
    || !(record.messageId === null || typeof record.messageId === "string")
    || !(record.nonce === null || typeof record.nonce === "string")
    || !(record.replyToMessageId === null || typeof record.replyToMessageId === "string")
    || !(record.error === null || typeof record.error === "string")
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: record.kind as InteractionActivityKind,
    messageId: record.messageId,
    nonce: record.nonce,
    replyToMessageId: record.replyToMessageId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as InteractionActivityStatus,
    timestamp: record.timestamp,
  }
}

function parseMemberModerationActivity(
  value: unknown,
): MemberModerationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "member-moderation"
    || typeof record.id !== "string"
    || typeof record.timestamp !== "string"
    || !MEMBER_MODERATION_ACTIONS.includes(record.action as MemberModerationAction)
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || typeof record.userId !== "string"
    || typeof record.planDigest !== "string"
    || !(record.deleteMessageSeconds === null || typeof record.deleteMessageSeconds === "number")
    || !(record.durationMinutes === null || typeof record.durationMinutes === "number")
    || !(record.timeoutUntil === null || typeof record.timeoutUntil === "string")
    || !(record.error === null || typeof record.error === "string")
  ) {
    return undefined
  }
  return {
    action: record.action as MemberModerationActivityAction,
    deleteMessageSeconds: record.deleteMessageSeconds,
    durationMinutes: record.durationMinutes,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "member-moderation",
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MemberModerationActivityStatus,
    timeoutUntil: record.timeoutUntil,
    timestamp: record.timestamp,
    userId: record.userId,
  }
}

function parseChannelCreationActivity(
  value: unknown,
): ChannelCreationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "channel-create"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !CHANNEL_CREATION_KINDS.includes(record.channelKind as ChannelCreationKind)
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.channelId === null || (
      typeof record.channelId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    ))
    || !(record.parentId === null || (
      typeof record.parentId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.parentId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.channelId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.channelId === null
      || record.verification !== "match"
    ))
    || (record.status === "completed-with-drift" && (
      record.channelId === null
      || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    channelKind: record.channelKind as ChannelCreationKind,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "channel-create",
    operationKeyHash: record.operationKeyHash,
    parentId: record.parentId,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ChannelCreationActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseRoleCreationActivity(
  value: unknown,
): RoleCreationActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "role-create"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || !(record.roleId === null || (
      typeof record.roleId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.roleId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.roleId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.roleId === null
      || record.verification !== "match"
    ))
    || (record.status === "completed-with-drift" && (
      record.roleId === null
      || record.verification !== "drift"
    ))
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "role-create",
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    roleId: record.roleId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as RoleCreationActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseMessagePinActivity(
  value: unknown,
): MessagePinActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "message-pin"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["pinned", "unpinned"].includes(String(record.desiredState))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || typeof record.messageId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && record.verification !== "match")
    || (record.status === "completed-with-drift" && record.verification !== "drift")
    || (["failed", "uncertain"].includes(String(record.status)) && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    desiredState: record.desiredState as "pinned" | "unpinned",
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "message-pin",
    messageId: record.messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as MessagePinActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseAttachmentMessageActivity(
  value: unknown,
): AttachmentMessageActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "attachment-message-send"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || !["completed", "failed", "pending", "uncertain"].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.channelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.channelId)
    || !(record.messageId === null || (
      typeof record.messageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.messageId)
    ))
    || !(record.replyToMessageId === null || (
      typeof record.replyToMessageId === "string"
      && DISCORD_SNOWFLAKE_PATTERN.test(record.replyToMessageId)
    ))
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.messageId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.messageId === null
      || record.verification !== "match"
    ))
    || (record.status === "failed" && (
      record.messageId !== null
      || record.error === null
      || record.verification !== null
    ))
    || (record.status === "uncertain" && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    channelId: record.channelId,
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "attachment-message-send",
    messageId: record.messageId,
    operationKeyHash: record.operationKeyHash,
    planDigest: record.planDigest,
    replyToMessageId: record.replyToMessageId,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as AttachmentMessageActivityStatus,
    timestamp: record.timestamp,
    verification: record.verification as "match" | null,
  }
}

function parseForumPostActivity(value: unknown): ForumPostActivity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const terminalIdsValid = record.threadId === null
    ? record.messageId === null
    : (
        typeof record.threadId === "string"
        && DISCORD_SNOWFLAKE_PATTERN.test(record.threadId)
        && record.messageId === record.threadId
      )
  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.kind !== "forum-post-create"
    || typeof record.id !== "string"
    || !CONTENT_FREE_IDENTIFIER_PATTERN.test(record.id)
    || typeof record.timestamp !== "string"
    || Number.isNaN(Date.parse(record.timestamp))
    || ![
      "completed",
      "completed-with-drift",
      "failed",
      "pending",
      "uncertain",
    ].includes(String(record.status))
    || typeof record.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.guildId)
    || typeof record.parentChannelId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(record.parentChannelId)
    || !terminalIdsValid
    || typeof record.operationKeyHash !== "string"
    || !OPERATION_KEY_HASH_PATTERN.test(record.operationKeyHash)
    || typeof record.planDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.planDigest)
    || !(record.error === null || (
      typeof record.error === "string"
      && CONTENT_FREE_ERROR_PATTERN.test(record.error)
    ))
    || ![null, "drift", "match"].includes(record.verification as string | null)
    || (record.status === "pending" && (
      record.threadId !== null
      || record.error !== null
      || record.verification !== null
    ))
    || (record.status === "completed" && (
      record.threadId === null
      || record.verification !== "match"
      || record.error !== null
    ))
    || (record.status === "completed-with-drift" && (
      record.threadId === null
      || record.verification !== "drift"
      || record.error !== null
    ))
    || (record.status === "failed" && (
      record.threadId !== null
      || record.error === null
      || record.verification !== null
    ))
    || (record.status === "uncertain" && (
      record.error === null
      || record.verification !== null
    ))
  ) {
    return undefined
  }
  return {
    error: record.error,
    guildId: record.guildId,
    id: record.id,
    kind: "forum-post-create",
    messageId: record.messageId as string | null,
    operationKeyHash: record.operationKeyHash,
    parentChannelId: record.parentChannelId,
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as ForumPostActivityStatus,
    threadId: record.threadId as string | null,
    timestamp: record.timestamp,
    verification: record.verification as "drift" | "match" | null,
  }
}

function parseActivityEntry(value: unknown): ActivityEntry | undefined {
  return parseAttachmentMessageActivity(value)
    || parseForumPostActivity(value)
    || parseChannelCreationActivity(value)
    || parseMessagePinActivity(value)
    || parseRoleCreationActivity(value)
    || parseDeletionActivity(value)
    || parseInteractionActivity(value)
    || parseMemberModerationActivity(value)
}

export class JsonlActivityLog implements ActivityStore {
  readonly #file: string

  constructor(file: string) {
    this.#file = file
  }

  async append(entry: ActivityEntry): Promise<void> {
    const normalized = parseActivityEntry(entry)
    if (!normalized) {
      throw new AuditLogError("Discord activity has an invalid content-free shape")
    }
    try {
      await mkdir(dirname(this.#file), { mode: 0o700, recursive: true })
      const handle = await open(this.#file, "a", 0o600)
      try {
        await handle.appendFile(`${JSON.stringify(normalized)}\n`, "utf8")
      } finally {
        await handle.close()
      }
      await chmod(this.#file, 0o600)
    } catch (error) {
      throw new AuditLogError(
        `Unable to append Discord activity: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }

  async list(limit = 25): Promise<ActivityList> {
    const normalizedLimit = boundedLimit(limit)
    let fileSize: number
    try {
      fileSize = (await stat(this.#file)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { entries: [], file: this.#file, skippedLines: 0 }
      }
      throw new AuditLogError(
        `Unable to inspect Discord activity: ${errorMessage(error)}`,
        { cause: error },
      )
    }

    const readBytes = Math.min(fileSize, MAX_ACTIVITY_READ_BYTES)
    const offset = Math.max(0, fileSize - readBytes)
    try {
      const handle = await open(this.#file, "r")
      let text: string
      try {
        const buffer = Buffer.alloc(readBytes)
        const { bytesRead } = await handle.read(buffer, 0, readBytes, offset)
        text = buffer.subarray(0, bytesRead).toString("utf8")
      } finally {
        await handle.close()
      }

      const lines = text.split("\n")
      if (offset > 0) lines.shift()
      const entries: ActivityEntry[] = []
      let skippedLines = 0
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const value: unknown = JSON.parse(line)
          const entry = parseActivityEntry(value)
          if (entry) entries.push(entry)
          else skippedLines += 1
        } catch {
          skippedLines += 1
        }
      }
      return {
        entries: entries.slice(-normalizedLimit).reverse(),
        file: this.#file,
        skippedLines,
      }
    } catch (error) {
      if (error instanceof AuditLogError) throw error
      throw new AuditLogError(
        `Unable to read Discord activity: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }
}
