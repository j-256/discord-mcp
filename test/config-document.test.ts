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
  CONFIG_CAPABILITY_NAMES,
  CONFIG_DOCUMENT_SCHEMA_ID,
  CONFIG_LIMIT_NAMES,
  CONFIG_RUNTIME_NAMES,
  CONFIG_SCOPE_NAMES,
  CONFIG_STORAGE_NAMES,
  connectorConfigFields,
  connectorConfigJsonSchema,
  connectorConfigSecretEnvironmentNames,
  connectorConfigSecretFilePaths,
  createConnectorConfigDocument,
  loadConnectorCredentialFile,
  loadConnectorConfigDocumentFile,
  parseConnectorConfigDocument,
  parseConnectorConfigJson,
  type ConnectorConfigDocument,
} from "../src/config-document.js"
import {
  loadConnectorConfig,
  loadConnectorConfigDocument,
} from "../src/config.js"
import {
  CONNECTOR_LIMITS,
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
  MCP_READ_RESPONSE_DEFAULTS,
  MCP_READ_RESPONSE_LIMITS,
} from "../src/constants.js"
import { ConfigDocumentError } from "../src/errors.js"

const APPLICATION_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const ROLE_ID = "500000000000000001"
const TOKEN = "test-discord-token"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"
const HEADER_ALIAS = "HONEYCOMB_OTLP_HEADERS"
const UNDECLARED_POLICY_ENVIRONMENT_VARIABLE = "DISCORD_MCP_UNDECLARED_POLICY"
const COMPONENT_LINK_ORIGIN = "https://docs.example.com"

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
      applicationEmojiAudit: true,
      applicationEmojiChanges: true,
      attachments: true,
      interactions: true,
    },
    limits: {
      attachmentMaxBytes: 1_024,
      interactionMaxWritesPerMinute: 10,
      mcpReadResponseMaxBytes: MCP_READ_RESPONSE_LIMITS.minimumBytes,
    },
    observability: {
      exportEnabled: true,
      headers: { provider: "environment", variable: HEADER_ALIAS },
      traceSampleRatio: 0.25,
    },
    runtime: { nativeCommandName: "discord" },
    scopes: {
      attachmentChannelIds: [CHANNEL_ID],
      componentLinkOrigins: [COMPONENT_LINK_ORIGIN],
      interactionChannelIds: [CHANNEL_ID],
    },
    storage: {
      applicationEmojiRoots: ["/srv/discord-application-emojis"],
    },
  })
  assert.deepEqual(parseConnectorConfigDocument(valid, valid.name), valid)
  assert.equal(JSON.stringify(valid).includes(TOKEN), false)

  for (const componentLinkOrigins of [
    ["http://docs.example.com"],
    ["https://Docs.example.com"],
    ["https://docs.example.com/"],
    ["https://docs.example.com/path"],
    ["https://docs.example.com", "https://docs.example.com"],
    ["https://example.com", "https://docs.example.com"],
  ]) {
    assert.throws(
      () => parseConnectorConfigDocument({
        ...valid,
        scopes: { ...valid.scopes, componentLinkOrigins },
      }),
      ConfigDocumentError,
    )
  }

  const invalid: unknown[] = [
    { ...valid, unknown: true },
    { ...valid, schemaVersion: 1 },
    { ...valid, name: "Support" },
    { ...valid, token: TOKEN },
    { ...valid, credential: { provider: "environment", variable: "PATH" } },
    { ...valid, credential: { provider: "environment", variable: "discord_bot_token" } },
    {
      ...valid,
      credential: {
        provider: "environment",
        variable: `DISCORD_${"A".repeat(121)}_TOKEN`,
      },
    },
    {
      ...valid,
      credential: {
        provider: "environment",
        variable: UNDECLARED_POLICY_ENVIRONMENT_VARIABLE,
      },
    },
    { ...valid, credential: { path: "relative-token", provider: "file" } },
    { ...valid, credential: { path: "/run/secrets/token\n", provider: "file" } },
    {
      ...valid,
      credential: {
        path: "/run/secrets/discord-token",
        provider: "file",
        variable: TOKEN_ALIAS,
      },
    },
    { ...valid, readScope: { ...valid.readScope, guildIds: [] } },
    { ...valid, readScope: { ...valid.readScope, channelIds: [CHANNEL_ID, CHANNEL_ID] } },
    { ...valid, identity: { applicationId: APPLICATION_ID } },
    { ...valid, identity: { botId: BOT_ID } },
    { ...valid, tools: { ...valid.tools, toolsets: [] } },
    { ...valid, tools: { ...valid.tools, toolsets: ["messages", "all"] } },
    { ...valid, tools: { ...valid.tools, toolsets: ["messages", "unknown"] } },
    { ...valid, tools: { ...valid.tools, toolsets: ["messages", "connector"] } },
    { ...valid, capabilities: { ...valid.capabilities, deletion: true } },
    { ...valid, scopes: { ...valid.scopes, attachmentChannelIds: CHANNEL_ID } },
    { ...valid, limits: { ...valid.limits, attachmentMaxBytes: "1024" } },
    {
      ...valid,
      limits: {
        ...valid.limits,
        mcpReadResponseMaxBytes: MCP_READ_RESPONSE_LIMITS.minimumBytes - 1,
      },
    },
    {
      ...valid,
      limits: {
        ...valid.limits,
        mcpReadResponseMaxBytes: MCP_READ_RESPONSE_LIMITS.maximumBytes + 1,
      },
    },
    {
      ...valid,
      storage: { ...valid.storage, inviteCapabilityRoots: ["/private/invite\ncapabilities"] },
    },
    {
      ...valid,
      storage: { ...valid.storage, inviteCapabilityRoots: ["/private/invite-capabilities "] },
    },
    {
      ...valid,
      observability: {
        ...valid.observability,
        clientKey: "/private/collector.key",
      },
    },
    {
      ...valid,
      observability: {
        headers: {
          provider: "environment",
          variable: UNDECLARED_POLICY_ENVIRONMENT_VARIABLE,
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

test("native configuration loads only referenced secrets and rejects ambient policy", async (context) => {
  const applicationEmojiRoot = await configRoot(context)
  const source: NodeJS.ProcessEnv = {
    [TOKEN_ALIAS]: ` ${TOKEN} `,
    [HEADER_ALIAS]: "x-api-key=telemetry-secret",
    PATH: "/usr/bin",
  }
  const before = { ...source }
  const configured = document({
    capabilities: {
      applicationEmojiAudit: true,
      applicationEmojiChanges: true,
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
      componentLinkOrigins: [COMPONENT_LINK_ORIGIN],
      interactionChannelIds: [CHANNEL_ID],
    },
    storage: {
      applicationEmojiRoots: [applicationEmojiRoot],
    },
  })

  const config = loadConnectorConfigDocument(configured, source)
  assert.deepEqual(source, before)
  assert.equal(config.token, TOKEN)
  assert.equal(config.allowAttachments, true)
  assert.equal(config.allowApplicationEmojiAudit, true)
  assert.equal(config.allowApplicationEmojiChanges, true)
  assert.deepEqual(
    config.applicationEmojiRoots,
    [applicationEmojiRoot],
  )
  assert.deepEqual([...config.attachmentChannelIds], [CHANNEL_ID])
  assert.deepEqual([...config.componentLinkOrigins], [COMPONENT_LINK_ORIGIN])
  assert.equal(config.attachmentMaxBytes, 1_024)
  assert.equal(
    config.mcpReadResponseMaxBytes,
    MCP_READ_RESPONSE_DEFAULTS.maxBytes,
  )
  assert.deepEqual([...config.allowedGuildIds], [GUILD_ID])
  assert.deepEqual(
    config.observability.export?.traces.headers,
    { "x-api-key": "telemetry-secret" },
  )

  assert.throws(
    () => loadConnectorConfigDocument(configured, {
      ...source,
      [UNDECLARED_POLICY_ENVIRONMENT_VARIABLE]: "false",
    }),
    new RegExp(`conflicts.*${UNDECLARED_POLICY_ENVIRONMENT_VARIABLE}`),
  )
  assert.throws(
    () => loadConnectorConfigDocument(configured, {
      [TOKEN_ALIAS]: TOKEN,
    }),
    new RegExp(`requires ${HEADER_ALIAS}`),
  )
})

test("file-backed credentials activate without ambient secret delivery", async (context) => {
  const root = await configRoot(context)
  const tokenFile = join(root, "discord-token")
  await writeFile(tokenFile, `  ${TOKEN}\n`, { mode: 0o600 })
  const configured = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialFile: tokenFile,
    guildIds: [GUILD_ID],
    name: "support-bot",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
  const source = { PATH: "/usr/bin" }
  const before = { ...source }

  assert.deepEqual(connectorConfigSecretEnvironmentNames(configured), [])
  assert.deepEqual(connectorConfigSecretFilePaths(configured), [tokenFile])
  assert.equal(loadConnectorCredentialFile(tokenFile), TOKEN)
  const config = loadConnectorConfigDocument(configured, source)
  assert.deepEqual(source, before)
  assert.equal(config.token, TOKEN)
  assert.throws(
    () => loadConnectorConfigDocument(configured, {
      DISCORD_BOT_TOKEN: "ambient-token",
    }),
    /conflicts with undeclared environment variables: DISCORD_BOT_TOKEN/,
  )
})

test("credential files allow projected-secret symlinks and reject unsafe storage", async (context) => {
  const root = await configRoot(context)
  const tokenFile = join(root, "discord-token")
  const tokenLink = join(root, "projected-token")
  await writeFile(tokenFile, `${TOKEN}\n`, { mode: 0o600 })
  await symlink(tokenFile, tokenLink)
  assert.equal(loadConnectorCredentialFile(tokenLink), TOKEN)

  const hardlink = join(root, "hardlinked-token")
  await link(tokenFile, hardlink)
  assert.throws(
    () => loadConnectorCredentialFile(tokenFile),
    /owned by the process user or root/,
  )
  await rm(hardlink)

  if (process.platform !== "win32") {
    await chmod(tokenFile, 0o622)
    assert.throws(
      () => loadConnectorCredentialFile(tokenFile),
      /owned by the process user or root/,
    )
    await chmod(tokenFile, 0o600)
  }

  const empty = join(root, "empty-token")
  await writeFile(empty, "", { mode: 0o600 })
  assert.throws(() => loadConnectorCredentialFile(empty), /bounded/)

  const oversized = join(root, "oversized-token")
  await writeFile(oversized, "x".repeat(CONNECTOR_LIMITS.credentialFileBytes + 1), {
    mode: 0o600,
  })
  assert.throws(() => loadConnectorCredentialFile(oversized), /bounded/)

  const multiline = join(root, "multiline-token")
  await writeFile(multiline, `${TOKEN}\nsecond-line\n`, { mode: 0o600 })
  assert.throws(() => loadConnectorCredentialFile(multiline), /control characters/)

  const malformed = join(root, "malformed-token")
  await writeFile(malformed, Uint8Array.from([0xc3, 0x28]), { mode: 0o600 })
  assert.throws(() => loadConnectorCredentialFile(malformed), /valid UTF-8/)

  assert.throws(
    () => loadConnectorCredentialFile(join(root, "missing-token")),
    /was not found/,
  )
})

test("configuration file loading is canonical, bounded, and usable by the connector", async (context) => {
  const file = await writeConfig(context)
  assert.deepEqual(loadConnectorConfigDocumentFile(file), document())
  const config = loadConnectorConfig({
    [CONFIG_FILE_ENVIRONMENT_VARIABLE]: file,
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

test("configuration file is the complete role-deletion policy surface", async (context) => {
  const configured = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    capabilities: {
      roleDeletionAudit: true,
      roleDeletions: true,
    },
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    gatewayEnabled: true,
    guildIds: [GUILD_ID],
    name: "support-bot",
    scopes: {
      roleDeletionIds: [ROLE_ID],
    },
    toolsets: ["connector", "gateway", "role-deletion"],
    toolSurface: "progressive",
  })
  const file = await writeConfig(context, configured)
  const config = loadConnectorConfig({
    [CONFIG_FILE_ENVIRONMENT_VARIABLE]: file,
    [TOKEN_ALIAS]: TOKEN,
  })

  assert.equal(config.allowRoleDeletionAudit, true)
  assert.equal(config.allowRoleDeletions, true)
  assert.deepEqual([...config.roleDeletionIds], [ROLE_ID])
  assert.equal(config.allowGateway, true)
  assert.deepEqual([...config.mcpToolsets], ["connector", "gateway", "role-deletion"])

})

test("configuration metadata covers every runtime field and emits a strict schema", () => {
  const fields = connectorConfigFields()
  const paths = new Set(fields.map((field) => field.path))
  assert.equal(paths.size, fields.length)
  assert.equal(
    fields.every((field) => field.description.length > 0),
    true,
  )
  for (const name of CONFIG_CAPABILITY_NAMES) {
    assert.equal(paths.has(`$.capabilities.${name}`), true)
  }
  for (const name of CONFIG_SCOPE_NAMES) {
    assert.equal(paths.has(`$.scopes.${name}`), true)
  }
  assert.equal(
    fields.find((field) => field.path === "$.scopes.componentLinkOrigins")?.kind,
    "strings",
  )
  for (const name of CONFIG_LIMIT_NAMES) {
    assert.equal(paths.has(`$.limits.${name}`), true)
  }
  for (const name of CONFIG_STORAGE_NAMES) {
    assert.equal(paths.has(`$.storage.${name}`), true)
  }
  for (const name of CONFIG_RUNTIME_NAMES) {
    assert.equal(paths.has(`$.runtime.${name}`), true)
  }

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
  const properties = schema.properties as Record<string, Record<string, unknown>>
  const credential = properties.credential as {
    oneOf?: Array<{ properties?: Record<string, Record<string, unknown>> }>
  }
  assert.deepEqual(
    credential.oneOf?.map((entry) => entry.properties?.provider?.const),
    ["environment", "file"],
  )
  const capabilities = (properties.capabilities as Record<string, unknown>).properties as Record<
    string,
    Record<string, unknown>
  >
  const scopes = (properties.scopes as Record<string, unknown>).properties as Record<
    string,
    Record<string, unknown>
  >
  assert.match(
    String(capabilities.channelMetadataChanges?.description),
    /channel metadata and exact ordinary voice-channel status/,
  )
  assert.match(
    String(scopes.channelMetadataIds?.description),
    /channel metadata and ordinary voice-channel status/,
  )
  assert.match(
    String(capabilities.inviteCreation?.description),
    /finite invite creation with private-file capability delivery/,
  )
  assert.match(
    String(capabilities.inviteRoleAssignment?.description),
    /persistent role assignment through finite privately delivered invites/,
  )
  assert.match(
    String(capabilities.applicationIntentChanges?.description),
    /reviewed additive application privileged-intent enablement/,
  )
  assert.match(
    String(scopes.inviteCreationChannelIds?.description),
    /direct guild-channel ID allowlist/,
  )
  assert.match(
    String(scopes.inviteRoleIds?.description),
    /role ID allowlist for reviewed persistent invite role assignment/,
  )
  const storage = (properties.storage as Record<string, unknown>).properties as Record<
    string,
    Record<string, unknown>
  >
  assert.match(
    String(storage.inviteCapabilityRoots?.description),
    /exclusive private invite capability files/,
  )
})
