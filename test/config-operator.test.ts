import assert from "node:assert/strict"
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  explainConnectorConfig,
  initializeConnectorConfigFile,
  showConnectorConfigFile,
  validateConnectorConfigDocumentPolicy,
  validateConnectorConfigFile,
  writeConnectorConfigDocumentFile,
} from "../src/config-operator.js"
import {
  createConnectorConfigDocument,
  loadConnectorConfigDocumentFile,
  type ConnectorConfigDocument,
} from "../src/config-document.js"
import { ConfigDocumentError } from "../src/errors.js"

const APPLICATION_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const OTHER_BOT_ID = "400000000000000002"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const TOKEN = "test-discord-token"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"

function document(
  overrides: Partial<Parameters<typeof createConnectorConfigDocument>[0]> = {},
): ConnectorConfigDocument {
  return createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "support-bot",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
    ...overrides,
  })
}

async function operatorRoot(context: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-config-operator-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  return realpath(root)
}

test("configuration policy validation is offline, secret-free, and cross-field complete", () => {
  const valid = document({
    capabilities: {
      pollAudit: true,
      pollCreation: true,
    },
    scopes: { pollChannelIds: [CHANNEL_ID] },
  })
  assert.deepEqual(validateConnectorConfigDocumentPolicy(valid), valid)

  const invalid = document({
    capabilities: { pollCreation: true },
    scopes: { pollChannelIds: [CHANNEL_ID] },
  })
  assert.throws(
    () => validateConnectorConfigDocumentPolicy(invalid),
    /poll creation.*\.capabilities\.pollAudit/i,
  )

  const fileCredential = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialFile: "/run/secrets/discord_bot_token",
    guildIds: [GUILD_ID],
    name: "file-credential",
    toolsets: ["connector"],
    toolSurface: "full",
  })
  assert.deepEqual(
    validateConnectorConfigDocumentPolicy(fileCredential),
    fileCredential,
  )
})

test("configuration files create privately, validate canonically, and preserve backups", async (context) => {
  const root = await operatorRoot(context)
  const file = join(root, "discord-mcp.json")
  const original = document()
  const created = await writeConnectorConfigDocumentFile(file, original)
  assert.equal(created.created, true)
  assert.equal(created.backupFile, undefined)
  assert.equal((await lstat(file)).mode & 0o777, 0o600)
  assert.deepEqual(loadConnectorConfigDocumentFile(file), original)

  const validation = validateConnectorConfigFile(file)
  assert.equal(validation.validation.discordContacted, false)
  assert.equal(validation.validation.secretValuesRead, false)
  assert.deepEqual(validation.summary.credential, {
    provider: "environment",
    variable: TOKEN_ALIAS,
  })
  assert.deepEqual(validation.summary.secretEnvironmentVariables, [TOKEN_ALIAS])
  assert.deepEqual(validation.summary.secretFilePaths, [])
  assert.deepEqual(showConnectorConfigFile(file).document, original)

  await assert.rejects(
    () => writeConnectorConfigDocumentFile(file, original),
    /already exists/,
  )

  const replacement = document({
    capabilities: { pollAudit: true },
    scopes: { pollChannelIds: [CHANNEL_ID] },
  })
  const replaced = await writeConnectorConfigDocumentFile(
    file,
    replacement,
    { overwrite: true },
  )
  assert.equal(replaced.created, false)
  assert.ok(replaced.backupFile)
  assert.deepEqual(loadConnectorConfigDocumentFile(file), replacement)
  assert.deepEqual(
    loadConnectorConfigDocumentFile(replaced.backupFile as string),
    original,
  )

  await assert.rejects(
    () => writeConnectorConfigDocumentFile(
      file,
      document({ botId: OTHER_BOT_ID }),
      { overwrite: true },
    ),
    /locked to its existing Discord identity/,
  )
})

test("configuration publication respects directory safety and another writer's lock", async (context) => {
  const root = await operatorRoot(context)
  const file = join(root, "discord-mcp.json")
  await assert.rejects(
    () => writeConnectorConfigDocumentFile(`${file}\nspoofed`, document()),
    /control characters/,
  )
  const lock = join(root, ".discord-mcp.json.lock")
  await writeFile(lock, "active\n", { mode: 0o600 })
  await assert.rejects(
    () => writeConnectorConfigDocumentFile(file, document()),
    /locked by another operation/,
  )
  assert.equal(await readFile(lock, "utf8"), "active\n")

  await rm(lock)
  if (process.platform !== "win32") {
    await chmod(root, 0o722)
    await assert.rejects(
      () => writeConnectorConfigDocumentFile(file, document()),
      /not group or world writable/,
    )
    await chmod(root, 0o700)
  }
})

test("configuration init creates a read-only preset and enforces required channel scope", async (context) => {
  const root = await operatorRoot(context)
  const observerFile = join(root, "observer.json")
  const observer = await initializeConnectorConfigFile({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    file: observerFile,
    guildIds: [GUILD_ID],
    name: "observer",
  })
  assert.equal(observer.action, "init")
  assert.equal(observer.source, "new")
  assert.deepEqual(observer.document.capabilities, {})
  assert.equal(observer.document.gateway.enabled, false)
  assert.equal(observer.document.tools.surface, "full")
  assert.equal(JSON.stringify(observer).includes(TOKEN), false)

  const fileCredential = await initializeConnectorConfigFile({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialFile: join(root, "discord.token"),
    file: join(root, "file-credential.json"),
    guildIds: [GUILD_ID],
    name: "file-credential",
  })
  assert.deepEqual(fileCredential.document.credential, {
    path: join(root, "discord.token"),
    provider: "file",
  })

  await assert.rejects(
    () => initializeConnectorConfigFile({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      credentialFile: "",
      file: join(root, "empty-credential-file.json"),
      guildIds: [GUILD_ID],
      name: "empty-credential-file",
    }),
    /must not be empty/,
  )

  await assert.rejects(
    () => initializeConnectorConfigFile({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      file: join(root, "reader.json"),
      guildIds: [GUILD_ID],
      name: "reader",
      preset: "channel-reader",
    }),
    /requires at least one channel ID/,
  )
})

test("configuration explanation returns bounded schema-backed field metadata", () => {
  const report = explainConnectorConfig("capabilities.deletions")
  assert.equal(report.query, "$.capabilities.deletions")
  assert.equal(report.fields.length, 1)
  assert.equal(Object.hasOwn(report.fields[0] ?? {}, "environmentVariable"), false)
  assert.equal(
    (report.fields[0]?.schema as { type?: string }).type,
    "boolean",
  )
  assert.throws(
    () => explainConnectorConfig("capabilities.notReal"),
    ConfigDocumentError,
  )
})
