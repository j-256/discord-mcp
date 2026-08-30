import assert from "node:assert/strict"
import test from "node:test"

import { createConnectorConfigDocument } from "../src/config-document.js"
import { CONNECTOR_VERSION } from "../src/constants.js"
import {
  HOST_ADAPTER_CATALOG_FORMAT,
  HOST_ADAPTER_CATALOG_SCHEMA_VERSION,
  HOST_ADAPTER_IDS,
  createHostAdapterCatalog,
  findHostAdapter,
  isHostAdapterId,
  verifyHostAdapterCatalog,
} from "../src/host-adapters.js"
import {
  createHostActivationPlan,
  type HostActivationPlan,
} from "../src/host-activation.js"
import { createStdioLaunchDescriptor } from "../src/operator.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CONFIG_FILE = "/configuration/guildcontrol.json"
const TOKEN_ALIAS = "DISCORD_ADAPTER_BOT_TOKEN"
const TOKEN_VALUE = "private-adapter-token-value"
const SERVER_NAME = "Discord_Test-42"

function environmentPlan(): HostActivationPlan {
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "adapter-policy",
    toolsets: ["connector", "guilds"],
    toolSurface: "progressive",
  })
  const launch = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    args: ["--yes", `guildcontrol@${CONNECTOR_VERSION}`, "serve"],
    botId: BOT_ID,
    command: "npx",
    config: { document, file: CONFIG_FILE },
    serverName: SERVER_NAME,
  })
  return createHostActivationPlan({
    document,
    launch,
    source: { file: CONFIG_FILE, kind: "config" },
  })
}

function filePlan(): HostActivationPlan {
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialFile: "/run/secrets/discord-bot-token",
    guildIds: [GUILD_ID],
    name: "file-policy",
    toolsets: ["roles"],
    toolSurface: "full",
  })
  return createHostActivationPlan({
    document,
    launch: createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      profile: document,
      serverName: "discord-file",
    }),
    source: { kind: "profile", name: document.name },
  })
}

function serverFrom(
  configuration: Readonly<Record<string, unknown>>,
  root: "mcpServers" | "servers",
  name: string,
): Record<string, unknown> {
  return (configuration[root] as Record<string, Record<string, unknown>>)[name] as Record<string, unknown>
}

test("host adapters bind deterministic exact projections to one activation", () => {
  const plan = environmentPlan()
  const first = createHostAdapterCatalog(plan)
  const second = createHostAdapterCatalog(plan)

  assert.deepEqual(second, first)
  assert.equal(first.format, HOST_ADAPTER_CATALOG_FORMAT)
  assert.equal(first.schemaVersion, HOST_ADAPTER_CATALOG_SCHEMA_VERSION)
  assert.equal(first.status, "ok")
  assert.equal(first.activationDigest, plan.activationDigest)
  assert.deepEqual(first.adapters.map((adapter) => adapter.id), HOST_ADAPTER_IDS)
  assert.equal(new Set(first.adapters.map((adapter) => adapter.adapterDigest)).size, HOST_ADAPTER_IDS.length)
  assert.equal(verifyHostAdapterCatalog(plan, first), true)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.adapters), true)

  for (const adapter of first.adapters) {
    assert.equal(adapter.activationDigest, plan.activationDigest)
    assert.match(adapter.adapterDigest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(adapter.content, `${JSON.stringify(adapter.configuration, null, 2)}\n`)
    assert.equal(Object.isFrozen(adapter), true)
    assert.equal(Object.isFrozen(adapter.configuration), true)
    assert.equal(Object.isFrozen(adapter.instructions), true)
    assert.equal(adapter.requirements.requiredServer, true)
    assert.equal(adapter.requirements.toolApproval, "writes")
    assert.equal(adapter.requirements.elicitation, "required-for-reviewed-writes")
  }
  assert.doesNotMatch(JSON.stringify(first), new RegExp(TOKEN_VALUE))
})

test("common MCP JSON preserves exact launch order without inventing secret syntax", () => {
  const plan = environmentPlan()
  const adapter = findHostAdapter(createHostAdapterCatalog(plan), "mcp-json")

  assert.deepEqual(adapter.configuration, {
    mcpServers: {
      [SERVER_NAME]: {
        args: plan.launch.args,
        command: plan.launch.command,
      },
    },
  })
  assert.equal(adapter.secret.strategy, "inherited-environment")
  assert.deepEqual(adapter.secret.environmentVariables, [TOKEN_ALIAS])
  assert.doesNotMatch(adapter.content, /"env"/)
})

test("Cursor adapter emits explicit environment references and a round-trippable install URI", () => {
  const plan = environmentPlan()
  const adapter = findHostAdapter(createHostAdapterCatalog(plan), "cursor")
  const server = serverFrom(adapter.configuration, "mcpServers", SERVER_NAME)

  assert.deepEqual(server, {
    args: plan.launch.args,
    command: plan.launch.command,
    env: { [TOKEN_ALIAS]: `\${env:${TOKEN_ALIAS}}` },
    type: "stdio",
  })
  const uri = new URL(adapter.installUri as string)
  assert.equal(uri.protocol, "cursor:")
  assert.equal(uri.host, "anysphere.cursor-deeplink")
  assert.equal(uri.pathname, "/mcp/install")
  assert.equal(uri.searchParams.get("name"), SERVER_NAME)
  assert.deepEqual(
    JSON.parse(Buffer.from(uri.searchParams.get("config") as string, "base64").toString("utf8")),
    server,
  )
  assert.equal(adapter.secret.strategy, "environment-interpolation")
  assert.doesNotMatch(adapter.installUri as string, new RegExp(TOKEN_VALUE))
})

test("VS Code adapter uses password inputs and leaves auto-approving sandbox disabled", () => {
  const plan = environmentPlan()
  const adapter = findHostAdapter(createHostAdapterCatalog(plan), "vscode")

  assert.deepEqual(adapter.configuration, {
    inputs: [{
      description: `Discord bot credential for ${TOKEN_ALIAS}`,
      id: "guildcontrol-credential-1",
      password: true,
      type: "promptString",
    }],
    servers: {
      [SERVER_NAME]: {
        args: plan.launch.args,
        command: plan.launch.command,
        env: { [TOKEN_ALIAS]: "${input:guildcontrol-credential-1}" },
        type: "stdio",
      },
    },
  })
  assert.equal(adapter.secret.strategy, "secure-input")
  assert.doesNotMatch(adapter.content, /sandboxEnabled|private-adapter-token-value/)
})

test("Gemini CLI adapter uses a policy-specific safe alias and keychain settings", () => {
  const plan = environmentPlan()
  const adapter = findHostAdapter(createHostAdapterCatalog(plan), "gemini-extension")
  const configuration = adapter.configuration as {
    mcpServers: Record<string, Record<string, unknown>>
    name: string
    settings: readonly Record<string, unknown>[]
  }

  assert.match(configuration.name, /^guildcontrol-[a-f0-9]{12}$/)
  assert.equal(configuration.name.includes("_"), false)
  assert.equal(adapter.hostServerName, configuration.name)
  assert.deepEqual(configuration.settings, [{
    description: `Discord bot credential exposed only as ${TOKEN_ALIAS}`,
    envVar: TOKEN_ALIAS,
    name: `Discord credential (${TOKEN_ALIAS})`,
    sensitive: true,
  }])
  assert.deepEqual(configuration.mcpServers[configuration.name], {
    args: plan.launch.args,
    command: plan.launch.command,
    env: { [TOKEN_ALIAS]: `\${${TOKEN_ALIAS}}` },
  })
  assert.equal(adapter.secret.strategy, "system-keychain")
})

test("file-credential plans omit every host secret field", () => {
  const plan = filePlan()
  const catalog = createHostAdapterCatalog(plan)

  for (const adapter of catalog.adapters) {
    assert.equal(adapter.secret.strategy, "credential-file")
    assert.deepEqual(adapter.secret.environmentVariables, [])
    assert.doesNotMatch(adapter.content, /"env"|"inputs"|"settings"/)
    assert.match(adapter.instructions.join(" "), /private credential file/)
  }
})

test("adapter verification rejects changed evidence and invalid activation plans", () => {
  const plan = environmentPlan()
  const catalog = createHostAdapterCatalog(plan)
  const changed = JSON.parse(JSON.stringify(catalog)) as {
    adapters: Array<{ content: string }>
  }
  changed.adapters[0]!.content = "{}\n"

  assert.equal(verifyHostAdapterCatalog(plan, changed), false)
  assert.equal(isHostAdapterId("cursor"), true)
  assert.equal(isHostAdapterId("unknown"), false)
  assert.throws(
    () => createHostAdapterCatalog({
      ...plan,
      activationDigest: `sha256:${"0".repeat(64)}`,
    }),
    /exact credential-free activation plan/,
  )
})
