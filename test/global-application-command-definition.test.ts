import assert from "node:assert/strict"
import test from "node:test"

import {
  globalApplicationCommandApiBody,
  globalApplicationCommandDefinitionDigest,
  GlobalApplicationCommandDefinitionError,
  normalizeGlobalApplicationCommandDefinition,
  projectGlobalApplicationCommand,
  sameGlobalApplicationCommandDefinition,
} from "../src/global-application-command-definition.js"
import type { DiscordApplicationCommand } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const COMMAND_ID = "300000000000000001"
const VERSION_ID = "300000000000000002"

function completeDefinition(): Record<string, unknown> {
  return {
    contexts: ["guild", "bot-dm", "private-channel"],
    defaultMemberPermissions: ["MANAGE_GUILD"],
    description: "Review exact command evidence",
    descriptionLocalizations: [{ locale: "de", value: "Exakte Befehlsbelege pruefen" }],
    integrationTypes: ["guild-install", "user-install"],
    name: "review",
    nameLocalizations: [{ locale: "de", value: "pruefen" }],
    nsfw: false,
    options: [{
      description: "Evidence kind",
      name: "kind",
      required: true,
      type: "string",
    }],
    type: "chat-input",
  }
}

function rawCommand(
  definition: Record<string, unknown> = completeDefinition(),
): DiscordApplicationCommand {
  const body = globalApplicationCommandApiBody(definition)
  return {
    application_id: APPLICATION_ID,
    contexts: body.contexts,
    default_member_permissions: body.default_member_permissions,
    description: body.description ?? "",
    ...(body.description_localizations === undefined
      ? {}
      : { description_localizations: body.description_localizations }),
    id: COMMAND_ID,
    integration_types: body.integration_types,
    name: body.name,
    name_localizations: body.name_localizations,
    nsfw: body.nsfw,
    ...(body.options === undefined ? {} : { options: body.options }),
    ...(body.handler === undefined ? {} : { handler: body.handler }),
    type: body.type,
    version: VERSION_ID,
  }
}

test("global definitions normalize explicit scope and encode one complete body", () => {
  const definition = normalizeGlobalApplicationCommandDefinition(completeDefinition())
  assert.equal(definition.type, "chat-input")
  assert.deepEqual(definition.contexts, ["guild", "bot-dm", "private-channel"])
  assert.deepEqual(definition.integrationTypes, ["guild-install", "user-install"])
  const body = globalApplicationCommandApiBody(definition)
  assert.deepEqual(body.contexts, [0, 1, 2])
  assert.deepEqual(body.integration_types, [0, 1])
  assert.equal(body.default_member_permissions, "32")
  assert.equal(body.type, 1)
  assert.equal(body.options?.[0]?.required, true)
  assert.match(globalApplicationCommandDefinitionDigest(definition), /^sha256:[a-f0-9]{64}$/)
})

test("Primary Entry Point definitions are optionless, typed, and handler-complete", () => {
  const definition = normalizeGlobalApplicationCommandDefinition({
    contexts: ["guild"],
    defaultMemberPermissions: null,
    description: "Launch the Activity",
    descriptionLocalizations: [{ locale: "de", value: "Aktivitaet starten" }],
    handler: "discord-launch-activity",
    integrationTypes: ["guild-install"],
    name: "launch",
    nameLocalizations: [],
    nsfw: false,
    type: "primary-entry-point",
  })
  assert.equal(definition.type, "primary-entry-point")
  const body = globalApplicationCommandApiBody(definition)
  assert.deepEqual(body, {
    contexts: [0],
    default_member_permissions: null,
    description: "Launch the Activity",
    description_localizations: { de: "Aktivitaet starten" },
    handler: 2,
    integration_types: [0],
    name: "launch",
    name_localizations: null,
    nsfw: false,
    type: 4,
  })
  assert.throws(
    () => normalizeGlobalApplicationCommandDefinition({
      ...definition,
      options: [],
    }),
    /unknown fields options/,
  )
})

test("full-localization global evidence round trips through canonical definitions", () => {
  const expected = normalizeGlobalApplicationCommandDefinition(completeDefinition())
  const projected = projectGlobalApplicationCommand(
    rawCommand(),
    APPLICATION_ID,
    ["guild-install", "user-install"],
  )
  assert.equal(projected.commandId, COMMAND_ID)
  assert.equal(projected.version, VERSION_ID)
  assert.ok(sameGlobalApplicationCommandDefinition(projected.definition, expected))

  const primaryDefinition = {
    contexts: ["guild", "bot-dm"],
    defaultMemberPermissions: [],
    description: "Launch the Activity",
    handler: "application",
    integrationTypes: ["guild-install"],
    name: "launch",
    nsfw: false,
    type: "primary-entry-point",
  }
  const primary = projectGlobalApplicationCommand(
    rawCommand(primaryDefinition),
    APPLICATION_ID,
    ["guild-install"],
  )
  assert.deepEqual(primary.definition, {
    ...primaryDefinition,
    descriptionLocalizations: [],
    nameLocalizations: [],
  })
})

test("omitted global scope uses documented contexts and application installation defaults", () => {
  const raw = rawCommand()
  delete raw.contexts
  delete raw.integration_types
  const projected = projectGlobalApplicationCommand(
    raw,
    APPLICATION_ID,
    ["guild-install", "user-install"],
  )
  assert.deepEqual(projected.definition.contexts, ["guild", "bot-dm", "private-channel"])
  assert.deepEqual(projected.definition.integrationTypes, ["guild-install", "user-install"])
})

test("global definitions reject ambiguous, incompatible, and noncanonical scope", () => {
  const invalid = [
    { ...completeDefinition(), contexts: [] },
    { ...completeDefinition(), contexts: ["bot-dm", "guild"] },
    { ...completeDefinition(), contexts: ["guild", "guild"] },
    {
      ...completeDefinition(),
      contexts: ["private-channel"],
      integrationTypes: ["guild-install"],
    },
    { ...completeDefinition(), integrationTypes: ["user-install", "guild-install"] },
    { ...completeDefinition(), unknown: true },
  ]
  for (const value of invalid) {
    assert.throws(
      () => normalizeGlobalApplicationCommandDefinition(value),
      GlobalApplicationCommandDefinitionError,
    )
  }

  const deprecatedDm = rawCommand()
  delete deprecatedDm.contexts
  deprecatedDm.dm_permission = true
  assert.throws(
    () => projectGlobalApplicationCommand(
      deprecatedDm,
      APPLICATION_ID,
      ["guild-install", "user-install"],
    ),
    /ambiguous deprecated DM permission/,
  )
  assert.throws(
    () => projectGlobalApplicationCommand({
      ...rawCommand(),
      guild_id: "200000000000000001",
    }, APPLICATION_ID, ["guild-install", "user-install"]),
    /contains a guild ID/,
  )
  assert.throws(
    () => projectGlobalApplicationCommand({
      ...rawCommand(),
      handler: 1,
    }, APPLICATION_ID, ["guild-install", "user-install"]),
    /contains a handler/,
  )
})

test("Primary Entry Point evidence rejects missing handlers and options", () => {
  const primary = rawCommand({
    contexts: ["guild"],
    defaultMemberPermissions: null,
    description: "Launch the Activity",
    handler: "application",
    integrationTypes: ["guild-install"],
    name: "launch",
    nsfw: false,
    type: "primary-entry-point",
  })
  const missingHandler = { ...primary }
  delete missingHandler.handler
  assert.throws(
    () => projectGlobalApplicationCommand(
      missingHandler,
      APPLICATION_ID,
      ["guild-install"],
    ),
    /handler is unsupported/,
  )
  assert.throws(
    () => projectGlobalApplicationCommand(
      {
        ...primary,
        options: [{ description: "Unsafe", name: "unsafe", type: 3 }],
      },
      APPLICATION_ID,
      ["guild-install"],
    ),
    /must not contain options/,
  )
})
