import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
} from "../src/constants.js"
import type { DiscordWebhookSummary } from "../src/discord-client.js"
import { GuildWebhookAuditEvidenceError } from "../src/errors.js"
import {
  GuildWebhookAuditService,
  type GuildWebhookAuditServiceClient,
} from "../src/guild-webhook-audit-service.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "../src/types.js"

const APPLICATION_ID = "500000000000000001"
const OTHER_APPLICATION_ID = "500000000000000002"
const BOT_ID = "600000000000000001"
const OWNER_ID = "600000000000000002"
const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const BOT_ROLE_ID = "350000000000000001"
const TEXT_CHANNEL_ID = "200000000000000001"
const FORUM_CHANNEL_ID = "200000000000000002"
const FUTURE_CHANNEL_ID = "200000000000000003"
const WEBHOOK_ID = "700000000000000001"

function application(): DiscordApplication {
  return {
    description: "Private connector description",
    id: APPLICATION_ID,
    name: "Private connector name",
  }
}

function guild(overrides: Partial<DiscordGuild> = {}): DiscordGuild {
  return {
    id: GUILD_ID,
    name: "Private guild name",
    owner_id: OWNER_ID,
    ...overrides,
  }
}

function botMember(overrides: Partial<DiscordGuildMember> = {}): DiscordGuildMember {
  return {
    roles: [BOT_ROLE_ID],
    user: {
      bot: true,
      id: BOT_ID,
      username: "private-bot-profile",
    },
    ...overrides,
  }
}

function role(
  id: string,
  permissions: bigint,
  position: number,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : "Private webhook manager",
    permissions: permissions.toString(),
    position,
  }
}

function channel(
  id: string,
  type: number,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: "Private channel name",
    topic: "Private channel topic",
    type,
    ...overrides,
  }
}

function webhook(
  id = WEBHOOK_ID,
  overrides: Partial<DiscordWebhookSummary> = {},
): DiscordWebhookSummary {
  return {
    applicationId: APPLICATION_ID,
    channelId: TEXT_CHANNEL_ID,
    creatorUserId: BOT_ID,
    guildId: GUILD_ID,
    id,
    name: "Ops 🪝",
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
    ...overrides,
  }
}

function policy(options: {
  allowAudit?: boolean
  allowedGuildIds?: readonly string[]
  webhookGuildIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(options.allowedGuildIds ?? [GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowWebhookAudit: options.allowAudit ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    webhookGuildIds: new Set(options.webhookGuildIds ?? [GUILD_ID]),
  })
}

class FixtureClient implements GuildWebhookAuditServiceClient {
  calls: string[] = []
  channels: DiscordChannel[] = [
    channel(TEXT_CHANNEL_ID, DISCORD_CHANNEL_TYPES.text),
    channel(FORUM_CHANNEL_ID, DISCORD_CHANNEL_TYPES.forum),
  ]
  guild: DiscordGuild = guild()
  member: DiscordGuildMember = botMember()
  options: RequestOptions[] = []
  roles: DiscordRole[] = [
    role(GUILD_ID, 0n, 0),
    role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_WEBHOOKS, 10),
  ]
  webhooks: DiscordWebhookSummary[] = []

  async getGuild(guildId: string, options: RequestOptions = {}) {
    assert.equal(guildId, GUILD_ID)
    this.calls.push("guild")
    this.options.push(options)
    return this.guild
  }

  async getGuildChannels(guildId: string, options: RequestOptions = {}) {
    assert.equal(guildId, GUILD_ID)
    this.calls.push("channels")
    this.options.push(options)
    return this.channels
  }

  async getGuildMember(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ) {
    assert.equal(guildId, GUILD_ID)
    assert.equal(userId, BOT_ID)
    this.calls.push("member")
    this.options.push(options)
    return this.member
  }

  async getGuildRoles(guildId: string, options: RequestOptions = {}) {
    assert.equal(guildId, GUILD_ID)
    this.calls.push("roles")
    this.options.push(options)
    return this.roles
  }

  async listGuildWebhooks(guildId: string, options: RequestOptions = {}) {
    assert.equal(guildId, GUILD_ID)
    this.calls.push("webhooks")
    this.options.push(options)
    return this.webhooks
  }
}

function fixture(options: {
  client?: FixtureClient
  policy?: ScopePolicy
} = {}) {
  const client = options.client ?? new FixtureClient()
  return {
    client,
    service: new GuildWebhookAuditService({
      client,
      policy: options.policy ?? policy(),
    }),
  }
}

test("guild webhook audit projects complete deterministic exposure evidence", async () => {
  const setup = fixture()
  setup.client.channels.push(channel(FUTURE_CHANNEL_ID, 99))
  setup.client.webhooks = [
    webhook("700000000000000004", {
      applicationId: null,
      channelId: FUTURE_CHANNEL_ID,
      creatorUserId: null,
      name: "Future",
      type: 4,
    }),
    webhook("700000000000000003", {
      applicationId: null,
      channelId: FORUM_CHANNEL_ID,
      creatorUserId: null,
      name: "Follower",
      sourceChannelId: "200000000000000004",
      sourceGuildId: OTHER_GUILD_ID,
      type: 2,
    }),
    webhook("700000000000000002", {
      applicationId: OTHER_APPLICATION_ID,
      channelId: null,
      creatorUserId: null,
      name: null,
      type: 3,
    }),
    webhook(),
  ]
  const signal = new AbortController().signal

  const result = await setup.service.audit(
    application(),
    BOT_ID,
    GUILD_ID,
    { signal },
  )

  assert.deepEqual(result.records.map(({ id }) => id), [
    "700000000000000001",
    "700000000000000002",
    "700000000000000003",
    "700000000000000004",
  ])
  assert.deepEqual(result.records.map(({ type }) => type.name), [
    "incoming",
    "application",
    "channel-follower",
    "unknown",
  ])
  assert.equal(result.records[0]?.nameCharacters, 5)
  assert.deepEqual(result.records[3]?.channel?.type, {
    code: 99,
    name: "unknown",
  })
  assert.deepEqual(result.exposure, {
    applications: { current: 1, none: 2, other: 1 },
    channels: { boundRecords: 3, uniqueAffected: 3, unboundRecords: 1 },
    creators: { present: 1, unavailable: 3 },
    types: {
      application: 1,
      channelFollowers: 1,
      incoming: 1,
      unknown: 1,
    },
  })
  assert.deepEqual(result.findings.map(({ code }) => code), [
    "incoming-webhooks-present",
    "other-application-webhooks-present",
    "creator-evidence-unavailable",
    "unbound-webhooks-present",
    "future-schema-evidence",
  ])
  assert.deepEqual(result.findingCounts, { info: 2, warnings: 3 })
  assert.equal(result.inventory.completeness, "complete-guild")
  assert.equal(result.inventory.count, 4)
  assert.equal(result.inventory.channelCount, 3)
  assert.equal(result.inventory.localRecordLimit, DISCORD_LIMITS.guildWebhooks)
  assert.equal(result.inventory.projectionComplete, false)
  assert.equal(result.access.manageWebhooks, true)
  assert.equal(result.access.requiredPermission, "MANAGE_WEBHOOKS")
  assert.equal(result.privacy.persistence, "none")
  assert.equal(result.privacy.rawPayloads, "omitted")
  assert.equal(result.privacy.text, "transient-untrusted")
  assert.equal(result.privacy.unknownFields, "discarded")
  assert.deepEqual(new Set(setup.client.calls), new Set([
    "channels",
    "guild",
    "member",
    "roles",
    "webhooks",
  ]))
  assert.equal(setup.client.options.every((options) => options.signal === signal), true)
  const serialized = JSON.stringify(result)
  for (const omitted of [
    "Private guild name",
    "Private channel name",
    "Private channel topic",
    "Private webhook manager",
    "private-bot-profile",
    "200000000000000004",
    OTHER_GUILD_ID,
  ]) {
    assert.equal(serialized.includes(omitted), false)
  }
})

test("guild webhook audit reports empty inventory and administrator authority honestly", async () => {
  const setup = fixture()
  setup.client.roles = [
    role(GUILD_ID, 0n, 0),
    role(BOT_ROLE_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, 10),
  ]

  const result = await setup.service.audit(application(), BOT_ID, GUILD_ID)

  assert.deepEqual(result.findings.map(({ code }) => code), [
    "empty-inventory",
    "administrator-authority",
  ])
  assert.equal(result.access.botAdministrator, true)
  assert.equal(result.inventory.projectionComplete, true)
})

test("guild webhook audit policy fails before Discord access", async () => {
  for (const restrictedPolicy of [
    policy({ allowAudit: false }),
    policy({ webhookGuildIds: [] }),
    policy({ webhookGuildIds: [OTHER_GUILD_ID] }),
    policy({ allowedGuildIds: [OTHER_GUILD_ID] }),
  ]) {
    const setup = fixture({ policy: restrictedPolicy })
    await assert.rejects(
      () => setup.service.audit(application(), BOT_ID, GUILD_ID),
      /webhook|configured read scope/u,
    )
    assert.deepEqual(setup.client.calls, [])
  }
})

test("guild webhook audit rejects incomplete permission evidence", async () => {
  const missingPermission = fixture()
  missingPermission.client.roles = [
    role(GUILD_ID, 0n, 0),
    role(BOT_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 10),
  ]
  await assert.rejects(
    () => missingPermission.service.audit(application(), BOT_ID, GUILD_ID),
    /lacks guild-level MANAGE_WEBHOOKS/u,
  )

  const missingRole = fixture()
  missingRole.client.member = botMember({ roles: ["350000000000000002"] })
  await assert.rejects(
    () => missingRole.service.audit(application(), BOT_ID, GUILD_ID),
    /incomplete guild webhook permission evidence/u,
  )
})

test("guild webhook audit rejects malformed identity, role, and channel evidence", async () => {
  const cases: Array<(client: FixtureClient) => void> = [
    (client) => {
      client.guild = { id: GUILD_ID, name: "Private guild name" }
    },
    (client) => {
      client.member = botMember({
        user: { bot: false, id: BOT_ID, username: "private-user" },
      })
    },
    (client) => { client.roles = [role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_WEBHOOKS, 10)] },
    (client) => {
      client.roles = [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_WEBHOOKS, 10),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_WEBHOOKS, 10),
      ]
    },
    (client) => {
      client.channels = [channel(TEXT_CHANNEL_ID, DISCORD_CHANNEL_TYPES.text, {
        guild_id: OTHER_GUILD_ID,
      })]
    },
  ]
  for (const mutate of cases) {
    const setup = fixture()
    mutate(setup.client)
    await assert.rejects(
      () => setup.service.audit(application(), BOT_ID, GUILD_ID),
      GuildWebhookAuditEvidenceError,
    )
  }
})

test("guild webhook audit rejects malformed and ambiguous webhook evidence", async () => {
  const cases: Array<DiscordWebhookSummary[]> = [
    [webhook(), webhook()],
    [webhook(WEBHOOK_ID, { channelId: "200000000000000099" })],
    [webhook(WEBHOOK_ID, { channelId: null })],
    [webhook(WEBHOOK_ID, { applicationId: null, channelId: null, type: 3 })],
    [webhook(WEBHOOK_ID, { sourceChannelId: "200000000000000004" })],
    [{ ...webhook(), private_unknown_value: "credential-canary" } as DiscordWebhookSummary],
  ]
  for (const webhooks of cases) {
    const setup = fixture()
    setup.client.webhooks = webhooks
    await assert.rejects(
      () => setup.service.audit(application(), BOT_ID, GUILD_ID),
      GuildWebhookAuditEvidenceError,
    )
  }
})

test("guild webhook audit rejects invalid connector identities before access", async () => {
  const setup = fixture()
  await assert.rejects(
    () => setup.service.audit({ ...application(), id: "invalid" }, BOT_ID, GUILD_ID),
    GuildWebhookAuditEvidenceError,
  )
  await assert.rejects(
    () => setup.service.audit(application(), "0", GUILD_ID),
    GuildWebhookAuditEvidenceError,
  )
  assert.deepEqual(setup.client.calls, [])
})
