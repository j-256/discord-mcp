import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_APPLICATION_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
} from "../src/constants.js"
import {
  type CreateForumPostInput,
  type CreateThreadFromMessageInput,
  type CreateThreadWithoutMessageInput,
  DiscordClient,
} from "../src/discord-client.js"
import {
  ApplicationActivityInstanceEvidenceError,
  ApplicationEmojiEvidenceError,
  ApplicationMonetizationEvidenceError,
  BotProfileEvidenceError,
  ChannelMetadataEvidenceError,
  DirectMessageEvidenceError,
  DiscordApiError,
  MemberVoiceEvidenceError,
  OnboardingEvidenceError,
  RoleConfigurationEvidenceError,
  StageInstanceEvidenceError,
  ThreadGovernanceEvidenceError,
  VoiceRegionEvidenceError,
  WelcomeScreenEvidenceError,
  WidgetSettingsEvidenceError,
} from "../src/errors.js"

function channelMetadataPayload(overrides: Record<string, unknown> = {}) {
  return {
    default_auto_archive_duration: 1_440,
    default_thread_rate_limit_per_user: 15,
    guild_id: "100",
    id: "200",
    name: "product-feedback",
    nsfw: false,
    parent_id: "300",
    permission_overwrites: [{
      allow: "1024",
      deny: "0",
      future_overwrite_field: "omitted",
      id: "400",
      type: 0,
    }],
    position: 4,
    rate_limit_per_user: 30,
    topic: "Share product feedback",
    type: 15,
    unknown_channel_field: "omitted",
    ...overrides,
  }
}

function threadStatePayload(overrides: Record<string, unknown> = {}) {
  return {
    future_thread_field: "discarded",
    guild_id: "100",
    id: "200",
    member: { flags: 0, user_id: "500" },
    member_count: 8,
    message_count: 12,
    name: "incident-review",
    owner_id: "400",
    parent_id: "300",
    rate_limit_per_user: 15,
    thread_metadata: {
      archive_timestamp: "2026-08-22T00:00:00.000Z",
      archived: false,
      auto_archive_duration: 1_440,
      create_timestamp: "2026-08-21T00:00:00.000Z",
      invitable: true,
      locked: false,
    },
    type: 12,
    ...overrides,
  }
}
import type {
  OperationCompletion,
  OperationalErrorCategory,
} from "../src/observability.js"

const TOKEN = "test-discord-token-value"
const API_BASE_URL = "https://discord.test/api/v10"
const BOT_PROFILE_BOT_ID = "100000000000000001"
const DIRECT_MESSAGE_CHANNEL_ID = "200"
const DIRECT_MESSAGE_ID = "300"
const DIRECT_MESSAGE_REPLY_ID = "301"
const DIRECT_MESSAGE_USER_ID = "400"

function directMessageUserPayload(overrides: Record<string, unknown> = {}) {
  return {
    future_user_field: "omitted",
    id: DIRECT_MESSAGE_USER_ID,
    username: "private-recipient",
    ...overrides,
  }
}

function directMessageChannelPayload(overrides: Record<string, unknown> = {}) {
  return {
    future_channel_field: "omitted",
    id: DIRECT_MESSAGE_CHANNEL_ID,
    recipients: [directMessageUserPayload()],
    type: DISCORD_CHANNEL_TYPES.dm,
    ...overrides,
  }
}

interface RecordedObservation {
  completions: OperationCompletion[]
  operation: string
  responses?: Array<{ sharedRateLimit: boolean; statusCode: number }>
  retries: number
  runs: number
}

function recordingObserver(records: RecordedObservation[]) {
  return {
    startDiscordRequest(operation: string) {
      const record: RecordedObservation = {
        completions: [],
        operation,
        retries: 0,
        runs: 0,
      }
      records.push(record)
      return {
        end(completion: OperationCompletion) {
          record.completions.push(completion)
        },
        response(response: { sharedRateLimit: boolean; statusCode: number }) {
          if ([401, 403, 429].includes(response.statusCode)) {
            const responses = record.responses || []
            responses.push(response)
            record.responses = responses
          }
        },
        retry() {
          record.retries += 1
        },
        async run<T>(callback: () => Promise<T>): Promise<T> {
          record.runs += 1
          return callback()
        },
      }
    },
  }
}

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
  assert.equal(requestUrl, `${API_BASE_URL}/applications/@me`)
  assert.equal(authorization, `Bot ${TOKEN}`)
  assert.equal(redirect, "error")
})

test("Discord client reads one exact bounded application Activity instance", async () => {
  const applicationId = "500000000000000001"
  const guildId = "600000000000000001"
  const channelId = "700000000000000001"
  const launchId = "800000000000000001"
  const userId = "900000000000000001"
  const instanceId = "i:opaque%instance"
  let requestUrl = ""
  let authorization = ""
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get("Authorization") || ""
      return jsonResponse({
        application_id: applicationId,
        future_private_field: `private ${TOKEN}`,
        instance_id: instanceId,
        launch_id: launchId,
        location: {
          channel_id: channelId,
          future_location_field: `private ${TOKEN}`,
          guild_id: guildId,
          id: `gc-${guildId}-${channelId}`,
          kind: "gc",
        },
        users: [userId],
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const result = await client.getApplicationActivityInstance(applicationId, instanceId)

  assert.equal(
    requestUrl,
    `${API_BASE_URL}/applications/${applicationId}/activity-instances/i%3Aopaque%25instance`,
  )
  assert.equal(authorization, `Bot ${TOKEN}`)
  assert.deepEqual(result, {
    applicationId,
    instanceId,
    launchId,
    location: {
      channelId,
      guildId,
      kind: "gc",
      unknownFieldCount: 1,
    },
    unknownFieldCount: 1,
    userIds: [userId],
  })
  assert.deepEqual(records.map((record) => record.operation), [
    "get_application_activity_instance",
  ])
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN, "u"))
})

test("Discord client rejects malformed and oversized Activity-instance evidence privately", async () => {
  const applicationId = "500000000000000001"
  const instanceId = "i-valid-instance"
  for (const response of [
    jsonResponse({
      application_id: applicationId,
      instance_id: instanceId,
      launch_id: "800000000000000001",
      location: {
        channel_id: "700000000000000001",
        guild_id: "600000000000000001",
        id: "gc-valid",
        kind: "gc",
      },
      users: ["not-a-user"],
    }),
    jsonResponse({ private: `${TOKEN}${"x".repeat(300_000)}` }),
  ]) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => response,
      token: TOKEN,
    })
    await assert.rejects(
      client.getApplicationActivityInstance(applicationId, instanceId),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, new RegExp(TOKEN, "u"))
        assert.ok(
          error instanceof ApplicationActivityInstanceEvidenceError
          || /exceeded its local response bound/u.test(error.message),
        )
        return true
      },
    )
  }
})

test("Discord client treats Activity-instance identifiers as content-sensitive failures", async () => {
  const applicationId = "500000000000000001"
  const instanceId = "private-instance-id"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(`private ${instanceId} ${TOKEN}`)
    },
    maxRetries: 0,
    token: TOKEN,
  })

  await assert.rejects(
    client.getApplicationActivityInstance(applicationId, instanceId),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, "Discord API GET /applications/{application.id}/activity-instances/{instance.id} failed: request failed")
      assert.doesNotMatch(error.message, new RegExp(instanceId, "u"))
      assert.doesNotMatch(error.message, new RegExp(TOKEN, "u"))
      return true
    },
  )
})

test("Discord client discovers the authenticated Gateway endpoint with bounded projection", async () => {
  let requestUrl = ""
  let authorization = ""
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get("Authorization") || ""
      return jsonResponse({
        future_field: `private ${TOKEN}`,
        session_start_limit: {
          future_limit_field: `private ${TOKEN}`,
          max_concurrency: 2,
          remaining: 8,
          reset_after: 4_000,
          total: 10,
        },
        shards: 1,
        url: "wss://gateway.discord.gg/",
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const result = await client.getGatewayBot()

  assert.equal(requestUrl, `${API_BASE_URL}/gateway/bot`)
  assert.equal(authorization, `Bot ${TOKEN}`)
  assert.deepEqual(result, {
    sessionStartLimit: {
      maxConcurrency: 2,
      remaining: 8,
      resetAfterMs: 4_000,
      total: 10,
    },
    shards: 1,
    url: "wss://gateway.discord.gg/?v=10&encoding=json",
  })
  assert.deepEqual(records.map((record) => record.operation), ["get_gateway_bot"])
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
})

test("Discord client rejects malformed and oversized Gateway discovery without raw evidence", async () => {
  for (const payload of [
    { private: TOKEN, url: `wss://${TOKEN}@gateway.discord.gg/` },
    { future: "x".repeat(20_000) },
  ]) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(payload),
      token: TOKEN,
    })
    await assert.rejects(
      () => client.getGatewayBot(),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, new RegExp(TOKEN))
        assert.match(
          error.message,
          /Gateway Bot discovery response is invalid|exceeded its local response bound/,
        )
        return true
      },
    )
  }
})

test("Discord client resolves one exact Gateway channel route with minimal evidence", async () => {
  const channelId = "300000000000000001"
  const guildId = "200000000000000001"
  let requestUrl = ""
  let authorization = ""
  let redirect: RequestInit["redirect"]
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get("Authorization") || ""
      redirect = init?.redirect
      return jsonResponse({
        guild_id: guildId,
        id: channelId,
        name: `private ${TOKEN}`,
        permission_overwrites: [{ private: TOKEN }],
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const result = await client.getGatewayChannelRoute(channelId)

  assert.equal(requestUrl, `${API_BASE_URL}/channels/${channelId}`)
  assert.equal(authorization, `Bot ${TOKEN}`)
  assert.equal(redirect, "error")
  assert.deepEqual(result, { channelId, guildId })
  assert.deepEqual(records.map((record) => record.operation), [
    "get_gateway_channel_route",
  ])
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
})

test("Discord client fails closed on unsafe Gateway channel-route evidence", async () => {
  const channelId = "300000000000000001"
  for (const payload of [
    { id: channelId, private: TOKEN },
    { guild_id: "200000000000000001", id: "300000000000000002" },
    { future: "x".repeat(20_000) },
  ]) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(payload),
      token: TOKEN,
    })
    await assert.rejects(
      () => client.getGatewayChannelRoute(channelId),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, new RegExp(TOKEN))
        assert.match(
          error.message,
          /Gateway topology evidence is invalid|exceeded its local response bound/,
        )
        return true
      },
    )
  }
})

test("Discord client rejects an invalid Gateway route ID before transport", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.getGatewayChannelRoute("0"),
    /positive Discord snowflake/,
  )
  assert.equal(requests, 0)
})

test("Discord client forwards Gateway route cancellation without retaining its cause", async () => {
  const channelId = "300000000000000001"
  let requestSignal: AbortSignal | undefined
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      requestSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => {
          reject(new Error(`private ${TOKEN}`))
        }, { once: true })
      })
    },
    token: TOKEN,
  })
  const controller = new AbortController()
  const request = client.getGatewayChannelRoute(channelId, { signal: controller.signal })
  await new Promise<void>((resolve) => setImmediate(resolve))
  controller.abort()

  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.doesNotMatch(error.message, new RegExp(TOKEN))
    assert.equal(error.cause, undefined)
    assert.equal(
      (error as { operationalCategory?: unknown }).operationalCategory,
      "cancelled",
    )
    return true
  })
  assert.equal(requestSignal?.aborted, true)
})

test("Discord client sends one exact non-retried current-application flag PATCH", async () => {
  const requests: Array<{
    authorization: string | null
    body: string | null
    method: string | undefined
    url: string
  }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        body: String(init?.body ?? ""),
        method: init?.method,
        url: String(input),
      })
      return jsonResponse({ message: "rate limited", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await assert.rejects(
    () => client.modifyCurrentApplicationFlags({ flags: 557_056 }),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
    ),
  )
  assert.deepEqual(requests, [{
    authorization: `Bot ${TOKEN}`,
    body: JSON.stringify({ flags: 557_056 }),
    method: "PATCH",
    url: `${API_BASE_URL}/applications/@me`,
  }])
  assert.deepEqual(records, [{
    completions: [{ errorCategory: "discord-rate-limited", outcome: "error", statusCode: 429 }],
    operation: "modify_current_application_flags",
    responses: [{ sharedRateLimit: false, statusCode: 429 }],
    retries: 0,
    runs: 1,
  }])

  assert.throws(
    () => client.modifyCurrentApplicationFlags({ flags: -1 }),
    /flags input is invalid/,
  )
  assert.throws(
    () => client.modifyCurrentApplicationFlags({ flags: 0 }),
    /flags input is invalid/,
  )
  assert.throws(
    () => client.modifyCurrentApplicationFlags({
      flags: Number(DISCORD_APPLICATION_FLAGS.gatewayPresence),
    }),
    /flags input is invalid/,
  )
  assert.throws(
    () => client.modifyCurrentApplicationFlags({
      flags: 1,
      name: "not allowed",
    } as unknown as { flags: number }),
    /flags input is invalid/,
  )
  assert.equal(requests.length, 1)
})

test("Discord client projects the pinned bot profile and sends one sparse image-data PATCH", async () => {
  const requests: Array<{
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const avatar = roleIconPng()
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const method = init?.method
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      if (method === "PATCH") {
        return jsonResponse({
          avatar: "b".repeat(32),
          banner: null,
          bot: true,
          future_profile_field: `private ${TOKEN}`,
          id: BOT_PROFILE_BOT_ID,
          username: "reviewed-bot",
        })
      }
      return jsonResponse({
        avatar: "a_" + "a".repeat(32),
        banner: null,
        bot: true,
        future_profile_field: `private ${TOKEN}`,
        id: BOT_PROFILE_BOT_ID,
        username: "current-bot",
      })
    },
    token: TOKEN,
  })

  assert.deepEqual(
    await client.getCurrentBotProfile(BOT_PROFILE_BOT_ID),
    {
      avatarHash: "a_" + "a".repeat(32),
      bannerHash: null,
      bot: true,
      id: BOT_PROFILE_BOT_ID,
      unknownFieldCount: 1,
      username: "current-bot",
    },
  )
  assert.deepEqual(
    await client.modifyCurrentBotProfile(BOT_PROFILE_BOT_ID, {
      avatar: { bytes: avatar, format: "png", kind: "image" },
      banner: { kind: "clear" },
      username: "reviewed-bot",
    }),
    {
      avatarHash: "b".repeat(32),
      bannerHash: null,
      bot: true,
      id: BOT_PROFILE_BOT_ID,
      unknownFieldCount: 1,
      username: "reviewed-bot",
    },
  )

  assert.deepEqual(requests, [
    {
      body: null,
      method: "GET",
      reason: null,
      url: `${API_BASE_URL}/users/@me`,
    },
    {
      body: {
        avatar: `data:image/png;base64,${Buffer.from(avatar).toString("base64")}`,
        banner: null,
        username: "reviewed-bot",
      },
      method: "PATCH",
      reason: null,
      url: `${API_BASE_URL}/users/@me`,
    },
  ])
  assert.doesNotMatch(JSON.stringify(await client.getCurrentBotProfile(
    BOT_PROFILE_BOT_ID,
  )), new RegExp(TOKEN, "u"))
})

test("Discord client rejects unsafe bot-profile inputs and mismatched identity before ambiguity", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      if (requests === 2) {
        return jsonResponse({
          avatar: null,
          bot: true,
          id: BOT_PROFILE_BOT_ID,
          username: "current-bot",
        })
      }
      return jsonResponse({
        avatar: null,
        banner: null,
        bot: true,
        id: "100000000000000002",
        username: "another-bot",
      })
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.getCurrentBotProfile(BOT_PROFILE_BOT_ID),
    BotProfileEvidenceError,
  )
  await assert.rejects(
    () => client.getCurrentBotProfile(BOT_PROFILE_BOT_ID),
    BotProfileEvidenceError,
  )
  await assert.rejects(
    () => client.modifyCurrentBotProfile(BOT_PROFILE_BOT_ID, {
      username: "Discord helper",
    }),
    /Discord username restrictions/u,
  )
  await assert.rejects(
    () => client.modifyCurrentBotProfile(BOT_PROFILE_BOT_ID, {
      username: "valid-bot",
      unexpected: true,
    } as never),
    /supported explicit fields/u,
  )
  await assert.rejects(
    () => client.modifyCurrentBotProfile(BOT_PROFILE_BOT_ID, {
      avatar: {
        bytes: roleIconPng(),
        format: "jpeg",
        kind: "image",
      },
    }),
    /format does not match/u,
  )
  assert.equal(requests, 2)
})

test("Discord client never retries a current bot-profile mutation", async () => {
  const records: RecordedObservation[] = []
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await assert.rejects(
    () => client.modifyCurrentBotProfile(BOT_PROFILE_BOT_ID, {
      username: "reviewed-bot",
    }),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 1)
  assert.deepEqual(records, [{
    completions: [{ errorCategory: "discord-rate-limited", outcome: "error", statusCode: 429 }],
    operation: "modify_current_bot_profile",
    responses: [{ sharedRateLimit: false, statusCode: 429 }],
    retries: 0,
    runs: 1,
  }])
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

test("Discord client projects exact private users and one-to-one channels without profiles", async () => {
  const requests: Array<{
    body: string | null
    method: string | undefined
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const url = String(input)
      requests.push({
        body: init?.body === undefined ? null : String(init.body),
        method: init?.method,
        url,
      })
      if (url.endsWith(`/users/${DIRECT_MESSAGE_USER_ID}`)) {
        return jsonResponse(directMessageUserPayload())
      }
      return jsonResponse(directMessageChannelPayload())
    },
    token: TOKEN,
  })

  const user = await client.getDirectMessageUser(DIRECT_MESSAGE_USER_ID)
  const channel = await client.getDirectMessageChannel(
    DIRECT_MESSAGE_CHANNEL_ID,
    DIRECT_MESSAGE_USER_ID,
  )
  const created = await client.createDirectMessageChannel(DIRECT_MESSAGE_USER_ID)

  assert.deepEqual(user, {
    bot: false,
    id: DIRECT_MESSAGE_USER_ID,
    system: false,
    unknownFieldCount: 1,
  })
  assert.deepEqual(channel, {
    id: DIRECT_MESSAGE_CHANNEL_ID,
    recipient: user,
    type: DISCORD_CHANNEL_TYPES.dm,
    unknownFieldCount: 1,
  })
  assert.deepEqual(created, channel)
  assert.deepEqual(requests, [{
    body: null,
    method: "GET",
    url: `${API_BASE_URL}/users/${DIRECT_MESSAGE_USER_ID}`,
  }, {
    body: null,
    method: "GET",
    url: `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}`,
  }, {
    body: JSON.stringify({ recipient_id: DIRECT_MESSAGE_USER_ID }),
    method: "POST",
    url: `${API_BASE_URL}/users/@me/channels`,
  }])
  assert.doesNotMatch(JSON.stringify({ channel, created, user }), /private-recipient/)
})

test("Discord client rejects malformed, guild, and group private-channel evidence", async () => {
  for (const response of [
    directMessageChannelPayload({ guild_id: "100" }),
    directMessageChannelPayload({
      recipients: [
        directMessageUserPayload(),
        directMessageUserPayload({ id: "401" }),
      ],
    }),
    directMessageChannelPayload({ type: DISCORD_CHANNEL_TYPES.groupDm }),
    directMessageChannelPayload({ id: "201" }),
  ]) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(response),
      token: TOKEN,
    })
    await assert.rejects(
      () => client.getDirectMessageChannel(
        DIRECT_MESSAGE_CHANNEL_ID,
        DIRECT_MESSAGE_USER_ID,
      ),
      DirectMessageEvidenceError,
    )
  }

  const invalidUser = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      id: DIRECT_MESSAGE_USER_ID,
    }),
    token: TOKEN,
  })
  await assert.rejects(
    () => invalidUser.getDirectMessageUser(DIRECT_MESSAGE_USER_ID),
    DirectMessageEvidenceError,
  )
})

test("Discord client uses only exact bounded private-message read routes", async () => {
  const urls: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      urls.push(String(input))
      return String(input).includes(`/${DIRECT_MESSAGE_ID}`)
        ? jsonResponse({ id: DIRECT_MESSAGE_ID })
        : jsonResponse([])
    },
    token: TOKEN,
  })

  await client.listDirectMessages(DIRECT_MESSAGE_CHANNEL_ID, {
    before: DIRECT_MESSAGE_ID,
    limit: 25,
  })
  await client.getDirectMessage(
    DIRECT_MESSAGE_CHANNEL_ID,
    DIRECT_MESSAGE_ID,
  )

  assert.deepEqual(urls, [
    `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}/messages?before=${DIRECT_MESSAGE_ID}&limit=25`,
    `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}/messages/${DIRECT_MESSAGE_ID}`,
  ])
  assert.throws(
    () => client.listDirectMessages(DIRECT_MESSAGE_CHANNEL_ID, {
      after: DIRECT_MESSAGE_ID,
      limit: 25,
    }),
    /supports only an exact before cursor/,
  )
  assert.throws(
    () => client.listDirectMessages(DIRECT_MESSAGE_CHANNEL_ID, {
      around: DIRECT_MESSAGE_ID,
      limit: 25,
    }),
    /supports only an exact before cursor/,
  )
})

test("Discord client suppresses private-message mentions and never retries mutations", async () => {
  const requests: Array<{
    auditReason: string | null
    body: string | null
    method: string | undefined
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        auditReason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        body: init?.body === undefined ? null : String(init.body),
        method: init?.method,
        url: String(input),
      })
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse({ id: DIRECT_MESSAGE_ID })
    },
    token: TOKEN,
  })

  await client.createDirectMessage(DIRECT_MESSAGE_CHANNEL_ID, {
    content: `Hello <@${DIRECT_MESSAGE_USER_ID}>`,
    nonce: "direct-message-nonce",
    replyToMessageId: DIRECT_MESSAGE_REPLY_ID,
  })
  await client.editDirectMessage(
    DIRECT_MESSAGE_CHANNEL_ID,
    DIRECT_MESSAGE_ID,
    "Edited @everyone",
  )
  await client.deleteDirectMessage(
    DIRECT_MESSAGE_CHANNEL_ID,
    DIRECT_MESSAGE_ID,
  )

  assert.deepEqual(requests, [{
    auditReason: null,
    body: JSON.stringify({
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
      content: `Hello <@${DIRECT_MESSAGE_USER_ID}>`,
      enforce_nonce: true,
      message_reference: {
        channel_id: DIRECT_MESSAGE_CHANNEL_ID,
        fail_if_not_exists: true,
        message_id: DIRECT_MESSAGE_REPLY_ID,
        type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
      },
      nonce: "direct-message-nonce",
    }),
    method: "POST",
    url: `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}/messages`,
  }, {
    auditReason: null,
    body: JSON.stringify({
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
      content: "Edited @everyone",
    }),
    method: "PATCH",
    url: `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}/messages/${DIRECT_MESSAGE_ID}`,
  }, {
    auditReason: null,
    body: null,
    method: "DELETE",
    url: `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}/messages/${DIRECT_MESSAGE_ID}`,
  }])

  let attempts = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      attempts += 1
      return jsonResponse({ message: "rate limited", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  for (const mutation of [
    () => rateLimited.createDirectMessageChannel(DIRECT_MESSAGE_USER_ID),
    () => rateLimited.createDirectMessage(DIRECT_MESSAGE_CHANNEL_ID, {
      content: "One shot",
      nonce: "direct-message-nonce",
    }),
    () => rateLimited.createDirectComponentMessage(DIRECT_MESSAGE_CHANNEL_ID, {
      components: [{ content: "One shot component", type: 10 }],
      nonce: "component-nonce",
    }),
    () => rateLimited.createDirectAttachmentMessage(DIRECT_MESSAGE_CHANNEL_ID, {
      bytes: new Uint8Array([1]),
      filename: "private.bin",
      nonce: "attachment-nonce",
    }),
    () => rateLimited.editDirectMessage(
      DIRECT_MESSAGE_CHANNEL_ID,
      DIRECT_MESSAGE_ID,
      "One shot edit",
    ),
    () => rateLimited.editDirectComponentMessage(
      DIRECT_MESSAGE_CHANNEL_ID,
      DIRECT_MESSAGE_ID,
      {
        components: [{ content: "One shot component edit", type: 10 }],
        flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
      },
    ),
    () => rateLimited.deleteDirectMessage(
      DIRECT_MESSAGE_CHANNEL_ID,
      DIRECT_MESSAGE_ID,
    ),
  ]) {
    await assert.rejects(mutation, DiscordApiError)
  }
  assert.equal(attempts, 7)
})

test("Discord client sends exact private static Components V2 contracts", async () => {
  const requests: Array<{
    body: Record<string, unknown>
    method: string | undefined
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        method: init?.method,
        url: String(input),
      })
      return jsonResponse({ id: DIRECT_MESSAGE_ID })
    },
    token: TOKEN,
  })
  const components = [{ content: "Private static layout", type: 10 as const }]

  await client.createDirectComponentMessage(DIRECT_MESSAGE_CHANNEL_ID, {
    components,
    nonce: "component-nonce",
    replyToMessageId: DIRECT_MESSAGE_REPLY_ID,
  })
  await client.editDirectComponentMessage(
    DIRECT_MESSAGE_CHANNEL_ID,
    DIRECT_MESSAGE_ID,
    { components, flags: DISCORD_MESSAGE_FLAGS.isComponentsV2 },
  )

  assert.deepEqual(requests, [{
    body: {
      allowed_mentions: { parse: [], replied_user: false },
      components,
      enforce_nonce: true,
      flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
      message_reference: {
        channel_id: DIRECT_MESSAGE_CHANNEL_ID,
        fail_if_not_exists: true,
        message_id: DIRECT_MESSAGE_REPLY_ID,
        type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
      },
      nonce: "component-nonce",
    },
    method: "POST",
    url: `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}/messages`,
  }, {
    body: {
      allowed_mentions: { parse: [], replied_user: false },
      components,
      flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
    },
    method: "PATCH",
    url: `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}/messages/${DIRECT_MESSAGE_ID}`,
  }])

  assert.throws(
    () => client.editDirectComponentMessage(
      DIRECT_MESSAGE_CHANNEL_ID,
      DIRECT_MESSAGE_ID,
      { components, flags: 0 } as unknown as Parameters<
        DiscordClient["editDirectComponentMessage"]
      >[2],
    ),
    /preserve the exact IS_COMPONENTS_V2 flag/,
  )
  assert.equal(requests.length, 2)
})

test("Discord client sends one exact private attachment without retry or URL fields", async () => {
  let capturedBody: FormData | null = null
  let capturedMethod: string | undefined
  let capturedUrl = ""
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      capturedBody = init?.body as FormData
      capturedMethod = init?.method
      capturedUrl = String(input)
      return jsonResponse({ id: DIRECT_MESSAGE_ID })
    },
    token: TOKEN,
  })

  await client.createDirectAttachmentMessage(DIRECT_MESSAGE_CHANNEL_ID, {
    bytes: new Uint8Array([1, 2, 3, 4]),
    content: "Requested report attached",
    description: "Reviewed report",
    filename: "private-report.bin",
    nonce: "private-attachment-nonce",
    replyToMessageId: DIRECT_MESSAGE_REPLY_ID,
  })

  assert.equal(capturedMethod, "POST")
  assert.equal(
    capturedUrl,
    `${API_BASE_URL}/channels/${DIRECT_MESSAGE_CHANNEL_ID}/messages`,
  )
  const body = capturedBody as unknown as FormData
  assert.ok(body instanceof FormData)
  const payloadValue = body.get("payload_json")
  assert.equal(typeof payloadValue, "string")
  assert.deepEqual(JSON.parse(payloadValue as string), {
    allowed_mentions: { parse: [], replied_user: false },
    attachments: [{
      description: "Reviewed report",
      filename: "private-report.bin",
      id: "0",
    }],
    content: "Requested report attached",
    enforce_nonce: true,
    message_reference: {
      channel_id: DIRECT_MESSAGE_CHANNEL_ID,
      fail_if_not_exists: true,
      message_id: DIRECT_MESSAGE_REPLY_ID,
      type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
    },
    nonce: "private-attachment-nonce",
  })
  const file = body.get("files[0]")
  assert.ok(file instanceof Blob)
  assert.equal(file.size, 4)
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([1, 2, 3, 4]))
  assert.doesNotMatch(
    JSON.stringify(JSON.parse(payloadValue as string)),
    /guild_id|https?:|url|base64/i,
  )

  let attempts = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      attempts += 1
      return jsonResponse({ message: "rate limited", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.createDirectAttachmentMessage(DIRECT_MESSAGE_CHANNEL_ID, {
      bytes: new Uint8Array([1]),
      filename: "private.bin",
      nonce: "attachment-nonce",
    }),
    DiscordApiError,
  )
  assert.equal(attempts, 1)

  const privateMarker = "private-filename-must-not-escape"
  const refused = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ message: privateMarker }, 400),
    token: TOKEN,
  })
  await assert.rejects(
    refused.createDirectAttachmentMessage(DIRECT_MESSAGE_CHANNEL_ID, {
      bytes: new Uint8Array([1]),
      filename: "private.bin",
      nonce: "attachment-nonce",
    }),
    (error: unknown) => (
      error instanceof DiscordApiError
      && !error.message.includes(privateMarker)
      && /request failed/.test(error.message)
    ),
  )

  for (const input of [
    {
      bytes: new Uint8Array(),
      filename: "private.bin",
      nonce: "attachment-nonce",
    },
    {
      bytes: new Uint8Array([1]),
      filename: "../private.bin",
      nonce: "attachment-nonce",
    },
    {
      bytes: new Uint8Array([1]),
      description: " ",
      filename: "private.bin",
      nonce: "attachment-nonce",
    },
    {
      bytes: new Uint8Array([1]),
      filename: "private.bin",
      nonce: "",
    },
  ]) {
    assert.throws(
      () => client.createDirectAttachmentMessage(
        DIRECT_MESSAGE_CHANNEL_ID,
        input,
      ),
      RangeError,
    )
  }
})

test("Discord client uses the current paginated message pin route", async () => {
  let requestUrl = ""
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requestUrl = String(input)
      return jsonResponse({ has_more: false, items: [] })
    },
    token: TOKEN,
  })

  await client.listMessagePins("200", {
    before: "2026-08-20T12:34:56.000Z",
    limit: 25,
  })

  assert.equal(
    requestUrl,
    `${API_BASE_URL}/channels/200/messages/pins?before=2026-08-20T12%3A34%3A56.000Z&limit=25`,
  )
})

test("Discord client validates message pin pagination before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ has_more: false, items: [] })
    },
    token: TOKEN,
  })

  assert.throws(() => client.listMessagePins("invalid"), /channel ID/)
  assert.throws(() => client.listMessagePins("200", { limit: 51 }), /between 1 and 50/)
  assert.throws(
    () => client.listMessagePins("200", { before: "yesterday" }),
    /ISO 8601 timestamp/,
  )
  assert.equal(requests, 0)
})

test("Discord client encodes bounded guild audit-log filters and cursors", async () => {
  let requestUrl = ""
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requestUrl = String(input)
      return jsonResponse({ audit_log_entries: [] })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await client.getGuildAuditLog("100", {
    actionType: 22,
    actorUserId: "200",
    before: "300",
    limit: 51,
  })

  const url = new URL(requestUrl)
  assert.equal(url.pathname, "/api/v10/guilds/100/audit-logs")
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    action_type: "22",
    before: "300",
    limit: "51",
    user_id: "200",
  })
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "get_guild_audit_log",
    retries: 0,
    runs: 1,
  }])
  assert.equal(JSON.stringify(records).includes("100"), false)
})

test("Discord client uses documented bounded member-directory routes", async () => {
  const requests: Array<{ method: string | undefined; url: string }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method, url: String(input) })
      return jsonResponse([])
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await client.listGuildMembers("100", { after: "200", limit: 25 })
  await client.searchGuildMembers("100", { limit: 10, query: "alpha beta" })

  assert.deepEqual(requests, [
    {
      method: "GET",
      url: `${API_BASE_URL}/guilds/100/members?after=200&limit=25`,
    },
    {
      method: "GET",
      url: `${API_BASE_URL}/guilds/100/members/search?limit=10&query=alpha+beta`,
    },
  ])
  assert.deepEqual(records.map(({ operation }) => operation), [
    "list_guild_members",
    "search_guild_members",
  ])
})

test("Discord client validates member-directory requests before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([])
    },
    token: TOKEN,
  })

  assert.throws(() => client.getGuildMember("invalid", "200"), /guild ID/)
  assert.throws(() => client.getGuildMember("100", "0"), /user ID/)
  assert.throws(() => client.listGuildMembers("100", { after: "0" }), /after cursor/)
  assert.throws(() => client.listGuildMembers("100", { limit: 101 }), /between 1 and 100/)
  assert.throws(
    () => client.searchGuildMembers("100", { query: "x" }),
    /2-100/,
  )
  assert.throws(
    () => client.searchGuildMembers("100", { query: " alpha " }),
    /trimmed characters/,
  )
  assert.throws(
    () => client.searchGuildMembers("100", { query: "alpha\n" }),
    /trimmed characters/,
  )
  assert.throws(
    () => client.searchGuildMembers("100", { limit: 26, query: "alpha" }),
    /between 1 and 25/,
  )
  assert.equal(requests, 0)
})

test("Discord client keeps member and message search queries out of failures", async () => {
  const privateQuery = "private-member-query"
  const apiClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      message: `Rejected ${privateQuery}`,
    }, 400),
    token: TOKEN,
  })
  await assert.rejects(
    () => apiClient.searchGuildMembers("100", { query: privateQuery }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.route, "/guilds/100/members/search")
      assert.doesNotMatch(error.message, new RegExp(privateQuery))
      assert.doesNotMatch(error.route, /\?/)
      return true
    },
  )

  const networkClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(`Failed URL containing ${privateQuery}`)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => networkClient.searchGuildMessages("100", { content: privateQuery }),
    (error: unknown) => {
      assert.doesNotMatch(String(error), new RegExp(privateQuery))
      assert.doesNotMatch(String(error), /\?/)
      assert.equal((error as Error & { cause?: unknown }).cause, undefined)
      return true
    },
  )
})

test("Discord client rejects invalid guild audit-log inputs before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ audit_log_entries: [] })
    },
    token: TOKEN,
  })

  assert.throws(() => client.getGuildAuditLog("invalid"), /guild ID/)
  assert.throws(
    () => client.getGuildAuditLog("18446744073709551616"),
    /guild ID/,
  )
  assert.throws(
    () => client.getGuildAuditLog("100", { actorUserId: "invalid" }),
    /actor user ID/,
  )
  assert.throws(
    () => client.getGuildAuditLog("100", { after: "200", before: "300" }),
    /mutually exclusive/,
  )
  assert.throws(
    () => client.getGuildAuditLog("100", { limit: 101 }),
    /between 1 and 100/,
  )
  assert.throws(
    () => client.getGuildAuditLog("100", { actionType: 0 }),
    /positive safe integer/,
  )
  assert.equal(requests, 0)
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

test("Discord client leaves one exact guild with a non-retried empty DELETE", async () => {
  const requests: Array<{
    body: unknown
    method: string
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: init?.body ?? null,
        method: init?.method ?? "GET",
        url: String(input),
      })
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  await client.leaveGuild("100")

  assert.deepEqual(requests, [{
    body: null,
    method: "DELETE",
    url: `${API_BASE_URL}/users/@me/guilds/100`,
  }])
  await assert.rejects(client.leaveGuild("bad"), /departure guild ID/)

  let rateLimitedAttempts = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      rateLimitedAttempts += 1
      return new Response(JSON.stringify({
        message: "rate limited",
        retry_after: 0.001,
      }), {
        headers: { "Content-Type": "application/json" },
        status: 429,
      })
    },
    maxRetries: 3,
    sleep: async () => {
      throw new Error("Guild departure must not retry")
    },
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.leaveGuild("100"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(rateLimitedAttempts, 1)
})

test("Discord client suppresses guild-inventory and departure failure details", async () => {
  const privateMarker = "private-guild-membership-detail"
  const refused = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(
      JSON.stringify({ code: 50_013, message: privateMarker }),
      { status: 403 },
    ),
    token: TOKEN,
  })

  for (const operation of [
    () => refused.listCurrentUserGuilds({ after: "900" }),
    () => refused.leaveGuild("100"),
  ]) {
    await assert.rejects(
      operation,
      (error: unknown) => (
        error instanceof DiscordApiError
        && error.message.includes("request failed")
        && !error.message.includes(privateMarker)
        && error.cause === undefined
      ),
    )
  }

  const unavailable = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateMarker)
    },
    token: TOKEN,
  })
  for (const operation of [
    () => unavailable.listCurrentUserGuilds({ after: "900" }),
    () => unavailable.leaveGuild("100"),
  ]) {
    await assert.rejects(
      operation,
      (error: unknown) => (
        error instanceof Error
        && error.name === "DiscordTransportError"
        && error.cause === undefined
        && error.message.includes("request failed")
        && !error.message.includes(privateMarker)
      ),
    )
  }
})

test("Discord client encodes native guild search filters as repeated bounded query values", async () => {
  let requestUrl = ""
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requestUrl = String(input)
      return jsonResponse({
        doing_deep_historical_index: false,
        messages: [],
        total_results: 0,
      })
    },
    token: TOKEN,
  })

  await client.searchGuildMessages("100", {
    attachmentExtensions: ["log", "txt"],
    authorIds: ["300", "301"],
    authorTypes: ["bot", "-webhook"],
    channelIds: ["200", "201"],
    content: "deploy failed",
    has: ["file", "-poll"],
    includeNsfw: false,
    limit: 25,
    maxId: "999",
    mentionEveryone: false,
    minId: "100",
    offset: 25,
    pinned: true,
    slop: 3,
    sortBy: "timestamp",
    sortOrder: "desc",
  })

  const url = new URL(requestUrl)
  assert.equal(url.pathname, "/api/v10/guilds/100/messages/search")
  assert.deepEqual(url.searchParams.getAll("channel_id"), ["200", "201"])
  assert.deepEqual(url.searchParams.getAll("author_id"), ["300", "301"])
  assert.deepEqual(url.searchParams.getAll("author_type"), ["bot", "-webhook"])
  assert.deepEqual(url.searchParams.getAll("has"), ["file", "-poll"])
  assert.deepEqual(url.searchParams.getAll("attachment_extension"), ["log", "txt"])
  assert.equal(url.searchParams.get("content"), "deploy failed")
  assert.equal(url.searchParams.get("include_nsfw"), "false")
  assert.equal(url.searchParams.get("mention_everyone"), "false")
  assert.equal(url.searchParams.get("pinned"), "true")
  assert.equal(url.searchParams.get("sort_by"), "timestamp")
  assert.equal(url.searchParams.get("sort_order"), "desc")
})

test("Discord client rejects invalid native search bounds and runtime enum values", () => {
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({}),
    token: TOKEN,
  })

  assert.throws(
    () => client.searchGuildMessages("100", { limit: 26 }),
    /between 1 and 25/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { offset: 9_976 }),
    /between 0 and 9975/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { content: "find", slop: 101 }),
    /between 0 and 100/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { slop: 2 }),
    /requires content/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", {
      sortBy: "relevance",
      sortOrder: "desc",
    }),
    /cannot accompany relevance/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", {
      authorTypes: ["robot" as never],
    }),
    /unsupported value "robot"/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { channelIds: ["not-a-snowflake"] }),
    /values must be Discord snowflakes/,
  )
  assert.throws(
    () => client.searchGuildMessages("100", { maxId: "100", minId: "100" }),
    /minimum ID must be less than maximum ID/,
  )
})

test("Discord client returns Discord search indexing progress without retrying", async () => {
  let calls = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      calls += 1
      return jsonResponse({
        code: 110000,
        documents_indexed: 42,
        message: "Index not yet available",
        retry_after: 1.25,
      }, 202)
    },
    token: TOKEN,
  })

  const result = await client.searchGuildMessages("100", { content: "deploy" })

  assert.deepEqual(result, {
    code: 110000,
    documents_indexed: 42,
    message: "Index not yet available",
    retry_after: 1.25,
  })
  assert.equal(calls, 1)
})

test("Discord client targets role, member, thread-member, and thread-list routes", async () => {
  const requests: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/roles")) return jsonResponse([])
      if (url.includes("/thread-members/")) {
        return jsonResponse({
          flags: 0,
          id: "200",
          join_timestamp: "2026-08-14T00:00:00.000Z",
          user_id: "101",
        })
      }
      if (url.includes("/members/")) return jsonResponse({ roles: [] })
      return jsonResponse({ has_more: false, threads: [] })
    },
    token: TOKEN,
  })

  await client.getGuildRoles("100")
  await client.getGuildMember("100", "101")
  await client.getThreadMember("200", "101")
  await client.listActiveGuildThreads("100")
  await client.listPublicArchivedThreads("200", {
    before: "2026-08-14T00:00:00.000Z",
    limit: 25,
  })
  await client.listPrivateArchivedThreads("200", { limit: 20 })
  await client.listJoinedPrivateArchivedThreads("200", { before: "300", limit: 15 })

  assert.deepEqual(requests, [
    `${API_BASE_URL}/guilds/100/roles`,
    `${API_BASE_URL}/guilds/100/members/101`,
    `${API_BASE_URL}/channels/200/thread-members/101?with_member=false`,
    `${API_BASE_URL}/guilds/100/threads/active`,
    `${API_BASE_URL}/channels/200/threads/archived/public?before=2026-08-14T00%3A00%3A00.000Z&limit=25`,
    `${API_BASE_URL}/channels/200/threads/archived/private?limit=20`,
    `${API_BASE_URL}/channels/200/users/@me/threads/archived/private?before=300&limit=15`,
  ])
  assert.throws(
    () => client.listPublicArchivedThreads("200", { limit: 101 }),
    /between 2 and 100/,
  )
  assert.throws(
    () => client.listPublicArchivedThreads("200", { limit: 1 }),
    /between 2 and 100/,
  )
  assert.throws(
    () => client.listPublicArchivedThreads("200", { before: "tomorrow" }),
    /ISO 8601 timestamp/,
  )
  assert.throws(
    () => client.listJoinedPrivateArchivedThreads("200", { before: "not-a-snowflake" }),
    /Discord snowflake/,
  )
  assert.throws(
    () => client.getThreadMember("not-a-snowflake", "101"),
    /exact thread-member lookup requires snowflake IDs/,
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

test("Discord client trims a separator-heavy test transport origin once", async () => {
  const requests: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: `${API_BASE_URL}${"/".repeat(512)}`,
    fetchImplementation: async (input) => {
      requests.push(String(input))
      return jsonResponse({ bot: true, id: "1", username: "bot" })
    },
    token: TOKEN,
  })

  await client.getCurrentUser()

  assert.deepEqual(requests, [`${API_BASE_URL}/users/@me`])
})

test("Discord client observes only fixed REST operations, outcomes, status, and retries", async () => {
  const records: RecordedObservation[] = []
  let calls = 0
  const privateChannelId = "299999999999999999"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      calls += 1
      if (calls === 1) {
        return jsonResponse(
          { message: "private rate-limit detail", retry_after: 0 },
          429,
          { "X-RateLimit-Scope": "shared" },
        )
      }
      if (calls === 3) {
        return jsonResponse({ message: "private forbidden detail" }, 403)
      }
      return jsonResponse([])
    },
    observer: recordingObserver(records),
    sleep: async () => undefined,
    token: TOKEN,
  })

  await client.listMessages(privateChannelId)
  await assert.rejects(() => client.getChannel(privateChannelId), DiscordApiError)

  assert.deepEqual(records, [
    {
      completions: [{ outcome: "ok" }],
      operation: "list_messages",
      responses: [{ sharedRateLimit: true, statusCode: 429 }],
      retries: 1,
      runs: 1,
    },
    {
      completions: [{
        errorCategory: "discord-client-error" satisfies OperationalErrorCategory,
        outcome: "error",
        statusCode: 403,
      }],
      operation: "get_channel",
      responses: [{ sharedRateLimit: false, statusCode: 403 }],
      retries: 0,
      runs: 1,
    },
  ])
  const observed = JSON.stringify(records)
  assert.equal(observed.includes(privateChannelId), false)
  assert.equal(observed.includes("private"), false)
  assert.equal(observed.includes(TOKEN), false)
})

test("Discord client isolates response-observer failures from request behavior", async () => {
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      bot: true,
      id: "1",
      username: "bot",
    }),
    observer: {
      startDiscordRequest() {
        return {
          end() {},
          response() {
            throw new Error("observer failed")
          },
          retry() {},
          run<T>(callback: () => Promise<T>) {
            return callback()
          },
        }
      },
    },
    token: TOKEN,
  })

  const user = await client.getCurrentUser()

  assert.equal(user.id, "1")
})

test("Discord client classifies transport timeout and caller cancellation without details", async () => {
  const categories: OperationalErrorCategory[] = []
  const observer = {
    startDiscordRequest() {
      return {
        end(completion: OperationCompletion) {
          if (completion.errorCategory) categories.push(completion.errorCategory)
        },
        response() {},
        retry() {},
        run<T>(callback: () => Promise<T>) {
          return callback()
        },
      }
    },
  }
  const timeoutClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
    }),
    observer,
    requestTimeoutMs: 1,
    token: TOKEN,
  })
  await assert.rejects(() => timeoutClient.getCurrentUser())

  const cancellation = new AbortController()
  cancellation.abort()
  const cancelledClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      throw init?.signal?.reason
    },
    observer,
    token: TOKEN,
  })
  await assert.rejects(() => cancelledClient.getCurrentUser({ signal: cancellation.signal }))

  assert.deepEqual(categories, ["timeout", "cancelled"])
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
    }, 403, { "x-ratelimit-reset-after": "0.1" }),
    token: TOKEN,
  })
  await assert.rejects(
    () => apiClient.getCurrentUser(),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.code === 50_013
      && error.retryAfterMs === undefined
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

test("Discord client uses current pin mutation routes with encoded audit reasons", async () => {
  const requests: Array<{
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  await client.pinMessage("200", "300", "Review / case 42")
  await client.unpinMessage("200", "300", "Review / case 42")

  assert.deepEqual(requests, [
    {
      method: "PUT",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/channels/200/messages/pins/300`,
    },
    {
      method: "DELETE",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/channels/200/messages/pins/300`,
    },
  ])
})

test("Discord client validates pin mutations and never retries their rate limits", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.pinMessage("200", "300", "reviewed"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  await assert.rejects(
    () => client.unpinMessage("bad", "300", "reviewed"),
    /channel ID/,
  )
  await assert.rejects(
    () => client.unpinMessage("200", "bad", "reviewed"),
    /message ID/,
  )
  await assert.rejects(
    () => client.unpinMessage("200", "300", " "),
    /must not be blank/,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client crossposts one exact message without a body or automatic retry", async () => {
  const requests: Array<{
    body: RequestInit["body"]
    method: string
    reason: string | null
    url: string
  }> = []
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: init?.body,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.crosspostMessage("200", "300"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )

  assert.deepEqual(requests, [{
    body: undefined,
    method: "POST",
    reason: null,
    url: `${API_BASE_URL}/channels/200/messages/300/crosspost`,
  }])
  assert.equal(sleeps, 0)
  assert.throws(() => client.crosspostMessage("bad", "300"), /channel ID/)
  assert.throws(() => client.crosspostMessage("200", "bad"), /message ID/)
})

test("Discord client triggers one exact typing indicator without a body or retry", async () => {
  const requests: Array<{
    body: RequestInit["body"]
    method: string
    url: string
  }> = []
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: init?.body,
        method: init?.method || "GET",
        url: String(input),
      })
      return new Response(null, { status: 204 })
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await client.triggerTypingIndicator("200")
  assert.deepEqual(requests, [{
    body: undefined,
    method: "POST",
    url: `${API_BASE_URL}/channels/200/typing`,
  }])
  assert.equal(sleeps, 0)
  await assert.rejects(client.triggerTypingIndicator("bad"), /channel ID/)
  assert.equal(requests.length, 1)

  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      message: "do not expose this",
      retry_after: 0.001,
    }, 429),
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.triggerTypingIndicator("200"),
    (error: unknown) => {
      assert(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.equal(error.message.includes("do not expose this"), false)
      assert.equal(error.cause, undefined)
      return true
    },
  )
  assert.equal(sleeps, 0)
})

test("Discord client sends one exact message-forward contract without automatic retry", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        url: String(input),
      })
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.createMessageForward("200", {
      nonce: "forward-nonce",
      sourceChannelId: "201",
      sourceGuildId: "100",
      sourceMessageId: "300",
    }),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )

  assert.deepEqual(requests, [{
    body: {
      allowed_mentions: { parse: [], replied_user: false },
      enforce_nonce: true,
      flags: DISCORD_MESSAGE_FLAGS.suppressNotifications,
      message_reference: {
        channel_id: "201",
        fail_if_not_exists: true,
        guild_id: "100",
        message_id: "300",
        type: DISCORD_MESSAGE_REFERENCE_TYPES.forward,
      },
      nonce: "forward-nonce",
    },
    method: "POST",
    url: `${API_BASE_URL}/channels/200/messages`,
  }])
  assert.equal(sleeps, 0)
  assert.throws(
    () => client.createMessageForward("bad", {
      nonce: "forward-nonce",
      sourceChannelId: "201",
      sourceGuildId: "100",
      sourceMessageId: "300",
    }),
    /target channel ID/,
  )
  assert.throws(
    () => client.createMessageForward("200", {
      nonce: "forward-nonce",
      sourceChannelId: "200",
      sourceGuildId: "100",
      sourceMessageId: "300",
    }),
    /must differ/,
  )
})

test("Discord client sends exact managed-command and unauthenticated Interaction contracts", async () => {
  const interactionToken = "private.interaction-token"
  const requests: Array<{
    authorization: string | null
    body: unknown
    method: string
    url: string
  }> = []
  const command = {
    application_id: "100",
    default_member_permissions: "0",
    description: "Send a private request to the configured MCP workflow",
    guild_id: "200",
    id: "300",
    name: "discord-mcp",
    nsfw: false,
    options: [{
      description: "The private request to process",
      max_length: 2_000,
      min_length: 1,
      name: "request",
      required: true,
      type: 3,
    }],
    type: 1,
    version: "301",
  }
  const responses = [
    jsonResponse([command]),
    jsonResponse(command, 201),
    new Response(null, { status: 204 }),
    new Response(null, { status: 204 }),
    new Response(null, { status: 204 }),
    jsonResponse({
      application_id: "100",
      attachments: [],
      author: { bot: true, id: "500", username: "connector" },
      channel_id: "600",
      components: [],
      content: "Reviewed response",
      embeds: [],
      flags: 64,
      id: "700",
      timestamp: "2026-08-22T00:00:00.000Z",
      type: 20,
      webhook_id: "100",
    }),
    jsonResponse({
      application_id: "100",
      attachments: [],
      author: { bot: true, id: "500", username: "connector" },
      channel_id: "600",
      components: [],
      content: "Private follow-up",
      embeds: [],
      flags: 64,
      id: "701",
      timestamp: "2026-08-22T00:01:00.000Z",
      type: 0,
      webhook_id: "100",
    }),
    jsonResponse({
      application_id: "100",
      attachments: [],
      author: { bot: true, id: "500", username: "connector" },
      channel_id: "600",
      components: [],
      content: "Private follow-up",
      embeds: [],
      flags: 64,
      id: "701",
      timestamp: "2026-08-22T00:01:00.000Z",
      type: 0,
      webhook_id: "100",
    }),
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        url: String(input),
      })
      const response = responses.shift()
      if (!response) throw new Error("Unexpected request")
      return response
    },
    token: TOKEN,
  })

  await client.listGuildApplicationCommands("100", "200")
  await client.createGuildApplicationCommand("100", "200", {
    defaultMemberPermissions: [],
    description: command.description,
    descriptionLocalizations: [],
    name: command.name,
    nameLocalizations: [],
    nsfw: false,
    options: [{
      autocomplete: false,
      choices: [],
      description: command.options[0]!.description,
      descriptionLocalizations: [],
      maxLength: command.options[0]!.max_length,
      minLength: command.options[0]!.min_length,
      name: command.options[0]!.name,
      nameLocalizations: [],
      required: command.options[0]!.required,
      type: "string",
    }],
    type: "chat-input",
  })
  await client.deleteGuildApplicationCommand("100", "200", "300")
  await client.createDeferredInteractionResponse("400", interactionToken)
  await client.createImmediateInteractionResponse(
    "401",
    interactionToken,
    "Private rejection",
  )
  await client.editOriginalInteractionResponse(
    "100",
    interactionToken,
    "Reviewed response",
  )
  await client.createInteractionFollowup(
    "100",
    interactionToken,
    "Private follow-up",
  )
  await client.getInteractionFollowup("100", interactionToken, "701")

  assert.deepEqual(requests.map(({ authorization, method, url }) => ({
    authorization,
    method,
    url,
  })), [{
    authorization: `Bot ${TOKEN}`,
    method: "GET",
    url: `${API_BASE_URL}/applications/100/guilds/200/commands`,
  }, {
    authorization: `Bot ${TOKEN}`,
    method: "POST",
    url: `${API_BASE_URL}/applications/100/guilds/200/commands`,
  }, {
    authorization: `Bot ${TOKEN}`,
    method: "DELETE",
    url: `${API_BASE_URL}/applications/100/guilds/200/commands/300`,
  }, {
    authorization: null,
    method: "POST",
    url: `${API_BASE_URL}/interactions/400/${interactionToken}/callback`,
  }, {
    authorization: null,
    method: "POST",
    url: `${API_BASE_URL}/interactions/401/${interactionToken}/callback`,
  }, {
    authorization: null,
    method: "PATCH",
    url: `${API_BASE_URL}/webhooks/100/${interactionToken}/messages/@original`,
  }, {
    authorization: null,
    method: "POST",
    url: `${API_BASE_URL}/webhooks/100/${interactionToken}`,
  }, {
    authorization: null,
    method: "GET",
    url: `${API_BASE_URL}/webhooks/100/${interactionToken}/messages/701`,
  }])
  assert.deepEqual(requests[1]?.body, {
    default_member_permissions: "0",
    description: command.description,
    description_localizations: null,
    name: command.name,
    name_localizations: null,
    nsfw: false,
    options: [{
      autocomplete: false,
      choices: [],
      description: command.options[0]!.description,
      description_localizations: null,
      max_length: command.options[0]!.max_length,
      min_length: command.options[0]!.min_length,
      name: command.options[0]!.name,
      name_localizations: null,
      required: command.options[0]!.required,
      type: 3,
    }],
    type: 1,
  })
  assert.equal("contexts" in (requests[1]?.body as Record<string, unknown>), false)
  assert.equal("integration_types" in (requests[1]?.body as Record<string, unknown>), false)
  assert.deepEqual(requests[3]?.body, { data: { flags: 64 }, type: 5 })
  assert.deepEqual(requests[4]?.body, {
    data: {
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
      content: "Private rejection",
      flags: 64,
    },
    type: 4,
  })
  assert.deepEqual(requests[5]?.body, {
    allowed_mentions: {
      parse: [],
      replied_user: false,
    },
    attachments: [],
    components: [],
    content: "Reviewed response",
    embeds: [],
  })
  assert.deepEqual(requests[6]?.body, {
    allowed_mentions: {
      parse: [],
      replied_user: false,
    },
    attachments: [],
    components: [],
    content: "Private follow-up",
    embeds: [],
    flags: DISCORD_MESSAGE_FLAGS.ephemeral,
  })
  assert.equal(requests[7]?.body, null)
})

test("Discord client uses full-localization reviewed command routes and exact success statuses", async () => {
  const definition = {
    defaultMemberPermissions: ["MANAGE_GUILD" as const],
    description: "Review exact command evidence",
    descriptionLocalizations: [{ locale: "de" as const, value: "Exakte Belege pruefen" }],
    name: "review",
    nameLocalizations: [{ locale: "de" as const, value: "pruefen" }],
    nsfw: false,
    options: [],
    type: "chat-input" as const,
  }
  const command = {
    application_id: "100",
    default_member_permissions: "32",
    description: definition.description,
    description_localizations: { de: "Exakte Belege pruefen" },
    guild_id: "200",
    id: "300",
    name: definition.name,
    name_localizations: { de: "pruefen" },
    nsfw: false,
    options: [],
    type: 1,
    version: "301",
  }
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const responses = [
    jsonResponse([command]),
    jsonResponse(command, 201),
    jsonResponse({ ...command, version: "302" }),
    new Response(null, { status: 204 }),
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        url: String(input),
      })
      const response = responses.shift()
      if (!response) throw new Error("Unexpected request")
      return response
    },
    token: TOKEN,
  })

  await client.listGuildApplicationCommandsWithLocalizations("100", "200")
  await client.createGuildApplicationCommand("100", "200", definition)
  await client.editGuildApplicationCommand("100", "200", "300", definition)
  await client.deleteGuildApplicationCommand("100", "200", "300")

  assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [{
    method: "GET",
    url: `${API_BASE_URL}/applications/100/guilds/200/commands?with_localizations=true`,
  }, {
    method: "POST",
    url: `${API_BASE_URL}/applications/100/guilds/200/commands`,
  }, {
    method: "PATCH",
    url: `${API_BASE_URL}/applications/100/guilds/200/commands/300`,
  }, {
    method: "DELETE",
    url: `${API_BASE_URL}/applications/100/guilds/200/commands/300`,
  }])
  assert.deepEqual(requests[1]?.body, {
    default_member_permissions: "32",
    description: definition.description,
    description_localizations: { de: "Exakte Belege pruefen" },
    name: definition.name,
    name_localizations: { de: "pruefen" },
    nsfw: false,
    options: [],
    type: 1,
  })
  assert.deepEqual(requests[2]?.body, {
    default_member_permissions: "32",
    description: definition.description,
    description_localizations: { de: "Exakte Belege pruefen" },
    name: definition.name,
    name_localizations: { de: "pruefen" },
    nsfw: false,
    options: [],
  })
})

test("Discord client uses full-localization reviewed global command routes", async () => {
  const definition = {
    contexts: ["guild" as const, "bot-dm" as const],
    defaultMemberPermissions: ["MANAGE_GUILD" as const],
    description: "Review exact global command evidence",
    descriptionLocalizations: [{ locale: "de" as const, value: "Globale Belege pruefen" }],
    integrationTypes: ["guild-install" as const],
    name: "review-global",
    nameLocalizations: [{ locale: "de" as const, value: "global-pruefen" }],
    nsfw: false,
    options: [],
    type: "chat-input" as const,
  }
  const command = {
    application_id: "100",
    contexts: [0, 1],
    default_member_permissions: "32",
    description: definition.description,
    description_localizations: { de: "Globale Belege pruefen" },
    id: "300",
    integration_types: [0],
    name: definition.name,
    name_localizations: { de: "global-pruefen" },
    nsfw: false,
    options: [],
    type: 1,
    version: "301",
  }
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const responses = [
    jsonResponse([command]),
    jsonResponse(command, 201),
    jsonResponse({ ...command, version: "302" }),
    new Response(null, { status: 204 }),
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        url: String(input),
      })
      const response = responses.shift()
      if (!response) throw new Error("Unexpected request")
      return response
    },
    token: TOKEN,
  })

  await client.listGlobalApplicationCommandsWithLocalizations("100")
  await client.createGlobalApplicationCommand("100", definition)
  await client.editGlobalApplicationCommand("100", "300", definition)
  await client.deleteGlobalApplicationCommand("100", "300")

  assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [{
    method: "GET",
    url: `${API_BASE_URL}/applications/100/commands?with_localizations=true`,
  }, {
    method: "POST",
    url: `${API_BASE_URL}/applications/100/commands`,
  }, {
    method: "PATCH",
    url: `${API_BASE_URL}/applications/100/commands/300`,
  }, {
    method: "DELETE",
    url: `${API_BASE_URL}/applications/100/commands/300`,
  }])
  assert.deepEqual(requests[1]?.body, {
    contexts: [0, 1],
    default_member_permissions: "32",
    description: definition.description,
    description_localizations: { de: "Globale Belege pruefen" },
    integration_types: [0],
    name: definition.name,
    name_localizations: { de: "global-pruefen" },
    nsfw: false,
    options: [],
    type: 1,
  })
  assert.deepEqual(requests[2]?.body, {
    contexts: [0, 1],
    default_member_permissions: "32",
    description: definition.description,
    description_localizations: { de: "Globale Belege pruefen" },
    integration_types: [0],
    name: definition.name,
    name_localizations: { de: "global-pruefen" },
    nsfw: false,
    options: [],
  })
})

test("Discord client rejects command upserts and never retries reviewed writes", async () => {
  const definition = {
    defaultMemberPermissions: null,
    description: "Review exact command evidence",
    descriptionLocalizations: [],
    name: "review",
    nameLocalizations: [],
    nsfw: false,
    options: [],
    type: "chat-input" as const,
  }
  const privateMarker = "private-command-description"
  let calls = 0
  const upsert = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      calls += 1
      return jsonResponse({ message: privateMarker }, 200)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    upsert.createGuildApplicationCommand("100", "200", definition),
    (error: unknown) => (
      error instanceof Error
      && error.name === "DiscordTransportError"
      && /unexpected success status/.test(error.message)
      && !error.message.includes(privateMarker)
    ),
  )
  assert.equal(calls, 1)

  calls = 0
  const limited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      calls += 1
      return jsonResponse({ message: privateMarker, retry_after: 0 }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    limited.editGuildApplicationCommand("100", "200", "300", definition),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && !error.message.includes(privateMarker)
    ),
  )
  assert.equal(calls, 1)

  const wrongDeleteStatus = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({}, 200),
    token: TOKEN,
  })
  await assert.rejects(
    wrongDeleteStatus.deleteGuildApplicationCommand("100", "200", "300"),
    /unexpected success status/,
  )

  calls = 0
  const unsafeGlobalUpsert = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      calls += 1
      return jsonResponse({ message: privateMarker }, 200)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    unsafeGlobalUpsert.createGlobalApplicationCommand("100", {
      contexts: ["guild"],
      ...definition,
      integrationTypes: ["guild-install"],
    }),
    (error: unknown) => (
      error instanceof Error
      && error.name === "DiscordTransportError"
      && /unexpected success status/.test(error.message)
      && !error.message.includes(privateMarker)
    ),
  )
  assert.equal(calls, 1)
})

test("Discord client bounds and protects application-command inventories", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return jsonResponse([])
    },
    token: TOKEN,
  })
  await client.listGlobalApplicationCommands("100")
  assert.deepEqual(requests, [{
    method: "GET",
    url: `${API_BASE_URL}/applications/100/commands?with_localizations=false`,
  }])

  const privateMarker = "private-command-description"
  const refused = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ message: privateMarker }, 400),
    token: TOKEN,
  })
  await assert.rejects(
    refused.listGlobalApplicationCommands("100"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.message.includes("request failed")
      && !error.message.includes(privateMarker)
    ),
  )

  const transport = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateMarker)
    },
    token: TOKEN,
  })
  await assert.rejects(
    transport.listGuildApplicationCommands("100", "200"),
    (error: unknown) => (
      error instanceof Error
      && error.name === "DiscordTransportError"
      && error.cause === undefined
      && error.message.includes("request failed")
      && !error.message.includes(privateMarker)
    ),
  )

  const oversized = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(
      "x".repeat(DISCORD_LIMITS.applicationCommandInventoryResponseBytes + 1),
      { status: 200 },
    ),
    token: TOKEN,
  })
  await assert.rejects(
    oversized.listGlobalApplicationCommands("100"),
    /exceeded its local response bound/,
  )
  assert.throws(
    () => client.listGlobalApplicationCommands("invalid"),
    /application-command application ID/,
  )
})

test("Discord client bounds and protects linked-role metadata inventories", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const record = {
    description: "Minimum review level",
    key: "review_level",
    name: "Review level",
    type: 2,
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return jsonResponse([record])
    },
    token: TOKEN,
  })

  assert.deepEqual(
    await client.listApplicationRoleConnectionMetadata("100"),
    [record],
  )
  assert.deepEqual(requests, [{
    method: "GET",
    url: `${API_BASE_URL}/applications/100/role-connections/metadata`,
  }])

  const privateMarker = "private-linked-role-description"
  const refused = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ message: privateMarker }, 400),
    token: TOKEN,
  })
  await assert.rejects(
    refused.listApplicationRoleConnectionMetadata("100"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.message.includes("request failed")
      && !error.message.includes(privateMarker)
      && error.cause === undefined
    ),
  )

  const transport = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateMarker)
    },
    token: TOKEN,
  })
  await assert.rejects(
    transport.listApplicationRoleConnectionMetadata("100"),
    (error: unknown) => (
      error instanceof Error
      && !error.message.includes(privateMarker)
    ),
  )

  const oversized = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(
      "x".repeat(
        DISCORD_LIMITS.applicationRoleConnectionMetadataResponseBytes + 1,
      ),
      { status: 200 },
    ),
    token: TOKEN,
  })
  await assert.rejects(
    oversized.listApplicationRoleConnectionMetadata("100"),
    /exceeded its local response bound/u,
  )
  assert.throws(
    () => client.listApplicationRoleConnectionMetadata("invalid"),
    /role-connection metadata application ID/u,
  )
})

test("Discord client replaces linked-role metadata once through an exact bounded contract", async () => {
  const requests: Array<{
    body: unknown
    method: string
    url: string
  }> = []
  const record = {
    description: "Minimum review level",
    description_localizations: { de: "Mindestpruefungsstufe" },
    key: "review_level",
    name: "Review level",
    name_localizations: { de: "Pruefungsstufe" },
    type: 2,
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        method: init?.method || "GET",
        url: String(input),
      })
      return jsonResponse([record], 200)
    },
    token: TOKEN,
  })

  assert.deepEqual(
    await client.replaceApplicationRoleConnectionMetadata("100", [record]),
    [record],
  )
  assert.deepEqual(requests, [{
    body: [record],
    method: "PUT",
    url: `${API_BASE_URL}/applications/100/role-connections/metadata`,
  }])

  assert.throws(
    () => client.replaceApplicationRoleConnectionMetadata("invalid", []),
    /role-connection metadata application ID/u,
  )
  assert.throws(
    () => client.replaceApplicationRoleConnectionMetadata("100", [{
      ...record,
      future: true,
    }] as never),
    /input is invalid/u,
  )
})

test("Discord client never retries or leaks failed linked-role metadata writes", async () => {
  const privateMarker = "private-linked-role-write"
  let attempts = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      attempts += 1
      return jsonResponse({ message: privateMarker, retry_after: 0 }, 429)
    },
    maxRetries: 3,
    sleep: async () => undefined,
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.replaceApplicationRoleConnectionMetadata("100", []),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && error.cause === undefined
      && !error.message.includes(privateMarker)
    ),
  )
  assert.equal(attempts, 1)

  const wrongStatus = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([], 201),
    token: TOKEN,
  })
  await assert.rejects(
    wrongStatus.replaceApplicationRoleConnectionMetadata("100", []),
    (error: unknown) => (
      error instanceof Error
      && error.cause === undefined
      && /unexpected success status/u.test(error.message)
    ),
  )

  const transport = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateMarker)
    },
    token: TOKEN,
  })
  await assert.rejects(
    transport.replaceApplicationRoleConnectionMetadata("100", []),
    (error: unknown) => (
      error instanceof Error
      && error.cause === undefined
      && !error.message.includes(privateMarker)
    ),
  )
})

test("Discord client bounds and protects current-application SKU inventories", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const record = {
    application_id: "100",
    flags: 4,
    id: "200",
    name: "Supporter",
    slug: "supporter",
    type: 2,
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return jsonResponse([record])
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.listApplicationSkus("100"), [record])
  assert.deepEqual(requests, [{
    method: "GET",
    url: `${API_BASE_URL}/applications/100/skus`,
  }])

  const privateMarker = "private-sku-evidence"
  const refused = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ message: privateMarker }, 400),
    token: TOKEN,
  })
  await assert.rejects(
    refused.listApplicationSkus("100"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.message.includes("request failed")
      && !error.message.includes(privateMarker)
      && error.cause === undefined
    ),
  )

  const transport = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateMarker)
    },
    token: TOKEN,
  })
  await assert.rejects(
    transport.listApplicationSkus("100"),
    (error: unknown) => (
      error instanceof Error
      && !error.message.includes(privateMarker)
    ),
  )

  const oversized = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(
      "x".repeat(DISCORD_LIMITS.applicationSkuResponseBytes + 1),
      { status: 200 },
    ),
    token: TOKEN,
  })
  await assert.rejects(
    oversized.listApplicationSkus("100"),
    /exceeded its local response bound/u,
  )
  assert.throws(
    () => client.listApplicationSkus("invalid"),
    /application SKU application ID/u,
  )
})

test("Discord client fetches one exact application entitlement with bounded redacted failures", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const entitlement = {
    application_id: "100",
    consumed: false,
    deleted: false,
    id: "600",
    sku_id: "400",
    type: 1,
    user_id: "300",
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return jsonResponse(entitlement)
    },
    token: TOKEN,
  })

  assert.deepEqual(
    await client.getApplicationEntitlement("100", "600"),
    entitlement,
  )
  assert.deepEqual(requests, [{
    method: "GET",
    url: API_BASE_URL + "/applications/100/entitlements/600",
  }])
  assert.throws(
    () => client.getApplicationEntitlement("invalid", "600"),
    /application entitlement application ID/u,
  )
  assert.throws(
    () => client.getApplicationEntitlement("100", "invalid"),
    /application entitlement ID/u,
  )

  const privateMarker = "private-entitlement-evidence"
  const refused = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ message: privateMarker }, 400),
    token: TOKEN,
  })
  await assert.rejects(
    refused.getApplicationEntitlement("100", "600"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.message.includes("request failed")
      && !error.message.includes(privateMarker)
      && error.cause === undefined
    ),
  )

  const oversized = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(
      "x".repeat(DISCORD_LIMITS.applicationEntitlementRecordResponseBytes + 1),
      { status: 200 },
    ),
    token: TOKEN,
  })
  await assert.rejects(
    oversized.getApplicationEntitlement("100", "600"),
    /exceeded its local response bound/u,
  )
})

test("Discord client sends exact non-retried application entitlement lifecycle writes", async () => {
  const entitlement = {
    application_id: "100",
    consumed: false,
    deleted: false,
    id: "600",
    sku_id: "400",
    type: 4,
    user_id: "300",
  }
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
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      if (String(input).endsWith("/entitlements")) return jsonResponse(entitlement)
      return new Response(null, { status: 204 })
    },
    maxRetries: 3,
    token: TOKEN,
  })

  assert.deepEqual(await client.createApplicationTestEntitlement("100", {
    beneficiary: { type: "user", userId: "300" },
    skuId: "400",
  }), entitlement)
  await client.deleteApplicationTestEntitlement("100", "600")
  await client.consumeApplicationEntitlement("100", "600")

  assert.deepEqual(requests, [{
    body: { owner_id: "300", owner_type: 2, sku_id: "400" },
    method: "POST",
    reason: null,
    url: `${API_BASE_URL}/applications/100/entitlements`,
  }, {
    body: null,
    method: "DELETE",
    reason: null,
    url: `${API_BASE_URL}/applications/100/entitlements/600`,
  }, {
    body: null,
    method: "POST",
    reason: null,
    url: `${API_BASE_URL}/applications/100/entitlements/600/consume`,
  }])

  assert.throws(
    () => client.createApplicationTestEntitlement("100", {
      beneficiary: {
        type: "guild",
        guildId: "200",
        userId: "private-extra-identity",
      } as never,
      skuId: "400",
    }),
    /beneficiary is invalid/u,
  )
  assert.throws(
    () => client.createApplicationTestEntitlement("100", {
      beneficiary: { type: "user", userId: "300" },
      privateProduct: "private-product-text",
      skuId: "400",
    } as never),
    /input is invalid/u,
  )
  await assert.rejects(
    client.deleteApplicationTestEntitlement("100", "invalid"),
    /test entitlement ID/u,
  )
  await assert.rejects(
    client.consumeApplicationEntitlement("invalid", "600"),
    /consumable entitlement application ID/u,
  )

  for (const operation of [
    (target: DiscordClient) => target.createApplicationTestEntitlement("100", {
      beneficiary: { type: "guild", guildId: "200" },
      skuId: "400",
    }),
    (target: DiscordClient) => target.deleteApplicationTestEntitlement("100", "600"),
    (target: DiscordClient) => target.consumeApplicationEntitlement("100", "600"),
  ]) {
    const privateMarker = "private-entitlement-write-detail"
    let attempts = 0
    const refused = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => {
        attempts += 1
        return jsonResponse({ message: privateMarker, retry_after: 0 }, 429)
      },
      maxRetries: 3,
      sleep: async () => undefined,
      token: TOKEN,
    })
    await assert.rejects(
      operation(refused),
      (error: unknown) => (
        error instanceof DiscordApiError
        && error.status === 429
        && error.cause === undefined
        && !error.message.includes(privateMarker)
      ),
    )
    assert.equal(attempts, 1)
  }

  for (const operation of [
    (target: DiscordClient) => target.deleteApplicationTestEntitlement("100", "600"),
    (target: DiscordClient) => target.consumeApplicationEntitlement("100", "600"),
  ]) {
    const wrongStatus = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => new Response(null, { status: 200 }),
      token: TOKEN,
    })
    await assert.rejects(
      operation(wrongStatus),
      /unexpected success status/u,
    )
  }

  const nonemptySuccess = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => ({
      headers: new Headers(),
      ok: true,
      status: 204,
      statusText: "",
      text: async () => "unexpected-success-body",
    }) as Response,
    token: TOKEN,
  })
  await assert.rejects(
    nonemptySuccess.consumeApplicationEntitlement("100", "600"),
    /unexpected success body/u,
  )
})

test("Discord client requests only exact filtered application entitlement pages", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const entitlement = {
    application_id: "100",
    consumed: false,
    deleted: false,
    id: "600",
    sku_id: "400",
    type: 1,
    user_id: "300",
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return jsonResponse([entitlement])
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.listApplicationEntitlements(
    "100",
    { type: "guild", guildId: "200" },
    ["400", "500"],
  ), [entitlement])
  assert.deepEqual(await client.listApplicationEntitlements(
    "100",
    { type: "user", userId: "300" },
    ["400"],
    { after: "550", limit: 10 },
  ), [entitlement])
  assert.deepEqual(requests, [{
    method: "GET",
    url: `${API_BASE_URL}/applications/100/entitlements?exclude_deleted=true&exclude_ended=true&guild_id=200&limit=25&sku_ids=400%2C500`,
  }, {
    method: "GET",
    url: `${API_BASE_URL}/applications/100/entitlements?after=550&exclude_deleted=true&exclude_ended=true&limit=10&sku_ids=400&user_id=300`,
  }])

  await assert.rejects(
    client.listApplicationEntitlements(
      "100",
      { type: "user", userId: "300" },
      ["400"],
      { after: "500", before: "600" },
    ),
    /only one cursor/u,
  )
  await assert.rejects(
    client.listApplicationEntitlements(
      "100",
      { type: "user", userId: "300" },
      [],
    ),
    /SKU filters/u,
  )
  await assert.rejects(
    client.listApplicationEntitlements(
      "100",
      { type: "guild", guildId: "invalid" },
      ["400"],
    ),
    /guild ID/u,
  )

  const oversized = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(
      "x".repeat(DISCORD_LIMITS.applicationEntitlementResponseBytes + 1),
      { status: 200 },
    ),
    token: TOKEN,
  })
  await assert.rejects(
    oversized.listApplicationEntitlements(
      "100",
      { type: "user", userId: "300" },
      ["400"],
    ),
    /exceeded its local response bound/u,
  )

  const overfull = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([entitlement, entitlement]),
    token: TOKEN,
  })
  await assert.rejects(
    overfull.listApplicationEntitlements(
      "100",
      { type: "user", userId: "300" },
      ["400"],
      { limit: 1 },
    ),
    ApplicationMonetizationEvidenceError,
  )
})

test("Discord client requires exact-user application subscription pages", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const subscription = {
    current_period_end: "2026-09-01T00:00:00Z",
    current_period_start: "2026-08-01T00:00:00Z",
    entitlement_ids: ["500"],
    id: "600",
    sku_ids: ["200"],
    status: 0,
    user_id: "300",
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return jsonResponse([subscription])
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.listApplicationSubscriptions(
    "200",
    "300",
    { before: "700", limit: 50 },
  ), [subscription])
  assert.deepEqual(requests, [{
    method: "GET",
    url: `${API_BASE_URL}/skus/200/subscriptions?before=700&limit=50&user_id=300`,
  }])

  await assert.rejects(
    client.listApplicationSubscriptions("200", "invalid"),
    /subscription user ID/u,
  )
  await assert.rejects(
    client.listApplicationSubscriptions(
      "200",
      "300",
      { after: "500", before: "700" },
    ),
    /only one cursor/u,
  )

  const oversized = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(
      "x".repeat(DISCORD_LIMITS.applicationSubscriptionResponseBytes + 1),
      { status: 200 },
    ),
    token: TOKEN,
  })
  await assert.rejects(
    oversized.listApplicationSubscriptions("200", "300"),
    /exceeded its local response bound/u,
  )
})

test("Discord client never retries or reveals an Interaction token after transport refusal", async () => {
  const interactionToken = "private.interaction-token"
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: interactionToken, retry_after: 0.001 }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  const operations = [
    () => client.createDeferredInteractionResponse("400", interactionToken),
    () => client.createInteractionFollowup(
      "100",
      interactionToken,
      "Private follow-up",
    ),
    () => client.getInteractionFollowup("100", interactionToken, "701"),
  ]
  for (const operation of operations) {
    await assert.rejects(operation, (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.equal(error.route.includes(interactionToken), false)
      assert.equal(error.message.includes(interactionToken), false)
      return true
    })
  }
  assert.equal(requests, operations.length)
  assert.equal(sleeps, 0)
})

test("Discord client sends exact permission-overwrite routes and encoded reasons", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  await client.editChannelPermissionOverwrite(
    "200",
    "300",
    { allow: "1024", deny: "2048", type: 0 },
    "Review / case 42",
  )
  await client.deleteChannelPermissionOverwrite("200", "300", "Review / case 42")

  assert.deepEqual(requests, [
    {
      body: { allow: "1024", deny: "2048", type: 0 },
      method: "PUT",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/channels/200/permissions/300`,
    },
    {
      body: null,
      method: "DELETE",
      reason: "Review%20%2F%20case%2042",
      url: `${API_BASE_URL}/channels/200/permissions/300`,
    },
  ])
})

test("Discord client validates overwrite mutations and never retries their rate limits", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.editChannelPermissionOverwrite(
      "200",
      "300",
      { allow: "1024", deny: "0", type: 1 },
      "reviewed",
    ),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  await assert.rejects(
    () => client.deleteChannelPermissionOverwrite("bad", "300", "reviewed"),
    /channel ID/,
  )
  await assert.rejects(
    () => client.editChannelPermissionOverwrite(
      "200",
      "bad",
      { allow: "0", deny: "0", type: 0 },
      "reviewed",
    ),
    /target ID/,
  )
  await assert.rejects(
    () => client.editChannelPermissionOverwrite(
      "200",
      "300",
      { allow: "01", deny: "0", type: 0 },
      "reviewed",
    ),
    /allow field/,
  )
  await assert.rejects(
    () => client.editChannelPermissionOverwrite(
      "200",
      "300",
      { allow: "1024", deny: "1024", type: 0 },
      "reviewed",
    ),
    /must not overlap/,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client replaces a complete overwrite set once and returns the exact channel response", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const response = {
    guild_id: "100",
    id: "200",
    parent_id: "201",
    permission_overwrites: [{ allow: "1024", deny: "0", id: "300", type: 0 }],
    type: 0,
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse(response)
    },
    token: TOKEN,
  })

  const result = await client.replaceChannelPermissionOverwrites(
    "200",
    [{ allow: "1024", deny: "0", id: "300", type: 0 }],
    "Reviewed parent sync / case 42",
  )

  assert.deepEqual(result, response)
  assert.deepEqual(requests, [{
    body: {
      permission_overwrites: [{ allow: "1024", deny: "0", id: "300", type: 0 }],
    },
    method: "PATCH",
    reason: "Reviewed%20parent%20sync%20%2F%20case%2042",
    url: `${API_BASE_URL}/channels/200`,
  }])
})

test("Discord client validates full overwrite replacement and never retries or exposes a private cause", async () => {
  const privateDetail = "private-permission-sync-transport-detail"
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: privateDetail, retry_after: 0.001 }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.replaceChannelPermissionOverwrites(
      "200",
      [{ allow: "1024", deny: "0", id: "300", type: 0 }],
      "reviewed",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.equal(error.message.includes(privateDetail), false)
      assert.equal(error.cause, undefined)
      return true
    },
  )
  await assert.rejects(
    () => client.replaceChannelPermissionOverwrites(
      "200",
      [
        { allow: "0", deny: "0", id: "300", type: 0 },
        { allow: "0", deny: "0", id: "300", type: 1 },
      ],
      "reviewed",
    ),
    /duplicated/,
  )
  await assert.rejects(
    () => client.replaceChannelPermissionOverwrites(
      "200",
      [{ allow: "1024", deny: "1024", id: "300", type: 0 }],
      "reviewed",
    ),
    /must not overlap/,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client sends exact member moderation routes, bodies, and encoded reasons", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const method = init?.method || "GET"
      const url = String(input)
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({
        body,
        method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url,
      })
      if (method === "GET" && url.endsWith("/guilds/100")) {
        return jsonResponse({ id: "100", name: "guild", owner_id: "500" })
      }
      if (method === "GET" && url.endsWith("/users/400")) {
        return jsonResponse({ id: "400", username: "target" })
      }
      if (method === "GET") {
        return jsonResponse({ user: { id: "400", username: "target" } })
      }
      if (method === "PATCH") {
        return jsonResponse({
          communication_disabled_until: "2026-08-20T00:00:00.000Z",
          roles: [],
          user: { id: "400", username: "target" },
        })
      }
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })
  const reason = "Safety review / case 42"

  await client.getGuild("100")
  await client.getUser("400")
  await client.getGuildBan("100", "400")
  await client.removeGuildMember("100", "400", reason)
  await client.createGuildBan("100", "400", 3_600, reason)
  await client.removeGuildBan("100", "400", reason)
  await client.modifyGuildMemberTimeout(
    "100",
    "400",
    { communicationDisabledUntil: "2026-08-20T00:00:00.000Z" },
    reason,
  )

  assert.deepEqual(requests, [
    { body: null, method: "GET", reason: null, url: `${API_BASE_URL}/guilds/100` },
    { body: null, method: "GET", reason: null, url: `${API_BASE_URL}/users/400` },
    { body: null, method: "GET", reason: null, url: `${API_BASE_URL}/guilds/100/bans/400` },
    {
      body: null,
      method: "DELETE",
      reason: "Safety%20review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/members/400`,
    },
    {
      body: { delete_message_seconds: 3_600 },
      method: "PUT",
      reason: "Safety%20review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/bans/400`,
    },
    {
      body: null,
      method: "DELETE",
      reason: "Safety%20review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/bans/400`,
    },
    {
      body: { communication_disabled_until: "2026-08-20T00:00:00.000Z" },
      method: "PATCH",
      reason: "Safety%20review%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/members/400`,
    },
  ])
})

test("Discord client rejects invalid moderation parameters and audit reasons before fetching", async () => {
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
    () => client.createGuildBan("100", "400", 604_801, "reviewed"),
    /between 0 and 604800/,
  )
  assert.throws(
    () => client.modifyGuildMemberTimeout(
      "100",
      "400",
      { communicationDisabledUntil: "not-a-timestamp" },
      "reviewed",
    ),
    /ISO 8601 timestamp/,
  )
  await assert.rejects(
    () => client.removeGuildMember("100", "400", " "),
    /must not be blank/,
  )
  await assert.rejects(
    () => client.removeGuildMember("100", "400", "x".repeat(513)),
    /must not exceed 512 URL-encoded characters/,
  )
  await assert.rejects(
    () => client.removeGuildMember("100", "400", "\ud800"),
    /invalid Unicode/,
  )
  assert.equal(requests, 0)
})

test("Discord client never retries member moderation or leaks transport causes", async () => {
  let requests = 0
  let sleeps = 0
  const secret = "private-member-moderation-transport-cause"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      throw new Error(secret)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  const operations = [
    () => client.removeGuildMember("100", "400", "reviewed"),
    () => client.createGuildBan("100", "400", 0, "reviewed"),
    () => client.removeGuildBan("100", "400", "reviewed"),
    () => client.modifyGuildMemberTimeout(
      "100",
      "400",
      { communicationDisabledUntil: null },
      "reviewed",
    ),
  ]

  for (const operation of operations) {
    await assert.rejects(operation(), (error: Error) => {
      assert.doesNotMatch(error.message, new RegExp(secret))
      assert.equal(error.cause, undefined)
      return true
    })
  }
  assert.equal(requests, operations.length)
  assert.equal(sleeps, 0)
})

test("Discord client sends one exact bulk guild ban and projects its response partition", async () => {
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
        body: JSON.parse(String(init?.body)),
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({
        banned_users: ["402", "400"],
        failed_users: ["401"],
      })
    },
    token: TOKEN,
  })

  const result = await client.bulkGuildBan(
    "100",
    ["400", "401", "402"],
    3_600,
    "Safety review / case 42",
  )

  assert.deepEqual(result, {
    bannedUserIds: ["400", "402"],
    failedUserIds: ["401"],
  })
  assert.deepEqual(requests, [{
    body: {
      delete_message_seconds: 3_600,
      user_ids: ["400", "401", "402"],
    },
    method: "POST",
    reason: "Safety%20review%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/100/bulk-ban`,
  }])
})

test("Discord client accepts the full bulk guild ban target limit", async () => {
  const userIds = Array.from(
    { length: 200 },
    (_, index) => String(1_000 + index),
  )
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      banned_users: [...userIds].reverse(),
      failed_users: [],
    }),
    token: TOKEN,
  })

  const result = await client.bulkGuildBan("100", userIds, 0, "reviewed")

  assert.deepEqual(result.bannedUserIds, userIds)
  assert.deepEqual(result.failedUserIds, [])
})

test("Discord client rejects invalid bulk guild ban parameters before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ banned_users: [], failed_users: [] })
    },
    token: TOKEN,
  })
  const tooManyUserIds = Array.from(
    { length: 201 },
    (_, index) => String(1_000 + index),
  )
  const operations = [
    () => client.bulkGuildBan("100", ["400"], 0, "reviewed"),
    () => client.bulkGuildBan("100", tooManyUserIds, 0, "reviewed"),
    () => client.bulkGuildBan("100", ["400", "400"], 0, "reviewed"),
    () => client.bulkGuildBan("100", ["0", "401"], 0, "reviewed"),
    () => client.bulkGuildBan("100", ["400", "401"], 604_801, "reviewed"),
    () => client.bulkGuildBan("100", ["400", "401"], 0, " "),
  ]

  for (const operation of operations) await assert.rejects(operation())
  assert.equal(requests, 0)
})

test("Discord client rejects malformed bulk guild ban response partitions", async () => {
  const malformedResponses = [
    null,
    { banned_users: ["400"], failed_users: ["401"], future: true },
    { banned_users: ["400"] },
    { banned_users: "400", failed_users: ["401"] },
    { banned_users: ["400", "400"], failed_users: ["401"] },
    { banned_users: ["400"], failed_users: ["400", "401"] },
    { banned_users: ["400"], failed_users: [] },
    { banned_users: ["400"], failed_users: ["402"] },
    { banned_users: ["0"], failed_users: ["401"] },
  ]

  for (const response of malformedResponses) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(response),
      token: TOKEN,
    })
    await assert.rejects(
      () => client.bulkGuildBan("100", ["400", "401"], 0, "reviewed"),
      /invalid bulk guild ban evidence/,
    )
  }
})

test("Discord client never retries bulk guild bans and redacts sensitive failures", async () => {
  let rateLimitRequests = 0
  let sleeps = 0
  const rateLimitedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      rateLimitRequests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => rateLimitedClient.bulkGuildBan("100", ["400", "401"], 0, "reviewed"),
    (error: DiscordApiError) => {
      assert.equal(error.route, "/guilds/{guild.id}/bulk-ban")
      assert.equal(error.status, 429)
      return true
    },
  )
  assert.equal(rateLimitRequests, 1)
  assert.equal(sleeps, 0)

  const secret = "private-bulk-ban-transport-cause"
  const transportClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(secret)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    () => transportClient.bulkGuildBan("100", ["400", "401"], 0, "reviewed"),
    (error: Error) => {
      assert.doesNotMatch(error.message, new RegExp(secret))
      assert.doesNotMatch(error.message, /100|400|401/)
      assert.equal(error.cause, undefined)
      return true
    },
  )
})

test("Discord client reads and begins one exact guild prune contract", async () => {
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
        body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({ pruned: requests.length === 1 ? 4 : 3 })
    },
    token: TOKEN,
  })

  const estimate = await client.getGuildPruneCount("100", 14, ["402", "401"])
  const result = await client.beginGuildPrune(
    "100",
    14,
    ["402", "401"],
    "Safety review / case 42",
  )

  assert.deepEqual(estimate, { pruned: 4 })
  assert.deepEqual(result, { pruned: 3 })
  assert.deepEqual(requests, [{
    body: null,
    method: "GET",
    reason: null,
    url: `${API_BASE_URL}/guilds/100/prune?days=14&include_roles=402%2C401`,
  }, {
    body: {
      compute_prune_count: true,
      days: 14,
      include_roles: ["402", "401"],
    },
    method: "POST",
    reason: "Safety%20review%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/100/prune`,
  }])
})

test("Discord client omits an empty guild prune include-role field", async () => {
  let body: unknown
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return jsonResponse({ pruned: 0 })
    },
    token: TOKEN,
  })

  await client.beginGuildPrune("100", 7, [], "reviewed")

  assert.deepEqual(body, { compute_prune_count: true, days: 7 })
})

test("Discord client rejects malformed guild prune input and response evidence", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ pruned: 1 })
    },
    token: TOKEN,
  })
  const tooManyRoleIds = Array.from(
    { length: 101 },
    (_, index) => String(1_000 + index),
  )
  const invalid = [
    () => client.getGuildPruneCount("0", 14, []),
    () => client.getGuildPruneCount("100", 0, []),
    () => client.getGuildPruneCount("100", 31, []),
    () => client.getGuildPruneCount("100", 14, ["401", "401"]),
    () => client.getGuildPruneCount("100", 14, tooManyRoleIds),
    () => client.beginGuildPrune("100", 14, [], " "),
  ]
  for (const operation of invalid) await assert.rejects(operation())
  assert.equal(requests, 0)

  for (const response of [
    null,
    {},
    { pruned: -1 },
    { pruned: 1.5 },
    { pruned: 1, future: true },
  ]) {
    const malformedClient = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(response),
      token: TOKEN,
    })
    await assert.rejects(
      () => malformedClient.getGuildPruneCount("100", 14, []),
      /invalid guild prune evidence/,
    )
  }
})

test("Discord client never retries guild prune writes and redacts sensitive failures", async () => {
  let rateLimitRequests = 0
  let sleeps = 0
  const rateLimitedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      rateLimitRequests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => rateLimitedClient.beginGuildPrune("100", 14, ["401"], "reviewed"),
    (error: DiscordApiError) => {
      assert.equal(error.route, "/guilds/{guild.id}/prune")
      assert.equal(error.status, 429)
      return true
    },
  )
  assert.equal(rateLimitRequests, 1)
  assert.equal(sleeps, 0)

  const secret = "private-guild-prune-transport-cause"
  const transportClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(secret)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    () => transportClient.beginGuildPrune("100", 14, ["401"], "reviewed"),
    (error: Error) => {
      assert.doesNotMatch(error.message, new RegExp(secret))
      assert.doesNotMatch(error.message, /100|401|reviewed/)
      assert.equal(error.cause, undefined)
      return true
    },
  )
})

test("Discord client projects exact member voice state and sends one-field PATCH bodies", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const method = init?.method || "GET"
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({
        body,
        method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      if (method === "GET") {
        return jsonResponse({
          channel_id: "200",
          deaf: false,
          future_voice_field: { secret: "discarded" },
          guild_id: "100",
          member: { user: { id: "400", username: "discarded" } },
          mute: true,
          request_to_speak_timestamp: "2026-08-22T00:00:00.000Z",
          self_deaf: false,
          self_mute: false,
          self_stream: true,
          self_video: true,
          session_id: "discarded-session",
          suppress: false,
          user_id: "400",
        })
      }
      return jsonResponse({
        deaf: false,
        future_member_field: "discarded",
        mute: true,
        roles: [],
        user: { id: "400", username: "discarded" },
      })
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.getGuildVoiceState("100", "400"), {
    channelId: "200",
    deaf: false,
    guildId: "100",
    mute: true,
    unknownFieldCount: 1,
    userId: "400",
  })
  assert.deepEqual(await client.modifyGuildMemberVoice(
    "100",
    "400",
    { mute: true },
    "Reviewed voice / case 42",
  ), {
    deaf: false,
    mute: true,
    unknownFieldCount: 1,
    userId: "400",
  })
  assert.deepEqual(requests, [
    {
      body: null,
      method: "GET",
      reason: null,
      url: `${API_BASE_URL}/guilds/100/voice-states/400`,
    },
    {
      body: { mute: true },
      method: "PATCH",
      reason: "Reviewed%20voice%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/members/400`,
    },
  ])
})

test("Discord client rejects raw or ambiguous member voice evidence and never retries writes", async () => {
  let requests = 0
  let sleeps = 0
  const privateText = "private member voice transport detail"
  const malformed = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      channel_id: "200",
      deaf: false,
      guild_id: "100",
      mute: false,
      user_id: "401",
    }),
    token: TOKEN,
  })
  await assert.rejects(
    malformed.getGuildVoiceState("100", "400"),
    MemberVoiceEvidenceError,
  )
  await assert.rejects(
    malformed.modifyGuildMemberVoice(
      "100",
      "400",
      { mute: true, deaf: true } as never,
      "Reviewed voice",
    ),
    /exactly one field/,
  )
  const mismatchedUpdate = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      deaf: false,
      mute: true,
      user: { id: "401" },
    }),
    token: TOKEN,
  })
  await assert.rejects(
    mismatchedUpdate.modifyGuildMemberVoice(
      "100",
      "400",
      { mute: true },
      "Reviewed voice",
    ),
    MemberVoiceEvidenceError,
  )

  const transportFailure = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateText)
    },
    token: TOKEN,
  })
  await assert.rejects(
    transportFailure.getGuildVoiceState("100", "400"),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.equal(error.message.includes(privateText), false)
      assert.equal(error.cause, undefined)
      return true
    },
  )

  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.modifyGuildMemberVoice(
      "100",
      "400",
      { channelId: null },
      "Reviewed disconnect",
    ),
    (error: unknown) => {
      assert(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.equal(error.message.includes("rate limited"), false)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client projects current-user voice state and sets one exact status", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const method = init?.method || "GET"
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      if (method === "PUT") return new Response(null, { status: 204 })
      return jsonResponse({
        channel_id: "200",
        deaf: false,
        future_voice_field: "discarded",
        guild_id: "100",
        member: { user: { id: "400", username: "discarded" } },
        mute: false,
        session_id: "discarded-session",
        user_id: "400",
      })
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    sleep: async () => {
      throw new Error("Voice channel status PUT must not retry")
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.getCurrentUserVoiceState("100", "400"), {
    channelId: "200",
    deaf: false,
    guildId: "100",
    mute: false,
    unknownFieldCount: 1,
    userId: "400",
  })
  await client.setVoiceChannelStatus("200", "Incident room", "Reviewed status / case 42")
  await client.setVoiceChannelStatus("200", null, "Reviewed status removal")

  assert.deepEqual(requests, [
    {
      body: null,
      method: "GET",
      reason: null,
      url: `${API_BASE_URL}/guilds/100/voice-states/@me`,
    },
    {
      body: { status: "Incident room" },
      method: "PUT",
      reason: "Reviewed%20status%20%2F%20case%2042",
      url: `${API_BASE_URL}/channels/200/voice-status`,
    },
    {
      body: { status: null },
      method: "PUT",
      reason: "Reviewed%20status%20removal",
      url: `${API_BASE_URL}/channels/200/voice-status`,
    },
  ])
  assert.deepEqual(records.map(({ operation, retries }) => ({ operation, retries })), [
    { operation: "get_current_user_voice_state", retries: 0 },
    { operation: "set_voice_channel_status", retries: 0 },
    { operation: "set_voice_channel_status", retries: 0 },
  ])
})

test("Discord client validates and redacts voice channel status operations", async () => {
  let requests = 0
  let sleeps = 0
  const privateText = "private voice channel status"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  await assert.rejects(client.setVoiceChannelStatus("invalid", "status", "Reviewed"))
  await assert.rejects(
    client.setVoiceChannelStatus("200", "x".repeat(501), "Reviewed"),
    /1-500 trimmed characters without controls/,
  )
  for (const status of ["", " padded", "line\nbreak", "contains\0nul"]) {
    await assert.rejects(
      client.setVoiceChannelStatus("200", status, "Reviewed"),
      /1-500 trimmed characters without controls/,
    )
  }
  await assert.rejects(
    client.setVoiceChannelStatus("200", "\ud800", "Reviewed"),
    /invalid Unicode/,
  )
  await assert.rejects(
    client.setVoiceChannelStatus("200", "status", " "),
    /must not be blank/,
  )
  assert.equal(requests, 0)

  const unexpectedStatus = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ status: privateText }),
    token: TOKEN,
  })
  await assert.rejects(
    unexpectedStatus.setVoiceChannelStatus("200", privateText, "Reviewed"),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.match(error.message, /unexpected success status/)
      assert.equal(error.message.includes(privateText), false)
      assert.equal(error.cause, undefined)
      return true
    },
  )

  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: privateText, retry_after: 0.001 }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.setVoiceChannelStatus("200", privateText, "Reviewed"),
    (error: unknown) => {
      assert(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.equal(error.message.includes(privateText), false)
      assert.equal(error.cause, undefined)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)

  const readFailure = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateText)
    },
    token: TOKEN,
  })
  await assert.rejects(
    readFailure.getCurrentUserVoiceState("100", "400"),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.equal(error.message.includes(privateText), false)
      assert.equal(error.cause, undefined)
      return true
    },
  )
})

test("Discord client projects exact thread state and membership with one-field writes", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const method = init?.method || "GET"
      const url = String(input)
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url,
      })
      if (url.includes("/thread-members/") && method === "GET") {
        return jsonResponse({
          flags: 3,
          future_member_field: "discarded",
          id: "200",
          join_timestamp: "2026-08-20T00:00:00.000Z",
          user_id: "500",
        })
      }
      if (method === "PUT" || method === "DELETE") return new Response(null, { status: 204 })
      if (method === "PATCH") {
        return jsonResponse(threadStatePayload({
          name: "incident-review-renamed",
          thread_metadata: {
            archive_timestamp: "2026-08-22T00:00:00.000Z",
            archived: false,
            auto_archive_duration: 1_440,
            create_timestamp: "2026-08-21T00:00:00.000Z",
            invitable: true,
            locked: false,
          },
        }))
      }
      return jsonResponse(threadStatePayload())
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.getThreadState("200"), {
    archived: false,
    autoArchiveDuration: 1_440,
    guildId: "100",
    id: "200",
    invitable: true,
    locked: false,
    name: "incident-review",
    ownerId: "400",
    parentId: "300",
    rateLimitPerUser: 15,
    type: 12,
    unknownFieldCount: 1,
    unknownMetadataFieldCount: 0,
  })
  assert.deepEqual(await client.getThreadMember("200", "500"), {
    flags: 3,
    id: "200",
    join_timestamp: "2026-08-20T00:00:00.000Z",
    unknown_field_count: 1,
    user_id: "500",
  })
  assert.equal((await client.modifyThreadState(
    "200",
    { name: "incident-review-renamed" },
    "Reviewed thread / case 42",
  )).name, "incident-review-renamed")
  await client.addThreadMember("200", "500")
  await client.joinThread("200")
  await client.leaveThread("200")
  await client.removeThreadMember("200", "500")

  assert.deepEqual(requests, [
    {
      body: null,
      method: "GET",
      reason: null,
      url: `${API_BASE_URL}/channels/200`,
    },
    {
      body: null,
      method: "GET",
      reason: null,
      url: `${API_BASE_URL}/channels/200/thread-members/500?with_member=false`,
    },
    {
      body: { name: "incident-review-renamed" },
      method: "PATCH",
      reason: "Reviewed%20thread%20%2F%20case%2042",
      url: `${API_BASE_URL}/channels/200`,
    },
    {
      body: null,
      method: "PUT",
      reason: null,
      url: `${API_BASE_URL}/channels/200/thread-members/500`,
    },
    {
      body: null,
      method: "PUT",
      reason: null,
      url: `${API_BASE_URL}/channels/200/thread-members/@me`,
    },
    {
      body: null,
      method: "DELETE",
      reason: null,
      url: `${API_BASE_URL}/channels/200/thread-members/@me`,
    },
    {
      body: null,
      method: "DELETE",
      reason: null,
      url: `${API_BASE_URL}/channels/200/thread-members/500`,
    },
  ])
})

test("Discord client rejects malformed thread evidence and never retries governance writes", async () => {
  const malformed = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse(threadStatePayload({ guild_id: "101" })),
    token: TOKEN,
  })
  await assert.rejects(
    malformed.getThreadState("201"),
    ThreadGovernanceEvidenceError,
  )
  await assert.rejects(
    malformed.modifyThreadState(
      "200",
      { archived: true, locked: true } as never,
      "Reviewed thread",
    ),
    /exactly one field/,
  )

  const missingArchiveTimestamp = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse(threadStatePayload({
      thread_metadata: {
        archived: false,
        auto_archive_duration: 1_440,
        invitable: true,
        locked: false,
      },
    })),
    token: TOKEN,
  })
  await assert.rejects(
    missingArchiveTimestamp.getThreadState("200"),
    ThreadGovernanceEvidenceError,
  )

  const embeddedMember = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      flags: 0,
      id: "200",
      join_timestamp: "2026-08-20T00:00:00.000Z",
      member: { user: { id: "500", username: "private" } },
      user_id: "500",
    }),
    token: TOKEN,
  })
  await assert.rejects(
    embeddedMember.getThreadMember("200", "500"),
    ThreadGovernanceEvidenceError,
  )

  const missingJoinTimestamp = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      flags: 0,
      id: "200",
      user_id: "500",
    }),
    token: TOKEN,
  })
  await assert.rejects(
    missingJoinTimestamp.getThreadMember("200", "500"),
    ThreadGovernanceEvidenceError,
  )

  let requests = 0
  let sleeps = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "private thread failure", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.addThreadMember("200", "500"),
    (error: unknown) => {
      assert(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.equal(error.message.includes("private thread failure"), false)
      return true
    },
  )
  await assert.rejects(
    rateLimited.joinThread("200"),
    (error: unknown) => {
      assert(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.equal(error.message.includes("private thread failure"), false)
      return true
    },
  )
  await assert.rejects(
    rateLimited.leaveThread("200"),
    (error: unknown) => {
      assert(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.equal(error.message.includes("private thread failure"), false)
      return true
    },
  )
  assert.equal(requests, 3)
  assert.equal(sleeps, 0)
})

test("Discord client sends narrow channel creation bodies and encoded audit reasons", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({
        body,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({
        guild_id: "100",
        id: requests.length === 1 ? "201" : "202",
        name: body.name,
        parent_id: body.parent_id ?? null,
        type: body.type,
      })
    },
    token: TOKEN,
  })

  await client.createGuildChannel("100", {
    defaultAutoArchiveDuration: 1_440,
    name: "customer-help",
    nsfw: false,
    parentId: "200",
    rateLimitPerUser: 30,
    topic: "Reviewed support queue",
    type: 0,
  }, "Support / case 42")
  await client.createGuildChannel("100", {
    name: "Support",
    type: 4,
  }, "Support / case 42")

  assert.deepEqual(requests, [
    {
      body: {
        default_auto_archive_duration: 1_440,
        name: "customer-help",
        nsfw: false,
        parent_id: "200",
        rate_limit_per_user: 30,
        topic: "Reviewed support queue",
        type: 0,
      },
      method: "POST",
      reason: "Support%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/channels`,
    },
    {
      body: { name: "Support", type: 4 },
      method: "POST",
      reason: "Support%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/channels`,
    },
  ])
})

test("Discord client never retries a rate-limited channel creation", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        message: "rate limited",
        retry_after: 0.001,
      }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.createGuildChannel(
      "100",
      { name: "customer-help", type: 0 },
      "Reviewed support queue",
    ),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && error.retryAfterMs === 1
    ),
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client sends one complete atomically cloneable forum body", async () => {
  let body: unknown = null
  const topic = "f".repeat(1_024)
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      return jsonResponse({ guild_id: "100", id: "201", name: "reviewed-copy", type: 15 })
    },
    token: TOKEN,
  })

  await client.createGuildChannel("100", {
    availableTags: [
      {
        emojiId: null,
        emojiName: "📌",
        moderated: true,
        name: "Pinned",
      },
      {
        emojiId: "300",
        emojiName: null,
        moderated: false,
        name: "Custom",
      },
    ],
    defaultAutoArchiveDuration: 4_320,
    defaultForumLayout: 2,
    defaultReactionEmoji: { emojiId: null, emojiName: "✅" },
    defaultSortOrder: 1,
    defaultThreadRateLimitPerUser: 7,
    flags: 16,
    name: "reviewed-copy",
    nsfw: false,
    parentId: "200",
    permissionOverwrites: [{ allow: "1024", deny: "0", id: "100", type: 0 }],
    rateLimitPerUser: 5,
    topic,
    type: 15,
  }, "Reviewed forum clone")

  assert.deepEqual(body, {
    available_tags: [
      {
        emoji_id: null,
        emoji_name: "📌",
        moderated: true,
        name: "Pinned",
      },
      {
        emoji_id: "300",
        emoji_name: null,
        moderated: false,
        name: "Custom",
      },
    ],
    default_auto_archive_duration: 4_320,
    default_forum_layout: 2,
    default_reaction_emoji: { emoji_id: null, emoji_name: "✅" },
    default_sort_order: 1,
    default_thread_rate_limit_per_user: 7,
    flags: 16,
    name: "reviewed-copy",
    nsfw: false,
    parent_id: "200",
    permission_overwrites: [{ allow: "1024", deny: "0", id: "100", type: 0 }],
    rate_limit_per_user: 5,
    topic,
    type: 15,
  })
})

test("Discord client sends one narrow forum-post body with fixed telemetry", async () => {
  let request: {
    body: unknown
    method: string
    reason: string | null
    url: string
  } | null = null
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      request = {
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      }
      return jsonResponse({
        guild_id: "100",
        id: "300",
        message: {
          author: { bot: true, id: "400", username: "connector" },
          channel_id: "300",
          content: "Reviewed body",
          guild_id: "100",
          id: "300",
          timestamp: "2026-08-20T00:00:00.000Z",
          type: 0,
        },
        name: "Reviewed post",
        owner_id: "400",
        parent_id: "200",
        type: 11,
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await client.createForumPost("200", {
    allowedMentions: { replied_user: false, users: ["500"] },
    appliedTagIds: ["600"],
    autoArchiveDuration: 1_440,
    content: "Reviewed body",
    name: "Reviewed post",
    rateLimitPerUser: 15,
  }, "Support / case 42")

  assert.deepEqual(request, {
    body: {
      applied_tags: ["600"],
      auto_archive_duration: 1_440,
      message: {
        allowed_mentions: { replied_user: false, users: ["500"] },
        content: "Reviewed body",
      },
      name: "Reviewed post",
      rate_limit_per_user: 15,
    },
    method: "POST",
    reason: "Support%20%2F%20case%2042",
    url: `${API_BASE_URL}/channels/200/threads`,
  })
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "create_forum_post",
    retries: 0,
    runs: 1,
  }])
  assert.equal(JSON.stringify(records).includes("200"), false)
})

test("Discord client never retries a rate-limited forum post", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.createForumPost("200", {
      allowedMentions: { parse: [], replied_user: false },
      content: "Reviewed body",
      name: "Reviewed post",
    }, "Reviewed forum post"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && error.retryAfterMs === 1
    ),
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects invalid forum-post inputs before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  const valid = {
    allowedMentions: { parse: [], replied_user: false } as const,
    content: "Reviewed body",
    name: "Reviewed post",
  }

  assert.throws(() => client.createForumPost("invalid", valid, "reviewed"), /channel ID/)
  assert.throws(
    () => client.createForumPost("200", { ...valid, name: " reviewed" }, "reviewed"),
    /forum-post name/,
  )
  assert.throws(
    () => client.createForumPost("200", { ...valid, content: "" }, "reviewed"),
    /must not be blank/,
  )
  assert.throws(
    () => client.createForumPost("200", { ...valid, appliedTagIds: [] }, "reviewed"),
    /tag IDs/,
  )
  assert.throws(
    () => client.createForumPost("200", { ...valid, autoArchiveDuration: 30 }, "reviewed"),
    /auto-archive/,
  )
  assert.throws(
    () => client.createForumPost("200", { ...valid, rateLimitPerUser: 21_601 }, "reviewed"),
    /slowmode/,
  )
  assert.throws(
    () => client.createForumPost("200", {
      ...valid,
      allowedMentions: {
        parse: [],
        replied_user: false,
        roles: ["500"],
      },
    } as unknown as CreateForumPostInput, "reviewed"),
    /parsing must be empty/,
  )
  assert.throws(
    () => client.createForumPost("200", {
      ...valid,
      allowedMentions: { parse: [], replied_user: "false" },
    } as unknown as CreateForumPostInput, "reviewed"),
    /must be a boolean/,
  )
  assert.throws(
    () => client.createForumPost("200", null as unknown as CreateForumPostInput, "reviewed"),
    /input must be an object/,
  )
  assert.throws(() => client.createForumPost("200", valid, ""), /must not be blank/)
  assert.equal(requests, 0)
})

test("Discord client sends exact non-retried anchored and standalone thread contracts", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({
        guild_id: "100",
        id: requests.length === 1 ? "300" : "301",
        name: requests.length === 1 ? "Anchored" : "Private",
        owner_id: "400",
        parent_id: "200",
        type: requests.length === 1 ? 11 : 12,
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await client.createThreadFromMessage("200", "300", {
    autoArchiveDuration: 1_440,
    name: "Anchored",
    rateLimitPerUser: 15,
  }, "Reviewed anchored thread")
  await client.createThreadWithoutMessage("200", {
    autoArchiveDuration: 4_320,
    invitable: false,
    name: "Private",
    rateLimitPerUser: 30,
    type: 12,
  }, "Reviewed private thread")

  assert.deepEqual(requests, [{
    body: {
      auto_archive_duration: 1_440,
      name: "Anchored",
      rate_limit_per_user: 15,
    },
    method: "POST",
    reason: "Reviewed%20anchored%20thread",
    url: `${API_BASE_URL}/channels/200/messages/300/threads`,
  }, {
    body: {
      auto_archive_duration: 4_320,
      invitable: false,
      name: "Private",
      rate_limit_per_user: 30,
      type: 12,
    },
    method: "POST",
    reason: "Reviewed%20private%20thread",
    url: `${API_BASE_URL}/channels/200/threads`,
  }])
  assert.deepEqual(records.map((record) => record.operation), [
    "create_thread_from_message",
    "create_thread_without_message",
  ])
  assert.equal(records.every((record) => record.retries === 0), true)
})

test("Discord client validates exact thread inputs before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  const anchored: CreateThreadFromMessageInput = {
    autoArchiveDuration: 1_440,
    name: "Reviewed",
    rateLimitPerUser: 0,
  }
  const standalone: CreateThreadWithoutMessageInput = {
    ...anchored,
    type: 11,
  }

  assert.throws(
    () => client.createThreadFromMessage("bad", "300", anchored, "reviewed"),
    /parent channel ID/,
  )
  assert.throws(
    () => client.createThreadFromMessage("200", "bad", anchored, "reviewed"),
    /source message ID/,
  )
  assert.throws(
    () => client.createThreadFromMessage("200", "300", { ...anchored, name: " reviewed" }, "reviewed"),
    /thread name/,
  )
  assert.throws(
    () => client.createThreadFromMessage("200", "300", { ...anchored, autoArchiveDuration: 30 }, "reviewed"),
    /auto-archive/,
  )
  assert.throws(
    () => client.createThreadWithoutMessage("200", { ...standalone, type: 10 }, "reviewed"),
    /type is not supported/,
  )
  assert.throws(
    () => client.createThreadWithoutMessage("200", { ...standalone, invitable: false }, "reviewed"),
    /public thread creation does not accept invitable/,
  )
  assert.throws(
    () => client.createThreadWithoutMessage("200", { ...standalone, type: 12 }, "reviewed"),
    /requires explicit invitable/,
  )
  assert.throws(
    () => client.createThreadWithoutMessage(
      "200",
      null as unknown as CreateThreadWithoutMessageInput,
      "reviewed",
    ),
    /input must be an object/,
  )
  assert.equal(requests, 0)
})

test("Discord client sends current role creation and exact lookup contracts", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({
        body,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({
        color: 3_447_003,
        colors: {
          primary_color: 3_447_003,
          secondary_color: null,
          tertiary_color: null,
        },
        flags: 0,
        hoist: false,
        id: "300",
        managed: false,
        mentionable: false,
        name: "Support",
        permissions: "3072",
        position: 1,
      })
    },
    token: TOKEN,
  })

  await client.createGuildRole("100", {
    hoist: false,
    mentionable: false,
    name: "Support",
    permissions: "3072",
    primaryColor: 3_447_003,
  }, "Support / case 42")
  await client.getGuildRole("100", "300")

  assert.deepEqual(requests, [
    {
      body: {
        colors: {
          primary_color: 3_447_003,
          secondary_color: null,
          tertiary_color: null,
        },
        hoist: false,
        mentionable: false,
        name: "Support",
        permissions: "3072",
      },
      method: "POST",
      reason: "Support%20%2F%20case%2042",
      url: `${API_BASE_URL}/guilds/100/roles`,
    },
    {
      body: null,
      method: "GET",
      reason: null,
      url: `${API_BASE_URL}/guilds/100/roles/300`,
    },
  ])
})

test("Discord client never retries rate-limited role creation", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.createGuildRole("100", {
      hoist: false,
      mentionable: false,
      name: "Support",
      permissions: "0",
      primaryColor: 0,
    }, "Reviewed support role"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

function roleIconPng(): Uint8Array {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const u32 = (value: number) => {
    const result = Buffer.alloc(4)
    result.writeUInt32BE(value)
    return result
  }
  const chunk = (type: string, data = Buffer.alloc(0)) => Buffer.concat([
    u32(data.byteLength),
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(64, 0)
  header.writeUInt32BE(64, 4)
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IEND")])
}

test("Discord client reads exact role-member counts and sends one narrow role PATCH", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({
        body,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      if (init?.method === "PATCH") {
        return jsonResponse({
          color: 1,
          colors: {
            primary_color: 1,
            secondary_color: 2,
            tertiary_color: null,
          },
          flags: 0,
          hoist: true,
          id: "300",
          managed: false,
          mentionable: false,
          name: "Support",
          permissions: "3072",
          position: 1,
        })
      }
      return jsonResponse({ 300: 5, 200: 0 })
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.getGuildRoleMemberCounts("100"), {
    200: 0,
    300: 5,
  })
  await client.modifyGuildRole("100", "300", {
    colors: {
      primaryColor: 1,
      secondaryColor: 2,
      tertiaryColor: null,
    },
    hoist: true,
    name: "Support",
    permissions: "3072",
  }, "Support / reviewed")

  assert.deepEqual(requests, [
    {
      body: null,
      method: "GET",
      reason: null,
      url: `${API_BASE_URL}/guilds/100/roles/member-counts`,
    },
    {
      body: {
        colors: {
          primary_color: 1,
          secondary_color: 2,
          tertiary_color: null,
        },
        hoist: true,
        name: "Support",
        permissions: "3072",
      },
      method: "PATCH",
      reason: "Support%20%2F%20reviewed",
      url: `${API_BASE_URL}/guilds/100/roles/300`,
    },
  ])
})

test("Discord client serializes exact mutually exclusive role icon intents", async () => {
  const bodies: unknown[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : null)
      return jsonResponse({})
    },
    token: TOKEN,
  })
  const bytes = roleIconPng()
  await client.modifyGuildRole("100", "300", {
    roleIcon: { bytes, format: "png", kind: "image" },
  }, "Reviewed image")
  await client.modifyGuildRole("100", "300", {
    roleIcon: { kind: "unicode", value: "🛡️" },
  }, "Reviewed emoji")
  await client.modifyGuildRole("100", "300", {
    roleIcon: { kind: "clear" },
  }, "Reviewed clear")
  assert.deepEqual(bodies, [
    {
      icon: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      unicode_emoji: null,
    },
    { icon: null, unicode_emoji: "🛡️" },
    { icon: null, unicode_emoji: null },
  ])
})

test("Discord client projects command-role dependencies and sends one exact role DELETE", async () => {
  const requests: Array<{
    authorization: string | null
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      return jsonResponse([{
        application_id: "100",
        guild_id: "200",
        id: "300",
        permissions: [{ id: "400", permission: true, type: 1 }],
      }])
    },
    token: TOKEN,
  })

  assert.deepEqual(
    await client.listGuildApplicationCommandPermissions("100", "200"),
    [{
      applicationId: "100",
      commandId: "300",
      guildId: "200",
      permissions: [{
        allowed: true,
        id: "400",
        type: 1,
        unknownFieldCount: 0,
      }],
      unknownFieldCount: 0,
    }],
  )
  await client.deleteGuildRole("200", "400", "Retire role / reviewed")

  assert.deepEqual(requests, [{
    authorization: `Bot ${TOKEN}`,
    method: "GET",
    reason: null,
    url: `${API_BASE_URL}/applications/100/guilds/200/commands/permissions`,
  }, {
    authorization: `Bot ${TOKEN}`,
    method: "DELETE",
    reason: "Retire%20role%20%2F%20reviewed",
    url: `${API_BASE_URL}/guilds/200/roles/400`,
  }])
})

test("Discord client fails closed on command-permission drift and never retries role deletion", async () => {
  const drift = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse([{
      application_id: "100",
      future_command_field: true,
      guild_id: "200",
      id: "300",
      permissions: [{
        future_permission_field: true,
        id: "400",
        permission: true,
        type: 1,
      }],
    }]),
    token: TOKEN,
  })
  assert.deepEqual(
    await drift.listGuildApplicationCommandPermissions("100", "200"),
    [{
      applicationId: "100",
      commandId: "300",
      guildId: "200",
      permissions: [{
        allowed: true,
        id: "400",
        type: 1,
        unknownFieldCount: 1,
      }],
      unknownFieldCount: 1,
    }],
  )

  for (const body of [
    [{ application_id: "999", guild_id: "200", id: "300", permissions: [] }],
    [{ application_id: "100", guild_id: "999", id: "300", permissions: [] }],
    [
      { application_id: "100", guild_id: "200", id: "300", permissions: [] },
      { application_id: "100", guild_id: "200", id: "300", permissions: [] },
    ],
  ]) {
    const malformed = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(body),
      token: TOKEN,
    })
    await assert.rejects(
      malformed.listGuildApplicationCommandPermissions("100", "200"),
      /invalid application-command permission evidence/,
    )
  }

  let requests = 0
  let sleeps = 0
  const limited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    limited.deleteGuildRole("200", "400", "reviewed"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client sends one exact role-position PATCH and returns the complete response", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const roles = [
    { flags: 0, hoist: false, id: "100", managed: false, mentionable: false, name: "@everyone", permissions: "0", position: 0 },
    { flags: 0, hoist: false, id: "300", managed: false, mentionable: false, name: "Support", permissions: "0", position: 1 },
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse(roles, 200)
    },
    maxRetries: 3,
    token: TOKEN,
  })

  assert.deepEqual(
    await client.modifyGuildRolePositions(
      "100",
      [{ id: "300", position: 1 }],
      "Reviewed hierarchy / case 42",
    ),
    roles,
  )
  assert.deepEqual(requests, [{
    body: [{ id: "300", position: 1 }],
    method: "PATCH",
    reason: "Reviewed%20hierarchy%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/100/roles`,
  }])
})

test("Discord client rejects unsafe role-position contracts before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([])
    },
    token: TOKEN,
  })

  assert.throws(
    () => client.modifyGuildRolePositions("invalid", [{ id: "300", position: 1 }], "reviewed"),
    /guild ID/,
  )
  assert.throws(
    () => client.modifyGuildRolePositions("100", [], "reviewed"),
    /must contain/,
  )
  assert.throws(
    () => client.modifyGuildRolePositions("100", [
      { id: "300", position: 1 },
      { id: "300", position: 2 },
    ], "reviewed"),
    /invalid entry/,
  )
  assert.throws(
    () => client.modifyGuildRolePositions("100", [{ id: "bad", position: 1 }], "reviewed"),
    /invalid entry/,
  )
  assert.throws(
    () => client.modifyGuildRolePositions("100", [{ id: "300", position: -1 }], "reviewed"),
    /invalid entry/,
  )
  assert.throws(
    () => client.modifyGuildRolePositions(
      "100",
      [{ id: "300", position: 1, future: true } as never],
      "reviewed",
    ),
    /invalid entry/,
  )
  assert.equal(requests, 0)
})

test("Discord client requires exact role-position success and never retries or leaks causes", async () => {
  let requests = 0
  let sleeps = 0
  const secret = "private-role-order-transport-cause"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      throw new Error(secret)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    client.modifyGuildRolePositions("100", [{ id: "300", position: 1 }], "reviewed"),
    (error: Error) => {
      assert.doesNotMatch(error.message, new RegExp(secret))
      assert.equal(error.cause, undefined)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)

  const wrongStatus = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(null, { status: 204 }),
    token: TOKEN,
  })
  await assert.rejects(
    wrongStatus.modifyGuildRolePositions("100", [{ id: "300", position: 1 }], "reviewed"),
    /PATCH \/guilds\/\{guild.id\}\/roles returned an unexpected success status/,
  )
})

test("Discord client sends one exact channel-position PATCH and requires empty 204", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return new Response(null, { status: 204 })
    },
    maxRetries: 3,
    token: TOKEN,
  })

  await client.modifyGuildChannelPositions(
    "100",
    [
      {
        id: "300",
        lockPermissions: false,
        parentId: "400",
        position: 0,
      },
      { id: "301", position: 1 },
    ],
    "Reviewed channel order / case 42",
  )

  assert.deepEqual(requests, [{
    body: [
      {
        id: "300",
        lock_permissions: false,
        parent_id: "400",
        position: 0,
      },
      { id: "301", position: 1 },
    ],
    method: "PATCH",
    reason: "Reviewed%20channel%20order%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/100/channels`,
  }])
})

test("Discord client rejects unsafe channel-position contracts before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  assert.throws(
    () => client.modifyGuildChannelPositions("invalid", [{ id: "300", position: 0 }], "reviewed"),
    /guild ID/,
  )
  assert.throws(
    () => client.modifyGuildChannelPositions("100", [], "reviewed"),
    /must contain/,
  )
  assert.throws(
    () => client.modifyGuildChannelPositions("100", [
      { id: "300", position: 0 },
      { id: "300", position: 1 },
    ], "reviewed"),
    /invalid entry/,
  )
  assert.throws(
    () => client.modifyGuildChannelPositions("100", [{ id: "bad", position: 0 }], "reviewed"),
    /invalid entry/,
  )
  assert.throws(
    () => client.modifyGuildChannelPositions("100", [{ id: "300", position: -1 }], "reviewed"),
    /invalid entry/,
  )
  assert.throws(
    () => client.modifyGuildChannelPositions(
      "100",
      [{ id: "300", parentId: "400", position: 0 } as never],
      "reviewed",
    ),
    /invalid entry/,
  )
  assert.throws(
    () => client.modifyGuildChannelPositions(
      "100",
      [{
        id: "300",
        lockPermissions: true,
        parentId: "400",
        position: 0,
      } as never],
      "reviewed",
    ),
    /invalid parent change/,
  )
  assert.throws(
    () => client.modifyGuildChannelPositions(
      "100",
      [
        {
          id: "300",
          lockPermissions: false,
          parentId: "400",
          position: 0,
        },
        {
          id: "301",
          lockPermissions: false,
          parentId: null,
          position: 1,
        },
      ],
      "reviewed",
    ),
    /invalid parent change/,
  )
  assert.equal(requests, 0)
})

test("Discord client never retries channel ordering or leaks transport causes", async () => {
  let requests = 0
  let sleeps = 0
  const secret = "private-channel-order-transport-cause"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      throw new Error(secret)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    client.modifyGuildChannelPositions("100", [{ id: "300", position: 0 }], "reviewed"),
    (error: Error) => {
      assert.doesNotMatch(error.message, new RegExp(secret))
      assert.equal(error.cause, undefined)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)

  const wrongStatus = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({}, 200),
    token: TOKEN,
  })
  await assert.rejects(
    wrongStatus.modifyGuildChannelPositions("100", [{ id: "300", position: 0 }], "reviewed"),
    /PATCH \/guilds\/\{guild.id\}\/channels returned an unexpected success status/,
  )
})

test("Discord client deletes one exact guild channel with an encoded reason", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
    url: string
  }> = []
  const deleted = {
    guild_id: "100",
    id: "200",
    name: "retired-channel",
    parent_id: "300",
    permission_overwrites: [],
    position: 4,
    type: 0,
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: init?.body ?? null,
        method: init?.method || "GET",
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse(deleted)
    },
    maxRetries: 3,
    token: TOKEN,
  })

  assert.deepEqual(
    await client.deleteGuildChannel("200", "Reviewed retirement / case 42"),
    deleted,
  )
  assert.deepEqual(requests, [{
    body: null,
    method: "DELETE",
    reason: "Reviewed%20retirement%20%2F%20case%2042",
    url: `${API_BASE_URL}/channels/200`,
  }])
})

test("Discord client validates channel deletion and never retries or leaks causes", async () => {
  let requests = 0
  let sleeps = 0
  const secret = "private-channel-deletion-transport-cause"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      throw new Error(secret)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  assert.throws(
    () => client.deleteGuildChannel("invalid", "reviewed"),
    /channel ID/,
  )
  await assert.rejects(
    client.deleteGuildChannel("200", "reviewed"),
    (error: Error) => {
      assert.doesNotMatch(error.message, new RegExp(secret))
      assert.equal(error.cause, undefined)
      return true
    },
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects malformed role configuration evidence and input", async () => {
  let requests = 0
  const malformed = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ 0: 1 })
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => malformed.getGuildRoleMemberCounts("100"),
    RoleConfigurationEvidenceError,
  )

  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  assert.throws(
    () => client.modifyGuildRole("100", "300", {}, "reviewed"),
    /requires supported explicit fields/,
  )
  assert.throws(
    () => client.modifyGuildRole("100", "300", {
      colors: { primaryColor: 1, secondaryColor: null } as never,
    }, "reviewed"),
    /complete exact object/,
  )
  assert.throws(
    () => client.modifyGuildRole("100", "300", { permissions: "01" }, "reviewed"),
    /canonical decimal/,
  )
  assert.throws(
    () => client.modifyGuildRole("100", "300", {
      roleIcon: { kind: "unicode", value: "not emoji" },
    }, "reviewed"),
    /one NFC emoji grapheme/,
  )
  assert.throws(
    () => client.modifyGuildRole("100", "300", {
      roleIcon: { bytes: roleIconPng(), format: "jpeg", kind: "image" },
    }, "reviewed"),
    /format does not match/,
  )
  assert.throws(
    () => client.modifyGuildRole("invalid", "300", { hoist: false }, "reviewed"),
    /guild ID/,
  )
  assert.throws(
    () => client.modifyGuildRole("100", "300", { future: true } as never, "reviewed"),
    /supported explicit fields/,
  )
  assert.equal(requests, 1)
})

test("Discord client projects strict Welcome Screen reads and unknown-field counts", async () => {
  let requestUrl = ""
  let method = ""
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requestUrl = String(input)
      method = init?.method || "GET"
      return jsonResponse({
        description: "Welcome",
        future_top_level: "omitted",
        welcome_channels: [{
          channel_id: "200",
          description: "Read the rules",
          emoji_id: "300",
          emoji_name: "wave",
          future_channel_field: "omitted",
        }, {
          channel_id: "201",
          description: "Say hello",
          emoji_id: null,
          emoji_name: "👋",
        }],
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const result = await client.getGuildWelcomeScreen("100")

  assert.equal(requestUrl, `${API_BASE_URL}/guilds/100/welcome-screen`)
  assert.equal(method, "GET")
  assert.deepEqual(result, {
    description: "Welcome",
    unknownFieldCount: 1,
    welcomeChannels: [{
      channelId: "200",
      description: "Read the rules",
      emojiId: "300",
      emojiName: "wave",
      unknownFieldCount: 1,
    }, {
      channelId: "201",
      description: "Say hello",
      emojiId: null,
      emojiName: "👋",
      unknownFieldCount: 0,
    }],
  })
  assert.equal(records[0]?.operation, "get_guild_welcome_screen")
})

test("Discord client sends one exact non-retried Welcome Screen PATCH", async () => {
  let requests = 0
  let requestBody: unknown
  let auditReason = ""
  let method = ""
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      requests += 1
      method = init?.method || "GET"
      auditReason = new Headers(init?.headers).get("X-Audit-Log-Reason") || ""
      requestBody = JSON.parse(String(init?.body))
      return jsonResponse({
        description: "Welcome",
        welcome_channels: [{
          channel_id: "200",
          description: "Read the rules",
          emoji_id: "300",
          emoji_name: "wave",
        }],
      })
    },
    maxRetries: 3,
    token: TOKEN,
  })

  const result = await client.modifyGuildWelcomeScreen("100", {
    description: "Welcome",
    enabled: true,
    welcomeChannels: [{
      channelId: "200",
      description: "Read the rules",
      emojiId: "300",
      emojiName: "wave",
    }],
  }, "Reviewed Welcome Screen / launch")

  assert.equal(requests, 1)
  assert.equal(method, "PATCH")
  assert.equal(auditReason, "Reviewed%20Welcome%20Screen%20%2F%20launch")
  assert.deepEqual(requestBody, {
    description: "Welcome",
    enabled: true,
    welcome_channels: [{
      channel_id: "200",
      description: "Read the rules",
      emoji_id: "300",
      emoji_name: "wave",
    }],
  })
  assert.equal(result.welcomeChannels[0]?.channelId, "200")

  requests = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        code: 20_016,
        message: "rate limited",
        retry_after: 0,
      }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.modifyGuildWelcomeScreen("100", {
      description: null,
      enabled: false,
      welcomeChannels: [],
    }, "Reviewed"),
    DiscordApiError,
  )
  assert.equal(requests, 1)
})

test("Discord client distinguishes an absent Welcome Screen from other failures", async () => {
  const absent = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      code: 10_069,
      message: "Unknown Guild Welcome Screen",
    }, 404),
    token: TOKEN,
  })
  assert.equal(await absent.getGuildWelcomeScreen("100"), null)

  const otherFailure = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      code: 10_004,
      message: "Unknown Guild",
    }, 404),
    token: TOKEN,
  })
  await assert.rejects(otherFailure.getGuildWelcomeScreen("100"), DiscordApiError)
})

test("Discord client rejects malformed Welcome Screen evidence and inputs", async () => {
  let requests = 0
  const malformed = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        description: "Welcome",
        welcome_channels: [{
          channel_id: "200",
          description: "Read the rules",
          emoji_id: "300",
          emoji_name: null,
        }],
      })
    },
    token: TOKEN,
  })
  await assert.rejects(
    malformed.getGuildWelcomeScreen("100"),
    WelcomeScreenEvidenceError,
  )

  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ description: null, welcome_channels: [] })
    },
    token: TOKEN,
  })
  await assert.rejects(
    client.modifyGuildWelcomeScreen("100", {
      description: " not trimmed",
      enabled: true,
      welcomeChannels: [],
    }, "Reviewed"),
    /description is invalid/,
  )
  await assert.rejects(
    client.modifyGuildWelcomeScreen("100", {
      description: null,
      enabled: true,
      welcomeChannels: [{
        channelId: "200",
        description: "Read\nthe rules",
        emojiId: null,
        emojiName: null,
      }],
    }, "Reviewed"),
    /channel description is invalid/,
  )
  await assert.rejects(
    client.modifyGuildWelcomeScreen("100", {
      description: null,
      enabled: true,
      welcomeChannels: [{
        channelId: "200",
        description: "Read the rules",
        emojiId: "300",
        emojiName: null,
      }],
    } as unknown as Parameters<DiscordClient["modifyGuildWelcomeScreen"]>[1], "Reviewed"),
    /channel input is invalid/,
  )
  assert.equal(requests, 1)
})

test("Discord client projects exact authenticated widget settings without public data", async () => {
  let requestUrl = ""
  let method = ""
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requestUrl = String(input)
      method = init?.method || "GET"
      return jsonResponse({
        channel_id: "200",
        enabled: true,
        future_field: "omitted",
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const result = await client.getGuildWidgetSettings("100")

  assert.equal(requestUrl, `${API_BASE_URL}/guilds/100/widget`)
  assert.equal(method, "GET")
  assert.deepEqual(result, {
    channelId: "200",
    enabled: true,
    unknownFieldCount: 1,
  })
  assert.equal(records[0]?.operation, "get_guild_widget_settings")
  assert.equal(JSON.stringify(result).includes("future_field"), false)
})

test("Discord client sends one complete non-retried widget-settings PATCH", async () => {
  let requests = 0
  let requestBody: unknown
  let auditReason = ""
  let method = ""
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      requests += 1
      method = init?.method || "GET"
      auditReason = new Headers(init?.headers).get("X-Audit-Log-Reason") || ""
      requestBody = JSON.parse(String(init?.body))
      return jsonResponse({ channel_id: "200", enabled: true })
    },
    maxRetries: 3,
    token: TOKEN,
  })

  const result = await client.modifyGuildWidgetSettings("100", {
    channelId: "200",
    enabled: true,
  }, "Reviewed widget / launch")

  assert.equal(requests, 1)
  assert.equal(method, "PATCH")
  assert.equal(auditReason, "Reviewed%20widget%20%2F%20launch")
  assert.deepEqual(requestBody, { channel_id: "200", enabled: true })
  assert.equal(result.channelId, "200")

  let sleeps = 0
  requests = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        code: 20_016,
        message: "rate limited",
        retry_after: 0,
      }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.modifyGuildWidgetSettings("100", {
      channelId: null,
      enabled: false,
    }, "Reviewed"),
    DiscordApiError,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects malformed widget-settings evidence and inputs", async () => {
  let requests = 0
  const malformed = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ channel_id: "invalid", enabled: true })
    },
    token: TOKEN,
  })
  await assert.rejects(
    malformed.getGuildWidgetSettings("100"),
    WidgetSettingsEvidenceError,
  )

  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ channel_id: null, enabled: false })
    },
    token: TOKEN,
  })
  await assert.rejects(
    client.modifyGuildWidgetSettings("100", {
      channelId: "bad",
      enabled: true,
    }, "Reviewed"),
    /widget channel ID/,
  )
  await assert.rejects(
    client.modifyGuildWidgetSettings("100", {
      channelId: null,
      enabled: true,
      future: true,
    } as never, "Reviewed"),
    /input is invalid/,
  )
  assert.equal(requests, 1)
})

test("Discord client sends one sparse non-retried guild-settings PATCH", async () => {
  let requests = 0
  let requestUrl = ""
  let requestBody: unknown
  let auditReason = ""
  let method = ""
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests += 1
      requestUrl = String(input)
      method = init?.method || "GET"
      auditReason = new Headers(init?.headers).get("X-Audit-Log-Reason") || ""
      requestBody = JSON.parse(String(init?.body))
      return jsonResponse({
        afk_channel_id: "300",
        afk_timeout: 300,
        default_message_notifications: 1,
        explicit_content_filter: 2,
        features: [],
        id: "100",
        name: "Private Guild",
        owner_id: "200",
        premium_progress_bar_enabled: true,
        system_channel_flags: 3,
        system_channel_id: null,
        verification_level: 4,
      })
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const result = await client.modifyGuildSettings("100", {
    defaultMessageNotifications: 1,
    explicitContentFilter: 2,
    premiumProgressBarEnabled: true,
    suppressedSystemNotifications: 3,
    systemChannelId: null,
    verificationLevel: 4,
  }, "Reviewed guild / defaults")

  assert.equal(requests, 1)
  assert.equal(requestUrl, `${API_BASE_URL}/guilds/100`)
  assert.equal(method, "PATCH")
  assert.equal(auditReason, "Reviewed%20guild%20%2F%20defaults")
  assert.deepEqual(requestBody, {
    default_message_notifications: 1,
    explicit_content_filter: 2,
    premium_progress_bar_enabled: true,
    system_channel_flags: 3,
    system_channel_id: null,
    verification_level: 4,
  })
  assert.equal(result.id, "100")
  assert.equal(records[0]?.operation, "modify_guild_settings")

  let sleeps = 0
  requests = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        code: 20_016,
        message: "rate limited",
        retry_after: 0,
      }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.modifyGuildSettings("100", { verificationLevel: 2 }, "Reviewed"),
    DiscordApiError,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects invalid guild-settings inputs before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  await assert.rejects(
    client.modifyGuildSettings("bad", { verificationLevel: 2 }, "Reviewed"),
    /guild ID/,
  )
  await assert.rejects(
    client.modifyGuildSettings("100", {}, "Reviewed"),
    /supported fields/,
  )
  await assert.rejects(
    client.modifyGuildSettings("100", { afkChannelId: "bad" }, "Reviewed"),
    /afkChannelId/,
  )
  await assert.rejects(
    client.modifyGuildSettings("100", { afkTimeoutSeconds: 120 as 60 }, "Reviewed"),
    /AFK timeout/,
  )
  await assert.rejects(
    client.modifyGuildSettings("100", { suppressedSystemNotifications: 64 }, "Reviewed"),
    /notification mask/,
  )
  await assert.rejects(
    client.modifyGuildSettings("100", {
      verificationLevel: 2,
      future: true,
    } as never, "Reviewed"),
    /supported fields/,
  )
  assert.equal(requests, 0)
})

test("Discord client sends one exact non-retried guild Community PATCH", async () => {
  let requests = 0
  let requestBody: unknown
  let requestUrl = ""
  let method = ""
  let auditReason = ""
  const records: RecordedObservation[] = []
  const response = {
    features: ["COMMUNITY", "NEWS"],
    id: "100",
    name: "Private Guild",
    owner_id: "200",
    public_updates_channel_id: "301",
    rules_channel_id: "300",
    safety_alerts_channel_id: "301",
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests += 1
      requestUrl = String(input)
      method = init?.method || "GET"
      auditReason = new Headers(init?.headers).get("X-Audit-Log-Reason") || ""
      requestBody = JSON.parse(String(init?.body))
      return jsonResponse(response)
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const result = await client.modifyGuildCommunity("100", {
    features: ["COMMUNITY", "NEWS"],
    publicUpdatesChannelId: "301",
    rulesChannelId: "300",
    safetyAlertsChannelId: "301",
  }, "Reviewed Community / routing")

  assert.equal(requests, 1)
  assert.equal(requestUrl, `${API_BASE_URL}/guilds/100`)
  assert.equal(method, "PATCH")
  assert.equal(auditReason, "Reviewed%20Community%20%2F%20routing")
  assert.deepEqual(requestBody, {
    features: ["COMMUNITY", "NEWS"],
    public_updates_channel_id: "301",
    rules_channel_id: "300",
    safety_alerts_channel_id: "301",
  })
  assert.deepEqual(result, response)
  assert.equal(records[0]?.operation, "modify_guild_community")

  let sleeps = 0
  requests = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        code: 20_016,
        message: "rate limited",
        retry_after: 0,
      }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.modifyGuildCommunity("100", {
      features: ["COMMUNITY"],
      publicUpdatesChannelId: "301",
      rulesChannelId: "300",
      safetyAlertsChannelId: null,
    }, "Reviewed"),
    DiscordApiError,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects unsafe guild Community inputs before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  const valid = {
    features: ["COMMUNITY"],
    publicUpdatesChannelId: "301",
    rulesChannelId: "300",
    safetyAlertsChannelId: null,
  } as const
  await assert.rejects(
    client.modifyGuildCommunity("bad", valid, "Reviewed"),
    /guild ID/,
  )
  await assert.rejects(
    client.modifyGuildCommunity("100", { ...valid, features: ["NEWS"] }, "Reviewed"),
    /input is invalid/,
  )
  await assert.rejects(
    client.modifyGuildCommunity("100", {
      ...valid,
      features: ["NEWS", "COMMUNITY"],
    }, "Reviewed"),
    /input is invalid/,
  )
  await assert.rejects(
    client.modifyGuildCommunity("100", {
      ...valid,
      publicUpdatesChannelId: "300",
    }, "Reviewed"),
    /must be distinct/,
  )
  await assert.rejects(
    client.modifyGuildCommunity("100", {
      ...valid,
      safetyAlertsChannelId: "bad",
    }, "Reviewed"),
    /safety-alerts channel ID/,
  )
  await assert.rejects(
    client.modifyGuildCommunity("100", { ...valid, future: true } as never, "Reviewed"),
    /input is invalid/,
  )
  assert.equal(requests, 0)
})

test("Discord client never retries a rate-limited role configuration", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.modifyGuildRole("100", "300", { mentionable: true }, "reviewed"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client rejects unsafe role contracts before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  const valid = {
    hoist: false,
    mentionable: false,
    name: "Support",
    permissions: "0",
    primaryColor: 0,
  }

  assert.throws(() => client.getGuildRole("invalid", "300"), /snowflake IDs/)
  assert.throws(() => client.getGuildRole("100", "invalid"), /snowflake IDs/)
  assert.throws(
    () => client.createGuildRole("invalid", valid, "reviewed"),
    /guild ID must be a snowflake/,
  )
  assert.throws(
    () => client.createGuildRole("100", { ...valid, name: " Support" }, "reviewed"),
    /surrounding whitespace/,
  )
  assert.throws(
    () => client.createGuildRole("100", { ...valid, permissions: "01" }, "reviewed"),
    /canonical decimal/,
  )
  assert.throws(
    () => client.createGuildRole("100", { ...valid, primaryColor: 0x1_00_00_00 }, "reviewed"),
    /between 0 and/,
  )
  assert.throws(
    () => client.createGuildRole("100", { ...valid, hoist: "yes" } as never, "reviewed"),
    /hoist setting must be a boolean/,
  )
  assert.equal(requests, 0)
})

test("Discord client rejects unsupported channel creation before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })

  assert.throws(
    () => client.createGuildChannel("invalid", { name: "valid", type: 0 }, "reviewed"),
    /guild ID must be a positive Discord snowflake/,
  )
  assert.throws(
    () => client.createGuildChannel("0", { name: "valid", type: 0 }, "reviewed"),
    /guild ID must be a positive Discord snowflake/,
  )
  assert.throws(
    () => client.createGuildChannel("100", {
      name: "valid",
      parentId: "0",
      type: 0,
    }, "reviewed"),
    /parent ID must be a positive Discord snowflake/,
  )
  assert.throws(
    () => client.createGuildChannel("100", { name: "valid", type: 14 }, "reviewed"),
    /type is not supported/,
  )
  assert.throws(
    () => client.createGuildChannel("100", {
      name: "Support",
      parentId: "200",
      type: 4,
    }, "reviewed"),
    /category creation does not accept a parent/,
  )
  assert.throws(
    () => client.createGuildChannel("100", {
      defaultAutoArchiveDuration: 30,
      name: "valid",
      type: 15,
    }, "reviewed"),
    /auto-archive duration is not supported/,
  )
  assert.throws(
    () => client.createGuildChannel("100", { name: " valid", type: 0 }, "reviewed"),
    /without surrounding whitespace or controls/,
  )
  assert.throws(
    () => client.createGuildChannel("100", { name: "private\nname", type: 0 }, "reviewed"),
    /without surrounding whitespace or controls/,
  )
  assert.throws(
    () => client.createGuildChannel("100", {
      name: "valid",
      topic: "private\u0000topic",
      type: 0,
    }, "reviewed"),
    /without unsupported controls/,
  )
  assert.throws(
    () => client.createGuildChannel("100", {
      name: "valid",
      topic: "f".repeat(1_025),
      type: 15,
    }, "reviewed"),
    /at most 1024 characters/,
  )
  assert.throws(
    () => client.createGuildChannel("100", {
      flags: 2 ** 32,
      name: "valid",
      type: 15,
    }, "reviewed"),
    /flags are not supported/,
  )
  assert.throws(
    () => client.createGuildChannel("100", {
      availableTags: [{
        emojiId: null,
        emojiName: null,
        id: "300",
        moderated: false,
        name: "invalid",
      }],
      name: "valid",
      type: 15,
    } as never, "reviewed"),
    /available tag is invalid/,
  )
  assert.equal(requests, 0)
})

test("Discord client sends safe message, edit, and own-reaction wire contracts", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({ body, method: init?.method || "GET", url: String(input) })
      if (init?.method === "PUT") return new Response(null, { status: 204 })
      return jsonResponse({
        author: { bot: true, id: "400", username: "bot" },
        channel_id: "200",
        content: body.content,
        id: "300",
        nonce: body.nonce,
        timestamp: "2026-08-14T00:00:00.000Z",
        type: 0,
      })
    },
    token: TOKEN,
  })

  await client.createMessage("200", {
    allowedMentions: { parse: [], replied_user: false },
    content: "safe reply",
    nonce: "stable-nonce",
    reply: { guildId: "100", messageId: "299" },
  })
  await client.editMessage("200", "300", {
    allowedMentions: { replied_user: false, users: ["401"] },
    content: "hello <@401>",
  })
  await client.addOwnReaction("200", "300", "🔥")

  assert.deepEqual(requests, [
    {
      body: {
        allowed_mentions: { parse: [], replied_user: false },
        content: "safe reply",
        enforce_nonce: true,
        message_reference: {
          channel_id: "200",
          fail_if_not_exists: true,
          guild_id: "100",
          message_id: "299",
          type: 0,
        },
        nonce: "stable-nonce",
      },
      method: "POST",
      url: `${API_BASE_URL}/channels/200/messages`,
    },
    {
      body: {
        allowed_mentions: { replied_user: false, users: ["401"] },
        content: "hello <@401>",
      },
      method: "PATCH",
      url: `${API_BASE_URL}/channels/200/messages/300`,
    },
    {
      body: null,
      method: "PUT",
      url: `${API_BASE_URL}/channels/200/messages/300/reactions/%F0%9F%94%A5/@me`,
    },
  ])
})

test("Discord client sends exact non-retried static component-message contracts", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({ body, method: init?.method || "GET", url: String(input) })
      return jsonResponse({
        author: { bot: true, id: "400", username: "bot" },
        channel_id: "200",
        components: body.components,
        content: "",
        flags: body.flags,
        id: "300",
        nonce: body.nonce,
        timestamp: "2026-08-22T00:00:00.000Z",
        type: 0,
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })
  const components = [
    { content: "# Release", type: 10 as const },
    { divider: true, spacing: 1 as const, type: 14 as const },
    {
      accent_color: 0x12_AB_34,
      components: [{ content: "Details", type: 10 as const }],
      spoiler: false,
      type: 17 as const,
    },
  ]

  await client.createComponentMessage("200", {
    allowedMentions: { parse: [], replied_user: false },
    components,
    nonce: "component-nonce",
    reply: { guildId: "100", messageId: "299" },
  })
  await client.editComponentMessage("200", "300", {
    allowedMentions: { replied_user: false, users: ["401"] },
    components,
    flags: 32_768,
  })

  assert.deepEqual(requests, [
    {
      body: {
        allowed_mentions: { parse: [], replied_user: false },
        components,
        enforce_nonce: true,
        flags: 32_768,
        message_reference: {
          channel_id: "200",
          fail_if_not_exists: true,
          guild_id: "100",
          message_id: "299",
          type: 0,
        },
        nonce: "component-nonce",
      },
      method: "POST",
      url: `${API_BASE_URL}/channels/200/messages`,
    },
    {
      body: {
        allowed_mentions: { replied_user: false, users: ["401"] },
        components,
        flags: 32_768,
      },
      method: "PATCH",
      url: `${API_BASE_URL}/channels/200/messages/300`,
    },
  ])
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "create_component_message",
    retries: 0,
    runs: 1,
  }, {
    completions: [{ outcome: "ok" }],
    operation: "edit_component_message",
    retries: 0,
    runs: 1,
  }])
})

test("Discord client sends exact non-retried static embed-message contracts", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({ body, method: init?.method || "GET", url: String(input) })
      return jsonResponse({
        author: { bot: true, id: "400", username: "bot" },
        channel_id: "200",
        content: body.content ?? "",
        embeds: body.embeds,
        id: "300",
        nonce: body.nonce,
        timestamp: "2026-08-22T00:00:00.000Z",
        type: 0,
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })
  const embeds = [{
    author: { name: "Release bot" },
    color: 0x12_AB_34,
    fields: [{ inline: true, name: "Status", value: "Ready" }],
    footer: { text: "Deployment" },
    timestamp: "2026-08-22T00:00:00.000Z",
    title: "Release",
  }]

  await client.createEmbedMessage("200", {
    allowedMentions: { parse: [], replied_user: false },
    content: "hello <@401>",
    embeds,
    nonce: "embed-nonce",
    reply: { guildId: "100", messageId: "299" },
  })
  await client.editEmbedMessage("200", "300", {
    allowedMentions: { replied_user: false, users: ["401"] },
    content: "",
    embeds,
  })

  assert.deepEqual(requests, [
    {
      body: {
        allowed_mentions: { parse: [], replied_user: false },
        content: "hello <@401>",
        embeds,
        enforce_nonce: true,
        message_reference: {
          channel_id: "200",
          fail_if_not_exists: true,
          guild_id: "100",
          message_id: "299",
          type: 0,
        },
        nonce: "embed-nonce",
      },
      method: "POST",
      url: `${API_BASE_URL}/channels/200/messages`,
    },
    {
      body: {
        allowed_mentions: { replied_user: false, users: ["401"] },
        content: "",
        embeds,
      },
      method: "PATCH",
      url: `${API_BASE_URL}/channels/200/messages/300`,
    },
  ])
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "create_embed_message",
    retries: 0,
    runs: 1,
  }, {
    completions: [{ outcome: "ok" }],
    operation: "edit_embed_message",
    retries: 0,
    runs: 1,
  }])
})

test("Discord client keeps component content out of API and transport errors", async () => {
  const privateText = "private component text"
  const components = [{ content: privateText, type: 10 as const }]
  const apiFailure = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ message: privateText }, 400),
    token: TOKEN,
  })
  await assert.rejects(
    apiFailure.createComponentMessage("200", {
      allowedMentions: { parse: [], replied_user: false },
      components,
      nonce: "component-nonce",
    }),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.message.includes("request failed")
      && !error.message.includes(privateText)
    ),
  )

  const transportFailure = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateText)
    },
    token: TOKEN,
  })
  await assert.rejects(
    transportFailure.editComponentMessage("200", "300", {
      allowedMentions: { parse: [], replied_user: false },
      components,
      flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
    }),
    (error: unknown) => (
      error instanceof Error
      && error.name === "DiscordTransportError"
      && error.cause === undefined
      && error.message.includes("request failed")
      && !error.message.includes(privateText)
    ),
  )
})

test("Discord client rejects unsafe component-message wire inputs before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  const allowedMentions = { parse: [] as const, replied_user: false }
  const text = [{ content: "Hello", type: 10 as const }]

  assert.throws(
    () => client.createComponentMessage("invalid", {
      allowedMentions,
      components: text,
      nonce: "nonce",
    }),
    /channel ID/,
  )
  assert.throws(
    () => client.createComponentMessage("200", {
      allowedMentions,
      components: [{
        content: "Hello",
        custom_id: "hidden-authority",
        type: 10,
      }] as never,
      nonce: "nonce",
    }),
    /unsupported fields: custom_id/,
  )
  assert.throws(
    () => client.createComponentMessage("200", {
      allowedMentions,
      components: text,
      nonce: "x".repeat(26),
    }),
    /nonce/,
  )
  assert.throws(
    () => client.editComponentMessage("200", "300", {
      allowedMentions,
      components: text,
      flags: 0,
    }),
    /preserve IS_COMPONENTS_V2/,
  )
  assert.throws(
    () => client.editComponentMessage("200", "invalid", {
      allowedMentions,
      components: text,
      flags: 32_768,
    }),
    /message ID/,
  )
  assert.equal(requests, 0)
})

test("Discord client never automatically retries component-message mutations", async () => {
  let createRequests = 0
  const createClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      createRequests += 1
      return jsonResponse({ message: "temporary" }, 500)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  const input = {
    allowedMentions: { parse: [] as const, replied_user: false },
    components: [{ content: "Hello", type: 10 as const }],
    nonce: "component-nonce",
  }

  await assert.rejects(
    createClient.createComponentMessage("200", input),
    (error: DiscordApiError) => error.status === 500,
  )
  assert.equal(createRequests, 1)

  let editRequests = 0
  const editClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      editRequests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    editClient.editComponentMessage("200", "300", {
      allowedMentions: input.allowedMentions,
      components: input.components,
      flags: 32_768,
    }),
    (error: DiscordApiError) => error.status === 429,
  )
  assert.equal(editRequests, 1)
})

test("Discord client sends bounded encoded reaction lifecycle contracts", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      if (init?.method === "GET") {
        return jsonResponse([{ bot: false, id: "401", username: "person" }])
      }
      return new Response(null, { status: 204 })
    },
    token: TOKEN,
  })

  const users = await client.listReactionUsers("200", "300", "ship:500", {
    after: "400",
    limit: 25,
    type: 1,
  })
  await client.deleteOwnReaction("200", "300", "🔥")
  await client.deleteUserReaction("200", "300", "ship:500", "401")
  await client.deleteAllMessageReactionsForEmoji("200", "300", "ship:500")
  await client.deleteAllMessageReactions("200", "300")

  assert.deepEqual(users, [{ bot: false, id: "401", username: "person" }])
  assert.deepEqual(requests, [
    {
      method: "GET",
      url: `${API_BASE_URL}/channels/200/messages/300/reactions/ship%3A500?after=400&limit=25&type=1`,
    },
    {
      method: "DELETE",
      url: `${API_BASE_URL}/channels/200/messages/300/reactions/%F0%9F%94%A5/@me`,
    },
    {
      method: "DELETE",
      url: `${API_BASE_URL}/channels/200/messages/300/reactions/ship%3A500/401`,
    },
    {
      method: "DELETE",
      url: `${API_BASE_URL}/channels/200/messages/300/reactions/ship%3A500`,
    },
    {
      method: "DELETE",
      url: `${API_BASE_URL}/channels/200/messages/300/reactions`,
    },
  ])
})

test("Discord client validates reaction inputs and exact success statuses", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      requests += 1
      return init?.method === "GET"
        ? new Response(null, { status: 204 })
        : jsonResponse({ unexpected: true })
    },
    token: TOKEN,
  })

  await assert.rejects(client.listReactionUsers("invalid", "300", "🔥"), /channel ID/)
  await assert.rejects(client.listReactionUsers("200", "invalid", "🔥"), /message ID/)
  await assert.rejects(
    client.listReactionUsers("200", "300", "🔥", { limit: 101 }),
    /between 1 and 100/,
  )
  await assert.rejects(
    client.listReactionUsers("200", "300", "🔥", { type: 2 as 0 }),
    /normal or burst/,
  )
  await assert.rejects(client.deleteUserReaction("200", "300", "🔥", "nope"), /user ID/)
  assert.equal(requests, 0)

  await assert.rejects(
    client.addOwnReaction("200", "300", "private:500"),
    (error: Error) => {
      assert.match(error.message, /unexpected success status/)
      assert.doesNotMatch(error.message, /private|500/)
      return true
    },
  )
  await assert.rejects(
    client.listReactionUsers("200", "300", "private:500"),
    /unexpected success status/,
  )
})

test("Discord client does not automatically retry reviewed reaction removals", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "wait", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })

  await assert.rejects(
    client.deleteAllMessageReactions("200", "300"),
    (error: DiscordApiError) => error.status === 429,
  )
  assert.equal(requests, 1)
})

test("Discord client sends one nonce-enforced native poll without automatic retries", async () => {
  const requests: Array<{ body: unknown; method: string; url: string }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({ body, method: init?.method || "GET", url: String(input) })
      return jsonResponse({
        author: { bot: true, id: "400", username: "bot" },
        channel_id: "200",
        content: "",
        guild_id: "100",
        id: "300",
        nonce: "stable-poll-nonce",
        timestamp: "2026-08-21T00:00:00.000Z",
        type: 0,
      })
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await client.createPoll("200", {
    allowMultiselect: true,
    answers: [
      { emoji: "👍", text: "Ship it" },
      { text: "Revise it" },
    ],
    durationHours: 48,
    nonce: "stable-poll-nonce",
    question: "What should we do?",
  })

  assert.deepEqual(requests, [{
    body: {
      enforce_nonce: true,
      nonce: "stable-poll-nonce",
      poll: {
        allow_multiselect: true,
        answers: [
          { poll_media: { emoji: { name: "👍" }, text: "Ship it" } },
          { poll_media: { text: "Revise it" } },
        ],
        duration: 48,
        layout_type: 1,
        question: { text: "What should we do?" },
      },
    },
    method: "POST",
    url: `${API_BASE_URL}/channels/200/messages`,
  }])
  assert.deepEqual(records.map(({ operation, retries }) => ({ operation, retries })), [{
    operation: "create_poll",
    retries: 0,
  }])
})

test("Discord client uses bounded poll voter and non-retried end routes", async () => {
  const requests: Array<{ method: string; url: string }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      if (init?.method === "GET") {
        return jsonResponse({ users: [{ id: "500", username: "private-name" }] })
      }
      return jsonResponse({
        author: { bot: true, id: "400", username: "bot" },
        channel_id: "200",
        content: "",
        guild_id: "100",
        id: "300",
        timestamp: "2026-08-21T00:00:00.000Z",
        type: 0,
      })
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const voters = await client.listPollAnswerVoters("200", "300", 7, {
    after: "499",
    limit: 25,
  })
  await client.endPoll("200", "300")

  assert.equal(voters.users[0]?.username, "private-name")
  assert.deepEqual(requests, [
    {
      method: "GET",
      url: `${API_BASE_URL}/channels/200/polls/300/answers/7?after=499&limit=25`,
    },
    {
      method: "POST",
      url: `${API_BASE_URL}/channels/200/polls/300/expire`,
    },
  ])
  assert.deepEqual(records.map(({ operation, retries }) => ({ operation, retries })), [
    { operation: "list_poll_answer_voters", retries: 0 },
    { operation: "end_poll", retries: 0 },
  ])
})

test("Discord client rejects unsafe poll wire inputs before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  const valid = {
    allowMultiselect: false,
    answers: [{ text: "Yes" }, { text: "No" }],
    durationHours: 24,
    nonce: "poll-nonce",
    question: "Proceed?",
  }

  assert.throws(() => client.createPoll("invalid", valid), /channel ID/)
  assert.throws(
    () => client.createPoll("200", { ...valid, answers: [{ text: "Only one" }] }),
    /2-10 entries/,
  )
  assert.throws(
    () => client.createPoll("200", {
      ...valid,
      answers: [{ text: "Same" }, { text: "Ｓａｍｅ" }],
    }),
    /logically unique/,
  )
  assert.throws(
    () => client.createPoll("200", {
      ...valid,
      answers: [{ emoji: "not-emoji", text: "Yes" }, { text: "No" }],
    }),
    /one Unicode emoji/,
  )
  assert.throws(
    () => client.createPoll("200", { ...valid, durationHours: 769 }),
    /between 1 and 768 hours/,
  )
  assert.throws(() => client.listPollAnswerVoters("200", "300", 0), /answer ID/)
  assert.throws(
    () => client.listPollAnswerVoters("200", "300", 1, { limit: 101 }),
    /between 1 and 100/,
  )
  assert.throws(() => client.endPoll("200", "invalid"), /message ID/)
  assert.equal(requests, 0)
})

test("Discord client projects exact Stage instances without forwarding unknown fields", async () => {
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      assert.equal(String(input), `${API_BASE_URL}/stage-instances/200`)
      assert.equal(init?.method, "GET")
      return jsonResponse({
        channel_id: "200",
        discoverable_disabled: false,
        future_private_field: "discarded",
        guild_id: "100",
        guild_scheduled_event_id: "400",
        id: "300",
        privacy_level: 1,
        topic: "Town hall",
      })
    },
    token: TOKEN,
  })

  assert.deepEqual(await client.getStageInstance("200"), {
    channelId: "200",
    discoverableDisabled: false,
    guildId: "100",
    id: "300",
    privacyLevel: 1,
    scheduledEventId: "400",
    topic: "Town hall",
    unknownFieldCount: 1,
  })
})

test("Discord client sends exact non-retried Stage lifecycle requests with audit reasons", async () => {
  const requests: Array<{
    auditReason: string | null
    body: unknown
    method: string
    url: string
  }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        auditReason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        method: init?.method || "GET",
        url: String(input),
      })
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as Record<string, unknown>
        : {}
      return jsonResponse({
        channel_id: body.channel_id ?? "200",
        discoverable_disabled: true,
        guild_id: "100",
        guild_scheduled_event_id: null,
        id: "300",
        privacy_level: 2,
        topic: body.topic,
      })
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await client.createStageInstance({
    channelId: "200",
    sendStartNotification: true,
    topic: "Town hall",
  }, "Reviewed Stage start")
  await client.modifyStageInstance(
    "200",
    { topic: "Questions" },
    "Reviewed Stage update",
  )
  await client.deleteStageInstance("200", "Reviewed Stage end")

  assert.deepEqual(requests, [
    {
      auditReason: "Reviewed%20Stage%20start",
      body: {
        channel_id: "200",
        privacy_level: 2,
        send_start_notification: true,
        topic: "Town hall",
      },
      method: "POST",
      url: `${API_BASE_URL}/stage-instances`,
    },
    {
      auditReason: "Reviewed%20Stage%20update",
      body: { topic: "Questions" },
      method: "PATCH",
      url: `${API_BASE_URL}/stage-instances/200`,
    },
    {
      auditReason: "Reviewed%20Stage%20end",
      body: null,
      method: "DELETE",
      url: `${API_BASE_URL}/stage-instances/200`,
    },
  ])
  assert.deepEqual(records.map(({ operation, retries }) => ({ operation, retries })), [
    { operation: "create_stage_instance", retries: 0 },
    { operation: "modify_stage_instance", retries: 0 },
    { operation: "delete_stage_instance", retries: 0 },
  ])
})

test("Discord client rejects unsafe Stage data and redacts topic-bearing failures", async () => {
  let requests = 0
  const privateTopic = "private Stage instructions"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: `Rejected ${privateTopic}` }, 429, {
        "Retry-After": "0",
      })
    },
    maxRetries: 3,
    token: TOKEN,
  })

  await assert.rejects(
    client.createStageInstance({
      channelId: "200",
      sendStartNotification: false,
      topic: privateTopic,
    }, "Reviewed Stage start"),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.equal(error.status, 429)
      assert.doesNotMatch(error.message, new RegExp(privateTopic))
      assert.equal(error.message.includes("Rejected"), false)
      return true
    },
  )
  assert.equal(requests, 1)

  const invalidClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  await assert.rejects(
    invalidClient.createStageInstance({
      channelId: "200",
      sendStartNotification: false,
      topic: " ",
    }, "Reviewed Stage start"),
    /topic/,
  )
  await assert.rejects(
    invalidClient.getStageInstance("200"),
    StageInstanceEvidenceError,
  )
  assert.equal(requests, 2)
})

test("Discord client sends one bounded attachment through native multipart form data", async () => {
  let contentType: string | null = "unexpected"
  let file: File | undefined
  let payload: unknown
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests += 1
      assert.equal(String(input), `${API_BASE_URL}/channels/200/messages`)
      assert.equal(init?.method, "POST")
      contentType = new Headers(init?.headers).get("Content-Type")
      assert.ok(init?.body instanceof FormData)
      const payloadJson = init.body.get("payload_json")
      assert.equal(typeof payloadJson, "string")
      payload = JSON.parse(payloadJson as string)
      const part = init.body.get("files[0]")
      assert.ok(part instanceof File)
      file = part
      return jsonResponse({
        attachments: [{
          description: "Accessible report",
          filename: "report.txt",
          id: "400",
          size: 14,
          url: "https://cdn.discord.test/private",
        }],
        author: { bot: true, id: "500", username: "bot" },
        channel_id: "200",
        content: "Review <@600>",
        guild_id: "100",
        id: "300",
        nonce: "stable-nonce",
        timestamp: "2026-08-20T00:00:00.000Z",
        type: 0,
      })
    },
    token: TOKEN,
  })

  await client.createAttachmentMessage("200", {
    allowedMentions: { replied_user: true, users: ["600"] },
    bytes: new TextEncoder().encode("reviewed bytes"),
    content: "Review <@600>",
    description: "Accessible report",
    filename: "report.txt",
    nonce: "stable-nonce",
    reply: { guildId: "100", messageId: "299" },
  })

  assert.equal(requests, 1)
  assert.equal(contentType, null)
  assert.deepEqual(payload, {
    allowed_mentions: { replied_user: true, users: ["600"] },
    attachments: [{
      description: "Accessible report",
      filename: "report.txt",
      id: "0",
    }],
    content: "Review <@600>",
    enforce_nonce: true,
    message_reference: {
      channel_id: "200",
      fail_if_not_exists: true,
      guild_id: "100",
      message_id: "299",
      type: 0,
    },
    nonce: "stable-nonce",
  })
  assert.equal(file?.name, "report.txt")
  assert.equal(file?.size, 14)
  assert.equal(await file?.text(), "reviewed bytes")
})

test("Discord client never retries attachment upload and rejects unsafe files", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "slow down", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  const safe = {
    allowedMentions: { parse: [] as const, replied_user: false },
    bytes: new Uint8Array([1]),
    filename: "safe.txt",
    nonce: "stable-nonce",
  }

  await assert.rejects(
    client.createAttachmentMessage("200", safe),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 1)
  assert.throws(
    () => client.createAttachmentMessage("200", { ...safe, bytes: new Uint8Array() }),
    /attachment bytes/,
  )
  assert.throws(
    () => client.createAttachmentMessage("200", { ...safe, filename: "../secret" }),
    /filename is invalid/,
  )
  assert.throws(
    () => client.createAttachmentMessage("200", {
      ...safe,
      description: "x".repeat(1_025),
    }),
    /description/,
  )
  assert.equal(requests, 1)
})

test("Discord client rejects unsafe message wire inputs before fetching", () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })

  assert.throws(
    () => client.createMessage("200", {
      allowedMentions: { parse: [], replied_user: false },
      content: " ",
      nonce: "nonce",
    }),
    /must not be blank/,
  )
  assert.throws(
    () => client.createMessage("200", {
      allowedMentions: { parse: [], replied_user: false },
      content: "hello",
      nonce: "x".repeat(26),
    }),
    /nonce/,
  )
  assert.throws(
    () => client.editMessage("200", "300", {
      allowedMentions: { replied_user: false, users: ["401", "401"] },
      content: "hello",
    }),
    /must not contain duplicates/,
  )
  assert.equal(requests, 0)
})

test("Discord client projects channel webhook inventory before returning it", async () => {
  const privateToken = "incoming-webhook-secret"
  const privateUrl = "https://discord.test/api/webhooks/300/incoming-webhook-secret"
  const privateProfile = "private-creator-profile"
  const records: RecordedObservation[] = []
  let request: {
    authorization: string | null
    method: string | undefined
    url: string
  } | null = null
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      request = {
        authorization: new Headers(init?.headers).get("Authorization"),
        method: init?.method,
        url: String(input),
      }
      return jsonResponse([{
        application_id: "500",
        avatar: "private-avatar",
        channel_id: "200",
        guild_id: "100",
        id: "300",
        name: "reviewed-hook",
        source_channel: { id: "201", name: "private-source-channel" },
        source_guild: { id: "101", name: "private-source-guild" },
        token: privateToken,
        type: 1,
        unknown: "private-unknown-field",
        url: privateUrl,
        user: {
          avatar: "private-user-avatar",
          discriminator: "0001",
          global_name: privateProfile,
          id: "400",
          username: privateProfile,
        },
      }, {
        application_id: null,
        channel_id: "200",
        guild_id: null,
        id: "301",
        name: null,
        type: 3,
        user: null,
      }, {
        application_id: null,
        channel_id: "200",
        guild_id: "100",
        id: "302",
        name: "private-follower-name",
        source_channel: { id: "202", name: "private-followed-channel" },
        source_guild: {
          icon: "private-source-icon",
          id: "102",
          name: "private-followed-guild",
        },
        type: 2,
      }])
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const inventory = await client.listChannelWebhooks("200")

  assert.deepEqual(inventory, [{
    applicationId: "500",
    channelId: "200",
    creatorUserId: "400",
    guildId: "100",
    id: "300",
    name: "reviewed-hook",
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
  }, {
    applicationId: null,
    channelId: "200",
    creatorUserId: null,
    guildId: null,
    id: "301",
    name: null,
    sourceChannelId: null,
    sourceGuildId: null,
    type: 3,
  }, {
    applicationId: null,
    channelId: "200",
    creatorUserId: null,
    guildId: "100",
    id: "302",
    name: "private-follower-name",
    sourceChannelId: "202",
    sourceGuildId: "102",
    type: 2,
  }])
  assert.deepEqual(request, {
    authorization: `Bot ${TOKEN}`,
    method: "GET",
    url: `${API_BASE_URL}/channels/200/webhooks`,
  })
  const serialized = JSON.stringify(inventory)
  for (const secret of [
    privateToken,
    privateUrl,
    privateProfile,
    "private-avatar",
    "private-source-channel",
    "private-source-guild",
    "private-followed-channel",
    "private-followed-guild",
    "private-source-icon",
    "private-unknown-field",
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "list_channel_webhooks",
    retries: 0,
    runs: 1,
  }])
})

test("Discord client rejects invalid webhook inventory without exposing response data", async () => {
  const privateFailure = "private-webhook-response-detail"
  let requests = 0
  const malformedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([{
        channel_id: "200",
        id: "300",
        name: null,
        type: 1,
        user: { id: 400 },
      }])
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => malformedClient.listChannelWebhooks("200"),
    /invalid webhook object/,
  )

  const failedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: privateFailure }, 403)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => failedClient.listChannelWebhooks("200"),
    (error: unknown) => {
      assert.ok(error instanceof DiscordApiError)
      assert.doesNotMatch(error.message, new RegExp(privateFailure))
      return true
    },
  )

  const oversizedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse(Array.from({ length: 16 }, (_, index) => ({
        application_id: null,
        channel_id: "200",
        guild_id: "100",
        id: String(300 + index),
        name: "reviewed-hook",
        type: 1,
      })))
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => oversizedClient.listChannelWebhooks("200"),
    /invalid channel webhook inventory/,
  )

  await assert.rejects(
    () => malformedClient.listChannelWebhooks("invalid"),
    /webhook channel ID/,
  )
  await assert.rejects(
    () => malformedClient.listChannelWebhooks("0"),
    /positive Discord snowflake/,
  )
  assert.equal(requests, 3)
})

test("Discord client projects a bounded guild webhook inventory before returning it", async () => {
  const privateToken = "guild-webhook-secret"
  const privateUrl = `https://discord.test/api/webhooks/300/${privateToken}`
  const privateProfile = "private-guild-webhook-creator"
  const records: RecordedObservation[] = []
  const requests: Array<{ method: string; url: string }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method || "GET", url: String(input) })
      return jsonResponse([{
        application_id: "500",
        avatar: "private-guild-webhook-avatar",
        channel_id: "200",
        guild_id: "100",
        id: "300",
        name: "reviewed-hook",
        token: privateToken,
        type: 1,
        unknown_private_value: "private-guild-webhook-unknown",
        url: privateUrl,
        user: {
          avatar: "private-guild-webhook-user-avatar",
          global_name: privateProfile,
          id: "400",
          username: privateProfile,
        },
      }, {
        application_id: null,
        channel_id: "201",
        guild_id: "100",
        id: "301",
        name: "Follower",
        source_channel: { id: "202", name: "private-source-channel-name" },
        source_guild: { id: "101", name: "private-source-guild-name" },
        type: 2,
      }])
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const inventory = await client.listGuildWebhooks("100")

  assert.deepEqual(inventory, [{
    applicationId: "500",
    channelId: "200",
    creatorUserId: "400",
    guildId: "100",
    id: "300",
    name: "reviewed-hook",
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
  }, {
    applicationId: null,
    channelId: "201",
    creatorUserId: null,
    guildId: "100",
    id: "301",
    name: "Follower",
    sourceChannelId: "202",
    sourceGuildId: "101",
    type: 2,
  }])
  assert.deepEqual(requests, [{
    method: "GET",
    url: `${API_BASE_URL}/guilds/100/webhooks`,
  }])
  const serialized = JSON.stringify(inventory)
  for (const secret of [
    privateToken,
    privateUrl,
    privateProfile,
    "private-guild-webhook-avatar",
    "private-guild-webhook-user-avatar",
    "private-guild-webhook-unknown",
    "private-source-channel-name",
    "private-source-guild-name",
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "list_guild_webhooks",
    retries: 0,
    runs: 1,
  }])
})

test("Discord client fails guild webhook inventory closed without leaking evidence", async () => {
  const privateMarker = "private-guild-webhook-failure"
  const refused = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ message: privateMarker }, 403),
    token: TOKEN,
  })
  await assert.rejects(
    refused.listGuildWebhooks("100"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.message.includes("request failed")
      && !error.message.includes(privateMarker)
      && error.cause === undefined
    ),
  )

  const transport = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateMarker)
    },
    token: TOKEN,
  })
  await assert.rejects(
    transport.listGuildWebhooks("100"),
    (error: unknown) => error instanceof Error
      && !error.message.includes(privateMarker)
      && error.cause === undefined,
  )

  const tooMany = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse(Array.from(
      { length: DISCORD_LIMITS.guildWebhooks + 1 },
      (_, index) => ({
        application_id: null,
        channel_id: "200",
        guild_id: "100",
        id: String(1_000_000 + index),
        name: null,
        type: 1,
      }),
    )),
    token: TOKEN,
  })
  await assert.rejects(
    tooMany.listGuildWebhooks("100"),
    /invalid guild webhook inventory/u,
  )

  const oversized = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => new Response(
      "x".repeat(DISCORD_LIMITS.guildWebhookResponseBytes + 1),
      { status: 200 },
    ),
    token: TOKEN,
  })
  await assert.rejects(
    oversized.listGuildWebhooks("100"),
    /exceeded its local response bound/u,
  )
  await assert.rejects(
    refused.listGuildWebhooks("invalid"),
    /webhook guild ID/u,
  )
  await assert.rejects(
    refused.listGuildWebhooks("0"),
    /positive Discord snowflake/u,
  )
})

test("Discord client creates an Incoming webhook while projecting its credential out", async () => {
  const privateToken = "incoming-webhook-credential-canary"
  const privateUrl = `https://discord.test/api/webhooks/300/${privateToken}`
  const credentials: Array<{ token: string; webhookId: string }> = []
  const requests: Array<{
    authorization: string | null
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        body: JSON.parse(String(init?.body)),
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({
        application_id: null,
        avatar: "private-avatar",
        channel_id: "200",
        guild_id: "100",
        id: "300",
        name: "Release relay",
        token: privateToken,
        type: 1,
        url: privateUrl,
        user: { id: "400", username: "private-profile" },
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const created = await client.createWebhook(
    "200",
    { name: "Release relay" },
    async (webhook, token) => {
      credentials.push({ token, webhookId: webhook.id })
    },
    "Reviewed creation / case 42",
  )

  assert.deepEqual(created, {
    applicationId: null,
    channelId: "200",
    creatorUserId: "400",
    guildId: "100",
    id: "300",
    name: "Release relay",
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
  })
  assert.deepEqual(requests, [{
    authorization: `Bot ${TOKEN}`,
    body: { name: "Release relay" },
    method: "POST",
    reason: "Reviewed%20creation%20%2F%20case%2042",
    url: `${API_BASE_URL}/channels/200/webhooks`,
  }])
  assert.equal(JSON.stringify(created).includes(privateToken), false)
  assert.deepEqual(credentials, [{ token: privateToken, webhookId: "300" }])
  assert.equal(JSON.stringify(created).includes(privateUrl), false)
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "create_webhook",
    retries: 0,
    runs: 1,
  }])
})

test("Discord client uses credential-redacted exact webhook message routes", async () => {
  const privateToken = "private/webhook+token.canary"
  const requests: Array<{
    authorization: string | null
    body: unknown
    method: string | undefined
    url: string
  }> = []
  const records: RecordedObservation[] = []
  let requestIndex = 0
  const webhookMessage = (content: string) => ({
    attachments: [],
    author: { bot: true, id: "300", username: "Release relay" },
    channel_id: "200",
    components: [],
    content,
    embeds: [],
    flags: DISCORD_MESSAGE_FLAGS.suppressEmbeds,
    guild_id: "100",
    id: "500",
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    sticker_items: [],
    timestamp: "2026-08-25T00:00:00.000Z",
    tts: false,
    type: 0,
    webhook_id: "300",
  })
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method,
        url: String(input),
      })
      requestIndex += 1
      if (requestIndex === 1) {
        return jsonResponse({
          application_id: null,
          channel_id: "200",
          guild_id: "100",
          id: "300",
          name: "Release relay",
          type: 1,
        })
      }
      if (requestIndex === 2 || requestIndex === 3) {
        return jsonResponse(webhookMessage("Deployment complete"))
      }
      if (requestIndex === 4) {
        return jsonResponse(webhookMessage("Deployment corrected"))
      }
      return new Response(null, { status: 204 })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const projected = await client.getWebhookWithToken("300", privateToken)
  const created = await client.executeWebhookMessage("300", privateToken, {
    allowedMentions: { parse: [], replied_user: false },
    content: "Deployment complete",
  })
  const read = await client.getWebhookMessage("300", privateToken, "500")
  const edited = await client.modifyWebhookMessage("300", privateToken, "500", {
    allowedMentions: { replied_user: false, users: ["700"] },
    content: "Deployment corrected",
  })
  await client.deleteWebhookMessage("300", privateToken, "500")

  assert.equal(projected.id, "300")
  assert.equal(created.content, "Deployment complete")
  assert.equal(read.webhook_id, "300")
  assert.equal(edited.content, "Deployment corrected")
  assert.deepEqual(requests.map((request) => request.authorization), [
    null,
    null,
    null,
    null,
    null,
  ])
  const encodedToken = encodeURIComponent(privateToken)
  assert.deepEqual(requests.map((request) => request.url), [
    `${API_BASE_URL}/webhooks/300/${encodedToken}`,
    `${API_BASE_URL}/webhooks/300/${encodedToken}?wait=true`,
    `${API_BASE_URL}/webhooks/300/${encodedToken}/messages/500`,
    `${API_BASE_URL}/webhooks/300/${encodedToken}/messages/500`,
    `${API_BASE_URL}/webhooks/300/${encodedToken}/messages/500`,
  ])
  assert.deepEqual(requests[1]?.body, {
    allowed_mentions: { parse: [], replied_user: false },
    content: "Deployment complete",
    flags: DISCORD_MESSAGE_FLAGS.suppressEmbeds,
  })
  assert.deepEqual(requests[3]?.body, {
    allowed_mentions: { replied_user: false, users: ["700"] },
    content: "Deployment corrected",
    flags: DISCORD_MESSAGE_FLAGS.suppressEmbeds,
  })
  assert.deepEqual(records.map((record) => record.operation), [
    "get_webhook",
    "execute_webhook",
    "get_webhook_message",
    "modify_webhook_message",
    "delete_webhook_message",
  ])
  assert.equal(JSON.stringify(records).includes(privateToken), false)
})

test("Discord client never retries or reveals a webhook credential on delivery failure", async () => {
  const privateToken = "webhook-credential-failure-canary"
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        message: `failure ${privateToken}`,
        retry_after: 0.001,
      }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    client.executeWebhookMessage("300", privateToken, {
      allowedMentions: { parse: [], replied_user: false },
      content: "Deployment complete",
    }),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && !error.message.includes(privateToken)
      && !error.route.includes(privateToken)
    ),
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client follows one announcement channel with an exact non-retried request", async () => {
  const requests: Array<{
    authorization: string | null
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        body: JSON.parse(String(init?.body)),
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({
        channel_id: "201",
        webhook_id: "300",
      })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const followed = await client.followAnnouncementChannel(
    "201",
    "200",
    "Reviewed follow / case 42",
  )

  assert.deepEqual(followed, {
    sourceChannelId: "201",
    webhookId: "300",
  })
  assert.deepEqual(requests, [{
    authorization: `Bot ${TOKEN}`,
    body: { webhook_channel_id: "200" },
    method: "POST",
    reason: "Reviewed%20follow%20%2F%20case%2042",
    url: `${API_BASE_URL}/channels/201/followers`,
  }])
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "follow_announcement_channel",
    retries: 0,
    runs: 1,
  }])
})

test("Discord client rejects malformed follower evidence and never retries following", async () => {
  let requests = 0
  let sleeps = 0
  const malformedInventory = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([{
        application_id: null,
        channel_id: "200",
        guild_id: "100",
        id: "300",
        name: "Follower",
        source_channel: { id: "201", name: "private-source" },
        type: 2,
      }])
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => malformedInventory.listChannelWebhooks("200"),
    /invalid webhook object/,
  )

  const mismatchedResponse = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ channel_id: "202", webhook_id: "300" })
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => mismatchedResponse.followAnnouncementChannel("201", "200", "Reviewed"),
    /another source channel/,
  )

  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "private-follow-failure", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => rateLimited.followAnnouncementChannel("201", "200", "Reviewed"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && !error.message.includes("private-follow-failure")
    ),
  )
  await assert.rejects(
    () => rateLimited.followAnnouncementChannel("0", "200", "Reviewed"),
    /positive Discord snowflake/,
  )
  await assert.rejects(
    () => rateLimited.followAnnouncementChannel("201", "invalid", "Reviewed"),
    /target channel ID/,
  )
  assert.equal(requests, 3)
  assert.equal(sleeps, 0)
})

test("Discord client modifies exact webhook metadata without surfacing credentials", async () => {
  const privateToken = "modified-webhook-credential-canary"
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
        body: JSON.parse(String(init?.body)),
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return jsonResponse({
        application_id: null,
        channel_id: "201",
        guild_id: "100",
        id: "300",
        name: "Deployment relay",
        token: privateToken,
        type: 1,
        user: { id: "400" },
      })
    },
    token: TOKEN,
  })

  const modified = await client.modifyWebhook(
    "300",
    { channelId: "201", name: "Deployment relay" },
    "Reviewed move",
  )

  assert.deepEqual(modified, {
    applicationId: null,
    channelId: "201",
    creatorUserId: "400",
    guildId: "100",
    id: "300",
    name: "Deployment relay",
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
  })
  assert.deepEqual(requests, [{
    body: { channel_id: "201", name: "Deployment relay" },
    method: "PATCH",
    reason: "Reviewed%20move",
    url: `${API_BASE_URL}/webhooks/300`,
  }])
  assert.equal(JSON.stringify(modified).includes(privateToken), false)
})

test("Discord client webhook mutations validate locally and never retry", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        message: "private-webhook-failure",
        retry_after: 0.001,
      }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.createWebhook("200", { name: "Release relay" }, async () => {}, "Reviewed"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && !error.message.includes("private-webhook-failure")
    ),
  )
  await assert.rejects(
    () => client.modifyWebhook("300", { name: "Release relay" }, "Reviewed"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 2)
  assert.equal(sleeps, 0)

  await assert.rejects(
    () => client.createWebhook("200", { name: " discord relay" }, async () => {}, "Reviewed"),
    /webhook name is invalid/,
  )
  await assert.rejects(
    () => client.modifyWebhook("300", {}, "Reviewed"),
    /requires a name or destination channel/,
  )
  await assert.rejects(
    () => client.modifyWebhook("300", { channelId: "0" }, "Reviewed"),
    /positive Discord snowflake/,
  )
  await assert.rejects(
    () => client.createWebhook("200", {
      name: "Release relay",
      token: "credential-must-be-rejected",
    } as never, async () => {}, "Reviewed"),
    /exact object/,
  )
  await assert.rejects(
    () => client.modifyWebhook("300", {
      name: "Release relay",
      token: "credential-must-be-rejected",
    } as never, "Reviewed"),
    /exact object/,
  )
  await assert.rejects(
    () => client.createWebhook("200", null as never, async () => {}, "Reviewed"),
    /exact object/,
  )
  assert.equal(requests, 2)
})

test("Discord client deletes an exact webhook once with an encoded audit reason", async () => {
  const requests: Array<{
    authorization: string | null
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("Authorization"),
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      return new Response(null, { status: 204 })
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await client.deleteWebhook("300", "Reviewed cleanup / case 42")

  assert.deepEqual(requests, [{
    authorization: `Bot ${TOKEN}`,
    method: "DELETE",
    reason: "Reviewed%20cleanup%20%2F%20case%2042",
    url: `${API_BASE_URL}/webhooks/300`,
  }])
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "delete_webhook",
    retries: 0,
    runs: 1,
  }])
})

test("Discord client never retries webhook deletion and validates before fetching", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.deleteWebhook("300", "Reviewed cleanup"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && error.retryAfterMs === 1
      && !error.message.includes("rate limited")
    ),
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
  await assert.rejects(
    () => client.deleteWebhook("invalid", "Reviewed cleanup"),
    /webhook ID/,
  )
  await assert.rejects(
    () => client.deleteWebhook("0", "Reviewed cleanup"),
    /positive Discord snowflake/,
  )
  await assert.rejects(
    () => client.deleteWebhook("300", " "),
    /must not be blank/,
  )
  assert.equal(requests, 1)
})

test("Discord client projects bounded guild expression inventories without CDN or profile fields", async () => {
  const privateProfile = "private-expression-uploader"
  const privateUrl = "https://cdn.discord.test/private-expression"
  const requests: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.includes("/emojis")) {
        const emoji = {
          animated: true,
          available: false,
          id: "300",
          managed: false,
          name: "wave",
          require_colons: true,
          roles: ["400"],
          unknown_url: privateUrl,
          user: {
            avatar: "private-avatar",
            global_name: privateProfile,
            id: "500",
            username: privateProfile,
          },
        }
        return jsonResponse(url.endsWith("/emojis") ? [emoji] : emoji)
      }
      if (url.includes("/stickers")) {
        const sticker = {
          available: true,
          description: "Friendly wave",
          format_type: 1,
          guild_id: "100",
          id: "600",
          name: "Wave",
          tags: "wave",
          type: 2,
          unknown_url: privateUrl,
          user: {
            avatar: "private-avatar",
            global_name: privateProfile,
            id: "500",
            username: privateProfile,
          },
        }
        return jsonResponse(url.endsWith("/stickers") ? [sticker] : sticker)
      }
      throw new Error(`Unexpected request ${url}`)
    },
    token: TOKEN,
  })

  const emojis = await client.listGuildEmojis("100")
  const stickers = await client.listGuildStickers("100")
  const exactEmoji = await client.getGuildEmoji("100", "300")
  const exactSticker = await client.getGuildSticker("100", "600")

  assert.deepEqual(emojis, [{
    animated: true,
    available: false,
    creatorUserId: "500",
    id: "300",
    managed: false,
    name: "wave",
    requiresColons: true,
    roleIds: ["400"],
    unknownFieldCount: 1,
  }])
  assert.deepEqual(stickers, [{
    available: true,
    creatorUserId: "500",
    description: "Friendly wave",
    formatType: 1,
    guildId: "100",
    id: "600",
    name: "Wave",
    tags: "wave",
    type: 2,
  }])
  assert.deepEqual(requests, [
    `${API_BASE_URL}/guilds/100/emojis`,
    `${API_BASE_URL}/guilds/100/stickers`,
    `${API_BASE_URL}/guilds/100/emojis/300`,
    `${API_BASE_URL}/guilds/100/stickers/600`,
  ])
  assert.equal(exactEmoji.id, "300")
  assert.equal(exactSticker.id, "600")
  const serialized = JSON.stringify({ emojis, exactEmoji, exactSticker, stickers })
  assert.equal(serialized.includes(privateProfile), false)
  assert.equal(serialized.includes(privateUrl), false)
  assert.equal(serialized.includes("private-avatar"), false)
})

test("Discord client sends exact non-retried guild expression writes", async () => {
  const requests: Array<{
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const stickerFiles: File[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const url = String(input)
      let body: unknown = null
      if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown
      if (init?.body instanceof FormData) {
        const file = init.body.get("file")
        assert.ok(file instanceof File)
        stickerFiles.push(file)
        body = {
          description: init.body.get("description"),
          name: init.body.get("name"),
          tags: init.body.get("tags"),
        }
      }
      requests.push({
        body,
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url,
      })
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      if (url.includes("/emojis")) {
        const record = body as Record<string, unknown>
        return jsonResponse({
          animated: false,
          available: true,
          id: "300",
          managed: false,
          name: record.name ?? "wave",
          require_colons: true,
          roles: record.roles ?? [],
          user: { id: "500" },
        })
      }
      return jsonResponse({
        available: true,
        description: (body as Record<string, unknown>).description ?? "Friendly wave",
        format_type: 1,
        guild_id: "100",
        id: "600",
        name: (body as Record<string, unknown>).name ?? "Wave",
        tags: (body as Record<string, unknown>).tags ?? "wave",
        type: 2,
        user: { id: "500" },
      })
    },
    maxRetries: 3,
    token: TOKEN,
  })

  await client.createGuildEmoji("100", {
    bytes: new Uint8Array([1, 2, 3]),
    format: "png",
    name: "wave",
    roleIds: ["400"],
  }, "Reviewed / expression")
  await client.modifyGuildEmoji("100", "300", {
    name: "hello",
    roleIds: [],
  }, "Reviewed / expression")
  await client.deleteGuildEmoji("100", "300", "Reviewed / expression")
  await client.createGuildSticker("100", {
    bytes: new Uint8Array([4, 5, 6]),
    description: "Friendly wave",
    format: "png",
    name: "Wave",
    tags: "wave",
  }, "Reviewed / expression")
  await client.modifyGuildSticker("100", "600", {
    description: null,
    name: "Hello",
    tags: "hello",
  }, "Reviewed / expression")
  await client.deleteGuildSticker("100", "600", "Reviewed / expression")

  assert.deepEqual(requests, [{
    body: {
      image: "data:image/png;base64,AQID",
      name: "wave",
      roles: ["400"],
    },
    method: "POST",
    reason: "Reviewed%20%2F%20expression",
    url: `${API_BASE_URL}/guilds/100/emojis`,
  }, {
    body: { name: "hello", roles: [] },
    method: "PATCH",
    reason: "Reviewed%20%2F%20expression",
    url: `${API_BASE_URL}/guilds/100/emojis/300`,
  }, {
    body: null,
    method: "DELETE",
    reason: "Reviewed%20%2F%20expression",
    url: `${API_BASE_URL}/guilds/100/emojis/300`,
  }, {
    body: {
      description: "Friendly wave",
      name: "Wave",
      tags: "wave",
    },
    method: "POST",
    reason: "Reviewed%20%2F%20expression",
    url: `${API_BASE_URL}/guilds/100/stickers`,
  }, {
    body: { description: null, name: "Hello", tags: "hello" },
    method: "PATCH",
    reason: "Reviewed%20%2F%20expression",
    url: `${API_BASE_URL}/guilds/100/stickers/600`,
  }, {
    body: null,
    method: "DELETE",
    reason: "Reviewed%20%2F%20expression",
    url: `${API_BASE_URL}/guilds/100/stickers/600`,
  }])
  const stickerFile = stickerFiles[0]
  assert.ok(stickerFile)
  assert.equal(stickerFile.name, "sticker.png")
  assert.equal(stickerFile.type, "image/png")
  assert.deepEqual(new Uint8Array(await stickerFile.arrayBuffer()), new Uint8Array([4, 5, 6]))
})

test("Discord client validates expression writes before fetching and does not retry them", async () => {
  let requests = 0
  let sleeps = 0
  const privateResponseDetail = "private-expression-response-detail"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: privateResponseDetail, retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.createGuildEmoji("100", {
      bytes: new Uint8Array([1]),
      format: "png",
      name: "wave",
      roleIds: [],
    }, "Reviewed expression"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && !error.message.includes(privateResponseDetail)
    ),
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
  await assert.rejects(
    client.createGuildEmoji("100", {
      bytes: new Uint8Array(),
      format: "png",
      name: "wave",
      roleIds: [],
    }, "Reviewed expression"),
    /emoji bytes/,
  )
  await assert.rejects(
    client.modifyGuildEmoji("100", "300", {}, "Reviewed expression"),
    /must contain a name or role IDs/,
  )
  await assert.rejects(
    client.createGuildEmoji("100", {
      bytes: new Uint8Array([1]),
      format: "png",
      name: "bad-name",
      roleIds: [],
    }, "Reviewed expression"),
    /ASCII letters/,
  )
  await assert.rejects(
    client.createGuildSticker("100", {
      bytes: new Uint8Array([1]),
      description: "x",
      format: "png",
      name: "Wave",
      tags: "wave",
    }, "Reviewed expression"),
    /description/,
  )
  await assert.rejects(
    client.createGuildSticker("100", {
      bytes: new Uint8Array([1]),
      description: null,
      format: "png",
      name: "Wave",
      tags: "wave",
    } as unknown as Parameters<DiscordClient["createGuildSticker"]>[1], "Reviewed expression"),
    /creation description must be a string/,
  )
  await assert.rejects(
    client.createGuildEmoji("100", {
      bytes: new Uint8Array([1]),
      format: "toString",
      name: "wave",
      roleIds: [],
    } as unknown as Parameters<DiscordClient["createGuildEmoji"]>[1], "Reviewed expression"),
    /format is unsupported/,
  )
  await assert.rejects(
    client.modifyGuildSticker("100", "600", {}, "Reviewed expression"),
    /must contain a name, description, or tags/,
  )
  assert.equal(requests, 1)
})

test("Discord client projects application emoji envelopes without uploader or image data", async () => {
  const privateProfile = "private-application-emoji-uploader"
  const privateUrl = "https://cdn.discord.test/private-application-emoji"
  const requests: string[] = []
  const payload = {
    animated: true,
    available: false,
    id: "300",
    image_url: privateUrl,
    managed: false,
    name: "wave",
    require_colons: true,
    roles: [],
    user: {
      avatar: "private-avatar",
      global_name: privateProfile,
      id: "500",
      username: privateProfile,
    },
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      const url = String(input)
      requests.push(url)
      return jsonResponse(url.endsWith("/emojis")
        ? { future_envelope_field: "discarded", items: [payload] }
        : payload)
    },
    token: TOKEN,
  })

  const inventory = await client.listApplicationEmojis("100")
  const exact = await client.getApplicationEmoji("100", "300")

  assert.deepEqual(inventory, {
    items: [{
      animated: true,
      available: false,
      id: "300",
      managed: false,
      name: "wave",
      requiresColons: true,
      unknownFieldCount: 1,
      uploaderProjectedOut: true,
    }],
    unknownFieldCount: 1,
  })
  assert.deepEqual(exact, inventory.items[0])
  assert.deepEqual(requests, [
    `${API_BASE_URL}/applications/100/emojis`,
    `${API_BASE_URL}/applications/100/emojis/300`,
  ])
  const serialized = JSON.stringify({ exact, inventory })
  assert.doesNotMatch(serialized, new RegExp(privateProfile))
  assert.doesNotMatch(serialized, new RegExp(privateUrl))
  assert.doesNotMatch(serialized, /private-avatar/)

  const malformed = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      ...payload,
      roles: ["400"],
    }),
    token: TOKEN,
  })
  await assert.rejects(
    malformed.getApplicationEmoji("100", "300"),
    ApplicationEmojiEvidenceError,
  )
})

test("Discord client sends exact application emoji writes without audit reasons or retries", async () => {
  const requests: Array<{
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({
        body,
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      return jsonResponse({
        animated: false,
        available: true,
        id: "300",
        managed: false,
        name: (body as Record<string, unknown>).name,
        require_colons: true,
        roles: [],
        user: { id: "500" },
      })
    },
    maxRetries: 3,
    token: TOKEN,
  })

  await client.createApplicationEmoji("100", {
    bytes: new Uint8Array([1, 2, 3]),
    format: "png",
    name: "wave",
  })
  await client.modifyApplicationEmoji("100", "300", { name: "hello" })
  await client.deleteApplicationEmoji("100", "300")

  assert.deepEqual(requests, [{
    body: {
      image: "data:image/png;base64,AQID",
      name: "wave",
    },
    method: "POST",
    reason: null,
    url: `${API_BASE_URL}/applications/100/emojis`,
  }, {
    body: { name: "hello" },
    method: "PATCH",
    reason: null,
    url: `${API_BASE_URL}/applications/100/emojis/300`,
  }, {
    body: null,
    method: "DELETE",
    reason: null,
    url: `${API_BASE_URL}/applications/100/emojis/300`,
  }])

  let attempts = 0
  const rateLimited = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      attempts += 1
      return jsonResponse({ message: "private detail", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    rateLimited.modifyApplicationEmoji("100", "300", { name: "hello" }),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && !error.message.includes("private detail")
    ),
  )
  assert.equal(attempts, 1)
  await assert.rejects(
    rateLimited.createApplicationEmoji("100", {
      bytes: new Uint8Array(),
      format: "png",
      name: "wave",
    }),
    /emoji bytes/,
  )
  await assert.rejects(
    rateLimited.modifyApplicationEmoji("100", "300", { name: "bad-name" }),
    /ASCII letters/,
  )
  assert.equal(attempts, 1)
})

test("Discord client projects bounded soundboard inventories without audio or creator profiles", async () => {
  const privateProfile = "private-sound-uploader"
  const privateUrl = "https://cdn.discord.test/private-sound"
  const requests: string[] = []
  const sound = (id: string, guild = true) => ({
    available: true,
    cdn_url: privateUrl,
    emoji_id: null,
    emoji_name: "🔔",
    ...(guild ? { guild_id: "100", user: {
      avatar: "private-avatar",
      id: "500",
      username: privateProfile,
    } } : {}),
    name: `Bell ${id}`,
    sound_id: id,
    volume: 0.75,
  })
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("/soundboard-default-sounds")) {
        return jsonResponse([sound("2", false), sound("1", false)])
      }
      if (url.endsWith("/guilds/100/soundboard-sounds")) {
        return jsonResponse({ items: [sound("4"), sound("3")] })
      }
      return jsonResponse(sound("3"))
    },
    token: TOKEN,
  })

  const defaults = await client.listDefaultSoundboardSounds()
  const guild = await client.listGuildSoundboardSounds("100")
  const exact = await client.getGuildSoundboardSound("100", "3")

  assert.deepEqual(defaults.map(({ guildId, id, unknownFieldCount }) => ({
    guildId,
    id,
    unknownFieldCount,
  })), [
    { guildId: null, id: "1", unknownFieldCount: 1 },
    { guildId: null, id: "2", unknownFieldCount: 1 },
  ])
  assert.deepEqual(guild.map(({ creatorUserId, guildId, id, unknownFieldCount }) => ({
    creatorUserId,
    guildId,
    id,
    unknownFieldCount,
  })), [
    { creatorUserId: "500", guildId: "100", id: "3", unknownFieldCount: 1 },
    { creatorUserId: "500", guildId: "100", id: "4", unknownFieldCount: 1 },
  ])
  assert.equal(exact.id, "3")
  assert.deepEqual(requests, [
    `${API_BASE_URL}/soundboard-default-sounds`,
    `${API_BASE_URL}/guilds/100/soundboard-sounds`,
    `${API_BASE_URL}/guilds/100/soundboard-sounds/3`,
  ])
  const serialized = JSON.stringify({ defaults, exact, guild })
  assert.equal(serialized.includes(privateProfile), false)
  assert.equal(serialized.includes(privateUrl), false)
  assert.equal(serialized.includes("private-avatar"), false)
})

test("Discord client rejects incomplete or cross-guild soundboard evidence", async () => {
  const responses: unknown[] = [
    { items: [{
      available: true,
      emoji_id: null,
      emoji_name: null,
      guild_id: "999",
      name: "Alert",
      sound_id: "300",
      volume: 1,
    }] },
    { items: [
      {
        available: true,
        emoji_id: null,
        emoji_name: null,
        guild_id: "100",
        name: "Alert",
        sound_id: "300",
        volume: 1,
      },
      {
        available: true,
        emoji_id: null,
        emoji_name: null,
        guild_id: "100",
        name: "Again",
        sound_id: "300",
        volume: 1,
      },
    ] },
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse(responses.shift()),
    token: TOKEN,
  })

  await assert.rejects(
    client.listGuildSoundboardSounds("100"),
    /invalid soundboard sound/,
  )
  await assert.rejects(
    client.listGuildSoundboardSounds("100"),
    /duplicate guild soundboard sound IDs/,
  )
})

test("Discord client sends exact non-retried soundboard writes", async () => {
  const requests: Array<{
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
      requests.push({
        body,
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      const record = body as Record<string, unknown>
      return jsonResponse({
        available: true,
        emoji_id: record.emoji_id ?? null,
        emoji_name: record.emoji_name ?? null,
        guild_id: "100",
        name: record.name ?? "Alert",
        sound_id: "300",
        user: { id: "500" },
        volume: typeof record.volume === "number" ? record.volume : 1,
      })
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    token: TOKEN,
  })

  await client.createGuildSoundboardSound("100", {
    bytes: new Uint8Array([1, 2, 3]),
    emojiId: null,
    emojiName: "🔔",
    format: "mp3",
    name: "Alert",
    volume: 0.75,
  }, "Reviewed / sound")
  await client.modifyGuildSoundboardSound("100", "300", {
    emojiId: null,
    emojiName: null,
    name: "Alarm",
    volume: null,
  }, "Reviewed / sound")
  await client.deleteGuildSoundboardSound("100", "300", "Reviewed / sound")

  assert.deepEqual(requests, [{
    body: {
      emoji_id: null,
      emoji_name: "🔔",
      name: "Alert",
      sound: "data:audio/mpeg;base64,AQID",
      volume: 0.75,
    },
    method: "POST",
    reason: "Reviewed%20%2F%20sound",
    url: `${API_BASE_URL}/guilds/100/soundboard-sounds`,
  }, {
    body: {
      emoji_id: null,
      emoji_name: null,
      name: "Alarm",
      volume: null,
    },
    method: "PATCH",
    reason: "Reviewed%20%2F%20sound",
    url: `${API_BASE_URL}/guilds/100/soundboard-sounds/300`,
  }, {
    body: null,
    method: "DELETE",
    reason: "Reviewed%20%2F%20sound",
    url: `${API_BASE_URL}/guilds/100/soundboard-sounds/300`,
  }])
  assert.deepEqual(records.map(({ operation, retries }) => ({ operation, retries })), [
    { operation: "create_guild_soundboard_sound", retries: 0 },
    { operation: "modify_guild_soundboard_sound", retries: 0 },
    { operation: "delete_guild_soundboard_sound", retries: 0 },
  ])
})

test("Discord client validates soundboard writes before fetching and never retries", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "private-sound-detail", retry_after: 0.001 }, 429)
    },
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })
  const valid = {
    bytes: new Uint8Array([1]),
    emojiId: null,
    emojiName: null,
    format: "ogg" as const,
    name: "Alert",
    volume: 1,
  }

  await assert.rejects(
    client.createGuildSoundboardSound("100", valid, "Reviewed sound"),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
  await assert.rejects(
    client.createGuildSoundboardSound("100", {
      ...valid,
      bytes: new Uint8Array(),
    }, "Reviewed sound"),
    /soundboard bytes/,
  )
  await assert.rejects(
    client.createGuildSoundboardSound("100", {
      ...valid,
      emojiId: "400",
      emojiName: "🔔",
    }, "Reviewed sound"),
    /mutually exclusive/,
  )
  await assert.rejects(
    client.modifyGuildSoundboardSound("100", "300", {
      emojiId: null,
    }, "Reviewed sound"),
    /complete nullable pair/,
  )
  await assert.rejects(
    client.modifyGuildSoundboardSound("100", "300", {}, "Reviewed sound"),
    /must contain a name, volume, or complete emoji pair/,
  )
  await assert.rejects(
    client.modifyGuildSoundboardSound("100", "300", {
      volume: Number.NaN,
    }, "Reviewed sound"),
    /finite number/,
  )
  assert.equal(requests, 1)
})

test("Discord client projects bounded onboarding evidence and counts unknown fields", async () => {
  let requestUrl = ""
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requestUrl = String(input)
      return jsonResponse({
        default_channel_ids: ["200"],
        enabled: false,
        future_top_level: { private: "omitted" },
        guild_id: "100",
        mode: 7,
        prompts: [{
          future_prompt_field: true,
          id: "300",
          in_onboarding: true,
          options: [{
            channel_ids: ["200"],
            description: null,
            emoji: {
              animated: false,
              future_emoji_field: true,
              id: null,
              name: "😀",
            },
            future_option_field: true,
            id: "400",
            role_ids: ["500"],
            title: "Community",
          }],
          required: true,
          single_select: true,
          title: "Choose access",
          type: 9,
        }],
      })
    },
    token: TOKEN,
  })

  const onboarding = await client.getGuildOnboarding("100")

  assert.equal(requestUrl, `${API_BASE_URL}/guilds/100/onboarding`)
  assert.equal(onboarding.guildId, "100")
  assert.equal(onboarding.unknownEnumCount, 2)
  assert.equal(onboarding.unknownFieldCount, 4)
  assert.deepEqual(onboarding.prompts[0]?.options[0], {
    channelIds: ["200"],
    description: null,
    emoji: { animated: false, id: null, name: "😀" },
    id: "400",
    roleIds: ["500"],
    title: "Community",
  })
  assert.equal(JSON.stringify(onboarding).includes("private"), false)
})

test("Discord client sends an exact non-retried onboarding replacement", async () => {
  const requests: Array<{
    body: unknown
    method: string
    reason: string | null
  }> = []
  let sleeps = 0
  const responseBody = {
    default_channel_ids: ["200"],
    enabled: false,
    guild_id: "100",
    mode: 0,
    prompts: [{
      id: "300",
      in_onboarding: true,
      options: [{
        channel_ids: ["200"],
        description: "",
        emoji: { animated: true, id: "500", name: "wave" },
        id: "400",
        role_ids: [],
        title: "Community",
      }, {
        channel_ids: [],
        description: null,
        emoji: null,
        id: "401",
        role_ids: [],
        title: "General",
      }],
      required: true,
      single_select: true,
      title: "Choose access",
      type: 0,
    }],
  }
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)) as unknown,
        method: String(init?.method),
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
      })
      return jsonResponse(responseBody)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  const result = await client.modifyGuildOnboarding("100", {
    defaultChannelIds: ["200"],
    enabled: false,
    mode: 0,
    prompts: [{
      id: "300",
      inOnboarding: true,
      options: [{
        channelIds: ["200"],
        description: "",
        emoji: { animated: true, id: "500", name: "wave" },
        id: "400",
        roleIds: [],
        title: "Community",
      }, {
        channelIds: [],
        description: null,
        emoji: null,
        id: "401",
        roleIds: [],
        title: "General",
      }],
      required: true,
      singleSelect: true,
      title: "Choose access",
      type: 0,
    }],
  }, "Reviewed / onboarding")

  assert.equal(result.guildId, "100")
  assert.deepEqual(requests, [{
    body: {
      default_channel_ids: ["200"],
      enabled: false,
      mode: 0,
      prompts: [{
        id: "300",
        in_onboarding: true,
        options: [{
          channel_ids: ["200"],
          description: "",
          emoji_animated: true,
          emoji_id: "500",
          emoji_name: "wave",
          id: "400",
          role_ids: [],
          title: "Community",
        }, {
          channel_ids: [],
          description: null,
          emoji_animated: false,
          emoji_id: null,
          emoji_name: null,
          id: "401",
          role_ids: [],
          title: "General",
        }],
        required: true,
        single_select: true,
        title: "Choose access",
        type: 0,
      }],
    },
    method: "PUT",
    reason: "Reviewed%20%2F%20onboarding",
  }])
  assert.equal(sleeps, 0)
})

test("Discord client does not retry rate-limited onboarding replacements", async () => {
  let requests = 0
  let sleeps = 0
  const privateResponseDetail = "private-onboarding-rate-limit-detail"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        message: privateResponseDetail,
        retry_after: 0.001,
      }, 429)
    },
    maxRetries: 3,
    sleep: async () => {
      sleeps += 1
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => client.modifyGuildOnboarding("100", {
      defaultChannelIds: [],
      enabled: false,
      mode: 0,
      prompts: [],
    }, "Reviewed onboarding"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && error.status === 429
      && error.retryAfterMs === 1
      && !error.message.includes(privateResponseDetail)
    ),
  )
  assert.equal(requests, 1)
  assert.equal(sleeps, 0)
})

test("Discord client validates onboarding replacements before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({})
    },
    token: TOKEN,
  })
  const valid = {
    defaultChannelIds: ["200"],
    enabled: false,
    mode: 0 as const,
    prompts: [{
      id: "300",
      inOnboarding: true,
      options: [],
      required: true,
      singleSelect: true,
      title: "Choose access",
      type: 0 as const,
    }],
  }

  await assert.rejects(
    client.modifyGuildOnboarding("bad", valid, "Reviewed onboarding"),
    /guild ID/,
  )
  await assert.rejects(
    client.modifyGuildOnboarding("100", {
      ...valid,
      defaultChannelIds: ["200", "200"],
    }, "Reviewed onboarding"),
    /must be unique/,
  )
  await assert.rejects(
    client.modifyGuildOnboarding("100", {
      ...valid,
      prompts: [{ ...valid.prompts[0]!, title: "" }],
    }, "Reviewed onboarding"),
    /prompt title/,
  )
  await assert.rejects(
    client.modifyGuildOnboarding("100", {
      ...valid,
      prompts: [{
        ...valid.prompts[0]!,
        options: [{
          channelIds: [],
          description: null,
          emoji: { id: null, name: "😀" },
          roleIds: [],
          title: "Community",
        }],
      }],
    } as unknown as Parameters<DiscordClient["modifyGuildOnboarding"]>[1], "Reviewed onboarding"),
    /emoji is invalid/,
  )
  await assert.rejects(
    client.modifyGuildOnboarding("100", {
      ...valid,
      future: true,
    } as unknown as Parameters<DiscordClient["modifyGuildOnboarding"]>[1], "Reviewed onboarding"),
    /input is invalid/,
  )
  assert.equal(requests, 0)
})

test("Discord client sanitizes onboarding evidence and transport failures", async () => {
  const privateDetail = "private-onboarding-response-detail"
  const apiClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({ message: privateDetail }, 500),
    token: TOKEN,
  })

  await assert.rejects(
    () => apiClient.getGuildOnboarding("100"),
    (error: unknown) => (
      error instanceof DiscordApiError
      && !error.message.includes(privateDetail)
    ),
  )

  const malformedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      default_channel_ids: [],
      enabled: false,
      guild_id: "different",
      mode: 0,
      prompts: [],
    }),
    token: TOKEN,
  })
  await assert.rejects(
    () => malformedClient.getGuildOnboarding("100"),
    OnboardingEvidenceError,
  )

  const incompleteClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse({
      default_channel_ids: [],
      enabled: false,
      guild_id: "100",
      mode: 0,
      prompts: [{
        id: "300",
        in_onboarding: true,
        options: [{
          channel_ids: [],
          description: null,
          emoji: null,
          id: "400",
          title: "Community",
        }],
        required: false,
        single_select: false,
        title: "Choose access",
        type: 0,
      }],
    }),
    token: TOKEN,
  })
  await assert.rejects(
    () => incompleteClient.getGuildOnboarding("100"),
    OnboardingEvidenceError,
  )

  const transportDetail = "private-onboarding-transport-detail"
  const transportClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(transportDetail)
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => transportClient.getGuildOnboarding("100"),
    (error: unknown) => (
      error instanceof Error
      && !error.message.includes(transportDetail)
      && error.cause === undefined
    ),
  )
})

test("Discord client projects exact guild channel metadata and counts unknown fields", async () => {
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => jsonResponse(channelMetadataPayload()),
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const result = await client.getGuildChannelMetadata("200")

  assert.deepEqual(result, {
    bitrate: null,
    defaultAutoArchiveDuration: 1_440,
    defaultThreadRateLimitPerUser: 15,
    guildId: "100",
    id: "200",
    name: "product-feedback",
    nsfw: false,
    parentId: "300",
    permissionOverwrites: [{
      allow: "1024",
      deny: "0",
      id: "400",
      type: 0,
    }],
    position: 4,
    rateLimitPerUser: 30,
    rtcRegion: null,
    topic: "Share product feedback",
    type: 15,
    unknownFieldCount: 2,
    userLimit: null,
    videoQualityMode: null,
  })
  assert.equal(records[0]?.operation, "get_channel_metadata")
})

test("Discord client lists strict global and guild voice-region inventories", async () => {
  const requests: Array<{ method: string | undefined; url: string }> = []
  const records: RecordedObservation[] = []
  const payload = [
    {
      custom: false,
      deprecated: false,
      future_region_field: "omitted",
      id: "us-central",
      name: "US Central",
      optimal: true,
    },
    {
      custom: true,
      deprecated: false,
      id: "amsterdam",
      name: "Amsterdam",
      optimal: false,
    },
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({ method: init?.method, url: String(input) })
      return jsonResponse(payload)
    },
    observer: recordingObserver(records),
    token: TOKEN,
  })

  const global = await client.listVoiceRegions()
  const guild = await client.listGuildVoiceRegions("100")

  assert.deepEqual(global, [
    {
      custom: true,
      deprecated: false,
      id: "amsterdam",
      name: "Amsterdam",
      optimal: false,
      unknownFieldCount: 0,
    },
    {
      custom: false,
      deprecated: false,
      id: "us-central",
      name: "US Central",
      optimal: true,
      unknownFieldCount: 1,
    },
  ])
  assert.deepEqual(guild, global)
  assert.deepEqual(requests, [
    { method: "GET", url: `${API_BASE_URL}/voice/regions` },
    { method: "GET", url: `${API_BASE_URL}/guilds/100/regions` },
  ])
  assert.deepEqual(records.map(({ operation }) => operation), [
    "list_voice_regions",
    "list_guild_voice_regions",
  ])
})

test("Discord client rejects malformed voice-region evidence before returning it", async () => {
  for (const payload of [
    {},
    [{ custom: false, deprecated: false, id: "us-central", name: "US Central" }],
    [{ custom: false, deprecated: false, id: " bad", name: "US Central", optimal: true }],
    [
      { custom: false, deprecated: false, id: "same", name: "One", optimal: true },
      { custom: true, deprecated: false, id: "same", name: "Two", optimal: false },
    ],
  ]) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(payload),
      token: TOKEN,
    })
    await assert.rejects(client.listVoiceRegions(), VoiceRegionEvidenceError)
  }
})

test("Discord client projects voice metadata and sends one exact sparse voice patch", async () => {
  const requests: Array<{ body: unknown; method: string | undefined; url: string }> = []
  const records: RecordedObservation[] = []
  const voicePayload = channelMetadataPayload({
    bitrate: 96_000,
    default_auto_archive_duration: null,
    default_thread_rate_limit_per_user: 0,
    nsfw: false,
    rate_limit_per_user: 0,
    rtc_region: "us-central",
    topic: null,
    type: 2,
    user_limit: 12,
    video_quality_mode: 1,
  })
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) as unknown : null,
        method: init?.method,
        url: String(input),
      })
      return jsonResponse({
        ...voicePayload,
        bitrate: 128_000,
        rtc_region: null,
        user_limit: 25,
        video_quality_mode: 2,
      })
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    sleep: async () => {
      throw new Error("Voice metadata PATCH must not retry")
    },
    token: TOKEN,
  })

  const result = await client.modifyGuildChannelMetadata(
    "200",
    {
      bitrate: 128_000,
      rtcRegion: null,
      userLimit: 25,
      videoQualityMode: 2,
    },
    "Reviewed voice settings",
  )

  assert.equal(result.bitrate, 128_000)
  assert.equal(result.rtcRegion, null)
  assert.equal(result.userLimit, 25)
  assert.equal(result.videoQualityMode, 2)
  assert.deepEqual(requests, [{
    body: {
      bitrate: 128_000,
      rtc_region: null,
      user_limit: 25,
      video_quality_mode: 2,
    },
    method: "PATCH",
    url: `${API_BASE_URL}/channels/200`,
  }])
  assert.deepEqual(records, [{
    completions: [{ outcome: "ok" }],
    operation: "modify_channel_metadata",
    retries: 0,
    runs: 1,
  }])
})

test("Discord client sends one exact non-retried partial channel metadata patch", async () => {
  let requests = 0
  let method = ""
  let body: unknown
  let auditReason = ""
  const records: RecordedObservation[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      requests += 1
      method = init?.method || ""
      body = JSON.parse(String(init?.body)) as unknown
      auditReason = new Headers(init?.headers).get("X-Audit-Log-Reason") || ""
      return jsonResponse(channelMetadataPayload({
        name: "feedback",
        topic: null,
      }))
    },
    maxRetries: 3,
    observer: recordingObserver(records),
    sleep: async () => {
      throw new Error("Channel metadata PATCH must not retry")
    },
    token: TOKEN,
  })

  const result = await client.modifyGuildChannelMetadata(
    "200",
    { name: "feedback", topic: null },
    "Reviewed metadata update",
  )

  assert.equal(requests, 1)
  assert.equal(method, "PATCH")
  assert.deepEqual(body, { name: "feedback", topic: null })
  assert.equal(auditReason, "Reviewed%20metadata%20update")
  assert.equal(result.name, "feedback")
  assert.equal(result.topic, null)
  assert.equal(records[0]?.operation, "modify_channel_metadata")
})

test("Discord client rejects malformed and unsupported channel metadata evidence", async () => {
  for (const payload of [
    channelMetadataPayload({ id: "201" }),
    channelMetadataPayload({ permission_overwrites: undefined }),
    channelMetadataPayload({ type: 11 }),
    channelMetadataPayload({ default_auto_archive_duration: 120 }),
    channelMetadataPayload({ permission_overwrites: [{
      allow: "1024",
      deny: "1024",
      id: "400",
      type: 0,
    }] }),
  ]) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(payload),
      token: TOKEN,
    })
    await assert.rejects(
      client.getGuildChannelMetadata("200"),
      ChannelMetadataEvidenceError,
    )
  }
})

test("Discord client rejects invalid type-specific voice metadata evidence", async () => {
  const voice = {
    bitrate: 96_000,
    default_auto_archive_duration: null,
    default_thread_rate_limit_per_user: 0,
    rate_limit_per_user: 0,
    rtc_region: null,
    topic: null,
    type: 2,
    user_limit: 0,
    video_quality_mode: 1,
  }
  for (const payload of [
    channelMetadataPayload({ ...voice, bitrate: undefined }),
    channelMetadataPayload({ ...voice, bitrate: 384_001 }),
    channelMetadataPayload({ ...voice, user_limit: 100 }),
    channelMetadataPayload({ ...voice, rtc_region: "" }),
    channelMetadataPayload({ ...voice, video_quality_mode: 3 }),
    channelMetadataPayload({ ...voice, bitrate: 64_001, type: 13 }),
    channelMetadataPayload({ ...voice, bitrate: 64_000, type: 13, user_limit: 10_001 }),
    channelMetadataPayload({ bitrate: 96_000 }),
  ]) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(payload),
      token: TOKEN,
    })
    await assert.rejects(
      client.getGuildChannelMetadata("200"),
      ChannelMetadataEvidenceError,
    )
  }
})

test("Discord client validates channel metadata input before fetching", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse(channelMetadataPayload())
    },
    token: TOKEN,
  })

  await assert.rejects(
    client.modifyGuildChannelMetadata("200", {}, "Reviewed"),
    /explicit fields/,
  )
  await assert.rejects(
    client.modifyGuildChannelMetadata("200", { topic: " surrounding " }, "Reviewed"),
    /topic is invalid/,
  )
  await assert.rejects(
    client.modifyGuildChannelMetadata(
      "200",
      { defaultAutoArchiveDuration: 120 },
      "Reviewed",
    ),
    /unsupported/,
  )
  await assert.rejects(
    client.modifyGuildChannelMetadata("200", { bitrate: 7_999 }, "Reviewed"),
    /between 8000 and 384000/,
  )
  await assert.rejects(
    client.modifyGuildChannelMetadata("200", { userLimit: 10_001 }, "Reviewed"),
    /between 0 and 10000/,
  )
  await assert.rejects(
    client.modifyGuildChannelMetadata("200", { rtcRegion: " bad" }, "Reviewed"),
    /voice region is invalid/,
  )
  await assert.rejects(
    client.modifyGuildChannelMetadata("200", { videoQualityMode: 3 }, "Reviewed"),
    /video quality mode is unsupported/,
  )
  await assert.rejects(client.getGuildChannelMetadata("invalid"), /positive Discord snowflake/)
  await assert.rejects(client.listGuildVoiceRegions("invalid"), /positive Discord snowflake/)
  assert.equal(requests, 0)
})

test("Discord client suppresses channel metadata content from failures and never retries writes", async () => {
  const privateText = "private channel topic"
  const transportClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      throw new Error(privateText)
    },
    token: TOKEN,
  })
  await assert.rejects(
    transportClient.getGuildChannelMetadata("200"),
    (error: unknown) => {
      assert(error instanceof Error)
      assert.equal(error.message.includes(privateText), false)
      assert.equal(error.cause, undefined)
      return true
    },
  )

  let requests = 0
  const rateLimitedClient = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({
        code: 20_016,
        message: privateText,
        retry_after: 0,
      }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })
  await assert.rejects(
    rateLimitedClient.modifyGuildChannelMetadata(
      "200",
      { name: "feedback" },
      "Reviewed",
    ),
    (error: unknown) => {
      assert(error instanceof DiscordApiError)
      assert.equal(error.message.includes(privateText), false)
      return true
    },
  )
  assert.equal(requests, 1)
})
