import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import type {
  DiscordStaticEmbed,
} from "../src/embed-layout.js"
import {
  embedMessageRequestDigest,
  embedMessageNonce,
  EmbedMessageService,
  normalizeEmbedMessageRequest,
  type EmbedMessageRequest,
  type EmbedMessageServiceOptions,
} from "../src/embed-message-service.js"
import {
  DISCORD_CHANNEL_TYPES,
} from "../src/constants.js"
import {
  EmbedMessageEvidenceError,
  EmbedMessageExecutionError,
  EmbedMessageOperationConflictError,
  EmbedMessagePlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import type {
  EmbedMessageOperationReceipt,
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
  DiscordMessage,
  DiscordRole,
  DiscordThreadMember,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const OTHER_APPLICATION_ID = "100000000000000002"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "300000000000000002"
const OTHER_BOT_ID = "300000000000000003"
const CHANNEL_ID = "400000000000000001"
const PARENT_CHANNEL_ID = "400000000000000002"
const REPLY_ID = "500000000000000001"
const REPLY_AUTHOR_ID = "500000000000000002"
const EXISTING_ID = "600000000000000001"
const CREATED_ID = "600000000000000002"
const OPERATION_KEY = "embed-operation-0001"
const PLAN_DIGEST = `hmac-sha256:${"a".repeat(64)}`
const NOW = "2026-08-22T00:00:00.000Z"
const EDITED = "2026-08-22T00:01:00.000Z"
const CURRENT_CONTENT = "Before content"
const TARGET_CONTENT = `Notify <@${REPLY_AUTHOR_ID}>`
const CURRENT_LAYOUT = [{ title: "Before" }]
const TARGET_LAYOUT = [{
  color: 0x58_65_F2,
  description: `After <@${REPLY_AUTHOR_ID}>`,
  fields: [{ inline: true, name: "Status", value: "Ready" }],
  footerText: "Reviewed",
  title: "After",
}]

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
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function guild(overrides: Partial<DiscordGuild> = {}): DiscordGuild {
  return {
    id: GUILD_ID,
    name: "Reviewed guild",
    owner_id: OWNER_ID,
    ...overrides,
  }
}

function botMember(): DiscordGuildMember {
  return {
    roles: [BOT_ROLE_ID],
    user: { bot: true, id: BOT_ID, username: "connector" },
  }
}

function responseEmbeds(
  embeds: readonly DiscordStaticEmbed[],
): unknown[] {
  return embeds.map((embed) => ({ ...embed, type: "rich" }))
}

function wireLayout(
  layout: typeof CURRENT_LAYOUT | typeof TARGET_LAYOUT,
): unknown[] {
  if (layout === CURRENT_LAYOUT) {
    return [{ title: "Before", type: "rich" }]
  }
  return [{
    color: 0x58_65_F2,
    description: `After <@${REPLY_AUTHOR_ID}>`,
    fields: [{ inline: true, name: "Status", value: "Ready" }],
    footer: { text: "Reviewed" },
    title: "After",
    type: "rich",
  }]
}

function embedMessage(
  id: string,
  embeds: unknown[],
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  const defaultContent = JSON.stringify(embeds) === JSON.stringify(wireLayout(TARGET_LAYOUT))
    ? TARGET_CONTENT
    : CURRENT_CONTENT
  return {
    attachments: [],
    author: { bot: true, id: BOT_ID, username: "connector" },
    channel_id: CHANNEL_ID,
    components: [],
    content: defaultContent,
    edited_timestamp: null,
    embeds,
    flags: 0,
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
    ...overrides,
  }
}

function replyMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    attachments: [],
    author: { bot: false, id: REPLY_AUTHOR_ID, username: "member" },
    channel_id: CHANNEL_ID,
    content: "Reply target",
    embeds: [],
    guild_id: GUILD_ID,
    id: REPLY_ID,
    pinned: false,
    timestamp: NOW,
    type: 0,
    ...overrides,
  }
}

function createRequest(
  overrides: Partial<EmbedMessageRequest> = {},
): EmbedMessageRequest {
  return {
    action: "create",
    channelId: CHANNEL_ID,
    content: TARGET_CONTENT,
    embeds: TARGET_LAYOUT,
    notifyUserIds: [REPLY_AUTHOR_ID],
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function editRequest(
  overrides: Partial<EmbedMessageRequest> = {},
): EmbedMessageRequest {
  return {
    action: "edit",
    channelId: CHANNEL_ID,
    content: TARGET_CONTENT,
    embeds: TARGET_LAYOUT,
    messageId: EXISTING_ID,
    notifyUserIds: [],
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function configuredPolicy(options: {
  enabled?: boolean
  embedMessageChannelIds?: readonly string[]
  mentionUserIds?: readonly string[]
  permissions?: bigint
  readChannelIds?: readonly string[]
} = {}): { policy: ScopePolicy; roles: DiscordRole[] } {
  const permissions = options.permissions ?? (
    DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.EMBED_LINKS
    | DISCORD_PERMISSIONS.SEND_MESSAGES
  )
  return {
    policy: new ScopePolicy({
      adminGuildIds: new Set(),
      allowedChannelIds: new Set(options.readChannelIds ?? [CHANNEL_ID]),
      allowedGuildIds: new Set([GUILD_ID]),
      allowAdministration: false,
      allowDeletions: false,
      allowEmbedMessages: options.enabled ?? true,
      allowInteractions: false,
      deleteChannelIds: new Set(),
      embedMessageChannelIds: new Set(
        options.embedMessageChannelIds ?? [CHANNEL_ID],
      ),
      interactionChannelIds: new Set(),
      interactionMaxWritesPerMinute: 10,
      interactionMinWriteIntervalMs: 0,
      mentionUserIds: new Set(options.mentionUserIds ?? [REPLY_AUTHOR_ID]),
      protectedUserIds: new Set(),
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
  botMember: DiscordGuildMember
  channel: DiscordChannel
  created: DiscordMessage | null
  current: DiscordMessage
  guild: DiscordGuild
  mutationError: unknown
  parent: DiscordChannel
  readbackError: unknown
  readbackOverrides: Partial<DiscordMessage>
  reply: DiscordMessage
  responseOverrides: Partial<DiscordMessage>
  roles: DiscordRole[]
  threadMember: DiscordThreadMember
}

function fixture(options: {
  operationStore?: MemoryOperationStore
  policyOptions?: Parameters<typeof configuredPolicy>[0]
  state?: Partial<FixtureState>
  verificationKey?: Uint8Array
} = {}) {
  const configured = configuredPolicy(options.policyOptions)
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: botMember(),
    channel: channel(),
    created: null,
    current: embedMessage(EXISTING_ID, wireLayout(CURRENT_LAYOUT)),
    guild: guild(),
    mutationError: undefined,
    parent: channel({ id: PARENT_CHANNEL_ID }),
    readbackError: undefined,
    readbackOverrides: {},
    reply: replyMessage(),
    responseOverrides: {},
    roles: configured.roles,
    threadMember: {
      flags: 0,
      id: CHANNEL_ID,
      join_timestamp: NOW,
      user_id: BOT_ID,
    },
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let createInput: Parameters<
    EmbedMessageServiceOptions["client"]["createEmbedMessage"]
  >[1] | undefined
  let editInput: Parameters<
    EmbedMessageServiceOptions["client"]["editEmbedMessage"]
  >[2] | undefined
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
  const operationStore = options.operationStore ?? new MemoryOperationStore(events)

  const createdMessage = (overrides: Partial<DiscordMessage> = {}) => {
    if (!createInput) throw new Error("missing embed create input")
    const explicitMentionIds = "users" in createInput.allowedMentions
      ? createInput.allowedMentions.users
      : []
    const mentionIds = [...new Set([
      ...explicitMentionIds,
      ...(createInput.allowedMentions.replied_user && createInput.reply
        ? [REPLY_AUTHOR_ID]
        : []),
    ])].sort()
    return embedMessage(CREATED_ID, responseEmbeds(createInput.embeds), {
      content: createInput.content ?? "",
      ...(createInput.reply
        ? {
            message_reference: {
              channel_id: CHANNEL_ID,
              guild_id: GUILD_ID,
              message_id: createInput.reply.messageId,
              type: 0,
            },
            type: 19,
          }
        : {}),
      nonce: createInput.nonce,
      mentions: mentionIds.map((id) => ({ bot: false, id, username: "member" })),
      ...overrides,
    })
  }
  const editedMessage = (overrides: Partial<DiscordMessage> = {}) => {
    if (!editInput) throw new Error("missing embed edit input")
    const mentionIds = "users" in editInput.allowedMentions
      ? editInput.allowedMentions.users
      : []
    return embedMessage(EXISTING_ID, responseEmbeds(editInput.embeds), {
      content: editInput.content,
      edited_timestamp: EDITED,
      flags: 0,
      mentions: mentionIds.map((id) => ({ bot: false, id, username: "member" })),
      pinned: state.current.pinned ?? false,
      timestamp: state.current.timestamp,
      ...overrides,
    })
  }

  const client: EmbedMessageServiceOptions["client"] = {
    async createEmbedMessage(_channelId, input) {
      events.push("write:create")
      if (state.mutationError) throw state.mutationError
      createInput = input
      const response = createdMessage(state.responseOverrides)
      state.created = response
      return response
    },
    async editEmbedMessage(_channelId, _messageId, input) {
      events.push("write:edit")
      if (state.mutationError) throw state.mutationError
      editInput = input
      const response = editedMessage(state.responseOverrides)
      state.current = response
      return response
    },
    async getChannel(channelId) {
      events.push(`read:channel:${channelId}`)
      if (channelId === state.channel.parent_id) return state.parent
      return state.channel
    },
    async getGuild() {
      events.push("read:guild")
      return state.guild
    },
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
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
      if (messageId === CREATED_ID) {
        events.push("read:created")
        if (state.readbackError) throw state.readbackError
        if (state.created) return { ...state.created, ...state.readbackOverrides }
        return createdMessage(state.readbackOverrides)
      }
      events.push(editInput ? "read:edited" : "read:current")
      if (state.readbackError) throw state.readbackError
      return editInput
        ? { ...state.current, ...state.readbackOverrides }
        : state.current
    },
    async getThreadMember() {
      events.push("read:thread-member")
      return state.threadMember
    },
  }
  const service = new EmbedMessageService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    limiter: new InteractionLimiter({
      clock: () => Date.parse(NOW),
      maxWritesPerMinute: 10,
      minWriteIntervalMs: 0,
    }),
    operationStore,
    planKey: new Uint8Array(32).fill(8),
    policy: configured.policy,
    randomId: () => "activity-embed-1",
    ...(options.verificationKey === undefined
      ? {}
      : { verificationKey: options.verificationKey }),
  })
  return {
    activities,
    get createInput() {
      return createInput
    },
    get editInput() {
      return editInput
    },
    events,
    operationStore,
    service,
    state,
  }
}

function verificationReceipt(
  request: EmbedMessageRequest,
  verificationKey: Uint8Array,
  status: EmbedMessageOperationReceipt["status"],
): EmbedMessageOperationReceipt {
  const normalized = normalizeEmbedMessageRequest(request)
  return {
    activityId: "activity-embed-1",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: GUILD_ID,
    kind: "embed-message",
    operationKeyHash: normalized.operationKeyHash,
    planDigest: PLAN_DIGEST,
    requestDigest: embedMessageRequestDigest(
      verificationKey,
      APPLICATION_ID,
      BOT_ID,
      normalized,
    ),
    resourceId: ["completed", "uncertain"].includes(status) ? CREATED_ID : null,
    schemaVersion: 2,
    status,
    timestamp: NOW,
    verification: status === "completed" ? "match" : null,
  }
}

test("embed-message normalization is action-specific and mention-aware", () => {
  const normalized = normalizeEmbedMessageRequest(createRequest())
  assert.equal(normalized.action, "create")
  assert.equal(normalized.messageId, null)
  assert.equal(normalized.operationKeyHash.startsWith("sha256:"), true)
  assert.deepEqual(normalized.notifyUserIds, [REPLY_AUTHOR_ID])
  assert.deepEqual(normalized.review.counts, { embeds: 1, fields: 1 })

  assert.throws(
    () => normalizeEmbedMessageRequest(createRequest({ messageId: EXISTING_ID })),
    /unsupported action fields/,
  )
  assert.throws(
    () => normalizeEmbedMessageRequest({
      ...editRequest(),
      replyToMessageId: REPLY_ID,
    }),
    /unsupported action fields/,
  )
  assert.throws(
    () => normalizeEmbedMessageRequest({
      ...editRequest(),
      messageId: undefined,
    } as unknown as EmbedMessageRequest),
    /edit target ID/,
  )
})

test("embed-message planning binds exact identity, permissions, and transient layout", async () => {
  const current = fixture()
  const request = createRequest({
    notifyReplyAuthor: true,
    replyToMessageId: REPLY_ID,
  })
  const first = await current.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  const second = await current.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )

  assert.equal(first.digest, second.digest)
  assert.equal(first.applicationId, APPLICATION_ID)
  assert.equal(first.messageContentIntent, "enabled")
  assert.equal(first.status, "planned")
  assert.deepEqual(first.target.counts, { embeds: 1, fields: 1 })
  assert.deepEqual(first.privacy.omittedFields, [
    "attachmentUrls",
    "embedLayouts",
    "embedText",
    "messageContent",
    "mentionProfiles",
    "nonce",
    "notificationUserIds",
    "parsedUserMentionIds",
    "rawOperationKey",
    "rawPayloads",
    "replyAuthorId",
  ])
  assert.deepEqual(first.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    "EMBED_LINKS",
    "SEND_MESSAGES",
  ])
  assert.deepEqual(first.reply, {
    authorId: REPLY_AUTHOR_ID,
    messageId: REPLY_ID,
    type: 0,
  })
  assert.equal(JSON.stringify(first).includes(OPERATION_KEY), false)

  const intentMissing = fixture()
  await assert.rejects(
    intentMissing.service.plan(
      APPLICATION_ID,
      BOT_ID,
      "unknown",
      createRequest(),
    ),
    EmbedMessageEvidenceError,
  )
  assert.equal(intentMissing.events.some((event) => event.startsWith("read:")), false)
})

test("embed-message planning rejects incomplete legacy and unsafe mention evidence", async () => {
  const cases: Array<{
    expected: RegExp
    mutate: (message: DiscordMessage) => void
    name: string
  }> = [
    {
      expected: /mismatched embed-message evidence/,
      mutate: (message) => { delete message.attachments },
      name: "missing attachments",
    },
    {
      expected: /mismatched embed-message evidence/,
      mutate: (message) => { delete message.embeds },
      name: "missing embeds",
    },
    {
      expected: /mismatched embed-message evidence/,
      mutate: (message) => { message.tts = true },
      name: "TTS",
    },
    {
      expected: /not an exact default embed message/,
      mutate: (message) => { message.pinned = true },
      name: "pinned target",
    },
    {
      expected: /mismatched embed-message evidence/,
      mutate: (message) => { message.timestamp = "2026-02-31T00:00:00Z" },
      name: "impossible timestamp",
    },
    {
      expected: /exact default message flags/,
      mutate: (message) => { message.flags = 4 },
      name: "nondefault flags",
    },
    {
      expected: /unsafe parsed mention state/,
      mutate: (message) => { message.mention_everyone = true },
      name: "mass mention",
    },
    {
      expected: /unsafe parsed mention state/,
      mutate: (message) => { message.mention_roles = [BOT_ROLE_ID] },
      name: "role mention",
    },
    {
      expected: /absent from its presentation/,
      mutate: (message) => {
        message.mentions = [{ bot: false, id: OWNER_ID, username: "owner" }]
      },
      name: "hidden parsed user mention",
    },
    {
      expected: /duplicate parsed user mentions/,
      mutate: (message) => {
        message.mentions = [
          { bot: false, id: REPLY_AUTHOR_ID, username: "member" },
          { bot: false, id: REPLY_AUTHOR_ID, username: "member" },
        ]
      },
      name: "duplicate parsed user mention",
    },
  ]

  for (const currentCase of cases) {
    const message = embedMessage(EXISTING_ID, wireLayout(TARGET_LAYOUT))
    currentCase.mutate(message)
    const current = fixture({
      state: { current: message },
    })
    await assert.rejects(
      current.service.plan(
        APPLICATION_ID,
        BOT_ID,
        "enabled",
        editRequest(),
      ),
      currentCase.expected,
      currentCase.name,
    )
  }

  const omittedFlagsMessage = embedMessage(EXISTING_ID, wireLayout(TARGET_LAYOUT))
  delete omittedFlagsMessage.flags
  const omittedFlags = fixture({ state: { current: omittedFlagsMessage } })
  const omittedFlagsPlan = await omittedFlags.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    editRequest(),
  )
  assert.equal(omittedFlagsPlan.current?.flags, 0)
})

test("embed-message create reserves, audits, writes once, and verifies readback", async () => {
  const current = fixture()
  const request = createRequest()
  const plan = await current.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)
  const result = await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.messageId, CREATED_ID)
  assert.equal(result.responseMatched, true)
  assert.equal(result.readbackMatched, true)
  assert.equal(
    current.createInput?.nonce,
    embedMessageNonce(CHANNEL_ID, OPERATION_KEY),
  )
  assert.deepEqual(current.createInput?.allowedMentions, {
    replied_user: false,
    users: [REPLY_AUTHOR_ID],
  })
  const executionEvents = current.events.slice(
    current.events.lastIndexOf(`read:channel:${CHANNEL_ID}`),
  )
  assert.equal(
    executionEvents.indexOf("operation:reserve") < executionEvents.indexOf("write:create"),
    true,
  )
  assert.equal(
    executionEvents.indexOf("activity:pending") < executionEvents.indexOf("write:create"),
    true,
  )
  assert.equal(current.events.filter((event) => event === "write:create").length, 1)
  assert.equal(current.operationStore.receipt?.status, "completed")
  const persisted = JSON.stringify({
    activities: current.activities,
    receipt: current.operationStore.receipt,
  })
  for (const privateValue of [
    OPERATION_KEY,
    "After",
    REPLY_AUTHOR_ID,
    "accentColor",
    "generatedEmbedIds",
  ]) {
    assert.equal(persisted.includes(privateValue), false)
  }
})

test("embed-message create keeps reply-author notification separate from visible mentions", async () => {
  const current = fixture()
  const request = createRequest({
    content: "Reviewed reply",
    notifyReplyAuthor: true,
    notifyUserIds: [],
    operationKey: "embed-operation-reply-0001",
    replyToMessageId: REPLY_ID,
  })
  const plan = await current.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)
  const result = await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.deepEqual(current.createInput?.allowedMentions, {
    parse: [],
    replied_user: true,
  })
  assert.deepEqual(current.state.created?.mentions?.map((mention) => mention.id), [
    REPLY_AUTHOR_ID,
  ])
})

test("embed-message verification is restart-safe, request-bound, and read-only", async () => {
  const verificationKey = new Uint8Array(32).fill(9)
  const current = fixture({ verificationKey })
  const request = createRequest({
    notifyReplyAuthor: true,
    replyToMessageId: REPLY_ID,
  })
  const plan = await current.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)
  await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )
  const eventCount = current.events.length
  const activityCount = current.activities.length
  const result = await current.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.deepEqual({
    messageId: result.messageId,
    readbackMatched: result.readbackMatched,
    reason: result.reason,
    requestMatched: result.requestMatched,
    status: result.status,
  }, {
    messageId: CREATED_ID,
    readbackMatched: true,
    reason: null,
    requestMatched: true,
    status: "verified",
  })
  assert.equal(current.activities.length, activityCount)
  assert.equal(
    current.events.slice(eventCount).some((event) => (
      event.startsWith("activity:")
      || event.startsWith("operation:")
      || event.startsWith("write:")
    )),
    false,
  )

  const restarted = fixture({
    operationStore: current.operationStore,
    state: { created: current.state.created },
    verificationKey: new Uint8Array(verificationKey),
  })
  assert.equal((await restarted.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )).status, "verified")

  const readOnlyRestart = fixture({
    operationStore: current.operationStore,
    policyOptions: {
      permissions: DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
    },
    state: { created: current.state.created },
    verificationKey: new Uint8Array(verificationKey),
  })
  assert.equal((await readOnlyRestart.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )).status, "verified")

  const changedRequest = createRequest({
    content: "Different",
    embeds: [{ title: "Different" }],
    notifyReplyAuthor: true,
    notifyUserIds: [],
    replyToMessageId: REPLY_ID,
  })
  const readsBeforeMismatch = restarted.events.filter((event) => event.startsWith("read:")).length
  const mismatch = await restarted.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    changedRequest,
  )
  assert.equal(mismatch.status, "blocked")
  assert.equal(mismatch.reason, "request-mismatch")
  assert.equal(mismatch.requestMatched, false)
  assert.equal(
    restarted.events.filter((event) => event.startsWith("read:")).length,
    readsBeforeMismatch,
  )

  for (const [applicationId, botId] of [
    [OTHER_APPLICATION_ID, BOT_ID],
    [APPLICATION_ID, OTHER_BOT_ID],
  ] as const) {
    const readsBeforeIdentityMismatch = restarted.events.filter(
      (event) => event.startsWith("read:"),
    ).length
    const identityMismatch = await restarted.service.verify(
      applicationId,
      botId,
      "enabled",
      request,
    )
    assert.equal(identityMismatch.status, "blocked")
    assert.equal(identityMismatch.reason, "request-mismatch")
    assert.equal(
      restarted.events.filter((event) => event.startsWith("read:")).length,
      readsBeforeIdentityMismatch,
    )
  }

  const rotated = fixture({
    operationStore: current.operationStore,
    state: { created: current.state.created },
    verificationKey: new Uint8Array(32).fill(10),
  })
  const rotatedResult = await rotated.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.equal(rotatedResult.status, "blocked")
  assert.equal(rotatedResult.reason, "request-mismatch")
  assert.equal(rotated.events.some((event) => event.startsWith("read:")), false)
})

test("embed-message verification fails closed before Discord for absent and incomplete receipts", async () => {
  const verificationKey = new Uint8Array(32).fill(9)
  const request = createRequest()
  const absent = fixture({ verificationKey })
  const absentResult = await absent.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.equal(absentResult.status, "not-found")
  assert.equal(absentResult.reason, "operation-not-found")
  assert.equal(absent.events.some((event) => event.startsWith("read:")), false)

  for (const status of ["pending", "failed", "uncertain"] as const) {
    const current = fixture({ verificationKey })
    current.operationStore.receipt = verificationReceipt(request, verificationKey, status)
    const result = await current.service.verify(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request,
    )
    assert.equal(result.status, "blocked")
    assert.equal(result.reason, `operation-${status}`)
    assert.equal(result.requestMatched, true)
    assert.equal(current.events.some((event) => event.startsWith("read:")), false)
  }
})

test("embed-message verification distinguishes exact edit state from live drift", async () => {
  const verificationKey = new Uint8Array(32).fill(9)
  const edited = fixture({ verificationKey })
  const request = editRequest()
  const plan = await edited.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)
  await edited.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )
  assert.equal((await edited.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )).status, "verified")

  edited.state.current = embedMessage(EXISTING_ID, wireLayout(CURRENT_LAYOUT))
  const drifted = await edited.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.equal(drifted.status, "drifted")
  assert.equal(drifted.reason, "message-state-mismatch")

  const receipt = edited.operationStore.receipt
  assert.ok(receipt?.kind === "embed-message")
  edited.operationStore.receipt = { ...receipt, resourceId: CREATED_ID }
  const eventCount = edited.events.length
  const targetMismatch = await edited.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.equal(targetMismatch.status, "blocked")
  assert.equal(targetMismatch.reason, "receipt-target-mismatch")
  assert.equal(edited.events.length, eventCount)
})

test("embed-message verification reports an exact missing receipt-bound message", async () => {
  const verificationKey = new Uint8Array(32).fill(9)
  const current = fixture({ verificationKey })
  const request = createRequest()
  const plan = await current.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)
  await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )
  current.state.readbackError = new DiscordApiError({
    code: 10_008,
    message: "Unknown Message",
    method: "GET",
    route: `/channels/${CHANNEL_ID}/messages/${CREATED_ID}`,
    status: 404,
  })
  const result = await current.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.equal(result.status, "drifted")
  assert.equal(result.reason, "message-missing")
  assert.equal(result.url, null)
})

test("embed-message edit preserves identity and skips an exact notification-free no-op", async () => {
  const changed = fixture()
  const request = editRequest()
  const plan = await changed.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)
  assert.equal(plan.current?.messageId, EXISTING_ID)
  assert.equal(plan.status, "planned")
  const result = await changed.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.messageId, EXISTING_ID)
  assert.equal(changed.editInput?.content, TARGET_CONTENT)
  assert.deepEqual(changed.editInput?.allowedMentions, {
    parse: [],
    replied_user: false,
  })
  assert.equal(changed.events.filter((event) => event === "write:edit").length, 1)

  const noOp = fixture({
    state: {
      current: embedMessage(EXISTING_ID, wireLayout(TARGET_LAYOUT)),
    },
  })
  const noOpRequest = editRequest()
  const noOpPlan = await noOp.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    noOpRequest,
  )
  assert.equal(noOpPlan.status, "already-current")
  assert.equal(noOpPlan.writeRequired, false)
  assert.deepEqual(noOpPlan.current?.parsedUserMentionIds, [])
  assert.ok(noOpPlan.warnings.some((warning) => warning.includes("record-free no-op")))
  assert.equal(noOpPlan.warnings.some((warning) => warning.includes("non-retried")), false)
  const noOpResult = await noOp.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    noOpRequest,
    noOpPlan.digest,
  )
  assert.equal(noOpResult.status, "already-current")
  assert.equal(noOpResult.activityId, null)
  assert.equal(noOp.events.includes("operation:reserve"), false)
  assert.equal(noOp.events.includes("write:edit"), false)

  const parsedMention = fixture({
    state: {
      current: embedMessage(EXISTING_ID, wireLayout(TARGET_LAYOUT), {
        mentions: [{ bot: false, id: REPLY_AUTHOR_ID, username: "member" }],
      }),
    },
  })
  const suppressionPlan = await parsedMention.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    editRequest(),
  )
  assert.equal(suppressionPlan.writeRequired, true)
  assert.deepEqual(suppressionPlan.current?.parsedUserMentionIds, [REPLY_AUTHOR_ID])
})

test("embed-message planning enforces scope, permissions, and active thread evidence", async () => {
  const disabled = fixture({ policyOptions: { enabled: false } })
  await assert.rejects(
    disabled.service.plan(APPLICATION_ID, BOT_ID, "enabled", createRequest()),
    /embed messages are disabled/,
  )

  const missingSend = fixture({
    policyOptions: {
      permissions: DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
    },
  })
  await assert.rejects(
    missingSend.service.plan(APPLICATION_ID, BOT_ID, "enabled", createRequest()),
    /SEND_MESSAGES/,
  )

  const threadPermissions = DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.EMBED_LINKS
    | DISCORD_PERMISSIONS.SEND_MESSAGES_IN_THREADS
  const privateThread = fixture({
    policyOptions: {
      permissions: threadPermissions,
      readChannelIds: [CHANNEL_ID, PARENT_CHANNEL_ID],
    },
    state: {
      channel: channel({
        parent_id: PARENT_CHANNEL_ID,
        thread_metadata: {
          archive_timestamp: NOW,
          archived: false,
          auto_archive_duration: 1440,
          locked: false,
        },
        type: DISCORD_CHANNEL_TYPES.privateThread,
      }),
      parent: channel({ id: PARENT_CHANNEL_ID }),
    },
  })
  const threadPlan = await privateThread.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    createRequest(),
  )
  assert.equal(threadPlan.permission.permissionSourceChannelId, PARENT_CHANNEL_ID)
  assert.equal(threadPlan.permission.privateThreadAccess, "lookup-succeeded")
  assert.equal(privateThread.events.includes("read:thread-member"), true)

  privateThread.state.channel.thread_metadata = {
    archive_timestamp: NOW,
    archived: true,
    auto_archive_duration: 1440,
    locked: false,
  }
  await assert.rejects(
    privateThread.service.plan(APPLICATION_ID, BOT_ID, "enabled", createRequest({
      operationKey: "embed-operation-0002",
    })),
    /must be active and unlocked/,
  )
})

test("embed-message execution refuses fresh-plan drift and spent operation keys", async () => {
  const drift = fixture()
  const request = createRequest()
  const plan = await drift.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)
  drift.state.guild = guild({ name: "Changed guild" })
  await assert.rejects(
    drift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request,
      plan.digest,
    ),
    EmbedMessagePlanChangedError,
  )
  assert.equal(drift.events.includes("operation:reserve"), false)
  assert.equal(drift.events.includes("write:create"), false)

  const spent = fixture()
  const spentPlan = await spent.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  await spent.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    spentPlan.digest,
  )
  await assert.rejects(
    spent.service.plan(APPLICATION_ID, BOT_ID, "enabled", request),
    EmbedMessageOperationConflictError,
  )
  assert.equal(spent.events.filter((event) => event === "write:create").length, 1)
})

test("embed-message execution separates deterministic rejection from uncertainty", async () => {
  const rejected = fixture({
    state: {
      mutationError: new DiscordApiError({
        code: 50_013,
        message: "Missing Permissions",
        method: "POST",
        route: `/channels/${CHANNEL_ID}/messages`,
        status: 403,
      }),
    },
  })
  const request = createRequest()
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  await assert.rejects(
    rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request,
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof EmbedMessageExecutionError
      && (error.result as { messageId: null; status: string }).messageId === null
      && (error.result as { status: string }).status === "failed"
    ),
  )
  assert.equal(rejected.operationStore.receipt?.status, "failed")

  const uncertain = fixture({
    state: {
      readbackOverrides: { content: "Discord changed it" },
    },
  })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  await assert.rejects(
    uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request,
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof EmbedMessageExecutionError
      && (error.result as { messageId: string; status: string }).messageId === CREATED_ID
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal(uncertain.operationStore.receipt?.status, "uncertain")

  const mentionMismatch = fixture({
    state: {
      responseOverrides: { mentions: [] },
    },
  })
  const mentionPlan = await mentionMismatch.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  await assert.rejects(
    mentionMismatch.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request,
      mentionPlan.digest,
    ),
    (error: unknown) => (
      error instanceof EmbedMessageExecutionError
      && (error.result as { responseMatched: null; status: string }).responseMatched === null
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal(mentionMismatch.operationStore.receipt?.status, "uncertain")
})

test("embed-message execution blocks before write when pending audit fails", async () => {
  const current = fixture({ state: { activityFailureAt: 1 } })
  const request = createRequest()
  const plan = await current.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)
  await assert.rejects(
    current.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof EmbedMessageExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(current.events.includes("write:create"), false)
  assert.equal(current.operationStore.receipt?.status, "failed")
})
