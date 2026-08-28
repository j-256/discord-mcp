import { lstat, readFile, readdir, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  canonicalJson,
  invariant,
  readJson,
  REPOSITORY_ROOT,
  sha256,
  sha512Integrity,
} from "./release-lib.mjs"

const GITHUB_API_ORIGIN = "https://api.github.com"
const GITHUB_API_VERSION = "2026-03-10"
const GITHUB_REPOSITORY = "j-256/discord-mcp"
const MCP_REGISTRY_NAME = "io.github.j-256/discord-mcp"
const NPM_PACKAGE = "@j-256/discord-mcp"
const RELEASE_EVIDENCE_FORMAT = "discord-mcp.github-release-evidence.v1"
const RELEASE_EVIDENCE_SCHEMA_VERSION = 1
const RELEASE_NOTES_FILE = "release-notes.md"
const RELEASE_CHECKSUM_FILE = "SHA256SUMS"
const CATALOG_EVIDENCE_FILE = "catalog-evidence.json"
const SPDX_SBOM_FILE = "sbom.spdx.json"
const RELEASE_ASSET_BYTE_LIMIT = 20 * 1024 * 1024
const GITHUB_RESPONSE_BYTE_LIMIT = 16 * 1024 * 1024
const RELEASE_PAGE_SIZE = 100
const RELEASE_PAGE_LIMIT = 1000

function assertVersion(version) {
  invariant(/^\d+\.\d+\.\d+$/.test(version), `Invalid stable version ${version}`)
}

function assertRevision(revision) {
  invariant(/^[0-9a-f]{40}$/.test(revision), "GitHub Release revision must be a full lowercase commit SHA")
}

function assertOciDigest(digest) {
  invariant(/^sha256:[0-9a-f]{64}$/.test(digest), "GitHub Release OCI digest is invalid")
}

function normalizeProse(value) {
  return value.replaceAll("\r\n", "\n").trimEnd()
}

function compareAssetNames(left, right) {
  if (left.name === right.name) return 0
  return left.name < right.name ? -1 : 1
}

function releaseTag(version) {
  assertVersion(version)
  return `v${version}`
}

function releaseTitle(version) {
  assertVersion(version)
  return `Discord MCP ${version}`
}

function npmArchiveName(version) {
  assertVersion(version)
  return `j-256-discord-mcp-${version}.tgz`
}

function registryVersionUrl(version) {
  assertVersion(version)
  return `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(MCP_REGISTRY_NAME)}/versions/${version}`
}

export function renderGitHubReleaseNotes({ npmIntegrity, ociDigest, revision, version }) {
  assertVersion(version)
  assertRevision(revision)
  assertOciDigest(ociDigest)
  invariant(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(npmIntegrity), "GitHub Release npm integrity is invalid")
  const tag = releaseTag(version)
  return [
    `Discord MCP ${version} is published from the protected [${tag}](https://github.com/${GITHUB_REPOSITORY}/tree/${tag}) source tag at commit \`${revision}\`.`,
    "",
    "## Install",
    "",
    "```sh",
    `npx --yes ${NPM_PACKAGE}@${version} catalog --check`,
    `docker run --rm -i --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges:true --pids-limit=64 ghcr.io/${GITHUB_REPOSITORY}:${version} catalog --check`,
    "```",
    "",
    "Each operational deployment requires an operator-owned Discord application and bot, one strict non-secret configuration file, and the bot token supplied through the launching secret store.",
    "",
    "## Published identities",
    "",
    `- npm: [${NPM_PACKAGE}@${version}](https://www.npmjs.com/package/${NPM_PACKAGE}/v/${version}) with integrity \`${npmIntegrity}\``,
    `- OCI: \`ghcr.io/${GITHUB_REPOSITORY}@${ociDigest}\``,
    `- MCP Registry: [${MCP_REGISTRY_NAME}@${version}](${registryVersionUrl(version)})`,
    "",
    "## Included evidence",
    "",
    `- \`${npmArchiveName(version)}\`: the exact npm archive reconstructed and attested by the protected release workflow`,
    `- \`${CATALOG_EVIDENCE_FILE}\`: the deterministic credential-free MCP contract fingerprint`,
    `- \`${SPDX_SBOM_FILE}\`: the validated SPDX production-dependency inventory`,
    `- \`${RELEASE_NOTES_FILE}\`: the canonical notes retained as an immutable asset because GitHub permits displayed Release notes to be edited`,
    `- \`${RELEASE_CHECKSUM_FILE}\`: SHA-256 digests for the listed evidence assets above`,
    "",
    "The immutable GitHub Release attestation binds the source tag, commit, and attached assets. npm provenance separately binds the package to the protected workflow, while the OCI index carries per-platform BuildKit provenance and SPDX evidence plus a signed root-digest claim.",
    "",
    "## Verify",
    "",
    "```sh",
    `gh release verify ${tag} --repo ${GITHUB_REPOSITORY}`,
    `gh release download ${tag} --repo ${GITHUB_REPOSITORY}`,
    `gh release verify-asset ${tag} ${npmArchiveName(version)} --repo ${GITHUB_REPOSITORY}`,
    `gh release verify-asset ${tag} ${RELEASE_NOTES_FILE} --repo ${GITHUB_REPOSITORY}`,
    `gh attestation verify ${npmArchiveName(version)} --repo ${GITHUB_REPOSITORY} --signer-workflow ${GITHUB_REPOSITORY}/.github/workflows/release.yml --source-ref refs/tags/${tag} --deny-self-hosted-runners`,
    `gh attestation verify oci://ghcr.io/${GITHUB_REPOSITORY}@${ociDigest} --repo ${GITHUB_REPOSITORY} --signer-workflow ${GITHUB_REPOSITORY}/.github/workflows/release.yml --source-ref refs/tags/${tag} --deny-self-hosted-runners`,
    "shasum -a 256 -c SHA256SUMS",
    "```",
    "",
    "Attestations establish artifact identity, origin, and integrity. They do not guarantee that software is vulnerability-free, and the SBOM remains bounded by the scanner and package metadata that produced it.",
    "",
  ].join("\n")
}

export function renderSha256Sums(assets) {
  invariant(Array.isArray(assets) && assets.length > 0, "GitHub Release checksum assets are missing")
  const names = new Set()
  const normalized = assets.map((asset) => {
    invariant(asset && typeof asset === "object", "GitHub Release checksum asset is invalid")
    invariant(typeof asset.name === "string" && basename(asset.name) === asset.name, "GitHub Release checksum asset name is invalid")
    invariant(!names.has(asset.name), `Duplicate GitHub Release checksum asset ${asset.name}`)
    names.add(asset.name)
    invariant(/^sha256:[0-9a-f]{64}$/.test(asset.digest), `GitHub Release checksum digest for ${asset.name} is invalid`)
    return { digest: asset.digest.slice("sha256:".length), name: asset.name }
  }).sort(compareAssetNames)
  return `${normalized.map(({ digest, name }) => `${digest}  ${name}`).join("\n")}\n`
}

async function assertRegularBoundedFile(path, label) {
  const metadata = await lstat(path)
  invariant(metadata.isFile() && !metadata.isSymbolicLink(), `${label} must be one regular file`)
  invariant(metadata.size > 0 && metadata.size <= RELEASE_ASSET_BYTE_LIMIT, `${label} has an invalid size`)
  return metadata.size
}

async function releaseAsset(path) {
  const size = await assertRegularBoundedFile(path, `GitHub Release asset ${basename(path)}`)
  return {
    digest: `sha256:${sha256(await readFile(path))}`,
    name: basename(path),
    size,
  }
}

function expectedAssetNames(version) {
  return [
    RELEASE_CHECKSUM_FILE,
    CATALOG_EVIDENCE_FILE,
    npmArchiveName(version),
    RELEASE_NOTES_FILE,
    SPDX_SBOM_FILE,
  ].sort()
}

export async function prepareGitHubReleaseEvidence({ directory, ociDigest, output, revision, version }) {
  assertVersion(version)
  assertRevision(revision)
  assertOciDigest(ociDigest)
  const root = resolve(directory)
  const archiveName = npmArchiveName(version)
  const inputNames = (await readdir(root)).sort()
  invariant(
    canonicalJson(inputNames) === canonicalJson([CATALOG_EVIDENCE_FILE, archiveName, SPDX_SBOM_FILE].sort()),
    "GitHub Release input directory must contain only the verified archive, catalog evidence, and SPDX SBOM",
  )

  const archivePath = join(root, archiveName)
  const catalogPath = join(root, CATALOG_EVIDENCE_FILE)
  const sbomPath = join(root, SPDX_SBOM_FILE)
  const archive = await releaseAsset(archivePath)
  const catalog = await releaseAsset(catalogPath)
  const sbom = await releaseAsset(sbomPath)
  const npmIntegrity = sha512Integrity(await readFile(archivePath))

  const catalogDocument = await readJson(catalogPath)
  invariant(catalogDocument.evidenceFormat === "discord-mcp.catalog-evidence.v2", "GitHub Release catalog evidence format is invalid")
  invariant(catalogDocument.schemaVersion === 1, "GitHub Release catalog evidence schema is invalid")
  invariant(catalogDocument.serverVersion === version, "GitHub Release catalog evidence version is invalid")
  invariant(catalogDocument.status === "ok", "GitHub Release catalog evidence status is invalid")
  invariant(catalogDocument.credentialsRequired === false, "GitHub Release catalog evidence requires credentials")
  invariant(catalogDocument.discordExecution === "disabled", "GitHub Release catalog evidence contacted Discord")
  invariant(catalogDocument.gateway === "disabled", "GitHub Release catalog evidence enabled Gateway access")
  invariant(catalogDocument.observabilityExport === "disabled", "GitHub Release catalog evidence exported telemetry")
  invariant(catalogDocument.activityRecordsCreated === false, "GitHub Release catalog evidence persisted activity")

  const sbomDocument = await readJson(sbomPath)
  invariant(sbomDocument.spdxVersion === "SPDX-2.3", "GitHub Release SBOM version is invalid")
  invariant(sbomDocument.name === `${NPM_PACKAGE}@${version}`, "GitHub Release SBOM identity is invalid")
  invariant(Array.isArray(sbomDocument.packages) && sbomDocument.packages.length > 0, "GitHub Release SBOM packages are missing")
  invariant(
    sbomDocument.packages.some((entry) => entry?.name === NPM_PACKAGE && entry?.versionInfo === version),
    "GitHub Release SBOM root package is missing",
  )

  const notes = renderGitHubReleaseNotes({ npmIntegrity, ociDigest, revision, version })
  const notesPath = join(root, RELEASE_NOTES_FILE)
  await writeFile(notesPath, notes, { flag: "wx" })
  const notesAsset = await releaseAsset(notesPath)

  const checksums = renderSha256Sums([archive, catalog, notesAsset, sbom])
  const checksumPath = join(root, RELEASE_CHECKSUM_FILE)
  await writeFile(checksumPath, checksums, { flag: "wx" })
  const checksum = await releaseAsset(checksumPath)
  const assets = [archive, catalog, notesAsset, sbom, checksum].sort(compareAssetNames)
  invariant(canonicalJson(assets.map(({ name }) => name)) === canonicalJson(expectedAssetNames(version)), "GitHub Release asset set is invalid")

  const evidence = {
    assets,
    format: RELEASE_EVIDENCE_FORMAT,
    notesDigest: `sha256:${sha256(notes)}`,
    npmIntegrity,
    ociDigest,
    revision,
    schemaVersion: RELEASE_EVIDENCE_SCHEMA_VERSION,
    tag: releaseTag(version),
    title: releaseTitle(version),
    version,
  }
  await writeFile(resolve(output), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" })
  return evidence
}

export function classifyGitHubRelease(releases, version) {
  assertVersion(version)
  invariant(Array.isArray(releases), "GitHub Releases response is invalid")
  const tag = releaseTag(version)
  const matches = releases.filter((release) => release?.tag_name === tag)
  invariant(matches.length <= 1, `GitHub returned duplicate Releases for ${tag}`)
  if (matches.length === 0) return { release: undefined, state: "absent" }
  const release = matches[0]
  invariant(typeof release.id === "number" && release.id > 0, "GitHub Release ID is invalid")
  invariant(release.prerelease === false, "GitHub Release must not be a prerelease")
  if (release.draft === true) {
    invariant(release.immutable !== true, "Draft GitHub Release cannot be immutable")
    return { release, state: "draft" }
  }
  invariant(release.draft === false, "GitHub Release draft state is invalid")
  return { release, state: release.immutable === true ? "immutable" : "mutable" }
}

function validateReleaseUrl(value, expectedPath, label) {
  invariant(typeof value === "string", `${label} URL is invalid`)
  const url = new URL(value)
  invariant(url.origin === "https://github.com" && !url.username && !url.password, `${label} origin is invalid`)
  invariant(url.pathname === expectedPath, `${label} path is invalid`)
  invariant(!url.search && !url.hash, `${label} URL contains unsupported components`)
}

function validateEvidence(evidence) {
  invariant(evidence?.format === RELEASE_EVIDENCE_FORMAT, "GitHub Release evidence format is invalid")
  invariant(evidence?.schemaVersion === RELEASE_EVIDENCE_SCHEMA_VERSION, "GitHub Release evidence schema is invalid")
  invariant(canonicalJson(Object.keys(evidence).sort()) === canonicalJson([
    "assets",
    "format",
    "notesDigest",
    "npmIntegrity",
    "ociDigest",
    "revision",
    "schemaVersion",
    "tag",
    "title",
    "version",
  ]), "GitHub Release evidence fields are invalid")
  assertVersion(evidence.version)
  assertRevision(evidence.revision)
  assertOciDigest(evidence.ociDigest)
  invariant(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(evidence.npmIntegrity), "GitHub Release evidence npm integrity is invalid")
  invariant(/^sha256:[0-9a-f]{64}$/.test(evidence.notesDigest), "GitHub Release evidence notes digest is invalid")
  invariant(evidence.tag === releaseTag(evidence.version), "GitHub Release evidence tag is invalid")
  invariant(evidence.title === releaseTitle(evidence.version), "GitHub Release evidence title is invalid")
  invariant(Array.isArray(evidence.assets), "GitHub Release evidence assets are invalid")
  const assets = evidence.assets.map((asset) => {
    invariant(asset && typeof asset === "object", "GitHub Release evidence asset is invalid")
    invariant(canonicalJson(Object.keys(asset).sort()) === canonicalJson(["digest", "name", "size"]), "GitHub Release evidence asset fields are invalid")
    invariant(typeof asset.name === "string" && basename(asset.name) === asset.name, "GitHub Release evidence asset name is invalid")
    invariant(typeof asset.size === "number" && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= RELEASE_ASSET_BYTE_LIMIT, `GitHub Release evidence asset ${asset.name} size is invalid`)
    invariant(/^sha256:[0-9a-f]{64}$/.test(asset.digest), `GitHub Release evidence asset ${asset.name} digest is invalid`)
    return { digest: asset.digest, name: asset.name, size: asset.size }
  }).sort(compareAssetNames)
  invariant(canonicalJson(assets.map(({ name }) => name)) === canonicalJson(expectedAssetNames(evidence.version)), "GitHub Release evidence asset set is invalid")
  invariant(
    assets.find(({ name }) => name === RELEASE_NOTES_FILE)?.digest === evidence.notesDigest,
    "GitHub Release canonical notes digest is invalid",
  )
  return assets
}

export function validateGitHubRelease({ evidence, expectedState, notes, release, tagRevision }) {
  invariant(expectedState === "draft" || expectedState === "immutable", "GitHub Release expected state is invalid")
  const expectedAssets = validateEvidence(evidence)
  invariant(typeof notes === "string", "GitHub Release notes are invalid")
  assertRevision(tagRevision)
  invariant(tagRevision === evidence.revision, "GitHub Release tag does not resolve to the expected commit")
  invariant(typeof release?.id === "number" && Number.isSafeInteger(release.id) && release.id > 0, "GitHub Release ID is invalid")
  invariant(release?.tag_name === evidence.tag, "GitHub Release tag is invalid")
  invariant(release?.name === evidence.title, "GitHub Release title is invalid")
  invariant(normalizeProse(release?.body || "") === normalizeProse(notes), "GitHub Release notes are invalid")
  invariant(release?.prerelease === false, "GitHub Release must not be a prerelease")
  if (expectedState === "draft") {
    invariant(release?.draft === true && release?.immutable !== true, "GitHub Release is not an editable draft")
  } else {
    invariant(release?.draft === false && release?.immutable === true, "GitHub Release is not immutable")
    invariant(typeof release.published_at === "string" && release.published_at.length > 0, "Immutable GitHub Release publication time is missing")
  }

  validateReleaseUrl(release.html_url, `/${GITHUB_REPOSITORY}/releases/tag/${evidence.tag}`, "GitHub Release")
  invariant(Array.isArray(release.assets), "GitHub Release assets are missing")
  const actualAssets = release.assets.map((asset) => {
    invariant(asset?.state === "uploaded", `GitHub Release asset ${asset?.name || "unknown"} is not uploaded`)
    invariant(typeof asset.name === "string" && basename(asset.name) === asset.name, "GitHub Release asset name is invalid")
    invariant(typeof asset.size === "number" && asset.size > 0, `GitHub Release asset ${asset.name} size is invalid`)
    invariant(/^sha256:[0-9a-f]{64}$/.test(asset.digest), `GitHub Release asset ${asset.name} digest is invalid`)
    validateReleaseUrl(
      asset.browser_download_url,
      `/${GITHUB_REPOSITORY}/releases/download/${evidence.tag}/${asset.name}`,
      `GitHub Release asset ${asset.name}`,
    )
    return { digest: asset.digest, name: asset.name, size: asset.size }
  }).sort(compareAssetNames)
  invariant(canonicalJson(actualAssets) === canonicalJson(expectedAssets), "GitHub Release assets do not match the verified evidence")
  invariant(`sha256:${sha256(notes)}` === evidence.notesDigest, "GitHub Release notes digest is invalid")
  return {
    assets: actualAssets,
    releaseId: release.id,
    state: expectedState,
    tag: evidence.tag,
    url: release.html_url,
  }
}

async function githubRequest(path, token) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "discord-mcp-release-verifier",
    "x-github-api-version": GITHUB_API_VERSION,
  }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(new URL(path, GITHUB_API_ORIGIN), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  })
  invariant(response.ok, `GitHub API returned HTTP ${response.status} for ${path}`)
  invariant((response.headers.get("content-type") || "").includes("application/json"), `GitHub API returned non-JSON for ${path}`)
  const declaredLength = response.headers.get("content-length")
  if (declaredLength !== null) {
    invariant(/^(?:0|[1-9][0-9]*)$/.test(declaredLength), `GitHub API returned an invalid content length for ${path}`)
    invariant(Number(declaredLength) <= GITHUB_RESPONSE_BYTE_LIMIT, `GitHub API response exceeds the limit for ${path}`)
  }
  invariant(response.body, `GitHub API returned no response body for ${path}`)
  const chunks = []
  let byteLength = 0
  for await (const chunk of response.body) {
    byteLength += chunk.byteLength
    invariant(byteLength <= GITHUB_RESPONSE_BYTE_LIMIT, `GitHub API response exceeds the limit for ${path}`)
    chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, byteLength)))
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${path}`)
  }
}

export async function findGitHubRelease(version, token) {
  for (let page = 1; page <= RELEASE_PAGE_LIMIT; page += 1) {
    const releases = await githubRequest(
      `/repos/${GITHUB_REPOSITORY}/releases?per_page=${RELEASE_PAGE_SIZE}&page=${page}`,
      token,
    )
    invariant(Array.isArray(releases) && releases.length <= RELEASE_PAGE_SIZE, "GitHub Releases page is invalid")
    const matches = releases.filter((release) => release?.tag_name === releaseTag(version))
    if (matches.length > 0) return classifyGitHubRelease(matches, version)
    if (releases.length < RELEASE_PAGE_SIZE) return classifyGitHubRelease([], version)
  }
  throw new Error("GitHub Releases pagination exceeded its safety limit")
}

export async function fetchGitHubReleaseContext(version) {
  const token = process.env.GITHUB_TOKEN
  invariant(token, "GitHub Release inspection requires GITHUB_TOKEN")
  const tag = releaseTag(version)
  const [commit, classified] = await Promise.all([
    githubRequest(`/repos/${GITHUB_REPOSITORY}/commits/${encodeURIComponent(tag)}`, token),
    findGitHubRelease(version, token),
  ])
  assertRevision(commit?.sha)
  return { ...classified, tagRevision: commit.sha }
}

function parseOptions(args) {
  const options = { json: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--json") {
      options.json = true
      continue
    }
    const value = args[index + 1]
    invariant(value, `Option ${argument} requires a value`)
    index += 1
    if (argument === "--directory") options.directory = value
    else if (argument === "--evidence") options.evidence = value
    else if (argument === "--expect") options.expect = value
    else if (argument === "--oci-digest") options.ociDigest = value
    else if (argument === "--output") options.output = value
    else if (argument === "--revision") options.revision = value
    else throw new Error(`Unknown option ${argument}`)
  }
  return options
}

async function main(args) {
  const [command, ...rest] = args
  invariant(command, "GitHub Release command is required")
  const options = parseOptions(rest)
  const packageJson = await readJson(join(REPOSITORY_ROOT, "package.json"))
  const version = packageJson.version
  assertVersion(version)

  if (command === "prepare") {
    invariant(options.directory, "prepare requires --directory")
    invariant(options.ociDigest, "prepare requires --oci-digest")
    invariant(options.output, "prepare requires --output")
    invariant(options.revision, "prepare requires --revision")
    const evidence = await prepareGitHubReleaseEvidence({
      directory: options.directory,
      ociDigest: options.ociDigest,
      output: options.output,
      revision: options.revision,
      version,
    })
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
    return
  }

  if (command === "inspect") {
    invariant(options.revision, "inspect requires --revision")
    assertRevision(options.revision)
    const context = await fetchGitHubReleaseContext(version)
    invariant(context.tagRevision === options.revision, "GitHub Release tag commit is invalid")
    const report = {
      releaseId: context.release?.id || null,
      state: context.state,
      tag: releaseTag(version),
      tagRevision: context.tagRevision,
    }
    process.stdout.write(options.json ? `${JSON.stringify(report)}\n` : `GitHub Release: ${report.state}\n`)
    return
  }

  if (command === "verify") {
    invariant(options.directory, "verify requires --directory")
    invariant(options.evidence, "verify requires --evidence")
    invariant(options.expect === "draft" || options.expect === "immutable", "verify requires --expect draft or immutable")
    invariant(options.revision, "verify requires --revision")
    const evidence = await readJson(resolve(options.evidence))
    invariant(evidence.revision === options.revision, "GitHub Release evidence revision is invalid")
    const context = await fetchGitHubReleaseContext(version)
    invariant(context.state === options.expect, `GitHub Release is ${context.state}, expected ${options.expect}`)
    const notes = await readFile(join(resolve(options.directory), RELEASE_NOTES_FILE), "utf8")
    const report = validateGitHubRelease({
      evidence,
      expectedState: options.expect,
      notes,
      release: context.release,
      tagRevision: context.tagRevision,
    })
    process.stdout.write(options.json ? `${JSON.stringify(report)}\n` : `GitHub Release: exact ${report.state}\n`)
    return
  }

  throw new Error(`Unknown GitHub Release command ${command}`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) await main(process.argv.slice(2))
