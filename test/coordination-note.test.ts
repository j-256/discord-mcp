import assert from "node:assert/strict"
import test from "node:test"

import {
  COORDINATION_ADDRESS_FORMAT,
  COORDINATION_ADDRESS_PATTERN,
  COORDINATION_NOTE_BODY_CHARACTERS,
  COORDINATION_NOTE_FORMAT,
  COORDINATION_NOTE_SCHEMA_VERSION,
  createCoordinationAddress,
  encodeCoordinationNote,
  parseCoordinationNote,
} from "../src/coordination-note.js"

const FROM = "dca_AAAAAAAAAAAAAAAAAAAAAA"
const TO = "dca_AQEBAQEBAQEBAQEBAQEBAQ"
const USER_ID = "100000000000000001"

test("coordination addresses are random-shaped, caller-retained, and authority-free", () => {
  const report = createCoordinationAddress((size) => {
    assert.equal(size, 16)
    return Uint8Array.from({ length: size }, (_, index) => index)
  })

  assert.equal(report.format, COORDINATION_ADDRESS_FORMAT)
  assert.equal(report.schemaVersion, COORDINATION_NOTE_SCHEMA_VERSION)
  assert.match(report.address, COORDINATION_ADDRESS_PATTERN)
  assert.equal(report.address, "dca_AAECAwQFBgcICQoLDA0ODw")
  assert.equal(report.authorityGranted, false)
  assert.equal(report.authenticated, false)
  assert.equal(report.callerRetained, true)
  assert.equal(report.persisted, false)
  assert.equal(report.registered, false)
  assert.equal(report.status, "created")
  assert.ok(report.limitations.some((value) => value.includes("spoof")))
})

test("coordination notes round-trip one canonical address envelope", () => {
  const content = encodeCoordinationNote({
    body: "Verify the release and reply with exact evidence.",
    fromAddress: FROM,
    notifyUserId: USER_ID,
    tags: ["release", "handoff"],
    to: { address: TO, kind: "address" },
  })

  assert.equal(content, [
    `[${COORDINATION_NOTE_FORMAT}]`,
    `to=${TO}`,
    `from=${FROM}`,
    "tags=handoff,release",
    `notify=<@${USER_ID}>`,
    "",
    "Verify the release and reply with exact evidence.",
  ].join("\n"))
  assert.deepEqual(parseCoordinationNote(content), {
    body: "Verify the release and reply with exact evidence.",
    fromAddress: FROM,
    notifyUserId: USER_ID,
    tags: ["handoff", "release"],
    to: { address: TO, kind: "address" },
  })
})

test("coordination notes support canonical broadcast without notification", () => {
  const content = encodeCoordinationNote({
    body: "Address available for release work.",
    fromAddress: FROM,
    tags: ["presence"],
    to: { kind: "broadcast" },
  })

  assert.deepEqual(parseCoordinationNote(content), {
    body: "Address available for release work.",
    fromAddress: FROM,
    notifyUserId: null,
    tags: ["presence"],
    to: { kind: "broadcast" },
  })
})

test("coordination note encoding rejects ambiguous or unsafe input", () => {
  assert.throws(
    () => createCoordinationAddress(() => new Uint8Array(15)),
    /randomness is invalid/u,
  )
  assert.throws(
    () => encodeCoordinationNote({
      body: "x",
      fromAddress: "planner",
      to: { kind: "broadcast" },
    }),
    /sender address is invalid/u,
  )
  assert.throws(
    () => encodeCoordinationNote({
      body: "x",
      fromAddress: FROM,
      to: { address: "builder", kind: "address" },
    }),
    /recipient address is invalid/u,
  )
  assert.throws(
    () => encodeCoordinationNote({
      body: "x",
      fromAddress: FROM,
      tags: ["release", "release"],
      to: { kind: "broadcast" },
    }),
    /tags must be unique/u,
  )
  assert.throws(
    () => encodeCoordinationNote({
      body: "x",
      fromAddress: FROM,
      tags: ["Not-Canonical"],
      to: { kind: "broadcast" },
    }),
    /tag is invalid/u,
  )
  assert.throws(
    () => encodeCoordinationNote({
      body: " ".repeat(COORDINATION_NOTE_BODY_CHARACTERS),
      fromAddress: FROM,
      to: { kind: "broadcast" },
    }),
    /body must be/u,
  )
  assert.throws(
    () => encodeCoordinationNote({
      body: "x",
      fromAddress: FROM,
      notifyUserId: "01",
      to: { kind: "broadcast" },
    }),
    /notification user ID is invalid/u,
  )
})

test("coordination note parsing rejects noncanonical or forged shapes", () => {
  const canonical = encodeCoordinationNote({
    body: "Exact body",
    fromAddress: FROM,
    tags: ["handoff", "release"],
    to: { address: TO, kind: "address" },
  })
  for (const invalid of [
    canonical.replace(`[${COORDINATION_NOTE_FORMAT}]`, "[unknown]"),
    canonical.replace("to=", "recipient="),
    canonical.replace("tags=handoff,release", "tags=release,handoff"),
    canonical.replace("notify=", "notify=<@01>"),
    canonical.replace("\n\nExact body", "\nextra=value\n\nExact body"),
    canonical.replace("\n\nExact body", "\n\n"),
  ]) {
    assert.equal(parseCoordinationNote(invalid), undefined)
  }
  assert.equal(parseCoordinationNote(null), undefined)
})
