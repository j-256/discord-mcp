import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import { DISCORD_LIMITS } from "../src/constants.js"
import {
  GuildDepartureService,
  normalizeGuildDepartureRequest,
  type GuildDepartureRequest,
} from "../src/guild-departure-service.js"
import {
  DiscordApiError,
  GuildDepartureEvidenceError,
  GuildDepartureExecutionError,
  GuildDepartureOperationConflictError,
  GuildDeparturePlanChangedError,
} from "../src/errors.js"
import type {
  GuildOperationKind,
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
} from "../src/types.js"

const APPLICATION_ID = "810000000000000001"
const BOT_ID = "810000000000000002"
const GUILD_ID = "810000000000000250"
const OWNER_ID = "810000000000000003"
const NOW = "2026-08-28T10:00:00.000Z"
const OPERATION_KEY = "guild-departure-operation-0001"

class MemoryOperationStore implements OperationStore {
  readonly events: string[]
  receipt: OperationReceipt | undefined

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`receipt:${receipt.status}`)
    this.receipt = receipt
  }

  async get(
    _kind: GuildOperationKind,
    _operationKeyHash: string,
  ): Promise<OperationReceipt | undefined> {
    return this.receipt
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("receipt:pending")
    if (this.receipt) return { created: false, receipt: this.receipt }
    this.receipt = receipt
    return { created: true, receipt }
  }
}

function request(
  overrides: Partial<GuildDepartureRequest> = {},
): GuildDepartureRequest {
  return {
    acknowledgeAccessLoss: true,
    acknowledgeConcurrentOperationsStopped: true,
    acknowledgeReinviteRequired: true,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    reviewReason: "Retire this bot from the reviewed guild",
    ...overrides,
  }
}

function guildIdAt(offset: number): string {
  return (810000000000000000n + BigInt(offset)).toString()
}

function currentGuild(id: string, name: string, owner = false): DiscordGuild {
  return { id, name, owner, permissions: "0" }
}

function botMember(): DiscordGuildMember {
  return {
    roles: [GUILD_ID],
    user: { bot: true, id: BOT_ID, username: "connector-bot" },
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected guild departure",
    method: "DELETE",
    route: "/users/@me/guilds/{guild.id}",
    status,
  })
}

function fixture(options: {
  activityFailure?: Error
  guildCount?: number
  guildId?: string
  fullOwnerId?: string
  leaveError?: Error
  omitTarget?: boolean
  owner?: boolean
  policy?: { assertGuildDepartureAllowed(guildId: string): void }
  readbackStillPresent?: boolean
} = {}) {
  const guildId = options.guildId ?? GUILD_ID
  const guildCount = options.guildCount ?? DISCORD_LIMITS.currentUserGuilds + 5
  const events: string[] = []
  const activities: ActivityEntry[] = []
  const operationStore = new MemoryOperationStore(events)
  let left = false
  let guildName = "Reviewed Guild"
  const inventory = Array.from({ length: guildCount }, (_, index) => {
    const id = guildIdAt(index + 10)
    return currentGuild(id, `Guild ${index}`)
  })
  const targetIndex = Math.min(200, inventory.length - 1)
  if (!options.omitTarget) {
    inventory[targetIndex] = currentGuild(guildId, guildName, options.owner ?? false)
  }
  inventory.sort((leftGuild, rightGuild) => (
    BigInt(leftGuild.id) < BigInt(rightGuild.id) ? -1 : 1
  ))
  const activityStore: ActivityStore = {
    async append(entry) {
      events.push(`activity:${entry.status}`)
      if (options.activityFailure && entry.status === "pending") {
        throw options.activityFailure
      }
      activities.push(entry)
    },
    async list() {
      return {
        entries: activities,
        file: "/memory/activity.jsonl",
        skippedLines: 0,
      }
    },
  }
  const client = {
    async getGuild() {
      events.push("read:guild")
      return {
        id: guildId,
        name: guildName,
        owner_id: options.fullOwnerId ?? OWNER_ID,
      }
    },
    async getGuildMember() {
      events.push("read:member")
      return {
        ...botMember(),
        roles: [guildId],
      }
    },
    async leaveGuild() {
      events.push("write:leave")
      if (options.leaveError) throw options.leaveError
      left = true
    },
    async listCurrentUserGuilds(page: { after?: string; limit?: number }) {
      events.push(left ? "read:readback" : "read:inventory")
      const visible = left && !options.readbackStillPresent
        ? inventory.filter((guild) => guild.id !== guildId)
        : inventory
      const after = page.after === undefined ? 0n : BigInt(page.after)
      return visible
        .filter((guild) => BigInt(guild.id) > after)
        .slice(0, page.limit)
    },
  }
  const service = new GuildDepartureService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(9),
    policy: options.policy ?? {
      assertGuildDepartureAllowed(requestGuildId: string) {
        assert.equal(requestGuildId, guildId)
      },
    },
    randomId: () => "activity-departure-0001",
  })
  return {
    activities,
    events,
    get guildName() {
      return guildName
    },
    set guildName(value: string) {
      guildName = value
      const target = inventory.find((guild) => guild.id === guildId)
      if (target) target.name = value
    },
    operationStore,
    service,
  }
}

test("guild departure normalization is strict and hashes the one-shot key", () => {
  const normalized = normalizeGuildDepartureRequest(request())
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(normalized.operationKeyHash.includes(OPERATION_KEY), false)
  assert.throws(
    () => normalizeGuildDepartureRequest(request({ guildId: "bad" })),
    /guild ID/,
  )
  assert.throws(
    () => normalizeGuildDepartureRequest(request({ operationKey: "short" })),
    /operation key/,
  )
  assert.throws(
    () => normalizeGuildDepartureRequest(request({ reviewReason: " padded " })),
    /fields are invalid/,
  )
  assert.throws(
    () => normalizeGuildDepartureRequest({
      ...request(),
      unexpected: true,
    } as GuildDepartureRequest),
    /exact fields/,
  )
})

test("guild departure plans bind complete paginated membership and privacy evidence", async () => {
  const setup = fixture()
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.action, "leave")
  assert.deepEqual(plan.guild, {
    id: GUILD_ID,
    name: "Reviewed Guild",
    requesterIsOwner: false,
  })
  assert.deepEqual(plan.membership, {
    botMemberVerified: true,
    complete: true,
    inspectedGuilds: DISCORD_LIMITS.currentUserGuilds + 5,
    pages: 2,
    present: true,
  })
  assert.equal(plan.reviewReason, request().reviewReason)
  assert.equal(plan.privacy.otherGuildIdentitiesProjectedOut, true)
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(plan).includes("Guild 1"), false)
  assert.equal(setup.events.filter((event) => event === "read:inventory").length, 2)
})

test("guild departure planning fails closed on scope, acknowledgment, membership, and ownership", async () => {
  const denied = fixture({
    policy: {
      assertGuildDepartureAllowed() {
        throw new Error("outside exact departure scope")
      },
    },
  })
  await assert.rejects(
    denied.service.plan(APPLICATION_ID, BOT_ID, request()),
    /outside exact departure scope/,
  )

  const unacknowledged = fixture()
  await assert.rejects(
    unacknowledged.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ acknowledgeConcurrentOperationsStopped: false }),
    ),
    /overlapping guild work is stopped/,
  )

  const missing = fixture({ omitTarget: true })
  await assert.rejects(
    missing.service.plan(APPLICATION_ID, BOT_ID, request()),
    GuildDepartureEvidenceError,
  )

  const owner = fixture({ owner: true })
  await assert.rejects(
    owner.service.plan(APPLICATION_ID, BOT_ID, request()),
    /inconsistent requester ownership evidence/,
  )

  const botOwned = fixture({ fullOwnerId: BOT_ID, owner: true })
  await assert.rejects(
    botOwned.service.plan(APPLICATION_ID, BOT_ID, request()),
    /cannot leave a guild it owns/,
  )
})

test("guild departure rejects an inventory that exceeds its pagination bound", async () => {
  const guildId = "810000000000020000"
  const setup = fixture({ guildCount: 10_000, guildId })
  await assert.rejects(
    setup.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ guildId }),
    ),
    /inventory exceeded its safety bound/,
  )
  assert.equal(
    setup.events.filter((event) => event === "read:inventory").length,
    50,
  )
})

test("guild departure reserves, journals, mutates once, and verifies exact absence", async () => {
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
  assert.equal(result.verifiedAbsent, true)
  assert.equal(setup.events.filter((event) => event === "write:leave").length, 1)
  assert.ok(setup.events.indexOf("receipt:pending") < setup.events.indexOf("activity:pending"))
  assert.ok(setup.events.indexOf("activity:pending") < setup.events.indexOf("write:leave"))
  assert.ok(setup.events.indexOf("write:leave") < setup.events.indexOf("read:readback"))
  assert.equal(setup.operationStore.receipt?.status, "completed")
  assert.equal(setup.operationStore.receipt?.verification, "match")
  assert.equal(JSON.stringify(setup.activities).includes(request().reviewReason), false)
  assert.equal(JSON.stringify(setup.activities).includes("Reviewed Guild"), false)
})

test("guild departure rejects stale plans and spent operation keys", async () => {
  const stale = fixture()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, request())
  stale.guildName = "Renamed Guild"
  await assert.rejects(
    stale.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    GuildDeparturePlanChangedError,
  )
  assert.equal(stale.events.includes("write:leave"), false)

  const spent = fixture()
  const spentPlan = await spent.service.plan(APPLICATION_ID, BOT_ID, request())
  await spent.service.execute(APPLICATION_ID, BOT_ID, request(), spentPlan.digest)
  await assert.rejects(
    spent.service.plan(APPLICATION_ID, BOT_ID, request()),
    GuildDepartureOperationConflictError,
  )
})

test("guild departure blocks before mutation when pending audit cannot be recorded", async () => {
  const setup = fixture({ activityFailure: new Error("audit unavailable") })
  const plan = await setup.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    setup.service.execute(APPLICATION_ID, BOT_ID, request(), plan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildDepartureExecutionError)
      assert.equal((error.result as { status: string }).status, "blocked-audit-failed")
      return true
    },
  )
  assert.equal(setup.events.includes("write:leave"), false)
  assert.equal(setup.operationStore.receipt?.status, "failed")
})

test("guild departure distinguishes settled rejection from uncertain mutation outcome", async () => {
  const rejected = fixture({ leaveError: apiError(403) })
  const rejectedPlan = await rejected.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    rejected.service.execute(APPLICATION_ID, BOT_ID, request(), rejectedPlan.digest),
    (error: unknown) => {
      assert.ok(error instanceof GuildDepartureExecutionError)
      assert.equal((error.result as { status: string }).status, "failed")
      return true
    },
  )
  assert.equal(rejected.operationStore.receipt?.status, "failed")

  const uncertainGuildId = "810000000000000251"
  const uncertain = fixture({
    guildId: uncertainGuildId,
    readbackStillPresent: true,
  })
  const uncertainRequest = request({ guildId: uncertainGuildId })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildDepartureExecutionError)
      assert.equal((error.result as { status: string }).status, "uncertain")
      return true
    },
  )
  assert.equal(uncertain.operationStore.receipt?.status, "uncertain")
  await assert.rejects(
    uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => {
      assert.ok(error instanceof GuildDepartureExecutionError)
      assert.equal(
        (error.result as { status: string }).status,
        "blocked-prior-uncertain",
      )
      return true
    },
  )
  assert.equal(
    uncertain.events.filter((event) => event === "write:leave").length,
    1,
  )
})
