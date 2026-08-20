import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import {
  canonicalJson,
  invariant,
  readJson,
  REPOSITORY_ROOT,
  sha256,
} from "./release-lib.mjs"

const PACKAGE_NAME = "@j-256/discord-mcp"
const MCP_NAME = "io.github.j-256/discord-mcp"
const MCP_DESCRIPTION = "Least-privilege Discord access with bounded reads and reviewed, audited writes"
const REPOSITORY_URL = "https://github.com/j-256/discord-mcp"
const REPOSITORY_ID = "1334461127"
const ICON_SHA256 = "8208f78c171eba7210b836286c2402054fbef3823c143bbbdfa75febb7d515f0"
const REGISTRY_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
const NPM_REGISTRY = "https://registry.npmjs.org"
const NPM_CONFIGURATION = "registry=https://registry.npmjs.org/\nreplace-registry-host=never\n"
const STABLE_SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/
const EXPECTED_DEPENDENCIES = {
  "@modelcontextprotocol/client": "2.0.0",
  "@modelcontextprotocol/server": "2.0.0",
  "@opentelemetry/api": "1.9.1",
  "@opentelemetry/context-async-hooks": "2.10.0",
  "@opentelemetry/exporter-metrics-otlp-proto": "0.221.0",
  "@opentelemetry/exporter-trace-otlp-proto": "0.221.0",
  "@opentelemetry/otlp-exporter-base": "0.221.0",
  "@opentelemetry/resources": "2.10.0",
  "@opentelemetry/sdk-metrics": "2.10.0",
  "@opentelemetry/sdk-trace": "2.10.0",
  zod: "4.4.3",
}
const EXPECTED_DEV_DEPENDENCIES = {
  "@types/node": "26.2.0",
  tsx: "4.23.12",
  typescript: "7.0.2",
}

const EXPECTED_PACKAGE_FILES = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "dist",
  "server.json",
]

const EXPECTED_ENVIRONMENT_NAMES = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_MCP_ADMIN_GUILD_IDS",
  "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  "DISCORD_MCP_ALLOWED_GUILD_IDS",
  "DISCORD_MCP_ALLOW_ADMINISTRATION",
  "DISCORD_MCP_ALLOW_CHANNEL_CREATION",
  "DISCORD_MCP_ALLOW_DELETIONS",
  "DISCORD_MCP_ALLOW_GATEWAY",
  "DISCORD_MCP_ALLOW_INTERACTIONS",
  "DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT",
  "DISCORD_MCP_ALLOW_ROLE_CREATION",
  "DISCORD_MCP_APPLICATION_ID",
  "DISCORD_MCP_AUDIT_FILE",
  "DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS",
  "DISCORD_MCP_DELETE_CHANNEL_IDS",
  "DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE",
  "DISCORD_MCP_INTERACTION_CHANNEL_IDS",
  "DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE",
  "DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS",
  "DISCORD_MCP_MENTION_USER_IDS",
  "DISCORD_MCP_OBSERVABILITY_LOGS",
  "DISCORD_MCP_PROTECTED_USER_IDS",
  "DISCORD_MCP_ROLE_CREATION_GUILD_IDS",
  "DISCORD_MCP_TOOLSETS",
  "DISCORD_MCP_TOOL_SURFACE",
  "OTEL_EXPORTER_OTLP_COMPRESSION",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_METRICS_COMPRESSION",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
  "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TIMEOUT",
  "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
  "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
  "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT",
  "OTEL_SERVICE_NAME",
  "OTEL_TRACES_SAMPLER",
  "OTEL_TRACES_SAMPLER_ARG",
].sort()

const SECRET_ENVIRONMENT_NAMES = new Set([
  "DISCORD_BOT_TOKEN",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
  "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
])

const EXPECTED_ACTION_PINS = new Map([
  ["actions/attest", "1e69f48acb82d1966a394da916b4c1698aa569d6"],
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
  ["github/codeql-action/analyze", "ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd"],
  ["github/codeql-action/init", "ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd"],
])

function assertEqual(actual, expected, message) {
  invariant(canonicalJson(actual) === canonicalJson(expected), message)
}

function assertPinnedDependencies(packageJson) {
  for (const [name, version] of Object.entries({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  })) {
    invariant(STABLE_SEMVER.test(version), `${name} must use an exact stable version`)
  }
}

async function checkPackageAndLock() {
  const packageJson = await readJson(join(REPOSITORY_ROOT, "package.json"))
  const lock = await readJson(join(REPOSITORY_ROOT, "package-lock.json"))
  invariant(packageJson.name === PACKAGE_NAME, "package name does not match the release identity")
  invariant(STABLE_SEMVER.test(packageJson.version), "package version must be stable semantic versioning")
  invariant(packageJson.private === undefined, "publishable package must not be private")
  invariant(packageJson.description === "A least-privilege MCP server for safely accessing and moderating Discord guilds", "package description is invalid")
  invariant(packageJson.author === "j-256", "package author is invalid")
  invariant(packageJson.mcpName === MCP_NAME, "package mcpName does not match the registry identity")
  invariant(packageJson.license === "AGPL-3.0-only", "package license does not match LICENSE")
  invariant(packageJson.engines?.node === ">=22", "package Node.js floor must remain 22")
  invariant(packageJson.main === "./dist/index.js", "package main entrypoint is invalid")
  invariant(packageJson.types === "./dist/index.d.ts", "package types entrypoint is invalid")
  invariant(packageJson.bin?.["discord-mcp"] === "dist/cli.js", "package CLI entrypoint is invalid")
  assertEqual(packageJson.exports, {
    ".": {
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    },
  }, "package exports are invalid")
  assertEqual(packageJson.dependencies, EXPECTED_DEPENDENCIES, "production dependency set changed")
  assertEqual(packageJson.devDependencies, EXPECTED_DEV_DEPENDENCIES, "development dependency set changed")
  assertEqual([...packageJson.keywords].sort(), [
    "host",
    "discord",
    "least-privilege",
    "mcp",
    "model-context-protocol",
    "moderation",
  ], "package keywords are invalid")
  assertEqual([...packageJson.files].sort(), [...EXPECTED_PACKAGE_FILES].sort(), "package file allowlist is invalid")
  assertEqual(packageJson.publishConfig, { access: "public", provenance: true }, "publish configuration must require public provenance")
  assertEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/j-256/discord-mcp.git",
  }, "package repository metadata is invalid")
  invariant(packageJson.homepage === `${REPOSITORY_URL}#readme`, "package homepage is invalid")
  invariant(packageJson.bugs?.url === `${REPOSITORY_URL}/issues`, "package issue tracker is invalid")
  assertEqual(packageJson.allowScripts, {
    "esbuild@0.28.2": true,
    fsevents: false,
  }, "install-script allowlist is invalid")
  assertPinnedDependencies(packageJson)
  assertEqual(packageJson.scripts, {
    build: "tsc -p tsconfig.build.json",
    "deps:locked": "npm ci --ignore-scripts && npm rebuild esbuild@0.28.2 --ignore-scripts=false",
    mcp: "node dist/cli.js serve",
    "metadata:check": "node scripts/check-release-metadata.mjs",
    "pack:verify": "node scripts/pack-and-verify.mjs",
    prepack: "npm run metadata:check && npm run build",
    "probe:live": "node dist/cli.js doctor --online --json",
    sbom: "node scripts/generate-sbom.mjs",
    "security:check": "npm audit --audit-level=moderate && npm audit signatures",
    test: "tsx --test test/*.test.ts",
    "test:coverage": "tsx --test --experimental-test-coverage --test-coverage-lines=85 --test-coverage-branches=75 --test-coverage-functions=80 test/*.test.ts",
    typecheck: "tsc --noEmit",
  }, "package scripts do not match the verified release contract")

  invariant(lock.name === packageJson.name, "lockfile package name is out of sync")
  invariant(lock.version === packageJson.version, "lockfile package version is out of sync")
  invariant(lock.lockfileVersion === 3, "lockfile version must remain npm lockfile v3")
  invariant(lock.requires === true, "lockfile must preserve dependency requirements")
  const root = lock.packages?.[""]
  invariant(root?.name === packageJson.name, "lockfile root package name is out of sync")
  invariant(root?.version === packageJson.version, "lockfile root package version is out of sync")
  assertEqual(root?.dependencies, packageJson.dependencies, "lockfile production dependencies are out of sync")
  assertEqual(root?.devDependencies, packageJson.devDependencies, "lockfile development dependencies are out of sync")
  const installScripts = Object.entries(lock.packages)
    .filter(([, metadata]) => metadata.hasInstallScript === true)
    .map(([path, metadata]) => `${path.replace(/^node_modules\//, "")}@${metadata.version}`)
    .sort()
  assertEqual(installScripts, ["esbuild@0.28.2", "fsevents@2.3.3"], "lockfile install-script packages changed")
  for (const [path, metadata] of Object.entries(lock.packages)) {
    if (!path) continue
    invariant(metadata.link !== true, `${path} must not be a linked dependency`)
    invariant(STABLE_SEMVER.test(metadata.version), `${path} must use a stable package version`)
    invariant(typeof metadata.resolved === "string", `${path} lacks an immutable registry archive`)
    invariant(metadata.resolved.startsWith(`${NPM_REGISTRY}/`), `${path} is not locked to the public npm registry`)
    invariant(typeof metadata.integrity === "string" && metadata.integrity.startsWith("sha512-"), `${path} lacks SHA-512 integrity`)
  }
  return packageJson
}

async function checkSourceIdentity(packageJson) {
  const source = await readFile(join(REPOSITORY_ROOT, "src/constants.ts"), "utf8")
  const connectorName = source.match(/export const CONNECTOR_NAME = "([^"]+)"/)?.[1]
  const connectorVersion = source.match(/export const CONNECTOR_VERSION = "([^"]+)"/)?.[1]
  invariant(connectorName === "discord-mcp", "source connector name is out of sync")
  invariant(connectorVersion === packageJson.version, "source connector version is out of sync")
  const environmentBlock = source.match(/export const ENVIRONMENT_NAMES = Object\.freeze\(\{([\s\S]*?)\n\}\)/)?.[1]
  invariant(environmentBlock, "source environment catalog was not found")
  const environmentNames = [...environmentBlock.matchAll(/:\s*"([A-Z0-9_]+)"/g)]
    .map((match) => match[1])
    .sort()
  assertEqual(environmentNames, EXPECTED_ENVIRONMENT_NAMES, "source environment catalog changed without registry metadata")
}

async function checkDocumentation(packageJson) {
  const readme = await readFile(join(REPOSITORY_ROOT, "README.md"), "utf8")
  const documentedVersions = [...readme.matchAll(/@j-256\/discord-mcp@([0-9]+\.[0-9]+\.[0-9]+)/g)]
    .map((match) => match[1])
  invariant(documentedVersions.length > 0, "README does not show a pinned npm installation")
  invariant(documentedVersions.every((version) => version === packageJson.version), "README npm versions are out of sync")
  invariant(readme.includes(`https://raw.githubusercontent.com/j-256/discord-mcp/v${packageJson.version}/assets/discord-mcp-icon.png`), "README icon URL is out of sync")
}

async function checkRegistryManifest(packageJson) {
  const server = await readJson(join(REPOSITORY_ROOT, "server.json"))
  invariant(server.$schema === REGISTRY_SCHEMA, "registry manifest schema is invalid")
  invariant(server.name === MCP_NAME, "registry server name is invalid")
  invariant(server.title === "Discord MCP", "registry server title is invalid")
  invariant(server.version === packageJson.version, "registry server version is out of sync")
  invariant(server.description === MCP_DESCRIPTION, "registry description is invalid")
  invariant(server.description.length <= 100, "registry description must contain at most 100 characters")
  assertEqual(server.repository, {
    id: REPOSITORY_ID,
    source: "github",
    url: REPOSITORY_URL,
  }, "registry repository identity is invalid")
  invariant(server.websiteUrl === REPOSITORY_URL, "registry website is invalid")
  invariant(server.icons?.length === 1, "registry manifest must declare one project icon")
  const icon = server.icons[0]
  invariant(icon.src === `https://raw.githubusercontent.com/j-256/discord-mcp/v${packageJson.version}/assets/discord-mcp-icon.png`, "registry icon URL must use the exact release tag")
  invariant(icon.mimeType === "image/png", "registry icon media type is invalid")
  const iconBytes = await readFile(join(REPOSITORY_ROOT, "assets/discord-mcp-icon.png"))
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  invariant(iconBytes.subarray(0, pngSignature.length).equals(pngSignature), "project icon is not a PNG")
  invariant(sha256(iconBytes) === ICON_SHA256, "project icon checksum changed")
  const iconSize = `${iconBytes.readUInt32BE(16)}x${iconBytes.readUInt32BE(20)}`
  assertEqual(icon.sizes, [iconSize], "registry icon size does not match the PNG")

  invariant(server.packages?.length === 1, "registry manifest must declare one package")
  const registryPackage = server.packages[0]
  invariant(registryPackage.registryType === "npm", "registry package type is invalid")
  invariant(registryPackage.registryBaseUrl === NPM_REGISTRY, "registry package origin is invalid")
  invariant(registryPackage.identifier === packageJson.name, "registry package name is out of sync")
  invariant(registryPackage.version === packageJson.version, "registry package version is out of sync")
  invariant(registryPackage.runtimeHint === "npx", "registry runtime hint is invalid")
  assertEqual(registryPackage.transport, { type: "stdio" }, "registry transport must remain stdio")
  const environmentVariables = registryPackage.environmentVariables || []
  const environmentNames = environmentVariables.map((entry) => entry.name).sort()
  assertEqual(environmentNames, EXPECTED_ENVIRONMENT_NAMES, "registry environment catalog is incomplete")
  invariant(new Set(environmentNames).size === environmentNames.length, "registry environment catalog contains duplicates")
  const byName = new Map(environmentVariables.map((entry) => [entry.name, entry]))
  for (const entry of environmentVariables) {
    invariant(typeof entry.description === "string" && entry.description.length > 0, `${entry.name} lacks a registry description`)
    if (entry.name === "DISCORD_BOT_TOKEN") continue
    invariant(entry.isRequired === undefined, `${entry.name} must remain optional`)
    if (SECRET_ENVIRONMENT_NAMES.has(entry.name)) {
      invariant(entry.isSecret === true, `${entry.name} must be marked secret`)
    } else {
      invariant(entry.isSecret === undefined, `${entry.name} must not be marked secret`)
    }
  }
  assertEqual(byName.get("DISCORD_BOT_TOKEN"), {
    description: "Discord bot token sent only to fixed Discord REST and vetted Gateway origins",
    format: "string",
    isRequired: true,
    isSecret: true,
    name: "DISCORD_BOT_TOKEN",
  }, "registry token metadata is invalid")
  for (const name of [
    "DISCORD_MCP_ALLOW_ADMINISTRATION",
    "DISCORD_MCP_ALLOW_DELETIONS",
    "DISCORD_MCP_ALLOW_GATEWAY",
    "DISCORD_MCP_ALLOW_INTERACTIONS",
    "DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT",
    "DISCORD_MCP_OBSERVABILITY_LOGS",
  ]) {
    const entry = byName.get(name)
    invariant(entry?.default === "false", `${name} must default to false`)
    assertEqual(entry?.choices, ["false", "true"], `${name} must expose bounded boolean choices`)
  }
  for (const name of [
    "DISCORD_MCP_ADMIN_GUILD_IDS",
    "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
    "DISCORD_MCP_ALLOWED_GUILD_IDS",
    "DISCORD_MCP_APPLICATION_ID",
    "DISCORD_MCP_AUDIT_FILE",
    "DISCORD_MCP_DELETE_CHANNEL_IDS",
    "DISCORD_MCP_INTERACTION_CHANNEL_IDS",
    "DISCORD_MCP_MENTION_USER_IDS",
    "DISCORD_MCP_PROTECTED_USER_IDS",
    "DISCORD_MCP_TOOLSETS",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
    "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
    "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
    "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_SERVICE_NAME",
  ]) {
    invariant(byName.get(name)?.format === "string", `${name} must use string registry input`)
  }
  for (const name of [
    "OTEL_EXPORTER_OTLP_COMPRESSION",
    "OTEL_EXPORTER_OTLP_METRICS_COMPRESSION",
    "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION",
  ]) {
    const entry = byName.get(name)
    assertEqual(entry?.choices, ["none", "gzip"], `${name} must expose bounded compression choices`)
    invariant(
      entry?.default === (name === "OTEL_EXPORTER_OTLP_COMPRESSION" ? "none" : undefined),
      `${name} has an invalid compression default`,
    )
  }
  for (const name of [
    "OTEL_EXPORTER_OTLP_TIMEOUT",
    "OTEL_EXPORTER_OTLP_METRICS_TIMEOUT",
    "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT",
  ]) {
    assertEqual(
      { default: byName.get(name)?.default, format: byName.get(name)?.format },
      {
        default: name === "OTEL_EXPORTER_OTLP_TIMEOUT" ? "10000" : undefined,
        format: "number",
      },
      `${name} metadata is invalid`,
    )
  }
  assertEqual(
    byName.get("OTEL_EXPORTER_OTLP_PROTOCOL")?.default,
    "http/protobuf",
    "shared OTLP protocol default is invalid",
  )
  for (const name of [
    "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
    "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
  ]) {
    invariant(byName.get(name)?.default === undefined, `${name} must remain an explicit override`)
  }
  assertEqual(
    byName.get("OTEL_TRACES_SAMPLER")?.choices,
    [
      "always_off",
      "always_on",
      "parentbased_always_off",
      "parentbased_always_on",
      "parentbased_traceidratio",
      "traceidratio",
    ],
    "registry trace sampler choices are invalid",
  )
  assertEqual(
    {
      default: byName.get("OTEL_TRACES_SAMPLER_ARG")?.default,
      format: byName.get("OTEL_TRACES_SAMPLER_ARG")?.format,
    },
    { default: "1", format: "number" },
    "registry trace sampler argument metadata is invalid",
  )
  assertEqual(
    {
      choices: byName.get("DISCORD_MCP_TOOL_SURFACE")?.choices,
      default: byName.get("DISCORD_MCP_TOOL_SURFACE")?.default,
    },
    { choices: ["full", "progressive"], default: "full" },
    "registry MCP tool surface metadata is invalid",
  )
  assertEqual(
    {
      default: byName.get("DISCORD_MCP_TOOLSETS")?.default,
      format: byName.get("DISCORD_MCP_TOOLSETS")?.format,
    },
    { default: "all", format: "string" },
    "registry MCP toolset metadata is invalid",
  )
  assertEqual(
    {
      default: byName.get("DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE")?.default,
      format: byName.get("DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE")?.format,
    },
    { default: "100", format: "number" },
    "registry Gateway buffer metadata is invalid",
  )
  assertEqual(
    {
      default: byName.get("DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE")?.default,
      format: byName.get("DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE")?.format,
    },
    { default: "10", format: "number" },
    "registry interaction budget metadata is invalid",
  )
  assertEqual(
    {
      default: byName.get("DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS")?.default,
      format: byName.get("DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS")?.format,
    },
    { default: "500", format: "number" },
    "registry interaction interval metadata is invalid",
  )
}

async function checkAutomation() {
  const npmConfiguration = await readFile(join(REPOSITORY_ROOT, ".npmrc"), "utf8")
  invariant(npmConfiguration === NPM_CONFIGURATION, "project npm registry configuration is invalid")
  const workflowsDirectory = join(REPOSITORY_ROOT, ".github/workflows")
  const workflowNames = (await readdir(workflowsDirectory)).filter((name) => name.endsWith(".yml")).sort()
  assertEqual(workflowNames, ["ci.yml", "codeql.yml", "release.yml"], "workflow catalog is invalid")
  for (const name of workflowNames) {
    const workflow = await readFile(join(workflowsDirectory, name), "utf8")
    invariant(!workflow.includes("pull_request_target:"), `${name} must not use pull_request_target`)
    const useLines = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s]+)@([^\s#]+)/gm)]
    for (const [, action, reference] of useLines) {
      invariant(EXPECTED_ACTION_PINS.has(action), `${name} uses unreviewed action ${action}`)
      invariant(FULL_COMMIT_SHA.test(reference), `${name} must pin ${action} to a full commit SHA`)
      invariant(reference === EXPECTED_ACTION_PINS.get(action), `${name} uses an unreviewed commit for ${action}`)
    }
    const externalUseCount = (workflow.match(/^\s*(?:-\s*)?uses:\s*[^.]/gm) || []).length
    invariant(useLines.length === externalUseCount, `${name} contains an unparsable external action reference`)
    const checkoutCount = useLines.filter(([, action]) => action === "actions/checkout").length
    const credentialGuards = (workflow.match(/persist-credentials:\s*false/g) || []).length
    invariant(credentialGuards >= checkoutCount, `${name} must disable persisted checkout credentials`)
  }
  const release = await readFile(join(workflowsDirectory, "release.yml"), "utf8")
  for (const required of [
    "environment: release",
    "bootstrap",
    "stage",
    "register",
    "npm stage publish",
    "--provenance",
    "test \"$(node --version)\" = \"v24.19.0\"",
    "test \"$(npm --version)\" = \"11.17.0\"",
    "package-manager-cache: false",
    "registry-url: https://registry.npmjs.org",
    "NPM_BOOTSTRAP_TOKEN",
    "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}",
    "refs/tags/$RELEASE_TAG",
    "Verify versioned public icon",
    "cmp assets/discord-mcp-icon.png",
    "--proto-redir '=https'",
    "mcp-publisher_linux_amd64.tar.gz",
    "test \"$(uname -m)\" = \"x86_64\"",
    "mcp-publisher 1.8.1 ",
    "v1.8.1",
    "a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc",
  ]) {
    invariant(release.includes(required), `release workflow is missing ${required}`)
  }
  for (const workflowName of ["ci.yml", "release.yml"]) {
    const workflow = await readFile(join(workflowsDirectory, workflowName), "utf8")
    invariant(workflow.includes("NPM_CONFIG_REGISTRY: https://registry.npmjs.org"), `${workflowName} must pin the npm registry`)
    invariant(workflow.includes("NPM_CONFIG_REPLACE_REGISTRY_HOST: never"), `${workflowName} must preserve lockfile registry origins`)
  }
  invariant((release.match(/uses: actions\/attest@/g) || []).length === 2, "release workflow must create provenance and SBOM attestations")
  invariant(!release.includes("secrets.NPM_TOKEN"), "release workflow must not use a standing npm token")
  const codeowners = await readFile(join(REPOSITORY_ROOT, ".github/CODEOWNERS"), "utf8")
  for (const path of [
    "/.github/",
    "/.npmrc",
    "/assets/",
    "/docs/releasing.md",
    "/package.json",
    "/package-lock.json",
    "/server.json",
    "/scripts/",
    "/SECURITY.md",
  ]) {
    invariant(codeowners.includes(`${path} @j-256`), `CODEOWNERS does not protect ${path}`)
  }
}

const packageJson = await checkPackageAndLock()
await checkSourceIdentity(packageJson)
await checkDocumentation(packageJson)
await checkRegistryManifest(packageJson)
await checkAutomation()
process.stdout.write(`Release metadata verified for ${packageJson.name}@${packageJson.version}\n`)
