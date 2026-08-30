import assert from "node:assert/strict"
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import type {
  DiscordGuildEmojiSummary,
  DiscordGuildStickerSummary,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  GuildExpressionEvidenceError,
  GuildExpressionExecutionError,
  GuildExpressionOperationConflictError,
  GuildExpressionPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import {
  GuildExpressionService,
  normalizeGuildExpressionChangeRequest,
  type GuildExpressionChangeRequest,
  type GuildExpressionServiceOptions,
} from "../src/guild-expression-service.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordGuildMember, DiscordRole } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OTHER_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const OTHER_USER_ID = "300000000000000002"
const BOT_ROLE_ID = "400000000000000001"
const RESTRICTION_ROLE_ID = "400000000000000002"
const EMOJI_ID = "500000000000000001"
const STICKER_ID = "600000000000000001"
const AUDIT_REASON = "Reviewed guild expression change"
const OPERATION_KEY = "guild-expression-operation-0001"
const NOW = "2026-08-21T12:00:00.000Z"
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    u32(data.byteLength),
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ])
}

function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IEND"),
  ])
}

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: id === BOT_ROLE_ID,
    name: id === GUILD_ID ? "@everyone" : `role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function emoji(
  overrides: Partial<DiscordGuildEmojiSummary> = {},
): DiscordGuildEmojiSummary {
  return {
    animated: false,
    available: true,
    creatorUserId: BOT_ID,
    id: EMOJI_ID,
    managed: false,
    name: "wave",
    requiresColons: true,
    roleIds: [RESTRICTION_ROLE_ID],
    ...overrides,
  }
}

function sticker(
  overrides: Partial<DiscordGuildStickerSummary> = {},
): DiscordGuildStickerSummary {
  return {
    available: true,
    creatorUserId: BOT_ID,
    description: "Friendly wave",
    formatType: 1,
    guildId: GUILD_ID,
    id: STICKER_ID,
    name: "Wave Sticker",
    tags: "wave",
    type: 2,
    ...overrides,
  }
}

function updateEmojiRequest(
  overrides: Partial<GuildExpressionChangeRequest> = {},
): GuildExpressionChangeRequest {
  return {
    action: "update",
    auditReason: AUDIT_REASON,
    expressionId: EMOJI_ID,
    guildId: GUILD_ID,
    kind: "emoji",
    name: "hello",
    operationKey: OPERATION_KEY,
    ...overrides,
  } as GuildExpressionChangeRequest
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
    allowGuildExpressionAudit: options.audit ?? true,
    allowGuildExpressionChanges: options.changes ?? true,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    guildExpressionGuildIds: new Set(options.guildIds || [GUILD_ID]),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
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
  createdEmojiId: string
  emojis: DiscordGuildEmojiSummary[]
  guildFeatures: string[] | undefined
  guildId: string
  guildName: string
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  ownerId: string
  preserveDeletion: boolean
  readbackError: unknown
  roles: DiscordRole[]
  stickers: DiscordGuildStickerSummary[]
}

function fixture(options: {
  fileRoots?: readonly string[]
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS
    | DISCORD_PERMISSIONS.MANAGE_GUILD_EXPRESSIONS
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    createdEmojiId: "500000000000000099",
    emojis: [emoji()],
    guildFeatures: [],
    guildId: GUILD_ID,
    guildName: "Private Guild Name",
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    ownerId: OTHER_USER_ID,
    preserveDeletion: false,
    readbackError: undefined,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, permissions, 10),
      role(RESTRICTION_ROLE_ID, 0n, 5),
    ],
    stickers: [sticker()],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let mutated = false
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
    mutated = true
  }
  const readback = () => {
    if (mutated && state.readbackError) throw state.readbackError
  }
  const client: GuildExpressionServiceOptions["client"] = {
    async createGuildEmoji(_guildId, input) {
      await mutate("write:emoji:create")
      const created = emoji({
        animated: input.format === "gif",
        creatorUserId: BOT_ID,
        id: state.createdEmojiId,
        name: input.name,
        roleIds: [...input.roleIds],
      })
      state.emojis.push(created)
      return created
    },
    async createGuildSticker(_guildId, input) {
      await mutate("write:sticker:create")
      const created = sticker({
        creatorUserId: BOT_ID,
        description: input.description,
        formatType: { apng: 2, gif: 4, lottie: 3, png: 1 }[input.format],
        id: "600000000000000099",
        name: input.name,
        tags: input.tags,
      })
      state.stickers.push(created)
      return created
    },
    async deleteGuildEmoji(_guildId, expressionId) {
      await mutate("write:emoji:delete")
      if (!state.preserveDeletion) {
        state.emojis = state.emojis.filter((entry) => entry.id !== expressionId)
      }
    },
    async deleteGuildSticker(_guildId, expressionId) {
      await mutate("write:sticker:delete")
      if (!state.preserveDeletion) {
        state.stickers = state.stickers.filter((entry) => entry.id !== expressionId)
      }
    },
    async getGuild() {
      events.push("read:guild")
      return {
        ...(state.guildFeatures !== undefined ? { features: state.guildFeatures } : {}),
        id: state.guildId,
        name: state.guildName,
        owner_id: state.ownerId,
      }
    },
    async getGuildEmoji(_guildId, expressionId) {
      events.push("read:emoji:get")
      readback()
      const found = state.emojis.find((entry) => entry.id === expressionId)
      if (!found) throw new Error("emoji absent")
      return found
    },
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async getGuildSticker(_guildId, expressionId) {
      events.push("read:sticker:get")
      readback()
      const found = state.stickers.find((entry) => entry.id === expressionId)
      if (!found) throw new Error("sticker absent")
      return found
    },
    async listGuildEmojis() {
      events.push(mutated ? "read:emoji:readback" : "read:emoji:list")
      readback()
      return state.emojis
    },
    async listGuildStickers() {
      events.push(mutated ? "read:sticker:readback" : "read:sticker:list")
      readback()
      return state.stickers
    },
    async modifyGuildEmoji(_guildId, expressionId, input) {
      await mutate("write:emoji:update")
      const index = state.emojis.findIndex((entry) => entry.id === expressionId)
      const current = state.emojis[index]
      if (!current) throw new Error("emoji absent")
      const updated = {
        ...current,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.roleIds !== undefined ? { roleIds: [...input.roleIds] } : {}),
      }
      state.emojis[index] = updated
      return updated
    },
    async modifyGuildSticker(_guildId, expressionId, input) {
      await mutate("write:sticker:update")
      const index = state.stickers.findIndex((entry) => entry.id === expressionId)
      const current = state.stickers[index]
      if (!current) throw new Error("sticker absent")
      const updated = {
        ...current,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      }
      state.stickers[index] = updated
      return updated
    },
  }
  const service = new GuildExpressionService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    fileRoots: options.fileRoots || [],
    operationStore,
    planKey: Buffer.alloc(32, 7),
    policy: options.policy || policy(),
    randomId: () => "expression-activity-0001",
  })
  return { activities, events, operationStore, service, state }
}

test("guild expression requests normalize every action without retaining raw operation keys", () => {
  const requests: GuildExpressionChangeRequest[] = [{
    action: "create",
    auditReason: AUDIT_REASON,
    filePath: "/safe/emoji.png",
    guildId: GUILD_ID,
    kind: "emoji",
    name: "wave",
    operationKey: OPERATION_KEY,
    roleIds: [RESTRICTION_ROLE_ID],
  }, {
    action: "update",
    auditReason: AUDIT_REASON,
    expressionId: EMOJI_ID,
    guildId: GUILD_ID,
    kind: "emoji",
    operationKey: OPERATION_KEY,
    roleIds: [],
  }, {
    action: "delete",
    auditReason: AUDIT_REASON,
    expressionId: EMOJI_ID,
    guildId: GUILD_ID,
    kind: "emoji",
    operationKey: OPERATION_KEY,
  }, {
    action: "create",
    auditReason: AUDIT_REASON,
    description: "Friendly wave",
    filePath: "/safe/sticker.png",
    guildId: GUILD_ID,
    kind: "sticker",
    name: "Wave Sticker",
    operationKey: OPERATION_KEY,
    tags: "wave",
  }, {
    action: "update",
    auditReason: AUDIT_REASON,
    description: null,
    expressionId: STICKER_ID,
    guildId: GUILD_ID,
    kind: "sticker",
    operationKey: OPERATION_KEY,
  }, {
    action: "delete",
    auditReason: AUDIT_REASON,
    expressionId: STICKER_ID,
    guildId: GUILD_ID,
    kind: "sticker",
    operationKey: OPERATION_KEY,
  }]

  for (const request of requests) {
    const normalized = normalizeGuildExpressionChangeRequest(request)
    assert.equal("operationKey" in normalized, false)
    assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  }
  assert.throws(
    () => normalizeGuildExpressionChangeRequest(updateEmojiRequest({ name: "bad-name" })),
    /ASCII letters/,
  )
  assert.throws(
    () => normalizeGuildExpressionChangeRequest({
      action: "update",
      auditReason: AUDIT_REASON,
      expressionId: EMOJI_ID,
      guildId: GUILD_ID,
      kind: "emoji",
      operationKey: OPERATION_KEY,
    }),
    /must contain a name or role IDs/,
  )
  assert.throws(
    () => normalizeGuildExpressionChangeRequest({
      action: "create",
      auditReason: AUDIT_REASON,
      description: null,
      filePath: "/safe/sticker.png",
      guildId: GUILD_ID,
      kind: "sticker",
      name: "Wave Sticker",
      operationKey: OPERATION_KEY,
      tags: "wave",
    } as unknown as GuildExpressionChangeRequest),
    /creation description must be a string/,
  )
})

test("guild expression reads expose bounded privacy-safe inventory and permission evidence", async () => {
  const privateUrl = "https://cdn.discord.test/private"
  const { service } = fixture()

  const inventory = await service.list(BOT_ID, GUILD_ID, "emoji")
  const lookup = await service.get(BOT_ID, GUILD_ID, "sticker", STICKER_ID)

  assert.equal(inventory.page.returned, 1)
  assert.equal(inventory.permission.manageGuildExpressions, true)
  assert.deepEqual(inventory.privacy.omittedFields, [
    "cdnUrl",
    "imageBytes",
    "rawDiscordObject",
    "uploaderProfile",
  ])
  assert.equal(lookup.expression.expressionId, STICKER_ID)
  assert.equal(JSON.stringify({ inventory, lookup }).includes(privateUrl), false)
})

test("guild expression policy separates audit from changes and exact guild scope", async () => {
  const auditOnly = fixture({ policy: policy({ changes: false }) }).service
  await auditOnly.list(BOT_ID, GUILD_ID, "emoji")
  await assert.rejects(
    auditOnly.plan(APPLICATION_ID, BOT_ID, updateEmojiRequest()),
    PolicyError,
  )

  const disabled = fixture({ policy: policy({ audit: false, changes: false }) }).service
  await assert.rejects(disabled.list(BOT_ID, GUILD_ID, "emoji"), PolicyError)
  await assert.rejects(
    fixture({ policy: policy({ guildIds: [OTHER_GUILD_ID] }) }).service
      .list(BOT_ID, GUILD_ID, "emoji"),
    PolicyError,
  )
})

test("guild expression create plans bind owned local bytes and execute after pending audit", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-expression-service-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "hello.png")
  await writeFile(filePath, png(128, 128))
  const { activities, events, operationStore, service } = fixture({
    fileRoots: [root],
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS, 10),
        role(RESTRICTION_ROLE_ID, 0n, 5),
      ],
    },
  })
  const request: GuildExpressionChangeRequest = {
    action: "create",
    auditReason: AUDIT_REASON,
    filePath,
    guildId: GUILD_ID,
    kind: "emoji",
    name: "hello",
    operationKey: OPERATION_KEY,
    roleIds: [RESTRICTION_ROLE_ID],
  }

  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.effect, "change")
  assert.equal(plan.desired?.expressionId, null)
  assert.equal(plan.permission.manageGuildExpressions, false)
  assert.equal(plan.permission.ownershipRequired, false)
  assert.equal(plan.file?.review.canonicalPath, filePath)
  assert.match(plan.file?.contentDigest || "", /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  const result = await service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)
  assert.equal(result.status, "completed")
  assert.equal(result.expressionId, "500000000000000099")
  assert.deepEqual(events.slice(-6), [
    "operation:reserve",
    "activity:pending",
    "write:emoji:create",
    "read:emoji:get",
    "operation:completed",
    "activity:completed",
  ])
  assert.equal(activities.at(-1)?.status, "completed")
  const receipt = await operationStore.get(
    "guild-expression-change",
    plan.operationKeyHash,
  )
  assert.equal(receipt?.resourceId, "500000000000000099")
  assert.equal(receipt?.verification, "match")
})

test("guild expression update uses ownership authority and returns no-op without a write", async () => {
  const createOnlyPermissions = DISCORD_PERMISSIONS.CREATE_GUILD_EXPRESSIONS
  const owned = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, createOnlyPermissions, 10),
        role(RESTRICTION_ROLE_ID, 0n, 5),
      ],
    },
  })
  const noOpRequest = updateEmojiRequest({ name: "wave" })
  const plan = await owned.service.plan(APPLICATION_ID, BOT_ID, noOpRequest)
  const result = await owned.service.execute(
    APPLICATION_ID,
    BOT_ID,
    noOpRequest,
    plan.digest,
  )
  assert.equal(plan.effect, "none")
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(owned.events.some((event) => event.startsWith("write:")), false)

  const foreign = fixture({
    state: {
      emojis: [emoji({ creatorUserId: OTHER_USER_ID })],
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, createOnlyPermissions, 10),
        role(RESTRICTION_ROLE_ID, 0n, 5),
      ],
    },
  })
  await assert.rejects(
    foreign.service.plan(APPLICATION_ID, BOT_ID, updateEmojiRequest()),
    GuildExpressionEvidenceError,
  )
})

test("guild expression creation requires CREATE_GUILD_EXPRESSIONS even with management authority", async () => {
  const manageOnly = DISCORD_PERMISSIONS.MANAGE_GUILD_EXPRESSIONS
  const { service } = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, manageOnly, 10),
        role(RESTRICTION_ROLE_ID, 0n, 5),
      ],
    },
  })

  await assert.rejects(
    service.plan(APPLICATION_ID, BOT_ID, {
      action: "create",
      auditReason: AUDIT_REASON,
      filePath: "/not-read-without-create-permission.png",
      guildId: GUILD_ID,
      kind: "emoji",
      name: "new_emoji",
      operationKey: OPERATION_KEY,
    }),
    /lacks CREATE_GUILD_EXPRESSIONS/,
  )

  const update = updateEmojiRequest()
  const updatePlan = await service.plan(APPLICATION_ID, BOT_ID, update)
  assert.equal(updatePlan.effect, "change")
})

test("guild expression planning requires fresh eligible guild features for Lottie stickers", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-expression-lottie-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "sticker.json")
  await writeFile(filePath, JSON.stringify({ fr: 30, h: 320, ip: 0, op: 30, w: 320 }))
  const request: GuildExpressionChangeRequest = {
    action: "create",
    auditReason: AUDIT_REASON,
    description: "Reviewed Lottie sticker",
    filePath,
    guildId: GUILD_ID,
    kind: "sticker",
    name: "Lottie Sticker",
    operationKey: OPERATION_KEY,
    tags: "lottie",
  }

  await assert.rejects(
    fixture({ fileRoots: [root], state: { guildFeatures: [] } }).service
      .plan(APPLICATION_ID, BOT_ID, request),
    /require a VERIFIED or PARTNERED guild feature/,
  )
  await assert.rejects(
    fixture({ fileRoots: [root], state: { guildFeatures: undefined } }).service
      .plan(APPLICATION_ID, BOT_ID, request),
    /incomplete Lottie sticker guild-feature evidence/,
  )
  const plan = await fixture({
    fileRoots: [root],
    state: { guildFeatures: ["PARTNERED"] },
  }).service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.file?.review.format, "lottie")
  assert.match(plan.warnings.join("\n"), /confirms eligibility for Lottie sticker upload/)
})

test("guild expression delete distinguishes exact absence from server drift", async () => {
  const { activities, service, state } = fixture()
  const request: GuildExpressionChangeRequest = {
    action: "delete",
    auditReason: AUDIT_REASON,
    expressionId: STICKER_ID,
    guildId: GUILD_ID,
    kind: "sticker",
    operationKey: OPERATION_KEY,
  }
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  const result = await service.execute(APPLICATION_ID, BOT_ID, request, plan.digest)
  assert.equal(result.status, "completed")
  assert.equal(result.observed, null)
  assert.equal(state.stickers.length, 0)
  assert.equal(activities.at(-1)?.status, "completed")

  const drifted = fixture({ state: { preserveDeletion: true } })
  const driftedPlan = await drifted.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  const driftedResult = await drifted.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    driftedPlan.digest,
  )
  assert.equal(driftedResult.status, "completed-with-drift")
  assert.equal(driftedResult.observed?.expressionId, STICKER_ID)
  const driftActivity = drifted.activities.at(-1)
  assert.equal(driftActivity?.kind, "guild-expression-change")
  if (driftActivity?.kind !== "guild-expression-change") {
    throw new Error("Expected guild expression activity")
  }
  assert.equal(driftActivity.status, "completed-with-drift")
  assert.equal(driftActivity.verification, "drift")
})

test("guild expression execution covers sticker creation and update plus emoji deletion", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-expression-actions-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "new-sticker.png")
  await writeFile(filePath, png(320, 320))

  const stickerCreation = fixture({ fileRoots: [root] })
  const createRequest: GuildExpressionChangeRequest = {
    action: "create",
    auditReason: AUDIT_REASON,
    description: "New sticker",
    filePath,
    guildId: GUILD_ID,
    kind: "sticker",
    name: "New Sticker",
    operationKey: "guild-expression-sticker-create-0001",
    tags: "new",
  }
  const createPlan = await stickerCreation.service.plan(
    APPLICATION_ID,
    BOT_ID,
    createRequest,
  )
  const createResult = await stickerCreation.service.execute(
    APPLICATION_ID,
    BOT_ID,
    createRequest,
    createPlan.digest,
  )
  assert.equal(createResult.status, "completed")
  assert.equal(createResult.observed?.kind, "sticker")
  assert.equal(createResult.observed?.name, "New Sticker")

  const stickerUpdate = fixture()
  const updateRequest: GuildExpressionChangeRequest = {
    action: "update",
    auditReason: AUDIT_REASON,
    description: null,
    expressionId: STICKER_ID,
    guildId: GUILD_ID,
    kind: "sticker",
    operationKey: "guild-expression-sticker-update-0001",
    tags: "updated",
  }
  const updatePlan = await stickerUpdate.service.plan(
    APPLICATION_ID,
    BOT_ID,
    updateRequest,
  )
  const updateResult = await stickerUpdate.service.execute(
    APPLICATION_ID,
    BOT_ID,
    updateRequest,
    updatePlan.digest,
  )
  assert.equal(updateResult.status, "completed")
  assert.equal(
    updateResult.observed?.kind === "sticker"
      ? updateResult.observed.description
      : undefined,
    null,
  )

  const emojiDeletion = fixture()
  const deleteRequest: GuildExpressionChangeRequest = {
    action: "delete",
    auditReason: AUDIT_REASON,
    expressionId: EMOJI_ID,
    guildId: GUILD_ID,
    kind: "emoji",
    operationKey: "guild-expression-emoji-delete-0001",
  }
  const deletePlan = await emojiDeletion.service.plan(
    APPLICATION_ID,
    BOT_ID,
    deleteRequest,
  )
  const deleteResult = await emojiDeletion.service.execute(
    APPLICATION_ID,
    BOT_ID,
    deleteRequest,
    deletePlan.digest,
  )
  assert.equal(deleteResult.status, "completed")
  assert.equal(deleteResult.observed, null)
})

test("guild expression execution rejects stale plans and reserved operation keys", async () => {
  const stale = fixture()
  const request = updateEmojiRequest()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, request)
  stale.state.emojis[0] = emoji({ name: "changed" })
  await assert.rejects(
    stale.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    GuildExpressionPlanChangedError,
  )
  assert.equal(stale.events.some((event) => event.startsWith("write:")), false)

  const conflict = fixture()
  const conflictPlan = await conflict.service.plan(APPLICATION_ID, BOT_ID, request)
  await conflict.operationStore.reserve({
    activityId: "existing-activity",
    error: null,
    guildId: GUILD_ID,
    kind: "guild-expression-change",
    operationKeyHash: conflictPlan.operationKeyHash,
    planDigest: conflictPlan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    conflict.service.execute(APPLICATION_ID, BOT_ID, request, conflictPlan.digest),
    GuildExpressionOperationConflictError,
  )
})

test("guild expression execution treats an invalidated creation file as a changed plan", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-expression-replan-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "planned.png")
  await writeFile(filePath, png(128, 128))
  const { events, service } = fixture({ fileRoots: [root] })
  const request: GuildExpressionChangeRequest = {
    action: "create",
    auditReason: AUDIT_REASON,
    filePath,
    guildId: GUILD_ID,
    kind: "emoji",
    name: "planned_emoji",
    operationKey: OPERATION_KEY,
  }
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)
  await writeFile(filePath, "not an image")

  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    GuildExpressionPlanChangedError,
  )
  assert.equal(events.some((event) => event.startsWith("write:")), false)
  assert.equal(events.includes("operation:reserve"), false)
})

test("guild expression creation records an uncertain terminal outcome for a malformed success identity", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-expression-identity-"))
  context.after(() => rm(temporary, { force: true, recursive: true }))
  const root = await realpath(temporary)
  const filePath = join(root, "identity.png")
  await writeFile(filePath, png(128, 128))
  const { activities, operationStore, service } = fixture({
    fileRoots: [root],
    state: { createdEmojiId: "" },
  })
  const request: GuildExpressionChangeRequest = {
    action: "create",
    auditReason: AUDIT_REASON,
    filePath,
    guildId: GUILD_ID,
    kind: "emoji",
    name: "identity_emoji",
    operationKey: OPERATION_KEY,
  }
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof GuildExpressionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  const receipt = await operationStore.get(
    "guild-expression-change",
    plan.operationKeyHash,
  )
  assert.equal(receipt?.status, "uncertain")
  assert.equal(receipt?.resourceId, null)
  assert.equal(activities.at(-1)?.status, "uncertain")
})

test("guild expression execution classifies deterministic rejection and uncertain readback", async () => {
  const deterministic = fixture({
    state: {
      mutationError: new DiscordApiError({
        code: 50013,
        message: "missing permissions",
        method: "PATCH",
        route: "/guilds/200/emojis/500",
        status: 403,
      }),
    },
  })
  const request = updateEmojiRequest()
  const plan = await deterministic.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    deterministic.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof GuildExpressionExecutionError
      && (error.result as { status: string }).status === "failed"
    ),
  )

  const uncertain = fixture({ state: { readbackError: new Error("readback unavailable") } })
  const uncertainPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    uncertain.service.execute(APPLICATION_ID, BOT_ID, request, uncertainPlan.digest),
    (error: unknown) => (
      error instanceof GuildExpressionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
})

test("guild expression execution blocks writes when pending activity cannot be recorded", async () => {
  const blocked = fixture({ state: { activityFailureAt: 1 } })
  const request = updateEmojiRequest()
  const plan = await blocked.service.plan(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    blocked.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof GuildExpressionExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(blocked.events.some((event) => event.startsWith("write:")), false)
  const receipt = await blocked.operationStore.get(
    "guild-expression-change",
    plan.operationKeyHash,
  )
  assert.equal(receipt?.status, "failed")
})

test("guild expression execution preserves completion evidence when receipt finalization fails", async () => {
  const completed = fixture()
  const request = updateEmojiRequest()
  const plan = await completed.service.plan(APPLICATION_ID, BOT_ID, request)
  completed.operationStore.finishFailure = new Error("operation store unavailable")

  await assert.rejects(
    completed.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof GuildExpressionExecutionError
      && (error.result as {
        activityRecordError: string | null
        status: string
      }).status === "completed-operation-record-failed"
      && (error.result as { activityRecordError: string | null }).activityRecordError === null
    ),
  )
  assert.equal(completed.events.filter((event) => event.startsWith("write:")).length, 1)
  assert.equal(completed.activities.at(-1)?.status, "completed")
  assert.equal(completed.activities.at(-1)?.error, "Error")

  const auditFailed = fixture({ state: { activityFailureAt: 2 } })
  const auditPlan = await auditFailed.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  await assert.rejects(
    auditFailed.service.execute(APPLICATION_ID, BOT_ID, request, auditPlan.digest),
    (error: unknown) => (
      error instanceof GuildExpressionExecutionError
      && (error.result as { status: string }).status === "completed-audit-failed"
    ),
  )
  const receipt = await auditFailed.operationStore.get(
    "guild-expression-change",
    auditPlan.operationKeyHash,
  )
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.verification, "match")
})

test("guild expression execution blocks queued same-guild work after uncertainty", async () => {
  let releaseMutation: () => void = () => undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  let reportMutationStarted: () => void = () => undefined
  const mutationStarted = new Promise<void>((resolve) => {
    reportMutationStarted = resolve
  })
  const queued = fixture({
    state: {
      mutationGate,
      mutationStarted: reportMutationStarted,
      readbackError: new Error("readback unavailable"),
    },
  })
  const firstRequest = updateEmojiRequest()
  const secondRequest = updateEmojiRequest({
    name: "second",
    operationKey: "guild-expression-operation-0002",
  })
  const firstPlan = await queued.service.plan(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
  )
  const secondPlan = await queued.service.plan(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
  )

  const firstExecution = queued.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await mutationStarted
  const secondExecution = queued.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  releaseMutation()

  await assert.rejects(
    firstExecution,
    (error: unknown) => (
      error instanceof GuildExpressionExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  await assert.rejects(
    secondExecution,
    (error: unknown) => (
      error instanceof GuildExpressionExecutionError
      && (error.result as { status: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(queued.events.filter((event) => event.startsWith("write:")).length, 1)
  const secondHash = normalizeGuildExpressionChangeRequest(secondRequest).operationKeyHash
  assert.equal(
    await queued.operationStore.get("guild-expression-change", secondHash),
    undefined,
  )
})

test("guild expression planning rejects managed emojis, missing roles, and malformed evidence", async () => {
  await assert.rejects(
    fixture({ state: { emojis: [emoji({ managed: true })] } }).service
      .plan(APPLICATION_ID, BOT_ID, updateEmojiRequest()),
    /managed emojis/,
  )
  await assert.rejects(
    fixture().service.plan(APPLICATION_ID, BOT_ID, {
      action: "update",
      auditReason: AUDIT_REASON,
      expressionId: EMOJI_ID,
      guildId: GUILD_ID,
      kind: "emoji",
      operationKey: OPERATION_KEY,
      roleIds: ["499999999999999999"],
    }),
    /absent from the exact guild inventory/,
  )
  await assert.rejects(
    fixture({ state: { guildId: OTHER_GUILD_ID } }).service
      .list(BOT_ID, GUILD_ID, "emoji"),
    GuildExpressionEvidenceError,
  )
  await assert.rejects(
    fixture({
      state: {
        emojis: [
          emoji(),
          emoji({ id: "500000000000000002", name: "HELLO" }),
        ],
      },
    }).service.plan(APPLICATION_ID, BOT_ID, updateEmojiRequest({ name: "hello" })),
    /update conflicts with an existing normalized name/,
  )
})
