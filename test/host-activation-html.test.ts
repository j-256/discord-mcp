import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import { createConnectorConfigDocument } from "../src/config-document.js"
import { CONNECTOR_VERSION } from "../src/constants.js"
import { ConfigurationError } from "../src/errors.js"
import {
  HOST_ACTIVATION_HTML_FORMAT,
  HOST_ACTIVATION_HTML_SCHEMA_VERSION,
  exportDiscordHostActivationHtml,
  renderDiscordHostActivationHtml,
} from "../src/host-activation-html.js"
import {
  createHostActivationPlan,
  type HostActivationPlan,
} from "../src/host-activation.js"
import { createStdioLaunchDescriptor } from "../src/operator.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const CONFIG_FILE = "/configuration/discord-mcp.json"
const TOKEN_ALIAS = "DISCORD_ACTIVATION_BOT_TOKEN"
const AMBIENT_SECRET = "host-activation-html-ambient-secret"

function activationPlan(command = "npx"): HostActivationPlan {
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "activation-policy",
    toolsets: ["connector", "guilds"],
    toolSurface: "progressive",
  })
  const launch = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    args: ["--yes", `@j-256/discord-mcp@${CONNECTOR_VERSION}`, "serve"],
    botId: BOT_ID,
    command,
    config: { document, file: CONFIG_FILE },
  })
  return createHostActivationPlan({
    document,
    launch,
    source: { file: CONFIG_FILE, kind: "config" },
  })
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

test("host activation HTML renders an exact private host-neutral handoff", () => {
  const plan = activationPlan()
  const html = renderDiscordHostActivationHtml(plan)

  assert.equal(renderDiscordHostActivationHtml(plan), html)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, new RegExp(HOST_ACTIVATION_HTML_FORMAT))
  assert.match(html, /Private host activation/)
  assert.match(html, /Map the contract\. Keep custody\./)
  assert.match(html, /Cannot discover or edit an MCP host/)
  assert.match(html, /Cannot read a credential value/)
  assert.match(html, /Cannot start a local process/)
  assert.match(html, /Cannot contact Discord or another network/)
  assert.match(html, /Cannot validate a host-specific translation/)
  assert.match(html, /Cannot prove a host approval interface/)
  assert.match(html, /Local child process only; do not translate to HTTP/)
  assert.match(html, /Required server/)
  assert.match(html, /Write approval/)
  assert.match(html, /Elicitation/)
  assert.match(html, /Startup timeout/)
  assert.match(html, /Tool timeout/)
  assert.match(html, /Forward references, never values/)
  assert.match(html, /Do not paste a bot token into a static host file/)
  assert.ok(html.includes(escaped(plan.verification.prompt)))
  assert.ok(html.includes(escaped(JSON.stringify(plan.launch.args, null, 2))))
  assert.ok(html.includes(escaped(JSON.stringify(plan.launch, null, 2))))
  assert.ok(html.includes(escaped(JSON.stringify(plan, null, 2))))
  assert.match(html, /&quot;smoke&quot;/)
  assert.doesNotMatch(html, />HTTP</)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /default-src 'none'/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /form-action 'none'/)
  assert.match(html, /require-trusted-types-for 'script'/)
  assert.match(html, /meta name="referrer" content="no-referrer"/)
  assert.match(html, /navigator\.clipboard\.writeText/)
  assert.match(html, /aria-label="Copy server name"/)
  assert.match(html, /aria-label="Copy empty inline environment map"/)
  assert.match(html, /Must remain empty\. Forward named secret references/)
  assert.match(html, /aria-label="Copy structured smoke launch"/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.match(html, /<main id="main" class="shell" tabindex="-1">/)
  assert.match(html, /prefers-reduced-motion/)
  assert.equal((html.match(/data-step autocomplete="off"/g) || []).length, 5)
  assert.doesNotMatch(html, /<script\s+src=/)
  assert.doesNotMatch(html, /<link\b/)
  assert.doesNotMatch(html, /url\(https?:/)
  assert.doesNotMatch(html, /href="https?:/)
  assert.doesNotMatch(html, /\bfetch\s*\(/)
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|sendBeacon/)
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker/)

  const script = html.match(/<script>([\s\S]+)<\/script>/iu)?.[1]
  assert.ok(script)
  const expectedSource = `script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'`
  assert.ok(html.includes(expectedSource))
})

test("host activation HTML escapes launch fields", () => {
  const hostile = `</code><img src=x onerror="alert('activation')">&`
  const html = renderDiscordHostActivationHtml(activationPlan(hostile))

  assert.doesNotMatch(html, /<img src=x/)
  assert.ok(html.includes(escaped(hostile)))
})

test("host activation HTML export is deterministic, exclusive, private, and offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-host-activation-test-"))
  const first = join(directory, "first.html")
  const second = join(directory, "second.html")
  const existing = join(directory, "existing.html")
  const plan = activationPlan()
  const previousSecret = process.env[TOKEN_ALIAS]
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  try {
    process.env[TOKEN_ALIAS] = AMBIENT_SECRET
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error("Host activation HTML attempted network access")
    }) as typeof fetch

    const firstReport = await exportDiscordHostActivationHtml(first, plan)
    const secondReport = await exportDiscordHostActivationHtml(second, plan)
    const firstBytes = await readFile(first)
    const secondBytes = await readFile(second)

    assert.deepEqual(secondBytes, firstBytes)
    assert.equal(firstReport.file, resolve(first))
    assert.equal(firstReport.format, HOST_ACTIVATION_HTML_FORMAT)
    assert.equal(firstReport.schemaVersion, HOST_ACTIVATION_HTML_SCHEMA_VERSION)
    assert.equal(firstReport.activationDigest, plan.activationDigest)
    assert.equal(firstReport.bytes, firstBytes.byteLength)
    assert.equal(firstReport.htmlDigest, `sha256:${sha256(firstBytes)}`)
    assert.equal(secondReport.htmlDigest, firstReport.htmlDigest)
    assert.equal(firstReport.automaticNetwork, "disabled")
    assert.equal(firstReport.browserOpened, false)
    assert.equal(firstReport.credentialValuesEmbedded, false)
    assert.equal(firstReport.credentialValuesRead, false)
    assert.equal(firstReport.discordContacted, false)
    assert.deepEqual(firstReport.externalNavigationOrigins, [])
    assert.equal(Object.isFrozen(firstReport.externalNavigationOrigins), true)
    assert.equal(firstReport.hostConfigurationChanged, false)
    assert.equal(firstReport.hostDiscovered, false)
    assert.equal(firstReport.identifiersEmbedded, true)
    assert.equal(firstReport.localPathsEmbedded, true)
    assert.equal(firstReport.outputFileCreated, true)
    assert.equal(firstReport.processStarted, false)
    assert.equal(firstReport.runtimeCredentialsRequired, true)
    assert.equal(firstReport.statePersistence, "disabled")
    assert.equal(fetchCalls, 0)
    assert.equal((await stat(first)).mode & 0o777, 0o600)
    assert.doesNotMatch(firstBytes.toString("utf8"), new RegExp(AMBIENT_SECRET))

    await writeFile(existing, "operator-owned", "utf8")
    await assert.rejects(
      exportDiscordHostActivationHtml(existing, plan),
      (error: unknown) => (
        error instanceof ConfigurationError
        && /already exists/.test(error.message)
        && !error.message.includes(existing)
      ),
    )
    assert.equal(await readFile(existing, "utf8"), "operator-owned")
  } finally {
    globalThis.fetch = originalFetch
    if (previousSecret === undefined) delete process.env[TOKEN_ALIAS]
    else process.env[TOKEN_ALIAS] = previousSecret
    await rm(directory, { force: true, recursive: true })
  }
})

test("host activation HTML rejects invalid plans before opening output", async () => {
  const invalid = {
    ...activationPlan(),
    activationDigest: `sha256:${"0".repeat(64)}`,
  }
  let opens = 0

  await assert.rejects(
    exportDiscordHostActivationHtml("/virtual/activation.html", invalid, {
      fileSystem: {
        async open() {
          opens += 1
          throw new Error("must not open")
        },
        async unlink() {},
      },
    }),
    (error: unknown) => (
      error instanceof ConfigurationError
      && /requires an exact credential-free plan/.test(error.message)
    ),
  )
  assert.equal(opens, 0)
})

test("host activation HTML removes a partial file when an exclusive write fails", async () => {
  const file = "/virtual/activation.html"
  const events: string[] = []

  await assert.rejects(
    exportDiscordHostActivationHtml(file, activationPlan(), {
      fileSystem: {
        async open(received, flags, mode) {
          assert.equal(received, file)
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
        async unlink(received) {
          assert.equal(received, file)
          events.push("unlink")
        },
      },
    }),
    (error: unknown) => (
      error instanceof ConfigurationError
      && error.message === "Host activation HTML export could not be written"
    ),
  )
  assert.deepEqual(events, ["open", "write", "close", "unlink"])
})

test("host activation HTML rejects invalid output paths", async () => {
  for (const file of ["", "  ", "bad\0path"]) {
    await assert.rejects(
      exportDiscordHostActivationHtml(file, activationPlan()),
      /requires a valid file path/,
    )
  }
})
