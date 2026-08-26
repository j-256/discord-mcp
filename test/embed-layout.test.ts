import assert from "node:assert/strict"
import test from "node:test"

import {
  assertCompiledEmbedLayout,
  compileEmbedLayout,
  EMBED_LAYOUT_LIMITS,
  embedLayoutAggregateCharacters,
  embedLayoutCounts,
  embedLayoutsEqual,
  embedPresentationsEqual,
  normalizeEmbedLayout,
  normalizeEmbedPresentation,
  parseDiscordEmbedResponse,
  reviewEmbedPresentation,
} from "../src/embed-layout.js"

const USER_ID = "123456789012345678"
const OTHER_USER_ID = "223456789012345678"

test("static embed layouts normalize the complete supported presentation contract", () => {
  const presentation = normalizeEmbedPresentation({
    content: "  Hello <@123456789012345678>  ",
    embeds: [{
      authorName: "  Maintainer  ",
      color: 0x58_65_F2,
      description: "  Deployment details  ",
      fields: [
        { inline: true, name: "  Status  ", value: "  Ready  " },
        { name: "Region", value: "Global" },
      ],
      footerText: "  Reviewed  ",
      timestamp: "2026-08-26T12:34:56+00:00",
      title: "  Release  ",
    }],
  })

  assert.deepEqual(presentation, {
    content: `Hello <@${USER_ID}>`,
    embeds: [{
      authorName: "Maintainer",
      color: 0x58_65_F2,
      description: "Deployment details",
      fields: [
        { inline: true, name: "Status", value: "Ready" },
        { inline: false, name: "Region", value: "Global" },
      ],
      footerText: "Reviewed",
      timestamp: "2026-08-26T12:34:56.000Z",
      title: "Release",
    }],
  })
  assert.deepEqual(compileEmbedLayout(presentation.embeds), [{
    author: { name: "Maintainer" },
    color: 0x58_65_F2,
    description: "Deployment details",
    fields: [
      { inline: true, name: "Status", value: "Ready" },
      { inline: false, name: "Region", value: "Global" },
    ],
    footer: { text: "Reviewed" },
    timestamp: "2026-08-26T12:34:56.000Z",
    title: "Release",
  }])
  assert.deepEqual(embedLayoutCounts(presentation.embeds), { embeds: 1, fields: 2 })
  assert.equal(embedLayoutAggregateCharacters(presentation.embeds), 66)
})

test("static embed normalization rejects empty, oversized, malformed, and remote presentation", () => {
  const invalid: unknown[] = [
    [],
    [{}],
    [{ title: " " }],
    [{ title: "x", url: "https://example.com" }],
    [{ image: { url: "https://example.com/image.png" }, title: "x" }],
    [{ title: "x", future: true }],
    [{ color: -1 }],
    [{ color: 0x1_00_00_00 }],
    [{ timestamp: "2026-08-26" }],
    [{ timestamp: "2026-02-31T00:00:00Z" }],
    [{ fields: "not-an-array" }],
    [{ fields: [{ name: "n", value: "v", extra: true }] }],
    [{ title: "bad\u0000text" }],
    [{ title: "\uD800" }],
    [{ title: "x".repeat(EMBED_LAYOUT_LIMITS.titleCharacters + 1) }],
    [{ description: "x".repeat(EMBED_LAYOUT_LIMITS.descriptionCharacters + 1) }],
    [{ fields: Array.from(
      { length: EMBED_LAYOUT_LIMITS.fields + 1 },
      (_, index) => ({ name: String(index), value: "v" }),
    ) }],
    Array.from(
      { length: EMBED_LAYOUT_LIMITS.embeds + 1 },
      (_, index) => ({ title: String(index) }),
    ),
  ]
  for (const value of invalid) {
    assert.throws(() => normalizeEmbedLayout(value), RangeError)
  }
  assert.throws(
    () => normalizeEmbedLayout([
      { description: "x".repeat(4_000) },
      { description: "y".repeat(2_001) },
    ]),
    /6000 characters in total/,
  )
  assert.throws(
    () => normalizeEmbedLayout([
      { description: "😀".repeat(1_501) },
      { description: "😀".repeat(1_501) },
    ]),
    /6000 characters in total/,
  )
  assert.throws(
    () => normalizeEmbedPresentation({ embeds: [{ title: "x" }], extra: true }),
    /unsupported fields/,
  )
  assert.throws(
    () => normalizeEmbedPresentation({
      content: "x".repeat(2_001),
      embeds: [{ title: "x" }],
    }),
    /2000 characters/,
  )
  assert.throws(
    () => normalizeEmbedPresentation({
      content: "See HTTPS://example.com",
      embeds: [{ title: "x" }],
    }),
    /plain content cannot contain HTTP URLs/,
  )
  assert.doesNotThrow(() => normalizeEmbedPresentation({
    embeds: [{ description: "[Reviewed link](https://example.com)" }],
  }))
})

test("static embed response parsing accepts only exact rich server evidence", () => {
  const parsed = parseDiscordEmbedResponse([{
    author: { name: "Maintainer" },
    color: 0,
    description: "Details",
    fields: [{ inline: false, name: "Status", value: "Ready" }],
    footer: { text: "Reviewed" },
    flags: 0,
    timestamp: "2026-08-26T12:34:56.000000+00:00",
    title: "Release",
    type: "rich",
  }])
  assert.deepEqual(parsed, [{
    authorName: "Maintainer",
    color: 0,
    description: "Details",
    fields: [{ inline: false, name: "Status", value: "Ready" }],
    footerText: "Reviewed",
    timestamp: "2026-08-26T12:34:56.000Z",
    title: "Release",
  }])

  for (const value of [
    [{ title: "x", type: "image" }],
    [{ title: "x", url: "https://example.com" }],
    [{ title: "x", image: { url: "https://example.com" } }],
    [{ title: "x", author: { icon_url: "https://example.com" } }],
    [{ title: "x", footer: { text: "f", icon_url: "https://example.com" } }],
    [{ title: "x", flags: 32 }],
  ]) {
    assert.throws(() => parseDiscordEmbedResponse(value), RangeError)
  }
})

test("compiled static embed layouts must be canonical", () => {
  const compiled = [{
    fields: [{ inline: false, name: "Status", value: "Ready" }],
    title: "Release",
  }]
  assert.doesNotThrow(() => assertCompiledEmbedLayout(compiled))
  assert.throws(
    () => assertCompiledEmbedLayout([{ fields: [{ name: "Status", value: "Ready" }], title: "Release" }]),
    /not canonical/,
  )
  assert.throws(
    () => assertCompiledEmbedLayout([{ title: "Release", type: "rich" }]),
    /unsupported fields/,
  )
  assert.throws(
    () => assertCompiledEmbedLayout([{ flags: 0, title: "Release" }]),
    /unsupported fields/,
  )
})

test("static embed reviews bind previews and contain notifications", () => {
  const review = reviewEmbedPresentation({
    content: `Notify <@${USER_ID}> but render <@${OTHER_USER_ID}>`,
    embeds: [{
      description: `Embed mention <@${OTHER_USER_ID}>`,
      title: "Release",
    }],
  }, [USER_ID])

  assert.deepEqual(review.mentionedUserIds, [USER_ID, OTHER_USER_ID])
  assert.deepEqual(review.notificationUserIds, [USER_ID])
  assert.deepEqual(review.suppressedUserMentionIds, [OTHER_USER_ID])
  assert.match(review.preview, /Content: "Notify/)
  assert.match(review.preview, /\[1\] Embed/)
  assert.match(review.preview, /Title: "Release"/)
  assert.match(review.preview, /Description: "Embed mention/)
  assert.ok(review.requestBytes > 0)
  assert.match(review.warnings.join(" "), /rendered without notification/)
  assert.match(review.warnings.join(" "), /unreviewed link embed/)

  assert.throws(
    () => reviewEmbedPresentation({
      content: "No visible notification mention",
      embeds: [{ title: "Release" }],
    }, [USER_ID]),
    /must have a visible user mention in content/,
  )
})

test("static embed equality is order-sensitive and presentation-sensitive", () => {
  const left = normalizeEmbedPresentation({
    content: "Release",
    embeds: [{
      fields: [{ name: "Status", value: "Ready" }],
      title: "One",
    }, { title: "Two" }],
  })
  const same = normalizeEmbedPresentation({
    content: "Release",
    embeds: [{
      fields: [{ inline: false, name: "Status", value: "Ready" }],
      title: "One",
    }, { title: "Two" }],
  })
  const reversed = normalizeEmbedPresentation({
    content: "Release",
    embeds: [{ title: "Two" }, {
      fields: [{ name: "Status", value: "Ready" }],
      title: "One",
    }],
  })
  const changedContent = { ...same, content: "Changed" }

  assert.equal(embedLayoutsEqual(left.embeds, same.embeds), true)
  assert.equal(embedLayoutsEqual(left.embeds, reversed.embeds), false)
  assert.equal(embedPresentationsEqual(left, same), true)
  assert.equal(embedPresentationsEqual(left, changedContent), false)
})
