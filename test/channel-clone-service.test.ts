import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityList,
  ActivityStore,
} from "../src/activity-log.js"
import {
  ChannelCloneService,
  normalizeChannelCloneRequest,
  type ChannelCloneRequest,
} from "../src/channel-clone-service.js"
import {
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
  SCHEMA_VERSION,
} from "../src/constants.js"
import type { CreateGuildChannelInput } from "../src/discord-client.js"
import {
  ChannelCloneEvidenceError,
  ChannelCloneExecutionError,
  ChannelCloneOperationConflictError,
  ChannelClonePlanChangedError,
  DiscordApiError,
} from "../src/errors.js"
import type {
  GatewayChannelLayoutListener,
  GatewayChannelLayoutSnapshot,
  GatewayChannelLayoutSource,
  GatewayChannelLayoutStatus,
} from "../src/gateway-channel-layout.js"
import type {
  OperationKind,
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
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "810000000000000001"
const BOT_ID = "820000000000000001"
const GUILD_ID = "830000000000000001"
const OWNER_ID = "830000000000000002"
const CATEGORY_ID = "840000000000000001"
const SOURCE_ID = "840000000000000002"
const CREATED_ID = "840000000000000003"
const BOT_ROLE_ID = "850000000000000001"
const TAG_ID = "860000000000000001"
const CREATED_TAG_ID = "860000000000000002"
const OPERATION_KEY = "channel-clone-operation-0001"
const PLAN_KEY = new Uint8Array(32).fill(27)

interface FixtureIds {
  botRoleId: string
  categoryId: string
  createdId: string
  createdTagId: string
  guildId: string
  ownerId: string
  sourceId: string
  tagId: string
}

const DEFAULT_IDS: FixtureIds = Object.freeze({
  botRoleId: BOT_ROLE_ID,
  categoryId: CATEGORY_ID,
  createdId: CREATED_ID,
  createdTagId: CREATED_TAG_ID,
  guildId: GUILD_ID,
  ownerId: OWNER_ID,
  sourceId: SOURCE_ID,
  tagId: TAG_ID,
})

function isolatedIds(index: number): FixtureIds {
  const suffix = String(index).padStart(3, "0")
  return {
    botRoleId: `850000000000001${suffix}`,
    categoryId: `840000000000001${suffix}`,
    createdId: `840000000000003${suffix}`,
    createdTagId: `860000000000002${suffix}`,
    guildId: `830000000000001${suffix}`,
    ownerId: `830000000000002${suffix}`,
    sourceId: `840000000000002${suffix}`,
    tagId: `860000000000001${suffix}`,
  }
}

function role(
  id: string,
  name: string,
  permissions: bigint,
  position: number,
  overrides: Partial<DiscordRole> = {},
): DiscordRole {
  return {
    color: 0,
    colors: {
      primary_color: 0,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: false,
    icon: null,
    id,
    managed: false,
    mentionable: false,
    name,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
    ...overrides,
  }
}

function category(ids: FixtureIds = DEFAULT_IDS): DiscordChannel {
  return {
    flags: 0,
    guild_id: ids.guildId,
    id: ids.categoryId,
    name: "Operations",
    parent_id: null,
    permission_overwrites: [],
    position: 0,
    type: DISCORD_CHANNEL_TYPES.category,
  }
}

function textSource(
  overrides: Partial<DiscordChannel> = {},
  ids: FixtureIds = DEFAULT_IDS,
): DiscordChannel {
  return {
    default_auto_archive_duration: 1_440,
    default_thread_rate_limit_per_user: 0,
    flags: 0,
    guild_id: ids.guildId,
    id: ids.sourceId,
    name: "reviewed-source",
    nsfw: false,
    parent_id: ids.categoryId,
    permission_overwrites: [],
    position: 1,
    rate_limit_per_user: 3,
    topic: "Reviewed source topic",
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function forumSource(
  overrides: Partial<DiscordChannel> = {},
  ids: FixtureIds = DEFAULT_IDS,
): DiscordChannel {
  return {
    available_tags: [{
      emoji_id: null,
      emoji_name: "📌",
      id: ids.tagId,
      moderated: true,
      name: "Pinned",
    }],
    default_auto_archive_duration: 4_320,
    default_forum_layout: 2,
    default_reaction_emoji: {
      emoji_id: null,
      emoji_name: "✅",
    },
    default_sort_order: 1,
    default_thread_rate_limit_per_user: 7,
    flags: DISCORD_CHANNEL_FLAGS.requireTag,
    guild_id: ids.guildId,
    id: ids.sourceId,
    name: "reviewed-forum",
    nsfw: false,
    parent_id: ids.categoryId,
    permission_overwrites: [],
    position: 1,
    rate_limit_per_user: 5,
    topic: "Reviewed forum guidelines",
    type: DISCORD_CHANNEL_TYPES.forum,
    ...overrides,
  }
}

function announcementSource(
  overrides: Partial<DiscordChannel> = {},
  ids: FixtureIds = DEFAULT_IDS,
): DiscordChannel {
  return {
    default_auto_archive_duration: 4_320,
    default_thread_rate_limit_per_user: 9,
    flags: DISCORD_CHANNEL_FLAGS.isSpoilerChannel,
    guild_id: ids.guildId,
    id: ids.sourceId,
    name: "reviewed-announcements",
    nsfw: false,
    parent_id: ids.categoryId,
    permission_overwrites: [],
    position: 1,
    topic: "Reviewed announcements",
    type: DISCORD_CHANNEL_TYPES.announcement,
    ...overrides,
  }
}

function categorySource(
  overrides: Partial<DiscordChannel> = {},
  ids: FixtureIds = DEFAULT_IDS,
): DiscordChannel {
  return {
    flags: 0,
    guild_id: ids.guildId,
    id: ids.sourceId,
    name: "Reviewed category",
    parent_id: null,
    permission_overwrites: [],
    position: 1,
    type: DISCORD_CHANNEL_TYPES.category,
    ...overrides,
  }
}

function voiceSource(
  overrides: Partial<DiscordChannel> = {},
  ids: FixtureIds = DEFAULT_IDS,
): DiscordChannel {
  return {
    bitrate: 96_000,
    flags: 0,
    guild_id: ids.guildId,
    id: ids.sourceId,
    name: "reviewed-voice",
    nsfw: false,
    parent_id: ids.categoryId,
    permission_overwrites: [],
    position: 1,
    rate_limit_per_user: 6,
    rtc_region: "us-central",
    type: DISCORD_CHANNEL_TYPES.voice,
    user_limit: 24,
    video_quality_mode: 2,
    ...overrides,
  }
}

function stageSource(
  overrides: Partial<DiscordChannel> = {},
  ids: FixtureIds = DEFAULT_IDS,
): DiscordChannel {
  return {
    bitrate: 64_000,
    flags: 0,
    guild_id: ids.guildId,
    id: ids.sourceId,
    name: "reviewed-stage",
    nsfw: false,
    parent_id: ids.categoryId,
    permission_overwrites: [],
    position: 1,
    rate_limit_per_user: 4,
    rtc_region: null,
    type: DISCORD_CHANNEL_TYPES.stageVoice,
    user_limit: 500,
    video_quality_mode: 1,
    ...overrides,
  }
}

function mediaSource(
  overrides: Partial<DiscordChannel> = {},
  ids: FixtureIds = DEFAULT_IDS,
): DiscordChannel {
  return {
    available_tags: [{
      emoji_id: null,
      emoji_name: "🎬",
      id: ids.tagId,
      moderated: false,
      name: "Reviewed",
    }],
    default_auto_archive_duration: 10_080,
    default_reaction_emoji: {
      emoji_id: null,
      emoji_name: "🎥",
    },
    default_sort_order: 0,
    default_thread_rate_limit_per_user: 11,
    flags: DISCORD_CHANNEL_FLAGS.requireTag
      | DISCORD_CHANNEL_FLAGS.hideMediaDownloadOptions,
    guild_id: ids.guildId,
    id: ids.sourceId,
    name: "reviewed-media",
    nsfw: false,
    parent_id: ids.categoryId,
    permission_overwrites: [],
    position: 1,
    rate_limit_per_user: 8,
    topic: "Reviewed media guidelines",
    type: DISCORD_CHANNEL_TYPES.media,
    ...overrides,
  }
}

function extraTextChannel(
  index: number,
  ids: FixtureIds = DEFAULT_IDS,
  parentId: string | null = ids.categoryId,
): DiscordChannel {
  return {
    flags: 0,
    guild_id: ids.guildId,
    id: (870000000000000000n + BigInt(index)).toString(),
    name: `extra-${index}`,
    parent_id: parentId,
    permission_overwrites: [],
    position: index + 2,
    type: DISCORD_CHANNEL_TYPES.text,
  }
}

function layoutSnapshot(
  channels: readonly DiscordChannel[],
  revision = 1,
  guildId = GUILD_ID,
): GatewayChannelLayoutSnapshot {
  return {
    channels: channels.map((channel) => ({
      channelId: channel.id,
      obfuscated: false,
      parentChannelId: channel.parent_id ?? null,
      position: channel.position ?? 0,
      type: channel.type,
    })),
    complete: true,
    guildId,
    reason: null,
    revision,
    schemaVersion: SCHEMA_VERSION,
    state: "ready",
    updatedAt: `2026-08-23T14:00:${String(revision).padStart(2, "0")}.000Z`,
  }
}

class FixtureLayoutSource implements GatewayChannelLayoutSource {
  readonly guildId: string
  layoutEnabled = true
  readonly listeners = new Set<GatewayChannelLayoutListener>()
  snapshot: GatewayChannelLayoutSnapshot

  constructor(channels: readonly DiscordChannel[], guildId = GUILD_ID) {
    this.guildId = guildId
    this.snapshot = layoutSnapshot(channels, 1, guildId)
  }

  getChannelLayout(guildId: string): GatewayChannelLayoutSnapshot {
    if (guildId !== this.guildId) {
      return {
        channels: [],
        complete: false,
        guildId,
        reason: "outside-scope",
        revision: 0,
        schemaVersion: SCHEMA_VERSION,
        state: "unavailable",
        updatedAt: null,
      }
    }
    return structuredClone(this.snapshot)
  }

  getChannelLayoutStatus(): GatewayChannelLayoutStatus {
    return {
      channels: {
        obfuscated: this.snapshot.channels.filter((channel) => channel.obfuscated).length,
        retained: this.snapshot.channels.length,
      },
      enabled: this.layoutEnabled,
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
      updates: this.snapshot.revision,
    }
  }

  publish(channels: readonly DiscordChannel[]): void {
    this.snapshot = layoutSnapshot(channels, this.snapshot.revision + 1, this.guildId)
    for (const listener of this.listeners) listener(this.guildId)
  }

  subscribeChannelLayouts(listener: GatewayChannelLayoutListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

class MemoryActivityStore implements ActivityStore {
  appendCalls = 0
  failOnAppend: number | null = null
  readonly entries: ActivityEntry[] = []

  async append(entry: ActivityEntry): Promise<void> {
    this.appendCalls += 1
    if (this.appendCalls === this.failOnAppend) {
      throw new Error("activity store unavailable")
    }
    this.entries.push(structuredClone(entry))
  }

  async list(): Promise<ActivityList> {
    return {
      entries: structuredClone(this.entries),
      file: "/private/activity.jsonl",
      skippedLines: 0,
    }
  }
}

class MemoryOperationStore implements OperationStore {
  finishCalls = 0
  failOnFinish: number | null = null
  readonly receipts = new Map<string, OperationReceipt>()

  #key(kind: OperationKind, operationKeyHash: string): string {
    return `${kind}:${operationKeyHash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.finishCalls += 1
    if (this.finishCalls === this.failOnFinish) {
      throw new Error("operation store unavailable")
    }
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), structuredClone(receipt))
  }

  async get(kind: OperationKind, operationKeyHash: string): Promise<OperationReceipt | undefined> {
    const receipt = this.receipts.get(this.#key(kind, operationKeyHash))
    return receipt ? structuredClone(receipt) : undefined
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: structuredClone(existing) }
    this.receipts.set(key, structuredClone(receipt))
    return { created: true, receipt: structuredClone(receipt) }
  }
}

class FixtureClient {
  readonly ids: FixtureIds
  channels: DiscordChannel[]
  createCalls: Array<{
    auditReason: string
    guildId: string
    input: CreateGuildChannelInput
  }> = []
  beforePublish: ((channels: DiscordChannel[]) => void) | null = null
  createError: unknown = null
  guild: DiscordGuild
  member: DiscordGuildMember
  publishMutation = true
  roles: DiscordRole[]
  source: FixtureLayoutSource

  constructor(source: DiscordChannel = textSource(), ids: FixtureIds = DEFAULT_IDS) {
    this.ids = ids
    this.channels = [category(ids), source]
    this.guild = {
      features: [],
      id: ids.guildId,
      name: "Private guild",
      owner_id: ids.ownerId,
      premium_tier: 0,
    }
    this.member = {
      roles: [ids.botRoleId],
      user: { bot: true, id: BOT_ID, username: "connector" },
    }
    this.roles = [
      role(ids.guildId, "@everyone", DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
      role(ids.botRoleId, "connector", DISCORD_PERMISSIONS.MANAGE_CHANNELS, 1, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
    ]
    this.source = new FixtureLayoutSource(this.channels, ids.guildId)
  }

  async getGuild() {
    return structuredClone(this.guild)
  }

  async getGuildChannels() {
    return structuredClone(this.channels)
  }

  async getGuildMember() {
    return structuredClone(this.member)
  }

  async getGuildRoles() {
    return structuredClone(this.roles)
  }

  async getChannel(channelId: string) {
    const channel = this.channels.find((candidate) => candidate.id === channelId)
    if (!channel) throw new Error("channel missing")
    return structuredClone(channel)
  }

  async createGuildChannel(
    guildId: string,
    input: CreateGuildChannelInput,
    auditReason: string,
  ): Promise<DiscordChannel> {
    this.createCalls.push({ auditReason, guildId, input: structuredClone(input) })
    if (this.createError) throw this.createError
    const channel = channelFromInput(input, this.ids)
    this.channels.push(channel)
    this.beforePublish?.(this.channels)
    if (this.publishMutation) this.source.publish(this.channels)
    return structuredClone(channel)
  }
}

function channelFromInput(
  input: CreateGuildChannelInput,
  ids: FixtureIds = DEFAULT_IDS,
): DiscordChannel {
  return {
    ...(input.availableTags !== undefined
      ? {
          available_tags: input.availableTags.map((tag, index) => ({
            emoji_id: tag.emojiId,
            emoji_name: tag.emojiName,
            id: (BigInt(ids.createdTagId) + BigInt(index)).toString(),
            moderated: tag.moderated,
            name: tag.name,
          })),
        }
      : {}),
    ...(input.bitrate !== undefined ? { bitrate: input.bitrate } : {}),
    ...(input.defaultAutoArchiveDuration !== undefined
      ? { default_auto_archive_duration: input.defaultAutoArchiveDuration }
      : {}),
    ...(input.defaultForumLayout !== undefined
      ? { default_forum_layout: input.defaultForumLayout }
      : {}),
    ...(input.defaultReactionEmoji !== undefined
      ? {
          default_reaction_emoji: input.defaultReactionEmoji === null
            ? null
            : {
                emoji_id: input.defaultReactionEmoji.emojiId,
                emoji_name: input.defaultReactionEmoji.emojiName,
              },
        }
      : {}),
    ...(input.defaultSortOrder !== undefined
      ? { default_sort_order: input.defaultSortOrder }
      : {}),
    ...(input.defaultThreadRateLimitPerUser !== undefined
      ? { default_thread_rate_limit_per_user: input.defaultThreadRateLimitPerUser }
      : {}),
    ...(input.flags !== undefined ? { flags: input.flags } : {}),
    guild_id: ids.guildId,
    id: ids.createdId,
    name: input.name,
    ...(input.nsfw !== undefined ? { nsfw: input.nsfw } : {}),
    parent_id: input.parentId ?? null,
    permission_overwrites: (input.permissionOverwrites ?? []).map((overwrite) => ({
      allow: overwrite.allow,
      deny: overwrite.deny,
      id: overwrite.id,
      type: overwrite.type,
    })),
    position: 2,
    ...(input.rateLimitPerUser !== undefined
      ? { rate_limit_per_user: input.rateLimitPerUser }
      : {}),
    ...(input.rtcRegion !== undefined ? { rtc_region: input.rtcRegion } : {}),
    ...(input.topic !== undefined ? { topic: input.topic } : {}),
    type: input.type,
    ...(input.userLimit !== undefined ? { user_limit: input.userLimit } : {}),
    ...(input.videoQualityMode !== undefined
      ? { video_quality_mode: input.videoQualityMode }
      : {}),
  }
}

function policy(
  audit = true,
  changes = true,
  ids: FixtureIds = DEFAULT_IDS,
): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set<string>(),
    allowedChannelIds: new Set<string>(),
    allowedGuildIds: new Set([ids.guildId]),
    allowAdministration: false,
    allowChannelCloneAudit: audit,
    allowChannelCloning: changes,
    allowDeletions: false,
    allowInteractions: false,
    channelCloneGuildIds: new Set([ids.guildId]),
    channelCloneSourceIds: new Set([ids.sourceId]),
    deleteChannelIds: new Set<string>(),
    interactionChannelIds: new Set<string>(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set<string>(),
    protectedUserIds: new Set<string>(),
  })
}

function request(overrides: Partial<ChannelCloneRequest> = {}): ChannelCloneRequest {
  return requestFor(DEFAULT_IDS, overrides)
}

function requestFor(
  ids: FixtureIds,
  overrides: Partial<ChannelCloneRequest> = {},
): ChannelCloneRequest {
  return {
    auditReason: "Reviewed channel clone",
    guildId: ids.guildId,
    operationKey: OPERATION_KEY,
    sourceChannelId: ids.sourceId,
    ...overrides,
  }
}

function fixture(
  source: DiscordChannel = textSource(),
  timeout = 20,
  ids: FixtureIds = DEFAULT_IDS,
) {
  const activityStore = new MemoryActivityStore()
  const client = new FixtureClient(source, ids)
  const operationStore = new MemoryOperationStore()
  const service = new ChannelCloneService({
    activityStore,
    client,
    clock: () => new Date("2026-08-23T14:00:00.000Z"),
    layoutSource: client.source,
    operationStore,
    planKey: PLAN_KEY,
    policy: policy(true, true, ids),
    randomId: () => "activity-channel-clone-001",
    verificationTimeoutMs: timeout,
  })
  return { activityStore, client, operationStore, service }
}

test("normalizeChannelCloneRequest requires exact IDs and hashes the operation key", () => {
  const normalized = normalizeChannelCloneRequest(request({ name: "reviewed-copy" }))
  assert.equal(normalized.name, "reviewed-copy")
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  assert.throws(
    () => normalizeChannelCloneRequest({ ...request(), extra: true } as never),
    /exact object/u,
  )
})

test("plan copies exact text settings and omits source position", async () => {
  const { service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request({ name: "reviewed-copy" }))
  assert.equal(plan.status, "planned")
  assert.equal(plan.source.id, SOURCE_ID)
  assert.equal(plan.target.payload.name, "reviewed-copy")
  assert.equal(plan.target.payload.topic, "Reviewed source topic")
  assert.equal(plan.target.payload.rateLimitPerUser, 3)
  assert.equal("position" in plan.target.payload, false)
  assert.deepEqual(plan.capacity, {
    guildChannels: 2,
    guildLimit: 500,
    parentChildren: 1,
    parentLimit: 50,
  })
})

test("plan preserves forum semantics while dropping source tag IDs", async () => {
  const { service } = fixture(forumSource())
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request())
  assert.deepEqual(plan.target.payload.availableTags, [{
    emojiId: null,
    emojiName: "📌",
    moderated: true,
    name: "Pinned",
  }])
  assert.equal(plan.target.payload.defaultForumLayout, 2)
  assert.equal(plan.target.payload.defaultSortOrder, 1)
  assert.equal(plan.target.regeneratedTagIds, true)
})

test("plan preserves every create-supported field for the remaining channel types", async () => {
  const cases: Array<{
    expected: CreateGuildChannelInput
    guildFeatures?: string[]
    source: DiscordChannel
  }> = [
    {
      expected: {
        name: "Reviewed category",
        permissionOverwrites: [],
        type: DISCORD_CHANNEL_TYPES.category,
      },
      source: categorySource(),
    },
    {
      expected: {
        defaultAutoArchiveDuration: 4_320,
        defaultThreadRateLimitPerUser: 9,
        flags: DISCORD_CHANNEL_FLAGS.isSpoilerChannel,
        name: "reviewed-announcements",
        nsfw: false,
        parentId: CATEGORY_ID,
        permissionOverwrites: [],
        topic: "Reviewed announcements",
        type: DISCORD_CHANNEL_TYPES.announcement,
      },
      guildFeatures: ["NEWS"],
      source: announcementSource(),
    },
    {
      expected: {
        bitrate: 96_000,
        flags: 0,
        name: "reviewed-voice",
        nsfw: false,
        parentId: CATEGORY_ID,
        permissionOverwrites: [],
        rateLimitPerUser: 6,
        rtcRegion: "us-central",
        type: DISCORD_CHANNEL_TYPES.voice,
        userLimit: 24,
        videoQualityMode: 2,
      },
      source: voiceSource(),
    },
    {
      expected: {
        bitrate: 64_000,
        name: "reviewed-stage",
        nsfw: false,
        parentId: CATEGORY_ID,
        permissionOverwrites: [],
        rateLimitPerUser: 4,
        rtcRegion: null,
        type: DISCORD_CHANNEL_TYPES.stageVoice,
        userLimit: 500,
        videoQualityMode: 1,
      },
      source: stageSource(),
    },
    {
      expected: {
        availableTags: [{
          emojiId: null,
          emojiName: "🎬",
          moderated: false,
          name: "Reviewed",
        }],
        defaultAutoArchiveDuration: 10_080,
        defaultReactionEmoji: {
          emojiId: null,
          emojiName: "🎥",
        },
        defaultSortOrder: 0,
        defaultThreadRateLimitPerUser: 11,
        flags: DISCORD_CHANNEL_FLAGS.requireTag
          | DISCORD_CHANNEL_FLAGS.hideMediaDownloadOptions,
        name: "reviewed-media",
        parentId: CATEGORY_ID,
        permissionOverwrites: [],
        rateLimitPerUser: 8,
        topic: "Reviewed media guidelines",
        type: DISCORD_CHANNEL_TYPES.media,
      },
      source: mediaSource(),
    },
  ]

  for (const candidate of cases) {
    const { client, service } = fixture(candidate.source)
    if (candidate.guildFeatures) client.guild.features = candidate.guildFeatures
    const plan = await service.plan(APPLICATION_ID, BOT_ID, request())
    assert.deepEqual(plan.target.payload, candidate.expected)
    assert.equal("position" in plan.target.payload, false)
  }
})

test("plan requires observed announcement-channel creation access", async () => {
  const blocked = fixture(announcementSource())
  await assert.rejects(
    () => blocked.service.plan(APPLICATION_ID, BOT_ID, request()),
    /lacks the NEWS feature/u,
  )

  const allowed = fixture(announcementSource())
  allowed.client.guild.features = ["NEWS"]
  const plan = await allowed.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(plan.source.typeName, "announcement")
  assert.deepEqual(plan.guild.features, ["NEWS"])
})

test("plan accepts one Unicode emoji grapheme containing a joiner", async () => {
  const { service } = fixture(forumSource({
    available_tags: [{
      emoji_id: null,
      emoji_name: "👩‍💻",
      id: TAG_ID,
      moderated: false,
      name: "Engineering",
    }],
    default_reaction_emoji: {
      emoji_id: null,
      emoji_name: "👩‍💻",
    },
  }))
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(plan.target.payload.availableTags?.[0]?.emojiName, "👩‍💻")
  assert.equal(plan.target.payload.defaultReactionEmoji?.emojiName, "👩‍💻")
})

test("plan rejects a media age restriction that the create endpoint cannot preserve", async () => {
  const { service } = fixture(mediaSource({ nsfw: true }))
  await assert.rejects(
    service.plan(APPLICATION_ID, BOT_ID, request()),
    /age-restriction/u,
  )
})

test("plan preserves the create endpoint topic boundary and rejects expansion", async () => {
  const maximumTopic = "f".repeat(1_024)
  const accepted = fixture(forumSource({ topic: maximumTopic }))
  const plan = await accepted.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(plan.target.payload.topic, maximumTopic)

  const rejected = fixture(forumSource({ topic: `${maximumTopic}f` }))
  await assert.rejects(
    rejected.service.plan(APPLICATION_ID, BOT_ID, request()),
    /cannot be cloned atomically/u,
  )
})

test("plan rejects unknown source fields, unknown overwrite bits, and hidden sources", async () => {
  const unknown = fixture({ ...textSource(), new_clone_field: true } as DiscordChannel)
  await assert.rejects(
    unknown.service.plan(APPLICATION_ID, BOT_ID, request()),
    ChannelCloneEvidenceError,
  )

  const malformedManaged = fixture({ ...textSource(), managed: "false" } as DiscordChannel)
  await assert.rejects(
    malformedManaged.service.plan(APPLICATION_ID, BOT_ID, request()),
    /not safely cloneable/u,
  )

  const unknownFlag = fixture(forumSource({ flags: 2 ** 32 }))
  await assert.rejects(
    unknownFlag.service.plan(APPLICATION_ID, BOT_ID, request()),
    /flags that cannot be cloned/u,
  )

  const permission = fixture(textSource({
    permission_overwrites: [{
      allow: (1n << 63n).toString(),
      deny: "0",
      id: GUILD_ID,
      type: 0,
    }],
  }))
  await assert.rejects(
    permission.service.plan(APPLICATION_ID, BOT_ID, request()),
    /permission bits/u,
  )

  const hidden = fixture()
  hidden.client.source.snapshot.channels = hidden.client.source.snapshot.channels.map((channel) => (
    channel.channelId === SOURCE_ID ? { ...channel, obfuscated: true } : channel
  ))
  await assert.rejects(
    hidden.service.plan(APPLICATION_ID, BOT_ID, request()),
    /absent or obfuscated/u,
  )

  const malformedFeature = fixture()
  malformedFeature.client.guild.features = ["\uD800"]
  await assert.rejects(
    malformedFeature.service.plan(APPLICATION_ID, BOT_ID, request()),
    /invalid channel-clone guild evidence/u,
  )
})

test("plan fails closed at guild and parent channel capacity", async () => {
  const fullGuild = fixture()
  fullGuild.client.channels.push(
    ...Array.from({ length: 498 }, (_, index) => (
      extraTextChannel(index, DEFAULT_IDS, null)
    )),
  )
  fullGuild.client.source.publish(fullGuild.client.channels)
  await assert.rejects(
    fullGuild.service.plan(APPLICATION_ID, BOT_ID, request()),
    /guild channel capacity/u,
  )

  const fullParent = fixture()
  fullParent.client.channels.push(
    ...Array.from({ length: 49 }, (_, index) => extraTextChannel(index)),
  )
  fullParent.client.source.publish(fullParent.client.channels)
  await assert.rejects(
    fullParent.service.plan(APPLICATION_ID, BOT_ID, request()),
    /category child capacity/u,
  )
})

test("plan requires complete clone authority and overwrite targets", async () => {
  const unmanaged = fixture()
  unmanaged.client.roles[1]!.permissions = "0"
  await assert.rejects(
    unmanaged.service.plan(APPLICATION_ID, BOT_ID, request()),
    /guild-level MANAGE_CHANNELS/u,
  )

  const hidden = fixture(textSource({
    permission_overwrites: [{
      allow: "0",
      deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
      id: GUILD_ID,
      type: 0,
    }],
  }))
  await assert.rejects(
    hidden.service.plan(APPLICATION_ID, BOT_ID, request()),
    /lacks VIEW_CHANNEL/u,
  )

  const missingRole = fixture(textSource({
    permission_overwrites: [{
      allow: "0",
      deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
      id: "850000000000000099",
      type: 0,
    }],
  }))
  await assert.rejects(
    missingRole.service.plan(APPLICATION_ID, BOT_ID, request()),
    /missing role/u,
  )

  const unavailablePermission = fixture(textSource({
    permission_overwrites: [{
      allow: "0",
      deny: DISCORD_PERMISSIONS.MANAGE_MESSAGES.toString(),
      id: GUILD_ID,
      type: 0,
    }],
  }))
  await assert.rejects(
    unavailablePermission.service.plan(APPLICATION_ID, BOT_ID, request()),
    /lacks permissions present/u,
  )

  const privilegedOverwrite = fixture(textSource({
    permission_overwrites: [{
      allow: "0",
      deny: DISCORD_PERMISSIONS.MANAGE_ROLES.toString(),
      id: GUILD_ID,
      type: 0,
    }],
  }))
  await assert.rejects(
    privilegedOverwrite.service.plan(APPLICATION_ID, BOT_ID, request()),
    /requires ADMINISTRATOR/u,
  )
})

test("plan enforces observed voice and documented Stage bitrate limits", async () => {
  const voice = fixture(voiceSource({ bitrate: 128_000 }))
  await assert.rejects(
    voice.service.plan(APPLICATION_ID, BOT_ID, request()),
    /observed boost limit/u,
  )

  const stage = fixture(stageSource({ bitrate: 96_000 }))
  await assert.rejects(
    stage.service.plan(APPLICATION_ID, BOT_ID, request()),
    /Stage bitrate/u,
  )
})

test("execute verifies exact readback, source stability, and a newer complete layout", async () => {
  const secondTagId = "860000000000000005"
  const { activityStore, client, service } = fixture(forumSource({
    available_tags: [
      {
        emoji_id: null,
        emoji_name: "📌",
        id: TAG_ID,
        moderated: true,
        name: "Pinned",
      },
      {
        emoji_id: "860000000000000004",
        emoji_name: null,
        id: secondTagId,
        moderated: false,
        name: "Custom",
      },
    ],
  }))
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request({ name: "reviewed-copy" }))
  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    request({ name: "reviewed-copy" }),
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.createdChannelId, CREATED_ID)
  assert.ok(result.observedLayoutRevision > result.baselineLayoutRevision)
  assert.deepEqual(result.tagIdMap, [
    {
      createdTagId: CREATED_TAG_ID,
      sourceTagId: TAG_ID,
    },
    {
      createdTagId: (BigInt(CREATED_TAG_ID) + 1n).toString(),
      sourceTagId: secondTagId,
    },
  ])
  assert.equal(client.createCalls.length, 1)
  assert.equal("position" in client.createCalls[0]!.input, false)
  assert.deepEqual(activityStore.entries.map((entry) => entry.kind), [
    "channel-clone",
    "channel-clone",
  ])
})

test("execute permits raw position normalization without reordering existing siblings", async () => {
  const { client, service } = fixture()
  const siblingId = "840000000000000004"
  client.channels.push(textSource({
    id: siblingId,
    name: "reviewed-sibling",
    position: 2,
  }))
  client.source.publish(client.channels)
  client.beforePublish = (channels) => {
    const source = channels.find((channel) => channel.id === SOURCE_ID)
    const sibling = channels.find((channel) => channel.id === siblingId)
    assert.ok(source)
    assert.ok(sibling)
    source.position = 10
    sibling.position = 11
  }
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request())
  const result = await service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest)
  assert.equal(result.status, "completed")
})

test("execute rejects a spent operation key with a content-free receipt", async () => {
  const { operationStore, service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request())
  await operationStore.reserve({
    activityId: "activity-existing",
    error: null,
    guildId: GUILD_ID,
    kind: "channel-clone",
    operationKeyHash: plan.operationKeyHash,
    planDigest: plan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: "2026-08-23T14:00:00.000Z",
    verification: null,
  })
  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof ChannelCloneOperationConflictError)
      const receipt = JSON.stringify(error.receipt)
      assert.doesNotMatch(receipt, /Reviewed|operation-0001|topic/u)
      assert.match(receipt, /sha256:/u)
      return true
    },
  )
})

test("execute blocks mutation when the pending activity record fails", async () => {
  const { activityStore, client, operationStore, service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request({
    operationKey: "channel-clone-operation-audit-failure",
  }))
  activityStore.failOnAppend = 1
  await assert.rejects(
    service.execute(
      APPLICATION_ID,
      BOT_ID,
      request({ operationKey: "channel-clone-operation-audit-failure" }),
      plan.digest,
    ),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status === "blocked-audit-failed",
  )
  assert.equal(client.createCalls.length, 0)
  const receipt = await operationStore.get("channel-clone", plan.operationKeyHash)
  assert.equal(receipt?.status, "failed")
})

test("execute rejects a stale plan before reserving or mutating", async () => {
  const { client, service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request())
  client.channels[1]!.topic = "Changed after review"
  await assert.rejects(
    service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    ChannelClonePlanChangedError,
  )
  assert.equal(client.createCalls.length, 0)
})

test("execute treats a known client refusal as settled", async () => {
  const refused = fixture()
  const refusedPlan = await refused.service.plan(APPLICATION_ID, BOT_ID, request())
  refused.client.createError = new DiscordApiError({
    code: 50013,
    message: "refused",
    method: "POST",
    route: `/guilds/${GUILD_ID}/channels`,
    status: 403,
  })
  await assert.rejects(
    refused.service.execute(APPLICATION_ID, BOT_ID, request(), refusedPlan.digest),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status === "failed",
  )
  const followup = fixture()
  const followupRequest = request({ operationKey: "channel-clone-operation-after-refusal" })
  const followupPlan = await followup.service.plan(APPLICATION_ID, BOT_ID, followupRequest)
  const result = await followup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    followupRequest,
    followupPlan.digest,
  )
  assert.equal(result.status, "completed")
})

test("execute treats missing Gateway proof as uncertain and quarantines the guild", async () => {
  const ids = isolatedIds(1)
  const uncertain = fixture(textSource({}, ids), 5, ids)
  const cloneRequest = requestFor(ids, {
    operationKey: "channel-clone-operation-missing-proof",
  })
  const uncertainPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, cloneRequest)
  uncertain.client.publishMutation = false
  await assert.rejects(
    uncertain.service.execute(APPLICATION_ID, BOT_ID, cloneRequest, uncertainPlan.digest),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status === "uncertain",
  )

  const blocked = fixture(textSource({}, ids), 5, ids)
  const blockedRequest = requestFor(ids, {
    operationKey: "channel-clone-operation-after-uncertain",
  })
  const blockedPlan = await blocked.service.plan(APPLICATION_ID, BOT_ID, blockedRequest)
  await assert.rejects(
    blocked.service.execute(APPLICATION_ID, BOT_ID, blockedRequest, blockedPlan.digest),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status === "blocked-prior-uncertain",
  )
  assert.equal(blocked.client.createCalls.length, 0)
})

test("execute treats an existing-sibling reorder as uncertain", async () => {
  const ids = isolatedIds(2)
  const siblingId = "840000000000004002"
  const reordered = fixture(textSource({}, ids), 5, ids)
  reordered.client.channels.push(textSource({
    id: siblingId,
    name: "reviewed-sibling",
    position: 2,
  }, ids))
  reordered.client.source.publish(reordered.client.channels)
  reordered.client.beforePublish = (channels) => {
    const source = channels.find((channel) => channel.id === ids.sourceId)
    const sibling = channels.find((channel) => channel.id === siblingId)
    assert.ok(source)
    assert.ok(sibling)
    source.position = 2
    sibling.position = 1
  }
  const cloneRequest = requestFor(ids, {
    operationKey: "channel-clone-operation-reordered",
  })
  const plan = await reordered.service.plan(APPLICATION_ID, BOT_ID, cloneRequest)
  await assert.rejects(
    reordered.service.execute(APPLICATION_ID, BOT_ID, cloneRequest, plan.digest),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status === "uncertain",
  )
})

test("execute treats source metadata drift after creation as uncertain", async () => {
  const ids = isolatedIds(3)
  const drifted = fixture(textSource({}, ids), 20, ids)
  drifted.client.beforePublish = (channels) => {
    const source = channels.find((channel) => channel.id === ids.sourceId)
    assert.ok(source)
    source.topic = "Changed during cloning"
  }
  const cloneRequest = requestFor(ids, {
    operationKey: "channel-clone-operation-source-drift",
  })
  const plan = await drifted.service.plan(APPLICATION_ID, BOT_ID, cloneRequest)
  await assert.rejects(
    drifted.service.execute(APPLICATION_ID, BOT_ID, cloneRequest, plan.digest),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status === "uncertain",
  )
})

test("execute rejects a source tag ID reused by the created channel", async () => {
  const baseIds = isolatedIds(5)
  const ids = { ...baseIds, createdTagId: baseIds.tagId }
  const reused = fixture(forumSource({}, ids), 20, ids)
  const cloneRequest = requestFor(ids, {
    operationKey: "channel-clone-operation-reused-tag",
  })
  const plan = await reused.service.plan(APPLICATION_ID, BOT_ID, cloneRequest)
  await assert.rejects(
    reused.service.execute(APPLICATION_ID, BOT_ID, cloneRequest, plan.digest),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status === "uncertain",
  )
})

test("execute quarantines a verified mutation when its terminal receipt fails", async () => {
  const ids = isolatedIds(4)
  const failedReceipt = fixture(forumSource({}, ids), 20, ids)
  failedReceipt.operationStore.failOnFinish = 1
  const cloneRequest = requestFor(ids, {
    operationKey: "channel-clone-operation-receipt-failure",
  })
  const plan = await failedReceipt.service.plan(APPLICATION_ID, BOT_ID, cloneRequest)
  await assert.rejects(
    failedReceipt.service.execute(APPLICATION_ID, BOT_ID, cloneRequest, plan.digest),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status
        === "completed-operation-record-failed",
  )
  assert.deepEqual(
    failedReceipt.activityStore.entries.map((entry) => entry.status),
    ["pending", "uncertain"],
  )
  assert.equal(failedReceipt.client.createCalls.length, 1)
  assert.doesNotMatch(
    JSON.stringify(failedReceipt.activityStore.entries),
    /Reviewed channel clone|reviewed-forum|guidelines/u,
  )

  const blocked = fixture(forumSource({}, ids), 20, ids)
  const blockedRequest = requestFor(ids, {
    operationKey: "channel-clone-operation-after-receipt-failure",
  })
  const blockedPlan = await blocked.service.plan(APPLICATION_ID, BOT_ID, blockedRequest)
  await assert.rejects(
    blocked.service.execute(APPLICATION_ID, BOT_ID, blockedRequest, blockedPlan.digest),
    (error: unknown) => error instanceof ChannelCloneExecutionError
      && (error.result as { status?: unknown }).status === "blocked-prior-uncertain",
  )
})
