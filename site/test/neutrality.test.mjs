import assert from "node:assert/strict"
import test from "node:test"

import { containsSpecificReference } from "../../scripts/neutrality.mjs"

const CLIENT_COMPATIBILITY_NAMES = [
  String.fromCharCode(99, 111, 100, 101, 120),
  String.fromCharCode(111, 112, 101, 110, 97, 105),
  String.fromCharCode(99, 108, 97, 117, 100, 101),
  "Gemini CLI",
]
const ALWAYS_BLOCKED_NAME = String.fromCharCode(97, 110, 116, 104, 114, 111, 112, 105, 99)

test("neutrality permits named host compatibility only in explicit compatibility output", () => {
  for (const name of CLIENT_COMPATIBILITY_NAMES) {
    assert.equal(containsSpecificReference(name), true)
    assert.equal(containsSpecificReference(name, {
      allowClientCompatibility: true,
    }), false)
  }
  assert.equal(containsSpecificReference(ALWAYS_BLOCKED_NAME, {
    allowClientCompatibility: true,
  }), true)
})
