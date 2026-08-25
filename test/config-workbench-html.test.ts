import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import {
  CONFIG_WORKBENCH_HTML_FORMAT,
  CONFIG_WORKBENCH_HTML_SCHEMA_VERSION,
  createDiscordConfigWorkbenchModel,
  exportDiscordConfigWorkbenchHtml,
  renderDiscordConfigWorkbenchHtml,
  type ConfigWorkbenchFileSystem,
  type DiscordConfigWorkbenchModel,
} from "../src/config-workbench-html.js"
import {
  CONFIG_DOCUMENT_SCHEMA_ID,
  connectorConfigFields,
  createConnectorConfigDocument,
  type ConnectorConfigDocument,
} from "../src/config-document.js"
import { ConfigurationError } from "../src/errors.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const AMBIENT_SECRET = "config-workbench-ambient-secret"

function document(
  overrides: Partial<ConnectorConfigDocument> = {},
): ConnectorConfigDocument {
  const base = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: "DISCORD_WORKBENCH_TOKEN",
    guildIds: [GUILD_ID],
    name: "workbench",
    toolsets: ["connector", "guilds", "messages"],
    toolSurface: "progressive",
  })
  return {
    ...base,
    ...overrides,
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function embeddedModel(html: string): DiscordConfigWorkbenchModel {
  const encoded = html.match(/id="workbench-data" data-payload="([A-Za-z0-9+/=]+)"/)?.[1]
  assert.ok(encoded)
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as DiscordConfigWorkbenchModel
}

test("configuration workbench renders a deterministic complete offline editor", () => {
  const model = createDiscordConfigWorkbenchModel(
    "/configuration/discord-mcp.json",
    document(),
    "darwin",
  )
  const html = renderDiscordConfigWorkbenchHtml(model)
  const repeated = renderDiscordConfigWorkbenchHtml(model)
  const payload = embeddedModel(html)

  assert.equal(repeated, html)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, new RegExp(CONFIG_WORKBENCH_HTML_FORMAT))
  assert.match(html, /Private offline policy editor/)
  assert.match(html, /Candidate only/)
  assert.match(html, /config plan is authoritative/)
  assert.match(html, /Download candidate/)
  assert.match(html, /No secret-value field/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /default-src 'none'/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /form-action 'none'/)
  assert.match(html, /require-trusted-types-for 'script'/)
  assert.match(html, /meta name="referrer" content="no-referrer"/)
  assert.match(html, /prefers-reduced-motion/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.match(html, /<section class="sticky" aria-label="Policy navigation and filters">/)
  assert.match(html, /<main id="main" class="shell" tabindex="-1">/)
  assert.match(html, /setAttribute\('aria-label', fieldLabel\(field\)\)/)
  assert.match(html, /new Blob\(\[candidateJson\(\)\]/)
  assert.match(html, /URL\.createObjectURL/)
  assert.match(html, /link\.download = payload\.candidateFilename/)
  assert.doesNotMatch(html, /<script\s+src=/)
  assert.doesNotMatch(html, /<link\b/)
  assert.doesNotMatch(html, /href="https?:/)
  assert.doesNotMatch(html, /url\(https?:/)
  assert.doesNotMatch(html, /\bfetch\s*\(/)
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|sendBeacon/)
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker/)
  assert.doesNotMatch(html, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/)

  const script = html.match(/<script>([\s\S]+)<\/script>/)?.[1]
  const style = html.match(/<style>([\s\S]+)<\/style>/)?.[1]
  assert.ok(script)
  assert.ok(style)
  assert.ok(html.includes(`script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'`))
  assert.ok(html.includes(`style-src 'sha256-${createHash("sha256").update(style).digest("base64")}'`))

  assert.equal(payload.format, CONFIG_WORKBENCH_HTML_FORMAT)
  assert.equal(payload.schemaVersion, CONFIG_WORKBENCH_HTML_SCHEMA_VERSION)
  assert.equal(payload.schemaId, CONFIG_DOCUMENT_SCHEMA_ID)
  assert.equal(payload.platform, "darwin")
  assert.equal(payload.activeFile, "/configuration/discord-mcp.json")
  assert.equal(payload.candidateFilename, "discord-mcp.candidate.json")
  assert.deepEqual(payload.activeDocument, document())
  assert.equal(payload.fields.length, connectorConfigFields().length)
  assert.deepEqual(
    payload.fields.map((field) => field.path),
    connectorConfigFields().map((field) => field.path),
  )
  assert.equal(payload.fields.find((field) => field.path === "$.$schema")?.editable, false)
  assert.equal(payload.fields.find((field) => field.path === "$.schemaVersion")?.editable, false)
  assert.equal(payload.fields.find((field) => field.path === "$.identity.applicationId")?.editable, false)
  assert.equal(payload.fields.find((field) => field.path === "$.identity.botId")?.editable, false)
  assert.match(
    payload.fields.find((field) => (
      field.path === "$.capabilities.directMessageAttachments"
    ))?.description ?? "",
    /owned local-file attachments/,
  )
  assert.deepEqual(
    payload.fields.find((field) => field.path === "$.credential")?.constraints.referenceProviders?.map((entry) => entry.provider),
    ["environment", "file"],
  )
  assert.deepEqual(
    payload.fields.find((field) => field.path === "$.tools.surface")?.constraints.enumValues,
    ["full", "progressive"],
  )
})

test("configuration workbench base64 payload contains hostile non-secret paths without HTML execution", () => {
  const hostile = "/var/lib/discord-mcp/<img-onerror-alert>"
  const configured = document({
    storage: {
      auditFile: hostile,
    },
  })
  const model = createDiscordConfigWorkbenchModel(
    "/configuration/<active>.json",
    configured,
    "darwin",
  )
  const html = renderDiscordConfigWorkbenchHtml(model)
  const payload = embeddedModel(html)

  assert.equal(payload.activeDocument.storage.auditFile, hostile)
  assert.doesNotMatch(html, /<img-onerror-alert>/)
  assert.doesNotMatch(html, /<active>/)
  assert.match(html, /data-payload="[A-Za-z0-9+/=]+"/)
})

test("configuration workbench rejects a model changed after validation", () => {
  const model = createDiscordConfigWorkbenchModel(
    "/configuration/discord-mcp.json",
    document(),
  )
  const changed = {
    ...model,
    candidateFilename: "unreviewed.json",
  } as DiscordConfigWorkbenchModel

  assert.throws(
    () => renderDiscordConfigWorkbenchHtml(changed),
    (error: unknown) => (
      error instanceof ConfigurationError
      && /does not match the current schema contract/.test(error.message)
    ),
  )
})

test("configuration workbench export is private, exclusive, credential-free, and network-free", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-workbench-test-"))
  const directory = await realpath(temporary)
  const active = join(directory, "discord-mcp.json")
  const first = join(directory, "first.html")
  const second = join(directory, "second.html")
  const existing = join(directory, "existing.html")
  const previousSecret = process.env.DISCORD_WORKBENCH_TOKEN
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  try {
    await writeFile(active, `${JSON.stringify(document(), null, 2)}\n`, { mode: 0o600 })
    process.env.DISCORD_WORKBENCH_TOKEN = AMBIENT_SECRET
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error("Configuration workbench attempted network access")
    }) as typeof fetch

    const firstReport = await exportDiscordConfigWorkbenchHtml(active, first)
    const secondReport = await exportDiscordConfigWorkbenchHtml(active, second)
    const firstBytes = await readFile(first)
    const secondBytes = await readFile(second)

    assert.deepEqual(secondBytes, firstBytes)
    assert.equal(firstReport.activeConfigurationWritten, false)
    assert.equal(firstReport.activeFile, resolve(active))
    assert.equal(firstReport.automaticNetwork, "disabled")
    assert.equal(firstReport.browserOpened, false)
    assert.equal(firstReport.bytes, firstBytes.byteLength)
    assert.equal(firstReport.candidateAuthority, "explicit-download-only")
    assert.equal(firstReport.candidateFilename, "discord-mcp.candidate.json")
    assert.equal(firstReport.configurationEmbedded, true)
    assert.equal(firstReport.credentialsEmbedded, false)
    assert.equal(firstReport.discordContacted, false)
    assert.deepEqual(firstReport.externalNavigationOrigins, [])
    assert.equal(firstReport.file, resolve(first))
    assert.equal(firstReport.format, CONFIG_WORKBENCH_HTML_FORMAT)
    assert.equal(firstReport.htmlDigest, `sha256:${sha256(firstBytes)}`)
    assert.equal(firstReport.outputFileCreated, true)
    assert.equal(firstReport.schemaVersion, CONFIG_WORKBENCH_HTML_SCHEMA_VERSION)
    assert.equal(firstReport.secretValuesRead, false)
    assert.equal(firstReport.statePersistence, "disabled")
    assert.equal(firstReport.status, "ok")
    assert.equal(secondReport.htmlDigest, firstReport.htmlDigest)
    assert.equal(secondReport.activeDocumentDigest, firstReport.activeDocumentDigest)
    assert.equal(secondReport.schemaDigest, firstReport.schemaDigest)
    assert.equal(fetchCalls, 0)
    assert.equal((await stat(first)).mode & 0o777, 0o600)
    assert.doesNotMatch(firstBytes.toString("utf8"), new RegExp(AMBIENT_SECRET))

    await writeFile(existing, "operator-owned", { encoding: "utf8", mode: 0o600 })
    await assert.rejects(
      exportDiscordConfigWorkbenchHtml(active, existing),
      (error: unknown) => (
        error instanceof ConfigurationError
        && /already exists/.test(error.message)
        && !error.message.includes(existing)
      ),
    )
    assert.equal(await readFile(existing, "utf8"), "operator-owned")
  } finally {
    globalThis.fetch = originalFetch
    if (previousSecret === undefined) delete process.env.DISCORD_WORKBENCH_TOKEN
    else process.env.DISCORD_WORKBENCH_TOKEN = previousSecret
    await rm(temporary, { force: true, recursive: true })
  }
})

test("configuration workbench rejects unsafe output directories before opening a file", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-workbench-directory-test-"))
  const directory = await realpath(temporary)
  const active = join(directory, "discord-mcp.json")
  const unsafe = join(directory, "unsafe")
  let opens = 0
  try {
    await writeFile(active, `${JSON.stringify(document(), null, 2)}\n`, { mode: 0o600 })
    await mkdir(unsafe, { mode: 0o700 })
    await chmod(unsafe, 0o777)
    const fileSystem: ConfigWorkbenchFileSystem = {
      async lstat(path) {
        return lstat(path)
      },
      async open() {
        opens += 1
        throw new Error("must not open")
      },
      realpath,
      async unlink() {},
    }

    await assert.rejects(
      exportDiscordConfigWorkbenchHtml(active, join(unsafe, "workbench.html"), {
        fileSystem,
      }),
      (error: unknown) => (
        error instanceof ConfigurationError
        && /canonical, owned by the process user/.test(error.message)
      ),
    )
    assert.equal(opens, 0)
  } finally {
    await chmod(unsafe, 0o700).catch(() => undefined)
    await rm(temporary, { force: true, recursive: true })
  }
})

test("configuration workbench removes a partial output after an exclusive write failure", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-config-workbench-write-test-"))
  const directory = await realpath(temporary)
  const active = join(directory, "discord-mcp.json")
  const output = "/virtual/workbench.html"
  const events: string[] = []
  try {
    await writeFile(active, `${JSON.stringify(document(), null, 2)}\n`, { mode: 0o600 })
    await assert.rejects(
      exportDiscordConfigWorkbenchHtml(active, output, {
        fileSystem: {
          async lstat(received) {
            assert.equal(received, "/virtual")
            return {
              isDirectory: () => true,
              isSymbolicLink: () => false,
              mode: 0o700,
              uid: 501,
            }
          },
          async open(received, flags, mode) {
            assert.equal(received, output)
            assert.equal(flags, "wx")
            assert.equal(mode, 0o600)
            events.push("open")
            return {
              async close() {
                events.push("close")
              },
              async sync() {
                events.push("sync")
              },
              async writeFile() {
                events.push("write")
                throw new Error("simulated storage failure")
              },
            }
          },
          async realpath(received) {
            assert.equal(received, "/virtual")
            return received
          },
          async unlink(received) {
            assert.equal(received, output)
            events.push("unlink")
          },
        },
        platform: "darwin",
        processUserId: 501,
      }),
      (error: unknown) => (
        error instanceof ConfigurationError
        && error.message === "Configuration workbench could not be written"
      ),
    )
    assert.deepEqual(events, ["open", "write", "close", "unlink"])
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})
