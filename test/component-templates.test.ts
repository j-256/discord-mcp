import assert from "node:assert/strict"
import test from "node:test"

import {
  COMPONENT_TEMPLATE_CATALOG,
  COMPONENT_TEMPLATE_LIMITS,
  COMPONENT_TEMPLATE_NAMES,
  COMPONENT_TEMPLATE_VERSION,
  compileComponentTemplate,
} from "../src/component-templates.js"

const USER_ID = "400000000000000001"
const OTHER_USER_ID = "400000000000000002"

test("compiles every named template into the bounded static layout DSL", () => {
  const fixtures = [
    {
      body: "The maintenance window begins at 20:00 UTC.",
      headline: "Planned maintenance",
      priority: "important",
      template: "announcement",
    },
    {
      impact: "New sessions may fail.",
      nextUpdate: "Within 30 minutes",
      status: "investigating",
      summary: "Authentication errors are elevated.",
      template: "incident-status",
      title: "Authentication incident",
    },
    {
      options: [
        { label: "Option A", votes: 3 },
        { label: "Option B", votes: 1 },
      ],
      question: "Which option should we choose?",
      template: "poll-results",
    },
    {
      changes: ["Added safer templates", "Improved documentation"],
      releaseName: "Discord MCP 1.0",
      summary: "A focused product release.",
      template: "release-notes",
    },
    {
      headline: "Welcome to the server",
      introduction: "Start here before joining the conversation.",
      steps: ["Read the rules", "Choose your roles"],
      template: "welcome-card",
    },
  ] as const

  for (const [index, fixture] of fixtures.entries()) {
    const result = compileComponentTemplate(fixture)

    assert.equal(result.template, COMPONENT_TEMPLATE_NAMES[index])
    assert.equal(result.templateVersion, COMPONENT_TEMPLATE_VERSION)
    assert.equal(result.review.counts.containers, 1)
    assert.equal(result.review.counts.topLevel, 1)
    assert.equal(result.review.layout[0]?.kind, "container")
    assert.equal(result.review.notificationUserIds.length, 0)
    assert.match(result.review.preview, /Container: accent=#[0-9A-F]{6} spoiler=false/)
    assert.ok(result.review.warnings.includes(
      "This static layout registers no button, select, modal, or callback authority",
    ))
  }
})

test("renders deterministic poll totals, percentages, and singular votes", () => {
  const input = Object.freeze({
    options: Object.freeze([
      Object.freeze({ label: "Alpha", votes: 1 }),
      Object.freeze({ label: "Beta", votes: 2 }),
      Object.freeze({ label: "Gamma", votes: 0 }),
    ]),
    question: "Result?",
    template: "poll-results" as const,
  })
  const first = compileComponentTemplate(input)
  const second = compileComponentTemplate(input)
  const container = first.review.layout[0]

  assert.deepEqual(first, second)
  assert.equal(container?.kind, "container")
  if (container?.kind !== "container") assert.fail("Expected a container")
  const resultText = container.components[2]
  assert.equal(resultText?.kind, "text")
  if (resultText?.kind !== "text") assert.fail("Expected poll result text")
  assert.equal(
    resultText.content,
    "- **Alpha:** 1 vote (33.3%)\n- **Beta:** 2 votes (66.7%)\n- **Gamma:** 0 votes (0.0%)\n\n**Total:** 3 votes",
  )
  assert.deepEqual(input.options, [
    { label: "Alpha", votes: 1 },
    { label: "Beta", votes: 2 },
    { label: "Gamma", votes: 0 },
  ])
})

test("uses accessible status text and semantic incident accents", () => {
  const colors = new Map<string, number>()
  for (const status of [
    "identified",
    "investigating",
    "monitoring",
    "resolved",
  ] as const) {
    const result = compileComponentTemplate({
      status,
      summary: "Service state changed.",
      template: "incident-status",
      title: "Service incident",
    })
    const container = result.review.layout[0]
    assert.equal(container?.kind, "container")
    if (container?.kind !== "container") assert.fail("Expected a container")
    colors.set(status, container.accentColor ?? -1)
    const heading = container.components[0]
    assert.equal(heading?.kind, "text")
    if (heading?.kind !== "text") assert.fail("Expected incident heading text")
    assert.match(heading.content, new RegExp(`\\*\\*Status:\\*\\* ${status.slice(0, 1).toUpperCase()}${status.slice(1)}`))
  }

  assert.equal(new Set(colors.values()).size, colors.size)
})

test("projects mentions through the existing notification review", () => {
  const result = compileComponentTemplate({
    body: `Notify <@${USER_ID}> but render <@!${OTHER_USER_ID}> quietly.`,
    headline: "Mention review",
    priority: "information",
    template: "announcement",
  }, [USER_ID])

  assert.deepEqual(result.review.mentionedUserIds, [OTHER_USER_ID, USER_ID].sort())
  assert.deepEqual(result.review.notificationUserIds, [USER_ID])
  assert.deepEqual(result.review.suppressedUserMentionIds, [OTHER_USER_ID])
  assert.ok(result.review.warnings.some((warning) => warning.includes("without notification")))
})

test("publishes a complete immutable local template catalog", () => {
  assert.deepEqual(
    COMPONENT_TEMPLATE_CATALOG.map((entry) => entry.name),
    COMPONENT_TEMPLATE_NAMES,
  )
  assert.equal(Object.isFrozen(COMPONENT_TEMPLATE_CATALOG), true)
  for (const entry of COMPONENT_TEMPLATE_CATALOG) {
    assert.equal(Object.isFrozen(entry), true)
    assert.equal(Object.isFrozen(entry.requiredFields), true)
    assert.equal(Object.isFrozen(entry.optionalFields), true)
    assert.ok(entry.purpose.length > 0)
    assert.ok(entry.accentBehavior.length > 0)
  }
})

test("rejects unknown templates, fields, multiline labels, and malformed text", () => {
  assert.throws(
    () => compileComponentTemplate({ template: "remote-template", source: "https://example.com" }),
    /template\.template must be/,
  )
  assert.throws(
    () => compileComponentTemplate({
      body: "Body",
      headline: "Headline",
      priority: "information",
      rawComponents: [],
      template: "announcement",
    }),
    /unsupported fields: rawComponents/,
  )
  assert.throws(
    () => compileComponentTemplate({
      body: "Body",
      headline: "Two\nlines",
      priority: "information",
      template: "announcement",
    }),
    /headline must be single-line text/,
  )
  assert.throws(
    () => compileComponentTemplate({
      body: "\uD800",
      headline: "Headline",
      priority: "information",
      template: "announcement",
    }),
    /body contains invalid Unicode/,
  )
  assert.throws(
    () => compileComponentTemplate({
      body: "Body\u0000",
      headline: "Headline",
      priority: "information",
      template: "announcement",
    }),
    /body contains unsupported control characters/,
  )
})

test("enforces template-specific collection and numeric limits", () => {
  assert.throws(
    () => compileComponentTemplate({
      changes: Array.from(
        { length: COMPONENT_TEMPLATE_LIMITS.items + 1 },
        (_, index) => `Change ${index}`,
      ),
      releaseName: "Release",
      summary: "Summary",
      template: "release-notes",
    }),
    /changes must contain/,
  )
  assert.throws(
    () => compileComponentTemplate({
      options: [{ label: "Only one", votes: 1 }],
      question: "Question",
      template: "poll-results",
    }),
    /options must contain 2-/,
  )
  assert.throws(
    () => compileComponentTemplate({
      options: [
        { label: "A", votes: -1 },
        { label: "B", votes: 1 },
      ],
      question: "Question",
      template: "poll-results",
    }),
    /votes must be an integer/,
  )
  assert.throws(
    () => compileComponentTemplate({
      options: [
        { label: "A", votes: 0, weight: 1 },
        { label: "B", votes: 0 },
      ],
      question: "Question",
      template: "poll-results",
    }),
    /unsupported fields: weight/,
  )
  assert.throws(
    () => compileComponentTemplate({
      options: [
        { label: "Duplicate", votes: 1 },
        { label: "Duplicate", votes: 2 },
      ],
      question: "Question",
      template: "poll-results",
    }),
    /labels must be unique/,
  )
  assert.throws(
    () => compileComponentTemplate({
      impact: " ",
      status: "resolved",
      summary: "Recovered",
      template: "incident-status",
      title: "Incident",
    }),
    /impact must be non-blank text/,
  )
})

test("rejects invalid requested notification identities", () => {
  assert.throws(
    () => compileComponentTemplate({
      body: "No mention",
      headline: "Announcement",
      priority: "information",
      template: "announcement",
    }, [USER_ID]),
    /must have a visible user mention/,
  )
  assert.throws(
    () => compileComponentTemplate({
      body: `Hello <@${USER_ID}>`,
      headline: "Announcement",
      priority: "information",
      template: "announcement",
    }, [USER_ID, USER_ID]),
    /must be unique/,
  )
})
