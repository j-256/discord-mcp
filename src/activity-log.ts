import {
  chmod,
  mkdir,
  open,
  stat,
} from "node:fs/promises"
import { dirname } from "node:path"

import {
  CONNECTOR_LIMITS,
  MEMBER_MODERATION_ACTIONS,
  SCHEMA_VERSION,
  type MemberModerationAction,
} from "./constants.js"
import { AuditLogError, errorMessage } from "./errors.js"

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

export type ActivityEntry = DeletionActivity | InteractionActivity | MemberModerationActivity

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

export class JsonlActivityLog implements ActivityStore {
  readonly #file: string

  constructor(file: string) {
    this.#file = file
  }

  async append(entry: ActivityEntry): Promise<void> {
    try {
      await mkdir(dirname(this.#file), { mode: 0o700, recursive: true })
      const handle = await open(this.#file, "a", 0o600)
      try {
        await handle.appendFile(`${JSON.stringify(entry)}\n`, "utf8")
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
          const entry = parseDeletionActivity(value)
            || parseInteractionActivity(value)
            || parseMemberModerationActivity(value)
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
