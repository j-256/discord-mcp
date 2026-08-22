import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityList,
  ActivityStore,
  DeletionActivity,
} from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
} from "../src/constants.js"
import {
  DeletionService,
  deletionOperations,
  normalizeDeletionRequest,
  normalizeMessageIds,
  type DeletionRequest,
  type DeletionServiceOptions,
} from "../src/deletion-service.js"
import {
  DeletionExecutionError,
  DeletionOperationConflictError,
  DeletionPlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
} from "../src/types.js"

const NOW = new Date("2026-08-14T12:00:00.000Z")
const DISCORD_EPOCH_MS = 1_420_070_400_000n
const APPLICATION_ID = "600000000000000001"
const BOT_ID = "500000000000000001"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const PARENT_ID = "200000000000000002"
const MESSAGE_ONE = snowflakeAt("2026-08-14T10:00:00.000Z", 1)
const MESSAGE_TWO = snowflakeAt("2026-08-14T11:00:00.000Z", 2)
const MESSAGE_THREE = snowflakeAt("2026-07-01T10:00:00.000Z", 3)
const OPERATION_KEY = "message-deletion-operation-0001"

function snowflakeAt(timestamp: string, increment: number): string {
  return (
    (BigInt(Date.parse(timestamp)) - DISCORD_EPOCH_MS) << 22n
    | BigInt(increment)
  ).toString()
}

function apiError(status: number, messageId: string): DiscordApiError {
  return new DiscordApiError({
    message: `Discord returned ${status}`,
    method: "GET",
    route: `/channels/${CHANNEL_ID}/messages/${messageId}`,
    status,
  })
}

class MemoryActivityStore implements ActivityStore {
  readonly entries: DeletionActivity[] = []
  failAfterEntries: number | undefined

  async append(entry: DeletionActivity): Promise<void> {
    if (
      this.failAfterEntries !== undefined
      && this.entries.length >= this.failAfterEntries
    ) {
      throw new Error("activity unavailable")
    }
    this.entries.push(structuredClone(entry))
  }

  async list(): Promise<ActivityList> {
    return {
      entries: [...this.entries].reverse(),
      file: "/memory/activity.jsonl",
      skippedLines: 0,
    }
  }
}

class MemoryOperationStore implements OperationStore {
  readonly receipts = new Map<string, OperationReceipt>()
  failFinish = false

  #key(kind: string, operationKeyHash: string): string {
    return `${kind}\0${operationKeyHash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    if (this.failFinish) throw new Error("operation store unavailable")
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), structuredClone(receipt))
  }

  async get(kind: OperationReceipt["kind"], operationKeyHash: string) {
    const receipt = this.receipts.get(this.#key(kind, operationKeyHash))
    return receipt ? structuredClone(receipt) : undefined
  }

  async reserve(receipt: OperationReceipt) {
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: structuredClone(existing) }
    this.receipts.set(key, structuredClone(receipt))
    return { created: true, receipt: structuredClone(receipt) }
  }
}

function message(
  id: string,
  timestamp: string,
  content = `content-${id}`,
  authorId = "400000000000000001",
  type = 0,
): DiscordMessage {
  return {
    attachments: [{
      filename: `${id}.txt`,
      id: `4${id.slice(1)}`,
      size: 12,
      url: `https://cdn.discord.test/${id}/private-attachment`,
    }],
    author: {
      bot: authorId === BOT_ID,
      id: authorId,
      username: `author-${id}`,
    },
    channel_id: CHANNEL_ID,
    components: [],
    content,
    embeds: [],
    guild_id: GUILD_ID,
    id,
    timestamp,
    type,
  }
}

function request(
  messageIds: readonly string[],
  operationKey = OPERATION_KEY,
): DeletionRequest {
  return {
    auditReason: "Remove reviewed messages",
    channelId: CHANNEL_ID,
    messageIds,
    operationKey,
  }
}

function policy(): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([CHANNEL_ID, PARENT_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: true,
    allowInteractions: false,
    deleteChannelIds: new Set([CHANNEL_ID]),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

interface FixtureOptions {
  channelType?: number
  manageMessages?: boolean
}

function fixture(
  initialMessages: DiscordMessage[],
  options: FixtureOptions = {},
) {
  const messages = new Map(initialMessages.map((entry) => [entry.id, entry]))
  const calls = {
    auditReasons: [] as string[],
    bulk: [] as string[][],
    individual: [] as string[],
    messageReads: [] as string[],
  }
  const channelType = options.channelType ?? DISCORD_CHANNEL_TYPES.text
  const permissions = (
    DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | (
      options.manageMessages === false
        ? 0n
        : DISCORD_PERMISSIONS.MANAGE_MESSAGES
    )
  ).toString()
  const channel: DiscordChannel = {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "cleanup",
    ...(channelType === DISCORD_CHANNEL_TYPES.privateThread
      ? { parent_id: PARENT_ID }
      : { permission_overwrites: [] }),
    type: channelType,
  }
  const client: DeletionServiceOptions["client"] = {
    async bulkDeleteMessages(_channelId, messageIds, reason) {
      calls.auditReasons.push(reason)
      calls.bulk.push([...messageIds])
      for (const messageId of messageIds) messages.delete(messageId)
    },
    async deleteMessage(_channelId, messageId, reason) {
      calls.auditReasons.push(reason)
      calls.individual.push(messageId)
      messages.delete(messageId)
    },
    async getChannel(channelId) {
      if (channelId === PARENT_ID) {
        return {
          guild_id: GUILD_ID,
          id: PARENT_ID,
          name: "forum",
          permission_overwrites: [],
          type: DISCORD_CHANNEL_TYPES.forum,
        }
      }
      return structuredClone(channel)
    },
    async getGuild() {
      return { id: GUILD_ID, name: "Test guild" }
    },
    async getGuildMember() {
      return {
        roles: [],
        user: { bot: true, id: BOT_ID, username: "connector" },
      }
    },
    async getGuildRoles() {
      return [{
        id: GUILD_ID,
        managed: false,
        name: "@everyone",
        permissions,
        position: 0,
      }]
    },
    async getMessage(_channelId, messageId) {
      calls.messageReads.push(messageId)
      const value = messages.get(messageId)
      if (!value) throw apiError(404, messageId)
      return structuredClone(value)
    },
    async getThreadMember(threadId, userId) {
      return {
        flags: 0,
        id: threadId,
        join_timestamp: NOW.toISOString(),
        user_id: userId,
      }
    },
  }
  const activityStore = new MemoryActivityStore()
  const operationStore = new MemoryOperationStore()
  const service = new DeletionService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: policy(),
    randomId: () => "activity-one",
  })
  return {
    activityStore,
    calls,
    channel,
    client,
    messages,
    operationStore,
    service,
  }
}

function plan(
  service: DeletionService,
  value: DeletionRequest,
) {
  return service.plan(APPLICATION_ID, BOT_ID, "enabled", value)
}

function execute(
  service: DeletionService,
  value: DeletionRequest,
  digest: string,
) {
  return service.execute(APPLICATION_ID, BOT_ID, "enabled", value, digest)
}

test("deletion request normalization binds a one-shot key and strict exact IDs", () => {
  const normalized = normalizeDeletionRequest(request([MESSAGE_TWO, MESSAGE_ONE]))

  assert.deepEqual(normalized.messageIds, [MESSAGE_ONE, MESSAGE_TWO])
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal("operationKey" in normalized, false)
  assert.throws(() => normalizeMessageIds([]), /between 1 and 100/)
  assert.throws(
    () => normalizeMessageIds(Array.from({ length: 101 }, (_, index) => String(index + 1))),
    /between 1 and 100/,
  )
  assert.throws(() => normalizeMessageIds(["0"]), /positive snowflakes/)
  assert.throws(() => normalizeMessageIds([MESSAGE_ONE, MESSAGE_ONE]), /unique/)
  assert.throws(
    () => normalizeDeletionRequest({ ...request([MESSAGE_ONE]), auditReason: " " }),
    /must not be blank/,
  )
})

test("deletion plan is deterministic, identity-bound, permission-aware, and content-bound", async () => {
  const one = message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")
  const two = message(MESSAGE_TWO, "2026-08-14T10:00:00.000Z")
  const data = fixture([one, two])
  const value = request([MESSAGE_TWO, MESSAGE_ONE])

  const first = await plan(data.service, value)
  const second = await plan(data.service, { ...value, messageIds: [MESSAGE_ONE, MESSAGE_TWO] })

  assert.equal(second.digest, first.digest)
  assert.deepEqual(first.application, {
    id: APPLICATION_ID,
    messageContentIntent: "enabled",
  })
  assert.deepEqual(first.bot, { id: BOT_ID })
  assert.equal(first.guild.id, GUILD_ID)
  assert.equal(first.channel.id, CHANNEL_ID)
  assert.equal(first.permission.manageMessages, true)
  assert.deepEqual(first.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    "MANAGE_MESSAGES",
  ])
  assert.deepEqual(first.operations, [{
    kind: "bulk",
    messageIds: [MESSAGE_ONE, MESSAGE_TWO],
  }])
  assert.equal(first.messages[0]?.contentPreview, one.content)
  assert.equal(first.privacy.persistence, "content-free")
})

test("own-message deletion remains least-authority and selects individual requests", async () => {
  const data = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "own-one", BOT_ID),
    message(MESSAGE_TWO, "2026-08-14T10:00:00.000Z", "own-two", BOT_ID),
  ], { manageMessages: false })

  const result = await plan(data.service, request([MESSAGE_ONE, MESSAGE_TWO]))

  assert.equal(result.permission.manageMessages, false)
  assert.deepEqual(result.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
  ])
  assert.deepEqual(result.operations, [{
    kind: "individual",
    messageIds: [MESSAGE_ONE, MESSAGE_TWO],
  }])
})

test("another author's message and AutoMod actions require MANAGE_MESSAGES", async () => {
  const other = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ], { manageMessages: false })
  const automod = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "", BOT_ID, 24),
  ], { manageMessages: false })

  await assert.rejects(
    () => plan(other.service, request([MESSAGE_ONE])),
    /lacks MANAGE_MESSAGES/,
  )
  await assert.rejects(
    () => plan(automod.service, request([MESSAGE_ONE])),
    /lacks MANAGE_MESSAGES/,
  )
})

test("planning rejects Discord message types documented as non-deletable", async () => {
  const data = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "", BOT_ID, 21),
  ])

  await assert.rejects(
    () => plan(data.service, request([MESSAGE_ONE])),
    /non-deletable message evidence/,
  )
})

test("private-thread planning binds exact parent and membership evidence", async () => {
  const data = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ], { channelType: DISCORD_CHANNEL_TYPES.privateThread })

  const result = await plan(data.service, request([MESSAGE_ONE]))

  assert.equal(result.channel.parentId, PARENT_ID)
  assert.equal(result.permission.permissionSourceChannelId, PARENT_ID)
  assert.equal(result.permission.privateThreadAccess, "lookup-succeeded")
})

test("planning rejects malformed, mismatched, and private-thread evidence", async () => {
  const wrongChannel = fixture([message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")])
  wrongChannel.client.getChannel = async () => ({
    guild_id: GUILD_ID,
    id: PARENT_ID,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
  })
  const wrongMessage = fixture([message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")])
  wrongMessage.client.getMessage = async () => (
    message(MESSAGE_TWO, "2026-08-14T11:00:00.000Z")
  )
  const wrongGuild = fixture([message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")])
  wrongGuild.client.getMessage = async () => ({
    ...message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
    guild_id: "100000000000000002",
  })
  const wrongThreadMember = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ], { channelType: DISCORD_CHANNEL_TYPES.privateThread })
  wrongThreadMember.client.getThreadMember = async () => ({
    flags: 0,
    id: CHANNEL_ID,
    join_timestamp: NOW.toISOString(),
    user_id: "500000000000000002",
  })
  const malformedMessage = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ])
  malformedMessage.client.getMessage = async () => ({
    ...message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
    attachments: [{
      filename: "unsafe\nfilename",
      id: "400000000000000001",
      size: 1,
      url: "https://cdn.discord.test/private",
    }],
  })

  await assert.rejects(() => plan(wrongChannel.service, request([MESSAGE_ONE])), /invalid deletion target/)
  await assert.rejects(() => plan(wrongMessage.service, request([MESSAGE_ONE])), /mismatched/)
  await assert.rejects(() => plan(wrongGuild.service, request([MESSAGE_ONE])), /mismatched/)
  await assert.rejects(() => plan(wrongThreadMember.service, request([MESSAGE_ONE])), /mismatched private-thread/)
  await assert.rejects(() => plan(malformedMessage.service, request([MESSAGE_ONE])), /incomplete/)
})

test("planning accepts Discord timestamps and rejects incomplete content-bearing arrays", async () => {
  const offsetTimestamp = "2026-08-14T11:00:00.123456+00:00"
  const accepted = fixture([message(MESSAGE_ONE, offsetTimestamp)])
  const missingAttachments = fixture([message(MESSAGE_ONE, offsetTimestamp)])
  const missingEmbeds = fixture([message(MESSAGE_ONE, offsetTimestamp)])
  missingAttachments.client.getMessage = async () => {
    const value = message(MESSAGE_ONE, offsetTimestamp)
    delete value.attachments
    return value
  }
  missingEmbeds.client.getMessage = async () => {
    const value = message(MESSAGE_ONE, offsetTimestamp)
    delete value.embeds
    return value
  }

  await plan(accepted.service, request([MESSAGE_ONE]))
  await assert.rejects(
    () => plan(missingAttachments.service, request([MESSAGE_ONE])),
    /incomplete/,
  )
  await assert.rejects(
    () => plan(missingEmbeds.service, request([MESSAGE_ONE])),
    /incomplete/,
  )
})

test("execution reserves and journals before non-retried age-safe writes then proves absence", async () => {
  const recentOne = message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "private-one")
  const recentTwo = message(MESSAGE_TWO, "2026-08-14T10:00:00.000Z", "private-two")
  const old = message(MESSAGE_THREE, "2026-07-01T10:00:00.000Z", "private-three")
  const data = fixture([recentOne, recentTwo, old])
  const value = request([MESSAGE_THREE, MESSAGE_TWO, MESSAGE_ONE])
  const reviewed = await plan(data.service, value)

  const result = await execute(data.service, value, reviewed.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.verifiedAbsent, true)
  assert.deepEqual(result.observedAbsentMessageIds, [MESSAGE_THREE, MESSAGE_ONE, MESSAGE_TWO])
  assert.deepEqual(data.calls.bulk, [[MESSAGE_ONE, MESSAGE_TWO]])
  assert.deepEqual(data.calls.individual, [MESSAGE_THREE])
  assert.deepEqual(data.calls.auditReasons, [value.auditReason, value.auditReason])
  assert.deepEqual(
    data.activityStore.entries.map((entry) => entry.status),
    ["pending", "completed"],
  )
  const receipt = [...data.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.verification, "match")
  const serialized = JSON.stringify({
    activity: data.activityStore.entries,
    receipts: [...data.operationStore.receipts.values()],
    result,
  })
  assert.doesNotMatch(serialized, /private-one|private-two|private-three/)
  assert.doesNotMatch(serialized, /cdn\.discord\.test|Remove reviewed messages/)
  assert.doesNotMatch(serialized, new RegExp(OPERATION_KEY))
})

test("execution rejects content changes before reservation or writing", async () => {
  const original = message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "original")
  const data = fixture([original])
  const value = request([MESSAGE_ONE])
  const reviewed = await plan(data.service, value)
  data.messages.set(
    MESSAGE_ONE,
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "edited"),
  )

  await assert.rejects(
    () => execute(data.service, value, reviewed.digest),
    DeletionPlanChangedError,
  )
  assert.deepEqual(data.calls.individual, [])
  assert.equal(data.operationStore.receipts.size, 0)
  assert.deepEqual(data.activityStore.entries, [])
})

test("execution treats a missing reviewed message as a changed plan", async () => {
  const data = fixture([message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")])
  const value = request([MESSAGE_ONE])
  const reviewed = await plan(data.service, value)
  data.messages.delete(MESSAGE_ONE)

  await assert.rejects(
    () => execute(data.service, value, reviewed.digest),
    (error: unknown) => (
      error instanceof DeletionPlanChangedError
      && error.actualDigest === "message-deletion-state-unavailable"
    ),
  )
  assert.equal(data.operationStore.receipts.size, 0)
})

test("a spent operation key blocks planning and execution", async () => {
  const data = fixture([message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")])
  const value = request([MESSAGE_ONE])
  const reviewed = await plan(data.service, value)
  await execute(data.service, value, reviewed.digest)

  await assert.rejects(
    () => plan(data.service, value),
    DeletionOperationConflictError,
  )
})

test("pending activity failure records a failed receipt and blocks mutation", async () => {
  const data = fixture([message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")])
  const value = request([MESSAGE_ONE])
  const reviewed = await plan(data.service, value)
  data.activityStore.failAfterEntries = 0

  await assert.rejects(
    () => execute(data.service, value, reviewed.digest),
    (error: unknown) => (
      error instanceof DeletionExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.deepEqual(data.calls.individual, [])
  assert.equal([...data.operationStore.receipts.values()][0]?.status, "failed")
})

test("a settled partial failure is observed, recorded, and not retried", async () => {
  const first = message(MESSAGE_ONE, "2026-07-01T10:00:00.000Z")
  const second = message(MESSAGE_TWO, "2026-07-01T11:00:00.000Z")
  const data = fixture([first, second])
  data.client.deleteMessage = async (_channelId, messageId) => {
    data.calls.individual.push(messageId)
    if (messageId === MESSAGE_TWO) throw apiError(403, messageId)
    data.messages.delete(messageId)
  }
  const value = request([MESSAGE_ONE, MESSAGE_TWO])
  const reviewed = await plan(data.service, value)

  await assert.rejects(
    () => execute(data.service, value, reviewed.digest),
    (error: unknown) => {
      if (!(error instanceof DeletionExecutionError)) return false
      const result = error.result as {
        observedAbsentMessageIds: string[]
        remainingMessageIds: string[]
        status: string
      }
      assert.equal(result.status, "partial")
      assert.deepEqual(result.observedAbsentMessageIds, [MESSAGE_ONE])
      assert.deepEqual(result.remainingMessageIds, [MESSAGE_TWO])
      return true
    },
  )
  assert.deepEqual(data.calls.individual, [MESSAGE_ONE, MESSAGE_TWO])
  assert.equal([...data.operationStore.receipts.values()][0]?.status, "failed")
  assert.deepEqual(
    data.activityStore.entries.map((entry) => entry.status),
    ["pending", "partial"],
  )
})

test("an ambiguous mutation with a surviving target is uncertain", async () => {
  const data = fixture([message(MESSAGE_ONE, "2026-07-01T10:00:00.000Z")])
  data.client.deleteMessage = async () => {
    throw apiError(500, MESSAGE_ONE)
  }
  const value = request([MESSAGE_ONE])
  const reviewed = await plan(data.service, value)

  await assert.rejects(
    () => execute(data.service, value, reviewed.digest),
    (error: unknown) => (
      error instanceof DeletionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal([...data.operationStore.receipts.values()][0]?.status, "uncertain")
})

test("exact absence settles an ambiguous mutation as completed with drift", async () => {
  const data = fixture([message(MESSAGE_ONE, "2026-07-01T10:00:00.000Z")])
  data.client.deleteMessage = async (_channelId, messageId) => {
    data.messages.delete(messageId)
    throw apiError(500, messageId)
  }
  const value = request([MESSAGE_ONE])
  const reviewed = await plan(data.service, value)

  const result = await execute(data.service, value, reviewed.digest)

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verifiedAbsent, true)
  const receipt = [...data.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.verification, "drift")
  assert.equal(data.activityStore.entries.at(-1)?.error, "DiscordApiError.500.unknown")
})

test("failed exact readback after mutation is uncertain", async () => {
  const data = fixture([message(MESSAGE_ONE, "2026-07-01T10:00:00.000Z")])
  const originalGet = data.client.getMessage
  let reads = 0
  data.client.getMessage = async (...args) => {
    reads += 1
    if (reads >= 3) throw apiError(500, MESSAGE_ONE)
    return originalGet(...args)
  }
  const value = request([MESSAGE_ONE])
  const reviewed = await plan(data.service, value)

  await assert.rejects(
    () => execute(data.service, value, reviewed.digest),
    (error: unknown) => (
      error instanceof DeletionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal([...data.operationStore.receipts.values()][0]?.status, "uncertain")
})

test("completed deletion reports operation-record and final-activity failures exactly", async () => {
  const operationFailure = fixture([
    message(MESSAGE_ONE, "2026-07-01T10:00:00.000Z"),
  ])
  const firstRequest = request([MESSAGE_ONE])
  const firstPlan = await plan(operationFailure.service, firstRequest)
  operationFailure.operationStore.failFinish = true

  await assert.rejects(
    () => execute(operationFailure.service, firstRequest, firstPlan.digest),
    (error: unknown) => (
      error instanceof DeletionExecutionError
      && (error.result as { status: string }).status
        === "completed-operation-record-failed"
    ),
  )

  const activityFailure = fixture([
    message(MESSAGE_ONE, "2026-07-01T10:00:00.000Z"),
  ])
  const secondRequest = request([MESSAGE_ONE], "message-deletion-operation-0002")
  const secondPlan = await plan(activityFailure.service, secondRequest)
  activityFailure.activityStore.failAfterEntries = 1

  await assert.rejects(
    () => execute(activityFailure.service, secondRequest, secondPlan.digest),
    (error: unknown) => (
      error instanceof DeletionExecutionError
      && (error.result as { status: string }).status === "completed-audit-failed"
    ),
  )
  assert.equal([...activityFailure.operationStore.receipts.values()][0]?.status, "completed")
})

test("deletion strategy uses conservative timestamp and snowflake age evidence", () => {
  const safelyRecent = message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")
  const nearBoundaryId = snowflakeAt("2026-07-31T12:00:30.000Z", 2)
  const nearBoundary = message(nearBoundaryId, "2026-07-31T12:00:30.000Z")
  const oldSnowflakeId = snowflakeAt("2026-07-01T12:00:00.000Z", 3)
  const inconsistent = message(oldSnowflakeId, "2026-08-14T11:00:00.000Z")

  const operations = deletionOperations([safelyRecent, nearBoundary], NOW)
  const inconsistentOperations = deletionOperations([safelyRecent, inconsistent], NOW)

  assert.deepEqual(operations, [{
    kind: "individual",
    messageIds: [nearBoundaryId, MESSAGE_ONE],
  }])
  assert.deepEqual(inconsistentOperations, [{
    kind: "individual",
    messageIds: [oldSnowflakeId, MESSAGE_ONE],
  }])
  assert.equal(DISCORD_LIMITS.deletionMessages, 100)
})
