import assert from "node:assert/strict"
import test from "node:test"

import type { MessagePageOptions } from "../src/discord-client.js"
import {
  encodeCoordinationNote,
  type CoordinationNoteInput,
} from "../src/coordination-note.js"
import {
  CoordinationNoteService,
  type CoordinationNoteServiceClient,
} from "../src/coordination-note-service.js"
import type {
  DiscordChannel,
  DiscordMessage,
  DiscordReaction,
  RequestOptions,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const CHANNEL_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const OTHER_USER_ID = "500000000000000001"
const NOTIFY_USER_ID = "500000000000000002"
const CURSOR_ID = "600000000000000000"
const RECIPIENT = "dca_AQEBAQEBAQEBAQEBAQEBAQ"
const SENDER = "dca_AAAAAAAAAAAAAAAAAAAAAA"
const OTHER_SENDER = "dca_AgICAgICAgICAgICAgICAg"
const OTHER_RECIPIENT = "dca_AwMDAwMDAwMDAwMDAwMDAw"

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-coordination-channel",
    type: 0,
    ...overrides,
  }
}

function reaction(emoji: string, count = 1): DiscordReaction {
  return {
    burst_colors: [],
    count,
    count_details: { burst: 0, normal: count },
    emoji: { animated: false, id: null, name: emoji },
    me: false,
    me_burst: false,
  }
}

function message(
  id: string,
  content: string,
  overrides: Partial<DiscordMessage> & Record<string, unknown> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: {
      bot: true,
      id: BOT_ID,
      username: "private-bot-profile",
    },
    channel_id: CHANNEL_ID,
    components: [],
    content,
    embeds: [],
    guild_id: GUILD_ID,
    id,
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    reactions: [],
    sticker_items: [],
    timestamp: "2026-08-29T00:00:00.000Z",
    tts: false,
    type: 0,
    ...overrides,
  }
}

function note(
  id: string,
  input: Partial<CoordinationNoteInput> & Pick<CoordinationNoteInput, "body">,
  overrides: Partial<DiscordMessage> & Record<string, unknown> = {},
): DiscordMessage {
  const complete: CoordinationNoteInput = {
    body: input.body,
    fromAddress: input.fromAddress ?? SENDER,
    ...(input.notifyUserId ? { notifyUserId: input.notifyUserId } : {}),
    tags: input.tags ?? ["handoff"],
    to: input.to ?? { address: RECIPIENT, kind: "address" },
  }
  return message(id, encodeCoordinationNote(complete), {
    ...(complete.notifyUserId
      ? {
          mentions: [{
            id: complete.notifyUserId,
            username: "private-notification-profile",
          }],
        }
      : {}),
    ...overrides,
  })
}

class FixtureClient implements CoordinationNoteServiceClient {
  channel = channel()
  messages: DiscordMessage[] = []
  calls = {
    channel: [] as Array<{ channelId: string; options: RequestOptions }>,
    messages: [] as Array<{ channelId: string; options: MessagePageOptions }>,
  }

  async getChannel(
    channelId: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannel> {
    this.calls.channel.push({ channelId, options })
    return this.channel
  }

  async listMessages(
    channelId: string,
    options: MessagePageOptions = {},
  ): Promise<DiscordMessage[]> {
    this.calls.messages.push({ channelId, options })
    return this.messages
  }
}

function fixture() {
  const client = new FixtureClient()
  const policyCalls: string[] = []
  const service = new CoordinationNoteService({
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

test("coordination note reads return one exact minimized page and count every discard", async () => {
  const { client, policyCalls, service } = fixture()
  const matchingId = "600000000000000009"
  const broadcastId = "600000000000000010"
  client.messages = [
    note(broadcastId, {
      body: "Broadcast body",
      fromAddress: OTHER_SENDER,
      tags: ["handoff", "release"],
      to: { kind: "broadcast" },
    }),
    note(matchingId, {
      body: "Matching private body",
      notifyUserId: NOTIFY_USER_ID,
      tags: ["handoff", "release"],
    }, {
      edited_timestamp: "2026-08-29T00:01:00.000Z",
      message_reference: {
        channel_id: CHANNEL_ID,
        guild_id: GUILD_ID,
        message_id: "600000000000000008",
      },
      reactions: [
        reaction("\u{1F440}", 2),
        reaction("\u{1F6D1}"),
        reaction("\u{1F916}"),
      ],
      type: 19,
    }),
    note("600000000000000008", {
      body: "resolved-body-must-not-escape",
    }, { reactions: [reaction("\u2705")] }),
    note("600000000000000007", {
      body: "filtered-tag-body-must-not-escape",
      tags: ["other"],
    }),
    note("600000000000000006", {
      body: "filtered-sender-body-must-not-escape",
      fromAddress: OTHER_SENDER,
    }),
    note("600000000000000005", {
      body: "different-recipient-body-must-not-escape",
      to: { address: OTHER_RECIPIENT, kind: "address" },
    }),
    note("600000000000000004", {
      body: "non-plain-body-must-not-escape",
    }, {
      attachments: [{
        privateUrl: "https://cdn.example.invalid/private",
      }] as unknown as NonNullable<DiscordMessage["attachments"]>,
    }),
    message(
      "600000000000000003",
      "[discord-mcp.coordination-note.v1]\nmalformed-envelope-secret",
    ),
    message("600000000000000002", "ordinary-chatter-secret"),
    note("600000000000000001", {
      body: "other-author-body-must-not-escape",
    }, {
      author: { bot: false, id: OTHER_USER_ID, username: "private-human-profile" },
    }),
  ]
  const signal = new AbortController().signal

  const result = await service.listNotes(
    APPLICATION_ID,
    BOT_ID,
    CHANNEL_ID,
    RECIPIENT,
    {
      afterMessageId: CURSOR_ID,
      fromAddress: SENDER,
      includeBroadcasts: true,
      scanLimit: 10,
      signal,
      tag: "handoff",
      unresolvedOnly: true,
    },
  )

  assert.deepEqual(policyCalls, [CHANNEL_ID])
  assert.deepEqual(client.calls.channel, [{ channelId: CHANNEL_ID, options: { signal } }])
  assert.deepEqual(client.calls.messages, [{
    channelId: CHANNEL_ID,
    options: { after: CURSOR_ID, limit: 10, signal },
  }])
  assert.deepEqual(result.discarded, {
    differentRecipient: 1,
    filteredSender: 2,
    filteredTag: 1,
    malformedEnvelope: 1,
    nonNote: 1,
    resolvedByConvention: 1,
    unsupportedAuthorOrWebhook: 1,
    unsupportedMessageShape: 1,
  })
  assert.equal(result.notes.length, 1)
  assert.deepEqual(result.notes[0], {
    body: "Matching private body",
    channelId: CHANNEL_ID,
    editedTimestamp: "2026-08-29T00:01:00.000Z",
    fromAddress: SENDER,
    guildId: GUILD_ID,
    id: matchingId,
    jumpUrl: `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${matchingId}`,
    notificationRequested: true,
    plainMessage: {
      attachmentCount: 0,
      componentCount: 0,
      embedCount: 0,
      stickerCount: 0,
    },
    replyToMessageId: "600000000000000008",
    statusSignals: {
      automatedReplyExpectedCount: 1,
      blockedCount: 1,
      declinedCount: 0,
      doneOrApprovedCount: 0,
      seenOrClaimedCount: 2,
      terminalConventionObserved: false,
    },
    tags: ["handoff", "release"],
    timestamp: "2026-08-29T00:00:00.000Z",
    to: { address: RECIPIENT, kind: "address" },
  })
  assert.deepEqual(result.page, {
    afterMessageId: CURSOR_ID,
    nextAfterMessageId: broadcastId,
    noteCount: 1,
    requestedScanLimit: 10,
    scanLimitReached: true,
    scannedMessageCount: 10,
  })
  assert.deepEqual(result.routing, {
    addressAuthority: "none",
    addressAuthentication: "none",
    addressLiveness: "not-proven",
    addressRegistration: "none",
    contentAuthority: "none",
    statusSignalAuthority: "none",
  })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /must-not-escape|ordinary-chatter-secret|malformed-envelope-secret/u)
  assert.doesNotMatch(serialized, /private-bot-profile|private-human-profile|private-notification-profile/u)
  assert.doesNotMatch(serialized, /cdn\.example\.invalid|500000000000000002/u)
})

test("coordination note reads include broadcasts by default and exclude them explicitly", async () => {
  const { client, service } = fixture()
  client.messages = [
    note("600000000000000002", { body: "broadcast", to: { kind: "broadcast" } }),
    note("600000000000000003", { body: "direct" }),
  ]

  const included = await service.listNotes(
    APPLICATION_ID,
    BOT_ID,
    CHANNEL_ID,
    RECIPIENT,
  )
  assert.deepEqual(included.notes.map(({ body }) => body), ["broadcast", "direct"])
  assert.equal(included.page.afterMessageId, null)

  const excluded = await service.listNotes(
    APPLICATION_ID,
    BOT_ID,
    CHANNEL_ID,
    RECIPIENT,
    { includeBroadcasts: false },
  )
  assert.deepEqual(excluded.notes.map(({ body }) => body), ["direct"])
  assert.equal(excluded.discarded.differentRecipient, 1)
})

test("coordination note reads reject every rich, unsafe-mention, and unsupported-reference shape", async () => {
  const cases: Array<Partial<DiscordMessage> & Record<string, unknown>> = [
    {
      attachments: [{}] as unknown as NonNullable<DiscordMessage["attachments"]>,
    },
    { components: [{}] as NonNullable<DiscordMessage["components"]> },
    { embeds: [{}] as NonNullable<DiscordMessage["embeds"]> },
    { sticker_items: [{}] as NonNullable<DiscordMessage["sticker_items"]> },
    { stickers: [{}] as NonNullable<DiscordMessage["stickers"]> },
    { message_snapshots: [] },
    { poll: {} as unknown as NonNullable<DiscordMessage["poll"]> },
    { tts: true },
    { mention_everyone: true },
    { mention_roles: ["500000000000000003"] },
    { mentions: [{ id: OTHER_USER_ID, username: "private-profile" }] },
    {
      message_reference: {
        channel_id: CHANNEL_ID,
        guild_id: GUILD_ID,
        message_id: "600000000000000000",
      },
      type: 0,
    },
  ]

  for (const [index, overrides] of cases.entries()) {
    const { client, service } = fixture()
    client.messages = [note(
      (600000000000000100n + BigInt(index)).toString(),
      { body: "body-must-not-escape" },
      overrides,
    )]

    const result = await service.listNotes(
      APPLICATION_ID,
      BOT_ID,
      CHANNEL_ID,
      RECIPIENT,
    )

    assert.equal(result.notes.length, 0)
    assert.equal(result.discarded.unsupportedMessageShape, 1)
    assert.doesNotMatch(JSON.stringify(result), /body-must-not-escape|private-profile/u)
  }

  const { client, service } = fixture()
  client.messages = [note(
    "600000000000000200",
    { body: "notification-body-must-not-escape", notifyUserId: NOTIFY_USER_ID },
    { mentions: [] },
  )]
  const notificationMismatch = await service.listNotes(
    APPLICATION_ID,
    BOT_ID,
    CHANNEL_ID,
    RECIPIENT,
  )
  assert.equal(notificationMismatch.notes.length, 0)
  assert.equal(notificationMismatch.discarded.unsupportedMessageShape, 1)
  assert.doesNotMatch(JSON.stringify(notificationMismatch), /notification-body-must-not-escape/u)
})

test("coordination address reads expose page-local routing labels without note data", async () => {
  const { client, service } = fixture()
  client.messages = [
    note("600000000000000004", {
      body: "newest-address-body-secret",
      fromAddress: SENDER,
      notifyUserId: NOTIFY_USER_ID,
      tags: ["private-tag"],
      to: { address: OTHER_RECIPIENT, kind: "address" },
    }),
    note("600000000000000003", {
      body: "other-address-body-secret",
      fromAddress: OTHER_SENDER,
      tags: ["other-private-tag"],
    }),
    note("600000000000000002", {
      body: "oldest-address-body-secret",
      fromAddress: SENDER,
    }),
  ]

  const result = await service.listAddresses(
    APPLICATION_ID,
    BOT_ID,
    CHANNEL_ID,
    { scanLimit: 3 },
  )

  assert.deepEqual(result.addresses, [
    {
      address: SENDER,
      firstObservedAtInPage: "2026-08-29T00:00:00.000Z",
      lastMessageIdInPage: "600000000000000004",
      lastObservedAtInPage: "2026-08-29T00:00:00.000Z",
      noteCountInPage: 2,
    },
    {
      address: OTHER_SENDER,
      firstObservedAtInPage: "2026-08-29T00:00:00.000Z",
      lastMessageIdInPage: "600000000000000003",
      lastObservedAtInPage: "2026-08-29T00:00:00.000Z",
      noteCountInPage: 1,
    },
  ].sort((left, right) => left.address.localeCompare(right.address)))
  assert.deepEqual(result.page, {
    addressCount: 2,
    afterMessageId: null,
    coordinationNoteCount: 3,
    nextAfterMessageId: "600000000000000004",
    requestedScanLimit: 3,
    scanLimitReached: true,
    scannedMessageCount: 3,
  })
  assert.deepEqual(result.privacy, {
    attachmentUrls: "omitted",
    connectorPersistence: "none",
    differentlyAddressedBodies: "discarded",
    notificationTargets: "omitted",
    noteBodies: "omitted",
    profiles: "omitted",
    rawPayloads: "omitted",
    reactionUsers: "not-read",
    recipients: "omitted",
    tags: "omitted",
  })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /body-secret|private-tag|other-private-tag/u)
  assert.doesNotMatch(serialized, new RegExp(NOTIFY_USER_ID, "u"))
  assert.doesNotMatch(serialized, new RegExp(RECIPIENT, "u"))
  assert.doesNotMatch(serialized, new RegExp(OTHER_RECIPIENT, "u"))
})

test("coordination reads reject invalid requests before Discord access", async () => {
  for (const run of [
    (service: CoordinationNoteService) => service.listNotes(
      APPLICATION_ID,
      BOT_ID,
      CHANNEL_ID,
      "friendly-name",
    ),
    (service: CoordinationNoteService) => service.listNotes(
      APPLICATION_ID,
      BOT_ID,
      CHANNEL_ID,
      RECIPIENT,
      { scanLimit: 101 },
    ),
    (service: CoordinationNoteService) => service.listAddresses(
      APPLICATION_ID,
      BOT_ID,
      "0",
    ),
  ]) {
    const { client, service } = fixture()
    await assert.rejects(run(service), /invalid|between 1 and 100|positive Discord snowflake/u)
    assert.equal(client.calls.channel.length, 0)
    assert.equal(client.calls.messages.length, 0)
  }
})

test("coordination reads fail closed on mismatched, duplicate, stale, and malformed page evidence", async () => {
  const cases: Array<(client: FixtureClient) => void> = [
    (client) => {
      client.channel = channel({ id: "300000000000000002" })
    },
    (client) => {
      client.messages = [note("600000000000000002", { body: "x" }), note("600000000000000002", { body: "x" })]
    },
    (client) => {
      client.messages = [note(CURSOR_ID, { body: "x" })]
    },
    (client) => {
      client.messages = [message("600000000000000002", "x", { channel_id: "300000000000000002" })]
    },
    (client) => {
      client.messages = [{
        ...message("600000000000000002", "x"),
        timestamp: "not-an-explicit-offset",
      }]
    },
    (client) => {
      client.messages = [note("600000000000000002", { body: "x" }, {
        message_reference: {
          channel_id: CHANNEL_ID,
          guild_id: GUILD_ID,
          message_id: "600000000000000001",
          type: 1,
        },
        type: 19,
      })]
    },
  ]
  for (const configure of cases) {
    const { client, service } = fixture()
    configure(client)
    await assert.rejects(
      () => service.listNotes(
        APPLICATION_ID,
        BOT_ID,
        CHANNEL_ID,
        RECIPIENT,
        { afterMessageId: CURSOR_ID },
      ),
      /different channel|invalid or duplicate coordination note scan evidence/u,
    )
  }
})

test("coordination address reads preserve a caller cursor for an empty page", async () => {
  const { client, service } = fixture()

  const result = await service.listAddresses(
    APPLICATION_ID,
    BOT_ID,
    CHANNEL_ID,
    { afterMessageId: CURSOR_ID },
  )

  assert.deepEqual(client.calls.messages, [{
    channelId: CHANNEL_ID,
    options: { after: CURSOR_ID, limit: 50 },
  }])
  assert.equal(result.page.nextAfterMessageId, CURSOR_ID)
  assert.deepEqual(result.addresses, [])
})
