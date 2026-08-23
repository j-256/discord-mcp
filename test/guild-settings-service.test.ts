import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
  GuildSettingsActivity,
} from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK,
} from "../src/constants.js"
import type { ModifyGuildSettingsInput } from "../src/discord-client.js"
import {
  DiscordApiError,
  GuildSettingsEvidenceError,
  GuildSettingsExecutionError,
  GuildSettingsOperationConflictError,
  GuildSettingsPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import type {
  GatewayChannelLayoutSnapshot,
  GatewayChannelLayoutSource,
} from "../src/gateway-channel-layout.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"
import {
  GuildSettingsService,
  normalizeGuildSettingsChangeRequest,
  type GuildSettingsChangeRequest,
  type GuildSettingsServiceOptions,
} from "../src/guild-settings-service.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const SECOND_GUILD_ID = "200000000000000002"
const THIRD_GUILD_ID = "200000000000000003"
const OWNER_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const BOT_ROLE_ID = "500000000000000001"
const TEXT_CHANNEL_ID = "600000000000000001"
const ANNOUNCEMENT_CHANNEL_ID = "600000000000000002"
const VOICE_CHANNEL_ID = "600000000000000003"
const STAGE_CHANNEL_ID = "600000000000000004"
const CATEGORY_ID = "600000000000000005"
const AUDIT_REASON = "Reviewed guild defaults"
const OPERATION_KEY = "guild-settings-operation-0001"
const NOW = "2026-08-23T00:00:00.000Z"

function role(
  id: string,
  permissions: bigint,
  position: number,
  guildId = GUILD_ID,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === guildId ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(
  id: string,
  type: number,
  position: number,
  guildId = GUILD_ID,
  parentId: string | null = null,
): DiscordChannel {
  return {
    guild_id: guildId,
    id,
    name: `private-channel-${id}`,
    parent_id: parentId,
    position,
    type,
  }
}

interface SettingsState {
  afkChannelId: string | null
  afkTimeoutSeconds: 60 | 300 | 900 | 1_800 | 3_600
  defaultMessageNotifications: 0 | 1
  explicitContentFilter: 0 | 1 | 2
  premiumProgressBarEnabled: boolean
  suppressedSystemNotifications: number
  systemChannelId: string | null
  verificationLevel: 0 | 1 | 2 | 3 | 4
}

function defaultSettings(): SettingsState {
  return {
    afkChannelId: VOICE_CHANNEL_ID,
    afkTimeoutSeconds: 300,
    defaultMessageNotifications: 0,
    explicitContentFilter: 1,
    premiumProgressBarEnabled: false,
    suppressedSystemNotifications: 0,
    systemChannelId: TEXT_CHANNEL_ID,
    verificationLevel: 1,
  }
}

function guild(
  guildId: string,
  ownerId: string,
  settings: SettingsState,
): DiscordGuild {
  return {
    afk_channel_id: settings.afkChannelId,
    afk_timeout: settings.afkTimeoutSeconds,
    default_message_notifications: settings.defaultMessageNotifications,
    explicit_content_filter: settings.explicitContentFilter,
    features: [],
    id: guildId,
    name: "Private Guild",
    owner_id: ownerId,
    premium_progress_bar_enabled: settings.premiumProgressBarEnabled,
    system_channel_flags: settings.suppressedSystemNotifications,
    system_channel_id: settings.systemChannelId,
    verification_level: settings.verificationLevel,
  }
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  async get(kind: OperationReceipt["kind"], hash: string) {
    return this.receipts.get(`${kind}:${hash}`)
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("operation:reserve")
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  botMember: DiscordGuildMember
  channels: DiscordChannel[]
  layoutObfuscatedIds: Set<string>
  layoutRevision: number
  mutationError: unknown
  mutationUpdatesState: boolean
  ownerId: string
  readbackError: unknown
  responseDriftField: keyof SettingsState | null
  roles: DiscordRole[]
  settings: SettingsState
}

class FixtureLayoutSource implements GatewayChannelLayoutSource {
  readonly #guildId: string
  readonly #state: FixtureState
  readonly layoutEnabled = true

  constructor(guildId: string, state: FixtureState) {
    this.#guildId = guildId
    this.#state = state
  }

  getChannelLayout(guildId: string): GatewayChannelLayoutSnapshot {
    assert.equal(guildId, this.#guildId)
    return {
      channels: this.#state.channels.map((entry) => ({
        channelId: entry.id,
        obfuscated: this.#state.layoutObfuscatedIds.has(entry.id),
        parentChannelId: entry.parent_id ?? null,
        position: entry.position ?? 0,
        type: entry.type,
      })),
      complete: true,
      guildId,
      reason: null,
      revision: this.#state.layoutRevision,
      schemaVersion: 1,
      state: "ready",
      updatedAt: NOW,
    }
  }

  getChannelLayoutStatus() {
    return {
      channels: { obfuscated: 0, retained: this.#state.channels.length },
      enabled: true,
      guilds: {
        invalidated: 0,
        pending: 0,
        ready: 1,
        resuming: 0,
        scoped: 1,
        unavailable: 0,
      },
      invalidations: 0,
      schemaVersion: 1,
      updates: 1,
    }
  }

  subscribeChannelLayouts() {
    return () => undefined
  }
}

function fixture(options: {
  allowAudit?: boolean
  allowChanges?: boolean
  guildId?: string
  state?: Partial<FixtureState>
} = {}) {
  const guildId = options.guildId ?? GUILD_ID
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: [
      channel(TEXT_CHANNEL_ID, DISCORD_CHANNEL_TYPES.text, 0, guildId),
      channel(ANNOUNCEMENT_CHANNEL_ID, DISCORD_CHANNEL_TYPES.announcement, 1, guildId),
      channel(VOICE_CHANNEL_ID, DISCORD_CHANNEL_TYPES.voice, 2, guildId),
      channel(STAGE_CHANNEL_ID, DISCORD_CHANNEL_TYPES.stageVoice, 3, guildId),
      channel(CATEGORY_ID, DISCORD_CHANNEL_TYPES.category, 4, guildId),
    ],
    layoutObfuscatedIds: new Set(),
    layoutRevision: 1,
    mutationError: undefined,
    mutationUpdatesState: true,
    ownerId: OWNER_ID,
    readbackError: undefined,
    responseDriftField: null,
    roles: [
      role(guildId, 0n, 0, guildId),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 1, guildId),
    ],
    settings: defaultSettings(),
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const writes: ModifyGuildSettingsInput[] = []
  const reasons: string[] = []
  let activityCalls = 0
  let mutationCompleted = false
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) throw new Error("activity unavailable")
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(events)
  const policy: GuildSettingsServiceOptions["policy"] = {
    assertGuildSettingsAuditable(candidate) {
      if (!(options.allowAudit ?? true) || candidate !== guildId) {
        throw new PolicyError("Discord guild-settings audit is outside scope")
      }
    },
    assertGuildSettingsChangeable(candidate) {
      if (!(options.allowChanges ?? true) || candidate !== guildId) {
        throw new PolicyError("Discord guild-settings change is outside scope")
      }
    },
  }
  const applyInput = (input: ModifyGuildSettingsInput, target: SettingsState) => {
    if (input.afkChannelId !== undefined) target.afkChannelId = input.afkChannelId
    if (input.afkTimeoutSeconds !== undefined) {
      target.afkTimeoutSeconds = input.afkTimeoutSeconds
    }
    if (input.defaultMessageNotifications !== undefined) {
      target.defaultMessageNotifications = input.defaultMessageNotifications
    }
    if (input.explicitContentFilter !== undefined) {
      target.explicitContentFilter = input.explicitContentFilter
    }
    if (input.premiumProgressBarEnabled !== undefined) {
      target.premiumProgressBarEnabled = input.premiumProgressBarEnabled
    }
    if (input.suppressedSystemNotifications !== undefined) {
      target.suppressedSystemNotifications = input.suppressedSystemNotifications
    }
    if (input.systemChannelId !== undefined) target.systemChannelId = input.systemChannelId
    if (input.verificationLevel !== undefined) target.verificationLevel = input.verificationLevel
  }
  const client: GuildSettingsServiceOptions["client"] = {
    async getGuild() {
      events.push(mutationCompleted ? "read:readback-guild" : "read:guild")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return guild(guildId, state.ownerId, state.settings)
    },
    async getGuildChannels() {
      events.push("read:channels")
      return structuredClone(state.channels)
    },
    async getGuildMember() {
      events.push("read:member")
      return structuredClone(state.botMember)
    },
    async getGuildRoles() {
      events.push("read:roles")
      return structuredClone(state.roles)
    },
    async modifyGuildSettings(_guildId, input, reason) {
      events.push("write:guild-settings")
      writes.push(structuredClone(input))
      reasons.push(reason)
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      const response = structuredClone(state.settings)
      applyInput(input, response)
      if (state.responseDriftField) {
        const field = state.responseDriftField
        if (field === "verificationLevel") response[field] = response[field] === 4 ? 3 : 4
        else if (field === "premiumProgressBarEnabled") response[field] = !response[field]
        else if (field === "systemChannelId") response[field] = null
      }
      if (state.mutationUpdatesState) applyInput(input, state.settings)
      return guild(guildId, state.ownerId, response)
    },
  }
  const service = new GuildSettingsService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    layoutSource: new FixtureLayoutSource(guildId, state),
    operationStore,
    planKey: new Uint8Array(32).fill(29),
    policy,
    randomId: () => "activity-guild-settings-0001",
  })
  return {
    activities,
    events,
    operationStore,
    reasons,
    service,
    state,
    writes,
  }
}

function request(
  overrides: Partial<GuildSettingsChangeRequest> = {},
): GuildSettingsChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    explicitContentFilter: "all-members",
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    verificationLevel: "high",
    ...overrides,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected guild-settings change",
    method: "PATCH",
    route: "/guilds/{guild.id}",
    status,
  })
}

test("guild-settings normalization accepts named sparse fields and hashes the key", () => {
  const normalized = normalizeGuildSettingsChangeRequest({
    afkChannelId: null,
    afkTimeoutSeconds: 3_600,
    auditReason: AUDIT_REASON,
    defaultMessageNotifications: "only-mentions",
    explicitContentFilter: "all-members",
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    premiumProgressBarEnabled: true,
    suppressedSystemNotifications: [
      "premium-subscriptions",
      "join-notifications",
    ],
    systemChannelId: ANNOUNCEMENT_CHANNEL_ID,
    verificationLevel: "very-high",
  })
  assert.deepEqual(normalized.requestedFields, [
    "afkChannelId",
    "afkTimeoutSeconds",
    "defaultMessageNotifications",
    "explicitContentFilter",
    "premiumProgressBarEnabled",
    "suppressedSystemNotifications",
    "systemChannelId",
    "verificationLevel",
  ])
  assert.deepEqual(normalized.suppressedSystemNotifications, [
    "join-notifications",
    "premium-subscriptions",
  ])
  assert.equal(normalized.operationKeyHash.includes(OPERATION_KEY), false)
})

test("guild-settings normalization rejects ambiguous or unsupported requests", () => {
  assert.throws(
    () => normalizeGuildSettingsChangeRequest({
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: OPERATION_KEY,
    }),
    /at least one field/,
  )
  assert.throws(
    () => normalizeGuildSettingsChangeRequest({
      ...request(),
      future: true,
    } as unknown as GuildSettingsChangeRequest),
    /request is invalid/,
  )
  assert.throws(
    () => normalizeGuildSettingsChangeRequest(request({ systemChannelId: "bad" })),
    /positive Discord snowflake/,
  )
  assert.throws(
    () => normalizeGuildSettingsChangeRequest(request({
      afkTimeoutSeconds: 120 as 60,
    })),
    /AFK timeout/,
  )
  assert.throws(
    () => normalizeGuildSettingsChangeRequest(request({
      verificationLevel: "extreme" as "high",
    })),
    /verification level/,
  )
  assert.throws(
    () => normalizeGuildSettingsChangeRequest(request({
      defaultMessageNotifications: "never" as "only-mentions",
    })),
    /notification default/,
  )
  assert.throws(
    () => normalizeGuildSettingsChangeRequest(request({
      explicitContentFilter: "future" as "all-members",
    })),
    /content filter/,
  )
  assert.throws(
    () => normalizeGuildSettingsChangeRequest(request({
      suppressedSystemNotifications: ["join-notifications", "join-notifications"],
    })),
    /suppressions/,
  )
  assert.throws(
    () => normalizeGuildSettingsChangeRequest(request({
      operationKey: "short",
    })),
    /operation key/,
  )
})

test("guild-settings audit projects finite values without presentation content", async () => {
  const audited = fixture({
    state: {
      settings: {
        ...defaultSettings(),
        defaultMessageNotifications: 1,
        explicitContentFilter: 2,
        premiumProgressBarEnabled: true,
        suppressedSystemNotifications: (1 << 0) | (1 << 5),
        verificationLevel: 4,
      },
    },
  })
  const result = await audited.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(result.status, "ok")
  assert.equal(result.guildId, GUILD_ID)
  assert.equal(result.configuration.verificationLevel, "very-high")
  assert.equal(result.configuration.defaultMessageNotifications, "only-mentions")
  assert.equal(result.configuration.explicitContentFilter, "all-members")
  assert.deepEqual(result.configuration.suppressedSystemNotifications, [
    "join-notifications",
    "role-subscription-purchase-notification-replies",
  ])
  assert.equal(result.configuration.afkChannel?.eligible, true)
  assert.equal(result.configuration.systemChannel?.eligible, true)
  assert.equal(result.inventory.metadataCoverage, "complete")
  assert.deepEqual(result.privacy, {
    channelNames: "omitted",
    guildPresentation: "omitted",
    memberData: "omitted",
    persistence: "none",
    rawPayloads: "omitted",
    roleNames: "omitted",
    unknownValues: "bit-presence-only",
  })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /Private Guild|private-channel|private-role/)
})

test("guild-settings audit requires exact scope, authority, and complete evidence", async () => {
  await assert.rejects(
    () => fixture({ allowAudit: false }).service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    PolicyError,
  )
  await assert.rejects(
    () => fixture({
      state: {
        roles: [
          role(GUILD_ID, 0n, 0),
          role(BOT_ROLE_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 1),
        ],
      },
    }).service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    GuildSettingsEvidenceError,
  )
  const owner = fixture({ state: { ownerId: BOT_ID } })
  assert.equal((await owner.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)).access.botIsGuildOwner, true)
  const administrator = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, 1),
      ],
    },
  })
  assert.equal(
    (await administrator.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)).access.botAdministrator,
    true,
  )
  const malformed = fixture()
  malformed.state.settings.afkTimeoutSeconds = 120 as 60
  await assert.rejects(
    () => malformed.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    GuildSettingsEvidenceError,
  )
})

test("guild-settings exposes unknown flag presence but changes them only with exact known evidence", async () => {
  const audited = fixture({
    state: {
      settings: {
        ...defaultSettings(),
        suppressedSystemNotifications: GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK | (1 << 8),
      },
    },
  })
  const result = await audited.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(result.configuration.unknownSystemChannelFlagsPresent, true)
  assert.match(result.configuration.issues.join(" "), /unknown future bits/)
  assert.equal(
    JSON.stringify(result).includes(String(GUILD_SYSTEM_CHANNEL_KNOWN_FLAG_MASK | (1 << 8))),
    false,
  )
  await assert.rejects(
    () => audited.service.plan(APPLICATION_ID, BOT_ID, request({
      suppressedSystemNotifications: [],
    })),
    /unknown flag bits/,
  )
  const scalar = await audited.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(scalar.status, "planned")
})

test("guild-settings validates requested channel roles while permitting safe clear and unrelated changes", async () => {
  await assert.rejects(
    () => fixture().service.plan(APPLICATION_ID, BOT_ID, request({
      afkChannelId: STAGE_CHANNEL_ID,
    })),
    /eligible voice channel/,
  )
  await assert.rejects(
    () => fixture().service.plan(APPLICATION_ID, BOT_ID, request({
      systemChannelId: VOICE_CHANNEL_ID,
    })),
    /eligible text channel/,
  )
  const obfuscated = fixture({
    state: {
      layoutObfuscatedIds: new Set([TEXT_CHANNEL_ID]),
    },
  })
  const audit = await obfuscated.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(audit.configuration.systemChannel?.metadata, "obfuscated")
  await assert.rejects(
    () => obfuscated.service.plan(APPLICATION_ID, BOT_ID, request({
      systemChannelId: TEXT_CHANNEL_ID,
    })),
    /eligible text channel/,
  )
  const scalar = await obfuscated.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(scalar.writeRequired, true)
  const cleared = await obfuscated.service.plan(APPLICATION_ID, BOT_ID, {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: "guild-settings-clear-operation-0001",
    systemChannelId: null,
  })
  assert.equal(cleared.desired.systemChannelId, null)
})

test("guild-settings plan binds exact current state, sparse intent, and risk direction", async () => {
  const planned = fixture()
  const first = await planned.service.plan(APPLICATION_ID, BOT_ID, request({
    afkTimeoutSeconds: 3_600,
    defaultMessageNotifications: "only-mentions",
    premiumProgressBarEnabled: true,
    suppressedSystemNotifications: ["join-notifications"],
    systemChannelId: ANNOUNCEMENT_CHANNEL_ID,
    verificationLevel: "none",
  }))
  const second = await planned.service.plan(APPLICATION_ID, BOT_ID, request({
    afkTimeoutSeconds: 3_600,
    defaultMessageNotifications: "only-mentions",
    premiumProgressBarEnabled: true,
    suppressedSystemNotifications: ["join-notifications"],
    systemChannelId: ANNOUNCEMENT_CHANNEL_ID,
    verificationLevel: "none",
  }))
  assert.equal(first.digest, second.digest)
  assert.equal(first.status, "planned")
  assert.deepEqual(first.changedFields, [
    "afkTimeoutSeconds",
    "defaultMessageNotifications",
    "explicitContentFilter",
    "premiumProgressBarEnabled",
    "suppressedSystemNotifications",
    "systemChannelId",
    "verificationLevel",
  ])
  assert.ok(first.effects.some(({ effect }) => effect === "weakening"))
  assert.ok(first.effects.some(({ effect }) => effect === "noise-reducing"))
  assert.ok(first.effects.some(({ effect }) => effect === "suppression-increase"))
  assert.ok(first.effects.some(({ effect }) => effect === "routing-change"))
  assert.match(first.risks.join(" "), /reduce guild verification/)
  assert.doesNotMatch(JSON.stringify(first), new RegExp(OPERATION_KEY))
})

test("guild-settings no-op avoids reservation, activity, and mutation", async () => {
  const noOp = fixture({
    state: {
      settings: {
        ...defaultSettings(),
        explicitContentFilter: 2,
        verificationLevel: 3,
      },
    },
  })
  const desired = request()
  const plan = await noOp.service.plan(APPLICATION_ID, BOT_ID, desired)
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)
  const result = await noOp.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.deepEqual(noOp.writes, [])
  assert.deepEqual(noOp.activities, [])
  assert.doesNotMatch(noOp.events.join(" "), /operation:reserve/)
})

test("guild-settings execution records pending evidence before one exact sparse patch", async () => {
  const changed = fixture()
  const desired: GuildSettingsChangeRequest = {
    afkChannelId: null,
    auditReason: AUDIT_REASON,
    defaultMessageNotifications: "only-mentions",
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    premiumProgressBarEnabled: true,
    suppressedSystemNotifications: [
      "join-notifications",
      "premium-subscriptions",
    ],
    systemChannelId: ANNOUNCEMENT_CHANNEL_ID,
  }
  const plan = await changed.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await changed.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.deepEqual(result.driftFields, [])
  assert.deepEqual(changed.writes, [{
    afkChannelId: null,
    defaultMessageNotifications: 1,
    premiumProgressBarEnabled: true,
    suppressedSystemNotifications: 3,
    systemChannelId: ANNOUNCEMENT_CHANNEL_ID,
  }])
  assert.deepEqual(changed.reasons, [AUDIT_REASON])
  const reserve = changed.events.indexOf("operation:reserve")
  const pending = changed.events.indexOf("activity:pending")
  const write = changed.events.indexOf("write:guild-settings")
  assert.ok(reserve >= 0 && reserve < pending && pending < write)
  assert.deepEqual(
    changed.activities.map((entry) => entry.status),
    ["pending", "completed"],
  )
  const records = changed.activities as GuildSettingsActivity[]
  assert.deepEqual(records[0]?.requestedFields, [
    "afkChannelId",
    "defaultMessageNotifications",
    "premiumProgressBarEnabled",
    "suppressedSystemNotifications",
    "systemChannelId",
  ])
  const persisted = JSON.stringify(changed.activities)
  assert.doesNotMatch(persisted, new RegExp(AUDIT_REASON))
  assert.doesNotMatch(persisted, new RegExp(TEXT_CHANNEL_ID))
  assert.doesNotMatch(persisted, new RegExp(ANNOUNCEMENT_CHANNEL_ID))
  assert.doesNotMatch(persisted, new RegExp(OPERATION_KEY))
})

test("guild-settings rejects stale plans and reserved one-shot keys", async () => {
  const stale = fixture()
  const desired = request()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, desired)
  stale.state.settings.verificationLevel = 2
  await assert.rejects(
    () => stale.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    GuildSettingsPlanChangedError,
  )

  const conflict = fixture()
  const conflictPlan = await conflict.service.plan(APPLICATION_ID, BOT_ID, desired)
  await conflict.operationStore.reserve({
    activityId: "prior-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "guild-settings-change",
    operationKeyHash: normalizeGuildSettingsChangeRequest(desired).operationKeyHash,
    planDigest: conflictPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    () => conflict.service.execute(APPLICATION_ID, BOT_ID, desired, conflictPlan.digest),
    GuildSettingsOperationConflictError,
  )
})

test("guild-settings reports response and readback drift without retry", async () => {
  const responseDrift = fixture({ state: { responseDriftField: "verificationLevel" } })
  const desired = request()
  const plan = await responseDrift.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await responseDrift.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )
  assert.equal(result.status, "completed-with-drift")
  assert.deepEqual(result.driftFields, ["verificationLevel"])
  assert.equal(responseDrift.writes.length, 1)

  const readbackDrift = fixture({ state: { mutationUpdatesState: false } })
  const readbackPlan = await readbackDrift.service.plan(APPLICATION_ID, BOT_ID, desired)
  const readbackResult = await readbackDrift.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    readbackPlan.digest,
  )
  assert.equal(readbackResult.status, "completed-with-drift")
  assert.deepEqual(readbackResult.driftFields, ["explicitContentFilter", "verificationLevel"])
  assert.equal(readbackDrift.writes.length, 1)
})

test("guild-settings distinguishes deterministic refusal from uncertain dispatch", async () => {
  const refused = fixture({ state: { mutationError: apiError(403) } })
  const desired = request()
  const refusedPlan = await refused.service.plan(APPLICATION_ID, BOT_ID, desired)
  await assert.rejects(
    () => refused.service.execute(APPLICATION_ID, BOT_ID, desired, refusedPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildSettingsExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )
  assert.equal(refused.writes.length, 1)
  assert.equal((refused.activities.at(-1) as GuildSettingsActivity).status, "failed")

  const uncertain = fixture({
    guildId: SECOND_GUILD_ID,
    state: { mutationError: apiError(500) },
  })
  const uncertainRequest = request({
    guildId: SECOND_GUILD_ID,
    operationKey: "guild-settings-uncertain-operation-0001",
  })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildSettingsExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  uncertain.state.mutationError = undefined
  const laterRequest = {
    ...uncertainRequest,
    operationKey: "guild-settings-later-operation-0002",
  }
  const laterPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    laterRequest,
  )
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      laterRequest,
      laterPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildSettingsExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-prior-uncertain")
      return true
    },
  )
  assert.equal(uncertain.writes.length, 1)
})

test("guild-settings blocks writes when pending activity fails", async () => {
  const blocked = fixture({
    guildId: THIRD_GUILD_ID,
    state: { activityFailureAt: 1 },
  })
  const desired = request({
    guildId: THIRD_GUILD_ID,
    operationKey: "guild-settings-audit-failure-0001",
  })
  const plan = await blocked.service.plan(APPLICATION_ID, BOT_ID, desired)
  await assert.rejects(
    () => blocked.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildSettingsExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.deepEqual(blocked.writes, [])
})

test("guild-settings quarantines a completed mutation whose receipt cannot finalize", async () => {
  const broken = fixture({
    guildId: "200000000000000004",
  })
  const desired = request({
    guildId: "200000000000000004",
    operationKey: "guild-settings-receipt-failure-0001",
  })
  const plan = await broken.service.plan(APPLICATION_ID, BOT_ID, desired)
  broken.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    () => broken.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildSettingsExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-operation-record-failed",
      )
      return true
    },
  )
  assert.equal(broken.writes.length, 1)
})
