import assert from "node:assert/strict"
import test from "node:test"

import {
  COMPONENT_LAYOUT_LIMITS,
  compileComponentLayout,
  componentLayoutCounts,
  componentLayoutsEqual,
  normalizeComponentLayout,
  parseDiscordComponentLayout,
  reviewComponentLayout,
} from "../src/component-layout.js"

const USER_ID = "400000000000000001"
const OTHER_USER_ID = "400000000000000002"

test("normalizes explicit static defaults and compiles only supported Discord fields", () => {
  const layout = normalizeComponentLayout([
    { kind: "text", content: "# Release" },
    { kind: "separator" },
    {
      kind: "container",
      accentColor: 0x12_AB_34,
      spoiler: true,
      components: [
        { kind: "text", content: "Details" },
        { kind: "separator", divider: false, spacing: "large" },
      ],
    },
  ])

  assert.deepEqual(layout, [
    { kind: "text", content: "# Release" },
    { kind: "separator", divider: true, spacing: "small" },
    {
      accentColor: 0x12_AB_34,
      components: [
        { kind: "text", content: "Details" },
        { kind: "separator", divider: false, spacing: "large" },
      ],
      kind: "container",
      spoiler: true,
    },
  ])
  assert.deepEqual(compileComponentLayout(layout), [
    { content: "# Release", type: 10 },
    { divider: true, spacing: 1, type: 14 },
    {
      accent_color: 0x12_AB_34,
      components: [
        { content: "Details", type: 10 },
        { divider: false, spacing: 2, type: 14 },
      ],
      spoiler: true,
      type: 17,
    },
  ])
  assert.deepEqual(componentLayoutCounts(layout), {
    containers: 1,
    separators: 2,
    textDisplays: 2,
    topLevel: 3,
    total: 5,
  })
})

test("counts Unicode code points and enforces aggregate text separately", () => {
  const content = "😀".repeat(COMPONENT_LAYOUT_LIMITS.textCharacters)
  assert.throws(
    () => normalizeComponentLayout([
      { kind: "text", content },
      ...Array.from({ length: COMPONENT_LAYOUT_LIMITS.components - 1 }, () => ({
        kind: "separator" as const,
      })),
    ]),
    /Canonical component layout must not exceed 16384 UTF-8 bytes/,
  )
  assert.equal(
    normalizeComponentLayout([{
      kind: "text",
      content: "😀".repeat(3_000),
    }])[0]?.kind,
    "text",
  )
  assert.throws(
    () => normalizeComponentLayout([
      { kind: "text", content: "a".repeat(2_001) },
      { kind: "text", content: "b".repeat(2_000) },
    ]),
    /must not exceed 4000 Unicode characters in total/,
  )
})

test("rejects invisible, malformed, and overly deep layouts", () => {
  assert.throws(() => normalizeComponentLayout([]), /must contain 1-40/)
  assert.throws(
    () => normalizeComponentLayout([{ kind: "separator" }]),
    /at least one Text Display/,
  )
  assert.throws(
    () => normalizeComponentLayout([{ kind: "text", content: "  " }]),
    /non-blank text/,
  )
  assert.throws(
    () => normalizeComponentLayout([{ kind: "text", content: "bad\u0000text" }]),
    /unsupported control/,
  )
  assert.throws(
    () => normalizeComponentLayout([{ kind: "text", content: "\uD800" }]),
    /invalid Unicode/,
  )
  assert.throws(
    () => normalizeComponentLayout([{
      components: [{
        components: [{ kind: "text", content: "nested" }],
        kind: "container",
      }],
      kind: "container",
    }]),
    /cannot nest a container/,
  )
})

test("rejects unknown fields, invalid defaults, colors, and recursive counts", () => {
  assert.throws(
    () => normalizeComponentLayout([{
      content: "hello",
      kind: "text",
      raw: true,
    }]),
    /unsupported fields: raw/,
  )
  assert.throws(
    () => normalizeComponentLayout([
      { kind: "text", content: "hello" },
      { kind: "separator", spacing: "medium" },
    ]),
    /spacing must be small or large/,
  )
  assert.throws(
    () => normalizeComponentLayout([{
      accentColor: 0x1_00_00_00,
      components: [{ kind: "text", content: "hello" }],
      kind: "container",
    }]),
    /accentColor must be an integer/,
  )
  assert.throws(
    () => normalizeComponentLayout([{
      components: [
        { kind: "text", content: "hello" },
        ...Array.from({ length: COMPONENT_LAYOUT_LIMITS.components - 1 }, () => ({
          kind: "separator" as const,
        })),
      ],
      kind: "container",
    }]),
    /exceeds the 40-component message limit/,
  )
})

test("parses generated Discord IDs and normalizes omitted response defaults", () => {
  const expected = normalizeComponentLayout([
    { kind: "text", content: "Hello" },
    {
      components: [
        { kind: "separator" },
        { kind: "text", content: "World" },
      ],
      kind: "container",
    },
  ])
  const parsed = parseDiscordComponentLayout([
    { content: "Hello", id: 1, type: 10 },
    {
      components: [
        { id: 3, type: 14 },
        { content: "World", id: 4, type: 10 },
      ],
      id: 2,
      type: 17,
    },
  ])

  assert.deepEqual(parsed, expected)
  assert.equal(componentLayoutsEqual(parsed, expected), true)
  assert.equal(componentLayoutsEqual(
    parsed,
    normalizeComponentLayout([{ kind: "text", content: "Different" }]),
  ), false)
})

test("rejects invalid Discord-generated component evidence", () => {
  assert.throws(
    () => parseDiscordComponentLayout([{ content: "Hello", type: 10 }]),
    /positive 32-bit integer/,
  )
  assert.throws(
    () => parseDiscordComponentLayout([
      { content: "Hello", id: 1, type: 10 },
      { divider: true, id: 1, spacing: 1, type: 14 },
    ]),
    /duplicates Discord component ID 1/,
  )
  assert.throws(
    () => parseDiscordComponentLayout([{
      content: "Hello",
      id: COMPONENT_LAYOUT_LIMITS.componentId + 1,
      type: 10,
    }]),
    /positive 32-bit integer/,
  )
  assert.throws(
    () => parseDiscordComponentLayout([{ content: "Hello", id: 1, type: 9 }]),
    /not a supported static Discord component/,
  )
  assert.throws(
    () => parseDiscordComponentLayout([{
      content: "Hello",
      custom_id: "hidden-authority",
      id: 1,
      type: 10,
    }]),
    /unsupported fields: custom_id/,
  )
})

test("returns a deterministic privacy-aware review", () => {
  const review = reviewComponentLayout([
    { kind: "text", content: `Hello <@${USER_ID}>` },
    {
      accentColor: 0x00_AA_FF,
      components: [
        { kind: "text", content: `Quiet <@!${OTHER_USER_ID}>` },
        { kind: "separator", divider: false, spacing: "large" },
      ],
      kind: "container",
    },
  ], [USER_ID])

  assert.deepEqual(review.counts, {
    containers: 1,
    separators: 1,
    textDisplays: 2,
    topLevel: 2,
    total: 4,
  })
  assert.deepEqual(review.mentionedUserIds, [OTHER_USER_ID, USER_ID].sort())
  assert.deepEqual(review.notificationUserIds, [USER_ID])
  assert.deepEqual(review.suppressedUserMentionIds, [OTHER_USER_ID])
  assert.equal(
    review.textCharacters,
    [...`Hello <@${USER_ID}>Quiet <@!${OTHER_USER_ID}>`].length,
  )
  assert.match(review.preview, /^\[1\] Text Display:/)
  assert.match(review.preview, /\[2\] Container: accent=#00AAFF spoiler=false/)
  assert.match(review.preview, /\[2\.2\] Separator: divider=false spacing=large/)
  assert.ok(review.warnings.some((warning) => warning.includes("without notification")))
})

test("requires notification IDs to be unique visible mentions", () => {
  assert.throws(
    () => reviewComponentLayout([
      { kind: "text", content: `Hello <@${USER_ID}>` },
    ], [USER_ID, USER_ID]),
    /must be unique/,
  )
  assert.throws(
    () => reviewComponentLayout([
      { kind: "text", content: "Hello" },
    ], [USER_ID]),
    /must have a visible user mention/,
  )
})
