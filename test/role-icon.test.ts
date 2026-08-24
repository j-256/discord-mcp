import assert from "node:assert/strict"
import test from "node:test"

import {
  assertRoleIconUnicodeEmoji,
  isRoleIconUnicodeEmoji,
} from "../src/role-icon.js"

test("role icon Unicode validation accepts one normalized emoji grapheme", () => {
  for (const value of ["1️⃣", "🇺🇳", "👩‍👩‍👧‍👧", "🩵"]) {
    assert.equal(isRoleIconUnicodeEmoji(value), true)
    assert.doesNotThrow(() => assertRoleIconUnicodeEmoji(value))
  }
})

test("role icon Unicode validation rejects text, controls, and ambiguous sequences", () => {
  for (const value of [
    undefined,
    "",
    "not-an-emoji",
    "a\u20E3",
    "🩵 ",
    "🩵🩷",
    "🩵\n",
    "🩵".repeat(65),
    "🩵\uD800",
    "🧑‍é",
  ]) {
    assert.equal(isRoleIconUnicodeEmoji(value), false)
    assert.throws(
      () => assertRoleIconUnicodeEmoji(value),
      /one NFC emoji grapheme/,
    )
  }
})
