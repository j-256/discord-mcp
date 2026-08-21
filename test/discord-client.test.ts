import assert from "node:assert/strict"
import test from "node:test"

import {
  type CreateForumPostInput,
  type CreateThreadFromMessageInput,
  type CreateThreadWithoutMessageInput,
  DiscordClient,
} from "../src/discord-client.js"
import {
  ChannelMetadataEvidenceError,
  DiscordApiError,
  OnboardingEvidenceError,
  RoleConfigurationEvidenceError,
  StageInstanceEvidenceError,
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
import type {
  OperationCompletion,
  OperationalErrorCategory,
} from "../src/observability.js"

const TOKEN = "test-discord-token-value"
const API_BASE_URL = "https://discord.test/api/v10"

interface RecordedObservation {
  completions: OperationCompletion[]
  operation: string
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
  assert.equal(requestUrl, `${API_BASE_URL}/oauth2/applications/@me`)
  assert.equal(authorization, `Bot ${TOKEN}`)
  assert.equal(redirect, "error")
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
        return jsonResponse({ flags: 0, join_timestamp: "2026-08-14T00:00:00.000Z" })
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

test("Discord client observes only fixed REST operations, outcomes, status, and retries", async () => {
  const records: RecordedObservation[] = []
  let calls = 0
  const privateChannelId = "299999999999999999"
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      calls += 1
      if (calls === 1) {
        return jsonResponse({ message: "private rate-limit detail", retry_after: 0 }, 429)
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
      retries: 0,
      runs: 1,
    },
  ])
  const observed = JSON.stringify(records)
  assert.equal(observed.includes(privateChannelId), false)
  assert.equal(observed.includes("private"), false)
  assert.equal(observed.includes(TOKEN), false)
})

test("Discord client classifies transport timeout and caller cancellation without details", async () => {
  const categories: OperationalErrorCategory[] = []
  const observer = {
    startDiscordRequest() {
      return {
        end(completion: OperationCompletion) {
          if (completion.errorCategory) categories.push(completion.errorCategory)
        },
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
    () => client.modifyGuildRole("invalid", "300", { hoist: false }, "reviewed"),
    /guild ID/,
  )
  assert.throws(
    () => client.modifyGuildRole("100", "300", { future: true } as never, "reviewed"),
    /supported explicit fields/,
  )
  assert.equal(requests, 1)
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
    /guild ID must be a snowflake/,
  )
  assert.throws(
    () => client.createGuildChannel("100", { name: "valid", type: 2 }, "reviewed"),
    /type is not supported/,
  )
  assert.throws(
    () => client.createGuildChannel("100", {
      name: "Support",
      parentId: "200",
      type: 4,
    }, "reviewed"),
    /category creation does not accept/,
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
    type: 1,
  }, {
    applicationId: null,
    channelId: "200",
    creatorUserId: null,
    guildId: null,
    id: "301",
    name: null,
    type: 3,
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
    topic: "Share product feedback",
    type: 15,
    unknownFieldCount: 2,
  })
  assert.equal(records[0]?.operation, "get_channel_metadata")
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
  await assert.rejects(client.getGuildChannelMetadata("invalid"), /positive Discord snowflake/)
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
