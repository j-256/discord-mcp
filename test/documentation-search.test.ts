import assert from "node:assert/strict"
import test from "node:test"

import {
  guildControlDocumentationSearchInputSchema,
  searchGuildControlDocumentation,
} from "../src/documentation-search.js"

test("documentation search finds exact mention-scope recovery guidance", async () => {
  const result = await searchGuildControlDocumentation({
    limit: 3,
    query: "Discord user 786955914723852309 is outside the notification scope",
  })

  assert.equal(result.status, "ok")
  assert.equal(result.authorityGranted, false)
  assert.equal(result.credentialsRequired, false)
  assert.equal(result.discordContacted, false)
  assert.equal(result.matches[0]?.title, "GuildControl MCP complete reference > Configuration > Expanding the user mention allowlist")
  assert.equal(
    result.matches[0]?.source,
    "docs/reference.md#expanding-the-user-mention-allowlist",
  )
  assert.match(result.matches[0]?.excerpt || "", /scopes\.mentionUserIds/)
  assert.match(result.matches[0]?.excerpt || "", /guildctl config replace/)
  assert.match(result.matches[0]?.excerpt || "", /notifyUserIds/)
  assert.doesNotMatch(JSON.stringify(result), /786955914723852309/)
  assert.doesNotMatch(JSON.stringify(result), /\/c\/guildcontrol/)
})

test("documentation search explains why mention scope is strict and when review replaces it", async () => {
  const result = await searchGuildControlDocumentation({
    limit: 2,
    query: "Why require a strict user ID list for mentions?",
  })

  assert.equal(
    result.matches[0]?.source,
    "docs/safety-usability.md#why-a-strict-user-id-list-still-exists",
  )
  assert.match(result.matches[0]?.excerpt || "", /spam, phishing, or accidental escalation/)
  assert.match(result.matches[0]?.excerpt || "", /unattended automation/)
  assert.equal(result.authorityGranted, false)
  assert.equal(result.discordContacted, false)
})

test("documentation search returns no weak match and validates its bounds", async () => {
  const naturalLanguage = await searchGuildControlDocumentation({
    limit: 1,
    query: "How do I expand its mention scope?",
  })
  const result = await searchGuildControlDocumentation({
    limit: 5,
    query: "quuxfrobnicator zzyzxwibble",
  })

  assert.equal(
    naturalLanguage.matches[0]?.source,
    "docs/reference.md#expanding-the-user-mention-allowlist",
  )
  assert.equal(result.totalMatches, 0)
  assert.deepEqual(result.matches, [])
  assert.throws(
    () => guildControlDocumentationSearchInputSchema.parse({
      limit: 6,
      query: "configuration",
    }),
  )
  assert.throws(
    () => guildControlDocumentationSearchInputSchema.parse({
      query: " ",
    }),
  )
})
