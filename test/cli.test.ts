import assert from "node:assert/strict"
import test from "node:test"

import {
  parseCliArguments,
  runCli,
  type CliDependencies,
} from "../src/cli.js"
import type { DiscordCatalogCheckReport } from "../src/catalog.js"
import {
  OPERATOR_REPORT_SCHEMA_VERSION,
  type DoctorReport,
  type SetupReport,
  type SmokeReport,
} from "../src/operator.js"
import {
  createConnectorProfile,
  type ConnectorProfile,
} from "../src/profile.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"

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
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status,
  }
}

function setupReport(): SetupReport {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    guildsAccessibleOnFirstPage: 1,
    guildsInScopeOnFirstPage: 1,
    launch: {
      args: ["serve"],
      command: "discord-mcp",
      environment: {
        forward: ["DISCORD_BOT_TOKEN"],
        set: {
          DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
          DISCORD_MCP_BOT_ID: BOT_ID,
        },
      },
      requirements: {
        elicitation: "required-for-reviewed-writes",
        requiredServer: true,
        toolApproval: "writes",
      },
      serverName: "discord",
      timeouts: {
        startupSeconds: 30,
        toolSeconds: 180,
      },
      transport: "stdio",
    },
    profile: null,
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
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
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status: "ok",
    toolCount: 12,
    toolsets: ["connector", "messages"],
    toolSurface: "full",
  }
}

function catalogReport(): DiscordCatalogCheckReport {
  return {
    activityRecordsCreated: false,
    credentialsRequired: false,
    discordExecution: "disabled",
    executionGuard: "CATALOG_ONLY",
    gateway: "disabled",
    observabilityExport: "disabled",
    promptCount: 8,
    resourceCount: 7,
    resourceTemplateCount: 5,
    schemaVersion: 1,
    serverName: "discord-mcp",
    serverVersion: "0.1.0",
    status: "ok",
    toolCount: 35,
  }
}

function connectorProfile(): ConnectorProfile {
  return createConnectorProfile({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "support-bot",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
}

function dependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  const profile = connectorProfile()
  return {
    async activateProfile(_name, options) {
      return {
        environment: {
          ...options.environment,
          DISCORD_BOT_TOKEN: TOKEN,
        },
        profile,
      }
    },
    catalog() {},
    async checkCatalog() {
      return catalogReport()
    },
    async diagnose() {
      return doctorReport()
    },
    async listProfiles() {
      return [profile]
    },
    async loadProfile() {
      return profile
    },
    async prepareSetup() {
      return setupReport()
    },
    async restoreProfile(name) {
      return { name, trashId: "0000000000000-restored" }
    },
    serve() {},
    async smoke() {
      return smokeReport()
    },
    async trashProfile(name) {
      return { name, trashId: "0000000000000-removed" }
    },
    ...overrides,
  }
}

test("CLI parser defaults to serve and strictly parses operator commands", () => {
  assert.deepEqual(parseCliArguments([]), { command: "serve" })
  assert.deepEqual(parseCliArguments(["catalog"]), {
    check: false,
    command: "catalog",
    json: false,
  })
  assert.deepEqual(parseCliArguments(["catalog", "--check", "--json"]), {
    check: true,
    command: "catalog",
    json: true,
  })
  assert.deepEqual(parseCliArguments(["doctor", "--online", "--json"]), {
    command: "doctor",
    json: true,
    online: true,
  })
  assert.deepEqual(parseCliArguments(["doctor", "--profile", "support-bot"]), {
    command: "doctor",
    json: false,
    online: false,
    profileName: "support-bot",
  })
  assert.deepEqual(parseCliArguments(["serve", "--profile", "support-bot"]), {
    command: "serve",
    profileName: "support-bot",
  })
  assert.deepEqual(parseCliArguments([
    "setup",
    "--name",
    "team-discord",
    "--command",
    "/usr/local/bin/discord-mcp",
  ]), {
    command: "setup",
    json: false,
    launcherCommand: "/usr/local/bin/discord-mcp",
    overwriteProfile: false,
    serverName: "team-discord",
  })
  assert.deepEqual(parseCliArguments([
    "setup",
    "--profile",
    "support-bot",
    "--token-env",
    TOKEN_ALIAS,
    "--force",
    "--json",
  ]), {
    command: "setup",
    credentialVariable: TOKEN_ALIAS,
    json: true,
    launcherCommand: undefined,
    overwriteProfile: true,
    profileName: "support-bot",
    serverName: undefined,
  })
  assert.deepEqual(parseCliArguments(["profile", "list", "--json"]), {
    action: "list",
    command: "profile",
    json: true,
  })
  assert.deepEqual(parseCliArguments(["profile", "show", "support-bot"]), {
    action: "show",
    command: "profile",
    json: false,
    name: "support-bot",
  })
  assert.deepEqual(parseCliArguments([
    "profile",
    "remove",
    "support-bot",
    "--confirm",
    "support-bot",
  ]), {
    action: "remove",
    command: "profile",
    confirmation: "support-bot",
    json: false,
    name: "support-bot",
  })
  assert.deepEqual(parseCliArguments(["smoke", "--help"]), {
    command: "help",
    topic: "smoke",
  })
  assert.throws(() => parseCliArguments(["unknown"]), /Unknown command/)
  assert.throws(() => parseCliArguments(["doctor", "--online", "--online"]), /only once/)
  assert.throws(
    () => parseCliArguments(["setup", "--client", "legacy"]),
    /Unknown option --client/,
  )
  assert.throws(() => parseCliArguments(["setup", "--name"]), /requires a value/)
  assert.throws(
    () => parseCliArguments(["setup", "--token-env", TOKEN_ALIAS]),
    /require --profile/,
  )
  assert.throws(
    () => parseCliArguments(["profile", "remove", "support-bot"]),
    /requires --confirm/,
  )
  assert.throws(
    () => parseCliArguments(["serve", "--profile"]),
    /requires a value/,
  )
  assert.throws(() => parseCliArguments(["smoke", "--other"]), /Unknown option/)
  assert.throws(() => parseCliArguments(["catalog", "--json"]), /requires --check/)
  assert.throws(() => parseCliArguments(["catalog", "--check", "--check"]), /only once/)
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

test("CLI starts the credential-free catalog without normal output or configuration", async () => {
  let catalogs = 0
  const stdout = outputStream()
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["catalog"],
    dependencies: dependencies({
      catalog() {
        catalogs += 1
      },
    }),
    environment: {},
    stderr: stderr.stream,
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.equal(catalogs, 1)
  assert.equal(stdout.value(), "")
  assert.equal(stderr.value(), "")
})

test("CLI renders credential-free catalog checks as exact text and JSON", async () => {
  const textOutput = outputStream()
  const jsonOutput = outputStream()

  assert.equal(await runCli({
    args: ["catalog", "--check"],
    dependencies: dependencies(),
    environment: {},
    stdout: textOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["catalog", "--check", "--json"],
    dependencies: dependencies(),
    environment: {},
    stdout: jsonOutput.stream,
  }), 0)

  assert.match(textOutput.value(), /Discord MCP catalog: ok/)
  assert.match(textOutput.value(), /Execution guard: CATALOG_ONLY/)
  assert.match(textOutput.value(), /Credentials required: no/)
  assert.deepEqual(JSON.parse(jsonOutput.value()), catalogReport())
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
        return {
          ...setupReport(),
          warnings: [`Rejected ${TOKEN}`],
        }
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
    overwriteProfile: false,
    serverName: "team-discord",
  })
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  assert.match(stdout.value(), /\[redacted\]/)
})

test("CLI setup pins the running Node.js executable and built entrypoint by default", async () => {
  let received: unknown
  const stdout = outputStream()
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
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    overwriteProfile: false,
  })
  assert.match(stdout.value(), /Portable stdio launch descriptor/)
  assert.match(stdout.value(), /required-server, write-approval, elicitation, and timeout settings/)
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
})

test("CLI forwards profile setup intent and redacts custom credential aliases", async () => {
  let received: unknown
  const stdout = outputStream()
  const source = { [TOKEN_ALIAS]: TOKEN }
  const exitCode = await runCli({
    args: [
      "setup",
      "--profile",
      "support-bot",
      "--token-env",
      TOKEN_ALIAS,
      "--force",
      "--json",
    ],
    dependencies: dependencies({
      async prepareSetup(options) {
        received = options
        return {
          ...setupReport(),
          profile: connectorProfile(),
          warnings: [`Credential ${TOKEN}`],
        }
      },
    }),
    entrypointPath: "/srv/discord-mcp/dist/cli.js",
    environment: source,
    executablePath: "/usr/bin/node",
    stdout: stdout.stream,
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(received, {
    args: ["/srv/discord-mcp/dist/cli.js", "serve"],
    command: "/usr/bin/node",
    credentialVariable: TOKEN_ALIAS,
    environment: source,
    overwriteProfile: true,
    profileName: "support-bot",
  })
  assert.doesNotMatch(stdout.value(), new RegExp(TOKEN))
  assert.match(stdout.value(), /\[redacted\]/)
})

test("CLI activates profiles before serve, doctor, and smoke without mutating the source", async () => {
  const source = { [TOKEN_ALIAS]: TOKEN, KEEP: "value" }
  const before = { ...source }
  const activated = {
    DISCORD_BOT_TOKEN: TOKEN,
    DISCORD_MCP_APPLICATION_ID: APPLICATION_ID,
    DISCORD_MCP_BOT_ID: BOT_ID,
    KEEP: "value",
  }
  const events: string[] = []
  const profiledDependencies = dependencies({
    async activateProfile(name, options) {
      events.push(`activate:${name}`)
      assert.equal(options.environment, source)
      return { environment: activated, profile: connectorProfile() }
    },
    async diagnose(options) {
      events.push("doctor")
      assert.equal(options.environment, activated)
      return doctorReport()
    },
    serve(options) {
      events.push("serve")
      assert.equal(options.environment, activated)
    },
    async smoke(options) {
      events.push("smoke")
      assert.equal(options.environment, activated)
      return smokeReport()
    },
  })

  assert.equal(await runCli({
    args: ["serve", "--profile", "support-bot"],
    dependencies: profiledDependencies,
    environment: source,
  }), 0)
  assert.equal(await runCli({
    args: ["doctor", "--profile", "support-bot"],
    dependencies: profiledDependencies,
    environment: source,
    stdout: outputStream().stream,
  }), 0)
  assert.equal(await runCli({
    args: ["smoke", "--profile", "support-bot"],
    dependencies: profiledDependencies,
    environment: source,
    stdout: outputStream().stream,
  }), 0)

  assert.deepEqual(source, before)
  assert.deepEqual(events, [
    "activate:support-bot",
    "serve",
    "activate:support-bot",
    "doctor",
    "activate:support-bot",
    "smoke",
  ])
})

test("CLI profile lifecycle is credential-free, recoverable, and exactly confirmed", async () => {
  const events: string[] = []
  let activations = 0
  const lifecycleDependencies = dependencies({
    async activateProfile() {
      activations += 1
      throw new Error("Profiles must not activate for lifecycle inspection")
    },
    async listProfiles() {
      events.push("list")
      return [connectorProfile()]
    },
    async loadProfile(name) {
      events.push(`load:${name}`)
      return connectorProfile()
    },
    async restoreProfile(name) {
      events.push(`restore:${name}`)
      return { name, trashId: "restored" }
    },
    async trashProfile(name) {
      events.push(`remove:${name}`)
      return { name, trashId: "removed" }
    },
  })
  const listOutput = outputStream()
  const showOutput = outputStream()
  const removeOutput = outputStream()
  const restoreOutput = outputStream()
  const mismatchError = outputStream()
  const environment = { [TOKEN_ALIAS]: TOKEN }

  assert.equal(await runCli({
    args: ["profile", "list", "--json"],
    dependencies: lifecycleDependencies,
    environment,
    stdout: listOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["profile", "show", "support-bot"],
    dependencies: lifecycleDependencies,
    environment,
    stdout: showOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["profile", "remove", "support-bot", "--confirm", "wrong"],
    dependencies: lifecycleDependencies,
    environment,
    stderr: mismatchError.stream,
  }), 1)
  assert.equal(await runCli({
    args: [
      "profile",
      "remove",
      "support-bot",
      "--confirm",
      "support-bot",
    ],
    dependencies: lifecycleDependencies,
    environment,
    stdout: removeOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: [
      "profile",
      "restore",
      "support-bot",
      "--confirm",
      "support-bot",
      "--json",
    ],
    dependencies: lifecycleDependencies,
    environment,
    stdout: restoreOutput.stream,
  }), 0)

  const listReport = JSON.parse(listOutput.value()) as {
    profiles: Array<{ credentialVariable: string; name: string }>
    schemaVersion: number
  }
  assert.equal(listReport.schemaVersion, OPERATOR_REPORT_SCHEMA_VERSION)
  assert.deepEqual(listReport.profiles.map((profile) => profile.name), ["support-bot"])
  assert.equal(listReport.profiles[0]?.credentialVariable, TOKEN_ALIAS)
  assert.match(showOutput.value(), /Discord MCP profile: support-bot/)
  assert.match(mismatchError.value(), /Confirmation must exactly match/)
  assert.match(removeOutput.value(), /moved to recoverable trash/)
  assert.deepEqual(JSON.parse(restoreOutput.value()), {
    action: "restore",
    credentialUnaffected: true,
    name: "support-bot",
    schemaVersion: OPERATOR_REPORT_SCHEMA_VERSION,
    status: "ok",
  })
  assert.equal(activations, 0)
  assert.deepEqual(events, [
    "list",
    "load:support-bot",
    "remove:support-bot",
    "restore:support-bot",
  ])
  for (const output of [
    listOutput.value(),
    showOutput.value(),
    removeOutput.value(),
    restoreOutput.value(),
    mismatchError.value(),
  ]) {
    assert.doesNotMatch(output, new RegExp(TOKEN))
  }
})

test("CLI renders smoke, help, and version output", async () => {
  const smokeOutput = outputStream()
  const helpOutput = outputStream()
  const catalogHelpOutput = outputStream()
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
    args: ["catalog", "--help"],
    dependencies: dependencies(),
    stdout: catalogHelpOutput.stream,
  }), 0)
  assert.equal(await runCli({
    args: ["--version"],
    dependencies: dependencies(),
    stdout: versionOutput.stream,
  }), 0)

  assert.match(smokeOutput.value(), /Discord MCP smoke: ok/)
  assert.match(smokeOutput.value(), /Resources: discord:\/\/connector\/safety/)
  assert.match(smokeOutput.value(), /Prompts: summarize_channel/)
  assert.match(helpOutput.value(), /doctor \[--profile NAME\]/)
  assert.match(catalogHelpOutput.value(), /catalog \[--check\] \[--json\]/)
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

test("CLI redacts a custom profile credential when activation fails", async () => {
  const stderr = outputStream()
  const exitCode = await runCli({
    args: ["smoke", "--profile", "support-bot"],
    dependencies: dependencies({
      async activateProfile() {
        throw new Error(`Activation exposed ${TOKEN}`)
      },
    }),
    environment: { [TOKEN_ALIAS]: ` ${TOKEN} ` },
    stderr: stderr.stream,
  })

  assert.equal(exitCode, 1)
  assert.match(stderr.value(), /\[redacted\]/)
  assert.doesNotMatch(stderr.value(), new RegExp(TOKEN))
})
