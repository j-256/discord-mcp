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

const PACKAGE_NAME = "@j-256/discord-mcp"
const DUMMY_TOKEN = "package-verification-placeholder"
const STATIC_RESOURCE_URI = "discord://connector/safety"
const REQUIRED_FILES = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "dist/cli.js",
  "dist/index.d.ts",
  "dist/index.js",
  "package.json",
  "server.json",
]
const STATIC_FILES = new Set([
  "LICENSE",
  "README.md",
  "SECURITY.md",
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
const PROFILE_NAME = "installed-profile"
const PROFILE_TOKEN_VARIABLE = "DISCORD_INSTALLED_BOT_TOKEN"
const entrypoint = process.argv[2]
const version = process.argv[3]
assert.equal(connector.CONNECTOR_VERSION, version)
assert.equal(typeof connector.AutoModerationService, "function")
assert.equal(typeof connector.InviteService, "function")
assert.equal(typeof connector.ScheduledEventService, "function")
await connector.saveProfile(connector.createConnectorProfile({
  applicationId: "100000000000000001",
  botId: "200000000000000001",
  channelIds: ["400000000000000001"],
  credentialVariable: PROFILE_TOKEN_VARIABLE,
  guildIds: ["300000000000000001"],
  name: PROFILE_NAME,
  toolsets: ["connector", "messages"],
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
  const catalogSafety = await catalogClient.readResource({ uri: "${STATIC_RESOURCE_URI}" })
  assert.equal(catalogSafety.contents.length, 1)
} finally {
  await catalogClient.close().catch(() => undefined)
}
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "serve"],
  env: {
    ...getDefaultEnvironment(),
    DISCORD_BOT_TOKEN: "${DUMMY_TOKEN}",
    DISCORD_MCP_TOOLSETS: "deletion",
    DISCORD_MCP_TOOL_SURFACE: "progressive",
  },
})
const client = new Client({ name: "installed-package-verifier", version: "1.0.0" }, { capabilities: {} })
try {
  await client.connect(transport)
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
  const discovery = await client.callTool({
    arguments: { query: REVIEWED_DELETION_TOOLS[0] },
    name: DISCOVERY_TOOL_NAME,
  })
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
  const catalogEnvironment = baseVerificationEnvironment(
    join(workDirectory, "catalog-home"),
  )
  await mkdir(catalogEnvironment.HOME, { recursive: true })
  const catalogResult = await run(bin, ["catalog", "--check", "--json"], {
    capture: true,
    cwd: consumer,
    env: catalogEnvironment,
  })
  const catalog = JSON.parse(catalogResult.stdout)
  invariant(catalog.status === "ok", "installed credential-free catalog check failed")
  invariant(catalog.credentialsRequired === false, "installed catalog unexpectedly requires credentials")
  invariant(catalog.discordExecution === "disabled", "installed catalog enabled Discord execution")
  invariant(catalog.executionGuard === "CATALOG_ONLY", "installed catalog execution guard changed")
  invariant(catalog.gateway === "disabled", "installed catalog enabled the Gateway")
  invariant(catalog.observabilityExport === "disabled", "installed catalog enabled telemetry export")
  invariant(catalog.activityRecordsCreated === false, "installed catalog created activity records")
  for (const name of [
    "toolCount",
    "promptCount",
    "resourceCount",
    "resourceTemplateCount",
  ]) {
    invariant(Number.isSafeInteger(catalog[name]) && catalog[name] > 0, `installed catalog ${name} is invalid`)
  }
  const doctorResult = await run(process.execPath, [entrypoint, "doctor", "--json"], {
    capture: true,
    cwd: consumer,
    env: environment,
  })
  const doctor = JSON.parse(doctorResult.stdout)
  invariant(doctor.online === false && doctor.status !== "error", "installed offline doctor failed")
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
  assert.equal(listedProfiles.profiles[0].credentialVariable, "DISCORD_INSTALLED_BOT_TOKEN")
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
    capture: true,
    cwd: consumer,
    env: {
      ...profileEnvironment,
      DISCORD_INSTALLED_BOT_TOKEN: DUMMY_TOKEN,
    },
  })
  invariant(JSON.parse(profileDoctorResult.stdout).status !== "error", "installed profile activation failed")
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
  await assertNoSecrets(extractedPackage, extractedFiles)
  await verifyInstalledPackage(first.archive, workDirectory, packageJson.version)
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true })
    await copyFile(first.archive, join(outputDirectory, basename(first.archive)), constants.COPYFILE_EXCL)
  }
  process.stdout.write(`Verified reproducible npm archive ${basename(first.archive)} sha256:${sha256(firstBytes)}\n`)
} finally {
  await rm(workDirectory, { force: true, recursive: true })
}
