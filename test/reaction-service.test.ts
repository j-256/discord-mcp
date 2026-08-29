import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  REACTION_TYPES,
} from "../src/constants.js"
import {
  DiscordApiError,
  PolicyError,
  ReactionEvidenceError,
  ReactionModerationExecutionError,
  ReactionModerationOperationConflictError,
  ReactionModerationPlanChangedError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeReactionEmoji,
  normalizeReactionModerationRequest,
  parseReactionAggregates,
  ReactionService,
  type ReactionModerationRequest,
  type ReactionModerationScope,
  type ReactionServiceOptions,
} from "../src/reaction-service.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordMessage,
  DiscordReaction,
  DiscordRole,
  DiscordUser,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const CHANNEL_ID = "300000000000000001"
const OTHER_CHANNEL_ID = "300000000000000002"
const PARENT_CHANNEL_ID = "300000000000000003"
const BOT_ID = "400000000000000001"
const OWNER_ID = "400000000000000002"
const USER_ID = "400000000000000003"
const OTHER_USER_ID = "400000000000000004"
const PROTECTED_USER_ID = "400000000000000005"
const BOT_ROLE_ID = "500000000000000001"
const MESSAGE_ID = "600000000000000001"
const SURVIVING_MESSAGE_ID = "600000000000000004"
const RECEIPT_FAILURE_MESSAGE_ID = "600000000000000005"
const ACTIVITY_FAILURE_MESSAGE_ID = "600000000000000006"
const CUSTOM_EMOJI_ID = "700000000000000001"
const CUSTOM_EMOJI = `party_blob:${CUSTOM_EMOJI_ID}`
const UNICODE_EMOJI = "👍"
const NOW = "2026-08-22T01:02:03.000Z"
const AUDIT_REASON = "Reviewed reaction cleanup / case 42"
const OPERATION_KEY = "reaction-operation-key-0001"

const BASE_PERMISSIONS = DISCORD_PERMISSIONS.VIEW_CHANNEL
  | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
  | DISCORD_PERMISSIONS.MANAGE_MESSAGES

function role(
  id: string,
  permissions: bigint,
  position: number,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : "private-connector-role",
    permissions: permissions.toString(),
    position,
  }
}

function reaction(
  emoji: string,
  options: {
    animated?: boolean
    burst?: number
    me?: boolean
    meBurst?: boolean
    normal?: number
  } = {},
): DiscordReaction {
  const normal = options.normal ?? 2
  const burst = options.burst ?? 0
  const custom = emoji.includes(":")
  const [name, id] = custom ? emoji.split(":") : [emoji, null]
  return {
    burst_colors: burst > 0 ? ["#AABBCC"] : [],
    count: normal + burst,
    count_details: { burst, normal },
    emoji: {
      animated: options.animated ?? false,
      id,
      name,
    },
    me: options.me ?? false,
    me_burst: options.meBurst ?? false,
  }
}

function request(
  scope: ReactionModerationScope,
  overrides: Partial<ReactionModerationRequest> = {},
): ReactionModerationRequest {
  const common = {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey: OPERATION_KEY,
    scope,
  }
  if (scope === "all") return { ...common, ...overrides }
  if (scope === "emoji") {
    return { ...common, emoji: UNICODE_EMOJI, ...overrides }
  }
  return {
    ...common,
    emoji: UNICODE_EMOJI,
    userId: USER_ID,
    ...overrides,
  }
}

function reactionKey(emoji: string): string {
  const custom = emoji.includes(":")
  return custom ? `custom:${emoji.split(":")[1]}` : `unicode:${emoji}`
}

function aggregateKey(entry: DiscordReaction): string {
  return entry.emoji.id
    ? `custom:${entry.emoji.id}`
    : `unicode:${entry.emoji.name ?? ""}`
}

function user(id: string, bot = false): DiscordUser {
  return {
    avatar: "private-avatar",
    bot,
    global_name: "Private Global Name",
    id,
    username: "private-user-name",
  }
}

function policy(options: {
  channelIds?: readonly string[]
  moderation?: boolean
  protectedUserIds?: readonly string[]
  userAudit?: boolean
} = {}): ScopePolicy {
  const channelIds = options.channelIds || [CHANNEL_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(channelIds),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowReactionModeration: options.moderation ?? true,
    allowReactionUserAudit: options.userAudit ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(options.protectedUserIds || []),
    reactionChannelIds: new Set(channelIds),
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
  channel: DiscordChannel
  driftAfterMutation: boolean
  messageId: string
  mutationCompleted: boolean
  mutationError: unknown
  mutationLeavesTarget: boolean
  parentChannel: DiscordChannel | null
  reactions: DiscordReaction[]
  reactionUsers: Map<string, DiscordUser[]>
  readbackError: unknown
  roles: DiscordRole[]
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const channel = options.state?.channel || {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-channel",
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
  }
  const channelPermissions = BASE_PERMISSIONS | (
    channel.type === DISCORD_CHANNEL_TYPES.voice
      || channel.type === DISCORD_CHANNEL_TYPES.stageVoice
      ? DISCORD_PERMISSIONS.CONNECT
      : 0n
  )
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: user(BOT_ID, true),
    },
    channel,
    driftAfterMutation: false,
    messageId: MESSAGE_ID,
    mutationCompleted: false,
    mutationError: undefined,
    mutationLeavesTarget: false,
    parentChannel: null,
    reactions: [
      reaction(UNICODE_EMOJI, { burst: 1, normal: 2 }),
      reaction(CUSTOM_EMOJI, { normal: 1 }),
    ],
    reactionUsers: new Map([
      [`${reactionKey(UNICODE_EMOJI)}:${REACTION_TYPES.normal}`, [
        user(USER_ID),
        user(OTHER_USER_ID, true),
      ]],
      [`${reactionKey(UNICODE_EMOJI)}:${REACTION_TYPES.burst}`, [user(OTHER_USER_ID, true)]],
      [`${reactionKey(CUSTOM_EMOJI)}:${REACTION_TYPES.normal}`, [user(OTHER_USER_ID, true)]],
    ]),
    readbackError: undefined,
    roles: [
      role(GUILD_ID, 0n, 0),
      role(BOT_ROLE_ID, channelPermissions, 10),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
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

  function usersFor(routeToken: string, type: number): DiscordUser[] {
    return state.reactionUsers.get(`${reactionKey(routeToken)}:${type}`) || []
  }

  function removeAggregate(routeToken: string): void {
    const key = reactionKey(routeToken)
    state.reactions = state.reactions.filter((entry) => aggregateKey(entry) !== key)
    for (const userKey of [...state.reactionUsers.keys()]) {
      if (userKey.startsWith(`${key}:`)) state.reactionUsers.delete(userKey)
    }
  }

  function drift(): void {
    if (!state.driftAfterMutation) return
    state.reactions.push(reaction("🔥", { normal: 1 }))
  }

  const client: ReactionServiceOptions["client"] = {
    async deleteAllMessageReactions(channelId, messageId) {
      assert.equal(channelId, state.channel.id)
      assert.equal(messageId, state.messageId)
      events.push("write:delete-all")
      if (state.mutationError) throw state.mutationError
      state.mutationCompleted = true
      if (!state.mutationLeavesTarget) {
        state.reactions = []
        state.reactionUsers.clear()
      }
      drift()
    },
    async deleteAllMessageReactionsForEmoji(channelId, messageId, emoji) {
      assert.equal(channelId, state.channel.id)
      assert.equal(messageId, state.messageId)
      events.push(`write:delete-emoji:${emoji}`)
      if (state.mutationError) throw state.mutationError
      state.mutationCompleted = true
      if (!state.mutationLeavesTarget) removeAggregate(emoji)
      drift()
    },
    async deleteUserReaction(channelId, messageId, emoji, userId) {
      assert.equal(channelId, state.channel.id)
      assert.equal(messageId, state.messageId)
      events.push(`write:delete-user:${userId}`)
      if (state.mutationError) throw state.mutationError
      state.mutationCompleted = true
      if (state.mutationLeavesTarget) return
      const key = `${reactionKey(emoji)}:${REACTION_TYPES.normal}`
      const users = state.reactionUsers.get(key) || []
      if (users.some((entry) => entry.id === userId)) {
        state.reactionUsers.set(key, users.filter((entry) => entry.id !== userId))
        const aggregate = state.reactions.find((entry) => (
          aggregateKey(entry) === reactionKey(emoji)
        ))
        if (aggregate) {
          aggregate.count -= 1
          aggregate.count_details.normal -= 1
          if (aggregate.count === 0) removeAggregate(emoji)
        }
      }
      drift()
    },
    async getChannel(channelId) {
      events.push(`read:channel:${channelId}`)
      if (channelId === state.channel.id) return state.channel
      if (state.parentChannel && channelId === state.parentChannel.id) {
        return state.parentChannel
      }
      throw apiError(404)
    },
    async getGuild(guildId) {
      events.push("read:guild")
      return { id: guildId, name: "Private Guild Name", owner_id: OWNER_ID }
    },
    async getGuildMember(guildId, userId) {
      assert.equal(guildId, GUILD_ID)
      assert.equal(userId, BOT_ID)
      events.push("read:member")
      return state.botMember
    },
    async getGuildRoles(guildId) {
      assert.equal(guildId, GUILD_ID)
      events.push("read:roles")
      return state.roles
    },
    async getMessage(channelId, messageId) {
      assert.equal(channelId, state.channel.id)
      assert.equal(messageId, state.messageId)
      events.push(state.mutationCompleted ? "read:readback" : "read:message")
      if (state.mutationCompleted && state.readbackError) throw state.readbackError
      const message: DiscordMessage = {
        attachments: [{
          filename: "private.txt",
          id: "800000000000000001",
          size: 7,
          url: "https://cdn.discordapp.com/private",
        }],
        author: user(OWNER_ID),
        channel_id: state.channel.id,
        components: [{ private: true }],
        content: "private message content",
        embeds: [{ private: true }],
        guild_id: GUILD_ID,
        id: state.messageId,
        reactions: state.reactions,
        timestamp: NOW,
        type: 0,
      }
      return message
    },
    async getThreadMember(threadId, userId) {
      events.push("read:thread-member")
      return {
        flags: 0,
        id: threadId,
        join_timestamp: NOW,
        user_id: userId,
      }
    },
    async listReactionUsers(channelId, messageId, emoji, page = {}) {
      assert.equal(channelId, state.channel.id)
      assert.equal(messageId, state.messageId)
      const type = page.type ?? REACTION_TYPES.normal
      events.push(`read:users:${emoji}:${type}`)
      const after = page.after === undefined ? null : BigInt(page.after)
      return usersFor(emoji, type)
        .filter((entry) => after === null || BigInt(entry.id) > after)
        .slice(0, page.limit)
    },
  }
  const service = new ReactionService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: options.policy || policy({ channelIds: [state.channel.id] }),
    randomId: () => "reaction-activity-0001",
  })
  return { activities, events, operationStore, service, state }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected reaction moderation",
    method: "DELETE",
    route: "/channels/{channel.id}/messages/{message.id}/reactions/{emoji}",
    status,
  })
}

function executionStatus(error: unknown): string | undefined {
  if (
    !(error instanceof ReactionModerationExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return undefined
  return typeof error.result.status === "string" ? error.result.status : undefined
}

test("reaction emoji and moderation request normalization are strict", () => {
  assert.deepEqual(normalizeReactionEmoji(UNICODE_EMOJI), {
    id: null,
    key: `unicode:${UNICODE_EMOJI}`,
    kind: "unicode",
    name: UNICODE_EMOJI,
    routeToken: UNICODE_EMOJI,
  })
  assert.deepEqual(normalizeReactionEmoji(CUSTOM_EMOJI), {
    id: CUSTOM_EMOJI_ID,
    key: `custom:${CUSTOM_EMOJI_ID}`,
    kind: "custom",
    name: "party_blob",
    routeToken: CUSTOM_EMOJI,
  })
  for (const invalid of ["", "plain", "👍 👎", "bad:0", "a:123"]) {
    assert.throws(() => normalizeReactionEmoji(invalid), RangeError)
  }

  const normalized = normalizeReactionModerationRequest(request("user"))
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(normalized.operationKeyHash.includes(OPERATION_KEY), false)
  assert.equal(normalized.userId, USER_ID)
  assert.throws(
    () => normalizeReactionModerationRequest({
      ...request("all"),
      emoji: UNICODE_EMOJI,
    }),
    /exact scope fields/,
  )
  assert.throws(
    () => normalizeReactionModerationRequest(request("user", { userId: "0" })),
    /user ID/,
  )
})

test("reaction aggregate parsing canonicalizes state and rejects unknown evidence", () => {
  const parsed = parseReactionAggregates([
    reaction(UNICODE_EMOJI, { burst: 1, meBurst: true, normal: 2 }),
    reaction(CUSTOM_EMOJI, { me: true, normal: 1 }),
  ])
  assert.deepEqual(parsed.map(({ emoji }) => emoji.kind), ["custom", "unicode"])
  assert.equal(parsed[0]?.emoji.routeToken, CUSTOM_EMOJI)
  assert.equal(parsed[1]?.burstCount, 1)
  assert.equal(parsed[1]?.meBurst, true)

  const compatible = reaction(UNICODE_EMOJI, {
    burst: 1,
    meBurst: true,
    normal: 2,
  })
  compatible.burst_count = 1
  compatible.burst_me = true
  assert.deepEqual(parseReactionAggregates([compatible]), [parsed[1]])

  const mismatched = reaction(UNICODE_EMOJI)
  mismatched.count = 99
  assert.throws(() => parseReactionAggregates([mismatched]), ReactionEvidenceError)
  assert.throws(
    () => parseReactionAggregates([reaction(UNICODE_EMOJI), reaction(UNICODE_EMOJI)]),
    /duplicate emoji/,
  )
  assert.throws(
    () => parseReactionAggregates([{
      ...reaction(UNICODE_EMOJI),
      future_field: true,
    } as DiscordReaction]),
    /invalid message reaction counts/,
  )
  assert.throws(
    () => parseReactionAggregates([{
      ...reaction(UNICODE_EMOJI),
      burst_count: 0,
    }]),
    /invalid message reaction counts/,
  )
  assert.throws(
    () => parseReactionAggregates([{
      ...reaction(UNICODE_EMOJI, { burst: 1 }),
      burst_count: 0,
      burst_me: false,
    }]),
    /invalid message reaction counts/,
  )
  assert.throws(
    () => parseReactionAggregates([{
      ...reaction(UNICODE_EMOJI),
      burst_count: 0,
      burst_me: "false",
    } as unknown as DiscordReaction]),
    /invalid message reaction counts/,
  )
  assert.throws(
    () => parseReactionAggregates([{
      ...reaction(UNICODE_EMOJI),
      emoji: { id: null, name: UNICODE_EMOJI, future_field: true },
    } as DiscordReaction]),
    /unknown reaction emoji fields/,
  )
})

test("reaction inventory projects message content, profiles, and burst colors out", async () => {
  const setup = fixture()
  const result = await setup.service.listMessageReactions(CHANNEL_ID, MESSAGE_ID)

  assert.equal(result.status, "ok")
  assert.equal(result.reactions.length, 2)
  assert.equal(result.reactions.find(({ emoji }) => emoji.kind === "unicode")?.burstCount, 1)
  assert.equal(result.privacy.persistence, "none")
  const serialized = JSON.stringify(result)
  for (const privateValue of [
    "private message content",
    "private-user-name",
    "private-avatar",
    "#AABBCC",
    "cdn.discordapp.com",
  ]) {
    assert.equal(serialized.includes(privateValue), false)
  }
  assert.deepEqual(setup.activities, [])
})

test("reaction-user audit returns bounded IDs and bot flags without profiles", async () => {
  const setup = fixture()
  const page = await setup.service.listReactionUsers(
    CHANNEL_ID,
    MESSAGE_ID,
    UNICODE_EMOJI,
    { limit: 2, type: REACTION_TYPES.normal },
  )

  assert.deepEqual(page.users, [
    { bot: false, id: USER_ID },
    { bot: true, id: OTHER_USER_ID },
  ])
  assert.equal(page.page.nextAfter, OTHER_USER_ID)
  assert.equal(page.reactionType, "normal")
  assert.equal(JSON.stringify(page).includes("private-user-name"), false)

  setup.events.length = 0
  const absent = await setup.service.listReactionUsers(
    CHANNEL_ID,
    MESSAGE_ID,
    "🔥",
    { limit: 25 },
  )
  assert.deepEqual(absent.users, [])
  assert.equal(setup.events.some((entry) => entry.startsWith("read:users")), false)

  const unordered = fixture({
    state: {
      reactionUsers: new Map([
        [`${reactionKey(UNICODE_EMOJI)}:${REACTION_TYPES.normal}`, [
          user(OTHER_USER_ID),
          user(USER_ID),
        ]],
      ]),
    },
  })
  await assert.rejects(
    () => unordered.service.listReactionUsers(
      CHANNEL_ID,
      MESSAGE_ID,
      UNICODE_EMOJI,
      { limit: 2 },
    ),
    /unordered reaction user evidence/,
  )

  const duplicate = fixture({
    state: {
      reactionUsers: new Map([
        [`${reactionKey(UNICODE_EMOJI)}:${REACTION_TYPES.normal}`, [
          user(USER_ID),
          user(USER_ID),
        ]],
      ]),
    },
  })
  await assert.rejects(
    () => duplicate.service.listReactionUsers(
      CHANNEL_ID,
      MESSAGE_ID,
      UNICODE_EMOJI,
      { limit: 2 },
    ),
    /duplicate.*reaction user evidence/,
  )

  await assert.rejects(
    () => setup.service.listReactionUsers(
      CHANNEL_ID,
      MESSAGE_ID,
      UNICODE_EMOJI,
      { after: OTHER_USER_ID, limit: 101 },
    ),
    RangeError,
  )
})

test("reaction reads and moderation fail closed on policy and permissions", async () => {
  const auditDisabled = fixture({
    policy: policy({ moderation: true, userAudit: false }),
  })
  await assert.rejects(
    () => auditDisabled.service.listReactionUsers(CHANNEL_ID, MESSAGE_ID, UNICODE_EMOJI),
    PolicyError,
  )
  assert.deepEqual(auditDisabled.events, [])

  const moderationDisabled = fixture({
    policy: policy({ moderation: false, userAudit: true }),
  })
  await assert.rejects(
    () => moderationDisabled.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("all"),
    ),
    /reaction moderation is disabled/,
  )
  assert.deepEqual(moderationDisabled.events, [])

  const outsideScope = fixture({
    policy: policy({ channelIds: [OTHER_CHANNEL_ID] }),
  })
  await assert.rejects(
    () => outsideScope.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("all"),
    ),
    /outside the reaction scope/,
  )
  assert.deepEqual(outsideScope.events, [])

  const missingPermission = fixture({
    state: {
      roles: [
        role(GUILD_ID, 0n, 0),
        role(
          BOT_ROLE_ID,
          DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
          10,
        ),
      ],
    },
  })
  await assert.rejects(
    () => missingPermission.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("all"),
    ),
    /MANAGE_MESSAGES/,
  )

  const protectedTarget = fixture({
    policy: policy({ protectedUserIds: [PROTECTED_USER_ID] }),
  })
  await assert.rejects(
    () => protectedTarget.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("user", { userId: PROTECTED_USER_ID }),
    ),
    /protected from administration/,
  )
  assert.deepEqual(protectedTarget.events, [])

  const connectorOwned = fixture()
  await assert.rejects(
    () => connectorOwned.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("user", { userId: BOT_ID }),
    ),
    /remove_own_reaction/,
  )
  assert.deepEqual(connectorOwned.events, [])
})

test("reaction moderation plans bind identity, permission, state, and local reason", async () => {
  const setup = fixture()
  const first = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("user"),
  )
  const second = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("user"),
  )

  assert.equal(first.digest, second.digest)
  assert.match(first.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(first.permission.confidence, "complete")
  assert.equal(first.permission.manageMessages, true)
  assert.equal(first.target.userId, USER_ID)
  assert.equal(first.target.userBot, false)
  assert.equal(first.writeRequired, true)
  assert.match(first.warnings.join("\n"), /transient local review context/)
  assert.equal(first.operationKeyHash.includes(OPERATION_KEY), false)

  setup.state.reactions[0] = reaction(UNICODE_EMOJI, { burst: 1, normal: 3 })
  const changed = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("user"),
  )
  assert.notEqual(changed.digest, first.digest)

  const differentReason = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("user", { auditReason: "Different reviewed reason" }),
  )
  assert.notEqual(differentReason.digest, changed.digest)
})

test("reaction moderation proves private-thread membership and voice CONNECT", async () => {
  const thread: DiscordChannel = {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "private-thread",
    parent_id: PARENT_CHANNEL_ID,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.privateThread,
  }
  const parent: DiscordChannel = {
    guild_id: GUILD_ID,
    id: PARENT_CHANNEL_ID,
    name: "parent",
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
  }
  const threadSetup = fixture({
    policy: policy({ channelIds: [CHANNEL_ID, PARENT_CHANNEL_ID] }),
    state: { channel: thread, parentChannel: parent },
  })
  const threadPlan = await threadSetup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("all"),
  )
  assert.equal(threadPlan.permission.privateThreadAccess, "lookup-succeeded")
  assert.equal(threadPlan.permission.permissionSourceChannelId, PARENT_CHANNEL_ID)
  assert.equal(threadSetup.events.includes("read:thread-member"), true)

  const voiceChannel: DiscordChannel = {
    guild_id: GUILD_ID,
    id: OTHER_CHANNEL_ID,
    name: "voice",
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.voice,
  }
  const voiceSetup = fixture({
    policy: policy({ channelIds: [OTHER_CHANNEL_ID] }),
    state: { channel: voiceChannel },
  })
  const voicePlan = await voiceSetup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request("all", { channelId: OTHER_CHANNEL_ID }),
  )
  assert.equal(voicePlan.permission.connect, true)

  const missingConnect = fixture({
    policy: policy({ channelIds: [OTHER_CHANNEL_ID] }),
    state: {
      channel: voiceChannel,
      roles: [
        role(GUILD_ID, 0n, 0),
        role(BOT_ROLE_ID, BASE_PERMISSIONS, 10),
      ],
    },
  })
  await assert.rejects(
    () => missingConnect.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request("all", { channelId: OTHER_CHANNEL_ID }),
    ),
    /CONNECT/,
  )
})

test("user reaction moderation reserves, journals, mutates once, and verifies", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request("user"))
  setup.events.length = 0

  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request("user"),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.targetAbsent, true)
  assert.equal(result.exactSnapshotMatched, true)
  assert.equal(
    setup.events.filter((entry) => entry.startsWith("write:delete-user")).length,
    1,
  )
  assert.deepEqual(setup.activities.map(({ status }) => status), [
    "pending",
    "completed",
  ])
  const activity = setup.activities.find((entry) => (
    entry.kind === "reaction-moderation"
  ))
  assert.match(activity?.emojiFingerprint ?? "", /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(setup.operationStore.lastReceipt?.kind, "reaction-moderation")
  assert.equal(setup.operationStore.lastReceipt?.resourceId, MESSAGE_ID)
  assert.equal(setup.operationStore.lastReceipt?.verification, "match")
  const persisted = JSON.stringify({
    activities: setup.activities,
    receipt: setup.operationStore.lastReceipt,
  })
  for (const forbidden of [AUDIT_REASON, OPERATION_KEY, UNICODE_EMOJI, "party_blob"]) {
    assert.equal(persisted.includes(forbidden), false)
  }
})

test("emoji and whole-message reaction moderation verify their exact postconditions", async () => {
  const emojiSetup = fixture()
  const emojiRequest = request("emoji", { emoji: CUSTOM_EMOJI })
  const emojiPlan = await emojiSetup.service.plan(APPLICATION_ID, BOT_ID, emojiRequest)
  assert.match(emojiPlan.warnings.join("\n"), /identity-blind/)
  assert.match(emojiPlan.warnings.join("\n"), /protected users/)
  const emojiResult = await emojiSetup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    emojiRequest,
    emojiPlan.digest,
  )
  assert.equal(emojiResult.status, "completed")
  assert.equal(
    emojiSetup.state.reactions.some((entry) => aggregateKey(entry) === reactionKey(CUSTOM_EMOJI)),
    false,
  )

  const allSetup = fixture()
  const allPlan = await allSetup.service.plan(APPLICATION_ID, BOT_ID, request("all"))
  const allResult = await allSetup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request("all"),
    allPlan.digest,
  )
  assert.equal(allResult.status, "completed")
  assert.deepEqual(allSetup.state.reactions, [])
})

test("reaction moderation reports absent targets without spending operation keys", async () => {
  const setup = fixture({ state: { reactions: [], reactionUsers: new Map() } })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request("all"))
  assert.equal(plan.status, "already-absent")
  assert.equal(plan.writeRequired, false)

  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request("all"),
    plan.digest,
  )
  assert.equal(result.status, "already-absent")
  assert.equal(result.activityId, null)
  assert.equal(setup.operationStore.lastReceipt, undefined)
  assert.deepEqual(setup.activities, [])
  assert.equal(setup.events.some((entry) => entry.startsWith("write:")), false)
})

test("reaction moderation rejects stale plans and spent operation keys", async () => {
  const stale = fixture()
  const stalePlan = await stale.service.plan(APPLICATION_ID, BOT_ID, request("emoji"))
  stale.state.reactions[0] = reaction(UNICODE_EMOJI, { burst: 1, normal: 3 })
  await assert.rejects(
    () => stale.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request("emoji"),
      stalePlan.digest,
    ),
    ReactionModerationPlanChangedError,
  )
  assert.equal(stale.events.some((entry) => entry.startsWith("write:")), false)

  const spent = fixture()
  const plan = await spent.service.plan(APPLICATION_ID, BOT_ID, request("all"))
  await spent.service.execute(APPLICATION_ID, BOT_ID, request("all"), plan.digest)
  await assert.rejects(
    () => spent.service.execute(APPLICATION_ID, BOT_ID, request("all"), plan.digest),
    ReactionModerationOperationConflictError,
  )
})

test("reaction moderation blocks writes when pending activity cannot be recorded", async () => {
  const setup = fixture({ state: { activityFailureAt: 1 } })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request("all"))

  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request("all"),
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof ReactionModerationExecutionError
      && executionStatus(error) === "blocked-audit-failed"
    ),
  )
  assert.equal(setup.events.some((entry) => entry.startsWith("write:")), false)
  assert.equal(setup.operationStore.lastReceipt?.status, "failed")
})

test("reaction moderation distinguishes verified drift from a surviving target", async () => {
  const drifted = fixture({ state: { driftAfterMutation: true } })
  const plan = await drifted.service.plan(APPLICATION_ID, BOT_ID, request("user"))
  const result = await drifted.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request("user"),
    plan.digest,
  )
  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.exactSnapshotMatched, false)
  assert.equal(drifted.operationStore.lastReceipt?.verification, "drift")

  const surviving = fixture({
    state: {
      messageId: SURVIVING_MESSAGE_ID,
      mutationLeavesTarget: true,
    },
  })
  const survivingRequest = request("user", { messageId: SURVIVING_MESSAGE_ID })
  const survivingPlan = await surviving.service.plan(
    APPLICATION_ID,
    BOT_ID,
    survivingRequest,
  )
  await assert.rejects(
    () => surviving.service.execute(
      APPLICATION_ID,
      BOT_ID,
      survivingRequest,
      survivingPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ReactionModerationExecutionError
      && executionStatus(error) === "uncertain"
      && (error.result as { targetAbsent: boolean }).targetAbsent === false
    ),
  )
  assert.equal(surviving.operationStore.lastReceipt?.status, "uncertain")
})

test("reaction moderation preserves completion evidence across local finalization failures", async () => {
  const receiptFailure = fixture({
    state: { messageId: RECEIPT_FAILURE_MESSAGE_ID },
  })
  const receiptRequest = request("all", { messageId: RECEIPT_FAILURE_MESSAGE_ID })
  const receiptPlan = await receiptFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    receiptRequest,
  )
  receiptFailure.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    () => receiptFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      receiptRequest,
      receiptPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ReactionModerationExecutionError
      && executionStatus(error) === "completed-operation-record-failed"
    ),
  )
  assert.deepEqual(receiptFailure.activities.map(({ status }) => status), [
    "pending",
    "uncertain",
  ])

  const activityFailure = fixture({
    state: {
      activityFailureAt: 2,
      messageId: ACTIVITY_FAILURE_MESSAGE_ID,
    },
  })
  const activityRequest = request("all", { messageId: ACTIVITY_FAILURE_MESSAGE_ID })
  const activityPlan = await activityFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    activityRequest,
  )
  await assert.rejects(
    () => activityFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      activityRequest,
      activityPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ReactionModerationExecutionError
      && executionStatus(error) === "completed-audit-failed"
    ),
  )
  assert.equal(activityFailure.operationStore.lastReceipt?.status, "completed")
  assert.deepEqual(activityFailure.activities.map(({ status }) => status), ["pending"])
})

test("settled client failures record failure without quarantining the message", async () => {
  const messageId = "600000000000000002"
  const setup = fixture({
    state: { messageId, mutationError: apiError(403) },
  })
  const firstRequest = request("all", { messageId })
  const firstPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      firstRequest,
      firstPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ReactionModerationExecutionError
      && executionStatus(error) === "failed"
    ),
  )
  assert.equal(setup.operationStore.lastReceipt?.status, "failed")

  setup.state.mutationError = undefined
  const secondRequest = request("all", {
    messageId,
    operationKey: "reaction-operation-key-0002",
  })
  const secondPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, secondRequest)
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
    secondPlan.digest,
  )
  assert.equal(result.status, "completed")
})

test("uncertain reaction outcomes quarantine subsequent same-message writes", async () => {
  const messageId = "600000000000000003"
  const setup = fixture({
    state: { messageId, mutationError: new TypeError("transport disconnected") },
  })
  const firstRequest = request("all", { messageId })
  const firstPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      firstRequest,
      firstPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ReactionModerationExecutionError
      && executionStatus(error) === "uncertain"
    ),
  )
  assert.equal(setup.operationStore.lastReceipt?.status, "uncertain")

  setup.state.mutationError = undefined
  const secondRequest = request("all", {
    messageId,
    operationKey: "reaction-operation-key-0003",
  })
  const secondPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, secondRequest)
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      secondRequest,
      secondPlan.digest,
    ),
    (error: unknown) => (
      error instanceof ReactionModerationExecutionError
      && executionStatus(error) === "blocked-prior-uncertain"
    ),
  )
  assert.equal(
    setup.events.filter((entry) => entry.startsWith("write:")).length,
    1,
  )
})
