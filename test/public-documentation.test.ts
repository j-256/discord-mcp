import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

interface ManifestEntry {
  path: string
  sha256: string
}

interface DocumentationManifest {
  format: string
  outputs: ManifestEntry[]
  package: { name: string; version: string }
  sources: ManifestEntry[]
  [key: string]: unknown
}

interface DocumentationModule {
  DOCUMENTATION_MANIFEST_FORMAT: string
  DOCUMENTATION_MANIFEST_PATH: string
  DOCUMENTATION_URL: string
  documentationSourceEvidence(): Promise<ManifestEntry[]>
  validateDocumentationManifest(manifest: unknown): Promise<{
    sourceFingerprint: string
    version: string
  }>
  verifyPublicDocumentation(options?: {
    attempts?: number
    delayMs?: number
    expectedManifest?: unknown
    fetchImplementation?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    onRetry?: (error: Error, attempt: number, attempts: number) => void
  }): Promise<{ state: string; version: string }>
}

interface DocumentationCliModule {
  parseArguments(args: string[]): {
    attempts: number
    delayMs: number
    help: boolean
    json: boolean
    manifest?: string
  }
}

const documentation = await import(
  pathToFileURL(resolve("scripts/documentation-manifest.mjs")).href
) as DocumentationModule
const documentationCli = await import(
  pathToFileURL(resolve("scripts/check-public-documentation.mjs")).href
) as DocumentationCliModule
const CLI_PATH = resolve("scripts/check-public-documentation.mjs")
const HASH = "a".repeat(64)
const REQUIRED_OUTPUTS = [
  "public/generated/LICENSE.txt",
  "public/generated/contract-evidence.json",
  "public/generated/contract-explorer.html",
  "public/generated/guildcontrol-icon.png",
  "public/generated/guildcontrol.config.schema.json",
  "public/generated/server.json",
  "public/llms-full.txt",
  "public/llms.txt",
].sort()

async function validManifest(): Promise<DocumentationManifest> {
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
    name: string
    version: string
  }
  return {
    format: documentation.DOCUMENTATION_MANIFEST_FORMAT,
    outputs: REQUIRED_OUTPUTS.map((path) => ({ path, sha256: HASH })),
    package: { name: packageJson.name, version: packageJson.version },
    sources: await documentation.documentationSourceEvidence(),
  }
}

function responseFor(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  if (!headers.has("content-type")) headers.set("content-type", "application/json")
  return new Response(`${JSON.stringify(value)}\n`, {
    ...init,
    headers,
  })
}

test("documentation manifest binds the exact package and source frontier", async () => {
  const manifest = await validManifest()
  const report = await documentation.validateDocumentationManifest(manifest)
  assert.equal(report.version, manifest.package.version)
  assert.match(report.sourceFingerprint, /^[0-9a-f]{64}$/u)

  await assert.rejects(
    documentation.validateDocumentationManifest({
      ...manifest,
      package: { ...manifest.package, version: "9.9.9" },
    }),
    /package version is stale/u,
  )
  await assert.rejects(
    documentation.validateDocumentationManifest({
      ...manifest,
      sources: manifest.sources.map((source, index) => (
        index === 0 ? { ...source, sha256: "b".repeat(64) } : source
      )),
    }),
    /source frontier is stale/u,
  )
})

test("documentation manifest rejects unsafe, incomplete, duplicate, and noncanonical output sets", async () => {
  const manifest = await validManifest()
  await assert.rejects(
    documentation.validateDocumentationManifest({
      ...manifest,
      outputs: [{ path: "../private", sha256: HASH }, ...manifest.outputs],
    }),
    /path is unsafe/u,
  )
  await assert.rejects(
    documentation.validateDocumentationManifest({
      ...manifest,
      outputs: manifest.outputs.slice(1),
    }),
    /manifest lacks/u,
  )
  await assert.rejects(
    documentation.validateDocumentationManifest({
      ...manifest,
      outputs: [...manifest.outputs, manifest.outputs[0]],
    }),
    /paths must be unique/u,
  )
  await assert.rejects(
    documentation.validateDocumentationManifest({
      ...manifest,
      outputs: [...manifest.outputs].reverse(),
    }),
    /canonical path order/u,
  )
  await assert.rejects(
    documentation.validateDocumentationManifest({ ...manifest, unexpected: true }),
    /fields are invalid/u,
  )
})

test("public documentation verification requires an exact bounded no-redirect JSON response", async () => {
  const manifest = await validManifest()
  let observedUrl = ""
  const report = await documentation.verifyPublicDocumentation({
    expectedManifest: manifest,
    fetchImplementation: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      observedUrl = url.toString()
      assert.equal(url.origin, new URL(documentation.DOCUMENTATION_URL).origin)
      assert.equal(url.pathname, `/guildcontrol/${documentation.DOCUMENTATION_MANIFEST_PATH}`)
      assert.match(url.searchParams.get("verification") || "", /^[0-9a-f]{64}-1$/u)
      assert.equal(init?.redirect, "error")
      assert.equal(init?.cache, "no-store")
      return responseFor(manifest)
    },
  })
  assert.equal(report.state, "matching")
  assert.ok(observedUrl.length > 0)

  await assert.rejects(
    documentation.verifyPublicDocumentation({
      expectedManifest: manifest,
      fetchImplementation: async () => responseFor({}, { status: 302 }),
    }),
    /HTTP 302/u,
  )
  await assert.rejects(
    documentation.verifyPublicDocumentation({
      expectedManifest: manifest,
      fetchImplementation: async () => responseFor(manifest, {
        headers: { "content-length": String(513 * 1024) },
      }),
    }),
    /too large/u,
  )
  await assert.rejects(
    documentation.verifyPublicDocumentation({
      expectedManifest: manifest,
      fetchImplementation: async () => new Response("not json", {
        headers: { "content-type": "text/plain" },
      }),
    }),
    /non-JSON/u,
  )
})

test("public documentation verification retries stale deployment evidence and compares exact artifacts", async () => {
  const manifest = await validManifest()
  let requests = 0
  const retries: number[] = []
  const report = await documentation.verifyPublicDocumentation({
    attempts: 2,
    delayMs: 0,
    expectedManifest: manifest,
    fetchImplementation: async () => {
      requests += 1
      return responseFor(requests === 1
        ? { ...manifest, outputs: manifest.outputs.map((output, index) => (
          index === 0 ? { ...output, sha256: "b".repeat(64) } : output
        )) }
        : manifest)
    },
    onRetry(_error, attempt) {
      retries.push(attempt)
    },
  })
  assert.equal(report.state, "matching")
  assert.equal(requests, 2)
  assert.deepEqual(retries, [1])

  await assert.rejects(
    documentation.verifyPublicDocumentation({
      expectedManifest: manifest,
      fetchImplementation: async () => responseFor({
        ...manifest,
        outputs: manifest.outputs.map((output, index) => (
          index === 0 ? { ...output, sha256: "b".repeat(64) } : output
        )),
      }),
    }),
    /differs from the verified artifact/u,
  )
})

test("public documentation command supports machine-facing option forms and usage exits", () => {
  assert.deepEqual(
    documentationCli.parseArguments([
      "--attempts=2",
      "--delay-ms",
      "0",
      "--manifest=site/dist/generated/docs-manifest.json",
      "--json",
      "--",
    ]),
    {
      attempts: 2,
      delayMs: 0,
      help: false,
      json: true,
      manifest: resolve("site/dist/generated/docs-manifest.json"),
    },
  )

  for (const helpOption of ["-h", "--help"]) {
    const result = spawnSync(process.execPath, [CLI_PATH, helpOption], { encoding: "utf8" })
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Usage: node scripts\/check-public-documentation\.mjs/u)
    assert.equal(result.stderr, "")
  }
  for (const args of [["--unknown"], ["--attempts"], ["--attempts=0"], ["--", "extra"]]) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf8" })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Try --help for usage\./u)
    assert.equal(result.stdout, "")
  }
})
