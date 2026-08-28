import assert from "node:assert/strict"
import test from "node:test"

import { InteractionRateLimitError } from "../src/errors.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"

test("interaction limiter enforces per-channel spacing without sleeping", () => {
  let now = 1_000
  const limiter = new InteractionLimiter({
    clock: () => now,
    maxWritesPerMinute: 10,
    minWriteIntervalMs: 500,
  })

  limiter.reserve("200")
  assert.throws(
    () => limiter.reserve("200"),
    (error: unknown) => (
      error instanceof InteractionRateLimitError
      && error.retryAfterMs === 500
    ),
  )
  limiter.reserve("201")
  now += 500
  limiter.reserve("200")
})

test("interaction limiter applies a rolling global budget and expires old reservations", () => {
  let now = 10_000
  const limiter = new InteractionLimiter({
    clock: () => now,
    maxWritesPerMinute: 2,
    minWriteIntervalMs: 0,
  })

  limiter.reserve("200")
  now += 10_000
  limiter.reserve("201")
  assert.throws(
    () => limiter.reserve("202"),
    (error: unknown) => (
      error instanceof InteractionRateLimitError
      && error.retryAfterMs === 50_000
    ),
  )
  now += 50_000
  limiter.reserve("202")
})

test("interaction limiter separates transient and durable channel cooldowns", () => {
  let now = 1_000
  const limiter = new InteractionLimiter({
    clock: () => now,
    maxWritesPerMinute: 4,
    minWriteIntervalMs: 1_000,
  })

  limiter.reserve("200", "transient")
  limiter.reserve("200")
  assert.throws(
    () => limiter.reserve("200", "transient"),
    (error: unknown) => (
      error instanceof InteractionRateLimitError
      && error.retryAfterMs === 1_000
    ),
  )
  assert.throws(
    () => limiter.reserve("200"),
    (error: unknown) => (
      error instanceof InteractionRateLimitError
      && error.retryAfterMs === 1_000
    ),
  )

  now += 1_000
  limiter.reserve("200", "transient")
  limiter.reserve("200")
})

test("interaction limiter rejects invalid direct construction", () => {
  assert.throws(
    () => new InteractionLimiter({ maxWritesPerMinute: 0, minWriteIntervalMs: 0 }),
    /positive integer/,
  )
  assert.throws(
    () => new InteractionLimiter({ maxWritesPerMinute: 1, minWriteIntervalMs: -1 }),
    /non-negative integer/,
  )

  const limiter = new InteractionLimiter({
    maxWritesPerMinute: 1,
    minWriteIntervalMs: 0,
  })
  assert.throws(
    () => limiter.reserve("200", "other" as never),
    /lane is invalid/,
  )
})
