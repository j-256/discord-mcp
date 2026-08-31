import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import type {
  DiscordLinkButtonComponent,
  DiscordRequestButtonComponent,
  DiscordStaticComponent,
} from "../src/component-layout.js"
import {
  componentMessageRequestDigest,
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
  ComponentMessageOperationReceipt,
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
const OPERATION_KEY = "component-operation-0001"
const PLAN_DIGEST = `hmac-sha256:${"a".repeat(64)}`
const NOW = "2026-08-22T00:00:00.000Z"
const EDITED = "2026-08-22T00:01:00.000Z"
const REQUEST_BUTTON_KEY = new Uint8Array(32).fill(9)
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
  const visit = (
    component:
      | DiscordLinkButtonComponent
      | DiscordRequestButtonComponent
      | DiscordStaticComponent,
  ): Record<string, unknown> => {
    const id = nextId
    nextId += 1
    if (component.type === 1 || component.type === 17) {
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
  componentLinkOrigins?: readonly string[]
  enabled?: boolean
  interactionChannelIds?: readonly string[]
  mentionUserIds?: readonly string[]
  nativeInteractionsEnabled?: boolean
  nativeInteractionChannelIds?: readonly string[]
  permissions?: bigint
  readChannelIds?: readonly string[]
  userMentionMode?: "allowlist" | "disabled" | "reviewed"
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
      componentLinkOrigins: new Set(options.componentLinkOrigins ?? []),
      deleteChannelIds: new Set(),
      interactionChannelIds: new Set(
        options.interactionChannelIds ?? [CHANNEL_ID],
      ),
      interactionMaxWritesPerMinute: 10,
      interactionMinWriteIntervalMs: 0,
      mentionUserIds: new Set(options.mentionUserIds ?? [REPLY_AUTHOR_ID]),
      allowNativeInteractions: options.nativeInteractionsEnabled ?? false,
      nativeInteractionChannelIds: new Set(
        options.nativeInteractionChannelIds ?? [],
      ),
      nativeInteractionGuildIds: new Set(
        options.nativeInteractionsEnabled ? [GUILD_ID] : [],
      ),
      nativeInteractionUserIds: new Set(
        options.nativeInteractionsEnabled ? [REPLY_AUTHOR_ID] : [],
      ),
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
  requestButtonKey?: Uint8Array
  requestButtonReadiness?: ComponentMessageServiceOptions["requestButtonReadiness"]
} = {}) {
  const configured = configuredPolicy(options.policyOptions)
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: botMember(),
    channel: channel(),
    created: null,
    current: componentMessage(EXISTING_ID, wireLayout(CURRENT_LAYOUT)),
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
  const operationStore = options.operationStore ?? new MemoryOperationStore(events)

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
      const response = createdMessage(state.responseOverrides)
      state.created = response
      return response
    },
    async editComponentMessage(_channelId, _messageId, input) {
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
    requestButtonKey: options.requestButtonKey ?? REQUEST_BUTTON_KEY,
    ...(options.requestButtonReadiness === undefined
      ? {}
      : { requestButtonReadiness: options.requestButtonReadiness }),
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
  request: ComponentMessageRequest,
  verificationKey: Uint8Array,
  status: ComponentMessageOperationReceipt["status"],
): ComponentMessageOperationReceipt {
  const normalized = normalizeComponentMessageRequest(request)
  return {
    activityId: "activity-component-1",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: GUILD_ID,
    kind: "component-message",
    operationKeyHash: normalized.operationKeyHash,
    planDigest: PLAN_DIGEST,
    requestDigest: componentMessageRequestDigest(
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
    "requestButtonCustomIds",
    "requestButtonRoutes",
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

test("component-message plans bind reviewed authorization for unlisted exact notifications", async () => {
  const current = fixture({
    policyOptions: {
      mentionUserIds: [],
      userMentionMode: "reviewed",
    },
  })
  const request = createRequest()
  const plan = await current.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )

  assert.equal(plan.notificationAuthorization.reviewRequired, true)
  assert.deepEqual(
    plan.notificationAuthorization.userMentions.reviewedUserIds,
    [REPLY_AUTHOR_ID],
  )
  assert.deepEqual(current.createInput?.allowedMentions, {
    replied_user: false,
    users: [REPLY_AUTHOR_ID],
  })
})

test("component-message planning requires every exact link origin before Discord contact", async () => {
  const request = createRequest({
    components: [
      { content: "Read the guide", kind: "text" },
      {
        buttons: [{ label: "Guide", url: "https://docs.example.com/guide" }],
        kind: "link-row",
      },
    ],
    notifyUserIds: [],
  })
  const blocked = fixture()

  await assert.rejects(
    blocked.service.plan(APPLICATION_ID, BOT_ID, "enabled", request),
    /Component link origin https:\/\/docs\.example\.com is outside the exact configured origin scope/,
  )
  assert.equal(blocked.events.length, 0)

  const allowed = fixture({
    policyOptions: { componentLinkOrigins: ["https://docs.example.com"] },
  })
  const plan = await allowed.service.plan(APPLICATION_ID, BOT_ID, "enabled", request)

  assert.deepEqual(plan.target.linkOrigins, ["https://docs.example.com"])
  assert.deepEqual(plan.target.linkUrls, ["https://docs.example.com/guide"])
  assert.equal(plan.target.counts.actionRows, 1)
  assert.equal(plan.target.counts.linkButtons, 1)
  assert.equal(allowed.events[0], `read:channel:${CHANNEL_ID}`)
  const result = await allowed.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  const verification = await allowed.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.equal(verification.status, "verified")

  const revoked = fixture({ operationStore: allowed.operationStore })
  await assert.rejects(
    revoked.service.verify(APPLICATION_ID, BOT_ID, "enabled", request),
    /outside the exact configured origin scope/,
  )
  assert.deepEqual(revoked.events, [])
})

test("component-message request Buttons bind ready exact ingress and authenticated readback", async () => {
  const request = createRequest({
    components: [
      { content: "Choose a private request", kind: "text" },
      {
        buttons: [
          { label: "Summarize release", style: "primary" },
          { label: "Assess blockers", style: "danger" },
        ],
        kind: "request-row",
      },
    ],
    notifyUserIds: [],
  })
  const current = fixture({
    policyOptions: {
      nativeInteractionChannelIds: [CHANNEL_ID],
      nativeInteractionsEnabled: true,
    },
    requestButtonReadiness: (guildId) => ({
      commandId: "700000000000000001",
      commandVersion: "700000000000000002",
      gatewayDelivery: "verified",
      guildId,
      phase: "ready",
      ready: true,
      schemaVersion: 1,
    }),
  })

  const plan = await current.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )

  assert.equal(plan.requestButtons.count, 2)
  assert.deepEqual(plan.requestButtons.ingress, {
    authorizedUserIds: [REPLY_AUTHOR_ID],
    commandId: "700000000000000001",
    commandVersion: "700000000000000002",
    gatewayDelivery: "verified",
    guildId: GUILD_ID,
    phase: "ready",
    ready: true,
    schemaVersion: 1,
  })
  assert.match(plan.warnings.join("\n"), /grant no write or administration authority/)
  assert.equal(JSON.stringify(plan).includes("dmcp1."), false)

  const result = await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  const compiled = current.createInput?.components as unknown as readonly Record<string, unknown>[]
  const row = compiled[1]
  const buttons = row?.components as readonly Record<string, unknown>[]
  assert.equal(buttons.length, 2)
  assert.equal(typeof buttons[0]?.custom_id, "string")
  assert.match(String(buttons[0]?.custom_id), /^dmcp1\./)
  assert.notEqual(buttons[0]?.custom_id, buttons[1]?.custom_id)
  assert.equal(JSON.stringify(current.activities).includes("Summarize release"), false)
  assert.equal(JSON.stringify(current.activities).includes("dmcp1."), false)
  assert.equal(JSON.stringify(current.operationStore.receipt).includes("dmcp1."), false)

  const restarted = fixture({
    operationStore: current.operationStore,
    state: { created: current.state.created },
  })
  const verification = await restarted.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.equal(verification.status, "verified")
  assert.equal(restarted.events.includes("write:create"), false)
})

test("component-message request Button execution rejects changed ingress readiness", async () => {
  const request = createRequest({
    components: [
      { content: "Choose a private request", kind: "text" },
      {
        buttons: [{ label: "Private request" }],
        kind: "request-row",
      },
    ],
    notifyUserIds: [],
  })
  let commandVersion = "700000000000000002"
  const current = fixture({
    policyOptions: {
      nativeInteractionChannelIds: [CHANNEL_ID],
      nativeInteractionsEnabled: true,
    },
    requestButtonReadiness: (guildId) => ({
      commandId: "700000000000000001",
      commandVersion,
      gatewayDelivery: "verified",
      guildId,
      phase: "ready",
      ready: true,
      schemaVersion: 1,
    }),
  })
  const plan = await current.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )

  commandVersion = "700000000000000003"
  await assert.rejects(
    current.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request,
      plan.digest,
    ),
    ComponentMessagePlanChangedError,
  )
  assert.equal(current.events.includes("write:create"), false)
})

test("component-message request Button publication fails closed without exact ready ingress", async () => {
  const request = createRequest({
    components: [
      { content: "Choose a private request", kind: "text" },
      {
        buttons: [{ label: "Private request" }],
        kind: "request-row",
      },
    ],
    notifyUserIds: [],
  })
  const missingBroker = fixture({
    policyOptions: {
      nativeInteractionChannelIds: [CHANNEL_ID],
      nativeInteractionsEnabled: true,
    },
  })
  await assert.rejects(
    missingBroker.service.plan(APPLICATION_ID, BOT_ID, "enabled", request),
    /paired native Interaction broker/,
  )

  const checking = fixture({
    policyOptions: {
      nativeInteractionChannelIds: [CHANNEL_ID],
      nativeInteractionsEnabled: true,
    },
    requestButtonReadiness: (guildId) => ({
      commandId: "700000000000000001",
      commandVersion: "700000000000000002",
      gatewayDelivery: null,
      guildId,
      phase: "checking",
      ready: false,
      schemaVersion: 1,
    }),
  })
  await assert.rejects(
    checking.service.plan(APPLICATION_ID, BOT_ID, "enabled", request),
    /ready, verified native Interaction ingress/,
  )

  const wrongChannel = fixture({
    policyOptions: {
      nativeInteractionChannelIds: [PARENT_CHANNEL_ID],
      nativeInteractionsEnabled: true,
    },
    requestButtonReadiness: () => {
      throw new Error("readiness must not be consulted outside exact scope")
    },
  })
  await assert.rejects(
    wrongChannel.service.plan(APPLICATION_ID, BOT_ID, "enabled", request),
    /outside the native Interaction scope/,
  )
  assert.equal(wrongChannel.events.includes("write:create"), false)
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

test("component-message verification is restart-safe, request-bound, and read-only", async () => {
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
    components: [{ content: "Different", kind: "text" }],
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

test("component-message verification fails closed before Discord for absent and incomplete receipts", async () => {
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

test("component-message verification distinguishes exact edit state from live drift", async () => {
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

  edited.state.current = componentMessage(EXISTING_ID, wireLayout(CURRENT_LAYOUT))
  const drifted = await edited.service.verify(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request,
  )
  assert.equal(drifted.status, "drifted")
  assert.equal(drifted.reason, "message-state-mismatch")

  const receipt = edited.operationStore.receipt
  assert.ok(receipt?.kind === "component-message")
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

test("component-message verification reports an exact missing receipt-bound message", async () => {
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
