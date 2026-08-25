import assert from "node:assert/strict"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import type {
  DiscordGuildApplicationCommandPermissions,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  GuildApplicationCommandEvidenceError,
  GuildApplicationCommandExecutionError,
  GuildApplicationCommandPlanChangedError,
  PolicyError,
} from "../src/errors.js"
import {
  guildApplicationCommandApiBody,
  type GuildApplicationCommandDefinition,
} from "../src/guild-application-command-definition.js"
import {
  type GuildApplicationCommandChangeRequest,
  GuildApplicationCommandService,
  type GuildApplicationCommandServiceOptions,
  normalizeGuildApplicationCommandChangeRequest,
} from "../src/guild-application-command-service.js"
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
const CREATED_COMMAND_ID = "400000000000000003"
const VERSION_ID = "500000000000000001"
const OTHER_VERSION_ID = "500000000000000002"
const NEXT_VERSION_ID = "500000000000000003"
const ROLE_ID = "600000000000000001"
const USER_ID = "700000000000000001"
const NOW = "2026-08-25T00:00:00.000Z"
const OPERATION_KEY = "guild-command-operation-0001"

function chatDefinition(
  overrides: Partial<Extract<GuildApplicationCommandDefinition, { type: "chat-input" }>> = {},
): Extract<GuildApplicationCommandDefinition, { type: "chat-input" }> {
  return {
    defaultMemberPermissions: ["MANAGE_GUILD"],
    description: "Deploy one reviewed release",
    descriptionLocalizations: [{ locale: "de", value: "Eine geprufte Version bereitstellen" }],
    name: "deploy",
    nameLocalizations: [{ locale: "de", value: "bereitstellen" }],
    nsfw: false,
    options: [{
      autocomplete: false,
      choices: [],
      description: "Exact release target",
      descriptionLocalizations: [],
      maxLength: 32,
      minLength: 1,
      name: "target",
      nameLocalizations: [],
      required: true,
      type: "string",
    }],
    type: "chat-input",
    ...overrides,
  }
}

interface UserDefinition {
  defaultMemberPermissions: null
  name: string
  nameLocalizations: []
  nsfw: boolean
  type: "user"
}

function userDefinition(
  overrides: Partial<UserDefinition> = {},
): UserDefinition {
  return {
    defaultMemberPermissions: null,
    name: "Inspect user",
    nameLocalizations: [],
    nsfw: false,
    type: "user",
    ...overrides,
  }
}

function command(
  definition: GuildApplicationCommandDefinition,
  options: {
    id?: string
    version?: string
  } = {},
): DiscordApplicationCommand {
  const body = guildApplicationCommandApiBody(definition)
  return {
    ...body,
    application_id: APPLICATION_ID,
    contexts: [0],
    description: body.description ?? "",
    dm_permission: false,
    guild_id: GUILD_ID,
    id: options.id ?? COMMAND_ID,
    integration_types: [0],
    options: body.options ?? [],
    version: options.version ?? VERSION_ID,
  }
}

function permissionEntry(
  commandId: string,
  overwrites: DiscordGuildApplicationCommandPermissions["permissions"] = [{
    allowed: true,
    id: ROLE_ID,
    type: 1,
    unknownFieldCount: 0,
  }],
): DiscordGuildApplicationCommandPermissions {
  return {
    applicationId: APPLICATION_ID,
    commandId,
    guildId: GUILD_ID,
    permissions: overwrites,
    unknownFieldCount: 0,
  }
}

function createRequest(
  overrides: Partial<GuildApplicationCommandChangeRequest> = {},
): GuildApplicationCommandChangeRequest {
  return {
    action: "create",
    definition: chatDefinition(),
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  } as GuildApplicationCommandChangeRequest
}

function updateRequest(
  definition: GuildApplicationCommandDefinition = chatDefinition({
    description: "Deploy one fully reviewed release",
  }),
  overrides: Partial<GuildApplicationCommandChangeRequest> = {},
): GuildApplicationCommandChangeRequest {
  return {
    action: "update",
    commandId: COMMAND_ID,
    definition,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  } as GuildApplicationCommandChangeRequest
}

function deleteRequest(
  overrides: Partial<GuildApplicationCommandChangeRequest> = {},
): GuildApplicationCommandChangeRequest {
  return {
    acknowledgeDeletion: true,
    action: "delete",
    commandId: COMMAND_ID,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  } as GuildApplicationCommandChangeRequest
}

function policy(options: {
  enabled?: boolean
  guildIds?: readonly string[]
} = {}): ScopePolicy {
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowApplicationCommandChanges: options.enabled ?? true,
    allowDeletions: false,
    allowInteractions: false,
    applicationCommandGuildIds: new Set(options.guildIds ?? [GUILD_ID]),
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
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
  afterMutation: (() => void) | null
  createError: unknown
  createResponse: DiscordApplicationCommand | null
  deleteError: unknown
  editError: unknown
  editResponse: DiscordApplicationCommand | null
  guildId: string
  inventory: DiscordApplicationCommand[]
  memberBot: boolean
  permissions: DiscordGuildApplicationCommandPermissions[]
  readbackError: unknown
  retainPermissionsOnRename: boolean
}

function fixture(options: {
  policy?: ScopePolicy
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
    guildId: GUILD_ID,
    inventory: [other],
    memberBot: true,
    permissions: [permissionEntry(OTHER_COMMAND_ID, [])],
    readbackError: undefined,
    retainPermissionsOnRename: false,
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
  const operationStore = new MemoryOperationStore(events)
  const client: GuildApplicationCommandServiceOptions["client"] = {
    async createGuildApplicationCommand(_applicationId, _guildId, definition) {
      createCalls += 1
      events.push("write:create")
      if (state.createError) throw state.createError
      const created = state.createResponse ?? command(definition, {
        id: CREATED_COMMAND_ID,
        version: NEXT_VERSION_ID,
      })
      state.inventory.push(created)
      state.permissions.push(permissionEntry(created.id, []))
      mutationAcknowledged = true
      state.afterMutation?.()
      return created
    },
    async deleteGuildApplicationCommand(_applicationId, _guildId, commandId) {
      deleteCalls += 1
      events.push("write:delete")
      if (state.deleteError) throw state.deleteError
      state.inventory = state.inventory.filter(({ id }) => id !== commandId)
      state.permissions = state.permissions.filter((entry) => entry.commandId !== commandId)
      mutationAcknowledged = true
      state.afterMutation?.()
    },
    async editGuildApplicationCommand(_applicationId, _guildId, commandId, definition) {
      editCalls += 1
      events.push("write:update")
      if (state.editError) throw state.editError
      const before = state.inventory.find(({ id }) => id === commandId)
      const edited = state.editResponse ?? command(definition, {
        id: commandId,
        version: NEXT_VERSION_ID,
      })
      state.inventory = state.inventory.map((entry) => (
        entry.id === commandId ? edited : entry
      ))
      if (before?.name !== edited.name && !state.retainPermissionsOnRename) {
        state.permissions = state.permissions.filter((entry) => entry.commandId !== commandId)
      }
      mutationAcknowledged = true
      state.afterMutation?.()
      return edited
    },
    async getGuild() {
      events.push("read:guild")
      return { id: state.guildId, name: "Private Guild" }
    },
    async getGuildMember() {
      events.push("read:member")
      return {
        roles: [ROLE_ID],
        user: {
          bot: state.memberBot,
          id: BOT_ID,
          username: "connector",
        },
      }
    },
    async listGuildApplicationCommandPermissions() {
      events.push(mutationAcknowledged ? "read:permission-readback" : "read:permissions")
      if (mutationAcknowledged && state.readbackError) throw state.readbackError
      return structuredClone(state.permissions)
    },
    async listGuildApplicationCommandsWithLocalizations() {
      events.push(mutationAcknowledged ? "read:command-readback" : "read:inventory")
      if (mutationAcknowledged && state.readbackError) throw state.readbackError
      return structuredClone(state.inventory)
    },
  }
  const service = new GuildApplicationCommandService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(9),
    policy: options.policy ?? policy(),
    randomId: () => "activity-guild-command",
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
    message: "Discord application-command request failed",
    method,
    route: `/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`,
    status,
  })
}

test("change requests are exact, canonical, and deletion-acknowledged", () => {
  const normalized = normalizeGuildApplicationCommandChangeRequest(createRequest())
  assert.equal(normalized.action, "create")
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(normalized).includes(OPERATION_KEY), false)

  assert.throws(
    () => normalizeGuildApplicationCommandChangeRequest({
      ...createRequest(),
      extra: true,
    } as unknown as GuildApplicationCommandChangeRequest),
    /create request is invalid/,
  )
  assert.throws(
    () => normalizeGuildApplicationCommandChangeRequest({
      ...deleteRequest(),
      acknowledgeDeletion: false,
    } as unknown as GuildApplicationCommandChangeRequest),
    /acknowledgeDeletion=true/,
  )
  assert.throws(
    () => normalizeGuildApplicationCommandChangeRequest(createRequest({
      definition: { ...chatDefinition(), name: "UPPERCASE" },
    })),
    /lowercase chat-input name syntax/,
  )
})

test("planning binds exact localized definitions, permissions, capacities, and privacy", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, createRequest())
  assert.equal(plan.status, "planned")
  assert.equal(plan.effect, "change")
  assert.equal(plan.commandType, "chat-input")
  assert.equal(plan.inventory.counts.user, 1)
  assert.equal(plan.inventory.limits["chat-input"], 100)
  assert.equal(plan.permissions.returned, 1)
  assert.equal(plan.privacy.definitionsPersisted, false)
  assert.equal(plan.verification.commandInventory, "exact-full-localization-readback")
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  setup.state.permissions[0]!.permissions.push({
    allowed: false,
    id: USER_ID,
    type: 2,
    unknownFieldCount: 0,
  })
  const changed = await setup.service.plan(
    APPLICATION_ID,
    BOT_ID,
    createRequest({ operationKey: "guild-command-operation-0002" }),
  )
  assert.notEqual(changed.permissions.digest, plan.permissions.digest)
  assert.notEqual(changed.digest, plan.digest)
})

test("policy, bot membership, collisions, and immutable command type fail closed", async () => {
  await assert.rejects(
    () => fixture({ policy: policy({ enabled: false }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      createRequest(),
    ),
    PolicyError,
  )
  await assert.rejects(
    () => fixture({ policy: policy({ guildIds: [OTHER_GUILD_ID] }) }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      createRequest(),
    ),
    PolicyError,
  )
  await assert.rejects(
    () => fixture({ state: { memberBot: false } }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      createRequest(),
    ),
    GuildApplicationCommandEvidenceError,
  )

  const existing = command(chatDefinition())
  await assert.rejects(
    () => fixture({
      state: {
        inventory: [existing],
        permissions: [permissionEntry(COMMAND_ID)],
      },
    }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      createRequest(),
    ),
    /collides with an exact name and type pair/,
  )
  await assert.rejects(
    () => fixture({
      state: {
        inventory: [existing],
        permissions: [permissionEntry(COMMAND_ID)],
      },
    }).service.plan(
      APPLICATION_ID,
      BOT_ID,
      updateRequest(userDefinition()),
    ),
    /cannot change command type/,
  )
})

test("already-current update and already-absent deletion perform no writes or records", async () => {
  const current = fixture({
    state: {
      inventory: [command(chatDefinition())],
      permissions: [permissionEntry(COMMAND_ID)],
    },
  })
  const currentRequest = updateRequest(chatDefinition())
  const currentPlan = await current.service.plan(APPLICATION_ID, BOT_ID, currentRequest)
  const currentResult = await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    currentRequest,
    currentPlan.digest,
  )
  assert.equal(currentResult.status, "already-current")
  assert.equal(currentResult.activityId, null)
  assert.equal(current.editCalls(), 0)
  assert.deepEqual(current.activities, [])

  const absent = fixture()
  const absentPlan = await absent.service.plan(APPLICATION_ID, BOT_ID, deleteRequest())
  const absentResult = await absent.service.execute(
    APPLICATION_ID,
    BOT_ID,
    deleteRequest(),
    absentPlan.digest,
  )
  assert.equal(absentPlan.commandType, null)
  assert.equal(absentResult.status, "already-absent")
  assert.equal(absent.deleteCalls(), 0)
  assert.deepEqual(absent.activities, [])
})

test("creation journals first and verifies the exact command and permission transition", async () => {
  const setup = fixture()
  const request = createRequest()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  setup.events.length = 0
  const result = await setup.service.execute(
    APPLICATION_ID,
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
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.resourceId, CREATED_COMMAND_ID)
  assert.equal(receipt?.verification, "match")
})

test("complete update preserves permission overwrites when the name is unchanged", async () => {
  const setup = fixture({
    state: {
      inventory: [command(chatDefinition())],
      permissions: [permissionEntry(COMMAND_ID)],
    },
  })
  const request = updateRequest()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.permissionEffect, "none")
  assert.equal(plan.permissions.target?.overwrites.length, 1)
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(
    result.observed?.definition.type === "chat-input"
      ? result.observed.definition.description
      : null,
    "Deploy one fully reviewed release",
  )
  assert.equal(setup.editCalls(), 1)
  assert.equal(setup.state.permissions[0]?.permissions.length, 1)
})

test("rename surfaces and verifies Discord's permanent target-permission reset", async () => {
  const setup = fixture({
    state: {
      inventory: [command(chatDefinition())],
      permissions: [permissionEntry(COMMAND_ID)],
    },
  })
  const request = updateRequest(chatDefinition({
    name: "release",
    nameLocalizations: [],
  }))
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.permissionEffect, "target-overwrites-cleared-by-discord")
  assert.ok(plan.risks.some((risk) => risk.includes("Renaming permanently deletes")))
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.observed?.definition.name, "release")
  assert.equal(setup.state.permissions.length, 0)
})

test("deletion removes only the exact command and its permission entry", async () => {
  const survivor = command(userDefinition(), {
    id: OTHER_COMMAND_ID,
    version: OTHER_VERSION_ID,
  })
  const setup = fixture({
    state: {
      inventory: [command(chatDefinition()), survivor],
      permissions: [
        permissionEntry(COMMAND_ID),
        permissionEntry(OTHER_COMMAND_ID, []),
      ],
    },
  })
  const request = deleteRequest()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.permissionEffect, "target-overwrites-cleared-by-discord")
  const result = await setup.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "completed")
  assert.equal(result.observed, null)
  assert.equal(setup.deleteCalls(), 1)
  assert.deepEqual(setup.state.inventory.map(({ id }) => id), [OTHER_COMMAND_ID])
  assert.deepEqual(setup.state.permissions.map(({ commandId }) => commandId), [
    OTHER_COMMAND_ID,
  ])
})

test("fresh inventory or permission drift invalidates the reviewed plan before mutation", async () => {
  const inventoryDrift = fixture()
  const create = createRequest()
  const inventoryPlan = await inventoryDrift.service.plan(
    APPLICATION_ID,
    BOT_ID,
    create,
  )
  inventoryDrift.state.inventory[0]!.version = NEXT_VERSION_ID
  await assert.rejects(
    () => inventoryDrift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      create,
      inventoryPlan.digest,
    ),
    GuildApplicationCommandPlanChangedError,
  )
  assert.equal(inventoryDrift.createCalls(), 0)

  const permissionDrift = fixture()
  const permissionPlan = await permissionDrift.service.plan(
    APPLICATION_ID,
    BOT_ID,
    create,
  )
  permissionDrift.state.permissions[0]!.permissions.push({
    allowed: true,
    id: USER_ID,
    type: 2,
    unknownFieldCount: 0,
  })
  await assert.rejects(
    () => permissionDrift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      create,
      permissionPlan.digest,
    ),
    GuildApplicationCommandPlanChangedError,
  )
  assert.equal(permissionDrift.createCalls(), 0)
})

test("pending activity failure blocks the write and closes the reservation", async () => {
  const setup = fixture({ state: { activityFailureAt: 1 } })
  const request = createRequest()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    () => setup.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(setup.createCalls(), 0)
  assert.equal([...setup.operationStore.receipts.values()][0]?.status, "failed")
})

test("known rejections settle while rate limits and server failures quarantine", async () => {
  const rejected = fixture({ state: { createError: apiError(400) } })
  const rejectedRequest = createRequest()
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
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )

  const rateLimited = fixture({ state: { createError: apiError(429) } })
  const rateRequest = createRequest({ operationKey: "guild-command-operation-rate-limit" })
  const ratePlan = await rateLimited.service.plan(APPLICATION_ID, BOT_ID, rateRequest)
  await assert.rejects(
    () => rateLimited.service.execute(
      APPLICATION_ID,
      BOT_ID,
      rateRequest,
      ratePlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  rateLimited.state.createError = undefined
  const laterRequest = createRequest({ operationKey: "guild-command-operation-after-limit" })
  const laterPlan = await rateLimited.service.plan(APPLICATION_ID, BOT_ID, laterRequest)
  await assert.rejects(
    () => rateLimited.service.execute(
      APPLICATION_ID,
      BOT_ID,
      laterRequest,
      laterPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-prior-uncertain")
      return true
    },
  )
  assert.equal(rateLimited.createCalls(), 1)
})

test("acknowledged readback or unrelated survivor drift is uncertain", async () => {
  const unreadable = fixture({ state: { readbackError: apiError(404, "GET") } })
  const request = createRequest()
  const unreadablePlan = await unreadable.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    () => unreadable.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request,
      unreadablePlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  const drift = fixture()
  drift.state.afterMutation = () => {
    drift.state.inventory[0]!.version = "500000000000000009"
  }
  const driftPlan = await drift.service.plan(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    () => drift.service.execute(APPLICATION_ID, BOT_ID, request, driftPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
})

test("retained rename permissions and response drift fail closed as uncertain", async () => {
  const retained = fixture({
    state: {
      inventory: [command(chatDefinition())],
      permissions: [permissionEntry(COMMAND_ID)],
      retainPermissionsOnRename: true,
    },
  })
  const rename = updateRequest(chatDefinition({
    name: "release",
    nameLocalizations: [],
  }))
  const renamePlan = await retained.service.plan(APPLICATION_ID, BOT_ID, rename)
  await assert.rejects(
    () => retained.service.execute(APPLICATION_ID, BOT_ID, rename, renamePlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )

  const responseDrift = fixture({
    state: {
      createResponse: command(chatDefinition({ description: "Unexpected response" }), {
        id: CREATED_COMMAND_ID,
        version: NEXT_VERSION_ID,
      }),
    },
  })
  const create = createRequest({ operationKey: "guild-command-operation-response-drift" })
  const createPlan = await responseDrift.service.plan(APPLICATION_ID, BOT_ID, create)
  await assert.rejects(
    () => responseDrift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      create,
      createPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
})

test("unknown permission evidence blocks planning and completion-record failure quarantines", async () => {
  const unknown = fixture()
  unknown.state.permissions[0]!.unknownFieldCount = 1
  await assert.rejects(
    () => unknown.service.plan(APPLICATION_ID, BOT_ID, createRequest()),
    GuildApplicationCommandEvidenceError,
  )

  const setup = fixture()
  const request = createRequest({ operationKey: "guild-command-operation-record-failure" })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request)
  setup.operationStore.finishFailure = new Error("operation store unavailable")
  await assert.rejects(
    () => setup.service.execute(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "completed-record-failed")
      return true
    },
  )
  const laterRequest = updateRequest(chatDefinition({
    description: "A later complete update",
  }), {
    commandId: CREATED_COMMAND_ID,
    operationKey: "guild-command-operation-after-record-failure",
  })
  const laterPlan = await setup.service.plan(APPLICATION_ID, BOT_ID, laterRequest)
  await assert.rejects(
    () => setup.service.execute(
      APPLICATION_ID,
      BOT_ID,
      laterRequest,
      laterPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildApplicationCommandExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-prior-uncertain")
      return true
    },
  )
  assert.equal(setup.createCalls(), 1)
})
