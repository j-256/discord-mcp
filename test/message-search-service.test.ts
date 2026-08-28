import assert from "node:assert/strict"
import test from "node:test"

import {
  conversationRecallTimestampSnowflake,
  MessageSearchService,
  normalizeConversationRecallRequest,
  type MessageSearchServiceClient,
} from "../src/message-search-service.js"
import { ConversationRecallEvidenceError, PolicyError } from "../src/errors.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
  DiscordMessageSearchIndexing,
  DiscordMessageSearchResponse,
} from "../src/types.js"
import { loadFixtureConfig } from "./config-fixture.js"

const TOKEN = "test-token"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const OTHER_CHANNEL_ID = "200000000000000002"
const AUTHOR_ID = "300000000000000001"
const MESSAGE_A = "400000000000000001"
const MESSAGE_B = "400000000000000002"
const MESSAGE_C = "400000000000000000"
const MESSAGE_D = "400000000000000004"
const TIMESTAMP_A = "2026-08-27T23:59:57.000Z"
const TIMESTAMP_B = "2026-08-27T23:59:58.000Z"
const TIMESTAMP_C = "2026-08-27T23:59:59.000Z"

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-channel-name",
    type: 0,
    ...overrides,
  }
}

function message(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    author: {
      bot: false,
      id: AUTHOR_ID,
      username: "private-user-name",
    },
    channel_id: CHANNEL_ID,
    content: "remembered evidence",
    guild_id: GUILD_ID,
    id: MESSAGE_B,
    timestamp: TIMESTAMP_B,
    type: 0,
    ...overrides,
  }
}

function searchResponse(
  messages: DiscordMessage[],
  overrides: Partial<DiscordMessageSearchResponse> = {},
): DiscordMessageSearchResponse {
  return {
    doing_deep_historical_index: false,
    messages: messages.map((entry) => [entry]),
    total_results: messages.length,
    ...overrides,
  }
}

function policy(channelIds: readonly string[] = [CHANNEL_ID]): ScopePolicy {
  return new ScopePolicy(loadFixtureConfig({
    readScope: {
      channelIds,
      guildIds: [GUILD_ID],
    },
    token: TOKEN,
  }))
}

function fixture(overrides: Partial<MessageSearchServiceClient> = {}) {
  const calls = {
    channel: [] as string[],
    context: [] as Array<{ around?: string; limit?: number; signal?: AbortSignal }>,
    search: [] as Array<{
      content?: string
      maxId?: string
      minId?: string
      signal?: AbortSignal
    }>,
  }
  const client: MessageSearchServiceClient = {
    async getChannel(channelId) {
      calls.channel.push(channelId)
      return channel({ id: channelId })
    },
    async listMessages(_channelId, options) {
      calls.context.push(options || {})
      const targetId = options?.around || MESSAGE_B
      const target = targetId === MESSAGE_A
        ? message({ id: MESSAGE_A, timestamp: TIMESTAMP_A })
        : message()
      return [
        message({ id: MESSAGE_D, timestamp: TIMESTAMP_C }),
        target,
        message({ id: MESSAGE_C, timestamp: "2026-08-27T23:59:56.000Z" }),
      ]
    },
    async searchGuildMessages(_guildId, options) {
      calls.search.push(options || {})
      return searchResponse([])
    },
    ...overrides,
  }
  return {
    calls,
    service: new MessageSearchService({ client, policy: policy() }),
  }
}

test("conversation recall normalizes exact bounds and converts ISO timestamps", () => {
  const normalized = normalizeConversationRecallRequest({
    after: "2026-08-27T17:00:00-07:00",
    authorIds: [AUTHOR_ID],
    before: "2026-08-28T01:00:00Z",
    channelIds: [CHANNEL_ID],
    contextRadius: 5,
    guildId: GUILD_ID,
    limit: 3,
    searchPhrases: ["distinct phrase", "alternate wording"],
    slop: 4,
  })

  assert.equal(normalized.after, "2026-08-28T00:00:00.000Z")
  assert.equal(normalized.before, "2026-08-28T01:00:00.000Z")
  assert(BigInt(normalized.minId!) < BigInt(normalized.maxId!))
  assert.deepEqual(normalized.authorIds, [AUTHOR_ID])
  assert.deepEqual(normalized.channelIds, [CHANNEL_ID])
  assert.equal(normalized.contextRadius, 5)
  assert.equal(normalized.limit, 3)
  assert.equal(normalized.slop, 4)

  const boundary = conversationRecallTimestampSnowflake(
    "2026-08-28T00:00:00Z",
    "test boundary",
  )
  assert.equal(boundary.timestamp, "2026-08-28T00:00:00.000Z")
  assert.match(boundary.snowflake, /^[0-9]+$/)
})

test("conversation recall rejects malformed, redundant, and unordered input", () => {
  const base = {
    guildId: GUILD_ID,
    searchPhrases: ["one phrase"],
  }
  assert.throws(
    () => normalizeConversationRecallRequest({ ...base, searchPhrases: [] }),
    /requires between 1 and 5/,
  )
  assert.throws(
    () => normalizeConversationRecallRequest({
      ...base,
      searchPhrases: ["same", "same"],
    }),
    /must be unique/,
  )
  assert.throws(
    () => normalizeConversationRecallRequest({ ...base, searchPhrases: [" padded "] }),
    /trimmed text/,
  )
  assert.throws(
    () => normalizeConversationRecallRequest({ ...base, searchPhrases: ["control\ntext"] }),
    /without controls/,
  )
  assert.throws(
    () => normalizeConversationRecallRequest({
      ...base,
      after: "2026-08-28T02:00:00Z",
      before: "2026-08-28T01:00:00Z",
    }),
    /must precede/,
  )
  assert.throws(
    () => normalizeConversationRecallRequest({
      ...base,
      after: "2015-01-01T00:00:00Z",
    }),
    /after the Discord epoch/,
  )
  assert.throws(
    () => normalizeConversationRecallRequest({
      ...base,
      channelIds: [CHANNEL_ID, CHANNEL_ID],
    }),
    /channel IDs must be unique/,
  )
  assert.throws(
    () => normalizeConversationRecallRequest({
      ...base,
      guildId: `0${GUILD_ID}`,
    }),
    /exact positive Discord snowflake/,
  )
})

test("conversation recall fuses phrases and freshly verifies minimized context", async () => {
  const signal = new AbortController().signal
  const configured = fixture({
    async searchGuildMessages(_guildId, options) {
      configured.calls.search.push(options || {})
      if (options?.content === "alpha phrase") {
        return searchResponse([
          message({ id: MESSAGE_A, timestamp: TIMESTAMP_A }),
          message(),
        ], { documents_indexed: 200, total_results: 9 })
      }
      return searchResponse([
        message(),
        message({ id: MESSAGE_C, timestamp: TIMESTAMP_C }),
      ], { documents_indexed: 201, total_results: 7 })
    },
  })

  const result = await configured.service.recall({
    after: "2026-08-01T00:00:00Z",
    authorIds: [AUTHOR_ID],
    before: "2026-08-28T00:00:00Z",
    channelIds: [CHANNEL_ID],
    contextRadius: 1,
    guildId: GUILD_ID,
    limit: 2,
    searchPhrases: ["alpha phrase", "beta wording"],
    slop: 8,
  }, { signal })

  assert.equal(result.status, "ok")
  assert.deepEqual(result.matches.map((entry) => entry.messageId), [MESSAGE_B, MESSAGE_A])
  assert.deepEqual(result.matches[0]?.matchedPhraseIndexes, [1, 2])
  assert.deepEqual(result.searches.map((entry) => entry.phraseIndex), [1, 2])
  assert.deepEqual(
    configured.calls.search.map((entry) => entry.content),
    ["alpha phrase", "beta wording"],
  )
  assert.equal(configured.calls.search.every((entry) => entry.signal === signal), true)
  assert.equal(configured.calls.context.every((entry) => entry.signal === signal), true)
  assert.equal(configured.calls.context.every((entry) => entry.limit === 3), true)
  assert.deepEqual(
    result.matches[0]?.context.messages.map((entry) => entry.id),
    [MESSAGE_C, MESSAGE_B, MESSAGE_D],
  )
  assert.equal(result.matches[0]?.context.targetOrdinal, 2)
  assert.equal(result.matches[0]?.context.messages[1]?.authorId, AUTHOR_ID)
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /private-user-name|private-channel-name/)
  assert.doesNotMatch(serialized, /alpha phrase|beta wording/)
  assert.match(serialized, /remembered evidence/)
  assert.equal(result.privacy.persistence, "none")
})

test("conversation recall discards partial matches when Discord reports indexing", async () => {
  let contextCalls = 0
  let searchCalls = 0
  const service = new MessageSearchService({
    client: {
      async getChannel() {
        return channel()
      },
      async listMessages() {
        contextCalls += 1
        return []
      },
      async searchGuildMessages() {
        searchCalls += 1
        if (searchCalls === 1) return searchResponse([message()])
        return {
          code: 110000,
          documents_indexed: 42,
          message: "private indexing detail",
          retry_after: 1.25,
        } satisfies DiscordMessageSearchIndexing
      },
    },
    policy: policy(),
  })

  const result = await service.recall({
    guildId: GUILD_ID,
    searchPhrases: ["first", "second", "third"],
  })

  assert.deepEqual(result, {
    attemptedPhraseCount: 2,
    documentsIndexed: 42,
    guildId: GUILD_ID,
    privacy: {
      contextProfiles: "omitted",
      persistence: "none",
      phraseText: "input-only",
      rawPayloads: "omitted",
    },
    retryAfterMs: 1_250,
    schemaVersion: 1,
    searchedPhraseCount: 3,
    status: "indexing",
  })
  assert.equal(contextCalls, 0)
  assert.doesNotMatch(JSON.stringify(result), /private indexing detail|first|second|third/)
})

test("conversation recall enforces exact search scope before Discord contact", async () => {
  let searchCalls = 0
  const service = new MessageSearchService({
    client: {
      async getChannel() {
        return channel()
      },
      async listMessages() {
        return []
      },
      async searchGuildMessages() {
        searchCalls += 1
        return searchResponse([])
      },
    },
    policy: policy(),
  })

  await assert.rejects(
    service.recall({
      channelIds: [OTHER_CHANNEL_ID],
      guildId: GUILD_ID,
      searchPhrases: ["bounded"],
    }),
    PolicyError,
  )
  assert.equal(searchCalls, 0)
})

test("conversation recall rejects conflicting snapshots for one candidate", async () => {
  let contextCalls = 0
  let searchCalls = 0
  const service = new MessageSearchService({
    client: {
      async getChannel() {
        return channel()
      },
      async listMessages() {
        contextCalls += 1
        return [message()]
      },
      async searchGuildMessages() {
        searchCalls += 1
        return searchResponse([
          message(searchCalls === 1 ? {} : { content: "changed between searches" }),
        ])
      },
    },
    policy: policy(),
  })

  await assert.rejects(
    service.recall({
      guildId: GUILD_ID,
      searchPhrases: ["first phrase", "second phrase"],
    }),
    /inconsistent conversation recall search evidence/,
  )
  assert.equal(contextCalls, 0)
})

test("conversation recall rejects malformed search evidence before context", async () => {
  let contextCalls = 0
  const service = new MessageSearchService({
    client: {
      async getChannel() {
        return channel()
      },
      async listMessages() {
        contextCalls += 1
        return [message()]
      },
      async searchGuildMessages() {
        return searchResponse([message({ timestamp: "not-a-timestamp" })])
      },
    },
    policy: policy(),
  })

  await assert.rejects(
    service.recall({ guildId: GUILD_ID, searchPhrases: ["remembered"] }),
    /invalid conversation recall search evidence/,
  )
  assert.equal(contextCalls, 0)
})

test("conversation recall rejects a changed indexed target", async () => {
  const configured = fixture({
    async listMessages() {
      return [message({ content: "edited after search" })]
    },
    async searchGuildMessages() {
      return searchResponse([message()])
    },
  })

  await assert.rejects(
    configured.service.recall({
      guildId: GUILD_ID,
      searchPhrases: ["remembered"],
    }),
    ConversationRecallEvidenceError,
  )
})

test("conversation recall rejects malformed or age-restricted context evidence", async () => {
  const duplicate = fixture({
    async listMessages() {
      return [message(), message()]
    },
    async searchGuildMessages() {
      return searchResponse([message()])
    },
  })
  await assert.rejects(
    duplicate.service.recall({ guildId: GUILD_ID, searchPhrases: ["remembered"] }),
    /invalid conversation recall context evidence/,
  )

  const oversized = fixture({
    async listMessages() {
      return Array.from({ length: 6 }, (_, index) => message({
        id: `40000000000000000${index + 1}`,
      }))
    },
    async searchGuildMessages() {
      return searchResponse([message()])
    },
  })
  await assert.rejects(
    oversized.service.recall({ guildId: GUILD_ID, searchPhrases: ["remembered"] }),
    /invalid conversation recall context evidence/,
  )

  const malformedNeighbor = fixture({
    async listMessages() {
      return [
        message(),
        message({
          author: {
            id: "malformed-author",
            username: "private-user-name",
          },
          id: MESSAGE_A,
        }),
      ]
    },
    async searchGuildMessages() {
      return searchResponse([message()])
    },
  })
  await assert.rejects(
    malformedNeighbor.service.recall({ guildId: GUILD_ID, searchPhrases: ["remembered"] }),
    /invalid conversation recall context evidence/,
  )

  const ageRestricted = fixture({
    async getChannel() {
      return channel({ nsfw: true })
    },
    async searchGuildMessages() {
      return searchResponse([message()])
    },
  })
  await assert.rejects(
    ageRestricted.service.recall({ guildId: GUILD_ID, searchPhrases: ["remembered"] }),
    /became age-restricted/,
  )
})
