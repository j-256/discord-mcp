import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import type {
  DiscordForumTagState,
  ModifyForumTagInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  ForumTagEvidenceError,
  ForumTagExecutionError,
  ForumTagPlanChangedError,
} from "../src/errors.js"
import {
  ForumTagService,
  normalizeForumTagChangeRequest,
  type ForumTagChangeRequest,
  type ForumTagServiceClient,
} from "../src/forum-tag-service.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type { ScopePolicy } from "../src/policy.js"
import type { DiscordGuildMember, DiscordRole } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const FORUM_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const OWNER_ID = "400000000000000002"
const BOT_ROLE_ID = "500000000000000001"
const SUPPORT_TAG_ID = "600000000000000001"
const STAFF_TAG_ID = "600000000000000002"
const CREATED_TAG_ID = "600000000000000003"
const CUSTOM_EMOJI_ID = "700000000000000001"
const OPERATION_KEY = "forum-tag-operation-0001"
const AUDIT_REASON = "Reviewed forum-tag change / case 42"
const NOW = "2026-08-22T18:00:00.000Z"

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: id === BOT_ROLE_ID,
    name: id === GUILD_ID ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position,
  }
}

function forum(overrides: Partial<DiscordForumTagState> = {}): DiscordForumTagState {
  return {
    flags: 16,
    guildId: GUILD_ID,
    id: FORUM_ID,
    permissionOverwriteUnknownFieldCount: 0,
    permissionOverwrites: [],
    tags: [{
      emojiId: null,
      emojiName: "📌",
      id: SUPPORT_TAG_ID,
      moderated: false,
      name: "Support",
      unknownFieldCount: 0,
    }, {
      emojiId: CUSTOM_EMOJI_ID,
      emojiName: null,
      id: STAFF_TAG_ID,
      moderated: true,
      name: "Staff",
      unknownFieldCount: 0,
    }],
    type: 15,
    unknownFieldCount: 0,
    ...overrides,
  }
}

class MemoryOperationStore implements OperationStore {
  readonly events: string[]
  finishCalls = 0
  finishFailureAt: number | null = null
  lastReceipt: OperationReceipt | undefined
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.finishCalls += 1
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailureAt === this.finishCalls) {
      throw new Error("operation store unavailable")
    }
    this.lastReceipt = receipt
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
    this.lastReceipt = receipt
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  botMember: DiscordGuildMember
  forum: DiscordForumTagState
  mutationError: unknown
  preflightError: unknown
  readbackDrift: boolean
  responseDrift: boolean
  roles: DiscordRole[]
}

function fixture(options: { permissions?: bigint; state?: Partial<FixtureState> } = {}) {
  const permissions = options.permissions
    ?? DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_CHANNELS
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    forum: forum(),
    mutationError: undefined,
    preflightError: undefined,
    readbackDrift: false,
    responseDrift: false,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, permissions, 10),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const patches: Array<{
    auditReason: string
    channelId: string
    tags: readonly ModifyForumTagInput[]
  }> = []
  let activityCalls = 0
  let forumReads = 0
  let patched = false
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) {
        throw new Error("activity store unavailable")
      }
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(events)
  const client: ForumTagServiceClient = {
    async getGuild(guildId) {
      return { id: guildId, name: "Private Guild", owner_id: OWNER_ID }
    },
    async getGuildForumTags(channelId) {
      forumReads += 1
      assert.equal(channelId, FORUM_ID)
      const result = structuredClone(state.forum)
      if (patched && state.readbackDrift && result.tags[0]) {
        result.tags[0].moderated = !result.tags[0].moderated
      }
      return result
    },
    async getGuildMember(guildId, userId) {
      assert.equal(guildId, GUILD_ID)
      assert.equal(userId, BOT_ID)
      return structuredClone(state.botMember)
    },
    async getGuildRoles(guildId) {
      assert.equal(guildId, GUILD_ID)
      return structuredClone(state.roles)
    },
    async modifyGuildForumTags(channelId, tags, auditReason) {
      events.push("discord:patch")
      patches.push({
        auditReason,
        channelId,
        tags: structuredClone(tags),
      })
      if (state.mutationError) throw state.mutationError
      state.forum = {
        ...state.forum,
        tags: tags.map((tag) => ({
          emojiId: tag.emojiId,
          emojiName: tag.emojiName,
          id: tag.id ?? CREATED_TAG_ID,
          moderated: tag.moderated,
          name: tag.name,
          unknownFieldCount: 0,
        })),
      }
      patched = true
      const response = structuredClone(state.forum)
      if (state.responseDrift && response.tags[0]) {
        response.tags[0].moderated = !response.tags[0].moderated
      }
      return response
    },
  }
  let policyCalls = 0
  const policy: Pick<
    ScopePolicy,
    | "assertForumTagAuditConfigured"
    | "assertForumTagAuditable"
    | "assertForumTagChangeConfigured"
    | "assertForumTagChangeable"
  > = {
    assertForumTagAuditConfigured(channelId) {
      policyCalls += 1
      assert.equal(channelId, FORUM_ID)
      if (state.preflightError) throw state.preflightError
    },
    assertForumTagAuditable(channel) {
      policyCalls += 1
      assert.equal(channel.id, FORUM_ID)
      assert.equal(channel.type, 15)
      return GUILD_ID
    },
    assertForumTagChangeConfigured(channelId) {
      policyCalls += 1
      assert.equal(channelId, FORUM_ID)
      if (state.preflightError) throw state.preflightError
    },
    assertForumTagChangeable(channel) {
      policyCalls += 1
      assert.equal(channel.id, FORUM_ID)
      assert.equal(channel.type, 15)
      return GUILD_ID
    },
  }
  const service = new ForumTagService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(23),
    policy,
    randomId: () => "forum-tag-activity-0001",
  })
  return {
    activities,
    events,
    get forumReads() { return forumReads },
    get policyCalls() { return policyCalls },
    operationStore,
    patches,
    service,
    state,
  }
}

function request(
  overrides: Record<string, unknown> = {},
): ForumTagChangeRequest {
  const base = {
    auditReason: AUDIT_REASON,
    channelId: FORUM_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
  }
  const record = overrides
  if (record.action === "update-metadata") {
    return {
      ...base,
      action: "update-metadata",
      ...(Object.hasOwn(record, "moderated")
        ? { moderated: record.moderated as boolean }
        : {}),
      ...(Object.hasOwn(record, "name") ? { name: record.name as string } : {}),
      operationKey: record.operationKey as string | undefined ?? OPERATION_KEY,
      tagId: record.tagId as string,
      ...(Object.hasOwn(record, "unicodeEmoji")
        ? { unicodeEmoji: record.unicodeEmoji as string | null }
        : {}),
    }
  }
  if (record.action === "delete") {
    return {
      ...base,
      action: "delete",
      operationKey: record.operationKey as string | undefined ?? OPERATION_KEY,
      tagId: record.tagId as string,
    }
  }
  return {
    ...base,
    action: "create",
    ...(record.moderated === undefined ? {} : { moderated: record.moderated as boolean }),
    name: record.name as string | undefined ?? "Resolved",
    operationKey: record.operationKey as string | undefined ?? OPERATION_KEY,
    unicodeEmoji: Object.hasOwn(record, "unicodeEmoji")
      ? record.unicodeEmoji as string | null
      : "✅",
  }
}

test("forum-tag normalization preserves omitted versus cleared emoji state", () => {
  const omitted = normalizeForumTagChangeRequest(request({
    action: "update-metadata",
    name: "Escalated",
    tagId: STAFF_TAG_ID,
  }))
  const cleared = normalizeForumTagChangeRequest(request({
    action: "update-metadata",
    tagId: STAFF_TAG_ID,
    unicodeEmoji: null,
  }))

  assert.equal(Object.hasOwn(omitted, "unicodeEmoji"), false)
  assert.equal(Object.hasOwn(cleared, "unicodeEmoji"), true)
  assert.equal(cleared.action, "update-metadata")
  if (cleared.action !== "update-metadata") throw new Error("Unexpected action")
  assert.equal(cleared.unicodeEmoji, null)
  assert.throws(
    () => normalizeForumTagChangeRequest(request({
      action: "update-metadata",
      tagId: STAFF_TAG_ID,
    })),
    /metadata update request is invalid/,
  )
  assert.throws(
    () => normalizeForumTagChangeRequest({
      ...request(),
      customEmojiId: CUSTOM_EMOJI_ID,
    } as never),
    /creation request is invalid/,
  )
  assert.throws(
    () => normalizeForumTagChangeRequest(request({ unicodeEmoji: "plain-text" })),
    /one NFC emoji/,
  )
})

test("forum-tag audit requires only VIEW_CHANNEL and returns a transient strict projection", async () => {
  const target = fixture({ permissions: DISCORD_PERMISSIONS.VIEW_CHANNEL })

  const result = await target.service.audit(APPLICATION_ID, BOT_ID, FORUM_ID)

  assert.equal(result.status, "ok")
  assert.equal(result.access.manageChannels, false)
  assert.equal(result.access.requiredPermissions.join(","), "VIEW_CHANNEL")
  assert.equal(result.inventory.returned, 2)
  assert.equal(result.tags[1]?.emoji.kind, "custom")
  assert.equal(result.privacy.persistence, "content-free-activity-only")
  assert.equal(target.activities.length, 0)
  assert.equal(target.operationStore.receipts.size, 0)
})

test("forum-tag scope rejects an exact channel before reading Discord forum state", async () => {
  const target = fixture({ state: { preflightError: new Error("outside scope") } })

  await assert.rejects(
    () => target.service.audit(APPLICATION_ID, BOT_ID, FORUM_ID),
    /outside scope/,
  )
  await assert.rejects(
    () => target.service.plan(APPLICATION_ID, BOT_ID, request()),
    /outside scope/,
  )
  assert.equal(target.forumReads, 0)
})

test("forum-tag plans preserve ordered tags and custom emoji IDs", async () => {
  const target = fixture()

  const plan = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )

  assert.equal(plan.status, "planned")
  assert.equal(plan.mutation, "create")
  assert.equal(plan.desiredTags.length, 3)
  assert.equal(plan.desiredTags[0]?.id, SUPPORT_TAG_ID)
  assert.deepEqual(plan.desiredTags[1]?.emoji, {
    emojiId: CUSTOM_EMOJI_ID,
    kind: "custom",
  })
  assert.equal(plan.desiredTags[2]?.id, null)
  assert.deepEqual(plan.desiredTags[2]?.emoji, {
    kind: "unicode",
    unicodeEmoji: "✅",
  })
  assert.equal(plan.access.manageChannels, true)
  assert.equal(plan.digest.startsWith("hmac-sha256:"), true)
  assert.equal(target.activities.length, 0)
})

test("forum-tag creation is record-free when one exact semantic match exists", async () => {
  const target = fixture()
  const exactRequest = request({
    name: "Support",
    unicodeEmoji: "📌",
  })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, exactRequest)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    exactRequest,
    plan.digest,
  )

  assert.equal(plan.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.tagId, SUPPORT_TAG_ID)
  assert.equal(target.patches.length, 0)
  assert.equal(target.activities.length, 0)
  assert.equal(target.operationStore.receipts.size, 0)
})

test("forum-tag creation rejects ambiguous semantic duplicates", async () => {
  const duplicateId = "600000000000000004"
  const target = fixture({
    state: {
      forum: forum({
        tags: [
          ...forum().tags,
          { ...forum().tags[0]!, id: duplicateId },
        ],
      }),
    },
  })

  await assert.rejects(
    () => target.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ name: "Support", unicodeEmoji: "📌" }),
    ),
    /multiple exact matches/,
  )
})

test("forum-tag update preserves an existing custom emoji when omitted", async () => {
  const target = fixture()
  const update = request({
    action: "update-metadata",
    name: "Team",
    tagId: STAFF_TAG_ID,
  })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, update)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    update,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.tagId, STAFF_TAG_ID)
  assert.equal(target.patches.length, 1)
  assert.deepEqual(target.patches[0]?.tags[1], {
    emojiId: CUSTOM_EMOJI_ID,
    emojiName: null,
    id: STAFF_TAG_ID,
    moderated: true,
    name: "Team",
  })
})

test("forum-tag deletion exposes unknown usage impact and verifies the full inventory", async () => {
  const target = fixture()
  const deletion = request({
    action: "delete",
    tagId: SUPPORT_TAG_ID,
  })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, deletion)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    deletion,
    plan.digest,
  )

  assert.equal(plan.impact.tagUsage, "unknown-unavailable")
  assert.equal(plan.impact.activeThreadsEnumerated, false)
  assert.deepEqual(plan.desiredTags.map(({ id }) => id), [STAFF_TAG_ID])
  assert.equal(result.observed.tags.length, 1)
  assert.equal(result.readbackMatched, true)
})

test("future forum-tag fields block writes but remain count-only in audit", async () => {
  const target = fixture({
    state: {
      forum: forum({
        tags: forum().tags.map((tag, index) => ({
          ...tag,
          unknownFieldCount: index === 0 ? 1 : 0,
        })),
      }),
    },
  })
  const audit = await target.service.audit(APPLICATION_ID, BOT_ID, FORUM_ID)

  assert.equal(audit.inventory.unknownTagFields, 1)
  await assert.rejects(
    () => target.service.plan(APPLICATION_ID, BOT_ID, request()),
    /future tag fields/,
  )
})

test("unknown permission-overwrite fields block forum-tag permission claims", async () => {
  const target = fixture({
    state: {
      forum: forum({ permissionOverwriteUnknownFieldCount: 1 }),
    },
  })

  await assert.rejects(
    () => target.service.audit(APPLICATION_ID, BOT_ID, FORUM_ID),
    /permission-overwrite evidence contains unknown fields/,
  )
  await assert.rejects(
    () => target.service.plan(APPLICATION_ID, BOT_ID, request()),
    /permission-overwrite evidence contains unknown fields/,
  )
})

test("forum-tag execution reserves, audits, mutates once, and records no tag text", async () => {
  const target = fixture()
  const change = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)
  const result = await target.service.execute(
    APPLICATION_ID,
    BOT_ID,
    change,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.tagId, CREATED_TAG_ID)
  assert.deepEqual(target.events, [
    "operation:reserve",
    "activity:pending",
    "discord:patch",
    "operation:completed",
    "activity:completed",
  ])
  assert.deepEqual(target.activities.map(({ status }) => status), ["pending", "completed"])
  assert.equal(target.operationStore.lastReceipt?.resourceId, CREATED_TAG_ID)
  const durable = JSON.stringify({
    activities: target.activities,
    receipt: target.operationStore.lastReceipt,
  })
  assert.doesNotMatch(durable, /Resolved|✅|Reviewed forum-tag change|forum-tag-operation-0001/)
})

test("forum-tag execution rejects stale plans before reservation or mutation", async () => {
  const target = fixture()
  const change = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)
  target.state.forum.tags[0]!.moderated = true

  await assert.rejects(
    () => target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      change,
      plan.digest,
    ),
    ForumTagPlanChangedError,
  )
  assert.equal(target.patches.length, 0)
  assert.equal(target.operationStore.receipts.size, 0)
})

test("known Discord rejections fail safely without quarantining the forum", async () => {
  const target = fixture({
    state: {
      mutationError: new DiscordApiError({
        message: "Discord API PATCH /channels/{channel.id} returned 400: rejected",
        method: "PATCH",
        route: "/channels/{channel.id}",
        status: 400,
      }),
    },
  })
  const change = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert(error instanceof ForumTagExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )
  assert.deepEqual(target.activities.map(({ status }) => status), ["pending", "failed"])
  assert.equal(target.operationStore.lastReceipt?.status, "failed")
})

test("ambiguous forum-tag outcomes quarantine later same-channel execution", async () => {
  const target = fixture({
    state: { responseDrift: true },
  })
  const change = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert(error instanceof ForumTagExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  const later = request({
    operationKey: "forum-tag-operation-0002",
    name: "Later",
  })
  const laterPlan = await target.service.plan(APPLICATION_ID, BOT_ID, later)
  await assert.rejects(
    () => target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      later,
      laterPlan.digest,
    ),
    (error: unknown) => {
      assert(error instanceof ForumTagExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
  assert.equal(target.patches.length, 1)
})

test("pending activity failure blocks the forum-tag mutation after reservation", async () => {
  const target = fixture({ state: { activityFailureAt: 1 } })
  const change = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert(error instanceof ForumTagExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(target.patches.length, 0)
  assert.equal(target.operationStore.lastReceipt?.status, "failed")
})

test("completion recording failures are reported and quarantine the forum", async () => {
  const target = fixture()
  target.operationStore.finishFailureAt = 1
  const change = request()
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert(error instanceof ForumTagExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-record-failed",
      )
      return true
    },
  )
  assert.deepEqual(target.activities.map(({ status }) => status), ["pending", "completed"])
})

test("forum-tag planning requires MANAGE_CHANNELS", async () => {
  const target = fixture({ permissions: DISCORD_PERMISSIONS.VIEW_CHANNEL })

  await assert.rejects(
    () => target.service.plan(APPLICATION_ID, BOT_ID, request()),
    ForumTagEvidenceError,
  )
  assert.equal(target.patches.length, 0)
})
