import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type { DiscordWebhookSummary } from "../src/discord-client.js"
import {
  DiscordApiError,
  PolicyError,
  WebhookChangeExecutionError,
  WebhookCreationExecutionError,
  WebhookEvidenceError,
} from "../src/errors.js"
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
import {
  normalizeWebhookChangeRequest,
  normalizeWebhookCreationRequest,
  normalizeWebhookName,
  WebhookService,
  type WebhookChangeRequest,
  type WebhookCreationRequest,
  type WebhookServiceOptions,
} from "../src/webhook-service.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const SOURCE_CHANNEL_ID = "500000000000000001"
const DESTINATION_CHANNEL_ID = "500000000000000002"
const WEBHOOK_ID = "600000000000000001"
const OTHER_WEBHOOK_ID = "600000000000000002"
const CREATED_WEBHOOK_ID = "600000000000000003"
const CREATOR_ID = "700000000000000001"
const NOW = "2026-08-22T00:00:00.000Z"

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position,
  }
}

function channel(id: string, overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: id === SOURCE_CHANNEL_ID ? "source" : "destination",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function webhook(
  id: string,
  channelId: string,
  name: string,
  overrides: Partial<DiscordWebhookSummary> = {},
): DiscordWebhookSummary {
  return {
    applicationId: APPLICATION_ID,
    channelId,
    creatorUserId: CREATOR_ID,
    guildId: GUILD_ID,
    id,
    name,
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
    ...overrides,
  }
}

function creationRequest(
  overrides: Partial<WebhookCreationRequest> = {},
): WebhookCreationRequest {
  return {
    auditReason: "Reviewed webhook creation",
    channelId: SOURCE_CHANNEL_ID,
    name: "Release relay",
    operationKey: "webhook-creation-operation-0001",
    ...overrides,
  }
}

function changeRequest(
  overrides: Partial<WebhookChangeRequest> = {},
): WebhookChangeRequest {
  return {
    auditReason: "Reviewed webhook metadata change",
    channelId: SOURCE_CHANNEL_ID,
    name: "Deployment relay",
    operationKey: "webhook-change-operation-0001",
    webhookId: WEBHOOK_ID,
    ...overrides,
  }
}

function policy(options: {
  audit?: boolean
  changes?: boolean
  creation?: boolean
  webhookChannels?: readonly string[]
} = {}): ScopePolicy {
  const webhookChannels = options.webhookChannels
    ?? [SOURCE_CHANNEL_ID, DESTINATION_CHANNEL_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(webhookChannels),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowWebhookAudit: options.audit ?? true,
    allowWebhookChanges: options.changes ?? true,
    allowWebhookCreation: options.creation ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
    webhookChannelIds: new Set(webhookChannels),
  })
}

class MemoryOperationStore implements OperationStore {
  readonly receipts = new Map<string, OperationReceipt>()

  async finish(receipt: OperationReceipt): Promise<void> {
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  async get(kind: OperationReceipt["kind"], hash: string) {
    return this.receipts.get(`${kind}:${hash}`)
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  createError: unknown
  createUpdatesState: boolean
  modifyError: unknown
  modifyUpdatesState: boolean
  readbackError: unknown
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const permissions = DISCORD_PERMISSIONS.MANAGE_WEBHOOKS
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
  const state: FixtureState = {
    createError: undefined,
    createUpdatesState: true,
    modifyError: undefined,
    modifyUpdatesState: true,
    readbackError: undefined,
    ...options.state,
  }
  const channels = new Map([
    [SOURCE_CHANNEL_ID, channel(SOURCE_CHANNEL_ID)],
    [DESTINATION_CHANNEL_ID, channel(DESTINATION_CHANNEL_ID)],
  ])
  const inventories = new Map<string, DiscordWebhookSummary[]>([
    [SOURCE_CHANNEL_ID, [
      webhook(WEBHOOK_ID, SOURCE_CHANNEL_ID, "Release relay"),
      webhook(OTHER_WEBHOOK_ID, SOURCE_CHANNEL_ID, "Other relay"),
    ]],
    [DESTINATION_CHANNEL_ID, []],
  ])
  const botMember: DiscordGuildMember = {
    roles: [BOT_ROLE_ID],
    user: { bot: true, id: BOT_ID, username: "connector" },
  }
  const roles = [
    role(GUILD_ID, permissions, 0),
    role(BOT_ROLE_ID, 0n, 10),
  ]
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const operationStore = new MemoryOperationStore()
  let mutationCompleted = false
  const activityStore: ActivityStore = {
    async append(entry) {
      events.push(`activity:${entry.kind}:${entry.status}`)
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const client: WebhookServiceOptions["client"] = {
    async createWebhook(channelId, input, reason) {
      events.push(`write:create:${reason}`)
      if (state.createError) throw state.createError
      mutationCompleted = true
      const created = webhook(CREATED_WEBHOOK_ID, channelId, input.name)
      if (state.createUpdatesState) inventories.get(channelId)?.push(created)
      return created
    },
    async deleteWebhook() {
      throw new Error("unexpected webhook deletion")
    },
    async getChannel(channelId) {
      const result = channels.get(channelId)
      if (!result) throw new Error("channel fixture missing")
      return result
    },
    async getGuild() {
      return { id: GUILD_ID, name: "Private Guild" }
    },
    async getGuildMember() {
      return botMember
    },
    async getGuildRoles() {
      return roles
    },
    async listChannelWebhooks(channelId) {
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return [...(inventories.get(channelId) ?? [])]
    },
    async modifyWebhook(webhookId, input, reason) {
      events.push(`write:modify:${reason}`)
      if (state.modifyError) throw state.modifyError
      mutationCompleted = true
      const source = inventories.get(SOURCE_CHANNEL_ID) ?? []
      const current = source.find((entry) => entry.id === webhookId)
      if (!current) throw new Error("webhook fixture missing")
      const destinationChannelId = input.channelId ?? SOURCE_CHANNEL_ID
      const modified = {
        ...current,
        channelId: destinationChannelId,
        name: input.name ?? current.name,
      }
      if (state.modifyUpdatesState) {
        inventories.set(
          SOURCE_CHANNEL_ID,
          source.filter((entry) => entry.id !== webhookId),
        )
        const destination = destinationChannelId === SOURCE_CHANNEL_ID
          ? inventories.get(SOURCE_CHANNEL_ID) ?? []
          : inventories.get(destinationChannelId) ?? []
        destination.push(modified)
        inventories.set(destinationChannelId, destination)
      }
      return modified
    },
  }
  const service = new WebhookService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(9),
    policy: options.policy ?? policy(),
    randomId: () => "activity-webhook-admin-0001",
  })
  return { activities, events, inventories, operationStore, service, state }
}

test("webhook administration normalizes exact names and request fields", () => {
  assert.equal(normalizeWebhookName("Release relay"), "Release relay")
  assert.throws(() => normalizeWebhookName(" discord relay"), /invalid/)
  assert.throws(() => normalizeWebhookName("Clyde relay"), /invalid/)
  assert.throws(() => normalizeWebhookName("release  relay"), /invalid/)
  assert.throws(() => normalizeWebhookName("release\nrelay"), /invalid/)
  assert.equal(
    normalizeWebhookCreationRequest(creationRequest()).operationKeyHash.length,
    71,
  )
  assert.deepEqual(
    normalizeWebhookChangeRequest(changeRequest({
      destinationChannelId: DESTINATION_CHANNEL_ID,
    })).requestedFields,
    ["channelId", "name"],
  )
  const emptyChange = changeRequest()
  delete emptyChange.name
  assert.throws(
    () => normalizeWebhookChangeRequest(emptyChange),
    /requires a name or destination/,
  )
})

test("webhook creation plans complete credential-redacted evidence", async () => {
  const { service } = fixture()
  const plan = await service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    creationRequest(),
  )

  assert.equal(plan.action, "create")
  assert.equal(plan.source.channel.id, SOURCE_CHANNEL_ID)
  assert.equal(plan.source.permission.manageWebhooks, true)
  assert.equal(plan.source.webhooks.length, 2)
  assert.equal(plan.desired.name, "Release relay")
  assert.equal(plan.privacy.credentialsProjectedOut, true)
  assert.match(plan.digest, /^hmac-sha256:/)
  assert.ok(plan.risks.some((risk) => /bearer capability/.test(risk)))
})

test("webhook creation executes once and verifies the complete inventory", async () => {
  const setup = fixture()
  const request = creationRequest()
  const plan = await setup.service.planCreation(APPLICATION_ID, BOT_ID, request)
  const result = await setup.service.executeCreation(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.created.webhookId, CREATED_WEBHOOK_ID)
  assert.equal(result.readbackMatched, true)
  assert.equal(result.inventoryMatched, true)
  assert.equal(setup.activities[0]?.kind, "webhook-creation")
  assert.equal(setup.activities.at(-1)?.status, "completed")
  const serialized = JSON.stringify({
    activities: setup.activities,
    receipt: [...setup.operationStore.receipts.values()],
  })
  assert.equal(serialized.includes("Release relay"), false)
  assert.equal(serialized.includes("Reviewed webhook creation"), false)
})

test("webhook creation reports response-confirmed inventory drift", async () => {
  const setup = fixture({ state: { createUpdatesState: false } })
  const request = creationRequest()
  const plan = await setup.service.planCreation(APPLICATION_ID, BOT_ID, request)
  const result = await setup.service.executeCreation(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, false)
  assert.equal(result.inventoryMatched, false)
})

test("webhook creation treats rate limits and readback failures as uncertain", async () => {
  const rateLimited = fixture()
  const rateRequest = creationRequest()
  const ratePlan = await rateLimited.service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    rateRequest,
  )
  rateLimited.state.createError = new DiscordApiError({
    message: "rate limited",
    method: "POST",
    route: "/channels/{channel.id}/webhooks",
    status: 429,
  })
  await assert.rejects(
    () => rateLimited.service.executeCreation(
      APPLICATION_ID,
      BOT_ID,
      rateRequest,
      ratePlan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookCreationExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )

  const readback = fixture({ state: { readbackError: new Error("offline") } })
  const readbackRequest = creationRequest({
    operationKey: "webhook-creation-operation-0002",
  })
  const readbackPlan = await readback.service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    readbackRequest,
  )
  await assert.rejects(
    () => readback.service.executeCreation(
      APPLICATION_ID,
      BOT_ID,
      readbackRequest,
      readbackPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookCreationExecutionError
      && (error.result as { status: string; webhookId: string }).status === "uncertain"
      && (error.result as { webhookId: string }).webhookId === CREATED_WEBHOOK_ID
    ),
  )
})

test("webhook changes plan and execute an exact same-guild move and rename", async () => {
  const setup = fixture()
  const request = changeRequest({ destinationChannelId: DESTINATION_CHANNEL_ID })
  const plan = await setup.service.planChange(APPLICATION_ID, BOT_ID, request)

  assert.deepEqual(plan.changedFields, ["channelId", "name"])
  assert.equal(plan.destination?.channel.id, DESTINATION_CHANNEL_ID)
  assert.equal(plan.current.channelId, SOURCE_CHANNEL_ID)
  assert.equal(plan.desired.channelId, DESTINATION_CHANNEL_ID)

  const result = await setup.service.executeChange(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, true)
  assert.equal(result.sourceTargetAbsent, true)
  assert.equal(result.inventoryMatched, true)
  assert.equal(
    setup.inventories.get(DESTINATION_CHANNEL_ID)?.[0]?.name,
    "Deployment relay",
  )
  const serialized = JSON.stringify({
    activities: setup.activities,
    receipt: [...setup.operationStore.receipts.values()],
  })
  assert.equal(serialized.includes("Deployment relay"), false)
  assert.equal(serialized.includes("Reviewed webhook metadata change"), false)
})

test("already-current webhook changes need no write or durable record", async () => {
  const setup = fixture()
  const request = changeRequest({ name: "Release relay" })
  const plan = await setup.service.planChange(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.status, "already-current")
  assert.equal(plan.writeRequired, false)

  const result = await setup.service.executeChange(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(result.sourceTargetAbsent, false)
  assert.deepEqual(setup.activities, [])
  assert.equal(setup.events.some((event) => event.startsWith("write:")), false)
})

test("webhook changes reject unsafe targets and destination scope", async () => {
  const disabled = fixture({ policy: policy({ changes: false }) })
  await assert.rejects(
    () => disabled.service.planChange(APPLICATION_ID, BOT_ID, changeRequest()),
    PolicyError,
  )

  const narrow = fixture({
    policy: policy({ webhookChannels: [SOURCE_CHANNEL_ID] }),
  })
  await assert.rejects(
    () => narrow.service.planChange(
      APPLICATION_ID,
      BOT_ID,
      changeRequest({ destinationChannelId: DESTINATION_CHANNEL_ID }),
    ),
    PolicyError,
  )

  const unsupported = fixture()
  unsupported.inventories.set(SOURCE_CHANNEL_ID, [
    webhook(WEBHOOK_ID, SOURCE_CHANNEL_ID, "Follower", { type: 2 }),
  ])
  await assert.rejects(
    () => unsupported.service.planChange(APPLICATION_ID, BOT_ID, changeRequest()),
    WebhookEvidenceError,
  )
})

test("webhook change readback failures retain an uncertain outcome", async () => {
  const setup = fixture({ state: { readbackError: new Error("offline") } })
  const request = changeRequest({ destinationChannelId: DESTINATION_CHANNEL_ID })
  const plan = await setup.service.planChange(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    () => setup.service.executeChange(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookChangeExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal(setup.activities.at(-1)?.status, "uncertain")
})
