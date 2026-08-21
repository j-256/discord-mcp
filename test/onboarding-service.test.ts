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
  DiscordGuildOnboarding,
  ModifyGuildOnboardingInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  OnboardingEvidenceError,
  OnboardingExecutionError,
  OnboardingOperationConflictError,
  OnboardingPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import {
  normalizeOnboardingChangeRequest,
  OnboardingService,
  type OnboardingChangeRequest,
  type OnboardingServiceOptions,
} from "../src/onboarding-service.js"
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

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const SAFE_ROLE_ID = "400000000000000002"
const EMOJI_ID = "500000000000000001"
const PROMPT_ID = "600000000000000001"
const OPTION_ID = "700000000000000001"
const NEW_PROMPT_ID = "600000000000000002"
const NEW_OPTION_ID = "700000000000000002"
const CHANNEL_IDS = Array.from(
  { length: 7 },
  (_, index) => `80000000000000000${index + 1}`,
)
const OPERATION_KEY = "onboarding-operation-0001"
const AUDIT_REASON = "Reviewed onboarding / community launch"
const NOW = "2026-08-21T00:00:00.000Z"
const PRIVATE_PROMPT_TITLE = "Private member-facing prompt"
const PRIVATE_OPTION_TITLE = "Private member-facing option"

function role(id: string, permissions: bigint, position: number): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(id: string): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: `private-channel-${id}`,
    parent_id: null,
    permission_overwrites: [],
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
    name: "wave",
    requiresColons: true,
    roleIds: [],
  }
}

function emptyOnboarding(): DiscordGuildOnboarding {
  return {
    defaultChannelIds: [],
    enabled: false,
    guildId: GUILD_ID,
    mode: 0,
    prompts: [],
    unknownEnumCount: 0,
    unknownFieldCount: 0,
  }
}

function populatedOnboarding(): DiscordGuildOnboarding {
  return {
    defaultChannelIds: [...CHANNEL_IDS],
    enabled: true,
    guildId: GUILD_ID,
    mode: 0,
    prompts: [{
      id: PROMPT_ID,
      inOnboarding: true,
      options: [{
        channelIds: [CHANNEL_IDS[0] as string],
        description: "Private option description",
        emoji: { animated: false, id: EMOJI_ID, name: "wave" },
        id: OPTION_ID,
        roleIds: [SAFE_ROLE_ID],
        title: PRIVATE_OPTION_TITLE,
      }],
      required: true,
      singleSelect: true,
      title: PRIVATE_PROMPT_TITLE,
      type: 0,
    }],
    unknownEnumCount: 0,
    unknownFieldCount: 0,
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
  guildFeatures: string[] | undefined
  mutationError: unknown
  mutationGate: Promise<void> | null
  mutationStarted: (() => void) | null
  mutationUpdatesState: boolean
  onboarding: DiscordGuildOnboarding
  readbackError: unknown
  responseDrift: boolean
  responseUsesPromptPlaceholder: boolean
  roles: DiscordRole[]
}

function responseFromInput(
  input: ModifyGuildOnboardingInput,
  current: DiscordGuildOnboarding,
): DiscordGuildOnboarding {
  const currentPromptIds = new Set(current.prompts.map((prompt) => prompt.id))
  const currentOptionIds = new Set(current.prompts.flatMap((prompt) => (
    prompt.options.map((option) => option.id)
  )))
  let newPromptIndex = 0
  let newOptionIndex = 0
  return {
    defaultChannelIds: [...input.defaultChannelIds],
    enabled: input.enabled,
    guildId: GUILD_ID,
    mode: input.mode,
    prompts: input.prompts.map((prompt) => ({
      id: currentPromptIds.has(prompt.id)
        ? prompt.id
        : (BigInt(NEW_PROMPT_ID) + BigInt(newPromptIndex++)).toString(),
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map((option) => ({
        channelIds: [...option.channelIds],
        description: option.description,
        emoji: option.emoji === null
          ? null
          : {
              animated: option.emoji.animated,
              id: option.emoji.id,
              name: option.emoji.name,
            },
        id: option.id && currentOptionIds.has(option.id)
          ? option.id
          : (BigInt(NEW_OPTION_ID) + BigInt(newOptionIndex++)).toString(),
        roleIds: [...option.roleIds],
        title: option.title,
      })),
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type: prompt.type,
    })),
    unknownEnumCount: 0,
    unknownFieldCount: 0,
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
    channels: CHANNEL_IDS.map(channel),
    emojis: [emoji()],
    guildFeatures: ["COMMUNITY"],
    mutationError: undefined,
    mutationGate: null,
    mutationStarted: null,
    mutationUpdatesState: true,
    onboarding: emptyOnboarding(),
    readbackError: undefined,
    responseDrift: false,
    responseUsesPromptPlaceholder: false,
    roles: [
      role(
        GUILD_ID,
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.SEND_MESSAGES,
        0,
      ),
      role(
        BOT_ROLE_ID,
        DISCORD_PERMISSIONS.MANAGE_GUILD | DISCORD_PERMISSIONS.MANAGE_ROLES,
        10,
      ),
      role(SAFE_ROLE_ID, 0n, 5),
    ],
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const writes: ModifyGuildOnboardingInput[] = []
  let activityCalls = 0
  let mutationCompleted = false
  let policyCalls = 0
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
  const scopedPolicy: OnboardingServiceOptions["policy"] = {
    assertGuildOnboardingAuditable(guildId) {
      policyCalls += 1
      if (!(options.allowAudit ?? true) || guildId !== GUILD_ID) {
        throw new PolicyError("Discord onboarding audit is outside scope")
      }
    },
    assertGuildOnboardingChangeable(guildId) {
      policyCalls += 1
      if (!(options.allowChanges ?? true) || guildId !== GUILD_ID) {
        throw new PolicyError("Discord onboarding change is outside scope")
      }
    },
  }
  const client: OnboardingServiceOptions["client"] = {
    async getGuild() {
      events.push("read:guild")
      return {
        ...(state.guildFeatures !== undefined ? { features: state.guildFeatures } : {}),
        id: GUILD_ID,
        name: "Private Guild",
        owner_id: OWNER_ID,
      }
    },
    async getGuildChannels() {
      events.push("read:channels")
      return state.channels
    },
    async getGuildMember() {
      events.push("read:member")
      return state.botMember
    },
    async getGuildOnboarding() {
      events.push(mutationCompleted ? "read:readback" : "read:onboarding")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return structuredClone(state.onboarding)
    },
    async getGuildRoles() {
      events.push("read:roles")
      return state.roles
    },
    async listGuildEmojis() {
      events.push("read:emojis")
      return state.emojis
    },
    async modifyGuildOnboarding(_guildId, input, reason) {
      events.push(`write:onboarding:${reason}`)
      writes.push(structuredClone(input))
      state.mutationStarted?.()
      if (state.mutationGate) await state.mutationGate
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      const response = responseFromInput(input, state.onboarding)
      if (state.responseUsesPromptPlaceholder && response.prompts[0]) {
        response.prompts[0].id = input.prompts[0]!.id
      }
      if (state.mutationUpdatesState) state.onboarding = structuredClone(response)
      if (state.responseDrift) response.prompts[0]!.title = "Valid response drift"
      return response
    },
  }
  const service = new OnboardingService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(13),
    policy: scopedPolicy,
    randomId: () => "activity-0001",
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
  overrides: Partial<OnboardingChangeRequest> = {},
): OnboardingChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    defaultChannelIds: CHANNEL_IDS,
    enabled: true,
    guildId: GUILD_ID,
    mode: "default",
    operationKey: OPERATION_KEY,
    prompts: [{
      inOnboarding: true,
      options: [{
        channelIds: [CHANNEL_IDS[0] as string],
        description: "Welcome to the community",
        emoji: { guildEmojiId: EMOJI_ID, kind: "guild" },
        roleIds: [SAFE_ROLE_ID],
        title: "Community member",
      }],
      required: true,
      singleSelect: true,
      title: "Choose your access",
      type: "multiple-choice",
    }],
    ...overrides,
  }
}

function requestForCurrent(
  onboarding: DiscordGuildOnboarding,
  overrides: Partial<OnboardingChangeRequest> = {},
): OnboardingChangeRequest {
  const prompt = onboarding.prompts[0]
  const option = prompt?.options[0]
  assert.ok(prompt)
  assert.ok(option)
  return request({
    defaultChannelIds: onboarding.defaultChannelIds,
    enabled: onboarding.enabled,
    mode: onboarding.mode === 1 ? "advanced" : "default",
    prompts: [{
      inOnboarding: prompt.inOnboarding,
      options: [{
        channelIds: option.channelIds,
        description: option.description,
        emoji: option.emoji?.id
          ? { guildEmojiId: option.emoji.id, kind: "guild" }
          : option.emoji?.name
            ? { kind: "unicode", unicode: option.emoji.name }
            : null,
        optionId: option.id,
        roleIds: option.roleIds,
        title: option.title,
      }],
      promptId: prompt.id,
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type: prompt.type === 1 ? "dropdown" : "multiple-choice",
    }],
    ...overrides,
  })
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected onboarding change",
    method: "PUT",
    route: "/guilds/{guild.id}/onboarding",
    status,
  })
}

test("onboarding normalization rejects ambiguous desired state before remote access", () => {
  assert.throws(
    () => normalizeOnboardingChangeRequest(request({
      defaultChannelIds: [CHANNEL_IDS[0] as string, CHANNEL_IDS[0] as string],
    })),
    /must be unique/,
  )
  assert.throws(
    () => normalizeOnboardingChangeRequest(request({
      prompts: [
        request().prompts[0] as never,
        request().prompts[0] as never,
      ],
    })),
    /titles must be unique/,
  )
  const prompt = request().prompts[0]!
  assert.throws(
    () => normalizeOnboardingChangeRequest(request({
      prompts: [{
        ...prompt,
        options: [{
          ...prompt.options[0]!,
          emoji: { kind: "unicode", unicode: "not emoji" },
        }],
      }],
    })),
    /one emoji grapheme/,
  )
  assert.throws(
    () => normalizeOnboardingChangeRequest({
      ...request(),
      future: true,
    } as unknown as OnboardingChangeRequest),
    /request is invalid/,
  )
})

test("onboarding audit defaults to content minimization and supports explicit transient text", async () => {
  const { service, state } = fixture({
    state: { onboarding: populatedOnboarding() },
  })

  const minimized = await service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  const included = await service.get(APPLICATION_ID, BOT_ID, GUILD_ID, true)

  assert.equal(minimized.configuration.textIncluded, false)
  assert.equal(minimized.configuration.prompts[0]?.title, null)
  assert.equal(minimized.configuration.prompts[0]?.options[0]?.description, null)
  assert.equal(JSON.stringify(minimized).includes(PRIVATE_PROMPT_TITLE), false)
  assert.equal(JSON.stringify(minimized).includes(PRIVATE_OPTION_TITLE), false)
  assert.equal(included.configuration.prompts[0]?.title, PRIVATE_PROMPT_TITLE)
  assert.equal(included.configuration.prompts[0]?.options[0]?.title, PRIVATE_OPTION_TITLE)
  assert.equal(included.access.authorizedForChange, true)
  assert.equal(included.configuration.enablement.constraintsMet, true)
  assert.equal(state.onboarding.enabled, true)

  state.onboarding.prompts = []
  const enabledWithoutPrompts = await service.get(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
  )
  assert.equal(
    enabledWithoutPrompts.verificationBoundary.freshNonStaffClientCheckRecommended,
    true,
  )
})

test("onboarding planning proves safe references and rejects authority-bearing roles", async () => {
  const safe = fixture()
  const plan = await safe.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.status, "planned")
  assert.equal(plan.diff.promptsAdded, 1)
  assert.equal(plan.desired.enablement.constraintsMet, true)
  assert.deepEqual(plan.risks, [
    "channel-assignment-change",
    "emoji-change",
    "enablement-change",
    "fresh-member-client-check-required",
    "full-replacement",
    "member-facing-text-change",
    "role-assignment-change",
  ])
  assert.equal(plan.current.textIncluded, true)
  assert.equal(plan.operationKeyHash.includes(OPERATION_KEY), false)

  const unsafe = fixture()
  unsafe.state.roles = unsafe.state.roles.map((entry) => (
    entry.id === SAFE_ROLE_ID
      ? role(SAFE_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_MESSAGES, 5)
      : entry
  ))
  await assert.rejects(
    () => unsafe.service.plan(APPLICATION_ID, BOT_ID, request()),
    OnboardingEvidenceError,
  )

  const unknown = fixture()
  unknown.state.onboarding.unknownFieldCount = 1
  await assert.rejects(
    () => unknown.service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown or ambiguous state/,
  )

  const nonCommunity = fixture({ state: { guildFeatures: [] } })
  await assert.rejects(
    () => nonCommunity.service.plan(APPLICATION_ID, BOT_ID, request()),
    /requires the COMMUNITY guild feature/,
  )
  const disablePlan = await nonCommunity.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ enabled: false }),
  )
  assert.equal(disablePlan.desired.communityGuild, false)

  const incompleteFeatures = fixture({ state: { guildFeatures: undefined } })
  await assert.rejects(
    () => incompleteFeatures.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    OnboardingEvidenceError,
  )

  const malformedEmoji = fixture()
  malformedEmoji.state.emojis[0]!.roleIds = [SAFE_ROLE_ID, SAFE_ROLE_ID]
  await assert.rejects(
    () => malformedEmoji.service.plan(APPLICATION_ID, BOT_ID, request()),
    OnboardingEvidenceError,
  )

  const mismatchedOnboarding = fixture()
  mismatchedOnboarding.state.onboarding.guildId = OWNER_ID
  await assert.rejects(
    () => mismatchedOnboarding.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    OnboardingEvidenceError,
  )
})

test("onboarding reviewed digests bind custom emoji restrictions", async () => {
  const reviewed = fixture()
  reviewed.state.emojis[0]!.roleIds = [SAFE_ROLE_ID]
  const desired = request()
  const plan = await reviewed.service.plan(APPLICATION_ID, BOT_ID, desired)
  assert.equal(plan.risks.includes("guild-emoji-role-restriction"), true)
  assert.deepEqual(
    plan.desired.prompts[0]?.options[0]?.emoji.restrictedRoleIds,
    [SAFE_ROLE_ID],
  )
  reviewed.state.emojis[0]!.roleIds = []

  await assert.rejects(
    () => reviewed.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      plan.digest,
    ),
    OnboardingPlanChangedError,
  )
})

test("onboarding no-op execution does not reserve an operation or write", async () => {
  const current = populatedOnboarding()
  const { events, operationStore, service, writes } = fixture({
    state: { onboarding: current },
  })
  const desired = requestForCurrent(current)
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

test("onboarding execution reserves and records before one write then verifies readback", async () => {
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
  assert.equal(writes[0]?.prompts[0]?.id, "18446744073709551615")
  assert.equal(writes[0]?.prompts[0]?.options[0]?.id, undefined)
  assert.deepEqual(events.slice(6, 9), [
    "operation:reserve",
    "activity:pending",
    `write:onboarding:${AUDIT_REASON}`,
  ])
  assert.equal(operationStore.lastReceipt?.status, "completed")
  assert.equal(operationStore.lastReceipt?.resourceId, GUILD_ID)
  assert.equal(operationStore.lastReceipt?.verification, "match")
  const serialized = JSON.stringify({
    activities,
    receipt: operationStore.lastReceipt,
    result,
  })
  for (const privateText of [
    AUDIT_REASON,
    "Choose your access",
    "Community member",
    "Welcome to the community",
    "wave",
  ]) {
    assert.equal(serialized.includes(privateText), false)
  }
})

test("onboarding execution reports valid semantic drift and spends the key", async () => {
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
  assert.equal(state.onboarding.prompts.length, 0)
  await assert.rejects(
    () => service.plan(APPLICATION_ID, BOT_ID, desired),
    OnboardingOperationConflictError,
  )
})

test("onboarding execution never treats a transport prompt placeholder as authoritative", async () => {
  const { operationStore, service } = fixture({
    state: { responseUsesPromptPlaceholder: true },
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
  assert.equal(operationStore.lastReceipt?.verification, "drift")
})

test("onboarding execution rejects stale plans and blocks when pending audit fails", async () => {
  const stale = fixture()
  const desired = request()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, desired)
  stale.state.onboarding.mode = 1
  await assert.rejects(
    () => stale.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      plan.digest,
    ),
    OnboardingPlanChangedError,
  )

  const featureDrift = fixture()
  const featurePlan = await featureDrift.service.plan(
    APPLICATION_ID,
    BOT_ID,
    desired,
  )
  featureDrift.state.guildFeatures?.push("NEWS")
  await assert.rejects(
    () => featureDrift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      featurePlan.digest,
    ),
    OnboardingPlanChangedError,
  )

  const auditFailure = fixture({ state: { activityFailureAt: 1 } })
  const auditPlan = await auditFailure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    desired,
  )
  auditFailure.events.length = 0
  await assert.rejects(
    () => auditFailure.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      auditPlan.digest,
    ),
    (error: unknown) => (
      error instanceof OnboardingExecutionError
      && (error.result as { status: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(auditFailure.writes.length, 0)
  assert.deepEqual(auditFailure.events, [
    "read:guild",
    "read:member",
    "read:roles",
    "read:channels",
    "read:emojis",
    "read:onboarding",
    "operation:reserve",
    "activity:pending",
    "operation:failed",
  ])
})

test("onboarding policy gates audit and changes separately", async () => {
  const auditBlocked = fixture({ allowAudit: false })
  await assert.rejects(
    () => auditBlocked.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    PolicyError,
  )
  assert.deepEqual(auditBlocked.events, [])

  const changesBlocked = fixture({ allowChanges: false })
  await assert.rejects(
    () => changesBlocked.service.plan(APPLICATION_ID, BOT_ID, request()),
    PolicyError,
  )
  assert.deepEqual(changesBlocked.events, [])
})

test("onboarding executions serialize and rebuild a queued same-guild plan", async () => {
  let releaseMutation: () => void = () => undefined
  let signalMutation: () => void = () => undefined
  const mutationGate = new Promise<void>((resolve) => {
    releaseMutation = resolve
  })
  const mutationStarted = new Promise<void>((resolve) => {
    signalMutation = resolve
  })
  const concurrent = fixture({
    state: {
      mutationGate,
      mutationStarted: signalMutation,
    },
  })
  const firstRequest = request()
  const secondRequest = request({ operationKey: "onboarding-operation-0002" })
  const firstPlan = await concurrent.service.plan(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
  )
  const secondPlan = await concurrent.service.plan(
    APPLICATION_ID,
    BOT_ID,
    secondRequest,
  )

  const firstExecution = concurrent.service.execute(
    APPLICATION_ID,
    BOT_ID,
    firstRequest,
    firstPlan.digest,
  )
  await mutationStarted
  const secondExecution = assert.rejects(
    () => concurrent.service.execute(
      APPLICATION_ID,
      BOT_ID,
      secondRequest,
      secondPlan.digest,
    ),
    OnboardingPlanChangedError,
  )
  releaseMutation()

  const firstResult = await firstExecution
  await secondExecution
  assert.equal(firstResult.status, "completed")
  assert.equal(concurrent.writes.length, 1)
})

test("onboarding definite mutation refusal settles while verification refusal blocks the guild", async () => {
  const refused = fixture()
  const desired = request()
  const refusedPlan = await refused.service.plan(APPLICATION_ID, BOT_ID, desired)
  refused.state.mutationError = apiError(400)
  await assert.rejects(
    () => refused.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      refusedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof OnboardingExecutionError
      && (error.result as { status: string }).status === "failed"
    ),
  )
  assert.equal(refused.operationStore.lastReceipt?.status, "failed")

  const uncertain = fixture()
  const uncertainPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, desired)
  uncertain.state.readbackError = apiError(404)
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof OnboardingExecutionError
      && (error.result as { status: string }).status === "uncertain"
    ),
  )
  assert.equal(uncertain.operationStore.lastReceipt?.status, "uncertain")
  uncertain.events.length = 0
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request({ operationKey: "onboarding-operation-0002" }),
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof OnboardingExecutionError
      && (error.result as { status: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.deepEqual(uncertain.events, [])
})
