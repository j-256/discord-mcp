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

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  attachmentMessageNonce,
  AttachmentMessageService,
  normalizeAttachmentMessageRequest,
  type AttachmentMessageRequest,
  type AttachmentMessageServiceOptions,
} from "../src/attachment-message-service.js"
import {
  AttachmentMessageExecutionError,
  AttachmentMessageOperationConflictError,
  AttachmentMessagePlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
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
  DiscordMessage,
  DiscordRole,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const BOT_ROLE_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const PARENT_CHANNEL_ID = "400000000000000002"
const REPLY_ID = "500000000000000001"
const REPLY_AUTHOR_ID = "600000000000000001"
const MESSAGE_ID = "700000000000000001"
const OPERATION_KEY = "attachment-operation-0001"
const NOW = "2026-08-20T00:00:00.000Z"
const CONTENT = `Reviewed report for <@${REPLY_AUTHOR_ID}>`
const DESCRIPTION = "Accessible report"
const FILENAME = "report.txt"
const FILE_CONTENT = "private reviewed bytes"

function role(id: string, permissions: bigint): DiscordRole {
  return {
    id,
    managed: id !== GUILD_ID,
    name: id === GUILD_ID ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position: id === GUILD_ID ? 0 : 1,
  }
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    permission_overwrites: [],
    type: 0,
    ...overrides,
  }
}

function botMember(): DiscordGuildMember {
  return {
    roles: [BOT_ROLE_ID],
    user: { bot: true, id: BOT_ID, username: "connector" },
  }
}

function message(
  id: string,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: { bot: false, id: REPLY_AUTHOR_ID, username: "member" },
    channel_id: CHANNEL_ID,
    content: "reply target",
    guild_id: GUILD_ID,
    id,
    timestamp: NOW,
    type: 0,
    ...overrides,
  }
}

function request(filePath: string, overrides: Partial<AttachmentMessageRequest> = {}) {
  return {
    channelId: CHANNEL_ID,
    content: CONTENT,
    description: DESCRIPTION,
    filePath,
    filename: FILENAME,
    notifyReplyAuthor: true,
    notifyUserIds: [REPLY_AUTHOR_ID],
    operationKey: OPERATION_KEY,
    replyToMessageId: REPLY_ID,
    ...overrides,
  }
}

function policy(root: string, options: {
  channels?: readonly string[]
  enabled?: boolean
  mentionUserIds?: readonly string[]
  permissions?: bigint
  readChannels?: readonly string[]
  userMentionMode?: "allowlist" | "disabled" | "reviewed"
} = {}) {
  const permissions = options.permissions
    ?? (
      DISCORD_PERMISSIONS.VIEW_CHANNEL
      | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
      | DISCORD_PERMISSIONS.SEND_MESSAGES
      | DISCORD_PERMISSIONS.ATTACH_FILES
    )
  return {
    policy: new ScopePolicy({
      adminGuildIds: new Set(),
      allowedChannelIds: new Set(options.readChannels || [CHANNEL_ID]),
      allowedGuildIds: new Set([GUILD_ID]),
      allowAdministration: false,
      allowAttachments: options.enabled ?? true,
      allowDeletions: false,
      allowInteractions: false,
      attachmentChannelIds: new Set(options.channels || [CHANNEL_ID]),
      attachmentMaxBytes: 1_024,
      attachmentRoots: [root],
      deleteChannelIds: new Set(),
      interactionChannelIds: new Set(),
      interactionMaxWritesPerMinute: 10,
      interactionMinWriteIntervalMs: 0,
      mentionUserIds: new Set(options.mentionUserIds ?? [REPLY_AUTHOR_ID]),
      protectedUserIds: new Set(),
      userMentionMode: options.userMentionMode ?? "allowlist",
    }),
    roles: [role(GUILD_ID, 0n), role(BOT_ROLE_ID, permissions)],
  }
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  receipt: OperationReceipt | undefined

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipt = receipt
  }

  async get(): Promise<OperationReceipt | undefined> {
    return this.receipt
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("operation:reserve")
    if (this.receipt) return { created: false, receipt: this.receipt }
    this.receipt = receipt
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  channel: DiscordChannel
  createError: unknown
  member: DiscordGuildMember
  omitReadbackNonce: boolean
  parent: DiscordChannel
  readbackError: unknown
  readbackOverrides: Partial<DiscordMessage>
  reply: DiscordMessage
  roles: DiscordRole[]
}

async function fixture(options: {
  policyOptions?: Parameters<typeof policy>[1]
  state?: Partial<FixtureState>
} = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-attachment-service-"))
  const root = await realpath(temporary)
  const filePath = join(root, FILENAME)
  await writeFile(filePath, FILE_CONTENT)
  const configured = policy(root, options.policyOptions)
  const state: FixtureState = {
    activityFailureAt: null,
    channel: channel(),
    createError: undefined,
    member: botMember(),
    omitReadbackNonce: false,
    parent: channel({ id: PARENT_CHANNEL_ID }),
    readbackError: undefined,
    readbackOverrides: {},
    reply: message(REPLY_ID),
    roles: configured.roles,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let lastInput: Parameters<AttachmentMessageServiceOptions["client"]["createAttachmentMessage"]>[1]
    | undefined
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
  const client: AttachmentMessageServiceOptions["client"] = {
    async createAttachmentMessage(_channelId, input) {
      events.push("write:create")
      lastInput = input
      if (state.createError) throw state.createError
      return message(MESSAGE_ID, {
        attachments: [{
          ...(input.description !== undefined ? { description: input.description } : {}),
          filename: input.filename,
          id: "800000000000000001",
          size: input.bytes.byteLength,
          url: "https://cdn.discord.test/private",
        }],
        author: { bot: true, id: BOT_ID, username: "connector" },
        content: input.content ?? "",
        ...(input.reply
          ? { message_reference: {
              channel_id: CHANNEL_ID,
              guild_id: GUILD_ID,
              message_id: REPLY_ID,
              type: 0,
            } }
          : {}),
        nonce: input.nonce,
      })
    },
    async getChannel(channelId) {
      events.push("read:channel")
      if (channelId === state.channel.parent_id) return state.parent
      return state.channel
    },
    async getGuildMember() {
      events.push("read:member")
      return state.member
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async getMessage(_channelId, messageId) {
      if (messageId === REPLY_ID) {
        events.push("read:reply")
        return state.reply
      }
      events.push("read:created")
      if (state.readbackError) throw state.readbackError
      if (!lastInput) throw new Error("missing upload input")
      const readback = message(MESSAGE_ID, {
        attachments: [{
          ...(lastInput.description !== undefined
            ? { description: lastInput.description }
            : {}),
          filename: lastInput.filename,
          id: "800000000000000001",
          size: lastInput.bytes.byteLength,
          url: "https://cdn.discord.test/private",
        }],
        author: { bot: true, id: BOT_ID, username: "connector" },
        content: lastInput.content ?? "",
        ...(lastInput.reply
          ? { message_reference: {
              channel_id: CHANNEL_ID,
              guild_id: GUILD_ID,
              message_id: REPLY_ID,
              type: 0,
            } }
          : {}),
        nonce: lastInput.nonce,
        ...state.readbackOverrides,
      })
      if (state.omitReadbackNonce) delete readback.nonce
      return readback
    },
  }
  const limiter = new InteractionLimiter({
    clock: () => Date.parse(NOW),
    maxWritesPerMinute: 10,
    minWriteIntervalMs: 0,
  })
  const service = new AttachmentMessageService({
    activityStore,
    attachmentMaxBytes: 1_024,
    attachmentRoots: [root],
    client,
    clock: () => new Date(NOW),
    limiter,
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: configured.policy,
    randomId: () => "activity-attachment-1",
  })
  return {
    activities,
    async cleanup() {
      await rm(temporary, { force: true, recursive: true })
    },
    events,
    filePath,
    get lastInput() {
      return lastInput
    },
    operationStore,
    service,
    state,
  }
}

test("attachment message normalization and plan bind exact local and Discord evidence", async () => {
  const current = await fixture()
  try {
    const normalized = normalizeAttachmentMessageRequest(request(current.filePath, {
      notifyUserIds: [REPLY_AUTHOR_ID],
    }))
    assert.equal(normalized.filename, FILENAME)
    assert.equal(normalized.operationKeyHash.startsWith("sha256:"), true)
    const first = await current.service.plan(BOT_ID, request(current.filePath))
    const second = await current.service.plan(BOT_ID, request(current.filePath))

    assert.equal(first.digest, second.digest)
    assert.equal(first.file.canonicalPath, current.filePath)
    assert.equal(first.file.sizeBytes, Buffer.byteLength(FILE_CONTENT))
    assert.equal(first.file.stableRead, true)
    assert.deepEqual(first.permission.requiredPermissionNames, [
      "VIEW_CHANNEL",
      "READ_MESSAGE_HISTORY",
      "ATTACH_FILES",
      "SEND_MESSAGES",
    ])
    assert.deepEqual(first.reply, {
      authorId: REPLY_AUTHOR_ID,
      messageId: REPLY_ID,
    })
    const serialized = JSON.stringify(first)
    assert.equal(serialized.includes(OPERATION_KEY), false)
    assert.equal(serialized.includes(FILE_CONTENT), false)
    assert.equal(serialized.includes("contentDigest"), false)
  } finally {
    await current.cleanup()
  }
})

test("attachment plans authorize unlisted exact notifications only through reviewed mode", async () => {
  const current = await fixture({
    policyOptions: {
      mentionUserIds: [],
      userMentionMode: "reviewed",
    },
  })
  try {
    const requested = request(current.filePath)
    const plan = await current.service.plan(BOT_ID, requested)
    const result = await current.service.execute(BOT_ID, requested, plan.digest)

    assert.equal(result.status, "completed")
    assert.deepEqual(plan.notificationAuthorization, {
      replyAuthor: {
        authorization: "reviewed",
        userId: REPLY_AUTHOR_ID,
      },
      reviewRequired: true,
      userMentions: {
        allowlistedUserIds: [],
        authorization: "reviewed",
        reviewedUserIds: [REPLY_AUTHOR_ID],
      },
    })
    assert.deepEqual(current.lastInput?.allowedMentions, {
      replied_user: true,
      users: [REPLY_AUTHOR_ID],
    })
  } finally {
    await current.cleanup()
  }
})

test("attachment execution reserves, journals, uploads once, and verifies exact readback", async () => {
  const current = await fixture()
  try {
    const requested = request(current.filePath)
    const plan = await current.service.plan(BOT_ID, requested)
    const result = await current.service.execute(BOT_ID, requested, plan.digest)

    assert.equal(result.status, "completed")
    assert.equal(result.messageId, MESSAGE_ID)
    assert.equal(result.attachment.filename, FILENAME)
    assert.deepEqual(current.lastInput?.bytes, new TextEncoder().encode(FILE_CONTENT))
    const executionEvents = current.events.slice(current.events.lastIndexOf("read:channel"))
    assert.equal(executionEvents.indexOf("operation:reserve") < executionEvents.indexOf("write:create"), true)
    assert.equal(executionEvents.indexOf("activity:pending") < executionEvents.indexOf("write:create"), true)
    assert.equal(current.events.filter((entry) => entry === "write:create").length, 1)
    assert.equal(current.operationStore.receipt?.status, "completed")
    const persisted = JSON.stringify({
      activities: current.activities,
      receipt: current.operationStore.receipt,
    })
    for (const secret of [
      OPERATION_KEY,
      current.filePath,
      FILENAME,
      DESCRIPTION,
      FILE_CONTENT,
      CONTENT,
      "cdn.discord.test",
    ]) assert.equal(persisted.includes(secret), false)
  } finally {
    await current.cleanup()
  }
})

test("attachment execution refuses changed bytes and spent operation keys", async () => {
  const changed = await fixture()
  try {
    const requested = request(changed.filePath)
    const plan = await changed.service.plan(BOT_ID, requested)
    await writeFile(changed.filePath, "changed after review")
    await assert.rejects(
      changed.service.execute(BOT_ID, requested, plan.digest),
      AttachmentMessagePlanChangedError,
    )
    assert.equal(changed.events.includes("operation:reserve"), false)
    assert.equal(changed.events.includes("write:create"), false)
  } finally {
    await changed.cleanup()
  }

  const spent = await fixture()
  try {
    const requested = request(spent.filePath)
    const plan = await spent.service.plan(BOT_ID, requested)
    await spent.service.execute(BOT_ID, requested, plan.digest)
    await assert.rejects(
      spent.service.plan(BOT_ID, requested),
      AttachmentMessageOperationConflictError,
    )
    assert.equal(spent.events.filter((entry) => entry === "write:create").length, 1)
  } finally {
    await spent.cleanup()
  }
})

test("attachment planning fails closed on scope and complete send permissions", async () => {
  const disabled = await fixture({ policyOptions: { enabled: false } })
  try {
    await assert.rejects(
      disabled.service.plan(BOT_ID, request(disabled.filePath)),
      /attachment messages are disabled/,
    )
  } finally {
    await disabled.cleanup()
  }

  const missingPermission = await fixture({
    policyOptions: {
      permissions: DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
        | DISCORD_PERMISSIONS.SEND_MESSAGES,
    },
  })
  try {
    await assert.rejects(
      missingPermission.service.plan(BOT_ID, request(missingPermission.filePath)),
      /lacks attachment permissions: ATTACH_FILES/,
    )
  } finally {
    await missingPermission.cleanup()
  }
})

test("attachment threads require their exact scope and thread-specific send permission", async () => {
  const required = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.ATTACH_FILES
    | DISCORD_PERMISSIONS.SEND_MESSAGES_IN_THREADS
  const current = await fixture({
    policyOptions: {
      permissions: required,
      readChannels: [CHANNEL_ID, PARENT_CHANNEL_ID],
    },
    state: {
      channel: channel({ parent_id: PARENT_CHANNEL_ID, type: 11 }),
    },
  })
  try {
    const plan = await current.service.plan(BOT_ID, request(current.filePath))
    assert.equal(plan.channel.parentId, PARENT_CHANNEL_ID)
    assert.equal(plan.permission.permissionSourceChannelId, PARENT_CHANNEL_ID)
    assert.deepEqual(plan.permission.requiredPermissionNames, [
      "VIEW_CHANNEL",
      "READ_MESSAGE_HISTORY",
      "ATTACH_FILES",
      "SEND_MESSAGES_IN_THREADS",
    ])
  } finally {
    await current.cleanup()
  }

  const missing = await fixture({
    policyOptions: {
      permissions: required ^ DISCORD_PERMISSIONS.SEND_MESSAGES_IN_THREADS,
      readChannels: [CHANNEL_ID, PARENT_CHANNEL_ID],
    },
    state: {
      channel: channel({ parent_id: PARENT_CHANNEL_ID, type: 11 }),
    },
  })
  try {
    await assert.rejects(
      missing.service.plan(BOT_ID, request(missing.filePath)),
      /SEND_MESSAGES_IN_THREADS/,
    )
  } finally {
    await missing.cleanup()
  }
})

test("attachment execution distinguishes known rejection from uncertain readback", async () => {
  const rejected = await fixture({
    state: {
      createError: new DiscordApiError({
        code: 50_013,
        message: "Missing Permissions",
        method: "POST",
        route: `/channels/${CHANNEL_ID}/messages`,
        status: 403,
      }),
    },
  })
  try {
    const requested = request(rejected.filePath)
    const plan = await rejected.service.plan(BOT_ID, requested)
    await assert.rejects(
      rejected.service.execute(BOT_ID, requested, plan.digest),
      (error: unknown) => (
        error instanceof AttachmentMessageExecutionError
        && (error.result as { status: string }).status === "failed"
      ),
    )
    assert.equal(rejected.operationStore.receipt?.status, "failed")
  } finally {
    await rejected.cleanup()
  }

  const uncertain = await fixture({
    state: { readbackOverrides: { content: "Discord changed it" } },
  })
  try {
    const requested = request(uncertain.filePath)
    const plan = await uncertain.service.plan(BOT_ID, requested)
    await assert.rejects(
      uncertain.service.execute(BOT_ID, requested, plan.digest),
      (error: unknown) => (
        error instanceof AttachmentMessageExecutionError
        && (error.result as { messageId: string; status: string }).messageId === MESSAGE_ID
        && (error.result as { status: string }).status === "uncertain"
      ),
    )
    assert.equal(uncertain.operationStore.receipt?.status, "uncertain")
  } finally {
    await uncertain.cleanup()
  }
})

test("attachment execution blocks on pending audit failure and reports local completion-record failures", async () => {
  const auditFailure = await fixture({ state: { activityFailureAt: 1 } })
  try {
    const requested = request(auditFailure.filePath)
    const plan = await auditFailure.service.plan(BOT_ID, requested)
    await assert.rejects(
      auditFailure.service.execute(BOT_ID, requested, plan.digest),
      (error: unknown) => (
        error instanceof AttachmentMessageExecutionError
        && (error.result as { status: string }).status === "blocked-audit-failed"
      ),
    )
    assert.equal(auditFailure.events.includes("write:create"), false)
    assert.equal(auditFailure.operationStore.receipt?.status, "failed")
  } finally {
    await auditFailure.cleanup()
  }

  const receiptFailure = await fixture()
  try {
    const requested = request(receiptFailure.filePath)
    const plan = await receiptFailure.service.plan(BOT_ID, requested)
    receiptFailure.operationStore.finishFailure = new Error("receipt unavailable")
    await assert.rejects(
      receiptFailure.service.execute(BOT_ID, requested, plan.digest),
      (error: unknown) => (
        error instanceof AttachmentMessageExecutionError
        && (error.result as { status: string }).status
          === "completed-operation-record-failed"
      ),
    )
    assert.equal(receiptFailure.events.filter((entry) => entry === "write:create").length, 1)
    const completedActivity = receiptFailure.activities.at(-1)
    assert.equal(completedActivity?.kind, "attachment-message-send")
    if (completedActivity?.kind !== "attachment-message-send") {
      throw new Error("Expected an attachment-message activity")
    }
    assert.equal(completedActivity.status, "completed")
    assert.equal(completedActivity.verification, "match")
  } finally {
    await receiptFailure.cleanup()
  }

  const activityFailure = await fixture({ state: { activityFailureAt: 2 } })
  try {
    const requested = request(activityFailure.filePath)
    const plan = await activityFailure.service.plan(BOT_ID, requested)
    await assert.rejects(
      activityFailure.service.execute(BOT_ID, requested, plan.digest),
      (error: unknown) => (
        error instanceof AttachmentMessageExecutionError
        && (error.result as { status: string }).status === "completed-audit-failed"
      ),
    )
    assert.equal(activityFailure.events.filter((entry) => entry === "write:create").length, 1)
    assert.equal(activityFailure.operationStore.receipt?.status, "completed")
  } finally {
    await activityFailure.cleanup()
  }
})

test("attachment readback permits only omission of Discord's optional nonce", async () => {
  const omitted = await fixture({ state: { omitReadbackNonce: true } })
  try {
    const requested = request(omitted.filePath)
    const plan = await omitted.service.plan(BOT_ID, requested)
    assert.equal(
      (await omitted.service.execute(BOT_ID, requested, plan.digest)).status,
      "completed",
    )
  } finally {
    await omitted.cleanup()
  }

  const conflicting = await fixture({
    state: { readbackOverrides: { nonce: "different-nonce" } },
  })
  try {
    const requested = request(conflicting.filePath)
    const plan = await conflicting.service.plan(BOT_ID, requested)
    await assert.rejects(
      conflicting.service.execute(BOT_ID, requested, plan.digest),
      (error: unknown) => (
        error instanceof AttachmentMessageExecutionError
        && (error.result as { status: string }).status === "uncertain"
      ),
    )
  } finally {
    await conflicting.cleanup()
  }
})

test("attachment nonce is stable, key-bound, and Discord-sized", () => {
  const first = attachmentMessageNonce(CHANNEL_ID, OPERATION_KEY)
  assert.equal(first, attachmentMessageNonce(CHANNEL_ID, OPERATION_KEY))
  assert.notEqual(first, attachmentMessageNonce(CHANNEL_ID, `${OPERATION_KEY}-other`))
  assert.equal(first.length, 25)
})

test("attachment normalization rejects malformed runtime-only inputs", () => {
  const base = request("/test/report.txt")
  assert.throws(
    () => normalizeAttachmentMessageRequest({
      ...base,
      content: 42,
    } as unknown as AttachmentMessageRequest),
    RangeError,
  )
  assert.throws(
    () => normalizeAttachmentMessageRequest({
      ...base,
      notifyReplyAuthor: "true",
    } as unknown as AttachmentMessageRequest),
    /must be a boolean/,
  )
  assert.throws(
    () => normalizeAttachmentMessageRequest({
      ...base,
      notifyUserIds: REPLY_AUTHOR_ID,
    } as unknown as AttachmentMessageRequest),
    /must be an array/,
  )
  assert.throws(
    () => normalizeAttachmentMessageRequest({
      ...base,
      filePath: `/${"a".repeat(4_097)}`,
    }),
    /one exact absolute path/,
  )
})
