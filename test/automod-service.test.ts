import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  autoModerationRequestDigest,
  AutoModerationService,
  normalizeAutoModerationChangeRequest,
  type AutoModerationChangeRequest,
  type AutoModerationServiceOptions,
} from "../src/automod-service.js"
import {
  DISCORD_AUTO_MODERATION_ACTION_TYPES,
  DISCORD_AUTO_MODERATION_EVENT_TYPES,
  DISCORD_AUTO_MODERATION_TRIGGER_TYPES,
  type DiscordAutoModerationRuleSummary,
} from "../src/discord-client.js"
import {
  AutoModerationExecutionError,
  AutoModerationOperationConflictError,
  AutoModerationPlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { OPERATION_KEY_HASH_PATTERN } from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import { REVIEWED_PLAN_DIGEST_PATTERN } from "../src/reviewed-plan.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OTHER_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const OWNER_ID = "300000000000000002"
const BOT_ROLE_ID = "400000000000000001"
const EXEMPT_ROLE_ID = "400000000000000002"
const ALERT_CHANNEL_ID = "500000000000000001"
const EXEMPT_CHANNEL_ID = "500000000000000002"
const RULE_ID = "600000000000000001"
const CREATED_RULE_ID = "600000000000000099"
const AUDIT_REASON = "Reviewed AutoMod policy change"
const OPERATION_KEY = "automod-operation-key-0001"
const NOW = "2026-08-21T12:00:00.000Z"

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: id === BOT_ROLE_ID,
    name: id === GUILD_ID ? "@everyone" : `role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(
  id: string,
  type = 0,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: `channel-${id}`,
    permission_overwrites: [],
    type,
    ...overrides,
  }
}

function keywordRule(
  overrides: Partial<DiscordAutoModerationRuleSummary> = {},
): DiscordAutoModerationRuleSummary {
  return {
    actions: [{
      customMessage: "Private custom response",
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
    }, {
      channelId: ALERT_CHANNEL_ID,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage,
    }],
    creatorUserId: BOT_ID,
    enabled: false,
    eventType: DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
    exemptChannelIds: [EXEMPT_CHANNEL_ID],
    exemptRoleIds: [EXEMPT_ROLE_ID],
    guildId: GUILD_ID,
    id: RULE_ID,
    name: "Private policy name",
    trigger: {
      allowList: ["private allow value"],
      keywordFilter: ["private blocked value"],
      regexPatterns: ["^private-regex$"],
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword,
    },
    ...overrides,
  }
}

function createRequest(
  overrides: Partial<AutoModerationChangeRequest> = {},
): AutoModerationChangeRequest {
  return {
    action: "create",
    actions: [{
      customMessage: "Private create response",
      type: "block-message",
    }, {
      channelId: ALERT_CHANNEL_ID,
      type: "send-alert-message",
    }, {
      durationSeconds: 300,
      type: "timeout",
    }],
    auditReason: AUDIT_REASON,
    exemptChannelIds: [EXEMPT_CHANNEL_ID],
    exemptRoleIds: [EXEMPT_ROLE_ID],
    guildId: GUILD_ID,
    name: "Private create policy",
    operationKey: OPERATION_KEY,
    trigger: {
      allowList: ["private create allow"],
      keywordFilter: ["private create block"],
      regexPatterns: ["^private-create-regex$"],
      type: "keyword",
    },
    ...overrides,
  } as AutoModerationChangeRequest
}

function updateRequest(
  overrides: Partial<AutoModerationChangeRequest> = {},
): AutoModerationChangeRequest {
  return {
    action: "update",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    name: "Private updated policy",
    operationKey: OPERATION_KEY,
    ruleId: RULE_ID,
    ...overrides,
  } as AutoModerationChangeRequest
}

function policy(options: {
  alertChannelIds?: readonly string[]
  audit?: boolean
  changes?: boolean
  guildIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([ALERT_CHANNEL_ID, EXEMPT_CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowAutomodAudit: options.audit ?? true,
    allowAutomodChanges: options.changes ?? true,
    allowDeletions: false,
    allowInteractions: false,
    automodAlertChannelIds: new Set(options.alertChannelIds || [ALERT_CHANNEL_ID]),
    automodGuildIds: new Set(options.guildIds || [GUILD_ID]),
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

class MemoryOperationStore implements OperationStore {
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()
  finishFailure: unknown = null

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
  driftReadback: boolean
  guildId: string
  guildName: string
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  ownerId: string
  preserveDeletion: boolean
  readbackError: unknown
  roles: DiscordRole[]
  rules: DiscordAutoModerationRuleSummary[]
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
  verificationKey?: Uint8Array
} = {}) {
  const permissions = DISCORD_PERMISSIONS.MANAGE_GUILD
    | DISCORD_PERMISSIONS.MODERATE_MEMBERS
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: [
      channel(ALERT_CHANNEL_ID),
      channel(EXEMPT_CHANNEL_ID),
    ],
    driftReadback: false,
    guildId: GUILD_ID,
    guildName: "Private guild name",
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    ownerId: OWNER_ID,
    preserveDeletion: false,
    readbackError: undefined,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, permissions, 10),
      role(EXEMPT_ROLE_ID, 0n, 5),
    ],
    rules: [keywordRule()],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutationCompleted = false
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) {
        throw new Error("activity unavailable")
      }
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(events)
  const mutate = async (event: string) => {
    events.push(event)
    state.mutationStarted?.()
    if (state.mutationGate) await state.mutationGate
    if (state.mutationError) throw state.mutationError
    mutationCompleted = true
  }
  const readback = () => {
    if (mutationCompleted && state.readbackError) throw state.readbackError
  }
  const client: AutoModerationServiceOptions["client"] = {
    async createGuildAutoModerationRule(_guildId, input) {
      await mutate("write:create")
      const created: DiscordAutoModerationRuleSummary = {
        actions: [...input.actions],
        creatorUserId: BOT_ID,
        enabled: false,
        eventType: input.trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile
          ? DISCORD_AUTO_MODERATION_EVENT_TYPES.memberUpdate
          : DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
        exemptChannelIds: [...input.exemptChannelIds],
        exemptRoleIds: [...input.exemptRoleIds],
        guildId: GUILD_ID,
        id: CREATED_RULE_ID,
        name: input.name,
        trigger: input.trigger,
      }
      state.rules.push(created)
      return created
    },
    async deleteGuildAutoModerationRule(_guildId, ruleId) {
      await mutate("write:delete")
      if (!state.preserveDeletion) {
        state.rules = state.rules.filter((rule) => rule.id !== ruleId)
      }
    },
    async getGuild() {
      events.push("read:guild")
      return {
        id: state.guildId,
        name: state.guildName,
        owner_id: state.ownerId,
      }
    },
    async getGuildAutoModerationRule(_guildId, ruleId) {
      events.push(mutationCompleted ? "read:rule:readback" : "read:rule:get")
      readback()
      const found = state.rules.find((rule) => rule.id === ruleId)
      if (!found) {
        throw new DiscordApiError({
          message: "Unknown AutoMod rule",
          method: "GET",
          route: "/guilds/:guildId/auto-moderation/rules/:ruleId",
          status: 404,
        })
      }
      return found
    },
    async getGuildChannels() {
      events.push("read:channels")
      return state.channels
    },
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async listGuildAutoModerationRules() {
      events.push(mutationCompleted ? "read:rules:readback" : "read:rules:list")
      readback()
      return state.rules
    },
    async modifyGuildAutoModerationRule(_guildId, ruleId, input) {
      await mutate("write:modify")
      const index = state.rules.findIndex((rule) => rule.id === ruleId)
      const existing = state.rules[index]
      if (!existing) throw new Error("rule absent")
      const updated: DiscordAutoModerationRuleSummary = {
        ...existing,
        ...(input.actions === undefined ? {} : { actions: [...input.actions] }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.exemptChannelIds === undefined
          ? {}
          : { exemptChannelIds: [...input.exemptChannelIds] }),
        ...(input.exemptRoleIds === undefined
          ? {}
          : { exemptRoleIds: [...input.exemptRoleIds] }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
      }
      if (state.driftReadback) updated.name = "Discord-normalized drift"
      state.rules[index] = updated
      return updated
    },
  }
  const service = new AutoModerationService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: Buffer.alloc(32, 11),
    policy: options.policy || policy(),
    randomId: () => "automod-activity-0001",
    ...(options.verificationKey === undefined
      ? {}
      : { verificationKey: options.verificationKey }),
  })
  return {
    activities,
    activityStore,
    client,
    events,
    operationStore,
    service,
    state,
  }
}

test("AutoMod normalization canonicalizes closed policy unions without retaining raw keys", () => {
  const normalized = normalizeAutoModerationChangeRequest(createRequest({
    actions: [{ type: "timeout", durationSeconds: 60 }, {
      type: "block-message",
      customMessage: "Review this message",
    }],
    exemptChannelIds: [EXEMPT_CHANNEL_ID, ALERT_CHANNEL_ID],
    exemptRoleIds: [EXEMPT_ROLE_ID, BOT_ROLE_ID],
    trigger: {
      allowList: ["z", "a"],
      keywordFilter: ["z", "a"],
      regexPatterns: ["z", "a"],
      type: "keyword",
    },
  }))
  if (normalized.action !== "create") throw new Error("Expected normalized create")

  assert.deepEqual(normalized.actions.map(({ type }) => type), [
    "block-message",
    "timeout",
  ])
  assert.deepEqual(normalized.exemptChannelIds, [ALERT_CHANNEL_ID, EXEMPT_CHANNEL_ID])
  assert.deepEqual(normalized.exemptRoleIds, [BOT_ROLE_ID, EXEMPT_ROLE_ID])
  assert.deepEqual(normalized.trigger, {
    allowList: ["a", "z"],
    keywordFilter: ["a", "z"],
    regexPatterns: ["a", "z"],
    type: "keyword",
  })
  assert.equal("operationKey" in normalized, false)
  assert.match(normalized.operationKeyHash, OPERATION_KEY_HASH_PATTERN)

  assert.throws(
    () => normalizeAutoModerationChangeRequest(createRequest({
      actions: [{
        channelId: ALERT_CHANNEL_ID,
        customMessage: "Review this message",
        type: "block-message",
      } as never],
      trigger: { type: "spam" },
    })),
    /block-message action fields are invalid/,
  )
  assert.throws(
    () => normalizeAutoModerationChangeRequest(createRequest({
      actions: [{ type: "timeout", durationSeconds: 60 }],
      trigger: { type: "spam" },
    })),
    /timeout is incompatible/,
  )
  assert.throws(
    () => normalizeAutoModerationChangeRequest({
      action: "update",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: OPERATION_KEY,
      ruleId: RULE_ID,
    }),
    /at least one change|supported changes/,
  )
})

test("AutoMod reads separate summary inventory from exact transient policy review", async () => {
  const { service } = fixture()

  const inventory = await service.list(BOT_ID, GUILD_ID)
  const exact = await service.get(BOT_ID, GUILD_ID, RULE_ID)

  assert.equal(inventory.rules.length, 1)
  assert.deepEqual(inventory.rules[0]?.policyEntryCounts, {
    allowList: 1,
    keywordFilter: 1,
    presets: 0,
    regexPatterns: 1,
  })
  assert.equal(inventory.rules[0]?.references.healthy, true)
  assert.equal(JSON.stringify(inventory).includes("private blocked value"), false)
  assert.equal(JSON.stringify(inventory).includes("Private custom response"), false)
  assert.equal(JSON.stringify(inventory).includes(ALERT_CHANNEL_ID), false)
  assert.equal(JSON.stringify(inventory).includes(EXEMPT_CHANNEL_ID), false)
  assert.equal(JSON.stringify(inventory).includes(EXEMPT_ROLE_ID), false)
  assert.equal(exact.rule.trigger.type, "keyword")
  assert.equal(JSON.stringify(exact).includes("private blocked value"), true)
  assert.deepEqual(exact.privacy, {
    actionExecutionEventsExposed: false,
    omittedFields: [
      "actionExecutionContent",
      "matchedContent",
      "matchedKeyword",
      "rawDiscordObject",
    ],
    policyContentPersisted: false,
  })
})

test("AutoMod planning binds disabled creation, capacity, references, and conditional permissions", async () => {
  const { service } = fixture()
  const request = createRequest()

  const first = await service.plan(APPLICATION_ID, BOT_ID, request)
  const second = await service.plan(APPLICATION_ID, BOT_ID, request)

  assert.equal(first.digest, second.digest)
  assert.equal(first.desired?.enabled, false)
  assert.equal(first.effect, "create")
  assert.equal(first.capacity?.limitForTrigger, 6)
  assert.equal(first.capacity?.observedForTrigger, 1)
  assert.equal(first.references.desired?.healthy, true)
  assert.deepEqual(first.permission.requiredPermissions, [
    "MANAGE_GUILD",
    "MODERATE_MEMBERS",
  ])
  assert.equal(JSON.stringify(first).includes(OPERATION_KEY), false)
  assert.match(first.digest, REVIEWED_PLAN_DIGEST_PATTERN)
  assert.match(first.operationKeyHash, OPERATION_KEY_HASH_PATTERN)
  assert.match(first.warnings.join(" "), /created disabled/)
})

test("AutoMod planning fails closed on unsafe lifecycle, capacity, references, and permissions", async () => {
  const enabled = fixture({
    state: { rules: [keywordRule({ enabled: true })] },
  })
  await assert.rejects(
    () => enabled.service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    /must be disabled.*before editing/,
  )
  await assert.rejects(
    () => enabled.service.plan(APPLICATION_ID, BOT_ID, {
      action: "delete",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      operationKey: "automod-delete-enabled-0001",
      ruleId: RULE_ID,
    }),
    /must be disabled.*before deletion/,
  )

  const immutable = fixture()
  await assert.rejects(
    () => immutable.service.plan(APPLICATION_ID, BOT_ID, updateRequest({
      trigger: { type: "spam" },
    })),
    /trigger type is immutable/,
  )

  const capacity = fixture({
    state: {
      rules: [keywordRule({
        actions: [{
          customMessage: null,
          type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
        }],
        trigger: { type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam },
      })],
    },
  })
  await assert.rejects(
    () => capacity.service.plan(APPLICATION_ID, BOT_ID, createRequest({
      actions: [{ type: "block-message" }],
      operationKey: "automod-capacity-0001",
      trigger: { type: "spam" },
    })),
    /capacity is exhausted/,
  )

  const disallowedAlert = fixture({
    policy: policy({ alertChannelIds: [] }),
  })
  await assert.rejects(
    () => disallowedAlert.service.plan(APPLICATION_ID, BOT_ID, createRequest()),
    /must be an existing allowlisted visible text or announcement channel/,
  )

  const missingModerate = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(
          BOT_ROLE_ID,
          DISCORD_PERMISSIONS.MANAGE_GUILD | DISCORD_PERMISSIONS.VIEW_CHANNEL,
          10,
        ),
        role(EXEMPT_ROLE_ID, 0n, 5),
      ],
    },
  })
  await assert.rejects(
    () => missingModerate.service.plan(APPLICATION_ID, BOT_ID, createRequest()),
    /MODERATE_MEMBERS/,
  )

  const mismatchedChannel = fixture({
    state: {
      channels: [
        channel(ALERT_CHANNEL_ID, 0, { guild_id: OTHER_GUILD_ID }),
        channel(EXEMPT_CHANNEL_ID),
      ],
    },
  })
  await assert.rejects(
    () => mismatchedChannel.service.plan(
      APPLICATION_ID,
      BOT_ID,
      createRequest({ operationKey: "automod-channel-evidence-0001" }),
    ),
    /invalid AutoMod channel inventory/,
  )
})

test("AutoMod execution journals content-free intent before one write and verifies readback", async () => {
  const { activities, events, operationStore, service } = fixture()
  const request = createRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  events.length = 0

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.ruleId, CREATED_RULE_ID)
  assert.equal(events.filter((event) => event === "write:create").length, 1)
  assert.ok(events.indexOf("operation:reserve") < events.indexOf("activity:pending"))
  assert.ok(events.indexOf("activity:pending") < events.indexOf("write:create"))
  assert.ok(events.indexOf("write:create") < events.indexOf("read:rule:readback"))
  assert.deepEqual(activities.map((entry) => entry.status), ["pending", "completed"])
  const serialized = JSON.stringify(activities)
  for (const forbidden of [
    AUDIT_REASON,
    OPERATION_KEY,
    "Private create policy",
    "Private create response",
    "private create allow",
    "private create block",
    "private-create-regex",
  ]) {
    assert.equal(serialized.includes(forbidden), false)
  }
  const receipt = await operationStore.get("automod-change", plan.operationKeyHash)
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.verification, "match")
  assert.equal(receipt?.schemaVersion, 2)
  assert.equal(receipt?.kind, "automod-change")
  if (receipt?.kind !== "automod-change") throw new Error("Expected AutoMod receipt")
  assert.match(receipt.requestDigest, REVIEWED_PLAN_DIGEST_PATTERN)
  assert.equal(JSON.stringify(receipt).includes("Private create policy"), false)
  await assert.rejects(
    () => service.plan(APPLICATION_ID, BOT_ID, request),
    AutoModerationOperationConflictError,
  )
})

test("AutoMod verification binds exact requests and receipt-bound live state", async () => {
  const verificationKey = Buffer.alloc(32, 19)
  const target = fixture({ verificationKey })
  const request = createRequest({
    operationKey: "automod-verification-operation-0001",
  })

  const absent = await target.service.verify(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  assert.deepEqual(absent, {
    action: "create",
    activityId: null,
    guildId: GUILD_ID,
    operationKeyHash: normalizeAutoModerationChangeRequest(request).operationKeyHash,
    planDigest: null,
    readbackMatched: false,
    reason: "operation-not-found",
    receiptStatus: null,
    requestMatched: false,
    ruleId: null,
    schemaVersion: 1,
    status: "not-found",
    timestamp: null,
  })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, request)
  await target.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)
  target.events.length = 0

  const verified = await target.service.verify(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  assert.equal(verified.status, "verified")
  assert.equal(verified.requestMatched, true)
  assert.equal(verified.readbackMatched, true)
  assert.equal(verified.ruleId, CREATED_RULE_ID)
  assert.equal(target.events.some((event) => event.startsWith("write:")), false)
  assert.equal(target.events.includes("operation:reserve"), false)
  assert.equal(JSON.stringify(verified).includes("Private create policy"), false)

  const createdRule = target.state.rules.find((rule) => rule.id === CREATED_RULE_ID)
  if (!createdRule) throw new Error("Expected created AutoMod rule")
  createdRule.enabled = true
  assert.equal(
    (await target.service.verify(APPLICATION_ID, BOT_ID, request)).status,
    "verified",
  )

  const mismatched = await target.service.verify(
    APPLICATION_ID,
    BOT_ID,
    createRequest({
      name: "Another private policy",
      operationKey: "automod-verification-operation-0001",
    }),
  )
  assert.equal(mismatched.status, "blocked")
  assert.equal(mismatched.reason, "request-mismatch")
  assert.equal(mismatched.requestMatched, false)

  const restarted = new AutoModerationService({
    activityStore: target.activityStore,
    client: target.client,
    operationStore: target.operationStore,
    planKey: Buffer.alloc(32, 23),
    policy: policy(),
    verificationKey,
  })
  assert.equal(
    (await restarted.verify(APPLICATION_ID, BOT_ID, request)).status,
    "verified",
  )
  const rotated = new AutoModerationService({
    activityStore: target.activityStore,
    client: target.client,
    operationStore: target.operationStore,
    planKey: Buffer.alloc(32, 29),
    policy: policy(),
    verificationKey: Buffer.alloc(32, 31),
  })
  target.events.length = 0
  const rotatedResult = await rotated.verify(APPLICATION_ID, BOT_ID, request)
  assert.equal(rotatedResult.status, "blocked")
  assert.equal(rotatedResult.reason, "request-mismatch")
  assert.deepEqual(target.events, [])

  createdRule.name = "Externally drifted policy"
  const drifted = await target.service.verify(APPLICATION_ID, BOT_ID, request)
  assert.equal(drifted.status, "drifted")
  assert.equal(drifted.reason, "rule-state-mismatch")
})

test("AutoMod verification checks partial updates and exact deletion absence", async () => {
  const updated = fixture()
  const update = updateRequest({
    operationKey: "automod-update-verification-0001",
  })
  const updatePlan = await updated.service.plan(APPLICATION_ID, BOT_ID, update)
  await updated.service.execute(APPLICATION_ID, BOT_ID, update, updatePlan.digest)
  assert.equal(
    (await updated.service.verify(APPLICATION_ID, BOT_ID, update)).status,
    "verified",
  )
  const existing = updated.state.rules.find((rule) => rule.id === RULE_ID)
  if (!existing) throw new Error("Expected updated AutoMod rule")
  existing.exemptRoleIds = []
  assert.equal(
    (await updated.service.verify(APPLICATION_ID, BOT_ID, update)).status,
    "verified",
  )
  existing.name = "Changed again"
  assert.equal(
    (await updated.service.verify(APPLICATION_ID, BOT_ID, update)).reason,
    "rule-state-mismatch",
  )

  const deleted = fixture()
  const deletion: AutoModerationChangeRequest = {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: "automod-delete-verification-0001",
    ruleId: RULE_ID,
  }
  const deletionPlan = await deleted.service.plan(
    APPLICATION_ID,
    BOT_ID,
    deletion,
  )
  await deleted.service.execute(
    APPLICATION_ID,
    BOT_ID,
    deletion,
    deletionPlan.digest,
  )
  assert.equal(
    (await deleted.service.verify(APPLICATION_ID, BOT_ID, deletion)).status,
    "verified",
  )
  deleted.state.rules.push(keywordRule())
  const present = await deleted.service.verify(APPLICATION_ID, BOT_ID, deletion)
  assert.equal(present.status, "drifted")
  assert.equal(present.reason, "rule-still-present")
})

test("AutoMod verification blocks nonterminal receipts before Discord reads", async () => {
  const verificationKey = Buffer.alloc(32, 37)
  const target = fixture({ verificationKey })
  const request = createRequest({
    operationKey: "automod-pending-verification-0001",
  })
  const normalized = normalizeAutoModerationChangeRequest(request)
  await target.operationStore.reserve({
    activityId: "automod-pending-activity-0001",
    error: null,
    guildId: GUILD_ID,
    kind: "automod-change",
    operationKeyHash: normalized.operationKeyHash,
    planDigest: `hmac-sha256:${"7".repeat(64)}`,
    requestDigest: autoModerationRequestDigest(
      verificationKey,
      APPLICATION_ID,
      BOT_ID,
      normalized,
    ),
    resourceId: null,
    schemaVersion: 2,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  target.events.length = 0

  const result = await target.service.verify(APPLICATION_ID, BOT_ID, request)

  assert.equal(result.status, "blocked")
  assert.equal(result.reason, "operation-pending")
  assert.equal(result.requestMatched, true)
  assert.deepEqual(target.events, [])
})

test("AutoMod execution returns an exact no-op without spending the operation key", async () => {
  const { events, operationStore, service } = fixture()
  const request: AutoModerationChangeRequest = {
    action: "set-enabled",
    auditReason: AUDIT_REASON,
    enabled: false,
    guildId: GUILD_ID,
    operationKey: "automod-no-op-operation-0001",
    ruleId: RULE_ID,
  }
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  events.length = 0

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(events.some((event) => event.startsWith("write:")), false)
  assert.equal(events.includes("operation:reserve"), false)
  assert.equal(
    await operationStore.get("automod-change", plan.operationKeyHash),
    undefined,
  )
})

test("AutoMod execution dispatches update, enable, and delete as separate reviewed changes", async () => {
  const update = fixture()
  const updateRequestValue = updateRequest({
    operationKey: "automod-update-operation-0001",
  })
  const updatePlan = await update.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequestValue,
  )
  const updated = await update.service.execute(
    APPLICATION_ID,
    BOT_ID,
    updateRequestValue,
    updatePlan.digest,
  )
  assert.equal(updated.status, "completed")
  assert.equal(updated.observed?.name, "Private updated policy")
  assert.equal(update.events.filter((event) => event === "write:modify").length, 1)

  const enable = fixture()
  const enableRequest: AutoModerationChangeRequest = {
    action: "set-enabled",
    auditReason: AUDIT_REASON,
    enabled: true,
    guildId: GUILD_ID,
    operationKey: "automod-enable-operation-0001",
    ruleId: RULE_ID,
  }
  const enablePlan = await enable.service.plan(
    APPLICATION_ID,
    BOT_ID,
    enableRequest,
  )
  const enabled = await enable.service.execute(
    APPLICATION_ID,
    BOT_ID,
    enableRequest,
    enablePlan.digest,
  )
  assert.equal(enabled.status, "completed")
  assert.equal(enabled.observed?.enabled, true)
  assert.equal(enable.events.filter((event) => event === "write:modify").length, 1)

  const deletion = fixture()
  const deleteRequest: AutoModerationChangeRequest = {
    action: "delete",
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: "automod-delete-operation-0001",
    ruleId: RULE_ID,
  }
  const deletePlan = await deletion.service.plan(
    APPLICATION_ID,
    BOT_ID,
    deleteRequest,
  )
  const deleted = await deletion.service.execute(
    APPLICATION_ID,
    BOT_ID,
    deleteRequest,
    deletePlan.digest,
  )
  assert.equal(deleted.status, "completed")
  assert.equal(deleted.observed, null)
  assert.equal(deletion.events.filter((event) => event === "write:delete").length, 1)
})

test("AutoMod execution rejects changed plans before reservation or mutation", async () => {
  const { events, service, state } = fixture()
  const request = updateRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  events.length = 0
  state.guildName = "Changed guild name"

  await assert.rejects(
    () => service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    AutoModerationPlanChangedError,
  )
  assert.equal(events.includes("operation:reserve"), false)
  assert.equal(events.some((event) => event.startsWith("write:")), false)
})

test("AutoMod execution distinguishes known rejection, uncertain readback, and verified drift", async () => {
  const rejected = fixture({
    state: {
      mutationError: new DiscordApiError({
        message: "Forbidden",
        method: "PATCH",
        route: "/guilds/:guildId/auto-moderation/rules/:ruleId",
        status: 403,
      }),
    },
  })
  const rejectedRequest = updateRequest({
    operationKey: "automod-rejected-operation-0001",
  })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    rejectedRequest,
  )
  await assert.rejects(
    () => rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      rejectedRequest,
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof AutoModerationExecutionError
      && (error.result as { status?: unknown }).status === "failed"
    ),
  )

  const uncertain = fixture({
    state: { readbackError: new Error("network unavailable") },
  })
  const uncertainRequest = updateRequest({
    operationKey: "automod-uncertain-operation-0001",
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
    (error: unknown) => (
      error instanceof AutoModerationExecutionError
      && (error.result as { status?: unknown }).status === "uncertain"
    ),
  )

  const drift = fixture({ state: { driftReadback: true } })
  const driftRequest = updateRequest({
    operationKey: "automod-drift-operation-0001",
  })
  const driftPlan = await drift.service.plan(
    APPLICATION_ID,
    BOT_ID,
    driftRequest,
  )
  const drifted = await drift.service.execute(
    APPLICATION_ID,
    BOT_ID,
    driftRequest,
    driftPlan.digest,
  )
  assert.equal(drifted.status, "completed-with-drift")
  assert.equal(drift.events.filter((event) => event === "write:modify").length, 1)
})

test("AutoMod execution blocks writes when pending activity cannot be recorded", async () => {
  const blocked = fixture({ state: { activityFailureAt: 1 } })
  const request = updateRequest({
    operationKey: "automod-pending-audit-failure-0001",
  })
  const plan = await blocked.service.plan(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    () => blocked.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof AutoModerationExecutionError
      && (error.result as { status?: unknown }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(blocked.events.some((event) => event.startsWith("write:")), false)
  const receipt = await blocked.operationStore.get(
    "automod-change",
    plan.operationKeyHash,
  )
  assert.equal(receipt?.status, "failed")
})

test("AutoMod execution preserves success evidence when local finalization fails", async () => {
  const receiptFailure = fixture()
  const receiptRequest = updateRequest({
    operationKey: "automod-receipt-failure-0001",
  })
  const receiptPlan = await receiptFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    receiptRequest,
  )
  receiptFailure.operationStore.finishFailure = new Error("receipt unavailable")

  await assert.rejects(
    () => receiptFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      receiptRequest,
      receiptPlan.digest,
    ),
    (error: unknown) => (
      error instanceof AutoModerationExecutionError
      && (error.result as { status?: unknown }).status
        === "completed-operation-record-failed"
      && (error.result as { activityRecordError?: unknown }).activityRecordError
        === null
    ),
  )
  assert.equal(
    receiptFailure.events.filter((event) => event === "write:modify").length,
    1,
  )
  assert.deepEqual(
    receiptFailure.activities.map((entry) => entry.status),
    ["pending", "completed"],
  )
  assert.equal(receiptFailure.activities.at(-1)?.error, "Error")

  const auditFailure = fixture({ state: { activityFailureAt: 2 } })
  const auditRequest = updateRequest({
    operationKey: "automod-final-audit-failure-0001",
  })
  const auditPlan = await auditFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    auditRequest,
  )

  await assert.rejects(
    () => auditFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      auditRequest,
      auditPlan.digest,
    ),
    (error: unknown) => (
      error instanceof AutoModerationExecutionError
      && (error.result as { status?: unknown }).status === "completed-audit-failed"
    ),
  )
  assert.equal(
    auditFailure.events.filter((event) => event === "write:modify").length,
    1,
  )
  const receipt = await auditFailure.operationStore.get(
    "automod-change",
    auditPlan.operationKeyHash,
  )
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.verification, "match")
})

test("AutoMod policy is independently gated and exact-guild scoped", async () => {
  const disabled = fixture({ policy: policy({ audit: false, changes: false }) })
  await assert.rejects(
    () => disabled.service.list(BOT_ID, GUILD_ID),
    /AutoMod audit is disabled/,
  )

  const auditOnly = fixture({ policy: policy({ changes: false }) })
  await auditOnly.service.list(BOT_ID, GUILD_ID)
  await assert.rejects(
    () => auditOnly.service.plan(APPLICATION_ID, BOT_ID, updateRequest()),
    /AutoMod changes are disabled/,
  )

  const scoped = fixture({ policy: policy({ guildIds: [OTHER_GUILD_ID] }) })
  await assert.rejects(
    () => scoped.service.list(BOT_ID, GUILD_ID),
    /outside the AutoMod scope/,
  )
})

test("AutoMod same-guild serialization permanently blocks queued work after uncertainty", async () => {
  let releaseMutation!: () => void
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let mutationStarted!: () => void
  const started = new Promise<void>((resolve) => {
    mutationStarted = resolve
  })
  const shared = fixture({
    state: {
      mutationError: new Error("transport ended during mutation"),
      mutationGate,
      mutationStarted,
    },
  })
  const firstRequest = updateRequest({
    operationKey: "automod-concurrent-operation-0001",
  })
  const secondRequest = updateRequest({
    name: "Another reviewed name",
    operationKey: "automod-concurrent-operation-0002",
  })
  const firstPlan = await shared.service.plan(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
  )
  const secondPlan = await shared.service.plan(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
  )
  const firstExecution = shared.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await started
  const secondExecution = shared.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation()

  await assert.rejects(
    () => firstExecution,
    (error: unknown) => (
      error instanceof AutoModerationExecutionError
      && (error.result as { status?: unknown }).status === "uncertain"
    ),
  )
  await assert.rejects(
    () => secondExecution,
    (error: unknown) => (
      error instanceof AutoModerationExecutionError
      && (error.result as { status?: unknown }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(shared.events.filter((event) => event === "write:modify").length, 1)
})
