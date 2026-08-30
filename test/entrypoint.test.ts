import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { isMainModule } from "../src/entrypoint.js"

test("main-module detection resolves filesystem aliases", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-entrypoint-"))
  context.after(() => rm(directory, { force: true, recursive: true }))
  const canonicalPath = join(directory, "entrypoint.mjs")
  const aliasPath = join(directory, "entrypoint-alias.mjs")
  const otherPath = join(directory, "other.mjs")
  await Promise.all([
    writeFile(canonicalPath, ""),
    writeFile(otherPath, ""),
  ])
  await symlink(canonicalPath, aliasPath)

  const metaUrl = pathToFileURL(await realpath(canonicalPath)).href

  assert.equal(isMainModule(metaUrl, aliasPath), true)
  assert.equal(isMainModule(metaUrl, otherPath), false)
  assert.equal(isMainModule(metaUrl, join(directory, "missing.mjs")), false)
  assert.equal(isMainModule(metaUrl, undefined), false)
})

test("library entrypoint direct execution fails with exact CLI guidance", async (context) => {
  const privateToken = "private-entrypoint-diagnostic-token"
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    resolve("src/index.ts"),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DISCORD_BOT_TOKEN: privateToken,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  context.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM")
  })
  let stderr = ""
  let stdout = ""
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk)
  })
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk)
  })
  const [exitCode] = await once(child, "close")

  assert.equal(exitCode, 1)
  assert.equal(stdout, "")
  assert.equal(
    stderr,
    "[guildcontrol] The package library entrypoint does not run an MCP server. Use `guildcontrol serve --config FILE` or `node dist/bin.js serve --config FILE`.\n",
  )
  assert.doesNotMatch(stderr, new RegExp(privateToken))
})
