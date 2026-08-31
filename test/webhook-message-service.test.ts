import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
  WebhookMessageActivity,
} from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_MESSAGE_FLAGS,
} from "../src/constants.js"
import type {
  DiscordAllowedMentions,
  DiscordWebhookSummary,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  WebhookMessageExecutionError,
  WebhookMessageOperationConflictError,
  WebhookMessagePlanChangedError,
} from "../src/errors.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordMessage,
} from "../src/types.js"
import {
  normalizeWebhookMessageDeletionRequest,
  normalizeWebhookMessageEditRequest,
  normalizeWebhookMessageSendRequest,
  WebhookMessageService,
  type WebhookMessageDeletionRequest,
  type WebhookMessageEditRequest,
  type WebhookMessageSendRequest,
  type WebhookMessageServiceOptions,
} from "../src/webhook-message-service.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const OTHER_CHANNEL_ID = "400000000000000002"
const WEBHOOK_ID = "500000000000000001"
const MESSAGE_ID = "600000000000000001"
const CREATED_MESSAGE_ID = "600000000000000002"
const USER_ID = "700000000000000001"
const OTHER_USER_ID = "700000000000000002"
const TOKEN = "private-webhook-token-canary"
const NOW = "2026-08-25T00:00:00.000Z"

function webhook(overrides: Partial<DiscordWebhookSummary> = {}): DiscordWebhookSummary {
  return {
    applicationId: null,
    channelId: CHANNEL_ID,
    creatorUserId: BOT_ID,
    guildId: GUILD_ID,
    id: WEBHOOK_ID,
    name: "Private relay",
    sourceChannelId: null,
    sourceGuildId: null,
    type: 1,
    ...overrides,
  }
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-channel",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function message(
  id: string,
  content: string,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: { bot: true, id: WEBHOOK_ID, username: "Private relay" },
    channel_id: CHANNEL_ID,
    components: [],
    content,
    embeds: [],
    flags: DISCORD_MESSAGE_FLAGS.suppressEmbeds,
    guild_id: GUILD_ID,
    id,
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    sticker_items: [],
    timestamp: NOW,
    tts: false,
    type: 0,
    webhook_id: WEBHOOK_ID,
    ...overrides,
  }
}

function policy(overrides: {
  audit?: boolean
  changes?: boolean
  deletions?: boolean
  delivery?: boolean
  messageChannels?: readonly string[]
  notifyIds?: readonly string[]
  userMentionMode?: "allowlist" | "disabled" | "reviewed"
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([CHANNEL_ID, OTHER_CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowWebhookMessageAudit: overrides.audit ?? true,
    allowWebhookMessageChanges: overrides.changes ?? true,
    allowWebhookMessageDeletions: overrides.deletions ?? true,
    allowWebhookMessageDelivery: overrides.delivery ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(overrides.notifyIds ?? [USER_ID]),
    protectedUserIds: new Set(),
    userMentionMode: overrides.userMentionMode ?? "allowlist",
    webhookMessageChannelIds: new Set(overrides.messageChannels ?? [CHANNEL_ID]),
  })
}

class MemoryOperationStore implements OperationStore {
  readonly receipts = new Map<string, OperationReceipt>()
  readonly #finishErrorAt: number | undefined
  #finishCount = 0

  constructor(finishErrorAt?: number) {
    this.#finishErrorAt = finishErrorAt
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.#finishCount += 1
    if (this.#finishCount === this.#finishErrorAt) {
      throw new Error("injected operation receipt failure")
    }
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

function notFound(method: string): DiscordApiError {
  return new DiscordApiError({
    message: "Discord resource not found",
    method,
    route: "/redacted",
    status: 404,
  })
}

function executionStatus(status: string) {
  return (error: unknown): boolean => (
    error instanceof WebhookMessageExecutionError
    && (error.result as { status: string }).status === status
  )
}

function fixture(options: {
  activityAppendErrorAt?: number
  channel?: DiscordChannel
  deleteLeavesMessage?: boolean
  deleteMessageOverrides?: Partial<DiscordMessage>
  editMessageOverrides?: Partial<DiscordMessage>
  guildName?: string
  intentKey?: Uint8Array
  moveWebhookAtRead?: number
  moveWebhookAfterDelete?: boolean
  operationFinishErrorAt?: number
  planKey?: Uint8Array
  policy?: ScopePolicy
  sendError?: Error
  sendMessageOverrides?: Partial<DiscordMessage>
  webhook?: DiscordWebhookSummary
} = {}) {
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const messages = new Map<string, DiscordMessage>([
    [MESSAGE_ID, message(MESSAGE_ID, "Original content")],
  ])
  const operationStore = new MemoryOperationStore(options.operationFinishErrorAt)
  let currentWebhook = options.webhook ?? webhook()
  let currentChannel = options.channel ?? channel()
  let currentGuildName = options.guildName ?? "Private Guild"
  let sendCount = 0
  let editCount = 0
  let deleteCount = 0
  let credentialReadCount = 0
  let webhookReadCount = 0
  let lastAllowedMentions: DiscordAllowedMentions | null = null
  let activityAppendCount = 0
  const activityStore: ActivityStore = {
    async append(entry) {
      activityAppendCount += 1
      if (activityAppendCount === options.activityAppendErrorAt) {
        throw new Error("injected activity failure")
      }
      activities.push(entry)
      events.push(`activity:${entry.kind}:${entry.status}`)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const client: WebhookMessageServiceOptions["client"] = {
    async deleteWebhookMessage(_webhookId, token, messageId) {
      assert.equal(token, TOKEN)
      deleteCount += 1
      if (options.deleteLeavesMessage) {
        const surviving = messages.get(messageId)
        if (surviving && options.deleteMessageOverrides) {
          messages.set(messageId, {
            ...surviving,
            ...options.deleteMessageOverrides,
          })
        }
      } else {
        messages.delete(messageId)
      }
      if (options.moveWebhookAfterDelete) {
        currentWebhook = webhook({ channelId: OTHER_CHANNEL_ID })
      }
    },
    async executeWebhookMessage(_webhookId, token, input) {
      assert.equal(token, TOKEN)
      sendCount += 1
      if (options.sendError) throw options.sendError
      lastAllowedMentions = input.allowedMentions
      const created = message(
        CREATED_MESSAGE_ID,
        input.content,
        options.sendMessageOverrides,
      )
      messages.set(CREATED_MESSAGE_ID, created)
      return created
    },
    async getChannel(channelId) {
      assert.equal(channelId, currentChannel.id)
      return currentChannel
    },
    async getGuild() {
      return { id: GUILD_ID, name: currentGuildName }
    },
    async getWebhookMessage(_webhookId, token, messageId) {
      assert.equal(token, TOKEN)
      const current = messages.get(messageId)
      if (!current) throw notFound("GET")
      return current
    },
    async getWebhookWithToken(webhookId, token) {
      webhookReadCount += 1
      assert.equal(webhookId, WEBHOOK_ID)
      assert.equal(token, TOKEN)
      if (webhookReadCount === options.moveWebhookAtRead) {
        currentWebhook = webhook({ channelId: OTHER_CHANNEL_ID })
        currentChannel = channel({ id: OTHER_CHANNEL_ID })
      }
      return currentWebhook
    },
    async modifyWebhookMessage(_webhookId, token, messageId, input) {
      assert.equal(token, TOKEN)
      editCount += 1
      lastAllowedMentions = input.allowedMentions
      const edited = message(messageId, input.content, {
        edited_timestamp: NOW,
        ...options.editMessageOverrides,
      })
      messages.set(messageId, edited)
      return edited
    },
  }
  const service = new WebhookMessageService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    credentialStore: {
      async read(webhookId) {
        credentialReadCount += 1
        assert.equal(webhookId, WEBHOOK_ID)
        return TOKEN
      },
    },
    intentKey: options.intentKey ?? new Uint8Array(32).fill(11),
    planKey: options.planKey ?? new Uint8Array(32).fill(12),
    limiter: new InteractionLimiter({
      clock: () => Date.parse(NOW),
      maxWritesPerMinute: 20,
      minWriteIntervalMs: 0,
    }),
    operationStore,
    policy: options.policy ?? policy(),
    randomId: () => `activity-${activities.length + 1}`,
  })
  return {
    activities,
    events,
    get credentialReadCount() {
      return credentialReadCount
    },
    get deleteCount() {
      return deleteCount
    },
    get editCount() {
      return editCount
    },
    get lastAllowedMentions() {
      return lastAllowedMentions
    },
    messages,
    operationStore,
    service,
    setTarget(nextWebhook: DiscordWebhookSummary, nextChannel: DiscordChannel) {
      currentWebhook = nextWebhook
      currentChannel = nextChannel
    },
    setGuildName(name: string) {
      currentGuildName = name
    },
    get sendCount() {
      return sendCount
    },
    get webhookReadCount() {
      return webhookReadCount
    },
  }
}

function sendRequest(
  overrides: Partial<WebhookMessageSendRequest> = {},
): WebhookMessageSendRequest {
  return {
    content: "Deployment complete",
    operationKey: "webhook-message-send-operation-0001",
    webhookId: WEBHOOK_ID,
    ...overrides,
  }
}

function editRequest(
  overrides: Partial<WebhookMessageEditRequest> = {},
): WebhookMessageEditRequest {
  return {
    content: "Replacement content",
    messageId: MESSAGE_ID,
    operationKey: "webhook-message-edit-operation-0001",
    webhookId: WEBHOOK_ID,
    ...overrides,
  }
}

function deletionRequest(
  overrides: Partial<WebhookMessageDeletionRequest> = {},
): WebhookMessageDeletionRequest {
  return {
    messageId: MESSAGE_ID,
    operationKey: "webhook-message-delete-operation-0001",
    reviewReason: "Reviewed obsolete relay message / case 42",
    webhookId: WEBHOOK_ID,
    ...overrides,
  }
}

test("webhook message requests reject credential-shaped extras and unsafe content", () => {
  assert.match(
    normalizeWebhookMessageSendRequest(sendRequest()).operationKeyHash,
    /^sha256:/,
  )
  assert.equal(normalizeWebhookMessageEditRequest(editRequest()).messageId, MESSAGE_ID)
  assert.equal(
    normalizeWebhookMessageDeletionRequest(deletionRequest()).reviewReason,
    "Reviewed obsolete relay message / case 42",
  )
  assert.throws(
    () => normalizeWebhookMessageSendRequest({
      ...sendRequest(),
      token: TOKEN,
    } as never),
    /exact object/,
  )
  assert.throws(
    () => normalizeWebhookMessageSendRequest(sendRequest({ content: " " })),
    /must not be blank/,
  )
  assert.throws(
    () => normalizeWebhookMessageDeletionRequest(deletionRequest({
      reviewReason: "bad\nreason",
    })),
    /without controls/,
  )
})

test("webhook message replay intent is stable while deletion review keys remain process-local", async () => {
  const intentKey = new Uint8Array(32).fill(31)
  const first = fixture({
    intentKey,
    planKey: new Uint8Array(32).fill(32),
  })
  const second = fixture({
    intentKey,
    planKey: new Uint8Array(32).fill(33),
  })

  assert.equal(
    first.service.sendDigest(sendRequest()),
    second.service.sendDigest(sendRequest()),
  )
  const firstPlan = await first.service.planDeletion(
    APPLICATION_ID,
    BOT_ID,
    deletionRequest(),
  )
  const secondPlan = await second.service.planDeletion(
    APPLICATION_ID,
    BOT_ID,
    deletionRequest(),
  )
  assert.notEqual(firstPlan.digest, secondPlan.digest)
})

test("webhook message lookup returns exact content without credential or attachment URLs", async () => {
  const { service } = fixture()
  const result = await service.get({ messageId: MESSAGE_ID, webhookId: WEBHOOK_ID })

  assert.equal(result.message.content, "Original content")
  assert.equal(result.message.webhookId, WEBHOOK_ID)
  assert.equal(result.message.attachmentCount, 0)
  assert.equal(result.privacy.credentials, "connector-private")
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
})

test("webhook message projections reject malformed omitted and guild evidence", async () => {
  const malformedPoll = fixture()
  malformedPoll.messages.set(MESSAGE_ID, message(MESSAGE_ID, "Original content", {
    poll: null as never,
  }))
  await assert.rejects(
    malformedPoll.service.get({ messageId: MESSAGE_ID, webhookId: WEBHOOK_ID }),
    /invalid webhook message identity evidence/,
  )

  const malformedGuild = fixture({ guildName: "bad\nguild" })
  await assert.rejects(
    malformedGuild.service.planDeletion(APPLICATION_ID, BOT_ID, deletionRequest()),
    /invalid webhook message guild evidence/,
  )

  const malformedTimestamp = fixture()
  malformedTimestamp.messages.set(MESSAGE_ID, message(
    MESSAGE_ID,
    "Original content",
    { timestamp: `${NOW}\nInjected review line` },
  ))
  await assert.rejects(
    malformedTimestamp.service.get({
      messageId: MESSAGE_ID,
      webhookId: WEBHOOK_ID,
    }),
    /invalid webhook message timestamp evidence/,
  )

  const inconsistentTimestamp = fixture()
  inconsistentTimestamp.messages.set(MESSAGE_ID, message(
    MESSAGE_ID,
    "Original content",
    { edited_timestamp: "2026-08-24T23:59:59.000Z" },
  ))
  await assert.rejects(
    inconsistentTimestamp.service.get({
      messageId: MESSAGE_ID,
      webhookId: WEBHOOK_ID,
    }),
    /inconsistent webhook message timestamp evidence/,
  )
})

test("webhook message send records content-free evidence and durably replays", async () => {
  const state = fixture()
  const request = sendRequest()
  const first = await state.service.send(request)
  const replay = await state.service.send(request)

  assert.equal(first.status, "completed")
  assert.equal(first.localReplay, false)
  assert.equal(replay.localReplay, true)
  assert.equal(first.messageId, CREATED_MESSAGE_ID)
  assert.equal(state.sendCount, 1)
  assert.deepEqual(state.lastAllowedMentions, { parse: [], replied_user: false })
  assert.deepEqual(
    state.activities.map((entry) => `${entry.kind}:${entry.status}`),
    ["webhook-message-send:pending", "webhook-message-send:completed"],
  )
  const durable = JSON.stringify({
    activities: state.activities,
    receipts: [...state.operationStore.receipts.values()],
  })
  assert.equal(durable.includes(request.content), false)
  assert.equal(durable.includes(TOKEN), false)
  await assert.rejects(
    state.service.send(sendRequest({ content: "Different content" })),
    WebhookMessageOperationConflictError,
  )
})

test("webhook message send allows only explicit visible scoped user notifications", async () => {
  const state = fixture({
    sendMessageOverrides: {
      mentions: [{ id: USER_ID, username: "allowed-user" }],
    },
  })
  await state.service.send(sendRequest({
    content: `Deployment complete <@${USER_ID}>`,
    notifyUserIds: [USER_ID],
  }))
  assert.deepEqual(state.lastAllowedMentions, {
    replied_user: false,
    users: [USER_ID],
  })
  await assert.rejects(
    state.service.send(sendRequest({
      content: "No visible user mention",
      notifyUserIds: [USER_ID],
      operationKey: "webhook-message-send-operation-0002",
    })),
    /must have a visible user mention/,
  )

  const hostile = fixture({
    sendMessageOverrides: {
      mentions: [{ id: OTHER_USER_ID, username: "other-user" }],
    },
  })
  await assert.rejects(
    hostile.service.send(sendRequest({
      content: `Deployment complete <@${USER_ID}>`,
      notifyUserIds: [USER_ID],
    })),
    (error: unknown) => (
      error instanceof WebhookMessageExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )

  const omitted = fixture()
  await assert.rejects(
    omitted.service.send(sendRequest({
      content: `Deployment complete <@${USER_ID}>`,
      notifyUserIds: [USER_ID],
    })),
    (error: unknown) => (
      error instanceof WebhookMessageExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )

  const reviewedOnly = fixture({
    policy: policy({
      notifyIds: [],
      userMentionMode: "reviewed",
    }),
  })
  await assert.rejects(
    reviewedOnly.service.send(sendRequest({
      content: `Deployment complete <@${USER_ID}>`,
      notifyUserIds: [USER_ID],
    })),
    /requires signed interactive notification review/,
  )
  assert.equal(reviewedOnly.sendCount, 0)
})

test("webhook message writes distinguish known rejection from uncertain delivery", async () => {
  const rejected = fixture({
    sendError: new DiscordApiError({
      code: 50_035,
      message: "Discord rejected the webhook message",
      method: "POST",
      route: "/redacted",
      status: 400,
    }),
  })
  await assert.rejects(rejected.service.send(sendRequest()), executionStatus("failed"))
  assert.equal(rejected.activities.at(-1)?.status, "failed")
  assert.equal([...rejected.operationStore.receipts.values()].at(-1)?.status, "failed")

  const rateLimited = fixture({
    sendError: new DiscordApiError({
      message: "Discord rate limited the webhook message",
      method: "POST",
      retryAfterMs: 2_500,
      route: "/redacted",
      status: 429,
    }),
  })
  await assert.rejects(
    rateLimited.service.send(sendRequest()),
    (error: unknown) => (
      executionStatus("uncertain")(error)
      && (error as WebhookMessageExecutionError).result !== null
      && ((error as WebhookMessageExecutionError).result as {
        retryAfterMs: number | null
      }).retryAfterMs === 2_500
    ),
  )
  assert.equal(rateLimited.activities.at(-1)?.status, "uncertain")
  assert.equal(
    [...rateLimited.operationStore.receipts.values()].at(-1)?.status,
    "uncertain",
  )
})

test("webhook message writes block on pending audit and expose terminal record failures", async () => {
  const pendingAudit = fixture({ activityAppendErrorAt: 1 })
  await assert.rejects(
    pendingAudit.service.send(sendRequest()),
    executionStatus("blocked-audit-failed"),
  )
  assert.equal(pendingAudit.sendCount, 0)
  assert.equal(
    [...pendingAudit.operationStore.receipts.values()].at(-1)?.status,
    "failed",
  )

  const receiptFailure = fixture({ operationFinishErrorAt: 1 })
  await assert.rejects(
    receiptFailure.service.send(sendRequest()),
    executionStatus("completed-operation-record-failed"),
  )
  assert.equal(receiptFailure.sendCount, 1)
  assert.equal(
    [...receiptFailure.operationStore.receipts.values()].at(-1)?.status,
    "pending",
  )

  const finalAuditFailure = fixture({ activityAppendErrorAt: 2 })
  await assert.rejects(
    finalAuditFailure.service.send(sendRequest()),
    executionStatus("completed-audit-failed"),
  )
  assert.equal(finalAuditFailure.sendCount, 1)
  assert.equal(
    [...finalAuditFailure.operationStore.receipts.values()].at(-1)?.status,
    "completed",
  )
})

test("webhook message edit is a no-op when exact content is already current", async () => {
  const state = fixture()
  const result = await state.service.edit(editRequest({ content: "Original content" }))

  assert.equal(result.status, "noop")
  assert.equal(result.activityId, null)
  assert.equal(state.editCount, 0)
  assert.equal(state.activities.length, 0)
  assert.equal(state.operationStore.receipts.size, 0)
})

test("webhook message edit rewrites matching content when prior mention state is unsafe", async () => {
  const state = fixture()
  state.messages.set(MESSAGE_ID, message(MESSAGE_ID, "Original content", {
    mention_roles: ["800000000000000001"],
  }))

  const result = await state.service.edit(editRequest({ content: "Original content" }))

  assert.equal(result.status, "completed")
  assert.equal(state.editCount, 1)
  assert.deepEqual(state.messages.get(MESSAGE_ID)?.mention_roles, [])
})

test("webhook message writes fail closed on unsupported payload and flag evidence", async () => {
  const send = fixture({
    sendMessageOverrides: { embeds: [{}] },
  })
  await assert.rejects(
    send.service.send(sendRequest()),
    (error: unknown) => (
      error instanceof WebhookMessageExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )

  const edit = fixture()
  edit.messages.set(MESSAGE_ID, message(MESSAGE_ID, "Original content", {
    components: [{}],
  }))
  await assert.rejects(
    edit.service.edit(editRequest()),
    /limited to plain-text message payloads/,
  )
  assert.equal(edit.editCount, 0)

  const unexpectedSendFlags = fixture({
    sendMessageOverrides: {
      flags: DISCORD_MESSAGE_FLAGS.suppressEmbeds
        | DISCORD_MESSAGE_FLAGS.suppressNotifications,
    },
  })
  await assert.rejects(
    unexpectedSendFlags.service.send(sendRequest()),
    executionStatus("uncertain"),
  )

  const unexpectedEditFlags = fixture()
  unexpectedEditFlags.messages.set(
    MESSAGE_ID,
    message(MESSAGE_ID, "Original content", {
      flags: DISCORD_MESSAGE_FLAGS.suppressNotifications,
    }),
  )
  await assert.rejects(
    unexpectedEditFlags.service.edit(editRequest()),
    /limited to plain-text message payloads/,
  )
  assert.equal(unexpectedEditFlags.editCount, 0)
})

test("webhook message edit replaces and verifies only the exact owned message", async () => {
  const state = fixture()
  const result = await state.service.edit(editRequest())

  assert.equal(result.status, "completed")
  assert.equal(state.editCount, 1)
  assert.equal(state.messages.get(MESSAGE_ID)?.content, "Replacement content")
  assert.deepEqual(
    state.activities.map((entry) => `${entry.kind}:${entry.status}`),
    ["webhook-message-edit:pending", "webhook-message-edit:completed"],
  )
})

test("webhook message target pinning blocks moves outside exact delivery scope", async () => {
  const state = fixture()
  state.setTarget(
    webhook({ channelId: OTHER_CHANNEL_ID }),
    channel({ id: OTHER_CHANNEL_ID }),
  )
  await assert.rejects(
    state.service.send(sendRequest()),
    /outside the webhook message scope/,
  )
  assert.equal(state.sendCount, 0)
})

test("webhook message target pinning rejects unsupported forum parents", async () => {
  const state = fixture({
    channel: channel({ type: DISCORD_CHANNEL_TYPES.forum }),
  })
  await assert.rejects(
    state.service.send(sendRequest()),
    /does not support webhook message delivery/,
  )
  assert.equal(state.sendCount, 0)
})

test("disabled webhook message actions fail before credential or Discord access", async () => {
  const cases = [
    {
      invoke: (state: ReturnType<typeof fixture>) => state.service.get({
        messageId: MESSAGE_ID,
        webhookId: WEBHOOK_ID,
      }),
      policy: policy({ audit: false }),
    },
    {
      invoke: (state: ReturnType<typeof fixture>) => state.service.send(sendRequest()),
      policy: policy({ delivery: false }),
    },
    {
      invoke: (state: ReturnType<typeof fixture>) => state.service.edit(editRequest()),
      policy: policy({ changes: false }),
    },
    {
      invoke: (state: ReturnType<typeof fixture>) => state.service.planDeletion(
        APPLICATION_ID,
        BOT_ID,
        deletionRequest(),
      ),
      policy: policy({ deletions: false }),
    },
  ]
  for (const testCase of cases) {
    const state = fixture({ policy: testCase.policy })
    await assert.rejects(testCase.invoke(state), /disabled by connector configuration/)
    assert.equal(state.credentialReadCount, 0)
    assert.equal(state.webhookReadCount, 0)
  }
})

test("webhook message deletion plans exact transient content and verifies absence", async () => {
  const state = fixture()
  const request = deletionRequest()
  const plan = await state.service.planDeletion(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  const result = await state.service.executeDeletion(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(plan.target.content, "Original content")
  assert.equal(plan.webhook.id, WEBHOOK_ID)
  assert.equal(plan.privacy.messageContentPersistence, "none")
  assert.equal(plan.warnings.some((warning) => warning.includes("count")), true)
  assert.equal(result.status, "completed")
  assert.equal(result.readbackMatched, true)
  assert.equal(state.deleteCount, 1)
  assert.equal(state.messages.has(MESSAGE_ID), false)
  const durable = JSON.stringify({
    activities: state.activities,
    receipts: [...state.operationStore.receipts.values()],
  })
  assert.equal(durable.includes("Original content"), false)
  assert.equal(durable.includes(request.reviewReason), false)
  assert.equal(durable.includes(TOKEN), false)
})

test("webhook message deletion rejects a webhook move during absence proof", async () => {
  const state = fixture({ moveWebhookAfterDelete: true })
  const request = deletionRequest()
  const plan = await state.service.planDeletion(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    state.service.executeDeletion(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof WebhookMessageExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal(state.deleteCount, 1)
  assert.equal(state.activities.at(-1)?.status, "uncertain")
})

test("webhook message deletion binds guild labels and the final webhook target", async () => {
  const renamed = fixture()
  const request = deletionRequest()
  const renamedPlan = await renamed.service.planDeletion(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  renamed.setGuildName("Renamed Guild")
  await assert.rejects(
    renamed.service.executeDeletion(
      APPLICATION_ID,
      BOT_ID,
      request,
      renamedPlan.digest,
    ),
    WebhookMessagePlanChangedError,
  )
  assert.equal(renamed.deleteCount, 0)

  const moved = fixture({
    moveWebhookAtRead: 3,
    policy: policy({ messageChannels: [CHANNEL_ID, OTHER_CHANNEL_ID] }),
  })
  const movedPlan = await moved.service.planDeletion(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  await assert.rejects(
    moved.service.executeDeletion(
      APPLICATION_ID,
      BOT_ID,
      request,
      movedPlan.digest,
    ),
    WebhookMessagePlanChangedError,
  )
  assert.equal(moved.deleteCount, 0)
})

test("webhook message deletion rejects stale plans, invalid digests, and spent keys", async () => {
  const stale = fixture()
  const request = deletionRequest()
  const plan = await stale.service.planDeletion(APPLICATION_ID, BOT_ID, request)
  stale.messages.set(MESSAGE_ID, message(MESSAGE_ID, "Changed after review"))
  await assert.rejects(
    stale.service.executeDeletion(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    WebhookMessagePlanChangedError,
  )
  assert.equal(stale.deleteCount, 0)

  await assert.rejects(
    stale.service.executeDeletion(APPLICATION_ID, BOT_ID, request, "invalid"),
    /plan digest is invalid/,
  )

  const missing = fixture()
  const missingPlan = await missing.service.planDeletion(
    APPLICATION_ID,
    BOT_ID,
    request,
  )
  missing.messages.delete(MESSAGE_ID)
  await assert.rejects(
    missing.service.executeDeletion(
      APPLICATION_ID,
      BOT_ID,
      request,
      missingPlan.digest,
    ),
    WebhookMessagePlanChangedError,
  )

  const spent = fixture()
  const spentPlan = await spent.service.planDeletion(APPLICATION_ID, BOT_ID, request)
  await spent.service.executeDeletion(
    APPLICATION_ID,
    BOT_ID,
    request,
    spentPlan.digest,
  )
  await assert.rejects(
    spent.service.executeDeletion(
      APPLICATION_ID,
      BOT_ID,
      request,
      spentPlan.digest,
    ),
    WebhookMessageOperationConflictError,
  )
  assert.equal(spent.deleteCount, 1)
})

test("webhook message deletion reports a surviving exact message as drift", async () => {
  const state = fixture({ deleteLeavesMessage: true })
  const request = deletionRequest()
  const plan = await state.service.planDeletion(APPLICATION_ID, BOT_ID, request)
  const result = await state.service.executeDeletion(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.readbackMatched, false)
  assert.equal(
    (state.activities.at(-1) as WebhookMessageActivity | undefined)?.verification,
    "drift",
  )
})

test("webhook message deletion treats malformed survival evidence as uncertain", async () => {
  const state = fixture({
    deleteLeavesMessage: true,
    deleteMessageOverrides: { channel_id: OTHER_CHANNEL_ID },
  })
  const request = deletionRequest()
  const plan = await state.service.planDeletion(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    state.service.executeDeletion(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    executionStatus("uncertain"),
  )
  assert.equal(state.deleteCount, 1)
  assert.equal(state.activities.at(-1)?.status, "uncertain")
})
