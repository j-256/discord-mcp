import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import {
  DiscordApiError,
  GuildProfileEvidenceError,
} from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"
const ASSET_HASH = "0123456789abcdef0123456789abcdef"

function profile(overrides: Record<string, unknown> = {}) {
  return {
    banner: null,
    description: "Private profile text",
    discovery_splash: `a_${ASSET_HASH}`,
    icon: ASSET_HASH,
    id: "100",
    name: "Private Guild",
    owner_id: "200",
    splash: null,
    unrelated_secret: "must not escape",
    ...overrides,
  }
}

test("Discord client projects guild profiles without media hashes or unknown fields", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return Response.json(profile())
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.getGuildProfile("100"), {
    description: "Private profile text",
    id: "100",
    mediaPresence: {
      banner: false,
      discoverySplash: true,
      icon: true,
      inviteSplash: false,
    },
    name: "Private Guild",
    ownerId: "200",
  })
  assert.deepEqual(requests, [{
    method: "GET",
    url: `${API_BASE_URL}/guilds/100`,
  }])
})

test("Discord client sends one exact sparse non-retried guild profile patch", async () => {
  const requests: Array<{
    body: string | null
    method: string
    reason: string | null
    url: string
  }> = []
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: init?.body ? String(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return Response.json(profile({ description: null }))
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  const result = await client.modifyGuildProfile(
    "100",
    { description: null },
    "Review / case 42",
  )

  assert.equal(result.description, null)
  assert.deepEqual(requests, [{
    body: JSON.stringify({ description: null }),
    method: "PATCH",
    reason: "Review%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/100`,
  }])
  assert.equal(sleeps, 0)
})

test("Discord client validates exact guild profile intent before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return Response.json(profile())
    },
    token: TOKEN,
  })
  const invalidInputs = [
    {},
    { name: "x" },
    { name: "x".repeat(101) },
    { name: " leading" },
    { name: "trailing " },
    { name: "line\nbreak" },
    { name: "zero\u200bwidth" },
    { name: "\ud800x" },
    { description: "" },
    { description: "x".repeat(121) },
    { description: " trailing " },
    { description: "line\nbreak" },
    { description: "zero\u200bwidth" },
    { description: "\ud800" },
    { name: "Valid Guild", unsupported: true },
  ]

  for (const input of invalidInputs) {
    await assert.rejects(
      client.modifyGuildProfile(
        "100",
        input as { description?: string | null; name?: string },
        "Reviewed",
      ),
      RangeError,
    )
  }
  await assert.rejects(
    client.modifyGuildProfile("invalid", { name: "Valid Guild" }, "Reviewed"),
    RangeError,
  )
  assert.equal(requests, 0)
})

test("Discord client rejects malformed guild profile evidence", async () => {
  const responses: unknown[] = [
    profile({ id: "999" }),
    profile({ owner_id: "invalid" }),
    profile({ name: "x" }),
    profile({ description: 42 }),
    profile({ icon: "raw-media-secret" }),
    (({ banner: _banner, ...value }) => value)(profile()),
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => Response.json(responses.shift()),
    token: TOKEN,
  })

  for (let index = 0; index < 6; index += 1) {
    await assert.rejects(
      client.getGuildProfile("100"),
      GuildProfileEvidenceError,
    )
  }
})

test("Discord client does not retry or expose guild profile write failures", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return new Response(JSON.stringify({
        message: "Secret Guild Name and private reason",
        retry_after: 0.001,
      }), {
        headers: { "content-type": "application/json" },
        status: 429,
      })
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    client.modifyGuildProfile(
      "100",
      { name: "Secret Guild Name" },
      "private reason",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.doesNotMatch(error.message, /Secret Guild Name|private reason/u)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})
