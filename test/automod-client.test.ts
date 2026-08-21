import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_AUTO_MODERATION_ACTION_TYPES,
  DISCORD_AUTO_MODERATION_EVENT_TYPES,
  DISCORD_AUTO_MODERATION_TRIGGER_TYPES,
  DiscordClient,
} from "../src/discord-client.js"
import {
  AutoModerationEvidenceError,
  DiscordApiError,
} from "../src/errors.js"

const TOKEN = "test-discord-token-value"
const API_BASE_URL = "https://discord.test/api/v10"
const GUILD_ID = "100"
const RULE_ID = "200"
const CREATED_RULE_ID = "201"
const CREATOR_ID = "300"
const ALERT_CHANNEL_ID = "400"
const EXEMPT_CHANNEL_ID = "401"
const EXEMPT_ROLE_ID = "500"
const AUDIT_REASON = "Reviewed AutoMod / case 42"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}

function keywordRule(overrides: Record<string, unknown> = {}) {
  return {
    actions: [{
      metadata: { custom_message: "Please revise this message" },
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
    }, {
      metadata: { channel_id: ALERT_CHANNEL_ID },
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage,
    }, {
      metadata: { duration_seconds: 60 },
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout,
    }],
    creator_id: CREATOR_ID,
    enabled: false,
    event_type: DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
    exempt_channels: [EXEMPT_CHANNEL_ID],
    exempt_roles: [EXEMPT_ROLE_ID],
    guild_id: GUILD_ID,
    id: RULE_ID,
    name: "Reviewed keyword policy",
    private_future_field: "must not escape",
    trigger_metadata: {
      allow_list: ["allowed"],
      keyword_filter: ["blocked"],
      regex_patterns: ["^unsafe$"],
    },
    trigger_type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword,
    ...overrides,
  }
}

test("Discord client projects AutoMod reads and sends exact non-retried write contracts", async () => {
  const requests: Array<{
    body: unknown
    method: string | undefined
    reason: string | null
    url: string
  }> = []
  const responses: Response[] = [
    jsonResponse([keywordRule()]),
    jsonResponse(keywordRule()),
    jsonResponse(keywordRule({ id: CREATED_RULE_ID })),
    jsonResponse(keywordRule({ enabled: true })),
    new Response(null, { status: 204 }),
  ]
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string"
          ? JSON.parse(init.body) as unknown
          : null,
        method: init?.method,
        reason: new Headers(init?.headers).get("X-Audit-Log-Reason"),
        url: String(input),
      })
      const response = responses.shift()
      assert.ok(response)
      return response
    },
    maxRetries: 3,
    token: TOKEN,
  })

  const listed = await client.listGuildAutoModerationRules(GUILD_ID)
  const exact = await client.getGuildAutoModerationRule(GUILD_ID, RULE_ID)
  const created = await client.createGuildAutoModerationRule(GUILD_ID, {
    actions: [{
      customMessage: "Please revise this message",
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
    }, {
      channelId: ALERT_CHANNEL_ID,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage,
    }, {
      durationSeconds: 60,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout,
    }],
    exemptChannelIds: [EXEMPT_CHANNEL_ID],
    exemptRoleIds: [EXEMPT_ROLE_ID],
    name: "Reviewed keyword policy",
    trigger: {
      allowList: ["allowed"],
      keywordFilter: ["blocked"],
      regexPatterns: ["^unsafe$"],
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword,
    },
  }, AUDIT_REASON)
  const modified = await client.modifyGuildAutoModerationRule(
    GUILD_ID,
    RULE_ID,
    { enabled: true },
    AUDIT_REASON,
  )
  await client.deleteGuildAutoModerationRule(GUILD_ID, RULE_ID, AUDIT_REASON)

  assert.equal(listed.length, 1)
  assert.deepEqual(exact, listed[0])
  assert.equal(created.id, CREATED_RULE_ID)
  assert.equal(modified.enabled, true)
  assert.equal(JSON.stringify(listed).includes("private_future_field"), false)
  assert.deepEqual(requests, [{
    body: null,
    method: "GET",
    reason: null,
    url: `${API_BASE_URL}/guilds/${GUILD_ID}/auto-moderation/rules`,
  }, {
    body: null,
    method: "GET",
    reason: null,
    url: `${API_BASE_URL}/guilds/${GUILD_ID}/auto-moderation/rules/${RULE_ID}`,
  }, {
    body: {
      actions: [{
        metadata: { custom_message: "Please revise this message" },
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
      }, {
        metadata: { channel_id: ALERT_CHANNEL_ID },
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage,
      }, {
        metadata: { duration_seconds: 60 },
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout,
      }],
      enabled: false,
      event_type: DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
      exempt_channels: [EXEMPT_CHANNEL_ID],
      exempt_roles: [EXEMPT_ROLE_ID],
      name: "Reviewed keyword policy",
      trigger_metadata: {
        allow_list: ["allowed"],
        keyword_filter: ["blocked"],
        regex_patterns: ["^unsafe$"],
      },
      trigger_type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword,
    },
    method: "POST",
    reason: "Reviewed%20AutoMod%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/${GUILD_ID}/auto-moderation/rules`,
  }, {
    body: { enabled: true },
    method: "PATCH",
    reason: "Reviewed%20AutoMod%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/${GUILD_ID}/auto-moderation/rules/${RULE_ID}`,
  }, {
    body: null,
    method: "DELETE",
    reason: "Reviewed%20AutoMod%20%2F%20case%2042",
    url: `${API_BASE_URL}/guilds/${GUILD_ID}/auto-moderation/rules/${RULE_ID}`,
  }])
})

test("Discord client supports the closed AutoMod trigger and action vocabulary", async () => {
  const bodies: Record<string, unknown>[] = []
  const client = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      bodies.push(body)
      const rule = keywordRule({
        actions: body.actions,
        event_type: body.event_type,
        exempt_channels: body.exempt_channels,
        exempt_roles: body.exempt_roles,
        id: String(700 + bodies.length),
        name: body.name,
        trigger_metadata: body.trigger_metadata,
        trigger_type: body.trigger_type,
      })
      return jsonResponse(rule)
    },
    token: TOKEN,
  })

  await client.createGuildAutoModerationRule(GUILD_ID, {
    actions: [{ type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMemberInteraction }],
    exemptChannelIds: [],
    exemptRoleIds: [],
    name: "Profile policy",
    trigger: {
      allowList: [],
      keywordFilter: ["unsafe profile"],
      regexPatterns: [],
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile,
    },
  }, AUDIT_REASON)
  await client.createGuildAutoModerationRule(GUILD_ID, {
    actions: [{
      customMessage: null,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
    }],
    exemptChannelIds: [],
    exemptRoleIds: [],
    name: "Preset policy",
    trigger: {
      allowList: [],
      presets: [1, 2, 3],
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keywordPreset,
    },
  }, AUDIT_REASON)
  await client.createGuildAutoModerationRule(GUILD_ID, {
    actions: [{
      durationSeconds: 300,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout,
    }],
    exemptChannelIds: [],
    exemptRoleIds: [],
    name: "Mention policy",
    trigger: {
      mentionRaidProtectionEnabled: true,
      mentionTotalLimit: 12,
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.mentionSpam,
    },
  }, AUDIT_REASON)
  await client.createGuildAutoModerationRule(GUILD_ID, {
    actions: [{
      customMessage: null,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
    }],
    exemptChannelIds: [],
    exemptRoleIds: [],
    name: "Spam policy",
    trigger: { type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam },
  }, AUDIT_REASON)

  assert.deepEqual(bodies.map((body) => ({
    eventType: body.event_type,
    triggerType: body.trigger_type,
  })), [{
    eventType: DISCORD_AUTO_MODERATION_EVENT_TYPES.memberUpdate,
    triggerType: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile,
  }, {
    eventType: DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
    triggerType: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keywordPreset,
  }, {
    eventType: DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
    triggerType: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.mentionSpam,
  }, {
    eventType: DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
    triggerType: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam,
  }])
})

test("Discord client rejects malformed AutoMod evidence and unsafe input before mutation", async () => {
  let requests = 0
  const malformed = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse(keywordRule({
        actions: [{ type: 99 }],
      }))
    },
    token: TOKEN,
  })

  await assert.rejects(
    () => malformed.getGuildAutoModerationRule(GUILD_ID, RULE_ID),
    AutoModerationEvidenceError,
  )
  assert.equal(requests, 1)

  const guarded = new DiscordClient({
    apiBaseUrl: API_BASE_URL,
    fetchImplementation: async () => {
      requests += 1
      return jsonResponse(keywordRule())
    },
    token: TOKEN,
  })
  await assert.rejects(
    () => guarded.createGuildAutoModerationRule(GUILD_ID, {
      actions: [{
        customMessage: null,
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
      }],
      exemptChannelIds: [],
      exemptRoleIds: [],
      name: "Invalid policy",
      trigger: {
        allowList: [],
        keywordFilter: [],
        regexPatterns: [],
        type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword,
      },
    }, AUDIT_REASON),
    /must contain a keyword or regex/,
  )
  await assert.rejects(
    () => guarded.modifyGuildAutoModerationRule(
      GUILD_ID,
      RULE_ID,
      {} as never,
      AUDIT_REASON,
    ),
    /update fields are invalid/,
  )
  assert.equal(requests, 1)
})

test("Discord client never retries rate-limited AutoMod writes", async () => {
  let requests = 0
  let sleeps = 0
  const client = new DiscordClient({
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
    () => client.modifyGuildAutoModerationRule(
      GUILD_ID,
      RULE_ID,
      { enabled: true },
      AUDIT_REASON,
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
