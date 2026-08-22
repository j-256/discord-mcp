import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import { DiscordApiError } from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"
const GUILD_ID = "100000000000000001"
const CREATOR_ID = "200000000000000001"
const PRIVATE_CODE = "private/A?template"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}

function rawTemplate(overrides: Record<string, unknown> = {}) {
  return {
    code: PRIVATE_CODE,
    created_at: "2026-08-21T12:00:00.000Z",
    creator: {
      avatar: "private-avatar-hash",
      id: CREATOR_ID,
      username: "private-profile",
    },
    creator_id: CREATOR_ID,
    description: "",
    is_dirty: null,
    name: "Private template name",
    serialized_source_guild: {
      channels: [{
        id: 1,
        name: "private-channel",
        parent_id: null,
        permission_overwrites: [],
        position: 0,
        topic: "private-topic",
        type: 0,
      }],
      name: "Private guild snapshot",
      roles: [{
        color: 0,
        hoist: false,
        id: 0,
        mentionable: false,
        name: "@everyone",
        permissions: "0",
      }],
    },
    source_guild_id: GUILD_ID,
    unknown_private_field: "private-unknown",
    updated_at: "2026-08-22T12:00:00.000Z",
    usage_count: 7,
    ...overrides,
  }
}

test("Discord client projects a bounded Guild Template inventory with empty descriptions", async () => {
  const requests: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requests.push(String(input))
      return jsonResponse([rawTemplate()])
    },
    token: TOKEN,
  })

  const templates = await client.listGuildTemplates(GUILD_ID)

  assert.deepEqual(requests, [`${API_BASE_URL}/guilds/${GUILD_ID}/templates`])
  assert.deepEqual(templates, [{
    code: PRIVATE_CODE,
    createdAt: "2026-08-21T12:00:00.000Z",
    creatorId: CREATOR_ID,
    description: "",
    isDirty: null,
    name: "Private template name",
    serializedSourceGuild: rawTemplate().serialized_source_guild,
    sourceGuildId: GUILD_ID,
    unknownFieldCount: 1,
    updatedAt: "2026-08-22T12:00:00.000Z",
    usageCount: 7,
  }])
  assert.doesNotMatch(JSON.stringify(templates), /private-profile|private-avatar-hash|private-unknown/)
})

test("Discord client sends each Guild Template mutation once without an undocumented audit header", async () => {
  const requests: Array<{
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method,
        reason: new Headers(init?.headers).get("x-audit-log-reason"),
        url: String(input),
      })
      return jsonResponse(rawTemplate())
    },
    token: TOKEN,
  })

  await client.createGuildTemplate(GUILD_ID, { description: "", name: "Created" })
  await client.syncGuildTemplate(GUILD_ID, PRIVATE_CODE)
  await client.modifyGuildTemplate(GUILD_ID, PRIVATE_CODE, { description: null })
  await client.deleteGuildTemplate(GUILD_ID, PRIVATE_CODE)

  const capabilityUrl = `${API_BASE_URL}/guilds/${GUILD_ID}/templates/private%2FA%3Ftemplate`
  assert.deepEqual(requests, [
    {
      body: { description: "", name: "Created" },
      method: "POST",
      reason: null,
      url: `${API_BASE_URL}/guilds/${GUILD_ID}/templates`,
    },
    { body: null, method: "PUT", reason: null, url: capabilityUrl },
    { body: { description: null }, method: "PATCH", reason: null, url: capabilityUrl },
    { body: null, method: "DELETE", reason: null, url: capabilityUrl },
  ])
})

test("Discord client suppresses Guild Template capabilities and response content from failures", async () => {
  const networkClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      throw new Error(`failed ${String(input)} ${PRIVATE_CODE} private-topic`)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => networkClient.syncGuildTemplate(GUILD_ID, PRIVATE_CODE),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, /private\/A|private%2FA|private-topic/i)
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )

  let requests = 0
  const apiClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: `rejected ${PRIVATE_CODE} private-topic` }, 429)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => apiClient.deleteGuildTemplate(GUILD_ID, PRIVATE_CODE),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.route, "/guilds/{guild.id}/templates/{template.code}")
      assert.doesNotMatch(error.message, /private\/A|private%2FA|private-topic/i)
      return true
    },
  )
  assert.equal(requests, 1)
})

test("Discord client rejects malformed Guild Template evidence and inputs before mutation", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([rawTemplate({ usage_count: "seven" })])
    },
    token: TOKEN,
  })

  await assert.rejects(() => client.listGuildTemplates(GUILD_ID), /invalid guild-template evidence/)
  await assert.rejects(() => client.listGuildTemplates("bad"), /guild-template guild ID/)
  await assert.rejects(
    () => client.createGuildTemplate(GUILD_ID, { description: null, name: "" }),
    /invalid guild-template evidence/,
  )
  await assert.rejects(
    () => client.modifyGuildTemplate(GUILD_ID, PRIVATE_CODE, {}),
    /metadata fields are invalid/,
  )
  await assert.rejects(() => client.syncGuildTemplate(GUILD_ID, ".."), /invalid guild-template evidence/)
  assert.equal(requests, 1)

  for (const overrides of [
    { code: "." },
    { created_at: "2026" },
    { creator: null },
    { creator: { id: GUILD_ID } },
    { creator_id: "0" },
    { description: 42 },
    { is_dirty: "false" },
    { serialized_source_guild: [] },
    { source_guild_id: "18446744073709551616" },
  ]) {
    const malformedClient = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse([rawTemplate(overrides)]),
      token: TOKEN,
    })
    await assert.rejects(
      () => malformedClient.listGuildTemplates(GUILD_ID),
      /invalid guild-template evidence/,
    )
  }

  const duplicateClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([rawTemplate(), rawTemplate()]),
    token: TOKEN,
  })
  await assert.rejects(
    () => duplicateClient.listGuildTemplates(GUILD_ID),
    /invalid guild-template evidence/,
  )
})
