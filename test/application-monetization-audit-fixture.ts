import type {
  ApplicationEntitlementAuditResult,
  ApplicationEntitlementInspectionResult,
  ApplicationSubscriptionAuditResult,
} from "../src/application-monetization-audit-service.js"
import { SCHEMA_VERSION } from "../src/constants.js"

const PRIVACY = Object.freeze({
  omitted: Object.freeze(["raw-discord-payloads"]),
  persistence: "none" as const,
  rawPayloads: "omitted" as const,
  unknownFields: "counts-only" as const,
})

export function fixtureApplicationEntitlementAudit(options: {
  applicationId: string
  beneficiaryId: string
  beneficiaryType: "guild" | "user"
  botId: string
  entitlementId: string
  skuId: string
}): ApplicationEntitlementAuditResult {
  return {
    application: { botId: options.botId, id: options.applicationId },
    beneficiary: { id: options.beneficiaryId, type: options.beneficiaryType },
    evidence: { unknownFields: 0, unknownTypes: 0 },
    inventory: {
      completeness: "bounded-present-access-page",
      projectionComplete: true,
      skuIds: [options.skuId],
    },
    page: {
      boundaryIds: { first: options.entitlementId, last: options.entitlementId },
      cursor: { after: null, before: null },
      possibleMore: false,
      requestedLimit: 25,
      returned: 1,
    },
    privacy: PRIVACY,
    records: [{
      consumed: false,
      endsAt: null,
      id: options.entitlementId,
      skuId: options.skuId,
      startsAt: null,
      type: "application-subscription",
      unknownFieldCount: 0,
    }],
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
    warnings: [],
  }
}

export function fixtureApplicationEntitlementInspection(options: {
  applicationId: string
  beneficiaryId: string
  beneficiaryType: "guild" | "user"
  botId: string
  entitlementId: string
  skuId: string
}): ApplicationEntitlementInspectionResult {
  return {
    application: { botId: options.botId, id: options.applicationId },
    beneficiary: { id: options.beneficiaryId, type: options.beneficiaryType },
    entitlement: {
      consumed: false,
      deleted: false,
      endsAt: null,
      id: options.entitlementId,
      skuId: options.skuId,
      startsAt: null,
      type: "application-subscription",
      unknownFieldCount: 0,
    },
    evidence: {
      projectionComplete: true,
      unknownFields: 0,
      unknownSkuFields: 0,
      unknownSkuFlagBits: 0,
      unknownSkuType: false,
      unknownType: false,
    },
    privacy: PRIVACY,
    schemaVersion: SCHEMA_VERSION,
    sku: {
      available: true,
      id: options.skuId,
      purchaseScope: options.beneficiaryType,
      type: "subscription",
    },
    status: "ok",
    warnings: [],
  }
}

export function fixtureApplicationSubscriptionAudit(options: {
  applicationId: string
  botId: string
  skuId: string
  subscriptionId: string
  userId: string
}): ApplicationSubscriptionAuditResult {
  return {
    application: { botId: options.botId, id: options.applicationId },
    evidence: { unknownFields: 0, unknownStatuses: 0 },
    inventory: {
      accessAuthority: "entitlements-only",
      completeness: "bounded-user-and-sku-page",
      projectionComplete: true,
      skuId: options.skuId,
      userId: options.userId,
    },
    page: {
      boundaryIds: { first: options.subscriptionId, last: options.subscriptionId },
      cursor: { after: null, before: null },
      possibleMore: false,
      requestedLimit: 25,
      returned: 1,
    },
    privacy: PRIVACY,
    records: [{
      canceledAt: null,
      currentPeriod: {
        end: "2026-09-01T00:00:00.000Z",
        start: "2026-08-01T00:00:00.000Z",
      },
      entitlementCount: 1,
      id: options.subscriptionId,
      relatedSkus: { configuredIds: [options.skuId], omittedUnconfigured: 0 },
      renewalSkus: { configuredIds: [options.skuId], omittedUnconfigured: 0 },
      status: "active",
      unknownFieldCount: 0,
    }],
    schemaVersion: SCHEMA_VERSION,
    status: "ok",
    warnings: [],
  }
}
