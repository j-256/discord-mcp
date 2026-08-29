import assert from "node:assert/strict"
import test from "node:test"

import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import { ConfigurationError } from "../src/errors.js"
import {
  MessageCatchupService,
  normalizeMessageCatchupRequest,
  type MessageCatchupRequest,
  type MessageCatchupServiceClient,
} from "../src/message-catchup-service.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
  DiscordThreadMember,
  RequestOptions,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const BOT_ID = "200000000000000001"
const BOT_ROLE_ID = "300000000000000001"
const CHANNEL_A = "400000000000000001"
const CHANNEL_B = "400000000000000002"
const THREAD_ID = "400000000000000003"
const PARENT_ID = "400000000000000004"
const AUTHOR_ID = "500000000000000001"
const WEBHOOK_ID = "500000000000000002"
const MESSAGE_1 = "600000000000000001"
const MESSAGE_2 = "600000000000000002"
const MESSAGE_3 = "600000000000000003"
const MESSAGE_4 = "600000000000000004"
const MESSAGE_5 = "600000000000000005"
const TIMESTAMP = "2026-08-29T00:00:00.000Z"

function role(
  id: string,
  name: string,
  permissions: bigint,
  position: number,
): DiscordRole {
  return {
    color: 0,
    colors: {
      primary_color: 0,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: false,
    icon: null,
    id,
    managed: false,
    mentionable: false,
    name,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
  }
}

function roles(
  permissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.CONNECT,
): DiscordRole[] {
  return [
    role(GUILD_ID, "@everyone", permissions, 0),
    role(BOT_ROLE_ID, "private-connector-role", 0n, 1),
  ]
}

function member(overrides: Partial<DiscordGuildMember> = {}): DiscordGuildMember {
  return {
    roles: [BOT_ROLE_ID],
    user: {
      bot: true,
      id: BOT_ID,
      username: "private-connector-name",
    },
    ...overrides,
  }
}

function threadMember(
  overrides: Partial<DiscordThreadMember> = {},
): DiscordThreadMember {
  return {
    flags: 0,
    id: THREAD_ID,
    join_timestamp: TIMESTAMP,
    user_id: BOT_ID,
    ...overrides,
  }
}

function channel(
  id = CHANNEL_A,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: "private-channel-name",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function message(
  id: string,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: {
      avatar: "private-avatar-hash",
      bot: false,
      global_name: "Private Profile Name",
      id: AUTHOR_ID,
      username: "private-author-name",
    },
    channel_id: CHANNEL_A,
    components: [],
    content: `message ${id}`,
    edited_timestamp: null,
    embeds: [],
    guild_id: GUILD_ID,
    id,
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    reactions: [],
    sticker_items: [],
    timestamp: TIMESTAMP,
    tts: false,
    type: 0,
    ...overrides,
  }
}

interface FixtureOptions {
  channels?: ReadonlyMap<string, DiscordChannel>
  client?: Partial<MessageCatchupServiceClient>
  member?: DiscordGuildMember
  policyGuildError?: Error
  policyReadError?: Error
  roles?: DiscordRole[]
  threadMember?: DiscordThreadMember
}

function fixture(options: FixtureOptions = {}) {
  const events: string[] = []
  const calls = {
    channels: [] as Array<{
      channelId: string
      options: RequestOptions | undefined
    }>,
    members: [] as Array<{
      guildId: string
      options: RequestOptions | undefined
      userId: string
    }>,
    messages: [] as Array<{
      after?: string
      channelId: string
      limit?: number
      signal?: AbortSignal
    }>,
    roles: [] as Array<{
      guildId: string
      options: RequestOptions | undefined
    }>,
    threadMembers: [] as Array<{
      options: RequestOptions | undefined
      threadId: string
      userId: string
    }>,
  }
  const client: MessageCatchupServiceClient = {
    async getChannel(channelId, requestOptions) {
      events.push(`channel:${channelId}`)
      calls.channels.push({ channelId, options: requestOptions })
      return structuredClone(
        options.channels?.get(channelId) ?? channel(channelId),
      )
    },
    async getGuildMember(guildId, userId, requestOptions) {
      events.push("member")
      calls.members.push({ guildId, options: requestOptions, userId })
      return structuredClone(options.member ?? member())
    },
    async getGuildRoles(guildId, requestOptions) {
      events.push("roles")
      calls.roles.push({ guildId, options: requestOptions })
      return structuredClone(options.roles ?? roles())
    },
    async getThreadMember(threadId, userId, requestOptions) {
      events.push(`thread-member:${threadId}`)
      calls.threadMembers.push({ options: requestOptions, threadId, userId })
      return structuredClone(options.threadMember ?? threadMember())
    },
    async listMessages(channelId, requestOptions) {
      events.push(`messages:${channelId}`)
      calls.messages.push({ channelId, ...requestOptions })
      return []
    },
    ...options.client,
  }
  const service = new MessageCatchupService({
    client,
    policy: {
      assertChannelReadable(value) {
        events.push(`scope-channel:${value.id}`)
        if (options.policyReadError) throw options.policyReadError
        return GUILD_ID
      },
      assertGuildAllowed(guildId) {
        events.push(`scope-guild:${guildId}`)
        if (options.policyGuildError) throw options.policyGuildError
      },
    },
  })
  return { calls, events, service }
}

function request(
  overrides: Partial<MessageCatchupRequest> = {},
): MessageCatchupRequest {
  return {
    channels: [{ channelId: CHANNEL_A }],
    guildId: GUILD_ID,
    maxMessagesPerChannel: 2,
    ...overrides,
  }
}

test("message catch-up normalizes a bounded caller-retained cursor request", () => {
  const normalized = normalizeMessageCatchupRequest({
    channels: [
      { afterMessageId: MESSAGE_1, channelId: CHANNEL_A },
      { channelId: CHANNEL_B },
    ],
    guildId: GUILD_ID,
  })

  assert.deepEqual(normalized, {
    channels: [
      { afterMessageId: MESSAGE_1, channelId: CHANNEL_A },
      { channelId: CHANNEL_B },
    ],
    guildId: GUILD_ID,
    includeAutomatedMessages: false,
    maxMessagesPerChannel: 5,
  })
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized.channels), true)
  assert.equal(Object.isFrozen(normalized.channels[0]), true)
})

test("message catch-up rejects ambiguous, duplicate, and excessive input", () => {
  const invalid: Array<{ expected: RegExp; value: unknown }> = [
    { expected: /must be an object/, value: null },
    { expected: /unknown field/, value: { ...request(), extra: true } },
    { expected: /requires 1-10/, value: { ...request(), channels: [] } },
    {
      expected: /must be unique/,
      value: {
        ...request(),
        channels: [{ channelId: CHANNEL_A }, { channelId: CHANNEL_A }],
      },
    },
    {
      expected: /unknown field/,
      value: { ...request(), channels: [{ channelId: CHANNEL_A, name: "private" }] },
    },
    {
      expected: /exact positive Discord snowflake/,
      value: { ...request(), guildId: `0${GUILD_ID}` },
    },
    {
      expected: /must be a boolean/,
      value: { ...request(), includeAutomatedMessages: "yes" },
    },
    { expected: /must be 2-10/, value: { ...request(), maxMessagesPerChannel: 1 } },
    { expected: /must be 2-10/, value: { ...request(), maxMessagesPerChannel: 11 } },
    {
      expected: /at most 50 messages/,
      value: {
        ...request(),
        channels: Array.from({ length: 10 }, (_, index) => ({
          channelId: String(BigInt(CHANNEL_A) + BigInt(index)),
        })),
        maxMessagesPerChannel: 6,
      },
    },
  ]

  for (const { expected, value } of invalid) {
    assert.throws(
      () => normalizeMessageCatchupRequest(value as MessageCatchupRequest),
      expected,
    )
  }
})

test("message catch-up initializes channels chronologically with a compact privacy view", async () => {
  const signal = new AbortController().signal
  const secretUrl = "https://cdn.discordapp.com/private-attachment"
  const longContent = `  hello\n\tworld 🫡 ${"x".repeat(180)}  `
  const target = fixture({
    client: {
      async listMessages(channelId, options) {
        target.events.push(`messages:${channelId}`)
        target.calls.messages.push({ channelId, ...options })
        return [
          message(MESSAGE_5, {
            attachments: [{ filename: "private.txt", id: MESSAGE_1, size: 4, url: secretUrl }],
            components: [{ private: "private-component-payload" }],
            content: longContent,
            embeds: [{ private: "private-embed-payload" }],
            mention_everyone: true,
            mention_roles: [BOT_ROLE_ID],
            mentions: [{ id: BOT_ID, username: "private-mention-name" }],
            pinned: true,
            reactions: [{ private: "private-reaction-payload" }] as never[],
            sticker_items: [{ private: "private-sticker-payload" }],
          }),
          message(MESSAGE_4),
        ]
      },
    },
  })

  const result = await target.service.catchUp(
    BOT_ID,
    "enabled",
    request(),
    { signal },
  )

  assert.equal(result.status, "ok")
  assert.deepEqual(result.privacy, {
    automaticPagination: "none",
    cursorCustody: "caller",
    messageContent: "preview-only",
    partialResults: "none",
    persistence: "none",
    profileExpansion: "omitted",
    rawPayloads: "omitted",
  })
  const selected = result.channels[0]!
  assert.deepEqual(selected.messages.map(({ id }) => id), [MESSAGE_4, MESSAGE_5])
  assert.equal(selected.page.mode, "initialize")
  assert.equal(selected.page.afterMessageId, null)
  assert.equal(selected.page.nextAfterMessageId, MESSAGE_5)
  assert.equal(selected.page.boundaryVerification, "not-applicable")
  assert.equal(selected.page.olderMessagesMayExist, true)
  assert.equal(selected.page.newerMessagesMayExist, false)
  assert.equal(selected.messages[1]?.content.preview.startsWith("hello world 🫡"), true)
  assert.equal([...selected.messages[1]!.content.preview].length, 160)
  assert.equal(selected.messages[1]?.content.truncated, true)
  assert.equal(selected.messages[1]?.attachmentCount, 1)
  assert.equal(selected.messages[1]?.mentionedConnector, true)
  assert.equal(selected.messages[1]?.mentionEveryone, true)
  assert.equal(selected.messages[1]?.pinned, true)
  const serialized = JSON.stringify(result)
  for (const secret of [
    "private-author-name",
    "Private Profile Name",
    "private-avatar-hash",
    "private-mention-name",
    secretUrl,
    "private.txt",
    "private-component-payload",
    "private-embed-payload",
    "private-reaction-payload",
    "private-sticker-payload",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret))
  }
  const firstMessageRead = target.events.findIndex((event) => event.startsWith("messages:"))
  assert(firstMessageRead > target.events.indexOf("member"))
  assert(firstMessageRead > target.events.indexOf("roles"))
  assert.equal(target.calls.messages[0]?.signal, signal)
  for (const call of [
    ...target.calls.channels.map(({ options }) => options),
    ...target.calls.members.map(({ options }) => options),
    ...target.calls.roles.map(({ options }) => options),
  ]) {
    assert.deepEqual(call, { signal })
  }
})

test("message catch-up returns a complete short page without a boundary probe", async () => {
  const target = fixture({
    client: {
      async listMessages(channelId, options) {
        target.calls.messages.push({ channelId, ...options })
        return [message(MESSAGE_3), message(MESSAGE_2)]
      },
    },
  })

  const result = await target.service.catchUp(BOT_ID, "enabled", request({
    channels: [{ afterMessageId: MESSAGE_1, channelId: CHANNEL_A }],
    maxMessagesPerChannel: 3,
  }))
  const selected = result.channels[0]!

  assert.deepEqual(selected.messages.map(({ id }) => id), [MESSAGE_2, MESSAGE_3])
  assert.equal(selected.page.boundaryVerification, "not-required")
  assert.equal(selected.page.nextAfterMessageId, MESSAGE_3)
  assert.equal(selected.page.newerMessagesMayExist, false)
  assert.equal(selected.page.scanLimitReached, false)
  assert.equal(target.calls.messages.length, 1)
})

test("message catch-up verifies a full catch-up boundary before advancing", async () => {
  const target = fixture({
    client: {
      async listMessages(channelId, options) {
        target.calls.messages.push({ channelId, ...options })
        return options?.limit === 1
          ? [message(MESSAGE_2)]
          : [message(MESSAGE_3), message(MESSAGE_2)]
      },
    },
  })

  const result = await target.service.catchUp(BOT_ID, "enabled", request({
    channels: [{ afterMessageId: MESSAGE_1, channelId: CHANNEL_A }],
  }))
  const selected = result.channels[0]!

  assert.equal(selected.page.boundaryVerification, "verified")
  assert.equal(selected.page.newerMessagesMayExist, true)
  assert.equal(selected.page.nextAfterMessageId, MESSAGE_3)
  assert.deepEqual(target.calls.messages.map(({ after, limit }) => ({ after, limit })), [
    { after: MESSAGE_1, limit: 2 },
    { after: MESSAGE_1, limit: 1 },
  ])
})

test("message catch-up rejects a contradictory full-page boundary", async () => {
  const target = fixture({
    client: {
      async listMessages(_channelId, options) {
        return options?.limit === 1
          ? [message(MESSAGE_3)]
          : [message(MESSAGE_3), message(MESSAGE_2)]
      },
    },
  })

  await assert.rejects(
    target.service.catchUp(BOT_ID, "enabled", request({
      channels: [{ afterMessageId: MESSAGE_1, channelId: CHANNEL_A }],
    })),
    /boundary evidence changed or contradicted/,
  )
})

test("message catch-up advances across omitted bot and webhook messages", async () => {
  const target = fixture({
    client: {
      async listMessages(channelId, options) {
        target.calls.messages.push({ channelId, ...options })
        if (options?.limit === 1) return [message(MESSAGE_2)]
        return [
          message(MESSAGE_4, { webhook_id: WEBHOOK_ID }),
          message(MESSAGE_3, { author: {
            bot: true,
            id: BOT_ID,
            username: "private-bot-name",
          } }),
          message(MESSAGE_2),
        ]
      },
    },
  })

  const result = await target.service.catchUp(BOT_ID, "enabled", request({
    channels: [{ afterMessageId: MESSAGE_1, channelId: CHANNEL_A }],
    maxMessagesPerChannel: 3,
  }))
  const selected = result.channels[0]!

  assert.deepEqual(selected.messages.map(({ id }) => id), [MESSAGE_2])
  assert.equal(selected.page.omittedAutomatedMessageCount, 2)
  assert.equal(selected.page.nextAfterMessageId, MESSAGE_4)

  const included = await target.service.catchUp(BOT_ID, "enabled", request({
    channels: [{ afterMessageId: MESSAGE_1, channelId: CHANNEL_A }],
    includeAutomatedMessages: true,
    maxMessagesPerChannel: 3,
  }))
  assert.deepEqual(included.channels[0]?.messages.map(({ id }) => id), [
    MESSAGE_2,
    MESSAGE_3,
    MESSAGE_4,
  ])
  assert.equal(included.channels[0]?.messages[1]?.authorIsConnector, true)
  assert.equal(included.channels[0]?.messages[2]?.authorWebhook, true)
})

test("message catch-up verifies exact private-thread membership and its parent", async () => {
  const privateThread = channel(THREAD_ID, {
    parent_id: PARENT_ID,
    type: DISCORD_CHANNEL_TYPES.privateThread,
  })
  delete privateThread.permission_overwrites
  const channels = new Map<string, DiscordChannel>([
    [THREAD_ID, privateThread],
    [PARENT_ID, channel(PARENT_ID, { type: DISCORD_CHANNEL_TYPES.forum })],
  ])
  const target = fixture({
    channels,
    client: {
      async listMessages(channelId, options) {
        target.calls.messages.push({ channelId, ...options })
        return [message(MESSAGE_2, { channel_id: THREAD_ID })]
      },
    },
  })

  const result = await target.service.catchUp(BOT_ID, "enabled", request({
    channels: [{ channelId: THREAD_ID }],
  }))

  assert.deepEqual(target.calls.threadMembers.map(({ threadId, userId }) => ({
    threadId,
    userId,
  })), [{ threadId: THREAD_ID, userId: BOT_ID }])
  assert.equal(result.channels[0]?.permissions.permissionSourceChannelId, PARENT_ID)
  assert.equal(result.channels[0]?.permissions.privateThreadAccess, "lookup-succeeded")
})

test("message catch-up validates every selection before reading any messages", async () => {
  const denied = fixture({ roles: roles(0n) })
  await assert.rejects(
    denied.service.catchUp(BOT_ID, "enabled", request({
      channels: [{ channelId: CHANNEL_A }, { channelId: CHANNEL_B }],
    })),
    /requires complete read permissions/,
  )
  assert.equal(denied.calls.messages.length, 0)

  const invalidType = fixture({
    channels: new Map([[CHANNEL_A, channel(CHANNEL_A, {
      type: DISCORD_CHANNEL_TYPES.category,
    })]]),
  })
  await assert.rejects(
    invalidType.service.catchUp(BOT_ID, "enabled", request()),
    /invalid message catch-up channel evidence/,
  )
  assert.equal(invalidType.calls.messages.length, 0)

  const invalidOverwrite = fixture({
    channels: new Map([[CHANNEL_A, channel(CHANNEL_A, {
      permission_overwrites: [{
        allow: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
        deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
        id: GUILD_ID,
        type: 0,
      }],
    })]]),
  })
  await assert.rejects(
    invalidOverwrite.service.catchUp(BOT_ID, "enabled", request()),
    /invalid, duplicate, or unresolved permission-overwrite evidence/,
  )
  assert.equal(invalidOverwrite.calls.messages.length, 0)

  const incompleteMember = member()
  delete incompleteMember.user
  const invalidMember = fixture({ member: incompleteMember })
  await assert.rejects(
    invalidMember.service.catchUp(BOT_ID, "enabled", request()),
    /invalid connector member evidence/,
  )
  assert.equal(invalidMember.calls.messages.length, 0)
})

test("message catch-up fails before channel calls without intent or guild scope", async () => {
  const noIntent = fixture()
  await assert.rejects(
    noIntent.service.catchUp(BOT_ID, "unknown", request()),
    /requires authoritative enabled Message Content intent evidence/,
  )
  assert.equal(noIntent.calls.channels.length, 0)

  const deniedGuild = fixture({ policyGuildError: new Error("guild denied") })
  await assert.rejects(
    deniedGuild.service.catchUp(BOT_ID, "enabled", request()),
    /guild denied/,
  )
  assert.equal(deniedGuild.calls.channels.length, 0)
})

test("message catch-up rejects malformed or out-of-scope message pages", async (context) => {
  const invalidPages: Array<{ expected: RegExp; messages: DiscordMessage[] }> = [
    {
      expected: /outside|invalid|unordered/,
      messages: [message(MESSAGE_2, { channel_id: CHANNEL_B })],
    },
    {
      expected: /invalid|unordered/,
      messages: [message(MESSAGE_2, { guild_id: OTHER_GUILD_ID })],
    },
    {
      expected: /invalid|unordered/,
      messages: [message(MESSAGE_1)],
    },
    {
      expected: /duplicate|unordered/,
      messages: [message(MESSAGE_2), message(MESSAGE_2)],
    },
    {
      expected: /unordered/,
      messages: [message(MESSAGE_2), message(MESSAGE_3)],
    },
    {
      expected: /malformed reply evidence/,
      messages: [message(MESSAGE_2, {
        message_reference: { channel_id: CHANNEL_B, guild_id: GUILD_ID, message_id: MESSAGE_1 },
        type: 19,
      })],
    },
  ]

  for (const [index, invalid] of invalidPages.entries()) {
    await context.test(`invalid page ${index + 1}`, async () => {
      const target = fixture({
        client: {
          async listMessages() {
            return structuredClone(invalid.messages)
          },
        },
      })
      await assert.rejects(
        target.service.catchUp(BOT_ID, "enabled", request({
          channels: [{ afterMessageId: MESSAGE_1, channelId: CHANNEL_A }],
          maxMessagesPerChannel: 3,
        })),
        invalid.expected,
      )
    })
  }
})

test("message catch-up preserves an empty caller cursor", async () => {
  const target = fixture()
  const result = await target.service.catchUp(BOT_ID, "enabled", request({
    channels: [{ afterMessageId: MESSAGE_1, channelId: CHANNEL_A }],
  }))

  assert.deepEqual(result.channels[0]?.messages, [])
  assert.equal(result.channels[0]?.page.nextAfterMessageId, MESSAGE_1)
  assert.equal(result.channels[0]?.page.scanLimitReached, false)
})

test("message catch-up classifies Discord evidence failures", async () => {
  const target = fixture({
    client: {
      async listMessages() {
        return [message(MESSAGE_2, { author: {
          bot: false,
          id: AUTHOR_ID,
          username: "",
        } })]
      },
    },
  })

  await assert.rejects(
    target.service.catchUp(BOT_ID, "enabled", request({
      channels: [{ afterMessageId: MESSAGE_1, channelId: CHANNEL_A }],
    })),
    ConfigurationError,
  )
})
