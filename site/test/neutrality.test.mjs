import assert from "node:assert/strict"
import test from "node:test"

import { containsSpecificReference } from "../../scripts/neutrality.mjs"

const CLIENT_COMPATIBILITY_NAME = "Gemini CLI"
const ALWAYS_BLOCKED_NAME = String.fromCharCode(99, 111, 100, 101, 120)

test("neutrality permits one named client only in explicit compatibility output", () => {
  assert.equal(containsSpecificReference(CLIENT_COMPATIBILITY_NAME), true)
  assert.equal(containsSpecificReference(CLIENT_COMPATIBILITY_NAME, {
    allowClientCompatibility: true,
  }), false)
  assert.equal(containsSpecificReference(ALWAYS_BLOCKED_NAME, {
    allowClientCompatibility: true,
  }), true)
})
