import type { ApplicationSkuAuditResult } from "../src/application-sku-audit-service.js"

export function fixtureApplicationSkuAudit(options: {
  applicationId: string
  botId: string
}): ApplicationSkuAuditResult {
  return {
    application: {
      botId: options.botId,
      id: options.applicationId,
    },
    catalog: {
      availability: {
        available: 1,
        unavailable: 0,
      },
      purchaseScopes: {
        conflicting: 0,
        guild: 1,
        unspecified: 0,
        user: 0,
      },
      types: {
        consumable: 0,
        durable: 0,
        subscription: 1,
        subscriptionGroups: 0,
        unknown: 0,
      },
    },
    evidence: {
      unknownFields: 0,
      unknownFlagBits: 0,
      unknownTypes: 0,
    },
    findingCounts: {
      info: 1,
      warnings: 0,
    },
    findings: [{
      code: "available-offerings",
      severity: "info",
      summary: "The application reports one or more available SKUs",
    }],
    inventory: {
      completeness: "complete-current-application",
      count: 1,
      documentedOwnerCreatedLimit: 50,
      localRecordLimit: 100,
      projectionComplete: true,
    },
    privacy: {
      omitted: [
        "beneficiary-guild-identifiers",
        "benefits",
        "entitlement-data",
        "media",
        "payment-data",
        "prices",
        "purchaser-identifiers",
        "raw-discord-payloads",
        "store-urls",
        "subscription-data",
        "unknown-field-values",
      ],
      persistence: "none",
      rawPayloads: "omitted",
      text: "transient-untrusted",
      unknownFields: "counts-only",
    },
    records: [{
      flags: {
        available: true,
        guildSubscription: true,
        purchaseScope: "guild",
        unknownBitCount: 0,
        userSubscription: false,
      },
      id: "700000000000000001",
      name: "Server supporter",
      nameCharacters: 16,
      slug: "server-supporter",
      slugCharacters: 16,
      type: {
        code: 5,
        name: "subscription",
      },
      unknownFieldCount: 0,
    }],
    schemaVersion: 1,
    status: "ok",
    warnings: [
      "SKU availability does not prove entitlement, revenue, payment, or access state",
    ],
  }
}
