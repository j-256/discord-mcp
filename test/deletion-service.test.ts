import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityList,
  ActivityStore,
  DeletionActivity,
} from "../src/activity-log.js"
import {
  DeletionService,
  deletionOperations,
  normalizeMessageIds,
  type DeletionServiceOptions,
} from "../src/deletion-service.js"
import {
  DeletionExecutionError,
  DeletionPlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
} from "../src/types.js"

const NOW = new Date("2026-08-14T12:00:00.000Z")
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const MESSAGE_ONE = "300000000000000001"
const MESSAGE_TWO = "300000000000000002"
const MESSAGE_THREE = "300000000000000003"

class MemoryActivityStore implements ActivityStore {
  readonly entries: DeletionActivity[] = []
  failAppend = false
  failAfterEntries: number | undefined

  async append(entry: DeletionActivity): Promise<void> {
    if (
      this.failAppend
      || (
        this.failAfterEntries !== undefined
        && this.entries.length >= this.failAfterEntries
      )
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

function message(
  id: string,
  timestamp: string,
  content = `content-${id}`,
): DiscordMessage {
  return {
    attachments: [{
      filename: `${id}.txt`,
      id: `4${id.slice(1)}`,
      size: 12,
      url: `https://cdn.discord.test/${id}/private-attachment`,
    }],
    author: {
      bot: false,
      id: `5${id.slice(1)}`,
      username: `author-${id}`,
    },
    channel_id: CHANNEL_ID,
    components: [],
    content,
    embeds: [],
    guild_id: GUILD_ID,
    id,
    timestamp,
    type: 0,
  }
}

function policy(): ScopePolicy {
  return new ScopePolicy({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowDeletions: true,
    deleteChannelIds: new Set([CHANNEL_ID]),
  })
}

function fixture(initialMessages: DiscordMessage[]) {
  const messages = new Map(initialMessages.map((entry) => [entry.id, entry]))
  const calls = {
    bulk: [] as string[][],
    individual: [] as string[],
  }
  const client: DeletionServiceOptions["client"] = {
    async bulkDeleteMessages(_channelId, messageIds) {
      calls.bulk.push([...messageIds])
    },
    async deleteMessage(_channelId, messageId) {
      calls.individual.push(messageId)
    },
    async getChannel(): Promise<DiscordChannel> {
      return {
        guild_id: GUILD_ID,
        id: CHANNEL_ID,
        name: "cleanup",
        type: 0,
      }
    },
    async getMessage(_channelId, messageId) {
      const value = messages.get(messageId)
      if (!value) throw new Error(`missing ${messageId}`)
      return structuredClone(value)
    },
  }
  const activityStore = new MemoryActivityStore()
  const service = new DeletionService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    planKey: new Uint8Array(32).fill(7),
    policy: policy(),
    randomId: () => "activity-one",
  })
  return {
    activityStore,
    calls,
    client,
    messages,
    service,
  }
}

test("deletion plan is deterministic, exact-ID based, and process keyed", async () => {
  const one = message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")
  const two = message(MESSAGE_TWO, "2026-08-14T10:00:00.000Z")
  const { service } = fixture([one, two])

  const first = await service.plan(CHANNEL_ID, [MESSAGE_TWO, MESSAGE_ONE])
  const second = await service.plan(CHANNEL_ID, [MESSAGE_ONE, MESSAGE_TWO])

  assert.match(first.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(second.digest, first.digest)
  assert.deepEqual(first.messageIds, [MESSAGE_ONE, MESSAGE_TWO])
  assert.deepEqual(first.operations, [{
    kind: "bulk",
    messageIds: [MESSAGE_ONE, MESSAGE_TWO],
  }])
  assert.equal(first.messages[0]?.contentPreview, one.content)
})

test("deletion ID normalization enforces core bounds without the MCP schema", () => {
  assert.throws(() => normalizeMessageIds([]), /between 1 and 100/)
  assert.throws(
    () => normalizeMessageIds(Array.from({ length: 101 }, (_, index) => String(index + 1))),
    /between 1 and 100/,
  )
  assert.throws(() => normalizeMessageIds(["not-a-snowflake"]), /valid snowflakes/)
})

test("deletion planning rejects Discord responses outside exact requested identities", async () => {
  const wrongChannel = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ])
  wrongChannel.client.getChannel = async () => ({
    guild_id: GUILD_ID,
    id: "200000000000000002",
    type: 0,
  })
  const wrongMessage = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ])
  wrongMessage.client.getMessage = async () => (
    message(MESSAGE_TWO, "2026-08-14T11:00:00.000Z")
  )
  const wrongGuild = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ])
  wrongGuild.client.getMessage = async () => ({
    ...message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
    guild_id: "100000000000000002",
  })

  await assert.rejects(
    () => wrongChannel.service.plan(CHANNEL_ID, [MESSAGE_ONE]),
    /different deletion channel than requested/,
  )
  await assert.rejects(
    () => wrongMessage.service.plan(CHANNEL_ID, [MESSAGE_ONE]),
    /different message than requested for deletion/,
  )
  await assert.rejects(
    () => wrongGuild.service.plan(CHANNEL_ID, [MESSAGE_ONE]),
    /different message than requested for deletion/,
  )
  assert.deepEqual(wrongChannel.activityStore.entries, [])
  assert.deepEqual(wrongMessage.activityStore.entries, [])
  assert.deepEqual(wrongGuild.activityStore.entries, [])
})

test("deletion execution journals before writing and uses age-safe strategies", async () => {
  const recentOne = message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "private-one")
  const recentTwo = message(MESSAGE_TWO, "2026-08-14T10:00:00.000Z", "private-two")
  const old = message(MESSAGE_THREE, "2026-07-01T10:00:00.000Z", "private-three")
  const { activityStore, calls, service } = fixture([recentOne, recentTwo, old])
  const plan = await service.plan(
    CHANNEL_ID,
    [MESSAGE_THREE, MESSAGE_TWO, MESSAGE_ONE],
  )

  const result = await service.execute(CHANNEL_ID, plan.messageIds, plan.digest)

  assert.equal(result.status, "completed")
  assert.deepEqual(calls.bulk, [[MESSAGE_ONE, MESSAGE_TWO]])
  assert.deepEqual(calls.individual, [MESSAGE_THREE])
  assert.deepEqual(
    activityStore.entries.map((entry) => entry.status),
    ["pending", "completed"],
  )
  const serializedActivity = JSON.stringify(activityStore.entries)
  assert.doesNotMatch(serializedActivity, /private-one|private-two|private-three/)
  assert.doesNotMatch(serializedActivity, /cdn\.discord\.test/)
})

test("deletion execution rejects content changes before journaling or writing", async () => {
  const original = message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "original")
  const { activityStore, calls, messages, service } = fixture([original])
  const plan = await service.plan(CHANNEL_ID, [MESSAGE_ONE])
  messages.set(
    MESSAGE_ONE,
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z", "edited"),
  )

  await assert.rejects(
    () => service.execute(CHANNEL_ID, [MESSAGE_ONE], plan.digest),
    DeletionPlanChangedError,
  )
  assert.deepEqual(calls.bulk, [])
  assert.deepEqual(calls.individual, [])
  assert.deepEqual(activityStore.entries, [])
})

test("deletion execution treats a missing reviewed message as a changed plan", async () => {
  const data = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ])
  const plan = await data.service.plan(CHANNEL_ID, [MESSAGE_ONE])
  data.client.getMessage = async () => {
    throw new DiscordApiError({
      message: "Discord returned 404",
      method: "GET",
      route: `/channels/${CHANNEL_ID}/messages/${MESSAGE_ONE}`,
      status: 404,
    })
  }

  await assert.rejects(
    () => data.service.execute(CHANNEL_ID, [MESSAGE_ONE], plan.digest),
    (error: unknown) => (
      error instanceof DeletionPlanChangedError
      && error.actualDigest === "message-unavailable"
    ),
  )
  assert.deepEqual(data.calls.individual, [])
  assert.deepEqual(data.activityStore.entries, [])
})

test("deletion execution treats response identity mismatch as a changed plan", async () => {
  const data = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ])
  const plan = await data.service.plan(CHANNEL_ID, [MESSAGE_ONE])
  data.client.getMessage = async () => (
    message(MESSAGE_TWO, "2026-08-14T11:00:00.000Z")
  )

  await assert.rejects(
    () => data.service.execute(CHANNEL_ID, [MESSAGE_ONE], plan.digest),
    (error: unknown) => (
      error instanceof DeletionPlanChangedError
      && error.actualDigest === "response-identity-mismatch"
    ),
  )
  assert.deepEqual(data.calls.bulk, [])
  assert.deepEqual(data.calls.individual, [])
  assert.deepEqual(data.activityStore.entries, [])
})

test("deletion execution blocks when the pending activity record cannot be written", async () => {
  const { activityStore, calls, service } = fixture([
    message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z"),
  ])
  const plan = await service.plan(CHANNEL_ID, [MESSAGE_ONE])
  activityStore.failAppend = true

  await assert.rejects(
    () => service.execute(CHANNEL_ID, [MESSAGE_ONE], plan.digest),
    /activity unavailable/,
  )
  assert.deepEqual(calls.individual, [])
})

test("deletion execution reports and audits a bounded partial failure without content", async () => {
  const first = message(MESSAGE_ONE, "2026-07-01T10:00:00.000Z", "sensitive-first")
  const second = message(MESSAGE_TWO, "2026-07-01T11:00:00.000Z", "sensitive-second")
  const data = fixture([first, second])
  data.client.deleteMessage = async (_channelId, messageId) => {
    if (messageId === MESSAGE_TWO) throw new Error("write failed")
    data.calls.individual.push(messageId)
  }
  const plan = await data.service.plan(CHANNEL_ID, [MESSAGE_ONE, MESSAGE_TWO])

  await assert.rejects(
    () => data.service.execute(CHANNEL_ID, plan.messageIds, plan.digest),
    (error: unknown) => {
      if (!(error instanceof DeletionExecutionError)) return false
      const result = error.result as {
        deletedMessageIds: string[]
        failedMessageId: string
        status: string
      }
      assert.deepEqual(result.deletedMessageIds, [MESSAGE_ONE])
      assert.equal(result.failedMessageId, MESSAGE_TWO)
      assert.equal(result.status, "partial")
      return true
    },
  )
  assert.deepEqual(
    data.activityStore.entries.map((entry) => entry.status),
    ["pending", "partial"],
  )
  assert.doesNotMatch(
    JSON.stringify(data.activityStore.entries),
    /sensitive-first|sensitive-second/,
  )
})

test("deletion execution reports when final journaling fails after the write", async () => {
  const data = fixture([
    message(MESSAGE_ONE, "2026-07-01T10:00:00.000Z"),
  ])
  const plan = await data.service.plan(CHANNEL_ID, [MESSAGE_ONE])
  data.activityStore.failAfterEntries = 1

  await assert.rejects(
    () => data.service.execute(CHANNEL_ID, [MESSAGE_ONE], plan.digest),
    (error: unknown) => {
      if (!(error instanceof DeletionExecutionError)) return false
      const result = error.result as {
        deletedMessageIds: string[]
        status: string
      }
      assert.deepEqual(result.deletedMessageIds, [MESSAGE_ONE])
      assert.equal(result.status, "completed-audit-failed")
      return true
    },
  )
  assert.deepEqual(data.calls.individual, [MESSAGE_ONE])
  assert.deepEqual(
    data.activityStore.entries.map((entry) => entry.status),
    ["pending"],
  )
})

test("deletion strategy keeps messages near the bulk age boundary individual", () => {
  const safelyRecent = message(MESSAGE_ONE, "2026-08-14T11:00:00.000Z")
  const nearBoundary = message(MESSAGE_TWO, "2026-07-31T12:00:30.000Z")

  const operations = deletionOperations([safelyRecent, nearBoundary], NOW)

  assert.deepEqual(operations, [{
    kind: "individual",
    messageIds: [MESSAGE_ONE, MESSAGE_TWO],
  }])
})
