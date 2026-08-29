import { CONNECTOR_LIMITS } from "./constants.js"
import {
  normalizeGuildBlueprintRequest,
  type GuildBlueprintRequest,
  type GuildBlueprintScaffoldInput,
} from "./guild-blueprint-service.js"

export const GUILD_BLUEPRINT_STARTER_NAMES = [
  "community",
  "creator",
  "project",
  "support",
] as const

export type GuildBlueprintStarterName =
  typeof GUILD_BLUEPRINT_STARTER_NAMES[number]

export const GUILD_BLUEPRINT_STARTER_VERSION = 1

export const GUILD_BLUEPRINT_STARTER_PRINCIPLES = Object.freeze([
  "Keep the initial public layout compact and add channels only when activity justifies them",
  "Create no private or read-only area until exact channel IDs are proven and permission overwrites are reviewed",
  "Create no Administrator role and assign no role through a starter",
  "Use symbolic keys only for requested additive resources; fresh scaffold planning may accept one exact-state logical-name match but blocks ambiguity or drift",
  "Treat every compiled name and topic as editable presentation data, not authority",
  "Plan and execute one fresh blueprint frontier at a time",
])

export const GUILD_BLUEPRINT_STARTER_OMISSIONS = Object.freeze([
  "application-or-bot-identity-selection",
  "automod",
  "channel-ordering",
  "community-enablement",
  "existing-role-or-channel-convergence",
  "member-or-role-assignment",
  "onboarding",
  "permission-overwrites",
  "private-areas",
  "publications",
  "read-only-enforcement",
  "role-creation-and-ordering",
  "verification-level-change",
  "welcome-screen",
])

export interface GuildBlueprintStarterInput {
  auditReason: string
  guildId: string
  guildName?: string
  operationKey: string
  starter: GuildBlueprintStarterName
}

interface GuildBlueprintStarterDefinition {
  channels: GuildBlueprintScaffoldInput["channels"]
  informationChannelKeys: readonly string[]
  purpose: string
  systemChannelKey: string
}

export interface GuildBlueprintStarterCatalogEntry {
  categoryCount: number
  forumChannelCount: number
  informationChannelKeys: readonly string[]
  name: GuildBlueprintStarterName
  purpose: string
  systemChannelKey: string
  textChannelCount: number
}

export interface GuildBlueprintStarterCompilation {
  request: GuildBlueprintRequest
  review: {
    categoryCount: number
    forumChannelCount: number
    informationChannelKeys: string[]
    omittedCapabilities: readonly string[]
    policyRequirements: {
      capabilities: string[]
      discordPermissions: string[]
      gatewayIntents: string[]
      identity: string[]
      scopes: string[]
      toolsets: string[]
    }
    postCompileHardening: {
      instruction: string
      symbolicChannelKeys: string[]
      tool: string
    }[]
    purpose: string
    resourceCount: number
    systemChannelKey: string
    textChannelCount: number
    warnings: string[]
  }
  starter: GuildBlueprintStarterName
  starterVersion: number
}

const STARTER_INPUT_KEYS = new Set([
  "auditReason",
  "guildId",
  "guildName",
  "operationKey",
  "starter",
])

const STARTERS: Readonly<Record<
  GuildBlueprintStarterName,
  GuildBlueprintStarterDefinition
>> = Object.freeze({
  community: Object.freeze({
    channels: Object.freeze([
      { key: "com-01-start", kind: "category", name: "START HERE" },
      {
        key: "com-start-01-rules",
        kind: "text",
        name: "rules",
        parentKey: "com-01-start",
        topic: "Community expectations and important guidance",
      },
      {
        key: "com-start-02-news",
        kind: "text",
        name: "announcements",
        parentKey: "com-01-start",
        topic: "Official community updates and important notices",
      },
      { key: "com-02-social", kind: "category", name: "COMMUNITY" },
      {
        key: "com-social-01-general",
        kind: "text",
        name: "general",
        parentKey: "com-02-social",
        rateLimitPerUser: 5,
        topic: "Everyday community conversation",
      },
      {
        key: "com-social-02-intro",
        kind: "text",
        name: "introductions",
        parentKey: "com-02-social",
        topic: "A welcoming place for new members to introduce themselves",
      },
      { key: "com-03-feedback", kind: "category", name: "FEEDBACK" },
      {
        defaultAutoArchiveDuration: 4_320,
        key: "com-feedback-01-ideas",
        kind: "forum",
        name: "ideas",
        parentKey: "com-03-feedback",
        rateLimitPerUser: 10,
        topic: "One focused suggestion per post with context and expected value",
      },
    ] as const),
    informationChannelKeys: Object.freeze([
      "com-start-01-rules",
      "com-start-02-news",
    ] as const),
    purpose: "A compact public community with onboarding information, conversation, and structured ideas",
    systemChannelKey: "com-social-01-general",
  }),
  creator: Object.freeze({
    channels: Object.freeze([
      { key: "creator-01-start", kind: "category", name: "START HERE" },
      {
        key: "creator-start-01-news",
        kind: "text",
        name: "announcements",
        parentKey: "creator-01-start",
        topic: "Official creator news, releases, and event notices",
      },
      {
        key: "creator-start-02-schedule",
        kind: "text",
        name: "schedule",
        parentKey: "creator-01-start",
        topic: "Upcoming streams, premieres, and community events",
      },
      { key: "creator-02-community", kind: "category", name: "COMMUNITY" },
      {
        key: "creator-community-01-general",
        kind: "text",
        name: "general",
        parentKey: "creator-02-community",
        rateLimitPerUser: 5,
        topic: "Community conversation around the creator and their work",
      },
      {
        key: "creator-community-02-art",
        kind: "text",
        name: "fan-art",
        parentKey: "creator-02-community",
        topic: "Original community art and creative work",
      },
      {
        key: "creator-community-03-clips",
        kind: "text",
        name: "clips",
        parentKey: "creator-02-community",
        topic: "Memorable clips and highlights with source context",
      },
      { key: "creator-03-ideas", kind: "category", name: "IDEAS" },
      {
        defaultAutoArchiveDuration: 4_320,
        key: "creator-ideas-01-requests",
        kind: "forum",
        name: "content-ideas",
        parentKey: "creator-03-ideas",
        rateLimitPerUser: 10,
        topic: "Focused content ideas and constructive community requests",
      },
    ] as const),
    informationChannelKeys: Object.freeze([
      "creator-start-01-news",
      "creator-start-02-schedule",
    ] as const),
    purpose: "A public creator community for updates, discussion, fan work, clips, and content ideas",
    systemChannelKey: "creator-community-01-general",
  }),
  project: Object.freeze({
    channels: Object.freeze([
      { key: "project-01-info", kind: "category", name: "INFORMATION" },
      {
        key: "project-info-01-readme",
        kind: "text",
        name: "readme",
        parentKey: "project-01-info",
        topic: "Project purpose, contribution paths, and essential references",
      },
      {
        key: "project-info-02-releases",
        kind: "text",
        name: "releases",
        parentKey: "project-01-info",
        topic: "Release announcements and important compatibility notes",
      },
      { key: "project-02-collab", kind: "category", name: "COLLABORATION" },
      {
        key: "project-collab-01-general",
        kind: "text",
        name: "general",
        parentKey: "project-02-collab",
        topic: "General project discussion and coordination",
      },
      {
        key: "project-collab-02-help",
        kind: "text",
        name: "help",
        parentKey: "project-02-collab",
        rateLimitPerUser: 5,
        topic: "Focused implementation and usage questions",
      },
      {
        key: "project-collab-03-showcase",
        kind: "text",
        name: "showcase",
        parentKey: "project-02-collab",
        topic: "Projects, integrations, and outcomes built by the community",
      },
      { key: "project-03-planning", kind: "category", name: "PLANNING" },
      {
        defaultAutoArchiveDuration: 10_080,
        key: "project-plan-01-issues",
        kind: "forum",
        name: "issues",
        parentKey: "project-03-planning",
        rateLimitPerUser: 10,
        topic: "Reproducible problems with expected behavior and safe evidence",
      },
      {
        defaultAutoArchiveDuration: 10_080,
        key: "project-plan-02-ideas",
        kind: "forum",
        name: "ideas",
        parentKey: "project-03-planning",
        rateLimitPerUser: 10,
        topic: "One scoped proposal per post with motivation and tradeoffs",
      },
    ] as const),
    informationChannelKeys: Object.freeze([
      "project-info-01-readme",
      "project-info-02-releases",
    ]),
    purpose: "A software or creative project hub for releases, collaboration, support, issues, and proposals",
    systemChannelKey: "project-collab-01-general",
  }),
  support: Object.freeze({
    channels: Object.freeze([
      { key: "support-01-start", kind: "category", name: "START HERE" },
      {
        key: "support-start-01-welcome",
        kind: "text",
        name: "welcome",
        parentKey: "support-01-start",
        topic: "Where to begin, what support covers, and how to protect private information",
      },
      {
        key: "support-start-02-faq",
        kind: "text",
        name: "faq",
        parentKey: "support-01-start",
        topic: "Frequently asked questions and verified answers",
      },
      { key: "support-02-help", kind: "category", name: "SUPPORT" },
      {
        defaultAutoArchiveDuration: 4_320,
        key: "support-help-01-questions",
        kind: "forum",
        name: "get-help",
        parentKey: "support-02-help",
        rateLimitPerUser: 10,
        topic: "One support question per post with context and safe reproduction details",
      },
      {
        defaultAutoArchiveDuration: 10_080,
        key: "support-help-02-bugs",
        kind: "forum",
        name: "bug-reports",
        parentKey: "support-02-help",
        rateLimitPerUser: 10,
        topic: "Reproducible defects with expected behavior and secrets removed",
      },
      { key: "support-03-community", kind: "category", name: "COMMUNITY" },
      {
        key: "support-community-01-general",
        kind: "text",
        name: "general",
        parentKey: "support-03-community",
        rateLimitPerUser: 5,
        topic: "General product and community conversation",
      },
      {
        defaultAutoArchiveDuration: 10_080,
        key: "support-community-02-feedback",
        kind: "forum",
        name: "feedback",
        parentKey: "support-03-community",
        rateLimitPerUser: 10,
        topic: "Constructive product feedback and focused feature requests",
      },
    ] as const),
    informationChannelKeys: Object.freeze([
      "support-start-01-welcome",
      "support-start-02-faq",
    ]),
    purpose: "A product support hub with clear entry guidance, structured help, bug reports, and feedback",
    systemChannelKey: "support-community-01-general",
  }),
})

function isStarterName(value: unknown): value is GuildBlueprintStarterName {
  return typeof value === "string"
    && (GUILD_BLUEPRINT_STARTER_NAMES as readonly string[]).includes(value)
}

function exactInput(value: GuildBlueprintStarterInput): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord guild blueprint starter input must be an object")
  }
  const record = value as unknown as Record<string, unknown>
  const unexpected = Object.keys(record)
    .filter((key) => !STARTER_INPUT_KEYS.has(key))
    .sort()
  if (unexpected.length > 0) {
    throw new RangeError(
      `Discord guild blueprint starter input contains unsupported fields: ${unexpected.join(", ")}`,
    )
  }
  return record
}

function plannerRequest(
  input: GuildBlueprintStarterInput,
  definition: GuildBlueprintStarterDefinition,
): GuildBlueprintRequest {
  const candidate: GuildBlueprintRequest = {
    auditReason: input.auditReason,
    guildId: input.guildId,
    operationKey: input.operationKey,
    ...(input.guildName === undefined
      ? {}
      : { profile: { name: input.guildName } }),
    scaffold: {
      channels: definition.channels.map((channel) => ({ ...channel })),
      roles: [],
      stepLimit: CONNECTOR_LIMITS.scaffoldStepLimit,
    },
    settings: {
      defaultMessageNotifications: "only-mentions",
      explicitContentFilter: "all-members",
      systemChannel: {
        key: definition.systemChannelKey,
        kind: "scaffold",
      },
    },
  }
  const {
    operationKeyHash: _operationKeyHash,
    ...normalized
  } = normalizeGuildBlueprintRequest(candidate)
  return normalized
}

function counts(definition: GuildBlueprintStarterDefinition) {
  return {
    categoryCount: definition.channels.filter(({ kind }) => kind === "category").length,
    forumChannelCount: definition.channels.filter(({ kind }) => kind === "forum").length,
    textChannelCount: definition.channels.filter(({ kind }) => kind === "text").length,
  }
}

export const GUILD_BLUEPRINT_STARTER_CATALOG:
readonly GuildBlueprintStarterCatalogEntry[] = Object.freeze(
  GUILD_BLUEPRINT_STARTER_NAMES.map((name) => {
    const definition = STARTERS[name]
    return Object.freeze({
      ...counts(definition),
      informationChannelKeys: Object.freeze([...definition.informationChannelKeys]),
      name,
      purpose: definition.purpose,
      systemChannelKey: definition.systemChannelKey,
    })
  }),
)

export function compileGuildBlueprintStarter(
  input: GuildBlueprintStarterInput,
): GuildBlueprintStarterCompilation {
  const record = exactInput(input)
  if (!isStarterName(record.starter)) {
    throw new RangeError(
      `Discord guild blueprint starter must be one of: ${GUILD_BLUEPRINT_STARTER_NAMES.join(", ")}`,
    )
  }
  const definition = STARTERS[record.starter]
  const request = plannerRequest(input, definition)
  const channelCounts = counts(definition)
  return {
    request,
    review: {
      ...channelCounts,
      informationChannelKeys: [...definition.informationChannelKeys],
      omittedCapabilities: GUILD_BLUEPRINT_STARTER_OMISSIONS,
      policyRequirements: {
        capabilities: [
          "capabilities.guildScaffolds",
          ...(input.guildName === undefined
            ? []
            : [
                "capabilities.guildProfileAudit",
                "capabilities.guildProfileChanges",
              ]),
          "capabilities.guildSettingsAudit",
          "capabilities.guildSettingsChanges",
        ],
        discordPermissions: [
          "VIEW_CHANNEL",
          "MANAGE_CHANNELS",
          "MANAGE_GUILD",
        ],
        gatewayIntents: ["GUILDS"],
        identity: [
          "identity.applicationId",
          "identity.botId",
        ],
        scopes: [
          "readScope.guildIds",
          "scopes.guildScaffoldGuildIds",
          ...(input.guildName === undefined
            ? []
            : ["scopes.guildProfileGuildIds"]),
          "scopes.guildSettingsGuildIds",
        ],
        toolsets: ["guild-blueprints"],
      },
      postCompileHardening: [
        {
          instruction: "After structure completion resolves exact channel IDs, add reviewed deny-SEND_MESSAGES entries to channelPermissionOverwrites and preview the retained manifest again, or use the standalone planner",
          symbolicChannelKeys: [...definition.informationChannelKeys],
          tool: "plan_channel_permission_overwrite",
        },
        {
          instruction: "Review exact channel placement separately if visual order matters; the starter does not claim an ordered live layout",
          symbolicChannelKeys: definition.channels.map(({ key }) => key),
          tool: "plan_channel_order",
        },
      ],
      purpose: definition.purpose,
      resourceCount: definition.channels.length,
      systemChannelKey: definition.systemChannelKey,
      textChannelCount: channelCounts.textChannelCount,
      warnings: [
        "Information and announcement-style entries are ordinary public text channels until their exact IDs are proven and permission overwrites are reviewed",
        "Private staff areas are deliberately omitted so the starter cannot accidentally create a public staff channel",
        "The starter creates no role, grants no role permission, assigns no member, and never requests Administrator",
        "Fresh scaffold planning may accept one exact-state logical-name match as already current; ambiguous, mismatched, or drifting candidates block",
        "The starter sets default notifications to only mentions, applies explicit content filtering to all members, and points the system channel at its requested general channel",
        "The starter preserves the existing guild verification level rather than lowering an established membership barrier",
        ...(input.guildName === undefined
          ? []
          : ["The optional guild name is a complete reviewed replacement of the live guild name"]),
        "Role order, permission overwrites, Community, Welcome Screen, onboarding, AutoMod, publications, and existing-resource convergence require separately authored reviewed intent",
      ],
    },
    starter: record.starter,
    starterVersion: GUILD_BLUEPRINT_STARTER_VERSION,
  }
}
