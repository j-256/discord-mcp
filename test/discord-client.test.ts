import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import { DiscordApiError } from "../src/errors.js"

const TOKEN = "test-discord-token-value"
const API_BASE_URL = "https://discord.test/api/v10"

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    status,
  })
}

test("Discord client sends bot authentication only to its configured API origin", async () => {
  let requestUrl = ""
  let authorization = ""
  let redirect: RequestInit["redirect"]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get("Authorization") || ""
      redirect = init?.redirect
      return jsonResponse({ description: "", id: "1", name: "test" })
    },
    token: TOKEN,
  })

  const application = await client.getCurrentApplication()

  assert.equal(application.id, "1")
  assert.equal(requestUrl, `${API_BASE_URL}/oauth2/applications/@me`)
  assert.equal(authorization, `Bot ${TOKEN}`)
  assert.equal(redirect, "error")
})

test("Discord client encodes bounded message pagination without undefined cursors", async () => {
  let requestUrl = ""
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requestUrl = String(input)
      return jsonResponse([])
    },
    token: TOKEN,
  })

  await client.listMessages("200", { before: "300", limit: 25 })

  assert.equal(requestUrl, `${API_BASE_URL}/channels/200/messages?before=300&limit=25`)
})

test("Discord client enforces pagination bounds outside the MCP adapter", () => {
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([]),
    token: TOKEN,
  })

  assert.throws(
    () => client.listMessages("200", { limit: 101 }),
    /between 1 and 100/,
  )
  assert.throws(
    () => client.listMessages("200", { after: "1", before: "2" }),
    /mutually exclusive/,
  )
  assert.throws(
    () => client.listCurrentUserGuilds({ limit: 201 }),
    /between 1 and 200/,
  )
})

test("Discord client encodes native guild search filters as repeated bounded query values", async () => {
  let requestUrl = ""
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requestUrl = String(input)
      return jsonResponse({
        doing_deep_historical_index: false,
        messages: [],
        total_results: 0,
      })
    },
    token: TOKEN,
  })

  await client.searchGuildMessages("100", {
    attachmentExtensions: ["log", "txt"],
    authorIds: ["300", "301"],
    authorTypes: ["bot", "-webhook"],
    channelIds: ["200", "201"],
    content: "deploy failed",
    has: ["file", "-poll"],
    includeNsfw: false,
    limit: 25,
    maxId: "999",
    mentionEveryone: false,
    minId: "100",
    offset: 25,
    pinned: true,
    slop: 3,
    sortBy: "timestamp",
    sortOrder: "desc",
  })

  const url = new URL(requestUrl)
  assert.equal(url.pathname, "/api/v10/guilds/100/messages/search")
  assert.deepEqual(url.searchParams.getAll("channel_id"), ["200", "201"])
  assert.deepEqual(url.searchParams.getAll("author_id"), ["300", "301"])
  assert.deepEqual(url.searchParams.getAll("author_type"), ["bot", "-webhook"])
  assert.deepEqual(url.searchParams.getAll("has"), ["file", "-poll"])
  assert.deepEqual(url.searchParams.getAll("attachment_extension"), ["log", "txt"])
  assert.equal(url.searchParams.get("content"), "deploy failed")
  assert.equal(url.searchParams.get("include_nsfw"), "false")
  assert.equal(url.searchParams.get("mention_everyone"), "false")
  assert.equal(url.searchParams.get("pinned"), "true")
  assert.equal(url.searchParams.get("sort_by"), "timestamp")
  assert.equal(url.searchParams.get("sort_order"), "desc")
})

test("Discord client rejects invalid native search bounds and runtime enum values", () => {
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({}),
    token: TOKEN,
  })

  assert.throws(
    () => client.searchGuildMessages("100", { limit: 26 }),
    /between 1 and 25/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { offset: 9_976 }),
    /between 0 and 9975/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { content: "find", slop: 101 }),
    /between 0 and 100/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { slop: 2 }),
    /requires content/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", {
      sortBy: "relevance",
      sortOrder: "desc",
    }),
    /cannot accompany relevance/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", {
      authorTypes: ["robot" as never],
    }),
    /unsupported value "robot"/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { channelIds: ["not-a-snowflake"] }),
    /values must be Discord snowflakes/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { maxId: "100", minId: "100" }),
    /minimum ID must be less than maximum ID/,
  )
})

test("Discord client returns Discord search indexing progress without retrying", async () => {
  let calls = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      calls += 1
      return jsonResponse({
        code: 110000,
        documents_indexed: 42,
        message: "Index not yet available",
        retry_after: 1.25,
      }, 202)
    },
    token: TOKEN,
  })

  const result = await client.searchGuildMessages("100", { content: "deploy" })

  assert.deepEqual(result, {
    code: 110000,
    documents_indexed: 42,
    message: "Index not yet available",
    retry_after: 1.25,
  })
  assert.equal(calls, 1)
})

test("Discord client targets role, member, active-thread, and archived-thread routes", async () => {
  const requests: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/roles")) return jsonResponse([])
      if (url.includes("/members/")) return jsonResponse({ roles: [] })
      return jsonResponse({ has_more: false, threads: [] })
    },
    token: TOKEN,
  })

  await client.getGuildRoles("100")
  await client.getGuildMember("100", "101")
  await client.listActiveGuildThreads("100")
  await client.listPublicArchivedThreads("200", {
    before: "2026-08-14T00:00:00.000Z",
    limit: 25,
  })
  await client.listPrivateArchivedThreads("200", { limit: 20 })
  await client.listJoinedPrivateArchivedThreads("200", { before: "300", limit: 15 })

  assert.deepEqual(requests, [
    `${API_BASE_URL}/guilds/100/roles`,
    `${API_BASE_URL}/guilds/100/members/101`,
    `${API_BASE_URL}/guilds/100/threads/active`,
    `${API_BASE_URL}/channels/200/threads/archived/public?before=2026-08-14T00%3A00%3A00.000Z&limit=25`,
    `${API_BASE_URL}/channels/200/threads/archived/private?limit=20`,
    `${API_BASE_URL}/channels/200/users/@me/threads/archived/private?before=300&limit=15`,
  ])
  assert.throws(
    () => client.listPublicArchivedThreads("200", { limit: 101 }),
    /between 2 and 100/,
  )
  assert.throws(
    () => client.listPublicArchivedThreads("200", { limit: 1 }),
    /between 2 and 100/,
  )
  assert.throws(
    () => client.listPublicArchivedThreads("200", { before: "tomorrow" }),
    /ISO 8601 timestamp/,
  )
  assert.throws(
    () => client.listJoinedPrivateArchivedThreads("200", { before: "not-a-snowflake" }),
    /Discord snowflake/,
  )
})

test("Discord client retries short rate limits using Discord retry timing", async () => {
  const waits: number[] = []
  let calls = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      calls += 1
      if (calls === 1) {
        return jsonResponse({
          global: false,
          message: "rate limited",
          retry_after: 0.012,
        }, 429)
      }
      return jsonResponse({ bot: true, id: "1", username: "bot" })
    },
    sleep: async (milliseconds) => {
      waits.push(milliseconds)
    },
    token: TOKEN,
  })

  const user = await client.getCurrentUser()

  assert.equal(user.id, "1")
  assert.equal(calls, 2)
  assert.deepEqual(waits, [12])
})

test("Discord client surfaces long rate limits without sleeping", async () => {
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      message: "rate limited",
      retry_after: 30,
    }, 429),
    maxAutomaticRetryWaitMs: 100,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.getCurrentUser(),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && error.retryAfterMs === 30_000
    ),
  )
  assert.equal(sleeps, 0)
})

test("Discord client redacts the bot token from API and network errors", async () => {
  const apiClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      code: 50_013,
      message: `Missing permissions for ${TOKEN}`,
    }, 403, { "x-ratelimit-reset-after": "0.1" }),
    token: TOKEN,
  })
  await assert.rejects(
    () => apiClient.getCurrentUser(),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.code === 50_013
      && error.retryAfterMs === undefined
      && error.message.includes("[redacted]")
      && !error.message.includes(TOKEN)
    ),
  )

  const networkClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(`network exposed ${TOKEN}`)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => networkClient.getCurrentUser(),
    (error: unknown) => (
      error instanceof Error
      && error.message.includes("[redacted]")
      && !error.message.includes(TOKEN)
    ),
  )
})

test("Discord client sends deletion bodies and audit reasons without response parsing noise", async () => {
  const requests: Array<{
    body: string | null
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  await client.bulkDeleteMessages("200", ["301", "302"], "reviewed plan")
  await client.deleteMessage("200", "303", "reviewed plan")

  assert.deepEqual(requests, [
    {
      body: JSON.stringify({ messages: ["301", "302"] }),
      method: "POST",
      reason: "reviewed%20plan",
      url: `${API_BASE_URL}/channels/200/messages/bulk-delete`,
    },
    {
      body: null,
      method: "DELETE",
      reason: "reviewed%20plan",
      url: `${API_BASE_URL}/channels/200/messages/303`,
    },
  ])
})

test("Discord client sends safe message, edit, and own-reaction wire contracts", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({ body, method: init?.method || "GET", url: String(input) })
      if (init?.method === "PUT") return new Response(null, { status: 204 })
      return jsonResponse({
        author: { bot: true, id: "400", username: "bot" },
        channel_id: "200",
        content: body.content,
        id: "300",
        nonce: body.nonce,
        timestamp: "2026-08-14T00:00:00.000Z",
        type: 0,
      })
    },
    token: TOKEN,
  })

  await client.createMessage("200", {
    allowedMentions: { parse: [], replied_user: false },
    content: "safe reply",
    nonce: "stable-nonce",
    reply: { guildId: "100", messageId: "299" },
  })
  await client.editMessage("200", "300", {
    allowedMentions: { replied_user: false, users: ["401"] },
    content: "hello <@401>",
  })
  await client.addOwnReaction("200", "300", "🔥")

  assert.deepEqual(requests, [
    {
      body: {
        allowed_mentions: { parse: [], replied_user: false },
        content: "safe reply",
        enforce_nonce: true,
        message_reference: {
          channel_id: "200",
          fail_if_not_exists: true,
          guild_id: "100",
          message_id: "299",
          type: 0,
        },
        nonce: "stable-nonce",
      },
      method: "POST",
      url: `${API_BASE_URL}/channels/200/messages`,
    },
    {
      body: {
        allowed_mentions: { replied_user: false, users: ["401"] },
        content: "hello <@401>",
      },
      method: "PATCH",
      url: `${API_BASE_URL}/channels/200/messages/300`,
    },
    {
      body: null,
      method: "PUT",
      url: `${API_BASE_URL}/channels/200/messages/300/reactions/%F0%9F%94%A5/@me`,
    },
  ])
})

test("Discord client rejects unsafe message wire inputs before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })

  assert.throws(
    () => client.createMessage("200", {
      allowedMentions: { parse: [], replied_user: false },
      content: " ",
      nonce: "nonce",
    }),
    /must not be blank/,
  )
  assert.throws(
    () => client.createMessage("200", {
      allowedMentions: { parse: [], replied_user: false },
      content: "hello",
      nonce: "x".repeat(26),
    }),
    /nonce/,
  )
  assert.throws(
    () => client.editMessage("200", "300", {
      allowedMentions: { replied_user: false, users: ["401", "401"] },
      content: "hello",
    }),
    /must not contain duplicates/,
  )
  assert.equal(requests, 0)
})
