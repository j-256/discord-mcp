import assert from "node:assert/strict"
import test from "node:test"

import {
  CommunityActivityService,
  type CommunityActivityServiceClient,
  normalizeCommunityActivityRequest,
} from "../src/community-activity-service.js"
import { CommunityActivityEvidenceError } from "../src/errors.js"
import type { MessagePageOptions } from "../src/discord-client.js"
import type {
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "../src/types.js"

const GUILD_ID = "200000000000000001"
const OTHER_GUILD_ID = "200000000000000002"
const FIRST_CHANNEL_ID = "300000000000000001"
const SECOND_CHANNEL_ID = "300000000000000002"
const OTHER_CHANNEL_ID = "300000000000000003"
const FIRST_AUTHOR_ID = "400000000000000001"
const SECOND_AUTHOR_ID = "400000000000000002"
const BOT_AUTHOR_ID = "400000000000000003"
const SYSTEM_AUTHOR_ID = "400000000000000004"
const WEBHOOK_ID = "500000000000000001"
const PRIVATE_CONTENT = "private-message-content"
const PRIVATE_USERNAME = "private-user-name"
const PRIVATE_CHANNEL_NAME = "private-channel-name"

function channel(
  id: string,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: PRIVATE_CHANNEL_NAME,
    type: 0,
    ...overrides,
  }
}

function message(
  id: string,
  timestamp: string,
  authorId: string,
  overrides: Partial<DiscordMessage> & Record<string, unknown> = {},
): DiscordMessage {
  return {
    attachments: [{
      filename: "private-attachment.txt",
      id: "700000000000000001",
      proxy_url: "https://media.discordapp.net/private",
      size: 10,
      url: "https://cdn.discordapp.com/private",
    }],
    author: {
      avatar: "private-avatar",
      id: authorId,
      username: PRIVATE_USERNAME,
    },
    channel_id: FIRST_CHANNEL_ID,
    components: [{ private: "component" }],
    content: PRIVATE_CONTENT,
    embeds: [{ description: "private-embed" }],
    guild_id: GUILD_ID,
    id,
    timestamp,
    tts: false,
    type: 0,
    ...overrides,
  }
}

function reply(
  id: string,
  timestamp: string,
  authorId: string,
  target: DiscordMessage | null | undefined,
  overrides: Partial<DiscordMessage> & Record<string, unknown> = {},
): DiscordMessage {
  const targetId = target?.id ?? "600000000000000099"
  const channelId = overrides.channel_id ?? target?.channel_id ?? FIRST_CHANNEL_ID
  return message(id, timestamp, authorId, {
    channel_id: channelId,
    message_reference: {
      channel_id: channelId,
      guild_id: GUILD_ID,
      message_id: targetId,
      type: 0,
    },
    ...(target !== undefined ? { referenced_message: target } : {}),
    type: 19,
    ...overrides,
  })
}

class FixtureClient implements CommunityActivityServiceClient {
  channels = new Map<string, DiscordChannel>()
  getChannelCalls: Array<{ channelId: string; options: RequestOptions }> = []
  listCalls: Array<{ channelId: string; options: MessagePageOptions }> = []
  pageResponses: unknown[] = []

  async getChannel(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannel> {
    this.getChannelCalls.push({ channelId, options })
    return this.channels.get(channelId) ?? channel(channelId)
  }

  async listMessages(
    channelId: string,
    options: MessagePageOptions = {},
  ): Promise<DiscordMessage[]> {
    this.listCalls.push({ channelId, options })
    return this.pageResponses.shift() as DiscordMessage[]
  }
}

function fixture() {
  const client = new FixtureClient()
  client.channels.set(FIRST_CHANNEL_ID, channel(FIRST_CHANNEL_ID))
  client.channels.set(SECOND_CHANNEL_ID, channel(SECOND_CHANNEL_ID))
  const policyCalls = {
    channels: [] as string[],
    guilds: [] as string[],
  }
  const service = new CommunityActivityService({
    client,
    policy: {
      assertChannelReadable(value) {
        policyCalls.channels.push(value.id)
        return value.guild_id as string
      },
      assertGuildAllowed(guildId) {
        policyCalls.guilds.push(guildId)
      },
    },
  })
  return { client, policyCalls, service }
}

test("community activity analysis returns bounded aggregate evidence without private message data", async () => {
  const { client, policyCalls, service } = fixture()
  const firstTarget = message(
    "600000000000000004",
    "2026-08-27T11:59:00+00:00",
    SECOND_AUTHOR_ID,
  )
  const outsideTarget = message(
    "600000000000000099",
    "2026-08-27T08:58:00+00:00",
    FIRST_AUTHOR_ID,
    { channel_id: SECOND_CHANNEL_ID },
  )
  client.pageResponses = [
    [
      reply(
        "600000000000000005",
        "2026-08-27T12:00:00+00:00",
        FIRST_AUTHOR_ID,
        firstTarget,
      ),
      firstTarget,
      message(
        "600000000000000003",
        "2026-08-26T10:00:00+00:00",
        FIRST_AUTHOR_ID,
      ),
    ],
    [
      reply(
        "600000000000000002",
        "2026-08-27T09:00:00+00:00",
        SECOND_AUTHOR_ID,
        outsideTarget,
        { channel_id: SECOND_CHANNEL_ID },
      ),
      message(
        "600000000000000001",
        "2026-08-27T08:00:00+00:00",
        BOT_AUTHOR_ID,
        {
          author: {
            bot: true,
            id: BOT_AUTHOR_ID,
            username: PRIVATE_USERNAME,
          },
          channel_id: SECOND_CHANNEL_ID,
        },
      ),
    ],
  ]
  const signal = new AbortController().signal

  const result = await service.analyze({
    channels: [
      { channelId: FIRST_CHANNEL_ID },
      {
        beforeMessageId: "600000000000000010",
        channelId: SECOND_CHANNEL_ID,
      },
    ],
    guildId: GUILD_ID,
    maxMessagesPerChannel: 3,
  }, { signal })

  assert.deepEqual(result.activity, {
    activeUtcDays: 2,
    botMessages: 1,
    conversationMessages: 5,
    humanMessages: 4,
    humanParticipants: 2,
    messagesFetched: 5,
    nonConversationMessages: 0,
    otherConversationMessages: 0,
    webhookMessages: 0,
  })
  assert.deepEqual(result.participation, {
    multiDayParticipantRate: 0.5,
    multiDayParticipants: 1,
    topFiveParticipantMessageShare: 1,
    topParticipantMessageShare: 0.5,
  })
  assert.deepEqual(result.responsiveness, {
    humanAuthoredExplicitReplies: 2,
    humanToDifferentHumanReplies: 2,
    latencyPairs: 2,
    medianSeconds: 60,
    nonHumanTargetReplies: 0,
    p75Seconds: 120,
    p90Seconds: 120,
    sampledHumanMessagesReceivingReply: 1,
    sampledHumanMessagesWithoutObservedReply: 3,
    selfReplies: 0,
    unresolvedTargetReplies: 0,
  })
  assert.deepEqual(result.reciprocity, {
    directedRelationships: 2,
    participantPairs: 1,
    reciprocalPairRate: 1,
    reciprocalPairs: 1,
  })
  assert.deepEqual(result.coverage.channels, [
    {
      beforeMessageId: null,
      botMessages: 0,
      channelId: FIRST_CHANNEL_ID,
      conversationMessages: 3,
      humanMessages: 3,
      humanParticipants: 2,
      messagesFetched: 3,
      newestObservedAt: "2026-08-27T12:00:00.000Z",
      nextBeforeMessageId: "600000000000000003",
      nonConversationMessages: 0,
      oldestObservedAt: "2026-08-26T10:00:00.000Z",
      otherConversationMessages: 0,
      pagesRequested: 1,
      paginationStop: "request-limit",
      webhookMessages: 0,
    },
    {
      beforeMessageId: "600000000000000010",
      botMessages: 1,
      channelId: SECOND_CHANNEL_ID,
      conversationMessages: 2,
      humanMessages: 1,
      humanParticipants: 1,
      messagesFetched: 2,
      newestObservedAt: "2026-08-27T09:00:00.000Z",
      nextBeforeMessageId: null,
      nonConversationMessages: 0,
      oldestObservedAt: "2026-08-27T08:00:00.000Z",
      otherConversationMessages: 0,
      pagesRequested: 1,
      paginationStop: "short-page",
      webhookMessages: 0,
    },
  ])
  assert.equal(result.timing.weekdaysUtc.find(({ weekday }) => weekday === "Wednesday")?.messageCount, 1)
  assert.equal(result.timing.weekdaysUtc.find(({ weekday }) => weekday === "Thursday")?.messageCount, 3)
  assert.equal(result.timing.hoursUtc.find(({ hour }) => hour === 12)?.messageCount, 1)
  assert.deepEqual(policyCalls, {
    channels: [FIRST_CHANNEL_ID, SECOND_CHANNEL_ID],
    guilds: [GUILD_ID],
  })
  assert.deepEqual(client.getChannelCalls, [
    { channelId: FIRST_CHANNEL_ID, options: { signal } },
    { channelId: SECOND_CHANNEL_ID, options: { signal } },
  ])
  assert.deepEqual(client.listCalls, [
    { channelId: FIRST_CHANNEL_ID, options: { limit: 3, signal } },
    {
      channelId: SECOND_CHANNEL_ID,
      options: { before: "600000000000000010", limit: 3, signal },
    },
  ])
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_CONTENT, "u"))
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_USERNAME, "u"))
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_CHANNEL_NAME, "u"))
  assert.doesNotMatch(serialized, new RegExp(FIRST_AUTHOR_ID, "u"))
  assert.doesNotMatch(serialized, new RegExp(SECOND_AUTHOR_ID, "u"))
  assert.doesNotMatch(serialized, /private-attachment|private-embed|private-avatar/u)
})

test("community activity analysis paginates newest to oldest under the exact limit", async () => {
  const { client, service } = fixture()
  const baseId = 650_000_000_000_000_200n
  const baseTime = Date.parse("2026-08-27T12:00:00Z")
  const messages = Array.from({ length: 101 }, (_, index) => message(
    (baseId - BigInt(index)).toString(),
    new Date(baseTime - index * 1_000).toISOString(),
    FIRST_AUTHOR_ID,
  ))
  client.pageResponses = [messages.slice(0, 100), messages.slice(100)]

  const result = await service.analyze({
    channels: [{ channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
    maxMessagesPerChannel: 150,
  })

  assert.equal(result.coverage.messagesFetched, 101)
  assert.equal(result.coverage.channels[0]?.pagesRequested, 2)
  assert.equal(result.coverage.channels[0]?.paginationStop, "short-page")
  assert.equal(result.coverage.channels[0]?.nextBeforeMessageId, null)
  assert.deepEqual(client.listCalls, [
    { channelId: FIRST_CHANNEL_ID, options: { limit: 100 } },
    {
      channelId: FIRST_CHANNEL_ID,
      options: { before: messages[99]?.id, limit: 50 },
    },
  ])
})

test("community activity analysis distinguishes automation, system, and non-conversation evidence", async () => {
  const { client, service } = fixture()
  client.pageResponses = [[
    message("660000000000000005", "2026-08-27T12:00:05Z", FIRST_AUTHOR_ID),
    message("660000000000000004", "2026-08-27T12:00:04Z", BOT_AUTHOR_ID, {
      author: { bot: true, id: BOT_AUTHOR_ID, username: PRIVATE_USERNAME },
    }),
    message("660000000000000003", "2026-08-27T12:00:03Z", BOT_AUTHOR_ID, {
      author: { bot: true, id: BOT_AUTHOR_ID, username: PRIVATE_USERNAME },
      webhook_id: WEBHOOK_ID,
    }),
    message("660000000000000002", "2026-08-27T12:00:02Z", SYSTEM_AUTHOR_ID, {
      author: { id: SYSTEM_AUTHOR_ID, system: true, username: PRIVATE_USERNAME },
    }),
    message("660000000000000001", "2026-08-27T12:00:01Z", FIRST_AUTHOR_ID, {
      type: 7,
    }),
  ]]

  const result = await service.analyze({
    channels: [{ channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
    maxMessagesPerChannel: 10,
  })

  assert.deepEqual(result.activity, {
    activeUtcDays: 1,
    botMessages: 1,
    conversationMessages: 4,
    humanMessages: 1,
    humanParticipants: 1,
    messagesFetched: 5,
    nonConversationMessages: 1,
    otherConversationMessages: 1,
    webhookMessages: 1,
  })
})

test("community activity analysis reports unresolved, self, and non-human reply targets", async () => {
  const { client, service } = fixture()
  const selfTarget = message(
    "670000000000000003",
    "2026-08-27T12:00:03Z",
    FIRST_AUTHOR_ID,
  )
  const botTarget = message(
    "670000000000000002",
    "2026-08-27T12:00:02Z",
    BOT_AUTHOR_ID,
    { author: { bot: true, id: BOT_AUTHOR_ID, username: PRIVATE_USERNAME } },
  )
  client.pageResponses = [[
    reply(
      "670000000000000006",
      "2026-08-27T12:00:06Z",
      FIRST_AUTHOR_ID,
      undefined,
    ),
    reply(
      "670000000000000005",
      "2026-08-27T12:00:05Z",
      FIRST_AUTHOR_ID,
      selfTarget,
    ),
    reply(
      "670000000000000004",
      "2026-08-27T12:00:04Z",
      FIRST_AUTHOR_ID,
      botTarget,
    ),
    selfTarget,
    botTarget,
  ]]

  const result = await service.analyze({
    channels: [{ channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
    maxMessagesPerChannel: 10,
  })

  assert.deepEqual(result.responsiveness, {
    humanAuthoredExplicitReplies: 3,
    humanToDifferentHumanReplies: 0,
    latencyPairs: 0,
    medianSeconds: null,
    nonHumanTargetReplies: 1,
    p75Seconds: null,
    p90Seconds: null,
    sampledHumanMessagesReceivingReply: 0,
    sampledHumanMessagesWithoutObservedReply: 4,
    selfReplies: 1,
    unresolvedTargetReplies: 1,
  })
})

test("community activity analysis reports an empty bounded sample without claiming completeness", async () => {
  const { client, service } = fixture()
  client.pageResponses = [[]]

  const result = await service.analyze({
    channels: [{ channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
  })

  assert.equal(result.coverage.messagesFetched, 0)
  assert.equal(result.coverage.channels[0]?.paginationStop, "empty-page")
  assert.equal(result.coverage.channels[0]?.nextBeforeMessageId, null)
  assert.equal(result.participation.topParticipantMessageShare, null)
  assert.equal(result.reciprocity.reciprocalPairRate, null)
  assert.equal(result.responsiveness.medianSeconds, null)
  assert.equal(result.timing.hoursUtc.every(({ messageCount }) => messageCount === 0), true)
  assert.match(result.limitations.join(" "), /does not prove complete history/u)
})

test("community activity request normalization enforces exact scope and request budgets", () => {
  assert.deepEqual(normalizeCommunityActivityRequest({
    channels: [{ channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
  }), {
    channels: [{ channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
    maxMessagesPerChannel: 100,
  })
  assert.throws(() => normalizeCommunityActivityRequest({
    channels: [
      { channelId: FIRST_CHANNEL_ID },
      { channelId: FIRST_CHANNEL_ID },
    ],
    guildId: GUILD_ID,
  }), /must be unique/u)
  assert.throws(() => normalizeCommunityActivityRequest({
    channels: Array.from({ length: 5 }, (_, index) => ({
      channelId: (300_000_000_000_000_001n + BigInt(index)).toString(),
    })),
    guildId: GUILD_ID,
    maxMessagesPerChannel: 500,
  }), /at most 2000 messages/u)
  assert.throws(() => normalizeCommunityActivityRequest({
    channels: [{ beforeMessageId: "0", channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
  }), /exact positive Discord snowflake/u)
})

test("community activity analysis validates scope before fetching message evidence", async () => {
  const { client, service } = fixture()
  client.channels.set(FIRST_CHANNEL_ID, channel(FIRST_CHANNEL_ID, {
    guild_id: OTHER_GUILD_ID,
  }))

  await assert.rejects(service.analyze({
    channels: [{ channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
  }), CommunityActivityEvidenceError)
  assert.equal(client.listCalls.length, 0)
})

test("community activity analysis rejects malformed or inconsistent Discord pages", async () => {
  const first = message(
    "680000000000000002",
    "2026-08-27T12:00:02Z",
    FIRST_AUTHOR_ID,
  )
  const cases: Array<{ max?: number; pages: unknown[] }> = [
    { pages: [{}] },
    { max: 1, pages: [[first, first]] },
    { pages: [[first, first]] },
    { pages: [[
      first,
      message(
        "680000000000000001",
        "2026-08-27T12:00:03Z",
        SECOND_AUTHOR_ID,
      ),
    ]] },
    { pages: [[message(
      "680000000000000003",
      "not-a-timestamp",
      FIRST_AUTHOR_ID,
    )]] },
    { pages: [[message(
      "680000000000000004",
      "2026-08-27T12:00:04Z",
      FIRST_AUTHOR_ID,
      { channel_id: OTHER_CHANNEL_ID },
    )]] },
    { pages: [[reply(
      "680000000000000005",
      "2026-08-27T12:00:05Z",
      FIRST_AUTHOR_ID,
      null,
      {
        message_reference: {
          channel_id: OTHER_CHANNEL_ID,
          guild_id: GUILD_ID,
          message_id: "680000000000000001",
        },
      },
    )]] },
  ]
  for (const entry of cases) {
    const { client, service } = fixture()
    client.pageResponses = [...entry.pages]
    await assert.rejects(service.analyze({
      channels: [{ channelId: FIRST_CHANNEL_ID }],
      guildId: GUILD_ID,
      maxMessagesPerChannel: entry.max ?? 10,
    }), CommunityActivityEvidenceError)
  }
})

test("community activity analysis rejects conflicting or future resolved reply evidence", async () => {
  const target = message(
    "690000000000000001",
    "2026-08-27T12:00:01Z",
    SECOND_AUTHOR_ID,
  )
  const conflict = reply(
    "690000000000000003",
    "2026-08-27T12:00:03Z",
    FIRST_AUTHOR_ID,
    { ...target, author: { id: FIRST_AUTHOR_ID, username: PRIVATE_USERNAME } },
  )
  const future = reply(
    "690000000000000004",
    "2026-08-27T12:00:04Z",
    FIRST_AUTHOR_ID,
    message(
      "690000000000000002",
      "2026-08-27T12:00:05Z",
      SECOND_AUTHOR_ID,
    ),
  )
  for (const page of [[conflict, target], [future]]) {
    const { client, service } = fixture()
    client.pageResponses = [page]
    await assert.rejects(service.analyze({
      channels: [{ channelId: FIRST_CHANNEL_ID }],
      guildId: GUILD_ID,
      maxMessagesPerChannel: 10,
    }), CommunityActivityEvidenceError)
  }
})

test("community activity analysis stops before network access when aborted", async () => {
  const { client, service } = fixture()
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(service.analyze({
    channels: [{ channelId: FIRST_CHANNEL_ID }],
    guildId: GUILD_ID,
  }, { signal: controller.signal }), { name: "AbortError" })
  assert.equal(client.getChannelCalls.length, 0)
  assert.equal(client.listCalls.length, 0)
})
