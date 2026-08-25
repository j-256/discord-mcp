import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeDiscordGatewayUrl,
  projectGatewayBotDiscovery,
  validateGatewayBotDiscovery,
} from "../src/gateway-discovery.js"

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    future_top_level: "discarded",
    session_start_limit: {
      future_limit_field: "discarded",
      max_concurrency: 1,
      remaining: 999,
      reset_after: 14_400_000,
      total: 1_000,
    },
    shards: 1,
    url: "wss://gateway.discord.gg/",
    ...overrides,
  }
}

test("Gateway Bot discovery projects only a normalized endpoint and bounded counters", () => {
  const result = projectGatewayBotDiscovery(response())

  assert.deepEqual(result, {
    sessionStartLimit: {
      maxConcurrency: 1,
      remaining: 999,
      resetAfterMs: 14_400_000,
      total: 1_000,
    },
    shards: 1,
    url: "wss://gateway.discord.gg/?v=10&encoding=json",
  })
  assert.deepEqual(validateGatewayBotDiscovery(result), result)
  assert.doesNotMatch(JSON.stringify(result), /future/)
})

test("Gateway URL normalization accepts only credential-free Discord WSS hosts", () => {
  assert.equal(
    normalizeDiscordGatewayUrl("wss://gateway-us-east1-b.discord.gg/custom?old=true"),
    "wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json",
  )
  for (const value of [
    "https://gateway.discord.gg/",
    "wss://credential@gateway.discord.gg/",
    "wss://gateway.discord.gg:444/",
    "wss://gateway.discord.gg.evil.example/",
    "wss://notgateway.discord.gg/",
    "not a URL",
    "x".repeat(2_049),
  ]) {
    assert.equal(normalizeDiscordGatewayUrl(value), undefined)
  }
})

test("Gateway Bot discovery rejects non-root endpoints and malformed limit evidence", () => {
  const invalid: unknown[] = [
    null,
    [],
    response({ url: "wss://gateway.discord.gg/private" }),
    response({ url: "wss://gateway.discord.gg/?token=private" }),
    response({ shards: 0 }),
    response({ shards: 1.5 }),
    response({ shards: "1" }),
    response({ session_start_limit: null }),
    response({
      session_start_limit: {
        max_concurrency: 1,
        remaining: 1,
        reset_after: 1,
        total: 0,
      },
    }),
    response({
      session_start_limit: {
        max_concurrency: 1,
        remaining: -1,
        reset_after: 1,
        total: 1,
      },
    }),
    response({
      session_start_limit: {
        max_concurrency: 1,
        remaining: 2,
        reset_after: 1,
        total: 1,
      },
    }),
    response({
      session_start_limit: {
        max_concurrency: 1,
        remaining: 1,
        reset_after: -1,
        total: 1,
      },
    }),
    response({
      session_start_limit: {
        max_concurrency: 0,
        remaining: 1,
        reset_after: 1,
        total: 1,
      },
    }),
  ]

  for (const value of invalid) {
    assert.throws(
      () => projectGatewayBotDiscovery(value),
      /Gateway Bot discovery response is invalid/,
    )
  }
  assert.throws(
    () => validateGatewayBotDiscovery({
      sessionStartLimit: {
        maxConcurrency: 1,
        remaining: 1,
        resetAfterMs: 1,
        total: 1,
      },
      shards: 1,
      url: "wss://gateway.discord.gg/private",
    }),
    /Gateway Bot discovery response is invalid/,
  )
})
