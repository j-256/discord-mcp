import assert from "node:assert/strict"
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type { ActivityEntry, ActivityStore } from "../src/activity-log.js"
import {
  BotProfileService,
  normalizeBotProfileChangeRequest,
  type BotProfileChangeRequest,
  type BotProfileServiceOptions,
} from "../src/bot-profile-service.js"
import type { DiscordCurrentBotProfile } from "../src/bot-profile.js"
import {
  BotProfileExecutionError,
  BotProfileOperationConflictError,
  BotProfilePlanChangedError,
  DiscordApiError,
  PolicyError,
} from "../src/errors.js"
import type {
  ApplicationOperationKind,
  ApplicationOperationReceipt,
  ApplicationOperationReservation,
  ApplicationOperationStore,
  GuildOperationKind,
  OperationReceipt,
  OperationReservation,
} from "../src/operation-store.js"
import type { DiscordApplication } from "../src/types.js"

const APPLICATION_ID = "100000000000000101"
const BOT_ID = "200000000000000101"
const OPERATION_KEY = "bot-profile-operation-0001"
const REVIEW_REASON = "Align the public bot identity with the reviewed product name"
const NOW = "2026-08-28T12:00:00.000Z"
const AVATAR_HASH = "a".repeat(32)
const BANNER_HASH = "b".repeat(32)
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    u32(data.byteLength),
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ])
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IEND"),
  ])
}

function request(
  overrides: Partial<BotProfileChangeRequest> = {},
): BotProfileChangeRequest {
  return {
    acknowledgeApplicationWideChange: true,
    operationKey: OPERATION_KEY,
    reviewReason: REVIEW_REASON,
    username: "reviewed-bot",
    ...overrides,
  }
}

class MemoryApplicationOperationStore implements ApplicationOperationStore {
  readonly events: string[]
  readonly receipts = new Map<string, ApplicationOperationReceipt>()
  finishFailure: unknown

  constructor(events: string[]) {
    this.events = events
  }

  key(kind: ApplicationOperationKind, hash: string): string {
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
    this.receipts.set(this.key(receipt.kind, receipt.operationKeyHash), receipt)
  }

  async getApplication(kind: ApplicationOperationKind, hash: string) {
    return this.receipts.get(this.key(kind, hash))
  }

  async reserveApplication(
    receipt: ApplicationOperationReceipt,
  ): Promise<ApplicationOperationReservation> {
    this.events.push("operation:reserve")
    const key = this.key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  applicationId: string
  botId: string
  mutationError: unknown
  profile: DiscordCurrentBotProfile
  readbackError: unknown
  responseOverride: DiscordCurrentBotProfile | null
}

function fixture(options: {
  auditEnabled?: boolean
  changeEnabled?: boolean
  fileRoots?: readonly string[]
  state?: Partial<FixtureState>
} = {}) {
  const state: FixtureState = {
    activityFailureAt: null,
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    mutationError: undefined,
    profile: {
      avatarHash: AVATAR_HASH,
      bannerHash: BANNER_HASH,
      bot: true,
      id: BOT_ID,
      unknownFieldCount: 1,
      username: "current-bot",
    },
    readbackError: undefined,
    responseOverride: null,
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const writes: unknown[] = []
  let activityCalls = 0
  let mutated = false
  const application = (): DiscordApplication => ({
    bot: {
      bot: true,
      id: state.botId,
      username: "private-application-bot-name",
    },
    description: "private application description",
    id: state.applicationId,
    name: "private application name",
  })
  const cloneProfile = (): DiscordCurrentBotProfile => ({ ...state.profile })
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
  const client: BotProfileServiceOptions["client"] = {
    async getCurrentApplication() {
      events.push("read:application")
      return application()
    },
    async getCurrentBotProfile(expectedBotId) {
      events.push(mutated ? "read:readback" : "read:profile")
      if (expectedBotId !== state.botId) {
        throw new Error("unexpected bot identity")
      }
      if (mutated && state.readbackError) throw state.readbackError
      return cloneProfile()
    },
    async modifyCurrentBotProfile(expectedBotId, input) {
      events.push("write:profile")
      writes.push(input)
      if (expectedBotId !== state.botId) throw new Error("unexpected bot identity")
      if (state.mutationError) throw state.mutationError
      if (input.username !== undefined) state.profile.username = input.username
      if (input.avatar !== undefined) {
        state.profile.avatarHash = input.avatar.kind === "clear"
          ? null
          : input.avatar.format === "gif" ? `a_${"c".repeat(32)}` : "c".repeat(32)
      }
      if (input.banner !== undefined) {
        state.profile.bannerHash = input.banner.kind === "clear"
          ? null
          : input.banner.format === "gif" ? `a_${"d".repeat(32)}` : "d".repeat(32)
      }
      mutated = true
      return state.responseOverride ?? cloneProfile()
    },
  }
  const auditEnabled = options.auditEnabled ?? true
  const changeEnabled = options.changeEnabled ?? true
  const service = new BotProfileService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    fileRoots: options.fileRoots ?? [],
    operationStore,
    planKey: Buffer.alloc(32, 9),
    policy: {
      assertBotProfileAuditable() {
        if (!auditEnabled) throw new PolicyError("audit disabled")
      },
      assertBotProfileChangeAllowed() {
        if (!auditEnabled || !changeEnabled) throw new PolicyError("changes disabled")
      },
    },
    randomId: () => "bot-profile-activity-0001",
  })
  return {
    activities,
    events,
    operationStore,
    service,
    state,
    writes,
  }
}

async function fileFixture() {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-bot-profile-service-"))
  const root = await realpath(temporary)
  const avatarPath = join(root, "avatar.png")
  await writeFile(avatarPath, png(128, 128), { mode: 0o600 })
  return {
    avatarPath,
    async cleanup() {
      await rm(temporary, { force: true, recursive: true })
    },
    root,
  }
}

test("bot-profile requests require exact acknowledged typed intent", () => {
  const normalized = normalizeBotProfileChangeRequest(request())
  assert.equal(normalized.username, "reviewed-bot")
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  assert.doesNotMatch(JSON.stringify(normalized), new RegExp(OPERATION_KEY, "u"))

  assert.throws(
    () => normalizeBotProfileChangeRequest({
      ...request(),
      acknowledgeApplicationWideChange: false,
    } as unknown as BotProfileChangeRequest),
    /acknowledgement/u,
  )
  assert.throws(
    () => normalizeBotProfileChangeRequest({
      acknowledgeApplicationWideChange: true,
      operationKey: OPERATION_KEY,
      reviewReason: REVIEW_REASON,
    }),
    /at least one change/u,
  )
  assert.throws(
    () => normalizeBotProfileChangeRequest({
      ...request(),
      avatar: { action: "set", filePath: "https://example.test/avatar.png" },
      arbitrary: true,
    } as unknown as BotProfileChangeRequest),
    /exact fields/u,
  )
  assert.throws(
    () => normalizeBotProfileChangeRequest(request({ username: "discord helper" })),
    /username restrictions/u,
  )
})

test("bot-profile audit pins both identities and projects sensitive evidence out", async () => {
  const current = fixture()
  const result = await current.service.get(APPLICATION_ID, BOT_ID)
  assert.deepEqual(result.profile, {
    avatar: { animated: false, present: true },
    banner: { animated: false, present: true },
    username: "current-bot",
  })
  assert.equal(result.responseUnknownFieldCount, 1)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(AVATAR_HASH, "u"))
  assert.doesNotMatch(JSON.stringify(result), /private application/u)

  current.state.applicationId = "100000000000000102"
  await assert.rejects(
    current.service.get(APPLICATION_ID, BOT_ID),
    /different bot identity/u,
  )

  await assert.rejects(
    fixture({ auditEnabled: false }).service.get(APPLICATION_ID, BOT_ID),
    PolicyError,
  )
})

test("bot-profile planning identifies no-ops without reserving durable state", async () => {
  const current = fixture()
  const plan = await current.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({
      avatar: { action: "clear" },
      username: "current-bot",
    }),
  )
  assert.equal(plan.effect, "change")
  assert.deepEqual(plan.changedFields, ["avatar"])

  current.state.profile.avatarHash = null
  const noOpRequest = request({
    avatar: { action: "clear" },
    operationKey: "bot-profile-operation-no-op",
    username: "current-bot",
  })
  const noOp = await current.service.plan(APPLICATION_ID, BOT_ID, noOpRequest)
  const result = await current.service.execute(
    APPLICATION_ID,
    BOT_ID,
    noOpRequest,
    noOp.digest,
  )
  assert.equal(noOp.status, "already-current")
  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.deepEqual(current.writes, [])
  assert.equal(current.operationStore.receipts.size, 0)
})

test("bot-profile plans bind owned image bytes without returning paths or hashes", async () => {
  const files = await fileFixture()
  try {
    const current = fixture({ fileRoots: [files.root] })
    const imageRequest: BotProfileChangeRequest = {
      acknowledgeApplicationWideChange: true,
      avatar: { action: "set", filePath: files.avatarPath },
      operationKey: "bot-profile-operation-image-plan",
      reviewReason: REVIEW_REASON,
    }
    const first = await current.service.plan(APPLICATION_ID, BOT_ID, imageRequest)
    assert.deepEqual(first.changedFields, ["avatar"])
    assert.equal(first.files.avatar?.review.format, "png")
    assert.equal(first.files.avatar?.review.width, 128)
    assert.equal(first.desired.avatar.present, true)
    assert.doesNotMatch(JSON.stringify(first), new RegExp(files.avatarPath, "u"))
    assert.doesNotMatch(JSON.stringify(first), new RegExp(AVATAR_HASH, "u"))

    await writeFile(files.avatarPath, png(256, 128), { mode: 0o600 })
    const changed = await current.service.plan(APPLICATION_ID, BOT_ID, imageRequest)
    assert.notEqual(changed.digest, first.digest)
    assert.equal(changed.files.avatar?.review.width, 256)
  } finally {
    await files.cleanup()
  }
})

test("bot-profile execution writes once after pending evidence and verifies readback", async () => {
  const files = await fileFixture()
  try {
    const current = fixture({ fileRoots: [files.root] })
    const change = request({
      avatar: { action: "set", filePath: files.avatarPath },
      banner: { action: "clear" },
    })
    const plan = await current.service.plan(APPLICATION_ID, BOT_ID, change)
    const result = await current.service.execute(
      APPLICATION_ID,
      BOT_ID,
      change,
      plan.digest,
    )
    assert.equal(result.status, "completed")
    assert.deepEqual(result.changedFields, ["avatar", "banner", "username"])
    assert.equal(current.writes.length, 1)
    assert.deepEqual(Object.keys(current.writes[0] as object).sort(), [
      "avatar",
      "banner",
      "username",
    ])
    assert.ok(
      current.events.indexOf("activity:pending")
      < current.events.indexOf("write:profile"),
    )
    assert.ok(current.events.includes("read:readback"))
    assert.equal(current.activities[0]?.kind, "bot-profile-change")
    assert.equal(current.activities.at(-1)?.status, "completed")
    const persisted = JSON.stringify({
      activities: current.activities,
      receipts: [...current.operationStore.receipts.values()],
    })
    for (const privateValue of [
      "reviewed-bot",
      REVIEW_REASON,
      OPERATION_KEY,
      files.avatarPath,
      AVATAR_HASH,
      BANNER_HASH,
      "image/png",
    ]) {
      assert.doesNotMatch(persisted, new RegExp(privateValue, "u"))
    }
  } finally {
    await files.cleanup()
  }
})

test("bot-profile execution rejects fresh remote or local drift before reservation", async () => {
  const files = await fileFixture()
  try {
    const remote = fixture()
    const remoteRequest = request({ operationKey: "bot-profile-operation-remote-drift" })
    const remotePlan = await remote.service.plan(APPLICATION_ID, BOT_ID, remoteRequest)
    remote.state.profile.username = "external-edit"
    await assert.rejects(
      remote.service.execute(APPLICATION_ID, BOT_ID, remoteRequest, remotePlan.digest),
      BotProfilePlanChangedError,
    )
    assert.equal(remote.operationStore.receipts.size, 0)

    const local = fixture({ fileRoots: [files.root] })
    const localRequest: BotProfileChangeRequest = {
      acknowledgeApplicationWideChange: true,
      avatar: { action: "set", filePath: files.avatarPath },
      operationKey: "bot-profile-operation-local-drift",
      reviewReason: REVIEW_REASON,
    }
    const localPlan = await local.service.plan(APPLICATION_ID, BOT_ID, localRequest)
    await writeFile(files.avatarPath, png(64, 64), { mode: 0o600 })
    await assert.rejects(
      local.service.execute(APPLICATION_ID, BOT_ID, localRequest, localPlan.digest),
      BotProfilePlanChangedError,
    )
    assert.equal(local.operationStore.receipts.size, 0)
  } finally {
    await files.cleanup()
  }
})

test("bot-profile operation keys are one-shot and audit failure blocks Discord", async () => {
  const conflict = fixture()
  const conflictRequest = request({ operationKey: "bot-profile-operation-conflict" })
  const plan = await conflict.service.plan(APPLICATION_ID, BOT_ID, conflictRequest)
  const normalized = normalizeBotProfileChangeRequest(conflictRequest)
  conflict.operationStore.receipts.set(
    conflict.operationStore.key("bot-profile-change", normalized.operationKeyHash),
    {
      activityId: "existing-bot-profile-activity",
      applicationId: APPLICATION_ID,
      error: null,
      kind: "bot-profile-change",
      operationKeyHash: normalized.operationKeyHash,
      planDigest: plan.digest,
      resourceId: null,
      schemaVersion: 1,
      status: "pending",
      timestamp: NOW,
      verification: null,
    },
  )
  await assert.rejects(
    conflict.service.execute(APPLICATION_ID, BOT_ID, conflictRequest, plan.digest),
    BotProfileOperationConflictError,
  )
  assert.deepEqual(conflict.writes, [])

  const auditFailure = fixture({ state: { activityFailureAt: 1 } })
  const auditRequest = request({ operationKey: "bot-profile-operation-audit-failure" })
  const auditPlan = await auditFailure.service.plan(APPLICATION_ID, BOT_ID, auditRequest)
  await assert.rejects(
    auditFailure.service.execute(APPLICATION_ID, BOT_ID, auditRequest, auditPlan.digest),
    (error: unknown) => (
      error instanceof BotProfileExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.deepEqual(auditFailure.writes, [])
})

test("bot-profile known refusal settles while ambiguous success remains uncertain", async () => {
  const rejected = fixture({
    state: {
      applicationId: "100000000000000103",
      botId: "200000000000000103",
      mutationError: new DiscordApiError({
        message: "Discord rejected the profile",
        method: "PATCH",
        route: "/users/@me",
        status: 403,
      }),
      profile: {
        avatarHash: null,
        bannerHash: null,
        bot: true,
        id: "200000000000000103",
        unknownFieldCount: 0,
        username: "current-bot",
      },
    },
  })
  const rejectedRequest = request({ operationKey: "bot-profile-operation-rejected" })
  const rejectedPlan = await rejected.service.plan(
    rejected.state.applicationId,
    rejected.state.botId,
    rejectedRequest,
  )
  await assert.rejects(
    rejected.service.execute(
      rejected.state.applicationId,
      rejected.state.botId,
      rejectedRequest,
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof BotProfileExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  assert.equal(rejected.activities.at(-1)?.status, "failed")

  const uncertain = fixture({
    state: {
      applicationId: "100000000000000104",
      botId: "200000000000000104",
      profile: {
        avatarHash: null,
        bannerHash: null,
        bot: true,
        id: "200000000000000104",
        unknownFieldCount: 0,
        username: "current-bot",
      },
      responseOverride: {
        avatarHash: null,
        bannerHash: null,
        bot: true,
        id: "200000000000000104",
        unknownFieldCount: 0,
        username: "unexpected-bot",
      },
    },
  })
  const uncertainRequest = request({ operationKey: "bot-profile-operation-uncertain" })
  const uncertainPlan = await uncertain.service.plan(
    uncertain.state.applicationId,
    uncertain.state.botId,
    uncertainRequest,
  )
  await assert.rejects(
    uncertain.service.execute(
      uncertain.state.applicationId,
      uncertain.state.botId,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof BotProfileExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal(uncertain.activities.at(-1)?.status, "uncertain")
})
