import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  DiscordApiError,
  NativeInteractionCommandExecutionError,
  NativeInteractionCommandPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import {
  NativeInteractionCommandService,
  exactNativeInteractionCommand,
  nativeInteractionCommandContract,
  type NativeInteractionCommandRequest,
  type NativeInteractionCommandServiceOptions,
} from "../src/native-interaction-command-service.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { ScopePolicy } from "../src/policy.js"
import type { DiscordApplicationCommand } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OTHER_GUILD_ID = "200000000000000002"
const BOT_ID = "300000000000000001"
const COMMAND_ID = "400000000000000001"
const OTHER_COMMAND_ID = "400000000000000002"
const VERSION_ID = "500000000000000001"
const OTHER_VERSION_ID = "500000000000000002"
const OPERATION_KEY = "native-command-operation-0001"
const NOW = "2026-08-22T00:00:00.000Z"
const COMMAND_NAME = "guildcontrol"

function command(overrides: Partial<DiscordApplicationCommand> = {}): DiscordApplicationCommand {
  const contract = nativeInteractionCommandContract(COMMAND_NAME)
  return {
    application_id: APPLICATION_ID,
    default_member_permissions: contract.defaultMemberPermissions,
    description: contract.description,
    guild_id: GUILD_ID,
    id: COMMAND_ID,
    name: contract.name,
    nsfw: contract.nsfw,
    options: [{
      description: contract.option.description,
      max_length: contract.option.maximumLength,
      min_length: contract.option.minimumLength,
      name: contract.option.name,
      required: contract.option.required,
      type: 3,
    }],
    type: 1,
    version: VERSION_ID,
    ...overrides,
  }
}

function otherCommand(overrides: Partial<DiscordApplicationCommand> = {}): DiscordApplicationCommand {
  return command({
    description: "Other command",
    id: OTHER_COMMAND_ID,
    name: "other-command",
    options: [],
    version: OTHER_VERSION_ID,
    ...overrides,
  })
}

function request(
  overrides: Partial<NativeInteractionCommandRequest> = {},
): NativeInteractionCommandRequest {
  return {
    action: "install",
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function policy(options: { enabled?: boolean; guildIds?: readonly string[] } = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowNativeCommandChanges: options.enabled ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    nativeInteractionGuildIds: new Set(options.guildIds || [GUILD_ID]),
    protectedUserIds: new Set(),
  })
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
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
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  createError: unknown
  createResponse: DiscordApplicationCommand
  deleteError: unknown
  inventory: DiscordApplicationCommand[]
  readbackError: unknown
  readbackExtra: DiscordApplicationCommand | null
}

function fixture(options: {
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    createError: undefined,
    createResponse: command(),
    deleteError: undefined,
    inventory: [otherCommand()],
    readbackError: undefined,
    readbackExtra: null,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let createCalls = 0
  let deleteCalls = 0
  let mutationAcknowledged = false
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
  const client: NativeInteractionCommandServiceOptions["client"] = {
    async createGuildApplicationCommand() {
      createCalls += 1
      events.push("write:create")
      if (state.createError) throw state.createError
      mutationAcknowledged = true
      state.inventory.push(state.createResponse)
      if (state.readbackExtra) state.inventory.push(state.readbackExtra)
      return state.createResponse
    },
    async deleteGuildApplicationCommand(_applicationId, _guildId, commandId) {
      deleteCalls += 1
      events.push("write:delete")
      if (state.deleteError) throw state.deleteError
      mutationAcknowledged = true
      state.inventory = state.inventory.filter(({ id }) => id !== commandId)
      if (state.readbackExtra) state.inventory.push(state.readbackExtra)
    },
    async getGuild() {
      events.push("read:guild")
      return { id: GUILD_ID, name: "Private Guild" }
    },
    async listGuildApplicationCommands() {
      events.push(mutationAcknowledged ? "read:readback" : "read:inventory")
      if (mutationAcknowledged && state.readbackError) throw state.readbackError
      return [...state.inventory]
    },
  }
  const service = new NativeInteractionCommandService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    commandName: COMMAND_NAME,
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: options.policy || policy(),
    randomId: () => "activity-native-command",
  })
  return {
    activities,
    createCalls: () => createCalls,
    deleteCalls: () => deleteCalls,
    events,
    operationStore,
    service,
    state,
  }
}

function apiError(status: number, method = "POST"): DiscordApiError {
  return new DiscordApiError({
    message: "Discord application-command request failed",
    method,
    route: `/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`,
    status,
  })
}

test("managed command contract is exact and guild-safe", () => {
  const contract = nativeInteractionCommandContract(COMMAND_NAME)
  assert.equal(contract.guildOnly, true)
  assert.equal(contract.defaultMemberPermissions, "0")
  assert.equal(contract.option.required, true)
  assert.equal(contract.option.minimumLength, 1)
  assert.equal(contract.option.maximumLength, 2_000)
  assert.ok(exactNativeInteractionCommand(command(), APPLICATION_ID, GUILD_ID, contract))
  assert.equal(
    exactNativeInteractionCommand(
      command({ default_member_permissions: null }),
      APPLICATION_ID,
      GUILD_ID,
      contract,
    ),
    undefined,
  )
  assert.equal(
    exactNativeInteractionCommand(
      command({ dm_permission: true }),
      APPLICATION_ID,
      GUILD_ID,
      contract,
    ),
    undefined,
  )
})

test("planning binds full inventory evidence and blocks same-name drift", async () => {
  const setup = fixture()
  assert.throws(
    () => setup.service.plan(
      APPLICATION_ID,
      BOT_ID,
      { ...request(), extra: true } as NativeInteractionCommandRequest,
    ),
    /request fields are invalid/,
  )
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(plan.mutation, "create")
  assert.equal(plan.status, "planned")
  assert.equal(plan.inventory.chatInputCount, 1)
  assert.equal(plan.inventory.chatInputLimit, 100)
  assert.equal(plan.command.id, null)
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  setup.state.inventory[0] = otherCommand({ version: "500000000000000003" })
  const changed = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ operationKey: "native-command-operation-0002" }),
  )
  assert.notEqual(changed.digest, plan.digest)

  setup.state.inventory = [command({ description: "Drifted contract" })]
  await assert.rejects(
    () => setup.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ operationKey: "native-command-operation-0003" }),
    ),
    /same-name Discord command exists/,
  )
})

test("policy requires explicit command-change authority and exact guild scope", async () => {
  await assert.rejects(
    () => fixture({ policy: policy({ enabled: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    PolicyError,
  )
  await assert.rejects(
    () => fixture({ policy: policy({ guildIds: [OTHER_GUILD_ID] }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      request(),
    ),
    PolicyError,
  )
})

test("already-installed and already-absent plans execute without records or writes", async () => {
  const installed = fixture({ state: { inventory: [command()] } })
  const installPlan = await installed.service.plan(APPLICATION_ID, BOT_ID, request())
  const installResult = await installed.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    installPlan.digest,
  )
  assert.equal(installResult.status, "already-installed")
  assert.equal(installResult.activityId, null)
  assert.equal(installed.createCalls(), 0)
  assert.deepEqual(installed.activities, [])

  const absent = fixture({ state: { inventory: [otherCommand()] } })
  const removeRequest = request({ action: "remove" })
  const removePlan = await absent.service.plan(APPLICATION_ID, BOT_ID, removeRequest)
  const removeResult = await absent.service.execute(
    APPLICATION_ID,
    BOT_ID,
    removeRequest,
    removePlan.digest,
  )
  assert.equal(removeResult.status, "already-absent")
  assert.equal(absent.deleteCalls(), 0)
  assert.deepEqual(absent.activities, [])
})

test("installation journals before one write and verifies the exact full transition", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  setup.events.length = 0
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.commandId, COMMAND_ID)
  assert.equal(result.readbackMatched, true)
  assert.equal(setup.createCalls(), 1)
  assert.ok(setup.events.indexOf("activity:pending") < setup.events.indexOf("write:create"))
  assert.deepEqual(setup.activities.map(({ status }) => status), ["pending", "completed"])
  const completion = setup.activities.at(-1)
  assert.equal(
    completion?.kind === "native-interaction-command-change"
      ? completion.commandId
      : null,
    COMMAND_ID,
  )
  const receipt = [...setup.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.resourceId, COMMAND_ID)
  assert.equal(receipt?.verification, "match")
})

test("removal deletes only the freshly reviewed exact command", async () => {
  const setup = fixture({ state: { inventory: [otherCommand(), command()] } })
  const removeRequest = request({ action: "remove" })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, removeRequest)
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    removeRequest,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.commandId, COMMAND_ID)
  assert.equal(setup.deleteCalls(), 1)
  assert.deepEqual(setup.state.inventory.map(({ id }) => id), [OTHER_COMMAND_ID])
})

test("stale plans and pending-audit failures block mutation", async () => {
  const stale = fixture()
  const stalePlan = await stale.service.plan(APPLICATION_ID, BOT_ID, request())
  stale.state.inventory[0] = otherCommand({ version: "500000000000000003" })
  await assert.rejects(
    () => stale.service.execute(APPLICATION_ID, BOT_ID, request(), stalePlan.digest),
    NativeInteractionCommandPlanChangedError,
  )
  assert.equal(stale.createCalls(), 0)

  const blocked = fixture({ state: { activityFailureAt: 1 } })
  const blockedPlan = await blocked.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    () => blocked.service.execute(APPLICATION_ID, BOT_ID, request(), blockedPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(blocked.createCalls(), 0)
})

test("known mutation rejection settles while acknowledged or ambiguous outcomes quarantine", async () => {
  const rejected = fixture({ state: { createError: apiError(400) } })
  const rejectedPlan = await rejected.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    () => rejected.service.execute(APPLICATION_ID, BOT_ID, request(), rejectedPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )

  const rateLimited = fixture({ state: { createError: apiError(429) } })
  const rateLimitedRequest = request({
    operationKey: "native-command-operation-rate-limited",
  })
  const rateLimitedPlan = await rateLimited.service.plan(
    APPLICATION_ID,
    BOT_ID,
    rateLimitedRequest,
  )
  await assert.rejects(
    () => rateLimited.service.execute(
      APPLICATION_ID,
      BOT_ID,
      rateLimitedRequest,
      rateLimitedPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  const ambiguous = fixture({ state: { createError: apiError(500) } })
  const ambiguousPlan = await ambiguous.service.plan(APPLICATION_ID, BOT_ID, request({
    operationKey: "native-command-operation-0002",
  }))
  await assert.rejects(
    () => ambiguous.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request({ operationKey: "native-command-operation-0002" }),
      ambiguousPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  ambiguous.state.createError = undefined
  const blockedRequest = request({
    operationKey: "native-command-operation-0004",
  })
  const blockedPlan = await ambiguous.service.plan(
    APPLICATION_ID,
    BOT_ID,
    blockedRequest,
  )
  await assert.rejects(
    () => ambiguous.service.execute(
      APPLICATION_ID,
      BOT_ID,
      blockedRequest,
      blockedPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
  assert.equal(ambiguous.createCalls(), 1)

  const acknowledged = fixture({ state: { readbackError: apiError(404, "GET") } })
  const acknowledgedPlan = await acknowledged.service.plan(APPLICATION_ID, BOT_ID, request({
    operationKey: "native-command-operation-0003",
  }))
  await assert.rejects(
    () => acknowledged.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request({ operationKey: "native-command-operation-0003" }),
      acknowledgedPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
})

test("unexpected concurrent inventory changes become uncertain after mutation", async () => {
  const extra = otherCommand({
    id: "400000000000000003",
    name: "concurrent-command",
    version: "500000000000000003",
  })
  const setup = fixture({ state: { readbackExtra: extra } })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    () => setup.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(setup.createCalls(), 1)
})

test("completion-record failure keeps the managed-command guild quarantined", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  setup.operationStore.finishFailure = new Error("operation store unavailable")

  await assert.rejects(
    () => setup.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "completed-record-failed",
      )
      return true
    },
  )
  const laterRequest = request({
    operationKey: "native-command-operation-after-record-failure",
  })
  const laterPlan = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    laterRequest,
  )
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      laterRequest,
      laterPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof NativeInteractionCommandExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
  assert.equal(setup.createCalls(), 1)
})
