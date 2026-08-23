import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityList,
  ActivityStore,
} from "../src/activity-log.js"
import {
  type ChannelDeletionRequest,
  ChannelDeletionService,
  type ChannelDeletionServiceClient,
  normalizeChannelDeletionRequest,
} from "../src/channel-deletion-service.js"
import {
  DISCORD_CHANNEL_TYPES,
  SCHEMA_VERSION,
} from "../src/constants.js"
import type {
  DiscordGuildOnboarding,
  DiscordGuildWidgetSettings,
  DiscordInviteSummary,
} from "../src/discord-client.js"
import {
  ChannelDeletionEvidenceError,
  ChannelDeletionExecutionError,
  ChannelDeletionPlanChangedError,
} from "../src/errors.js"
import type {
  GatewayChannelLayoutListener,
  GatewayChannelLayoutSnapshot,
  GatewayChannelLayoutSource,
  GatewayChannelLayoutStatus,
} from "../src/gateway-channel-layout.js"
import type {
  OperationKind,
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  DiscordThreadList,
} from "../src/types.js"

const APPLICATION_ID = "810000000000000001"
const BOT_ID = "820000000000000001"
const GUILD_ID = "830000000000000001"
const UNCERTAIN_GUILD_ID = "830000000000000099"
const OWNER_ID = "830000000000000002"
const CATEGORY_ID = "840000000000000001"
const TARGET_CHANNEL_ID = "840000000000000002"
const OTHER_CHANNEL_ID = "840000000000000003"
const CHILD_CHANNEL_ID = "840000000000000004"
const BOT_ROLE_ID = "850000000000000001"
const OPERATION_KEY = "channel-deletion-operation-001"
const PLAN_KEY = new Uint8Array(32).fill(23)

function role(
  id: string,
  name: string,
  permissions: bigint,
  position: number,
  overrides: Partial<DiscordRole> = {},
): DiscordRole {
  return {
    color: 0,
    colors: {
      primary_color: 0,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: false,
    icon: null,
    id,
    managed: false,
    mentionable: false,
    name,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
    ...overrides,
  }
}

function channel(
  id: string,
  name: string,
  type: number,
  position: number,
  parentId: string | null,
  guildId = GUILD_ID,
): DiscordChannel {
  return {
    guild_id: guildId,
    id,
    last_message_id: null,
    name,
    parent_id: parentId,
    permission_overwrites: [],
    position,
    type,
  }
}

function layoutSnapshot(
  channels: readonly DiscordChannel[],
  guildId: string,
  revision = 1,
): GatewayChannelLayoutSnapshot {
  return {
    channels: channels.map((entry) => ({
      channelId: entry.id,
      obfuscated: false,
      parentChannelId: entry.parent_id ?? null,
      position: entry.position ?? 0,
      type: entry.type,
    })),
    complete: true,
    guildId,
    reason: null,
    revision,
    schemaVersion: SCHEMA_VERSION,
    state: "ready",
    updatedAt: new Date(Date.UTC(2026, 7, 23, 12, 0, revision)).toISOString(),
  }
}

class FixtureLayoutSource implements GatewayChannelLayoutSource {
  layoutEnabled = true
  readonly listeners = new Set<GatewayChannelLayoutListener>()
  snapshot: GatewayChannelLayoutSnapshot

  constructor(channels: readonly DiscordChannel[], guildId: string) {
    this.snapshot = layoutSnapshot(channels, guildId)
  }

  getChannelLayout(guildId: string): GatewayChannelLayoutSnapshot {
    if (guildId !== this.snapshot.guildId) {
      return {
        channels: [],
        complete: false,
        guildId,
        reason: "outside-scope",
        revision: 0,
        schemaVersion: SCHEMA_VERSION,
        state: "unavailable",
        updatedAt: null,
      }
    }
    return structuredClone(this.snapshot)
  }

  getChannelLayoutStatus(): GatewayChannelLayoutStatus {
    return {
      channels: {
        obfuscated: this.snapshot.channels.filter((entry) => entry.obfuscated).length,
        retained: this.snapshot.channels.length,
      },
      enabled: this.layoutEnabled,
      guilds: {
        invalidated: 0,
        pending: 0,
        ready: 1,
        resuming: 0,
        scoped: 1,
        unavailable: 0,
      },
      invalidations: 0,
      schemaVersion: SCHEMA_VERSION,
      updates: this.snapshot.revision,
    }
  }

  publish(snapshot: GatewayChannelLayoutSnapshot): void {
    this.snapshot = structuredClone(snapshot)
    for (const listener of this.listeners) listener(snapshot.guildId)
  }

  subscribeChannelLayouts(listener: GatewayChannelLayoutListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

class MemoryActivityStore implements ActivityStore {
  readonly entries: ActivityEntry[] = []
  failAt: number | null = null

  async append(entry: ActivityEntry): Promise<void> {
    if (this.failAt === this.entries.length + 1) throw new Error("activity unavailable")
    this.entries.push(structuredClone(entry))
  }

  async list(): Promise<ActivityList> {
    return {
      entries: structuredClone(this.entries),
      file: "/private/activity.jsonl",
      skippedLines: 0,
    }
  }
}

class MemoryOperationStore implements OperationStore {
  readonly receipts = new Map<string, OperationReceipt>()
  reserveCalls = 0

  #key(kind: OperationKind, operationKeyHash: string): string {
    return `${kind}:${operationKeyHash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), structuredClone(receipt))
  }

  async get(
    kind: OperationReceipt["kind"],
    operationKeyHash: string,
  ): Promise<OperationReceipt | undefined> {
    const receipt = this.receipts.get(this.#key(kind, operationKeyHash))
    return receipt ? structuredClone(receipt) : undefined
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.reserveCalls += 1
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: structuredClone(existing) }
    this.receipts.set(key, structuredClone(receipt))
    return { created: true, receipt: structuredClone(receipt) }
  }
}

class FixtureClient implements ChannelDeletionServiceClient {
  activeThreads: DiscordThreadList = { members: [], threads: [] }
  channels: DiscordChannel[]
  deleteCalls: Array<{ auditReason: string; channelId: string }> = []
  deleteError: unknown
  deletedResponse: DiscordChannel | null = null
  guild: DiscordGuild
  invites: DiscordInviteSummary[] = []
  member: DiscordGuildMember
  privateArchivedThreads: DiscordThreadList = { has_more: false, threads: [] }
  publicArchivedThreads: DiscordThreadList = { has_more: false, threads: [] }
  publishDeletion = true
  roles: DiscordRole[]
  source: FixtureLayoutSource
  widget: DiscordGuildWidgetSettings = {
    channelId: null,
    enabled: false,
    unknownFieldCount: 0,
  }

  constructor(guildId = GUILD_ID) {
    this.channels = [
      channel(CATEGORY_ID, "Archive", DISCORD_CHANNEL_TYPES.category, 0, null, guildId),
      channel(TARGET_CHANNEL_ID, "Retire me", DISCORD_CHANNEL_TYPES.text, 1, CATEGORY_ID, guildId),
      channel(OTHER_CHANNEL_ID, "Keep me", DISCORD_CHANNEL_TYPES.voice, 2, CATEGORY_ID, guildId),
    ]
    this.source = new FixtureLayoutSource(this.channels, guildId)
    this.guild = {
      afk_channel_id: null,
      features: [],
      id: guildId,
      name: "Private guild",
      owner_id: OWNER_ID,
      public_updates_channel_id: null,
      rules_channel_id: null,
      safety_alerts_channel_id: null,
      system_channel_id: null,
      widget_channel_id: null,
    }
    this.member = {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    }
    const required = DISCORD_PERMISSIONS.VIEW_CHANNEL
      | DISCORD_PERMISSIONS.MANAGE_CHANNELS
      | DISCORD_PERMISSIONS.MANAGE_GUILD
      | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
      | DISCORD_PERMISSIONS.MANAGE_THREADS
      | DISCORD_PERMISSIONS.MANAGE_WEBHOOKS
    this.roles = [
      role(guildId, "@everyone", 0n, 0),
      role(BOT_ROLE_ID, "connector", required, 1, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ]
  }

  async deleteGuildChannel(channelId: string, auditReason: string) {
    this.deleteCalls.push({ auditReason, channelId })
    if (this.deleteError) throw this.deleteError
    const target = this.channels.find((entry) => entry.id === channelId)
    assert.ok(target)
    if (this.publishDeletion) {
      this.channels = this.channels.filter((entry) => entry.id !== channelId)
      this.source.publish(layoutSnapshot(
        this.channels,
        this.guild.id,
        this.source.snapshot.revision + 1,
      ))
    }
    return structuredClone(this.deletedResponse ?? target)
  }

  async getGuild() {
    return structuredClone(this.guild)
  }

  async getGuildChannels() {
    return structuredClone(this.channels)
  }

  async getGuildMember() {
    return structuredClone(this.member)
  }

  async getGuildOnboarding(): Promise<DiscordGuildOnboarding> {
    return {
      defaultChannelIds: [],
      enabled: false,
      guildId: this.guild.id,
      mode: 0,
      prompts: [],
      unknownEnumCount: 0,
      unknownFieldCount: 0,
    }
  }

  async getGuildRoles() {
    return structuredClone(this.roles)
  }

  async getGuildWelcomeScreen() {
    return null
  }

  async getGuildWidgetSettings() {
    return structuredClone(this.widget)
  }

  async getStageInstance(): Promise<never> {
    throw new Error("unexpected Stage lookup")
  }

  async listActiveGuildThreads() {
    return structuredClone(this.activeThreads)
  }

  async listChannelWebhooks() {
    return []
  }

  async listGuildAutoModerationRules() {
    return []
  }

  async listGuildInvites() {
    return structuredClone(this.invites)
  }

  async listGuildScheduledEvents() {
    return []
  }

  async listPrivateArchivedThreads() {
    return structuredClone(this.privateArchivedThreads)
  }

  async listPublicArchivedThreads() {
    return structuredClone(this.publicArchivedThreads)
  }
}

function policy(guildId = GUILD_ID, audit = true, changes = true) {
  return new ScopePolicy({
    adminGuildIds: new Set<string>(),
    allowedChannelIds: new Set([TARGET_CHANNEL_ID]),
    allowedGuildIds: new Set([guildId]),
    allowAdministration: false,
    allowChannelDeletionAudit: audit,
    allowChannelDeletions: changes,
    allowDeletions: false,
    allowInteractions: false,
    channelDeletionIds: new Set([TARGET_CHANNEL_ID]),
    deleteChannelIds: new Set<string>(),
    interactionChannelIds: new Set<string>(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set<string>(),
    protectedUserIds: new Set<string>(),
  })
}

function request(
  overrides: Partial<ChannelDeletionRequest> = {},
): ChannelDeletionRequest {
  return {
    acknowledgeIrreversibleContentLoss: true,
    auditReason: "Reviewed channel retirement",
    channelId: TARGET_CHANNEL_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function fixture(options: {
  client?: FixtureClient
  policy?: ScopePolicy
  verificationTimeoutMs?: number
} = {}) {
  const activityStore = new MemoryActivityStore()
  const client = options.client ?? new FixtureClient()
  const operationStore = new MemoryOperationStore()
  const service = new ChannelDeletionService({
    activityStore,
    client,
    clock: () => new Date("2026-08-23T12:00:00.000Z"),
    layoutSource: client.source,
    operationStore,
    planKey: PLAN_KEY,
    policy: options.policy ?? policy(client.guild.id),
    randomId: () => "activity-channel-deletion-001",
    verificationTimeoutMs: options.verificationTimeoutMs ?? 20,
  })
  return { activityStore, client, operationStore, service }
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof ChannelDeletionExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("channel-deletion request normalization requires exact irreversible acknowledgement", () => {
  const normalized = normalizeChannelDeletionRequest(request())

  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.doesNotMatch(normalized.operationKeyHash, new RegExp(OPERATION_KEY))
  assert.throws(
    () => normalizeChannelDeletionRequest({ ...request(), future: true } as never),
    /exact acknowledged object/,
  )
  assert.throws(
    () => normalizeChannelDeletionRequest({
      ...request(),
      acknowledgeIrreversibleContentLoss: false,
    } as never),
    /exact acknowledged object/,
  )
})

test("channel-deletion readiness and plan bind complete content-free evidence", async () => {
  const target = fixture()

  const readiness = await target.service.audit(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    TARGET_CHANNEL_ID,
  )
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(readiness.status, "ready")
  assert.equal(readiness.ready, true)
  assert.equal(readiness.httpEvidenceMode, "complete")
  assert.equal(readiness.permission.guildManageGuild, true)
  assert.equal(readiness.target.kind, "text")
  assert.equal(readiness.target.lastMessagePresent, false)
  assert.deepEqual(readiness.blockers, [])
  assert.match(readiness.evidenceDigest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(plan.status, "planned")
  assert.equal(plan.writeRequired, true)
  assert.equal(plan.acknowledgeIrreversibleContentLoss, true)
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)
  assert.equal(JSON.stringify(plan).includes("permission_overwrites"), false)
})

test("channel-deletion discloses unavailable voice occupancy evidence", async () => {
  const client = new FixtureClient()
  const selected = client.channels.find((entry) => entry.id === TARGET_CHANNEL_ID)
  assert.ok(selected)
  selected.type = DISCORD_CHANNEL_TYPES.voice
  client.source.snapshot = layoutSnapshot(client.channels, GUILD_ID)
  const target = fixture({ client })

  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.target.kind, "voice")
  assert.ok(plan.privacy.omittedFields.includes("voiceOccupancy"))
  assert.ok(plan.warnings.some((warning) => warning.includes(
    "verify that the target is empty in Discord",
  )))
})

test("channel-deletion returns reviewable blockers without reserving or mutating", async () => {
  const target = fixture()
  target.client.invites = [{
    channelId: TARGET_CHANNEL_ID,
    code: "private-invite-code",
    createdAt: "2026-08-23T00:00:00.000Z",
    expiresAt: null,
    flags: 0,
    guildId: GUILD_ID,
    inviterUserId: null,
    maxAge: 0,
    maxUses: 0,
    roleIds: [],
    targetApplicationId: null,
    targetType: null,
    targetUserId: null,
    temporary: false,
    type: 0,
    uses: 0,
  }]

  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(plan.status, "blocked")
  assert.deepEqual(plan.blockers, [{ count: 1, kind: "invite" }])
  assert.equal(JSON.stringify(plan).includes("private-invite-code"), false)
  assert.equal(result.status, "blocked")
  assert.equal(result.activityId, null)
  assert.equal(target.operationStore.reserveCalls, 0)
  assert.equal(target.client.deleteCalls.length, 0)
})

test("channel-deletion blocks nonempty categories and unsupported channel types", async () => {
  const categoryClient = new FixtureClient()
  const targetChannel = categoryClient.channels.find((entry) => entry.id === TARGET_CHANNEL_ID)
  assert.ok(targetChannel)
  targetChannel.type = DISCORD_CHANNEL_TYPES.category
  targetChannel.parent_id = null
  categoryClient.channels.push(channel(
    CHILD_CHANNEL_ID,
    "Child",
    DISCORD_CHANNEL_TYPES.text,
    0,
    TARGET_CHANNEL_ID,
  ))
  categoryClient.source.snapshot = layoutSnapshot(categoryClient.channels, GUILD_ID)
  const category = fixture({ client: categoryClient })

  const plan = await category.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.deepEqual(plan.blockers, [{ count: 1, kind: "category-child" }])

  const announcementClient = new FixtureClient()
  const announcement = announcementClient.channels.find((entry) => entry.id === TARGET_CHANNEL_ID)
  assert.ok(announcement)
  announcement.type = DISCORD_CHANNEL_TYPES.announcement
  announcementClient.source.snapshot = layoutSnapshot(announcementClient.channels, GUILD_ID)
  await assert.rejects(
    fixture({ client: announcementClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    ChannelDeletionEvidenceError,
  )
})

test("channel-deletion fails closed on incomplete permission and thread evidence", async () => {
  const permissionClient = new FixtureClient()
  permissionClient.roles[1] = role(
    BOT_ROLE_ID,
    "connector",
    DISCORD_PERMISSIONS.VIEW_CHANNEL,
    1,
    { managed: true, tags: { bot_id: BOT_ID } },
  )
  await assert.rejects(
    fixture({ client: permissionClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /MANAGE_GUILD/,
  )

  const threadClient = new FixtureClient()
  threadClient.publicArchivedThreads = { has_more: true, threads: [] }
  await assert.rejects(
    fixture({ client: threadClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /incomplete empty public archived-thread inventory evidence/,
  )

  const wrongParentClient = new FixtureClient()
  wrongParentClient.publicArchivedThreads = {
    has_more: false,
    threads: [{
      guild_id: GUILD_ID,
      id: CHILD_CHANNEL_ID,
      parent_id: OTHER_CHANNEL_ID,
      type: DISCORD_CHANNEL_TYPES.publicThread,
    }],
  }
  await assert.rejects(
    fixture({ client: wrongParentClient }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /another channel's public archived-thread inventory evidence/,
  )

  const futureTargetClient = new FixtureClient()
  const futureTarget = futureTargetClient.channels.find((entry) => (
    entry.id === TARGET_CHANNEL_ID
  )) as DiscordChannel & { future_dependency?: string }
  futureTarget.future_dependency = OTHER_CHANNEL_ID
  futureTargetClient.source.snapshot = layoutSnapshot(futureTargetClient.channels, GUILD_ID)
  await assert.rejects(
    fixture({ client: futureTargetClient }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /invalid or unsupported channel-deletion target evidence/,
  )

  const futureRoleClient = new FixtureClient()
  futureRoleClient.roles[1] = {
    ...futureRoleClient.roles[1],
    future_permission_scope: true,
  } as DiscordRole
  await assert.rejects(
    fixture({ client: futureRoleClient }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /unknown channel-deletion role evidence/,
  )

  const futurePermissionClient = new FixtureClient()
  const futurePermissionTarget = futurePermissionClient.channels.find((entry) => (
    entry.id === TARGET_CHANNEL_ID
  ))
  assert.ok(futurePermissionTarget)
  futurePermissionTarget.permission_overwrites = [{
    allow: (1n << 100n).toString(),
    deny: "0",
    id: GUILD_ID,
    type: 0,
  }]
  await assert.rejects(
    fixture({ client: futurePermissionClient }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /permission evidence contains unknown bits/,
  )

  const futureWidgetClient = new FixtureClient()
  futureWidgetClient.widget.unknownFieldCount = 1
  await assert.rejects(
    fixture({ client: futureWidgetClient }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    /unknown widget dependency evidence/,
  )
})

test("channel-deletion rejects a stale reviewed plan before mutation", async () => {
  const target = fixture()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())
  target.client.widget = {
    channelId: TARGET_CHANNEL_ID,
    enabled: true,
    unknownFieldCount: 0,
  }

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    ChannelDeletionPlanChangedError,
  )
  assert.equal(target.client.deleteCalls.length, 0)
  assert.equal(target.operationStore.reserveCalls, 0)
})

test("channel-deletion records pending evidence, mutates once, and proves absence", async () => {
  const target = fixture()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())

  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.equal(result.observedLayoutRevision, 2)
  assert.equal(result.observedChannelCount, 2)
  assert.deepEqual(target.client.deleteCalls, [{
    auditReason: "Reviewed channel retirement",
    channelId: TARGET_CHANNEL_ID,
  }])
  assert.deepEqual(target.activityStore.entries.map((entry) => (
    "status" in entry ? entry.status : null
  )), ["pending", "completed"])
  const receipt = [...target.operationStore.receipts.values()][0]
  assert.equal(receipt?.kind, "channel-deletion")
  assert.equal(receipt?.resourceId, TARGET_CHANNEL_ID)
  assert.equal(receipt?.verification, "match")
})

test("channel-deletion blocks mutation when pending activity cannot be recorded", async () => {
  const target = fixture()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request())
  target.activityStore.failAt = 1

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert.equal(executionResult(error).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(target.client.deleteCalls.length, 0)
  const receipt = [...target.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "failed")
})

test("channel-deletion quarantines an accepted response mismatch", async () => {
  const client = new FixtureClient(UNCERTAIN_GUILD_ID)
  const target = fixture({
    client,
    policy: policy(UNCERTAIN_GUILD_ID),
  })
  const selected = client.channels.find((entry) => entry.id === TARGET_CHANNEL_ID)
  assert.ok(selected)
  client.deletedResponse = {
    ...selected,
    name: "Changed before deletion",
  }
  const uncertainRequest = request({ guildId: UNCERTAIN_GUILD_ID })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, uncertainRequest)

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, uncertainRequest, plan.digest),
    (error: unknown) => {
      assert.equal(executionResult(error).status, "uncertain")
      return true
    },
  )
  assert.equal(target.client.deleteCalls.length, 1)

  await assert.rejects(
    target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request({
        guildId: UNCERTAIN_GUILD_ID,
        operationKey: "channel-deletion-operation-002",
      }),
      plan.digest,
    ),
    (error: unknown) => {
      assert.equal(executionResult(error).status, "blocked-prior-uncertain")
      return true
    },
  )
})
