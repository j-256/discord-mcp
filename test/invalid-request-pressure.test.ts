import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_INVALID_REQUEST_PRESSURE,
  InvalidRequestPressureTracker,
} from "../src/invalid-request-pressure.js"

test("invalid-request pressure classifies statuses and excludes proven shared rate limits", () => {
  const tracker = new InvalidRequestPressureTracker(() => 0)

  assert.equal(tracker.record({ sharedRateLimit: false, statusCode: 200 }), false)
  assert.equal(tracker.record({ sharedRateLimit: false, statusCode: 404 }), false)
  assert.equal(tracker.record({ sharedRateLimit: false, statusCode: 401 }), true)
  assert.equal(tracker.record({ sharedRateLimit: false, statusCode: 403 }), true)
  assert.equal(tracker.record({ sharedRateLimit: false, statusCode: 429 }), true)
  assert.equal(tracker.record({ sharedRateLimit: true, statusCode: 429 }), false)

  assert.deepEqual(tracker.snapshot(), {
    coverage: "this-process-only",
    discordDocumentedLimit: DISCORD_INVALID_REQUEST_PRESSURE.documentedLimit,
    discordDocumentedWindowMs: DISCORD_INVALID_REQUEST_PRESSURE.documentedWindowMs,
    ipWideTotalKnown: false,
    observed: {
      forbidden403: 1,
      rateLimited429: 1,
      total: 3,
      unauthorized401: 1,
    },
    sharedScope429Excluded: true,
    state: "observed",
    thresholdReachedByThisProcess: false,
    windowResolutionMs: DISCORD_INVALID_REQUEST_PRESSURE.resolutionMs,
  })
})

test("invalid-request pressure expires rolling buckets at the documented window", () => {
  let now = 0
  const tracker = new InvalidRequestPressureTracker(() => now)
  tracker.record({ sharedRateLimit: false, statusCode: 401 })

  now = DISCORD_INVALID_REQUEST_PRESSURE.documentedWindowMs - 1
  assert.equal(tracker.snapshot().observed.total, 1)

  now = DISCORD_INVALID_REQUEST_PRESSURE.documentedWindowMs
  assert.deepEqual(tracker.snapshot().observed, {
    forbidden403: 0,
    rateLimited429: 0,
    total: 0,
    unauthorized401: 0,
  })
  assert.equal(tracker.snapshot().state, "clear")
})

test("invalid-request pressure aggregates high volume without per-response retention", () => {
  let now = 123_456
  const tracker = new InvalidRequestPressureTracker(() => now)
  const responses = DISCORD_INVALID_REQUEST_PRESSURE.documentedLimit + 1
  for (let index = 0; index < responses; index += 1) {
    tracker.record({ sharedRateLimit: false, statusCode: 403 })
  }

  const saturated = tracker.snapshot()
  assert.equal(saturated.observed.forbidden403, responses)
  assert.equal(saturated.observed.total, responses)
  assert.equal(saturated.state, "documented-limit-reached")
  assert.equal(saturated.thresholdReachedByThisProcess, true)

  now += DISCORD_INVALID_REQUEST_PRESSURE.documentedWindowMs
  assert.equal(tracker.snapshot().observed.total, 0)
})
