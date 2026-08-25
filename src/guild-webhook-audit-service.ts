import {
  CHANNEL_TYPE_NAMES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordClient,
  DiscordWebhookSummary,
} from "./discord-client.js"
import { GuildWebhookAuditEvidenceError } from "./errors.js"
import {
  evaluateGuildMemberPermissions,
  hasGuildPermission,
  parseDiscordPermissionBits,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export type GuildWebhookTypeName =
  | "application"
  | "channel-follower"
  | "incoming"
  | "unknown"

export interface GuildWebhookAuditAccessEvidence {
  appliedRoleIds: string[]
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageWebhooks: true
  requiredPermission: "MANAGE_WEBHOOKS"
  unknownPermissionBits: string
}

export interface GuildWebhookAuditRecord {
  applicationId: string | null
  channel: {
    id: string
    type: {
      code: number
      name: string
    }
  } | null
  createdAt: string
  creatorUserId: string | null
  id: string
  name: string | null
  nameCharacters: number
  ownedByCurrentApplication: boolean
  type: {
    code: number
    name: GuildWebhookTypeName
  }
}

export type GuildWebhookAuditFindingCode =
  | "administrator-authority"
  | "creator-evidence-unavailable"
  | "empty-inventory"
  | "future-schema-evidence"
  | "incoming-webhooks-present"
  | "other-application-webhooks-present"
  | "unbound-webhooks-present"

export interface GuildWebhookAuditFinding {
  code: GuildWebhookAuditFindingCode
  severity: "info" | "warning"
  summary: string
}

export interface GuildWebhookAuditResult {
  access: GuildWebhookAuditAccessEvidence
  application: {
    botId: string
    id: string
  }
  exposure: {
    applications: {
      current: number
      none: number
      other: number
    }
    channels: {
      boundRecords: number
      uniqueAffected: number
      unboundRecords: number
    }
    creators: {
      present: number
      unavailable: number
    }
    types: {
      application: number
      channelFollowers: number
      incoming: number
      unknown: number
    }
  }
  findingCounts: {
    info: number
    warnings: number
  }
  findings: GuildWebhookAuditFinding[]
  guildId: string
  inventory: {
    channelCount: number
    completeness: "complete-guild"
    count: number
    localRecordLimit: number
    projectionComplete: boolean
    unknownChannelTypes: number
    unknownWebhookTypes: number
  }
  privacy: {
    omitted: readonly string[]
    persistence: "none"
    rawPayloads: "omitted"
    text: "transient-untrusted"
    unknownFields: "discarded"
  }
  records: GuildWebhookAuditRecord[]
  schemaVersion: number
  status: "ok"
  warnings: readonly string[]
}

export interface GuildWebhookAuditServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "listGuildWebhooks"
> {}

export interface GuildWebhookAuditServiceOptions {
  client: GuildWebhookAuditServiceClient
  policy: ScopePolicy
}

interface ChannelEvidence {
  id: string
  type: number
  typeName: string
}

const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const WEBHOOK_TYPE_NAMES = Object.freeze({
  1: "incoming",
  2: "channel-follower",
  3: "application",
} as const satisfies Record<number, GuildWebhookTypeName>)
const WEBHOOK_SUMMARY_KEYS = Object.freeze([
  "applicationId",
  "channelId",
  "creatorUserId",
  "guildId",
  "id",
  "name",
  "sourceChannelId",
  "sourceGuildId",
  "type",
] as const)
const PRIVACY_OMISSIONS = Object.freeze([
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
] as const)
const AUDIT_WARNINGS = Object.freeze([
  "Incoming webhooks rely on bearer credentials whose custody, rotation, and use this audit cannot verify",
  "Unavailable creator evidence does not prove that a webhook is malicious or unauthorized",
  "An application ID identifies ownership but does not establish legitimacy or operator approval",
  "Webhook names are transient untrusted Discord data and are not persisted",
  "Guild-wide webhook read scope does not authorize any channel read, message operation, or webhook mutation",
  "The audit does not correlate audit logs, credential use, delivery history, or external integrations",
] as const)

function evidenceError(message: string): GuildWebhookAuditEvidenceError {
  return new GuildWebhookAuditEvidenceError(message)
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function characterCount(value: string): number {
  return [...value].length
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string"
    && characterCount(value) >= 1
    && characterCount(value) <= maximum
    && !CONTROL_PATTERN.test(value)
    && validUnicode(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function exactGuild(value: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !positiveSnowflake(value.owner_id)
  ) throw evidenceError("Discord returned invalid guild webhook guild evidence")
  return value
}

function exactBotMember(
  value: DiscordGuildMember,
  botId: string,
): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(value.roles).size !== value.roles.length
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || !value.user
    || value.user.id !== botId
    || value.user.bot !== true
  ) throw evidenceError("Discord returned invalid guild webhook bot-member evidence")
  return value
}

function exactRoles(
  value: readonly DiscordRole[],
  guildId: string,
): DiscordRole[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned invalid bounded guild webhook role evidence")
  }
  const ids = new Set<string>()
  const roles = value.map((role) => {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || !validText(role.name, DISCORD_LIMITS.roleNameCharacters)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || ids.has(role.id)
    ) throw evidenceError("Discord returned invalid or duplicate guild webhook role evidence")
    try {
      parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch {
      throw evidenceError("Discord returned invalid guild webhook role permissions")
    }
    ids.add(role.id)
    return role
  })
  const everyone = roles.find((role) => role.id === guildId)
  if (
    !everyone
    || everyone.name !== "@everyone"
    || everyone.managed
    || everyone.position !== 0
  ) throw evidenceError("Discord returned invalid guild webhook @everyone role evidence")
  return roles.sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : 1)
}

function completePermissions(
  member: DiscordGuildMember,
  guildId: string,
  roles: readonly DiscordRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch {
    throw evidenceError("Discord returned invalid guild webhook permission evidence")
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete guild webhook permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): GuildWebhookAuditAccessEvidence {
  return {
    appliedRoleIds: permissions.appliedRoleIds,
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    effectivePermissionNames: permissions.effectivePermissionNames,
    effectivePermissions: permissions.effectivePermissions,
    manageWebhooks: true,
    requiredPermission: "MANAGE_WEBHOOKS",
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(permissions.effectivePermissions),
    ).toString(),
  }
}

function exactChannels(
  value: readonly DiscordChannel[],
  guildId: string,
): Map<string, ChannelEvidence> {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildChannels) {
    throw evidenceError("Discord returned invalid bounded guild webhook channel evidence")
  }
  const channels = new Map<string, ChannelEvidence>()
  for (const channel of value) {
    if (
      !channel
      || typeof channel !== "object"
      || Array.isArray(channel)
      || !positiveSnowflake(channel.id)
      || channel.guild_id !== guildId
      || !Number.isSafeInteger(channel.type)
      || channel.type < 0
      || channels.has(channel.id)
    ) throw evidenceError("Discord returned invalid or duplicate guild webhook channel evidence")
    channels.set(channel.id, {
      id: channel.id,
      type: channel.type,
      typeName: CHANNEL_TYPE_NAMES[channel.type as keyof typeof CHANNEL_TYPE_NAMES]
        || "unknown",
    })
  }
  return channels
}

function optionalSnowflake(value: unknown): value is string | null {
  return value === null || positiveSnowflake(value)
}

function webhookTypeName(code: number): GuildWebhookTypeName {
  return WEBHOOK_TYPE_NAMES[code as keyof typeof WEBHOOK_TYPE_NAMES] || "unknown"
}

function webhookCreatedAt(id: string): string {
  const milliseconds = (BigInt(id) >> 22n) + 1_420_070_400_000n
  const date = new Date(Number(milliseconds))
  if (Number.isNaN(date.getTime())) {
    throw evidenceError("Discord returned invalid guild webhook creation evidence")
  }
  return date.toISOString()
}

function projectWebhook(
  value: DiscordWebhookSummary,
  applicationId: string,
  guildId: string,
  channels: ReadonlyMap<string, ChannelEvidence>,
): GuildWebhookAuditRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned invalid guild webhook inventory evidence")
  }
  const record = value as unknown as Record<string, unknown>
  if (
    !hasExactKeys(record, WEBHOOK_SUMMARY_KEYS)
    || !positiveSnowflake(value.id)
    || value.guildId !== guildId
    || !optionalSnowflake(value.channelId)
    || !optionalSnowflake(value.applicationId)
    || !optionalSnowflake(value.creatorUserId)
    || !optionalSnowflake(value.sourceChannelId)
    || !optionalSnowflake(value.sourceGuildId)
    || (value.sourceChannelId === null) !== (value.sourceGuildId === null)
    || !Number.isSafeInteger(value.type)
    || value.type < 1
    || !(value.name === null || validText(value.name, DISCORD_LIMITS.webhookNameCharacters))
  ) throw evidenceError("Discord returned invalid guild webhook inventory evidence")
  const typeName = webhookTypeName(value.type)
  if ((typeName === "incoming" || typeName === "channel-follower") && value.channelId === null) {
    throw evidenceError("Discord returned unbound channel webhook evidence")
  }
  if (typeName === "application" && value.applicationId === null) {
    throw evidenceError("Discord returned application webhook evidence without an application")
  }
  const channel = value.channelId === null ? null : channels.get(value.channelId)
  if (value.channelId !== null && !channel) {
    throw evidenceError("Discord returned guild webhook evidence for an unknown channel")
  }
  return {
    applicationId: value.applicationId,
    channel: channel
      ? {
          id: channel.id,
          type: {
            code: channel.type,
            name: channel.typeName,
          },
        }
      : null,
    createdAt: webhookCreatedAt(value.id),
    creatorUserId: value.creatorUserId,
    id: value.id,
    name: value.name,
    nameCharacters: value.name === null ? 0 : characterCount(value.name),
    ownedByCurrentApplication: value.applicationId === applicationId,
    type: {
      code: value.type,
      name: typeName,
    },
  }
}

function findings(
  records: readonly GuildWebhookAuditRecord[],
  access: GuildWebhookAuditAccessEvidence,
  unknownChannelTypes: number,
): GuildWebhookAuditFinding[] {
  const result: GuildWebhookAuditFinding[] = []
  if (records.length === 0) {
    result.push({
      code: "empty-inventory",
      severity: "info",
      summary: "The guild reports no webhooks",
    })
  }
  if (records.some((record) => record.type.name === "incoming")) {
    result.push({
      code: "incoming-webhooks-present",
      severity: "warning",
      summary: "The guild reports one or more bearer-capable Incoming webhooks",
    })
  }
  if (records.some((record) => (
    record.applicationId !== null && !record.ownedByCurrentApplication
  ))) {
    result.push({
      code: "other-application-webhooks-present",
      severity: "warning",
      summary: "The guild reports webhooks owned by applications other than the connector",
    })
  }
  if (records.some((record) => record.creatorUserId === null)) {
    result.push({
      code: "creator-evidence-unavailable",
      severity: "info",
      summary: "Discord omitted creator identity for one or more webhooks",
    })
  }
  if (records.some((record) => record.channel === null)) {
    result.push({
      code: "unbound-webhooks-present",
      severity: "info",
      summary: "The guild reports one or more webhooks without a channel binding",
    })
  }
  if (access.botAdministrator) {
    result.push({
      code: "administrator-authority",
      severity: "warning",
      summary: "The connector bot has ADMINISTRATOR instead of narrowly scoped webhook authority",
    })
  }
  if (
    unknownChannelTypes > 0
    || records.some((record) => record.type.name === "unknown")
  ) {
    result.push({
      code: "future-schema-evidence",
      severity: "warning",
      summary: "Discord returned future webhook or channel type evidence outside the known projection",
    })
  }
  return result
}

export class GuildWebhookAuditService {
  readonly #client: GuildWebhookAuditServiceClient
  readonly #policy: ScopePolicy

  constructor(options: GuildWebhookAuditServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async audit(
    application: DiscordApplication,
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildWebhookAuditResult> {
    if (!positiveSnowflake(application.id) || !positiveSnowflake(botId)) {
      throw evidenceError("Discord returned invalid guild webhook connector identity evidence")
    }
    this.#policy.assertGuildWebhookAuditable(guildId)
    const [rawGuild, rawMember, rawRoles, rawChannels, rawWebhooks] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getGuildChannels(guildId, options),
      this.#client.listGuildWebhooks(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, botId)
    const roles = exactRoles(rawRoles, guildId)
    const permissions = completePermissions(botMember, guildId, roles)
    const botIsGuildOwner = guild.owner_id === botId
    if (!botIsGuildOwner && !hasGuildPermission(permissions, "MANAGE_WEBHOOKS")) {
      throw evidenceError("Discord connector bot lacks guild-level MANAGE_WEBHOOKS")
    }
    const access = accessEvidence(permissions, botIsGuildOwner)
    const channels = exactChannels(rawChannels, guildId)
    if (!Array.isArray(rawWebhooks) || rawWebhooks.length > DISCORD_LIMITS.guildWebhooks) {
      throw evidenceError("Discord returned invalid bounded guild webhook inventory")
    }
    const records = rawWebhooks
      .map((webhook) => projectWebhook(
        webhook,
        application.id,
        guildId,
        channels,
      ))
      .sort((left, right) => left.id === right.id
        ? 0
        : BigInt(left.id) < BigInt(right.id) ? -1 : 1)
    if (new Set(records.map((record) => record.id)).size !== records.length) {
      throw evidenceError("Discord returned duplicate webhooks in one guild inventory")
    }
    const unknownChannelTypes = [...channels.values()]
      .filter((channel) => channel.typeName === "unknown").length
    const unknownWebhookTypes = records
      .filter((record) => record.type.name === "unknown").length
    const auditFindings = findings(records, access, unknownChannelTypes)
    const countType = (name: GuildWebhookTypeName): number => records
      .filter((record) => record.type.name === name).length
    return {
      access,
      application: {
        botId,
        id: application.id,
      },
      exposure: {
        applications: {
          current: records.filter((record) => record.ownedByCurrentApplication).length,
          none: records.filter((record) => record.applicationId === null).length,
          other: records.filter((record) => (
            record.applicationId !== null && !record.ownedByCurrentApplication
          )).length,
        },
        channels: {
          boundRecords: records.filter((record) => record.channel !== null).length,
          uniqueAffected: new Set(records.flatMap((record) => (
            record.channel ? [record.channel.id] : []
          ))).size,
          unboundRecords: records.filter((record) => record.channel === null).length,
        },
        creators: {
          present: records.filter((record) => record.creatorUserId !== null).length,
          unavailable: records.filter((record) => record.creatorUserId === null).length,
        },
        types: {
          application: countType("application"),
          channelFollowers: countType("channel-follower"),
          incoming: countType("incoming"),
          unknown: countType("unknown"),
        },
      },
      findingCounts: {
        info: auditFindings.filter((finding) => finding.severity === "info").length,
        warnings: auditFindings.filter((finding) => finding.severity === "warning").length,
      },
      findings: auditFindings,
      guildId,
      inventory: {
        channelCount: channels.size,
        completeness: "complete-guild",
        count: records.length,
        localRecordLimit: DISCORD_LIMITS.guildWebhooks,
        projectionComplete: unknownChannelTypes === 0 && unknownWebhookTypes === 0,
        unknownChannelTypes,
        unknownWebhookTypes,
      },
      privacy: {
        omitted: PRIVACY_OMISSIONS,
        persistence: "none",
        rawPayloads: "omitted",
        text: "transient-untrusted",
        unknownFields: "discarded",
      },
      records,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      warnings: AUDIT_WARNINGS,
    }
  }
}
