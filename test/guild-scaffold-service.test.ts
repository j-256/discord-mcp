import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  ChannelAdministrationService,
  type ChannelAdministrationServiceOptions,
} from "../src/channel-administration-service.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
} from "../src/constants.js"
import {
  GuildScaffoldExecutionError,
  GuildScaffoldOperationConflictError,
} from "../src/errors.js"
import {
  GuildScaffoldService,
  normalizeGuildScaffoldRequest,
  type GuildScaffoldRequest,
} from "../src/guild-scaffold-service.js"
import type {
  OperationKind,
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { operationKeyHash } from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  RoleAdministrationService,
  type RoleAdministrationServiceOptions,
} from "../src/role-administration-service.js"
import type {
  DiscordChannel,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const OWNER_ID = "400000000000000001"
const BOT_ROLE_ID = "500000000000000001"
const CREATED_ROLE_ID = "600000000000000001"
const CREATED_CATEGORY_ID = "700000000000000001"
const CREATED_CHANNEL_ID = "800000000000000001"
const OPERATION_KEY = "guild-scaffold-operation-0001"
const NOW = "2026-08-20T00:00:00.000Z"

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

function scaffoldRequest(
  overrides: Partial<GuildScaffoldRequest> = {},
): GuildScaffoldRequest {
  return {
    auditReason: "Reviewed additive support scaffold",
    channels: [
      {
        key: "support-category",
        kind: "category",
        name: "Support",
      },
      {
        key: "support-queue",
        kind: "text",
        name: "customer-help",
        parentKey: "support-category",
        topic: "Private support queue",
      },
    ],
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    roles: [{
      key: "support-role",
      name: "Support",
      permissions: ["VIEW_CHANNEL"],
      primaryColor: 3_447_003,
    }],
    stepLimit: 10,
    ...overrides,
  }
}

function scaffoldPolicy(enabled = true): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowGuildScaffolds: enabled,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    guildScaffoldGuildIds: new Set([GUILD_ID]),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

class MemoryOperationStore implements OperationStore {
  failGuildScaffoldFinish = false
  readonly receipts = new Map<string, OperationReceipt>()

  #key(kind: OperationKind, hash: string): string {
    return `${kind}\0${hash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    if (this.failGuildScaffoldFinish && receipt.kind === "guild-scaffold") {
      throw new Error("Top scaffold receipt write failed")
    }
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const pending = this.receipts.get(key)
    assert.ok(pending)
    assert.equal(pending.status, "pending")
    assert.equal(pending.activityId, receipt.activityId)
    assert.equal(pending.planDigest, receipt.planDigest)
    this.receipts.set(key, receipt)
  }

  async get(
    kind: OperationKind,
    hash: string,
  ): Promise<OperationReceipt | undefined> {
    return this.receipts.get(this.#key(kind, hash))
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

function fixture() {
  const permissions = DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.MANAGE_ROLES
    | DISCORD_PERMISSIONS.SEND_MESSAGES
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const state = {
    botUserIsBot: true,
    channels: [] as DiscordChannel[],
    createdRolePrimaryColor: null as number | null,
    createRoleError: null as Error | null,
    getGuildRolesErrorAt: null as number | null,
    guildRolesCalls: 0,
    nextChannel: 0,
    roles: [
      role(GUILD_ID, "@everyone", 0n, 0),
      role(BOT_ROLE_ID, "connector", permissions, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ],
  }
  const activities: ActivityEntry[] = []
  const activityStore: ActivityStore = {
    async append(entry) {
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore()
  const client: ChannelAdministrationServiceOptions["client"]
    & RoleAdministrationServiceOptions["client"] = {
      async createGuildChannel(guildId, input) {
        assert.equal(guildId, GUILD_ID)
        const id = state.nextChannel++ === 0
          ? CREATED_CATEGORY_ID
          : CREATED_CHANNEL_ID
        const channel: DiscordChannel = input.type === DISCORD_CHANNEL_TYPES.category
          ? {
              guild_id: GUILD_ID,
              id,
              name: input.name,
              parent_id: null,
              permission_overwrites: [],
              position: state.channels.length,
              type: input.type,
            }
          : {
              default_auto_archive_duration: input.defaultAutoArchiveDuration ?? 1_440,
              guild_id: GUILD_ID,
              id,
              name: input.name,
              nsfw: input.nsfw ?? false,
              parent_id: input.parentId ?? null,
              permission_overwrites: [],
              position: state.channels.length,
              rate_limit_per_user: input.rateLimitPerUser ?? 0,
              topic: input.topic ?? null,
              type: input.type,
            }
        state.channels.push(channel)
        return channel
      },
      async createGuildRole(guildId, input) {
        assert.equal(guildId, GUILD_ID)
        if (state.createRoleError) throw state.createRoleError
        const primaryColor = state.createdRolePrimaryColor ?? input.primaryColor
        const created = role(
          CREATED_ROLE_ID,
          input.name,
          BigInt(input.permissions),
          1,
          {
            color: primaryColor,
            colors: {
              primary_color: primaryColor,
              secondary_color: null,
              tertiary_color: null,
            },
            hoist: input.hoist,
            mentionable: input.mentionable,
          },
        )
        state.roles.push(created)
        return created
      },
      async getChannel(channelId) {
        const channel = state.channels.find((entry) => entry.id === channelId)
        assert.ok(channel)
        return channel
      },
      async getGuild() {
        return {
          features: [],
          id: GUILD_ID,
          name: "Private Guild Name",
          owner_id: OWNER_ID,
        }
      },
      async getGuildChannels() {
        return state.channels
      },
      async getGuildMember() {
        return {
          roles: [BOT_ROLE_ID],
          user: {
            bot: state.botUserIsBot,
            id: BOT_ID,
            username: "connector",
          },
        }
      },
      async getGuildRole(_guildId, roleId) {
        const found = state.roles.find((entry) => entry.id === roleId)
        assert.ok(found)
        return found
      },
      async getGuildRoles() {
        state.guildRolesCalls += 1
        if (state.guildRolesCalls === state.getGuildRolesErrorAt) {
          throw new Error("Discord role evidence became unavailable")
        }
        return state.roles
      },
  }
  const policy = scaffoldPolicy()
  const createService = (options: {
    channelPlanKeyByte?: number
    policy?: ScopePolicy
    rolePlanKeyByte?: number
    scaffoldPlanKeyByte?: number
  } = {}) => {
    const servicePolicy = options.policy ?? policy
    const channelService = new ChannelAdministrationService({
      activityStore,
      client,
      clock: () => new Date(NOW),
      operationStore,
      planKey: Buffer.alloc(32, options.channelPlanKeyByte ?? 1),
      policy: servicePolicy,
      randomId: () => `channel-activity-${activities.length}`,
    })
    const roleService = new RoleAdministrationService({
      activityStore,
      client,
      clock: () => new Date(NOW),
      operationStore,
      planKey: Buffer.alloc(32, options.rolePlanKeyByte ?? 2),
      policy: servicePolicy,
      randomId: () => `role-activity-${activities.length}`,
    })
    return new GuildScaffoldService({
      channelService,
      client,
      clock: () => new Date(NOW),
      operationStore,
      planKey: Buffer.alloc(32, options.scaffoldPlanKeyByte ?? 3),
      policy: servicePolicy,
      randomId: () => "scaffold-operation",
      roleService,
    })
  }
  const service = createService()
  return { activities, createService, operationStore, service, state }
}

test("normalizes a canonical bounded scaffold without exposing the raw key in snapshots", () => {
  const normalized = normalizeGuildScaffoldRequest(scaffoldRequest())
  assert.deepEqual(normalized.roles.map((role) => role.key), ["support-role"])
  assert.deepEqual(
    normalized.channels.map((channel) => channel.key),
    ["support-category", "support-queue"],
  )
  assert.deepEqual(
    [...normalized.roles, ...normalized.channels].map((step) => step.index),
    [0, 1, 2],
  )
  assert.notEqual(normalized.roles[0]?.request.operationKey, OPERATION_KEY)
})

test("canonical step identities do not depend on caller array order", () => {
  const request = scaffoldRequest({
    roles: [{
      key: "support-role",
      name: "Support",
      permissions: ["VIEW_CHANNEL"],
      primaryColor: 3_447_003,
    }, {
      key: "audit-role",
      name: "Audit",
      permissions: ["READ_MESSAGE_HISTORY"],
    }],
  })
  const reordered = {
    ...request,
    channels: [...request.channels].reverse(),
    roles: [...request.roles].reverse(),
  }
  assert.deepEqual(
    normalizeGuildScaffoldRequest(request),
    normalizeGuildScaffoldRequest(reordered),
  )
})

test("rejects duplicate logical locations and invalid parent references", () => {
  assert.throws(
    () => normalizeGuildScaffoldRequest(scaffoldRequest({
      channels: [
        { key: "one", kind: "category", name: "Support Center" },
        { key: "two", kind: "category", name: "support-center" },
      ],
      roles: [],
    })),
    /logically unique/,
  )
  assert.throws(
    () => normalizeGuildScaffoldRequest(scaffoldRequest({
      channels: [
        { key: "one", kind: "category", name: "Support" },
        { key: "two", kind: "text", name: "queue", parentKey: "missing" },
      ],
      roles: [],
    })),
    /does not reference a requested category/,
  )
})

test("plans one snapshot and pauses at the new-category dependency frontier", async () => {
  const { service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, scaffoldRequest())
  assert.equal(plan.status, "planned")
  assert.deepEqual(
    plan.steps.map((step) => [step.key, step.state]),
    [
      ["support-role", "ready"],
      ["support-category", "ready"],
      ["support-queue", "waiting-for-parent"],
    ],
  )
  assert.equal(plan.counts.ready, 2)
  assert.equal(plan.counts.waitingForParent, 1)
  assert.deepEqual(plan.executionFrontier.stepIndexes, [0, 1])
})

test("executes in resumable frontiers and completes without repeating prior writes", async () => {
  const { activities, operationStore, service, state } = fixture()
  const request = scaffoldRequest()
  const firstPlan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const first = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    firstPlan.digest,
  )
  assert.equal(first.status, "paused")
  assert.deepEqual(first.executedSteps.map((step) => step.resourceId), [
    CREATED_ROLE_ID,
    CREATED_CATEGORY_ID,
  ])
  assert.equal(state.roles.length, 3)
  assert.equal(state.channels.length, 1)

  const secondPlan = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.deepEqual(
    secondPlan.steps.map((step) => [step.key, step.state]),
    [
      ["support-role", "completed"],
      ["support-category", "completed"],
      ["support-queue", "ready"],
    ],
  )
  assert.equal(secondPlan.steps[2]?.parent?.resourceId, CREATED_CATEGORY_ID)
  assert.equal(secondPlan.steps[2]?.parent?.permission?.confidence, "complete")
  assert.equal(secondPlan.steps[2]?.parent?.permission?.manageChannels, true)
  assert.equal(secondPlan.steps[2]?.parent?.permission?.viewChannel, true)
  assert.equal(
    secondPlan.steps[2]?.parent?.permission?.permissionSourceChannelId,
    CREATED_CATEGORY_ID,
  )
  const second = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    secondPlan.digest,
  )
  assert.equal(second.status, "completed")
  assert.deepEqual(second.executedSteps.map((step) => step.resourceId), [
    CREATED_CHANNEL_ID,
  ])
  assert.equal(state.roles.length, 3)
  assert.equal(state.channels.length, 2)
  assert.deepEqual(activities.map((entry) => entry.status), [
    "pending",
    "completed",
    "pending",
    "completed",
    "pending",
    "completed",
  ])

  const serializedReceipts = JSON.stringify([...operationStore.receipts.values()])
  assert.doesNotMatch(serializedReceipts, /Private support queue|Support|customer-help/)
  assert.doesNotMatch(serializedReceipts, new RegExp(OPERATION_KEY))

  const finalPlan = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(finalPlan.status, "completed")
  const replay = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    finalPlan.digest,
  )
  assert.equal(replay.status, "completed")
  assert.equal(state.roles.length, 3)
  assert.equal(state.channels.length, 2)
})

test("resumes across process-local plan-key changes and adjustable reviewed frontiers", async () => {
  const { createService, state } = fixture()
  const firstRequest = scaffoldRequest({ stepLimit: 1 })
  const firstService = createService({
    channelPlanKeyByte: 11,
    rolePlanKeyByte: 12,
    scaffoldPlanKeyByte: 13,
  })
  const firstPlan = await firstService.plan(APPLICATION_ID, BOT_ID, firstRequest)
  assert.deepEqual(firstPlan.executionFrontier.stepIndexes, [0])
  const first = await firstService.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  assert.equal(first.status, "paused")
  assert.deepEqual(first.executedSteps.map((step) => step.key), ["support-role"])

  const resumedRequest = scaffoldRequest({ stepLimit: 10 })
  const secondService = createService({
    channelPlanKeyByte: 21,
    rolePlanKeyByte: 22,
    scaffoldPlanKeyByte: 23,
  })
  const secondPlan = await secondService.plan(APPLICATION_ID, BOT_ID, resumedRequest)
  assert.equal(secondPlan.status, "resume-ready")
  assert.deepEqual(secondPlan.executionFrontier.stepIndexes, [1])
  assert.deepEqual(
    secondPlan.steps.map((step) => [step.key, step.state]),
    [
      ["support-role", "completed"],
      ["support-category", "ready"],
      ["support-queue", "waiting-for-parent"],
    ],
  )
  const second = await secondService.execute(
    APPLICATION_ID,
    BOT_ID,
    resumedRequest,
    secondPlan.digest,
  )
  assert.equal(second.status, "paused")
  assert.deepEqual(second.executedSteps.map((step) => step.key), ["support-category"])

  const thirdService = createService({
    channelPlanKeyByte: 31,
    rolePlanKeyByte: 32,
    scaffoldPlanKeyByte: 33,
  })
  const thirdPlan = await thirdService.plan(APPLICATION_ID, BOT_ID, resumedRequest)
  assert.deepEqual(
    thirdPlan.steps.map((step) => [step.key, step.state]),
    [
      ["support-role", "completed"],
      ["support-category", "completed"],
      ["support-queue", "ready"],
    ],
  )
  const third = await thirdService.execute(
    APPLICATION_ID,
    BOT_ID,
    resumedRequest,
    thirdPlan.digest,
  )
  assert.equal(third.status, "completed")
  assert.deepEqual(third.executedSteps.map((step) => step.key), ["support-queue"])
  assert.equal(state.roles.length, 3)
  assert.equal(state.channels.length, 2)
})

test("serializes concurrent resumes of the same scaffold operation", async () => {
  const { service, state } = fixture()
  const request = scaffoldRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const outcomes = await Promise.allSettled([
    service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
  ])
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled")
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected")
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(fulfilled[0]?.value.status, "paused")
  assert.match(String(rejected[0]?.reason), /does not match the reviewed scaffold plan/)
  assert.equal(state.roles.length, 3)
  assert.equal(state.channels.length, 1)
})

test("serializes shared logical targets across scaffold operation keys", async () => {
  const { service, state } = fixture()
  const firstRequest = scaffoldRequest()
  const secondRequest = scaffoldRequest({
    operationKey: "guild-scaffold-operation-0002",
  })
  const [firstPlan, secondPlan] = await Promise.all([
    service.plan(APPLICATION_ID, BOT_ID, firstRequest),
    service.plan(APPLICATION_ID, BOT_ID, secondRequest),
  ])
  const outcomes = await Promise.allSettled([
    service.execute(APPLICATION_ID, BOT_ID, firstRequest, firstPlan.digest),
    service.execute(APPLICATION_ID, BOT_ID, secondRequest, secondPlan.digest),
  ])
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  )
  const rejected = outcomes.find((outcome) => outcome.status === "rejected")
  assert.ok(rejected && rejected.status === "rejected")
  assert.ok(rejected.reason instanceof GuildScaffoldExecutionError)
  assert.equal(
    (rejected.reason.result as { status?: string }).status,
    "paused-step-prewrite",
  )
  assert.equal(state.roles.length, 3)
  assert.equal(state.channels.length, 1)
})

test("fails closed on pending and drifting durable step checkpoints", async () => {
  const pendingFixture = fixture()
  const pendingRequest = scaffoldRequest()
  const normalized = normalizeGuildScaffoldRequest(pendingRequest)
  const pendingRole = normalized.roles[0]
  assert.ok(pendingRole)
  await pendingFixture.operationStore.reserve({
    activityId: "pending-role-step",
    error: null,
    guildId: GUILD_ID,
    kind: "role-creation",
    operationKeyHash: operationKeyHash(pendingRole.request.operationKey),
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    pendingFixture.service.plan(APPLICATION_ID, BOT_ID, pendingRequest),
    /incomplete or drifting checkpoint/,
  )

  const driftFixture = fixture()
  const driftRequest = scaffoldRequest({ stepLimit: 1 })
  const driftPlan = await driftFixture.service.plan(
    APPLICATION_ID,
    BOT_ID,
    driftRequest,
  )
  await driftFixture.service.execute(
    APPLICATION_ID,
    BOT_ID,
    driftRequest,
    driftPlan.digest,
  )
  const createdRole = driftFixture.state.roles.find(
    (candidate) => candidate.id === CREATED_ROLE_ID,
  )
  assert.ok(createdRole)
  createdRole.name = "Changed externally"
  await assert.rejects(
    driftFixture.createService({ scaffoldPlanKeyByte: 41 }).plan(
      APPLICATION_ID,
      BOT_ID,
      driftRequest,
    ),
    /incomplete or drifting checkpoint/,
  )
})

test("records an uncertain external-write outcome without persisting Discord intent", async () => {
  const { operationStore, service, state } = fixture()
  state.createRoleError = new Error("Discord write failed for private Support role")
  const request = scaffoldRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    GuildScaffoldExecutionError,
  )
  const topReceipt = [...operationStore.receipts.values()].find(
    (receipt) => receipt.kind === "guild-scaffold",
  )
  assert.equal(topReceipt?.status, "uncertain")
  const serializedReceipts = JSON.stringify([...operationStore.receipts.values()])
  assert.doesNotMatch(serializedReceipts, /private|Support/i)
  assert.doesNotMatch(serializedReceipts, new RegExp(OPERATION_KEY))
  await assert.rejects(
    service.plan(APPLICATION_ID, BOT_ID, request),
    /terminal and cannot be resumed/,
  )
})

test("blocks drift even when the top uncertain receipt cannot be finalized", async () => {
  const { operationStore, service, state } = fixture()
  state.createdRolePrimaryColor = 0
  operationStore.failGuildScaffoldFinish = true
  const request = scaffoldRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildScaffoldExecutionError)
      const result = error.result as {
        status?: string
        topRecordError?: string | null
      }
      assert.equal(result.status, "uncertain")
      assert.equal(result.topRecordError, "Error")
      return true
    },
  )
  const roleReceipt = [...operationStore.receipts.values()].find(
    (receipt) => receipt.kind === "role-creation",
  )
  const topReceipt = [...operationStore.receipts.values()].find(
    (receipt) => receipt.kind === "guild-scaffold",
  )
  assert.equal(roleReceipt?.status, "completed")
  assert.equal(roleReceipt?.verification, "drift")
  assert.equal(topReceipt?.status, "pending")
  await assert.rejects(
    service.plan(APPLICATION_ID, BOT_ID, request),
    /incomplete or drifting checkpoint/,
  )
})

test("keeps the scaffold resumable when a step fails before write reservation", async () => {
  const { operationStore, service, state } = fixture()
  state.getGuildRolesErrorAt = 3
  const request = scaffoldRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildScaffoldExecutionError)
      assert.equal(
        (error.result as { status?: string }).status,
        "paused-step-prewrite",
      )
      return true
    },
  )
  const topReceipt = [...operationStore.receipts.values()].find(
    (receipt) => receipt.kind === "guild-scaffold",
  )
  assert.equal(topReceipt?.status, "pending")
  assert.equal(
    [...operationStore.receipts.values()].some(
      (receipt) => receipt.kind === "role-creation",
    ),
    false,
  )

  state.getGuildRolesErrorAt = null
  const resumed = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(resumed.status, "resume-ready")
})

test("enforces dedicated policy, effective permissions, and bounded capacity", async () => {
  const disabledFixture = fixture()
  await assert.rejects(
    disabledFixture.createService({ policy: scaffoldPolicy(false) }).plan(
      APPLICATION_ID,
      BOT_ID,
      scaffoldRequest(),
    ),
    /guild scaffolds are disabled/,
  )

  const permissionFixture = fixture()
  const botRole = permissionFixture.state.roles.find(
    (candidate) => candidate.id === BOT_ROLE_ID,
  )
  assert.ok(botRole)
  botRole.permissions = (
    DISCORD_PERMISSIONS.MANAGE_CHANNELS
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  ).toString()
  await assert.rejects(
    permissionFixture.service.plan(APPLICATION_ID, BOT_ID, scaffoldRequest()),
    /lacks guild-level MANAGE_ROLES/,
  )

  const roleCapacityFixture = fixture()
  for (
    let index = roleCapacityFixture.state.roles.length;
    index < DISCORD_LIMITS.guildRoles;
    index += 1
  ) {
    roleCapacityFixture.state.roles.push(role(
      (900_000_000_000_000_000n + BigInt(index)).toString(),
      `existing-${index}`,
      0n,
      1,
    ))
  }
  await assert.rejects(
    roleCapacityFixture.service.plan(APPLICATION_ID, BOT_ID, scaffoldRequest()),
    /exceed the guild role limit/,
  )

  const categoryCapacityFixture = fixture()
  categoryCapacityFixture.state.channels.push({
    guild_id: GUILD_ID,
    id: CREATED_CATEGORY_ID,
    name: "Support",
    parent_id: null,
    permission_overwrites: [],
    position: 0,
    type: DISCORD_CHANNEL_TYPES.category,
  })
  for (let index = 0; index < DISCORD_LIMITS.categoryChannels; index += 1) {
    categoryCapacityFixture.state.channels.push({
      guild_id: GUILD_ID,
      id: (910_000_000_000_000_000n + BigInt(index)).toString(),
      name: `existing-${index}`,
      parent_id: CREATED_CATEGORY_ID,
      permission_overwrites: [],
      position: index + 1,
      type: DISCORD_CHANNEL_TYPES.text,
    })
  }
  await assert.rejects(
    categoryCapacityFixture.service.plan(APPLICATION_ID, BOT_ID, scaffoldRequest()),
    /exceed its child limit/,
  )

  const incompleteParentFixture = fixture()
  incompleteParentFixture.state.channels.push({
    guild_id: GUILD_ID,
    id: CREATED_CATEGORY_ID,
    name: "Support",
    parent_id: null,
    position: 0,
    type: DISCORD_CHANNEL_TYPES.category,
  })
  await assert.rejects(
    incompleteParentFixture.service.plan(
      APPLICATION_ID,
      BOT_ID,
      scaffoldRequest(),
    ),
    /parent permission evidence is incomplete/,
  )

  const oversizedFixture = fixture()
  for (let index = 0; index <= DISCORD_LIMITS.guildChannels; index += 1) {
    oversizedFixture.state.channels.push({
      guild_id: GUILD_ID,
      id: (920_000_000_000_000_000n + BigInt(index)).toString(),
      name: `existing-${index}`,
      parent_id: null,
      permission_overwrites: [],
      position: index,
      type: DISCORD_CHANNEL_TYPES.text,
    })
  }
  await assert.rejects(
    oversizedFixture.service.plan(APPLICATION_ID, BOT_ID, scaffoldRequest()),
    /inventory above the documented limit/,
  )
})

test("binds a resumable operation to the verified application and bot identity", async () => {
  const { service } = fixture()
  const request = scaffoldRequest({ stepLimit: 1 })
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)
  assert.equal(result.status, "paused")
  await assert.rejects(
    service.plan("999999999999999999", BOT_ID, request),
    GuildScaffoldOperationConflictError,
  )
  await assert.rejects(
    service.plan(APPLICATION_ID, "999999999999999998", request),
    GuildScaffoldOperationConflictError,
  )

  const nonBotFixture = fixture()
  nonBotFixture.state.botUserIsBot = false
  await assert.rejects(
    nonBotFixture.service.plan(APPLICATION_ID, BOT_ID, request),
    /different guild scaffold bot member/,
  )
})

test("resumes only top-level completion after a local receipt failure", async () => {
  const { operationStore, service } = fixture()
  const request = scaffoldRequest()
  const firstPlan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const first = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    firstPlan.digest,
  )
  assert.equal(first.status, "paused")

  const secondPlan = await service.plan(APPLICATION_ID, BOT_ID, request)
  operationStore.failGuildScaffoldFinish = true
  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request, secondPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildScaffoldExecutionError)
      assert.equal(
        (error.result as { status?: string }).status,
        "completed-operation-record-failed",
      )
      return true
    },
  )

  operationStore.failGuildScaffoldFinish = false
  const resumePlan = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(resumePlan.status, "resume-ready")
  assert.deepEqual(resumePlan.executionFrontier.stepIndexes, [])
  const resumed = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    resumePlan.digest,
  )
  assert.equal(resumed.status, "completed")
  assert.deepEqual(resumed.executedSteps, [])
})

test("returns already-current without reserving an operation", async () => {
  const { operationStore, service, state } = fixture()
  state.roles.push(role(
    CREATED_ROLE_ID,
    "Support",
    DISCORD_PERMISSIONS.VIEW_CHANNEL,
    1,
    {
      color: 3_447_003,
      colors: {
        primary_color: 3_447_003,
        secondary_color: null,
        tertiary_color: null,
      },
    },
  ))
  state.channels.push({
    guild_id: GUILD_ID,
    id: CREATED_CATEGORY_ID,
    name: "Support",
    parent_id: null,
    permission_overwrites: [],
    position: 0,
    type: DISCORD_CHANNEL_TYPES.category,
  }, {
    default_auto_archive_duration: 1_440,
    guild_id: GUILD_ID,
    id: CREATED_CHANNEL_ID,
    name: "customer-help",
    nsfw: false,
    parent_id: CREATED_CATEGORY_ID,
    permission_overwrites: [],
    position: 1,
    rate_limit_per_user: 0,
    topic: "Private support queue",
    type: DISCORD_CHANNEL_TYPES.text,
  })
  const request = scaffoldRequest()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.status, "already-current")
  const result = await service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)
  assert.equal(result.status, "already-current")
  assert.equal(operationStore.receipts.size, 0)
})
