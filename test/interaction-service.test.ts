import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityList,
  ActivityStore,
} from "../src/activity-log.js"
import type {
  CreateMessageInput,
  EditMessageInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  InteractionConflictError,
  InteractionExecutionError,
  InteractionIdentityError,
  PolicyError,
} from "../src/errors.js"
import {
  InteractionService,
  interactionNonce,
  type InteractionServiceClient,
} from "../src/interaction-service.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
} from "../src/types.js"

const BOT_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const CHANNEL_ID = "300000000000000001"
const OTHER_CHANNEL_ID = "300000000000000002"
const MESSAGE_ID = "400000000000000001"
const REPLY_MESSAGE_ID = "400000000000000002"
const MEMBER_ID = "500000000000000001"
const NOTIFY_USER_ID = "500000000000000002"
const IDEMPOTENCY_KEY = "request-1234567890"

class MemoryActivityStore implements ActivityStore {
  readonly entries: ActivityEntry[] = []
  readonly events: string[]
  failAfterEntries: number | undefined

  constructor(events: string[] = []) {
    this.events = events
  }

  async append(entry: ActivityEntry): Promise<void> {
    if (
      this.failAfterEntries !== undefined
      && this.entries.length >= this.failAfterEntries
    ) {
      throw new Error("activity unavailable")
    }
    this.entries.push(structuredClone(entry))
    this.events.push(`audit:${entry.status}`)
  }

  async list(): Promise<ActivityList> {
    return {
      entries: [...this.entries].reverse(),
      file: "/memory/activity.jsonl",
      skippedLines: 0,
    }
  }
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "interactions",
    type: 0,
    ...overrides,
  }
}

function message(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    author: {
      bot: true,
      id: BOT_ID,
      username: "connector-bot",
    },
    channel_id: CHANNEL_ID,
    content: "old content",
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    timestamp: "2026-08-14T00:00:00.000Z",
    type: 0,
    ...overrides,
  }
}

function policy(options: {
  interactionChannelIds?: readonly string[]
  mentionUserIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    allowedChannelIds: new Set([CHANNEL_ID, OTHER_CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowDeletions: false,
    allowInteractions: true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(options.interactionChannelIds || [CHANNEL_ID]),
    interactionMaxWritesPerMinute: 60,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(options.mentionUserIds || []),
  })
}

function createdMessage(input: CreateMessageInput): DiscordMessage {
  return message({
    content: input.content,
    id: MESSAGE_ID,
    ...(input.reply
      ? { message_reference: {
          channel_id: CHANNEL_ID,
          guild_id: GUILD_ID,
          message_id: input.reply.messageId,
        } }
      : {}),
    nonce: input.nonce,
  })
}

function fixture(options: {
  client?: Partial<InteractionServiceClient>
  interactionPolicy?: ScopePolicy
  store?: MemoryActivityStore
} = {}) {
  const events = options.store?.events || []
  const store = options.store || new MemoryActivityStore(events)
  const calls = {
    create: [] as CreateMessageInput[],
    edit: [] as EditMessageInput[],
    reaction: [] as string[],
  }
  const client: InteractionServiceClient = {
    async addOwnReaction(_channelId, _messageId, emoji) {
      calls.reaction.push(emoji)
      events.push("reaction")
    },
    async createMessage(_channelId, input) {
      calls.create.push(structuredClone(input))
      events.push("create")
      return createdMessage(input)
    },
    async editMessage(_channelId, _messageId, input) {
      calls.edit.push(structuredClone(input))
      events.push("edit")
      return message({ content: input.content })
    },
    async getChannel(channelId) {
      return channel({ id: channelId })
    },
    async getMessage(_channelId, messageId) {
      if (messageId === REPLY_MESSAGE_ID) {
        return message({
          author: { bot: false, id: MEMBER_ID, username: "member" },
          id: REPLY_MESSAGE_ID,
        })
      }
      return message({ id: messageId })
    },
  }
  Object.assign(client, options.client)
  let activitySequence = 0
  const service = new InteractionService({
    activityStore: store,
    client,
    clock: () => new Date("2026-08-14T00:00:00.000Z"),
    maxWritesPerMinute: 60,
    minWriteIntervalMs: 0,
    policy: options.interactionPolicy || policy(),
    randomId: () => `activity-${++activitySequence}`,
  })
  return { calls, client, events, service, store }
}

test("interaction nonce is stable, channel-bound, and Discord-sized", () => {
  const first = interactionNonce(CHANNEL_ID, IDEMPOTENCY_KEY)

  assert.equal(first, interactionNonce(CHANNEL_ID, IDEMPOTENCY_KEY))
  assert.notEqual(first, interactionNonce(OTHER_CHANNEL_ID, IDEMPOTENCY_KEY))
  assert.notEqual(first, interactionNonce(CHANNEL_ID, `${IDEMPOTENCY_KEY}-other`))
  assert.equal(first.length, 25)
  assert.match(first, /^[A-Za-z0-9_-]+$/)
})

test("send suppresses mentions, journals before writing, and returns no content", async () => {
  const { calls, events, service, store } = fixture()

  const result = await service.sendMessage(BOT_ID, {
    channelId: CHANNEL_ID,
    content: "@everyone safe text",
    idempotencyKey: IDEMPOTENCY_KEY,
  })

  assert.deepEqual(calls.create[0]?.allowedMentions, {
    parse: [],
    replied_user: false,
  })
  assert.deepEqual(events, ["audit:pending", "create", "audit:completed"])
  assert.deepEqual(store.entries.map((entry) => entry.status), ["pending", "completed"])
  assert.equal(store.entries[0]?.kind, "message-send")
  assert.equal(store.entries[0] && "messageId" in store.entries[0]
    ? store.entries[0].messageId
    : undefined, null)
  assert.equal(store.entries[1] && "messageId" in store.entries[1]
    ? store.entries[1].messageId
    : undefined, MESSAGE_ID)
  assert.equal(result.messageId, MESSAGE_ID)
  assert.equal(result.localReplay, false)
  assert.doesNotMatch(JSON.stringify({ result, entries: store.entries }), /safe text/)
})

test("send permits only configured visible user and reply-author notifications", async () => {
  const { calls, service } = fixture({
    interactionPolicy: policy({ mentionUserIds: [MEMBER_ID, NOTIFY_USER_ID] }),
  })

  await service.sendMessage(BOT_ID, {
    channelId: CHANNEL_ID,
    content: `Attention <@${NOTIFY_USER_ID}>`,
    idempotencyKey: IDEMPOTENCY_KEY,
    notifyReplyAuthor: true,
    notifyUserIds: [NOTIFY_USER_ID],
    replyToMessageId: REPLY_MESSAGE_ID,
  })

  assert.deepEqual(calls.create[0], {
    allowedMentions: {
      replied_user: true,
      users: [NOTIFY_USER_ID],
    },
    content: `Attention <@${NOTIFY_USER_ID}>`,
    nonce: interactionNonce(CHANNEL_ID, IDEMPOTENCY_KEY),
    reply: { guildId: GUILD_ID, messageId: REPLY_MESSAGE_ID },
  })
})

test("send rejects unconfigured, invisible, and detached notification requests before writing", async () => {
  const configured = fixture({
    interactionPolicy: policy({ mentionUserIds: [NOTIFY_USER_ID] }),
  })

  await assert.rejects(
    () => configured.service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: `hello <@${MEMBER_ID}>`,
      idempotencyKey: IDEMPOTENCY_KEY,
      notifyUserIds: [MEMBER_ID],
    }),
    PolicyError,
  )
  await assert.rejects(
    () => configured.service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "hello without a visible mention",
      idempotencyKey: `${IDEMPOTENCY_KEY}-2`,
      notifyUserIds: [NOTIFY_USER_ID],
    }),
    /must have a visible user mention/,
  )
  await assert.rejects(
    () => configured.service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "hello",
      idempotencyKey: `${IDEMPOTENCY_KEY}-3`,
      notifyReplyAuthor: true,
    }),
    /requires a reply target/,
  )
  assert.equal(configured.calls.create.length, 0)
})

test("send enforces content, key, and channel identity outside the MCP adapter", async () => {
  const invalid = fixture()
  await assert.rejects(
    () => invalid.service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "hello",
      idempotencyKey: "short",
    }),
    /safe ASCII characters/,
  )
  await assert.rejects(
    () => invalid.service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "bad\u0000content",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /control characters/,
  )
  const mismatch = fixture({
    client: {
      async getChannel() {
        return channel({ id: OTHER_CHANNEL_ID })
      },
    },
  })
  await assert.rejects(
    () => mismatch.service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "hello",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    InteractionIdentityError,
  )
  assert.equal(invalid.calls.create.length, 0)
  assert.equal(mismatch.calls.create.length, 0)
})

test("send coalesces matching keys and rejects conflicting reuse", async () => {
  const { calls, service, store } = fixture()
  const request = {
    channelId: CHANNEL_ID,
    content: "one safe message",
    idempotencyKey: IDEMPOTENCY_KEY,
  }

  const [first, replay] = await Promise.all([
    service.sendMessage(BOT_ID, request),
    service.sendMessage(BOT_ID, request),
  ])

  assert.equal(first.localReplay, false)
  assert.equal(replay.localReplay, true)
  assert.equal(first.messageId, replay.messageId)
  assert.equal(calls.create.length, 1)
  assert.equal(store.entries.length, 2)
  await assert.rejects(
    () => service.sendMessage(BOT_ID, { ...request, content: "different" }),
    InteractionConflictError,
  )
  assert.equal(calls.create.length, 1)
})

test("failed sends leave the stable nonce retryable and record an uncertain outcome", async () => {
  const nonces: string[] = []
  let attempts = 0
  const { service, store } = fixture({
    client: {
      async createMessage(_channelId, input) {
        attempts += 1
        nonces.push(input.nonce)
        if (attempts === 1) throw new Error("connection reset")
        return createdMessage(input)
      },
    },
  })
  const request = {
    channelId: CHANNEL_ID,
    content: "retry safely",
    idempotencyKey: IDEMPOTENCY_KEY,
  }

  await assert.rejects(
    () => service.sendMessage(BOT_ID, request),
    (error: unknown) => (
      error instanceof InteractionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  const result = await service.sendMessage(BOT_ID, request)

  assert.equal(result.status, "completed")
  assert.deepEqual(nonces, [
    interactionNonce(CHANNEL_ID, IDEMPOTENCY_KEY),
    interactionNonce(CHANNEL_ID, IDEMPOTENCY_KEY),
  ])
  assert.deepEqual(store.entries.map((entry) => entry.status), [
    "pending",
    "uncertain",
    "pending",
    "completed",
  ])
})

test("send treats mismatched successful content or reply state as uncertain", async () => {
  for (const response of [
    (input: CreateMessageInput) => createdMessage({ ...input, content: "different response" }),
    (input: CreateMessageInput) => ({
      ...createdMessage(input),
      message_reference: { message_id: REPLY_MESSAGE_ID },
    }),
  ]) {
    const { service, store } = fixture({
      client: {
        async createMessage(_channelId, input) {
          return response(input)
        },
      },
    })

    await assert.rejects(
      () => service.sendMessage(BOT_ID, {
        channelId: CHANNEL_ID,
        content: "requested content",
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      (error: unknown) => (
        error instanceof InteractionExecutionError
        && (error.result as { status: string }).status === "uncertain"
      ),
    )
    assert.deepEqual(store.entries.map((entry) => entry.status), ["pending", "uncertain"])
  }
})

test("send records a known Discord rejection as failed without persisting details", async () => {
  const { service, store } = fixture({
    client: {
      async createMessage() {
        throw new DiscordApiError({
          code: 50013,
          message: "Discord rejected private request details",
          method: "POST",
          retryAfterMs: 875,
          route: `/channels/${CHANNEL_ID}/messages`,
          status: 403,
        })
      },
    },
  })

  await assert.rejects(
    () => service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "not persisted",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    (error: unknown) => (
      error instanceof InteractionExecutionError
      && (error.result as { status: string }).status === "failed"
      && (error.result as { retryAfterMs: number }).retryAfterMs === 875
    ),
  )
  assert.deepEqual(store.entries.map((entry) => entry.status), ["pending", "failed"])
  assert.doesNotMatch(JSON.stringify(store.entries), /private request details|not persisted/)
})

test("edit requires bot ownership, suppresses mentions, and short-circuits exact no-ops", async () => {
  const changed = fixture()
  const result = await changed.service.editOwnMessage(BOT_ID, {
    channelId: CHANNEL_ID,
    content: "replacement",
    messageId: MESSAGE_ID,
  })

  assert.equal(result.status, "completed")
  assert.deepEqual(changed.calls.edit[0], {
    allowedMentions: { parse: [], replied_user: false },
    content: "replacement",
  })
  assert.deepEqual(changed.events, ["audit:pending", "edit", "audit:completed"])

  const noop = fixture({
    client: {
      async getMessage() {
        return message({ content: "same" })
      },
    },
  })
  const noopResult = await noop.service.editOwnMessage(BOT_ID, {
    channelId: CHANNEL_ID,
    content: "same",
    messageId: MESSAGE_ID,
  })
  assert.equal(noopResult.status, "noop")
  assert.equal(noop.calls.edit.length, 0)
  assert.deepEqual(noop.store.entries.map((entry) => entry.status), ["noop"])

  for (const ownership of [
    { author: { bot: false, id: MEMBER_ID, username: "member" } },
    { webhook_id: "600000000000000001" },
  ]) {
    const denied = fixture({
      client: {
        async getMessage() {
          return message(ownership)
        },
      },
    })
    await assert.rejects(
      () => denied.service.editOwnMessage(BOT_ID, {
        channelId: CHANNEL_ID,
        content: "replacement",
        messageId: MESSAGE_ID,
      }),
      InteractionIdentityError,
    )
    assert.equal(denied.calls.edit.length, 0)
    assert.equal(denied.store.entries.length, 0)
  }

  const mismatched = fixture({
    client: {
      async editMessage() {
        return message({ content: "not the requested replacement" })
      },
    },
  })
  await assert.rejects(
    () => mismatched.service.editOwnMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "replacement",
      messageId: MESSAGE_ID,
    }),
    (error: unknown) => (
      error instanceof InteractionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
})

test("reaction validates one emoji, verifies the target, and journals no emoji content", async () => {
  const { calls, events, service, store } = fixture()

  const result = await service.addReaction({
    channelId: CHANNEL_ID,
    emoji: "🔥",
    messageId: MESSAGE_ID,
  })

  assert.equal(result.status, "completed")
  assert.deepEqual(calls.reaction, ["🔥"])
  assert.deepEqual(events, ["audit:pending", "reaction", "audit:completed"])
  assert.doesNotMatch(JSON.stringify(store.entries), /🔥/)
  await assert.rejects(
    () => service.addReaction({
      channelId: CHANNEL_ID,
      emoji: "not-an-emoji",
      messageId: MESSAGE_ID,
    }),
    /one Unicode emoji or name:snowflake/,
  )
})

test("interaction scope stays exact and a pending audit failure blocks the write", async () => {
  const outOfScope = fixture()
  await assert.rejects(
    () => outOfScope.service.sendMessage(BOT_ID, {
      channelId: OTHER_CHANNEL_ID,
      content: "blocked",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /outside the interaction scope/,
  )

  const store = new MemoryActivityStore()
  store.failAfterEntries = 0
  const blocked = fixture({ store })
  await assert.rejects(
    () => blocked.service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "blocked before write",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /activity unavailable/,
  )
  assert.equal(blocked.calls.create.length, 0)
})

test("interaction reports a completed write whose terminal audit record fails", async () => {
  const store = new MemoryActivityStore()
  store.failAfterEntries = 1
  const { calls, service } = fixture({ store })

  await assert.rejects(
    () => service.sendMessage(BOT_ID, {
      channelId: CHANNEL_ID,
      content: "write then audit failure",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    (error: unknown) => (
      error instanceof InteractionExecutionError
      && (error.result as { status: string }).status === "completed-audit-failed"
      && (error.result as { messageId: string }).messageId === MESSAGE_ID
    ),
  )
  assert.equal(calls.create.length, 1)
  assert.deepEqual(store.entries.map((entry) => entry.status), ["pending"])
})
