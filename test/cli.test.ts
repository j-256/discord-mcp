import assert from "node:assert/strict"
import test from "node:test"

import {
  parseCliArguments,
  runCli,
  type CliDependencies,
} from "../src/cli.js"
import type {
  DoctorReport,
  SetupReport,
  SmokeReport,
} from "../src/operator.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"

function outputStream() {
  let output = ""
  return {
    stream: {
      write(value: string | Uint8Array) {
        output += String(value)
        return true
      },
    },
    value() {
      return output
    },
  }
}

function doctorReport(status: DoctorReport["status"] = "ok"): DoctorReport {
  return {
    checks: [{
      id: "configuration",
      status: status === "error" ? "fail" : "pass",
      summary: status === "error" ? `Rejected ${TOKEN}` : "Configuration is valid",
    }],
    identity: null,
    online: false,
    schemaVersion: 1,
    status,
  }
}

function setupReport(): SetupReport {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    client: "host",
    hostConfig: `secret = "${TOKEN}"`,
    guildsAccessibleOnFirstPage: 1,
    guildsInScopeOnFirstPage: 1,
    schemaVersion: 1,
    serverName: "discord",
    status: "ok",
    toolsets: ["connector", "messages"],
    toolSurface: "full",
    warnings: [],
  }
}

function smokeReport(): SmokeReport {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    destructiveTools: ["delete_messages"],
    guildsAccessibleOnFirstPage: 1,
    guildsInScopeOnFirstPage: 1,
    promptNames: ["summarize_channel"],
    readOnlyTools: ["get_connector_status"],
    resourceTemplateUris: ["discord://channels/{channelId}/access"],
    resourceUris: ["discord://connector/safety"],
    schemaVersion: 1,
    status: "ok",
    toolCount: 12,
    toolsets: ["connector", "messages"],
    toolSurface: "full",
  }
}

function dependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  return {
    async diagnose() {
      return doctorReport()
    },
    async prepareSetup() {
      return setupReport()
    },
    serve() {},
    async smoke() {
      return smokeReport()
    },
    ...overrides,
  }
}

test("CLI parser defaults to serve and strictly parses operator commands", () => {
  assert.deepEqual(parseCliArguments([]), { command: "serve" })
  assert.deepEqual(parseCliArguments(["doctor", "--online", "--json"]), {
    command: "doctor",
    json: true,
    online: true,
  })
  assert.deepEqual(parseCliArguments([
    "setup",
    "--client",
    "host",
    "--name",
    "team-discord",
    "--command",
    "/usr/local/bin/discord-mcp",
  ]), {
    client: "host",
    command: "setup",
    json: false,
    launcherCommand: "/usr/local/bin/discord-mcp",
    serverName: "team-discord",
  })
  assert.deepEqual(parseCliArguments(["smoke", "--help"]), {
    command: "help",
    topic: "smoke",
  })
  assert.throws(() => parseCliArguments(["unknown"]), /Unknown command/)
  assert.throws(() => parseCliArguments(["doctor", "--online", "--online"]), /only once/)
  assert.throws(() => parseCliArguments(["setup", "--client", "other"]), /Only the host/)
  assert.throws(() => parseCliArguments(["setup", "--name"]), /requires a value/)
  assert.throws(() => parseCliArguments(["smoke", "--other"]), /Unknown option/)
})

test("CLI defaults to the stdio server without writing normal output", async () => {
  let serves = 0
  const stdout = outputStream()
  const stderr = outputStream()
  const exitCode = await runCli({
    args: [],
    dependencies: dependencies({
      serve() {
        serves += 1
      },
    }),
    environment: { DISCORD_BOT_TOKEN: `  ${TOKEN}  ` },
    stderr: stderr.stream,
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(serves, 1)
  assert.equal(stdout.value(), "")
  assert.equal(stderr.value(), "")
})

test("CLI returns diagnostic failure while preserving secret-free JSON", async () => {
  const stdout = outputStream()
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["doctor", "--json"],
    dependencies: dependencies({
      async diagnose() {
        return doctorReport("error")
      },
    }),
    environment: { DISCORD_BOT_TOKEN: `  ${TOKEN}  ` },
    stderr: stderr.stream,
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 1)
  assert.match(stdout.value(), /\[redacted\]/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  assert.equal(stderr.value(), "")
})

test("CLI redacts setup output and forwards setup options", async () => {
  const stdout = outputStream()
  let received: unknown
  const exitCode = await runCli({
    args: ["setup", "--json", "--name", "team-discord", "--command", "/bin/discord-mcp"],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return setupReport()
      },
    }),
    environment: { DISCORD_BOT_TOKEN: `  ${TOKEN}  ` },
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["serve"],
    command: "/bin/discord-mcp",
    environment: { DISCORD_BOT_TOKEN: `  ${TOKEN}  ` },
    serverName: "team-discord",
  })
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  assert.match(stdout.value(), /\[redacted\]/)
})

test("CLI setup pins the running Node.js executable and built entrypoint by default", async () => {
  let received: unknown
  const exitCode = await runCli({
    args: ["setup"],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return setupReport()
      },
    }),
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    executablePath: "/usr/bin/node",
    stdout: outputStream().stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    environment: { DISCORD_BOT_TOKEN: TOKEN },
  })
})

test("CLI renders smoke, help, and version output", async () => {
  const smokeOutput = outputStream()
  const helpOutput = outputStream()
  const versionOutput = outputStream()

  assert.equal(await runCli({
    args: ["smoke"],
    dependencies: dependencies(),
    stdout: smokeOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["help", "doctor"],
    dependencies: dependencies(),
    stdout: helpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["--version"],
    dependencies: dependencies(),
    stdout: versionOutput.stream,
  }), 0)

  assert.match(smokeOutput.value(), /Discord MCP smoke: ok/)
  assert.match(smokeOutput.value(), /Resources: discord:\/\/connector\/safety/)
  assert.match(smokeOutput.value(), /Prompts: summarize_channel/)
  assert.match(helpOutput.value(), /doctor \[--online\]/)
  assert.match(versionOutput.value(), /0\.1\.0/)
})

test("CLI converts thrown failures into redacted diagnostics", async () => {
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["smoke"],
    dependencies: dependencies({
      async smoke() {
        throw new Error(`Transport exposed ${TOKEN}`)
      },
    }),
    environment: { DISCORD_BOT_TOKEN: `  ${TOKEN}  ` },
    stderr: stderr.stream,
  })

  assert.equal(exitCode, 1)
  assert.match(stderr.value(), /\[redacted\]/)
  assert.doesNotMatch(stderr.value(), new RegExp(TOKEN))
})
