import assert from "node:assert/strict"
import test from "node:test"

import { loadConnectorConfigDocument } from "../src/config.js"
import { createConnectorConfigDocument } from "../src/config-document.js"
import {
  DISCORD_CHANNEL_FLAGS,
  DISCORD_CHANNEL_TYPES,
} from "../src/constants.js"
import {
  GuildBlueprintCaptureService,
  normalizeGuildBlueprintCaptureRequest,
} from "../src/guild-blueprint-capture-service.js"
import { normalizeGuildBlueprintRequest } from "../src/guild-blueprint-service.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordRole,
} from "../src/types.js"
import {
  DISCORD_AUTO_MODERATION_ACTION_TYPES,
  DISCORD_AUTO_MODERATION_EVENT_TYPES,
  DISCORD_AUTO_MODERATION_TRIGGER_TYPES,
  type DiscordAutoModerationRuleSummary,
  type DiscordGuildOnboarding,
  type DiscordGuildWelcomeScreen,
} from "../src/discord-client.js"

const APPLICATION_ID = "900000000000000001"
const BOT_ID = "900000000000000002"
const GUILD_ID = "100000000000000001"
const ROLE_ID = "300000000000000001"
const SECOND_ROLE_ID = "300000000000000002"
const THIRD_ROLE_ID = "300000000000000003"
const FOURTH_ROLE_ID = "300000000000000004"
const FIFTH_ROLE_ID = "300000000000000005"
const CHANNEL_ID = "200000000000000001"
const VOICE_CHANNEL_ID = "200000000000000002"
const SECOND_CHANNEL_ID = "200000000000000003"
const THIRD_CHANNEL_ID = "200000000000000004"
const FOURTH_CHANNEL_ID = "200000000000000005"
const FIFTH_CHANNEL_ID = "200000000000000006"
const MISSING_CHANNEL_ID = "200000000000000099"
const MISSING_ROLE_ID = "300000000000000099"
const AUTOMOD_RULE_ID = "800000000000000001"
const TOKEN_VARIABLE = "DISCORD_CAPTURE_TEST_TOKEN"
const OPERATION_KEY = "guild-blueprint-capture-operation-0001"
const AUDIT_REASON = "Restore the reviewed caller-retained guild blueprint"

interface CapturePass {
  autoModerationRules: DiscordAutoModerationRuleSummary[]
  channels: DiscordChannel[]
  guild: DiscordGuild
  onboarding: DiscordGuildOnboarding
  roles: DiscordRole[]
  welcomeScreen: DiscordGuildWelcomeScreen | null
}

function everyoneRole(): DiscordRole {
  return {
    color: 0,
    colors: {
      primary_color: 0,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: false,
    id: GUILD_ID,
    managed: false,
    mentionable: false,
    name: "@everyone",
    permissions: "1024",
    position: 0,
  }
}

function standardRole(
  id = ROLE_ID,
  overrides: Partial<DiscordRole> = {},
): DiscordRole {
  return {
    color: 5_793_266,
    colors: {
      primary_color: 5_793_266,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: true,
    id,
    managed: false,
    mentionable: false,
    name: "Members",
    permissions: "1024",
    position: 1,
    ...overrides,
  }
}

function textChannel(
  id = CHANNEL_ID,
  overrides: Partial<DiscordChannel> = {},
): DiscordChannel {
  return {
    default_auto_archive_duration: 1_440,
    flags: 0,
    guild_id: GUILD_ID,
    id,
    name: "general",
    nsfw: false,
    parent_id: null,
    permission_overwrites: [],
    position: 0,
    rate_limit_per_user: 0,
    topic: "General discussion",
    type: DISCORD_CHANNEL_TYPES.text,
    ...overrides,
  }
}

function autoModerationRule(
  overrides: Partial<DiscordAutoModerationRuleSummary> = {},
): DiscordAutoModerationRuleSummary {
  return {
    actions: [{
      customMessage: "Keep it civil",
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
    }, {
      channelId: CHANNEL_ID,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage,
    }],
    creatorUserId: BOT_ID,
    enabled: true,
    eventType: DISCORD_AUTO_MODERATION_EVENT_TYPES.messageSend,
    exemptChannelIds: [CHANNEL_ID],
    exemptRoleIds: [ROLE_ID],
    guildId: GUILD_ID,
    id: AUTOMOD_RULE_ID,
    name: "Community safety",
    trigger: {
      allowList: [],
      keywordFilter: ["blocked phrase"],
      regexPatterns: [],
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword,
    },
    unknownFieldCount: 0,
    ...overrides,
  }
}

function capturePass(overrides: Partial<CapturePass> = {}): CapturePass {
  return {
    autoModerationRules: [],
    channels: [textChannel()],
    guild: {
      afk_channel_id: null,
      afk_timeout: 300,
      banner: null,
      default_message_notifications: 1,
      description: "A private community",
      discovery_splash: null,
      explicit_content_filter: 2,
      features: ["COMMUNITY", "WELCOME_SCREEN_ENABLED"],
      icon: null,
      id: GUILD_ID,
      name: "Private source guild",
      owner_id: "400000000000000001",
      premium_progress_bar_enabled: false,
      splash: null,
      system_channel_flags: 1,
      system_channel_id: CHANNEL_ID,
      verification_level: 2,
    },
    onboarding: {
      defaultChannelIds: [CHANNEL_ID],
      enabled: false,
      guildId: GUILD_ID,
      mode: 1,
      prompts: [{
        id: "500000000000000001",
        inOnboarding: true,
        options: [{
          channelIds: [CHANNEL_ID],
          description: "Follow community discussion",
          emoji: { animated: false, id: null, name: "👋" },
          id: "600000000000000001",
          roleIds: [ROLE_ID],
          title: "Community member",
        }],
        required: false,
        singleSelect: true,
        title: "Choose a path",
        type: 0,
      }],
      unknownEnumCount: 0,
      unknownFieldCount: 0,
    },
    roles: [standardRole(), everyoneRole()],
    welcomeScreen: {
      description: "Welcome",
      unknownFieldCount: 0,
      welcomeChannels: [{
        channelId: CHANNEL_ID,
        description: "Start here",
        emojiId: null,
        emojiName: "👋",
        unknownFieldCount: 0,
      }],
    },
    ...overrides,
  }
}

function policy(capabilities: Record<string, boolean> = {
  automodAudit: true,
  guildProfileAudit: true,
  guildSettingsAudit: true,
  onboardingAudit: true,
  welcomeScreenAudit: true,
}, channelIds: readonly string[] = []): ScopePolicy {
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    capabilities,
    channelIds,
    credentialVariable: TOKEN_VARIABLE,
    guildIds: [GUILD_ID],
    name: "capture-test",
    scopes: {
      automodGuildIds: [GUILD_ID],
      guildProfileGuildIds: [GUILD_ID],
      guildSettingsGuildIds: [GUILD_ID],
      onboardingGuildIds: [GUILD_ID],
      welcomeScreenGuildIds: [GUILD_ID],
    },
    toolsets: ["guild-blueprints"],
    toolSurface: "full",
  })
  return new ScopePolicy(loadConnectorConfigDocument(document, {
    [TOKEN_VARIABLE]: "test-token",
  }))
}

function fixture(
  passes: CapturePass[],
  selectedPolicy = policy(),
) {
  let passIndex = -1
  const calls = {
    autoModerationRules: 0,
    channels: 0,
    guild: 0,
    onboarding: 0,
    roles: 0,
    welcomeScreen: 0,
  }
  const current = (): CapturePass => {
    const selected = passes[passIndex]
    if (!selected) throw new Error("Missing capture pass fixture")
    return selected
  }
  const service = new GuildBlueprintCaptureService({
    client: {
      async getGuild() {
        calls.guild += 1
        passIndex += 1
        return structuredClone(current().guild)
      },
      async getGuildChannels() {
        calls.channels += 1
        return structuredClone(current().channels)
      },
      async getGuildOnboarding() {
        calls.onboarding += 1
        return structuredClone(current().onboarding)
      },
      async getGuildRoles() {
        calls.roles += 1
        return structuredClone(current().roles)
      },
      async getGuildWelcomeScreen() {
        calls.welcomeScreen += 1
        return structuredClone(current().welcomeScreen)
      },
      async listGuildAutoModerationRules() {
        calls.autoModerationRules += 1
        return structuredClone(current().autoModerationRules)
      },
    },
    clock: (() => {
      const values = [
        new Date("2026-08-24T00:00:00.000Z"),
        new Date("2026-08-24T00:00:01.000Z"),
      ]
      return () => values.shift() ?? new Date("2026-08-24T00:00:01.000Z")
    })(),
    policy: selectedPolicy,
  })
  return { calls, service }
}

function request() {
  return {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
  }
}

test("guild blueprint capture returns one strict planner-ready caller-retained input", async () => {
  const pass = capturePass()
  const { calls, service } = fixture([pass, pass])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "ready")
  assert.equal(result.plannerReady, true)
  assert.equal(result.freshPlanRequired, true)
  assert.equal(result.nextAction, "retain-blueprint-and-plan")
  assert.deepEqual(result.limitations, {
    atomicSnapshot: false,
    completeBackup: false,
    crossGuildPortable: false,
    messageRecovery: false,
    originalIdRestoration: false,
    rollback: false,
  })
  assert.match(result.captureDigest as string, /^sha256:[a-f0-9]{64}$/u)
  assert.deepEqual(result.omissions, [])
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(calls, {
    autoModerationRules: 2,
    channels: 2,
    guild: 2,
    onboarding: 2,
    roles: 2,
    welcomeScreen: 2,
  })
  assert.equal(result.captureWindow.stable, true)
  assert.equal(result.privacy.messageContent, "not-read")
  assert.equal(result.privacy.memberProfiles, "not-read")
  assert.equal(result.privacy.serverPersistence, "none")
  assert.ok(result.blueprint)
  assert.doesNotThrow(() => normalizeGuildBlueprintRequest(result.blueprint!))
  assert.deepEqual(result.blueprint!.settings?.systemChannel, {
    key: `channel-${CHANNEL_ID}`,
    kind: "scaffold",
  })
  assert.deepEqual(result.blueprint!.welcomeScreen?.channels[0]?.channel, {
    key: `channel-${CHANNEL_ID}`,
    kind: "scaffold",
  })
  assert.deepEqual(result.blueprint!.onboarding?.prompts[0]?.options[0]?.roles, [{
    key: `role-${ROLE_ID}`,
    kind: "scaffold",
  }])
  assert.equal(JSON.stringify(result).includes("test-token"), false)
})

test("guild blueprint capture returns no torn blueprint when the second pass changes", async () => {
  const first = capturePass()
  const second = capturePass({
    guild: { ...first.guild, name: "Changed during capture" },
  })
  const { service } = fixture([first, second])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "changed-during-capture")
  assert.equal(result.captureWindow.stable, false)
  assert.equal(result.nextAction, "retry-capture")
  assert.equal(result.blueprint, null)
  assert.equal(result.captureDigest, null)
  assert.equal(result.coverage, null)
  assert.deepEqual(result.omissions, [])
  assert.deepEqual(result.blockers.map((entry) => entry.code), ["CAPTURE_CHANGED"])
  assert.doesNotMatch(JSON.stringify(result), /Changed during capture/u)
})

test("guild blueprint capture retains complete exact-ID AutoMod policy with scaffold references", async () => {
  const pass = capturePass({ autoModerationRules: [autoModerationRule()] })
  const { service } = fixture([pass, pass])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "ready")
  assert.equal(result.coverage?.autoModerationRules.captured, 1)
  assert.equal(result.coverage?.autoModerationRules.returned, 1)
  assert.deepEqual(result.blueprint?.autoModerationRules, [{
    actions: [{
      customMessage: "Keep it civil",
      type: "block-message",
    }, {
      channel: { key: `channel-${CHANNEL_ID}`, kind: "scaffold" },
      type: "send-alert-message",
    }],
    enabled: true,
    exemptChannels: [{ key: `channel-${CHANNEL_ID}`, kind: "scaffold" }],
    exemptRoles: [{ key: `role-${ROLE_ID}`, kind: "scaffold" }],
    key: `automod-${AUTOMOD_RULE_ID}`,
    name: "Community safety",
    ruleId: AUTOMOD_RULE_ID,
    trigger: {
      allowList: [],
      keywordFilter: ["blocked phrase"],
      regexPatterns: [],
      type: "keyword",
    },
  }])
  assert.equal(result.coverage?.exactChannelReferences, 0)
  assert.equal(result.coverage?.exactRoleReferences, 0)
})

test("guild blueprint capture includes AutoMod policy in two-pass stability", async () => {
  const first = capturePass({ autoModerationRules: [autoModerationRule()] })
  const second = capturePass({
    autoModerationRules: [autoModerationRule({
      actions: [{
        customMessage: "Changed policy",
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
      }],
    })],
  })
  const result = await fixture([first, second]).service.capture(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )

  assert.equal(result.status, "changed-during-capture")
  assert.equal(result.blueprint, null)
  assert.doesNotMatch(JSON.stringify(result), /Changed policy/u)
})

test("guild blueprint capture blocks unknown or unresolved AutoMod evidence", async () => {
  const rule = autoModerationRule({
    actions: [{
      channelId: MISSING_CHANNEL_ID,
      type: DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage,
    }],
    exemptRoleIds: [MISSING_ROLE_ID],
    unknownFieldCount: 1,
  })
  const pass = capturePass({ autoModerationRules: [rule] })
  const result = await fixture([pass, pass]).service.capture(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )

  assert.equal(result.status, "blocked")
  assert.equal(result.blueprint, null)
  const codes = new Set(result.blockers.map(({ code }) => code))
  assert.equal(codes.has("AUTOMOD_UNKNOWN_EVIDENCE"), true)
  assert.equal(codes.has("CHANNEL_REFERENCE_UNRESOLVED"), true)
  assert.equal(codes.has("ROLE_REFERENCE_UNRESOLVED"), true)
})

test("guild blueprint capture detects drift between unknown system flag values", async () => {
  const first = capturePass({
    guild: { ...capturePass().guild, system_channel_flags: 1 << 10 },
  })
  const second = capturePass({
    guild: { ...capturePass().guild, system_channel_flags: 1 << 11 },
  })
  const { service } = fixture([first, second])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "changed-during-capture")
  assert.equal(result.blueprint, null)
})

test("guild blueprint capture detects drift in unknown channel evidence", async () => {
  const first = capturePass({
    channels: [{ ...textChannel(), future_semantics: true } as DiscordChannel],
  })
  const second = capturePass()
  const { service } = fixture([first, second])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "changed-during-capture")
  assert.equal(result.blueprint, null)
})

test("guild blueprint capture applies the configured channel boundary", async () => {
  const excludedName = "private-operator-channel"
  const excludedTopic = "Private operator notes"
  const pass = capturePass({
    channels: [
      textChannel(),
      textChannel(SECOND_CHANNEL_ID, {
        id: SECOND_CHANNEL_ID,
        name: excludedName,
        position: 1,
        topic: excludedTopic,
      }),
    ],
  })
  const { service } = fixture([pass, pass], policy(undefined, [CHANNEL_ID]))
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "ready")
  assert.equal(result.coverage?.channels.returned, 1)
  assert.equal(result.coverage?.channels.captured, 1)
  assert.equal(JSON.stringify(result).includes(excludedName), false)
  assert.equal(JSON.stringify(result).includes(excludedTopic), false)
})

test("guild blueprint capture exposes every lossy boundary and retains exact references", async () => {
  const base = capturePass()
  const pass = capturePass({
    channels: [
      textChannel(CHANNEL_ID, {
        permission_overwrites: [{
          allow: "1024",
          deny: "0",
          id: GUILD_ID,
          type: 0,
        }],
      }),
      textChannel("200000000000000003", {
        available_tags: [{
          id: "700000000000000001",
          moderated: false,
          name: "Support",
        }],
        default_forum_layout: 1,
        flags: DISCORD_CHANNEL_FLAGS.requireTag,
        id: "200000000000000003",
        name: "support",
        position: 1,
        type: DISCORD_CHANNEL_TYPES.forum,
      }),
      {
        bitrate: 64_000,
        guild_id: GUILD_ID,
        id: VOICE_CHANNEL_ID,
        name: "Lobby",
        parent_id: null,
        permission_overwrites: [],
        position: 2,
        type: DISCORD_CHANNEL_TYPES.voice,
        user_limit: 0,
      },
    ],
    guild: {
      ...base.guild,
      afk_channel_id: VOICE_CHANNEL_ID,
      system_channel_flags: 1 << 10,
    },
    onboarding: {
      ...base.onboarding,
      prompts: [{
        ...base.onboarding.prompts[0]!,
        options: [{
          ...base.onboarding.prompts[0]!.options[0]!,
          roleIds: [SECOND_ROLE_ID],
        }],
      }],
    },
    roles: [
      standardRole(),
      standardRole("300000000000000002", {
        id: "300000000000000002",
        managed: true,
        name: "Managed integration",
        position: 2,
      }),
      standardRole("300000000000000003", {
        id: "300000000000000003",
        name: "Administrators",
        permissions: (1n << 3n).toString(),
        position: 3,
      }),
      everyoneRole(),
    ],
  })
  const { service } = fixture([pass, pass])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "review-required")
  assert.equal(result.plannerReady, true)
  assert.equal(result.nextAction, "review-or-edit-omissions-before-plan")
  assert.ok(result.blueprint)
  assert.doesNotThrow(() => normalizeGuildBlueprintRequest(result.blueprint!))
  const codes = new Set(result.omissions.map((entry) => entry.code))
  for (const expected of [
    "CHANNEL_FORUM_CONFIGURATION_OMITTED",
    "CHANNEL_ORDER_OMITTED",
    "CHANNEL_PERMISSION_OVERWRITES_OMITTED",
    "CHANNEL_UNSUPPORTED_TYPE",
    "EXACT_CHANNEL_REFERENCE_RETAINED",
    "EXACT_ROLE_REFERENCE_RETAINED",
    "ROLE_ADMINISTRATOR_OMITTED",
    "ROLE_MANAGED_OMITTED",
    "SETTINGS_UNKNOWN_SYSTEM_FLAGS",
  ]) assert.equal(codes.has(expected as never), true, expected)
  assert.deepEqual(result.blueprint!.settings?.afkChannel, {
    channelId: VOICE_CHANNEL_ID,
    kind: "exact",
  })
  assert.equal(
    Object.hasOwn(result.blueprint!.settings as object, "suppressedSystemNotifications"),
    false,
  )
})

test("guild blueprint capture blocks ambiguous additive identity", async () => {
  const pass = capturePass({
    roles: [
      standardRole(),
      standardRole("300000000000000002", {
        id: "300000000000000002",
        name: "members",
        position: 2,
      }),
      everyoneRole(),
    ],
  })
  const { service } = fixture([pass, pass])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "blocked")
  assert.equal(result.nextAction, "resolve-blockers-and-recapture")
  assert.equal(result.plannerReady, false)
  assert.equal(result.blueprint, null)
  assert.equal(result.captureDigest, null)
  assert.equal(
    result.blockers.some((entry) => entry.code === "ROLE_AMBIGUOUS_NAME"),
    true,
  )
})

test("guild blueprint capture blocks unknown enums and unresolved references", async () => {
  const base = capturePass()
  const pass = capturePass({
    guild: {
      ...base.guild,
      verification_level: 99,
    },
    onboarding: {
      ...base.onboarding,
      prompts: [{
        ...base.onboarding.prompts[0]!,
        options: [{
          ...base.onboarding.prompts[0]!.options[0]!,
          roleIds: [MISSING_ROLE_ID],
        }],
      }],
      unknownEnumCount: 1,
    },
    welcomeScreen: {
      ...base.welcomeScreen!,
      welcomeChannels: [{
        ...base.welcomeScreen!.welcomeChannels[0]!,
        channelId: MISSING_CHANNEL_ID,
      }],
    },
  })
  const { service } = fixture([pass, pass])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "blocked")
  assert.equal(result.blueprint, null)
  assert.equal(result.captureDigest, null)
  const codes = new Set(result.blockers.map((entry) => entry.code))
  assert.equal(codes.has("SETTINGS_UNKNOWN_ENUM"), true)
  assert.equal(codes.has("ONBOARDING_UNKNOWN_ENUM"), true)
  assert.equal(codes.has("CHANNEL_REFERENCE_UNRESOLVED"), true)
  assert.equal(codes.has("ROLE_REFERENCE_UNRESOLVED"), true)
})

test("guild blueprint capture identifies every additional lossy scaffold boundary", async () => {
  const base = capturePass()
  const pass = capturePass({
    channels: [
      textChannel(),
      textChannel(SECOND_CHANNEL_ID, {
        id: SECOND_CHANNEL_ID,
        name: " unsupported ",
        position: 1,
      }),
      {
        bitrate: 64_000,
        guild_id: GUILD_ID,
        id: VOICE_CHANNEL_ID,
        name: "Lobby",
        parent_id: null,
        permission_overwrites: [],
        position: 2,
        type: DISCORD_CHANNEL_TYPES.voice,
        user_limit: 0,
      },
      textChannel(THIRD_CHANNEL_ID, {
        id: THIRD_CHANNEL_ID,
        name: "voice-child",
        parent_id: VOICE_CHANNEL_ID,
        position: 3,
      }),
      textChannel(FOURTH_CHANNEL_ID, {
        id: FOURTH_CHANNEL_ID,
        name: "updates",
        position: 4,
      }),
      {
        ...textChannel(FIFTH_CHANNEL_ID, {
          id: FIFTH_CHANNEL_ID,
          name: "future-channel",
          position: 5,
        }),
        future_semantics: true,
      } as DiscordChannel,
    ],
    onboarding: {
      ...base.onboarding,
      unknownFieldCount: 1,
    },
    roles: [
      standardRole(ROLE_ID, {
        colors: {
          primary_color: 5_793_266,
          secondary_color: 1,
          tertiary_color: null,
        },
        icon: "private-role-icon-hash",
      }),
      standardRole(SECOND_ROLE_ID, {
        id: SECOND_ROLE_ID,
        name: "Helpers",
        position: 2,
      }),
      standardRole(THIRD_ROLE_ID, {
        id: THIRD_ROLE_ID,
        name: "Future permission",
        permissions: (1n << 60n).toString(),
        position: 3,
      }),
      standardRole(FOURTH_ROLE_ID, {
        id: FOURTH_ROLE_ID,
        name: " Untrimmed ",
        position: 4,
      }),
      {
        ...standardRole(FIFTH_ROLE_ID, {
          id: FIFTH_ROLE_ID,
          name: "Future role",
          position: 5,
        }),
        future_semantics: true,
      } as DiscordRole,
      everyoneRole(),
    ],
  })
  const { service } = fixture([pass, pass])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "review-required")
  const codes = new Set(result.omissions.map((entry) => entry.code))
  for (const expected of [
    "CHANNEL_ORDER_OMITTED",
    "CHANNEL_PARENT_OMITTED",
    "CHANNEL_UNREPRESENTABLE",
    "CHANNEL_UNSUPPORTED_TYPE",
    "CHANNEL_UNKNOWN_EVIDENCE",
    "ONBOARDING_UNKNOWN_EVIDENCE",
    "ROLE_COSMETICS_OMITTED",
    "ROLE_ORDER_OMITTED",
    "ROLE_UNKNOWN_PERMISSION_BITS",
    "ROLE_UNKNOWN_EVIDENCE",
    "ROLE_UNREPRESENTABLE",
  ]) assert.equal(codes.has(expected as never), true, expected)
})

test("guild blueprint capture reports unavailable and unknown Welcome Screen evidence", async () => {
  const base = capturePass()
  const unavailable = capturePass({ welcomeScreen: null })
  const unavailableResult = await fixture([unavailable, unavailable]).service.capture(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  assert.equal(
    unavailableResult.omissions.some((entry) => entry.code === "WELCOME_SCREEN_UNAVAILABLE"),
    true,
  )

  const unknown = capturePass({
    welcomeScreen: {
      ...base.welcomeScreen!,
      unknownFieldCount: 1,
      welcomeChannels: [{
        ...base.welcomeScreen!.welcomeChannels[0]!,
        unknownFieldCount: 1,
      }],
    },
  })
  const unknownResult = await fixture([unknown, unknown]).service.capture(
    APPLICATION_ID,
    BOT_ID,
    request(),
  )
  assert.equal(
    unknownResult.omissions.some((entry) => (
      entry.code === "WELCOME_SCREEN_UNKNOWN_EVIDENCE"
    )),
    true,
  )
})

test("guild blueprint capture blocks live profile text outside the planner contract", async () => {
  const base = capturePass()
  const pass = capturePass({
    guild: {
      ...base.guild,
      description: "",
    },
  })
  const { service } = fixture([pass, pass])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "blocked")
  assert.equal(result.blueprint, null)
  assert.equal(
    result.blockers.some((entry) => entry.code === "BLUEPRINT_VALIDATION_FAILED"),
    true,
  )
})

test("guild blueprint capture rejects malformed Discord profile Unicode", async () => {
  const base = capturePass()
  const pass = capturePass({
    guild: {
      ...base.guild,
      description: "Invalid\uD800description",
    },
  })
  const { service } = fixture([pass, pass])

  await assert.rejects(
    service.capture(APPLICATION_ID, BOT_ID, request()),
    /invalid guild profile evidence/u,
  )
})

test("guild blueprint capture rejects malformed Discord role Unicode", async () => {
  const pass = capturePass({
    roles: [
      standardRole(ROLE_ID, { name: "Invalid\uD800role" }),
      everyoneRole(),
    ],
  })
  const { service } = fixture([pass, pass])

  await assert.rejects(
    service.capture(APPLICATION_ID, BOT_ID, request()),
    /invalid Unicode in role evidence/u,
  )
})

test("guild blueprint capture rejects unbounded channel evidence", async () => {
  for (const malformed of [
    textChannel(CHANNEL_ID, { permission_overwrites: {} as never }),
    textChannel(CHANNEL_ID, { available_tags: {} as never }),
    textChannel(CHANNEL_ID, { position: -1 }),
    textChannel(CHANNEL_ID, { flags: -1 }),
  ]) {
    const pass = capturePass({ channels: [malformed] })
    const { service } = fixture([pass, pass])
    await assert.rejects(
      service.capture(APPLICATION_ID, BOT_ID, request()),
      /invalid .*capture evidence/iu,
    )
  }
})

test("guild blueprint capture reports bounded truncation without silent completeness", async () => {
  const roles = Array.from({ length: 11 }, (_, index) => standardRole(
    `3000000000000000${String(index + 10).padStart(2, "0")}`,
    {
      id: `3000000000000000${String(index + 10).padStart(2, "0")}`,
      name: `Role ${index + 1}`,
      position: index + 1,
    },
  ))
  const pass = capturePass({ roles: [standardRole(), ...roles, everyoneRole()] })
  const { service } = fixture([pass, pass])
  const result = await service.capture(APPLICATION_ID, BOT_ID, request())

  assert.equal(result.status, "review-required")
  assert.equal(result.coverage?.roles.captured, 10)
  assert.equal(
    result.omissions.filter((entry) => entry.code === "BLUEPRINT_RESOURCE_LIMIT").length,
    2,
  )
})

test("guild blueprint capture composes every existing audit policy before Discord reads", async () => {
  const pass = capturePass()
  const { calls, service } = fixture([pass, pass], policy({
    guildProfileAudit: true,
    guildSettingsAudit: true,
    onboardingAudit: true,
    welcomeScreenAudit: false,
  }))

  await assert.rejects(
    service.capture(APPLICATION_ID, BOT_ID, request()),
    /Welcome Screen audit is disabled/u,
  )
  assert.deepEqual(calls, {
    autoModerationRules: 0,
    channels: 0,
    guild: 0,
    onboarding: 0,
    roles: 0,
    welcomeScreen: 0,
  })
})

test("guild blueprint capture requires AutoMod audit policy before Discord reads", async () => {
  const pass = capturePass()
  const { calls, service } = fixture([pass, pass], policy({
    automodAudit: false,
    guildProfileAudit: true,
    guildSettingsAudit: true,
    onboardingAudit: true,
    welcomeScreenAudit: true,
  }))

  await assert.rejects(
    service.capture(APPLICATION_ID, BOT_ID, request()),
    /AutoMod audit is disabled/u,
  )
  assert.deepEqual(calls, {
    autoModerationRules: 0,
    channels: 0,
    guild: 0,
    onboarding: 0,
    roles: 0,
    welcomeScreen: 0,
  })
})

test("guild blueprint capture validates its exact envelope before policy or network", async () => {
  assert.throws(
    () => normalizeGuildBlueprintCaptureRequest({
      ...request(),
      extra: true,
    } as never),
    /exact object/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintCaptureRequest({
      ...request(),
      operationKey: "short",
    }),
    /operation key/u,
  )
})
