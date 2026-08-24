import assert from "node:assert/strict"
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import {
  CONNECTOR_LIMITS,
  CONFIG_FILE_ENVIRONMENT_VARIABLE,
} from "../src/constants.js"
import { ProfileError } from "../src/errors.js"
import {
  activateProfile,
  createConnectorProfile,
  listProfiles,
  loadProfile,
  normalizeProfileName,
  parseConnectorProfile,
  profilePath,
  resolveProfileDirectory,
  restoreProfile,
  saveProfile,
  trashProfile,
  type ConnectorProfile,
} from "../src/profile.js"

const APPLICATION_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const CHANNEL_ID = "200000000000000001"
const OTHER_CHANNEL_ID = "200000000000000002"
const TOKEN = "test-discord-token"
const ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"
const UNDECLARED_POLICY_ENVIRONMENT_VARIABLE = "DISCORD_MCP_UNDECLARED_POLICY"

function profile(overrides: Partial<{
  applicationId: string
  botId: string
  channelIds: readonly string[]
  credentialVariable: string
  gatewayEnabled: boolean
  gatewayEventBufferSize: number
  guildIds: readonly string[]
  name: string
  capabilities: Readonly<Record<string, boolean>>
  scopes: Readonly<Record<string, readonly string[]>>
}> = {}): ConnectorProfile {
  return createConnectorProfile({
    applicationId: overrides.applicationId ?? APPLICATION_ID,
    botId: overrides.botId ?? BOT_ID,
    ...(overrides.capabilities ? { capabilities: overrides.capabilities } : {}),
    channelIds: overrides.channelIds ?? [CHANNEL_ID],
    credentialVariable: overrides.credentialVariable ?? ALIAS,
    gatewayEnabled: overrides.gatewayEnabled ?? false,
    gatewayEventBufferSize: overrides.gatewayEventBufferSize ?? 100,
    guildIds: overrides.guildIds ?? [GUILD_ID],
    name: overrides.name ?? "support-bot",
    ...(overrides.scopes ? { scopes: overrides.scopes } : {}),
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
}

async function profileRoot(context: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-profiles-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  return join(await realpath(root), "profiles")
}

test("profile names are bounded portable identifiers", () => {
  assert.equal(normalizeProfileName(" support.bot-1_2 "), "support.bot-1_2")

  for (const name of [
    "",
    "Support",
    ".support",
    "support.",
    "../support",
    "support/bot",
    "con",
    "aux.json",
    "a".repeat(65),
  ]) {
    assert.throws(() => normalizeProfileName(name), ProfileError)
  }
})

test("profile parsing requires one exact canonical non-secret contract", () => {
  const valid = profile()
  assert.deepEqual(parseConnectorProfile(valid, valid.name), valid)

  const invalid: unknown[] = [
    { ...valid, schemaVersion: 1 },
    { ...valid, schemaVersion: 3 },
    { ...valid, name: null },
    { ...valid, token: TOKEN },
    {
      ...valid,
      credential: { ...valid.credential, variable: null },
    },
    {
      ...valid,
      credential: { ...valid.credential, token: TOKEN },
    },
    {
      ...valid,
      identity: { ...valid.identity, applicationName: "private" },
    },
    {
      ...valid,
      readScope: { ...valid.readScope, guildIds: [] },
    },
    {
      ...valid,
      readScope: { ...valid.readScope, guildIds: [GUILD_ID, GUILD_ID] },
    },
    {
      ...valid,
      readScope: { ...valid.readScope, guildIds: [OTHER_GUILD_ID, GUILD_ID] },
    },
    {
      ...valid,
      readScope: { ...valid.readScope, channelIds: ["not-an-id"] },
    },
    {
      ...valid,
      tools: { ...valid.tools, toolsets: ["messages", "connector"] },
    },
    {
      ...valid,
      tools: { ...valid.tools, surface: "hidden" },
    },
    {
      ...valid,
      gateway: { ...valid.gateway, eventBufferSize: 0 },
    },
    {
      ...valid,
      gateway: { ...valid.gateway, eventBufferSize: 1.5 },
    },
    {
      ...valid,
      gateway: { ...valid.gateway, enabled: "false" },
    },
  ]
  for (const candidate of invalid) {
    assert.throws(() => parseConnectorProfile(candidate), ProfileError)
  }
  assert.throws(
    () => parseConnectorProfile(valid, "another-profile"),
    /does not match its filename/,
  )
  assert.throws(
    () => profile({ gatewayEventBufferSize: 0 }),
    /gateway\.eventBufferSize/,
  )
})

test("profile directories use platform configuration roots and exact overrides", () => {
  assert.equal(
    resolveProfileDirectory({
      homeDirectory: "/Users/operator",
      platform: "darwin",
    }),
    resolve("/Users/operator/Library/Application Support/discord-mcp/profiles"),
  )
  assert.equal(
    resolveProfileDirectory({
      environment: { XDG_CONFIG_HOME: "/configuration" },
      homeDirectory: "/home/operator",
      platform: "linux",
    }),
    resolve("/configuration/discord-mcp/profiles"),
  )
  assert.equal(
    resolveProfileDirectory({
      environment: { XDG_CONFIG_HOME: "relative" },
      homeDirectory: "/home/operator",
      platform: "linux",
    }),
    resolve("/home/operator/.config/discord-mcp/profiles"),
  )
  assert.equal(
    profilePath("support-bot", { directory: "/profiles" }),
    resolve("/profiles/support-bot.json"),
  )
  assert.throws(
    () => resolveProfileDirectory({ directory: "relative" }),
    /absolute path/,
  )
})

test("profile storage is private, deterministic, sorted, and credential-free", async (context) => {
  const directory = await profileRoot(context)
  const support = profile()
  const alerts = profile({
    applicationId: "300000000000000002",
    botId: "400000000000000002",
    name: "alerts-bot",
  })

  await saveProfile(support, { directory })
  await saveProfile(alerts, { directory })

  assert.deepEqual(await loadProfile(support.name, { directory }), support)
  assert.deepEqual(
    (await listProfiles({ directory })).map((entry) => entry.name),
    ["alerts-bot", "support-bot"],
  )
  assert.equal((await lstat(directory)).mode & 0o777, 0o700)
  for (const name of [alerts.name, support.name]) {
    assert.equal(
      (await lstat(profilePath(name, { directory }))).mode & 0o777,
      0o600,
    )
  }
  const stored = await readFile(profilePath(support.name, { directory }), "utf8")
  assert.equal(stored.endsWith("\n"), true)
  assert.doesNotMatch(
    stored,
    new RegExp([
      TOKEN,
      "username",
      "writePolicy",
      "attachmentRoots",
      "auditFile",
      "telemetry",
    ].join("|"), "i"),
  )
  assert.deepEqual(JSON.parse(stored), support)
})

test("profile replacement requires intent and preserves the verified identity lock", async (context) => {
  const directory = await profileRoot(context)
  const initial = profile()
  const updated = profile({ channelIds: [OTHER_CHANNEL_ID] })
  await saveProfile(initial, { directory })

  await assert.rejects(
    () => saveProfile(updated, { directory }),
    /already exists/,
  )
  await saveProfile(updated, { directory, overwrite: true })
  assert.deepEqual(await loadProfile(initial.name, { directory }), updated)

  for (const changedIdentity of [
    profile({ applicationId: "300000000000000099" }),
    profile({ botId: "400000000000000099" }),
  ]) {
    await assert.rejects(
      () => saveProfile(changedIdentity, { directory, overwrite: true }),
      /locked to its verified Discord identity/,
    )
  }
  assert.deepEqual(await loadProfile(initial.name, { directory }), updated)
})

test("profile storage selects one concurrent creator and leaves no lock artifact", async (context) => {
  const directory = await profileRoot(context)
  const candidate = profile()
  const results = await Promise.allSettled([
    saveProfile(candidate, { directory }),
    saveProfile(candidate, { directory }),
    saveProfile(candidate, { directory }),
  ])

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
  assert.equal(results.filter((result) => result.status === "rejected").length, 2)
  assert.deepEqual(await listProfiles({ directory }), [candidate])
  assert.equal(
    (await readdir(directory)).some((entry) => entry.endsWith(".lock")),
    false,
  )
})

test("profile reads fail closed on permission, link, format, and size drift", async (context) => {
  const directory = await profileRoot(context)
  const candidate = profile()
  await saveProfile(candidate, { directory })
  const file = profilePath(candidate.name, { directory })

  if (process.platform !== "win32") {
    await chmod(file, 0o644)
    await assert.rejects(
      () => loadProfile(candidate.name, { directory }),
      /private canonical regular file/,
    )
    await chmod(file, 0o600)
  }

  const hardlink = join(resolve(directory, ".."), "hardlinked-profile.json")
  await link(file, hardlink)
  await assert.rejects(
    () => loadProfile(candidate.name, { directory }),
    /private canonical regular file/,
  )
  await rm(hardlink)

  const external = join(resolve(directory, ".."), "external-profile.json")
  await writeFile(external, `${JSON.stringify(candidate)}\n`, { mode: 0o600 })
  await rm(file)
  await symlink(external, file)
  await assert.rejects(
    () => loadProfile(candidate.name, { directory }),
    /private canonical regular file/,
  )

  await rm(file)
  await writeFile(file, "not-json\n", { mode: 0o600 })
  await assert.rejects(
    () => loadProfile(candidate.name, { directory }),
    /valid JSON/,
  )
  await writeFile(file, JSON.stringify(candidate), { mode: 0o600 })
  await assert.rejects(
    () => loadProfile(candidate.name, { directory }),
    /one complete JSON document/,
  )
  await writeFile(
    file,
    `${"x".repeat(CONNECTOR_LIMITS.configBytes + 1)}\n`,
    { mode: 0o600 },
  )
  await assert.rejects(
    () => loadProfile(candidate.name, { directory }),
    /private canonical regular file/,
  )
})

test("profile directory validation rejects public and linked storage", async (context) => {
  const directory = await profileRoot(context)
  await saveProfile(profile(), { directory })

  if (process.platform !== "win32") {
    await chmod(directory, 0o755)
    await assert.rejects(
      () => listProfiles({ directory }),
      /directory is not private and canonical/,
    )
    await chmod(directory, 0o700)
  }

  const linkedDirectory = join(resolve(directory, ".."), "linked-profiles")
  await symlink(directory, linkedDirectory)
  await assert.rejects(
    () => listProfiles({ directory: linkedDirectory }),
    /directory is not private and canonical/,
  )
})

test("profile activation loads complete policy and rejects ambient policy", async (context) => {
  const directory = await profileRoot(context)
  const candidate = profile({
    channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
    gatewayEnabled: true,
    gatewayEventBufferSize: 250,
    guildIds: [GUILD_ID, OTHER_GUILD_ID],
    capabilities: { deletions: true },
    scopes: { deleteChannelIds: [CHANNEL_ID] },
  })
  await saveProfile(candidate, { directory })
  const source: NodeJS.ProcessEnv = {
    [ALIAS]: ` ${TOKEN} `,
    PATH: "/usr/bin",
  }
  const before = { ...source }

  const activated = await activateProfile(candidate.name, {
    directory,
    environment: source,
  })

  assert.deepEqual(source, before)
  assert.deepEqual(activated.profile, candidate)
  assert.equal(activated.config.token, TOKEN)
  assert.equal(activated.config.expectedApplicationId, APPLICATION_ID)
  assert.equal(activated.config.expectedBotId, BOT_ID)
  assert.deepEqual(
    [...activated.config.allowedGuildIds],
    [GUILD_ID, OTHER_GUILD_ID],
  )
  assert.deepEqual(
    [...activated.config.allowedChannelIds],
    [CHANNEL_ID, OTHER_CHANNEL_ID],
  )
  assert.equal(activated.config.mcpToolSurface, "progressive")
  assert.deepEqual(
    [...activated.config.mcpToolsets],
    ["connector", "messages"],
  )
  assert.equal(activated.config.allowGateway, true)
  assert.equal(activated.config.gatewayEventBufferSize, 250)
  assert.equal(activated.config.allowDeletions, true)
  assert.deepEqual([...activated.config.deleteChannelIds], [CHANNEL_ID])

  await assert.rejects(
    () => activateProfile(candidate.name, { directory, environment: {} }),
    new RegExp(`requires ${ALIAS}`),
  )
  await assert.rejects(
    () => activateProfile(candidate.name, {
      directory,
      environment: {
        [ALIAS]: TOKEN,
        DISCORD_BOT_TOKEN: "different-token",
      },
    }),
    /conflicts with undeclared environment variables.*DISCORD_BOT_TOKEN/,
  )
  await assert.rejects(
    () => activateProfile(candidate.name, {
      directory,
      environment: {
        [ALIAS]: TOKEN,
        [UNDECLARED_POLICY_ENVIRONMENT_VARIABLE]: "false",
      },
    }),
    new RegExp(`conflicts.*${UNDECLARED_POLICY_ENVIRONMENT_VARIABLE}`),
  )
  await assert.rejects(
    () => activateProfile(candidate.name, {
      directory,
      environment: {
        [ALIAS]: TOKEN,
        [CONFIG_FILE_ENVIRONMENT_VARIABLE]: "/configuration/discord-mcp.json",
      },
    }),
    new RegExp(`conflicts.*${CONFIG_FILE_ENVIRONMENT_VARIABLE}`),
  )
})

test("profile activation resolves a file-backed credential without ambient secret state", async (context) => {
  const directory = await profileRoot(context)
  const credentialFile = resolve(directory, "..", "discord-token")
  await writeFile(credentialFile, `${TOKEN}\n`, { mode: 0o600 })
  const candidate = createConnectorProfile({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialFile,
    guildIds: [GUILD_ID],
    name: "file-backed",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
  await saveProfile(candidate, { directory })
  const source = { PATH: "/usr/bin" }

  const activated = await activateProfile(candidate.name, {
    directory,
    environment: source,
  })
  assert.deepEqual(source, { PATH: "/usr/bin" })
  assert.deepEqual(activated.profile.credential, {
    path: credentialFile,
    provider: "file",
  })
  assert.equal(activated.config.token, TOKEN)
  await assert.rejects(
    () => activateProfile(candidate.name, {
      directory,
      environment: { DISCORD_BOT_TOKEN: "ambient-token" },
    }),
    /conflicts with undeclared environment variables/,
  )
})

test("profile removal is recoverable and restore chooses the newest generation", async (context) => {
  const directory = await profileRoot(context)
  const first = profile({ channelIds: [CHANNEL_ID] })
  const second = profile({ channelIds: [OTHER_CHANNEL_ID] })

  await saveProfile(first, { directory })
  const firstTrash = await trashProfile(first.name, { directory })
  await assert.rejects(
    () => loadProfile(first.name, { directory }),
    /not found/,
  )
  assert.deepEqual(await listProfiles({ directory }), [])

  await saveProfile(second, { directory })
  const secondTrash = await trashProfile(second.name, { directory })
  assert.equal(secondTrash.trashId > firstTrash.trashId, true)

  const restored = await restoreProfile(first.name, { directory })
  assert.equal(restored.trashId, secondTrash.trashId)
  assert.deepEqual(await loadProfile(first.name, { directory }), second)
  await assert.rejects(
    () => restoreProfile(first.name, { directory }),
    /already exists/,
  )
})

test("missing profiles have stable content-free lifecycle errors", async (context) => {
  const directory = await profileRoot(context)
  assert.deepEqual(await listProfiles({ directory }), [])
  await assert.rejects(
    () => loadProfile("missing", { directory }),
    /Profile not found: missing/,
  )
  await assert.rejects(
    () => trashProfile("missing", { directory }),
    /Profile not found: missing/,
  )
  await assert.rejects(
    () => restoreProfile("missing", { directory }),
    /No trashed profile found: missing/,
  )
})
