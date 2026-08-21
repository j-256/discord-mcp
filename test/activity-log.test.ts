import assert from "node:assert/strict"
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  JsonlActivityLog,
  type AttachmentMessageActivity,
  type ChannelCreationActivity,
  type ChannelPermissionOverwriteActivity,
  type DeletionActivity,
  type ForumPostActivity,
  type InteractionActivity,
  type MemberModerationActivity,
  type MessagePinActivity,
  type RoleCreationActivity,
  type WebhookDeletionActivity,
} from "../src/activity-log.js"

function attachmentMessage(
  id: string,
  status: AttachmentMessageActivity["status"],
): AttachmentMessageActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status) ? "DiscordApiError.500.unknown" : null,
    guildId: "100",
    id,
    kind: "attachment-message-send",
    messageId: ["completed", "uncertain"].includes(status) ? "300" : null,
    operationKeyHash: `sha256:${"e".repeat(64)}`,
    planDigest: `hmac-sha256:${"f".repeat(64)}`,
    replyToMessageId: "400",
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

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

function roleCreation(
  id: string,
  status: RoleCreationActivity["status"],
): RoleCreationActivity {
  return {
    error: null,
    guildId: "100",
    id,
    kind: "role-create",
    operationKeyHash: `sha256:${"c".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    roleId: status.startsWith("completed") ? "350" : null,
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

function forumPost(
  id: string,
  status: ForumPostActivity["status"],
): ForumPostActivity {
  const hasThread = [
    "completed",
    "completed-with-drift",
    "uncertain",
  ].includes(status)
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "forum-post-create",
    messageId: hasThread ? "300" : null,
    operationKeyHash: `sha256:${"1".repeat(64)}`,
    parentChannelId: "200",
    planDigest: `hmac-sha256:${"2".repeat(64)}`,
    schemaVersion: 1,
    status,
    threadId: hasThread ? "300" : null,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function messagePin(
  id: string,
  status: MessagePinActivity["status"],
): MessagePinActivity {
  return {
    channelId: "200",
    desiredState: "pinned",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "message-pin",
    messageId: "300",
    operationKeyHash: `sha256:${"3".repeat(64)}`,
    planDigest: `hmac-sha256:${"4".repeat(64)}`,
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

function webhookDeletion(
  id: string,
  status: WebhookDeletionActivity["status"],
): WebhookDeletionActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "webhook-deletion",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
    webhookId: "300",
  }
}

function channelPermissionOverwrite(
  id: string,
  status: ChannelPermissionOverwriteActivity["status"],
): ChannelPermissionOverwriteActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "channel-permission-overwrite",
    mode: "update",
    operationKeyHash: `sha256:${"5".repeat(64)}`,
    planDigest: `hmac-sha256:${"6".repeat(64)}`,
    schemaVersion: 1,
    status,
    targetId: "300",
    targetType: "role",
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

test("JSONL activity log strips role content and raw operation keys from creation records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(roleCreation("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({
      ...roleCreation("2", "completed-with-drift"),
      auditReason: "private audit reason",
      name: "private-role-name",
      operationKey: "private-operation-key",
      permissions: ["private permission"],
    })}\n${JSON.stringify({
      ...roleCreation("3", "failed"),
      error: "private error text with spaces",
      operationKeyHash: "private role in a typed field",
    })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "role-create")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private-role|private-operation|private permission|private role/,
  )
})

test("JSONL activity log strips all attachment and message content from attachment records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...attachmentMessage("1", "pending"),
    content: "must never reach disk",
    filePath: "/private/must-not-persist.txt",
  } as AttachmentMessageActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...attachmentMessage("2", "completed"),
      attachmentUrl: "https://cdn.discordapp.com/private",
      content: "private message",
      description: "private description",
      fileDigest: "private digest",
      filePath: "/private/report.txt",
      filename: "private-name.txt",
      notifyUserIds: ["private user"],
      operationKey: "private-operation-key",
      sizeBytes: 123,
    })}\n${JSON.stringify({
      ...attachmentMessage("3", "failed"),
      error: "private error text with spaces",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "attachment-message-send")
  assert.doesNotMatch(
    JSON.stringify(result),
    /cdn\.discordapp|private message|private description|private digest|private\/report|private-name|private user|private-operation|sizeBytes/,
  )
})

test("JSONL activity log strips forum-post intent and rejects mismatched starter IDs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...forumPost("1", "pending"),
    content: "must never reach disk",
    name: "must-not-persist",
  } as ForumPostActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...forumPost("2", "completed-with-drift"),
      appliedTagIds: ["private-tag"],
      auditReason: "private audit reason",
      content: "private starter content",
      name: "private forum title",
      notifyUserIds: ["private user"],
      operationKey: "private-operation-key",
    })}\n${JSON.stringify({
      ...forumPost("3", "completed"),
      messageId: "301",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "forum-post-create")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-tag|private audit|private starter|private forum|private user|private-operation/,
  )
})

test("JSONL activity log keeps message pin evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...messagePin("1", "pending"),
    auditReason: "must never reach disk",
    content: "must-not-persist",
  } as MessagePinActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...messagePin("2", "completed-with-drift"),
      auditReason: "private audit reason",
      authorName: "private author",
      channelName: "private channel",
      content: "private message content",
      operationKey: "private-operation-key",
    })}\n${JSON.stringify({
      ...messagePin("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "message-pin")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private author|private channel|private message|private-operation/,
  )
})

test("JSONL activity log keeps permission-overwrite evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...channelPermissionOverwrite("1", "pending"),
    auditReason: "must never reach disk",
    permission: "SEND_MESSAGES",
    rawOperationKey: "must-not-persist",
  } as ChannelPermissionOverwriteActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...channelPermissionOverwrite("2", "completed-with-drift"),
      allow: "private bitfield",
      auditReason: "private audit reason",
      channelName: "private channel",
      permissionName: "private permission",
      roleName: "private role",
    })}\n${JSON.stringify({
      ...channelPermissionOverwrite("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "channel-permission-overwrite")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private bitfield|private channel|private permission|private role/,
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

test("JSONL activity log keeps webhook deletion evidence credential-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-creator-profile",
    "private-operation-key",
    "private-webhook-name",
    "private-webhook-secret",
    "private-webhook-url",
  ]

  await store.append(webhookDeletion("1", "pending"))
  await store.append({
    ...webhookDeletion("2", "completed"),
    auditReason: privateValues[0],
    creatorProfile: privateValues[1],
    operationKey: privateValues[2],
    name: privateValues[3],
    token: privateValues[4],
    url: privateValues[5],
  } as WebhookDeletionActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...webhookDeletion("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
      "webhookId",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})
