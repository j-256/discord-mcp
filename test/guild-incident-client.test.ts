import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import {
  DiscordApiError,
  GuildIncidentEvidenceError,
} from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"
const GUILD_ID = "100"
const OWNER_ID = "200"
const DISABLE_UNTIL = "2026-08-25T12:00:00.000Z"

function guild(overrides: Record<string, unknown> = {}) {
  return {
    id: GUILD_ID,
    incidents_data: {
      dms_disabled_until: null,
      dm_spam_detected_at: null,
      invites_disabled_until: DISABLE_UNTIL,
      raid_detected_at: "2026-08-24T11:00:00.000Z",
    },
    name: "Private Guild",
    owner_id: OWNER_ID,
    ...overrides,
  }
}

function actions(overrides: Record<string, unknown> = {}) {
  return {
    dms_disabled_until: null,
    dm_spam_detected_at: null,
    invites_disabled_until: DISABLE_UNTIL,
    raid_detected_at: null,
    ...overrides,
  }
}

test("Discord client projects guild incident actions without detection timestamps", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return Response.json(guild())
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.getGuildIncidentActions(GUILD_ID), {
    directMessagesDisabledUntil: null,
    dmSpamDetected: false,
    guildId: GUILD_ID,
    invitesDisabledUntil: DISABLE_UNTIL,
    ownerId: OWNER_ID,
    raidDetected: true,
    sourceAvailable: true,
    unknownFieldCount: 0,
  })
  assert.deepEqual(requests, [{
    method: "GET",
    url: `${API_BASE_URL}/guilds/${GUILD_ID}`,
  }])
})

test("Discord client reports absent incident data without inventing state", async () => {
  const response: Record<string, unknown> = guild()
  delete response.incidents_data
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => Response.json(response),
    token: TOKEN,
  })
  const result = await client.getGuildIncidentActions(GUILD_ID)

  assert.equal(result.sourceAvailable, false)
  assert.equal(result.unknownFieldCount, 0)
})

test("Discord client sends one sparse non-retried incident-action PUT without an audit header", async () => {
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
      return Response.json(actions({ dms_disabled_until: DISABLE_UNTIL }))
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  const result = await client.modifyGuildIncidentActions(GUILD_ID, {
    directMessagesDisabledUntil: DISABLE_UNTIL,
    invitesDisabledUntil: null,
  })

  assert.equal(result.directMessagesDisabledUntil, DISABLE_UNTIL)
  assert.deepEqual(requests, [{
    body: JSON.stringify({
      dms_disabled_until: DISABLE_UNTIL,
      invites_disabled_until: null,
    }),
    method: "PUT",
    reason: null,
    url: `${API_BASE_URL}/guilds/${GUILD_ID}/incident-actions`,
  }])
  assert.equal(sleeps, 0)
})

test("Discord client validates exact incident-action intent before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return Response.json(actions())
    },
    token: TOKEN,
  })
  const invalidInputs = [
    {},
    { directMessagesDisabledUntil: "not-a-time" },
    { directMessagesDisabledUntil: "2026-02-30T12:00:00Z" },
    { directMessagesDisabledUntil: DISABLE_UNTIL, unsupported: true },
  ]

  for (const input of invalidInputs) {
    await assert.rejects(
      client.modifyGuildIncidentActions(GUILD_ID, input),
      RangeError,
    )
  }
  await assert.rejects(
    client.modifyGuildIncidentActions("invalid", { invitesDisabledUntil: null }),
    RangeError,
  )
  assert.equal(requests, 0)
})

test("Discord client rejects malformed or expanded incident evidence", async () => {
  const responses: unknown[] = [
    guild({ id: "999" }),
    guild({ owner_id: "invalid" }),
    guild({ incidents_data: { invites_disabled_until: null } }),
    guild({ incidents_data: { ...actions(), invites_disabled_until: "not-a-time" } }),
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => Response.json(responses.shift()),
    token: TOKEN,
  })

  for (let index = 0; index < 4; index += 1) {
    await assert.rejects(
      client.getGuildIncidentActions(GUILD_ID),
      GuildIncidentEvidenceError,
    )
  }

  const expanded = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => Response.json(guild({
      incidents_data: { ...actions(), future_sensitive_value: "secret" },
    })),
    token: TOKEN,
  })
  const projected = await expanded.getGuildIncidentActions(GUILD_ID)
  assert.equal(projected.unknownFieldCount, 1)
  assert.doesNotMatch(JSON.stringify(projected), /future_sensitive_value|secret/u)
})

test("Discord client does not retry or expose incident-action write failures", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return new Response(JSON.stringify({
        message: "Private incident details",
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
    client.modifyGuildIncidentActions(GUILD_ID, {
      invitesDisabledUntil: DISABLE_UNTIL,
    }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.doesNotMatch(error.message, /Private incident/u)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})
