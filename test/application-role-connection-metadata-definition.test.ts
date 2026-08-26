import assert from "node:assert/strict"
import test from "node:test"

import {
  APPLICATION_ROLE_CONNECTION_METADATA_TYPES,
  ApplicationRoleConnectionMetadataDefinitionError,
  applicationRoleConnectionMetadataRecordDigest,
  applicationRoleConnectionMetadataSchemaBody,
  applicationRoleConnectionMetadataSchemaDigest,
  normalizeApplicationRoleConnectionMetadataSchema,
  projectApplicationRoleConnectionMetadataSchema,
  sameApplicationRoleConnectionMetadataSchema,
  type ApplicationRoleConnectionMetadataDefinition,
} from "../src/application-role-connection-metadata-definition.js"
import { DISCORD_APPLICATION_COMMAND_LOCALES } from "../src/guild-application-command-definition.js"
import { DISCORD_LOCALES } from "../src/constants.js"

function definition(
  overrides: Partial<ApplicationRoleConnectionMetadataDefinition> = {},
): ApplicationRoleConnectionMetadataDefinition {
  return {
    description: "Minimum completed reviews",
    descriptionLocalizations: [{ locale: "de", value: "Abgeschlossene Pruefungen" }],
    key: "review_count",
    name: "Review count",
    nameLocalizations: [{ locale: "de", value: "Pruefungsanzahl" }],
    type: "integer-greater-than-or-equal",
    ...overrides,
  }
}

test("linked-role definitions use the shared current Discord locale order", () => {
  assert.equal(DISCORD_APPLICATION_COMMAND_LOCALES, DISCORD_LOCALES)
  assert.ok(DISCORD_LOCALES.includes("es-419"))
  assert.ok(DISCORD_LOCALES.includes("zh-TW"))
})

test("linked-role definitions normalize, encode, and project every comparison type", () => {
  const schema = APPLICATION_ROLE_CONNECTION_METADATA_TYPES.map((type, index) => definition({
    descriptionLocalizations: [],
    key: `criterion_${index}`,
    nameLocalizations: [],
    type,
  }))

  for (const [index, type] of APPLICATION_ROLE_CONNECTION_METADATA_TYPES.entries()) {
    const normalized = normalizeApplicationRoleConnectionMetadataSchema([schema[index]])
    assert.equal(normalized[0]?.type, type)
    const body = applicationRoleConnectionMetadataSchemaBody(normalized)
    assert.equal(body[0]?.type, index + 1)
    assert.equal(Object.hasOwn(body[0] || {}, "name_localizations"), false)
    assert.equal(Object.hasOwn(body[0] || {}, "description_localizations"), false)
    assert.deepEqual(projectApplicationRoleConnectionMetadataSchema(body), normalized)
  }
})

test("linked-role schemas preserve complete canonical localization values", () => {
  const schema = normalizeApplicationRoleConnectionMetadataSchema([definition({
    descriptionLocalizations: [
      { locale: "de", value: "Mindestanzahl" },
      { locale: "fr", value: "Nombre minimum" },
    ],
    nameLocalizations: [
      { locale: "de", value: "Pruefungen" },
      { locale: "fr", value: "Evaluations" },
    ],
  })])
  const body = applicationRoleConnectionMetadataSchemaBody(schema)
  assert.deepEqual(body, [{
    description: "Minimum completed reviews",
    description_localizations: {
      de: "Mindestanzahl",
      fr: "Nombre minimum",
    },
    key: "review_count",
    name: "Review count",
    name_localizations: {
      de: "Pruefungen",
      fr: "Evaluations",
    },
    type: 2,
  }])
  assert.deepEqual(projectApplicationRoleConnectionMetadataSchema(body), schema)
})

test("linked-role projection accepts omitted optional localization dictionaries", () => {
  assert.deepEqual(projectApplicationRoleConnectionMetadataSchema([{
    description: "Account is verified",
    key: "verified",
    name: "Verified",
    type: 7,
  }]), [definition({
    description: "Account is verified",
    descriptionLocalizations: [],
    key: "verified",
    name: "Verified",
    nameLocalizations: [],
    type: "boolean-equal",
  })])
})

test("linked-role schema hashes bind record values and order", () => {
  const first = definition()
  const second = definition({ key: "verified", name: "Verified", type: "boolean-equal" })
  const digest = applicationRoleConnectionMetadataSchemaDigest([first, second])
  assert.match(digest, /^sha256:[a-f0-9]{64}$/u)
  assert.match(applicationRoleConnectionMetadataRecordDigest(first), /^sha256:[a-f0-9]{64}$/u)
  assert.equal(
    sameApplicationRoleConnectionMetadataSchema([first, second], [first, second]),
    true,
  )
  assert.equal(
    sameApplicationRoleConnectionMetadataSchema([first, second], [second, first]),
    false,
  )
  assert.notEqual(
    digest,
    applicationRoleConnectionMetadataSchemaDigest([second, first]),
  )
})

test("linked-role definition input rejects noncanonical or unsafe values", () => {
  const invalid: unknown[] = [
    null,
    "schema",
    Array.from({ length: 6 }, (_, index) => definition({ key: `key_${index}` })),
    [{ ...definition(), extra: true }],
    [definition({ key: "Uppercase" })],
    [definition({ key: " duplicate" })],
    [definition({ name: " padded" })],
    [definition({ description: "bad\u0000description" })],
    [definition({ type: "future-type" as never })],
    [
      definition(),
      definition({ name: "Duplicate", type: "integer-equal" }),
    ],
    [definition({
      nameLocalizations: [
        { locale: "fr", value: "Evaluations" },
        { locale: "de", value: "Pruefungen" },
      ],
    })],
    [definition({
      descriptionLocalizations: [
        { locale: "de", value: "Erste" },
        { locale: "de", value: "Zweite" },
      ],
    })],
    [definition({
      nameLocalizations: [{ locale: "future" as never, value: "Future" }],
    })],
  ]
  for (const value of invalid) {
    assert.throws(
      () => normalizeApplicationRoleConnectionMetadataSchema(value),
      ApplicationRoleConnectionMetadataDefinitionError,
    )
  }
})

test("linked-role projection rejects future or incomplete Discord evidence", () => {
  const raw = applicationRoleConnectionMetadataSchemaBody([definition()])[0]
  assert.ok(raw)
  const invalid: unknown[] = [
    {},
    [{ ...raw, extra: "future" }],
    [{ ...raw, type: 9 }],
    [{ ...raw, name_localizations: { xx: "Future" } }],
    [{ ...raw, description_localizations: [] }],
    [{ ...raw }, { ...raw, name: "Duplicate" }],
    [{ ...raw, key: "invalid-key" }],
    [{ ...raw, description: "" }],
  ]
  for (const value of invalid) {
    assert.throws(
      () => projectApplicationRoleConnectionMetadataSchema(value),
      ApplicationRoleConnectionMetadataDefinitionError,
    )
  }
})

test("linked-role definition character limits count Unicode code points", () => {
  const emoji = "\u{1F600}"
  assert.doesNotThrow(() => normalizeApplicationRoleConnectionMetadataSchema([definition({
    name: emoji.repeat(100),
  })]))
  assert.throws(
    () => normalizeApplicationRoleConnectionMetadataSchema([definition({
      name: emoji.repeat(101),
    })]),
    /1-100 safe unpadded characters/u,
  )
})
