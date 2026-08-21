import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityList,
  ActivityStore,
} from "../src/activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
} from "../src/constants.js"
import type {
  CreatePollInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  PollEvidenceError,
  PollExecutionError,
  PollOperationConflictError,
  PollPlanChangedError,
} from "../src/errors.js"
import { InteractionLimiter } from "../src/interaction-limiter.js"
import type {
  OperationKind,
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import {
  normalizeDiscordPollMessage,
  normalizePollCreationRequest,
  normalizePollEndRequest,
  pollNonce,
  PollService,
  type PollCreationRequest,
  type PollEndRequest,
  type PollServiceOptions,
} from "../src/poll-service.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordPoll,
  DiscordPollVoters,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const THREAD_ID = "400000000000000002"
const PARENT_ID = "400000000000000003"
const UNCERTAIN_CHANNEL_ID = "400000000000000004"
const MESSAGE_ID = "500000000000000001"
const UNCERTAIN_MESSAGE_ID = "500000000000000002"
const BOT_ROLE_ID = "600000000000000001"
const OWNER_ID = "700000000000000001"
const OTHER_OWNER_ID = "700000000000000002"
const VOTER_ID_ONE = "800000000000000001"
const VOTER_ID_TWO = "800000000000000002"
const OPERATION_KEY = "poll-operation-key-0001"
const SECOND_OPERATION_KEY = "poll-operation-key-0002"
const NOW = "2026-08-21T12:00:00.000Z"
const EXPIRY = "2026-08-22T12:00:00.000Z"
const ENDED_EXPIRY = "2026-08-21T11:59:59.000Z"
const QUESTION = "Which release theme should we choose?"
const ANSWER_ONE = "Reliability"
const ANSWER_TWO = "Usability"
const PLAN_KEY = new Uint8Array(32).fill(17)

const CREATE_PERMISSIONS = DISCORD_PERMISSIONS.VIEW_CHANNEL
  | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
  | DISCORD_PERMISSIONS.SEND_MESSAGES
  | DISCORD_PERMISSIONS.SEND_POLLS

function role(id: string, permissions: bigint, position = 0): DiscordRole {
  return {
    id,
    managed: id === BOT_ROLE_ID,
    name: id === GUILD_ID ? "@everyone" : "connector",
    permissions: permissions.toString(),
    position,
  }
}

function textChannel(
  id = CHANNEL_ID,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id,
    name: "polls",
    parent_id: null,
    permission_overwrites: [],
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function threadChannel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: THREAD_ID,
    name: "poll-thread",
    owner_id: BOT_ID,
    parent_id: PARENT_ID,
    thread_metadata: {
      archive_timestamp: NOW,
      archived: false,
      auto_archive_duration: 1_440,
      locked: false,
    },
    type: DISCORD_CHANNEL_TYPES.publicThread,
    ...overrides,
  }
}

function poll(overrides: Partial<DiscordPoll> = {}): DiscordPoll {
  return {
    allow_multiselect: false,
    answers: [
      {
        answer_id: 7,
        poll_media: {
          emoji: { id: null, name: "🔒" },
          text: ANSWER_ONE,
        },
      },
      {
        answer_id: 3,
        poll_media: { text: ANSWER_TWO },
      },
    ],
    expiry: EXPIRY,
    layout_type: 1,
    question: { text: QUESTION },
    results: {
      answer_counts: [
        { count: 4, id: 7, me_voted: false },
      ],
      is_finalized: false,
    },
    ...overrides,
  }
}

function pollMessage(
  id = MESSAGE_ID,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return {
    attachments: [],
    author: {
      bot: true,
      id: BOT_ID,
      username: "connector",
    },
    channel_id: CHANNEL_ID,
    components: [],
    content: "",
    guild_id: GUILD_ID,
    id,
    nonce: pollNonce(CHANNEL_ID, OPERATION_KEY),
    poll: poll(),
    timestamp: NOW,
    type: 0,
    ...overrides,
  }
}

function endedMessage(
  id = MESSAGE_ID,
  finalized = true,
  overrides: Partial<DiscordMessage> = {},
): DiscordMessage {
  return pollMessage(id, {
    poll: poll({
      expiry: ENDED_EXPIRY,
      results: {
        answer_counts: [
          { count: 4, id: 7, me_voted: false },
          { count: 0, id: 3, me_voted: false },
        ],
        is_finalized: finalized,
      },
    }),
    ...overrides,
  })
}

function creationRequest(
  overrides: Partial<PollCreationRequest> = {},
): PollCreationRequest {
  return {
    allowMultiselect: false,
    answers: [
      { emoji: "🔒", text: ANSWER_ONE },
      { text: ANSWER_TWO },
    ],
    channelId: CHANNEL_ID,
    durationHours: 24,
    operationKey: OPERATION_KEY,
    question: QUESTION,
    ...overrides,
  }
}

function endRequest(overrides: Partial<PollEndRequest> = {}): PollEndRequest {
  return {
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function policy(options: {
  allowedChannelIds?: readonly string[]
  allowAudit?: boolean
  allowCreation?: boolean
  allowEnding?: boolean
  allowVoterAudit?: boolean
  pollChannelIds?: readonly string[]
} = {}): ScopePolicy {
  const allowedChannelIds = options.allowedChannelIds ?? [CHANNEL_ID]
  return new ScopePolicy({
    adminGuildIds: new Set(),
    allowedChannelIds: new Set(allowedChannelIds),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowPollAudit: options.allowAudit ?? true,
    allowPollCreation: options.allowCreation ?? true,
    allowPollEnding: options.allowEnding ?? true,
    allowPollVoterAudit: options.allowVoterAudit ?? true,
    deleteChannelIds: new Set(),
    interactionChannelIds: new Set(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 0,
    mentionUserIds: new Set(),
    pollChannelIds: new Set(options.pollChannelIds ?? [CHANNEL_ID]),
    protectedUserIds: new Set(),
  })
}

class MemoryActivityStore implements ActivityStore {
  readonly entries: ActivityEntry[] = []
  failAt: number | null = null
  calls = 0

  async append(entry: ActivityEntry): Promise<void> {
    this.calls += 1
    if (this.calls === this.failAt) throw new Error("activity unavailable")
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
  readonly receipts = new Map<string, OperationReceipt>()
  failFinish = false
  finishCalls = 0
  reserveCalls = 0

  #key(kind: OperationKind, hash: string): string {
    return `${kind}:${hash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.finishCalls += 1
    if (this.failFinish) throw new Error("operation receipt unavailable")
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), structuredClone(receipt))
  }

  async get(
    kind: OperationKind,
    operationKeyHash: string,
  ): Promise<OperationReceipt | undefined> {
    const value = this.receipts.get(this.#key(kind, operationKeyHash))
    return value ? structuredClone(value) : undefined
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.reserveCalls += 1
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: structuredClone(existing) }
    this.receipts.set(key, structuredClone(receipt))
    return { created: true, receipt: structuredClone(receipt) }
  }
}

interface FixtureState {
  channel: DiscordChannel
  createCalls: number
  createError: unknown
  createInput: CreatePollInput | null
  created: DiscordMessage
  endCalls: number
  endError: unknown
  ended: DiscordMessage
  getMessageCalls: number
  guild: DiscordGuild
  member: DiscordGuildMember
  message: DiscordMessage
  parent: DiscordChannel
  roles: DiscordRole[]
  voterCalls: number
  voters: DiscordPollVoters
}

function fixture(options: {
  activityStore?: MemoryActivityStore
  client?: Partial<PollServiceOptions["client"]>
  operationStore?: MemoryOperationStore
  policy?: ScopePolicy
  state?: Partial<FixtureState>
} = {}) {
  const activityStore = options.activityStore ?? new MemoryActivityStore()
  const operationStore = options.operationStore ?? new MemoryOperationStore()
  const state: FixtureState = {
    channel: textChannel(),
    createCalls: 0,
    createError: null,
    createInput: null,
    created: pollMessage(),
    endCalls: 0,
    endError: null,
    ended: endedMessage(),
    getMessageCalls: 0,
    guild: {
      id: GUILD_ID,
      name: "Example guild",
      owner_id: OWNER_ID,
    },
    member: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    message: pollMessage(),
    parent: textChannel(PARENT_ID, { name: "poll-parent" }),
    roles: [
      role(GUILD_ID, 0n),
      role(BOT_ROLE_ID, CREATE_PERMISSIONS, 1),
    ],
    voterCalls: 0,
    voters: {
      users: [
        { id: VOTER_ID_ONE, username: "private-one" },
        { id: VOTER_ID_TWO, username: "private-two" },
      ],
    },
    ...options.state,
  }
  const client: PollServiceOptions["client"] = {
    async createPoll(_channelId, input) {
      state.createCalls += 1
      state.createInput = structuredClone(input)
      if (state.createError) throw state.createError
      const created = structuredClone(state.created)
      created.nonce = input.nonce
      state.message = structuredClone(created)
      return created
    },
    async endPoll() {
      state.endCalls += 1
      if (state.endError) throw state.endError
      state.message = structuredClone(state.ended)
      return structuredClone(state.ended)
    },
    async getChannel(channelId) {
      if (channelId === state.channel.id) return structuredClone(state.channel)
      if (channelId === state.parent.id) return structuredClone(state.parent)
      return textChannel(channelId)
    },
    async getGuild() {
      return structuredClone(state.guild)
    },
    async getGuildMember() {
      return structuredClone(state.member)
    },
    async getGuildRoles() {
      return structuredClone(state.roles)
    },
    async getMessage() {
      state.getMessageCalls += 1
      return structuredClone(state.message)
    },
    async listPollAnswerVoters() {
      state.voterCalls += 1
      return structuredClone(state.voters)
    },
  }
  Object.assign(client, options.client)
  return {
    activityStore,
    operationStore,
    service: new PollService({
      activityStore,
      client,
      clock: () => new Date(NOW),
      limiter: new InteractionLimiter({
        maxWritesPerMinute: 10,
        minWriteIntervalMs: 0,
      }),
      operationStore,
      planKey: PLAN_KEY,
      policy: options.policy ?? policy({
        allowedChannelIds: [state.channel.id, state.parent.id],
        pollChannelIds: [state.channel.id],
      }),
      randomId: () => "activity-poll-1",
    }),
    state,
  }
}

function discordError(status: number): DiscordApiError {
  return new DiscordApiError({
    ...(status === 400 ? { code: 50_035 } : {}),
    message: "Discord rejected the request",
    method: "POST",
    route: "/channels/:channelId/polls",
    status,
  })
}

test("poll request normalization is bounded, exact, and canonical", () => {
  const defaultRequest = creationRequest()
  delete defaultRequest.allowMultiselect
  delete defaultRequest.durationHours
  const normalized = normalizePollCreationRequest(defaultRequest)
  assert.equal(normalized.allowMultiselect, false)
  assert.equal(normalized.durationHours, 24)
  assert.deepEqual(normalized.answers, [
    { emoji: "🔒", text: ANSWER_ONE },
    { emoji: null, text: ANSWER_TWO },
  ])
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(normalized.operationKey, OPERATION_KEY)

  for (const invalid of [
    { ...creationRequest(), extra: true },
    creationRequest({ answers: [{ text: ANSWER_ONE }] }),
    creationRequest({ answers: [{ text: "A" }, { text: "ａ" }] }),
    creationRequest({ answers: [{ emoji: "not-emoji", text: "A" }, { text: "B" }] }),
    creationRequest({ durationHours: 0 }),
    creationRequest({ durationHours: 769 }),
    creationRequest({ question: " padded " }),
    creationRequest({ operationKey: "short" }),
  ]) {
    assert.throws(() => normalizePollCreationRequest(invalid as PollCreationRequest))
  }

  const ended = normalizePollEndRequest(endRequest())
  assert.match(ended.operationKeyHash, /^sha256:[a-f0-9]{64}$/u)
  assert.throws(() => normalizePollEndRequest({ ...endRequest(), messageId: "0" }))
  assert.throws(() => normalizePollEndRequest({
    ...endRequest(),
    extra: true,
  } as PollEndRequest))
})

test("poll normalization preserves answer IDs and distinguishes unknown, approximate, and final results", () => {
  const approximate = normalizeDiscordPollMessage(
    pollMessage(),
    CHANNEL_ID,
    GUILD_ID,
    MESSAGE_ID,
    new Date(NOW),
  )
  assert.deepEqual(approximate.poll.answers.map((answer) => ({
    count: answer.count,
    id: answer.answerId,
  })), [
    { count: 4, id: 7 },
    { count: 0, id: 3 },
  ])
  assert.equal(approximate.poll.lifecycleState, "active")
  assert.equal(approximate.poll.resultState, "approximate")
  assert.equal(approximate.poll.totalVotes, 4)

  const pollWithoutResults = poll()
  delete pollWithoutResults.results
  const unknown = normalizeDiscordPollMessage(
    pollMessage(MESSAGE_ID, { poll: pollWithoutResults }),
    CHANNEL_ID,
    GUILD_ID,
    MESSAGE_ID,
    new Date(NOW),
  )
  assert.equal(unknown.poll.resultState, "unknown")
  assert.deepEqual(unknown.poll.answers.map((answer) => answer.count), [null, null])

  const final = normalizeDiscordPollMessage(
    endedMessage(),
    CHANNEL_ID,
    GUILD_ID,
    MESSAGE_ID,
    new Date(NOW),
  )
  assert.equal(final.poll.lifecycleState, "ended")
  assert.equal(final.poll.resultState, "final")

  const futurePoll = poll() as DiscordPoll & { future_field: string }
  futurePoll.future_field = "new"
  const future = normalizeDiscordPollMessage(
    pollMessage(MESSAGE_ID, { poll: futurePoll }),
    CHANNEL_ID,
    GUILD_ID,
    MESSAGE_ID,
    new Date(NOW),
  )
  assert.equal(future.poll.unknownFieldCount, 1)

  assert.throws(
    () => normalizeDiscordPollMessage(
      pollMessage(MESSAGE_ID, {
        poll: poll({
          answers: [
            { answer_id: 7, poll_media: { text: "A" } },
            { answer_id: 7, poll_media: { text: "B" } },
          ],
        }),
      }),
      CHANNEL_ID,
      GUILD_ID,
      MESSAGE_ID,
      new Date(NOW),
    ),
    PollEvidenceError,
  )
})

test("poll reads expose exact transient poll state without fetching voters", async () => {
  const { service, state } = fixture()
  const result = await service.get(CHANNEL_ID, MESSAGE_ID)

  assert.equal(result.poll.question, QUESTION)
  assert.equal(result.messageId, MESSAGE_ID)
  assert.deepEqual(result.privacy, {
    persistence: "none",
    rawPayloads: "omitted",
    voterIdentities: "not-fetched",
  })
  assert.equal(state.voterCalls, 0)
})

test("poll voter audit returns IDs only with strict ordered pagination", async () => {
  const { service, state } = fixture()
  const result = await service.listAnswerVoters(CHANNEL_ID, MESSAGE_ID, 7, { limit: 2 })

  assert.deepEqual(result.voterUserIds, [VOTER_ID_ONE, VOTER_ID_TWO])
  assert.equal(result.page.nextAfter, VOTER_ID_TWO)
  assert.equal(JSON.stringify(result).includes("private-one"), false)
  assert.equal(state.voterCalls, 1)

  const disabled = fixture({
    policy: policy({ allowVoterAudit: false }),
  })
  await assert.rejects(
    () => disabled.service.listAnswerVoters(CHANNEL_ID, MESSAGE_ID, 7),
    /voter audit is disabled/u,
  )
  assert.equal(disabled.state.voterCalls, 0)

  const unordered = fixture({
    state: {
      voters: {
        users: [
          { id: VOTER_ID_TWO, username: "private-two" },
          { id: VOTER_ID_ONE, username: "private-one" },
        ],
      },
    },
  })
  await assert.rejects(
    () => unordered.service.listAnswerVoters(CHANNEL_ID, MESSAGE_ID, 7, { limit: 2 }),
    /unordered or duplicate/u,
  )
  await assert.rejects(
    () => service.listAnswerVoters(CHANNEL_ID, MESSAGE_ID, 99),
    /does not contain answer ID/u,
  )
})

test("poll creation plans bind identity, content, channel evidence, and permissions", async () => {
  const { service, state } = fixture()
  const plan = await service.planCreation(APPLICATION_ID, BOT_ID, creationRequest())

  assert.equal(plan.applicationId, APPLICATION_ID)
  assert.equal(plan.botId, BOT_ID)
  assert.equal(plan.channel.id, CHANNEL_ID)
  assert.deepEqual(plan.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
    "SEND_MESSAGES",
    "SEND_POLLS",
  ])
  assert.equal(plan.target.question, QUESTION)
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/u)

  state.guild.owner_id = OTHER_OWNER_ID
  const changed = await service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    creationRequest({ operationKey: SECOND_OPERATION_KEY }),
  )
  assert.notEqual(changed.digest, plan.digest)
})

test("poll creation policy, permissions, and thread lifecycle fail closed", async () => {
  await assert.rejects(
    () => fixture({
      policy: policy({ allowCreation: false }),
    }).service.planCreation(APPLICATION_ID, BOT_ID, creationRequest()),
    /creation is disabled/u,
  )

  await assert.rejects(
    () => fixture({
      state: {
        roles: [
          role(GUILD_ID, 0n),
          role(BOT_ROLE_ID, CREATE_PERMISSIONS & ~DISCORD_PERMISSIONS.SEND_POLLS, 1),
        ],
      },
    }).service.planCreation(APPLICATION_ID, BOT_ID, creationRequest()),
    /SEND_POLLS/u,
  )

  const thread = threadChannel({
    thread_metadata: {
      archive_timestamp: NOW,
      archived: true,
      auto_archive_duration: 1_440,
      locked: false,
    },
  })
  await assert.rejects(
    () => fixture({
      policy: policy({
        allowedChannelIds: [THREAD_ID, PARENT_ID],
        pollChannelIds: [THREAD_ID],
      }),
      state: {
        channel: thread,
        roles: [
          role(GUILD_ID, 0n),
          role(
            BOT_ROLE_ID,
            DISCORD_PERMISSIONS.VIEW_CHANNEL
              | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
              | DISCORD_PERMISSIONS.SEND_MESSAGES_IN_THREADS
              | DISCORD_PERMISSIONS.SEND_POLLS,
            1,
          ),
        ],
      },
    }).service.planCreation(
      APPLICATION_ID,
      BOT_ID,
      creationRequest({ channelId: THREAD_ID }),
    ),
    /active unlocked thread/u,
  )
})

test("poll creation executes once with nonce, exact readback, and content-free records", async () => {
  const { activityStore, operationStore, service, state } = fixture()
  const request = creationRequest()
  const plan = await service.planCreation(APPLICATION_ID, BOT_ID, request)
  const result = await service.executeCreation(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.equal(result.expiryMatched, true)
  assert.equal(state.createCalls, 1)
  assert.equal(state.createInput?.nonce, pollNonce(CHANNEL_ID, OPERATION_KEY))
  assert.deepEqual(activityStore.entries.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  const receipt = [...operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "completed")
  assert.equal(receipt?.resourceId, MESSAGE_ID)
  const durable = JSON.stringify({
    activities: activityStore.entries,
    receipts: [...operationStore.receipts.values()],
  })
  assert.equal(durable.includes(QUESTION), false)
  assert.equal(durable.includes(ANSWER_ONE), false)
  assert.equal(durable.includes(OPERATION_KEY), false)

  await assert.rejects(
    () => service.planCreation(APPLICATION_ID, BOT_ID, request),
    PollOperationConflictError,
  )
})

test("poll creation refuses stale plans before reservation or mutation", async () => {
  const { operationStore, service, state } = fixture()
  const request = creationRequest()
  const plan = await service.planCreation(APPLICATION_ID, BOT_ID, request)
  state.guild.owner_id = OTHER_OWNER_ID

  await assert.rejects(
    () => service.executeCreation(APPLICATION_ID, BOT_ID, request, plan.digest),
    PollPlanChangedError,
  )
  assert.equal(operationStore.reserveCalls, 0)
  assert.equal(state.createCalls, 0)
})

test("poll creation requires a pending activity record before mutation", async () => {
  const activityStore = new MemoryActivityStore()
  activityStore.failAt = 1
  const { operationStore, service, state } = fixture({ activityStore })
  const request = creationRequest()
  const plan = await service.planCreation(APPLICATION_ID, BOT_ID, request)

  await assert.rejects(
    () => service.executeCreation(APPLICATION_ID, BOT_ID, request, plan.digest),
    (error: unknown) => (
      error instanceof PollExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(state.createCalls, 0)
  assert.equal([...operationStore.receipts.values()][0]?.status, "failed")
})

test("poll creation separates known rejections from uncertain transport outcomes", async () => {
  const rejected = fixture({ state: { createError: discordError(400) } })
  const rejectedRequest = creationRequest()
  const rejectedPlan = await rejected.service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    rejectedRequest,
  )
  await assert.rejects(
    () => rejected.service.executeCreation(
      APPLICATION_ID,
      BOT_ID,
      rejectedRequest,
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof PollExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  const rejectedReceipt = [...rejected.operationStore.receipts.values()][0]
  assert.equal(rejectedReceipt?.status, "failed")
  assert.equal(rejectedReceipt?.resourceId, null)

  const uncertain = fixture({
    policy: policy({
      allowedChannelIds: [UNCERTAIN_CHANNEL_ID],
      pollChannelIds: [UNCERTAIN_CHANNEL_ID],
    }),
    state: {
      channel: textChannel(UNCERTAIN_CHANNEL_ID),
      createError: new Error("connection reset after write"),
      created: pollMessage(MESSAGE_ID, { channel_id: UNCERTAIN_CHANNEL_ID }),
      message: pollMessage(MESSAGE_ID, { channel_id: UNCERTAIN_CHANNEL_ID }),
    },
  })
  const uncertainRequest = creationRequest({
    channelId: UNCERTAIN_CHANNEL_ID,
    operationKey: "poll-uncertain-operation-0001",
  })
  const uncertainPlan = await uncertain.service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    () => uncertain.service.executeCreation(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof PollExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal([...uncertain.operationStore.receipts.values()][0]?.status, "uncertain")

  const retryRequest = creationRequest({
    channelId: UNCERTAIN_CHANNEL_ID,
    operationKey: "poll-uncertain-operation-0002",
  })
  const retryPlan = await uncertain.service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    retryRequest,
  )
  await assert.rejects(
    () => uncertain.service.executeCreation(
      APPLICATION_ID,
      BOT_ID,
      retryRequest,
      retryPlan.digest,
    ),
    /prior same-channel operation ended uncertainly/u,
  )
  assert.equal(uncertain.state.createCalls, 1)
})

test("poll creation reports verified response drift without hiding the completed write", async () => {
  const drifted = pollMessage(MESSAGE_ID, {
    poll: poll({ question: { text: "A changed question" } }),
  })
  const { activityStore, operationStore, service } = fixture({
    state: {
      created: drifted,
      message: drifted,
    },
  })
  const request = creationRequest()
  const plan = await service.planCreation(APPLICATION_ID, BOT_ID, request)
  const result = await service.executeCreation(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")
  assert.equal(activityStore.entries.at(-1)?.status, "completed-with-drift")
  assert.equal([...operationStore.receipts.values()][0]?.verification, "drift")
})

test("poll end planning requires owned known poll evidence and binds live counts", async () => {
  const { service, state } = fixture()
  const request = endRequest()
  const plan = await service.planEnd(APPLICATION_ID, BOT_ID, request)

  assert.equal(plan.status, "planned")
  assert.equal(plan.writeRequired, true)
  assert.equal(plan.poll.totalVotes, 4)
  assert.deepEqual(plan.permission.requiredPermissionNames, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
  ])
  assert.equal(JSON.stringify(plan).includes(OPERATION_KEY), false)

  const changedPoll = poll({
    results: {
      answer_counts: [{ count: 5, id: 7, me_voted: false }],
      is_finalized: false,
    },
  })
  state.message = pollMessage(MESSAGE_ID, { poll: changedPoll })
  const changed = await service.planEnd(
    APPLICATION_ID,
    BOT_ID,
    endRequest({ operationKey: SECOND_OPERATION_KEY }),
  )
  assert.notEqual(changed.digest, plan.digest)

  const foreign = fixture({
    state: {
      message: pollMessage(MESSAGE_ID, {
        author: { bot: true, id: VOTER_ID_ONE, username: "other-bot" },
      }),
    },
  })
  await assert.rejects(
    () => foreign.service.planEnd(APPLICATION_ID, BOT_ID, request),
    /not owned by the verified bot/u,
  )

  const unknownPoll = poll() as DiscordPoll & { future_field: string }
  unknownPoll.future_field = "new"
  await assert.rejects(
    () => fixture({
      state: { message: pollMessage(MESSAGE_ID, { poll: unknownPoll }) },
    }).service.planEnd(APPLICATION_ID, BOT_ID, request),
    /unknown poll fields/u,
  )
})

test("poll ending executes once and reports asynchronous finalization", async () => {
  const { activityStore, operationStore, service, state } = fixture({
    state: { ended: endedMessage(MESSAGE_ID, false) },
  })
  const request = endRequest()
  const plan = await service.planEnd(APPLICATION_ID, BOT_ID, request)
  const result = await service.executeEnd(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.finalization, "pending")
  assert.equal(result.verification, "match")
  assert.equal(state.endCalls, 1)
  assert.deepEqual(activityStore.entries.map((entry) => entry.status), [
    "pending",
    "completed",
  ])
  assert.equal([...operationStore.receipts.values()][0]?.resourceId, MESSAGE_ID)
  const durable = JSON.stringify({
    activities: activityStore.entries,
    receipts: [...operationStore.receipts.values()],
  })
  assert.equal(durable.includes(QUESTION), false)
  assert.equal(durable.includes(ANSWER_ONE), false)
  assert.equal(durable.includes(OPERATION_KEY), false)
})

test("already-ended polls are an audited no-op without reservation", async () => {
  const { activityStore, operationStore, service, state } = fixture({
    state: { message: endedMessage() },
  })
  const request = endRequest()
  const plan = await service.planEnd(APPLICATION_ID, BOT_ID, request)
  assert.equal(plan.status, "already-ended")
  assert.equal(plan.writeRequired, false)

  const result = await service.executeEnd(
    APPLICATION_ID,
    BOT_ID,
    request,
    plan.digest,
  )
  assert.equal(result.status, "already-ended")
  assert.equal(result.finalization, "not-required")
  assert.equal(result.activityId, null)
  assert.equal(state.endCalls, 0)
  assert.equal(operationStore.reserveCalls, 0)
  assert.deepEqual(activityStore.entries, [])
})

test("poll ending refuses vote-count drift before reservation or mutation", async () => {
  const { operationStore, service, state } = fixture()
  const request = endRequest()
  const plan = await service.planEnd(APPLICATION_ID, BOT_ID, request)
  state.message = pollMessage(MESSAGE_ID, {
    poll: poll({
      results: {
        answer_counts: [{ count: 5, id: 7, me_voted: false }],
        is_finalized: false,
      },
    }),
  })

  await assert.rejects(
    () => service.executeEnd(APPLICATION_ID, BOT_ID, request, plan.digest),
    PollPlanChangedError,
  )
  assert.equal(operationStore.reserveCalls, 0)
  assert.equal(state.endCalls, 0)
})

test("poll ending requires pending audit and classifies known rejection", async () => {
  const activityStore = new MemoryActivityStore()
  activityStore.failAt = 1
  const blocked = fixture({ activityStore })
  const blockedRequest = endRequest()
  const blockedPlan = await blocked.service.planEnd(
    APPLICATION_ID,
    BOT_ID,
    blockedRequest,
  )
  await assert.rejects(
    () => blocked.service.executeEnd(
      APPLICATION_ID,
      BOT_ID,
      blockedRequest,
      blockedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof PollExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(blocked.state.endCalls, 0)

  const rejected = fixture({ state: { endError: discordError(400) } })
  const rejectedRequest = endRequest({ operationKey: SECOND_OPERATION_KEY })
  const rejectedPlan = await rejected.service.planEnd(
    APPLICATION_ID,
    BOT_ID,
    rejectedRequest,
  )
  await assert.rejects(
    () => rejected.service.executeEnd(
      APPLICATION_ID,
      BOT_ID,
      rejectedRequest,
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof PollExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )
  const receipt = [...rejected.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "failed")
  assert.equal(receipt?.resourceId, null)
})

test("poll ending marks ambiguous outcomes uncertain and blocks same-message retries", async () => {
  const message = pollMessage(UNCERTAIN_MESSAGE_ID, {
    id: UNCERTAIN_MESSAGE_ID,
    nonce: pollNonce(CHANNEL_ID, "poll-end-uncertain-operation-0001"),
  })
  const uncertain = fixture({
    state: {
      endError: new Error("connection reset after write"),
      ended: endedMessage(UNCERTAIN_MESSAGE_ID),
      message,
    },
  })
  const request = endRequest({
    messageId: UNCERTAIN_MESSAGE_ID,
    operationKey: "poll-end-uncertain-operation-0001",
  })
  const plan = await uncertain.service.planEnd(APPLICATION_ID, BOT_ID, request)
  await assert.rejects(
    () => uncertain.service.executeEnd(
      APPLICATION_ID,
      BOT_ID,
      request,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof PollExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  const receipt = [...uncertain.operationStore.receipts.values()][0]
  assert.equal(receipt?.status, "uncertain")
  assert.equal(receipt?.resourceId, UNCERTAIN_MESSAGE_ID)

  const retryRequest = endRequest({
    messageId: UNCERTAIN_MESSAGE_ID,
    operationKey: "poll-end-uncertain-operation-0002",
  })
  const retryPlan = await uncertain.service.planEnd(APPLICATION_ID, BOT_ID, retryRequest)
  await assert.rejects(
    () => uncertain.service.executeEnd(
      APPLICATION_ID,
      BOT_ID,
      retryRequest,
      retryPlan.digest,
    ),
    /prior same-message operation ended uncertainly/u,
  )
  assert.equal(uncertain.state.endCalls, 1)
})

test("completed poll writes surface operation and activity persistence failures", async () => {
  const receiptFailure = fixture()
  const receiptRequest = creationRequest({ operationKey: "poll-record-failure-0001" })
  const receiptPlan = await receiptFailure.service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    receiptRequest,
  )
  receiptFailure.operationStore.failFinish = true
  await assert.rejects(
    () => receiptFailure.service.executeCreation(
      APPLICATION_ID,
      BOT_ID,
      receiptRequest,
      receiptPlan.digest,
    ),
    (error: unknown) => (
      error instanceof PollExecutionError
      && (error.result as { status?: string }).status === "completed-operation-record-failed"
    ),
  )
  assert.equal(receiptFailure.state.createCalls, 1)

  const activityStore = new MemoryActivityStore()
  activityStore.failAt = 2
  const activityFailure = fixture({ activityStore })
  const activityRequest = creationRequest({ operationKey: "poll-record-failure-0002" })
  const activityPlan = await activityFailure.service.planCreation(
    APPLICATION_ID,
    BOT_ID,
    activityRequest,
  )
  await assert.rejects(
    () => activityFailure.service.executeCreation(
      APPLICATION_ID,
      BOT_ID,
      activityRequest,
      activityPlan.digest,
    ),
    (error: unknown) => (
      error instanceof PollExecutionError
      && (error.result as { status?: string }).status === "completed-audit-failed"
    ),
  )
  assert.equal(activityFailure.state.createCalls, 1)
  assert.equal([...activityFailure.operationStore.receipts.values()][0]?.status, "completed")
})
