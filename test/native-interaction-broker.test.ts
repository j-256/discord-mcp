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
  applicationEndpoint: string | null
  botId: string
  channelError: unknown
  commandInventory: DiscordApplicationCommand[]
  deferError: unknown
  deferGate: Promise<void> | null
  editError: unknown
  editResponse: DiscordMessage | null
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
    applicationEndpoint: null,
    botId: BOT_ID,
    channelError: undefined,
    commandInventory: [command()],
    deferError: undefined,
    deferGate: null,
    editError: undefined,
    editResponse: null,
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
  let activityCalls = 0
  let referenceNumber = 0
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) {
        throw new Error("activity unavailable")
      }
      activities.push(entry)
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
    async editOriginalInteractionResponse(_applicationId, token, content) {
      events.push("response:edit")
      edits.push({ content, token })
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
  assert.deepEqual((await source.listPending()).interactions, [])
  await assert.rejects(
    () => source.respond(`iref_${"0".repeat(32)}`, "response"),
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
  assert.equal(result.responseMessageId, MESSAGE_ID)
  assert.equal(JSON.stringify(result).includes(TOKEN), false)
  assert.deepEqual((await setup.broker.listPending()).interactions, [])
  assert.equal(setup.edits.length, 1)
  assert.ok(setup.events.indexOf("activity:response-pending") < setup.events.indexOf("response:edit"))
  assert.deepEqual(
    setup.activities.slice(-2).map(({ status }) => status),
    ["response-pending", "response-completed"],
  )
  await assert.rejects(() => setup.broker.respond(reference, RESPONSE), /unavailable or expired/)
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
