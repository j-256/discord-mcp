import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

interface ReleaseAsset {
  digest: string
  name: string
  size: number
}

interface ReleaseEvidence {
  assets: ReleaseAsset[]
  format: string
  notesDigest: string
  npmIntegrity: string
  ociDigest: string
  revision: string
  schemaVersion: number
  tag: string
  title: string
  version: string
}

interface GitHubReleaseModule {
  classifyGitHubRelease(releases: unknown[], version: string): { release?: Record<string, unknown>; state: string }
  fetchGitHubReleaseContext(version: string): Promise<unknown>
  findGitHubRelease(version: string, token?: string): Promise<{ release?: Record<string, unknown>; state: string }>
  prepareGitHubReleaseEvidence(input: {
    directory: string
    ociDigest: string
    output: string
    revision: string
    version: string
  }): Promise<ReleaseEvidence>
  renderGitHubReleaseNotes(input: {
    npmIntegrity: string
    ociDigest: string
    revision: string
    version: string
  }): string
  renderSha256Sums(assets: ReleaseAsset[]): string
  validateGitHubRelease(input: {
    evidence: ReleaseEvidence
    expectedState: "draft" | "immutable"
    notes: string
    release: Record<string, unknown>
    tagRevision: string
  }): { assets: ReleaseAsset[]; releaseId: number; state: string; tag: string; url: string }
}

const modulePath = pathToFileURL(resolve("scripts/github-release.mjs")).href
const githubRelease = await import(modulePath) as GitHubReleaseModule
const VERSION = "0.1.1"
const REVISION = "a".repeat(40)
const OCI_DIGEST = `sha256:${"b".repeat(64)}`
const ARCHIVE_NAME = `j-256-discord-mcp-${VERSION}.tgz`
const NPM_INTEGRITY = `sha512-${Buffer.alloc(64, 3).toString("base64")}`

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function validCatalog(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activityRecordsCreated: false,
    credentialsRequired: false,
    discordExecution: "disabled",
    evidenceFormat: "discord-mcp.catalog-evidence.v1",
    gateway: "disabled",
    observabilityExport: "disabled",
    schemaVersion: 1,
    serverVersion: VERSION,
    status: "ok",
    ...overrides,
  }
}

function validSbom(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `@j-256/discord-mcp@${VERSION}`,
    packages: [{ name: "@j-256/discord-mcp", versionInfo: VERSION }],
    spdxVersion: "SPDX-2.3",
    ...overrides,
  }
}

async function writeEvidenceInputs(
  directory: string,
  options: { catalog?: Record<string, unknown>; sbom?: Record<string, unknown> } = {},
): Promise<void> {
  await mkdir(directory)
  await writeFile(join(directory, ARCHIVE_NAME), "verified npm archive")
  await writeFile(join(directory, "catalog-evidence.json"), `${JSON.stringify(options.catalog || validCatalog())}\n`)
  await writeFile(join(directory, "sbom.spdx.json"), `${JSON.stringify(options.sbom || validSbom())}\n`)
}

function validRelease(evidence: ReleaseEvidence, notes: string, state: "draft" | "immutable"): Record<string, unknown> {
  return {
    assets: evidence.assets.map((asset) => ({
      ...asset,
      browser_download_url: `https://github.com/j-256/discord-mcp/releases/download/${evidence.tag}/${asset.name}`,
      state: "uploaded",
    })),
    body: notes,
    draft: state === "draft",
    html_url: `https://github.com/j-256/discord-mcp/releases/tag/${evidence.tag}`,
    id: 123,
    immutable: state === "immutable",
    name: evidence.title,
    prerelease: false,
    published_at: state === "immutable" ? "2026-08-27T16:00:00Z" : null,
    tag_name: evidence.tag,
  }
}

async function preparedEvidence(t: test.TestContext): Promise<{
  directory: string
  evidence: ReleaseEvidence
  notes: string
}> {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-github-release-test-"))
  t.after(() => rm(root, { force: true, recursive: true }))
  const directory = join(root, "input")
  const output = join(root, "evidence.json")
  await writeEvidenceInputs(directory)
  const evidence = await githubRelease.prepareGitHubReleaseEvidence({
    directory,
    ociDigest: OCI_DIGEST,
    output,
    revision: REVISION,
    version: VERSION,
  })
  return {
    directory,
    evidence,
    notes: await readFile(join(directory, "release-notes.md"), "utf8"),
  }
}

test("renders deterministic release notes with exact public identities and verification commands", () => {
  const notes = githubRelease.renderGitHubReleaseNotes({
    npmIntegrity: NPM_INTEGRITY,
    ociDigest: OCI_DIGEST,
    revision: REVISION,
    version: VERSION,
  })
  assert.match(notes, new RegExp(`Discord MCP ${VERSION}`, "u"))
  assert.match(notes, new RegExp(REVISION, "u"))
  assert.match(notes, new RegExp(OCI_DIGEST, "u"))
  assert.match(notes, /gh release verify v0\.1\.1/u)
  assert.match(notes, /gh release verify-asset v0\.1\.1 j-256-discord-mcp-0\.1\.1\.tgz/u)
  assert.match(notes, /gh release verify-asset v0\.1\.1 release-notes\.md/u)
  assert.match(notes, /Attestations establish artifact identity, origin, and integrity/u)
  assert.doesNotMatch(notes, /DISCORD_BOT_TOKEN/u)
  assert.equal(notes.endsWith("\n"), true)
})

test("renders sorted exact checksums and rejects ambiguous checksum inputs", () => {
  const assets = [
    { digest: `sha256:${"b".repeat(64)}`, name: "z.tgz", size: 2 },
    { digest: `sha256:${"a".repeat(64)}`, name: "a.json", size: 1 },
  ]
  const firstAsset = assets[0]!
  assert.equal(
    githubRelease.renderSha256Sums(assets),
    `${"a".repeat(64)}  a.json\n${"b".repeat(64)}  z.tgz\n`,
  )
  assert.throws(() => githubRelease.renderSha256Sums([firstAsset, firstAsset]), /Duplicate/u)
  assert.throws(
    () => githubRelease.renderSha256Sums([{ digest: firstAsset.digest, name: "../z.tgz", size: 2 }]),
    /name/u,
  )
  assert.throws(
    () => githubRelease.renderSha256Sums([{ digest: "sha256:not-a-digest", name: "z.tgz", size: 2 }]),
    /digest/u,
  )
})

test("prepares a bounded immutable release asset set from verified evidence", async (t) => {
  const { directory, evidence, notes } = await preparedEvidence(t)
  assert.deepEqual((await readdir(directory)).sort(), [
    "SHA256SUMS",
    "catalog-evidence.json",
    ARCHIVE_NAME,
    "release-notes.md",
    "sbom.spdx.json",
  ])
  assert.deepEqual(evidence.assets.map(({ name }) => name), [
    "SHA256SUMS",
    "catalog-evidence.json",
    ARCHIVE_NAME,
    "release-notes.md",
    "sbom.spdx.json",
  ])
  assert.equal(evidence.revision, REVISION)
  assert.equal(evidence.ociDigest, OCI_DIGEST)
  assert.equal(evidence.notesDigest, `sha256:${sha256(notes)}`)
  assert.match(evidence.npmIntegrity, /^sha512-/u)

  const checksums = await readFile(join(directory, "SHA256SUMS"), "utf8")
  const assetDigests = new Map(evidence.assets.map((asset) => [asset.name, asset.digest.slice("sha256:".length)]))
  assert.equal(checksums, [
    `${assetDigests.get("catalog-evidence.json")}  catalog-evidence.json`,
    `${assetDigests.get(ARCHIVE_NAME)}  ${ARCHIVE_NAME}`,
    `${assetDigests.get("release-notes.md")}  release-notes.md`,
    `${assetDigests.get("sbom.spdx.json")}  sbom.spdx.json`,
    "",
  ].join("\n"))
})

test("rejects secret-bearing or unverified catalog evidence and mismatched SBOM identity", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-github-release-invalid-"))
  t.after(() => rm(root, { force: true, recursive: true }))
  const cases = [
    { catalog: validCatalog({ credentialsRequired: true }), label: "credentials" },
    { catalog: validCatalog({ discordExecution: "enabled" }), label: "Discord" },
    { catalog: validCatalog({ gateway: "enabled" }), label: "Gateway" },
    { catalog: validCatalog({ observabilityExport: "enabled" }), label: "telemetry" },
    { catalog: validCatalog({ activityRecordsCreated: true }), label: "activity" },
    { label: "SBOM", sbom: validSbom({ name: "other-package@0.1.1" }) },
  ]
  for (const [index, entry] of cases.entries()) {
    const directory = join(root, `case-${index}`)
    const inputOptions: { catalog?: Record<string, unknown>; sbom?: Record<string, unknown> } = {}
    if (entry.catalog) inputOptions.catalog = entry.catalog
    if (entry.sbom) inputOptions.sbom = entry.sbom
    await writeEvidenceInputs(directory, inputOptions)
    await assert.rejects(
      githubRelease.prepareGitHubReleaseEvidence({
        directory,
        ociDigest: OCI_DIGEST,
        output: join(root, `evidence-${index}.json`),
        revision: REVISION,
        version: VERSION,
      }),
      new RegExp(entry.label, "iu"),
    )
  }
})

test("classifies only absent, editable draft, mutable, or immutable stable releases", () => {
  assert.deepEqual(githubRelease.classifyGitHubRelease([], VERSION), { release: undefined, state: "absent" })
  const draft = { draft: true, id: 1, immutable: false, prerelease: false, tag_name: `v${VERSION}` }
  assert.equal(githubRelease.classifyGitHubRelease([draft], VERSION).state, "draft")
  assert.equal(githubRelease.classifyGitHubRelease([{ ...draft, draft: false }], VERSION).state, "mutable")
  assert.equal(githubRelease.classifyGitHubRelease([{ ...draft, draft: false, immutable: true }], VERSION).state, "immutable")
  assert.throws(() => githubRelease.classifyGitHubRelease([draft, draft], VERSION), /duplicate/u)
  assert.throws(() => githubRelease.classifyGitHubRelease([{ ...draft, prerelease: true }], VERSION), /prerelease/u)
  assert.throws(() => githubRelease.classifyGitHubRelease([{ ...draft, id: 0 }], VERSION), /ID/u)
  assert.throws(() => githubRelease.classifyGitHubRelease([{ ...draft, immutable: true }], VERSION), /Draft/u)
})

test("paginates authenticated releases until it finds the exact draft tag", async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(String(input))
    const headers = new Headers(init?.headers)
    assert.equal(headers.get("authorization"), "Bearer workflow-token")
    assert.equal(headers.get("x-github-api-version"), "2026-03-10")
    if (requests.length === 1) {
      return Response.json(Array.from({ length: 100 }, (_, index) => ({
        draft: false,
        id: index + 1,
        immutable: true,
        prerelease: false,
        tag_name: `v0.0.${index}`,
      })))
    }
    return Response.json([{
      draft: true,
      id: 200,
      immutable: false,
      prerelease: false,
      tag_name: `v${VERSION}`,
    }])
  }) as typeof fetch
  try {
    const result = await githubRelease.findGitHubRelease(VERSION, "workflow-token")
    assert.equal(result.state, "draft")
    assert.equal(result.release?.id, 200)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(requests.length, 2)
  assert.match(requests[0]!, /per_page=100&page=1$/u)
  assert.match(requests[1]!, /per_page=100&page=2$/u)
})

test("rejects an oversized GitHub release response before parsing it", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response("[]", {
    headers: {
      "content-length": String(16 * 1024 * 1024 + 1),
      "content-type": "application/json",
    },
  })) as typeof fetch
  try {
    await assert.rejects(githubRelease.findGitHubRelease(VERSION, "workflow-token"), /exceeds the limit/u)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("requires authenticated state inspection so a draft cannot look absent", async () => {
  const originalToken = process.env.GITHUB_TOKEN
  delete process.env.GITHUB_TOKEN
  try {
    await assert.rejects(githubRelease.fetchGitHubReleaseContext(VERSION), /GITHUB_TOKEN/u)
  } finally {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalToken
  }
})

test("inspects the protected tag and releases without repository administration authority", async () => {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.GITHUB_TOKEN
  const requests: string[] = []
  process.env.GITHUB_TOKEN = "workflow-token"
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer workflow-token")
    if (url.endsWith(`/commits/v${VERSION}`)) return Response.json({ sha: REVISION })
    if (url.includes("/releases?")) return Response.json([])
    throw new Error(`Unexpected GitHub request ${url}`)
  }) as typeof fetch
  try {
    const context = await githubRelease.fetchGitHubReleaseContext(VERSION) as {
      state: string
      tagRevision: string
    }
    assert.equal(context.state, "absent")
    assert.equal(context.tagRevision, REVISION)
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = originalToken
  }
  assert.equal(requests.length, 2)
  assert.equal(requests.some((url) => url.includes("immutable-releases")), false)
})

test("validates exact draft and immutable GitHub Release records", async (t) => {
  const { evidence, notes } = await preparedEvidence(t)
  const draft = githubRelease.validateGitHubRelease({
    evidence,
    expectedState: "draft",
    notes,
    release: validRelease(evidence, notes, "draft"),
    tagRevision: REVISION,
  })
  assert.equal(draft.state, "draft")
  assert.equal(draft.releaseId, 123)

  const immutable = githubRelease.validateGitHubRelease({
    evidence,
    expectedState: "immutable",
    notes,
    release: validRelease(evidence, notes, "immutable"),
    tagRevision: REVISION,
  })
  assert.equal(immutable.state, "immutable")
  assert.equal(immutable.tag, `v${VERSION}`)
  assert.equal(immutable.assets.length, 5)
})

test("fails closed on release identity, content, asset, URL, or immutability drift", async (t) => {
  const { evidence, notes } = await preparedEvidence(t)
  const cases: Array<{ label: RegExp; mutate: (release: Record<string, any>) => void }> = [
    { label: /title/u, mutate: (release) => { release.name = "Other release" } },
    { label: /notes/u, mutate: (release) => { release.body = `${notes}changed` } },
    { label: /tag/u, mutate: (release) => { release.tag_name = "v9.9.9" } },
    { label: /assets/u, mutate: (release) => { release.assets.pop() } },
    { label: /assets/u, mutate: (release) => { release.assets[0].digest = `sha256:${"f".repeat(64)}` } },
    { label: /URL/u, mutate: (release) => { release.html_url += "?unexpected=true" } },
    { label: /URL/u, mutate: (release) => { release.assets[0].browser_download_url += "#unexpected" } },
    { label: /immutable/u, mutate: (release) => { release.immutable = false } },
  ]
  for (const entry of cases) {
    const release = structuredClone(validRelease(evidence, notes, "immutable")) as Record<string, any>
    entry.mutate(release)
    assert.throws(() => githubRelease.validateGitHubRelease({
      evidence,
      expectedState: "immutable",
      notes,
      release,
      tagRevision: REVISION,
    }), entry.label)
  }
  assert.throws(() => githubRelease.validateGitHubRelease({
    evidence,
    expectedState: "immutable",
    notes,
    release: validRelease(evidence, notes, "immutable"),
    tagRevision: "f".repeat(40),
  }), /commit/u)

  const alteredEvidence = structuredClone(evidence)
  alteredEvidence.tag = "v9.9.9"
  assert.throws(() => githubRelease.validateGitHubRelease({
    evidence: alteredEvidence,
    expectedState: "immutable",
    notes,
    release: validRelease(evidence, notes, "immutable"),
    tagRevision: REVISION,
  }), /evidence tag/u)

  const extendedEvidence = { ...evidence, unsupported: true } as ReleaseEvidence
  assert.throws(() => githubRelease.validateGitHubRelease({
    evidence: extendedEvidence,
    expectedState: "immutable",
    notes,
    release: validRelease(evidence, notes, "immutable"),
    tagRevision: REVISION,
  }), /evidence fields/u)

  const mismatchedNotesEvidence = structuredClone(evidence)
  mismatchedNotesEvidence.notesDigest = `sha256:${"f".repeat(64)}`
  assert.throws(() => githubRelease.validateGitHubRelease({
    evidence: mismatchedNotesEvidence,
    expectedState: "immutable",
    notes,
    release: validRelease(evidence, notes, "immutable"),
    tagRevision: REVISION,
  }), /canonical notes digest/u)
})
