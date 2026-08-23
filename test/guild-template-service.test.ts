import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  GUILD_TEMPLATE_REFERENCE_PATTERN,
  SCHEMA_VERSION,
} from "../src/constants.js"
import type {
  DiscordGuildTemplateSummary,
  ModifyGuildTemplateInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  GuildTemplateEvidenceError,
  GuildTemplateExecutionError,
  GuildTemplateOperationConflictError,
  GuildTemplatePlanChangedError,
} from "../src/errors.js"
import {
  GuildTemplateService,
  normalizeGuildTemplateChangeRequest,
  type GuildTemplateAction,
  type GuildTemplateChangeRequest,
  type GuildTemplateServiceOptions,
} from "../src/guild-template-service.js"
import type {
  GatewayChannelLayoutListener,
  GatewayChannelLayoutSource,
} from "../src/gateway-channel-layout.js"
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
const CHANNEL_ID = "500000000000000001"
const CREATOR_ID = "600000000000000001"
const PRIVATE_CODE = "private-template-capability"
const OTHER_PRIVATE_CODE = "other-private-template"
const CREATED_PRIVATE_CODE = "created-private-template"
const PRIVATE_TEMPLATE_NAME = "Private template name"
const PRIVATE_DESCRIPTION = "Private template description"
const PRIVATE_GUILD_NAME = "Private Guild"
const PRIVATE_CHANNEL_NAME = "private-channel"
const PRIVATE_TOPIC = "private-topic"
const OPERATION_KEY = "guild-template-operation-0001"
const AUDIT_REASON = "Reviewed Guild Template change / case 42"
const NOW = "2026-08-22T12:00:00.000Z"

function role(
  id: string,
  permissions: bigint,
  position: number,
  managed = false,
): DiscordRole {
  return {
    color: 0,
    hoist: false,
    id,
    managed,
    mentionable: false,
    name: id === GUILD_ID ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: PRIVATE_CHANNEL_NAME,
    nsfw: false,
    parent_id: null,
    permission_overwrites: [],
    position: 0,
    rate_limit_per_user: 0,
    topic: PRIVATE_TOPIC,
    type: 0,
  }
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channels: [{
      id: 1,
      name: PRIVATE_CHANNEL_NAME,
      nsfw: false,
      parent_id: null,
      permission_overwrites: [],
      position: 0,
      rate_limit_per_user: 0,
      topic: PRIVATE_TOPIC,
      type: 0,
    }],
    description: "private-guild-description",
    name: PRIVATE_GUILD_NAME,
    roles: [{
      color: 0,
      hoist: false,
      id: 0,
      mentionable: false,
      name: "@everyone",
      permissions: "0",
    }],
    ...overrides,
  }
}

function template(
  code = PRIVATE_CODE,
  overrides: Partial<DiscordGuildTemplateSummary> = {},
): DiscordGuildTemplateSummary {
  return {
    code,
    createdAt: "2026-08-20T12:00:00.000Z",
    creatorId: CREATOR_ID,
    description: PRIVATE_DESCRIPTION,
    isDirty: true,
    name: PRIVATE_TEMPLATE_NAME,
    serializedSourceGuild: snapshot(),
    sourceGuildId: GUILD_ID,
    unknownFieldCount: 0,
    updatedAt: "2026-08-21T12:00:00.000Z",
    usageCount: 3,
    ...overrides,
  }
}

function policy(options: {
  audit?: boolean
  changes?: boolean
  guildIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowGuildTemplateAudit: options.audit ?? true,
    allowGuildTemplateChanges: options.changes ?? true,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    guildTemplateGuildIds: new Set(options.guildIds || [GUILD_ID]),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
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
  channels: DiscordChannel[]
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationLeavesDirty: boolean
  mutationStarted: (() => void) | null
  mutationUpdatesState: boolean
  obfuscatedChannelIds: Set<string>
  readbackError: unknown
  roles: DiscordRole[]
  templates: DiscordGuildTemplateSummary[]
}

function fixture(options: {
  planKeyByte?: number
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: [channel()],
    mutationError: undefined,
    mutationGate: null,
    mutationLeavesDirty: false,
    mutationStarted: null,
    mutationUpdatesState: true,
    obfuscatedChannelIds: new Set(),
    readbackError: undefined,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 10, true),
    ],
    templates: [
      template(),
      template(OTHER_PRIVATE_CODE, {
        description: null,
        isDirty: false,
        name: "Other private template",
        usageCount: 0,
      }),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutationCalls = 0
  let mutationCompleted = false
  let policyCalls = 0
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
  const layoutSource: GatewayChannelLayoutSource = {
    layoutEnabled: true,
    getChannelLayout(guildId) {
      return {
        channels: state.channels.map((entry, position) => ({
          channelId: entry.id,
          obfuscated: state.obfuscatedChannelIds.has(entry.id),
          parentChannelId: entry.parent_id ?? null,
          position: entry.position ?? position,
          type: entry.type,
        })),
        complete: true,
        guildId,
        reason: null,
        revision: 1,
        schemaVersion: SCHEMA_VERSION,
        state: "ready",
        updatedAt: NOW,
      }
    },
    getChannelLayoutStatus() {
      return {
        channels: {
          obfuscated: state.obfuscatedChannelIds.size,
          retained: state.channels.length,
        },
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
        schemaVersion: SCHEMA_VERSION,
        updates: 1,
      }
    },
    subscribeChannelLayouts(_listener: GatewayChannelLayoutListener) {
      return () => undefined
    },
  }
  const basePolicy = options.policy || policy()
  const scopedPolicy: GuildTemplateServiceOptions["policy"] = {
    assertGuildTemplateAuditable(guildId) {
      policyCalls += 1
      basePolicy.assertGuildTemplateAuditable(guildId)
    },
    assertGuildTemplateChangeable(guildId) {
      policyCalls += 1
      basePolicy.assertGuildTemplateChangeable(guildId)
    },
  }

  async function mutate(
    action: GuildTemplateAction,
    code?: string,
    input?: ModifyGuildTemplateInput,
  ): Promise<DiscordGuildTemplateSummary> {
    mutationCalls += 1
    events.push(`write:${action}`)
    state.mutationStarted?.()
    if (state.mutationGate) await state.mutationGate
    if (state.mutationError) throw state.mutationError
    const targetIndex = code === undefined
      ? -1
      : state.templates.findIndex((entry) => entry.code === code)
    if (code !== undefined && targetIndex < 0) throw new Error("missing target")
    let returned: DiscordGuildTemplateSummary
    if (action === "create") {
      returned = template(CREATED_PRIVATE_CODE, {
        description: input?.description ?? null,
        isDirty: state.mutationLeavesDirty,
        name: input?.name as string,
        usageCount: 0,
      })
      if (state.mutationUpdatesState) state.templates.push(returned)
    } else if (action === "delete") {
      returned = state.templates[targetIndex] as DiscordGuildTemplateSummary
      if (state.mutationUpdatesState) state.templates.splice(targetIndex, 1)
    } else if (action === "synchronize") {
      returned = {
        ...(state.templates[targetIndex] as DiscordGuildTemplateSummary),
        isDirty: state.mutationLeavesDirty,
        updatedAt: NOW,
      }
      if (state.mutationUpdatesState) state.templates[targetIndex] = returned
    } else {
      returned = {
        ...(state.templates[targetIndex] as DiscordGuildTemplateSummary),
        ...(input?.description !== undefined ? { description: input.description } : {}),
        ...(input?.name !== undefined ? { name: input.name } : {}),
      }
      if (state.mutationUpdatesState) state.templates[targetIndex] = returned
    }
    mutationCompleted = true
    return returned
  }

  const client: GuildTemplateServiceOptions["client"] = {
    async createGuildTemplate(_guildId, input) {
      return mutate("create", undefined, input)
    },
    async deleteGuildTemplate(_guildId, code) {
      return mutate("delete", code)
    },
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: PRIVATE_GUILD_NAME, owner_id: OWNER_ID }
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
    async listGuildTemplates() {
      events.push(mutationCompleted ? "read:readback" : "read:templates")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return state.templates
    },
    async modifyGuildTemplate(_guildId, code, input) {
      return mutate("update-metadata", code, input)
    },
    async syncGuildTemplate(_guildId, code) {
      return mutate("synchronize", code)
    },
  }
  const service = new GuildTemplateService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    layoutSource,
    operationStore,
    planKey: new Uint8Array(32).fill(options.planKeyByte ?? 17),
    policy: scopedPolicy,
    randomId: () => "activity-0001",
  })
  return {
    activities,
    events,
    getMutationCalls: () => mutationCalls,
    getPolicyCalls: () => policyCalls,
    operationStore,
    service,
    state,
  }
}

function request(
  action: GuildTemplateAction,
  templateRef?: string,
  overrides: Partial<GuildTemplateChangeRequest> = {},
): GuildTemplateChangeRequest {
  return {
    action,
    auditReason: AUDIT_REASON,
    ...(action === "create"
      ? { description: "Created description", name: "Created template" }
      : {}),
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...(templateRef === undefined ? {} : { templateRef }),
    ...overrides,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: `Discord rejected ${PRIVATE_CODE} ${PRIVATE_TOPIC}`,
    method: "PATCH",
    route: "/guilds/{guild.id}/templates/{template.code}",
    status,
  })
}

async function reference(
  service: GuildTemplateService,
  index = 0,
): Promise<string> {
  const result = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID)
  const templateRef = result.templates[index]?.templateRef
  assert.ok(templateRef)
  return templateRef
}

async function dirtyReference(service: GuildTemplateService): Promise<string> {
  const result = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID)
  const templateRef = result.templates.find(({ isDirty }) => isDirty === true)?.templateRef
  assert.ok(templateRef)
  return templateRef
}

test("Guild Template requests are exact, URL-free, and accept an empty description", () => {
  const templateRef = `tref_hmac_sha256_${"a".repeat(64)}`
  assert.equal(
    normalizeGuildTemplateChangeRequest(request("update-metadata", templateRef, {
      description: "",
    })).description,
    "",
  )
  assert.throws(
    () => normalizeGuildTemplateChangeRequest({
      ...request("create"),
      extra: true,
    } as GuildTemplateChangeRequest),
    /fields are invalid/,
  )
  assert.throws(
    () => normalizeGuildTemplateChangeRequest(request("update-metadata", templateRef)),
    /metadata request fields are invalid/,
  )
  assert.throws(
    () => normalizeGuildTemplateChangeRequest(request("delete", templateRef, {
      auditReason: "Delete https://discord.new/private-capability",
    })),
    /must not contain a template URL/,
  )
  assert.throws(
    () => normalizeGuildTemplateChangeRequest(request("synchronize", "bad")),
    /reference is invalid/,
  )
})

test("Guild Template audit returns only opaque capabilities and count-only private structure", async () => {
  const { service } = fixture()

  const result = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(result.access.manageGuild, true)
  assert.equal(result.access.complete, true)
  assert.deepEqual(result.guild, { id: GUILD_ID })
  assert.equal(result.inventory.returned, 2)
  assert.match(result.templates[0]?.templateRef || "", GUILD_TEMPLATE_REFERENCE_PATTERN)
  const privateTemplate = result.templates.find(({ usageCount }) => usageCount === 3)
  assert.equal(privateTemplate?.metadata.nameCharacters, PRIVATE_TEMPLATE_NAME.length)
  assert.equal(privateTemplate?.structure.channels.total, 1)
  assert.equal(privateTemplate?.structure.roles.total, 1)
  assert.equal(result.privacy.capabilities, "opaque-process-local-references")
  assert.equal(result.privacy.rawPayloads, "omitted")
  const serialized = JSON.stringify(result)
  for (const secret of [
    PRIVATE_CODE,
    OTHER_PRIVATE_CODE,
    PRIVATE_TEMPLATE_NAME,
    PRIVATE_DESCRIPTION,
    PRIVATE_GUILD_NAME,
    PRIVATE_CHANNEL_NAME,
    PRIVATE_TOPIC,
    "private-role-",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret))
  }
})

test("Guild Template snapshot capture blocks on obfuscated channels while exact capability changes remain available", async () => {
  const target = fixture({
    state: { obfuscatedChannelIds: new Set([CHANNEL_ID]) },
  })
  const audit = await target.service.list(APPLICATION_ID, BOT_ID, GUILD_ID)
  const templateRef = audit.templates.find(({ isDirty }) => isDirty === true)?.templateRef
  assert.ok(templateRef)
  assert.equal(audit.channelEvidence.metadataCoverage, "visibility-bounded")
  assert.equal(audit.channelEvidence.obfuscatedChannelCount, 1)
  assert.equal(audit.liveStructure.channels.total, 0)

  await assert.rejects(
    target.service.plan(APPLICATION_ID, BOT_ID, request("create")),
    /creation and synchronization require complete live channel metadata/,
  )
  await assert.rejects(
    target.service.plan(APPLICATION_ID, BOT_ID, request("synchronize", templateRef)),
    /creation and synchronization require complete live channel metadata/,
  )

  const metadataPlan = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("update-metadata", templateRef, { name: "Reviewed name" }),
  )
  assert.equal(metadataPlan.channelEvidence.metadataCoverage, "visibility-bounded")
  assert.equal(metadataPlan.drift?.channelComparisonComplete, false)
  assert.match(metadataPlan.warnings.join(" "), /channel drift are visibility-bounded/)

  const deletePlan = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("delete", templateRef),
  )
  assert.equal(deletePlan.mutation, "delete")
  assert.equal(deletePlan.drift?.channelComparisonComplete, false)
  assert.equal(target.getMutationCalls(), 0)
})

test("Guild Template references are stable only inside one process key", async () => {
  const first = fixture({ planKeyByte: 7 })
  const sibling = fixture({ planKeyByte: 7 })
  const restarted = fixture({ planKeyByte: 8 })

  const firstRef = await reference(first.service)
  assert.equal(await reference(sibling.service), firstRef)
  assert.notEqual(await reference(restarted.service), firstRef)
  await assert.rejects(
    () => restarted.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("delete", firstRef),
    ),
    /reference is absent or expired/,
  )
})

test("Guild Template policy and complete MANAGE_GUILD evidence are enforced before use", async () => {
  const auditBlocked = fixture({ policy: policy({ audit: false, changes: false }) })
  await assert.rejects(
    () => auditBlocked.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /audit is disabled/,
  )
  assert.deepEqual(auditBlocked.events, [])

  const changeBlocked = fixture({ policy: policy({ changes: false }) })
  await assert.rejects(
    () => changeBlocked.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("create"),
    ),
    /changes are disabled/,
  )
  assert.deepEqual(changeBlocked.events, [])

  const unauthorized = fixture({
    state: { roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10, true)] },
  })
  await assert.rejects(
    () => unauthorized.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /lacks guild-level MANAGE_GUILD/,
  )
})

test("Guild Template audit rejects malformed private snapshots and live overwrite evidence", async () => {
  const malformedSnapshot = fixture({
    state: {
      templates: [template(PRIVATE_CODE, {
        serializedSourceGuild: snapshot({
          roles: [{ id: 1, name: "not-everyone", permissions: "0" }],
        }),
      })],
    },
  })
  await assert.rejects(
    () => malformedSnapshot.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    GuildTemplateEvidenceError,
  )

  const malformedLive = fixture({
    state: {
      channels: [{
        ...channel(),
        permission_overwrites: [{
          allow: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
          deny: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
          id: BOT_ROLE_ID,
          type: 0,
        }],
      }],
    },
  })
  await assert.rejects(
    () => malformedLive.service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /conflicting permissions/,
  )
})

test("managed snapshot roles remain counted but stay out of advisory drift", async () => {
  const target = fixture({
    state: {
      templates: [template(PRIVATE_CODE, {
        serializedSourceGuild: snapshot({
          roles: [{
            color: 0,
            hoist: false,
            id: 0,
            managed: false,
            mentionable: false,
            name: "@everyone",
            permissions: "0",
          }, {
            color: 0,
            hoist: false,
            id: 1,
            managed: true,
            mentionable: false,
            name: `private-role-${BOT_ROLE_ID}`,
            permissions: DISCORD_PERMISSIONS.MANAGE_GUILD.toString(),
          }],
        }),
      })],
    },
  })
  const templateRef = await dirtyReference(target.service)
  const plan = await target.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("synchronize", templateRef),
  )

  assert.equal(plan.target?.structure.roles.total, 2)
  assert.equal(plan.target?.structure.roles.privileged, 1)
  assert.equal(plan.drift?.rolesMissingFromGuild, 0)
  assert.equal(plan.drift?.rolesAddedSinceSnapshot, 0)
})

test("future top-level template fields remain auditable but block every change plan", async () => {
  const target = fixture({
    state: {
      templates: [template(PRIVATE_CODE, { unknownFieldCount: 1 })],
    },
  })

  const inventory = await target.service.list(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(inventory.templates[0]?.unknownFieldCount, 1)
  await assert.rejects(
    () => target.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("create"),
    ),
    /future top-level fields that block changes/,
  )
  assert.equal(target.getMutationCalls(), 0)
  assert.equal(target.operationStore.receipts.size, 0)
})

for (const action of [
  "create",
  "delete",
  "synchronize",
  "update-metadata",
] as const) {
  test(`Guild Template ${action} uses a fresh one-shot plan and exact inventory readback`, async () => {
    const target = fixture()
    const templateRef = action === "create"
      ? undefined
      : action === "synchronize"
        ? await dirtyReference(target.service)
        : await reference(target.service)
    const change = request(action, templateRef, action === "update-metadata"
      ? { description: "", name: "Updated template" }
      : {})
    const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

    assert.equal(plan.mutation, action)
    assert.equal(plan.status, "planned")
    assert.deepEqual(plan.guild, { id: GUILD_ID })
    assert.equal(plan.liveStructure.channels.total, 1)
    assert.equal(plan.liveStructure.roles.total, 2)
    assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)
    const result = await target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      change,
      plan.digest,
    )

    assert.equal(result.status, "completed")
    assert.equal(result.readbackMatched, true)
    assert.match(result.templateRef || "", GUILD_TEMPLATE_REFERENCE_PATTERN)
    assert.equal(target.getMutationCalls(), 1)
    assert.deepEqual(
      target.activities.map((entry) => entry.status),
      ["pending", "completed"],
    )
    assert.equal(target.operationStore.lastReceipt?.status, "completed")
    const reserveIndex = target.events.lastIndexOf("operation:reserve")
    const pendingIndex = target.events.lastIndexOf("activity:pending")
    const writeIndex = target.events.lastIndexOf(`write:${action}`)
    const readbackIndex = target.events.lastIndexOf("read:readback")
    assert.ok(reserveIndex >= 0 && reserveIndex < pendingIndex)
    assert.ok(pendingIndex < writeIndex)
    assert.ok(writeIndex < readbackIndex)
    const persistent = JSON.stringify({
      activities: target.activities,
      receipts: [...target.operationStore.receipts.values()],
      result,
    })
    for (const secret of [
      PRIVATE_CODE,
      OTHER_PRIVATE_CODE,
      CREATED_PRIVATE_CODE,
      PRIVATE_TEMPLATE_NAME,
      PRIVATE_DESCRIPTION,
      PRIVATE_GUILD_NAME,
      PRIVATE_CHANNEL_NAME,
      PRIVATE_TOPIC,
      "Created template",
      "Created description",
      "Updated template",
    ]) {
      assert.doesNotMatch(persistent, new RegExp(secret))
    }
  })
}

test("snapshot mutations require authoritative clean response evidence", async () => {
  const target = fixture({ state: { mutationLeavesDirty: true } })
  const templateRef = await dirtyReference(target.service)
  const change = request("synchronize", templateRef)
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildTemplateExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(target.getMutationCalls(), 1)
  assert.deepEqual(
    target.activities.map((entry) => entry.status),
    ["pending", "uncertain"],
  )
  assert.equal(target.operationStore.lastReceipt?.status, "uncertain")
})

test("clean synchronization and matching metadata are read-only no-ops", async () => {
  const clean = fixture({
    state: { templates: [template(PRIVATE_CODE, { isDirty: false })] },
  })
  const templateRef = await reference(clean.service)
  const syncRequest = request("synchronize", templateRef)
  const syncPlan = await clean.service.plan(APPLICATION_ID, BOT_ID, syncRequest)
  assert.equal(syncPlan.mutation, "none")
  assert.equal(syncPlan.status, "already-current")
  const syncResult = await clean.service.execute(
    APPLICATION_ID,
    BOT_ID,
    syncRequest,
    syncPlan.digest,
  )
  assert.equal(syncResult.status, "already-current")

  const metadataRequest = request("update-metadata", templateRef, {
    description: PRIVATE_DESCRIPTION,
    name: PRIVATE_TEMPLATE_NAME,
    operationKey: "guild-template-operation-0002",
  })
  const metadataPlan = await clean.service.plan(
    APPLICATION_ID,
    BOT_ID,
    metadataRequest,
  )
  assert.equal(metadataPlan.mutation, "none")
  await clean.service.execute(
    APPLICATION_ID,
    BOT_ID,
    metadataRequest,
    metadataPlan.digest,
  )

  assert.equal(clean.getMutationCalls(), 0)
  assert.deepEqual(clean.activities, [])
  assert.equal(clean.operationStore.receipts.size, 0)
})

test("full private inventory drift invalidates a reviewed Guild Template plan before reservation", async () => {
  const target = fixture()
  const templateRef = await reference(target.service)
  const change = request("delete", templateRef)
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)
  const first = target.state.templates.find((entry) => entry.code === PRIVATE_CODE)
  assert.ok(first)
  first.usageCount += 1

  await assert.rejects(
    () => target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      change,
      plan.digest,
    ),
    GuildTemplatePlanChangedError,
  )
  assert.equal(target.getMutationCalls(), 0)
  assert.equal(target.operationStore.receipts.size, 0)
  assert.deepEqual(target.activities, [])
})

test("a reserved Guild Template operation key cannot be replayed", async () => {
  const target = fixture()
  const templateRef = await reference(target.service)
  const change = request("update-metadata", templateRef, { name: "Updated template" })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)
  await target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest)

  await assert.rejects(
    () => target.service.plan(APPLICATION_ID, BOT_ID, change),
    GuildTemplateOperationConflictError,
  )
  assert.equal(target.getMutationCalls(), 1)
})

test("known Discord rejection is recorded as failed and never retried", async () => {
  const target = fixture({ state: { mutationError: apiError(400) } })
  const templateRef = await reference(target.service)
  const change = request("delete", templateRef)
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildTemplateExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      assert.doesNotMatch(JSON.stringify(error.result), /private-template|private-topic/)
      return true
    },
  )
  assert.equal(target.getMutationCalls(), 1)
  assert.deepEqual(
    target.activities.map((entry) => entry.status),
    ["pending", "failed"],
  )
  assert.equal(target.operationStore.lastReceipt?.status, "failed")
})

test("uncertain Guild Template outcomes quarantine the guild for later execution", async () => {
  const target = fixture({ state: { mutationError: apiError(500) } })
  const templateRef = await reference(target.service)
  const first = request("delete", templateRef)
  const firstPlan = await target.service.plan(APPLICATION_ID, BOT_ID, first)
  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, first, firstPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildTemplateExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  target.state.mutationError = undefined
  const second = request("update-metadata", templateRef, {
    name: "Another update",
    operationKey: "guild-template-operation-0002",
  })
  const secondPlan = await target.service.plan(APPLICATION_ID, BOT_ID, second)
  const eventsBeforeBlockedExecution = target.events.length
  await assert.rejects(
    () => target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      second,
      secondPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildTemplateExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
  assert.equal(target.events.length, eventsBeforeBlockedExecution)
  assert.equal(target.getMutationCalls(), 1)
})

test("a mismatched Guild Template readback is uncertain and capability-safe", async () => {
  const target = fixture({ state: { mutationUpdatesState: false } })
  const templateRef = await reference(target.service)
  const change = request("update-metadata", templateRef, { name: "Updated template" })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildTemplateExecutionError)
      const serialized = JSON.stringify(error.result)
      assert.equal((error.result as { status: string }).status, "uncertain")
      assert.doesNotMatch(serialized, /private-template|private-topic|Updated template/)
      return true
    },
  )
  assert.equal(target.getMutationCalls(), 1)
  assert.equal(target.operationStore.lastReceipt?.status, "uncertain")
})

test("pending activity failure blocks a Guild Template mutation after durable reservation", async () => {
  const target = fixture({ state: { activityFailureAt: 1 } })
  const templateRef = await reference(target.service)
  const change = request("delete", templateRef)
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildTemplateExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(target.getMutationCalls(), 0)
  assert.equal(target.operationStore.lastReceipt?.status, "failed")
  assert.deepEqual(target.activities, [])
})

test("completion-record failure reports a completed Guild Template mutation without retrying", async () => {
  const target = fixture()
  target.operationStore.finishFailureAt = 1
  const templateRef = await reference(target.service)
  const change = request("delete", templateRef)
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, change)

  await assert.rejects(
    () => target.service.execute(APPLICATION_ID, BOT_ID, change, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildTemplateExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-record-failed",
      )
      assert.doesNotMatch(JSON.stringify(error.result), /private-template|private-topic/)
      return true
    },
  )
  assert.equal(target.getMutationCalls(), 1)
  assert.deepEqual(
    target.activities.map((entry) => entry.status),
    ["pending", "completed"],
  )
})
