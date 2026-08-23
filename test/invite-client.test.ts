import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import { DiscordApiError } from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"
const PRIVATE_CODE = "private/A?code"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}

function rawInvite(overrides: Record<string, unknown> = {}) {
  return {
    channel: { id: "200" },
    code: PRIVATE_CODE,
    created_at: "2026-08-21T12:00:00.000Z",
    expires_at: "2026-08-22T12:00:00.000Z",
    flags: 1,
    guild: { id: "100" },
    inviter: { id: "300", username: "private-profile" },
    max_age: 86_400,
    max_uses: 10,
    roles: [{ id: "400", name: "private-role" }],
    target_application: { id: "500", name: "private-application" },
    target_type: 2,
    target_user: null,
    temporary: false,
    type: 0,
    unknown_private_field: "private-unknown",
    uses: 2,
    ...overrides,
  }
}

test("Discord client projects a bounded guild invite inventory", async () => {
  const requests: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requests.push(String(input))
      return jsonResponse([rawInvite()])
    },
    token: TOKEN,
  })

  const invites = await client.listGuildInvites("100")

  assert.deepEqual(requests, [`${API_BASE_URL}/guilds/100/invites`])
  assert.deepEqual(invites, [{
    channelId: "200",
    code: PRIVATE_CODE,
    createdAt: "2026-08-21T12:00:00.000Z",
    expiresAt: "2026-08-22T12:00:00.000Z",
    flags: 1,
    guildId: "100",
    inviterUserId: "300",
    maxAge: 86_400,
    maxUses: 10,
    roleIds: ["400"],
    targetApplicationId: "500",
    targetType: 2,
    targetUserId: null,
    temporary: false,
    type: 0,
    unknownFieldCount: 1,
    uses: 2,
  }])
  assert.doesNotMatch(
    JSON.stringify(invites),
    /private-profile|private-role|private-application|private-target|private-unknown/,
  )
})

test("Discord client deletes an invite once with a secret-safe diagnostic route", async () => {
  const requests: Array<{
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        method: init?.method,
        reason: new Headers(init?.headers).get("x-audit-log-reason"),
        url: String(input),
      })
      return jsonResponse({
        channel: { id: "200" },
        code: PRIVATE_CODE,
        guild: { id: "100" },
        type: 0,
      })
    },
    token: TOKEN,
  })

  const deleted = await client.deleteInvite(PRIVATE_CODE, "Reviewed cleanup")

  assert.deepEqual(deleted, {
    channelId: "200",
    code: PRIVATE_CODE,
    guildId: "100",
    type: 0,
  })
  assert.deepEqual(requests, [{
    method: "DELETE",
    reason: "Reviewed%20cleanup",
    url: `${API_BASE_URL}/invites/private%2FA%3Fcode`,
  }])
})

test("Discord client never exposes an invite code through invite failures", async () => {
  const listClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(`failed inventory ${PRIVATE_CODE}`)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => listClient.listGuildInvites("100"),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, new RegExp(PRIVATE_CODE.replace(/[/?]/gu, "\\$&")))
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )

  const bodyClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      const response = new Response("[]")
      Object.defineProperty(response, "text", {
        value: async () => {
          throw new Error(`failed response body ${PRIVATE_CODE}`)
        },
      })
      return response
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => bodyClient.listGuildInvites("100"),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, new RegExp(PRIVATE_CODE.replace(/[/?]/gu, "\\$&")))
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )

  const networkClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      throw new Error(`failed ${String(input)} ${PRIVATE_CODE}`)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => networkClient.deleteInvite(PRIVATE_CODE, "Reviewed cleanup"),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, new RegExp(PRIVATE_CODE.replace(/[/?]/gu, "\\$&")))
      assert.doesNotMatch(error.message, /private%2FA%3Fcode/)
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )

  let requests = 0
  const apiClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: `rejected ${PRIVATE_CODE}` }, 429)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => apiClient.deleteInvite(PRIVATE_CODE, "Reviewed cleanup"),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.route, "/invites/{invite.code}")
      assert.doesNotMatch(error.message, /private/)
      return true
    },
  )
  assert.equal(requests, 1)
})

test("Discord client rejects malformed invite evidence and inputs", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([rawInvite({ max_uses: "ten" })])
    },
    token: TOKEN,
  })

  await assert.rejects(() => client.listGuildInvites("100"), /invalid guild invite inventory/)
  await assert.rejects(() => client.listGuildInvites("bad"), /invite-audit guild ID/)
  await assert.rejects(() => client.deleteInvite("", "Reviewed cleanup"), /code is invalid/)
  await assert.rejects(() => client.deleteInvite("..", "Reviewed cleanup"), /code is invalid/)
  assert.equal(requests, 1)

  for (const overrides of [
    { code: "." },
    { created_at: "2026" },
    { inviter: { id: "0" } },
    { max_age: 604_801 },
    { max_uses: 101 },
    { target_application: { id: "18446744073709551616" } },
  ]) {
    const malformedClient = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse([rawInvite(overrides)]),
      token: TOKEN,
    })
    await assert.rejects(
      () => malformedClient.listGuildInvites("100"),
      /invalid guild invite inventory/,
    )
  }
})
