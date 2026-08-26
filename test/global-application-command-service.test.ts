import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import { DISCORD_APPLICATION_FLAGS } from "../src/constants.js"
import {
  DiscordApiError,
  GlobalApplicationCommandEvidenceError,
  GlobalApplicationCommandExecutionError,
  GlobalApplicationCommandPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import {
  globalApplicationCommandApiBody,
  type GlobalApplicationCommandDefinition,
} from "../src/global-application-command-definition.js"
import {
  type GlobalApplicationCommandChangeRequest,
  GlobalApplicationCommandService,
  type GlobalApplicationCommandServiceOptions,
  normalizeGlobalApplicationCommandChangeRequest,
} from "../src/global-application-command-service.js"
import type {
  ApplicationOperationKind,
  ApplicationOperationReceipt,
  ApplicationOperationReservation,
  ApplicationOperationStore,
  GuildOperationKind,
  OperationReceipt,
  OperationReservation,
} from "../src/operation-store.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordApplication,
  DiscordApplicationCommand,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const COMMAND_ID = "300000000000000001"
const OTHER_COMMAND_ID = "300000000000000002"
const CREATED_COMMAND_ID = "300000000000000003"
const VERSION_ID = "400000000000000001"
const OTHER_VERSION_ID = "400000000000000002"
const NEXT_VERSION_ID = "400000000000000003"
const NOW = "2026-08-26T00:00:00.000Z"
const OPERATION_KEY = "global-command-operation-0001"

function chatDefinition(
  overrides: Partial<Extract<GlobalApplicationCommandDefinition, { type: "chat-input" }>> = {},
): Extract<GlobalApplicationCommandDefinition, { type: "chat-input" }> {
  return {
    contexts: ["guild", "bot-dm"],
    defaultMemberPermissions: ["MANAGE_GUILD"],
    description: "Deploy one reviewed release",
    descriptionLocalizations: [{ locale: "de", value: "Eine geprufte Version bereitstellen" }],
    integrationTypes: ["guild-install"],
    name: "deploy",
    nameLocalizations: [{ locale: "de", value: "bereitstellen" }],
    nsfw: false,
    options: [],
    type: "chat-input",
    ...overrides,
  }
}

function userDefinition(
  overrides: Partial<Extract<GlobalApplicationCommandDefinition, { type: "user" }>> = {},
): Extract<GlobalApplicationCommandDefinition, { type: "user" }> {
  return {
    contexts: ["guild"],
    defaultMemberPermissions: null,
    integrationTypes: ["guild-install"],
    name: "Inspect user",
    nameLocalizations: [],
    nsfw: false,
    type: "user",
    ...overrides,
  }
}

function primaryDefinition(): Extract<
  GlobalApplicationCommandDefinition,
  { type: "primary-entry-point" }
> {
  return {
    contexts: ["guild"],
    defaultMemberPermissions: null,
    description: "Launch the Activity",
    descriptionLocalizations: [],
    handler: "discord-launch-activity",
    integrationTypes: ["guild-install"],
    name: "launch",
    nameLocalizations: [],
    nsfw: false,
    type: "primary-entry-point",
  }
}

function command(
  definition: GlobalApplicationCommandDefinition,
  options: { id?: string; version?: string } = {},
): DiscordApplicationCommand {
  const body = globalApplicationCommandApiBody(definition)
  return {
    ...body,
    application_id: APPLICATION_ID,
    description: body.description ?? "",
    id: options.id ?? COMMAND_ID,
    options: body.options ?? [],
    version: options.version ?? VERSION_ID,
  }
}

function application(overrides: Partial<DiscordApplication> = {}): DiscordApplication {
  return {
    bot: {
      bot: true,
      discriminator: "0000",
      id: BOT_ID,
      username: "connector",
    },
    bot_public: false,
    bot_require_code_grant: false,
    description: "private application description",
    flags_new: "0",
    id: APPLICATION_ID,
    integration_types_config: {
      "0": {},
      "1": {},
    },
    name: "private application name",
    ...overrides,
  }
}

function createRequest(
  overrides: Partial<GlobalApplicationCommandChangeRequest> = {},
): GlobalApplicationCommandChangeRequest {
  return {
    acknowledgeGlobalExposure: true,
    action: "create",
    definition: chatDefinition(),
    operationKey: OPERATION_KEY,
    ...overrides,
  } as GlobalApplicationCommandChangeRequest
}

function updateRequest(
  definition: GlobalApplicationCommandDefinition = chatDefinition({
    description: "Deploy one fully reviewed release",
  }),
  overrides: Partial<GlobalApplicationCommandChangeRequest> = {},
): GlobalApplicationCommandChangeRequest {
  return {
    acknowledgeGlobalExposure: true,
    action: "update",
    commandId: COMMAND_ID,
    definition,
    operationKey: OPERATION_KEY,
    ...overrides,
  } as GlobalApplicationCommandChangeRequest
}

function deleteRequest(
  overrides: Partial<GlobalApplicationCommandChangeRequest> = {},
): GlobalApplicationCommandChangeRequest {
  return {
    acknowledgeGlobalDeletion: true,
    acknowledgePermissionResetAcrossGuilds: true,
    action: "delete",
    commandId: COMMAND_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  } as GlobalApplicationCommandChangeRequest
}

function policy(enabled = true): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set(),
    allowAdministration: false,
    allowDeletions: false,
    allowGlobalApplicationCommandChanges: enabled,
    allowInteractions: false,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    protectedUserIds: new Set(),
  })
}

class MemoryApplicationOperationStore implements ApplicationOperationStore {
  readonly events: string[]
  readonly receipts = new Map<string, ApplicationOperationReceipt>()
  finishFailure: unknown

  constructor(events: string[]) {
    this.events = events
  }

  #key(kind: ApplicationOperationKind, hash: string): string {
    return `${kind}\0${hash}`
  }

  async finish(_receipt: OperationReceipt): Promise<void> {
    throw new Error("Unexpected guild operation receipt")
  }

  async get(
    _kind: GuildOperationKind,
    _hash: string,
  ): Promise<OperationReceipt | undefined> {
    throw new Error("Unexpected guild operation receipt")
  }

  async reserve(_receipt: OperationReceipt): Promise<OperationReservation> {
    throw new Error("Unexpected guild operation receipt")
  }

  async finishApplication(receipt: ApplicationOperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), receipt)
  }

  async getApplication(kind: ApplicationOperationKind, hash: string) {
    return this.receipts.get(this.#key(kind, hash))
  }

  async reserveApplication(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation> {
    this.events.push("operation:reserve")
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  afterMutation: (() => void) | null
  createError: unknown
  createResponse: DiscordApplicationCommand | null
  deleteError: unknown
  editError: unknown
  editResponse: DiscordApplicationCommand | null
  inventory: DiscordApplicationCommand[]
  readbackError: unknown
}

function fixture(options: {
  enabled?: boolean
  state?: Partial<FixtureState>
} = {}) {
  const other = command(userDefinition(), {
    id: OTHER_COMMAND_ID,
    version: OTHER_VERSION_ID,
  })
  const state: FixtureState = {
    activityFailureAt: null,
    afterMutation: null,
    createError: undefined,
    createResponse: null,
    deleteError: undefined,
    editError: undefined,
    editResponse: null,
    inventory: [other],
    readbackError: undefined,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  let activityCalls = 0
  let createCalls = 0
  let deleteCalls = 0
  let editCalls = 0
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
  const operationStore = new MemoryApplicationOperationStore(events)
  const client: GlobalApplicationCommandServiceOptions["client"] = {
    async createGlobalApplicationCommand(_applicationId, definition) {
      createCalls += 1
      events.push("write:create")
      if (state.createError) throw state.createError
      const created = state.createResponse ?? command(definition, {
        id: CREATED_COMMAND_ID,
        version: NEXT_VERSION_ID,
      })
      state.inventory.push(created)
      mutationAcknowledged = true
      state.afterMutation?.()
      return created
    },
    async deleteGlobalApplicationCommand(_applicationId, commandId) {
      deleteCalls += 1
      events.push("write:delete")
      if (state.deleteError) throw state.deleteError
      state.inventory = state.inventory.filter(({ id }) => id !== commandId)
      mutationAcknowledged = true
      state.afterMutation?.()
    },
    async editGlobalApplicationCommand(_applicationId, commandId, definition) {
      editCalls += 1
      events.push("write:update")
      if (state.editError) throw state.editError
      const edited = state.editResponse ?? command(definition, {
        id: commandId,
        version: NEXT_VERSION_ID,
      })
      state.inventory = state.inventory.map((entry) => (
        entry.id === commandId ? edited : entry
      ))
      mutationAcknowledged = true
      state.afterMutation?.()
      return edited
    },
    async listGlobalApplicationCommandsWithLocalizations() {
      events.push(mutationAcknowledged ? "read:readback" : "read:inventory")
      if (mutationAcknowledged && state.readbackError) throw state.readbackError
      return structuredClone(state.inventory)
    },
  }
  const service = new GlobalApplicationCommandService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(7),
    policy: policy(options.enabled ?? true),
    randomId: () => "activity-global-command",
  })
  return {
    activities,
    createCalls: () => createCalls,
    deleteCalls: () => deleteCalls,
    editCalls: () => editCalls,
    events,
    operationStore,
    service,
    state,
  }
}

function apiError(status: number, method = "POST"): DiscordApiError {
  return new DiscordApiError({
    message: "Discord global application-command request failed",
    method,
    route: `/applications/${APPLICATION_ID}/commands`,
    status,
  })
}

test("global change requests are exact, acknowledged, and operation-key-safe after normalization", () => {
  const normalized = normalizeGlobalApplicationCommandChangeRequest(createRequest())
  assert.equal(normalized.action, "create")
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(normalized).includes(OPERATION_KEY), false)

  assert.throws(
    () => normalizeGlobalApplicationCommandChangeRequest({
      ...createRequest(),
      extra: true,
    } as unknown as GlobalApplicationCommandChangeRequest),
    /requires acknowledgeGlobalExposure=true/,
  )
  assert.throws(
    () => normalizeGlobalApplicationCommandChangeRequest({
      ...createRequest(),
      acknowledgeGlobalExposure: false,
    } as unknown as GlobalApplicationCommandChangeRequest),
    /acknowledgeGlobalExposure=true/,
  )
  assert.throws(
    () => normalizeGlobalApplicationCommandChangeRequest({
      ...deleteRequest(),
      acknowledgePermissionResetAcrossGuilds: false,
    } as unknown as GlobalApplicationCommandChangeRequest),
    /cross-guild permission-reset acknowledgements/,
  )
})

test("planning binds application support, complete inventory, capacities, and privacy", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(application(), BOT_ID, createRequest())
  assert.equal(plan.status, "planned")
  assert.equal(plan.effect, "change")
  assert.equal(plan.commandType, "chat-input")
  assert.deepEqual(plan.application.installationTypes, ["guild-install", "user-install"])
  assert.equal(plan.application.embedded, false)
  assert.equal(plan.inventory.counts.user, 1)
  assert.equal(plan.inventory.limits["primary-entry-point"], 1)
  assert.equal(plan.privacy.definitionsPersisted, false)
  assert.equal(plan.privacy.permissionTargetsEnumerated, false)
  assert.equal(
    plan.verification.commandInventory,
    "exact-full-localization-api-readback",
  )
  assert.equal(plan.verification.clientPropagation, "discord-read-repair")
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)
})

test("policy, installation support, collisions, and immutable command type fail closed", async () => {
  await assert.rejects(
    () => fixture({ enabled: false }).service.plan(
      application(),
      BOT_ID,
      createRequest(),
    ),
    PolicyError,
  )
  await assert.rejects(
    () => {
      const incomplete = application()
      delete incomplete.integration_types_config
      return fixture().service.plan(incomplete, BOT_ID, createRequest())
    },
    GlobalApplicationCommandEvidenceError,
  )
  await assert.rejects(
    () => fixture().service.plan(
      application({ integration_types_config: { "0": {} } }),
      BOT_ID,
      createRequest({
        definition: chatDefinition({
          contexts: ["private-channel"],
          integrationTypes: ["user-install"],
        }),
      }),
    ),
    /unsupported installation type/,
  )

  const existing = command(chatDefinition())
  await assert.rejects(
    () => fixture({ state: { inventory: [existing] } }).service.plan(
      application(),
      BOT_ID,
      createRequest(),
    ),
    /collides with an exact name and type pair/,
  )
  await assert.rejects(
    () => fixture({ state: { inventory: [existing] } }).service.plan(
      application(),
      BOT_ID,
      updateRequest(userDefinition()),
    ),
    /cannot change command type/,
  )
})

test("Primary Entry Point changes require fresh EMBEDDED application evidence", async () => {
  await assert.rejects(
    () => fixture().service.plan(
      application(),
      BOT_ID,
      createRequest({ definition: primaryDefinition() }),
    ),
    /require fresh EMBEDDED/,
  )
  const embedded = DISCORD_APPLICATION_FLAGS.embedded.toString()
  const plan = await fixture().service.plan(
    application({ flags_new: embedded }),
    BOT_ID,
    createRequest({ definition: primaryDefinition() }),
  )
  assert.equal(plan.application.embedded, true)
  assert.equal(plan.commandType, "primary-entry-point")
})

test("renames require explicit cross-guild permission-reset acknowledgement", async () => {
  const setup = fixture({ state: { inventory: [command(chatDefinition())] } })
  const renamed = chatDefinition({
    name: "release",
    nameLocalizations: [],
  })
  await assert.rejects(
    () => setup.service.plan(application(), BOT_ID, updateRequest(renamed)),
    /acknowledgePermissionResetAcrossGuilds=true/,
  )
  const plan = await setup.service.plan(
    application(),
    BOT_ID,
    updateRequest(renamed, { acknowledgePermissionResetAcrossGuilds: true }),
  )
  assert.equal(plan.permissionEffect, "all-guild-overwrites-cleared-by-discord")
  assert.ok(plan.risks.some((risk) => risk.includes("every guild")))
})

test("already-current update and already-absent deletion perform no writes or records", async () => {
  const current = fixture({ state: { inventory: [command(chatDefinition())] } })
  const currentRequest = updateRequest(chatDefinition())
  const currentPlan = await current.service.plan(application(), BOT_ID, currentRequest)
  const currentResult = await current.service.execute(
    application(),
    BOT_ID,
    currentRequest,
    currentPlan.digest,
  )
  assert.equal(currentResult.status, "already-current")
  assert.equal(currentResult.activityId, null)
  assert.equal(current.editCalls(), 0)
  assert.deepEqual(current.activities, [])

  const absent = fixture()
  const absentPlan = await absent.service.plan(application(), BOT_ID, deleteRequest())
  const absentResult = await absent.service.execute(
    application(),
    BOT_ID,
    deleteRequest(),
    absentPlan.digest,
  )
  assert.equal(absentPlan.commandType, null)
  assert.equal(absentResult.status, "already-absent")
  assert.equal(absent.deleteCalls(), 0)
  assert.deepEqual(absent.activities, [])
})

test("creation journals first and verifies the exact global transition", async () => {
  const setup = fixture()
  const request = createRequest()
  const plan = await setup.service.plan(application(), BOT_ID, request)
  setup.events.length = 0
  const result = await setup.service.execute(
    application(),
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.commandId, CREATED_COMMAND_ID)
  assert.equal(result.observed?.definition.name, "deploy")
  assert.equal(setup.createCalls(), 1)
  assert.ok(setup.events.indexOf("activity:pending") < setup.events.indexOf("write:create"))
  assert.deepEqual(setup.activities.map(({ status }) => status), ["pending", "completed"])
  assert.equal(JSON.stringify(setup.activities).includes("deploy"), false)
  assert.equal(JSON.stringify(setup.activities).includes("bereitstellen"), false)
  const receipt = [...setup.operationStore.receipts.values()][0]
  assert.equal(receipt?.kind, "global-application-command-change")
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.resourceId, CREATED_COMMAND_ID)
  assert.equal(receipt?.verification, "match")
})

test("complete update and exact deletion preserve unrelated global commands", async () => {
  const survivor = command(userDefinition(), {
    id: OTHER_COMMAND_ID,
    version: OTHER_VERSION_ID,
  })
  const update = fixture({
    state: { inventory: [command(chatDefinition()), survivor] },
  })
  const updateChange = updateRequest()
  const updatePlan = await update.service.plan(application(), BOT_ID, updateChange)
  const updateResult = await update.service.execute(
    application(),
    BOT_ID,
    updateChange,
    updatePlan.digest,
  )
  assert.equal(updateResult.status, "completed")
  assert.equal(updateResult.observed?.definition.name, "deploy")
  assert.equal(update.editCalls(), 1)
  assert.equal(update.state.inventory.find(({ id }) => id === OTHER_COMMAND_ID)?.name, "Inspect user")

  const deletion = fixture({
    state: { inventory: [command(chatDefinition()), survivor] },
  })
  const deletionPlan = await deletion.service.plan(
    application(),
    BOT_ID,
    deleteRequest(),
  )
  assert.equal(
    deletionPlan.permissionEffect,
    "all-guild-overwrites-cleared-by-discord",
  )
  const deletionResult = await deletion.service.execute(
    application(),
    BOT_ID,
    deleteRequest(),
    deletionPlan.digest,
  )
  assert.equal(deletionResult.status, "completed")
  assert.equal(deletionResult.observed, null)
  assert.equal(deletion.deleteCalls(), 1)
  assert.deepEqual(deletion.state.inventory.map(({ id }) => id), [OTHER_COMMAND_ID])
})

test("fresh application or inventory drift invalidates the reviewed plan before mutation", async () => {
  const setup = fixture()
  const request = createRequest()
  const plan = await setup.service.plan(application(), BOT_ID, request)
  setup.state.inventory.push(command(chatDefinition({ name: "other" }), {
    id: COMMAND_ID,
  }))
  await assert.rejects(
    () => setup.service.execute(application(), BOT_ID, request, plan.digest),
    GlobalApplicationCommandPlanChangedError,
  )
  assert.equal(setup.createCalls(), 0)

  const capability = fixture()
  const capabilityPlan = await capability.service.plan(application(), BOT_ID, request)
  await assert.rejects(
    () => capability.service.execute(
      application({ integration_types_config: { "0": {} } }),
      BOT_ID,
      request,
      capabilityPlan.digest,
    ),
    GlobalApplicationCommandPlanChangedError,
  )
  assert.equal(capability.createCalls(), 0)
})

test("pending audit failure blocks the write and closes the reservation as failed", async () => {
  const setup = fixture({ state: { activityFailureAt: 1 } })
  const request = createRequest()
  const plan = await setup.service.plan(application(), BOT_ID, request)
  await assert.rejects(
    () => setup.service.execute(application(), BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof GlobalApplicationCommandExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(setup.createCalls(), 0)
  const receipt = [...setup.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "failed")
})

test("application operation keys are one-shot before any write", async () => {
  const setup = fixture()
  const request = createRequest()
  const plan = await setup.service.plan(application(), BOT_ID, request)
  await setup.operationStore.reserveApplication({
    activityId: "prior-global-command",
    applicationId: APPLICATION_ID,
    error: null,
    kind: "global-application-command-change",
    operationKeyHash: plan.operationKeyHash,
    planDigest: plan.digest,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: NOW,
    verification: null,
  })
  await assert.rejects(
    () => setup.service.execute(application(), BOT_ID, request, plan.digest),
    /operation key has already been reserved/,
  )
  assert.equal(setup.createCalls(), 0)
})

test("deterministic Discord rejection is failed without retry authority", async () => {
  const setup = fixture({ state: { createError: apiError(400) } })
  const request = createRequest()
  const plan = await setup.service.plan(application(), BOT_ID, request)
  await assert.rejects(
    () => setup.service.execute(application(), BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof GlobalApplicationCommandExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(setup.createCalls(), 1)
  const receipt = [...setup.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "failed")
})

test("uncertain readback quarantines the application-wide command collection", async () => {
  const setup = fixture({ state: { readbackError: new Error("private response") } })
  const request = createRequest()
  const plan = await setup.service.plan(application(), BOT_ID, request)
  await assert.rejects(
    () => setup.service.execute(application(), BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof GlobalApplicationCommandExecutionError
      && (error.result as { status?: string }).status === "uncertain"
      && !JSON.stringify(error.result).includes("private response")
    ),
  )
  assert.equal(setup.createCalls(), 1)
  const receipt = [...setup.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "uncertain")

  const blocked = fixture()
  const blockedRequest = createRequest({
    operationKey: "global-command-operation-0002",
  })
  const blockedPlan = await blocked.service.plan(
    application(),
    BOT_ID,
    blockedRequest,
  )
  await assert.rejects(
    () => blocked.service.execute(
      application(),
      BOT_ID,
      blockedRequest,
      blockedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof GlobalApplicationCommandExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.equal(blocked.createCalls(), 0)
})
