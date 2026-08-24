import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  INVITE_CURSOR_PATTERN,
  INVITE_REFERENCE_PATTERN,
} from "../src/constants.js"
import type {
  DiscordDeletedInviteSummary,
  DiscordInviteSummary,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  InviteDeletionExecutionError,
  InviteDeletionOperationConflictError,
  InviteDeletionPlanChangedError,
  InviteEvidenceError,
  PolicyError,
} from "../src/errors.js"
import {
  InviteService,
  normalizeInviteDeletionRequest,
  type InviteDeletionRequest,
  type InviteServiceOptions,
} from "../src/invite-service.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const OWNER_ID = "300000000000000002"
const BOT_ROLE_ID = "400000000000000001"
const GRANTED_ROLE_ID = "400000000000000002"
const CHANNEL_ID = "500000000000000001"
const OTHER_CHANNEL_ID = "500000000000000002"
const INVITER_ID = "600000000000000001"
const TARGET_ID = "700000000000000001"
const PRIVATE_CODE = "private-invite-capability"
const OTHER_PRIVATE_CODE = "other-private-capability"
const OPERATION_KEY = "invite-deletion-operation-0001"
const AUDIT_REASON = "Reviewed invite cleanup / case 42"
const NOW = "2026-08-21T00:00:00.000Z"

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(id = CHANNEL_ID): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: id === CHANNEL_ID ? "private-channel" : "other-private-channel",
    type: 0,
  }
}

function invite(
  code: string,
  channelId: string,
  overrides: Partial<DiscordInviteSummary> = {},
): DiscordInviteSummary {
  return {
    channelId,
    code,
    createdAt: "2026-08-20T00:00:00.000Z",
    expiresAt: null,
    flags: 1,
    guildId: GUILD_ID,
    inviterUserId: INVITER_ID,
    maxAge: 0,
    maxUses: 0,
    roleIds: [GRANTED_ROLE_ID],
    targetApplicationId: TARGET_ID,
    targetType: 2,
    targetUserId: null,
    temporary: false,
    type: 0,
    uses: 2,
    ...overrides,
  }
}

function policy(options: {
  audit?: boolean
  deletion?: boolean
  guildIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowInviteAudit: options.audit ?? true,
    allowInviteDeletions: options.deletion ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    inviteGuildIds: new Set(options.guildIds || [GUILD_ID]),
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  lastReceipt: OperationReceipt | undefined
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
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
  channels: DiscordChannel[]
  deleted: boolean
  invites: DiscordInviteSummary[]
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  mutationUpdatesState: boolean
  readbackError: unknown
  roles: DiscordRole[]
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: [channel(), channel(OTHER_CHANNEL_ID)],
    deleted: false,
    invites: [
      invite(PRIVATE_CODE, CHANNEL_ID),
      invite(OTHER_PRIVATE_CODE, OTHER_CHANNEL_ID, {
        flags: 0,
        roleIds: [],
        targetApplicationId: null,
        targetType: null,
        uses: 0,
      }),
    ],
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    mutationUpdatesState: true,
    readbackError: undefined,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 10),
      role(GRANTED_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_ROLES, 5),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutationCompleted = false
  let policyCalls = 0
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
  const basePolicy = options.policy || policy()
  const scopedPolicy: InviteServiceOptions["policy"] = {
    assertGuildInviteAuditable(guildId) {
      policyCalls += 1
      basePolicy.assertGuildInviteAuditable(guildId)
    },
    assertGuildInviteDeletable(guildId) {
      policyCalls += 1
      basePolicy.assertGuildInviteDeletable(guildId)
    },
    assertGuildInviteCreatable(guildId, channelId) {
      policyCalls += 1
      basePolicy.assertGuildInviteCreatable(guildId, channelId)
    },
  }
  const client: InviteServiceOptions["client"] = {
    async createChannelInvite() {
      throw new Error("Unexpected invite creation")
    },
    async deleteInvite(code, reason) {
      events.push(`write:delete:${reason}`)
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      if (state.mutationUpdatesState) state.deleted = true
      const target = state.invites.find((entry) => entry.code === code)
      if (!target) throw new Error("missing target")
      return {
        channelId: target.channelId,
        code,
        guildId: target.guildId,
        type: target.type,
      } satisfies DiscordDeletedInviteSummary
    },
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: "Private Guild", owner_id: OWNER_ID }
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
    async getInvite() {
      throw new Error("Unexpected exact invite lookup")
    },
    async getInviteTargetUserIds() {
      throw new Error("Unexpected invite target-user lookup")
    },
    async getInviteTargetUsersJobStatus() {
      throw new Error("Unexpected invite target-user job lookup")
    },
    async listGuildInvites() {
      events.push(mutationCompleted ? "read:readback" : "read:invites")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return state.deleted
        ? state.invites.filter((entry) => entry.code !== PRIVATE_CODE)
        : state.invites
    },
  }
  const service = new InviteService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(11),
    policy: scopedPolicy,
    randomId: () => "activity-0001",
  })
  return {
    activities,
    events,
    getPolicyCalls: () => policyCalls,
    operationStore,
    service,
    state,
  }
}

function request(inviteRef: string, overrides: Partial<InviteDeletionRequest> = {}) {
  return {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    inviteRef,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected invite deletion",
    method: "DELETE",
    route: "/invites/{invite.code}",
    status,
  })
}

async function firstReference(service: InviteService): Promise<string> {
  const result = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID, { limit: 100 })
  const target = result.invites.find((entry) => entry.channel.id === CHANNEL_ID)
  assert.ok(target)
  return target.inviteRef
}

test("invite audit returns only opaque references and privacy-minimized risk evidence", async () => {
  const { service } = fixture()

  const result = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID, { limit: 1 })

  assert.equal(result.invites.length, 1)
  assert.match(result.invites[0]?.inviteRef || "", INVITE_REFERENCE_PATTERN)
  assert.equal(result.page.hasMore, true)
  assert.match(result.page.nextCursor || "", INVITE_CURSOR_PATTERN)
  assert.equal(result.access.manageGuild, true)
  assert.equal(result.access.complete, true)
  assert.equal(result.privacy.capabilitiesProjectedOut, true)
  const target = result.invites.find((entry) => entry.channel.id === CHANNEL_ID)
  if (target) {
    assert.deepEqual(target.roles[0]?.highRiskPermissions, ["MANAGE_ROLES"])
    assert.equal(target.flags.guest, true)
    assert.deepEqual(target.riskFlags, [
      "already-used",
      "guest-access",
      "high-risk-role-grant",
      "non-expiring",
      "role-grant",
      "targeted",
      "unlimited-use",
    ])
  }
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_CODE))
  assert.doesNotMatch(serialized, new RegExp(OTHER_PRIVATE_CODE))
  assert.doesNotMatch(serialized, /discord\.gg|private-role-/)
})

test("invite audit cursor is authenticated and bound to the complete fresh snapshot", async () => {
  const { events, service, state } = fixture()
  const first = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID, { limit: 1 })
  assert.ok(first.page.nextCursor)
  const second = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID, {
    cursor: first.page.nextCursor,
    limit: 1,
  })
  assert.equal(second.invites.length, 1)
  assert.notEqual(second.invites[0]?.inviteRef, first.invites[0]?.inviteRef)

  const readsBeforeTamper = events.length
  const tampered = `${first.page.nextCursor.slice(0, -1)}0`
  await assert.rejects(
    () => service.list(APPLICATION_ID, BOT_ID, GUILD_ID, { cursor: tampered }),
    /cursor is invalid or expired/,
  )
  assert.equal(events.length, readsBeforeTamper)

  state.invites[0] = invite(PRIVATE_CODE, CHANNEL_ID, { uses: 3 })
  await assert.rejects(
    () => service.list(APPLICATION_ID, BOT_ID, GUILD_ID, {
      cursor: first.page.nextCursor as string,
    }),
    /inventory changed/,
  )
})

test("exact invite lookup resolves only a current process reference", async () => {
  const { service } = fixture()
  const inviteRef = await firstReference(service)

  const result = await service.get(APPLICATION_ID, BOT_ID, GUILD_ID, inviteRef)

  assert.equal(result.invite.inviteRef, inviteRef)
  await assert.rejects(
    () => service.get(
      APPLICATION_ID,
      BOT_ID,
      GUILD_ID,
      inviteRef.replace(/[a-f0-9]$/u, "0"),
    ),
    /absent or expired/,
  )
})

test("invite audit applies local policy before Discord and requires complete MANAGE_GUILD", async () => {
  const disabled = fixture({ policy: policy({ audit: false }) })
  await assert.rejects(
    () => disabled.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    (error: unknown) => error instanceof PolicyError,
  )
  assert.deepEqual(disabled.events, [])

  const underprivileged = fixture({
    state: {
      roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)],
    },
  })
  await assert.rejects(
    () => underprivileged.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /lacks guild-level MANAGE_GUILD/,
  )

  const invalidChannel = fixture({
    state: { channels: [channel(OTHER_CHANNEL_ID)] },
  })
  await assert.rejects(
    () => invalidChannel.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    (error: unknown) => error instanceof InviteEvidenceError,
  )

  const contradictoryTarget = fixture({
    state: {
      invites: [invite(PRIVATE_CODE, CHANNEL_ID, { targetUserId: TARGET_ID })],
    },
  })
  await assert.rejects(
    () => contradictoryTarget.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /contradictory application invite evidence/,
  )

  const contradictoryLifetime = fixture({
    state: {
      invites: [invite(PRIVATE_CODE, CHANNEL_ID, { maxAge: 60 })],
    },
  })
  await assert.rejects(
    () => contradictoryLifetime.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /contradictory guild invite evidence/,
  )
})

test("invite deletion plan is stable, code-free, and separately gated", async () => {
  const { service } = fixture()
  const inviteRef = await firstReference(service)
  const first = await service.plan(APPLICATION_ID, BOT_ID, request(inviteRef))
  const second = await service.plan(APPLICATION_ID, BOT_ID, request(inviteRef))

  assert.equal(first.digest, second.digest)
  assert.equal(first.target.inviteRef, inviteRef)
  assert.equal(first.operationKeyHash.includes(OPERATION_KEY), false)
  assert.doesNotMatch(JSON.stringify(first), new RegExp(PRIVATE_CODE))
  assert.match(first.warnings.join("\n"), /does not remove members or roles granted/)

  const disabled = fixture({ policy: policy({ deletion: false }) })
  const disabledRef = await firstReference(disabled.service)
  await assert.rejects(
    () => disabled.service.plan(APPLICATION_ID, BOT_ID, request(disabledRef)),
    /invite deletion is disabled/,
  )
  await assert.rejects(
    () => service.plan(APPLICATION_ID, BOT_ID, request(inviteRef, {
      auditReason: `Do not persist ${PRIVATE_CODE}`,
    })),
    /must not contain the target invite code/,
  )
  const inviteUrl = fixture()
  await assert.rejects(
    () => inviteUrl.service.plan(APPLICATION_ID, BOT_ID, request(inviteRef, {
      auditReason: "Revoke https://discord.gg/private-capability",
    })),
    /must not contain an invite URL/,
  )
  assert.deepEqual(inviteUrl.events, [])
})

test("invite deletion records pending state before one write and verifies absence", async () => {
  const { activities, events, operationStore, service } = fixture()
  const inviteRef = await firstReference(service)
  events.length = 0
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request(inviteRef))
  events.length = 0

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(inviteRef),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verifiedAbsent, true)
  assert.deepEqual(events.slice(5, 9), [
    "operation:reserve",
    "activity:pending",
    `write:delete:${AUDIT_REASON}`,
    "read:guild",
  ])
  assert.equal(events.filter((entry) => entry.startsWith("write:")).length, 1)
  assert.equal(activities[0]?.status, "pending")
  assert.equal(activities.at(-1)?.status, "completed")
  assert.equal(operationStore.lastReceipt?.status, "completed")
  assert.equal(operationStore.lastReceipt?.resourceId, inviteRef)
  const serialized = JSON.stringify({ activities, receipt: operationStore.lastReceipt, result })
  assert.doesNotMatch(serialized, new RegExp(PRIVATE_CODE))
  assert.doesNotMatch(serialized, new RegExp(AUDIT_REASON.replace(/[ /]/gu, "\\$&")))
})

test("invite deletion rejects a stale plan before reservation or mutation", async () => {
  const { events, service, state } = fixture()
  const inviteRef = await firstReference(service)
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request(inviteRef))
  events.length = 0
  state.invites[0] = invite(PRIVATE_CODE, CHANNEL_ID, { maxUses: 2 })

  await assert.rejects(
    () => service.execute(APPLICATION_ID, BOT_ID, request(inviteRef), plan.digest),
    (error: unknown) => error instanceof InviteDeletionPlanChangedError,
  )
  assert.equal(events.some((entry) => entry.startsWith("operation:")), false)
  assert.equal(events.some((entry) => entry.startsWith("write:")), false)
})

test("invite deletion classifies definite refusal and uncertain dispatch without secret data", async () => {
  const refused = fixture()
  const refusedRef = await firstReference(refused.service)
  const refusedPlan = await refused.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(refusedRef),
  )
  refused.state.mutationError = apiError(403)
  await assert.rejects(
    () => refused.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(refusedRef),
      refusedPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof InviteDeletionExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      assert.doesNotMatch(JSON.stringify(error.result), new RegExp(PRIVATE_CODE))
      return true
    },
  )

  const uncertain = fixture()
  const uncertainRef = await firstReference(uncertain.service)
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(uncertainRef),
  )
  uncertain.state.mutationError = new Error(`network failure ${PRIVATE_CODE}`)
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(uncertainRef),
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof InviteDeletionExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      assert.doesNotMatch(JSON.stringify(error.result), new RegExp(PRIVATE_CODE))
      assert.equal(error.cause, undefined)
      return true
    },
  )
  uncertain.events.length = 0
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(uncertainRef, { operationKey: "invite-deletion-operation-0002" }),
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof InviteDeletionExecutionError
      && (error.result as { status: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.deepEqual(uncertain.events, [])
})

test("invite deletion blocks duplicate operation keys and pending-activity failure", async () => {
  const conflict = fixture()
  const inviteRef = await firstReference(conflict.service)
  const plan = await conflict.service.plan(APPLICATION_ID, BOT_ID, request(inviteRef))
  const normalized = normalizeInviteDeletionRequest(request(inviteRef))
  conflict.operationStore.receipts.set(`invite-deletion:${normalized.operationKeyHash}`, {
    activityId: "prior-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "invite-deletion",
    operationKeyHash: normalized.operationKeyHash,
    planDigest: plan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    () => conflict.service.plan(APPLICATION_ID, BOT_ID, request(inviteRef)),
    (error: unknown) => error instanceof InviteDeletionOperationConflictError,
  )

  const auditFailure = fixture({ state: { activityFailureAt: 1 } })
  const failureRef = await firstReference(auditFailure.service)
  const failurePlan = await auditFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request(failureRef),
  )
  await assert.rejects(
    () => auditFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(failureRef),
      failurePlan.digest,
    ),
    (error: unknown) => (
      error instanceof InviteDeletionExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(auditFailure.events.some((entry) => entry.startsWith("write:")), false)
})
