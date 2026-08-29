import assert from "node:assert/strict"
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
  inspectDiscordCatalog,
  type DiscordCatalogSnapshot,
} from "../src/catalog.js"
import {
  CATALOG_HTML_FORMAT,
  exportDiscordCatalogHtml,
  renderDiscordCatalogHtml,
} from "../src/catalog-html.js"
import { ConfigurationError } from "../src/errors.js"

const AMBIENT_SECRET = "catalog-html-ambient-secret"

function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

test("catalog HTML renders the exact negotiated contract as one offline explorer", async () => {
  const snapshot = await inspectDiscordCatalog()
  const html = renderDiscordCatalogHtml(snapshot)
  const repeated = renderDiscordCatalogHtml(snapshot)

  assert.equal(repeated, html)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, new RegExp(`<b>${CATALOG_HTML_FORMAT}</b>`))
  assert.match(html, new RegExp(snapshot.report.contractDigest))
  assert.match(html, new RegExp(snapshot.report.toolAccessResourceDigest))
  assert.match(html, new RegExp(snapshot.report.safetyResourceDigest))
  assert.match(html, new RegExp(snapshot.report.planReviewApp.htmlDigest))
  assert.match(html, new RegExp(snapshot.report.planReviewApp.resourceDigest))
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /default-src 'none'/)
  assert.match(html, /img-src 'none'/)
  assert.match(html, /id="tool-search"/)
  assert.match(html, /id="tour"/)
  assert.match(html, /Guided product tour/)
  assert.match(html, /role="tablist" aria-label="Guided product tour steps"/)
  assert.match(html, /role="tab" aria-label="Step 1: Inspect"/)
  assert.match(html, /role="tabpanel"/)
  assert.match(html, /This is negotiated contract evidence, not a recording or simulated Discord response/)
  assert.match(html, /href="#prompt-route_discord_goal"/)
  assert.match(html, /href="#tool-list_channels"/)
  assert.match(html, /href="#tool-plan_channel_creation"/)
  assert.match(html, /href="#tool-execute_channel_creation"/)
  assert.match(html, /href="#tool-list_activity"/)
  assert.match(html, /setup --npx --config \.\/discord-mcp\.json --preset server-observer/)
  assert.match(html, /coordination list --config \.\/discord-mcp\.json/)
  assert.match(html, /id="toolset-filter"/)
  assert.match(html, /id="risk-filter"/)
  assert.match(html, /id="access-filter"/)
  assert.match(html, /id="workflow-filter"/)
  assert.match(html, /id="completions"/)
  assert.match(html, /id="app"/)
  assert.match(html, /Plan-review MCP App/)
  assert.match(html, /No app-callable server tools/)
  assert.match(html, /Plan review app/)
  assert.ok(html.includes(escaped(snapshot.report.planReviewApp.resourceUri)))
  assert.ok(html.includes(escaped("<!doctype html>")))
  assert.match(html, /Policy completion routes/)
  assert.match(html, /zero returned identifiers/)
  assert.match(html, /role="status" aria-live="polite"/)
  assert.match(html, /<pre tabindex="0">/)
  assert.match(html, /prefers-reduced-motion/)
  assert.match(html, /No tools match these filters/)
  assert.match(html, /Static setup metadata never claims target readiness/)
  assert.match(html, /Every static setup requirement classified/)
  assert.match(html, /Static setup requirements/)
  assert.match(html, /Policy paths are exact for an exact-tool source/)
  assert.match(html, /MESSAGE_CONTENT \(required\)/)
  assert.match(html, /short-lived-interaction-token/)
  assert.match(html, /bot-and-stored-webhook-token/)
  assert.match(html, /data-access="review-execute"/)
  assert.match(html, /Access lifecycle/)
  assert.match(html, /fresh-plan-recheck/)
  assert.doesNotMatch(html, /<script\s+src=/)
  assert.doesNotMatch(html, /<link\b/)
  assert.doesNotMatch(html, /url\(https?:/)
  assert.doesNotMatch(html, /\bfetch\s*\(/)
  assert.doesNotMatch(html, /XMLHttpRequest|WebSocket/)

  for (const tool of snapshot.tools) {
    assert.match(html, new RegExp(`id="tool-${tool.name}"`))
    assert.match(html, new RegExp(`<code>${tool.name}</code>`))
  }
  for (const prompt of snapshot.prompts) {
    assert.match(html, new RegExp(`id="prompt-${prompt.name}"`))
    assert.match(html, new RegExp(`<code>${prompt.name}</code>`))
  }
  for (const resource of snapshot.resources) {
    assert.ok(html.includes(escaped(resource.uri)), resource.uri)
  }
  for (const template of snapshot.resourceTemplates) {
    assert.ok(html.includes(escaped(template.uriTemplate)), template.uriTemplate)
  }
  for (const completion of snapshot.report.completionBindings) {
    assert.ok(html.includes(escaped(completion.reference)), completion.reference)
    assert.ok(html.includes(escaped(completion.argument)), completion.argument)
    for (const field of completion.policyFields) {
      assert.ok(html.includes(escaped(field)), field)
    }
  }
})

test("catalog HTML guided tour fails closed when required negotiated evidence is absent", async () => {
  const snapshot = await inspectDiscordCatalog()
  assert.throws(
    () => renderDiscordCatalogHtml({
      ...snapshot,
      tools: snapshot.tools.filter(({ name }) => name !== "list_channels"),
    }),
    /guided tour tool list_channels is unavailable/u,
  )
  assert.throws(
    () => renderDiscordCatalogHtml({
      ...snapshot,
      prompts: snapshot.prompts.filter(({ name }) => name !== "route_discord_goal"),
    }),
    /guided tour prompt route_discord_goal is unavailable/u,
  )
})

test("catalog HTML escapes negotiated text and schema values before embedding them", async () => {
  const snapshot = await inspectDiscordCatalog()
  const hostile = `</script><img src=x onerror="alert('catalog')">&`
  const first = snapshot.tools[0]
  assert.ok(first)
  const modified: DiscordCatalogSnapshot = {
    ...snapshot,
    tools: [{
      ...first,
      description: hostile,
      inputSchema: {
        ...first.inputSchema,
        description: hostile,
      },
      title: hostile,
    }, ...snapshot.tools.slice(1)],
  }

  const html = renderDiscordCatalogHtml(modified)

  assert.doesNotMatch(html, /<img src=x/)
  assert.doesNotMatch(html, /<\/script><img/)
  assert.ok(html.includes(escaped(hostile)))
  assert.ok(html.includes(escaped(JSON.stringify(hostile))))
})

test("catalog HTML export is deterministic, exclusive, private, and credential-free", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-catalog-html-test-"))
  const first = join(directory, "first.html")
  const second = join(directory, "second.html")
  const existing = join(directory, "existing.html")
  const previousSecret = process.env.DISCORD_BOT_TOKEN
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  try {
    process.env.DISCORD_BOT_TOKEN = AMBIENT_SECRET
    globalThis.fetch = (async () => {
      fetchCalls += 1
      throw new Error("Catalog HTML attempted network access")
    }) as typeof fetch

    const firstReport = await exportDiscordCatalogHtml(first)
    const secondReport = await exportDiscordCatalogHtml(second)
    const firstBytes = await readFile(first)
    const secondBytes = await readFile(second)

    assert.deepEqual(secondBytes, firstBytes)
    assert.equal(firstReport.contractDigest, secondReport.contractDigest)
    assert.equal(firstReport.bytes, firstBytes.byteLength)
    assert.equal(firstReport.file, resolve(first))
    assert.equal(firstReport.format, CATALOG_HTML_FORMAT)
    assert.equal(firstReport.credentialsRequired, false)
    assert.equal(firstReport.discordExecution, "disabled")
    assert.equal(firstReport.activityRecordsCreated, false)
    assert.equal(fetchCalls, 0)
    assert.equal((await stat(first)).mode & 0o777, 0o600)
    assert.doesNotMatch(firstBytes.toString("utf8"), new RegExp(AMBIENT_SECRET))
    assert.doesNotMatch(firstBytes.toString("utf8"), new RegExp(directory))

    await writeFile(existing, "operator-owned", "utf8")
    await assert.rejects(
      exportDiscordCatalogHtml(existing),
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

test("catalog HTML export removes a partial file when its exclusive write fails", async () => {
  const snapshot = await inspectDiscordCatalog()
  const file = "/virtual/catalog.html"
  const events: string[] = []

  await assert.rejects(
    exportDiscordCatalogHtml(file, {
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
      async inspect() {
        return snapshot
      },
    }),
    (error: unknown) => (
      error instanceof ConfigurationError
      && error.message === "Catalog HTML export could not be written"
    ),
  )
  assert.deepEqual(events, ["open", "write", "close", "unlink"])
})

test("catalog HTML export rejects invalid paths before catalog inspection", async () => {
  let inspections = 0
  for (const file of ["", "  ", "bad\0path"]) {
    await assert.rejects(
      exportDiscordCatalogHtml(file, {
        async inspect() {
          inspections += 1
          return inspectDiscordCatalog()
        },
      }),
      /requires a valid file path/,
    )
  }
  assert.equal(inspections, 0)
})
