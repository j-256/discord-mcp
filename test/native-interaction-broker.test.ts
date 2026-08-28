import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { DISCORD_MESSAGE_FLAGS } from "../src/constants.js"
import {
  DiscordApiError,
  NativeInteractionResponseError,
} from "../src/errors.js"
import {
  NativeInteractionBroker,
  createDisabledNativeInteractionSource,
  type NativeInteractionBrokerOptions,
  type NativeInteractionScheduler,
} from "../src/native-interaction-broker.js"
import {
  nativeInteractionCommandContract,
} from "../src/native-interaction-command-service.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordApplicationCommand,
  DiscordMessage,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const CHANNEL_ID = "300000000000000001"
const USER_ID = "400000000000000001"
const OTHER_USER_ID = "400000000000000002"
const BOT_ID = "500000000000000001"
const COMMAND_ID = "600000000000000001"
const COMMAND_VERSION = "700000000000000001"
const INTERACTION_ID = "800000000000000001"
const MESSAGE_ID = "900000000000000001"
const FOLLOWUP_MESSAGE_ID = "900000000000000002"
const COMMAND_NAME = "discord-mcp"
const TOKEN = "private.interaction-token"
const REQUEST = "Summarize the release discussion"
const RESPONSE = "The release discussion is ready for review."
const NOW_MS = Date.parse("2026-08-22T00:00:00.000Z")

function command(
  overrides: Partial<DiscordApplicationCommand> = {},
): DiscordApplicationCommand {
  const contract = nativeInteractionCommandContract(COMMAND_NAME)
  return {
    application_id: APPLICATION_ID,
    default_member_permissions: contract.defaultMemberPermissions,
    description: contract.description,
    guild_id: GUILD_ID,
    id: COMMAND_ID,
    name: contract.name,
    nsfw: false,
    options: [{
      description: contract.option.description,
      max_length: contract.option.maximumLength,
      min_length: contract.option.minimumLength,
      name: contract.option.name,
      required: true,
      type: 3,
    }],
    type: 1,
    version: COMMAND_VERSION,
    ...overrides,
  }
}

function interaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    application_id: APPLICATION_ID,
    authorizing_integration_owners: { "0": GUILD_ID },
    channel_id: CHANNEL_ID,
    context: 0,
    data: {
      guild_id: GUILD_ID,
      id: COMMAND_ID,
      name: COMMAND_NAME,
      options: [{ name: "request", type: 3, value: REQUEST }],
      type: 1,
    },
    guild_id: GUILD_ID,
    id: INTERACTION_ID,
    member: {
      permissions: "8",
      user: { id: USER_ID, username: "private-user" },
    },
    token: TOKEN,
    type: 2,
    version: 1,
    ...overrides,
  }
}

function responseMessage(
  content: string,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    application_id: APPLICATION_ID,
    attachments: [],
    author: { bot: true, id: BOT_ID, username: "connector" },
    channel_id: CHANNEL_ID,
    components: [],
    content,
    embeds: [],
    flags: DISCORD_MESSAGE_FLAGS.ephemeral,
    id: MESSAGE_ID,
    interaction_metadata: {
      authorizing_integration_owners: { "0": GUILD_ID },
      id: INTERACTION_ID,
      type: 2,
      user: { id: USER_ID, username: "private-user" },
    },
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    timestamp: new Date(NOW_MS).toISOString(),
    tts: false,
    type: 20,
    webhook_id: APPLICATION_ID,
    ...overrides,
  }
}

function policy(options: {
  channels?: readonly string[]
  enabled?: boolean
  guilds?: readonly string[]
  users?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowNativeInteractions: options.enabled ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    nativeInteractionChannelIds: new Set(options.channels || [CHANNEL_ID]),
    nativeInteractionGuildIds: new Set(options.guilds || [GUILD_ID]),
    nativeInteractionUserIds: new Set(options.users || [USER_ID]),
    protectedUserIds: new Set(),
  })
}

class MemoryScheduler implements NativeInteractionScheduler {
  #next = 1
  readonly handlers = new Map<number, () => void>()

  clearTimeout(handle: unknown): void {
    this.handlers.delete(Number(handle))
  }

  runAll(): void {
    const handlers = [...this.handlers.values()]
    this.handlers.clear()
    for (const handler of handlers) handler()
  }

  setTimeout(handler: () => void, _milliseconds: number): unknown {
    const handle = this.#next
    this.#next += 1
    this.handlers.set(handle, handler)
    return handle
  }
}

interface FixtureState {
  activityAdvanceAt: number | null
  activityAdvanceMilliseconds: number
  activityFailureAt: number | null
  activityGate: Promise<void> | null
  activityGateAt: number | null
  applicationEndpoint: string | null
  botId: string
  channelError: unknown
  commandInventory: DiscordApplicationCommand[]
  deferError: unknown
  deferGate: Promise<void> | null
  editError: unknown
  editGate: Promise<void> | null
  editResponse: DiscordMessage | null
  followupCreateError: unknown
  followupCreateGate: Promise<void> | null
  followupGetError: unknown
  followupReadback: DiscordMessage | null
  followupResponse: DiscordMessage | null
  immediateError: unknown
  inventoryError: unknown
  preflightGate: Promise<void> | null
}

function fixture(options: {
  maximumPending?: number
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  let nowMs = NOW_MS
  const state: FixtureState = {
    activityAdvanceAt: null,
    activityAdvanceMilliseconds: 0,
    activityFailureAt: null,
    activityGate: null,
    activityGateAt: null,
    applicationEndpoint: null,
    botId: BOT_ID,
    channelError: undefined,
    commandInventory: [command()],
    deferError: undefined,
    deferGate: null,
    editError: undefined,
    editGate: null,
    editResponse: null,
    followupCreateError: undefined,
    followupCreateGate: null,
    followupGetError: undefined,
    followupReadback: null,
    followupResponse: null,
    immediateError: undefined,
    inventoryError: undefined,
    preflightGate: null,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const deferred: Array<{ id: string; token: string }> = []
  const initialResponseSignals: AbortSignal[] = []
  const immediate: Array<{ content: string; id: string; token: string }> = []
  const edits: Array<{ content: string; token: string }> = []
  const followups: Array<{ content: string; token: string }> = []
  const followupReads: Array<{ messageId: string; token: string }> = []
  let activityCalls = 0
  let continuationReferenceNumber = 0
  let referenceNumber = 0
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) {
        throw new Error("activity unavailable")
      }
      activities.push(entry)
      if (state.activityGateAt === activityCalls && state.activityGate) {
        await state.activityGate
      }
      if (state.activityAdvanceAt === activityCalls) {
        nowMs += state.activityAdvanceMilliseconds
      }
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const client: NativeInteractionBrokerOptions["client"] = {
    async createDeferredInteractionResponse(id, token, requestOptions) {
      events.push("callback:defer")
      deferred.push({ id, token })
      if (requestOptions?.signal) initialResponseSignals.push(requestOptions.signal)
      if (state.deferGate) await state.deferGate
      if (state.deferError) throw state.deferError
    },
    async createImmediateInteractionResponse(id, token, content, requestOptions) {
      events.push("callback:immediate")
      immediate.push({ content, id, token })
      if (requestOptions?.signal) initialResponseSignals.push(requestOptions.signal)
      if (state.immediateError) throw state.immediateError
    },
    async createInteractionFollowup(_applicationId, token, content) {
      events.push("response:followup")
      followups.push({ content, token })
      if (state.followupCreateGate) await state.followupCreateGate
      if (state.followupCreateError) throw state.followupCreateError
      return state.followupResponse || responseMessage(content, {
        id: String(BigInt(FOLLOWUP_MESSAGE_ID) + BigInt(followups.length - 1)),
        type: 0,
      })
    },
    async editOriginalInteractionResponse(_applicationId, token, content) {
      events.push("response:edit")
      edits.push({ content, token })
      if (state.editGate) await state.editGate
      if (state.editError) throw state.editError
      return state.editResponse || responseMessage(content)
    },
    async getChannel() {
      events.push("read:channel")
      if (state.channelError) throw state.channelError
      return {
        guild_id: GUILD_ID,
        id: CHANNEL_ID,
        name: "private-channel",
        parent_id: null,
        type: 0,
      }
    },
    async getCurrentApplication() {
      events.push("read:application")
      if (state.preflightGate) await state.preflightGate
      return {
        description: "",
        id: APPLICATION_ID,
        interactions_endpoint_url: state.applicationEndpoint,
        name: "Connector",
      }
    },
    async getCurrentUser() {
      events.push("read:bot")
      return { bot: true, id: state.botId, username: "connector" }
    },
    async getInteractionFollowup(_applicationId, token, messageId) {
      events.push("read:followup")
      followupReads.push({ messageId, token })
      if (state.followupGetError) throw state.followupGetError
      return state.followupReadback || responseMessage(
        followups.at(-1)?.content || RESPONSE,
        { id: messageId, type: 0 },
      )
    },
    async listGuildApplicationCommands() {
      events.push("read:commands")
      if (state.inventoryError) throw state.inventoryError
      return [...state.commandInventory]
    },
  }
  const scheduler = new MemoryScheduler()
  const broker = new NativeInteractionBroker({
    activityStore,
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    client,
    clock: () => new Date(nowMs),
    config: {
      allowNativeInteractions: true,
      nativeCommandName: COMMAND_NAME,
      nativeInteractionGuildIds: new Set([GUILD_ID]),
      nativeInteractionMaxPending: options.maximumPending ?? 25,
      nativeInteractionTtlSeconds: 60,
    },
    policy: options.policy || policy(),
    randomId: () => `activity-native-${activityCalls + 1}`,
    randomContinuationReference: () => {
      continuationReferenceNumber += 1
      return `icref_${continuationReferenceNumber.toString(16).padStart(32, "0")}`
    },
    randomReference: () => {
      referenceNumber += 1
      return `iref_${referenceNumber.toString(16).padStart(32, "0")}`
    },
    scheduler,
  })
  return {
    activities,
    advance(milliseconds: number) {
      nowMs += milliseconds
    },
    broker,
    deferred,
    edits,
    events,
    immediate,
    followupReads,
    followups,
    initialResponseSignals,
    scheduler,
    state,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord Interaction request failed",
    method: "PATCH",
    route: "/webhooks/{application.id}/{interaction.token}/messages/@original",
    status,
  })
}

test("disabled source stays inert and exposes no pending requests", async () => {
  const source = createDisabledNativeInteractionSource({
    nativeCommandName: COMMAND_NAME,
    nativeInteractionGuildIds: new Set(),
    nativeInteractionMaxPending: 25,
    nativeInteractionTtlSeconds: 600,
  })
  assert.equal(source.enabled, false)
  assert.equal(source.getStatus().phase, "disabled")
  assert.deepEqual((await source.listContinuations()).continuations, [])
  assert.deepEqual((await source.listPending()).interactions, [])
  await assert.rejects(
    () => source.respond(`iref_${"0".repeat(32)}`, "response"),
    /disabled/,
  )
  await assert.rejects(
    () => source.followup(`icref_${"0".repeat(32)}`, "response"),
    /disabled/,
  )
})

test("shutdown during preflight cannot revive or restart the broker", async () => {
  let releasePreflight!: () => void
  const preflightGate = new Promise<void>((resolve) => {
    releasePreflight = resolve
  })
  const setup = fixture({ state: { preflightGate } })
  const starting = setup.broker.start()
  assert.equal(setup.broker.getStatus().phase, "checking")

  await setup.broker.stop()
  assert.equal(setup.broker.getStatus().phase, "stopped")
  releasePreflight()
  await starting
  assert.equal(setup.broker.getStatus().phase, "stopped")

  await setup.broker.start()
  assert.equal(setup.broker.getStatus().phase, "stopped")
})

test("shutdown owns an in-flight deferred request and prevents late acceptance", async () => {
  let releaseDeferred!: () => void
  const deferGate = new Promise<void>((resolve) => {
    releaseDeferred = resolve
  })
  const setup = fixture({ state: { deferGate } })
  await setup.broker.start()

  const ingesting = setup.broker.ingestInteraction(interaction())
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(setup.deferred.length, 1)

  const stopping = setup.broker.stop()
  releaseDeferred()
  await Promise.all([ingesting, stopping])

  assert.equal(setup.broker.getStatus().phase, "stopped")
  assert.equal(setup.broker.getStatus().totals.accepted, 0)
  assert.equal(setup.broker.getStatus().totals.expired, 1)
  assert.deepEqual((await setup.broker.listPending()).interactions, [])
  assert.deepEqual(
    setup.events.filter((event) => event === "activity:accepted"),
    [],
  )
  assert.ok(setup.events.indexOf("callback:defer") < setup.events.indexOf("response:edit"))
})

test("preflight requires exact identity, Gateway ingress, and one managed command", async () => {
  const ready = fixture()
  await ready.broker.start()
  assert.equal(ready.broker.getStatus().phase, "ready")
  assert.equal(ready.broker.getStatus().command.verifiedGuildCount, 1)

  const endpoint = fixture({ state: { applicationEndpoint: "https://example.test/interactions" } })
  await assert.rejects(() => endpoint.broker.start(), /HTTP Interaction endpoint/)
  assert.equal(endpoint.broker.getStatus().lastError?.category, "application-endpoint-conflict")

  const identity = fixture({ state: { botId: "500000000000000002" } })
  await assert.rejects(() => identity.broker.start(), /identity preflight/)
  assert.equal(identity.broker.getStatus().lastError?.category, "identity-mismatch")

  const drift = fixture({
    state: { commandInventory: [command({ description: "Drifted" })] },
  })
  await assert.rejects(() => drift.broker.start(), /managed-command preflight/)
  assert.equal(drift.broker.getStatus().lastError?.category, "command-contract-mismatch")

  const malformedInventory = fixture({
    state: {
      commandInventory: [null as unknown as DiscordApplicationCommand],
    },
  })
  await assert.rejects(() => malformedInventory.broker.start(), /inventory is invalid/)
  assert.equal(
    malformedInventory.broker.getStatus().lastError?.category,
    "command-inventory-invalid",
  )
})

test("managed Interaction defers first and exposes only freshly validated token-free state", async () => {
  const setup = fixture()
  await setup.broker.start()
  setup.events.length = 0
  setup.state.commandInventory = [command({ version: "700000000000000002" })]

  await setup.broker.ingestInteraction(interaction())
  const pending = await setup.broker.listPending()

  assert.equal(pending.status, "ok")
  assert.equal(pending.interactions.length, 1)
  assert.equal(pending.interactions[0]?.request, REQUEST)
  assert.equal(pending.interactions[0]?.commandVersion, "700000000000000002")
  assert.equal(JSON.stringify(pending).includes(TOKEN), false)
  assert.equal(JSON.stringify(setup.activities).includes(TOKEN), false)
  assert.deepEqual(setup.deferred, [{ id: INTERACTION_ID, token: TOKEN }])
  assert.equal(setup.initialResponseSignals.length, 1)
  assert.equal(setup.initialResponseSignals[0]?.aborted, false)
  assert.ok(setup.events.indexOf("callback:defer") < setup.events.indexOf("read:channel"))
  assert.ok(setup.events.indexOf("callback:defer") < setup.events.indexOf("read:commands"))
  assert.ok(setup.events.indexOf("activity:accepted") > setup.events.indexOf("read:commands"))
  assert.equal(setup.broker.getStatus().totals.accepted, 1)
})

test("scope rejection receives a static private response and content-free activity", async () => {
  const setup = fixture({ policy: policy({ users: [OTHER_USER_ID] }) })
  await setup.broker.start()
  setup.events.length = 0

  await setup.broker.ingestInteraction(interaction())

  assert.equal(setup.deferred.length, 0)
  assert.equal(setup.immediate.length, 1)
  assert.equal(setup.initialResponseSignals.length, 1)
  assert.match(setup.immediate[0]?.content || "", /not authorized/)
  assert.deepEqual((await setup.broker.listPending()).interactions, [])
  const activity = setup.activities.at(-1)
  assert.equal(activity?.status, "rejected")
  assert.equal(activity?.kind === "native-interaction" ? activity.error : null, "scope-rejected")
  assert.equal(JSON.stringify(activity).includes(REQUEST), false)
  assert.equal(JSON.stringify(activity).includes(TOKEN), false)
})

test("initial rejection callback ambiguity is recorded separately", async () => {
  const setup = fixture({
    policy: policy({ users: [OTHER_USER_ID] }),
    state: { immediateError: apiError(429) },
  })
  await setup.broker.start()

  await setup.broker.ingestInteraction(interaction())

  assert.deepEqual(
    setup.activities.slice(-2).map(({ status }) => status),
    ["rejected", "response-uncertain"],
  )
  assert.equal(setup.broker.getStatus().totals.uncertain, 1)
  assert.equal(setup.broker.getStatus().lastError?.category, "callback-uncertain")
})

test("invalid or unrelated Interaction payloads are ignored without callbacks", async () => {
  const setup = fixture()
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction({
    data: {
      id: "600000000000000002",
      name: "other-command",
      options: [],
      type: 1,
    },
  }))
  await setup.broker.ingestInteraction(interaction({ context: 1 }))
  assert.equal(setup.deferred.length, 0)
  assert.equal(setup.immediate.length, 0)
  assert.deepEqual((await setup.broker.listPending()).interactions, [])
})

test("managed payload and administrator failures receive fixed private rejections", async () => {
  const malformed = fixture()
  await malformed.broker.start()
  await malformed.broker.ingestInteraction(interaction({
    data: {
      guild_id: GUILD_ID,
      id: COMMAND_ID,
      name: COMMAND_NAME,
      options: [],
      type: 1,
    },
  }))
  assert.equal(malformed.deferred.length, 0)
  assert.match(malformed.immediate[0]?.content || "", /could not be validated/)
  assert.equal(malformed.activities.at(-1)?.status, "rejected")
  assert.equal(
    malformed.activities.at(-1)?.kind === "native-interaction"
      ? malformed.activities.at(-1)?.error
      : null,
    "payload-invalid",
  )

  const unauthorized = fixture()
  await unauthorized.broker.start()
  await unauthorized.broker.ingestInteraction(interaction({
    member: {
      permissions: "0",
      user: { id: USER_ID, username: "private-user" },
    },
  }))
  assert.equal(unauthorized.deferred.length, 0)
  assert.match(unauthorized.immediate[0]?.content || "", /not authorized/)
  assert.equal(unauthorized.activities.at(-1)?.status, "rejected")
  assert.equal(
    unauthorized.activities.at(-1)?.kind === "native-interaction"
      ? unauthorized.activities.at(-1)?.error
      : null,
    "scope-rejected",
  )
})

test("post-defer evidence failure is rejected and never exposes request text", async () => {
  const setup = fixture()
  await setup.broker.start()
  setup.state.inventoryError = apiError(503)
  setup.events.length = 0

  await setup.broker.ingestInteraction(interaction())

  assert.equal(setup.deferred.length, 1)
  assert.equal(setup.edits.length, 1)
  assert.match(setup.edits[0]?.content || "", /could not be validated/)
  assert.deepEqual((await setup.broker.listPending()).interactions, [])
  assert.equal(
    setup.broker.getStatus().lastError?.category,
    "validation-evidence-unavailable",
  )
  assert.equal(setup.activities.at(-1)?.status, "rejected")
  assert.equal(JSON.stringify(setup.activities).includes(REQUEST), false)
})

test("deduplication and capacity reject excess work without exposing it", async () => {
  const setup = fixture({ maximumPending: 1 })
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  await setup.broker.ingestInteraction(interaction())
  assert.equal(setup.deferred.length, 1)
  assert.equal(setup.immediate.length, 0)

  await setup.broker.ingestInteraction(interaction({ id: "800000000000000002" }))
  assert.equal(setup.immediate.length, 1)
  assert.match(setup.immediate[0]?.content || "", /queue is full/)
  assert.equal((await setup.broker.listPending()).interactions.length, 1)
})

test("response journals before one edit, validates exact evidence, and consumes the token", async () => {
  const setup = fixture()
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const reference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(reference)
  setup.events.length = 0

  const result = await setup.broker.respond(reference, RESPONSE)

  assert.equal(result.status, "completed")
  assert.equal(result.continuation, null)
  assert.equal(result.responseMessageId, MESSAGE_ID)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  assert.deepEqual((await setup.broker.listPending()).interactions, [])
  assert.deepEqual((await setup.broker.listContinuations()).continuations, [])
  assert.equal(setup.edits.length, 1)
  assert.ok(setup.events.indexOf("activity:response-pending") < setup.events.indexOf("response:edit"))
  assert.deepEqual(
    setup.activities.slice(-2).map(({ status }) => status),
    ["response-pending", "response-completed"],
  )
  await assert.rejects(() => setup.broker.respond(reference, RESPONSE), /unavailable or expired/)
})

test("explicit continuation keeps the token private and rotates after exact follow-up readback", async () => {
  const setup = fixture()
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const reference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(reference)

  const initial = await setup.broker.respond(reference, RESPONSE, { keepOpen: true })
  const firstReference = initial.continuation?.reference
  assert.ok(firstReference)
  assert.equal(initial.continuation?.followupsRemaining, 3)
  assert.equal((await setup.broker.listContinuations()).continuations.length, 1)
  assert.equal(JSON.stringify(initial).includes(TOKEN), false)
  assert.equal(JSON.stringify(await setup.broker.listContinuations()).includes(TOKEN), false)
  assert.equal(JSON.stringify(setup.activities).includes(TOKEN), false)

  setup.events.length = 0
  const result = await setup.broker.followup(
    firstReference,
    "The first private follow-up is ready.",
    { keepOpen: true },
  )
  const secondReference = result.continuation?.reference
  assert.ok(secondReference)
  assert.notEqual(secondReference, firstReference)
  assert.equal(result.followupsCompleted, 1)
  assert.equal(result.continuation?.followupsRemaining, 2)
  assert.equal(result.verification, "response-and-readback-match")
  assert.equal(result.responseMessageId, FOLLOWUP_MESSAGE_ID)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  assert.equal(setup.followups.length, 1)
  assert.deepEqual(setup.followupReads, [{ messageId: FOLLOWUP_MESSAGE_ID, token: TOKEN }])
  assert.ok(setup.events.indexOf("activity:followup-pending") < setup.events.indexOf("response:followup"))
  assert.ok(setup.events.indexOf("response:followup") < setup.events.indexOf("read:followup"))
  assert.ok(setup.events.indexOf("read:followup") < setup.events.indexOf("activity:followup-completed"))
  assert.ok(setup.events.indexOf("activity:followup-completed") < setup.events.indexOf("activity:continuation-opened"))
  assert.deepEqual(
    (await setup.broker.listContinuations()).continuations.map(({ reference }) => reference),
    [secondReference],
  )
  await assert.rejects(
    () => setup.broker.followup(firstReference, "Do not send this twice."),
    /unavailable or expired/,
  )
})

test("continuations enforce a fixed sequence limit and share queue capacity", async () => {
  const setup = fixture({ maximumPending: 1 })
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const pendingReference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(pendingReference)
  let continuation = (await setup.broker.respond(
    pendingReference,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(continuation)

  await setup.broker.ingestInteraction(interaction({ id: "800000000000000002" }))
  assert.equal(setup.immediate.length, 1)
  assert.match(setup.immediate[0]?.content || "", /queue is full/)

  for (let sequence = 1; sequence <= 3; sequence += 1) {
    assert.ok(continuation)
    const result = await setup.broker.followup(
      continuation.reference,
      `Private follow-up ${sequence}`,
      { keepOpen: true },
    )
    assert.equal(result.followupsCompleted, sequence)
    continuation = result.continuation
  }
  assert.equal(continuation, null)
  assert.deepEqual((await setup.broker.listContinuations()).continuations, [])
  assert.equal(setup.broker.getStatus().totals.followups, 3)
  assert.equal(setup.broker.getStatus().limits.maximumFollowups, 3)

  await setup.broker.ingestInteraction(interaction({ id: "800000000000000003" }))
  assert.equal((await setup.broker.listPending()).interactions.length, 1)
})

test("in-flight responses retain shared capacity and shutdown cannot reopen a continuation", async () => {
  let releaseEdit!: () => void
  const editGate = new Promise<void>((resolve) => {
    releaseEdit = resolve
  })
  let releaseFollowup!: () => void
  const followupCreateGate = new Promise<void>((resolve) => {
    releaseFollowup = resolve
  })
  const setup = fixture({
    maximumPending: 1,
    state: { editGate, followupCreateGate },
  })
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const pendingReference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(pendingReference)

  const responding = setup.broker.respond(
    pendingReference,
    RESPONSE,
    { keepOpen: true },
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  await setup.broker.ingestInteraction(interaction({
    id: "800000000000000002",
  }))
  assert.match(setup.immediate.at(-1)?.content || "", /queue is full/)
  releaseEdit()
  const continuation = (await responding).continuation
  assert.ok(continuation)

  const followingUp = setup.broker.followup(
    continuation.reference,
    "The final private follow-up is ready.",
    { keepOpen: true },
  )
  await new Promise<void>((resolve) => setImmediate(resolve))
  await setup.broker.ingestInteraction(interaction({
    id: "800000000000000003",
  }))
  assert.match(setup.immediate.at(-1)?.content || "", /queue is full/)

  await setup.broker.stop()
  releaseFollowup()
  const result = await followingUp
  assert.equal(result.continuation, null)
  assert.deepEqual((await setup.broker.listContinuations()).continuations, [])
  assert.equal(setup.broker.getStatus().phase, "stopped")
})

test("shutdown during continuation recording cannot publish a late reference", async () => {
  let releaseActivity!: () => void
  const activityGate = new Promise<void>((resolve) => {
    releaseActivity = resolve
  })
  const setup = fixture({
    state: {
      activityGate,
      activityGateAt: 4,
    },
  })
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const pendingReference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(pendingReference)

  const responding = setup.broker.respond(
    pendingReference,
    RESPONSE,
    { keepOpen: true },
  )
  while (!setup.events.includes("activity:continuation-opened")) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  await setup.broker.stop()
  releaseActivity()

  const result = await responding
  assert.equal(result.continuation, null)
  assert.deepEqual((await setup.broker.listContinuations()).continuations, [])
  assert.deepEqual(
    setup.activities.slice(-2).map(({ status }) => status),
    ["continuation-opened", "continuation-expired"],
  )
})

test("follow-up pending activity failure restores the same fresh continuation", async () => {
  const setup = fixture()
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const pendingReference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(pendingReference)
  const continuation = (await setup.broker.respond(
    pendingReference,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(continuation)
  setup.state.activityFailureAt = setup.activities.length + 1

  await assert.rejects(
    () => setup.broker.followup(continuation.reference, "Blocked follow-up"),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(setup.followups.length, 0)
  assert.deepEqual(
    (await setup.broker.listContinuations()).continuations.map(({ reference }) => reference),
    [continuation.reference],
  )

  setup.state.activityFailureAt = null
  const result = await setup.broker.followup(continuation.reference, "Recorded follow-up")
  assert.equal(result.status, "completed")
  assert.equal(result.continuation, null)
})

test("follow-up refusal and uncertainty consume the one-shot continuation", async () => {
  const rejected = fixture()
  await rejected.broker.start()
  await rejected.broker.ingestInteraction(interaction())
  const rejectedPending = (await rejected.broker.listPending()).interactions[0]?.reference
  assert.ok(rejectedPending)
  const rejectedContinuation = (await rejected.broker.respond(
    rejectedPending,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(rejectedContinuation)
  rejected.state.followupCreateError = apiError(400)
  await assert.rejects(
    () => rejected.broker.followup(rejectedContinuation.reference, "Rejected follow-up"),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )
  assert.deepEqual((await rejected.broker.listContinuations()).continuations, [])
  assert.equal(rejected.followupReads.length, 0)
  assert.equal(rejected.activities.at(-1)?.status, "followup-failed")

  const uncertain = fixture()
  await uncertain.broker.start()
  await uncertain.broker.ingestInteraction(interaction())
  const uncertainPending = (await uncertain.broker.listPending()).interactions[0]?.reference
  assert.ok(uncertainPending)
  const uncertainContinuation = (await uncertain.broker.respond(
    uncertainPending,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(uncertainContinuation)
  uncertain.state.followupCreateError = apiError(429)
  await assert.rejects(
    () => uncertain.broker.followup(uncertainContinuation.reference, "Uncertain follow-up"),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.deepEqual((await uncertain.broker.listContinuations()).continuations, [])
  assert.equal(uncertain.broker.getStatus().totals.uncertain, 1)
  assert.equal(uncertain.activities.at(-1)?.status, "followup-uncertain")
})

test("follow-up response and readback drift are quarantined after dispatch", async () => {
  const invalid = fixture()
  await invalid.broker.start()
  await invalid.broker.ingestInteraction(interaction())
  const invalidPending = (await invalid.broker.listPending()).interactions[0]?.reference
  assert.ok(invalidPending)
  const invalidContinuation = (await invalid.broker.respond(
    invalidPending,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(invalidContinuation)
  invalid.state.followupResponse = responseMessage("Invalid evidence", {
    application_id: "100000000000000002",
    id: FOLLOWUP_MESSAGE_ID,
    type: 0,
  })
  await assert.rejects(
    () => invalid.broker.followup(invalidContinuation.reference, "Invalid evidence"),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(invalid.followupReads.length, 0)
  assert.equal(invalid.broker.getStatus().lastError?.category, "followup-evidence-invalid")

  const drift = fixture()
  await drift.broker.start()
  await drift.broker.ingestInteraction(interaction())
  const driftPending = (await drift.broker.listPending()).interactions[0]?.reference
  assert.ok(driftPending)
  const driftContinuation = (await drift.broker.respond(
    driftPending,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(driftContinuation)
  drift.state.followupReadback = responseMessage("Changed after response", {
    id: FOLLOWUP_MESSAGE_ID,
    type: 0,
  })
  await assert.rejects(
    () => drift.broker.followup(driftContinuation.reference, "Expected follow-up"),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(drift.followupReads.length, 1)
  assert.deepEqual((await drift.broker.listContinuations()).continuations, [])
})

test("follow-up completion recording failure closes the token after verified delivery", async () => {
  const setup = fixture()
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const pendingReference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(pendingReference)
  const continuation = (await setup.broker.respond(
    pendingReference,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(continuation)
  setup.state.activityFailureAt = setup.activities.length + 2

  await assert.rejects(
    () => setup.broker.followup(
      continuation.reference,
      "Delivered but not durably completed",
      { keepOpen: true },
    ),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "completed-record-failed")
      return true
    },
  )
  assert.equal(setup.followups.length, 1)
  assert.equal(setup.followupReads.length, 1)
  assert.deepEqual((await setup.broker.listContinuations()).continuations, [])
})

test("continuation expiry and shutdown discard tokens without editing completed responses", async () => {
  const expired = fixture()
  await expired.broker.start()
  await expired.broker.ingestInteraction(interaction())
  const expiredPending = (await expired.broker.listPending()).interactions[0]?.reference
  assert.ok(expiredPending)
  const expiredContinuation = (await expired.broker.respond(
    expiredPending,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(expiredContinuation)
  expired.advance(60_001)
  expired.scheduler.runAll()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual((await expired.broker.listContinuations()).continuations, [])
  assert.equal(expired.broker.getStatus().totals.continuationsExpired, 1)
  assert.equal(expired.activities.at(-1)?.status, "continuation-expired")

  const stopped = fixture()
  await stopped.broker.start()
  await stopped.broker.ingestInteraction(interaction())
  const stoppedPending = (await stopped.broker.listPending()).interactions[0]?.reference
  assert.ok(stoppedPending)
  const stoppedContinuation = (await stopped.broker.respond(
    stoppedPending,
    RESPONSE,
    { keepOpen: true },
  )).continuation
  assert.ok(stoppedContinuation)
  const editsBeforeStop = stopped.edits.length
  await stopped.broker.stop()
  assert.equal(stopped.edits.length, editsBeforeStop)
  assert.deepEqual((await stopped.broker.listContinuations()).continuations, [])
  assert.equal(stopped.broker.getStatus().totals.continuationsExpired, 1)
  assert.equal(JSON.stringify(stopped.activities).includes(TOKEN), false)
})

test("pending activity failure restores response availability without dispatch", async () => {
  const setup = fixture()
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const reference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(reference)
  setup.state.activityFailureAt = setup.activities.length + 1

  await assert.rejects(
    () => setup.broker.respond(reference, RESPONSE),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(setup.edits.length, 0)
  assert.equal((await setup.broker.listPending()).interactions.length, 1)
})

test("completion activity failure consumes the response reference", async () => {
  const setup = fixture()
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const reference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(reference)
  setup.state.activityFailureAt = setup.activities.length + 2

  await assert.rejects(
    () => setup.broker.respond(reference, RESPONSE),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-record-failed",
      )
      return true
    },
  )
  assert.equal(setup.edits.filter(({ content }) => content === RESPONSE).length, 1)
  assert.deepEqual((await setup.broker.listPending()).interactions, [])
  await assert.rejects(
    () => setup.broker.respond(reference, RESPONSE),
    /unavailable or expired/,
  )
})

test("response preparation rechecks expiry after pending activity", async () => {
  const setup = fixture()
  await setup.broker.start()
  await setup.broker.ingestInteraction(interaction())
  const reference = (await setup.broker.listPending()).interactions[0]?.reference
  assert.ok(reference)
  setup.state.activityAdvanceAt = setup.activities.length + 1
  setup.state.activityAdvanceMilliseconds = 60_001

  await assert.rejects(
    () => setup.broker.respond(reference, RESPONSE),
    /expired during response preparation/,
  )
  assert.equal(setup.edits.length, 1)
  assert.match(setup.edits[0]?.content || "", /expired before it could be completed/)
  assert.equal(setup.edits.some(({ content }) => content === RESPONSE), false)
  assert.deepEqual((await setup.broker.listPending()).interactions, [])
})

test("known response rejection settles while invalid response evidence is uncertain", async () => {
  const rejected = fixture({ state: { editError: apiError(400) } })
  await rejected.broker.start()
  rejected.state.editError = undefined
  await rejected.broker.ingestInteraction(interaction())
  const rejectedReference = (await rejected.broker.listPending()).interactions[0]?.reference
  assert.ok(rejectedReference)
  rejected.state.editError = apiError(400)
  await assert.rejects(
    () => rejected.broker.respond(rejectedReference, RESPONSE),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )
  assert.deepEqual((await rejected.broker.listPending()).interactions, [])

  const rateLimited = fixture()
  await rateLimited.broker.start()
  await rateLimited.broker.ingestInteraction(interaction())
  const rateLimitedReference = (
    await rateLimited.broker.listPending()
  ).interactions[0]?.reference
  assert.ok(rateLimitedReference)
  rateLimited.state.editError = apiError(429)
  await assert.rejects(
    () => rateLimited.broker.respond(rateLimitedReference, RESPONSE),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  const drift = fixture()
  await drift.broker.start()
  await drift.broker.ingestInteraction(interaction())
  const driftReference = (await drift.broker.listPending()).interactions[0]?.reference
  assert.ok(driftReference)
  drift.state.editResponse = responseMessage(RESPONSE, { application_id: "100000000000000002" })
  await assert.rejects(
    () => drift.broker.respond(driftReference, RESPONSE),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionResponseError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(drift.broker.getStatus().totals.uncertain, 1)
  assert.deepEqual((await drift.broker.listPending()).interactions, [])
})

test("expiry and shutdown remove requests, answer best-effort, and retain no content", async () => {
  const expired = fixture()
  await expired.broker.start()
  await expired.broker.ingestInteraction(interaction())
  expired.advance(60_001)
  expired.scheduler.runAll()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual((await expired.broker.listPending()).interactions, [])
  assert.equal(expired.broker.getStatus().totals.expired, 1)
  assert.equal(expired.activities.at(-1)?.status, "expired")

  const stopped = fixture()
  await stopped.broker.start()
  await stopped.broker.ingestInteraction(interaction())
  await stopped.broker.stop()
  assert.equal(stopped.broker.getStatus().phase, "stopped")
  assert.equal(stopped.broker.getStatus().totals.expired, 1)
  assert.deepEqual((await stopped.broker.listPending()).interactions, [])
  assert.equal(JSON.stringify(stopped.activities).includes(REQUEST), false)
  assert.equal(JSON.stringify(stopped.activities).includes(TOKEN), false)
})
