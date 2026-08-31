import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  MCPB_ARCHIVE_ENTRIES,
  mcpbArchiveName,
  validateMcpbManifest,
} from "../scripts/mcpb-artifact.mjs"

const packageJson = JSON.parse(await readFile("package.json", "utf8"))
const manifest = JSON.parse(await readFile("mcpb/manifest.json", "utf8"))

test("MCPB manifest is pinned, model-neutral, and exact", async () => {
  await validateMcpbManifest(manifest, packageJson)
  assert.equal(mcpbArchiveName(packageJson.version), `guildcontrol-${packageJson.version}.mcpb`)
})

test("MCPB archive allowlist is canonical and content-bearing", () => {
  assert.deepEqual(MCPB_ARCHIVE_ENTRIES, [...MCPB_ARCHIVE_ENTRIES].sort())
  assert.ok(MCPB_ARCHIVE_ENTRIES.includes("server/sbom.spdx.json"))
  assert.ok(MCPB_ARCHIVE_ENTRIES.includes("server/THIRD_PARTY_NOTICES.md"))
  assert.ok(MCPB_ARCHIVE_ENTRIES.includes("server/catalog-evidence.json"))
  assert.ok(MCPB_ARCHIVE_ENTRIES.includes("docs/reference.md"))
  assert.ok(MCPB_ARCHIVE_ENTRIES.includes("docs/safety-usability.md"))
  assert.ok(MCPB_ARCHIVE_ENTRIES.includes("README.md"))
  assert.equal(MCPB_ARCHIVE_ENTRIES.some((name) => name.endsWith("/")), false)
})
