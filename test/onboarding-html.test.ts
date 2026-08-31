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

import {
  createBotInstallPlan,
  type BotInstallPlan,
} from "../src/bot-install.js"
import { ConfigurationError } from "../src/errors.js"
import {
  ONBOARDING_HTML_FORMAT,
  ONBOARDING_HTML_SCHEMA_VERSION,
  exportDiscordOnboardingHtml,
  renderDiscordOnboardingHtml,
} from "../src/onboarding-html.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "300000000000000001"
const AMBIENT_SECRET = "onboarding-html-ambient-secret"

function installPlan(preset = "server-observer"): BotInstallPlan {
  return createBotInstallPlan({
    applicationId: APPLICATION_ID,
    guildId: GUILD_ID,
    preset,
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

test("onboarding HTML renders an exact client-neutral owner-managed setup", () => {
  const observer = installPlan()
  const html = renderDiscordOnboardingHtml(observer)
  const repeated = renderDiscordOnboardingHtml(observer)

  assert.equal(repeated, html)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, new RegExp(ONBOARDING_HTML_FORMAT))
  assert.match(html, /Owner-managed bot setup/)
  assert.match(html, /No privileged intent is required/)
  assert.match(html, /Leave privileged intent toggles off/)
  assert.match(html, /This first policy is read-only/)
  assert.match(html, /Cannot configure an MCP host/)
  assert.match(html, /Activate any compatible host/)
  assert.match(html, />Connect host<\/a>/)
  assert.doesNotMatch(html, /Verify and activate/)
  assert.match(html, /command, ordered arguments, external secret references/)
  assert.match(html, /must not be shared or committed/)
  assert.match(html, /stable exact-version package launch/)
  assert.match(html, /canonical process-owned private directory/)
  assert.match(html, /You can connect now/)
  assert.match(html, /Setup is the readiness gate/)
  assert.match(html, /Optional assurance and troubleshooting commands/)
  assert.ok(html.includes(escaped(observer.postInstall.firstRead.prompt)))
  assert.match(html, /First useful read/)
  assert.match(html, /Discord writes remain disabled/)
  assert.match(html, /No token/)
  assert.match(html, /No shared bot/iu)
  assert.match(html, new RegExp(APPLICATION_ID))
  assert.match(html, new RegExp(GUILD_ID))
  assert.match(html, new RegExp(observer.permissions.bitfield))
  assert.ok(html.includes(escaped(observer.installUrl)))
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /default-src 'none'/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /img-src 'none'/)
  assert.match(html, /require-trusted-types-for 'script'/)
  assert.match(html, /meta name="referrer" content="no-referrer"/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.match(html, /<main id="main" class="shell" tabindex="-1">/)
  assert.match(html, /prefers-reduced-motion/)
  assert.match(html, /@media\(max-width:520px\).*\.sticky\{position:static\}/)
  assert.match(html, />Supply secret<\/a>/)
  assert.equal(
    [...html.matchAll(/data-step autocomplete="off" aria-label="Mark step (\d) complete"/g)]
      .map((match) => match[1])
      .join(","),
    "1,2,3,4,5,6",
  )
  assert.match(html, /navigator\.clipboard\.writeText/)
  assert.doesNotMatch(html, /<script\s+src=/)
  assert.doesNotMatch(html, /<link\b/)
  assert.doesNotMatch(html, /url\(https?:/)
  assert.doesNotMatch(html, /\bfetch\s*\(/)
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket|EventSource|sendBeacon/)
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|document\.cookie|serviceWorker/)
  const verificationStart = html.indexOf('<summary>Optional assurance and troubleshooting commands</summary>')
  const verificationEnd = html.indexOf('</details>', verificationStart)
  assert.ok(verificationStart >= 0)
  assert.ok(verificationEnd > verificationStart)
  const verificationCommands = html.slice(verificationStart, verificationEnd)
  assert.doesNotMatch(verificationCommands, / setup /)
  assert.match(verificationCommands, / config validate /)
  assert.match(verificationCommands, / doctor /)
  assert.match(verificationCommands, / smoke /)
  assert.match(verificationCommands, /npx --yes guildctl@/)
  assert.match(html, / host /)
  assert.match(html, /--html \.\/guildcontrol-host-activation\.html/)

  const script = html.match(/<script>([\s\S]+)<\/script>/iu)?.[1]
  assert.ok(script)
  const expectedSource = `script-src 'sha256-${createHash("sha256").update(script).digest("base64")}'`
  assert.ok(html.includes(expectedSource))

  const externalUrls = [...html.matchAll(/href="(https:[^"]+)"/g)].map((match) => match[1])
  assert.equal(externalUrls.length, 2)
  for (const value of externalUrls) {
    const url = new URL(value?.replaceAll("&amp;", "&") || "")
    assert.equal(url.origin, "https://discord.com")
  }
})

test("onboarding HTML renders channel-reader requirements and escapes display data", () => {
  const reader = installPlan("channel-reader")
  const hostile = `</code><img src=x onerror="alert('guide')">&`
  const modified = {
    ...reader,
    preset: {
      ...reader.preset,
      description: hostile,
    },
  }

  const html = renderDiscordOnboardingHtml(modified)

  assert.match(html, /Enable Message Content on the Bot page/)
  assert.match(html, /MESSAGE_CONTENT/)
  assert.match(html, /Replace <code>CHANNEL_ID<\/code>/)
  assert.match(html, /READ_MESSAGE_HISTORY/)
  assert.doesNotMatch(html, /<img src=x/)
  assert.ok(html.includes(escaped(JSON.stringify(hostile))))
})

test("onboarding HTML export is deterministic, exclusive, private, and credential-free", async () => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-onboarding-html-test-"))
  const first = join(directory, "first.html")
  const second = join(directory, "second.html")
  const existing = join(directory, "existing.html")
  const plan = installPlan("channel-reader")
  const previousSecret = process.env.DISCORD_BOT_TOKEN
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  try {
    process.env.DISCORD_BOT_TOKEN = AMBIENT_SECRET
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error("Onboarding HTML attempted network access")
    }) as typeof fetch

    const firstReport = await exportDiscordOnboardingHtml(first, plan)
    const secondReport = await exportDiscordOnboardingHtml(second, plan)
    const firstBytes = await readFile(first)
    const secondBytes = await readFile(second)

    assert.deepEqual(secondBytes, firstBytes)
    assert.equal(firstReport.file, resolve(first))
    assert.equal(firstReport.format, ONBOARDING_HTML_FORMAT)
    assert.equal(firstReport.schemaVersion, ONBOARDING_HTML_SCHEMA_VERSION)
    assert.equal(firstReport.bytes, firstBytes.byteLength)
    assert.equal(firstReport.htmlDigest, `sha256:${sha256(firstBytes)}`)
    assert.equal(firstReport.planDigest, `sha256:${sha256(JSON.stringify(plan))}`)
    assert.equal(secondReport.htmlDigest, firstReport.htmlDigest)
    assert.equal(secondReport.planDigest, firstReport.planDigest)
    assert.equal(firstReport.activityRecordsCreated, false)
    assert.equal(firstReport.automaticNetwork, "disabled")
    assert.equal(firstReport.browserOpened, false)
    assert.equal(firstReport.clientSpecificConfiguration, false)
    assert.equal(firstReport.credentialsEmbedded, false)
    assert.equal(firstReport.credentialsRequired, false)
    assert.equal(firstReport.discordContacted, false)
    assert.deepEqual(firstReport.externalNavigationOrigins, ["https://discord.com"])
    assert.equal(Object.isFrozen(firstReport.externalNavigationOrigins), true)
    assert.equal(firstReport.statePersistence, "disabled")
    assert.equal(fetchCalls, 0)
    assert.equal((await stat(first)).mode & 0o777, 0o600)
    assert.doesNotMatch(firstBytes.toString("utf8"), new RegExp(AMBIENT_SECRET))
    assert.doesNotMatch(firstBytes.toString("utf8"), new RegExp(directory))

    await writeFile(existing, "operator-owned", "utf8")
    await assert.rejects(
      exportDiscordOnboardingHtml(existing, plan),
      (error: unknown) => (
        error instanceof ConfigurationError
        && /already exists/.test(error.message)
        && !error.message.includes(existing)
      ),
    )
    assert.equal(await readFile(existing, "utf8"), "operator-owned")
  } finally {
    globalThis.fetch = originalFetch
    if (previousSecret === undefined) delete process.env.DISCORD_BOT_TOKEN
    else process.env.DISCORD_BOT_TOKEN = previousSecret
    await rm(directory, { force: true, recursive: true })
  }
})

test("onboarding HTML export requires the exact installation plan", async () => {
  const plan = installPlan()
  const modified = {
    ...plan,
    installUrl: "https://example.com/not-discord",
  }
  let opens = 0

  await assert.rejects(
    exportDiscordOnboardingHtml("/virtual/guide.html", modified, {
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
      && /requires an exact bot installation plan/.test(error.message)
    ),
  )
  assert.equal(opens, 0)
})

test("onboarding HTML export removes a partial file when an exclusive write fails", async () => {
  const file = "/virtual/onboarding.html"
  const events: string[] = []

  await assert.rejects(
    exportDiscordOnboardingHtml(file, installPlan(), {
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
      && error.message === "Onboarding HTML export could not be written"
    ),
  )
  assert.deepEqual(events, ["open", "write", "close", "unlink"])
})

test("onboarding HTML export rejects invalid paths before plan validation", async () => {
  const invalidPlan = {
    ...installPlan(),
    installUrl: "https://example.com/not-discord",
  }
  for (const file of ["", "  ", "bad\0path"]) {
    await assert.rejects(
      exportDiscordOnboardingHtml(file, invalidPlan),
      /requires a valid file path/,
    )
  }
})
