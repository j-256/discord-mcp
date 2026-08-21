import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import { DiscordApiError } from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"

test("Discord client sends exact member-role routes with encoded audit reasons", async () => {
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
        body: init?.body ? String(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  await client.addGuildMemberRole("100", "200", "300", "Review / case 42")
  await client.removeGuildMemberRole("100", "200", "300", "Review / case 42")

  assert.deepEqual(requests, [
    {
      body: null,
      method: "PUT",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/members/200/roles/300`,
    },
    {
      body: null,
      method: "DELETE",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/members/200/roles/300`,
    },
  ])
})

test("Discord client never retries member-role writes", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return new Response(
        JSON.stringify({ message: "rate limited", retry_after: 0.001 }),
        {
          headers: { "content-type": "application/json" },
          status: 429,
        },
      )
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.addGuildMemberRole("100", "200", "300", "reviewed"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects invalid member-role inputs before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.addGuildMemberRole("bad", "200", "300", "reviewed"),
    /guild ID/,
  )
  await assert.rejects(
    () => client.addGuildMemberRole("100", "bad", "300", "reviewed"),
    /user ID/,
  )
  await assert.rejects(
    () => client.removeGuildMemberRole("100", "200", "bad", "reviewed"),
    /role ID/,
  )
  await assert.rejects(
    () => client.removeGuildMemberRole("100", "200", "300", "\ud800"),
    /invalid Unicode/,
  )
  assert.equal(requests, 0)
})
