import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
  ChannelCreationActivity,
  InteractionActivity,
} from "../src/activity-log.js"
import {
  ACTIVITY_HTML_FORMAT,
  ACTIVITY_HTML_SCHEMA_VERSION,
  exportDiscordActivityHtml,
  renderDiscordActivityHtml,
} from "../src/activity-html.js"
import {
  reviewDiscordActivity,
  type DiscordActivityReviewReport,
} from "../src/activity-review.js"
import { ConfigurationError } from "../src/errors.js"
import type {
  WriteCoordinationClaimStatus,
  WriteCoordinationList,
} from "../src/write-coordination.js"

const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const OPERATION_KEY_HASH = `sha256:${"a".repeat(64)}`
const PLAN_DIGEST = `hmac-sha256:${"b".repeat(64)}`
const AMBIENT_SECRET = "activity-html-ambient-secret"

function interaction(
  id: string,
  status: InteractionActivity["status"],
  timestamp: string,
  error: string | null = null,
): InteractionActivity {
  return {
    channelId: CHANNEL_ID,
    error,
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

function channelCreation(): ChannelCreationActivity {
  return {
    channelId: CHANNEL_ID,
    channelKind: "text",
    error: "DiscordApiError.500.unknown",
    guildId: GUILD_ID,
    id: "activity_uncertain",
    kind: "channel-create",
    operationKeyHash: OPERATION_KEY_HASH,
    parentId: null,
    planDigest: PLAN_DIGEST,
    schemaVersion: 1,
    status: "uncertain",
    timestamp: "2026-08-24T12:00:03.000Z",
    verification: null,
  }
}

function store(entries: ActivityEntry[], skippedLines = 0): ActivityStore {
  return {
    async append() {
      throw new Error("Activity HTML must not append")
    },
    async list() {
      return { entries, file: "/private/activity.jsonl", skippedLines }
    },
  }
}

function claim(): WriteCoordinationClaimStatus {
  return {
    claimId: `claim_${"1".repeat(32)}`,
    createdAt: "2026-08-24T12:00:02.000Z",
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
  }
}

function coordination(
  claims: WriteCoordinationClaimStatus[] = [],
): WriteCoordinationList {
  return { claims, schemaVersion: 1, status: "ok" }
}

async function activityReport(
  entries: ActivityEntry[] = [
    channelCreation(),
    interaction("activity_settled", "completed", "2026-08-24T12:00:02.000Z"),
    interaction("activity_settled", "pending", "2026-08-24T12:00:01.000Z"),
  ],
): Promise<DiscordActivityReviewReport> {
  return reviewDiscordActivity("/private/activity.jsonl", 25, {
    activityStore: store(entries, 1),
    async listCoordination() {
      return coordination([claim()])
    },
  })
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

test("activity HTML renders one exact private incident review", async () => {
  const report = await activityReport()
  const html = renderDiscordActivityHtml(report)
  const repeated = renderDiscordActivityHtml(report)

  assert.equal(repeated, html)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, new RegExp(ACTIVITY_HTML_FORMAT))
  assert.match(html, /Know what settled\. Stop where certainty ends\./)
  assert.match(html, /Snapshot outcome: attention/)
  assert.match(html, /Recent input was skipped/)
  assert.match(html, /data-disposition-filter="uncertain"/)
  assert.match(html, /id="activity-search"/)
  assert.match(html, /id="kind-filter"/)
  assert.match(html, /role="search" aria-label="Activity filters"/)
  assert.match(html, /Independent reads, not a global state lock/)
  assert.match(html, /Exact content-free record/)
  assert.match(html, /Exact content-free claim/)
  assert.match(html, /review-required/)
  assert.doesNotMatch(html, /no recent activity/)
  assert.match(html, /A newer record with the same activity ID/)
  assert.ok(html.includes(report.reportDigest))
  assert.ok(html.includes(GUILD_ID))
  assert.ok(html.includes(claim().claimId))
  assert.doesNotMatch(html, /\/private\/activity\.jsonl/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /default-src 'none'/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /img-src 'none'/)
  assert.match(html, /require-trusted-types-for 'script'/)
  assert.match(html, /meta name="referrer" content="no-referrer"/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.match(html, /<main id="main" class="shell" tabindex="-1">/)
  assert.match(html, /prefers-reduced-motion/)
  assert.match(html, /navigator\.clipboard\.writeText/)
  assert.doesNotMatch(html, /href="https:/)
  assert.doesNotMatch(html, /<script\s+src=/)
  assert.doesNotMatch(html, /<link\b/)
  assert.doesNotMatch(html, /url\(https?:/)
  assert.doesNotMatch(html, /\bfetch\s*\(/)
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|sendBeacon/)
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker/)

  const script = html.match(/<script>([\s\S]+)<\/script>/iu)?.[1]
  assert.ok(script)
  const expectedSource = `script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'`
  assert.ok(html.includes(expectedSource))
})

test("activity HTML escapes hostile local evidence before embedding it", async () => {
  const hostile = `</code><img src=x onerror="alert('activity')">&`
  const report = await activityReport([
    interaction(
      "activity_hostile",
      "failed",
      "2026-08-24T12:00:00.000Z",
      hostile,
    ),
  ])
  const html = renderDiscordActivityHtml(report)

  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<\/code><img/)
  assert.match(html, /no recent activity/)
  assert.ok(html.includes(escaped(hostile)))
  assert.ok(html.includes(escaped(JSON.stringify(hostile))))
})

test("activity HTML export is deterministic, exclusive, private, and credential-free", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-activity-html-test-"))
  const first = join(directory, "first.html")
  const second = join(directory, "second.html")
  const existing = join(directory, "existing.html")
  const report = await activityReport()
  const previousSecret = process.env.DISCORD_BOT_TOKEN
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  try {
    process.env.DISCORD_BOT_TOKEN = AMBIENT_SECRET
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error("Activity HTML attempted network access")
    }) as typeof fetch

    const firstReport = await exportDiscordActivityHtml(first, report)
    const secondReport = await exportDiscordActivityHtml(second, report)
    const firstBytes = await readFile(first)
    const secondBytes = await readFile(second)

    assert.deepEqual(secondBytes, firstBytes)
    assert.equal(firstReport.file, resolve(first))
    assert.equal(firstReport.format, ACTIVITY_HTML_FORMAT)
    assert.equal(firstReport.schemaVersion, ACTIVITY_HTML_SCHEMA_VERSION)
    assert.equal(firstReport.bytes, firstBytes.byteLength)
    assert.equal(firstReport.htmlDigest, `sha256:${sha256(firstBytes)}`)
    assert.equal(firstReport.reportDigest, report.reportDigest)
    assert.equal(secondReport.htmlDigest, firstReport.htmlDigest)
    assert.equal(firstReport.activityRecordsCreated, false)
    assert.equal(firstReport.activityStateChanged, false)
    assert.equal(firstReport.automaticNetwork, "disabled")
    assert.equal(firstReport.browserOpened, false)
    assert.equal(firstReport.credentialsEmbedded, false)
    assert.equal(firstReport.credentialsRequired, false)
    assert.equal(firstReport.discordContacted, false)
    assert.deepEqual(firstReport.externalNavigationOrigins, [])
    assert.equal(Object.isFrozen(firstReport.externalNavigationOrigins), true)
    assert.equal(firstReport.outputFileCreated, true)
    assert.equal(firstReport.statePersistence, "disabled")
    assert.equal(fetchCalls, 0)
    assert.equal((await stat(first)).mode & 0o777, 0o600)
    assert.doesNotMatch(firstBytes.toString("utf8"), new RegExp(AMBIENT_SECRET))
    assert.doesNotMatch(firstBytes.toString("utf8"), new RegExp(directory))

    await writeFile(existing, "operator-owned", "utf8")
    await assert.rejects(
      exportDiscordActivityHtml(existing, report),
      (error: unknown) => (
        error instanceof ConfigurationError
        && /already exists/.test(error.message)
        && !error.message.includes(existing)
      ),
    )
    assert.equal(await readFile(existing, "utf8"), "operator-owned")
  } finally {
    globalThis.fetch = originalFetch
    if (previousSecret === undefined) delete process.env.DISCORD_BOT_TOKEN
    else process.env.DISCORD_BOT_TOKEN = previousSecret
    await rm(directory, { force: true, recursive: true })
  }
})

test("activity HTML export validates report evidence before opening a file", async () => {
  const report = await activityReport()
  let opens = 0
  await assert.rejects(
    exportDiscordActivityHtml("/virtual/activity.html", {
      ...report,
      skippedLines: report.skippedLines + 1,
    }, {
      fileSystem: {
        async open() {
          opens += 1
          throw new Error("must not open")
        },
        async unlink() {},
      },
    }),
    /requires an exact activity-review report/,
  )
  assert.equal(opens, 0)
})

test("activity HTML export removes a partial file when an exclusive write fails", async () => {
  const report = await activityReport()
  const file = "/virtual/activity.html"
  const events: string[] = []

  await assert.rejects(
    exportDiscordActivityHtml(file, report, {
      fileSystem: {
        async open(received, flags, mode) {
          assert.equal(received, file)
          assert.equal(flags, "wx")
          assert.equal(mode, 0o600)
          events.push("open")
          return {
            async close() {
              events.push("close")
            },
            async sync() {
              events.push("sync")
            },
            async writeFile() {
              events.push("write")
              throw new Error("simulated storage failure")
            },
          }
        },
        async unlink(received) {
          assert.equal(received, file)
          events.push("unlink")
        },
      },
    }),
    (error: unknown) => (
      error instanceof ConfigurationError
      && error.message === "Activity HTML export could not be written"
    ),
  )
  assert.deepEqual(events, ["open", "write", "close", "unlink"])
})

test("activity HTML export rejects invalid paths before report validation", async () => {
  const report = await activityReport()
  const invalid = { ...report, reportDigest: `sha256:${"0".repeat(64)}` }
  for (const file of ["", "  ", "bad\0path"]) {
    await assert.rejects(
      exportDiscordActivityHtml(file, invalid),
      /requires a valid file path/,
    )
  }
})
