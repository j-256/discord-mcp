import assert from "node:assert/strict"
import test from "node:test"

import {
  GUILD_BLUEPRINT_STARTER_CATALOG,
  GUILD_BLUEPRINT_STARTER_NAMES,
  GUILD_BLUEPRINT_STARTER_OMISSIONS,
  GUILD_BLUEPRINT_STARTER_PRINCIPLES,
  GUILD_BLUEPRINT_STARTER_VERSION,
  compileGuildBlueprintStarter,
} from "../src/guild-blueprint-starters.js"
import { normalizeGuildBlueprintRequest } from "../src/guild-blueprint-service.js"

const GUILD_ID = "100000000000000001"
const OPERATION_KEY = "starter-operation-key-0001"

function input(starter: typeof GUILD_BLUEPRINT_STARTER_NAMES[number]) {
  return {
    auditReason: "Reviewed bundled starter",
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    starter,
  }
}

test("compiles every bundled starter into one strict planner request", () => {
  for (const starter of GUILD_BLUEPRINT_STARTER_NAMES) {
    const result = compileGuildBlueprintStarter(input(starter))
    const {
      operationKeyHash: _operationKeyHash,
      ...normalized
    } = normalizeGuildBlueprintRequest(result.request)

    assert.deepEqual(result.request, normalized)
    assert.equal(result.starter, starter)
    assert.equal(result.starterVersion, GUILD_BLUEPRINT_STARTER_VERSION)
    assert.equal(result.request.guildId, GUILD_ID)
    assert.equal(result.request.operationKey, OPERATION_KEY)
    assert.deepEqual(result.request.scaffold.roles, [])
    assert.equal(
      result.review.resourceCount,
      result.request.scaffold.channels.length,
    )
    assert.equal(
      result.review.purpose,
      GUILD_BLUEPRINT_STARTER_CATALOG.find(({ name }) => name === starter)?.purpose,
    )
    assert.deepEqual(result.request.settings, {
      defaultMessageNotifications: "only-mentions",
      explicitContentFilter: "all-members",
      systemChannel: {
        key: result.review.systemChannelKey,
        kind: "scaffold",
      },
    })
    assert.deepEqual(result.review.policyRequirements.capabilities, [
      "capabilities.guildScaffolds",
      "capabilities.guildSettingsAudit",
      "capabilities.guildSettingsChanges",
    ])
    assert.ok(result.request.scaffold.channels.some((channel) => (
      channel.key === result.review.systemChannelKey
      && channel.kind === "text"
    )))
    assert.equal("community" in result.request, false)
    assert.equal("onboarding" in result.request, false)
    assert.equal("publications" in result.request, false)
    assert.equal("welcomeScreen" in result.request, false)
    assert.equal(JSON.stringify(result).includes("ADMINISTRATOR"), false)
  }
})

test("keeps the catalog and compact layouts deterministic", () => {
  assert.deepEqual(
    GUILD_BLUEPRINT_STARTER_CATALOG.map(({ name }) => name),
    GUILD_BLUEPRINT_STARTER_NAMES,
  )
  assert.equal(Object.isFrozen(GUILD_BLUEPRINT_STARTER_CATALOG), true)
  assert.equal(Object.isFrozen(GUILD_BLUEPRINT_STARTER_PRINCIPLES), true)
  assert.equal(Object.isFrozen(GUILD_BLUEPRINT_STARTER_OMISSIONS), true)

  const expectedLayouts = {
    community: [
      "category:START HERE@root",
      "category:COMMUNITY@root",
      "category:FEEDBACK@root",
      "text:rules@com-01-start",
      "text:announcements@com-01-start",
      "text:general@com-02-social",
      "text:introductions@com-02-social",
      "forum:ideas@com-03-feedback",
    ],
    creator: [
      "category:START HERE@root",
      "category:COMMUNITY@root",
      "category:IDEAS@root",
      "text:announcements@creator-01-start",
      "text:schedule@creator-01-start",
      "text:general@creator-02-community",
      "text:fan-art@creator-02-community",
      "text:clips@creator-02-community",
      "forum:content-ideas@creator-03-ideas",
    ],
    project: [
      "category:INFORMATION@root",
      "category:COLLABORATION@root",
      "category:PLANNING@root",
      "text:readme@project-01-info",
      "text:releases@project-01-info",
      "text:general@project-02-collab",
      "text:help@project-02-collab",
      "text:showcase@project-02-collab",
      "forum:issues@project-03-planning",
      "forum:ideas@project-03-planning",
    ],
    support: [
      "category:START HERE@root",
      "category:SUPPORT@root",
      "category:COMMUNITY@root",
      "text:welcome@support-01-start",
      "text:faq@support-01-start",
      "forum:get-help@support-02-help",
      "forum:bug-reports@support-02-help",
      "text:general@support-03-community",
      "forum:feedback@support-03-community",
    ],
  } as const

  for (const starter of GUILD_BLUEPRINT_STARTER_NAMES) {
    const first = compileGuildBlueprintStarter(input(starter))
    const second = compileGuildBlueprintStarter(Object.freeze(input(starter)))
    assert.deepEqual(first, second)
    assert.deepEqual(
      first.request.scaffold.channels.map((channel) => (
        `${channel.kind}:${channel.name}@${channel.parentKey ?? "root"}`
      )),
      expectedLayouts[starter],
    )
  }
})

test("adds only the optional sparse guild-name phase", () => {
  const result = compileGuildBlueprintStarter({
    ...input("project"),
    guildName: "Reviewed Project Guild",
  })

  assert.deepEqual(result.request.profile, { name: "Reviewed Project Guild" })
  assert.deepEqual(result.review.policyRequirements.capabilities, [
    "capabilities.guildScaffolds",
    "capabilities.guildProfileAudit",
    "capabilities.guildProfileChanges",
    "capabilities.guildSettingsAudit",
    "capabilities.guildSettingsChanges",
  ])
  assert.deepEqual(result.review.policyRequirements.scopes, [
    "readScope.guildIds",
    "scopes.guildScaffoldGuildIds",
    "scopes.guildProfileGuildIds",
    "scopes.guildSettingsGuildIds",
  ])
  assert.deepEqual(result.review.policyRequirements.identity, [
    "identity.applicationId",
    "identity.botId",
  ])
  assert.deepEqual(result.review.policyRequirements.gatewayIntents, ["GUILDS"])
  assert.ok(result.review.warnings.some((warning) => (
    warning.includes("complete reviewed replacement")
  )))
})

test("exposes unresolved permission and ordering work without claiming it", () => {
  const result = compileGuildBlueprintStarter(input("community"))

  assert.deepEqual(result.review.informationChannelKeys, [
    "com-start-01-rules",
    "com-start-02-news",
  ])
  assert.deepEqual(
    result.review.postCompileHardening.map(({ tool }) => tool),
    ["plan_channel_permission_overwrite", "plan_channel_order"],
  )
  assert.ok(result.review.omittedCapabilities.includes("private-areas"))
  assert.ok(result.review.omittedCapabilities.includes("read-only-enforcement"))
  assert.ok(result.review.omittedCapabilities.includes("verification-level-change"))
  assert.ok(result.review.warnings.some((warning) => (
    warning.includes("exact-state logical-name match")
  )))
  assert.ok(result.review.warnings.every((warning) => warning.length > 0))
})

test("rejects remote, unknown, malformed, and unsupported starter inputs", () => {
  assert.throws(
    () => compileGuildBlueprintStarter({
      ...input("community"),
      source: "https://example.com/starter.json",
    } as never),
    /unsupported fields: source/u,
  )
  assert.throws(
    () => compileGuildBlueprintStarter({
      ...input("community"),
      starter: "remote",
    } as never),
    /must be one of/u,
  )
  assert.throws(
    () => compileGuildBlueprintStarter({
      ...input("community"),
      guildId: "not-a-snowflake",
    }),
    /guild ID/u,
  )
  assert.throws(
    () => compileGuildBlueprintStarter({
      ...input("community"),
      operationKey: "short",
    }),
    /operation key/u,
  )
  assert.throws(
    () => compileGuildBlueprintStarter({
      ...input("community"),
      guildName: " x ",
    }),
    /surrounding whitespace/u,
  )
})
