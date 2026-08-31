import assert from "node:assert/strict"
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  ONBOARD_HTML_FORMAT,
  exportOnboardHtml,
  renderOnboardHtml,
} from "../src/onboard-html.js"
import { createOnboardReport } from "../src/onboard.js"
import {
  ONBOARD_TOKEN,
  onboardFixture,
} from "./onboard-fixture.js"

function report(hostId: "claude-desktop" | "codex" = "codex") {
  return createOnboardReport({
    ...onboardFixture(),
    hostId,
  })
}

test("onboarding HTML is host-specific, interactive, offline, and credential-free", () => {
  const html = renderOnboardHtml(report("codex"))
  assert.match(html, /GuildControl is ready for Codex/)
  assert.match(html, /\[mcp_servers\.discord\]/)
  assert.match(html, /data-check/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /First read-only request/)
  assert.doesNotMatch(html, new RegExp(ONBOARD_TOKEN))
  assert.doesNotMatch(html, /https:\/\/fonts\./)
})

test("onboarding HTML renders the Claude Desktop MCPB handoff", () => {
  const html = renderOnboardHtml(report("claude-desktop"))
  assert.match(html, /GuildControl is ready for Claude Desktop/)
  assert.match(html, /Download guildcontrol-[0-9]+\.[0-9]+\.[0-9]+\.mcpb/)
  assert.match(html, /protected sensitive-input prompt/)
  assert.doesNotMatch(html, /\[mcp_servers\.discord\]/)
})

test("onboarding HTML export is exclusive, owner-private, and deterministic", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-onboard-html-test-"))
  context.after(async () => {
    await rm(directory, { force: true, recursive: true })
  })
  const first = join(directory, "first.html")
  const second = join(directory, "second.html")
  const value = report()
  const firstExport = await exportOnboardHtml(first, value)
  const secondExport = await exportOnboardHtml(second, value)
  const firstBytes = await readFile(first)
  const secondBytes = await readFile(second)
  assert.equal(firstExport.format, ONBOARD_HTML_FORMAT)
  assert.equal(firstExport.htmlDigest, secondExport.htmlDigest)
  assert.deepEqual(firstBytes, secondBytes)
  assert.equal(firstExport.credentialsEmbedded, false)
  assert.equal(firstExport.hostConfigurationChanged, false)
  assert.equal((await lstat(first)).mode & 0o777, 0o600)
  await assert.rejects(
    exportOnboardHtml(first, value),
    /already exists/,
  )
})

test("onboarding HTML rejects modified evidence and preserves an existing target", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-onboard-html-invalid-"))
  context.after(async () => {
    await rm(directory, { force: true, recursive: true })
  })
  const target = join(directory, "existing.html")
  await writeFile(target, "owner data", { mode: 0o600 })
  const valid = report()
  const invalid = {
    ...valid,
    onboardDigest: `sha256:${"0".repeat(64)}`,
  }
  assert.throws(
    () => renderOnboardHtml(invalid),
    /exact digest-bound/,
  )
  await assert.rejects(
    exportOnboardHtml(target, valid),
    /already exists/,
  )
  assert.equal(await readFile(target, "utf8"), "owner data")
})
