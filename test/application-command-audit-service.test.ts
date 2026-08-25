import assert from "node:assert/strict"
import test from "node:test"

import {
  ApplicationCommandAuditService,
  type ApplicationCommandAuditApplicationEvidence,
  type ApplicationCommandAuditServiceClient,
} from "../src/application-command-audit-service.js"
import type { DiscordGuildApplicationCommandPermissions } from "../src/discord-client.js"
import { ApplicationCommandAuditEvidenceError } from "../src/errors.js"
import type {
  DiscordApplicationCommand,
  DiscordGuild,
} from "../src/types.js"

const APPLICATION_ID = "100"
const BOT_ID = "101"
const GUILD_ID = "200"
const GLOBAL_COMMAND_ID = "300"
const GUILD_COMMAND_ID = "400"
const APPLICATION_EVIDENCE: ApplicationCommandAuditApplicationEvidence = {
  botId: BOT_ID,
  id: APPLICATION_ID,
  installationTypes: {
    reported: true,
    unknownValues: 0,
    values: ["guild-install", "user-install"],
  },
}

function globalCommand(
  overrides: Record<string, unknown> = {},
): DiscordApplicationCommand {
  return {
    application_id: APPLICATION_ID,
    contexts: [0, 1, 2],
    default_member_permissions: "32",
    description: "Private global description",
    id: GLOBAL_COMMAND_ID,
    integration_types: [0, 1],
    name: "review",
    nsfw: false,
    options: [{
      description: "Administrative actions",
      name: "admin",
      options: [{
        description: "Build a private report",
        name: "report",
        options: [{
          choices: [{ name: "Private choice", value: "private-value" }],
          description: "Private report query",
          name: "query",
          required: true,
          type: 3,
        }],
        type: 1,
      }],
      type: 2,
    }],
    type: 1,
    version: "301",
    ...overrides,
  } as unknown as DiscordApplicationCommand
}

function guildCommand(
  overrides: Record<string, unknown> = {},
): DiscordApplicationCommand {
  return {
    application_id: APPLICATION_ID,
    contexts: [0],
    default_member_permissions: "0",
    description: "",
    guild_id: GUILD_ID,
    id: GUILD_COMMAND_ID,
    integration_types: [0],
    name: "Inspect member",
    nsfw: true,
    type: 2,
    version: "401",
    ...overrides,
  } as DiscordApplicationCommand
}

function permissionSet(
  commandId: string,
  permissions: DiscordGuildApplicationCommandPermissions["permissions"],
  unknownFieldCount = 0,
): DiscordGuildApplicationCommandPermissions {
  return {
    applicationId: APPLICATION_ID,
    commandId,
    guildId: GUILD_ID,
    permissions,
    unknownFieldCount,
  }
}

class AuditClient implements ApplicationCommandAuditServiceClient {
  calls: string[] = []
  globalCommands: DiscordApplicationCommand[] = [globalCommand()]
  guildCommands: DiscordApplicationCommand[] = [guildCommand()]
  guild: DiscordGuild = { id: GUILD_ID, name: "Private guild" }
  permissions: DiscordGuildApplicationCommandPermissions[] = [
    permissionSet(APPLICATION_ID, [{
      allowed: true,
      id: GUILD_ID,
      type: 1,
      unknownFieldCount: 0,
    }, {
      allowed: false,
      id: (BigInt(GUILD_ID) - 1n).toString(),
      type: 3,
      unknownFieldCount: 0,
    }]),
    permissionSet(GLOBAL_COMMAND_ID, [{
      allowed: true,
      id: "500",
      type: 2,
      unknownFieldCount: 0,
    }]),
    permissionSet(GUILD_COMMAND_ID, [{
      allowed: false,
      id: "600",
      type: 1,
      unknownFieldCount: 0,
    }, {
      allowed: true,
      id: "700",
      type: 3,
      unknownFieldCount: 0,
    }]),
  ]

  async getGuild() {
    this.calls.push("guild")
    return structuredClone(this.guild)
  }

  async listGlobalApplicationCommands() {
    this.calls.push("global")
    return structuredClone(this.globalCommands)
  }

  async listGuildApplicationCommands() {
    this.calls.push("guild-commands")
    return structuredClone(this.guildCommands)
  }

  async listGuildApplicationCommandPermissions() {
    this.calls.push("permissions")
    return structuredClone(this.permissions)
  }
}

function setup() {
  const client = new AuditClient()
  const policyCalls: string[] = []
  const service = new ApplicationCommandAuditService({
    client,
    policy: {
      assertGuildAllowed(guildId) {
        policyCalls.push(guildId)
        if (guildId !== GUILD_ID) throw new Error("out of scope")
      },
    },
  })
  return { client, policyCalls, service }
}

test("application command audit combines complete pinned inventories and typed permissions", async () => {
  const { client, policyCalls, service } = setup()
  const result = await service.audit(APPLICATION_EVIDENCE, GUILD_ID)

  assert.deepEqual(policyCalls, [GUILD_ID])
  assert.deepEqual(client.calls.sort(), ["global", "guild", "guild-commands", "permissions"])
  assert.deepEqual(result.application, {
    botId: BOT_ID,
    id: APPLICATION_ID,
    installationTypes: {
      complete: true,
      reported: true,
      unknownValues: 0,
      values: ["guild-install", "user-install"],
    },
  })
  assert.deepEqual(result.guild, { id: GUILD_ID, name: "Private guild" })
  assert.deepEqual(result.inventory, {
    completeness: "complete-current-application",
    global: 1,
    guild: 1,
    permissions: 3,
    total: 2,
  })
  assert.deepEqual(result.commands.map((command) => ({
    access: command.defaultAccess,
    contexts: command.contexts.values,
    contextSource: command.contexts.source,
    id: command.id,
    installs: command.installationTypes.values,
    installationSource: command.installationTypes.source,
    name: command.name,
    options: command.options,
    permissionSource: command.permissionSource,
    scope: command.scope,
    type: command.type.name,
  })), [{
    access: "named-permissions",
    contexts: ["guild", "bot-dm", "private-channel"],
    contextSource: "command",
    id: GLOBAL_COMMAND_ID,
    installs: ["guild-install", "user-install"],
    installationSource: "command",
    name: "review",
    options: {
      autocomplete: 0,
      channelTypeConstraints: 0,
      choices: 1,
      localizationValues: 0,
      maximumDepth: 3,
      required: 1,
      topLevel: 1,
      total: 3,
      typeCounts: {
        attachment: 0,
        boolean: 0,
        channel: 0,
        integer: 0,
        mentionable: 0,
        number: 0,
        role: 0,
        string: 1,
        subcommand: 1,
        subcommandGroup: 1,
        user: 0,
      },
      unknownChannelTypes: 0,
      unknownFields: 0,
      unknownTypes: 0,
    },
    permissionSource: "command-specific",
    scope: "global",
    type: "chat-input",
  }, {
    access: "administrator-or-explicit-allow",
    contexts: ["guild"],
    contextSource: "guild-scope",
    id: GUILD_COMMAND_ID,
    installs: ["guild-install"],
    installationSource: "guild-scope",
    name: "Inspect member",
    options: {
      autocomplete: 0,
      channelTypeConstraints: 0,
      choices: 0,
      localizationValues: 0,
      maximumDepth: 0,
      required: 0,
      topLevel: 0,
      total: 0,
      typeCounts: {
        attachment: 0,
        boolean: 0,
        channel: 0,
        integer: 0,
        mentionable: 0,
        number: 0,
        role: 0,
        string: 0,
        subcommand: 0,
        subcommandGroup: 0,
        user: 0,
      },
      unknownChannelTypes: 0,
      unknownFields: 0,
      unknownTypes: 0,
    },
    permissionSource: "command-specific",
    scope: "guild",
    type: "user",
  }])
  assert.deepEqual(result.permissions.map((entry) => ({
    commandId: entry.commandId,
    decisions: entry.decisions.map(({ allowed, id, target }) => ({ allowed, id, target })),
    source: entry.source,
  })), [{
    commandId: null,
    decisions: [{ allowed: true, id: GUILD_ID, target: "everyone" }, {
      allowed: false,
      id: "199",
      target: "all-channels",
    }],
    source: "application-default",
  }, {
    commandId: GLOBAL_COMMAND_ID,
    decisions: [{ allowed: true, id: "500", target: "user" }],
    source: "command-specific",
  }, {
    commandId: GUILD_COMMAND_ID,
    decisions: [{ allowed: false, id: "600", target: "role" }, {
      allowed: true,
      id: "700",
      target: "channel",
    }],
    source: "command-specific",
  }])
  assert.deepEqual(result.exposure.commands, {
    administratorOrExplicitAllow: 1,
    applicationDefaultInstallationTypes: 0,
    discordDefault: 0,
    discordDefaultContexts: 0,
    global: 1,
    guild: 1,
    incompleteContexts: 0,
    incompleteInstallationTypes: 0,
    knownBotDm: 1,
    knownPrivateChannel: 1,
    knownUserInstall: 1,
    namedPermissions: 1,
    nsfw: 1,
    total: 2,
    unknownContextValues: 0,
    unknownInstallationTypeValues: 0,
    unknownTypes: 0,
  })
  assert.deepEqual(result.exposure.permissionSets, {
    allChannelDecisions: 1,
    allows: 3,
    applicationDefaults: 1,
    channelDecisions: 1,
    commandSpecific: 2,
    decisions: 5,
    denies: 2,
    everyoneDecisions: 1,
    roleDecisions: 1,
    userDecisions: 1,
  })
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /Private global description|Private choice|private-value|Private report query/)
  assert.match(serialized, /raw-command-definitions/)
  assert.equal(result.privacy.persistence, "none")
})

test("application command audit enforces scope before every Discord read", async () => {
  const client = new AuditClient()
  const service = new ApplicationCommandAuditService({
    client,
    policy: {
      assertGuildAllowed() {
        throw new Error("out of scope")
      },
    },
  })
  await assert.rejects(service.audit(APPLICATION_EVIDENCE, GUILD_ID), /out of scope/)
  assert.deepEqual(client.calls, [])
})

test("application command audit distinguishes Discord defaults from resolved application installation types", async () => {
  const { client, service } = setup()
  client.globalCommands = [globalCommand({
    contexts: undefined,
    integration_types: undefined,
  })]
  client.guildCommands = [guildCommand({
    contexts: undefined,
    integration_types: undefined,
  })]

  const result = await service.audit(APPLICATION_EVIDENCE, GUILD_ID)

  assert.deepEqual(result.commands.map(({ contexts, installationTypes, scope }) => ({
    contexts,
    installationTypes,
    scope,
  })), [{
    contexts: {
      complete: false,
      source: "discord-default",
      unknownValues: 0,
      values: [],
    },
    installationTypes: {
      complete: true,
      source: "application-default",
      unknownValues: 0,
      values: ["guild-install", "user-install"],
    },
    scope: "global",
  }, {
    contexts: {
      complete: true,
      source: "guild-scope",
      unknownValues: 0,
      values: ["guild"],
    },
    installationTypes: {
      complete: true,
      source: "guild-scope",
      unknownValues: 0,
      values: ["guild-install"],
    },
    scope: "guild",
  }])
  assert.equal(result.exposure.commands.applicationDefaultInstallationTypes, 1)
  assert.equal(result.exposure.commands.discordDefaultContexts, 1)
  assert.equal(result.exposure.commands.incompleteContexts, 1)
  assert.equal(result.exposure.commands.incompleteInstallationTypes, 0)
  assert.equal(result.exposure.commands.knownBotDm, 0)
  assert.equal(result.exposure.commands.knownPrivateChannel, 0)
  assert.equal(result.exposure.commands.knownUserInstall, 1)
})

test("application command audit preserves incomplete inherited application installation evidence", async () => {
  const { client, service } = setup()
  client.globalCommands = [globalCommand({
    contexts: undefined,
    integration_types: undefined,
  })]
  client.guildCommands = []
  client.permissions = [permissionSet(APPLICATION_ID, [])]

  const result = await service.audit({
    botId: BOT_ID,
    id: APPLICATION_ID,
    installationTypes: {
      reported: false,
      unknownValues: 0,
      values: [],
    },
  }, GUILD_ID)

  assert.deepEqual(result.application.installationTypes, {
    complete: false,
    reported: false,
    unknownValues: 0,
    values: [],
  })
  assert.deepEqual(result.commands[0]?.installationTypes, {
    complete: false,
    source: "application-default",
    unknownValues: 0,
    values: [],
  })
  assert.equal(result.exposure.commands.incompleteContexts, 1)
  assert.equal(result.exposure.commands.incompleteInstallationTypes, 1)
})

test("application command audit rejects incoherent application installation evidence before reads", async () => {
  const { client, service } = setup()
  await assert.rejects(service.audit({
    botId: BOT_ID,
    id: APPLICATION_ID,
    installationTypes: {
      reported: false,
      unknownValues: 0,
      values: ["guild-install"],
    },
  }, GUILD_ID), ApplicationCommandAuditEvidenceError)
  assert.deepEqual(client.calls, [])
})

test("application command audit counts future evidence without exposing raw values", async () => {
  const { client, service } = setup()
  client.globalCommands = [globalCommand({
    contexts: [99, 2, 1, 0],
    future_command_field: "private-future-value",
    integration_types: [99, 1, 0],
    options: [{
      description: "Future option",
      future_option_field: "private-option-value",
      name: "future",
      type: 99,
    }],
  })]
  client.guildCommands = []
  client.permissions = [permissionSet(APPLICATION_ID, [], 2)]

  const result = await service.audit(APPLICATION_EVIDENCE, GUILD_ID)
  assert.equal(result.commands[0]?.unknownFieldCount, 1)
  assert.equal(result.commands[0]?.options.unknownFields, 1)
  assert.equal(result.commands[0]?.options.unknownTypes, 1)
  assert.deepEqual(result.commands[0]?.contexts.values, [
    "guild",
    "bot-dm",
    "private-channel",
  ])
  assert.deepEqual(result.commands[0]?.installationTypes.values, [
    "guild-install",
    "user-install",
  ])
  assert.equal(result.exposure.commands.unknownContextValues, 1)
  assert.equal(result.exposure.commands.unknownInstallationTypeValues, 1)
  assert.equal(result.exposure.evidence.unknownFields, 4)
  assert.doesNotMatch(JSON.stringify(result), /private-future-value|private-option-value/)
})

test("application command audit rejects mismatched, duplicate, and unassociated evidence", async () => {
  const mutations: Array<(client: AuditClient) => void> = [
    (client) => {
      client.globalCommands = [globalCommand({ application_id: "999" })]
    },
    (client) => {
      client.guildCommands = [guildCommand({ guild_id: "999" })]
    },
    (client) => {
      client.guildCommands = [guildCommand({ id: GLOBAL_COMMAND_ID })]
    },
    (client) => {
      client.guildCommands = [guildCommand({ contexts: [1] })]
    },
    (client) => {
      client.guildCommands = [guildCommand({ integration_types: [1] })]
    },
    (client) => {
      client.globalCommands = [globalCommand(), globalCommand({ id: "302", version: "303" })]
    },
    (client) => {
      client.permissions = [permissionSet("999", [])]
    },
    (client) => {
      client.globalCommands = [globalCommand({
        options: [{
          description: "Mixed parameter",
          name: "query",
          type: 3,
        }, {
          description: "Mixed subcommand",
          name: "subcommand",
          type: 1,
        }],
      })]
    },
  ]
  for (const mutate of mutations) {
    const { client, service } = setup()
    mutate(client)
    await assert.rejects(
      service.audit(APPLICATION_EVIDENCE, GUILD_ID),
      ApplicationCommandAuditEvidenceError,
    )
  }
})

test("application command audit rejects malformed known fields and excessive inventories", async () => {
  const malformed: Array<Record<string, unknown>> = [
    { contexts: [0, 0] },
    { default_member_permissions: "invalid" },
    { description: "\u0000" },
    { integration_types: [0, 0] },
    { nsfw: "false" },
    { options: [{ description: "Group", name: "group", type: 2 }] },
    { options: [{ autocomplete: true, choices: [], description: "Query", name: "query", type: 3 }] },
    { version: "0" },
  ]
  for (const overrides of malformed) {
    const { client, service } = setup()
    client.globalCommands = [globalCommand(overrides)]
    await assert.rejects(
      service.audit(APPLICATION_EVIDENCE, GUILD_ID),
      ApplicationCommandAuditEvidenceError,
    )
  }

  const { client, service } = setup()
  client.globalCommands = Array.from({ length: 132 }, (_, index) => globalCommand({
    id: String(1_000 + index * 2),
    name: `command-${index}`,
    version: String(1_001 + index * 2),
  }))
  await assert.rejects(
    service.audit(APPLICATION_EVIDENCE, GUILD_ID),
    ApplicationCommandAuditEvidenceError,
  )
})
