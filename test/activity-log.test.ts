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
  type ChannelCreationActivity,
  type DeletionActivity,
  type InteractionActivity,
  type MemberModerationActivity,
} from "../src/activity-log.js"

function activity(id: string, status: DeletionActivity["status"]): DeletionActivity {
  return {
    channelId: "200",
    deletedMessageIds: status === "completed" ? ["300"] : [],
    error: null,
    failedMessageId: null,
    guildId: "100",
    id,
    kind: "message-deletion",
    messageIds: ["300"],
    planDigest: "hmac-sha256:test",
    schemaVersion: 1,
    status,
    strategies: ["individual:1"],
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
  }
}

function interaction(id: string, status: InteractionActivity["status"]): InteractionActivity {
  return {
    channelId: "200",
    error: null,
    guildId: "100",
    id,
    kind: "message-send",
    messageId: status === "pending" ? null : "300",
    nonce: "stable-nonce",
    replyToMessageId: null,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
  }
}

function moderation(
  id: string,
  status: MemberModerationActivity["status"],
): MemberModerationActivity {
  return {
    action: "timeout",
    deleteMessageSeconds: null,
    durationMinutes: 60,
    error: null,
    guildId: "100",
    id,
    kind: "member-moderation",
    planDigest: "hmac-sha256:test",
    schemaVersion: 1,
    status,
    timeoutUntil: status === "pending" ? null : "2026-08-14T01:00:00.000Z",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
  }
}

function channelCreation(
  id: string,
  status: ChannelCreationActivity["status"],
): ChannelCreationActivity {
  return {
    channelId: status.startsWith("completed") ? "250" : null,
    channelKind: "text",
    error: null,
    guildId: "100",
    id,
    kind: "channel-create",
    operationKeyHash: `sha256:${"a".repeat(64)}`,
    parentId: "200",
    planDigest: `hmac-sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
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

  const legacy = activity("1", "completed") as Partial<DeletionActivity>
  delete legacy.kind
  await appendFile(file, `${JSON.stringify(legacy)}\n`, "utf8")
  await appendFile(
    file,
    `${JSON.stringify({ ...activity("2", "completed"), content: "private" })}\nnot-json\n{}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.doesNotMatch(JSON.stringify(result), /private/)
  assert.equal(result.entries.at(-1)?.kind, "message-deletion")
})

test("JSONL activity log accepts content-free interaction records without surfacing extra data", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(interaction("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({ ...interaction("2", "completed"), content: "must-not-surface", emoji: "secret" })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.doesNotMatch(JSON.stringify(result), /must-not-surface|secret/)
})

test("JSONL activity log strips profile data and reasons from member moderation records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(moderation("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({
      ...moderation("2", "completed"),
      auditReason: "private reason",
      nickname: "private nickname",
      roleNames: ["private role"],
      username: "private username",
    })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.doesNotMatch(
    JSON.stringify(result),
    /private reason|private nickname|private role|private username/,
  )
  assert.equal(result.entries[0]?.kind, "member-moderation")
})

test("JSONL activity log strips channel content and raw operation keys from creation records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(channelCreation("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({
      ...channelCreation("2", "completed-with-drift"),
      auditReason: "private audit reason",
      name: "private-channel-name",
      operationKey: "private-operation-key",
      permissionOverwrites: [{ id: "private-role" }],
      topic: "private topic",
    })}\n${JSON.stringify({
      ...channelCreation("3", "failed"),
      error: "private error text with spaces",
      operationKeyHash: "private topic in a typed field",
    })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "channel-create")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private-channel|private-operation|private-role|private topic/,
  )
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
