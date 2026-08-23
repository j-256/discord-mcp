import assert from "node:assert/strict"
import test from "node:test"

import {
  DiscordClient,
  DISCORD_SCHEDULED_EVENT_ENTITY_TYPES,
  DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES,
  DISCORD_SCHEDULED_EVENT_STATUSES,
  type DiscordScheduledEventRecurrenceInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  ScheduledEventEvidenceError,
} from "../src/errors.js"

const TOKEN = "test-discord-token-value"
const API_BASE_URL = "https://discord.test/api/v10"
const GUILD_ID = "100"
const EVENT_ID = "200"
const CHANNEL_ID = "300"
const USER_ID = "401"
const OTHER_USER_ID = "402"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel_id: CHANNEL_ID,
    creator: {
      avatar: "private-avatar",
      id: "400",
      username: "private-name",
    },
    creator_id: "400",
    description: null,
    entity_id: null,
    entity_metadata: null,
    entity_type: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.voice,
    guild_id: GUILD_ID,
    id: EVENT_ID,
    image: "private-cover-hash",
    name: "Community call",
    privacy_level: 2,
    recurrence_rule: null,
    scheduled_end_time: null,
    scheduled_start_time: "2026-09-01T20:00:00+00:00",
    status: DISCORD_SCHEDULED_EVENT_STATUSES.scheduled,
    ...overrides,
  }
}

const WEEKLY_RECURRENCE: DiscordScheduledEventRecurrenceInput = {
  byMonth: null,
  byMonthDay: null,
  byNWeekday: null,
  byWeekday: [1],
  frequency: DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.weekly,
  interval: 2,
  startTime: "2026-09-01T20:00:00.000Z",
}

test("Discord client projects scheduled events without profiles or cover hashes", async () => {
  const requestUrls: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requestUrls.push(String(input))
      return jsonResponse([event({
        recurrence_rule: {
          by_month: null,
          by_month_day: null,
          by_n_weekday: null,
          by_weekday: [1],
          by_year_day: null,
          count: null,
          end: null,
          frequency: 2,
          interval: 2,
          start: "2026-09-01T20:00:00Z",
        },
        user_count: 17,
      })])
    },
    token: TOKEN,
  })

  const events = await client.listGuildScheduledEvents(GUILD_ID, {
    includeSubscriberCount: true,
  })

  assert.equal(
    requestUrls[0],
    `${API_BASE_URL}/guilds/${GUILD_ID}/scheduled-events?with_user_count=true`,
  )
  assert.equal(events[0]?.subscriberCount, 17)
  assert.equal(events[0]?.hasCoverImage, true)
  assert.equal(events[0]?.scheduledStartTime, "2026-09-01T20:00:00.000Z")
  assert.deepEqual(events[0]?.recurrenceRule, {
    byMonth: null,
    byMonthDay: null,
    byNWeekday: null,
    byWeekday: [1],
    byYearDay: null,
    count: null,
    endTime: null,
    frequency: 2,
    interval: 2,
    startTime: "2026-09-01T20:00:00.000Z",
  })
  assert.equal(JSON.stringify(events).includes("private-avatar"), false)
  assert.equal(JSON.stringify(events).includes("private-name"), false)
  assert.equal(JSON.stringify(events).includes("private-cover-hash"), false)
})

test("Discord client requests member-free scheduled event users and projects IDs immediately", async () => {
  const requestUrls: string[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input) => {
      requestUrls.push(String(input))
      return jsonResponse([
        {
          guild_scheduled_event_id: EVENT_ID,
          user: {
            avatar: "private-avatar",
            bot: false,
            global_name: "Private display name",
            id: USER_ID,
            username: "private-username",
          },
        },
        {
          guild_scheduled_event_id: EVENT_ID,
          user: {
            bot: true,
            id: OTHER_USER_ID,
            username: "private-bot-name",
          },
        },
      ])
    },
    token: TOKEN,
  })

  const users = await client.listGuildScheduledEventUsers(GUILD_ID, EVENT_ID, {
    after: "400",
    limit: 2,
  })

  assert.equal(
    requestUrls[0],
    `${API_BASE_URL}/guilds/${GUILD_ID}/scheduled-events/${EVENT_ID}/users?after=400&limit=2&with_member=false`,
  )
  assert.deepEqual(users, [
    { bot: false, eventId: EVENT_ID, userId: USER_ID },
    { bot: true, eventId: EVENT_ID, userId: OTHER_USER_ID },
  ])
  assert.equal(JSON.stringify(users).includes("private"), false)
})

test("Discord client rejects non-positive scheduled event user cursors before network access", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse([])
    },
    token: TOKEN,
  })

  await assert.rejects(
    client.listGuildScheduledEventUsers(GUILD_ID, EVENT_ID, { after: "0" }),
    /must be a positive Discord snowflake/,
  )
  assert.equal(requests, 0)
})

test("Discord client fails closed on expanded or inconsistent scheduled event users", async () => {
  const malformed: unknown[] = [
    [{
      guild_scheduled_event_id: EVENT_ID,
      member: { nick: "private-nickname", roles: [] },
      user: { id: USER_ID },
    }],
    [{ guild_scheduled_event_id: "201", user: { id: USER_ID } }],
    [{ guild_scheduled_event_id: EVENT_ID, user: { bot: "false", id: USER_ID } }],
    [
      { guild_scheduled_event_id: EVENT_ID, user: { id: OTHER_USER_ID } },
      { guild_scheduled_event_id: EVENT_ID, user: { id: USER_ID } },
    ],
  ]
  for (const response of malformed) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(response),
      token: TOKEN,
    })
    await assert.rejects(
      client.listGuildScheduledEventUsers(GUILD_ID, EVENT_ID, { limit: 2 }),
      ScheduledEventEvidenceError,
    )
  }
})

test("Discord client sends exact non-retried scheduled event lifecycle writes", async () => {
  const requests: Array<{
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as unknown : null
      requests.push({
        body,
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url,
      })
      if (init?.method === "DELETE") return new Response(null, { status: 204 })
      if (init?.method === "POST") {
        return jsonResponse(event({
          creator_id: "500",
          recurrence_rule: {
            by_month: null,
            by_month_day: null,
            by_n_weekday: null,
            by_weekday: [1],
            by_year_day: null,
            count: null,
            end: null,
            frequency: 2,
            interval: 2,
            start: "2026-09-01T20:00:00.000Z",
          },
        }))
      }
      return jsonResponse(event({
        description: "Updated",
        image: null,
      }))
    },
    maxRetries: 3,
    token: TOKEN,
  })

  await client.createGuildScheduledEvent(GUILD_ID, {
    channelId: CHANNEL_ID,
    cover: {
      bytes: Buffer.from("png-bytes"),
      format: "png",
    },
    description: "Weekly community call",
    entityType: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.voice,
    location: null,
    name: "Community call",
    recurrenceRule: WEEKLY_RECURRENCE,
    scheduledStartTime: "2026-09-01T20:00:00.000Z",
  }, "Reviewed event create")
  await client.modifyGuildScheduledEvent(GUILD_ID, EVENT_ID, {
    cover: null,
    description: "Updated",
  }, "Reviewed event update")
  await client.deleteGuildScheduledEvent(
    GUILD_ID,
    EVENT_ID,
    "Reviewed event delete",
  )

  assert.deepEqual(requests.map(({ method, reason, url }) => ({
    method,
    reason,
    url,
  })), [
    {
      method: "POST",
      reason: "Reviewed%20event%20create",
      url: `${API_BASE_URL}/guilds/${GUILD_ID}/scheduled-events`,
    },
    {
      method: "PATCH",
      reason: "Reviewed%20event%20update",
      url: `${API_BASE_URL}/guilds/${GUILD_ID}/scheduled-events/${EVENT_ID}`,
    },
    {
      method: "DELETE",
      reason: "Reviewed%20event%20delete",
      url: `${API_BASE_URL}/guilds/${GUILD_ID}/scheduled-events/${EVENT_ID}`,
    },
  ])
  assert.deepEqual(requests[0]?.body, {
    channel_id: CHANNEL_ID,
    description: "Weekly community call",
    entity_metadata: null,
    entity_type: 2,
    image: "data:image/png;base64,cG5nLWJ5dGVz",
    name: "Community call",
    privacy_level: 2,
    recurrence_rule: {
      by_month: null,
      by_month_day: null,
      by_n_weekday: null,
      by_weekday: [1],
      frequency: 2,
      interval: 2,
      start: "2026-09-01T20:00:00.000Z",
    },
    scheduled_start_time: "2026-09-01T20:00:00.000Z",
  })
  assert.deepEqual(requests[1]?.body, {
    description: "Updated",
    image: null,
  })
})

test("Discord client fails closed on malformed scheduled event evidence", async () => {
  const malformed = [
    event({ channel_id: null }),
    event({ entity_type: 3, scheduled_end_time: null }),
    event({ recurrence_rule: {} }),
    event({ scheduled_end_time: "2026-08-01T00:00:00Z" }),
  ]
  for (const value of malformed) {
    const client = new DiscordClient({
      apiBaseUrl: API_BASE_URL,
      fetchImplementation: async () => jsonResponse(value),
      token: TOKEN,
    })
    await assert.rejects(
      client.getGuildScheduledEvent(GUILD_ID, EVENT_ID),
      ScheduledEventEvidenceError,
    )
  }
})

test("Discord client validates recurrence and avoids retrying scheduled event writes", async () => {
  let requests = 0
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse({ message: "rate limited", retry_after: 0 }, 429)
    },
    maxRetries: 3,
    token: TOKEN,
  })

  await assert.rejects(
    client.createGuildScheduledEvent(GUILD_ID, {
      channelId: CHANNEL_ID,
      entityType: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.voice,
      location: null,
      name: "Community call",
      recurrenceRule: {
        ...WEEKLY_RECURRENCE,
        byWeekday: [1, 2],
      },
      scheduledStartTime: "2026-09-01T20:00:00.000Z",
    }, "Reviewed event create"),
    /weekly scheduled event recurrence/,
  )
  assert.equal(requests, 0)

  await assert.rejects(
    client.deleteGuildScheduledEvent(
      GUILD_ID,
      EVENT_ID,
      "Reviewed event delete",
    ),
    (error: unknown) => error instanceof DiscordApiError && error.status === 429,
  )
  assert.equal(requests, 1)
})
