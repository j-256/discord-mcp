import { createHmac, randomBytes, randomUUID } from "node:crypto"

import type {
  ActivityStore,
  DeletionActivity,
} from "./activity-log.js"
import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  DeletionExecutionError,
  DeletionPlanChangedError,
  DiscordApiError,
  errorMessage,
} from "./errors.js"
import {
  deletionPreview,
  deletionSnapshot,
  stableString,
} from "./normalize.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "./types.js"

const PLAN_DIGEST_PREFIX = "hmac-sha256:"

export interface DeletionOperation {
  kind: "bulk" | "individual"
  messageIds: string[]
}

export interface DeletionPlan {
  channelId: string
  createdAt: string
  digest: string
  guildId: string
  messageIds: string[]
  messages: ReturnType<typeof deletionPreview>[]
  operations: DeletionOperation[]
  schemaVersion: number
  status: "planned"
}

export interface DeletionResult {
  activityId: string
  channelId: string
  deletedMessageIds: string[]
  guildId: string
  planDigest: string
  schemaVersion: number
  status: "completed"
}

export interface DeletionServiceOptions {
  activityStore: ActivityStore
  client: Pick<
    DiscordClient,
    "bulkDeleteMessages" | "deleteMessage" | "getChannel" | "getMessage"
  >
  clock?: () => Date
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
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
    messageIds.length < 1
    || messageIds.length > DISCORD_LIMITS.deletionMessages
  ) {
    throw new Error(
      `Discord deletion requires between 1 and ${DISCORD_LIMITS.deletionMessages} message IDs`,
    )
  }
  if (messageIds.some((messageId) => !DISCORD_SNOWFLAKE_PATTERN.test(messageId))) {
    throw new Error("Discord deletion message IDs must be valid snowflakes")
  }
  const normalized = [...messageIds].sort(compareSnowflakes)
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Discord deletion message IDs must be unique")
  }
  return normalized
}

function messageTime(message: DiscordMessage): number {
  const timestamp = Date.parse(message.timestamp)
  if (Number.isNaN(timestamp)) {
    throw new Error(`Discord message ${message.id} has an invalid timestamp`)
  }
  return timestamp
}

export function deletionOperations(
  messages: readonly DiscordMessage[],
  now: Date,
): DeletionOperation[] {
  const bulkCutoff = now.getTime()
    - DISCORD_LIMITS.bulkDeleteAgeMs
    + DISCORD_LIMITS.bulkDeleteSafetyMarginMs
  const recent: string[] = []
  const individual: string[] = []
  for (const message of messages) {
    if (messageTime(message) >= bulkCutoff) recent.push(message.id)
    else individual.push(message.id)
  }

  const operations: DeletionOperation[] = []
  if (recent.length >= 2) {
    operations.push({ kind: "bulk", messageIds: recent })
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

function digestPlan(
  key: Uint8Array,
  channelId: string,
  guildId: string,
  messages: readonly DiscordMessage[],
  operations: readonly DeletionOperation[],
): string {
  const payload = {
    channelId,
    guildId,
    messages: messages.map(deletionSnapshot),
    operations,
  }
  const digest = createHmac("sha256", key)
    .update(stableString(payload))
    .digest("hex")
  return `${PLAN_DIGEST_PREFIX}${digest}`
}

function strategyNames(operations: readonly DeletionOperation[]): string[] {
  return operations.map((operation) => `${operation.kind}:${operation.messageIds.length}`)
}

function activityError(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError status=${error.status} code=${error.code ?? "unknown"}`
  }
  return error instanceof Error ? error.name : "UnknownError"
}

function activityEntry(options: {
  activityId: string
  channelId: string
  deletedMessageIds?: readonly string[]
  error?: string | null
  failedMessageId?: string | null
  guildId: string
  messageIds: readonly string[]
  planDigest: string
  status: DeletionActivity["status"]
  strategies: readonly string[]
  timestamp: string
}): DeletionActivity {
  return {
    channelId: options.channelId,
    deletedMessageIds: [...(options.deletedMessageIds || [])],
    error: options.error ?? null,
    failedMessageId: options.failedMessageId ?? null,
    guildId: options.guildId,
    id: options.activityId,
    messageIds: [...options.messageIds],
    planDigest: options.planDigest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    strategies: [...options.strategies],
    timestamp: options.timestamp,
  }
}

export class DeletionService {
  readonly #activityStore: ActivityStore
  readonly #client: DeletionServiceOptions["client"]
  readonly #clock: () => Date
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: DeletionServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#planKey = options.planKey || randomBytes(32)
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async plan(
    channelId: string,
    requestedMessageIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<DeletionPlan> {
    const messageIds = normalizeMessageIds(requestedMessageIds)
    const channel: DiscordChannel = await this.#client.getChannel(channelId, options)
    const guildId = this.#policy.assertChannelDeletable(channel)
    const messages: DiscordMessage[] = []
    for (const messageId of messageIds) {
      const message = await this.#client.getMessage(channelId, messageId, options)
      if (message.channel_id !== channelId) {
        throw new Error(`Discord returned message ${message.id} for the wrong channel`)
      }
      messages.push(message)
    }
    messages.sort((left, right) => compareSnowflakes(left.id, right.id))
    const createdAt = this.#clock()
    const operations = deletionOperations(messages, createdAt)
    return {
      channelId,
      createdAt: createdAt.toISOString(),
      digest: digestPlan(this.#planKey, channelId, guildId, messages, operations),
      guildId,
      messageIds,
      messages: messages.map(deletionPreview),
      operations,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
    }
  }

  async execute(
    channelId: string,
    messageIds: readonly string[],
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<DeletionResult> {
    let plan: DeletionPlan
    try {
      plan = await this.plan(channelId, messageIds, options)
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) {
        throw new DeletionPlanChangedError(expectedDigest, "message-unavailable")
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new DeletionPlanChangedError(expectedDigest, plan.digest)
    }

    const activityId = this.#randomId()
    const strategies = strategyNames(plan.operations)
    await this.#activityStore.append(activityEntry({
      activityId,
      channelId: plan.channelId,
      guildId: plan.guildId,
      messageIds: plan.messageIds,
      planDigest: plan.digest,
      status: "pending",
      strategies,
      timestamp: this.#clock().toISOString(),
    }))

    const deletedMessageIds: string[] = []
    let failedMessageId: string | null = null
    const auditReason = `MCP host approved deletion plan ${plan.digest.slice(0, 32)}`
    try {
      for (const operation of plan.operations) {
        if (operation.kind === "bulk") {
          await this.#client.bulkDeleteMessages(
            plan.channelId,
            operation.messageIds,
            auditReason,
            options,
          )
          deletedMessageIds.push(...operation.messageIds)
          continue
        }
        for (const messageId of operation.messageIds) {
          failedMessageId = messageId
          await this.#client.deleteMessage(
            plan.channelId,
            messageId,
            auditReason,
            options,
          )
          deletedMessageIds.push(messageId)
          failedMessageId = null
        }
      }
    } catch (error) {
      const failureStatus = deletedMessageIds.length > 0 ? "partial" : "failed"
      const result = {
        activityId,
        channelId: plan.channelId,
        deletedMessageIds,
        error: activityError(error),
        failedMessageId,
        guildId: plan.guildId,
        planDigest: plan.digest,
        schemaVersion: SCHEMA_VERSION,
        status: failureStatus,
      }
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          channelId: plan.channelId,
          deletedMessageIds,
          error: result.error,
          failedMessageId,
          guildId: plan.guildId,
          messageIds: plan.messageIds,
          planDigest: plan.digest,
          status: failureStatus,
          strategies,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (auditError) {
        result.error = `${result.error}; final activity write failed: ${errorMessage(auditError)}`
      }
      throw new DeletionExecutionError(
        "Discord message deletion did not complete",
        result,
        { cause: error },
      )
    }

    const result: DeletionResult = {
      activityId,
      channelId: plan.channelId,
      deletedMessageIds,
      guildId: plan.guildId,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        channelId: plan.channelId,
        deletedMessageIds,
        guildId: plan.guildId,
        messageIds: plan.messageIds,
        planDigest: plan.digest,
        status: "completed",
        strategies,
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      throw new DeletionExecutionError(
        "Discord messages were deleted but the final activity record failed",
        {
          ...result,
          auditError: errorMessage(error),
          status: "completed-audit-failed",
        },
        { cause: error },
      )
    }
    return result
  }
}
