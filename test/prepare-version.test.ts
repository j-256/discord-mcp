import assert from "node:assert/strict"
import { resolve } from "node:path"
import test from "node:test"

import {
  compareVersions,
  parseArguments,
  sourceDateEpoch,
  validateReleaseSummary,
} from "../scripts/prepare-version.mjs"

const SUMMARY = Object.freeze({
  highlights: ["Retain compatible behavior"],
  paragraphs: ["Establish the stable version line"],
  version: "2.2.0",
})

test("parses one exact version preparation request", () => {
  assert.deepEqual(
    parseArguments(["2.2.0", "--source-date", "2026-09-03", "--release-summary", "summary.json"]),
    {
      sourceDate: "2026-09-03",
      summaryPath: resolve("summary.json"),
      version: "2.2.0",
    },
  )
})

test("rejects ambiguous or incomplete version preparation requests", () => {
  assert.throws(() => parseArguments(["2.2.0"]), /--source-date is required/)
  assert.throws(
    () => parseArguments(["2.2.0", "--source-date", "2026-09-03"]),
    /--release-summary is required/,
  )
  assert.throws(
    () => parseArguments(["2.2.0-beta.1", "--source-date", "2026-09-03", "--release-summary", "summary.json"]),
    /Invalid stable version/,
  )
  assert.throws(
    () => parseArguments(["02.2.0", "--source-date", "2026-09-03", "--release-summary", "summary.json"]),
    /Invalid stable version/,
  )
  assert.throws(
    () => parseArguments(["2.2.0", "--source-date", "2026-09-03", "--release-summary", "summary.json", "extra"]),
    /Unexpected argument/,
  )
})

test("compares stable versions numerically", () => {
  assert.ok(compareVersions("2.0.0", "1.99.99") > 0)
  assert.ok(compareVersions("2.2.0", "2.1.99") > 0)
  assert.equal(compareVersions("2.2.0", "2.2.0"), 0)
})

test("accepts only exact UTC day boundaries", () => {
  assert.equal(sourceDateEpoch("2026-09-03"), 1_788_393_600)
  assert.throws(() => sourceDateEpoch("2026-02-30"), /Invalid UTC source date/)
  assert.throws(() => sourceDateEpoch("2026-9-3"), /Invalid UTC source date/)
})

test("validates bounded version-matched release summaries", () => {
  assert.equal(validateReleaseSummary(SUMMARY, "2.2.0"), SUMMARY)
  assert.throws(
    () => validateReleaseSummary({ ...SUMMARY, version: "2.2.1" }, "2.2.0"),
    /does not match/,
  )
  assert.throws(
    () => validateReleaseSummary({ ...SUMMARY, paragraphs: ["two\nlines"] }, "2.2.0"),
    /one trimmed line/,
  )
  assert.throws(
    () => validateReleaseSummary({ ...SUMMARY, extra: true }, "2.2.0"),
    /fields are invalid/,
  )
})
