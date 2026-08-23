import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
} from "../src/constants.js"
import type { CreateMessageForwardInput } from "../src/discord-client.js"
import {
  DiscordApiError,
  MessageForwardExecutionError,
  MessageForwardOperationConflictError,
  MessageForwardPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import {
  MessageForwardingService,
  normalizeMessageForwardRequest,
  type MessageForwardRequest,
  type MessageForwardServiceOptions,
} from "../src/message-forwarding-service.js"
import { normalizeMessage } from "../src/normalize.js"
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
  DiscordMessageSnapshot,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const SOURCE_GUILD_ID = "200000000000000001"
const TARGET_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const SOURCE_BOT_ROLE_ID = "400000000000000001"
const TARGET_BOT_ROLE_ID = "400000000000000002"
const SOURCE_CHANNEL_ID = "500000000000000001"
const TARGET_CHANNEL_ID = "500000000000000002"
const SOURCE_MESSAGE_ID = "600000000000000001"
const TARGET_MESSAGE_ID = "600000000000000002"
const AUTHOR_ID = "700000000000000001"
const MENTION_ID = "700000000000000002"
const OPERATION_KEY = "message-forward-operation-0001"
const NOW = "2026-08-23T00:00:00.000Z"
const TARGET_NOW = "2026-08-23T00:00:01.000Z"
const CONTENT = "Private roadmap detail"
const ATTACHMENT_FILENAME = "private-roadmap.txt"

const REQUIRED_PERMISSIONS = DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
  | DISCORD_PERMISSIONS.SEND_MESSAGES
  | DISCORD_PERMISSIONS.VIEW_CHANNEL

function role(
  guildId: string,
  id: string,
  permissions: bigint,
  position: number,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === guildId ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position,
  }
}

function channel(
  id: string,
  guildId: string,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: guildId,
    id,
    name: id === SOURCE_CHANNEL_ID ? "source" : "target",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function sourceMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    attachments: [{
      content_type: "text/plain",
      description: "Roadmap notes",
      filename: ATTACHMENT_FILENAME,
      height: null,
      id: "800000000000000001",
      proxy_url: "https://media.example.invalid/proxy/source",
      size: 42,
      url: "https://media.example.invalid/source",
      width: null,
    }],
    author: { bot: false, id: AUTHOR_ID, username: "source-author" },
    channel_id: SOURCE_CHANNEL_ID,
    components: [{ type: 1 }],
    content: CONTENT,
    edited_timestamp: null,
    embeds: [{ description: "Embedded detail", type: "rich" }],
    flags: 0,
    guild_id: SOURCE_GUILD_ID,
    id: SOURCE_MESSAGE_ID,
    mention_everyone: false,
    mention_roles: ["900000000000000001"],
    mentions: [{
      avatar: null,
      bot: false,
      discriminator: "0",
      global_name: "Mentioned Member",
      id: MENTION_ID,
      username: "mentioned-member",
    }],
    pinned: false,
    sticker_items: [{ format_type: 1, id: "910000000000000001", name: "wave" }],
    stickers: [],
    timestamp: NOW,
    tts: false,
    type: 0,
    ...overrides,
  }
}

function snapshotFromSource(message: DiscordMessage): DiscordMessageSnapshot["message"] {
  return {
    attachments: (message.attachments ?? []).map((attachment) => ({
      ...attachment,
      proxy_url: `${attachment.proxy_url ?? attachment.url}?snapshot=1`,
      url: `${attachment.url}?snapshot=1`,
    })),
    components: message.components ?? [],
    content: message.content,
    edited_timestamp: message.edited_timestamp ?? null,
    embeds: message.embeds ?? [],
    flags: message.flags ?? 0,
    mention_roles: message.mention_roles ?? [],
    mentions: message.mentions ?? [],
    sticker_items: message.sticker_items ?? [],
    stickers: message.stickers ?? [],
    timestamp: message.timestamp,
    type: message.type,
  }
}

function forwardedMessage(
  source: DiscordMessage,
  nonce: string,
  targetGuildId: string,
  overrides: Partial<DiscordMessage> = {},
  snapshotOverrides: Partial<DiscordMessageSnapshot["message"]> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: { bot: true, id: BOT_ID, username: "connector" },
    channel_id: TARGET_CHANNEL_ID,
    components: [],
    content: "",
    edited_timestamp: null,
    embeds: [],
    flags: DISCORD_MESSAGE_FLAGS.hasSnapshot
      | DISCORD_MESSAGE_FLAGS.suppressNotifications,
    guild_id: targetGuildId,
    id: TARGET_MESSAGE_ID,
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    message_reference: {
      channel_id: SOURCE_CHANNEL_ID,
      guild_id: SOURCE_GUILD_ID,
      message_id: SOURCE_MESSAGE_ID,
      type: DISCORD_MESSAGE_REFERENCE_TYPES.forward,
    },
    message_snapshots: [{
      message: {
        ...snapshotFromSource(source),
        ...snapshotOverrides,
      },
    }],
    nonce,
    pinned: false,
    sticker_items: [],
    stickers: [],
    timestamp: TARGET_NOW,
    tts: false,
    type: 0,
    ...overrides,
  }
}

function request(overrides: Partial<MessageForwardRequest> = {}): MessageForwardRequest {
  return {
    operationKey: OPERATION_KEY,
    sourceChannelId: SOURCE_CHANNEL_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    targetChannelId: TARGET_CHANNEL_ID,
    ...overrides,
  }
}

function policy(options: {
  crossGuild?: boolean
  enabled?: boolean
  sourceIds?: readonly string[]
  targetGuildId?: string
  targetIds?: readonly string[]
} = {}): ScopePolicy {
  const targetGuildId = options.targetGuildId ?? SOURCE_GUILD_ID
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([SOURCE_CHANNEL_ID, TARGET_CHANNEL_ID]),
    allowedGuildIds: new Set([SOURCE_GUILD_ID, targetGuildId]),
    allowAdministration: false,
    allowCrossGuildMessageForwarding: options.crossGuild ?? false,
    allowDeletions: false,
    allowInteractions: false,
    allowMessageForwarding: options.enabled ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    messageForwardSourceChannelIds: new Set(options.sourceIds ?? [SOURCE_CHANNEL_ID]),
    messageForwardTargetChannelIds: new Set(options.targetIds ?? [TARGET_CHANNEL_ID]),
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
  activitiesFailAt: number | null
  createCalls: number
  createError: unknown
  created: boolean
  lastCreateInput: CreateMessageForwardInput | null
  readbackError: unknown
  readbackOverrides: Partial<DiscordMessage>
  responseOverrides: Partial<DiscordMessage>
  snapshotOverrides: Partial<DiscordMessageSnapshot["message"]>
  sourceChannel: DiscordChannel
  sourceMessageOverrides: Partial<DiscordMessage>
  sourcePermissions: bigint
  targetChannel: DiscordChannel
  targetGuildId: string
  targetPermissions: bigint
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activitiesFailAt: null,
    createCalls: 0,
    createError: undefined,
    created: false,
    lastCreateInput: null,
    readbackError: undefined,
    readbackOverrides: {},
    responseOverrides: {},
    snapshotOverrides: {},
    sourceChannel: channel(SOURCE_CHANNEL_ID, SOURCE_GUILD_ID),
    sourceMessageOverrides: {},
    sourcePermissions: REQUIRED_PERMISSIONS,
    targetChannel: channel(TARGET_CHANNEL_ID, SOURCE_GUILD_ID),
    targetGuildId: SOURCE_GUILD_ID,
    targetPermissions: REQUIRED_PERMISSIONS,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activitiesFailAt === activityCalls) throw new Error("activity unavailable")
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(events)
  const client: MessageForwardServiceOptions["client"] = {
    async createMessageForward(_channelId, input) {
      state.createCalls += 1
      state.lastCreateInput = input
      events.push("write:forward")
      if (state.createError) throw state.createError
      state.created = true
      return forwardedMessage(
        sourceMessage(state.sourceMessageOverrides),
        input.nonce,
        state.targetGuildId,
        state.responseOverrides,
        state.snapshotOverrides,
      )
    },
    async getChannel(channelId) {
      events.push(`read:channel:${channelId}`)
      return channelId === SOURCE_CHANNEL_ID
        ? state.sourceChannel
        : state.targetChannel
    },
    async getGuild(guildId) {
      events.push(`read:guild:${guildId}`)
      return { id: guildId, name: guildId === SOURCE_GUILD_ID ? "Source Guild" : "Target Guild" }
    },
    async getGuildMember(guildId) {
      events.push(`read:member:${guildId}`)
      const member: DiscordGuildMember = {
        roles: [guildId === SOURCE_GUILD_ID ? SOURCE_BOT_ROLE_ID : TARGET_BOT_ROLE_ID],
        user: { bot: true, id: BOT_ID, username: "connector" },
      }
      return member
    },
    async getGuildRoles(guildId) {
      events.push(`read:roles:${guildId}`)
      const permissions = guildId === SOURCE_GUILD_ID
        ? state.sourcePermissions
        : state.targetPermissions
      const botRoleId = guildId === SOURCE_GUILD_ID
        ? SOURCE_BOT_ROLE_ID
        : TARGET_BOT_ROLE_ID
      return [
        role(guildId, guildId, permissions, 0),
        role(guildId, botRoleId, 0n, 10),
      ]
    },
    async getMessage(channelId) {
      if (channelId === SOURCE_CHANNEL_ID) {
        events.push("read:source-message")
        return sourceMessage(state.sourceMessageOverrides)
      }
      events.push("read:target-message")
      if (state.readbackError) throw state.readbackError
      if (!state.created || !state.lastCreateInput) throw new Error("target message is absent")
      return forwardedMessage(
        sourceMessage(state.sourceMessageOverrides),
        state.lastCreateInput.nonce,
        state.targetGuildId,
        state.readbackOverrides,
        state.snapshotOverrides,
      )
    },
  }
  const service = new MessageForwardingService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(9),
    policy: options.policy ?? policy({ targetGuildId: state.targetGuildId }),
    randomId: () => "activity-0001",
  })
  return { activities, events, operationStore, service, state }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected the message forward",
    method: "POST",
    route: `/channels/${TARGET_CHANNEL_ID}/messages`,
    status,
  })
}

test("message-forward requests use exact fields, a one-way key hash, and deterministic nonce", () => {
  const normalized = normalizeMessageForwardRequest(request())
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.match(normalized.nonce, /^[A-Za-z0-9_-]{25}$/)
  assert.equal(normalized.nonce, normalizeMessageForwardRequest(request()).nonce)
  assert.equal(JSON.stringify(normalized).includes(OPERATION_KEY), true)
  assert.notEqual(normalized.operationKeyHash, OPERATION_KEY)
  assert.throws(
    () => normalizeMessageForwardRequest({ ...request(), extra: true } as MessageForwardRequest),
    /unexpected fields/,
  )
  assert.throws(
    () => normalizeMessageForwardRequest(request({ sourceChannelId: TARGET_CHANNEL_ID })),
    /must differ/,
  )
  assert.throws(
    () => normalizeMessageForwardRequest(request({ sourceMessageId: "bad" })),
    /source message ID/,
  )
})

test("generic message normalization exposes only forwarded-snapshot redaction markers", () => {
  const raw = forwardedMessage(
    sourceMessage(),
    "forward_nonce_0001",
    SOURCE_GUILD_ID,
  )
  const normalized = normalizeMessage(raw)
  assert.equal(normalized.forwardedSnapshotCount, 1)
  assert.equal(normalized.forwardedSnapshotRedacted, true)
  assert.equal(JSON.stringify(normalized).includes(CONTENT), false)
  const { message_snapshots: _snapshot, ...flagOnlyRaw } = raw
  const flagOnly = normalizeMessage(flagOnlyRaw)
  assert.equal(flagOnly.forwardedSnapshotCount, 0)
  assert.equal(flagOnly.forwardedSnapshotRedacted, true)
  assert.throws(
    () => normalizeMessage({ ...raw, flags: 0 }),
    /snapshot flags are inconsistent/,
  )
  assert.throws(
    () => normalizeMessage({
      ...raw,
      message_snapshots: [raw.message_snapshots?.[0], raw.message_snapshots?.[0]] as DiscordMessageSnapshot[],
    }),
    /snapshots are malformed/,
  )
})

test("plans bind exact source content, endpoint permissions, and forced delivery controls", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())

  assert.equal(plan.status, "planned")
  assert.equal(plan.source.message.contentPreview, CONTENT)
  assert.equal(plan.source.message.attachmentCount, 1)
  assert.equal(plan.source.message.componentCount, 1)
  assert.equal(plan.source.message.embedCount, 1)
  assert.equal(plan.source.permission.readMessageHistory, true)
  assert.equal(plan.target.permission.readMessageHistory, true)
  assert.equal(plan.target.permission.sendMessages, true)
  assert.equal(plan.source.permission.unknownPermissionBits, "0")
  assert.deepEqual(plan.source.permission.warnings, [])
  assert.deepEqual(plan.delivery, {
    allowedMentions: "none",
    enforceNonce: true,
    nonce: plan.delivery.nonce,
    notifications: "suppressed",
    snapshotCount: 1,
  })
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  const changed = fixture({
    state: { sourceMessageOverrides: { content: "Changed source detail" } },
  })
  const changedPlan = await changed.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
  assert.notEqual(changedPlan.digest, plan.digest)

  const renamedAuthor = fixture({
    state: {
      sourceMessageOverrides: {
        author: { bot: false, id: AUTHOR_ID, username: "renamed-author" },
      },
    },
  })
  assert.notEqual(
    (await renamedAuthor.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())).digest,
    plan.digest,
  )

  const renamed = fixture({
    state: {
      targetChannel: channel(TARGET_CHANNEL_ID, SOURCE_GUILD_ID, { name: "renamed-target" }),
    },
  })
  assert.notEqual(
    (await renamed.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())).digest,
    plan.digest,
  )
})

test("plans surface unknown permission bits without treating them as authority", async () => {
  const unknownBit = 1n << 63n
  const setup = fixture({
    state: { sourcePermissions: REQUIRED_PERMISSIONS | unknownBit },
  })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
  assert.equal(plan.source.permission.unknownPermissionBits, unknownBit.toString())
  assert.match(plan.source.permission.warnings.join("\n"), /unknown to this build/)
})

test("plans bind hostile object keys and bound aggregate snapshot complexity", async () => {
  const first = fixture({
    state: {
      sourceMessageOverrides: {
        embeds: [JSON.parse('{"__proto__":{"detail":"first"},"type":"rich"}')],
      },
    },
  })
  const second = fixture({
    state: {
      sourceMessageOverrides: {
        embeds: [JSON.parse('{"__proto__":{"detail":"second"},"type":"rich"}')],
      },
    },
  })
  const firstPlan = await first.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  const secondPlan = await second.service.plan(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
  )
  assert.notEqual(firstPlan.digest, secondPlan.digest)

  const complex = fixture({
    state: {
      sourceMessageOverrides: {
        embeds: Array.from({ length: 1_000 }, () => ({
          values: Array.from({ length: 20 }, () => null),
        })),
      },
    },
  })
  await assert.rejects(
    () => complex.service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /excessively complex message-forward snapshot/,
  )

  const exotic = fixture({
    state: { sourceMessageOverrides: { embeds: [new Date(NOW)] } },
  })
  await assert.rejects(
    () => exotic.service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /non-JSON message-forward object/,
  )
})

test("planning rejects missing intent and write scope before any Discord read", async () => {
  const noIntent = fixture()
  await assert.rejects(
    () => noIntent.service.plan(APPLICATION_ID, BOT_ID, "unknown", request()),
    /requires confirmed Message Content intent/,
  )
  assert.deepEqual(noIntent.events, [])

  const disabled = fixture({ policy: policy({ enabled: false }) })
  await assert.rejects(
    () => disabled.service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    PolicyError,
  )
  assert.deepEqual(disabled.events, [])

  const sourceDenied = fixture({ policy: policy({ sourceIds: [] }) })
  await assert.rejects(
    () => sourceDenied.service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    PolicyError,
  )
  assert.deepEqual(sourceDenied.events, [])
})

test("planning permits direct text and announcement channels but rejects threads", async () => {
  const announcement = fixture({
    state: {
      sourceChannel: channel(SOURCE_CHANNEL_ID, SOURCE_GUILD_ID, {
        type: DISCORD_CHANNEL_TYPES.announcement,
      }),
    },
  })
  assert.equal(
    (await announcement.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())).source.channel.type,
    DISCORD_CHANNEL_TYPES.announcement,
  )

  const thread = fixture({
    state: {
      targetChannel: channel(TARGET_CHANNEL_ID, SOURCE_GUILD_ID, {
        type: DISCORD_CHANNEL_TYPES.publicThread,
      }),
    },
  })
  await assert.rejects(
    () => thread.service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /direct message-forward channel evidence/,
  )
})

test("cross-guild forwarding requires a separate explicit toggle", async () => {
  const state = {
    targetChannel: channel(TARGET_CHANNEL_ID, TARGET_GUILD_ID),
    targetGuildId: TARGET_GUILD_ID,
  }
  const blocked = fixture({
    policy: policy({ targetGuildId: TARGET_GUILD_ID }),
    state,
  })
  await assert.rejects(
    () => blocked.service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /Cross-guild Discord message forwarding is disabled/,
  )

  const allowed = fixture({
    policy: policy({ crossGuild: true, targetGuildId: TARGET_GUILD_ID }),
    state,
  })
  const plan = await allowed.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
  assert.equal(plan.crossGuild, true)
  assert.equal(plan.target.guild.id, TARGET_GUILD_ID)
})

test("planning blocks an age-restriction downgrade before reading source content", async () => {
  const blocked = fixture({
    state: {
      sourceChannel: channel(SOURCE_CHANNEL_ID, SOURCE_GUILD_ID, { nsfw: true }),
    },
  })
  await assert.rejects(
    () => blocked.service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    /cannot move age-restricted source content/,
  )
  assert.equal(blocked.events.includes("read:source-message"), false)

  const allowed = fixture({
    state: {
      sourceChannel: channel(SOURCE_CHANNEL_ID, SOURCE_GUILD_ID, { nsfw: true }),
      targetChannel: channel(TARGET_CHANNEL_ID, SOURCE_GUILD_ID, { nsfw: true }),
    },
  })
  const plan = await allowed.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
  assert.equal(plan.source.channel.nsfw, true)
  assert.equal(plan.target.channel.nsfw, true)
})

test("planning rejects polls, calls, activities, nested forwards, and unsupported types", async () => {
  const invalid: Partial<DiscordMessage>[] = [
    { poll: {} as NonNullable<DiscordMessage["poll"]> },
    { call: {} },
    { activity: {} },
    { flags: DISCORD_MESSAGE_FLAGS.hasSnapshot },
    { message_snapshots: [{ message: snapshotFromSource(sourceMessage()) }] },
    { message_reference: { type: DISCORD_MESSAGE_REFERENCE_TYPES.forward } },
    { type: 7 },
  ]
  for (const sourceMessageOverrides of invalid) {
    await assert.rejects(
      () => fixture({ state: { sourceMessageOverrides } }).service.plan(
        APPLICATION_ID,
        BOT_ID,
        "enabled",
        request(),
      ),
      /ineligible|already a forward/,
    )
  }
})

test("planning requires source read and target readback plus send permissions", async () => {
  const sourceWithoutRead = REQUIRED_PERMISSIONS & ~DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
  await assert.rejects(
    () => fixture({ state: { sourcePermissions: sourceWithoutRead } }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
    ),
    /source channel message-read prerequisites|source channel READ_MESSAGE_HISTORY/,
  )

  const targetWithoutSend = REQUIRED_PERMISSIONS & ~DISCORD_PERMISSIONS.SEND_MESSAGES
  await assert.rejects(
    () => fixture({
      policy: policy({ crossGuild: true, targetGuildId: TARGET_GUILD_ID }),
      state: {
        targetChannel: channel(TARGET_CHANNEL_ID, TARGET_GUILD_ID),
        targetGuildId: TARGET_GUILD_ID,
        targetPermissions: targetWithoutSend,
      },
    }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
    ),
    /target channel SEND_MESSAGES/,
  )

  const targetWithoutRead = REQUIRED_PERMISSIONS & ~DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
  await assert.rejects(
    () => fixture({
      policy: policy({ crossGuild: true, targetGuildId: TARGET_GUILD_ID }),
      state: {
        targetChannel: channel(TARGET_CHANNEL_ID, TARGET_GUILD_ID),
        targetGuildId: TARGET_GUILD_ID,
        targetPermissions: targetWithoutRead,
      },
    }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
    ),
    /target channel message-read prerequisites|target channel READ_MESSAGE_HISTORY/,
  )
})

test("execution journals before one write and verifies response plus independent readback", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
  setup.events.length = 0

  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    "enabled",
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.nonce, plan.delivery.nonce)
  assert.equal(result.targetMessageId, TARGET_MESSAGE_ID)
  assert.equal(result.responseSnapshotMatched, true)
  assert.equal(result.readbackSnapshotMatched, true)
  assert.equal(setup.state.createCalls, 1)
  assert.deepEqual(setup.state.lastCreateInput, {
    nonce: plan.delivery.nonce,
    sourceChannelId: SOURCE_CHANNEL_ID,
    sourceGuildId: SOURCE_GUILD_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
  })
  assert.ok(setup.events.indexOf("activity:pending") < setup.events.indexOf("write:forward"))
  assert.deepEqual(setup.activities.map((entry) => entry.status), ["pending", "completed"])
  assert.equal(setup.operationStore.lastReceipt?.kind, "message-forward")
  assert.equal(setup.operationStore.lastReceipt?.resourceId, TARGET_MESSAGE_ID)
  assert.equal(setup.operationStore.lastReceipt?.verification, "match")
})

test("signed attachment URL rotation is ignored while stable metadata drift is rejected", async () => {
  const rotated = fixture()
  const plan = await rotated.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
  assert.equal(
    (await rotated.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      plan.digest,
    )).status,
    "completed",
  )

  const drifted = fixture({
    state: {
      snapshotOverrides: {
        attachments: [{
          ...sourceMessage().attachments?.[0] as NonNullable<DiscordMessage["attachments"]>[number],
          filename: "changed.txt",
        }],
      },
    },
  })
  const driftPlan = await drifted.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
  await assert.rejects(
    () => drifted.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      driftPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof MessageForwardExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(drifted.operationStore.lastReceipt?.status, "uncertain")
})

test("execution rejects source drift before reservation or write", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
  setup.state.sourceMessageOverrides = { content: "Changed after review" }
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      plan.digest,
    ),
    MessageForwardPlanChangedError,
  )
  assert.equal(setup.state.createCalls, 0)
  assert.equal(setup.operationStore.lastReceipt, undefined)
})

test("a reserved operation key conflicts before Discord reads and exposes no content", async () => {
  const setup = fixture()
  const normalized = normalizeMessageForwardRequest(request())
  await setup.operationStore.reserve({
    activityId: "prior-activity",
    error: null,
    guildId: SOURCE_GUILD_ID,
    kind: "message-forward",
    operationKeyHash: normalized.operationKeyHash,
    planDigest: `hmac-sha256:${"1".repeat(64)}`,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  setup.events.length = 0

  await assert.rejects(
    () => setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request()),
    (error: unknown) => {
      assert.ok(error instanceof MessageForwardOperationConflictError)
      assert.equal(JSON.stringify(error.receipt).includes(CONTENT), false)
      return true
    },
  )
  assert.deepEqual(setup.events, [])
})

test("pending activity failure blocks the write and settles the receipt as failed", async () => {
  const setup = fixture({ state: { activitiesFailAt: 1 } })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())

  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      "enabled",
      request(),
      plan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof MessageForwardExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(setup.state.createCalls, 0)
  assert.equal(setup.operationStore.lastReceipt?.status, "failed")
})

test("definite client refusals are failed while rate limits and transport errors are uncertain", async () => {
  for (const [failure, expectedStatus] of [
    [apiError(403), "failed"],
    [apiError(408), "uncertain"],
    [apiError(429), "uncertain"],
    [new Error("transport ended"), "uncertain"],
  ] as const) {
    const setup = fixture({ state: { createError: failure } })
    const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
    await assert.rejects(
      () => setup.service.execute(
        APPLICATION_ID,
        BOT_ID,
        "enabled",
        request(),
        plan.digest,
      ),
      (error: unknown) => {
        assert.ok(error instanceof MessageForwardExecutionError)
        assert.equal((error.result as { status: string }).status, expectedStatus)
        return true
      },
    )
    assert.equal(setup.state.createCalls, 1)
    assert.equal(setup.operationStore.lastReceipt?.status, expectedStatus)
  }
})

test("mismatched forward identity, outer content, flags, and readback remain uncertain", async () => {
  const variants: Partial<FixtureState>[] = [
    { responseOverrides: { content: "unexpected" } },
    {
      responseOverrides: {
        attachments: undefined,
      } as unknown as Partial<DiscordMessage>,
    },
    {
      responseOverrides: {
        mention_everyone: undefined,
      } as unknown as Partial<DiscordMessage>,
    },
    { responseOverrides: { flags: DISCORD_MESSAGE_FLAGS.hasSnapshot } },
    { responseOverrides: { message_reference: { type: 0 } } },
    {
      responseOverrides: {
        message_snapshots: [{
          message: snapshotFromSource(sourceMessage()),
          unexpected: true,
        } as DiscordMessageSnapshot],
      },
    },
    {
      snapshotOverrides: {
        unexpected: true,
      } as Partial<DiscordMessageSnapshot["message"]>,
    },
    { readbackOverrides: { id: "999999999999999999" } },
  ]
  for (const state of variants) {
    const setup = fixture({ state })
    const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
    await assert.rejects(
      () => setup.service.execute(
        APPLICATION_ID,
        BOT_ID,
        "enabled",
        request(),
        plan.digest,
      ),
      (error: unknown) => {
        assert.ok(error instanceof MessageForwardExecutionError)
        assert.equal((error.result as { status: string }).status, "uncertain")
        return true
      },
    )
    assert.equal(setup.operationStore.lastReceipt?.status, "uncertain")
    assert.equal(setup.operationStore.lastReceipt?.resourceId, TARGET_MESSAGE_ID)
  }
})

test("durable activity and receipt records remain content-free for every terminal state", async () => {
  for (const createError of [undefined, apiError(403), new Error("transport ended")]) {
    const setup = fixture({ state: { createError } })
    const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, "enabled", request())
    try {
      await setup.service.execute(
        APPLICATION_ID,
        BOT_ID,
        "enabled",
        request(),
        plan.digest,
      )
    } catch (error) {
      assert.ok(error instanceof MessageForwardExecutionError)
    }
    const durable = JSON.stringify({
      activities: setup.activities,
      receipt: setup.operationStore.lastReceipt,
    })
    assert.equal(durable.includes(CONTENT), false)
    assert.equal(durable.includes(ATTACHMENT_FILENAME), false)
    assert.equal(durable.includes(OPERATION_KEY), false)
    assert.equal(durable.includes("media.example.invalid"), false)
  }
})
