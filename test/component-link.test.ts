import assert from "node:assert/strict"
import test from "node:test"

import {
  COMPONENT_LINK_LIMITS,
  canonicalComponentLinkOrigin,
  canonicalComponentLinkOrigins,
  componentLinkOrigin,
  normalizeComponentLinkUrl,
} from "../src/component-link.js"

test("normalizes absolute HTTPS link URLs and derives exact origins", () => {
  assert.equal(
    normalizeComponentLinkUrl("https://Example.com:443/releases?q=one two#details"),
    "https://example.com/releases?q=one%20two#details",
  )
  assert.equal(
    componentLinkOrigin("https://example.com/releases/latest"),
    "https://example.com",
  )
})

test("rejects unsafe or oversized link URLs", () => {
  for (const value of [
    "http://example.com",
    "javascript:alert(1)",
    "https://user:password@example.com",
    " https://example.com",
    "https://example.com\n",
    "https://example.com/\u2028hidden",
    "https://example.com/\uD800",
  ]) {
    assert.throws(() => normalizeComponentLinkUrl(value), RangeError)
  }
  assert.throws(
    () => normalizeComponentLinkUrl(
      `https://example.com/${"a".repeat(COMPONENT_LINK_LIMITS.urlCharacters)}`,
    ),
    /must not exceed 512 characters/,
  )
})

test("requires exact canonical HTTPS origins", () => {
  assert.equal(
    canonicalComponentLinkOrigin("https://docs.example.com:8443"),
    "https://docs.example.com:8443",
  )
  for (const value of [
    "http://example.com",
    "https://Example.com",
    "https://example.com/",
    "https://example.com:443",
    "https://example.com/path",
    "https://example.com?q=1",
    "https://example.com#fragment",
    "https://user@example.com",
  ]) {
    assert.throws(() => canonicalComponentLinkOrigin(value), RangeError)
  }
})

test("requires a bounded unique canonically sorted origin list", () => {
  assert.deepEqual(canonicalComponentLinkOrigins([
    "https://docs.example.com",
    "https://example.com",
  ]), [
    "https://docs.example.com",
    "https://example.com",
  ])
  assert.throws(
    () => canonicalComponentLinkOrigins([
      "https://example.com",
      "https://docs.example.com",
    ]),
    /sorted in canonical order/,
  )
  assert.throws(
    () => canonicalComponentLinkOrigins([
      "https://example.com",
      "https://example.com",
    ]),
    /unique and sorted/,
  )
  assert.throws(
    () => canonicalComponentLinkOrigins(
      Array.from(
        { length: COMPONENT_LINK_LIMITS.origins + 1 },
        (_, index) => `https://${String(index).padStart(3, "0")}.example.com`,
      ),
    ),
    /at most 100 origins/,
  )
})
