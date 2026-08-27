import assert from "node:assert/strict"
import test from "node:test"

import { DiscordClient } from "../src/discord-client.js"
import { DiscordApiError } from "../src/errors.js"
import { escapeRegularExpression } from "./regular-expression.js"

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
    roleIds: [],
    type: 0,
  })
  assert.deepEqual(requests, [{
    method: "DELETE",
    reason: "Reviewed%20cleanup",
    url: `${API_BASE_URL}/invites/private%2FA%3Fcode`,
  }])
})

test("Discord client creates one unique finite invite without automatic retry", async () => {
  const requests: Array<{
    authorization: string | null
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) as unknown,
        method: init?.method,
        reason: new Headers(init?.headers).get("x-audit-log-reason"),
        url: String(input),
      })
      return jsonResponse({
        channel: { id: "200" },
        code: PRIVATE_CODE,
        created_at: "2026-08-21T12:00:00.000Z",
        expires_at: "2026-08-21T13:00:00.000Z",
        flags: 0,
        guild: { id: "100" },
        inviter: { id: "300" },
        max_age: 3_600,
        max_uses: 2,
        roles: [],
        temporary: true,
        type: 0,
        uses: 0,
      })
    },
    token: TOKEN,
  })

  const created = await client.createChannelInvite(
    "200",
    {
      maxAgeSeconds: 3_600,
      maxUses: 2,
      roleIds: [],
      targetUserIds: null,
      temporaryMembership: true,
    },
    "Reviewed temporary access",
  )

  assert.equal(created.code, PRIVATE_CODE)
  assert.equal(created.unknownFieldCount, undefined)
  assert.deepEqual(requests, [{
    authorization: `Bot ${TOKEN}`,
    body: {
      max_age: 3_600,
      max_uses: 2,
      temporary: true,
      unique: true,
    },
    method: "POST",
    reason: "Reviewed%20temporary%20access",
    url: `${API_BASE_URL}/channels/200/invites`,
  }])
})

test("Discord client sends exact persistent invite roles in a JSON body", async () => {
  let body: unknown
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as unknown
      return jsonResponse({
        channel: { id: "200" },
        code: PRIVATE_CODE,
        created_at: "2026-08-21T12:00:00.000Z",
        expires_at: "2026-08-21T13:00:00.000Z",
        flags: 0,
        guild: { id: "100" },
        inviter: { id: "300" },
        max_age: 3_600,
        max_uses: 2,
        roles: [{ id: "400" }, { id: "401" }],
        temporary: false,
        type: 0,
        uses: 0,
      })
    },
    token: TOKEN,
  })

  const created = await client.createChannelInvite(
    "200",
    {
      maxAgeSeconds: 3_600,
      maxUses: 2,
      roleIds: ["400", "401"],
      targetUserIds: null,
      temporaryMembership: false,
    },
    "Reviewed persistent role access",
  )

  assert.deepEqual(body, {
    max_age: 3_600,
    max_uses: 2,
    role_ids: ["400", "401"],
    temporary: false,
    unique: true,
  })
  assert.deepEqual(created.roleIds, ["400", "401"])
})

test("Discord client creates exact-user invites from generated multipart data", async () => {
  const requests: Array<{
    authorization: string | null
    fileName: string
    fileText: string
    payload: unknown
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      assert.ok(init?.body instanceof FormData)
      const payload = init.body.get("payload_json")
      const file = init.body.get("target_users_file")
      assert.equal(typeof payload, "string")
      if (typeof payload !== "string") throw new Error("Missing multipart payload")
      assert.ok(file instanceof File)
      requests.push({
        authorization: new Headers(init.headers).get("authorization"),
        fileName: file.name,
        fileText: await file.text(),
        payload: JSON.parse(payload) as unknown,
        url: String(input),
      })
      return jsonResponse({
        channel: { id: "200" },
        code: PRIVATE_CODE,
        created_at: "2026-08-21T12:00:00.000Z",
        expires_at: "2026-08-21T13:00:00.000Z",
        flags: 0,
        guild: { id: "100" },
        inviter: { id: "300" },
        max_age: 3_600,
        max_uses: 2,
        roles: [{ id: "400" }, { id: "401" }],
        temporary: false,
        type: 0,
        uses: 0,
      })
    },
    token: TOKEN,
  })

  await client.createChannelInvite(
    "200",
    {
      maxAgeSeconds: 3_600,
      maxUses: 2,
      roleIds: ["400", "401"],
      targetUserIds: ["301", "302"],
      temporaryMembership: false,
    },
    "Reviewed exact-user access",
  )

  assert.deepEqual(requests, [{
    authorization: `Bot ${TOKEN}`,
    fileName: "target-users.csv",
    fileText: "user_id\n301\n302\n",
    payload: {
      max_age: 3_600,
      max_uses: 2,
      role_ids: ["400", "401"],
      temporary: false,
      unique: true,
    },
    url: `${API_BASE_URL}/channels/200/invites`,
  }])
})

test("Discord client projects exact target-user job and CSV evidence", async () => {
  const requests: Array<{
    accept: string | null
    authorization: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const headers = new Headers(init?.headers)
      requests.push({
        accept: headers.get("accept"),
        authorization: headers.get("authorization"),
        url: String(input),
      })
      if (String(input).endsWith("/job-status")) {
        return jsonResponse({
          completed_at: "2026-08-21T12:00:01.000Z",
          created_at: "2026-08-21T12:00:00.000Z",
          error_message: null,
          processed_users: 2,
          status: 2,
          total_users: 2,
        })
      }
      return new Response("user_id\r\n302\r\n301\r\n", {
        headers: { "content-type": "text/csv" },
      })
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.getInviteTargetUsersJobStatus(PRIVATE_CODE), {
    completedAt: "2026-08-21T12:00:01.000Z",
    createdAt: "2026-08-21T12:00:00.000Z",
    errorPresent: false,
    processedUsers: 2,
    status: 2,
    totalUsers: 2,
    unknownFieldCount: 0,
  })
  assert.deepEqual(await client.getInviteTargetUserIds(PRIVATE_CODE), ["301", "302"])
  assert.deepEqual(requests, [
    {
      accept: "application/json",
      authorization: `Bot ${TOKEN}`,
      url: `${API_BASE_URL}/invites/private%2FA%3Fcode/target-users/job-status`,
    },
    {
      accept: "text/csv",
      authorization: `Bot ${TOKEN}`,
      url: `${API_BASE_URL}/invites/private%2FA%3Fcode/target-users`,
    },
  ])
})

test("Discord client verifies an exact invite without sending bot authentication", async () => {
  const requests: Array<{ authorization: string | null; url: string }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        url: String(input),
      })
      return jsonResponse({
        channel: { id: "200" },
        code: PRIVATE_CODE,
        guild: { id: "100" },
        roles: [{ id: "401" }, { id: "400" }],
        type: 0,
      })
    },
    token: TOKEN,
  })

  const observed = await client.getInvite(PRIVATE_CODE)

  assert.deepEqual(observed, {
    channelId: "200",
    code: PRIVATE_CODE,
    guildId: "100",
    roleIds: ["400", "401"],
    type: 0,
  })
  assert.deepEqual(requests, [{
    authorization: null,
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
      assert.doesNotMatch(error.message, new RegExp(escapeRegularExpression(PRIVATE_CODE)))
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
      assert.doesNotMatch(error.message, new RegExp(escapeRegularExpression(PRIVATE_CODE)))
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
      assert.doesNotMatch(error.message, new RegExp(escapeRegularExpression(PRIVATE_CODE)))
      assert.doesNotMatch(error.message, /private%2FA%3Fcode/)
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )
  await assert.rejects(
    () => networkClient.getInvite(PRIVATE_CODE),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, new RegExp(escapeRegularExpression(PRIVATE_CODE)))
      assert.doesNotMatch(error.message, /private%2FA%3Fcode/)
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )
  for (const lookup of [
    () => networkClient.getInviteTargetUsersJobStatus(PRIVATE_CODE),
    () => networkClient.getInviteTargetUserIds(PRIVATE_CODE),
  ]) {
    await assert.rejects(
      lookup,
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, new RegExp(escapeRegularExpression(PRIVATE_CODE)))
        assert.doesNotMatch(error.message, /private%2FA%3Fcode/)
        assert.equal((error as Error & { cause?: unknown }).cause, undefined)
        return true
      },
    )
  }

  const targetUserErrorClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      message: `rejected ${PRIVATE_CODE}`,
    }, 403),
    token: TOKEN,
  })
  await assert.rejects(
    () => targetUserErrorClient.getInviteTargetUsersJobStatus(PRIVATE_CODE),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.route, "/invites/{invite.code}/target-users/job-status")
      assert.doesNotMatch(error.message, /private/)
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

  let creationRequests = 0
  const creationClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      creationRequests += 1
      return jsonResponse({ message: `rejected ${PRIVATE_CODE}`, retry_after: 0 }, 429)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => creationClient.createChannelInvite(
      "200",
      {
        maxAgeSeconds: 60,
        maxUses: 1,
        roleIds: [],
        targetUserIds: null,
        temporaryMembership: false,
      },
      "Reviewed access",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.route, "/channels/{channel.id}/invites")
      assert.doesNotMatch(error.message, /private/)
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )
  assert.equal(creationRequests, 1)
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
  await assert.rejects(() => client.getInvite(".."), /code is invalid/)
  await assert.rejects(
    () => client.createChannelInvite(
      "200",
      {
        maxAgeSeconds: 0,
        maxUses: 1,
        roleIds: [],
        targetUserIds: null,
        temporaryMembership: false,
      },
      "Reviewed access",
    ),
    /finite age/,
  )
  await assert.rejects(
    () => client.createChannelInvite(
      "200",
      {
        maxAgeSeconds: 60,
        maxUses: 0,
        roleIds: [],
        targetUserIds: null,
        temporaryMembership: false,
      },
      "Reviewed access",
    ),
    /finite age/,
  )
  await assert.rejects(
    () => client.createChannelInvite(
      "200",
      {
        maxAgeSeconds: 60,
        maxUses: 1,
        roleIds: [],
        targetUserIds: ["302", "301"],
        temporaryMembership: false,
      },
      "Reviewed access",
    ),
    /canonical acceptance/,
  )
  await assert.rejects(
    () => client.createChannelInvite(
      "200",
      {
        maxAgeSeconds: 60,
        maxUses: 1,
        roleIds: [],
        targetUserIds: ["0301"],
        temporaryMembership: false,
      },
      "Reviewed access",
    ),
    /canonical acceptance/,
  )
  await assert.rejects(
    () => client.createChannelInvite(
      "200",
      {
        maxAgeSeconds: 60,
        maxUses: 1,
        roleIds: [],
        targetUserIds: ["301", "301"],
        temporaryMembership: false,
      },
      "Reviewed access",
    ),
    /canonical acceptance/,
  )
  for (const roleIds of [
    ["401", "400"],
    ["0400"],
    ["400", "400"],
  ]) {
    await assert.rejects(
      () => client.createChannelInvite(
        "200",
        {
          maxAgeSeconds: 60,
          maxUses: 1,
          roleIds,
          targetUserIds: null,
          temporaryMembership: false,
        },
        "Reviewed access",
      ),
      /canonical role assignment/,
    )
  }
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

  for (const response of [
    jsonResponse({
      completed_at: null,
      created_at: "2026-08-21T12:00:00.000Z",
      error_message: null,
      processed_users: 2,
      status: 2,
      total_users: 1,
    }),
    jsonResponse({
      completed_at: null,
      created_at: "2026-08-21T12:00:00.000Z",
      error_message: null,
      processed_users: 0,
      status: 4,
      total_users: 1,
    }),
  ]) {
    const malformedClient = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => response.clone(),
      token: TOKEN,
    })
    await assert.rejects(
      () => malformedClient.getInviteTargetUsersJobStatus(PRIVATE_CODE),
      /invalid guild invite inventory/,
    )
  }

  for (const roles of [
    "not-an-array",
    [{ id: "400" }, { id: "400" }],
    [{ id: "0" }],
  ]) {
    const malformedClient = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse({
        channel: { id: "200" },
        code: PRIVATE_CODE,
        guild: { id: "100" },
        roles,
        type: 0,
      }),
      token: TOKEN,
    })
    await assert.rejects(
      () => malformedClient.getInvite(PRIVATE_CODE),
      /invalid guild invite inventory/,
    )
  }

  for (const csv of [
    "wrong\n301\n",
    "user_id\n",
    "user_id\n301\n301\n",
    "user_id\n0\n",
    "user_id\n0301\n",
  ]) {
    const malformedClient = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => new Response(csv),
      token: TOKEN,
    })
    await assert.rejects(
      () => malformedClient.getInviteTargetUserIds(PRIVATE_CODE),
      /invalid guild invite inventory/,
    )
  }

  const oversizedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(`user_id\n${"1".repeat(5_000)}\n`),
    token: TOKEN,
  })
  await assert.rejects(
    () => oversizedClient.getInviteTargetUserIds(PRIVATE_CODE),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /exceeded its local response bound/)
      assert.doesNotMatch(error.message, /private|%2F/)
      return true
    },
  )

  const failedJobClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      completed_at: null,
      created_at: "2026-08-21T12:00:00.000Z",
      error_message: "private target-user failure",
      processed_users: 1,
      status: 3,
      total_users: 2,
    }),
    token: TOKEN,
  })
  const failedJob = await failedJobClient.getInviteTargetUsersJobStatus(PRIVATE_CODE)
  assert.equal(failedJob.errorPresent, true)
  assert.doesNotMatch(JSON.stringify(failedJob), /private target-user failure/)
})
