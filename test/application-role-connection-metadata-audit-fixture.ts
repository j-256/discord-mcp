import type { ApplicationRoleConnectionMetadataAuditResult } from "../src/application-role-connection-metadata-audit-service.js"

export function fixtureApplicationRoleConnectionMetadataAudit(options: {
  applicationId: string
  botId: string
}): ApplicationRoleConnectionMetadataAuditResult {
  return {
    application: {
      botId: options.botId,
      id: options.applicationId,
      verificationEndpointConfigured: true,
    },
    evidence: {
      unknownFields: 0,
      unknownTypes: 0,
    },
    findingCounts: {
      info: 1,
      warnings: 0,
    },
    findings: [{
      code: "active-schema",
      severity: "info",
      summary: "The application reports a verification endpoint and linked-role metadata schema",
    }],
    inventory: {
      completeness: "complete-current-application",
      count: 1,
      documentedLimit: 5,
      projectionComplete: true,
    },
    privacy: {
      omitted: [
        "guild-role-configuration",
        "localization-values",
        "raw-discord-payloads",
        "unknown-field-values",
        "user-role-connection-values",
        "verification-endpoint-url",
      ],
      persistence: "none",
      rawPayloads: "omitted",
      text: "transient-untrusted",
      unknownFields: "counts-only",
    },
    records: [{
      description: "Minimum review level",
      descriptionCharacters: 20,
      key: "review_level",
      localizations: {
        descriptions: 0,
        names: 0,
      },
      name: "Review level",
      nameCharacters: 12,
      type: {
        code: 2,
        comparison: "greater-than-or-equal",
        name: "integer-greater-than-or-equal",
        valueKind: "integer",
      },
      unknownFieldCount: 0,
    }],
    schemaVersion: 1,
    status: "ok",
    warnings: [
      "Metadata definitions do not prove which guild roles use them or whether any user satisfies them",
    ],
  }
}
