import assert from "node:assert/strict"
import test from "node:test"

import {
  ApplicationSkuAuditService,
  type ApplicationSkuAuditServiceClient,
} from "../src/application-sku-audit-service.js"
import { ApplicationSkuEvidenceError } from "../src/errors.js"
import type {
  DiscordApplication,
  DiscordApplicationSku,
  RequestOptions,
} from "../src/types.js"

const APPLICATION_ID = "500000000000000001"
const BOT_ID = "600000000000000001"

function application(id = APPLICATION_ID): DiscordApplication {
  return {
    description: "Connector",
    id,
    name: "Connector",
  }
}

function sku(
  overrides: Partial<DiscordApplicationSku> = {},
): DiscordApplicationSku {
  return {
    application_id: APPLICATION_ID,
    flags: 4,
    id: "700000000000000001",
    name: "Supporter",
    slug: "supporter",
    type: 2,
    ...overrides,
  }
}

class FixtureClient implements ApplicationSkuAuditServiceClient {
  applicationIds: string[] = []
  options: RequestOptions[] = []
  response: unknown = []

  async listApplicationSkus(
    applicationId: string,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationSku[]> {
    this.applicationIds.push(applicationId)
    this.options.push(options)
    return this.response as DiscordApplicationSku[]
  }
}

function fixture(response: unknown = []) {
  const client = new FixtureClient()
  client.response = response
  return {
    client,
    service: new ApplicationSkuAuditService({ client }),
  }
}

test("application SKU audit maps documented types and flags deterministically", async () => {
  const { client, service } = fixture([
    sku({
      flags: 256,
      id: "700000000000000004",
      name: "Monthly",
      slug: "monthly",
      type: 5,
    }),
    sku(),
    sku({
      flags: 132,
      id: "700000000000000003",
      name: "Guild pass",
      slug: "guild-pass",
      type: 6,
    }),
    sku({
      flags: 4,
      id: "700000000000000002",
      name: "Credit",
      slug: "credit",
      type: 3,
    }),
  ])
  const signal = new AbortController().signal

  const result = await service.audit(application(), BOT_ID, { signal })

  assert.deepEqual(result.records.map((record) => record.id), [
    "700000000000000001",
    "700000000000000002",
    "700000000000000003",
    "700000000000000004",
  ])
  assert.deepEqual(result.records.map((record) => record.type.name), [
    "durable",
    "consumable",
    "subscription-group",
    "subscription",
  ])
  assert.deepEqual(result.records.map((record) => record.flags.purchaseScope), [
    "unspecified",
    "unspecified",
    "guild",
    "user",
  ])
  assert.equal(result.records[2]?.flags.available, true)
  assert.deepEqual(result.catalog, {
    availability: { available: 3, unavailable: 1 },
    purchaseScopes: { conflicting: 0, guild: 1, unspecified: 2, user: 1 },
    types: {
      consumable: 1,
      durable: 1,
      subscription: 1,
      subscriptionGroups: 1,
      unknown: 0,
    },
  })
  assert.deepEqual(result.evidence, {
    unknownFields: 0,
    unknownFlagBits: 0,
    unknownTypes: 0,
  })
  assert.equal(result.inventory.completeness, "complete-current-application")
  assert.equal(result.inventory.documentedOwnerCreatedLimit, 50)
  assert.equal(result.inventory.localRecordLimit, 100)
  assert.equal(result.inventory.projectionComplete, true)
  assert.deepEqual(result.findings.map((finding) => finding.code), [
    "available-offerings",
    "unavailable-records",
  ])
  assert.deepEqual(client.applicationIds, [APPLICATION_ID])
  assert.equal(client.options[0]?.signal, signal)
})

test("application SKU audit bounds transient Unicode labels", async () => {
  const { service } = fixture([sku({
    name: "Level 🛡",
    slug: "level-🛡",
  })])

  const result = await service.audit(application(), BOT_ID)

  assert.equal(result.records[0]?.name, "Level 🛡")
  assert.equal(result.records[0]?.nameCharacters, 7)
  assert.equal(result.records[0]?.slugCharacters, 7)
  assert.equal(result.privacy.text, "transient-untrusted")
  assert.equal(result.privacy.persistence, "none")
  assert.equal(result.privacy.unknownFields, "counts-only")
})

test("application SKU audit returns an honest empty catalog finding", async () => {
  const { service } = fixture([])

  const result = await service.audit(application(), BOT_ID)

  assert.equal(result.inventory.count, 0)
  assert.equal(result.findings[0]?.code, "empty-catalog")
  assert.equal(result.findingCounts.info, 1)
  assert.equal(result.findingCounts.warnings, 0)
})

test("application SKU audit counts conflicting and future evidence without values", async () => {
  const privateFutureValue = "private-future-sku-value"
  const { service } = fixture([{
    ...sku({ flags: 128 | 256 | 512, type: 7 }),
    future_private_field: privateFutureValue,
  }])

  const result = await service.audit(application(), BOT_ID)

  assert.deepEqual(result.records[0]?.type, {
    code: 7,
    name: "unknown",
  })
  assert.deepEqual(result.records[0]?.flags, {
    available: false,
    guildSubscription: true,
    purchaseScope: "conflicting",
    unknownBitCount: 1,
    userSubscription: true,
  })
  assert.equal(result.records[0]?.unknownFieldCount, 1)
  assert.deepEqual(result.evidence, {
    unknownFields: 1,
    unknownFlagBits: 1,
    unknownTypes: 1,
  })
  assert.equal(result.inventory.projectionComplete, false)
  assert.deepEqual(result.findings.map((finding) => finding.code), [
    "unavailable-records",
    "conflicting-purchase-scope",
    "future-schema-evidence",
  ])
  assert.equal(result.findingCounts.warnings, 3)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateFutureValue, "u"))
  assert.doesNotMatch(JSON.stringify(result), /512/u)
})

test("application SKU audit reports independently future flag and type evidence", async () => {
  const flagResult = await fixture([
    sku({ flags: 4 | 512 }),
  ]).service.audit(application(), BOT_ID)
  const typeResult = await fixture([
    sku({ type: 7 }),
  ]).service.audit(application(), BOT_ID)

  assert.deepEqual(flagResult.evidence, {
    unknownFields: 0,
    unknownFlagBits: 1,
    unknownTypes: 0,
  })
  assert.equal(flagResult.inventory.projectionComplete, false)
  assert.equal(flagResult.findings.at(-1)?.code, "future-schema-evidence")
  assert.deepEqual(typeResult.evidence, {
    unknownFields: 0,
    unknownFlagBits: 0,
    unknownTypes: 1,
  })
  assert.equal(typeResult.inventory.projectionComplete, false)
  assert.equal(typeResult.findings.at(-1)?.code, "future-schema-evidence")
})

test("application SKU audit rejects malformed whole-inventory evidence", async () => {
  const tooManyFields = Object.fromEntries(
    Array.from({ length: 33 }, (_, index) => [`field_${index}`, index]),
  )
  const cases: unknown[] = [
    null,
    {},
    Array.from({ length: 101 }, (_, index) => sku({ id: String(index + 1) })),
    [null],
    [true],
    [[]],
    [tooManyFields],
    [sku({ id: "0" })],
    [sku({ id: "invalid" })],
    [sku({ id: 1 as never })],
    [sku({ id: "18446744073709551616" })],
    [sku({ application_id: "0" })],
    [sku({ application_id: "500000000000000002" })],
    [sku({ name: "" })],
    [sku({ name: "line\nbreak" })],
    [sku({ name: "\uD800" })],
    [sku({ name: "x".repeat(81) })],
    [sku({ slug: "" })],
    [sku({ slug: "x".repeat(257) })],
    [sku({ type: 0 })],
    [sku({ type: 1.5 })],
    [sku({ type: "2" as never })],
    [sku({ type: Number.MAX_SAFE_INTEGER + 1 })],
    [sku({ flags: -1 })],
    [sku({ flags: 1.5 })],
    [sku({ flags: "4" as never })],
    [sku({ flags: Number.MAX_SAFE_INTEGER + 1 })],
    [sku(), sku()],
  ]
  for (const response of cases) {
    const { service } = fixture(response)
    await assert.rejects(
      service.audit(application(), BOT_ID),
      ApplicationSkuEvidenceError,
    )
  }
})

test("application SKU audit rejects invalid verified identity before reading", async () => {
  const { client, service } = fixture([])
  for (const [currentApplication, botId] of [
    [application("0"), BOT_ID],
    [application(), "0"],
  ] as const) {
    await assert.rejects(
      service.audit(currentApplication, botId),
      ApplicationSkuEvidenceError,
    )
  }
  assert.equal(client.applicationIds.length, 0)
})
