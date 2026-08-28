import assert from "node:assert/strict"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  createConnectorConfigDocument,
  type ConnectorConfigDocument,
} from "../src/config-document.js"
import {
  MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE,
  prepareMcpbEnvironment,
  runMcpbServer,
} from "../src/mcpb-entry.js"
import type { DiscordMcpRunOptions } from "../src/mcp.js"

const APPLICATION_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const CHANNEL_ID = "200000000000000001"
const GUILD_ID = "100000000000000001"
const TOKEN = "mcpb-test-discord-token"
const TOKEN_VARIABLE = "DISCORD_MCPB_TEST_TOKEN"

function document(
  options: { credentialFile?: string } = {},
): ConnectorConfigDocument {
  return createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    ...(options.credentialFile
      ? { credentialFile: options.credentialFile }
      : { credentialVariable: TOKEN_VARIABLE }),
    guildIds: [GUILD_ID],
    name: "mcpb-test",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
}

async function writeConfig(
  context: test.TestContext,
  value: ConnectorConfigDocument,
): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "discord-mcp-mcpb-entry-")))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "discord-mcp.json")
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  return file
}

test("MCPB environment maps only its sensitive input to the declared credential", async (context) => {
  const file = await writeConfig(context, document())
  const original = {
    [MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE]: TOKEN,
    [TOKEN_VARIABLE]: "ambient-token-must-not-win",
    SAFE_VALUE: "preserved",
  }
  const preparation = prepareMcpbEnvironment(
    ["serve", "--config", file],
    original,
  )

  assert.equal(preparation.configFile, file)
  assert.equal(preparation.credentialVariable, TOKEN_VARIABLE)
  assert.deepEqual(preparation.environment, {
    [TOKEN_VARIABLE]: TOKEN,
    SAFE_VALUE: "preserved",
  })
  assert.equal(original[MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE], TOKEN)
  assert.equal(original[TOKEN_VARIABLE], "ambient-token-must-not-win")
})

test("MCPB launcher passes the isolated environment to the normal server", async (context) => {
  const file = await writeConfig(context, document())
  let received: DiscordMcpRunOptions | undefined
  const exitCode = await runMcpbServer({
    args: ["serve", "--config", file],
    environment: { [MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE]: TOKEN },
    serve: (options) => {
      received = options
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(received?.environment?.[TOKEN_VARIABLE], TOKEN)
  assert.equal(received?.environment?.[MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE], undefined)
})

test("MCPB launcher rejects missing token, alternate commands, and file credentials safely", async (context) => {
  const environmentFile = await writeConfig(context, document())
  const credentialFile = join(environmentFile, "..", "token")
  const fileConfig = await writeConfig(context, document({ credentialFile }))

  for (const probe of [
    { args: ["serve", "--config", environmentFile], environment: {} },
    {
      args: ["catalog"],
      environment: { [MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE]: TOKEN },
    },
    {
      args: ["serve", "--config", fileConfig],
      environment: { [MCPB_TOKEN_INPUT_ENVIRONMENT_VARIABLE]: TOKEN },
    },
  ]) {
    let stderr = ""
    let invoked = false
    const exitCode = await runMcpbServer({
      ...probe,
      serve: () => {
        invoked = true
      },
      stderr: { write: (value) => { stderr += value; return true } },
    })
    assert.equal(exitCode, 2)
    assert.equal(invoked, false)
    assert.match(stderr, /^\[discord-mcp\] /)
    assert.equal(stderr.includes(TOKEN), false)
  }
})
