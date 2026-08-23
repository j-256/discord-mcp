import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import {
  DiscordApiError,
  MemberNicknameEvidenceError,
} from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"

test("Discord client sends narrow exact nickname routes and one-field bodies", async () => {
  const requests: Array<{
    body: string | null
    method: string
    reason: string | null
    url: string
  }> = []
  const responses = [
    { nick: "Connector Name", user: { id: "200" } },
    { nick: "Member Name", user: { id: "300" } },
    { user: { id: "200" } },
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: init?.body ? String(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return Response.json(responses.shift(), { status: 200 })
    },
    token: TOKEN,
  })

  assert.deepEqual(
    await client.modifyCurrentMemberNickname(
      "100",
      "200",
      "Connector Name",
      "Review / case 42",
    ),
    { nickname: "Connector Name", userId: "200" },
  )
  assert.deepEqual(
    await client.modifyGuildMemberNickname(
      "100",
      "300",
      "Member Name",
      "Review / case 42",
    ),
    { nickname: "Member Name", userId: "300" },
  )
  assert.deepEqual(
    await client.modifyCurrentMemberNickname(
      "100",
      "200",
      null,
      "Review / case 42",
    ),
    { nickname: null, userId: "200" },
  )

  assert.deepEqual(requests, [
    {
      body: JSON.stringify({ nick: "Connector Name" }),
      method: "PATCH",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/members/@me`,
    },
    {
      body: JSON.stringify({ nick: "Member Name" }),
      method: "PATCH",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/members/300`,
    },
    {
      body: JSON.stringify({ nick: null }),
      method: "PATCH",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/members/@me`,
    },
  ])
  assert.equal(requests.some((request) => request.url.endsWith("/nick")), false)
})

test("Discord client never retries nickname writes and suppresses sensitive failures", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return new Response(
        JSON.stringify({
          message: "Secret Nickname and private audit reason",
          retry_after: 0.001,
        }),
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
    () => client.modifyGuildMemberNickname(
      "100",
      "300",
      "Secret Nickname",
      "private audit reason",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.doesNotMatch(error.message, /Secret Nickname|private audit reason/u)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects mismatched or malformed nickname responses", async () => {
  const responses: unknown[] = [
    { nick: "Desired", user: { id: "999" } },
    { nick: 42, user: { id: "300" } },
    { nick: "\u0000", user: { id: "300" } },
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => Response.json(responses.shift()),
    token: TOKEN,
  })

  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(
      () => client.modifyGuildMemberNickname(
        "100",
        "300",
        "Desired",
        "reviewed",
      ),
      MemberNicknameEvidenceError,
    )
  }
})

test("Discord client validates exact nickname intent before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return Response.json({ nick: null, user: { id: "200" } })
    },
    token: TOKEN,
  })

  const invalidValues = [
    "",
    "x".repeat(33),
    " leading",
    "trailing ",
    "two  spaces",
    "line\nbreak",
    "zero\u200bwidth",
    "\ud800",
  ]
  for (const nickname of invalidValues) {
    await assert.rejects(
      () => client.modifyCurrentMemberNickname(
        "100",
        "200",
        nickname,
        "reviewed",
      ),
      /nickname/u,
    )
  }
  await assert.rejects(
    () => client.modifyCurrentMemberNickname("bad", "200", null, "reviewed"),
    /guild ID/u,
  )
  await assert.rejects(
    () => client.modifyCurrentMemberNickname("100", "bad", null, "reviewed"),
    /bot ID/u,
  )
  await assert.rejects(
    () => client.modifyGuildMemberNickname("100", "bad", null, "reviewed"),
    /user ID/u,
  )
  await assert.rejects(
    () => client.modifyCurrentMemberNickname("100", "200", null, "\ud800"),
    /invalid Unicode/u,
  )
  assert.equal(requests, 0)
})

test("Discord client counts nickname length by Unicode scalar values", async () => {
  let body = ""
  const nickname = "😀".repeat(32)
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      body = String(init?.body)
      return Response.json({ nick: nickname, user: { id: "200" } })
    },
    token: TOKEN,
  })

  const result = await client.modifyCurrentMemberNickname(
    "100",
    "200",
    nickname,
    "reviewed",
  )
  assert.equal(result.nickname, nickname)
  assert.equal(body, JSON.stringify({ nick: nickname }))
})
