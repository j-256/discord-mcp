import assert from "node:assert/strict"
import test from "node:test"

import { DISCORD_LIMITS } from "../src/constants.js"
import { DiscordClient } from "../src/discord-client.js"
import { DiscordApiError, IntegrationEvidenceError } from "../src/errors.js"

const API_BASE_URL = "https://discord.test/api/v10"
const TOKEN = "test-token-never-log"
const GUILD_ID = "100000000000000001"
const INTEGRATION_ID = "200000000000000001"
const APPLICATION_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const USER_ID = "500000000000000001"
const ROLE_ID = "600000000000000001"
const PRIVATE_TEXT = "private-integration-identity"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  })
}

function rawIntegration(overrides: Record<string, unknown> = {}) {
  return {
    account: {
      id: "private-external-account-id",
      name: "private-external-account-name",
      private_account_field: PRIVATE_TEXT,
    },
    application: {
      bot: {
        avatar: "private-bot-avatar",
        bot: true,
        id: BOT_ID,
        private_bot_field: PRIVATE_TEXT,
        username: "private-bot-name",
      },
      description: "private-application-description",
      icon: "private-application-icon",
      id: APPLICATION_ID,
      name: "private-application-name",
      private_application_field: PRIVATE_TEXT,
    },
    enable_emoticons: true,
    enabled: true,
    expire_behavior: 1,
    expire_grace_period: 7,
    id: INTEGRATION_ID,
    name: "private-integration-name",
    private_integration_field: PRIVATE_TEXT,
    revoked: false,
    role_id: ROLE_ID,
    scopes: [
      "identify",
      "applications.commands",
      "future.scope",
      "identify.premium",
      "activities.invites.write",
    ],
    subscriber_count: 12,
    synced_at: "2026-08-22T12:00:00.000Z",
    syncing: false,
    type: "discord",
    user: {
      avatar: "private-user-avatar",
      id: USER_ID,
      private_user_field: PRIVATE_TEXT,
      username: "private-user-name",
    },
    ...overrides,
  }
}

test("Discord client projects bounded guild integrations without private identities", async () => {
  const requests: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requests.push(String(input))
      return jsonResponse([rawIntegration()])
    },
    token: TOKEN,
  })

  const integrations = await client.listGuildIntegrations(GUILD_ID)

  assert.deepEqual(requests, [`${API_BASE_URL}/guilds/${GUILD_ID}/integrations`])
  assert.deepEqual(integrations, [{
    accountPresent: true,
    applicationId: APPLICATION_ID,
    associatedBotUserId: BOT_ID,
    enableEmoticons: true,
    enabled: true,
    expireBehavior: 1,
    expireGracePeriod: 7,
    id: INTEGRATION_ID,
    knownScopes: ["applications.commands", "identify", "identify.premium"],
    linkedUserPresent: true,
    revoked: false,
    roleId: ROLE_ID,
    subscriberCount: 12,
    syncedAt: "2026-08-22T12:00:00.000Z",
    syncing: false,
    type: "discord",
    unknownFieldCounts: {
      account: 1,
      application: 1,
      bot: 1,
      integration: 1,
      user: 1,
    },
    unknownScopeCount: 2,
  }])
  assert.doesNotMatch(
    JSON.stringify(integrations),
    /private|external-account|avatar|description|future\.scope|activities\.invites\.write/,
  )
})

test("Discord client normalizes integration types and optional evidence", async () => {
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([
      rawIntegration({
        application: null,
        enable_emoticons: undefined,
        expire_behavior: null,
        expire_grace_period: undefined,
        revoked: undefined,
        role_id: null,
        scopes: undefined,
        subscriber_count: null,
        synced_at: null,
        syncing: undefined,
        type: "Future_Service",
        user: null,
      }),
    ]),
    token: TOKEN,
  })

  const [integration] = await client.listGuildIntegrations(GUILD_ID)

  assert.deepEqual(integration, {
    accountPresent: true,
    applicationId: null,
    associatedBotUserId: null,
    enableEmoticons: null,
    enabled: true,
    expireBehavior: null,
    expireGracePeriod: null,
    id: INTEGRATION_ID,
    knownScopes: [],
    linkedUserPresent: false,
    revoked: null,
    roleId: null,
    subscriberCount: null,
    syncedAt: null,
    syncing: null,
    type: "unknown",
    unknownFieldCounts: {
      account: 1,
      application: 0,
      bot: 0,
      integration: 1,
      user: 0,
    },
    unknownScopeCount: 0,
  })
})

test("Discord client counts nested profile evidence without exposing it", async () => {
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([rawIntegration({
      application: {
        bot: {
          avatar_decoration_data: { asset: PRIVATE_TEXT, sku_id: "1" },
          bot: true,
          collectibles: { nameplate: { label: PRIVATE_TEXT } },
          id: BOT_ID,
          primary_guild: { identity_enabled: true },
          username: "private-bot-name",
        },
        description: "private-application-description",
        icon: null,
        id: APPLICATION_ID,
        name: "private-application-name",
      },
    })]),
    token: TOKEN,
  })

  const [integration] = await client.listGuildIntegrations(GUILD_ID)

  assert.equal(integration?.unknownFieldCounts.bot, 4)
  assert.doesNotMatch(JSON.stringify(integration), new RegExp(PRIVATE_TEXT))
})

test("Discord client deletes one exact guild integration without retrying", async () => {
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
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  await client.deleteGuildIntegration(
    GUILD_ID,
    INTEGRATION_ID,
    "Reviewed integration cleanup / case 42",
  )

  assert.deepEqual(requests, [{
    method: "DELETE",
    reason: "Reviewed%20integration%20cleanup%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/${GUILD_ID}/integrations/${INTEGRATION_ID}`,
  }])

  let rejectedRequests = 0
  const rejectedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      rejectedRequests += 1
      return jsonResponse({ message: PRIVATE_TEXT }, 429)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => rejectedClient.deleteGuildIntegration(
      GUILD_ID,
      INTEGRATION_ID,
      "Reviewed integration cleanup",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(
        error.route,
        "/guilds/{guild.id}/integrations/{integration.id}",
      )
      assert.doesNotMatch(error.message, /private/)
      return true
    },
  )
  assert.equal(rejectedRequests, 1)

  const unexpectedSuccessClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ status: "deleted" }),
    token: TOKEN,
  })
  await assert.rejects(
    () => unexpectedSuccessClient.deleteGuildIntegration(
      GUILD_ID,
      INTEGRATION_ID,
      "Reviewed integration cleanup",
    ),
    /unexpected success status/,
  )
})

test("Discord client rejects malformed and excessive integration evidence", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([rawIntegration({ enabled: "yes" })])
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.listGuildIntegrations(GUILD_ID),
    IntegrationEvidenceError,
  )
  await assert.rejects(
    () => client.listGuildIntegrations("invalid"),
    /integration guild ID/,
  )
  await assert.rejects(
    () => client.deleteGuildIntegration(GUILD_ID, "0", "Reviewed cleanup"),
    /integration ID/,
  )
  await assert.rejects(
    () => client.deleteGuildIntegration(GUILD_ID, INTEGRATION_ID, " "),
    /audit reason/,
  )
  assert.equal(requests, 1)

  for (const overrides of [
    { account: null },
    { id: "0" },
    { scopes: ["identify", "identify"] },
    { scopes: ["UPPERCASE"] },
    { synced_at: "not-a-time" },
    { synced_at: "2026" },
    { type: "x".repeat(129) },
    { user: { avatar_decoration_data: "invalid", id: USER_ID } },
    { application: { id: "0" } },
    {
      application: {
        bot: { bot: false, id: BOT_ID },
        description: "private-description",
        icon: null,
        id: APPLICATION_ID,
        name: "private-name",
      },
    },
    {
      application: {
        description: "private-description",
        id: APPLICATION_ID,
        name: "private-name",
      },
    },
    { user: { id: "0" } },
  ]) {
    const malformedClient = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse([rawIntegration(overrides)]),
      token: TOKEN,
    })
    await assert.rejects(
      () => malformedClient.listGuildIntegrations(GUILD_ID),
      IntegrationEvidenceError,
    )
  }

  const duplicateClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([
      rawIntegration(),
      rawIntegration(),
    ]),
    token: TOKEN,
  })
  await assert.rejects(
    () => duplicateClient.listGuildIntegrations(GUILD_ID),
    IntegrationEvidenceError,
  )

  const excessiveClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse(
      Array.from(
        { length: DISCORD_LIMITS.guildIntegrations + 1 },
        (_, index) => rawIntegration({ id: String(1_000 + index) }),
      ),
    ),
    token: TOKEN,
  })
  await assert.rejects(
    () => excessiveClient.listGuildIntegrations(GUILD_ID),
    IntegrationEvidenceError,
  )

  const unexpectedSuccessClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([rawIntegration()], 201),
    token: TOKEN,
  })
  await assert.rejects(
    () => unexpectedSuccessClient.listGuildIntegrations(GUILD_ID),
    /unexpected success status/,
  )
})

test("Discord client suppresses integration response content from failures", async () => {
  const listClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(`failed ${PRIVATE_TEXT}`)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => listClient.listGuildIntegrations(GUILD_ID),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, /private/)
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )
})
