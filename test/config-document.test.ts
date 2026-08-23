import assert from "node:assert/strict"
import {
  chmod,
  link,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  CONFIG_CAPABILITY_MAPPINGS,
  CONFIG_DOCUMENT_ENVIRONMENT_PATHS,
  CONFIG_DOCUMENT_SCHEMA_ID,
  CONFIG_LIMIT_MAPPINGS,
  CONFIG_RUNTIME_MAPPINGS,
  CONFIG_SCOPE_MAPPINGS,
  CONFIG_STORAGE_MAPPINGS,
  activateConnectorConfigDocument,
  connectorConfigFields,
  connectorConfigJsonSchema,
  createConnectorConfigDocument,
  loadConnectorConfigDocumentFile,
  parseConnectorConfigDocument,
  parseConnectorConfigJson,
  type ConnectorConfigDocument,
} from "../src/config-document.js"
import { loadConnectorConfig } from "../src/config.js"
import { ENVIRONMENT_NAMES } from "../src/constants.js"
import { ConfigDocumentError } from "../src/errors.js"

const APPLICATION_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const TOKEN = "test-discord-token"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"
const HEADER_ALIAS = "HONEYCOMB_OTLP_HEADERS"

function document(
  overrides: Partial<ConnectorConfigDocument> = {},
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

async function configRoot(context: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-config-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  return realpath(root)
}

async function writeConfig(
  context: test.TestContext,
  value: ConnectorConfigDocument = document(),
): Promise<string> {
  const root = await configRoot(context)
  const file = join(root, "discord-mcp.json")
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  return file
}

test("configuration document is strict, typed, canonical, and non-secret", () => {
  const valid = document({
    capabilities: {
      attachments: true,
      interactions: true,
    },
    limits: {
      attachmentMaxBytes: 1_024,
      interactionMaxWritesPerMinute: 10,
    },
    observability: {
      exportEnabled: true,
      headers: { provider: "environment", variable: HEADER_ALIAS },
      traceSampleRatio: 0.25,
    },
    runtime: { nativeCommandName: "discord" },
    scopes: {
      attachmentChannelIds: [CHANNEL_ID],
      interactionChannelIds: [CHANNEL_ID],
    },
  })
  assert.deepEqual(parseConnectorConfigDocument(valid, valid.name), valid)
  assert.equal(JSON.stringify(valid).includes(TOKEN), false)

  const invalid: unknown[] = [
    { ...valid, unknown: true },
    { ...valid, schemaVersion: 1 },
    { ...valid, name: "Support" },
    { ...valid, token: TOKEN },
    { ...valid, credential: { provider: "environment", variable: "PATH" } },
    { ...valid, credential: { provider: "environment", variable: ENVIRONMENT_NAMES.allowDeletions } },
    { ...valid, readScope: { ...valid.readScope, guildIds: [] } },
    { ...valid, readScope: { ...valid.readScope, channelIds: [CHANNEL_ID, CHANNEL_ID] } },
    { ...valid, tools: { ...valid.tools, toolsets: ["messages", "connector"] } },
    { ...valid, capabilities: { ...valid.capabilities, deletion: true } },
    { ...valid, scopes: { ...valid.scopes, attachmentChannelIds: CHANNEL_ID } },
    { ...valid, limits: { ...valid.limits, attachmentMaxBytes: "1024" } },
    {
      ...valid,
      observability: {
        headers: {
          provider: "environment",
          variable: ENVIRONMENT_NAMES.allowGateway,
        },
      },
    },
  ]
  for (const candidate of invalid) {
    assert.throws(() => parseConnectorConfigDocument(candidate), ConfigDocumentError)
  }
})

test("configuration JSON rejects duplicate keys, truncation, NULs, and deep nesting", () => {
  const valid = JSON.stringify(document())
  assert.deepEqual(parseConnectorConfigJson(`${valid}\n`), document())
  assert.throws(
    () => parseConnectorConfigJson('{"schemaVersion":2,"schemaVersion":2}\n'),
    /duplicate object key.*schemaVersion/,
  )
  assert.throws(
    () => parseConnectorConfigJson('{"name":"first","na\\u006de":"second"}\n'),
    /duplicate object key.*name/,
  )
  assert.throws(() => parseConnectorConfigJson(valid), /newline-terminated/)
  assert.throws(() => parseConnectorConfigJson(`${valid}\0\n`), /newline-terminated/)
  assert.throws(
    () => parseConnectorConfigJson(`${"[".repeat(66)}${"]".repeat(66)}\n`),
    /nesting depth/,
  )
})

test("configuration activation allows only referenced secrets and maps typed policy", () => {
  const source: NodeJS.ProcessEnv = {
    [TOKEN_ALIAS]: ` ${TOKEN} `,
    [HEADER_ALIAS]: "x-api-key=telemetry-secret",
    PATH: "/usr/bin",
  }
  const before = { ...source }
  const configured = document({
    capabilities: {
      attachments: true,
      interactions: true,
    },
    limits: { attachmentMaxBytes: 1_024 },
    observability: {
      exportEnabled: true,
      headers: { provider: "environment", variable: HEADER_ALIAS },
    },
    scopes: {
      attachmentChannelIds: [CHANNEL_ID],
      interactionChannelIds: [CHANNEL_ID],
    },
  })

  const environment = activateConnectorConfigDocument(configured, source)
  assert.deepEqual(source, before)
  assert.equal(environment[TOKEN_ALIAS], undefined)
  assert.equal(environment[HEADER_ALIAS], undefined)
  assert.equal(environment[ENVIRONMENT_NAMES.token], TOKEN)
  assert.equal(environment[ENVIRONMENT_NAMES.otelHeaders], "x-api-key=telemetry-secret")
  assert.equal(environment[ENVIRONMENT_NAMES.allowAttachments], "true")
  assert.equal(environment[ENVIRONMENT_NAMES.attachmentChannelIds], CHANNEL_ID)
  assert.equal(environment[ENVIRONMENT_NAMES.attachmentMaxBytes], "1024")
  assert.equal(environment[ENVIRONMENT_NAMES.allowedGuildIds], GUILD_ID)
  assert.equal(environment.PATH, "/usr/bin")

  assert.throws(
    () => activateConnectorConfigDocument(configured, {
      ...source,
      [ENVIRONMENT_NAMES.allowDeletions]: "false",
    }),
    new RegExp(`conflicts.*${ENVIRONMENT_NAMES.allowDeletions}`),
  )
  assert.throws(
    () => activateConnectorConfigDocument(configured, {
      ...source,
      DISCORD_MCP_ALLOW_DELETION: "true",
    }),
    /conflicts.*DISCORD_MCP_ALLOW_DELETION/,
  )
  assert.throws(
    () => activateConnectorConfigDocument(configured, {
      [TOKEN_ALIAS]: TOKEN,
    }),
    new RegExp(`requires ${HEADER_ALIAS}`),
  )
})

test("configuration file loading is canonical, bounded, and usable by the connector", async (context) => {
  const file = await writeConfig(context)
  assert.deepEqual(loadConnectorConfigDocumentFile(file), document())
  const config = loadConnectorConfig({
    [ENVIRONMENT_NAMES.configFile]: file,
    [TOKEN_ALIAS]: TOKEN,
  })
  assert.equal(config.token, TOKEN)
  assert.deepEqual([...config.allowedGuildIds], [GUILD_ID])
  assert.deepEqual([...config.allowedChannelIds], [CHANNEL_ID])
  assert.equal(config.mcpToolSurface, "progressive")

  if (process.platform !== "win32") {
    await chmod(file, 0o622)
    assert.throws(
      () => loadConnectorConfigDocumentFile(file),
      /non-writable regular file/,
    )
    await chmod(file, 0o600)
  }

  const hardlink = join(file, "..", "hardlink.json")
  await link(file, hardlink)
  assert.throws(
    () => loadConnectorConfigDocumentFile(file),
    /non-writable regular file/,
  )
  await rm(hardlink)

  const symlinkPath = join(file, "..", "linked.json")
  await symlink(file, symlinkPath)
  assert.throws(
    () => loadConnectorConfigDocumentFile(symlinkPath),
    ConfigDocumentError,
  )
})

test("configuration metadata covers every runtime field and emits a strict schema", () => {
  const mapped = new Set(CONFIG_DOCUMENT_ENVIRONMENT_PATHS.keys())
  const expected = Object.values(ENVIRONMENT_NAMES)
    .filter((name) => name !== ENVIRONMENT_NAMES.configFile)
  assert.deepEqual([...mapped].sort(), [...expected].sort())
  assert.equal(connectorConfigFields().length, expected.length + 3)
  assert.equal(
    connectorConfigFields().every((field) => field.description.length > 0),
    true,
  )
  assert.equal(CONFIG_CAPABILITY_MAPPINGS.length > 0, true)
  assert.equal(CONFIG_SCOPE_MAPPINGS.length > 0, true)
  assert.equal(CONFIG_LIMIT_MAPPINGS.length > 0, true)
  assert.equal(CONFIG_STORAGE_MAPPINGS.length > 0, true)
  assert.equal(CONFIG_RUNTIME_MAPPINGS.length > 0, true)

  const schema = connectorConfigJsonSchema()
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema")
  assert.equal(schema.$id, CONFIG_DOCUMENT_SCHEMA_ID)
  assert.equal(schema.additionalProperties, false)
  const schemaVersion = (
    schema.properties as Record<string, Record<string, unknown>>
  ).schemaVersion
  assert.equal(schemaVersion?.const, 2)
  assert.equal(schemaVersion?.type, "number")
  assert.equal(schemaVersion?.description, "Configuration format version")
})
