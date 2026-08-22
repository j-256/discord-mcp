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
  type AutoModerationActivity,
  type ChannelCreationActivity,
  type ChannelMetadataActivity,
  type ChannelPermissionOverwriteActivity,
  type DeletionActivity,
  type ForumPostActivity,
  type GuildExpressionActivity,
  type InteractionActivity,
  type InviteDeletionActivity,
  type MemberModerationActivity,
  type MemberRoleActivity,
  type MemberVoiceActivity,
  type MessagePinActivity,
  type OnboardingActivity,
  type PollActivity,
  type RoleCreationActivity,
  type RoleConfigurationActivity,
  type ScheduledEventActivity,
  type SoundboardActivity,
  type StageInstanceActivity,
  type ThreadCreationActivity,
  type WebhookDeletionActivity,
  type WelcomeScreenActivity,
  type WidgetSettingsActivity,
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

function channelMetadataChange(
  id: string,
  status: ChannelMetadataActivity["status"],
): ChannelMetadataActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "channel-metadata-change",
    operationKeyHash: `sha256:${"d".repeat(64)}`,
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
    requestedFields: ["name", "topic"],
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

function roleConfiguration(
  id: string,
  status: RoleConfigurationActivity["status"],
): RoleConfigurationActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "role-configuration",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    requestedFields: ["name", "grantPermissions"],
    roleId: "350",
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

function pollActivity(
  id: string,
  kind: PollActivity["kind"],
  status: PollActivity["status"],
): PollActivity {
  const terminalMessage = [
    "completed",
    "completed-with-drift",
  ].includes(status)
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind,
    messageId: terminalMessage || kind === "poll-end" && status === "pending"
      ? "300"
      : null,
    operationKeyHash: `sha256:${"9".repeat(64)}`,
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
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

function memberRole(
  id: string,
  status: MemberRoleActivity["status"],
): MemberRoleActivity {
  return {
    action: "add",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "member-role-change",
    operationKeyHash: `sha256:${"5".repeat(64)}`,
    planDigest: `hmac-sha256:${"6".repeat(64)}`,
    roleId: "350",
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function memberVoice(
  id: string,
  status: MemberVoiceActivity["status"],
): MemberVoiceActivity {
  return {
    action: "move",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "member-voice-change",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
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

function threadCreation(
  id: string,
  status: ThreadCreationActivity["status"],
): ThreadCreationActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "thread-create",
    mode: "from-message",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    parentChannelId: "200",
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    sourceMessageId: "300",
    status,
    threadId: ["completed", "completed-with-drift", "uncertain"].includes(status)
      ? "300"
      : null,
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

function inviteDeletion(
  id: string,
  status: InviteDeletionActivity["status"],
): InviteDeletionActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    inviteRef: `iref_hmac_sha256_${"6".repeat(64)}`,
    kind: "invite-deletion",
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
  }
}

function onboardingChange(
  id: string,
  status: OnboardingActivity["status"],
): OnboardingActivity {
  return {
    enabled: true,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "onboarding-change",
    operationKeyHash: `sha256:${"8".repeat(64)}`,
    planDigest: `hmac-sha256:${"9".repeat(64)}`,
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

function welcomeScreenChange(
  id: string,
  status: WelcomeScreenActivity["status"],
): WelcomeScreenActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "welcome-screen-change",
    operationKeyHash: `sha256:${"a".repeat(64)}`,
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

function widgetSettingsChange(
  id: string,
  status: WidgetSettingsActivity["status"],
): WidgetSettingsActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "widget-settings-change",
    operationKeyHash: `sha256:${"c".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
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

function guildExpression(
  id: string,
  status: GuildExpressionActivity["status"],
): GuildExpressionActivity {
  return {
    action: "create",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    expressionId: ["completed", "completed-with-drift", "uncertain"]
      .includes(status)
      ? "300"
      : null,
    expressionKind: "emoji",
    guildId: "100",
    id,
    kind: "guild-expression-change",
    operationKeyHash: `sha256:${"9".repeat(64)}`,
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
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

function scheduledEvent(
  id: string,
  status: ScheduledEventActivity["status"],
): ScheduledEventActivity {
  return {
    action: "transition",
    entityType: "voice",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    eventId: "300",
    guildId: "100",
    id,
    kind: "scheduled-event-change",
    operationKeyHash: `sha256:${"b".repeat(64)}`,
    planDigest: `hmac-sha256:${"c".repeat(64)}`,
    schemaVersion: 1,
    status,
    targetStatus: "active",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function soundboard(
  id: string,
  status: SoundboardActivity["status"],
): SoundboardActivity {
  return {
    action: "create",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "guild-soundboard-change",
    operationKeyHash: `sha256:${"c".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    schemaVersion: 1,
    soundId: ["completed", "completed-with-drift", "uncertain"]
      .includes(status)
      ? "300"
      : null,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function stageInstance(
  id: string,
  status: StageInstanceActivity["status"],
): StageInstanceActivity {
  return {
    action: "update",
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "stage-instance-change",
    operationKeyHash: `sha256:${"d".repeat(64)}`,
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
    schemaVersion: 1,
    stageInstanceId: ["completed", "completed-with-drift", "uncertain"]
      .includes(status)
      ? "300"
      : null,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function autoModeration(
  id: string,
  status: AutoModerationActivity["status"],
): AutoModerationActivity {
  return {
    action: "set-enabled",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "automod-change",
    operationKeyHash: `sha256:${"d".repeat(64)}`,
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
    ruleId: "300",
    schemaVersion: 1,
    status,
    targetEnabled: true,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    triggerType: "keyword",
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
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

test("JSONL activity log keeps role-configuration evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-role-name",
    "private-operation-key",
    "private-permission-data",
  ]

  await store.append(roleConfiguration("1", "pending"))
  await store.append({
    ...roleConfiguration("2", "completed"),
    auditReason: privateValues[0],
    name: privateValues[1],
    operationKey: privateValues[2],
    permissions: privateValues[3],
  } as RoleConfigurationActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...roleConfiguration("3", "completed"),
      requestedFields: ["name", "privateFutureField"],
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
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "requestedFields",
      "roleId",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log strips poll content and enforces pending identity shape", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private poll question",
    "private poll answer",
    "private-operation-key",
    "private voter identity",
  ]

  await store.append({
    ...pollActivity("1", "poll-create", "pending"),
    answers: [privateValues[1]],
    operationKey: privateValues[2],
    question: privateValues[0],
    voterUserIds: [privateValues[3]],
  } as PollActivity)
  await store.append({
    ...pollActivity("2", "poll-end", "completed-with-drift"),
    answers: [privateValues[1]],
    question: privateValues[0],
  } as PollActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...pollActivity("3", "poll-create", "pending"),
      messageId: "300",
    })}\n${JSON.stringify({
      ...pollActivity("4", "poll-end", "pending"),
      messageId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "messageId",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps member-role evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...memberRole("1", "pending"),
    auditReason: "must never reach disk",
    memberName: "must-not-persist",
  } as MemberRoleActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...memberRole("2", "completed-with-drift"),
      auditReason: "private audit reason",
      channelNames: ["private channel"],
      operationKey: "private-operation-key",
      permissionNames: ["private permission"],
      roleName: "private role",
      username: "private member",
    })}\n${JSON.stringify({
      ...memberRole("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "member-role-change")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private channel|private-operation|private permission|private role|private member/,
  )
})

test("JSONL activity log keeps member voice evidence and state content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...memberVoice("1", "pending"),
    destinationChannelId: "must-never-reach-disk",
    enabled: true,
    sourceChannelId: "must-not-persist",
  } as MemberVoiceActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...memberVoice("2", "completed-with-drift"),
      auditReason: "private audit reason",
      channelName: "private voice channel",
      destinationChannelId: "private destination",
      enabled: true,
      operationKey: "private-operation-key",
      permissionNames: ["private permission"],
      serverMuted: true,
      sourceChannelId: "private source",
      username: "private member",
    })}\n${JSON.stringify({
      ...memberVoice("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must-never-reach-disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "member-voice-change")
  assert.deepEqual(Object.keys(result.entries[0] || {}).sort(), [
    "action",
    "error",
    "guildId",
    "id",
    "kind",
    "operationKeyHash",
    "planDigest",
    "schemaVersion",
    "status",
    "timestamp",
    "userId",
    "verification",
  ])
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private destination|private member|private permission|private source|private voice|serverMuted/,
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

test("JSONL activity log keeps thread-creation evidence content-free and mode exact", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...threadCreation("1", "pending"),
    auditReason: "must never reach disk",
    name: "must-not-persist",
    sourceContent: "must-not-persist",
  } as ThreadCreationActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...threadCreation("2", "completed-with-drift"),
      auditReason: "private reason",
      name: "private thread name",
      operationKey: "private-operation-key",
      sourceProfile: "private profile",
    })}\n${JSON.stringify({
      ...threadCreation("3", "completed"),
      mode: "standalone-public",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "thread-create")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private reason|private thread|private-operation|private profile/,
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

test("JSONL activity log keeps invite deletion evidence capability-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-invite-code",
    "private-invite-url",
    "private-inviter-profile",
    "private-operation-key",
  ]

  await store.append(inviteDeletion("1", "pending"))
  await store.append({
    ...inviteDeletion("2", "completed"),
    auditReason: privateValues[0],
    code: privateValues[1],
    url: privateValues[2],
    inviterProfile: privateValues[3],
    operationKey: privateValues[4],
  } as InviteDeletionActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...inviteDeletion("3", "completed"),
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
      "inviteRef",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps onboarding evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-onboarding-description",
    "private-onboarding-option",
    "private-onboarding-prompt",
    "private-operation-key",
    "private-role-name",
  ]

  await store.append(onboardingChange("1", "pending"))
  await store.append({
    ...onboardingChange("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    description: privateValues[2],
    optionTitle: privateValues[3],
    promptTitle: privateValues[4],
    operationKey: privateValues[5],
    roleName: privateValues[6],
  } as OnboardingActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...onboardingChange("3", "completed"),
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
      "enabled",
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
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps Welcome Screen evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-id",
    "private-description",
    "private-emoji-name",
    "private-operation-key",
  ]

  await store.append(welcomeScreenChange("1", "pending"))
  await store.append({
    ...welcomeScreenChange("2", "completed"),
    auditReason: privateValues[0],
    channelId: privateValues[1],
    description: privateValues[2],
    emojiName: privateValues[3],
    operationKey: privateValues[4],
  } as WelcomeScreenActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...welcomeScreenChange("3", "completed-with-drift"),
      verification: "match",
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
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps widget-settings evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-id",
    "private-operation-key",
  ]

  await store.append(widgetSettingsChange("1", "pending"))
  await store.append({
    ...widgetSettingsChange("2", "completed"),
    auditReason: privateValues[0],
    channelId: privateValues[1],
    enabled: true,
    operationKey: privateValues[2],
  } as WidgetSettingsActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...widgetSettingsChange("3", "completed-with-drift"),
      verification: "match",
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
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps channel metadata evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-channel-topic",
    "private-operation-key",
  ]

  await store.append(channelMetadataChange("1", "pending"))
  await store.append({
    ...channelMetadataChange("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    channelTopic: privateValues[2],
    operationKey: privateValues[3],
  } as ChannelMetadataActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...channelMetadataChange("3", "completed"),
      requestedFields: ["name", "privateFutureField"],
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
      "requestedFields",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps guild expression evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-description",
    "private-expression-name",
    "private-file-path",
    "private-image-bytes",
    "private-operation-key",
    "private-sticker-tags",
    "private-uploader-profile",
  ]

  await store.append(guildExpression("1", "pending"))
  await store.append({
    ...guildExpression("2", "completed"),
    auditReason: privateValues[0],
    description: privateValues[1],
    name: privateValues[2],
    filePath: privateValues[3],
    imageBytes: privateValues[4],
    operationKey: privateValues[5],
    tags: privateValues[6],
    uploaderProfile: privateValues[7],
  } as GuildExpressionActivity)
  await store.append({
    ...guildExpression("4", "completed"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...guildExpression("3", "completed"),
      expressionId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "error",
      "expressionId",
      "expressionKind",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps AutoMod evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-action-content",
    "private-alert-channel-name",
    "private-audit-reason",
    "private-custom-message",
    "private-keyword",
    "private-operation-key",
    "private-regex",
    "private-role-name",
    "private-rule-name",
  ]

  await store.append(autoModeration("1", "pending"))
  await store.append({
    ...autoModeration("2", "completed"),
    actionExecutionContent: privateValues[0],
    alertChannelName: privateValues[1],
    auditReason: privateValues[2],
    customMessage: privateValues[3],
    keywordFilter: [privateValues[4]],
    operationKey: privateValues[5],
    regexPatterns: [privateValues[6]],
    roleName: privateValues[7],
    ruleName: privateValues[8],
  } as AutoModerationActivity)
  await store.append({
    ...autoModeration("4", "uncertain"),
    error: "OperationStoreError",
  })
  await store.append({
    ...autoModeration("5", "completed"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...autoModeration("3", "completed"),
      targetEnabled: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["5", "4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "ruleId",
      "schemaVersion",
      "status",
      "targetEnabled",
      "timestamp",
      "triggerType",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps scheduled event evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-cover-path",
    "private-description",
    "private-event-name",
    "private-location",
    "private-operation-key",
    "private-subscriber-profile",
  ]

  await store.append(scheduledEvent("1", "pending"))
  await store.append({
    ...scheduledEvent("2", "completed"),
    auditReason: privateValues[0],
    coverImagePath: privateValues[1],
    description: privateValues[2],
    name: privateValues[3],
    location: privateValues[4],
    operationKey: privateValues[5],
    subscriberProfile: privateValues[6],
  } as ScheduledEventActivity)
  await store.append({
    ...scheduledEvent("4", "uncertain"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...scheduledEvent("3", "completed"),
      targetStatus: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "entityType",
      "error",
      "eventId",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "targetStatus",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps soundboard evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-audio-bytes",
    "private-creator-profile",
    "private-file-path",
    "private-operation-key",
    "private-sound-name",
  ]

  await store.append(soundboard("1", "pending"))
  await store.append({
    ...soundboard("2", "completed"),
    auditReason: privateValues[0],
    audioBytes: privateValues[1],
    creatorProfile: privateValues[2],
    filePath: privateValues[3],
    operationKey: privateValues[4],
    name: privateValues[5],
  } as SoundboardActivity)
  await store.append({
    ...soundboard("4", "uncertain"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...soundboard("3", "completed"),
      soundId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "soundId",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps Stage-instance evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-guild-name",
    "private-operation-key",
    "private-stage-topic",
  ]

  await store.append(stageInstance("1", "pending"))
  await store.append({
    ...stageInstance("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    guildName: privateValues[2],
    operationKey: privateValues[3],
    topic: privateValues[4],
  } as StageInstanceActivity)
  await store.append({
    ...stageInstance("4", "uncertain"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...stageInstance("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "stageInstanceId",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})
