import {
  chmod,
  mkdir,
  open,
  stat,
} from "node:fs/promises"
import { dirname } from "node:path"

import { CONNECTOR_LIMITS, SCHEMA_VERSION } from "./constants.js"
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
  messageIds: string[]
  planDigest: string
  schemaVersion: number
  status: DeletionActivityStatus
  strategies: string[]
  timestamp: string
}

export interface ActivityList {
  entries: DeletionActivity[]
  file: string
  skippedLines: number
}

export interface ActivityStore {
  append(entry: DeletionActivity): Promise<void>
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
    messageIds: [...record.messageIds],
    planDigest: record.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: record.status as DeletionActivityStatus,
    strategies: [...record.strategies],
    timestamp: record.timestamp,
  }
}

export class JsonlActivityLog implements ActivityStore {
  readonly #file: string

  constructor(file: string) {
    this.#file = file
  }

  async append(entry: DeletionActivity): Promise<void> {
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
        `Unable to append Discord deletion activity: ${errorMessage(error)}`,
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
        `Unable to inspect Discord deletion activity: ${errorMessage(error)}`,
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
      const entries: DeletionActivity[] = []
      let skippedLines = 0
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const value: unknown = JSON.parse(line)
          const entry = parseDeletionActivity(value)
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
        `Unable to read Discord deletion activity: ${errorMessage(error)}`,
        { cause: error },
      )
    }
  }
}
