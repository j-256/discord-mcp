import assert from "node:assert/strict"
import { constants } from "node:fs"
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

import {
  invariant,
  readJson,
  REPOSITORY_ROOT,
  run,
  sha256,
  sha512Integrity,
} from "./release-lib.mjs"
import { containsSpecificReference } from "./neutrality.mjs"

const PACKAGE_NAME = "@j-256/discord-mcp"
const CATALOG_EVIDENCE_FILENAME = "catalog-evidence.json"
const CATALOG_EVIDENCE_FORMAT = "discord-mcp.catalog-evidence.v1"
const CATALOG_HTML_FORMAT = "discord-mcp.catalog-html.v1"
const CONFIG_WORKBENCH_HTML_FORMAT = "discord-mcp.config-workbench-html.v1"
const DUMMY_TOKEN = "package-verification-placeholder"
const EXPECTED_CONFIG_RECIPES = [
  "guild-builder",
  "channel-publisher",
  "direct-messenger",
  "incident-response",
]
const EXPECTED_RECIPE_GATEWAY_REQUIREMENTS = Object.freeze({
  "channel-publisher": Object.freeze({
    evidenceConnection: "none",
    eventFeedPolicy: "unchanged",
    intents: Object.freeze([]),
  }),
  "guild-builder": Object.freeze({
    evidenceConnection: "guild-layout",
    eventFeedPolicy: "unchanged",
    intents: Object.freeze(["GUILDS"]),
  }),
  "direct-messenger": Object.freeze({
    evidenceConnection: "none",
    eventFeedPolicy: "unchanged",
    intents: Object.freeze([]),
  }),
  "incident-response": Object.freeze({
    evidenceConnection: "none",
    eventFeedPolicy: "unchanged",
    intents: Object.freeze([]),
  }),
})
const EXPECTED_REST_METHODS = ["DELETE", "GET", "PATCH", "POST", "PUT"]
const EXPECTED_SETUP_PRESETS = ["server-observer", "channel-reader"]
const EXPECTED_RISK_CLASSES = [
  "administrative-write",
  "destructive-write",
  "discord-read",
  "interaction-write",
  "local-read",
]
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const STATIC_RESOURCE_URI = "discord://connector/safety"
const REQUIRED_FILES = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "discord-mcp.config.schema.json",
  "dist/cli.js",
  "dist/index.d.ts",
  "dist/index.js",
  "docs/reference.md",
  "docs/releasing.md",
  "package.json",
  "server.json",
]
const STATIC_FILES = new Set([
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "discord-mcp.config.schema.json",
  "docs/reference.md",
  "docs/releasing.md",
  "package.json",
  "server.json",
])
const DIST_FILE = /^dist\/[a-z0-9-]+\.(?:d\.ts(?:\.map)?|js(?:\.map)?)$/

function parseOutputDirectory(args) {
  if (args.length === 0) return undefined
  invariant(args.length === 2 && args[0] === "--output", "Usage: pack-and-verify.mjs [--output DIRECTORY]")
  return resolve(args[1])
}

async function createPack(directory) {
  await rm(join(REPOSITORY_ROOT, "dist"), { force: true, recursive: true })
  await run("npm", ["run", "build"])
  const result = await run(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
    { capture: true },
  )
  const reports = JSON.parse(result.stdout)
  invariant(Array.isArray(reports) && reports.length === 1, "npm pack must produce one archive")
  const report = reports[0]
  invariant(typeof report.filename === "string", "npm pack did not report an archive filename")
  return {
    archive: join(directory, report.filename),
    files: report.files.map((entry) => entry.path).sort(),
    integrity: report.integrity,
  }
}

function assertPackageFiles(files) {
  invariant(new Set(files).size === files.length, "npm archive contains duplicate paths")
  for (const required of REQUIRED_FILES) {
    invariant(files.includes(required), `npm archive is missing ${required}`)
  }
  for (const path of files) {
    invariant(STATIC_FILES.has(path) || DIST_FILE.test(path), `npm archive contains unexpected path ${path}`)
  }
}

function assertSortedUniqueStrings(values, label) {
  invariant(Array.isArray(values) && values.length > 0, `${label} is not a non-empty array`)
  invariant(values.every((value) => typeof value === "string" && value.length > 0), `${label} contains an invalid identity`)
  invariant(new Set(values).size === values.length, `${label} contains duplicate identities`)
  assert.deepEqual(values, [...values].sort(), `${label} is not sorted`)
}

function assertCountMap(value, expectedKeys, expectedTotal, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} is not an object`)
  assert.deepEqual(Object.keys(value), expectedKeys, `${label} keys changed`)
  invariant(
    Object.values(value).every((count) => Number.isSafeInteger(count) && count >= 0),
    `${label} contains an invalid count`,
  )
  invariant(
    Object.values(value).reduce((total, count) => total + count, 0) === expectedTotal,
    `${label} total does not match its inventory`,
  )
}

async function listFiles(directory, prefix = "") {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...await listFiles(path, relative))
      continue
    }
    const metadata = await lstat(path)
    invariant(metadata.isFile(), `npm archive contains non-file entry ${relative}`)
    result.push(relative)
  }
  return result.sort()
}

async function assertNoSecrets(packageDirectory, files) {
  const sensitiveValues = [
    REPOSITORY_ROOT,
    process.env.HOME,
    ...Object.entries(process.env)
      .filter(([name]) => /(?:CREDENTIAL|PASS|PRIVATE_KEY|SECRET|TOKEN)/i.test(name))
      .map(([, value]) => value),
  ].map((value) => value?.trim()).filter((value) => value && value.length >= 8)
  for (const relative of files) {
    if (!/\.(?:d\.ts|js|json|map|md)$/.test(relative) && relative !== "LICENSE") continue
    const contents = await readFile(join(packageDirectory, relative), "utf8")
    for (const value of sensitiveValues) {
      invariant(!contents.includes(value), `npm archive embeds a sensitive environment value in ${relative}`)
    }
  }
}

async function assertNeutralPackage(packageDirectory, files) {
  for (const relative of files) {
    invariant(
      !containsSpecificReference(relative),
      `npm archive path ${relative} has model- or harness-specific branding`,
    )
    const contents = await readFile(join(packageDirectory, relative))
    invariant(
      !containsSpecificReference(contents.toString("latin1")),
      `npm archive file ${relative} has model- or harness-specific branding`,
    )
  }
}

function baseVerificationEnvironment(homeDirectory) {
  const environment = {}
  for (const name of [
    "ALL_PROXY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "NPM_CONFIG_CAFILE",
    "NO_PROXY",
    "PATH",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "all_proxy",
    "http_proxy",
    "https_proxy",
    "no_proxy",
  ]) {
    if (process.env[name]) environment[name] = process.env[name]
  }
  Object.assign(environment, {
    HOME: homeDirectory,
    LANG: environment.LANG || "C.UTF-8",
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
    NPM_CONFIG_REPLACE_REGISTRY_HOST: "never",
    PATH: environment.PATH || "/usr/bin:/bin",
    TMPDIR: homeDirectory,
    XDG_STATE_HOME: join(homeDirectory, "state"),
  })
  return environment
}

function verificationEnvironment(homeDirectory) {
  return {
    ...baseVerificationEnvironment(homeDirectory),
    DISCORD_BOT_TOKEN: DUMMY_TOKEN,
  }
}

const INSTALLED_SMOKE = `
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/client"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import * as connector from "@j-256/discord-mcp"

const DISCOVERY_TOOL_NAME = "discover_discord_tools"
const REVIEWED_DELETION_TOOLS = ["plan_message_deletion", "delete_messages"]
const REVIEW_MESSAGE_DELETION_PROMPT = "review_message_deletion"
const PROFILE_NAME = "installed-profile"
const PROFILE_TOKEN_VARIABLE = "DISCORD_INSTALLED_BOT_TOKEN"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const EXPECTED_MCP_TOOL_PROGRESS = [
  { message: "Discord request round started", progress: 0, total: 1 },
  { message: "Discord request round finished", progress: 1, total: 1 },
]
const MCP_PROGRESS_NOTIFICATION_METHOD = "notifications/progress"

function collectWireMcpProgress(updates) {
  return (message) => {
    if (message?.method !== MCP_PROGRESS_NOTIFICATION_METHOD) return
    const params = message.params
    updates.push({
      ...(params.message === undefined ? {} : { message: params.message }),
      progress: params.progress,
      ...(params.total === undefined ? {} : { total: params.total }),
    })
  }
}

function assertInstalledMcpProgress(callbackUpdates, wireUpdates) {
  // The SDK may retire the progress token before dispatching a
  // coalesced terminal frame, so the raw wire is authoritative
  assert.deepEqual(wireUpdates, EXPECTED_MCP_TOOL_PROGRESS)
  assert.ok(callbackUpdates.length <= EXPECTED_MCP_TOOL_PROGRESS.length)
  assert.deepEqual(
    callbackUpdates,
    EXPECTED_MCP_TOOL_PROGRESS.slice(0, callbackUpdates.length),
  )
}

function assertOperationalInstructions(client) {
  const instructions = client.getInstructions()
  assert.equal(typeof instructions, "string")
  assert.ok(instructions.startsWith(connector.MCP_OPERATIONAL_INSTRUCTION_PREAMBLE + " "))
  assert.ok(
    new TextEncoder().encode(connector.MCP_OPERATIONAL_INSTRUCTION_PREAMBLE).byteLength
      <= connector.MCP_INSTRUCTION_PREAMBLE_MAX_BYTES,
  )
}
const entrypoint = process.argv[2]
const version = process.argv[3]
assert.equal(connector.CONNECTOR_VERSION, version)
const expectedServerIdentity = {
  description: connector.CONNECTOR_DESCRIPTION,
  icons: [{
    mimeType: connector.CONNECTOR_ICON_MIME_TYPE,
    sizes: [...connector.CONNECTOR_ICON_SIZES],
    src: connector.CONNECTOR_ICON_URL,
  }],
  name: connector.CONNECTOR_NAME,
  title: connector.CONNECTOR_TITLE,
  version,
  websiteUrl: connector.CONNECTOR_WEBSITE_URL,
}
assert.equal(typeof connector.AutoModerationService, "function")
assert.equal(typeof connector.ChannelCloneService, "function")
assert.equal(typeof connector.ChannelMetadataService, "function")
assert.equal(typeof connector.VoiceChannelStatusService, "function")
assert.equal(typeof connector.GuildTemplateService, "function")
assert.equal(typeof connector.GuildIncidentService, "function")
assert.equal(typeof connector.InviteService, "function")
assert.equal(typeof connector.DirectMessageService, "function")
assert.equal(typeof connector.DiscordClient.prototype.createDirectAttachmentMessage, "function")
assert.equal(typeof connector.readDirectAttachmentFileSnapshot, "function")
assert.equal(typeof connector.RoleConfigurationService, "function")
assert.equal(typeof connector.ScheduledEventService, "function")
assert.deepEqual(connector.SETUP_PRESET_NAMES, ["server-observer", "channel-reader"])
assert.equal(connector.getSetupPreset("server-observer").writeCapable, false)
assert.deepEqual(connector.CONFIG_RECIPE_NAMES, [
  "guild-builder",
  "channel-publisher",
  "direct-messenger",
  "incident-response",
])
assert.equal(connector.getConfigRecipe("guild-builder").writeCapable, true)
assert.equal(connector.getConfigRecipe("direct-messenger").writeCapable, true)
assert.equal(connector.getConfigRecipe("incident-response").writeCapable, true)
assert.equal(typeof connector.planConfigRecipe, "function")
assert.equal(typeof connector.applyConfigRecipe, "function")
assert.equal(typeof connector.createBotInstallPlan, "function")
await connector.saveProfile(connector.createConnectorProfile({
  applicationId: "100000000000000001",
  botId: "200000000000000001",
  channelIds: [CHANNEL_ID],
  credentialVariable: PROFILE_TOKEN_VARIABLE,
  guildIds: [GUILD_ID],
  name: PROFILE_NAME,
  scopes: { deleteChannelIds: [CHANNEL_ID] },
  toolsets: ["deletion"],
  toolSurface: "progressive",
}))
const catalogTransport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "catalog"],
  env: {},
})
const catalogClient = new Client({ name: "installed-catalog-verifier", version: "1.0.0" }, { capabilities: {} })
try {
  await catalogClient.connect(catalogTransport)
  assert.deepEqual(catalogClient.getServerVersion(), expectedServerIdentity)
  const [tools, resources, templates, prompts] = await Promise.all([
    catalogClient.listTools(),
    catalogClient.listResources(),
    catalogClient.listResourceTemplates(),
    catalogClient.listPrompts(),
  ])
  assert.ok(tools.tools.some(({ name }) => name === "read_messages"))
  assert.ok(resources.resources.length > 0)
  assert.ok(templates.resourceTemplates.length > 0)
  assert.ok(prompts.prompts.length > 0)
  assert.deepEqual(catalogClient.getServerCapabilities().completions, {})
  const catalogCompletion = await catalogClient.complete({
    argument: { name: "guildId", value: "" },
    ref: { type: "ref/resource", uri: "discord://guilds/{guildId}/channels" },
  })
  assert.deepEqual(catalogCompletion.completion.values, [])
  const listedGuard = await catalogClient.callTool({
    arguments: {},
    name: "read_messages",
  })
  const unknownGuard = await catalogClient.callTool({
    arguments: { ignored: true },
    name: "installed_unknown_probe",
  })
  assert.deepEqual(unknownGuard, listedGuard)
  assert.equal(listedGuard.isError, true)
  assert.equal(listedGuard.structuredContent.error.code, "CATALOG_ONLY")
  assert.equal(listedGuard.content.length, 2)
  assert.match(listedGuard.content[1].text, /^DISCORD_MCP_RECEIPT /)
  assert.match(listedGuard.content[1].text, /CATALOG_ONLY/)
  const catalogSafety = await catalogClient.readResource({ uri: "${STATIC_RESOURCE_URI}" })
  assert.equal(catalogSafety.contents.length, 1)
} finally {
  await catalogClient.close().catch(() => undefined)
}
const modernCatalogTransport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "catalog"],
  env: {},
})
const modernCatalogClient = new Client(
  { name: "installed-modern-catalog-verifier", version: "1.0.0" },
  {
    capabilities: {},
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  },
)
try {
  await modernCatalogClient.connect(modernCatalogTransport)
  assert.deepEqual(modernCatalogClient.getServerVersion(), expectedServerIdentity)
  const guard = await modernCatalogClient.callTool({
    arguments: {},
    name: "read_messages",
  })
  const completion = await modernCatalogClient.complete({
    argument: { name: "channelId", value: "" },
    ref: { name: "summarize_channel", type: "ref/prompt" },
  })
  assert.equal(modernCatalogClient.getProtocolEra(), "modern")
  assert.equal(guard.content.length, 2)
  assert.match(guard.content[1].text, /^DISCORD_MCP_RECEIPT /)
  assert.match(guard.content[1].text, /CATALOG_ONLY/)
  assert.deepEqual(modernCatalogClient.getServerCapabilities().completions, {})
  assert.deepEqual(completion.completion.values, [])
} finally {
  await modernCatalogClient.close().catch(() => undefined)
}
const operationalEnvironment = {
  ...getDefaultEnvironment(),
  [PROFILE_TOKEN_VARIABLE]: "${DUMMY_TOKEN}",
}
delete operationalEnvironment.DISCORD_BOT_TOKEN
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "serve", "--profile", PROFILE_NAME],
  env: operationalEnvironment,
})
const wireProgress = []
transport.onmessage = collectWireMcpProgress(wireProgress)
const client = new Client({ name: "installed-package-verifier", version: "1.0.0" }, { capabilities: {} })
try {
  await client.connect(transport)
  assert.deepEqual(client.getServerVersion(), expectedServerIdentity)
  assertOperationalInstructions(client)
  const [initialTools, resources, templates, prompts] = await Promise.all([
    client.listTools(),
    client.listResources(),
    client.listResourceTemplates(),
    client.listPrompts(),
  ])
  assert.deepEqual(initialTools.tools.map(({ name }) => name), [DISCOVERY_TOOL_NAME])
  assert.ok(resources.resources.length > 0)
  assert.ok(templates.resourceTemplates.length > 0)
  assert.ok(prompts.prompts.length > 0)
  assert.deepEqual(client.getServerCapabilities().completions, {})
  const [guildCompletion, channelCompletion] = await Promise.all([
    client.complete({
      argument: { name: "guildId", value: "300" },
      ref: { type: "ref/resource", uri: "discord://guilds/{guildId}/channels" },
    }),
    client.complete({
      argument: { name: "channelId", value: "400" },
      ref: { name: REVIEW_MESSAGE_DELETION_PROMPT, type: "ref/prompt" },
    }),
  ])
  assert.deepEqual(guildCompletion.completion.values, [GUILD_ID])
  assert.deepEqual(channelCompletion.completion.values, [CHANNEL_ID])
  const progress = []
  const discovery = await client.callTool({
    arguments: { query: REVIEWED_DELETION_TOOLS[0] },
    name: DISCOVERY_TOOL_NAME,
  }, {
    onprogress: (update) => progress.push(update),
  })
  assertInstalledMcpProgress(progress, wireProgress)
  assert.equal(discovery.isError, undefined)
  assert.deepEqual(
    discovery.structuredContent.newlyEnabledToolNames,
    [...REVIEWED_DELETION_TOOLS].sort(),
  )
  const refreshedTools = await client.listTools()
  assert.deepEqual(
    refreshedTools.tools.map(({ name }) => name),
    [...REVIEWED_DELETION_TOOLS, DISCOVERY_TOOL_NAME],
  )
  const safety = await client.readResource({ uri: "${STATIC_RESOURCE_URI}" })
  assert.equal(safety.contents.length, 1)
  assert.match(safety.contents[0].text, /review-first workflows/)
} finally {
  await client.close().catch(() => undefined)
}
const modernTransport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "serve", "--profile", PROFILE_NAME],
  env: operationalEnvironment,
})
const modernWireProgress = []
modernTransport.onmessage = collectWireMcpProgress(modernWireProgress)
const modernClient = new Client(
  { name: "installed-modern-package-verifier", version: "1.0.0" },
  {
    capabilities: {},
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  },
)
try {
  await modernClient.connect(modernTransport)
  assert.deepEqual(modernClient.getServerVersion(), expectedServerIdentity)
  assertOperationalInstructions(modernClient)
  const progress = []
  await modernClient.callTool({
    arguments: { query: REVIEWED_DELETION_TOOLS[0] },
    name: DISCOVERY_TOOL_NAME,
  }, {
    onprogress: (update) => progress.push(update),
  })
  const completion = await modernClient.complete({
    argument: { name: "guildId", value: "300" },
    ref: { type: "ref/resource", uri: "discord://guilds/{guildId}/channels" },
  })
  assert.equal(modernClient.getProtocolEra(), "modern")
  assertInstalledMcpProgress(progress, modernWireProgress)
  assert.deepEqual(modernClient.getServerCapabilities().completions, {})
  assert.deepEqual(completion.completion.values, [GUILD_ID])
} finally {
  await modernClient.close().catch(() => undefined)
}
`

async function verifyInstalledPackage(archive, workDirectory, version) {
  const consumer = join(workDirectory, "consumer")
  await mkdir(consumer)
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`)
  const environment = verificationEnvironment(join(workDirectory, "home"))
  await mkdir(environment.HOME, { recursive: true })
  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
    { cwd: consumer, env: environment },
  )
  const entrypoint = join(consumer, "node_modules", "@j-256", "discord-mcp", "dist", "cli.js")
  const libraryEntrypoint = join(
    consumer,
    "node_modules",
    "@j-256",
    "discord-mcp",
    "dist",
    "index.js",
  )
  const bin = join(consumer, "node_modules", ".bin", "discord-mcp")
  const versionResult = await run(bin, ["version"], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  assert.equal(versionResult.stdout.trim(), version)
  const helpResult = await run(process.execPath, [entrypoint, "help"], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  assert.match(helpResult.stdout, /Run the stdio MCP server/)
  const libraryResult = await run(process.execPath, [libraryEntrypoint], {
    allowedExitCodes: [1],
    capture: true,
    cwd: consumer,
    env: environment,
  })
  assert.equal(libraryResult.stdout, "")
  assert.match(
    libraryResult.stderr,
    /package library entrypoint does not run an MCP server/u,
  )
  assert.match(libraryResult.stderr, /discord-mcp serve --config FILE/u)
  assert.match(libraryResult.stderr, /node dist\/cli\.js serve --config FILE/u)
  invariant(
    !libraryResult.stderr.includes(DUMMY_TOKEN),
    "installed library-entrypoint diagnostic exposed the credential",
  )
  const configHelpResult = await run(bin, ["config", "--help"], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  assert.match(configHelpResult.stdout, /workbench ACTIVE_FILE --html OUTPUT_FILE/)
  const catalogEnvironment = baseVerificationEnvironment(
    join(workDirectory, "catalog-home"),
  )
  await mkdir(catalogEnvironment.HOME, { recursive: true })
  const presetResult = await run(bin, ["preset", "list", "--json"], {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  const repeatedPresetResult = await run(bin, ["preset", "list", "--json"], {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  assert.equal(
    repeatedPresetResult.stdout,
    presetResult.stdout,
    "installed setup presets are not deterministic",
  )
  const presetReport = JSON.parse(presetResult.stdout)
  invariant(presetReport.status === "ok", "installed setup preset inspection failed")
  assert.deepEqual(
    presetReport.presets.map(({ name }) => name),
    EXPECTED_SETUP_PRESETS,
  )
  for (const preset of presetReport.presets) {
    invariant(preset.writeCapable === false, `installed setup preset ${preset.name} enables writes`)
    invariant(preset.gatewayEnabled === false, `installed setup preset ${preset.name} enables the Gateway`)
    assertSortedUniqueStrings(preset.toolNames, `installed setup preset ${preset.name} tool inventory`)
    assertSortedUniqueStrings(preset.toolsets, `installed setup preset ${preset.name} toolset inventory`)
    assert.deepEqual(preset.riskClasses, ["discord-read", "local-read"])
    invariant(preset.requirements.botPermissions.includes("ADMINISTRATOR") === false, `installed setup preset ${preset.name} requests Administrator`)
    invariant(/^(0|[1-9][0-9]*)$/.test(preset.requirements.botPermissionBitfield), `installed setup preset ${preset.name} has an invalid bot permission bitfield`)
  }
  const recipeResult = await run(bin, ["recipe", "list", "--json"], {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  const repeatedRecipeResult = await run(bin, ["recipe", "list", "--json"], {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  assert.equal(
    repeatedRecipeResult.stdout,
    recipeResult.stdout,
    "installed configuration recipes are not deterministic",
  )
  const recipeReport = JSON.parse(recipeResult.stdout)
  invariant(recipeReport.status === "ok", "installed configuration recipe inspection failed")
  assert.deepEqual(
    recipeReport.recipes.map(({ name }) => name),
    EXPECTED_CONFIG_RECIPES,
  )
  for (const recipe of recipeReport.recipes) {
    invariant(recipe.writeCapable === true, `installed configuration recipe ${recipe.name} is not write-capable`)
    invariant(recipe.requirements.botPermissions.includes("ADMINISTRATOR") === false, `installed configuration recipe ${recipe.name} requests Administrator`)
    invariant(/^(0|[1-9][0-9]*)$/.test(recipe.requirements.botPermissionBitfield), `installed configuration recipe ${recipe.name} has an invalid bot permission bitfield`)
    invariant(
      (recipe.requirements.botPermissions.length === 0)
        === (recipe.requirements.botPermissionBitfield === "0"),
      `installed configuration recipe ${recipe.name} permission names and bitfield disagree`,
    )
    assertSortedUniqueStrings(recipe.capabilities, `installed configuration recipe ${recipe.name} capability inventory`)
    assertSortedUniqueStrings(recipe.riskClasses, `installed configuration recipe ${recipe.name} risk inventory`)
    assertSortedUniqueStrings(recipe.toolNames, `installed configuration recipe ${recipe.name} tool inventory`)
    assertSortedUniqueStrings(recipe.toolsets, `installed configuration recipe ${recipe.name} toolset inventory`)
    invariant(recipe.requirements.scope.targets.length > 0, `installed configuration recipe ${recipe.name} has no scope target`)
    assert.deepEqual(
      recipe.requirements.gateway,
      EXPECTED_RECIPE_GATEWAY_REQUIREMENTS[recipe.name],
      `installed configuration recipe ${recipe.name} Gateway requirement is invalid`,
    )
  }
  const installArguments = [
    "preset",
    "install",
    "channel-reader",
    "--application-id",
    "100000000000000001",
    "--guild-id",
    "300000000000000001",
    "--json",
  ]
  const installResult = await run(bin, installArguments, {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  const repeatedInstallResult = await run(bin, installArguments, {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  assert.equal(repeatedInstallResult.stdout, installResult.stdout, "installed bot plan is not deterministic")
  const installPlan = JSON.parse(installResult.stdout)
  invariant(installPlan.status === "ok", "installed bot planning failed")
  assert.deepEqual(installPlan.authorization, {
    callbackRequired: false,
    guildSelectionLocked: true,
    installContext: "guild",
    scopes: ["bot"],
    userTokenRequested: false,
  })
  assert.deepEqual(installPlan.execution, {
    browserOpened: false,
    credentialsRequired: false,
    discordContacted: false,
  })
  assert.deepEqual(installPlan.permissions, {
    administratorRequested: false,
    bitfield: "66560",
    names: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
  })
  assert.equal(
    installPlan.installUrl,
    "https://discord.com/oauth2/authorize?client_id=100000000000000001&scope=bot&permissions=66560&guild_id=300000000000000001&disable_guild_select=true",
  )
  assert.doesNotMatch(installResult.stdout, /ADMINISTRATOR/)
  const catalogResult = await run(bin, ["catalog", "--check", "--json"], {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  const repeatedCatalogResult = await run(bin, ["catalog", "--check", "--json"], {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  assert.equal(repeatedCatalogResult.stdout, catalogResult.stdout, "installed catalog evidence is not deterministic")
  const catalog = JSON.parse(catalogResult.stdout)
  invariant(catalog.status === "ok", "installed credential-free catalog check failed")
  invariant(catalog.evidenceFormat === CATALOG_EVIDENCE_FORMAT, "installed catalog evidence format changed")
  invariant(SHA256_DIGEST_PATTERN.test(catalog.contractDigest), "installed catalog contract digest is invalid")
  invariant(SHA256_DIGEST_PATTERN.test(catalog.safetyResourceDigest), "installed catalog safety digest is invalid")
  invariant(catalog.contractDigest !== catalog.safetyResourceDigest, "installed catalog digests unexpectedly match")
  invariant(catalog.credentialsRequired === false, "installed catalog unexpectedly requires credentials")
  invariant(catalog.discordExecution === "disabled", "installed catalog enabled Discord execution")
  invariant(catalog.executionGuard === "CATALOG_ONLY", "installed catalog execution guard changed")
  invariant(catalog.gateway === "disabled", "installed catalog enabled the Gateway")
  invariant(catalog.observabilityExport === "disabled", "installed catalog enabled telemetry export")
  invariant(catalog.activityRecordsCreated === false, "installed catalog created activity records")
  invariant(
    Number.isSafeInteger(catalog.completionBindingCount)
      && catalog.completionBindingCount > 0,
    "installed catalog completion binding count is invalid",
  )
  invariant(
    catalog.completionCatalogValuesExposed === false,
    "installed catalog exposed completion identifiers",
  )
  invariant(
    Array.isArray(catalog.completionBindings)
      && catalog.completionBindings.length === catalog.completionBindingCount,
    "installed catalog completion manifest does not match its count",
  )
  const completionKeys = []
  for (const completion of catalog.completionBindings) {
    invariant(
      completion
        && (completion.kind === "prompt" || completion.kind === "resource-template")
        && typeof completion.reference === "string"
        && completion.reference.length > 0
        && typeof completion.argument === "string"
        && completion.argument.length > 0,
      "installed catalog contains an invalid completion binding",
    )
    assertSortedUniqueStrings(
      completion.policyFields,
      `installed completion ${completion.reference} ${completion.argument} policy fields`,
    )
    completionKeys.push(`${completion.kind}:${completion.reference}:${completion.argument}`)
  }
  assertSortedUniqueStrings(completionKeys, "installed completion binding inventory")
  for (const name of [
    "toolCount",
    "promptCount",
    "resourceCount",
    "resourceTemplateCount",
  ]) {
    invariant(Number.isSafeInteger(catalog[name]) && catalog[name] > 0, `installed catalog ${name} is invalid`)
  }
  for (const [names, count, label] of [
    [catalog.toolNames, catalog.toolCount, "installed tool inventory"],
    [catalog.promptNames, catalog.promptCount, "installed prompt inventory"],
    [catalog.resourceUris, catalog.resourceCount, "installed resource inventory"],
    [catalog.resourceTemplateUris, catalog.resourceTemplateCount, "installed resource-template inventory"],
  ]) {
    assertSortedUniqueStrings(names, label)
    invariant(names.length === count, `${label} count does not match`)
  }
  assertSortedUniqueStrings(catalog.toolsetNames, "installed toolset inventory")
  invariant(
    Number.isSafeInteger(catalog.restOperationCount) && catalog.restOperationCount > 0,
    "installed REST operation count is invalid",
  )
  assertCountMap(
    catalog.riskClassCounts,
    EXPECTED_RISK_CLASSES,
    catalog.toolCount,
    "installed risk-class counts",
  )
  assertCountMap(
    catalog.restMethodCounts,
    EXPECTED_REST_METHODS,
    catalog.restOperationCount,
    "installed REST method counts",
  )
  const firstCatalogHtml = join(consumer, "catalog-first.html")
  const secondCatalogHtml = join(consumer, "catalog-second.html")
  const catalogHtmlEnvironment = {
    ...catalogEnvironment,
    DISCORD_MCP_CONFIG_FILE: join(consumer, "unavailable-catalog-policy.json"),
    DISCORD_PACKAGE_BOT_TOKEN: DUMMY_TOKEN,
  }
  const firstCatalogHtmlResult = await run(bin, ["catalog", "--html", firstCatalogHtml], {
    capture: true,
    cwd: consumer,
    env: catalogHtmlEnvironment,
  })
  const secondCatalogHtmlResult = await run(bin, ["catalog", "--html", secondCatalogHtml], {
    capture: true,
    cwd: consumer,
    env: catalogHtmlEnvironment,
  })
  assert.match(firstCatalogHtmlResult.stdout, /Discord MCP catalog HTML: ok/)
  assert.match(secondCatalogHtmlResult.stdout, /Discord MCP catalog HTML: ok/)
  const firstCatalogHtmlBytes = await readFile(firstCatalogHtml)
  const secondCatalogHtmlBytes = await readFile(secondCatalogHtml)
  invariant(firstCatalogHtmlBytes.equals(secondCatalogHtmlBytes), "installed catalog HTML is not deterministic")
  invariant(
    ((await lstat(firstCatalogHtml)).mode & 0o077) === 0
      && ((await lstat(secondCatalogHtml)).mode & 0o077) === 0,
    "installed catalog HTML is not private",
  )
  const catalogHtml = firstCatalogHtmlBytes.toString("utf8")
  invariant(catalogHtml.includes(CATALOG_HTML_FORMAT), "installed catalog HTML format changed")
  invariant(catalogHtml.includes('id="completions"'), "installed catalog HTML omitted completions")
  invariant(catalogHtml.includes(catalog.contractDigest), "installed catalog HTML contract digest changed")
  invariant(catalogHtml.includes(catalog.safetyResourceDigest), "installed catalog HTML safety digest changed")
  for (const toolName of catalog.toolNames) {
    invariant(catalogHtml.includes(`id="tool-${toolName}"`), `installed catalog HTML omitted ${toolName}`)
  }
  for (const completion of catalog.completionBindings) {
    invariant(
      catalogHtml.includes(completion.reference)
        && catalogHtml.includes(completion.argument),
      `installed catalog HTML omitted completion ${completion.reference} ${completion.argument}`,
    )
  }
  invariant(!catalogHtml.includes(DUMMY_TOKEN), "installed catalog HTML captured an ambient secret")
  invariant(
    !catalogHtml.includes(catalogHtmlEnvironment.DISCORD_MCP_CONFIG_FILE),
    "installed catalog HTML captured the ambient policy selector",
  )
  const configFile = join(consumer, "discord-mcp.json")
  const configResult = await run(bin, [
    "config",
    "init",
    configFile,
    "--name",
    "installed-config",
    "--application-id",
    "100000000000000001",
    "--bot-id",
    "200000000000000001",
    "--guild-id",
    "300000000000000001",
    "--preset",
    "server-observer",
    "--json",
  ], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const initializedConfig = JSON.parse(configResult.stdout)
  invariant(initializedConfig.status === "ok", "installed config initialization failed")
  const firstWorkbenchFile = join(consumer, "workbench-first.html")
  const secondWorkbenchFile = join(consumer, "workbench-second.html")
  const firstWorkbenchResult = await run(bin, [
    "config",
    "workbench",
    configFile,
    "--html",
    firstWorkbenchFile,
    "--json",
  ], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const secondWorkbenchResult = await run(bin, [
    "config",
    "workbench",
    configFile,
    "--html",
    secondWorkbenchFile,
    "--json",
  ], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const workbench = JSON.parse(firstWorkbenchResult.stdout)
  const repeatedWorkbench = JSON.parse(secondWorkbenchResult.stdout)
  for (const report of [workbench, repeatedWorkbench]) {
    invariant(report.status === "ok", "installed configuration workbench export failed")
    invariant(report.format === CONFIG_WORKBENCH_HTML_FORMAT, "installed configuration workbench format changed")
    invariant(SHA256_DIGEST_PATTERN.test(report.activeDocumentDigest), "installed configuration workbench document digest is invalid")
    invariant(SHA256_DIGEST_PATTERN.test(report.schemaDigest), "installed configuration workbench schema digest is invalid")
    invariant(SHA256_DIGEST_PATTERN.test(report.htmlDigest), "installed configuration workbench HTML digest is invalid")
    assert.deepEqual({
      activeConfigurationWritten: report.activeConfigurationWritten,
      automaticNetwork: report.automaticNetwork,
      browserOpened: report.browserOpened,
      candidateAuthority: report.candidateAuthority,
      configurationEmbedded: report.configurationEmbedded,
      credentialsEmbedded: report.credentialsEmbedded,
      discordContacted: report.discordContacted,
      externalNavigationOrigins: report.externalNavigationOrigins,
      outputFileCreated: report.outputFileCreated,
      secretValuesRead: report.secretValuesRead,
      statePersistence: report.statePersistence,
    }, {
      activeConfigurationWritten: false,
      automaticNetwork: "disabled",
      browserOpened: false,
      candidateAuthority: "explicit-download-only",
      configurationEmbedded: true,
      credentialsEmbedded: false,
      discordContacted: false,
      externalNavigationOrigins: [],
      outputFileCreated: true,
      secretValuesRead: false,
      statePersistence: "disabled",
    })
  }
  assert.equal(repeatedWorkbench.htmlDigest, workbench.htmlDigest, "installed configuration workbench digest is not deterministic")
  const firstWorkbenchBytes = await readFile(firstWorkbenchFile)
  const secondWorkbenchBytes = await readFile(secondWorkbenchFile)
  invariant(firstWorkbenchBytes.equals(secondWorkbenchBytes), "installed configuration workbench HTML is not deterministic")
  invariant(
    ((await lstat(firstWorkbenchFile)).mode & 0o077) === 0
      && ((await lstat(secondWorkbenchFile)).mode & 0o077) === 0,
    "installed configuration workbench HTML is not private",
  )
  const workbenchHtml = firstWorkbenchBytes.toString("utf8")
  invariant(workbenchHtml.includes(CONFIG_WORKBENCH_HTML_FORMAT), "installed configuration workbench HTML omitted its format")
  invariant(workbenchHtml.includes("connect-src 'none'"), "installed configuration workbench HTML permits network connections")
  invariant(!workbenchHtml.includes(DUMMY_TOKEN), "installed configuration workbench HTML captured an ambient secret")
  invariant(!/(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage)/.test(workbenchHtml), "installed configuration workbench HTML contains forbidden browser authority")
  assert.deepEqual(
    JSON.parse(await readFile(configFile, "utf8")),
    initializedConfig.document,
    "installed configuration workbench changed the active policy",
  )
  const recipePlanArguments = [
    "recipe",
    "plan",
    "guild-builder",
    configFile,
    "--guild-id",
    "300000000000000001",
    "--json",
  ]
  const recipePlanResult = await run(bin, recipePlanArguments, {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const repeatedRecipePlanResult = await run(bin, recipePlanArguments, {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  assert.equal(
    repeatedRecipePlanResult.stdout,
    recipePlanResult.stdout,
    "installed configuration recipe plan is not deterministic",
  )
  const recipePlan = JSON.parse(recipePlanResult.stdout)
  invariant(recipePlan.action === "plan" && recipePlan.status === "planned", "installed configuration recipe planning failed")
  invariant(SHA256_DIGEST_PATTERN.test(recipePlan.currentDocumentDigest), "installed configuration recipe current digest is invalid")
  invariant(SHA256_DIGEST_PATTERN.test(recipePlan.proposedDocumentDigest), "installed configuration recipe proposed digest is invalid")
  invariant(SHA256_DIGEST_PATTERN.test(recipePlan.recipeContractDigest), "installed configuration recipe contract digest is invalid")
  invariant(SHA256_DIGEST_PATTERN.test(recipePlan.planDigest), "installed configuration recipe plan digest is invalid")
  assert.deepEqual(recipePlan.execution, {
    configurationWritten: false,
    discordContacted: false,
    secretValuesRead: false,
  })
  invariant(recipePlan.proposedDocument.capabilities.guildScaffolds === true, "installed guild-builder recipe omitted guild scaffolds")
  for (const scope of [
    "guildScaffoldGuildIds",
    "guildProfileGuildIds",
    "guildSettingsGuildIds",
    "onboardingGuildIds",
    "welcomeScreenGuildIds",
  ]) {
    assert.deepEqual(
      recipePlan.proposedDocument.scopes[scope],
      ["300000000000000001"],
      `installed guild-builder recipe omitted ${scope}`,
    )
  }
  assert.doesNotMatch(recipePlanResult.stdout, new RegExp(DUMMY_TOKEN))
  const recipeApplyResult = await run(bin, [
    "recipe",
    "apply",
    "guild-builder",
    configFile,
    "--guild-id",
    "300000000000000001",
    "--plan-digest",
    recipePlan.planDigest,
    "--confirm",
    "guild-builder",
    "--json",
  ], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const recipeApply = JSON.parse(recipeApplyResult.stdout)
  invariant(recipeApply.action === "apply" && recipeApply.status === "applied", "installed configuration recipe application failed")
  assert.deepEqual(recipeApply.execution, {
    configurationWritten: true,
    discordContacted: false,
    secretValuesRead: false,
  })
  invariant(typeof recipeApply.backupFile === "string", "installed configuration recipe omitted its recoverable backup")
  assert.deepEqual(
    JSON.parse(await readFile(recipeApply.backupFile, "utf8")),
    initializedConfig.document,
    "installed configuration recipe backup changed the reviewed source",
  )
  invariant(
    ((await lstat(recipeApply.backupFile)).mode & 0o077) === 0,
    "installed configuration recipe backup is not private",
  )
  const appliedConfig = JSON.parse(await readFile(configFile, "utf8"))
  assert.deepEqual(appliedConfig, recipePlan.proposedDocument)
  assert.doesNotMatch(recipeApplyResult.stdout, new RegExp(DUMMY_TOKEN))
  const alreadyCurrentPlanResult = await run(bin, recipePlanArguments, {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const alreadyCurrentPlan = JSON.parse(alreadyCurrentPlanResult.stdout)
  invariant(alreadyCurrentPlan.status === "already-current", "installed configuration recipe did not detect current policy")
  const noOpRecipeResult = await run(bin, [
    "recipe",
    "apply",
    "guild-builder",
    configFile,
    "--guild-id",
    "300000000000000001",
    "--plan-digest",
    alreadyCurrentPlan.planDigest,
    "--confirm",
    "guild-builder",
    "--json",
  ], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const noOpRecipe = JSON.parse(noOpRecipeResult.stdout)
  invariant(noOpRecipe.status === "already-current" && noOpRecipe.applied === false, "installed configuration recipe no-op failed")
  invariant(noOpRecipe.backupFile === undefined, "installed configuration recipe no-op created a backup")
  assert.deepEqual(noOpRecipe.execution, {
    configurationWritten: false,
    discordContacted: false,
    secretValuesRead: false,
  })
  const doctorResult = await run(process.execPath, [
    entrypoint,
    "doctor",
    "--config",
    configFile,
    "--json",
  ], {
    allowedExitCodes: [0, 1],
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const doctor = JSON.parse(doctorResult.stdout)
  invariant(doctor.online === false && doctor.status !== "error", "installed offline doctor failed")
  assert.equal(doctorResult.code, doctor.status === "warning" ? 1 : 0)
  const smokePath = join(consumer, "installed-smoke.mjs")
  await writeFile(smokePath, INSTALLED_SMOKE)
  await run(process.execPath, [smokePath, entrypoint, version], {
    cwd: consumer,
    env: environment,
  })
  const profileEnvironment = baseVerificationEnvironment(environment.HOME)
  const listResult = await run(bin, ["profile", "list", "--json"], {
    capture: true,
    cwd: consumer,
    env: profileEnvironment,
  })
  const listedProfiles = JSON.parse(listResult.stdout)
  assert.deepEqual(listedProfiles.profiles.map(({ name }) => name), ["installed-profile"])
  assert.equal(listedProfiles.profiles[0].credentialProvider, "environment")
  assert.equal(listedProfiles.profiles[0].credentialReference, "DISCORD_INSTALLED_BOT_TOKEN")
  const showResult = await run(bin, ["profile", "show", "installed-profile", "--json"], {
    capture: true,
    cwd: consumer,
    env: profileEnvironment,
  })
  const shownProfile = JSON.parse(showResult.stdout)
  assert.equal(shownProfile.profile.identity.applicationId, "100000000000000001")
  assert.equal(shownProfile.profile.identity.botId, "200000000000000001")
  const removeResult = await run(bin, [
    "profile",
    "remove",
    "installed-profile",
    "--confirm",
    "installed-profile",
    "--json",
  ], {
    capture: true,
    cwd: consumer,
    env: profileEnvironment,
  })
  const removal = JSON.parse(removeResult.stdout)
  assert.equal(removal.action, "remove")
  assert.equal(removal.credentialUnaffected, true)
  assert.equal(removal.recoverable, true)
  const emptyListResult = await run(bin, ["profile", "list", "--json"], {
    capture: true,
    cwd: consumer,
    env: profileEnvironment,
  })
  assert.deepEqual(JSON.parse(emptyListResult.stdout).profiles, [])
  const restoreResult = await run(bin, [
    "profile",
    "restore",
    "installed-profile",
    "--confirm",
    "installed-profile",
    "--json",
  ], {
    capture: true,
    cwd: consumer,
    env: profileEnvironment,
  })
  const restoration = JSON.parse(restoreResult.stdout)
  assert.equal(restoration.action, "restore")
  assert.equal(restoration.credentialUnaffected, true)
  const profileDoctorResult = await run(bin, [
    "doctor",
    "--profile",
    "installed-profile",
    "--json",
  ], {
    allowedExitCodes: [0, 1],
    capture: true,
    cwd: consumer,
    env: {
      ...profileEnvironment,
      DISCORD_INSTALLED_BOT_TOKEN: DUMMY_TOKEN,
    },
  })
  const profileDoctor = JSON.parse(profileDoctorResult.stdout)
  invariant(profileDoctor.status !== "error", "installed profile activation failed")
  assert.equal(profileDoctorResult.code, profileDoctor.status === "warning" ? 1 : 0)
  return catalog
}

const outputDirectory = parseOutputDirectory(process.argv.slice(2))
const packageJson = await readJson(join(REPOSITORY_ROOT, "package.json"))
invariant(packageJson.name === PACKAGE_NAME, "package identity changed before pack verification")
const temporaryWorkDirectory = await mkdtemp(join(tmpdir(), "discord-mcp-pack-"))
const workDirectory = await realpath(temporaryWorkDirectory)
try {
  await run(process.execPath, ["scripts/check-release-metadata.mjs"])
  const firstDirectory = join(workDirectory, "first")
  const secondDirectory = join(workDirectory, "second")
  await mkdir(firstDirectory)
  await mkdir(secondDirectory)
  const first = await createPack(firstDirectory)
  const second = await createPack(secondDirectory)
  assert.deepEqual(second.files, first.files)
  assertPackageFiles(first.files)
  const firstBytes = await readFile(first.archive)
  const secondBytes = await readFile(second.archive)
  invariant(firstBytes.equals(secondBytes), "independent npm archives are not byte-identical")
  invariant(first.integrity === sha512Integrity(firstBytes), "npm pack reported unexpected SHA-512 integrity")
  invariant(second.integrity === first.integrity, "independent npm archives report different integrity")
  invariant(basename(first.archive) === `j-256-discord-mcp-${packageJson.version}.tgz`, "npm archive filename is invalid")
  const extraction = join(workDirectory, "extracted")
  await mkdir(extraction)
  await run("tar", ["-xzf", first.archive, "-C", extraction])
  const extractedPackage = join(extraction, "package")
  const extractedFiles = await listFiles(extractedPackage)
  assert.deepEqual(extractedFiles, first.files)
  await assertNeutralPackage(extractedPackage, extractedFiles)
  await assertNoSecrets(extractedPackage, extractedFiles)
  const catalogEvidence = await verifyInstalledPackage(
    first.archive,
    workDirectory,
    packageJson.version,
  )
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true })
    await copyFile(first.archive, join(outputDirectory, basename(first.archive)), constants.COPYFILE_EXCL)
    await writeFile(
      join(outputDirectory, CATALOG_EVIDENCE_FILENAME),
      `${JSON.stringify(catalogEvidence, null, 2)}\n`,
      { flag: "wx" },
    )
  }
  process.stdout.write(`Verified reproducible npm archive ${basename(first.archive)} sha256:${sha256(firstBytes)}\n`)
} finally {
  await rm(workDirectory, { force: true, recursive: true })
}
