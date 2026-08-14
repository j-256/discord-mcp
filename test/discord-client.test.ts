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
    }, 403),
    token: TOKEN,
  })
  await assert.rejects(
    () => apiClient.getCurrentUser(),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.code === 50_013
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
