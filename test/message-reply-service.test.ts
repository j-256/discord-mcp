import assert from "node:assert/strict"
import test from "node:test"

import {
  MessageReplyService,
  type MessageReplyServiceClient,
} from "../src/message-reply-service.js"
import type { MessagePageOptions } from "../src/discord-client.js"
import type {
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const SOURCE_MESSAGE_ID = "300000000000000001"
const CURSOR_MESSAGE_ID = "300000000000000003"
const FIRST_REPLY_ID = "300000000000000004"
const NON_REPLY_ID = "300000000000000005"
const SECOND_REPLY_ID = "300000000000000006"
const AUTHOR_ID = "400000000000000001"
const PRIVATE_CONTENT = "private coordination content"
const PRIVATE_USERNAME = "private-coordinator"

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-channel",
    type: 0,
    ...overrides,
  }
}

function message(
  id: string,
  overrides: Partial<DiscordMessage> & Record<string, unknown> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: {
      bot: false,
      id: AUTHOR_ID,
      username: PRIVATE_USERNAME,
    },
    channel_id: CHANNEL_ID,
    components: [],
    content: PRIVATE_CONTENT,
    embeds: [],
    guild_id: GUILD_ID,
    id,
    mention_roles: [],
    mentions: [],
    reactions: [],
    timestamp: "2026-08-29T00:00:00.000Z",
    type: 0,
    ...overrides,
  }
}

function reply(
  id: string,
  targetMessageId = SOURCE_MESSAGE_ID,
  overrides: Partial<DiscordMessage> & Record<string, unknown> = {},
): DiscordMessage {
  return message(id, {
    message_reference: {
      channel_id: CHANNEL_ID,
      guild_id: GUILD_ID,
      message_id: targetMessageId,
      type: 0,
    },
    type: 19,
    ...overrides,
  })
}

class FixtureClient implements MessageReplyServiceClient {
  channel = channel()
  source = message(SOURCE_MESSAGE_ID)
  scanned: DiscordMessage[] = []
  calls = {
    channel: [] as Array<{ channelId: string; options: RequestOptions }>,
    message: [] as Array<{
      channelId: string
      messageId: string
      options: RequestOptions
    }>,
    scan: [] as Array<{ channelId: string; options: MessagePageOptions }>,
  }

  async getChannel(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannel> {
    this.calls.channel.push({ channelId, options })
    return this.channel
  }

  async getMessage(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    this.calls.message.push({ channelId, messageId, options })
    return this.source
  }

  async listMessages(
    channelId: string,
    options: MessagePageOptions = {},
  ): Promise<DiscordMessage[]> {
    this.calls.scan.push({ channelId, options })
    return this.scanned
  }
}

function fixture() {
  const client = new FixtureClient()
  const policyCalls: string[] = []
  const service = new MessageReplyService({
    client,
    policy: {
      assertChannelReadable(value) {
        policyCalls.push(value.id)
        return value.guild_id as string
      },
    },
  })
  return { client, policyCalls, service }
}

test("message reply inspection returns exact replies in ascending order with scan coverage", async () => {
  const { client, policyCalls, service } = fixture()
  client.source = reply(SOURCE_MESSAGE_ID, "300000000000000000", {
    attachments: [{ privateUrl: "https://cdn.example.invalid/private" }],
    components: [{ privateCustomId: "private-component" }],
    embeds: [{ privateTitle: "private-embed" }],
    mentions: [{ id: "400000000000000002", username: "private-mentioned-user" }],
    reactions: [{ privateEmoji: "private-reaction" }],
    sticker_items: [{ privateSticker: "private-sticker" }],
  } as unknown as Partial<DiscordMessage>)
  client.scanned = [
    reply(SECOND_REPLY_ID),
    message(NON_REPLY_ID),
    reply(FIRST_REPLY_ID),
    reply(CURSOR_MESSAGE_ID, "300000000000000002"),
  ]
  const signal = new AbortController().signal

  const result = await service.list(CHANNEL_ID, SOURCE_MESSAGE_ID, {
    afterMessageId: "300000000000000002",
    scanLimit: 4,
    signal,
  })

  assert.deepEqual(policyCalls, [CHANNEL_ID])
  assert.deepEqual(client.calls.channel, [{ channelId: CHANNEL_ID, options: { signal } }])
  assert.deepEqual(client.calls.message, [{
    channelId: CHANNEL_ID,
    messageId: SOURCE_MESSAGE_ID,
    options: { signal },
  }])
  assert.deepEqual(client.calls.scan, [{
    channelId: CHANNEL_ID,
    options: {
      after: "300000000000000002",
      limit: 4,
      signal,
    },
  }])
  assert.equal(result.source.id, SOURCE_MESSAGE_ID)
  assert.equal(result.source.content, PRIVATE_CONTENT)
  assert.deepEqual(result.replies.map(({ id }) => id), [FIRST_REPLY_ID, SECOND_REPLY_ID])
  assert.deepEqual(result.page, {
    afterMessageId: "300000000000000002",
    nextAfterMessageId: SECOND_REPLY_ID,
    replyCount: 2,
    requestedScanLimit: 4,
    scanLimitReached: true,
    scannedMessageCount: 4,
  })
  assert.deepEqual(result.privacy, {
    persistence: "none",
    profileExpansion: "omitted",
    rawPayloads: "omitted",
  })
  assert.deepEqual(result.source, {
    attachmentCount: 1,
    authorBot: false,
    authorId: AUTHOR_ID,
    authorSystem: false,
    channelId: CHANNEL_ID,
    componentCount: 1,
    content: PRIVATE_CONTENT,
    editedTimestamp: null,
    embedCount: 1,
    guildId: GUILD_ID,
    id: SOURCE_MESSAGE_ID,
    jumpUrl: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${SOURCE_MESSAGE_ID}`,
    mentionEveryone: false,
    mentionedRoleCount: 0,
    mentionedUserCount: 1,
    pinned: false,
    reactionKindCount: 1,
    replyToMessageId: null,
    stickerCount: 1,
    timestamp: "2026-08-29T00:00:00.000Z",
    tts: false,
    type: 19,
  })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /300000000000000000/u)
  assert.doesNotMatch(serialized, /private-coordinator|private-mentioned-user/u)
  assert.doesNotMatch(serialized, /private-component|private-embed|private-reaction|private-sticker/u)
  assert.doesNotMatch(serialized, /cdn\.example\.invalid/u)
})

test("message reply inspection defaults to the source cursor and preserves it for an empty page", async () => {
  const { client, service } = fixture()

  const result = await service.list(CHANNEL_ID, SOURCE_MESSAGE_ID)

  assert.deepEqual(client.calls.scan, [{
    channelId: CHANNEL_ID,
    options: {
      after: SOURCE_MESSAGE_ID,
      limit: 50,
    },
  }])
  assert.deepEqual(result.replies, [])
  assert.deepEqual(result.page, {
    afterMessageId: SOURCE_MESSAGE_ID,
    nextAfterMessageId: SOURCE_MESSAGE_ID,
    replyCount: 0,
    requestedScanLimit: 50,
    scanLimitReached: false,
    scannedMessageCount: 0,
  })
})

test("message reply inspection rejects invalid input before Discord access", async () => {
  const { client, service } = fixture()

  await assert.rejects(
    () => service.list(CHANNEL_ID, SOURCE_MESSAGE_ID, {
      afterMessageId: "300000000000000000",
    }),
    /cursor must not precede the source message/,
  )
  await assert.rejects(
    () => service.list(CHANNEL_ID, SOURCE_MESSAGE_ID, { scanLimit: 101 }),
    /scan limit must be between 1 and 100/,
  )
  await assert.rejects(
    () => service.list("0", SOURCE_MESSAGE_ID),
    /exact positive Discord snowflake/,
  )
  assert.equal(client.calls.channel.length, 0)
  assert.equal(client.calls.message.length, 0)
  assert.equal(client.calls.scan.length, 0)
})

test("message reply inspection fails closed on mismatched source or channel evidence", async () => {
  const mismatches = [
    (client: FixtureClient) => {
      client.channel = channel({ id: "200000000000000002" })
    },
    (client: FixtureClient) => {
      client.source = message("300000000000000099")
    },
    (client: FixtureClient) => {
      client.source = {
        ...message(SOURCE_MESSAGE_ID),
        content: 42,
      } as unknown as DiscordMessage
    },
  ]
  for (const configure of mismatches) {
    const { client, service } = fixture()
    configure(client)
    await assert.rejects(
      () => service.list(CHANNEL_ID, SOURCE_MESSAGE_ID),
      /different channel|invalid source-message evidence/,
    )
    assert.equal(client.calls.scan.length, 0)
  }
})

test("message reply inspection rejects duplicate, stale, oversized, and cross-scope scan evidence", async () => {
  const pages: DiscordMessage[][] = [
    [message(NON_REPLY_ID), message(NON_REPLY_ID)],
    [message(SOURCE_MESSAGE_ID)],
    [message(NON_REPLY_ID, { channel_id: "200000000000000002" })],
    [message(NON_REPLY_ID, { guild_id: "100000000000000002" })],
    [message(NON_REPLY_ID), message(SECOND_REPLY_ID)],
  ]
  for (const [index, page] of pages.entries()) {
    const { client, service } = fixture()
    client.scanned = page
    await assert.rejects(
      () => service.list(CHANNEL_ID, SOURCE_MESSAGE_ID, {
        scanLimit: index === pages.length - 1 ? 1 : 50,
      }),
      /invalid message reply scan page|invalid or duplicate message reply scan evidence/,
    )
  }
})

test("message reply inspection rejects malformed reply references but skips valid other targets", async () => {
  const missingReference = reply(FIRST_REPLY_ID)
  delete missingReference.message_reference
  const invalidReplies = [
    missingReference,
    reply(FIRST_REPLY_ID, SOURCE_MESSAGE_ID, {
      message_reference: {
        channel_id: CHANNEL_ID,
        guild_id: GUILD_ID,
        message_id: SOURCE_MESSAGE_ID,
        type: 1,
      },
    }),
    reply(FIRST_REPLY_ID, SOURCE_MESSAGE_ID, {
      message_reference: {
        channel_id: "200000000000000002",
        guild_id: GUILD_ID,
        message_id: SOURCE_MESSAGE_ID,
        type: 0,
      },
    }),
    reply(FIRST_REPLY_ID, SOURCE_MESSAGE_ID, {
      message_reference: {
        channel_id: CHANNEL_ID,
        guild_id: "100000000000000002",
        message_id: SOURCE_MESSAGE_ID,
        type: 0,
      },
    }),
  ]
  for (const scanned of invalidReplies) {
    const { client, service } = fixture()
    client.scanned = [scanned]
    await assert.rejects(
      () => service.list(CHANNEL_ID, SOURCE_MESSAGE_ID),
      /malformed message-reply reference evidence|outside the requested channel or guild/,
    )
  }

  const { client, service } = fixture()
  client.scanned = [reply(FIRST_REPLY_ID, "300000000000000002")]
  const result = await service.list(CHANNEL_ID, SOURCE_MESSAGE_ID)
  assert.deepEqual(result.replies, [])
  assert.equal(result.page.nextAfterMessageId, FIRST_REPLY_ID)
})
