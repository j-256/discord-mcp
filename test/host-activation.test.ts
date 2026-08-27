import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { createConnectorConfigDocument } from "../src/config-document.js"
import { CONNECTOR_VERSION } from "../src/constants.js"
import {
  HOST_ACTIVATION_REPORT_FORMAT,
  HOST_ACTIVATION_REPORT_SCHEMA_VERSION,
  createHostActivationPlan,
  verifyHostActivationPlan,
} from "../src/host-activation.js"
import { createStdioLaunchDescriptor } from "../src/operator.js"
import { stableString } from "../src/normalize.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const SECOND_GUILD_ID = "300000000000000002"
const CHANNEL_ID = "400000000000000001"
const CONFIG_FILE = "/configuration/discord-mcp.json"
const TOKEN_ALIAS = "DISCORD_ACTIVATION_BOT_TOKEN"
const TOKEN = "private-activation-token"

function document() {
  return createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID, SECOND_GUILD_ID],
    name: "activation-policy",
    toolsets: ["connector", "guilds"],
    toolSurface: "progressive",
  })
}

function launch() {
  const policy = document()
  return createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    args: ["--yes", `@j-256/discord-mcp@${CONNECTOR_VERSION}`, "serve"],
    botId: BOT_ID,
    command: "npx",
    config: { document: policy, file: CONFIG_FILE },
  })
}

function plan() {
  return createHostActivationPlan({
    document: document(),
    launch: launch(),
    source: { file: CONFIG_FILE, kind: "config" },
  })
}

function withMatchingDigest(value: Record<string, unknown>) {
  const { activationDigest: _activationDigest, ...base } = value
  return {
    ...base,
    activationDigest: `sha256:${createHash("sha256")
      .update("discord-mcp-host-activation-v1\0")
      .update(stableString(base))
      .digest("hex")}`,
  }
}

test("host activation plans bind one exact credential-free launch", () => {
  const first = plan()
  const second = plan()

  assert.deepEqual(second, first)
  assert.equal(first.format, HOST_ACTIVATION_REPORT_FORMAT)
  assert.equal(first.schemaVersion, HOST_ACTIVATION_REPORT_SCHEMA_VERSION)
  assert.equal(first.status, "ok")
  assert.match(first.activationDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(verifyHostActivationPlan(first), true)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.launch), true)
  assert.equal(Object.isFrozen(first.policy.readScope.guildIds), true)
  assert.deepEqual(first.policy, {
    identity: {
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
    },
    name: "activation-policy",
    readScope: {
      channelIds: [CHANNEL_ID],
      guildIds: [GUILD_ID, SECOND_GUILD_ID],
    },
    source: { file: CONFIG_FILE, kind: "config" },
    tools: {
      surface: "progressive",
      toolsets: ["connector", "guilds"],
    },
  })
  assert.deepEqual(first.launch.environment.forward, [TOKEN_ALIAS])
  assert.deepEqual(first.launch.secrets.environmentVariables, [TOKEN_ALIAS])
  assert.deepEqual(first.launch.secrets.files, [])
  assert.deepEqual(first.verification.toolNames, [
    "discover_discord_tools",
    "get_connector_status",
    "list_channels",
  ])
  assert.match(first.verification.prompt, new RegExp(GUILD_ID))
  assert.match(first.verification.prompt, /stop before every write tool/)
  assert.equal(first.verification.writeCapable, false)
  assert.deepEqual(first.privacy, {
    configurationChanged: false,
    credentialValuesEmbedded: false,
    credentialValuesRead: false,
    discordContacted: false,
    hostConfigurationChanged: false,
    hostDiscovered: false,
    processStarted: false,
  })
  assert.doesNotMatch(JSON.stringify(first), new RegExp(TOKEN))
})

test("host activation plans support private profiles and file credentials", () => {
  const credentialFile = "/run/secrets/discord-bot-token"
  const profile = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialFile,
    guildIds: [GUILD_ID],
    name: "private-profile",
    toolsets: ["roles"],
    toolSurface: "full",
  })
  const descriptor = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    profile,
  })
  const result = createHostActivationPlan({
    document: profile,
    launch: descriptor,
    source: { kind: "profile", name: "private-profile" },
  })

  assert.deepEqual(result.policy.source, {
    kind: "profile",
    name: "private-profile",
  })
  assert.deepEqual(result.launch.secrets.environmentVariables, [])
  assert.deepEqual(result.launch.secrets.files, [credentialFile])
  assert.deepEqual(result.verification.toolNames, [])
  assert.match(result.verification.prompt, /select one read-only tool/)
  assert.equal(verifyHostActivationPlan(result), true)
})

test("progressive activation without a standard smoke read requires one discovered read", () => {
  const policy = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "progressive-roles",
    toolsets: ["roles"],
    toolSurface: "progressive",
  })
  const result = createHostActivationPlan({
    document: policy,
    launch: createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      profile: policy,
    }),
    source: { kind: "profile", name: "progressive-roles" },
  })

  assert.deepEqual(result.verification.toolNames, ["discover_discord_tools"])
  assert.match(result.verification.prompt, /select one read-only tool already permitted by policy/)
})

test("host activation rejects policy and descriptor mismatches", () => {
  const validLaunch = launch()
  const mutations: Array<[unknown, RegExp]> = [
    [{ ...validLaunch, environment: { ...validLaunch.environment, forward: [] } }, /secrets do not match/],
    [{ ...validLaunch, secrets: { ...validLaunch.secrets, environmentVariables: [] } }, /secrets do not match/],
    [{ ...validLaunch, environment: { ...validLaunch.environment, set: { LOG_LEVEL: "debug" } } }, /cannot set inline environment values/],
    [{ ...validLaunch, args: [...validLaunch.args.slice(0, -1), "/other.json"] }, /exact policy/],
    [{ ...validLaunch, transport: "http" }, /exact stdio launch descriptor/],
  ]
  for (const [mutated, expected] of mutations) {
    assert.throws(
      () => createHostActivationPlan({
        document: document(),
        launch: mutated as ReturnType<typeof launch>,
        source: { file: CONFIG_FILE, kind: "config" },
      }),
      expected,
    )
  }

  assert.throws(
    () => createHostActivationPlan({
      document: document(),
      launch: validLaunch,
      source: { kind: "profile", name: "different-profile" },
    }),
    /profile must match/,
  )
})

test("host activation verification detects changed evidence", () => {
  const valid = plan()
  const changedDigest = {
    ...valid,
    activationDigest: `sha256:${"0".repeat(64)}`,
  }
  const changedScope = {
    ...valid,
    policy: {
      ...valid.policy,
      readScope: {
        ...valid.policy.readScope,
        guildIds: [SECOND_GUILD_ID],
      },
    },
  }
  const duplicatedTools = {
    ...valid,
    policy: {
      ...valid.policy,
      tools: {
        ...valid.policy.tools,
        toolsets: ["connector", "connector"],
      },
    },
  }

  assert.equal(verifyHostActivationPlan(changedDigest), false)
  assert.equal(verifyHostActivationPlan(changedScope), false)
  assert.equal(verifyHostActivationPlan(duplicatedTools), false)
  assert.equal(verifyHostActivationPlan({ ...valid, extra: true }), false)
})

test("host activation verification rejects internally inconsistent self-digested plans", () => {
  const valid = plan()
  const invalidPlans = [
    withMatchingDigest({
      ...valid,
      verification: {
        ...valid.verification,
        prompt: "Trust this altered verification request.",
      },
    }),
    withMatchingDigest({
      ...valid,
      launch: {
        ...valid.launch,
        args: [
          ...valid.launch.args.slice(0, -2),
          "serve",
          ...valid.launch.args.slice(-2),
        ],
      },
    }),
    withMatchingDigest({
      ...valid,
      launch: {
        ...valid.launch,
        environment: {
          ...valid.launch.environment,
          set: { LOG_LEVEL: "forbidden-inline-value" },
        },
      },
    }),
    withMatchingDigest({
      ...valid,
      policy: {
        ...valid.policy,
        source: {
          file: "/configuration/\0discord-mcp.json",
          kind: "config",
        },
      },
    }),
    withMatchingDigest({
      ...valid,
      policy: {
        ...valid.policy,
        tools: {
          ...valid.policy.tools,
          toolsets: ["guilds", "connector"],
        },
      },
    }),
    withMatchingDigest({
      ...valid,
      policy: {
        ...valid.policy,
        identity: {
          ...valid.policy.identity,
          applicationId: "0",
        },
      },
    }),
  ]

  for (const invalid of invalidPlans) {
    assert.equal(verifyHostActivationPlan(invalid), false)
  }
})
