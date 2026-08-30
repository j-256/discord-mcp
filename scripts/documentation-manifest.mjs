import { readFile, readdir } from "node:fs/promises"
import { join, posix } from "node:path"

import {
  canonicalJson,
  invariant,
  readJson,
  REPOSITORY_ROOT,
  sha256,
} from "./release-lib.mjs"

export const DOCUMENTATION_URL = "https://guildcontrol.lasers.app"
export const DOCUMENTATION_MANIFEST_FORMAT = "guildcontrol.docs-manifest.v1"
export const DOCUMENTATION_MANIFEST_PATH = "generated/docs-manifest.json"
export const DOCUMENTATION_CONTENT_PATHS = Object.freeze([
  "README.md",
  "docs/getting-started.md",
  "docs/migration.md",
  "docs/limitations.md",
  "PRIVACY.md",
  "docs/comparison.md",
  "SUPPORT.md",
  "docs/releasing.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "docs/reference.md",
  "SECURITY.md",
  "guildcontrol.config.schema.json",
  "server.json",
  "LICENSE",
  "assets/guildcontrol-icon.png",
  "package.json",
])

const DOCUMENTATION_BUILD_PATHS = Object.freeze([
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "package-lock.json",
  "scripts/check-public-documentation.mjs",
  "scripts/check-release-metadata.mjs",
  "scripts/documentation-manifest.mjs",
  "scripts/neutrality.mjs",
  "scripts/release-lib.mjs",
  "site/astro.config.mjs",
  "site/package-lock.json",
  "site/package.json",
  "site/scripts/browser-test.mjs",
  "site/scripts/comparison-registry.mjs",
  "site/scripts/evidence-link-test.mjs",
  "site/scripts/generate.mjs",
  "site/src/components/ReleaseFooter.astro",
  "site/src/content.config.ts",
  "site/src/content/docs/contribute/index.mdx",
  "site/src/content/docs/index.mdx",
  "site/src/content/docs/operate/index.mdx",
  "site/src/content/docs/reference/index.mdx",
  "site/src/content/docs/start/choose.mdx",
  "site/src/content/docs/understand/safety.mdx",
  "site/src/pages/404.astro",
  "site/src/styles/custom.css",
  "site/test/comparison-registry.test.mjs",
  "site/test/site.test.mjs",
  "site/tsconfig.json",
  "test/public-documentation.test.ts",
  "tsconfig.build.json",
  "tsconfig.json",
])
const DOCUMENTATION_BUILD_DIRECTORIES = Object.freeze([
  "site/plugins",
  "src",
])

const DOCUMENTATION_RESPONSE_BYTE_LIMIT = 512 * 1024
const DOCUMENTATION_REQUEST_TIMEOUT_MS = 15_000
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const REQUIRED_OUTPUT_PATHS = Object.freeze([
  "public/generated/LICENSE.txt",
  "public/generated/contract-evidence.json",
  "public/generated/contract-explorer.html",
  "public/generated/guildcontrol-icon.png",
  "public/generated/guildcontrol.config.schema.json",
  "public/generated/server.json",
  "public/llms-full.txt",
  "public/llms.txt",
])

function assertObject(value, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`)
}

function assertExactKeys(value, expected, label) {
  assertObject(value, label)
  const actual = Object.keys(value).sort()
  invariant(canonicalJson(actual) === canonicalJson([...expected].sort()), `${label} fields are invalid`)
}

function assertSafeRelativePath(path, label) {
  invariant(typeof path === "string" && path.length > 0, `${label} path is invalid`)
  invariant(!path.includes("\\") && !path.includes("\0"), `${label} path is unsafe`)
  invariant(!path.startsWith("/") && !path.startsWith("../"), `${label} path is unsafe`)
  invariant(posix.normalize(path) === path, `${label} path is not canonical`)
}

function validateEvidenceEntries(entries, label) {
  invariant(Array.isArray(entries), `${label} must be an array`)
  const paths = []
  for (const entry of entries) {
    assertExactKeys(entry, ["path", "sha256"], `${label} entry`)
    assertSafeRelativePath(entry.path, label)
    invariant(SHA256_PATTERN.test(entry.sha256), `${label} digest is invalid`)
    paths.push(entry.path)
  }
  invariant(new Set(paths).size === paths.length, `${label} paths must be unique`)
  return paths
}

async function collectFiles(path) {
  const entries = await readdir(join(REPOSITORY_ROOT, path), { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = posix.join(path, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(child))
    else if (entry.isFile()) files.push(child)
    else throw new Error(`documentation source ${child} has an unsupported file type`)
  }
  return files
}

export async function documentationSourcePaths() {
  const buildFiles = (await Promise.all(
    DOCUMENTATION_BUILD_DIRECTORIES.map((path) => collectFiles(path)),
  )).flat()
  return [...new Set([
    ...DOCUMENTATION_CONTENT_PATHS,
    ...DOCUMENTATION_BUILD_PATHS,
    ...buildFiles,
  ])].sort()
}

export async function documentationSourceEvidence() {
  const paths = await documentationSourcePaths()
  return Promise.all(paths.map(async (path) => ({
    path,
    sha256: sha256(await readFile(`${REPOSITORY_ROOT}/${path}`)),
  })))
}

export async function validateDocumentationManifest(manifest, options = {}) {
  assertExactKeys(manifest, ["format", "outputs", "package", "sources"], "documentation manifest")
  invariant(manifest.format === DOCUMENTATION_MANIFEST_FORMAT, "documentation manifest format is invalid")

  const packageJson = options.packageJson ?? await readJson(`${REPOSITORY_ROOT}/package.json`)
  assertExactKeys(manifest.package, ["name", "version"], "documentation package identity")
  invariant(manifest.package.name === packageJson.name, "documentation package name is stale")
  invariant(manifest.package.version === packageJson.version, "documentation package version is stale")

  const outputPaths = validateEvidenceEntries(manifest.outputs, "documentation output")
  invariant(
    canonicalJson(outputPaths) === canonicalJson([...outputPaths].sort()),
    "documentation outputs must use canonical path order",
  )
  for (const required of REQUIRED_OUTPUT_PATHS) {
    invariant(outputPaths.includes(required), `documentation manifest lacks ${required}`)
  }
  invariant(
    outputPaths.every((path) => path.startsWith("public/") || path.startsWith("src/content/docs/")),
    "documentation manifest includes an unexpected output path",
  )

  validateEvidenceEntries(manifest.sources, "documentation source")
  const expectedSources = options.expectedSources ?? await documentationSourceEvidence()
  invariant(
    canonicalJson(manifest.sources) === canonicalJson(expectedSources),
    "documentation source frontier is stale",
  )

  return {
    format: manifest.format,
    outputCount: manifest.outputs.length,
    packageName: manifest.package.name,
    sourceCount: manifest.sources.length,
    sourceFingerprint: sha256(canonicalJson({
      package: manifest.package,
      sources: manifest.sources,
    })),
    version: manifest.package.version,
  }
}

async function fetchDocumentationManifest(fetchImplementation, cacheKey) {
  const url = new URL(DOCUMENTATION_MANIFEST_PATH, `${DOCUMENTATION_URL}/`)
  url.searchParams.set("verification", cacheKey)
  const response = await fetchImplementation(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
    },
    redirect: "error",
    signal: AbortSignal.timeout(DOCUMENTATION_REQUEST_TIMEOUT_MS),
  })
  invariant(response.ok, `${DOCUMENTATION_URL} returned HTTP ${response.status}`)
  const contentType = response.headers.get("content-type") || ""
  invariant(contentType.includes("application/json"), `${DOCUMENTATION_URL} returned a non-JSON manifest`)
  const contentLength = response.headers.get("content-length")
  if (contentLength !== null) {
    invariant(/^\d+$/u.test(contentLength), "documentation manifest content length is invalid")
    invariant(Number(contentLength) <= DOCUMENTATION_RESPONSE_BYTE_LIMIT, "documentation manifest is too large")
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  invariant(bytes.length <= DOCUMENTATION_RESPONSE_BYTE_LIMIT, "documentation manifest is too large")
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    throw new Error("documentation manifest contains invalid JSON")
  }
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function verifyPublicDocumentation(options = {}) {
  const attempts = options.attempts ?? 1
  const delayMs = options.delayMs ?? 0
  const fetchImplementation = options.fetchImplementation ?? fetch
  invariant(Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 12, "documentation attempts are invalid")
  invariant(Number.isSafeInteger(delayMs) && delayMs >= 0 && delayMs <= 10_000, "documentation delay is invalid")

  const packageJson = await readJson(`${REPOSITORY_ROOT}/package.json`)
  const expectedSources = await documentationSourceEvidence()
  const validationOptions = { expectedSources, packageJson }
  let expectedReport
  if (options.expectedManifest !== undefined) {
    expectedReport = await validateDocumentationManifest(options.expectedManifest, validationOptions)
  } else {
    expectedReport = {
      sourceFingerprint: sha256(canonicalJson({
        package: { name: packageJson.name, version: packageJson.version },
        sources: expectedSources,
      })),
    }
  }

  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const manifest = await fetchDocumentationManifest(
        fetchImplementation,
        `${expectedReport.sourceFingerprint}-${attempt}`,
      )
      const report = await validateDocumentationManifest(manifest, validationOptions)
      if (options.expectedManifest !== undefined) {
        invariant(
          canonicalJson(manifest) === canonicalJson(options.expectedManifest),
          "deployed documentation manifest differs from the verified artifact",
        )
      }
      return {
        ...report,
        manifestUrl: `${DOCUMENTATION_URL}/${DOCUMENTATION_MANIFEST_PATH}`,
        state: "matching",
      }
    } catch (error) {
      const failure = error instanceof Error
        ? error
        : new Error("public documentation verification failed without an error message")
      lastError = failure
      if (attempt === attempts) break
      options.onRetry?.(failure, attempt, attempts)
      if (delayMs > 0) await wait(delayMs)
    }
  }
  throw lastError
}
