import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityList,
  ActivityStore,
} from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  REACTION_LIMITS,
} from "../src/constants.js"
import type {
  CreateMessageInput,
  EditMessageInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  InteractionConflictError,
  InteractionExecutionError,
  InteractionIdentityError,
  InteractionNotificationPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import {
  InteractionService,
  interactionNonce,
  type InteractionServiceClient,
} from "../src/interaction-service.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
} from "../src/types.js"

const BOT_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const CHANNEL_ID = "300000000000000001"
const OTHER_CHANNEL_ID = "300000000000000002"
const THREAD_ID = "300000000000000003"
const MESSAGE_ID = "400000000000000001"
const REPLY_MESSAGE_ID = "400000000000000002"
const MEMBER_ID = "500000000000000001"
const NOTIFY_USER_ID = "500000000000000002"
const IDEMPOTENCY_KEY = "request-1234567890"
const NOW = "2026-08-14T00:00:00.000Z"
const COMMAND_TIMESTAMP = "2026-08-13T23:59:30.000Z"
const DISCORD_EPOCH_MS = 1_420_070_400_000n

function snowflakeAt(timestamp: string): string {
  return ((BigInt(Date.parse(timestamp)) - DISCORD_EPOCH_MS) << 22n).toString()
}

const COMMAND_MESSAGE_ID = snowflakeAt(COMMAND_TIMESTAMP)

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
    permission_overwrites: [],
    type: 0,
    ...overrides,
  }
}

function activeThread(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return channel({
    id: THREAD_ID,
    parent_id: CHANNEL_ID,
    thread_metadata: {
      archive_timestamp: NOW,
      archived: false,
      auto_archive_duration: 60,
      locked: false,
    },
    type: DISCORD_CHANNEL_TYPES.publicThread,
    ...overrides,
  })
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

function commandMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return message({
    author: {
      bot: false,
      id: MEMBER_ID,
      username: "private-member-name",
    },
    content: `<@${BOT_ID}> please process this private command`,
    id: COMMAND_MESSAGE_ID,
    mentions: [{ bot: true, id: BOT_ID, username: "private-bot-name" }],
    timestamp: COMMAND_TIMESTAMP,
    ...overrides,
  })
}

function ownReactionAggregate(reaction: string) {
  const custom = reaction.includes(":")
  const [name, id] = custom ? reaction.split(":") : [reaction, null]
  return {
    burst_colors: [],
    count: 1,
    count_details: { burst: 0, normal: 1 },
    emoji: { animated: false, id, name },
    me: true,
    me_burst: false,
  }
}

function policy(options: {
  allowedChannelIds?: readonly string[]
  interactionChannelIds?: readonly string[]
  mentionUserIds?: readonly string[]
  threadMessageWriteMode?: "exact" | "inherit"
  threadReadMode?: "exact" | "inherit"
  userMentionMode?: "allowlist" | "disabled" | "reviewed"
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(options.allowedChannelIds || [CHANNEL_ID, OTHER_CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(options.interactionChannelIds || [CHANNEL_ID]),
    interactionMaxWritesPerMinute: 60,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(options.mentionUserIds || []),
    protectedUserIds: new Set(),
    threadMessageWriteMode: options.threadMessageWriteMode ?? "exact",
    threadReadMode: options.threadReadMode ?? "inherit",
    userMentionMode: options.userMentionMode ?? "allowlist",
  })
}

function createdMessage(
  input: CreateMessageInput,
  channelId = CHANNEL_ID,
): DiscordMessage {
  return message({
    channel_id: channelId,
    content: input.content,
    id: MESSAGE_ID,
    ...(input.reply
      ? { message_reference: {
          channel_id: channelId,
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
  limiter?: InteractionLimiter
  store?: MemoryActivityStore
} = {}) {
  const events = options.store?.events || []
  const store = options.store || new MemoryActivityStore(events)
  const calls = {
    create: [] as CreateMessageInput[],
    edit: [] as EditMessageInput[],
    messageReads: [] as string[],
    reaction: [] as string[],
    reactionRemove: [] as string[],
    threadMember: [] as Array<[string, string]>,
    typing: [] as string[],
  }
  const ownReactions = new Set<string>()
  const reactionMessage = (messageId: string) => {
    return message({
      id: messageId,
      reactions: [...ownReactions].map(ownReactionAggregate),
    })
  }
  const client: InteractionServiceClient = {
    async addOwnReaction(_channelId, _messageId, emoji) {
      calls.reaction.push(emoji)
      events.push("reaction")
      ownReactions.add(emoji)
    },
    async createMessage(channelId, input) {
      calls.create.push(structuredClone(input))
      events.push("create")
      return createdMessage(input, channelId)
    },
    async editMessage(_channelId, _messageId, input) {
      calls.edit.push(structuredClone(input))
      events.push("edit")
      return message({ content: input.content })
    },
    async deleteOwnReaction(_channelId, _messageId, emoji) {
      calls.reactionRemove.push(emoji)
      events.push("reaction-remove")
      ownReactions.delete(emoji)
    },
    async getChannel(channelId) {
      return channel({ id: channelId })
    },
    async getGuildMember() {
      return {
        roles: [],
        user: { bot: true, id: BOT_ID, username: "connector-bot" },
      }
    },
    async getGuildRoles() {
      return [{
        id: GUILD_ID,
        managed: false,
        name: "everyone",
        permissions: (
          DISCORD_PERMISSIONS.VIEW_CHANNEL
          | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
          | DISCORD_PERMISSIONS.SEND_MESSAGES
          | DISCORD_PERMISSIONS.SEND_MESSAGES_IN_THREADS
        ).toString(),
        position: 0,
      }]
    },
    async getMessage(_channelId, messageId) {
      calls.messageReads.push(messageId)
      if (messageId === REPLY_MESSAGE_ID) {
        return message({
          author: { bot: false, id: MEMBER_ID, username: "member" },
          id: REPLY_MESSAGE_ID,
        })
      }
      return reactionMessage(messageId)
    },
    async getThreadMember(threadId, userId) {
      calls.threadMember.push([threadId, userId])
      return {
        flags: 0,
        id: threadId,
        join_timestamp: NOW,
        user_id: userId,
      }
    },
    async triggerTypingIndicator(channelId) {
      calls.typing.push(channelId)
      events.push("typing")
    },
  }
  Object.assign(client, options.client)
  let activitySequence = 0
  const service = new InteractionService({
    activityStore: store,
    client,
    clock: () => new Date(NOW),
    ...(options.limiter ? { limiter: options.limiter } : {}),
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

test("command-processing signal proves a fresh bot-directed source and coalesces repeats", async () => {
  const configured = fixture({
    client: {
      async getMessage() {
        return commandMessage()
      },
    },
  })
  const request = {
    channelId: CHANNEL_ID,
    sourceMessageId: COMMAND_MESSAGE_ID,
  }

  const [first, replay] = await Promise.all([
    configured.service.signalCommandProcessing(BOT_ID, request),
    configured.service.signalCommandProcessing(BOT_ID, request),
  ])

  assert.deepEqual(configured.calls.typing, [CHANNEL_ID])
  assert.deepEqual(configured.events, [
    "audit:pending",
    "typing",
    "audit:completed",
  ])
  assert.equal(first.localReplay, false)
  assert.equal(replay.localReplay, true)
  assert.equal(first.activityId, replay.activityId)
  assert.equal(first.expiresAt, "2026-08-14T00:00:10.000Z")
  assert.equal(first.sourceMessageId, COMMAND_MESSAGE_ID)
  assert.deepEqual(
    configured.store.entries.map(({ kind, status }) => ({ kind, status })),
    [
      { kind: "command-processing-signal", status: "pending" },
      { kind: "command-processing-signal", status: "completed" },
    ],
  )
  assert.equal(
    configured.store.entries.every((entry) => (
      "messageId" in entry && entry.messageId === COMMAND_MESSAGE_ID
    )),
    true,
  )
  assert.doesNotMatch(
    JSON.stringify({ entries: configured.store.entries, first, replay }),
    /private command|private-member-name|private-bot-name/,
  )
})

test("command-processing signal does not delay a durable response cooldown lane", async () => {
  const now = Date.parse(NOW)
  const configured = fixture({
    client: {
      async getMessage() {
        return commandMessage()
      },
    },
    limiter: new InteractionLimiter({
      clock: () => now,
      maxWritesPerMinute: 4,
      minWriteIntervalMs: 60_000,
    }),
  })

  await configured.service.signalCommandProcessing(BOT_ID, {
    channelId: CHANNEL_ID,
    sourceMessageId: COMMAND_MESSAGE_ID,
  })
  const response = await configured.service.sendMessage(BOT_ID, {
    channelId: CHANNEL_ID,
    content: "completed response",
    idempotencyKey: IDEMPOTENCY_KEY,
  })

  assert.equal(response.status, "completed")
  assert.deepEqual(configured.calls.typing, [CHANNEL_ID])
  assert.equal(configured.calls.create.length, 1)
})

test("command-processing signal rejects stale, indirect, automated, and malformed sources", async () => {
  const cases: Array<{
    message: DiscordMessage
    pattern: RegExp
  }> = [
    {
      message: commandMessage({ content: "not directed to the bot" }),
      pattern: /does not explicitly mention/,
    },
    {
      message: commandMessage({ mentions: [] }),
      pattern: /does not explicitly mention/,
    },
    {
      message: commandMessage({
        author: { bot: true, id: MEMBER_ID, username: "automated" },
      }),
      pattern: /not an ordinary user message/,
    },
    {
      message: commandMessage({ webhook_id: "600000000000000001" }),
      pattern: /not an ordinary user message/,
    },
    {
      message: commandMessage({ type: 6 }),
      pattern: /not an ordinary user message/,
    },
    {
      message: commandMessage({ content: undefined as never }),
      pattern: /not an ordinary user message/,
    },
    {
      message: commandMessage({
        id: snowflakeAt("2026-08-13T23:50:00.000Z"),
        timestamp: "2026-08-13T23:50:00.000Z",
      }),
      pattern: /stale or has inconsistent creation evidence/,
    },
    {
      message: commandMessage({ timestamp: "2026-08-13T23:59:20.000Z" }),
      pattern: /stale or has inconsistent creation evidence/,
    },
  ]

  for (const testCase of cases) {
    const configured = fixture({
      client: {
        async getMessage() {
          return testCase.message
        },
      },
    })
    await assert.rejects(
      configured.service.signalCommandProcessing(BOT_ID, {
        channelId: CHANNEL_ID,
        sourceMessageId: testCase.message.id,
      }),
      testCase.pattern,
    )
    assert.equal(configured.calls.typing.length, 0)
    assert.equal(configured.store.entries.length, 0)
  }
})

test("command-processing signal requires exact scope, supported state, and complete permissions", async () => {
  const request = {
    channelId: CHANNEL_ID,
    sourceMessageId: COMMAND_MESSAGE_ID,
  }
  const outOfScope = fixture({
    client: { async getMessage() { return commandMessage() } },
    interactionPolicy: policy({ interactionChannelIds: [OTHER_CHANNEL_ID] }),
  })
  await assert.rejects(
    outOfScope.service.signalCommandProcessing(BOT_ID, request),
    /outside the interaction scope/,
  )

  const unsupported = fixture({
    client: {
      async getChannel() {
        return channel({ type: 15 })
      },
      async getMessage() {
        return commandMessage()
      },
    },
  })
  await assert.rejects(
    unsupported.service.signalCommandProcessing(BOT_ID, request),
    /requires a text, announcement, or active thread channel/,
  )

  const incomplete = fixture({
    client: {
      async getChannel() {
        const value = channel()
        delete value.permission_overwrites
        return value
      },
      async getMessage() {
        return commandMessage()
      },
    },
  })
  await assert.rejects(
    incomplete.service.signalCommandProcessing(BOT_ID, request),
    /permission evidence is incomplete/,
  )

  const missing = fixture({
    client: {
      async getGuildRoles() {
        return [{
          id: GUILD_ID,
          managed: false,
          name: "everyone",
          permissions: (
            DISCORD_PERMISSIONS.VIEW_CHANNEL
            | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
          ).toString(),
          position: 0,
        }]
      },
      async getMessage() {
        return commandMessage()
      },
    },
  })
  await assert.rejects(
    missing.service.signalCommandProcessing(BOT_ID, request),
    /lacks command-processing signal permissions: SEND_MESSAGES/,
  )

  assert.equal(outOfScope.calls.typing.length, 0)
  assert.equal(unsupported.calls.typing.length, 0)
  assert.equal(incomplete.calls.typing.length, 0)
  assert.equal(missing.calls.typing.length, 0)
})

test("command-processing signal supports an exact active thread with parent permissions", async () => {
  const configured = fixture({
    client: {
      async getChannel(channelId) {
        if (channelId === CHANNEL_ID) {
          return channel({
            id: CHANNEL_ID,
            parent_id: OTHER_CHANNEL_ID,
            permission_overwrites: [],
            thread_metadata: {
              archived: false,
              locked: false,
            },
            type: 12,
          })
        }
        return channel({ id: OTHER_CHANNEL_ID, permission_overwrites: [], type: 0 })
      },
      async getMessage() {
        return commandMessage()
      },
    },
  })

  const result = await configured.service.signalCommandProcessing(BOT_ID, {
    channelId: CHANNEL_ID,
    sourceMessageId: COMMAND_MESSAGE_ID,
  })

  assert.equal(result.status, "completed")
  assert.deepEqual(configured.calls.typing, [CHANNEL_ID])
  assert.deepEqual(configured.calls.threadMember, [[CHANNEL_ID, BOT_ID]])
})

test("command-processing signal rejects mismatched private-thread membership", async () => {
  const configured = fixture({
    client: {
      async getChannel(channelId) {
        if (channelId === CHANNEL_ID) {
          return channel({
            id: CHANNEL_ID,
            parent_id: OTHER_CHANNEL_ID,
            permission_overwrites: [],
            thread_metadata: { archived: false, locked: false },
            type: 12,
          })
        }
        return channel({ id: OTHER_CHANNEL_ID, permission_overwrites: [], type: 0 })
      },
      async getMessage() {
        return commandMessage()
      },
      async getThreadMember(threadId) {
        return {
          flags: 0,
          id: threadId,
          join_timestamp: NOW,
          user_id: MEMBER_ID,
        }
      },
    },
  })

  await assert.rejects(
    configured.service.signalCommandProcessing(BOT_ID, {
      channelId: CHANNEL_ID,
      sourceMessageId: COMMAND_MESSAGE_ID,
    }),
    /mismatched command-processing private-thread membership evidence/,
  )
  assert.equal(configured.calls.typing.length, 0)
  assert.equal(configured.store.entries.length, 0)
})

test("command-processing signal records known rejection without leaking details", async () => {
  const configured = fixture({
    client: {
      async getMessage() {
        return commandMessage()
      },
      async triggerTypingIndicator() {
        throw new DiscordApiError({
          code: 50013,
          message: "Discord rejected private command details",
          method: "POST",
          retryAfterMs: 700,
          route: `/channels/${CHANNEL_ID}/typing`,
          status: 403,
        })
      },
    },
  })

  await assert.rejects(
    configured.service.signalCommandProcessing(BOT_ID, {
      channelId: CHANNEL_ID,
      sourceMessageId: COMMAND_MESSAGE_ID,
    }),
    (error: unknown) => (
      error instanceof InteractionExecutionError
      && (error.result as { status: string }).status === "failed"
      && (error.result as { retryAfterMs: number }).retryAfterMs === 700
    ),
  )
  assert.deepEqual(
    configured.store.entries.map(({ kind, status }) => ({ kind, status })),
    [
      { kind: "command-processing-signal", status: "pending" },
      { kind: "command-processing-signal", status: "failed" },
    ],
  )
  assert.doesNotMatch(
    JSON.stringify(configured.store.entries),
    /private command|private command details|private-member-name|private-bot-name/,
  )
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

test("message publication supports exact threads and explicit parent inheritance", async () => {
  const thread = activeThread()
  const exact = fixture({
    client: {
      async getChannel(channelId) {
        return channelId === THREAD_ID ? thread : channel()
      },
    },
    interactionPolicy: policy({
      allowedChannelIds: [CHANNEL_ID, THREAD_ID],
      interactionChannelIds: [THREAD_ID],
      threadMessageWriteMode: "exact",
      threadReadMode: "exact",
    }),
  })
  const exactResult = await exact.service.sendMessage(BOT_ID, {
    channelId: THREAD_ID,
    content: "exact thread response",
    idempotencyKey: IDEMPOTENCY_KEY,
  })

  assert.equal(exactResult.channelId, THREAD_ID)
  assert.equal(exact.calls.create.length, 1)

  const inherited = fixture({
    client: {
      async getChannel(channelId) {
        return channelId === THREAD_ID ? thread : channel()
      },
    },
    interactionPolicy: policy({
      allowedChannelIds: [CHANNEL_ID],
      interactionChannelIds: [CHANNEL_ID],
      threadMessageWriteMode: "inherit",
      threadReadMode: "inherit",
    }),
  })
  const plan = await inherited.service.planSendMessageNotifications(BOT_ID, {
    channelId: THREAD_ID,
    content: "inherited thread response",
    idempotencyKey: IDEMPOTENCY_KEY,
  })

  assert.deepEqual(plan.thread, {
    parentId: CHANNEL_ID,
    privateThreadAccess: "not-applicable",
  })
  assert.equal(plan.permission.confidence, "complete")
  assert.equal(plan.permission.permissionSourceChannelId, CHANNEL_ID)
  assert.deepEqual(plan.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    "SEND_MESSAGES_IN_THREADS",
  ])
  assert.equal(plan.permission.effectivePermissionNames.includes("SEND_MESSAGES_IN_THREADS"), true)
})

test("thread publication requires independent read and write inheritance", async () => {
  const thread = activeThread()
  const client = {
    async getChannel(channelId: string) {
      return channelId === THREAD_ID ? thread : channel()
    },
  }
  const writeExact = fixture({
    client,
    interactionPolicy: policy({
      allowedChannelIds: [CHANNEL_ID],
      interactionChannelIds: [CHANNEL_ID],
      threadMessageWriteMode: "exact",
      threadReadMode: "inherit",
    }),
  })
  await assert.rejects(
    () => writeExact.service.sendMessage(BOT_ID, {
      channelId: THREAD_ID,
      content: "write scope is still exact",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /outside the message-publication scope/,
  )

  const readExact = fixture({
    client,
    interactionPolicy: policy({
      allowedChannelIds: [CHANNEL_ID],
      interactionChannelIds: [CHANNEL_ID],
      threadMessageWriteMode: "inherit",
      threadReadMode: "exact",
    }),
  })
  await assert.rejects(
    () => readExact.service.sendMessage(BOT_ID, {
      channelId: THREAD_ID,
      content: "read scope is still exact",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /outside the configured read scope/,
  )

  const narrow = fixture({
    client,
    interactionPolicy: policy({
      allowedChannelIds: [CHANNEL_ID],
      interactionChannelIds: [CHANNEL_ID],
      threadMessageWriteMode: "inherit",
      threadReadMode: "inherit",
    }),
  })
  await assert.rejects(
    () => narrow.service.addReaction({
      channelId: THREAD_ID,
      emoji: "🔥",
      messageId: MESSAGE_ID,
    }),
    /outside the interaction scope/,
  )
  await assert.rejects(
    () => narrow.service.signalCommandProcessing(BOT_ID, {
      channelId: THREAD_ID,
      sourceMessageId: COMMAND_MESSAGE_ID,
    }),
    /outside the interaction scope/,
  )
  assert.equal(narrow.calls.create.length, 0)
  assert.deepEqual(narrow.calls.messageReads, [])
})

test("thread publication proves lifecycle, parent, private membership, and permissions", async () => {
  const inheritedPolicy = policy({
    allowedChannelIds: [CHANNEL_ID],
    interactionChannelIds: [CHANNEL_ID],
    threadMessageWriteMode: "inherit",
    threadReadMode: "inherit",
  })
  const privateThread = activeThread({ type: DISCORD_CHANNEL_TYPES.privateThread })
  const privateAccess = fixture({
    client: {
      async getChannel(channelId) {
        return channelId === THREAD_ID ? privateThread : channel()
      },
    },
    interactionPolicy: inheritedPolicy,
  })
  const privatePlan = await privateAccess.service.planSendMessageNotifications(BOT_ID, {
    channelId: THREAD_ID,
    content: "private thread response",
    idempotencyKey: IDEMPOTENCY_KEY,
  })
  assert.equal(privatePlan.permission.privateThreadAccess, "lookup-succeeded")
  assert.deepEqual(privateAccess.calls.threadMember, [[THREAD_ID, BOT_ID]])

  const archived = fixture({
    client: {
      async getChannel(channelId) {
        return channelId === THREAD_ID
          ? activeThread({
              thread_metadata: {
                archive_timestamp: NOW,
                archived: true,
                auto_archive_duration: 60,
                locked: false,
              },
            })
          : channel()
      },
    },
    interactionPolicy: inheritedPolicy,
  })
  await assert.rejects(
    () => archived.service.sendMessage(BOT_ID, {
      channelId: THREAD_ID,
      content: "archived thread response",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /active unlocked thread/,
  )

  const wrongParent = fixture({
    client: {
      async getChannel(channelId) {
        return channelId === THREAD_ID
          ? activeThread()
          : channel({ id: OTHER_CHANNEL_ID })
      },
    },
    interactionPolicy: inheritedPolicy,
  })
  await assert.rejects(
    () => wrongParent.service.sendMessage(BOT_ID, {
      channelId: THREAD_ID,
      content: "mismatched parent response",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /mismatched message-publication thread-parent evidence/,
  )

  const wrongPrivateMember = fixture({
    client: {
      async getChannel(channelId) {
        return channelId === THREAD_ID ? privateThread : channel()
      },
      async getThreadMember() {
        return {
          flags: 0,
          id: THREAD_ID,
          join_timestamp: NOW,
          user_id: MEMBER_ID,
        }
      },
    },
    interactionPolicy: inheritedPolicy,
  })
  await assert.rejects(
    () => wrongPrivateMember.service.sendMessage(BOT_ID, {
      channelId: THREAD_ID,
      content: "unproven private thread response",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /private-thread membership evidence/,
  )

  const missingPermission = fixture({
    client: {
      async getChannel(channelId) {
        return channelId === THREAD_ID ? activeThread() : channel()
      },
      async getGuildRoles() {
        return [{
          id: GUILD_ID,
          managed: false,
          name: "everyone",
          permissions: (
            DISCORD_PERMISSIONS.VIEW_CHANNEL
            | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
          ).toString(),
          position: 0,
        }]
      },
    },
    interactionPolicy: inheritedPolicy,
  })
  await assert.rejects(
    () => missingPermission.service.sendMessage(BOT_ID, {
      channelId: THREAD_ID,
      content: "permissionless thread response",
      idempotencyKey: IDEMPOTENCY_KEY,
    }),
    /SEND_MESSAGES_IN_THREADS/,
  )
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

test("reviewed notification mode keeps direct sends strict and binds mixed recipients plus reply author", async () => {
  const configured = fixture({
    interactionPolicy: policy({
      mentionUserIds: [NOTIFY_USER_ID],
      userMentionMode: "reviewed",
    }),
  })
  const request = {
    channelId: CHANNEL_ID,
    content: `Attention <@${NOTIFY_USER_ID}> and <@${MEMBER_ID}>; suppressed <@${OTHER_CHANNEL_ID}> @everyone <@&${GUILD_ID}>`,
    idempotencyKey: IDEMPOTENCY_KEY,
    notifyReplyAuthor: true,
    notifyUserIds: [NOTIFY_USER_ID, MEMBER_ID],
    replyToMessageId: REPLY_MESSAGE_ID,
  }

  await assert.rejects(
    () => configured.service.sendMessage(BOT_ID, request),
    /requires signed interactive notification review/,
  )
  const plan = await configured.service.planSendMessageNotifications(BOT_ID, request)

  assert.equal(plan.reviewRequired, true)
  assert.deepEqual(plan.notifications.userMentions, {
    allowlistedUserIds: [NOTIFY_USER_ID],
    authorization: "reviewed",
    reviewedUserIds: [MEMBER_ID],
  })
  assert.deepEqual(plan.notifications.replyAuthor, {
    authorId: MEMBER_ID,
    authorization: "reviewed",
  })
  assert.deepEqual(plan.notifications.suppressedUserIds, [OTHER_CHANNEL_ID])

  await configured.service.executeReviewedSendMessage(BOT_ID, request, plan.digest)

  assert.deepEqual(configured.calls.messageReads, [REPLY_MESSAGE_ID, REPLY_MESSAGE_ID])
  assert.deepEqual(configured.calls.create[0]?.allowedMentions, {
    replied_user: true,
    users: [MEMBER_ID, NOTIFY_USER_ID],
  })
})

test("reviewed notification plans fail closed when content, target, or recipients change", async () => {
  const reviewedPolicy = policy({
    interactionChannelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    userMentionMode: "reviewed",
  })
  const original = {
    channelId: CHANNEL_ID,
    content: `Hello <@${MEMBER_ID}>`,
    idempotencyKey: IDEMPOTENCY_KEY,
    notifyUserIds: [MEMBER_ID],
  }

  for (const changed of [
    { ...original, content: `Changed <@${MEMBER_ID}>` },
    { ...original, channelId: OTHER_CHANNEL_ID },
    {
      ...original,
      content: `Hello <@${NOTIFY_USER_ID}>`,
      notifyUserIds: [NOTIFY_USER_ID],
    },
  ]) {
    const configured = fixture({ interactionPolicy: reviewedPolicy })
    const plan = await configured.service.planSendMessageNotifications(BOT_ID, original)
    await assert.rejects(
      () => configured.service.executeReviewedSendMessage(BOT_ID, changed, plan.digest),
      InteractionNotificationPlanChangedError,
    )
    assert.equal(configured.calls.create.length, 0)
  }
})

test("reviewed notification plans cover own-message edits without relaxing direct edits", async () => {
  const configured = fixture({
    interactionPolicy: policy({ userMentionMode: "reviewed" }),
  })
  const request = {
    channelId: CHANNEL_ID,
    content: `Edited for <@${MEMBER_ID}> @everyone <@&${GUILD_ID}>`,
    messageId: MESSAGE_ID,
    notifyUserIds: [MEMBER_ID],
  }

  await assert.rejects(
    () => configured.service.editOwnMessage(BOT_ID, request),
    /requires signed interactive notification review/,
  )
  const plan = await configured.service.planEditOwnMessageNotifications(BOT_ID, request)
  await configured.service.executeReviewedEditOwnMessage(BOT_ID, request, plan.digest)

  assert.equal(plan.reviewRequired, true)
  assert.deepEqual(configured.calls.messageReads, [MESSAGE_ID, MESSAGE_ID])
  assert.deepEqual(configured.calls.edit[0]?.allowedMentions, {
    replied_user: false,
    users: [MEMBER_ID],
  })
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

test("reaction sets validate every logical emoji before reading or writing", async () => {
  for (const emojis of [
    ["🔥"],
    Array.from({ length: REACTION_LIMITS.addSetEmojis + 1 }, () => "🔥"),
    ["🔥", "not-an-emoji"],
    ["🔥", "🔥"],
    ["first:600000000000000001", "renamed:600000000000000001"],
  ]) {
    const configured = fixture()
    await assert.rejects(
      () => configured.service.addReactions({
        channelId: CHANNEL_ID,
        emojis,
        messageId: MESSAGE_ID,
      }),
      RangeError,
    )
    assert.deepEqual(configured.calls.messageReads, [])
    assert.deepEqual(configured.calls.reaction, [])
    assert.deepEqual(configured.store.entries, [])
  }
})

test("reaction sets preserve order, reuse verified snapshots, and converge to no-ops", async () => {
  const configured = fixture()
  const request = {
    channelId: CHANNEL_ID,
    emojis: ["🔥", "✅", "custom:600000000000000001"],
    messageId: MESSAGE_ID,
  }

  const first = await configured.service.addReactions(request)

  assert.equal(first.status, "completed")
  assert.equal(first.addedCount, 3)
  assert.equal(first.existingCount, 0)
  assert.equal(first.processedCount, 3)
  assert.equal(first.requestedCount, 3)
  assert.deepEqual(first.activityIds, ["activity-1", "activity-2", "activity-3"])
  assert.deepEqual(configured.calls.reaction, request.emojis)
  assert.deepEqual(configured.calls.messageReads, [
    MESSAGE_ID,
    MESSAGE_ID,
    MESSAGE_ID,
    MESSAGE_ID,
  ])
  assert.doesNotMatch(
    JSON.stringify({ entries: configured.store.entries, result: first }),
    /🔥|✅|custom/,
  )

  const replay = await configured.service.addReactions(request)

  assert.equal(replay.status, "noop")
  assert.equal(replay.addedCount, 0)
  assert.equal(replay.existingCount, 3)
  assert.equal(replay.processedCount, 3)
  assert.deepEqual(configured.calls.reaction, request.emojis)
  assert.equal(configured.calls.messageReads.length, 5)
  assert.deepEqual(
    configured.store.entries.slice(-3).map(({ kind, status }) => ({ kind, status })),
    [
      { kind: "reaction-add", status: "noop" },
      { kind: "reaction-add", status: "noop" },
      { kind: "reaction-add", status: "noop" },
    ],
  )
})

test("reaction sets detect concurrent drift across the processed prefix", async () => {
  let reads = 0
  const configured = fixture({
    client: {
      async getMessage() {
        reads += 1
        if (reads === 1) return message({ reactions: [] })
        if (reads === 2) {
          return message({ reactions: [ownReactionAggregate("🔥")] })
        }
        return message({ reactions: [ownReactionAggregate("✅")] })
      },
    },
  })

  await assert.rejects(
    () => configured.service.addReactions({
      channelId: CHANNEL_ID,
      emojis: ["🔥", "✅", "🎉"],
      messageId: MESSAGE_ID,
    }),
    (error: unknown) => {
      if (!(error instanceof InteractionExecutionError)) return false
      const result = error.result as Record<string, unknown>
      assert.equal(result.status, "uncertain")
      assert.equal(result.failedIndex, null)
      assert.equal(result.driftDetectedAfterIndex, 1)
      assert.equal(result.processedCount, 2)
      assert.deepEqual(result.activityIds, ["activity-1", "activity-2"])
      assert.doesNotMatch(JSON.stringify(result), /🔥|✅|🎉/)
      return true
    },
  )
  assert.deepEqual(configured.calls.reaction, ["🔥", "✅"])
  assert.deepEqual(configured.store.entries.map(({ status }) => status), [
    "pending",
    "completed",
    "pending",
    "completed",
  ])
})

test("reaction sets stop at the first failure and expose content-free retry progress", async () => {
  const configured = fixture()
  const originalAdd = configured.client.addOwnReaction.bind(configured.client)
  let attempts = 0
  configured.client.addOwnReaction = async (...arguments_) => {
    attempts += 1
    if (attempts === 2) {
      throw new DiscordApiError({
        code: 50013,
        message: "Discord rejected private reaction details",
        method: "PUT",
        route: `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/reactions/private/@me`,
        status: 403,
      })
    }
    return originalAdd(...arguments_)
  }
  const request = {
    channelId: CHANNEL_ID,
    emojis: ["🔥", "✅", "🎉"],
    messageId: MESSAGE_ID,
  }

  await assert.rejects(
    () => configured.service.addReactions(request),
    (error: unknown) => {
      if (!(error instanceof InteractionExecutionError)) return false
      const result = error.result as Record<string, unknown>
      assert.equal(result.status, "failed")
      assert.equal(result.failedIndex, 1)
      assert.equal(result.processedCount, 1)
      assert.equal(result.addedCount, 1)
      assert.equal(result.existingCount, 0)
      assert.deepEqual(result.activityIds, ["activity-1"])
      assert.equal(result.failedActivityId, "activity-2")
      assert.doesNotMatch(JSON.stringify(result), /🔥|✅|🎉|private/)
      return true
    },
  )
  assert.deepEqual(configured.calls.reaction, ["🔥"])
  assert.deepEqual(
    configured.store.entries.map(({ kind, status }) => ({ kind, status })),
    [
      { kind: "reaction-add", status: "pending" },
      { kind: "reaction-add", status: "completed" },
      { kind: "reaction-add", status: "pending" },
      { kind: "reaction-add", status: "failed" },
    ],
  )

  configured.client.addOwnReaction = originalAdd
  const recovered = await configured.service.addReactions(request)

  assert.equal(recovered.status, "completed")
  assert.equal(recovered.existingCount, 1)
  assert.equal(recovered.addedCount, 2)
  assert.deepEqual(configured.calls.reaction, ["🔥", "✅", "🎉"])
})

test("reaction sets preserve local retry timing after a verified prefix", async () => {
  const now = Date.parse(NOW)
  const configured = fixture({
    limiter: new InteractionLimiter({
      clock: () => now,
      maxWritesPerMinute: 1,
      minWriteIntervalMs: 0,
    }),
  })

  await assert.rejects(
    () => configured.service.addReactions({
      channelId: CHANNEL_ID,
      emojis: ["🔥", "✅"],
      messageId: MESSAGE_ID,
    }),
    (error: unknown) => {
      if (!(error instanceof InteractionExecutionError)) return false
      const result = error.result as Record<string, unknown>
      assert.equal(result.status, "rate-limited")
      assert.equal(result.failedIndex, 1)
      assert.equal(result.processedCount, 1)
      assert.equal(result.failedActivityId, null)
      return true
    },
  )
  assert.deepEqual(configured.calls.reaction, ["🔥"])
  assert.deepEqual(configured.store.entries.map(({ status }) => status), [
    "pending",
    "completed",
  ])
})

test("own reaction changes are idempotent and verify authoritative state", async () => {
  const { calls, events, service, store } = fixture()
  const reactionRequest = {
    channelId: CHANNEL_ID,
    emoji: "🔥",
    messageId: MESSAGE_ID,
  }

  assert.equal((await service.addReaction(reactionRequest)).status, "completed")
  assert.equal((await service.addReaction(reactionRequest)).status, "noop")
  assert.equal((await service.removeOwnReaction(reactionRequest)).status, "completed")
  assert.equal((await service.removeOwnReaction(reactionRequest)).status, "noop")

  assert.deepEqual(calls.reaction, ["🔥"])
  assert.deepEqual(calls.reactionRemove, ["🔥"])
  assert.deepEqual(events, [
    "audit:pending",
    "reaction",
    "audit:completed",
    "audit:noop",
    "audit:pending",
    "reaction-remove",
    "audit:completed",
    "audit:noop",
  ])
  assert.deepEqual(store.entries.map(({ kind, status }) => ({ kind, status })), [
    { kind: "reaction-add", status: "pending" },
    { kind: "reaction-add", status: "completed" },
    { kind: "reaction-add", status: "noop" },
    { kind: "reaction-remove-own", status: "pending" },
    { kind: "reaction-remove-own", status: "completed" },
    { kind: "reaction-remove-own", status: "noop" },
  ])
  assert.equal(JSON.stringify(store.entries).includes("🔥"), false)
})

test("own reaction postcondition failures are uncertain and retain content-free evidence", async () => {
  const add = fixture({
    client: {
      async addOwnReaction() {},
    },
  })
  await assert.rejects(
    () => add.service.addReaction({
      channelId: CHANNEL_ID,
      emoji: "🔥",
      messageId: MESSAGE_ID,
    }),
    (error: unknown) => (
      error instanceof InteractionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.deepEqual(add.store.entries.map(({ status }) => status), [
    "pending",
    "uncertain",
  ])
  assert.equal(JSON.stringify(add.store.entries).includes("🔥"), false)

  const remove = fixture()
  await remove.service.addReaction({
    channelId: CHANNEL_ID,
    emoji: "🔥",
    messageId: MESSAGE_ID,
  })
  remove.client.deleteOwnReaction = async () => undefined
  await assert.rejects(
    () => remove.service.removeOwnReaction({
      channelId: CHANNEL_ID,
      emoji: "🔥",
      messageId: MESSAGE_ID,
    }),
    (error: unknown) => (
      error instanceof InteractionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
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
    /outside the message-publication scope/,
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
