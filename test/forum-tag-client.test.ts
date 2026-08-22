import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import { DiscordApiError, ForumTagEvidenceError } from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"
const GUILD_ID = "100000000000000001"
const FORUM_ID = "200000000000000001"
const ROLE_ID = "300000000000000001"
const TAG_ID = "400000000000000001"
const CUSTOM_TAG_ID = "400000000000000002"
const NEW_TAG_ID = "400000000000000003"
const CUSTOM_EMOJI_ID = "500000000000000001"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}

function rawForum(overrides: Record<string, unknown> = {}) {
  return {
    available_tags: [{
      emoji_id: null,
      emoji_name: "📌",
      id: TAG_ID,
      moderated: false,
      name: "Support",
      private_tag_field: "discarded",
    }, {
      emoji_id: CUSTOM_EMOJI_ID,
      emoji_name: null,
      id: CUSTOM_TAG_ID,
      moderated: true,
      name: "Staff",
    }],
    flags: 16,
    guild_id: GUILD_ID,
    id: FORUM_ID,
    name: "private-forum-name",
    permission_overwrites: [{
      allow: "1024",
      deny: "0",
      id: ROLE_ID,
      private_overwrite_field: "discarded",
      type: 0,
    }],
    private_channel_field: "discarded",
    type: 15,
    ...overrides,
  }
}

test("Discord client projects exact bounded forum-tag state", async () => {
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      assert.equal(String(input), `${API_BASE_URL}/channels/${FORUM_ID}`)
      assert.equal(init?.method, "GET")
      return jsonResponse(rawForum())
    },
    token: TOKEN,
  })

  const state = await client.getGuildForumTags(FORUM_ID)

  assert.deepEqual(state, {
    flags: 16,
    guildId: GUILD_ID,
    id: FORUM_ID,
    permissionOverwriteUnknownFieldCount: 1,
    permissionOverwrites: [{
      allow: "1024",
      deny: "0",
      id: ROLE_ID,
      type: 0,
    }],
    tags: [{
      emojiId: null,
      emojiName: "📌",
      id: TAG_ID,
      moderated: false,
      name: "Support",
      unknownFieldCount: 1,
    }, {
      emojiId: CUSTOM_EMOJI_ID,
      emojiName: null,
      id: CUSTOM_TAG_ID,
      moderated: true,
      name: "Staff",
      unknownFieldCount: 0,
    }],
    type: 15,
    unknownFieldCount: 1,
  })
  assert.doesNotMatch(JSON.stringify(state), /private-/)
})

test("Discord client sends one exact non-retried forum-tag replacement", async () => {
  let requests = 0
  let requestBody: unknown
  let requestReason: string | null = null
  const response = rawForum({
    available_tags: [{
      emoji_id: CUSTOM_EMOJI_ID,
      emoji_name: null,
      id: CUSTOM_TAG_ID,
      moderated: true,
      name: "Staff",
    }, {
      emoji_id: null,
      emoji_name: "✅",
      id: NEW_TAG_ID,
      moderated: false,
      name: "Resolved",
    }],
  })
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      requests += 1
      requestBody = JSON.parse(String(init?.body)) as unknown
      requestReason = new Headers(init?.headers).get("x-audit-log-reason")
      assert.equal(init?.method, "PATCH")
      return jsonResponse(response)
    },
    maxRetries: 3,
    sleep: async () => {
      throw new Error("Forum-tag PATCH must not retry")
    },
    token: TOKEN,
  })

  const result = await client.modifyGuildForumTags(
    FORUM_ID,
    [{
      emojiId: CUSTOM_EMOJI_ID,
      emojiName: null,
      id: CUSTOM_TAG_ID,
      moderated: true,
      name: "Staff",
    }, {
      emojiId: null,
      emojiName: "✅",
      moderated: false,
      name: "Resolved",
    }],
    "Reviewed forum tags",
  )

  assert.equal(requests, 1)
  assert.equal(requestReason, "Reviewed%20forum%20tags")
  assert.deepEqual(requestBody, {
    available_tags: [{
      emoji_id: CUSTOM_EMOJI_ID,
      emoji_name: null,
      id: CUSTOM_TAG_ID,
      moderated: true,
      name: "Staff",
    }, {
      emoji_id: null,
      emoji_name: "✅",
      moderated: false,
      name: "Resolved",
    }],
  })
  assert.equal(result.tags[1]?.id, NEW_TAG_ID)
})

test("Discord client rejects malformed forum-tag evidence", async () => {
  const malformed = [
    rawForum({ id: "200000000000000002" }),
    rawForum({ type: 16 }),
    rawForum({ flags: -1 }),
    rawForum({ permission_overwrites: undefined }),
    rawForum({ available_tags: Array.from({ length: 21 }, (_, index) => ({
      emoji_id: null,
      emoji_name: null,
      id: String(600000000000000000n + BigInt(index)),
      moderated: false,
      name: "Tag",
    })) }),
    rawForum({ available_tags: [
      ...rawForum().available_tags,
      rawForum().available_tags[0],
    ] }),
    rawForum({ available_tags: [{
      emoji_id: CUSTOM_EMOJI_ID,
      emoji_name: "📌",
      id: TAG_ID,
      moderated: false,
      name: "Support",
    }] }),
    rawForum({ available_tags: [{
      emoji_id: null,
      emoji_name: "x",
      id: TAG_ID,
      moderated: false,
      name: "Support",
    }] }),
  ]

  for (const payload of malformed) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(payload),
      token: TOKEN,
    })
    await assert.rejects(
      () => client.getGuildForumTags(FORUM_ID),
      ForumTagEvidenceError,
    )
  }
})

test("Discord client validates exact forum-tag inputs before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse(rawForum())
    },
    token: TOKEN,
  })
  const valid = {
    emojiId: null,
    emojiName: null,
    moderated: false,
    name: "Tag",
  }

  await assert.rejects(
    () => client.modifyGuildForumTags(FORUM_ID, [valid, valid], "Reviewed"),
    /at most one tag/,
  )
  await assert.rejects(
    () => client.modifyGuildForumTags(FORUM_ID, [{
      ...valid,
      emojiId: CUSTOM_EMOJI_ID,
      emojiName: "📌",
    }], "Reviewed"),
    /emoji fields conflict/,
  )
  await assert.rejects(
    () => client.modifyGuildForumTags(FORUM_ID, [{
      ...valid,
      emojiName: "plain-text",
    }], "Reviewed"),
    /one Unicode emoji/,
  )
  await assert.rejects(
    () => client.modifyGuildForumTags(FORUM_ID, [{
      ...valid,
      extra: true,
    } as never], "Reviewed"),
    /input is invalid/,
  )
  await assert.rejects(
    () => client.getGuildForumTags("invalid"),
    /positive Discord snowflake/,
  )
  assert.equal(requests, 0)
})

test("Discord client suppresses forum-tag content from failures and never retries writes", async () => {
  const privateText = "private forum-tag name"
  const transportClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateText)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => transportClient.getGuildForumTags(FORUM_ID),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.equal(error.message.includes(privateText), false)
      assert.equal(error.cause, undefined)
      return true
    },
  )

  let requests = 0
  const rateLimitedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        code: 20_016,
        message: privateText,
        retry_after: 0,
      }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    () => rateLimitedClient.modifyGuildForumTags(FORUM_ID, [{
      emojiId: null,
      emojiName: null,
      id: TAG_ID,
      moderated: false,
      name: "Support",
    }], "Reviewed"),
    (error: unknown) => {
      assert(error instanceof DiscordApiError)
      assert.equal(error.route, "/channels/{channel.id}")
      assert.equal(error.message.includes(privateText), false)
      return true
    },
  )
  assert.equal(requests, 1)
})
