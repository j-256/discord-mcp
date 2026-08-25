import assert from "node:assert/strict"
import test from "node:test"

import {
  GuildApplicationCommandDefinitionError,
  guildApplicationCommandApiBody,
  guildApplicationCommandCharacterCount,
  guildApplicationCommandDefinitionDigest,
  normalizeGuildApplicationCommandDefinition,
  projectGuildApplicationCommand,
  sameGuildApplicationCommandDefinition,
} from "../src/guild-application-command-definition.js"
import type { DiscordApplicationCommand } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const COMMAND_ID = "300000000000000001"
const VERSION_ID = "300000000000000002"

function completeDefinition(): Record<string, unknown> {
  return {
    defaultMemberPermissions: ["MANAGE_GUILD"],
    description: "Review exact command evidence",
    descriptionLocalizations: [{ locale: "de", value: "Exakte Befehlsbelege pruefen" }],
    name: "review",
    nameLocalizations: [{ locale: "de", value: "pruefen" }],
    nsfw: false,
    options: [{
      description: "Evidence workflows",
      name: "evidence",
      options: [{
        description: "Inspect one target",
        name: "inspect",
        options: [{
          choices: [{
            name: "Command",
            nameLocalizations: [{ locale: "de", value: "Befehl" }],
            value: "command",
          }],
          description: "Evidence kind",
          name: "kind",
          required: true,
          type: "string",
        }, {
          channelTypes: ["guild-text", "guild-voice", "guild-forum"],
          description: "Optional channel",
          name: "channel",
          type: "channel",
        }, {
          description: "Optional evidence file",
          fileTypes: ["image", ".pdf"],
          name: "file",
          type: "attachment",
        }],
        type: "subcommand",
      }],
      type: "subcommand-group",
    }, {
      description: "Summarize the inventory",
      name: "summary",
      options: [{
        description: "Maximum entries",
        maximum: 100,
        minimum: 1,
        name: "limit",
        type: "integer",
      }],
      type: "subcommand",
    }],
    type: "chat-input",
  }
}

function rawCommand(
  definition: Record<string, unknown> = completeDefinition(),
): DiscordApplicationCommand {
  const body = guildApplicationCommandApiBody(definition)
  return {
    application_id: APPLICATION_ID,
    default_member_permissions: body.default_member_permissions,
    description: body.description ?? "",
    ...(body.description_localizations === undefined
      ? {}
      : { description_localizations: body.description_localizations }),
    guild_id: GUILD_ID,
    id: COMMAND_ID,
    name: body.name,
    name_localizations: body.name_localizations,
    nsfw: body.nsfw,
    ...(body.options === undefined ? {} : { options: body.options }),
    type: body.type,
    version: VERSION_ID,
  }
}

test("complete command definitions normalize and encode one exact Discord body", () => {
  const normalized = normalizeGuildApplicationCommandDefinition(completeDefinition())
  assert.equal(normalized.type, "chat-input")
  assert.equal(normalized.defaultMemberPermissions?.[0], "MANAGE_GUILD")
  assert.equal(normalized.options.length, 2)
  assert.equal(normalized.options[0]?.type, "subcommand-group")
  assert.equal(normalized.options[1]?.type, "subcommand")

  const body = guildApplicationCommandApiBody(normalized)
  assert.equal(body.type, 1)
  assert.equal(body.default_member_permissions, "32")
  assert.deepEqual(body.name_localizations, { de: "pruefen" })
  assert.deepEqual(body.description_localizations, {
    de: "Exakte Befehlsbelege pruefen",
  })
  assert.deepEqual(body.options?.[0]?.options?.[0]?.options?.[0], {
    autocomplete: false,
    choices: [{
      name: "Command",
      name_localizations: { de: "Befehl" },
      value: "command",
    }],
    description: "Evidence kind",
    description_localizations: null,
    name: "kind",
    name_localizations: null,
    required: true,
    type: 3,
  })
  assert.deepEqual(body.options?.[0]?.options?.[0]?.options?.[1]?.channel_types, [0, 2, 15])
  assert.deepEqual(body.options?.[0]?.options?.[0]?.options?.[2]?.file_types, ["image", ".pdf"])
  assert.ok(guildApplicationCommandCharacterCount(normalized) > 0)
  assert.match(guildApplicationCommandDefinitionDigest(normalized), /^sha256:[a-f0-9]{64}$/)
})

test("context commands reject chat-input fields and encode no empty aggregates", () => {
  const definition = normalizeGuildApplicationCommandDefinition({
    defaultMemberPermissions: [],
    name: "Inspect Member",
    nameLocalizations: [{ locale: "de", value: "Mitglied pruefen" }],
    nsfw: false,
    type: "user",
  })
  assert.deepEqual(guildApplicationCommandApiBody(definition), {
    default_member_permissions: "0",
    name: "Inspect Member",
    name_localizations: { de: "Mitglied pruefen" },
    nsfw: false,
    type: 2,
  })
  assert.throws(
    () => normalizeGuildApplicationCommandDefinition({
      ...definition,
      description: "Not accepted",
    }),
    /unknown fields description/,
  )
})

test("full-localization Discord evidence round trips through the canonical definition", () => {
  const expected = normalizeGuildApplicationCommandDefinition(completeDefinition())
  const raw = rawCommand()
  const scalarOptions = raw.options?.[0]?.options?.[0]?.options
  assert.ok(scalarOptions)
  scalarOptions[1]!.channel_types = [15, 0, 2]
  scalarOptions[2]!.file_types = [".pdf", "image"]
  const projected = projectGuildApplicationCommand(
    raw,
    APPLICATION_ID,
    GUILD_ID,
  )
  assert.equal(projected.commandId, COMMAND_ID)
  assert.equal(projected.version, VERSION_ID)
  assert.ok(sameGuildApplicationCommandDefinition(projected.definition, expected))
  assert.deepEqual(projected.immutableEvidence, {
    contexts: null,
    defaultPermission: null,
    dmPermission: null,
    integrationTypes: null,
  })

  const context = projectGuildApplicationCommand({
    application_id: APPLICATION_ID,
    contexts: [0],
    default_member_permissions: null,
    default_permission: true,
    description: "",
    dm_permission: false,
    guild_id: GUILD_ID,
    id: COMMAND_ID,
    integration_types: [0],
    name: "Inspect Message",
    nsfw: false,
    type: 3,
    version: VERSION_ID,
  }, APPLICATION_ID, GUILD_ID)
  assert.equal(context.definition.type, "message")
  assert.deepEqual(context.immutableEvidence, {
    contexts: [0],
    defaultPermission: true,
    dmPermission: false,
    integrationTypes: [0],
  })
})

test("definitions reject unknown fields, incomplete fields, and unsafe names", () => {
  const invalid = [
    { ...completeDefinition(), extra: true },
    { ...completeDefinition(), description: undefined },
    { ...completeDefinition(), name: "Uppercase" },
    { ...completeDefinition(), name: " leading" },
    { ...completeDefinition(), name: "bad\nname" },
    { ...completeDefinition(), type: "primary-entry-point" },
  ]
  for (const value of invalid) {
    assert.throws(
      () => normalizeGuildApplicationCommandDefinition(value),
      GuildApplicationCommandDefinitionError,
    )
  }
})

test("localizations and named permissions require unique canonical order", () => {
  assert.throws(
    () => normalizeGuildApplicationCommandDefinition({
      ...completeDefinition(),
      nameLocalizations: [
        { locale: "en-US", value: "review" },
        { locale: "de", value: "pruefen" },
      ],
    }),
    /canonical order/,
  )
  assert.throws(
    () => normalizeGuildApplicationCommandDefinition({
      ...completeDefinition(),
      defaultMemberPermissions: ["MANAGE_GUILD", "MANAGE_GUILD"],
    }),
    /canonical order/,
  )
  assert.throws(
    () => normalizeGuildApplicationCommandDefinition({
      ...completeDefinition(),
      defaultMemberPermissions: ["MANAGE_GUILD", "NOT_A_PERMISSION"],
    }),
    /must be one of/,
  )
})

test("option topology is bounded, exact, unique, and required-first", () => {
  const option = {
    description: "Value",
    name: "value",
    type: "string",
  }
  const invalidOptions = [
    [{ ...option, unknown: true }],
    [option, { ...option }],
    [{ ...option, required: false }, { ...option, name: "required", required: true }],
    [option, { description: "Nested", name: "nested", options: [], type: "subcommand" }],
    [{
      description: "Group",
      name: "group",
      options: [{ ...option }],
      type: "subcommand-group",
    }],
    [{
      description: "Nested",
      name: "nested",
      options: [{
        description: "Group",
        name: "group",
        options: [],
        type: "subcommand-group",
      }],
      type: "subcommand",
    }],
  ]
  for (const options of invalidOptions) {
    assert.throws(
      () => normalizeGuildApplicationCommandDefinition({
        ...completeDefinition(),
        options,
      }),
      GuildApplicationCommandDefinitionError,
    )
  }
})

test("choice, autocomplete, and numeric constraints fail closed", () => {
  const invalidOptions = [
    [{
      autocomplete: true,
      choices: [{ name: "One", value: "one" }],
      description: "Query",
      name: "query",
      type: "string",
    }],
    [{
      choices: [{ name: "One", value: "one" }, { name: "One", value: "two" }],
      description: "Query",
      name: "query",
      type: "string",
    }],
    [{
      choices: [{ name: "One", value: 1.5 }],
      description: "Count",
      name: "count",
      type: "integer",
    }],
    [{
      description: "Count",
      maximum: 1,
      minimum: 2,
      name: "count",
      type: "number",
    }],
    [{
      description: "Query",
      maxLength: 1,
      minLength: 2,
      name: "query",
      type: "string",
    }],
  ]
  for (const options of invalidOptions) {
    assert.throws(
      () => normalizeGuildApplicationCommandDefinition({
        ...completeDefinition(),
        options,
      }),
      GuildApplicationCommandDefinitionError,
    )
  }
})

test("channel and attachment filters require canonical known values", () => {
  const invalidOptions = [
    [{
      channelTypes: ["guild-forum", "guild-text"],
      description: "Channel",
      name: "channel",
      type: "channel",
    }],
    [{
      channelTypes: ["dm"],
      description: "Channel",
      name: "channel",
      type: "channel",
    }],
    [{
      description: "File",
      fileTypes: [".PDF"],
      name: "file",
      type: "attachment",
    }],
    [{
      description: "File",
      fileTypes: [".pdf", "image"],
      name: "file",
      type: "attachment",
    }],
  ]
  for (const options of invalidOptions) {
    assert.throws(
      () => normalizeGuildApplicationCommandDefinition({
        ...completeDefinition(),
        options,
      }),
      GuildApplicationCommandDefinitionError,
    )
  }
})

test("aggregate command size uses the longest localization and rejects overflow", () => {
  const choiceName = "x".repeat(100)
  const choices = Array.from({ length: 25 }, (_, index) => ({
    name: `${String(index).padStart(2, "0")}${choiceName.slice(2)}`,
    value: `${String(index).padStart(2, "0")}${choiceName.slice(2)}`,
  }))
  const options = Array.from({ length: 25 }, (_, index) => ({
    choices,
    description: "d".repeat(100),
    name: `value${index}`,
    type: "string",
  }))
  assert.throws(
    () => normalizeGuildApplicationCommandDefinition({
      ...completeDefinition(),
      options,
    }),
    /aggregate characters/,
  )

  const localized = normalizeGuildApplicationCommandDefinition({
    ...completeDefinition(),
    description: "short",
    descriptionLocalizations: [{ locale: "de", value: "x".repeat(100) }],
    options: [],
  })
  assert.equal(
    guildApplicationCommandCharacterCount(localized),
    Math.max("review".length, "pruefen".length) + 100,
  )
})

test("raw Discord evidence rejects future fields, identity drift, and unknown bits", () => {
  assert.throws(
    () => projectGuildApplicationCommand({
      ...rawCommand(),
      future_field: true,
    } as DiscordApplicationCommand, APPLICATION_ID, GUILD_ID),
    /unknown fields future_field/,
  )
  assert.throws(
    () => projectGuildApplicationCommand(rawCommand(), "999", GUILD_ID),
    /does not match/,
  )
  assert.throws(
    () => projectGuildApplicationCommand({
      ...rawCommand(),
      default_member_permissions: (1n << 63n).toString(),
    }, APPLICATION_ID, GUILD_ID),
    /unknown Discord permission bits/,
  )
  assert.throws(
    () => projectGuildApplicationCommand({
      ...rawCommand(),
      type: 4,
    }, APPLICATION_ID, GUILD_ID),
    /not a supported guild command type/,
  )
})
