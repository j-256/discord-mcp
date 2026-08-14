import assert from "node:assert/strict"
import {
  appendFile,
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  JsonlActivityLog,
  type DeletionActivity,
} from "../src/activity-log.js"

function activity(id: string, status: DeletionActivity["status"]): DeletionActivity {
  return {
    channelId: "200",
    deletedMessageIds: status === "completed" ? ["300"] : [],
    error: null,
    failedMessageId: null,
    guildId: "100",
    id,
    messageIds: ["300"],
    planDigest: "hmac-sha256:test",
    schemaVersion: 1,
    status,
    strategies: ["individual:1"],
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
  }
}

test("JSONL activity log appends privately and reads newest first", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "nested", "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(activity("1", "pending"))
  await store.append(activity("2", "completed"))
  const result = await store.list(10)
  const mode = (await stat(file)).mode & 0o777

  assert.equal(mode, 0o600)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 0)
  assert.equal(result.file, file)
})

test("JSONL activity log tolerates malformed historical lines", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(activity("1", "completed"))
  await appendFile(
    file,
    `${JSON.stringify({ ...activity("2", "completed"), content: "private" })}\nnot-json\n{}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

test("JSONL activity log returns an empty result before the first deletion", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")

  const result = await new JsonlActivityLog(file).list()

  assert.deepEqual(result, {
    entries: [],
    file,
    skippedLines: 0,
  })
})
