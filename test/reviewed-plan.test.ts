import assert from "node:assert/strict"
import test from "node:test"

import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  requireReviewedPlanDigest,
  resolveSignedReviewedPlanDigest,
  reviewedPlanDigest,
} from "../src/reviewed-plan.js"

test("reviewed plan digests are canonical, process keyed, and shape sensitive", () => {
  const key = new Uint8Array(32).fill(1)
  const otherKey = new Uint8Array(32).fill(2)
  const left = reviewedPlanDigest(key, {
    action: "kick",
    nested: { a: 1, b: 2 },
  })
  const reordered = reviewedPlanDigest(key, {
    nested: { b: 2, a: 1 },
    action: "kick",
  })
  const changed = reviewedPlanDigest(key, {
    action: "ban",
    nested: { a: 1, b: 2 },
  })

  assert.match(left, REVIEWED_PLAN_DIGEST_PATTERN)
  assert.equal(left, reordered)
  assert.notEqual(left, changed)
  assert.notEqual(left, reviewedPlanDigest(otherKey, {
    action: "kick",
    nested: { a: 1, b: 2 },
  }))
})

test("reviewed plan keys are independently generated", () => {
  const first = createReviewedPlanKey()
  const second = createReviewedPlanKey()

  assert.equal(first.length, 32)
  assert.equal(second.length, 32)
  assert.notDeepEqual(first, second)
})

test("reviewed plan digest resolution binds explicit and signed state", () => {
  const digest = `hmac-sha256:${"1".repeat(64)}`
  const otherDigest = `hmac-sha256:${"2".repeat(64)}`

  assert.equal(requireReviewedPlanDigest(digest), digest)
  assert.deepEqual(
    resolveSignedReviewedPlanDigest({ planDigest: digest }, undefined),
    { matchesSignedState: true, planDigest: digest },
  )
  assert.deepEqual(
    resolveSignedReviewedPlanDigest({ planDigest: digest }, digest),
    { matchesSignedState: true, planDigest: digest },
  )
  assert.throws(
    () => resolveSignedReviewedPlanDigest({}, undefined),
    /does not contain a valid reviewed plan digest/,
  )
  assert.throws(
    () => resolveSignedReviewedPlanDigest({ planDigest: "invalid" }, undefined),
    /does not contain a valid reviewed plan digest/,
  )
  assert.deepEqual(
    resolveSignedReviewedPlanDigest({ planDigest: digest }, otherDigest),
    { matchesSignedState: false, planDigest: otherDigest },
  )
})
