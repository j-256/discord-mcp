import assert from "node:assert/strict"
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { isMainModule } from "../src/entrypoint.js"

test("main-module detection resolves filesystem aliases", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "discord-mcp-entrypoint-"))
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
  assert.equal(isMainModule(metaUrl, undefined), false)
})
