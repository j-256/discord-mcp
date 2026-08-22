import assert from "node:assert/strict"
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { OperationStoreError } from "../src/errors.js"
import {
  FileOperationStore,
  operationKeyHash,
  type OperationReceipt,
} from "../src/operation-store.js"

const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const PLAN_DIGEST = `hmac-sha256:${"a".repeat(64)}`
const OPERATION_KEY = "channel-create-operation-0001"
const INVITE_REF = `iref_hmac_sha256_${"b".repeat(64)}`
const GUILD_TEMPLATE_REF = `tref_hmac_sha256_${"c".repeat(64)}`

function receipt(
  status: OperationReceipt["status"] = "pending",
): OperationReceipt {
  return {
    activityId: "activity-0001",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.400.unknown"
      : null,
    guildId: GUILD_ID,
    kind: "channel-creation",
    operationKeyHash: operationKeyHash(OPERATION_KEY),
    planDigest: PLAN_DIGEST,
    resourceId: status === "completed" ? CHANNEL_ID : null,
    schemaVersion: 1,
    status,
    timestamp: status === "pending"
      ? "2026-08-20T00:00:00.000Z"
      : "2026-08-20T00:00:01.000Z",
    verification: status === "completed" ? "match" : null,
  }
}

test("operation keys are domain-hashed and strictly bounded", () => {
  assert.match(operationKeyHash(OPERATION_KEY), /^sha256:[a-f0-9]{64}$/)
  assert.equal(operationKeyHash(OPERATION_KEY), operationKeyHash(OPERATION_KEY))
  assert.notEqual(
    operationKeyHash(OPERATION_KEY),
    operationKeyHash("channel-create-operation-0002"),
  )
  assert.throws(() => operationKeyHash("short"), /16-128/)
  assert.throws(() => operationKeyHash("unsafe key with spaces"), /safe ASCII/)
})

test("file operation store reserves once and records a private terminal receipt", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-operations-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const directory = join(root, "receipts")
  const store = new FileOperationStore(directory)
  const pending = receipt()

  assert.deepEqual(await store.reserve(pending), {
    created: true,
    receipt: pending,
  })
  assert.deepEqual(await store.get("channel-creation", pending.operationKeyHash), pending)
  await store.finish(receipt("completed"))
  assert.deepEqual(
    await store.get("channel-creation", pending.operationKeyHash),
    receipt("completed"),
  )
  await store.finish(receipt("completed"))

  const operations = await readdir(directory)
  assert.equal(operations.length, 1)
  const operationDirectory = join(directory, operations[0] as string)
  const terminalDirectory = join(operationDirectory, "terminal")
  const receiptFiles = [
    join(operationDirectory, "pending.json"),
    join(terminalDirectory, "receipt.json"),
  ]
  const text = (await Promise.all(
    receiptFiles.map((file) => readFile(file, "utf8")),
  )).join("\n")
  assert.doesNotMatch(text, new RegExp(OPERATION_KEY))
  assert.doesNotMatch(text, /channel name|private topic|audit reason/)
  assert.equal((await lstat(directory)).mode & 0o777, 0o700)
  assert.equal((await lstat(operationDirectory)).mode & 0o777, 0o700)
  assert.equal((await lstat(terminalDirectory)).mode & 0o777, 0o700)
  for (const file of receiptFiles) {
    assert.equal((await lstat(file)).mode & 0o777, 0o600)
  }
})

test("file operation store atomically selects one concurrent reservation", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-operations-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const store = new FileOperationStore(join(root, "receipts"))

  const results = await Promise.all([
    store.reserve(receipt()),
    store.reserve(receipt()),
    store.reserve(receipt()),
  ])

  assert.equal(results.filter((result) => result.created).length, 1)
  assert.equal(results.filter((result) => !result.created).length, 2)
  await Promise.all([
    store.finish(receipt("completed")),
    store.finish(receipt("completed")),
  ])
  assert.equal(
    (await store.get("channel-creation", receipt().operationKeyHash))?.status,
    "completed",
  )
})

test("file operation store isolates every durable write operation-key domain", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-operations-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const store = new FileOperationStore(join(root, "receipts"))
  const channel = receipt()
  const announcementCrosspost = { ...receipt(), kind: "announcement-crosspost" as const }
  const attachment = { ...receipt(), kind: "attachment-message" as const }
  const automod = { ...receipt(), kind: "automod-change" as const }
  const overwrite = { ...receipt(), kind: "channel-permission-overwrite" as const }
  const forum = { ...receipt(), kind: "forum-post" as const }
  const forumTag = { ...receipt(), kind: "forum-tag-change" as const }
  const expression = { ...receipt(), kind: "guild-expression-change" as const }
  const scaffold = { ...receipt(), kind: "guild-scaffold" as const }
  const integration = { ...receipt(), kind: "integration-deletion" as const }
  const invite = { ...receipt(), kind: "invite-deletion" as const }
  const guildTemplate = { ...receipt(), kind: "guild-template-change" as const }
  const onboarding = { ...receipt(), kind: "onboarding-change" as const }
  const memberRole = { ...receipt(), kind: "member-role-change" as const }
  const pin = { ...receipt(), kind: "message-pin" as const }
  const pollCreate = { ...receipt(), kind: "poll-create" as const }
  const pollEnd = { ...receipt(), kind: "poll-end" as const }
  const reactionModeration = { ...receipt(), kind: "reaction-moderation" as const }
  const role = { ...receipt(), kind: "role-creation" as const }
  const scheduledEvent = { ...receipt(), kind: "scheduled-event-change" as const }
  const soundboard = { ...receipt(), kind: "guild-soundboard-change" as const }
  const stageInstance = { ...receipt(), kind: "stage-instance-change" as const }
  const webhook = { ...receipt(), kind: "webhook-deletion" as const }
  const widgetSettings = { ...receipt(), kind: "widget-settings-change" as const }

  assert.equal((await store.reserve(channel)).created, true)
  assert.equal((await store.reserve(announcementCrosspost)).created, true)
  assert.equal((await store.reserve(attachment)).created, true)
  assert.equal((await store.reserve(automod)).created, true)
  assert.equal((await store.reserve(overwrite)).created, true)
  assert.equal((await store.reserve(forum)).created, true)
  assert.equal((await store.reserve(forumTag)).created, true)
  assert.equal((await store.reserve(expression)).created, true)
  assert.equal((await store.reserve(scaffold)).created, true)
  assert.equal((await store.reserve(integration)).created, true)
  assert.equal((await store.reserve(invite)).created, true)
  assert.equal((await store.reserve(guildTemplate)).created, true)
  assert.equal((await store.reserve(onboarding)).created, true)
  assert.equal((await store.reserve(memberRole)).created, true)
  assert.equal((await store.reserve(pin)).created, true)
  assert.equal((await store.reserve(pollCreate)).created, true)
  assert.equal((await store.reserve(pollEnd)).created, true)
  assert.equal((await store.reserve(reactionModeration)).created, true)
  assert.equal((await store.reserve(role)).created, true)
  assert.equal((await store.reserve(scheduledEvent)).created, true)
  assert.equal((await store.reserve(soundboard)).created, true)
  assert.equal((await store.reserve(stageInstance)).created, true)
  assert.equal((await store.reserve(webhook)).created, true)
  assert.equal((await store.reserve(widgetSettings)).created, true)
  assert.deepEqual(
    await store.get("announcement-crosspost", announcementCrosspost.operationKeyHash),
    announcementCrosspost,
  )
  assert.deepEqual(
    await store.get("attachment-message", attachment.operationKeyHash),
    attachment,
  )
  assert.deepEqual(
    await store.get("automod-change", automod.operationKeyHash),
    automod,
  )
  assert.deepEqual(
    await store.get("channel-creation", channel.operationKeyHash),
    channel,
  )
  assert.deepEqual(
    await store.get("channel-permission-overwrite", overwrite.operationKeyHash),
    overwrite,
  )
  assert.deepEqual(
    await store.get("forum-post", forum.operationKeyHash),
    forum,
  )
  assert.deepEqual(
    await store.get("forum-tag-change", forumTag.operationKeyHash),
    forumTag,
  )
  assert.deepEqual(
    await store.get("guild-expression-change", expression.operationKeyHash),
    expression,
  )
  assert.deepEqual(
    await store.get("guild-scaffold", scaffold.operationKeyHash),
    scaffold,
  )
  assert.deepEqual(
    await store.get("integration-deletion", integration.operationKeyHash),
    integration,
  )
  assert.deepEqual(
    await store.get("invite-deletion", invite.operationKeyHash),
    invite,
  )
  assert.deepEqual(
    await store.get("guild-template-change", guildTemplate.operationKeyHash),
    guildTemplate,
  )
  assert.deepEqual(
    await store.get("onboarding-change", onboarding.operationKeyHash),
    onboarding,
  )
  assert.deepEqual(
    await store.get("member-role-change", memberRole.operationKeyHash),
    memberRole,
  )
  assert.deepEqual(
    await store.get("message-pin", pin.operationKeyHash),
    pin,
  )
  assert.deepEqual(
    await store.get("poll-create", pollCreate.operationKeyHash),
    pollCreate,
  )
  assert.deepEqual(
    await store.get("poll-end", pollEnd.operationKeyHash),
    pollEnd,
  )
  assert.deepEqual(
    await store.get("reaction-moderation", reactionModeration.operationKeyHash),
    reactionModeration,
  )
  assert.deepEqual(
    await store.get("role-creation", role.operationKeyHash),
    role,
  )
  assert.deepEqual(
    await store.get("scheduled-event-change", scheduledEvent.operationKeyHash),
    scheduledEvent,
  )
  assert.deepEqual(
    await store.get("guild-soundboard-change", soundboard.operationKeyHash),
    soundboard,
  )
  assert.deepEqual(
    await store.get("stage-instance-change", stageInstance.operationKeyHash),
    stageInstance,
  )
  assert.deepEqual(
    await store.get("webhook-deletion", webhook.operationKeyHash),
    webhook,
  )
  assert.deepEqual(
    await store.get("widget-settings-change", widgetSettings.operationKeyHash),
    widgetSettings,
  )

  const completedInvite = {
    ...invite,
    resourceId: INVITE_REF,
    status: "completed" as const,
    timestamp: "2026-08-20T00:00:01.000Z",
    verification: "match" as const,
  }
  await store.finish(completedInvite)
  assert.deepEqual(
    await store.get("invite-deletion", invite.operationKeyHash),
    completedInvite,
  )
  const completedGuildTemplate = {
    ...guildTemplate,
    resourceId: GUILD_TEMPLATE_REF,
    status: "completed" as const,
    timestamp: "2026-08-20T00:00:01.000Z",
    verification: "match" as const,
  }
  await store.finish(completedGuildTemplate)
  assert.deepEqual(
    await store.get("guild-template-change", guildTemplate.operationKeyHash),
    completedGuildTemplate,
  )
})

test("file operation store rejects identity changes and divergent terminal state", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-operations-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const store = new FileOperationStore(join(root, "receipts"))
  await store.reserve(receipt())

  await assert.rejects(
    () => store.finish({ ...receipt("completed"), guildId: "999" }),
    OperationStoreError,
  )
  await assert.rejects(
    () => store.finish({ ...receipt("failed"), error: null }),
    /invalid outcome state/,
  )
  await assert.rejects(
    () => store.finish({ ...receipt("completed"), error: "UnexpectedError" }),
    /lacks verified state/,
  )
  const attachment = { ...receipt(), kind: "attachment-message" as const }
  await store.reserve(attachment)
  await assert.rejects(
    () => store.finish({
      ...receipt("completed"),
      kind: "attachment-message",
      verification: "drift",
    }),
    /attachment receipt cannot contain drift verification/,
  )
  await store.finish(receipt("failed"))
  await assert.rejects(
    () => store.finish(receipt("completed")),
    /different terminal receipt/,
  )
})

test("file operation store fails closed on malformed, linked, and public receipts", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-operations-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const directory = join(root, "receipts")
  const store = new FileOperationStore(directory)
  const pending = receipt()
  await store.reserve(pending)
  const operationDirectory = join(directory, (await readdir(directory))[0] as string)
  const pendingPath = join(operationDirectory, "pending.json")

  await chmod(pendingPath, 0o644)
  await assert.rejects(
    () => store.get("channel-creation", pending.operationKeyHash),
    /private regular file/,
  )
  await chmod(pendingPath, 0o600)
  await writeFile(pendingPath, "not-json\n", { mode: 0o600 })
  await assert.rejects(
    () => store.get("channel-creation", pending.operationKeyHash),
    /valid JSON/,
  )
  await writeFile(pendingPath, `${JSON.stringify(pending)}\n\n`, { mode: 0o600 })
  await assert.rejects(
    () => store.get("channel-creation", pending.operationKeyHash),
    /one complete record/,
  )

  await rm(pendingPath)
  await symlink(join(root, "missing"), pendingPath)
  await assert.rejects(
    () => store.get("channel-creation", pending.operationKeyHash),
    /private regular file/,
  )

  await rm(pendingPath)
  await writeFile(pendingPath, `${JSON.stringify(pending)}\n`, { mode: 0o600 })
  await link(pendingPath, join(root, "hardlinked-receipt.json"))
  await assert.rejects(
    () => store.get("channel-creation", pending.operationKeyHash),
    /private regular file/,
  )
})
