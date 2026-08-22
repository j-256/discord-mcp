import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  SCHEMA_VERSION,
} from "../src/constants.js"
import type {
  DiscordGuildEmojiSummary,
  DiscordGuildWelcomeScreen,
  ModifyGuildWelcomeScreenInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  PolicyError,
  WelcomeScreenEvidenceError,
  WelcomeScreenExecutionError,
  WelcomeScreenOperationConflictError,
  WelcomeScreenPlanChangedError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"
import {
  normalizeWelcomeScreenChangeRequest,
  WelcomeScreenService,
  type WelcomeScreenChangeRequest,
  type WelcomeScreenServiceOptions,
} from "../src/welcome-screen-service.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const EMOJI_ID = "500000000000000001"
const CHANNEL_ID = "600000000000000001"
const SECOND_CHANNEL_ID = "600000000000000002"
const OPERATION_KEY = "welcome-screen-operation-0001"
const AUDIT_REASON = "Reviewed Welcome Screen launch"
const NOW = "2026-08-22T00:00:00.000Z"
const PRIVATE_DESCRIPTION = "Private community greeting"
const PRIVATE_CHANNEL_DESCRIPTION = "Private rules description"

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(
  id: string,
  overwrites: DiscordChannel["permission_overwrites"] = [],
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: `private-channel-${id}`,
    parent_id: null,
    permission_overwrites: overwrites,
    type: DISCORD_CHANNEL_TYPES.text,
  }
}

function emoji(): DiscordGuildEmojiSummary {
  return {
    animated: false,
    available: true,
    creatorUserId: null,
    id: EMOJI_ID,
    managed: false,
    name: "private_wave",
    requiresColons: true,
    roleIds: [],
  }
}

function emptyScreen(): DiscordGuildWelcomeScreen {
  return {
    description: null,
    unknownFieldCount: 0,
    welcomeChannels: [],
  }
}

function populatedScreen(): DiscordGuildWelcomeScreen {
  return {
    description: PRIVATE_DESCRIPTION,
    unknownFieldCount: 0,
    welcomeChannels: [{
      channelId: CHANNEL_ID,
      description: PRIVATE_CHANNEL_DESCRIPTION,
      emojiId: null,
      emojiName: "👋",
      unknownFieldCount: 0,
    }],
  }
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
  channels: DiscordChannel[]
  emojis: DiscordGuildEmojiSummary[]
  enabled: boolean
  guildFeatures: string[] | undefined
  mutationError: unknown
  mutationUpdatesState: boolean
  readbackError: unknown
  responseDrift: boolean
  responseUnknown: boolean
  screen: DiscordGuildWelcomeScreen | null
  roles: DiscordRole[]
}

function responseFromInput(
  input: ModifyGuildWelcomeScreenInput,
): DiscordGuildWelcomeScreen {
  return {
    description: input.description,
    unknownFieldCount: 0,
    welcomeChannels: input.welcomeChannels.map((entry) => ({
      channelId: entry.channelId,
      description: entry.description,
      emojiId: entry.emojiId,
      emojiName: entry.emojiName,
      unknownFieldCount: 0,
    })),
  }
}

function fixture(options: {
  allowAudit?: boolean
  allowChanges?: boolean
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: [channel(CHANNEL_ID), channel(SECOND_CHANNEL_ID)],
    emojis: [emoji()],
    enabled: false,
    guildFeatures: ["COMMUNITY"],
    mutationError: undefined,
    mutationUpdatesState: true,
    readbackError: undefined,
    responseDrift: false,
    responseUnknown: false,
    roles: [
      role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 10),
    ],
    screen: emptyScreen(),
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const writes: ModifyGuildWelcomeScreenInput[] = []
  let activityCalls = 0
  let mutationCompleted = false
  let policyCalls = 0
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
  const policy: WelcomeScreenServiceOptions["policy"] = {
    assertGuildWelcomeScreenAuditable(guildId) {
      policyCalls += 1
      if (!(options.allowAudit ?? true) || guildId !== GUILD_ID) {
        throw new PolicyError("Discord Welcome Screen audit is outside scope")
      }
    },
    assertGuildWelcomeScreenChangeable(guildId) {
      policyCalls += 1
      if (!(options.allowChanges ?? true) || guildId !== GUILD_ID) {
        throw new PolicyError("Discord Welcome Screen change is outside scope")
      }
    },
  }
  const client: WelcomeScreenServiceOptions["client"] = {
    async getGuild() {
      events.push("read:guild")
      const features = state.guildFeatures === undefined
        ? undefined
        : [
            ...state.guildFeatures,
            ...(state.enabled ? ["WELCOME_SCREEN_ENABLED"] : []),
          ]
      return {
        ...(features === undefined ? {} : { features: [...new Set(features)] }),
        id: GUILD_ID,
        name: "Private Guild",
        owner_id: OWNER_ID,
      }
    },
    async getGuildChannels() {
      events.push("read:channels")
      return structuredClone(state.channels)
    },
    async getGuildMember() {
      events.push("read:member")
      return structuredClone(state.botMember)
    },
    async getGuildRoles() {
      events.push("read:roles")
      return structuredClone(state.roles)
    },
    async getGuildWelcomeScreen() {
      events.push(mutationCompleted ? "read:readback" : "read:welcome-screen")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return state.screen === null ? null : structuredClone(state.screen)
    },
    async listGuildEmojis() {
      events.push("read:emojis")
      return structuredClone(state.emojis)
    },
    async modifyGuildWelcomeScreen(_guildId, input, reason) {
      events.push(`write:welcome-screen:${reason}`)
      writes.push(structuredClone(input))
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      const response = responseFromInput(input)
      if (state.responseDrift) response.description = "Valid response drift"
      if (state.responseUnknown) response.unknownFieldCount = 1
      if (state.mutationUpdatesState) {
        state.screen = responseFromInput(input)
        state.enabled = input.enabled
      }
      return response
    },
  }
  const service = new WelcomeScreenService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(17),
    policy,
    randomId: () => "activity-welcome-screen-0001",
  })
  return {
    activities,
    events,
    getPolicyCalls: () => policyCalls,
    operationStore,
    service,
    state,
    writes,
  }
}

function request(
  overrides: Partial<WelcomeScreenChangeRequest> = {},
): WelcomeScreenChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    channels: [{
      channelId: CHANNEL_ID,
      description: "Read the community rules",
      emoji: { emojiId: EMOJI_ID, kind: "custom" },
    }, {
      channelId: SECOND_CHANNEL_ID,
      description: "Introduce yourself",
      emoji: { kind: "unicode", unicode: "👋" },
    }],
    description: "Welcome to the community",
    enabled: true,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function requestForCurrent(
  screen: DiscordGuildWelcomeScreen,
  enabled: boolean,
): WelcomeScreenChangeRequest {
  return request({
    channels: screen.welcomeChannels.map((entry) => ({
      channelId: entry.channelId,
      description: entry.description,
      emoji: entry.emojiId !== null
        ? { emojiId: entry.emojiId, kind: "custom" }
        : entry.emojiName !== null
          ? { kind: "unicode", unicode: entry.emojiName }
          : { kind: "none" },
    })),
    description: screen.description,
    enabled,
  })
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected Welcome Screen change",
    method: "PATCH",
    route: "/guilds/{guild.id}/welcome-screen",
    status,
  })
}

test("Welcome Screen normalization rejects ambiguous complete state", () => {
  assert.throws(
    () => normalizeWelcomeScreenChangeRequest(request({
      channels: [request().channels[0]!, request().channels[0]!],
    })),
    /must be unique/,
  )
  assert.throws(
    () => normalizeWelcomeScreenChangeRequest(request({
      description: " not trimmed",
    })),
    /description is invalid/,
  )
  assert.throws(
    () => normalizeWelcomeScreenChangeRequest(request({
      channels: [{
        ...request().channels[0]!,
        emoji: { kind: "unicode", unicode: "not emoji" },
      }],
    })),
    /one emoji grapheme/,
  )
  assert.throws(
    () => normalizeWelcomeScreenChangeRequest({
      ...request(),
      future: true,
    } as unknown as WelcomeScreenChangeRequest),
    /request is invalid/,
  )
})

test("Welcome Screen audit omits text by default and reports inaccessible disabled state", async () => {
  const includedFixture = fixture({
    state: { enabled: true, screen: populatedScreen() },
  })
  const minimized = await includedFixture.service.get(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
  )
  const included = await includedFixture.service.get(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    true,
  )

  assert.equal(minimized.configuration.description, null)
  assert.equal(minimized.configuration.channels[0]?.description, null)
  assert.equal(minimized.configuration.channels[0]?.emoji.unicode, null)
  assert.equal(JSON.stringify(minimized).includes(PRIVATE_DESCRIPTION), false)
  assert.equal(JSON.stringify(minimized).includes(PRIVATE_CHANNEL_DESCRIPTION), false)
  assert.equal(included.configuration.description, PRIVATE_DESCRIPTION)
  assert.equal(included.configuration.channels[0]?.description, PRIVATE_CHANNEL_DESCRIPTION)
  assert.equal(included.configuration.channels[0]?.emoji.unicode, "👋")
  assert.equal(included.verificationBoundary.freshNonStaffClientCheckRecommended, true)

  const unavailable = fixture({
    state: {
      roles: [role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0), role(BOT_ROLE_ID, 0n, 10)],
      screen: null,
    },
  })
  const result = await unavailable.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(result.configuration.available, false)
  assert.deepEqual(result.configuration.issues, ["disabled-screen-requires-manage-guild"])
  assert.equal(unavailable.events.includes("read:welcome-screen"), false)
})

test("Welcome Screen planning binds public channels, emoji evidence, and full replacement", async () => {
  const safe = fixture()
  const plan = await safe.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.status, "planned")
  assert.equal(plan.diff.channelEntriesAdded, 2)
  assert.equal(plan.diff.enabledChanged, true)
  assert.equal(plan.desired.channels.every((entry) => entry.channel.everyoneCanView), true)
  assert.equal(plan.desired.channels[0]?.emoji.customEmojiId, EMOJI_ID)
  assert.equal(plan.operationKeyHash.includes(OPERATION_KEY), false)
  assert.equal(plan.risks.includes("The write replaces the complete Welcome Screen configuration"), true)

  const hidden = fixture()
  hidden.state.channels[0] = channel(CHANNEL_ID, [{
    allow: "0",
    deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
    id: GUILD_ID,
    type: 0,
  }])
  await assert.rejects(
    () => hidden.service.plan(APPLICATION_ID, BOT_ID, request()),
    /visible to @everyone/,
  )

  const restricted = fixture()
  restricted.state.emojis[0]!.roleIds = [BOT_ROLE_ID]
  await assert.rejects(
    () => restricted.service.plan(APPLICATION_ID, BOT_ID, request()),
    /custom emojis must be visible/,
  )

  const unknown = fixture()
  unknown.state.screen!.unknownFieldCount = 1
  await assert.rejects(
    () => unknown.service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown state/,
  )
})

test("Welcome Screen planning fails closed on scope, authority, features, and evidence", async () => {
  const outOfScope = fixture({ allowChanges: false })
  await assert.rejects(
    () => outOfScope.service.plan(APPLICATION_ID, BOT_ID, request()),
    PolicyError,
  )
  assert.equal(outOfScope.events.length, 0)

  const noAuthority = fixture({
    state: {
      roles: [role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0), role(BOT_ROLE_ID, 0n, 10)],
    },
  })
  await assert.rejects(
    () => noAuthority.service.plan(APPLICATION_ID, BOT_ID, request()),
    /MANAGE_GUILD authority/,
  )

  const nonCommunity = fixture({ state: { guildFeatures: [] } })
  await assert.rejects(
    () => nonCommunity.service.plan(APPLICATION_ID, BOT_ID, request()),
    /COMMUNITY guild feature/,
  )

  const incomplete = fixture({ state: { guildFeatures: undefined } })
  await assert.rejects(
    () => incomplete.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    WelcomeScreenEvidenceError,
  )
})

test("Welcome Screen no-op execution does not reserve, journal, or write", async () => {
  const current = populatedScreen()
  const { events, operationStore, service, writes } = fixture({
    state: { enabled: true, screen: current },
  })
  const desired = requestForCurrent(current, true)
  const plan = await service.plan(APPLICATION_ID, BOT_ID, desired)
  events.length = 0

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(plan.status, "already-current")
  assert.deepEqual(result, {
    activityId: null,
    guildId: GUILD_ID,
    operationKeyHash: plan.operationKeyHash,
    planDigest: plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: "already-current",
    verification: "not-required",
  })
  assert.equal(operationStore.lastReceipt, undefined)
  assert.equal(writes.length, 0)
  assert.equal(events.includes("operation:reserve"), false)
})

test("Welcome Screen execution journals before one non-retried write and verifies readback", async () => {
  const { activities, events, operationStore, service, writes } = fixture()
  const desired = request()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, desired)
  events.length = 0

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.enabled, true)
  assert.equal(writes[0]?.welcomeChannels[0]?.emojiId, EMOJI_ID)
  assert.equal(writes[0]?.welcomeChannels[0]?.emojiName, "private_wave")
  const reserveIndex = events.indexOf("operation:reserve")
  const pendingIndex = events.indexOf("activity:pending")
  const writeIndex = events.indexOf(`write:welcome-screen:${AUDIT_REASON}`)
  assert.equal(reserveIndex >= 0 && reserveIndex < pendingIndex && pendingIndex < writeIndex, true)
  assert.equal(events.filter((event) => event.startsWith("write:")).length, 1)
  assert.equal(operationStore.lastReceipt?.status, "completed")
  assert.equal(operationStore.lastReceipt?.resourceId, GUILD_ID)
  assert.equal(operationStore.lastReceipt?.verification, "match")
  const persisted = JSON.stringify({ activities, receipt: operationStore.lastReceipt })
  for (const privateValue of [
    AUDIT_REASON,
    "Welcome to the community",
    "Read the community rules",
    CHANNEL_ID,
    SECOND_CHANNEL_ID,
    "private_wave",
  ]) {
    assert.equal(persisted.includes(privateValue), false)
  }
})

test("Welcome Screen execution reports verified semantic drift and spends the key", async () => {
  const { operationStore, service, state } = fixture({
    state: { mutationUpdatesState: false, responseDrift: true },
  })
  const desired = request()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, desired)

  const result = await service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")
  assert.equal(operationStore.lastReceipt?.status, "completed")
  assert.equal(operationStore.lastReceipt?.verification, "drift")
  assert.equal(state.enabled, false)
  await assert.rejects(
    () => service.plan(APPLICATION_ID, BOT_ID, desired),
    WelcomeScreenOperationConflictError,
  )
})

test("Welcome Screen execution rejects changed plans and blocks on pending activity failure", async () => {
  const stale = fixture()
  const desired = request()
  const stalePlan = await stale.service.plan(APPLICATION_ID, BOT_ID, desired)
  stale.state.screen = populatedScreen()
  await assert.rejects(
    () => stale.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      stalePlan.digest,
    ),
    WelcomeScreenPlanChangedError,
  )
  assert.equal(stale.writes.length, 0)

  const blocked = fixture({ state: { activityFailureAt: 1 } })
  const blockedPlan = await blocked.service.plan(APPLICATION_ID, BOT_ID, desired)
  await assert.rejects(
    () => blocked.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      blockedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WelcomeScreenExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(blocked.writes.length, 0)
  assert.equal(blocked.operationStore.lastReceipt?.status, "failed")
})

test("Welcome Screen execution separates known refusal from ambiguous dispatch", async () => {
  const rejected = fixture({ state: { mutationError: apiError(403) } })
  const rejectedRequest = request({ operationKey: "welcome-screen-rejected-0001" })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    rejectedRequest,
  )
  await assert.rejects(
    () => rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      rejectedRequest,
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WelcomeScreenExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(rejected.operationStore.lastReceipt?.status, "failed")

  const uncertain = fixture({ state: { mutationError: new Error("network unavailable") } })
  const uncertainRequest = request({ operationKey: "welcome-screen-uncertain-0001" })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WelcomeScreenExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal(uncertain.operationStore.lastReceipt?.status, "uncertain")

  uncertain.state.mutationError = undefined
  const nextRequest = request({ operationKey: "welcome-screen-after-uncertain-0001" })
  const nextPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, nextRequest)
  uncertain.events.length = 0
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      nextRequest,
      nextPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WelcomeScreenExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.deepEqual(uncertain.events, [])
})
