import assert from "node:assert/strict"
import test from "node:test"

import type { ApplicationSkuRecord } from "../src/application-sku-audit-service.js"
import {
  ApplicationMonetizationAuditService,
  type ApplicationMonetizationAuditServiceClient,
} from "../src/application-monetization-audit-service.js"
import type {
  ApplicationEntitlementBeneficiary,
  ApplicationEntitlementPageOptions,
  ApplicationSubscriptionPageOptions,
} from "../src/discord-client.js"
import { ApplicationMonetizationEvidenceError } from "../src/errors.js"
import type {
  DiscordApplication,
  DiscordApplicationEntitlement,
  DiscordSkuSubscription,
  RequestOptions,
} from "../src/types.js"

const APPLICATION_ID = "500000000000000001"
const BOT_ID = "600000000000000001"
const USER_ID = "700000000000000001"
const GUILD_ID = "800000000000000001"
const SKU_ID = "900000000000000001"
const OTHER_SKU_ID = "900000000000000002"
const ENTITLEMENT_ID = "910000000000000001"
const SUBSCRIPTION_ID = "920000000000000001"

function application(): DiscordApplication {
  return {
    description: "Connector",
    id: APPLICATION_ID,
    name: "Connector",
  }
}

function sku(
  id = SKU_ID,
  type: ApplicationSkuRecord["type"]["name"] = "subscription",
): ApplicationSkuRecord {
  return {
    flags: {
      available: true,
      guildSubscription: false,
      purchaseScope: "user",
      unknownBitCount: 0,
      userSubscription: true,
    },
    id,
    name: "Supporter",
    nameCharacters: 9,
    slug: "supporter",
    slugCharacters: 9,
    type: {
      code: type === "subscription" ? 5 : 2,
      name: type,
    },
    unknownFieldCount: 0,
  }
}

function entitlement(
  overrides: Partial<DiscordApplicationEntitlement> & Record<string, unknown> = {},
): DiscordApplicationEntitlement {
  return {
    application_id: APPLICATION_ID,
    consumed: false,
    deleted: false,
    ends_at: "2026-09-01T00:00:00+00:00",
    id: ENTITLEMENT_ID,
    sku_id: SKU_ID,
    starts_at: "2026-08-01T00:00:00+00:00",
    type: 1,
    user_id: USER_ID,
    ...overrides,
  }
}

function subscription(
  overrides: Partial<DiscordSkuSubscription> & Record<string, unknown> = {},
): DiscordSkuSubscription {
  return {
    canceled_at: null,
    current_period_end: "2026-09-01T00:00:00+00:00",
    current_period_start: "2026-08-01T00:00:00+00:00",
    entitlement_ids: [ENTITLEMENT_ID],
    id: SUBSCRIPTION_ID,
    renewal_sku_ids: [SKU_ID],
    sku_ids: [SKU_ID],
    status: 0,
    user_id: USER_ID,
    ...overrides,
  }
}

class FixtureClient implements ApplicationMonetizationAuditServiceClient {
  entitlementGetCalls: Array<{
    applicationId: string
    entitlementId: string
    options: RequestOptions
  }> = []
  entitlementGetResponse: unknown = entitlement()
  entitlementCalls: Array<{
    applicationId: string
    beneficiary: ApplicationEntitlementBeneficiary
    options: ApplicationEntitlementPageOptions
    skuIds: readonly string[]
  }> = []
  entitlementResponse: unknown = []
  subscriptionCalls: Array<{
    options: ApplicationSubscriptionPageOptions
    skuId: string
    userId: string
  }> = []
  subscriptionResponse: unknown = []

  async getApplicationEntitlement(
    applicationId: string,
    entitlementId: string,
    options: RequestOptions = {},
  ): Promise<DiscordApplicationEntitlement> {
    this.entitlementGetCalls.push({ applicationId, entitlementId, options })
    return this.entitlementGetResponse as DiscordApplicationEntitlement
  }

  async listApplicationEntitlements(
    applicationId: string,
    beneficiary: ApplicationEntitlementBeneficiary,
    skuIds: readonly string[],
    options: ApplicationEntitlementPageOptions = {},
  ): Promise<DiscordApplicationEntitlement[]> {
    this.entitlementCalls.push({ applicationId, beneficiary, options, skuIds })
    return this.entitlementResponse as DiscordApplicationEntitlement[]
  }

  async listApplicationSubscriptions(
    skuId: string,
    userId: string,
    options: ApplicationSubscriptionPageOptions = {},
  ): Promise<DiscordSkuSubscription[]> {
    this.subscriptionCalls.push({ options, skuId, userId })
    return this.subscriptionResponse as DiscordSkuSubscription[]
  }
}

function fixture() {
  const client = new FixtureClient()
  return {
    client,
    service: new ApplicationMonetizationAuditService({ client }),
  }
}

test("application entitlement audit projects exact present-access evidence", async () => {
  const privateFutureValue = "private-future-entitlement-value"
  const { client, service } = fixture()
  client.entitlementResponse = [
    entitlement({
      future_private_field: privateFutureValue,
      type: 99,
    }),
  ]
  const signal = new AbortController().signal

  const result = await service.auditEntitlements(
    application(),
    BOT_ID,
    { type: "user", userId: USER_ID },
    [SKU_ID],
    [sku()],
    { after: "900000000000000000", limit: 2, signal },
  )

  assert.deepEqual(result.application, { botId: BOT_ID, id: APPLICATION_ID })
  assert.deepEqual(result.beneficiary, { id: USER_ID, type: "user" })
  assert.deepEqual(result.records, [{
    consumed: false,
    endsAt: "2026-09-01T00:00:00.000Z",
    id: ENTITLEMENT_ID,
    skuId: SKU_ID,
    startsAt: "2026-08-01T00:00:00.000Z",
    type: "unknown",
    unknownFieldCount: 1,
  }])
  assert.deepEqual(result.evidence, { unknownFields: 1, unknownTypes: 1 })
  assert.equal(result.inventory.projectionComplete, false)
  assert.deepEqual(result.page, {
    boundaryIds: { first: ENTITLEMENT_ID, last: ENTITLEMENT_ID },
    cursor: { after: "900000000000000000", before: null },
    possibleMore: false,
    requestedLimit: 2,
    returned: 1,
  })
  assert.deepEqual(client.entitlementCalls, [{
    applicationId: APPLICATION_ID,
    beneficiary: { type: "user", userId: USER_ID },
    options: { after: "900000000000000000", limit: 2, signal },
    skuIds: [SKU_ID],
  }])
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, new RegExp(privateFutureValue, "u"))
  assert.doesNotMatch(serialized, /99/u)
})

test("user entitlement audit rejects a guild-beneficiary purchase by that user", async () => {
  const { client, service } = fixture()
  client.entitlementResponse = [entitlement({ guild_id: GUILD_ID })]

  await assert.rejects(
    service.auditEntitlements(
      application(),
      BOT_ID,
      { type: "user", userId: USER_ID },
      [SKU_ID],
      [sku()],
    ),
    ApplicationMonetizationEvidenceError,
  )
})

test("guild entitlement audit omits purchaser user identity", async () => {
  const purchaserId = "700000000000000099"
  const { client, service } = fixture()
  client.entitlementResponse = [entitlement({
    guild_id: GUILD_ID,
    user_id: purchaserId,
  })]

  const result = await service.auditEntitlements(
    application(),
    BOT_ID,
    { type: "guild", guildId: GUILD_ID },
    [SKU_ID],
    [sku()],
  )

  assert.deepEqual(result.beneficiary, { id: GUILD_ID, type: "guild" })
  assert.doesNotMatch(JSON.stringify(result), new RegExp(purchaserId, "u"))
  assert.ok(result.privacy.omitted.includes("guild-entitlement-purchaser-user-ids"))
})

test("application entitlement audit rejects inconsistent or malformed evidence", async () => {
  const cases: unknown[] = [
    entitlement({ application_id: "500000000000000002" }),
    entitlement({ sku_id: OTHER_SKU_ID }),
    entitlement({ user_id: "700000000000000002" }),
    entitlement({ deleted: true }),
    entitlement({ consumed: "false" as never }),
    entitlement({ starts_at: "2026-02-31T00:00:00Z" }),
    entitlement({
      ends_at: "2026-08-01T00:00:00Z",
      starts_at: "2026-09-01T00:00:00Z",
    }),
    entitlement({ id: "invalid" }),
    null,
  ]
  for (const value of cases) {
    const { client, service } = fixture()
    client.entitlementResponse = [value]
    await assert.rejects(
      service.auditEntitlements(
        application(),
        BOT_ID,
        { type: "user", userId: USER_ID },
        [SKU_ID],
        [sku(), sku(OTHER_SKU_ID)],
      ),
      ApplicationMonetizationEvidenceError,
    )
  }

  const duplicate = fixture()
  duplicate.client.entitlementResponse = [entitlement(), entitlement()]
  await assert.rejects(
    duplicate.service.auditEntitlements(
      application(),
      BOT_ID,
      { type: "user", userId: USER_ID },
      [SKU_ID],
      [sku()],
    ),
    ApplicationMonetizationEvidenceError,
  )

  await assert.rejects(
    fixture().service.auditEntitlements(
      application(),
      BOT_ID,
      { type: "user", userId: USER_ID },
      [OTHER_SKU_ID],
      [sku()],
    ),
    /not owned by the pinned application/u,
  )
})

test("exact application entitlement inspection projects deleted and future evidence safely", async () => {
  const privateFutureValue = "private-exact-entitlement-value"
  const { client, service } = fixture()
  client.entitlementGetResponse = entitlement({
    deleted: true,
    future_private_field: privateFutureValue,
    type: 99,
  })
  const selectedSku = sku()
  selectedSku.flags.unknownBitCount = 1
  selectedSku.unknownFieldCount = 1
  const signal = new AbortController().signal

  const result = await service.inspectEntitlement(
    application(),
    BOT_ID,
    { type: "user", userId: USER_ID },
    ENTITLEMENT_ID,
    SKU_ID,
    [selectedSku],
    { signal },
  )

  assert.deepEqual(result.application, { botId: BOT_ID, id: APPLICATION_ID })
  assert.deepEqual(result.beneficiary, { id: USER_ID, type: "user" })
  assert.deepEqual(result.entitlement, {
    consumed: false,
    deleted: true,
    endsAt: "2026-09-01T00:00:00.000Z",
    id: ENTITLEMENT_ID,
    skuId: SKU_ID,
    startsAt: "2026-08-01T00:00:00.000Z",
    type: "unknown",
    unknownFieldCount: 1,
  })
  assert.deepEqual(result.sku, {
    available: true,
    id: SKU_ID,
    purchaseScope: "user",
    type: "subscription",
  })
  assert.deepEqual(result.evidence, {
    projectionComplete: false,
    unknownFields: 1,
    unknownSkuFields: 1,
    unknownSkuFlagBits: 1,
    unknownSkuType: false,
    unknownType: true,
  })
  assert.deepEqual(client.entitlementGetCalls, [{
    applicationId: APPLICATION_ID,
    entitlementId: ENTITLEMENT_ID,
    options: { signal },
  }])
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateFutureValue, "u"))
  assert.doesNotMatch(JSON.stringify(result), /99/u)
})

test("exact application entitlement inspection rejects mismatched identity and scope evidence", async () => {
  const cases: unknown[] = [
    entitlement({ id: "910000000000000002" }),
    entitlement({ application_id: "500000000000000002" }),
    entitlement({ sku_id: OTHER_SKU_ID }),
    entitlement({ user_id: "700000000000000002" }),
    entitlement({ deleted: "false" as never }),
    null,
  ]
  for (const value of cases) {
    const { client, service } = fixture()
    client.entitlementGetResponse = value
    await assert.rejects(
      service.inspectEntitlement(
        application(),
        BOT_ID,
        { type: "user", userId: USER_ID },
        ENTITLEMENT_ID,
        SKU_ID,
        [sku()],
      ),
      ApplicationMonetizationEvidenceError,
    )
  }

  const { service } = fixture()
  await assert.rejects(
    service.inspectEntitlement(
      application(),
      BOT_ID,
      { type: "user", userId: USER_ID },
      ENTITLEMENT_ID,
      OTHER_SKU_ID,
      [sku()],
    ),
    /not owned by the pinned application/u,
  )
})

test("application subscription audit minimizes exact-user lifecycle evidence", async () => {
  const privateFutureValue = "private-future-subscription-value"
  const unconfiguredSkuId = OTHER_SKU_ID
  const { client, service } = fixture()
  client.subscriptionResponse = [subscription({
    canceled_at: "2026-08-20T12:30:00-05:00",
    country: "US",
    future_private_field: privateFutureValue,
    renewal_sku_ids: [unconfiguredSkuId],
    sku_ids: [SKU_ID, unconfiguredSkuId],
    status: 2,
  })]

  const result = await service.auditSubscriptions(
    application(),
    BOT_ID,
    USER_ID,
    SKU_ID,
    [SKU_ID],
    [sku(), sku(unconfiguredSkuId)],
    { before: "930000000000000001", limit: 3 },
  )

  assert.deepEqual(result.records, [{
    canceledAt: "2026-08-20T17:30:00.000Z",
    currentPeriod: {
      end: "2026-09-01T00:00:00.000Z",
      start: "2026-08-01T00:00:00.000Z",
    },
    entitlementCount: 1,
    id: SUBSCRIPTION_ID,
    relatedSkus: {
      configuredIds: [SKU_ID],
      omittedUnconfigured: 1,
    },
    renewalSkus: {
      configuredIds: [],
      omittedUnconfigured: 1,
    },
    status: "ending",
    unknownFieldCount: 1,
  }])
  assert.deepEqual(result.inventory, {
    accessAuthority: "entitlements-only",
    completeness: "bounded-user-and-sku-page",
    projectionComplete: false,
    skuId: SKU_ID,
    userId: USER_ID,
  })
  assert.deepEqual(result.evidence, { unknownFields: 1, unknownStatuses: 0 })
  assert.deepEqual(client.subscriptionCalls, [{
    options: { before: "930000000000000001", limit: 3 },
    skuId: SKU_ID,
    userId: USER_ID,
  }])
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /US/u)
  assert.doesNotMatch(serialized, new RegExp(ENTITLEMENT_ID, "u"))
  assert.doesNotMatch(serialized, new RegExp(unconfiguredSkuId, "u"))
  assert.doesNotMatch(serialized, new RegExp(privateFutureValue, "u"))
})

test("application subscription audit counts future status without returning its value", async () => {
  const { client, service } = fixture()
  client.subscriptionResponse = [subscription({ status: 99 })]

  const result = await service.auditSubscriptions(
    application(),
    BOT_ID,
    USER_ID,
    SKU_ID,
    [SKU_ID],
    [sku()],
  )

  assert.equal(result.records[0]?.status, "unknown")
  assert.equal(result.evidence.unknownStatuses, 1)
  assert.doesNotMatch(JSON.stringify(result), /99/u)
})

test("application subscription audit rejects unsafe scope and evidence", async () => {
  await assert.rejects(
    fixture().service.auditSubscriptions(
      application(),
      BOT_ID,
      USER_ID,
      SKU_ID,
      [SKU_ID],
      [sku(SKU_ID, "durable")],
    ),
    /requires a current application subscription SKU/u,
  )
  await assert.rejects(
    fixture().service.auditSubscriptions(
      application(),
      BOT_ID,
      USER_ID,
      SKU_ID,
      [OTHER_SKU_ID],
      [sku(), sku(OTHER_SKU_ID)],
    ),
    /outside the configured scope/u,
  )

  const cases: unknown[] = [
    subscription({ user_id: "700000000000000002" }),
    subscription({ sku_ids: [OTHER_SKU_ID] }),
    subscription({ sku_ids: [SKU_ID, "900000000000000099"] }),
    subscription({ current_period_start: "2026-02-31T00:00:00Z" }),
    subscription({
      current_period_end: "2026-08-01T00:00:00Z",
      current_period_start: "2026-09-01T00:00:00Z",
    }),
    subscription({ entitlement_ids: ["invalid"] }),
    subscription({ renewal_sku_ids: ["invalid"] }),
    subscription({ country: "USA" }),
    subscription({ status: -1 }),
    null,
  ]
  for (const value of cases) {
    const { client, service } = fixture()
    client.subscriptionResponse = [value]
    await assert.rejects(
      service.auditSubscriptions(
        application(),
        BOT_ID,
        USER_ID,
        SKU_ID,
        [SKU_ID, OTHER_SKU_ID],
        [sku(), sku(OTHER_SKU_ID)],
      ),
      ApplicationMonetizationEvidenceError,
    )
  }

  const duplicate = fixture()
  duplicate.client.subscriptionResponse = [subscription(), subscription()]
  await assert.rejects(
    duplicate.service.auditSubscriptions(
      application(),
      BOT_ID,
      USER_ID,
      SKU_ID,
      [SKU_ID],
      [sku()],
    ),
    ApplicationMonetizationEvidenceError,
  )
})
