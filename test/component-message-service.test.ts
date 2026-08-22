import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import type {
  DiscordStaticComponent,
} from "../src/component-layout.js"
import {
  componentMessageNonce,
  ComponentMessageService,
  normalizeComponentMessageRequest,
  type ComponentMessageRequest,
  type ComponentMessageServiceOptions,
} from "../src/component-message-service.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_MESSAGE_FLAGS,
} from "../src/constants.js"
import {
  ComponentMessageEvidenceError,
  ComponentMessageExecutionError,
  ComponentMessageOperationConflictError,
  ComponentMessagePlanChangedError,
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
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
  DiscordThreadMember,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "300000000000000002"
const CHANNEL_ID = "400000000000000001"
const PARENT_CHANNEL_ID = "400000000000000002"
const REPLY_ID = "500000000000000001"
const REPLY_AUTHOR_ID = "500000000000000002"
const EXISTING_ID = "600000000000000001"
const CREATED_ID = "600000000000000002"
const OPERATION_KEY = "component-operation-0001"
const NOW = "2026-08-22T00:00:00.000Z"
const EDITED = "2026-08-22T00:01:00.000Z"
const CURRENT_LAYOUT = [{ content: "Before", kind: "text" as const }]
const TARGET_LAYOUT = [{
  accentColor: 0x58_65_F2,
  components: [
    { content: `After <@${REPLY_AUTHOR_ID}>`, kind: "text" as const },
    { divider: true, kind: "separator" as const, spacing: "small" as const },
  ],
  kind: "container" as const,
  spoiler: false,
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

function withGeneratedIds(
  components: readonly DiscordStaticComponent[],
): unknown[] {
  let nextId = 1
  const visit = (component: DiscordStaticComponent): Record<string, unknown> => {
    const id = nextId
    nextId += 1
    if (component.type === 17) {
      return {
        ...component,
        components: component.components.map(visit),
        id,
      }
    }
    return { ...component, id }
  }
  return components.map(visit)
}

function wireLayout(
  layout: typeof CURRENT_LAYOUT | typeof TARGET_LAYOUT,
): unknown[] {
  if (layout === CURRENT_LAYOUT) {
    return [{ content: "Before", id: 1, type: 10 }]
  }
  return [{
    accent_color: 0x58_65_F2,
    components: [
      { content: `After <@${REPLY_AUTHOR_ID}>`, id: 2, type: 10 },
      { divider: true, id: 3, spacing: 1, type: 14 },
    ],
    id: 1,
    spoiler: false,
    type: 17,
  }]
}

function componentMessage(
  id: string,
  components: unknown[],
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: { bot: true, id: BOT_ID, username: "connector" },
    channel_id: CHANNEL_ID,
    components,
    content: "",
    edited_timestamp: null,
    embeds: [],
    flags: DISCORD_MESSAGE_FLAGS.isComponentsV2,
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
  overrides: Partial<ComponentMessageRequest> = {},
): ComponentMessageRequest {
  return {
    action: "create",
    channelId: CHANNEL_ID,
    components: TARGET_LAYOUT,
    notifyUserIds: [REPLY_AUTHOR_ID],
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function editRequest(
  overrides: Partial<ComponentMessageRequest> = {},
): ComponentMessageRequest {
  return {
    action: "edit",
    channelId: CHANNEL_ID,
    components: TARGET_LAYOUT,
    messageId: EXISTING_ID,
    notifyUserIds: [],
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function configuredPolicy(options: {
  enabled?: boolean
  interactionChannelIds?: readonly string[]
  mentionUserIds?: readonly string[]
  permissions?: bigint
  readChannelIds?: readonly string[]
} = {}): { policy: ScopePolicy; roles: DiscordRole[] } {
  const permissions = options.permissions ?? (
    DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    | DISCORD_PERMISSIONS.SEND_MESSAGES
  )
  return {
    policy: new ScopePolicy({
      adminGuildIds: new Set(),
      allowedChannelIds: new Set(options.readChannelIds ?? [CHANNEL_ID]),
      allowedGuildIds: new Set([GUILD_ID]),
      allowAdministration: false,
      allowDeletions: false,
      allowInteractions: options.enabled ?? true,
      deleteChannelIds: new Set(),
      interactionChannelIds: new Set(
        options.interactionChannelIds ?? [CHANNEL_ID],
      ),
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
  current: DiscordMessage
  guild: DiscordGuild
  mutationError: unknown
  parent: DiscordChannel
  readbackOverrides: Partial<DiscordMessage>
  reply: DiscordMessage
  responseOverrides: Partial<DiscordMessage>
  roles: DiscordRole[]
  threadMember: DiscordThreadMember
}

function fixture(options: {
  policyOptions?: Parameters<typeof configuredPolicy>[0]
  state?: Partial<FixtureState>
} = {}) {
  const configured = configuredPolicy(options.policyOptions)
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: botMember(),
    channel: channel(),
    current: componentMessage(EXISTING_ID, wireLayout(CURRENT_LAYOUT)),
    guild: guild(),
    mutationError: undefined,
    parent: channel({ id: PARENT_CHANNEL_ID }),
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
    ComponentMessageServiceOptions["client"]["createComponentMessage"]
  >[1] | undefined
  let editInput: Parameters<
    ComponentMessageServiceOptions["client"]["editComponentMessage"]
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
  const operationStore = new MemoryOperationStore(events)

  const createdMessage = (overrides: Partial<DiscordMessage> = {}) => {
    if (!createInput) throw new Error("missing component create input")
    const explicitMentionIds = "users" in createInput.allowedMentions
      ? createInput.allowedMentions.users
      : []
    const mentionIds = [...new Set([
      ...explicitMentionIds,
      ...(createInput.allowedMentions.replied_user && createInput.reply
        ? [REPLY_AUTHOR_ID]
        : []),
    ])].sort()
    return componentMessage(CREATED_ID, withGeneratedIds(createInput.components), {
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
    if (!editInput) throw new Error("missing component edit input")
    const mentionIds = "users" in editInput.allowedMentions
      ? editInput.allowedMentions.users
      : []
    return componentMessage(EXISTING_ID, withGeneratedIds(editInput.components), {
      edited_timestamp: EDITED,
      flags: editInput.flags,
      mentions: mentionIds.map((id) => ({ bot: false, id, username: "member" })),
      pinned: state.current.pinned ?? false,
      timestamp: state.current.timestamp,
      ...overrides,
    })
  }

  const client: ComponentMessageServiceOptions["client"] = {
    async createComponentMessage(_channelId, input) {
      events.push("write:create")
      if (state.mutationError) throw state.mutationError
      createInput = input
      return createdMessage(state.responseOverrides)
    },
    async editComponentMessage(_channelId, _messageId, input) {
      events.push("write:edit")
      if (state.mutationError) throw state.mutationError
      editInput = input
      return editedMessage(state.responseOverrides)
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
        return createdMessage(state.readbackOverrides)
      }
      events.push(editInput ? "read:edited" : "read:current")
      return editInput
        ? editedMessage(state.readbackOverrides)
        : state.current
    },
    async getThreadMember() {
      events.push("read:thread-member")
      return state.threadMember
    },
  }
  const service = new ComponentMessageService({
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
    randomId: () => "activity-component-1",
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

test("component-message normalization is action-specific and mention-aware", () => {
  const normalized = normalizeComponentMessageRequest(createRequest())
  assert.equal(normalized.action, "create")
  assert.equal(normalized.messageId, null)
  assert.equal(normalized.operationKeyHash.startsWith("sha256:"), true)
  assert.deepEqual(normalized.notifyUserIds, [REPLY_AUTHOR_ID])
  assert.equal(normalized.review.counts.total, 3)

  assert.throws(
    () => normalizeComponentMessageRequest(createRequest({ messageId: EXISTING_ID })),
    /unsupported action fields/,
  )
  assert.throws(
    () => normalizeComponentMessageRequest({
      ...editRequest(),
      replyToMessageId: REPLY_ID,
    }),
    /unsupported action fields/,
  )
  assert.throws(
    () => normalizeComponentMessageRequest({
      ...editRequest(),
      messageId: undefined,
    } as unknown as ComponentMessageRequest),
    /edit target ID/,
  )
})

test("component-message planning binds exact identity, permissions, and transient layout", async () => {
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
  assert.equal(first.target.counts.total, 3)
  assert.deepEqual(first.privacy.omittedFields, [
    "attachmentUrls",
    "componentLayouts",
    "componentText",
    "embeds",
    "generatedComponentIds",
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
    ComponentMessageEvidenceError,
  )
  assert.equal(intentMissing.events.some((event) => event.startsWith("read:")), false)
})

test("component-message planning rejects incomplete legacy and unsafe mention evidence", async () => {
  const cases: Array<{
    expected: RegExp
    mutate: (message: DiscordMessage) => void
    name: string
  }> = [
    {
      expected: /mismatched or legacy/,
      mutate: (message) => { delete message.attachments },
      name: "missing attachments",
    },
    {
      expected: /mismatched or legacy/,
      mutate: (message) => { delete message.embeds },
      name: "missing embeds",
    },
    {
      expected: /mismatched or legacy/,
      mutate: (message) => { message.tts = true },
      name: "TTS",
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
      expected: /absent from its layout/,
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
    const message = componentMessage(EXISTING_ID, wireLayout(TARGET_LAYOUT))
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
})

test("component-message create reserves, audits, writes once, and verifies readback", async () => {
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
    componentMessageNonce(CHANNEL_ID, OPERATION_KEY),
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
    "generatedComponentIds",
  ]) {
    assert.equal(persisted.includes(privateValue), false)
  }
})

test("component-message edit preserves flags and skips an exact notification-free no-op", async () => {
  const preservedFlags = DISCORD_MESSAGE_FLAGS.isComponentsV2
    | DISCORD_MESSAGE_FLAGS.suppressEmbeds
  const changed = fixture({
    state: {
      current: componentMessage(EXISTING_ID, wireLayout(CURRENT_LAYOUT), {
        flags: preservedFlags,
      }),
    },
  })
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
  assert.equal(changed.editInput?.flags, preservedFlags)
  assert.deepEqual(changed.editInput?.allowedMentions, {
    parse: [],
    replied_user: false,
  })
  assert.equal(changed.events.filter((event) => event === "write:edit").length, 1)

  const noOp = fixture({
    state: {
      current: componentMessage(EXISTING_ID, wireLayout(TARGET_LAYOUT)),
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
      current: componentMessage(EXISTING_ID, wireLayout(TARGET_LAYOUT), {
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

test("component-message planning enforces scope, permissions, and active thread evidence", async () => {
  const disabled = fixture({ policyOptions: { enabled: false } })
  await assert.rejects(
    disabled.service.plan(APPLICATION_ID, BOT_ID, "enabled", createRequest()),
    /interactions are disabled/,
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
      operationKey: "component-operation-0002",
    })),
    /must be active and unlocked/,
  )
})

test("component-message execution refuses fresh-plan drift and spent operation keys", async () => {
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
    ComponentMessagePlanChangedError,
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
    ComponentMessageOperationConflictError,
  )
  assert.equal(spent.events.filter((event) => event === "write:create").length, 1)
})

test("component-message execution separates deterministic rejection from uncertainty", async () => {
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
      error instanceof ComponentMessageExecutionError
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
      error instanceof ComponentMessageExecutionError
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
      error instanceof ComponentMessageExecutionError
      && (error.result as { responseMatched: null; status: string }).responseMatched === null
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal(mentionMismatch.operationStore.receipt?.status, "uncertain")
})

test("component-message execution blocks before write when pending audit fails", async () => {
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
      error instanceof ComponentMessageExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(current.events.includes("write:create"), false)
  assert.equal(current.operationStore.receipt?.status, "failed")
})
