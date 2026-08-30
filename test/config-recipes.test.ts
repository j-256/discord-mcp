import assert from "node:assert/strict"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  CONFIG_RECIPE_NAMES,
  CONFIG_RECIPE_PLAN_DIGEST_PATTERN,
  CONFIG_RECIPES,
  applyConfigRecipe,
  getConfigRecipe,
  normalizeConfigRecipeRequest,
  planConfigRecipe,
} from "../src/config-recipes.js"
import {
  createConnectorConfigDocument,
  loadConnectorConfigDocumentFile,
  type ConnectorConfigDocument,
} from "../src/config-document.js"
import { writeConnectorConfigDocumentFile } from "../src/config-operator.js"
import { loadConnectorConfigDocument } from "../src/config.js"
import { CONNECTOR_LIMITS } from "../src/constants.js"
import { guildChannelLayoutGuildIds } from "../src/guild-channel-evidence.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"

const APPLICATION_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const CHANNEL_ID = "200000000000000001"
const OTHER_CHANNEL_ID = "200000000000000002"
const USER_ID = "500000000000000001"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"
const TOKEN = "test-discord-token"

function document(
  overrides: Partial<Parameters<typeof createConnectorConfigDocument>[0]> = {},
): ConnectorConfigDocument {
  return createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "support-bot",
    toolsets: ["connector"],
    toolSurface: "progressive",
    ...overrides,
  })
}

async function recipeRoot(context: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guildcontrol-config-recipe-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  return realpath(root)
}

async function configFile(
  context: test.TestContext,
  value: ConnectorConfigDocument = document(),
  name = "guildcontrol.json",
): Promise<string> {
  const root = await recipeRoot(context)
  const file = join(root, name)
  await writeConnectorConfigDocumentFile(file, value)
  return file
}

test("configuration recipes expose frozen catalog-derived requirements", () => {
  assert.deepEqual(CONFIG_RECIPE_NAMES, [
    "guild-starter",
    "guild-builder",
    "coordination-channel",
    "message-channel",
    "channel-publisher",
    "direct-messenger",
    "incident-response",
  ])
  assert.equal(Object.isFrozen(CONFIG_RECIPES), true)

  const guildStarter = getConfigRecipe(" GUILD-STARTER ")
  assert.equal(Object.isFrozen(guildStarter), true)
  assert.deepEqual(guildStarter.toolsets, ["guild-blueprints"])
  assert.deepEqual(guildStarter.toolNames, [
    "capture_guild_blueprint",
    "compile_guild_blueprint_starter",
    "discover_discord_tools",
    "execute_guild_blueprint",
    "plan_guild_blueprint",
    "preview_guild_blueprint",
    "verify_guild_blueprint",
  ])
  assert.deepEqual(guildStarter.capabilities, [
    "channelOrderingAudit",
    "channelOrderingChanges",
    "guildScaffolds",
    "guildSettingsAudit",
    "guildSettingsChanges",
  ])
  assert.deepEqual(guildStarter.requirements.scope.targets, [
    "$.scopes.channelOrderingGuildIds",
    "$.scopes.guildScaffoldGuildIds",
    "$.scopes.guildSettingsGuildIds",
  ])
  assert.deepEqual(guildStarter.requirements.botPermissions, [
    "MANAGE_CHANNELS",
    "MANAGE_GUILD",
    "VIEW_CHANNEL",
  ])
  assert.deepEqual(guildStarter.requirements.gateway, {
    evidenceConnection: "guild-layout",
    eventFeedPolicy: "unchanged",
    intents: ["GUILDS"],
  })
  assert.deepEqual(guildStarter.requirements.privilegedIntents, [])
  assert.equal(
    guildStarter.requirements.botPermissions.includes("MANAGE_ROLES"),
    false,
  )
  assert.equal(
    guildStarter.warnings.some((warning) => warning.includes("ordinary public")),
    true,
  )
  assert.equal(
    guildStarter.warnings.some((warning) => warning.includes("guildName")),
    true,
  )

  const guildBuilder = getConfigRecipe(" GUILD-BUILDER ")
  assert.equal(Object.isFrozen(guildBuilder), true)
  assert.deepEqual(guildBuilder.toolsets, ["guild-blueprints"])
  assert.deepEqual(guildBuilder.toolNames, [
    "capture_guild_blueprint",
    "compile_guild_blueprint_starter",
    "discover_discord_tools",
    "execute_guild_blueprint",
    "plan_guild_blueprint",
    "preview_guild_blueprint",
    "verify_guild_blueprint",
  ])
  assert.equal(guildBuilder.capabilities.includes("automodAudit"), true)
  assert.equal(guildBuilder.capabilities.includes("automodChanges"), true)
  assert.equal(guildBuilder.capabilities.includes("channelOrderingAudit"), true)
  assert.equal(guildBuilder.capabilities.includes("channelOrderingChanges"), true)
  assert.equal(guildBuilder.capabilities.includes("guildCommunityAudit"), true)
  assert.equal(guildBuilder.capabilities.includes("guildCommunityChanges"), true)
  assert.deepEqual(guildBuilder.requirements.scope.targets, [
    "$.scopes.automodGuildIds",
    "$.scopes.channelOrderingGuildIds",
    "$.scopes.guildScaffoldGuildIds",
    "$.scopes.guildCommunityGuildIds",
    "$.scopes.guildProfileGuildIds",
    "$.scopes.guildSettingsGuildIds",
    "$.scopes.onboardingGuildIds",
    "$.scopes.welcomeScreenGuildIds",
  ])
  assert.deepEqual(guildBuilder.requirements.privilegedIntents, [])
  assert.equal(Object.isFrozen(guildBuilder.requirements.gateway), true)
  assert.equal(Object.isFrozen(guildBuilder.requirements.gateway.intents), true)
  assert.deepEqual(guildBuilder.requirements.gateway, {
    evidenceConnection: "guild-layout",
    eventFeedPolicy: "unchanged",
    intents: ["GUILDS"],
  })
  assert.equal(guildBuilder.riskClasses.includes("destructive-write"), true)
  assert.equal(
    guildBuilder.requirements.botPermissions.includes("MODERATE_MEMBERS"),
    false,
  )
  assert.equal(
    guildBuilder.requirements.botPermissions.includes("ADMINISTRATOR"),
    false,
  )
  assert.equal(
    guildBuilder.warnings.some((warning) => warning.includes("MODERATE_MEMBERS")),
    true,
  )
  assert.equal(
    guildBuilder.warnings.some((warning) => warning.includes("Administrator")),
    true,
  )

  const coordinationChannel = getConfigRecipe("coordination-channel")
  assert.deepEqual(coordinationChannel.toolsets, ["coordination"])
  assert.deepEqual(coordinationChannel.toolNames, [
    "create_coordination_address",
    "discover_discord_tools",
    "list_coordination_addresses",
    "list_coordination_notes",
    "send_coordination_note",
  ])
  assert.deepEqual(coordinationChannel.capabilities, ["interactions"])
  assert.deepEqual(coordinationChannel.requirements.scope.targets, [
    "$.scopes.interactionChannelIds",
  ])
  assert.deepEqual(coordinationChannel.requirements.botPermissions, [
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
    "READ_MESSAGE_HISTORY",
    "SEND_MESSAGES_IN_THREADS",
  ])
  assert.deepEqual(coordinationChannel.requirements.privilegedIntents, [])
  assert.deepEqual(coordinationChannel.requirements.gateway, {
    evidenceConnection: "none",
    eventFeedPolicy: "unchanged",
    intents: [],
  })
  assert.equal(
    coordinationChannel.warnings.some((warning) => warning.includes("app-authored-message")),
    true,
  )
  assert.equal(
    coordinationChannel.warnings.some((warning) => warning.includes("alias registry")),
    true,
  )

  const messageChannel = getConfigRecipe("message-channel")
  assert.deepEqual(messageChannel.toolsets, ["message-writes"])
  assert.deepEqual(messageChannel.toolNames, [
    "discover_discord_tools",
    "edit_own_message",
    "send_message",
    "signal_command_processing",
  ])
  assert.deepEqual(messageChannel.capabilities, ["interactions"])
  assert.deepEqual(messageChannel.requirements.scope.targets, [
    "$.scopes.interactionChannelIds",
  ])
  assert.deepEqual(messageChannel.requirements.botPermissions, [
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
    "READ_MESSAGE_HISTORY",
    "SEND_MESSAGES_IN_THREADS",
  ])
  assert.deepEqual(messageChannel.requirements.privilegedIntents, [])
  assert.deepEqual(messageChannel.requirements.gateway, {
    evidenceConnection: "none",
    eventFeedPolicy: "unchanged",
    intents: [],
  })
  assert.equal(messageChannel.toolNames.includes("add_reaction"), false)
  assert.equal(messageChannel.toolNames.includes("get_message"), false)
  assert.equal(messageChannel.toolNames.includes("execute_component_message"), false)
  assert.equal(messageChannel.toolNames.includes("execute_embed_message"), false)
  assert.equal(
    messageChannel.warnings.some((warning) => warning.includes("app-authored messages")),
    true,
  )

  const channelPublisher = getConfigRecipe("channel-publisher")
  assert.deepEqual(channelPublisher.toolsets, [
    "embed-messages",
    "interactions",
    "message-writes",
    "messages",
  ])
  assert.equal(channelPublisher.toolNames.includes("send_message"), true)
  assert.equal(channelPublisher.toolNames.includes("send_coordination_note"), false)
  assert.equal(channelPublisher.toolNames.includes("execute_component_message"), true)
  assert.equal(channelPublisher.toolNames.includes("execute_embed_message"), true)
  assert.deepEqual(channelPublisher.capabilities, ["embedMessages", "interactions"])
  assert.deepEqual(channelPublisher.requirements.scope.targets, [
    "$.scopes.embedMessageChannelIds",
    "$.scopes.interactionChannelIds",
  ])
  assert.deepEqual(channelPublisher.requirements.privilegedIntents, [{
    name: "MESSAGE_CONTENT",
    status: "required",
  }])
  assert.deepEqual(channelPublisher.requirements.gateway, {
    evidenceConnection: "none",
    eventFeedPolicy: "unchanged",
    intents: [],
  })
  assert.equal(
    channelPublisher.requirements.botPermissions.includes("ADMINISTRATOR"),
    false,
  )
  assert.equal(
    channelPublisher.warnings.some((warning) => warning.includes("scopes.componentLinkOrigins")),
    true,
  )
  const expectedPermissions = channelPublisher.requirements.botPermissions.reduce(
    (permissions, name) => permissions | DISCORD_PERMISSIONS[name],
    0n,
  )
  assert.equal(
    channelPublisher.requirements.botPermissionBitfield,
    expectedPermissions.toString(),
  )

  const directMessenger = getConfigRecipe("direct-messenger")
  assert.deepEqual(directMessenger.capabilities, [
    "directMessageAudit",
    "directMessageDeletion",
    "directMessageDelivery",
    "directMessageEditing",
  ])
  assert.deepEqual(directMessenger.toolsets, ["direct-messages"])
  assert.deepEqual(directMessenger.toolNames, [
    "discover_discord_tools",
    "execute_direct_message_change",
    "get_direct_message",
    "list_direct_messages",
    "plan_direct_message_change",
    "verify_direct_message_change",
  ])
  assert.equal(
    directMessenger.warnings.some((warning) => warning.includes("scopes.componentLinkOrigins")),
    true,
  )
  assert.deepEqual(directMessenger.requirements.scope, {
    kind: "user",
    maximum: CONNECTOR_LIMITS.directMessageUserAllowlist,
    minimum: 1,
    option: "--user-id",
    outerBoundary: null,
    targets: ["$.scopes.directMessageUserIds"],
  })
  assert.deepEqual(directMessenger.requirements.botPermissions, [])
  assert.equal(directMessenger.requirements.botPermissionBitfield, "0")
  assert.deepEqual(directMessenger.requirements.privilegedIntents, [])
  assert.deepEqual(directMessenger.requirements.gateway, {
    evidenceConnection: "none",
    eventFeedPolicy: "unchanged",
    intents: [],
  })

  const incidentResponse = getConfigRecipe("incident-response")
  assert.deepEqual(incidentResponse.capabilities, [
    "guildIncidentAudit",
    "guildIncidentChanges",
  ])
  assert.deepEqual(incidentResponse.toolsets, ["guild-incidents"])
  assert.deepEqual(incidentResponse.toolNames, [
    "discover_discord_tools",
    "execute_guild_incident_action_change",
    "get_guild_incident_actions",
    "plan_guild_incident_action_change",
  ])
  assert.deepEqual(incidentResponse.requirements.scope.targets, [
    "$.scopes.guildIncidentGuildIds",
  ])
  assert.deepEqual(incidentResponse.requirements.botPermissions, ["MANAGE_GUILD"])
  assert.deepEqual(incidentResponse.requirements.gateway, {
    evidenceConnection: "none",
    eventFeedPolicy: "unchanged",
    intents: [],
  })
  assert.deepEqual(incidentResponse.requirements.privilegedIntents, [])
})

test("configuration recipe requests normalize exact bounded scope", () => {
  assert.deepEqual(normalizeConfigRecipeRequest({
    guildIds: [OTHER_GUILD_ID, GUILD_ID],
    name: " GUILD-BUILDER ",
  }), {
    name: "guild-builder",
    scope: {
      ids: [GUILD_ID, OTHER_GUILD_ID],
      kind: "guild",
    },
  })
  assert.deepEqual(normalizeConfigRecipeRequest({
    guildIds: [GUILD_ID],
    name: "incident-response",
  }), {
    name: "incident-response",
    scope: {
      ids: [GUILD_ID],
      kind: "guild",
    },
  })
  assert.deepEqual(normalizeConfigRecipeRequest({
    channelIds: [CHANNEL_ID],
    name: "coordination-channel",
  }), {
    name: "coordination-channel",
    scope: {
      ids: [CHANNEL_ID],
      kind: "channel",
    },
  })
  assert.deepEqual(normalizeConfigRecipeRequest({
    channelIds: [CHANNEL_ID],
    name: "message-channel",
  }), {
    name: "message-channel",
    scope: {
      ids: [CHANNEL_ID],
      kind: "channel",
    },
  })
  assert.deepEqual(normalizeConfigRecipeRequest({
    channelIds: [CHANNEL_ID],
    name: "channel-publisher",
  }), {
    name: "channel-publisher",
    scope: {
      ids: [CHANNEL_ID],
      kind: "channel",
    },
  })
  assert.deepEqual(normalizeConfigRecipeRequest({
    name: "direct-messenger",
    userIds: [USER_ID],
  }), {
    name: "direct-messenger",
    scope: {
      ids: [USER_ID],
      kind: "user",
    },
  })
  assert.throws(
    () => normalizeConfigRecipeRequest({ name: "unknown", guildIds: [GUILD_ID] }),
    /must be one of/,
  )
  assert.throws(
    () => normalizeConfigRecipeRequest({ name: "guild-builder", channelIds: [CHANNEL_ID] }),
    /accepts --guild-id, not --channel-id/,
  )
  assert.throws(
    () => normalizeConfigRecipeRequest({ name: "channel-publisher", guildIds: [GUILD_ID] }),
    /accepts --channel-id, not --guild-id/,
  )
  assert.throws(
    () => normalizeConfigRecipeRequest({ name: "direct-messenger", guildIds: [GUILD_ID] }),
    /accepts --user-id only/,
  )
  assert.throws(
    () => normalizeConfigRecipeRequest({
      channelIds: [CHANNEL_ID, CHANNEL_ID],
      name: "channel-publisher",
    }),
    /unique Discord snowflakes/,
  )
  assert.throws(
    () => normalizeConfigRecipeRequest({
      channelIds: ["99999999999999999999"],
      name: "channel-publisher",
    }),
    /Discord snowflakes/,
  )
})

test("guild-starter plans only its public layout policy", async (context) => {
  const file = await configFile(context)
  const plan = planConfigRecipe({
    file,
    guildIds: [GUILD_ID],
    name: "guild-starter",
  })

  assert.equal(plan.status, "planned")
  assert.deepEqual(plan.proposedDocument.tools.toolsets, [
    "connector",
    "guild-blueprints",
  ])
  assert.deepEqual(
    Object.entries(plan.proposedDocument.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name),
    [
      "channelOrderingAudit",
      "channelOrderingChanges",
      "guildScaffolds",
      "guildSettingsAudit",
      "guildSettingsChanges",
    ],
  )
  assert.deepEqual(plan.proposedDocument.scopes.channelOrderingGuildIds, [GUILD_ID])
  assert.deepEqual(plan.proposedDocument.scopes.guildScaffoldGuildIds, [GUILD_ID])
  assert.deepEqual(plan.proposedDocument.scopes.guildSettingsGuildIds, [GUILD_ID])
  assert.equal("guildProfileGuildIds" in plan.proposedDocument.scopes, false)
  assert.equal("guildProfileChanges" in plan.proposedDocument.capabilities, false)
  assert.equal("guildCommunityGuildIds" in plan.proposedDocument.scopes, false)
  assert.equal("automodGuildIds" in plan.proposedDocument.scopes, false)
  assert.equal("guildCommunityChanges" in plan.proposedDocument.capabilities, false)
  assert.equal("automodChanges" in plan.proposedDocument.capabilities, false)
  const runtime = loadConnectorConfigDocument(plan.proposedDocument, {
    [TOKEN_ALIAS]: TOKEN,
  })
  assert.deepEqual([...guildChannelLayoutGuildIds(runtime)], [GUILD_ID])
})

test("guild-builder plans all declared scopes and preserves unrelated policy", async (context) => {
  const original = document({
    capabilities: { interactions: true },
    limits: {
      interactionMaxWritesPerMinute: 7,
      interactionMinWriteIntervalMs: 2_000,
    },
    observability: { jsonLogsEnabled: true },
    scopes: {
      interactionChannelIds: [CHANNEL_ID],
      mentionUserIds: [USER_ID],
    },
    storage: { auditFile: join(process.cwd(), ".test-activity.jsonl") },
    toolsets: ["connector", "interactions"],
  })
  const file = await configFile(context, original)
  process.env[TOKEN_ALIAS] = TOKEN
  context.after(() => delete process.env[TOKEN_ALIAS])

  const first = planConfigRecipe({
    file,
    guildIds: [GUILD_ID],
    name: "guild-builder",
  })
  const second = planConfigRecipe({
    file,
    guildIds: [GUILD_ID],
    name: "guild-builder",
  })

  assert.equal(first.status, "planned")
  assert.equal(first.planDigest, second.planDigest)
  assert.match(first.planDigest, CONFIG_RECIPE_PLAN_DIGEST_PATTERN)
  assert.equal(first.execution.configurationWritten, false)
  assert.equal(first.execution.discordContacted, false)
  assert.equal(first.execution.secretValuesRead, false)
  assert.equal(JSON.stringify(first).includes(TOKEN), false)
  assert.deepEqual(first.proposedDocument.credential, original.credential)
  assert.deepEqual(first.proposedDocument.identity, original.identity)
  assert.deepEqual(first.proposedDocument.gateway, original.gateway)
  assert.deepEqual(first.proposedDocument.limits, original.limits)
  assert.deepEqual(first.proposedDocument.observability, original.observability)
  assert.deepEqual(first.proposedDocument.storage, original.storage)
  assert.deepEqual(first.proposedDocument.scopes.interactionChannelIds, [CHANNEL_ID])
  assert.deepEqual(first.proposedDocument.scopes.mentionUserIds, [USER_ID])
  for (const target of first.recipe.requirements.scope.targets) {
    const scopeName = target.slice("$.scopes.".length) as keyof ConnectorConfigDocument["scopes"]
    assert.deepEqual(first.proposedDocument.scopes[scopeName], [GUILD_ID])
    assert.equal(first.changes.some((change) => change.path === target), true)
  }
  assert.deepEqual(first.proposedDocument.tools.toolsets, [
    "connector",
    "guild-blueprints",
    "interactions",
  ])
  const runtime = loadConnectorConfigDocument(first.proposedDocument, {
    [TOKEN_ALIAS]: TOKEN,
  })
  assert.equal(runtime.allowGateway, false)
  assert.deepEqual([...guildChannelLayoutGuildIds(runtime)], [GUILD_ID])
  assert.throws(
    () => planConfigRecipe({
      file,
      guildIds: [OTHER_GUILD_ID],
      name: "guild-builder",
    }),
    /must remain inside readScope\.guildIds/,
  )
})

test("channel-publisher enforces explicit outer scope and explains an open channel boundary", async (context) => {
  const boundedFile = await configFile(context, document())
  assert.throws(
    () => planConfigRecipe({
      channelIds: [OTHER_CHANNEL_ID],
      file: boundedFile,
      name: "channel-publisher",
    }),
    /must remain inside readScope\.channelIds/,
  )

  const openFile = await configFile(
    context,
    document({ channelIds: [] }),
    "open-channels.json",
  )
  const plan = planConfigRecipe({
    channelIds: [OTHER_CHANNEL_ID],
    file: openFile,
    name: "channel-publisher",
  })
  assert.equal(plan.status, "planned")
  assert.deepEqual(plan.proposedDocument.scopes.embedMessageChannelIds, [OTHER_CHANNEL_ID])
  assert.deepEqual(plan.proposedDocument.scopes.interactionChannelIds, [OTHER_CHANNEL_ID])
  assert.deepEqual(plan.proposedDocument.tools.toolsets, [
    "connector",
    "embed-messages",
    "interactions",
    "message-writes",
    "messages",
  ])
  const runtime = loadConnectorConfigDocument(plan.proposedDocument, {
    [TOKEN_ALIAS]: TOKEN,
  })
  assert.equal(runtime.allowGateway, false)
  assert.deepEqual([...guildChannelLayoutGuildIds(runtime)], [])
  assert.equal(
    plan.warnings.some((warning) => warning.includes("offline planning cannot prove")),
    true,
  )
})

test("message-channel adds only exact-channel plain-message writes", async (context) => {
  const file = await configFile(context)
  const plan = planConfigRecipe({
    channelIds: [CHANNEL_ID],
    file,
    name: "message-channel",
  })

  assert.equal(plan.status, "planned")
  assert.deepEqual(plan.proposedDocument.tools.toolsets, [
    "connector",
    "message-writes",
  ])
  assert.deepEqual(plan.proposedDocument.capabilities, { interactions: true })
  assert.deepEqual(plan.proposedDocument.scopes.interactionChannelIds, [CHANNEL_ID])
  assert.equal("embedMessageChannelIds" in plan.proposedDocument.scopes, false)
  assert.equal(
    plan.recipe.requirements.botPermissions.includes("ADD_REACTIONS"),
    false,
  )
  assert.equal(
    plan.recipe.requirements.botPermissions.includes("EMBED_LINKS"),
    false,
  )
  assert.deepEqual(plan.recipe.requirements.privilegedIntents, [])

  const runtime = loadConnectorConfigDocument(plan.proposedDocument, {
    [TOKEN_ALIAS]: TOKEN,
  })
  assert.equal(runtime.allowInteractions, true)
  assert.equal(runtime.allowGateway, false)
  assert.deepEqual([...runtime.interactionChannelIds], [CHANNEL_ID])
})

test("coordination-channel adds only exact-channel directed routing policy", async (context) => {
  const file = await configFile(context)
  const plan = planConfigRecipe({
    channelIds: [CHANNEL_ID],
    file,
    name: "coordination-channel",
  })

  assert.equal(plan.status, "planned")
  assert.deepEqual(plan.proposedDocument.tools.toolsets, [
    "connector",
    "coordination",
  ])
  assert.deepEqual(plan.proposedDocument.capabilities, { interactions: true })
  assert.deepEqual(plan.proposedDocument.scopes.interactionChannelIds, [CHANNEL_ID])
  assert.equal("embedMessageChannelIds" in plan.proposedDocument.scopes, false)
  assert.equal(
    plan.recipe.requirements.botPermissions.includes("ADD_REACTIONS"),
    false,
  )
  assert.equal(
    plan.recipe.requirements.botPermissions.includes("EMBED_LINKS"),
    false,
  )
  assert.deepEqual(plan.recipe.requirements.privilegedIntents, [])

  const runtime = loadConnectorConfigDocument(plan.proposedDocument, {
    [TOKEN_ALIAS]: TOKEN,
  })
  assert.equal(runtime.allowInteractions, true)
  assert.equal(runtime.allowGateway, false)
  assert.deepEqual([...runtime.interactionChannelIds], [CHANNEL_ID])
})

test("incident-response adds only exact-guild incident policy", async (context) => {
  const original = document({
    capabilities: { interactions: true },
    scopes: { interactionChannelIds: [CHANNEL_ID] },
    toolsets: ["connector", "interactions"],
  })
  const file = await configFile(context, original)
  const plan = planConfigRecipe({
    file,
    guildIds: [GUILD_ID],
    name: "incident-response",
  })

  assert.equal(plan.status, "planned")
  assert.equal(plan.execution.configurationWritten, false)
  assert.equal(plan.execution.discordContacted, false)
  assert.equal(plan.execution.secretValuesRead, false)
  assert.equal(plan.proposedDocument.capabilities.guildIncidentAudit, true)
  assert.equal(plan.proposedDocument.capabilities.guildIncidentChanges, true)
  assert.equal(plan.proposedDocument.capabilities.interactions, true)
  assert.deepEqual(plan.proposedDocument.scopes.guildIncidentGuildIds, [GUILD_ID])
  assert.deepEqual(plan.proposedDocument.scopes.interactionChannelIds, [CHANNEL_ID])
  assert.deepEqual(plan.proposedDocument.gateway, original.gateway)
  assert.deepEqual(plan.proposedDocument.tools.toolsets, [
    "connector",
    "guild-incidents",
    "interactions",
  ])
  const runtime = loadConnectorConfigDocument(plan.proposedDocument, {
    [TOKEN_ALIAS]: TOKEN,
  })
  assert.equal(runtime.allowGuildIncidentAudit, true)
  assert.equal(runtime.allowGuildIncidentChanges, true)
  assert.equal(runtime.allowGateway, false)
  assert.throws(
    () => planConfigRecipe({
      file,
      guildIds: [OTHER_GUILD_ID],
      name: "incident-response",
    }),
    /must remain inside readScope\.guildIds/,
  )
})

test("direct-messenger adds only exact-user private-message policy", async (context) => {
  const original = document({
    capabilities: { interactions: true },
    scopes: { interactionChannelIds: [CHANNEL_ID] },
    toolsets: ["connector", "interactions"],
  })
  const file = await configFile(context, original)
  const plan = planConfigRecipe({
    file,
    name: "direct-messenger",
    userIds: [USER_ID],
  })

  assert.equal(plan.status, "planned")
  assert.equal(plan.execution.configurationWritten, false)
  assert.equal(plan.execution.discordContacted, false)
  assert.equal(plan.execution.secretValuesRead, false)
  assert.equal(plan.proposedDocument.capabilities.directMessageAudit, true)
  assert.equal(plan.proposedDocument.capabilities.directMessageDeletion, true)
  assert.equal(plan.proposedDocument.capabilities.directMessageDelivery, true)
  assert.equal(plan.proposedDocument.capabilities.directMessageEditing, true)
  assert.equal(plan.proposedDocument.capabilities.interactions, true)
  assert.deepEqual(plan.proposedDocument.scopes.directMessageUserIds, [USER_ID])
  assert.deepEqual(plan.proposedDocument.scopes.interactionChannelIds, [CHANNEL_ID])
  assert.deepEqual(plan.proposedDocument.readScope, original.readScope)
  assert.deepEqual(plan.proposedDocument.gateway, original.gateway)
  assert.deepEqual(plan.proposedDocument.tools.toolsets, [
    "connector",
    "direct-messages",
    "interactions",
  ])
  const runtime = loadConnectorConfigDocument(plan.proposedDocument, {
    [TOKEN_ALIAS]: TOKEN,
  })
  assert.equal(runtime.allowDirectMessageAudit, true)
  assert.equal(runtime.allowDirectMessageDeletion, true)
  assert.equal(runtime.allowDirectMessageDelivery, true)
  assert.equal(runtime.allowDirectMessageEditing, true)
  assert.deepEqual([...runtime.directMessageUserIds], [USER_ID])
  assert.equal(runtime.allowGateway, false)
})

test("recipe plans bind the exact request and normalized file path", async (context) => {
  const original = document({ channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID] })
  const firstFile = await configFile(context, original, "first.json")
  const secondFile = await configFile(context, original, "second.json")
  const first = planConfigRecipe({
    channelIds: [CHANNEL_ID],
    file: firstFile,
    name: "channel-publisher",
  })
  const otherRequest = planConfigRecipe({
    channelIds: [OTHER_CHANNEL_ID],
    file: firstFile,
    name: "channel-publisher",
  })
  const otherFile = planConfigRecipe({
    channelIds: [CHANNEL_ID],
    file: secondFile,
    name: "channel-publisher",
  })
  assert.notEqual(first.planDigest, otherRequest.planDigest)
  assert.notEqual(first.planDigest, otherFile.planDigest)
  assert.notEqual(first.proposedDocumentDigest, otherRequest.proposedDocumentDigest)
})

test("recipe plans emit exact immutable apply commands for every scope kind", async (context) => {
  const file = await configFile(
    context,
    document({
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      guildIds: [GUILD_ID, OTHER_GUILD_ID],
    }),
  )
  const cases = [
    {
      name: "incident-response",
      option: "--guild-id",
      selection: { guildIds: [OTHER_GUILD_ID, GUILD_ID] },
    },
    {
      name: "message-channel",
      option: "--channel-id",
      selection: { channelIds: [OTHER_CHANNEL_ID, CHANNEL_ID] },
    },
    {
      name: "direct-messenger",
      option: "--user-id",
      selection: { userIds: [USER_ID] },
    },
  ] as const

  for (const entry of cases) {
    const plan = planConfigRecipe({
      file,
      name: entry.name,
      ...entry.selection,
    })
    assert.deepEqual(plan.applyCommand, {
      args: [
        "recipe",
        "apply",
        entry.name,
        file,
        ...plan.request.scope.ids.flatMap((id) => [entry.option, id]),
        "--plan-digest",
        plan.planDigest,
        "--confirm",
        entry.name,
      ],
      command: "guildcontrol",
    })
    assert.equal(Object.isFrozen(plan.applyCommand), true)
    assert.equal(Object.isFrozen(plan.applyCommand.args), true)
  }
})

test("recipe application requires exact review and preserves a recoverable backup", async (context) => {
  const original = document()
  const file = await configFile(context, original)
  const selection = {
    channelIds: [CHANNEL_ID],
    file,
    name: "channel-publisher",
  }
  const plan = planConfigRecipe(selection)

  await assert.rejects(
    () => applyConfigRecipe({
      ...selection,
      confirmation: "CHANNEL-PUBLISHER",
      planDigest: plan.planDigest,
    }),
    /confirmation must exactly match channel-publisher/,
  )
  await assert.rejects(
    () => applyConfigRecipe({
      ...selection,
      confirmation: "channel-publisher",
      planDigest: `sha256:${"0".repeat(64)}`,
    }),
    /plan is stale or does not match/,
  )

  const applied = await applyConfigRecipe({
    ...selection,
    confirmation: "channel-publisher",
    planDigest: plan.planDigest,
  })
  assert.equal(applied.status, "applied")
  assert.equal(applied.applied, true)
  assert.deepEqual(applied.applyCommand, plan.applyCommand)
  assert.equal(applied.execution.configurationWritten, true)
  assert.ok(applied.backupFile)
  assert.deepEqual(loadConnectorConfigDocumentFile(file), plan.proposedDocument)
  assert.deepEqual(
    loadConnectorConfigDocumentFile(applied.backupFile as string),
    original,
  )

  const currentPlan = planConfigRecipe(selection)
  assert.equal(currentPlan.status, "already-current")
  const noOp = await applyConfigRecipe({
    ...selection,
    confirmation: "channel-publisher",
    planDigest: currentPlan.planDigest,
  })
  assert.equal(noOp.status, "already-current")
  assert.equal(noOp.applied, false)
  assert.deepEqual(noOp.applyCommand, currentPlan.applyCommand)
  assert.equal(noOp.execution.configurationWritten, false)
  assert.equal(noOp.backupFile, undefined)
})

test("recipe application rejects a source changed after review", async (context) => {
  const original = document({ channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID] })
  const file = await configFile(context, original)
  const selection = {
    channelIds: [CHANNEL_ID],
    file,
    name: "channel-publisher",
  }
  const plan = planConfigRecipe(selection)
  await writeConnectorConfigDocumentFile(
    file,
    document({
      channelIds: [CHANNEL_ID, OTHER_CHANNEL_ID],
      limits: { interactionMaxWritesPerMinute: 9 },
    }),
    { overwrite: true },
  )
  await assert.rejects(
    () => applyConfigRecipe({
      ...selection,
      confirmation: "channel-publisher",
      planDigest: plan.planDigest,
    }),
    /plan is stale or does not match/,
  )
})
