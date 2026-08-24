import {
  lstat,
  readFile,
  readlink,
  readdir,
} from "node:fs/promises"
import { join } from "node:path"

import {
  canonicalJson,
  invariant,
  readJson,
  REPOSITORY_ROOT,
  run,
  sha256,
} from "./release-lib.mjs"
import { containsSpecificReference } from "./neutrality.mjs"

const PACKAGE_NAME = "@j-256/discord-mcp"
const MCP_NAME = "io.github.j-256/discord-mcp"
const MCP_DESCRIPTION = "Least-privilege Discord reads, privacy-safe audits, and reviewed administration"
const REPOSITORY_URL = "https://github.com/j-256/discord-mcp"
const REPOSITORY_ID = "1334461127"
const ICON_SHA256 = "4b65ca78a84dc8d5cc5ac5e1e19a08c4bab20d7d455cc0cb57185e6ff2ca15de"
const REGISTRY_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
const NPM_REGISTRY = "https://registry.npmjs.org"
const NPM_CONFIGURATION = "registry=https://registry.npmjs.org/\nreplace-registry-host=never\n"
const OCI_IMAGE_NAME = "ghcr.io/j-256/discord-mcp"
const NODE_IMAGE = "node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436"
const BINFMT_IMAGE = "tonistiigi/binfmt@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0"
const BUILDKIT_IMAGE = "moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8"
const SBOM_GENERATOR_IMAGE = "docker.io/docker/buildkit-syft-scanner@sha256:ae4f3b554449e7e25548e7d8ccc029d17357348e30c6e3df01b92bc93654d6a9"
const README_MAX_BYTES = 32 * 1024
const README_REQUIRED_HEADINGS = Object.freeze([
  "## Why this connector",
  "## Quick start",
  "## Capability map",
  "## Safety model",
  "## Trust and verification",
  "## Architecture",
  "## Documentation",
  "## Development",
  "## License",
])
const REFERENCE_REQUIRED_HEADINGS = Object.freeze([
  "## Safety model",
  "## Requirements",
  "## Operator CLI",
  "## Configuration",
  "## Tools",
  "## Resources",
  "## Deletion workflow",
  "## Verification",
  "## Release integrity",
])
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

async function checkNeutrality() {
  const { stdout } = await run(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { capture: true },
  )
  const paths = stdout.split("\0").filter(Boolean)
  for (const path of paths) {
    invariant(!containsSpecificReference(path), `${path} has model- or harness-specific branding`)
    const absolutePath = join(REPOSITORY_ROOT, path)
    const metadata = await lstat(absolutePath)
    const bytes = metadata.isSymbolicLink()
      ? Buffer.from(await readlink(absolutePath))
      : await readFile(absolutePath)
    invariant(
      !containsSpecificReference(bytes.toString("latin1")),
      `${path} has model- or harness-specific branding`,
    )
  }
}

const EXPECTED_PACKAGE_FILES = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "dist",
  "discord-mcp.config.schema.json",
  "docs/environment-migration.md",
  "docs/reference.md",
  "docs/releasing.md",
  "server.json",
]

const EXPECTED_COMPATIBILITY_ENVIRONMENT_NAMES = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_MCP_ADMIN_GUILD_IDS",
  "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  "DISCORD_MCP_ALLOWED_GUILD_IDS",
  "DISCORD_MCP_ALLOW_ADMINISTRATION",
  "DISCORD_MCP_ALLOW_APPLICATION_EMOJI_AUDIT",
  "DISCORD_MCP_ALLOW_APPLICATION_EMOJI_CHANGES",
  "DISCORD_MCP_ALLOW_ANNOUNCEMENT_CROSSPOSTS",
  "DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT",
  "DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_CHANGES",
  "DISCORD_MCP_ALLOW_ATTACHMENTS",
  "DISCORD_MCP_ALLOW_AUTOMOD_AUDIT",
  "DISCORD_MCP_ALLOW_AUTOMOD_CHANGES",
  "DISCORD_MCP_ALLOW_BAN_AUDIT",
  "DISCORD_MCP_ALLOW_CHANNEL_CLONE_AUDIT",
  "DISCORD_MCP_ALLOW_CHANNEL_CLONING",
  "DISCORD_MCP_ALLOW_CHANNEL_CREATION",
  "DISCORD_MCP_ALLOW_CHANNEL_DELETION_AUDIT",
  "DISCORD_MCP_ALLOW_CHANNEL_DELETIONS",
  "DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES",
  "DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT",
  "DISCORD_MCP_ALLOW_CHANNEL_ORDERING_CHANGES",
  "DISCORD_MCP_ALLOW_CROSS_GUILD_MESSAGE_FORWARDING",
  "DISCORD_MCP_ALLOW_DELETIONS",
  "DISCORD_MCP_ALLOW_FORUM_POSTS",
  "DISCORD_MCP_ALLOW_FORUM_TAG_AUDIT",
  "DISCORD_MCP_ALLOW_FORUM_TAG_CHANGES",
  "DISCORD_MCP_ALLOW_GATEWAY",
  "DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT",
  "DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES",
  "DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT",
  "DISCORD_MCP_ALLOW_GUILD_PROFILE_CHANGES",
  "DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS",
  "DISCORD_MCP_ALLOW_GUILD_SETTINGS_AUDIT",
  "DISCORD_MCP_ALLOW_GUILD_SETTINGS_CHANGES",
  "DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT",
  "DISCORD_MCP_ALLOW_GUILD_TEMPLATE_CHANGES",
  "DISCORD_MCP_ALLOW_INTEGRATION_AUDIT",
  "DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS",
  "DISCORD_MCP_ALLOW_INTERACTIONS",
  "DISCORD_MCP_ALLOW_INVITE_AUDIT",
  "DISCORD_MCP_ALLOW_INVITE_DELETIONS",
  "DISCORD_MCP_ALLOW_MEMBER_DIRECTORY",
  "DISCORD_MCP_ALLOW_NICKNAME_CHANGES",
  "DISCORD_MCP_ALLOW_OTHER_MEMBER_NICKNAME_CHANGES",
  "DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES",
  "DISCORD_MCP_ALLOW_MEMBER_VOICE_AUDIT",
  "DISCORD_MCP_ALLOW_MEMBER_VOICE_CHANGES",
  "DISCORD_MCP_ALLOW_MESSAGE_FORWARDING",
  "DISCORD_MCP_ALLOW_NATIVE_COMMAND_CHANGES",
  "DISCORD_MCP_ALLOW_NATIVE_INTERACTIONS",
  "DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT",
  "DISCORD_MCP_ALLOW_ONBOARDING_AUDIT",
  "DISCORD_MCP_ALLOW_ONBOARDING_CHANGES",
  "DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES",
  "DISCORD_MCP_ALLOW_PIN_MANAGEMENT",
  "DISCORD_MCP_ALLOW_POLL_AUDIT",
  "DISCORD_MCP_ALLOW_POLL_CREATION",
  "DISCORD_MCP_ALLOW_POLL_ENDING",
  "DISCORD_MCP_ALLOW_POLL_VOTER_AUDIT",
  "DISCORD_MCP_ALLOW_REACTION_MODERATION",
  "DISCORD_MCP_ALLOW_REACTION_USER_AUDIT",
  "DISCORD_MCP_ALLOW_ROLE_CONFIGURATION",
  "DISCORD_MCP_ALLOW_ROLE_CREATION",
  "DISCORD_MCP_ALLOW_ROLE_DELETION_AUDIT",
  "DISCORD_MCP_ALLOW_ROLE_DELETIONS",
  "DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT",
  "DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES",
  "DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT",
  "DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES",
  "DISCORD_MCP_ALLOW_SCHEDULED_EVENT_USER_AUDIT",
  "DISCORD_MCP_ALLOW_SOUNDBOARD_AUDIT",
  "DISCORD_MCP_ALLOW_SOUNDBOARD_CHANGES",
  "DISCORD_MCP_ALLOW_STAGE_INSTANCE_AUDIT",
  "DISCORD_MCP_ALLOW_STAGE_INSTANCE_CHANGES",
  "DISCORD_MCP_ALLOW_STAGE_START_NOTIFICATIONS",
  "DISCORD_MCP_ALLOW_THREAD_AUDIT",
  "DISCORD_MCP_ALLOW_THREAD_CHANGES",
  "DISCORD_MCP_ALLOW_THREAD_CREATION",
  "DISCORD_MCP_ALLOW_WEBHOOK_AUDIT",
  "DISCORD_MCP_ALLOW_WEBHOOK_CHANGES",
  "DISCORD_MCP_ALLOW_WEBHOOK_CREATION",
  "DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS",
  "DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT",
  "DISCORD_MCP_ALLOW_WELCOME_SCREEN_CHANGES",
  "DISCORD_MCP_ALLOW_WIDGET_PUBLIC_EXPOSURE",
  "DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT",
  "DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES",
  "DISCORD_MCP_ANNOUNCEMENT_CROSSPOST_CHANNEL_IDS",
  "DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_SOURCE_CHANNEL_IDS",
  "DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_TARGET_CHANNEL_IDS",
  "DISCORD_MCP_APPLICATION_EMOJI_ROOTS",
  "DISCORD_MCP_APPLICATION_ID",
  "DISCORD_MCP_ATTACHMENT_CHANNEL_IDS",
  "DISCORD_MCP_ATTACHMENT_MAX_BYTES",
  "DISCORD_MCP_ATTACHMENT_ROOTS",
  "DISCORD_MCP_AUDIT_FILE",
  "DISCORD_MCP_AUTOMOD_ALERT_CHANNEL_IDS",
  "DISCORD_MCP_AUTOMOD_GUILD_IDS",
  "DISCORD_MCP_BAN_AUDIT_GUILD_IDS",
  "DISCORD_MCP_BOT_ID",
  "DISCORD_MCP_CHANNEL_CLONE_GUILD_IDS",
  "DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS",
  "DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS",
  "DISCORD_MCP_CHANNEL_DELETION_IDS",
  "DISCORD_MCP_CHANNEL_METADATA_IDS",
  "DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS",
  "DISCORD_MCP_CONFIG_FILE",
  "DISCORD_MCP_DELETE_CHANNEL_IDS",
  "DISCORD_MCP_FORUM_POST_CHANNEL_IDS",
  "DISCORD_MCP_FORUM_TAG_CHANNEL_IDS",
  "DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE",
  "DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS",
  "DISCORD_MCP_GUILD_EXPRESSION_ROOTS",
  "DISCORD_MCP_GUILD_PROFILE_GUILD_IDS",
  "DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS",
  "DISCORD_MCP_GUILD_SETTINGS_GUILD_IDS",
  "DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS",
  "DISCORD_MCP_INTEGRATION_GUILD_IDS",
  "DISCORD_MCP_INTEGRATION_IDS",
  "DISCORD_MCP_INTERACTION_CHANNEL_IDS",
  "DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE",
  "DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS",
  "DISCORD_MCP_INVITE_GUILD_IDS",
  "DISCORD_MCP_MENTION_USER_IDS",
  "DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS",
  "DISCORD_MCP_NICKNAME_GUILD_IDS",
  "DISCORD_MCP_MEMBER_ROLE_GUILD_IDS",
  "DISCORD_MCP_MEMBER_ROLE_IDS",
  "DISCORD_MCP_MEMBER_VOICE_CHANNEL_IDS",
  "DISCORD_MCP_MEMBER_VOICE_GUILD_IDS",
  "DISCORD_MCP_MESSAGE_FORWARD_SOURCE_CHANNEL_IDS",
  "DISCORD_MCP_MESSAGE_FORWARD_TARGET_CHANNEL_IDS",
  "DISCORD_MCP_NATIVE_COMMAND_NAME",
  "DISCORD_MCP_NATIVE_INTERACTION_CHANNEL_IDS",
  "DISCORD_MCP_NATIVE_INTERACTION_GUILD_IDS",
  "DISCORD_MCP_NATIVE_INTERACTION_MAX_PENDING",
  "DISCORD_MCP_NATIVE_INTERACTION_TTL_SECONDS",
  "DISCORD_MCP_NATIVE_INTERACTION_USER_IDS",
  "DISCORD_MCP_OBSERVABILITY_LOGS",
  "DISCORD_MCP_ONBOARDING_GUILD_IDS",
  "DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS",
  "DISCORD_MCP_PIN_CHANNEL_IDS",
  "DISCORD_MCP_POLL_CHANNEL_IDS",
  "DISCORD_MCP_PROTECTED_USER_IDS",
  "DISCORD_MCP_REACTION_CHANNEL_IDS",
  "DISCORD_MCP_ROLE_CONFIGURATION_IDS",
  "DISCORD_MCP_ROLE_CREATION_GUILD_IDS",
  "DISCORD_MCP_ROLE_DELETION_IDS",
  "DISCORD_MCP_ROLE_ORDERING_GUILD_IDS",
  "DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS",
  "DISCORD_MCP_SCHEDULED_EVENT_ROOTS",
  "DISCORD_MCP_SOUNDBOARD_GUILD_IDS",
  "DISCORD_MCP_SOUNDBOARD_ROOTS",
  "DISCORD_MCP_STAGE_CHANNEL_IDS",
  "DISCORD_MCP_THREAD_GUILD_IDS",
  "DISCORD_MCP_THREAD_IDS",
  "DISCORD_MCP_THREAD_MEMBER_USER_IDS",
  "DISCORD_MCP_TOOLSETS",
  "DISCORD_MCP_TOOL_SURFACE",
  "DISCORD_MCP_THREAD_PARENT_IDS",
  "DISCORD_MCP_WEBHOOK_CHANNEL_IDS",
  "DISCORD_MCP_WELCOME_SCREEN_GUILD_IDS",
  "DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS",
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

const OCI_CONFIG_FILE = "/configuration/discord-mcp.json"
const REGISTRY_TOKEN_INPUT = Object.freeze({
  description: "Discord bot token sent only to fixed Discord REST and vetted Gateway origins",
  format: "string",
  isRequired: true,
  isSecret: true,
  name: "DISCORD_BOT_TOKEN",
})
const REGISTRY_CONFIG_ARGUMENT = Object.freeze({
  description: "Absolute path to one strict versioned non-secret configuration document",
  format: "filepath",
  isRequired: true,
  placeholder: "/absolute/path/to/discord-mcp.json",
  type: "positional",
  valueHint: "config_file",
})
const NPM_PACKAGE_ARGUMENTS = Object.freeze([
  { type: "positional", value: "serve" },
  { type: "positional", value: "--config" },
  REGISTRY_CONFIG_ARGUMENT,
])
const OCI_PACKAGE_ARGUMENTS = Object.freeze([
  { type: "positional", value: "serve" },
  { type: "positional", value: "--config" },
  { type: "positional", value: OCI_CONFIG_FILE },
])
const OCI_RUNTIME_ARGUMENTS = Object.freeze([
  { type: "positional", value: "--read-only" },
  { type: "positional", value: "--cap-drop=ALL" },
  { type: "positional", value: "--security-opt=no-new-privileges:true" },
  { type: "positional", value: "--pids-limit=64" },
  {
    description: "Read-only bind mount for the non-secret connector configuration",
    isRequired: true,
    name: "--mount",
    type: "named",
    value: `type=bind,source={config_file},target=${OCI_CONFIG_FILE},readonly`,
    variables: {
      config_file: {
        description: "Absolute host path to the connector configuration",
        format: "filepath",
        isRequired: true,
        placeholder: "/absolute/path/to/discord-mcp.json",
      },
    },
  },
])

const EXPECTED_ACTION_PINS = new Map([
  ["actions/attest", "1e69f48acb82d1966a394da916b4c1698aa569d6"],
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
  ["docker/build-push-action", "10e90e3645eae34f1e60eeb005ba3a3d33f178e8"],
  ["docker/login-action", "c94ce9fb468520275223c153574b00df6fe4bcc9"],
  ["docker/setup-buildx-action", "8d2750c68a42422c14e847fe6c8ac0403b4cbd6f"],
  ["docker/setup-qemu-action", "c7c53464625b32c7a7e944ae62b3e17d2b600130"],
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
    "ai-agent",
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
    "container:index:verify": "node scripts/verify-oci-layout.mjs",
    "container:verify": "npm run build && node scripts/verify-container.mjs",
    "config:schema": "node --import tsx scripts/generate-config-schema.mjs",
    "config:schema:check": "node --import tsx scripts/generate-config-schema.mjs --check",
    "deps:locked": "npm ci --ignore-scripts && npm rebuild esbuild@0.28.2 --ignore-scripts=false",
    mcp: "node dist/cli.js serve",
    "metadata:check": "node scripts/check-release-metadata.mjs",
    "pack:verify": "node scripts/pack-and-verify.mjs",
    prepack: "npm run config:schema:check && npm run metadata:check && npm run build",
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
  assertEqual(environmentNames, EXPECTED_COMPATIBILITY_ENVIRONMENT_NAMES, "source compatibility environment catalog changed without review")
}

async function checkDocumentation(packageJson) {
  const readme = await readFile(join(REPOSITORY_ROOT, "README.md"), "utf8")
  const migration = await readFile(
    join(REPOSITORY_ROOT, "docs/environment-migration.md"),
    "utf8",
  )
  const reference = await readFile(
    join(REPOSITORY_ROOT, "docs/reference.md"),
    "utf8",
  )
  const documentation = `${readme}\n${reference}`
  const documentedVersions = [...documentation.matchAll(/@j-256\/discord-mcp@([0-9]+\.[0-9]+\.[0-9]+)/g)]
    .map((match) => match[1])
  invariant(documentedVersions.length > 0, "README does not show a pinned npm installation")
  invariant(documentedVersions.every((version) => version === packageJson.version), "documentation npm versions are out of sync")
  invariant(readme.includes(`https://raw.githubusercontent.com/j-256/discord-mcp/v${packageJson.version}/assets/discord-mcp-icon.png`), "README icon URL is out of sync")
  invariant(Buffer.byteLength(readme) <= README_MAX_BYTES, "README must remain a concise landing page")
  invariant((readme.match(/^# /gm) || []).length === 1, "README must contain one top-level heading")
  let previousHeading = -1
  for (const heading of README_REQUIRED_HEADINGS) {
    const position = readme.indexOf(heading)
    invariant(position > previousHeading, `README is missing or misorders ${heading}`)
    previousHeading = position
  }
  for (const required of [
    "[Complete reference](docs/reference.md)",
    "--preset server-observer",
    "preset install server-observer",
    "--config ./discord-mcp.json",
    "catalog --check --json",
    "config validate ./discord-mcp.json",
    "doctor --config ./discord-mcp.json --online",
    "smoke --config ./discord-mcp.json",
  ]) {
    invariant(readme.includes(required), `README is missing ${required}`)
  }
  invariant(reference.includes("preset install server-observer"), "complete reference lacks preset-derived bot installation")
  invariant(reference.startsWith("# Discord MCP complete reference\n"), "complete reference heading is invalid")
  invariant(reference.includes("[Project overview and quick start](../README.md)"), "complete reference lacks the landing-page link")
  invariant(reference.includes("[release runbook](releasing.md)"), "complete reference release link is invalid")
  invariant(reference.includes("[environment-policy migration guide](environment-migration.md)"), "complete reference migration link is invalid")
  invariant(migration.startsWith("# Migrate environment policy to a configuration file\n"), "environment migration heading is invalid")
  const documentedCompatibilityEnvironmentNames = [
    ...migration.matchAll(/^\| `([A-Z0-9_]+)`(?:, `([A-Z0-9_]+)`)?(?:, `([A-Z0-9_]+)`)? \|/gm),
  ].flatMap((match) => match.slice(1).filter(Boolean)).sort()
  assertEqual(
    documentedCompatibilityEnvironmentNames,
    EXPECTED_COMPATIBILITY_ENVIRONMENT_NAMES,
    "environment migration catalog is incomplete",
  )
  invariant(reference.length > readme.length, "complete reference must retain the detailed contract")
  for (const heading of REFERENCE_REQUIRED_HEADINGS) {
    invariant(reference.includes(heading), `complete reference is missing ${heading}`)
  }
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

  invariant(server.packages?.length === 2, "registry manifest must declare npm and OCI packages")
  assertEqual(server.packages.map(({ registryType }) => registryType), ["npm", "oci"], "registry package order is invalid")
  const npmPackage = server.packages[0]
  invariant(npmPackage.registryType === "npm", "npm registry package type is invalid")
  invariant(npmPackage.registryBaseUrl === NPM_REGISTRY, "npm registry package origin is invalid")
  invariant(npmPackage.identifier === packageJson.name, "npm registry package name is out of sync")
  invariant(npmPackage.version === packageJson.version, "npm registry package version is out of sync")
  invariant(npmPackage.runtimeHint === "npx", "npm registry runtime hint is invalid")
  assertEqual(npmPackage.transport, { type: "stdio" }, "npm registry transport must remain stdio")
  assertEqual(npmPackage.packageArguments, NPM_PACKAGE_ARGUMENTS, "npm package arguments are invalid")
  invariant(npmPackage.runtimeArguments === undefined, "npm package must not declare runtime arguments")
  const ociPackage = server.packages[1]
  invariant(ociPackage.registryType === "oci", "OCI registry package type is invalid")
  invariant(ociPackage.identifier === `${OCI_IMAGE_NAME}:${packageJson.version}`, "OCI image reference is out of sync")
  invariant(ociPackage.runtimeHint === "docker", "OCI registry runtime hint is invalid")
  assertEqual(ociPackage.transport, { type: "stdio" }, "OCI registry transport must remain stdio")
  assertEqual(ociPackage.packageArguments, OCI_PACKAGE_ARGUMENTS, "OCI package arguments are invalid")
  assertEqual(ociPackage.runtimeArguments, OCI_RUNTIME_ARGUMENTS, "OCI runtime arguments are invalid")
  for (const forbidden of ["fileSha256", "registryBaseUrl", "version"]) {
    invariant(ociPackage[forbidden] === undefined, `OCI registry package must omit ${forbidden}`)
  }
  assertEqual(npmPackage.environmentVariables, [REGISTRY_TOKEN_INPUT], "npm registry inputs are invalid")
  assertEqual(ociPackage.environmentVariables, [REGISTRY_TOKEN_INPUT], "OCI registry inputs are invalid")
}

async function checkContainerSource(packageJson) {
  const dockerfile = await readFile(join(REPOSITORY_ROOT, "Dockerfile"), "utf8")
  const dockerignore = await readFile(join(REPOSITORY_ROOT, ".dockerignore"), "utf8")
  invariant(
    dockerfile.startsWith(`ARG NODE_IMAGE=${NODE_IMAGE}\n`),
    "Dockerfile base image is not pinned to the reviewed digest",
  )
  invariant((dockerfile.match(/FROM \$\{NODE_IMAGE\}/g) || []).length === 2, "every container stage must use the pinned base")
  for (const required of [
    "npm ci --ignore-scripts",
    "npm prune --omit=dev --ignore-scripts",
    `ARG VERSION=${packageJson.version}`,
    "ARG REVISION=local",
    "org.opencontainers.image.licenses=\"AGPL-3.0-only\"",
    "io.modelcontextprotocol.server.name=\"io.github.j-256/discord-mcp\"",
    "ENV NODE_ENV=production",
    "COPY --from=build --chown=node:node /app/dist ./dist",
    "COPY --from=build --chown=node:node /app/node_modules ./node_modules",
    "USER node",
    "ENTRYPOINT [\"node\", \"dist/cli.js\"]",
    "CMD [\"catalog\"]",
  ]) {
    invariant(dockerfile.includes(required), `Dockerfile is missing ${required}`)
  }
  invariant(!/(?:DISCORD|OTEL)_[A-Z0-9_]+\s*=/.test(dockerfile), "Dockerfile must not declare connector configuration")
  assertEqual(
    dockerignore.split("\n").filter(Boolean),
    [
      "**",
      "!.dockerignore",
      "!.npmrc",
      "!Dockerfile",
      "!LICENSE",
      "!package-lock.json",
      "!package.json",
      "!src",
      "!src/**",
      "!tsconfig.build.json",
      "!tsconfig.json",
    ],
    "container build context allowlist changed",
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
    "image",
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
    "Attest catalog evidence",
    "Attest exact OCI image provenance",
    "subject-name: ${{ steps.release.outputs.image_name }}",
    "catalog-evidence.json",
    "container-evidence.json",
    "ghcr.io/j-256/discord-mcp:$version",
    "linux/amd64,linux/arm64",
    "index:org.opencontainers.image.description=Least-privilege Discord reads, privacy-safe audits, and reviewed administration",
    "npm run container:verify",
    "npm run container:index:verify",
    "--expect-oci matching",
    "provenance: mode=max",
    `sbom: generator=${SBOM_GENERATOR_IMAGE}`,
    "--bundle-from-oci",
    "v1.8.1",
    "a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc",
  ]) {
    invariant(release.includes(required), `release workflow is missing ${required}`)
  }
  const ci = await readFile(join(workflowsDirectory, "ci.yml"), "utf8")
  for (const pinnedImage of [BINFMT_IMAGE, BUILDKIT_IMAGE]) {
    invariant(release.includes(pinnedImage), `release workflow does not pin ${pinnedImage}`)
    invariant(ci.includes(pinnedImage), `CI workflow does not pin ${pinnedImage}`)
  }
  const ociLayoutVerifier = await readFile(join(REPOSITORY_ROOT, "scripts/verify-oci-layout.mjs"), "utf8")
  const ociRegistry = await readFile(join(REPOSITORY_ROOT, "scripts/oci-registry.mjs"), "utf8")
  invariant(release.includes(SBOM_GENERATOR_IMAGE), "release workflow does not pin its SBOM generator")
  invariant(ociRegistry.includes(SBOM_GENERATOR_IMAGE), "OCI utilities do not pin their SBOM generator")
  invariant(ociLayoutVerifier.includes("SBOM_GENERATOR_IMAGE"), "OCI preflight does not use the pinned SBOM generator")
  for (const workflowName of ["ci.yml", "release.yml"]) {
    const workflow = await readFile(join(workflowsDirectory, workflowName), "utf8")
    invariant(workflow.includes("NPM_CONFIG_REGISTRY: https://registry.npmjs.org"), `${workflowName} must pin the npm registry`)
    invariant(workflow.includes("NPM_CONFIG_REPLACE_REGISTRY_HOST: never"), `${workflowName} must preserve lockfile registry origins`)
  }
  invariant((release.match(/uses: actions\/attest@/g) || []).length === 4, "release workflow must attest package, catalog, and image evidence")
  invariant((release.match(/artifact-metadata: write/g) || []).length === 1, "only file attestations may write artifact metadata")
  invariant(release.includes("create-storage-record: false"), "personal image attestation must disable unsupported storage records")
  invariant((release.match(/packages: write/g) || []).length === 1, "only the image release job may write packages")
  invariant((release.match(/packages: read/g) || []).length === 1, "the non-image release job must use read-only package access")
  invariant(!release.includes("secrets.NPM_TOKEN"), "release workflow must not use a standing npm token")
  invariant(
    (ci.match(/catalog-evidence\.json/g) || []).length >= 2,
    "CI must retain and compare catalog evidence across runtimes",
  )
  invariant(ci.includes("name: Hardened OCI image"), "CI must verify the hardened OCI image")
  invariant(ci.includes("cmp \"$evidence_reference\" container/catalog-evidence.json"), "CI must compare package and container contracts")
  const codeowners = await readFile(join(REPOSITORY_ROOT, ".github/CODEOWNERS"), "utf8")
  for (const path of [
    "/.github/",
    "/.dockerignore",
    "/.npmrc",
    "/assets/",
    "/docs/",
    "/Dockerfile",
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
await checkNeutrality()
await checkSourceIdentity(packageJson)
await checkDocumentation(packageJson)
await checkRegistryManifest(packageJson)
await checkContainerSource(packageJson)
await checkAutomation()
process.stdout.write(`Release metadata verified for ${packageJson.name}@${packageJson.version}\n`)
