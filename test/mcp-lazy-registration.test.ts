import assert from "node:assert/strict"
import test from "node:test"

import { MCP_TOOLSET_NAMES } from "../src/constants.js"
import { lazyZodSchemaStatistics } from "../src/lazy-z.js"
import { createDiscordMcpServer } from "../src/mcp.js"
import { getSetupPreset } from "../src/setup-presets.js"
import { loadFixtureConfig } from "./config-fixture.js"

const TOKEN = "mcp-lazy-registration-test-token"

test("MCP materializes canonical schemas only for selected toolsets", async () => {
  const imported = lazyZodSchemaStatistics()
  assert.ok(imported.created > 0)
  assert.ok(imported.pending > 0)

  const preset = getSetupPreset("server-observer")
  const minimal = createDiscordMcpServer({
    config: loadFixtureConfig({
      token: TOKEN,
      tools: { toolsets: preset.toolsets },
    }),
  })
  const selected = lazyZodSchemaStatistics()
  assert.ok(selected.created >= imported.created)
  assert.ok(selected.materialized > imported.materialized)
  assert.ok(selected.pending > 0)
  await minimal.close()

  const complete = createDiscordMcpServer({
    config: loadFixtureConfig({
      token: TOKEN,
      tools: { toolsets: MCP_TOOLSET_NAMES },
    }),
  })
  const all = lazyZodSchemaStatistics()
  assert.ok(all.created >= selected.created)
  assert.ok(all.materialized > selected.materialized)
  assert.ok(all.pending < selected.pending)
  await complete.close()
})
