import { DISCORD_LIMITS } from "../src/constants.js"
import type { GuildWebhookAuditResult } from "../src/guild-webhook-audit-service.js"

export function fixtureGuildWebhookAudit(
  overrides: {
    applicationId?: string
    botId?: string
    channelId?: string
    guildId?: string
    webhookId?: string
  } = {},
): GuildWebhookAuditResult {
  const applicationId = overrides.applicationId ?? "500000000000000001"
  const botId = overrides.botId ?? "600000000000000001"
  const channelId = overrides.channelId ?? "200000000000000001"
  const guildId = overrides.guildId ?? "100000000000000001"
  const webhookId = overrides.webhookId ?? "360000000000000001"
  return {
    access: {
      appliedRoleIds: [guildId],
      botAdministrator: false,
      botIsGuildOwner: false,
      complete: true,
      effectivePermissionNames: ["MANAGE_WEBHOOKS"],
      effectivePermissions: "536870912",
      manageWebhooks: true,
      requiredPermission: "MANAGE_WEBHOOKS",
      unknownPermissionBits: "0",
    },
    application: { botId, id: applicationId },
    exposure: {
      applications: { current: 1, none: 0, other: 0 },
      channels: { boundRecords: 1, uniqueAffected: 1, unboundRecords: 0 },
      creators: { present: 1, unavailable: 0 },
      types: {
        application: 0,
        channelFollowers: 0,
        incoming: 1,
        unknown: 0,
      },
    },
    findingCounts: { info: 0, warnings: 1 },
    findings: [{
      code: "incoming-webhooks-present",
      severity: "warning",
      summary: "The guild reports one or more bearer-capable Incoming webhooks",
    }],
    guildId,
    inventory: {
      channelCount: 1,
      completeness: "complete-guild",
      count: 1,
      localRecordLimit: DISCORD_LIMITS.guildWebhooks,
      projectionComplete: true,
      unknownChannelTypes: 0,
      unknownWebhookTypes: 0,
    },
    privacy: {
      omitted: [
        "audit-log-data",
        "avatars",
        "channel-names-and-topics",
        "creator-profiles-and-usernames",
        "execution-urls",
        "guild-names",
        "message-content",
        "raw-discord-payloads",
        "source-guilds-and-channels",
        "unknown-field-values",
        "webhook-tokens",
      ],
      persistence: "none",
      rawPayloads: "omitted",
      text: "transient-untrusted",
      unknownFields: "discarded",
    },
    records: [{
      applicationId,
      channel: { id: channelId, type: { code: 0, name: "guild-text" } },
      createdAt: "2017-04-13T13:20:15.899Z",
      creatorUserId: botId,
      id: webhookId,
      name: "private-webhook-name",
      nameCharacters: 20,
      ownedByCurrentApplication: true,
      type: { code: 1, name: "incoming" },
    }],
    schemaVersion: 1,
    status: "ok",
    warnings: [
      "Incoming webhooks rely on bearer credentials whose custody, rotation, and use this audit cannot verify",
    ],
  }
}
