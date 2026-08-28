import assert from "node:assert/strict"
import test from "node:test"

import {
  COMPONENT_LAYOUT_LIMITS,
  assertCompiledComponentLayout,
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
  const compiled = compileComponentLayout(layout)
  assert.deepEqual(compiled, [
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
    actionRows: 0,
    containers: 1,
    linkButtons: 0,
    separators: 2,
    textDisplays: 2,
    topLevel: 3,
    total: 5,
  })
})

test("normalizes and compiles bounded callback-free link rows", () => {
  const layout = normalizeComponentLayout([
    { kind: "text", content: "# Resources" },
    {
      buttons: [
        {
          label: "Documentation",
          url: "https://Docs.Example.com:443/guide?q=one two#start",
        },
        { label: "Status", url: "https://status.example.com" },
      ],
      kind: "link-row",
    },
    {
      components: [
        { kind: "text", content: "More" },
        {
          buttons: [{ label: "Support", url: "https://example.com/support" }],
          kind: "link-row",
        },
      ],
      kind: "container",
    },
  ])

  assert.deepEqual(layout, [
    { kind: "text", content: "# Resources" },
    {
      buttons: [
        {
          label: "Documentation",
          url: "https://docs.example.com/guide?q=one%20two#start",
        },
        { label: "Status", url: "https://status.example.com/" },
      ],
      kind: "link-row",
    },
    {
      accentColor: null,
      components: [
        { kind: "text", content: "More" },
        {
          buttons: [{ label: "Support", url: "https://example.com/support" }],
          kind: "link-row",
        },
      ],
      kind: "container",
      spoiler: false,
    },
  ])
  const compiled = compileComponentLayout(layout)
  assert.deepEqual(compiled, [
    { content: "# Resources", type: 10 },
    {
      components: [
        {
          label: "Documentation",
          style: 5,
          type: 2,
          url: "https://docs.example.com/guide?q=one%20two#start",
        },
        {
          label: "Status",
          style: 5,
          type: 2,
          url: "https://status.example.com/",
        },
      ],
      type: 1,
    },
    {
      components: [
        { content: "More", type: 10 },
        {
          components: [{
            label: "Support",
            style: 5,
            type: 2,
            url: "https://example.com/support",
          }],
          type: 1,
        },
      ],
      spoiler: false,
      type: 17,
    },
  ])
  assert.deepEqual(componentLayoutCounts(layout), {
    actionRows: 2,
    containers: 1,
    linkButtons: 3,
    separators: 0,
    textDisplays: 2,
    topLevel: 3,
    total: 8,
  })
  assert.doesNotThrow(() => assertCompiledComponentLayout(compiled))
  assert.throws(
    () => assertCompiledComponentLayout([
      { content: "Read more", type: 10 },
      {
        components: [{
          custom_id: "callback",
          label: "Unsafe",
          style: 5,
          type: 2,
          url: "https://example.com",
        }],
        type: 1,
      },
    ]),
    /unsupported fields: custom_id/,
  )
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
  assert.throws(
    () => normalizeComponentLayout([
      { kind: "text", content: "hello" },
      { buttons: [], kind: "link-row" },
    ]),
    /must contain 1-5 link buttons/,
  )
  assert.throws(
    () => normalizeComponentLayout([
      { kind: "text", content: "hello" },
      {
        buttons: [{
          customId: "callback",
          label: "Unsafe",
          url: "https://example.com",
        }],
        kind: "link-row",
      },
    ]),
    /unsupported fields: customId/,
  )
  assert.throws(
    () => normalizeComponentLayout([
      { kind: "text", content: "hello" },
      {
        buttons: [{ label: "Line\nbreak", url: "https://example.com" }],
        kind: "link-row",
      },
    ]),
    /single-line text/,
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

test("parses exact Discord link rows and strips generated IDs", () => {
  const parsed = parseDiscordComponentLayout([
    { content: "Read more", id: 1, type: 10 },
    {
      components: [{
        disabled: false,
        id: 3,
        label: "Documentation",
        style: 5,
        type: 2,
        url: "https://example.com/docs",
      }],
      id: 2,
      type: 1,
    },
  ])

  assert.deepEqual(parsed, normalizeComponentLayout([
    { content: "Read more", kind: "text" },
    {
      buttons: [{ label: "Documentation", url: "https://example.com/docs" }],
      kind: "link-row",
    },
  ]))
  assert.throws(
    () => parseDiscordComponentLayout([
      { content: "Read more", id: 1, type: 10 },
      {
        components: [{
          custom_id: "callback",
          id: 3,
          label: "Unsafe",
          style: 5,
          type: 2,
          url: "https://example.com",
        }],
        id: 2,
        type: 1,
      },
    ]),
    /unsupported fields: custom_id/,
  )
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
    actionRows: 0,
    containers: 1,
    linkButtons: 0,
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

test("reviews exact normalized link destinations and redirect limitations", () => {
  const review = reviewComponentLayout([
    { kind: "text", content: "Choose a destination" },
    {
      buttons: [
        { label: "Docs", url: "https://docs.example.com/guide" },
        { label: "Home", url: "https://example.com" },
        { label: "Again", url: "https://docs.example.com/other" },
      ],
      kind: "link-row",
    },
  ], [])

  assert.deepEqual(review.linkOrigins, [
    "https://docs.example.com",
    "https://example.com",
  ])
  assert.deepEqual(review.linkUrls, [
    "https://docs.example.com/guide",
    "https://example.com/",
    "https://docs.example.com/other",
  ])
  assert.match(review.preview, /Link Button: "Docs" -> https:\/\/docs\.example\.com\/guide/)
  assert.ok(review.warnings.some((warning) => warning.includes("verify redirects")))
  assert.ok(review.warnings.some((warning) => warning.includes("without callback authority")))
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
