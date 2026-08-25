import assert from "node:assert/strict"
import test from "node:test"

import {
  ApplicationRoleConnectionMetadataAuditService,
  type ApplicationRoleConnectionMetadataAuditServiceClient,
} from "../src/application-role-connection-metadata-audit-service.js"
import { ApplicationRoleConnectionMetadataEvidenceError } from "../src/errors.js"
import type {
  DiscordApplication,
  DiscordApplicationRoleConnectionMetadata,
  RequestOptions,
} from "../src/types.js"

const APPLICATION_ID = "500000000000000001"
const BOT_ID = "600000000000000001"
const PRIVATE_ENDPOINT = "https://private.example.test/linked-role"

function application(
  endpoint: string | null | undefined = PRIVATE_ENDPOINT,
): DiscordApplication {
  return {
    description: "Connector",
    id: APPLICATION_ID,
    name: "Connector",
    ...(endpoint === undefined
      ? {}
      : { role_connections_verification_url: endpoint }),
  }
}

function metadata(
  overrides: Partial<DiscordApplicationRoleConnectionMetadata> = {},
): DiscordApplicationRoleConnectionMetadata {
  return {
    description: "Minimum review level",
    key: "review_level",
    name: "Review level",
    type: 2,
    ...overrides,
  }
}

class FixtureClient implements ApplicationRoleConnectionMetadataAuditServiceClient {
  applicationIds: string[] = []
  options: RequestOptions[] = []
  response: unknown = []

  async listApplicationRoleConnectionMetadata(
    applicationId: string,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationRoleConnectionMetadata[]> {
    this.applicationIds.push(applicationId)
    this.options.push(options)
    return this.response as DiscordApplicationRoleConnectionMetadata[]
  }
}

function fixture(response: unknown = []) {
  const client = new FixtureClient()
  client.response = response
  return {
    client,
    service: new ApplicationRoleConnectionMetadataAuditService({ client }),
  }
}

test("linked-role metadata audit maps every documented comparison type", async () => {
  const expected = [
    [1, "integer-less-than-or-equal", "integer", "less-than-or-equal"],
    [2, "integer-greater-than-or-equal", "integer", "greater-than-or-equal"],
    [3, "integer-equal", "integer", "equal"],
    [4, "integer-not-equal", "integer", "not-equal"],
    [5, "datetime-less-than-or-equal", "datetime", "less-than-or-equal"],
    [6, "datetime-greater-than-or-equal", "datetime", "greater-than-or-equal"],
    [7, "boolean-equal", "boolean", "equal"],
    [8, "boolean-not-equal", "boolean", "not-equal"],
  ] as const
  for (const [code, name, valueKind, comparison] of expected) {
    const { client, service } = fixture([metadata({ type: code })])
    const signal = new AbortController().signal
    const result = await service.audit(application(), BOT_ID, { signal })
    assert.deepEqual(result.records[0]?.type, {
      code,
      comparison,
      name,
      valueKind,
    })
    assert.deepEqual(client.applicationIds, [APPLICATION_ID])
    assert.equal(client.options[0]?.signal, signal)
    assert.equal(result.inventory.completeness, "complete-current-application")
    assert.equal(result.inventory.documentedLimit, 5)
    assert.equal(result.inventory.projectionComplete, true)
    assert.equal(result.application.verificationEndpointConfigured, true)
    assert.equal(result.findings[0]?.code, "active-schema")
    assert.equal(result.findingCounts.info, 1)
    assert.equal(result.findingCounts.warnings, 0)
    assert.doesNotMatch(JSON.stringify(result), /private\.example/u)
  }
})

test("linked-role metadata audit returns bounded labels and count-only localization evidence", async () => {
  const privateNameLocalization = "Private localized name"
  const privateDescriptionLocalization = "Private localized description"
  const { service } = fixture([metadata({
    description: "Review level 🛡",
    description_localizations: {
      "en-US": privateDescriptionLocalization,
      "pt-BR": "Nivel de revisao",
    },
    name: "Level 🛡",
    name_localizations: {
      "en-US": privateNameLocalization,
    },
  })])

  const result = await service.audit(application(), BOT_ID)

  assert.equal(result.records[0]?.name, "Level 🛡")
  assert.equal(result.records[0]?.nameCharacters, 7)
  assert.equal(result.records[0]?.descriptionCharacters, 14)
  assert.deepEqual(result.records[0]?.localizations, {
    descriptions: 2,
    names: 1,
  })
  assert.equal(result.privacy.text, "transient-untrusted")
  assert.equal(result.privacy.unknownFields, "counts-only")
  assert.doesNotMatch(
    JSON.stringify(result),
    new RegExp(`${privateNameLocalization}|${privateDescriptionLocalization}`, "u"),
  )
})

test("linked-role metadata audit reports each endpoint and schema posture honestly", async () => {
  const cases = [
    {
      endpoint: PRIVATE_ENDPOINT,
      records: [],
      code: "verification-endpoint-without-schema",
      severity: "warning",
    },
    {
      endpoint: null,
      records: [metadata()],
      code: "schema-without-verification-endpoint",
      severity: "warning",
    },
    {
      endpoint: null,
      records: [],
      code: "empty-schema",
      severity: "info",
    },
  ] as const
  for (const entry of cases) {
    const { service } = fixture(entry.records)
    const result = await service.audit(application(entry.endpoint), BOT_ID)
    assert.equal(result.findings[0]?.code, entry.code)
    assert.equal(result.findings[0]?.severity, entry.severity)
    assert.equal(
      result.findingCounts.warnings,
      entry.severity === "warning" ? 1 : 0,
    )
  }
})

test("linked-role metadata audit counts future evidence without exposing values", async () => {
  const privateFutureValue = "private-future-metadata-value"
  const { service } = fixture([{
    ...metadata({ type: 9 }),
    future_private_field: privateFutureValue,
  }])

  const result = await service.audit(application(), BOT_ID)

  assert.deepEqual(result.records[0]?.type, {
    code: 9,
    comparison: "unknown",
    name: "unknown",
    valueKind: "unknown",
  })
  assert.equal(result.records[0]?.unknownFieldCount, 1)
  assert.deepEqual(result.evidence, {
    unknownFields: 1,
    unknownTypes: 1,
  })
  assert.equal(result.inventory.projectionComplete, false)
  assert.equal(result.findings.at(-1)?.code, "future-schema-evidence")
  assert.equal(result.findingCounts.warnings, 1)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateFutureValue, "u"))
})

test("linked-role metadata audit rejects malformed whole-inventory evidence", async () => {
  const tooManyFields = Object.fromEntries(
    Array.from({ length: 33 }, (_, index) => [`field_${index}`, index]),
  )
  const tooManyLocalizations = Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`x-${index}`, "label"]),
  )
  const cases: unknown[] = [
    null,
    {},
    Array.from({ length: 6 }, (_, index) => metadata({ key: `key_${index}` })),
    [null],
    [tooManyFields],
    [metadata({ key: "" })],
    [metadata({ key: "UPPERCASE" })],
    [metadata({ key: "x".repeat(51) })],
    [metadata({ name: "" })],
    [metadata({ name: "line\nbreak" })],
    [metadata({ name: "\uD800" })],
    [metadata({ name: "x".repeat(101) })],
    [metadata({ description: "" })],
    [metadata({ description: "x".repeat(201) })],
    [metadata({ type: 0 })],
    [metadata({ type: 1.5 })],
    [metadata({ type: 256 })],
    [metadata({ name_localizations: [] as never })],
    [metadata({ name_localizations: { "bad locale": "label" } })],
    [metadata({ name_localizations: { "en-US": "" } })],
    [metadata({ name_localizations: tooManyLocalizations })],
    [metadata(), metadata()],
  ]
  for (const response of cases) {
    const { service } = fixture(response)
    await assert.rejects(
      service.audit(application(), BOT_ID),
      ApplicationRoleConnectionMetadataEvidenceError,
    )
  }
})

test("linked-role metadata audit rejects invalid identity and endpoint evidence without echo", async () => {
  const { client, service } = fixture([])
  for (const [currentApplication, botId] of [
    [{ ...application(), id: "0" }, BOT_ID],
    [application(), "0"],
  ] as const) {
    await assert.rejects(
      service.audit(currentApplication, botId),
      ApplicationRoleConnectionMetadataEvidenceError,
    )
  }
  assert.equal(client.applicationIds.length, 0)

  for (const endpoint of ["line\nbreak", "x".repeat(2_049)]) {
    const scoped = fixture([])
    await assert.rejects(
      scoped.service.audit(application(endpoint), BOT_ID),
      (error: unknown) => {
        assert.ok(error instanceof ApplicationRoleConnectionMetadataEvidenceError)
        assert.doesNotMatch(error.message, /line|break|xxxx/u)
        return true
      },
    )
    assert.equal(scoped.client.applicationIds.length, 0)
  }
})
