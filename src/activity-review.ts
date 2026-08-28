import { createHash } from "node:crypto"
import { isAbsolute } from "node:path"

import {
  JsonlActivityLog,
  type ActivityEntry,
  type ActivityStore,
} from "./activity-log.js"
import { CONNECTOR_LIMITS } from "./constants.js"
import { ConfigurationError } from "./errors.js"
import {
  FileOperationStore,
  operationReceiptDirectory,
} from "./operation-store.js"
import {
  FileWriteCoordinator,
  writeCoordinationDirectory,
  type WriteCoordinationClaimStatus,
  type WriteCoordinationList,
} from "./write-coordination.js"

export const ACTIVITY_REVIEW_FORMAT = "discord-mcp.activity-review.v1"
export const ACTIVITY_REVIEW_SCHEMA_VERSION = 1

export const ACTIVITY_REVIEW_DISPOSITIONS = Object.freeze([
  "pending",
  "review",
  "settled",
  "superseded",
  "uncertain",
] as const)

export type ActivityReviewDisposition =
  typeof ACTIVITY_REVIEW_DISPOSITIONS[number]

export interface ActivityReviewCount {
  count: number
  value: string
}

export interface ActivityReviewRecord {
  claimIds: string[]
  current: boolean
  disposition: ActivityReviewDisposition
  entry: ActivityEntry
  guidance: string
}

export interface ActivityReviewAttention {
  activityId: string
  claimIds: string[]
  disposition: Exclude<ActivityReviewDisposition, "settled" | "superseded">
  guidance: string
  kind: ActivityEntry["kind"]
  status: ActivityEntry["status"]
  timestamp: string
}

export interface ActivityReviewSummary {
  attentionActivities: number
  currentActivities: number
  dispositions: ActivityReviewCount[]
  kinds: ActivityReviewCount[]
  records: number
  reviewRequiredClaims: number
  statuses: ActivityReviewCount[]
  unmatchedClaims: number
}

export interface DiscordActivityReviewReport {
  activityRecordsCreated: false
  attention: ActivityReviewAttention[]
  browserOpened: false
  claims: WriteCoordinationClaimStatus[]
  contentExcluded: readonly [
    "credentials",
    "message-content",
    "attachment-urls",
    "embeds",
    "components",
    "discord-names",
    "audit-reasons",
    "raw-operation-keys",
    "local-paths",
  ]
  credentialRead: false
  credentialsRequired: false
  discordContacted: false
  format: typeof ACTIVITY_REVIEW_FORMAT
  gatewayOpened: false
  limit: number
  activityFilePathExposed: false
  outcome: "attention" | "clear"
  records: ActivityReviewRecord[]
  reportDigest: string
  schemaVersion: typeof ACTIVITY_REVIEW_SCHEMA_VERSION
  skippedLines: number
  snapshotConsistency: "independent-local-reads"
  activityStateChanged: false
  status: "ok"
  summary: ActivityReviewSummary
  telemetryStarted: false
  unmatchedClaimIds: string[]
}

export interface DiscordActivityReviewOptions {
  activityStore?: ActivityStore
  listCoordination?: () => Promise<WriteCoordinationList>
}

type UnsignedDiscordActivityReviewReport = Omit<
  DiscordActivityReviewReport,
  "reportDigest"
>

const PENDING_STATUSES = new Set<string>([
  "accepted",
  "continuation-opened",
  "followup-pending",
  "pending",
  "response-pending",
])

const SETTLED_STATUSES = new Set<string>([
  "completed",
  "continuation-expired",
  "followup-completed",
  "noop",
  "response-completed",
])

const UNCERTAIN_STATUSES = new Set<string>([
  "followup-uncertain",
  "response-uncertain",
  "uncertain",
])

const GUIDANCE = Object.freeze({
  pending: "Check coordination and process ownership before acting; do not retry while the operation may still be running",
  review: "Inspect the fixed error and verification evidence, then create a fresh plan and operation key before any retry",
  settled: "No recovery action is indicated by the current record",
  superseded: "A newer record with the same activity ID determines the current outcome",
  uncertain: "Do not retry; inspect the exact Discord target and audit log, then resolve only a review-required claim after stopping its owner",
}) satisfies Record<ActivityReviewDisposition, string>

const CONTENT_EXCLUDED = Object.freeze([
  "credentials",
  "message-content",
  "attachment-urls",
  "embeds",
  "components",
  "discord-names",
  "audit-reasons",
  "raw-operation-keys",
  "local-paths",
] as const)

function activityReviewDigest(
  report: UnsignedDiscordActivityReviewReport,
): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(report)).digest("hex")}`
}

export function verifyDiscordActivityReviewReport(
  report: DiscordActivityReviewReport,
): boolean {
  const { reportDigest, ...unsigned } = report
  return report.format === ACTIVITY_REVIEW_FORMAT
    && report.schemaVersion === ACTIVITY_REVIEW_SCHEMA_VERSION
    && report.status === "ok"
    && report.credentialsRequired === false
    && report.credentialRead === false
    && report.discordContacted === false
    && report.activityFilePathExposed === false
    && report.snapshotConsistency === "independent-local-reads"
    && report.activityStateChanged === false
    && report.records.length <= report.limit
    && JSON.stringify(report.contentExcluded) === JSON.stringify(CONTENT_EXCLUDED)
    && /^sha256:[a-f0-9]{64}$/.test(reportDigest)
    && activityReviewDigest(unsigned) === reportDigest
}

function dispositionForStatus(
  status: ActivityEntry["status"],
): Exclude<ActivityReviewDisposition, "superseded"> {
  if (SETTLED_STATUSES.has(status)) return "settled"
  if (PENDING_STATUSES.has(status)) return "pending"
  if (UNCERTAIN_STATUSES.has(status)) return "uncertain"
  return "review"
}

function countValues(values: readonly string[]): ActivityReviewCount[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({ count, value }))
}

function operationIdentity(
  entry: ActivityEntry,
): { operationKeyHash: string; planDigest: string } | undefined {
  if (
    "operationKeyHash" in entry
    && typeof entry.operationKeyHash === "string"
    && "planDigest" in entry
    && typeof entry.planDigest === "string"
  ) {
    return {
      operationKeyHash: entry.operationKeyHash,
      planDigest: entry.planDigest,
    }
  }
  return undefined
}

function correlatedClaimIds(
  entry: ActivityEntry,
  claims: readonly WriteCoordinationClaimStatus[],
): string[] {
  const identity = operationIdentity(entry)
  if (!identity) return []
  return claims
    .filter((claim) => (
      claim.operationKeyHash === identity.operationKeyHash
      && claim.planDigest === identity.planDigest
    ))
    .map(({ claimId }) => claimId)
    .sort()
}

function normalizeRecentEntries(entries: readonly ActivityEntry[]): ActivityEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => (
      right.entry.timestamp.localeCompare(left.entry.timestamp)
      || left.index - right.index
    ))
    .map(({ entry }) => entry)
}

function buildRecords(
  entries: readonly ActivityEntry[],
  claims: readonly WriteCoordinationClaimStatus[],
): ActivityReviewRecord[] {
  const currentIds = new Set<string>()
  return normalizeRecentEntries(entries).map((entry) => {
    const current = !currentIds.has(entry.id)
    currentIds.add(entry.id)
    const disposition = current
      ? dispositionForStatus(entry.status)
      : "superseded"
    return {
      claimIds: correlatedClaimIds(entry, claims),
      current,
      disposition,
      entry,
      guidance: GUIDANCE[disposition],
    }
  })
}

function buildAttention(
  records: readonly ActivityReviewRecord[],
): ActivityReviewAttention[] {
  return records.flatMap((record) => {
    if (
      !record.current
      || record.disposition === "settled"
      || record.disposition === "superseded"
    ) return []
    return [{
      activityId: record.entry.id,
      claimIds: [...record.claimIds],
      disposition: record.disposition,
      guidance: record.guidance,
      kind: record.entry.kind,
      status: record.entry.status,
      timestamp: record.entry.timestamp,
    }]
  })
}

function normalizedLimit(limit: number): number {
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > CONNECTOR_LIMITS.activityEntries
  ) {
    throw new ConfigurationError(
      `Activity limit must be between 1 and ${CONNECTOR_LIMITS.activityEntries}`,
    )
  }
  return limit
}

export async function reviewDiscordActivity(
  activityFile: string,
  limit: number = CONNECTOR_LIMITS.activityPageDefault,
  options: DiscordActivityReviewOptions = {},
): Promise<DiscordActivityReviewReport> {
  if (!activityFile.trim() || !isAbsolute(activityFile)) {
    throw new ConfigurationError("Activity review requires an absolute activity-file path")
  }
  const boundedLimit = normalizedLimit(limit)
  const store = options.activityStore || new JsonlActivityLog(activityFile)
  const listCoordination = options.listCoordination || (() => (
    new FileWriteCoordinator(
      writeCoordinationDirectory(activityFile),
      new FileOperationStore(operationReceiptDirectory(activityFile)),
    ).list()
  ))
  const [activity, coordination] = await Promise.all([
    store.list(boundedLimit),
    listCoordination(),
  ])
  if (activity.entries.length > boundedLimit) {
    throw new ConfigurationError("Activity review source exceeded the requested limit")
  }
  const claims = [...coordination.claims].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt)
    || left.claimId.localeCompare(right.claimId)
  ))
  const records = buildRecords(activity.entries, claims)
  const currentRecords = records.filter(({ current }) => current)
  const attention = buildAttention(records)
  const matchedClaimIds = new Set(records.flatMap(({ claimIds }) => claimIds))
  const unmatchedClaimIds = claims
    .map(({ claimId }) => claimId)
    .filter((claimId) => !matchedClaimIds.has(claimId))
    .sort()
  const reviewRequiredClaims = claims.filter(({ state }) => state === "review-required").length
  const unsigned = {
    activityRecordsCreated: false,
    attention,
    browserOpened: false,
    claims,
    contentExcluded: CONTENT_EXCLUDED,
    credentialRead: false,
    credentialsRequired: false,
    discordContacted: false,
    format: ACTIVITY_REVIEW_FORMAT,
    gatewayOpened: false,
    limit: boundedLimit,
    activityFilePathExposed: false,
    outcome: attention.length > 0 || reviewRequiredClaims > 0 || activity.skippedLines > 0
      ? "attention"
      : "clear",
    records,
    schemaVersion: ACTIVITY_REVIEW_SCHEMA_VERSION,
    skippedLines: activity.skippedLines,
    snapshotConsistency: "independent-local-reads",
    activityStateChanged: false,
    status: "ok",
    summary: {
      attentionActivities: attention.length,
      currentActivities: currentRecords.length,
      dispositions: countValues(currentRecords.map(({ disposition }) => disposition)),
      kinds: countValues(currentRecords.map(({ entry }) => entry.kind)),
      records: records.length,
      reviewRequiredClaims,
      statuses: countValues(currentRecords.map(({ entry }) => entry.status)),
      unmatchedClaims: unmatchedClaimIds.length,
    },
    telemetryStarted: false,
    unmatchedClaimIds,
  } satisfies UnsignedDiscordActivityReviewReport
  return {
    ...unsigned,
    reportDigest: activityReviewDigest(unsigned),
  }
}
