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

test("file operation store isolates attachment, channel, and role operation-key domains", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-operations-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const store = new FileOperationStore(join(root, "receipts"))
  const channel = receipt()
  const attachment = { ...receipt(), kind: "attachment-message" as const }
  const role = { ...receipt(), kind: "role-creation" as const }

  assert.equal((await store.reserve(channel)).created, true)
  assert.equal((await store.reserve(attachment)).created, true)
  assert.equal((await store.reserve(role)).created, true)
  assert.deepEqual(
    await store.get("attachment-message", attachment.operationKeyHash),
    attachment,
  )
  assert.deepEqual(
    await store.get("channel-creation", channel.operationKeyHash),
    channel,
  )
  assert.deepEqual(
    await store.get("role-creation", role.operationKeyHash),
    role,
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
