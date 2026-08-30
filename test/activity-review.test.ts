import assert from "node:assert/strict"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  JsonlActivityLog,
  type ActivityEntry,
  type ActivityStore,
  type ChannelCreationActivity,
  type InteractionActivity,
  type NativeInteractionActivity,
} from "../src/activity-log.js"
import {
  ACTIVITY_REVIEW_FORMAT,
  ACTIVITY_REVIEW_SCHEMA_VERSION,
  reviewDiscordActivity,
  verifyDiscordActivityReviewReport,
} from "../src/activity-review.js"
import {
  FileOperationStore,
  operationReceiptDirectory,
  type StandardOperationReceipt,
} from "../src/operation-store.js"
import {
  FileWriteCoordinator,
  writeCoordinationDirectory,
  writeResourceTarget,
  type WriteCoordinationClaimStatus,
  type WriteCoordinationList,
} from "../src/write-coordination.js"

const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const OPERATION_KEY_HASH = `sha256:${"a".repeat(64)}`
const PLAN_DIGEST = `hmac-sha256:${"b".repeat(64)}`

function interaction(
  id: string,
  status: InteractionActivity["status"],
  timestamp: string,
): InteractionActivity {
  return {
    channelId: CHANNEL_ID,
    error: status === "failed" ? "DiscordApiError.400.unknown" : null,
    guildId: GUILD_ID,
    id,
    kind: "message-send",
    messageId: status === "completed" ? "300000000000000001" : null,
    nonce: null,
    replyToMessageId: null,
    schemaVersion: 1,
    status,
    timestamp,
  }
}

function nativeInteraction(
  id: string,
  status: NativeInteractionActivity["status"],
  timestamp: string,
): NativeInteractionActivity {
  const continuation = status.startsWith("continuation-")
  const followup = status.startsWith("followup-")
  return {
    channelId: CHANNEL_ID,
    error: null,
    guildId: GUILD_ID,
    id,
    interactionId: "400000000000000001",
    kind: "native-interaction",
    referenceHash: `hmac-sha256:${"c".repeat(64)}`,
    responseStage: continuation ? "continuation" : followup ? "followup" : "initial",
    schemaVersion: 1,
    sequence: continuation || followup ? 1 : 0,
    status,
    timestamp,
    userId: "500000000000000001",
  }
}

function channelCreation(
  id: string,
  status: ChannelCreationActivity["status"],
  timestamp: string,
): ChannelCreationActivity {
  return {
    channelId: status === "pending" ? null : CHANNEL_ID,
    channelKind: "text",
    error: status === "failed" ? "DiscordApiError.400.unknown" : null,
    guildId: GUILD_ID,
    id,
    kind: "channel-create",
    operationKeyHash: OPERATION_KEY_HASH,
    parentId: null,
    planDigest: PLAN_DIGEST,
    schemaVersion: 1,
    status,
    timestamp,
    verification: status === "completed-with-drift" ? "drift" : null,
  }
}

function store(
  entries: ActivityEntry[],
  skippedLines = 0,
): ActivityStore {
  return {
    async append() {
      throw new Error("Activity review must not append")
    },
    async list() {
      return {
        entries,
        file: "/private/activity.jsonl",
        skippedLines,
      }
    },
  }
}

function claim(
  claimId: string,
  options: Partial<WriteCoordinationClaimStatus> = {},
): WriteCoordinationClaimStatus {
  return {
    claimId,
    createdAt: "2026-08-24T12:00:00.000Z",
    kind: "channel-creation",
    operationKeyHash: OPERATION_KEY_HASH,
    ownerPid: 1234,
    ownerState: "dead",
    planDigest: PLAN_DIGEST,
    publishedTargetCount: 2,
    receiptState: "uncertain",
    schemaVersion: 1,
    state: "review-required",
    targets: [
      { collection: "channels", guildId: GUILD_ID, kind: "guild-collection" },
      { id: CHANNEL_ID, kind: "channel" },
    ],
    ...options,
  }
}

function coordination(
  claims: WriteCoordinationClaimStatus[] = [],
): WriteCoordinationList {
  return { claims, schemaVersion: 1, status: "ok" }
}

test("activity review collapses ordinary pending history into one settled lifecycle", async () => {
  const report = await reviewDiscordActivity("/private/activity.jsonl", 25, {
    activityStore: store([
      interaction("activity_a", "pending", "2026-08-24T12:00:00.000Z"),
      interaction("activity_a", "completed", "2026-08-24T12:00:01.000Z"),
    ]),
    async listCoordination() {
      return coordination()
    },
  })

  assert.equal(report.format, ACTIVITY_REVIEW_FORMAT)
  assert.equal(report.schemaVersion, ACTIVITY_REVIEW_SCHEMA_VERSION)
  assert.equal(report.outcome, "clear")
  assert.equal(report.summary.records, 2)
  assert.equal(report.summary.currentActivities, 1)
  assert.equal(report.summary.attentionActivities, 0)
  assert.equal(report.records[0]?.entry.status, "completed")
  assert.equal(report.records[0]?.disposition, "settled")
  assert.equal(report.records[0]?.current, true)
  assert.equal(report.records[1]?.entry.status, "pending")
  assert.equal(report.records[1]?.disposition, "superseded")
  assert.equal(report.records[1]?.current, false)
  assert.deepEqual(report.summary.dispositions, [{ count: 1, value: "settled" }])
  assert.deepEqual(report.attention, [])
  assert.equal(report.activityFilePathExposed, false)
  assert.equal(report.activityStateChanged, false)
  assert.equal(report.snapshotConsistency, "independent-local-reads")
  assert.equal(JSON.stringify(report).includes("/private/activity.jsonl"), false)
  assert.equal(verifyDiscordActivityReviewReport(report), true)
})

test("activity review correlates uncertain evidence only through both operation hashes", async () => {
  const matching = claim(`claim_${"1".repeat(32)}`)
  const differentPlan = claim(`claim_${"2".repeat(32)}`, {
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    state: "active",
  })
  const unmatched = claim(`claim_${"3".repeat(32)}`, {
    operationKeyHash: `sha256:${"e".repeat(64)}`,
    ownerState: "dead",
    receiptState: "failed",
    state: "auto-reclaimable",
  })
  const report = await reviewDiscordActivity("/private/activity.jsonl", 25, {
    activityStore: store([
      channelCreation("activity_b", "uncertain", "2026-08-24T12:00:02.000Z"),
    ]),
    async listCoordination() {
      return coordination([matching, differentPlan, unmatched])
    },
  })

  assert.equal(report.outcome, "attention")
  assert.equal(report.records[0]?.disposition, "uncertain")
  assert.deepEqual(report.records[0]?.claimIds, [matching.claimId])
  assert.deepEqual(report.attention[0]?.claimIds, [matching.claimId])
  assert.match(report.attention[0]?.guidance || "", /Do not retry/)
  assert.equal(report.summary.reviewRequiredClaims, 1)
  assert.equal(report.summary.unmatchedClaims, 2)
  assert.deepEqual(report.unmatchedClaimIds, [differentPlan.claimId, unmatched.claimId])
})

test("activity review classifies every current status family without false history alerts", async () => {
  const report = await reviewDiscordActivity("/private/activity.jsonl", 25, {
    activityStore: store([
      nativeInteraction("activity_pending", "accepted", "2026-08-24T12:00:05.000Z"),
      nativeInteraction("activity_followup_pending", "followup-pending", "2026-08-24T12:00:04.500Z"),
      channelCreation("activity_review", "completed-with-drift", "2026-08-24T12:00:04.000Z"),
      interaction("activity_failed", "failed", "2026-08-24T12:00:03.000Z"),
      nativeInteraction("activity_followup_failed", "followup-failed", "2026-08-24T12:00:02.500Z"),
      nativeInteraction("activity_uncertain", "response-uncertain", "2026-08-24T12:00:02.000Z"),
      nativeInteraction("activity_followup_uncertain", "followup-uncertain", "2026-08-24T12:00:01.500Z"),
      interaction("activity_settled", "noop", "2026-08-24T12:00:01.000Z"),
      nativeInteraction("activity_followup_settled", "followup-completed", "2026-08-24T12:00:00.500Z"),
      nativeInteraction("activity_continuation_settled", "continuation-expired", "2026-08-24T12:00:00.000Z"),
    ]),
    async listCoordination() {
      return coordination()
    },
  })

  assert.deepEqual(
    Object.fromEntries(report.records.map(({ disposition, entry }) => [entry.id, disposition])),
    {
      activity_failed: "review",
      activity_followup_failed: "review",
      activity_followup_pending: "pending",
      activity_followup_settled: "settled",
      activity_followup_uncertain: "uncertain",
      activity_continuation_settled: "settled",
      activity_pending: "pending",
      activity_review: "review",
      activity_settled: "settled",
      activity_uncertain: "uncertain",
    },
  )
  assert.equal(report.summary.attentionActivities, 7)
  assert.deepEqual(report.summary.dispositions, [
    { count: 2, value: "pending" },
    { count: 3, value: "review" },
    { count: 3, value: "settled" },
    { count: 2, value: "uncertain" },
  ])
})

test("activity review treats skipped input and review-required claims as attention", async () => {
  const report = await reviewDiscordActivity("/private/activity.jsonl", 10, {
    activityStore: store([], 2),
    async listCoordination() {
      return coordination([claim(`claim_${"4".repeat(32)}`)])
    },
  })

  assert.equal(report.outcome, "attention")
  assert.equal(report.skippedLines, 2)
  assert.equal(report.summary.reviewRequiredClaims, 1)
  assert.equal(report.summary.currentActivities, 0)
})

test("activity review is deterministic and its digest rejects changed evidence", async () => {
  const options = {
    activityStore: store([
      interaction("activity_c", "completed", "2026-08-24T12:00:00.000Z"),
    ]),
    async listCoordination() {
      return coordination()
    },
  }
  const first = await reviewDiscordActivity("/private/activity.jsonl", 25, options)
  const second = await reviewDiscordActivity("/private/activity.jsonl", 25, options)

  assert.deepEqual(second, first)
  assert.match(first.reportDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(verifyDiscordActivityReviewReport(first), true)
  assert.equal(verifyDiscordActivityReviewReport({
    ...first,
    skippedLines: first.skippedLines + 1,
  }), false)
})

test("activity review validates path and limit before reading local state", async () => {
  let reads = 0
  const options = {
    activityStore: {
      async append() {},
      async list() {
        reads += 1
        return { entries: [], file: "/private/activity.jsonl", skippedLines: 0 }
      },
    } satisfies ActivityStore,
    async listCoordination() {
      reads += 1
      return coordination()
    },
  }

  await assert.rejects(reviewDiscordActivity("relative.jsonl", 25, options), /absolute/)
  for (const limit of [0, 101, 1.5, Number.NaN]) {
    await assert.rejects(
      reviewDiscordActivity("/private/activity.jsonl", limit, options),
      /between 1 and 100/,
    )
  }
  assert.equal(reads, 0)
})

test("activity review leaves missing production state absent and clear", async () => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-activity-review-test-"))
  try {
    const report = await reviewDiscordActivity(join(directory, "activity.jsonl"))
    assert.equal(report.outcome, "clear")
    assert.deepEqual(report.records, [])
    assert.deepEqual(report.claims, [])
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("activity review joins and settles real local journal, receipt, and claim state", { timeout: 5_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-activity-review-state-test-"))
  const activityFile = join(directory, "activity.jsonl")
  const activityId = "activity_state"
  const activityLog = new JsonlActivityLog(activityFile)
  const operationStore = new FileOperationStore(operationReceiptDirectory(activityFile))
  const coordinator = new FileWriteCoordinator(
    writeCoordinationDirectory(activityFile),
    operationStore,
  )
  const pendingEntry = channelCreation(
    activityId,
    "pending",
    "2026-08-24T12:00:00.000Z",
  )
  const pendingReceipt = {
    activityId,
    error: null,
    guildId: GUILD_ID,
    kind: "channel-creation",
    operationKeyHash: OPERATION_KEY_HASH,
    planDigest: PLAN_DIGEST,
    resourceId: null,
    schemaVersion: 1,
    status: "pending",
    timestamp: pendingEntry.timestamp,
    verification: null,
  } satisfies StandardOperationReceipt
  let releaseOperation: (() => void) | undefined
  let reportActive: (() => void) | undefined
  let running: Promise<void> | undefined
  const operationGate = new Promise<void>((resolve) => {
    releaseOperation = resolve
  })
  const activeGate = new Promise<void>((resolve) => {
    reportActive = resolve
  })

  try {
    await activityLog.append(pendingEntry)
    await operationStore.reserve(pendingReceipt)
    running = coordinator.run({
      kind: pendingReceipt.kind,
      operationKeyHash: OPERATION_KEY_HASH,
      planDigest: PLAN_DIGEST,
      targets: [writeResourceTarget("channel", CHANNEL_ID)],
    }, async () => {
      reportActive?.()
      await operationGate
      const completedEntry = {
        ...channelCreation(
          activityId,
          "completed",
          "2026-08-24T12:00:01.000Z",
        ),
        verification: "match",
      } satisfies ChannelCreationActivity
      await activityLog.append(completedEntry)
      await operationStore.finish({
        ...pendingReceipt,
        resourceId: CHANNEL_ID,
        status: "completed",
        timestamp: completedEntry.timestamp,
        verification: "match",
      })
    })

    await activeGate
    const active = await reviewDiscordActivity(activityFile)
    assert.equal(active.outcome, "attention")
    assert.equal(active.records[0]?.disposition, "pending")
    assert.equal(active.claims[0]?.state, "active")
    assert.deepEqual(active.records[0]?.claimIds, [active.claims[0]?.claimId])

    releaseOperation?.()
    await running
    const settled = await reviewDiscordActivity(activityFile)
    assert.equal(settled.outcome, "clear")
    assert.equal(settled.records[0]?.disposition, "settled")
    assert.equal(settled.records[1]?.disposition, "superseded")
    assert.deepEqual(settled.claims, [])
  } finally {
    releaseOperation?.()
    await running?.catch(() => undefined)
    await rm(directory, { force: true, recursive: true })
  }
})
