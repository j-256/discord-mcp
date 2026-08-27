import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import {
  DiscordApiError,
  MemberVerificationEvidenceError,
} from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"

test("Discord client sends one exact member verification flag body", async () => {
  let request: {
    body: string | null
    method: string
    reason: string | null
    url: string
  } | null = null
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      request = {
        body: init?.body ? String(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      }
      return Response.json({ flags: 12, user: { id: "300" } })
    },
    token: TOKEN,
  })

  assert.deepEqual(
    await client.modifyGuildMemberVerificationBypass(
      "100",
      "300",
      12,
      "Review / case 42",
    ),
    {
      bypassesVerification: true,
      flags: 12,
      userId: "300",
    },
  )
  assert.deepEqual(request, {
    body: JSON.stringify({ flags: 12 }),
    method: "PATCH",
    reason: "Review%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/100/members/300`,
  })
})

test("Discord client preserves high safe member flag values without signed truncation", async () => {
  const flags = 2 ** 40 + 4
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => Response.json({ flags, user: { id: "300" } }),
    token: TOKEN,
  })

  assert.deepEqual(
    await client.modifyGuildMemberVerificationBypass("100", "300", flags, "reviewed"),
    { bypassesVerification: true, flags, userId: "300" },
  )
})

test("Discord client never retries member verification writes and redacts failures", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return new Response(
        JSON.stringify({ message: "private audit reason", retry_after: 0.001 }),
        { headers: { "content-type": "application/json" }, status: 429 },
      )
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.modifyGuildMemberVerificationBypass(
      "100",
      "300",
      4,
      "private audit reason",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.doesNotMatch(error.message, /private audit reason/u)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects mismatched or malformed member verification responses", async () => {
  const responses: unknown[] = [
    { flags: 4, user: { id: "999" } },
    { flags: -1, user: { id: "300" } },
    { flags: 1.5, user: { id: "300" } },
    { flags: Number.MAX_SAFE_INTEGER + 1, user: { id: "300" } },
    { user: { id: "300" } },
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => Response.json(responses.shift()),
    token: TOKEN,
  })

  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(
      () => client.modifyGuildMemberVerificationBypass("100", "300", 4, "reviewed"),
      MemberVerificationEvidenceError,
    )
  }
})

test("Discord client validates exact member verification intent before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return Response.json({ flags: 4, user: { id: "300" } })
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.modifyGuildMemberVerificationBypass("bad", "300", 4, "reviewed"),
    /guild ID/u,
  )
  await assert.rejects(
    () => client.modifyGuildMemberVerificationBypass("100", "bad", 4, "reviewed"),
    /user ID/u,
  )
  for (const flags of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => client.modifyGuildMemberVerificationBypass("100", "300", flags, "reviewed"),
      /flags/u,
    )
  }
  await assert.rejects(
    () => client.modifyGuildMemberVerificationBypass("100", "300", 4, "\ud800"),
    /invalid Unicode/u,
  )
  assert.equal(requests, 0)
})
