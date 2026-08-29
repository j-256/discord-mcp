import assert from "node:assert/strict"
import test from "node:test"

import type {
  AutoModerationChangeRequest,
  AutoModerationPlan,
  AutoModerationResult,
  AutoModerationVerificationResult,
  ProjectedAutoModerationRule,
} from "../src/automod-service.js"
import { normalizeAutoModerationChangeRequest } from "../src/automod-service.js"
import { DiscordApiError, GuildBlueprintPlanChangedError } from "../src/errors.js"
import type {
  ChannelPermissionOverwritePlan,
  ChannelPermissionOverwriteRequest,
  ChannelPermissionOverwriteResult,
} from "../src/channel-permission-overwrite-service.js"
import type {
  ChannelMetadataChangePlan,
  ChannelMetadataChangeRequest,
  ChannelMetadataChangeResult,
} from "../src/channel-metadata-service.js"
import type {
  ComponentMessagePlan,
  ComponentMessageRequest,
  ComponentMessageResult,
  ComponentMessageVerificationResult,
} from "../src/component-message-service.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
} from "../src/constants.js"
import {
  GuildBlueprintService,
  guildBlueprintAutoModerationOperationKey,
  guildBlueprintExactTargetOperationKey,
  guildBlueprintPublicationOperationKey,
  guildBlueprintRequestDigest,
  guildBlueprintStepOperationKey,
  normalizeGuildBlueprintRequest,
  previewGuildBlueprintManifest,
  type GuildBlueprintDomainServices,
  type GuildBlueprintExecutors,
  type GuildBlueprintPlanStep,
  type GuildBlueprintRequest,
} from "../src/guild-blueprint-service.js"
import { projectGuildBlueprintPlanManifestPreview } from "../src/guild-blueprint-preview.js"
import type {
  GuildProfileChangePlan,
  GuildProfileChangeRequest,
  GuildProfileChangeResult,
} from "../src/guild-profile-service.js"
import type {
  GuildCommunityAuditResult,
  GuildCommunityChangePlan,
  GuildCommunityChangeRequest,
  GuildCommunityChangeResult,
} from "../src/guild-community-service.js"
import type {
  GuildScaffoldPlan,
  GuildScaffoldRequest,
  GuildScaffoldResult,
} from "../src/guild-scaffold-service.js"
import type {
  GuildSettingsChangePlan,
  GuildSettingsChangeRequest,
  GuildSettingsChangeResult,
} from "../src/guild-settings-service.js"
import { operationKeyHash } from "../src/operation-store.js"
import type {
  RoleConfigurationPlan,
  RoleConfigurationRequest,
  RoleConfigurationResult,
} from "../src/role-configuration-service.js"
import type {
  RoleOrderingPlan,
  RoleOrderingRequest,
  RoleOrderingResult,
} from "../src/role-ordering-service.js"
import type {
  OnboardingChangePlan,
  OnboardingChangeRequest,
  OnboardingChangeResult,
} from "../src/onboarding-service.js"
import type {
  WelcomeScreenChangePlan,
  WelcomeScreenChangeRequest,
  WelcomeScreenChangeResult,
} from "../src/welcome-screen-service.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const OWNER_ID = "400000000000000001"
const ROLE_ID = "500000000000000001"
const SECOND_ROLE_ID = "500000000000000002"
const THIRD_ROLE_ID = "500000000000000003"
const CATEGORY_ID = "600000000000000001"
const CHANNEL_ID = "700000000000000001"
const SECOND_CHANNEL_ID = "700000000000000005"
const PUBLICATION_CHANNEL_ID = "700000000000000002"
const PUBLICATION_MESSAGE_ID = "700000000000000003"
const NOTIFICATION_USER_ID = "700000000000000004"
const ONBOARDING_PROMPT_ID = "800000000000000001"
const ONBOARDING_OPTION_ID = "900000000000000001"
const AUTOMOD_RULE_ID = "910000000000000001"
const CREATED_AUTOMOD_RULE_ID = "910000000000000002"
const AUTOMOD_KEY = "private-automod-rule"
const OPERATION_KEY = "guild-blueprint-operation-0001"
const AUDIT_REASON = "Private blueprint audit reason"
const WELCOME_DESCRIPTION = "Private Welcome Screen description"
const WELCOME_CHANNEL_DESCRIPTION = "Private welcome channel description"
const ONBOARDING_PROMPT_TITLE = "Private onboarding prompt title"
const ONBOARDING_OPTION_TITLE = "Private onboarding option title"
const ONBOARDING_OPTION_DESCRIPTION = "Private onboarding option description"
const PUBLICATION_KEY = "private-publication"
const PUBLICATION_TEXT = `Private publication component text <@${NOTIFICATION_USER_ID}>`
const NOW = "2026-08-24T12:00:00.000Z"
const PLAN_KEY = new Uint8Array(32).fill(17)
const MESSAGE_CONTENT_INTENT = "enabled" as const

function request(
  overrides: Partial<GuildBlueprintRequest> = {},
): GuildBlueprintRequest {
  return {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    profile: {
      description: "Private profile description",
      name: "Private Guild Name",
    },
    scaffold: {
      channels: [
        {
          key: "private-category",
          kind: "category",
          name: "Private Category",
        },
        {
          key: "private-system-channel",
          kind: "text",
          name: "private-system-channel",
          parentKey: "private-category",
          topic: "Private channel topic",
        },
      ],
      roles: [{
        key: "private-role",
        name: "Private Role",
        permissions: ["VIEW_CHANNEL"],
      }],
      stepLimit: 2,
    },
    settings: {
      defaultMessageNotifications: "only-mentions",
      systemChannel: {
        key: "private-system-channel",
        kind: "scaffold",
      },
      verificationLevel: "medium",
    },
    ...overrides,
  }
}

function welcomeScreen(): NonNullable<GuildBlueprintRequest["welcomeScreen"]> {
  return {
    channels: [{
      channel: {
        key: "private-system-channel",
        kind: "scaffold",
      },
      description: WELCOME_CHANNEL_DESCRIPTION,
      emoji: { kind: "unicode", unicode: "\u{1F44B}" },
    }],
    description: WELCOME_DESCRIPTION,
    enabled: true,
  }
}

function community(): NonNullable<GuildBlueprintRequest["community"]> {
  return {
    acknowledgeCommunityEnablement: true,
    publicUpdatesChannel: {
      channelId: PUBLICATION_CHANNEL_ID,
      kind: "exact",
    },
    rulesChannel: {
      key: "private-system-channel",
      kind: "scaffold",
    },
    safetyAlertsChannel: null,
  }
}

function onboarding(): NonNullable<GuildBlueprintRequest["onboarding"]> {
  return {
    defaultChannels: [{ key: "private-system-channel", kind: "scaffold" }],
    enabled: false,
    mode: "advanced",
    prompts: [{
      inOnboarding: true,
      options: [{
        channels: [{ key: "private-system-channel", kind: "scaffold" }],
        description: ONBOARDING_OPTION_DESCRIPTION,
        emoji: { kind: "unicode", unicode: "\u{1F3AE}" },
        roles: [{ key: "private-role", kind: "scaffold" }],
        title: ONBOARDING_OPTION_TITLE,
      }],
      required: false,
      singleSelect: true,
      title: ONBOARDING_PROMPT_TITLE,
      type: "multiple-choice",
    }],
  }
}

function publications(): NonNullable<GuildBlueprintRequest["publications"]> {
  return [{
    action: "create",
    channel: { key: "private-system-channel", kind: "scaffold" },
    components: [{ content: PUBLICATION_TEXT, kind: "text" }],
    key: PUBLICATION_KEY,
    notifyUserIds: [NOTIFICATION_USER_ID],
  }]
}

function autoModerationRules(
  overrides: Partial<
    NonNullable<GuildBlueprintRequest["autoModerationRules"]>[number]
  > = {},
): NonNullable<GuildBlueprintRequest["autoModerationRules"]> {
  return [{
    actions: [{
      customMessage: "Private AutoMod response",
      type: "block-message",
    }, {
      channel: { key: "private-system-channel", kind: "scaffold" },
      type: "send-alert-message",
    }],
    enabled: true,
    exemptChannels: [{ key: "private-system-channel", kind: "scaffold" }],
    exemptRoles: [{ key: "private-role", kind: "scaffold" }],
    key: AUTOMOD_KEY,
    name: "Private AutoMod policy",
    trigger: {
      allowList: ["private allowed phrase"],
      keywordFilter: ["private blocked phrase"],
      type: "keyword",
    },
    ...overrides,
  }]
}

function projectedAutoModerationRule(
  overrides: Partial<ProjectedAutoModerationRule> = {},
): ProjectedAutoModerationRule {
  return {
    actions: [{
      customMessage: "Private AutoMod response",
      type: "block-message",
    }, {
      channelId: CHANNEL_ID,
      type: "send-alert-message",
    }],
    creatorUserId: BOT_ID,
    enabled: false,
    eventType: "message-send",
    exemptChannelIds: [CHANNEL_ID],
    exemptRoleIds: [ROLE_ID],
    guildId: GUILD_ID,
    name: "Private AutoMod policy",
    ruleId: AUTOMOD_RULE_ID,
    trigger: {
      allowList: ["private allowed phrase"],
      keywordFilter: ["private blocked phrase"],
      regexPatterns: [],
      type: "keyword",
    },
    ...overrides,
  }
}

function autoModerationPlan(
  value: AutoModerationChangeRequest,
  existingRule: ProjectedAutoModerationRule | null = null,
  effectOverride?: AutoModerationPlan["effect"],
): AutoModerationPlan {
  const normalized = normalizeAutoModerationChangeRequest(value)
  const existing = normalized.action === "create"
    ? null
    : existingRule ?? projectedAutoModerationRule({ ruleId: normalized.ruleId })
  const desired = normalized.action === "delete"
    ? null
    : normalized.action === "create"
      ? {
          actions: normalized.actions,
          creatorUserId: BOT_ID,
          enabled: false,
          eventType: normalized.trigger.type === "member-profile"
            ? "member-update" as const
            : "message-send" as const,
          exemptChannelIds: normalized.exemptChannelIds,
          exemptRoleIds: normalized.exemptRoleIds,
          guildId: normalized.guildId,
          name: normalized.name,
          ruleId: null,
          trigger: normalized.trigger,
        }
      : normalized.action === "set-enabled"
        ? { ...existing!, enabled: normalized.enabled }
        : {
            ...existing!,
            ...(normalized.actions === undefined ? {} : { actions: normalized.actions }),
            ...(normalized.exemptChannelIds === undefined
              ? {}
              : { exemptChannelIds: normalized.exemptChannelIds }),
            ...(normalized.exemptRoleIds === undefined
              ? {}
              : { exemptRoleIds: normalized.exemptRoleIds }),
            ...(normalized.name === undefined ? {} : { name: normalized.name }),
            ...(normalized.trigger === undefined ? {} : { trigger: normalized.trigger }),
          }
  const effect = effectOverride ?? normalized.action
  const digestByte = normalized.action === "create"
    ? "1"
    : normalized.action === "update"
      ? "2"
      : normalized.action === "set-enabled"
        ? normalized.enabled ? "3" : "4"
        : "5"
  return {
    action: normalized.action,
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    desired,
    digest: `hmac-sha256:${digestByte.repeat(64)}`,
    effect,
    existing,
    guild: { id: GUILD_ID, name: "Private Guild" },
    operationKeyHash: normalized.operationKeyHash,
    schemaVersion: 1,
    status: effect === "none" ? "already-current" : "planned",
  } as AutoModerationPlan
}

function autoModerationVerification(
  value: AutoModerationChangeRequest,
  status: AutoModerationVerificationResult["status"],
  ruleId: string | null = null,
): AutoModerationVerificationResult {
  const normalized = normalizeAutoModerationChangeRequest(value)
  const completed = status === "verified" || status === "drifted"
  const recorded = completed || status === "blocked"
  return {
    action: normalized.action,
    activityId: recorded ? "activity-automod" : null,
    guildId: normalized.guildId,
    operationKeyHash: normalized.operationKeyHash,
    planDigest: recorded ? `hmac-sha256:${"5".repeat(64)}` : null,
    readbackMatched: status === "verified",
    reason: status === "verified"
      ? null
      : status === "not-found"
        ? "operation-not-found"
        : status === "drifted"
          ? "rule-state-mismatch"
          : "operation-pending",
    receiptStatus: completed ? "completed" : status === "blocked" ? "pending" : null,
    requestMatched: completed || status === "blocked",
    ruleId: completed ? ruleId ?? CREATED_AUTOMOD_RULE_ID : null,
    schemaVersion: 1,
    status,
    timestamp: recorded ? NOW : null,
  }
}

function scaffoldPlan(
  value: GuildScaffoldRequest,
  status: GuildScaffoldPlan["status"],
): GuildScaffoldPlan {
  const satisfied = ["already-current", "completed"].includes(status)
  const steps = [
    ...value.roles.map((role, index) => ({
      existingResourceId: satisfied ? ROLE_ID : null,
      index,
      key: role.key,
      kind: "role" as const,
      operationKeyHash: `sha256:${"1".repeat(64)}`,
      parent: null,
      state: satisfied ? "already-current" as const : "ready" as const,
      target: { name: role.name },
    })),
    ...value.channels.map((channel, offset) => ({
      existingResourceId: satisfied
        ? channel.kind === "category"
          ? CATEGORY_ID
          : CHANNEL_ID
        : null,
      index: value.roles.length + offset,
      key: channel.key,
      kind: channel.kind,
      operationKeyHash: `sha256:${"2".repeat(64)}`,
      parent: null,
      state: satisfied ? "already-current" as const : "ready" as const,
      target: { name: channel.name },
    })),
  ]
  return {
    applicationId: APPLICATION_ID,
    auditReason: value.auditReason,
    botId: BOT_ID,
    counts: {
      alreadyCurrent: satisfied ? steps.length : 0,
      completed: 0,
      ready: satisfied ? 0 : steps.length,
      total: steps.length,
      waitingForParent: 0,
    },
    createdAt: NOW,
    digest: `hmac-sha256:${(status === "planned" ? "3" : "4").repeat(64)}`,
    executionFrontier: {
      stepIndexes: satisfied ? [] : steps.map((step) => step.index),
    },
    guild: { id: GUILD_ID, name: "Private Guild", ownerId: OWNER_ID },
    operation: {
      operationKeyHash: operationKeyHash(value.operationKey),
      requestDigest: `hmac-sha256:${"5".repeat(64)}`,
      status: status === "completed" ? "completed" : "unreserved",
      stepLimit: value.stepLimit as number,
    },
    permission: {
      botAdministrator: false,
      botEffectivePermissionNames: [],
      botEffectivePermissions: "0",
      botHighestRoleIds: [],
      botHighestRolePosition: 1,
      guildManageChannels: true,
      guildManageRoles: true,
      guildViewChannel: true,
    },
    schemaVersion: 1,
    status,
    steps,
    visibleInventory: {
      channelLimit: 500,
      channels: 0,
      roleLimit: 250,
      roles: 1,
    },
    warnings: [],
  }
}

function roleConfigurationPlan(
  value: RoleConfigurationRequest,
  writeRequired: boolean,
): RoleConfigurationPlan {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    digest: `hmac-sha256:${(writeRequired ? "1" : "2").repeat(64)}`,
    guild: { id: GUILD_ID, name: "Private Guild", ownerId: OWNER_ID },
    operationKeyHash: operationKeyHash(value.operationKey),
    roleId: value.roleId,
    status: writeRequired ? "planned" : "already-current",
    writeRequired,
  } as RoleConfigurationPlan
}

function channelMetadataPlan(
  value: ChannelMetadataChangeRequest,
  writeRequired: boolean,
): ChannelMetadataChangePlan {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    current: { id: value.channelId },
    desired: { id: value.channelId },
    digest: `hmac-sha256:${(writeRequired ? "3" : "4").repeat(64)}`,
    guild: { id: GUILD_ID, name: "Private Guild" },
    operationKeyHash: operationKeyHash(value.operationKey),
    status: writeRequired ? "planned" : "already-current",
    writeRequired,
  } as ChannelMetadataChangePlan
}

function roleOrderingPlan(
  value: RoleOrderingRequest,
  writeRequired: boolean,
): RoleOrderingPlan {
  return {
    anchor: { id: value.anchorRoleId },
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    digest: `hmac-sha256:${(writeRequired ? "5" : "6").repeat(64)}`,
    guild: { id: GUILD_ID, name: "Private Guild", ownerId: OWNER_ID },
    operationKeyHash: operationKeyHash(value.operationKey),
    placement: value.placement,
    role: { id: value.roleId },
    status: writeRequired ? "planned" : "already-current",
    writeRequired,
  } as RoleOrderingPlan
}

function channelPermissionOverwritePlan(
  value: ChannelPermissionOverwriteRequest,
  writeRequired: boolean,
): ChannelPermissionOverwritePlan {
  return {
    action: writeRequired ? (value.mode === "delete" ? "delete" : "put") : "none",
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    changes: value.mode === "update" ? [...value.changes] : [],
    channel: { guildId: GUILD_ID, id: value.channelId },
    digest: `hmac-sha256:${(writeRequired ? "7" : "8").repeat(64)}`,
    guild: { id: GUILD_ID, name: "Private Guild" },
    operationKeyHash: operationKeyHash(value.operationKey),
    requestedMode: value.mode,
    status: writeRequired ? "planned" : "already-current",
    target: {
      id: value.targetId,
      name: value.targetId,
      type: value.targetType,
    },
  } as ChannelPermissionOverwritePlan
}

function profilePlan(
  value: GuildProfileChangeRequest,
  writeRequired: boolean,
): GuildProfileChangePlan {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    digest: `hmac-sha256:${(writeRequired ? "6" : "7").repeat(64)}`,
    guildId: GUILD_ID,
    operationKeyHash: operationKeyHash(value.operationKey),
    status: writeRequired ? "planned" : "already-current",
    writeRequired,
  } as GuildProfileChangePlan
}

function settingsPlan(
  value: GuildSettingsChangeRequest,
  writeRequired: boolean,
): GuildSettingsChangePlan {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    digest: `hmac-sha256:${(writeRequired ? "8" : "9").repeat(64)}`,
    guildId: GUILD_ID,
    operationKeyHash: operationKeyHash(value.operationKey),
    status: writeRequired ? "planned" : "already-current",
    writeRequired,
  } as GuildSettingsChangePlan
}

function communityAudit(enabled: boolean): GuildCommunityAuditResult {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    configuration: { communityEnabled: enabled },
    guildId: GUILD_ID,
    schemaVersion: 1,
    status: "ok",
  } as GuildCommunityAuditResult
}

function communityPlan(
  value: GuildCommunityChangeRequest,
  writeRequired: boolean,
): GuildCommunityChangePlan {
  return {
    acknowledgeCommunityEnablement: true,
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    desired: {
      publicUpdatesChannelId: value.publicUpdatesChannelId,
      rulesChannelId: value.rulesChannelId,
      safetyAlertsChannelId: value.safetyAlertsChannelId,
    },
    digest: `hmac-sha256:${(writeRequired ? "a" : "b").repeat(64)}`,
    guildId: GUILD_ID,
    operationKeyHash: operationKeyHash(value.operationKey),
    status: writeRequired ? "planned" : "already-current",
    writeRequired,
  } as GuildCommunityChangePlan
}

function welcomeScreenPlan(
  value: WelcomeScreenChangeRequest,
  writeRequired: boolean,
): WelcomeScreenChangePlan {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    digest: `hmac-sha256:${(writeRequired ? "b" : "c").repeat(64)}`,
    guild: { id: GUILD_ID, name: "Private Guild" },
    operationKeyHash: operationKeyHash(value.operationKey),
    status: writeRequired ? "planned" : "already-current",
    writeRequired,
  } as WelcomeScreenChangePlan
}

function onboardingPlan(
  value: OnboardingChangeRequest,
  writeRequired: boolean,
): OnboardingChangePlan {
  return {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    digest: `hmac-sha256:${(writeRequired ? "d" : "e").repeat(64)}`,
    guild: { id: GUILD_ID, name: "Private Guild" },
    operationKeyHash: operationKeyHash(value.operationKey),
    status: writeRequired ? "planned" : "already-current",
    writeRequired,
  } as OnboardingChangePlan
}

function componentPlan(
  value: ComponentMessageRequest,
  writeRequired: boolean,
): ComponentMessagePlan {
  return {
    action: value.action,
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channel: {
      guildId: GUILD_ID,
      id: value.channelId,
      parentId: null,
      type: 0,
    },
    digest: `hmac-sha256:${(writeRequired ? "f" : "0").repeat(64)}`,
    guild: { id: GUILD_ID, name: "Private Guild" },
    operationKeyHash: operationKeyHash(value.operationKey),
    status: writeRequired ? "planned" : "already-current",
    target: {
      messageId: value.action === "edit" ? value.messageId as string : null,
    },
    writeRequired,
  } as ComponentMessagePlan
}

function componentVerification(
  value: ComponentMessageRequest,
  status: ComponentMessageVerificationResult["status"] = "not-found",
): ComponentMessageVerificationResult {
  const verified = status === "verified"
  const blocked = status === "blocked"
  const drifted = status === "drifted"
  return {
    action: value.action,
    activityId: verified || drifted ? "activity-publication" : null,
    channelId: value.channelId,
    guildId: verified || drifted ? GUILD_ID : null,
    messageId: verified || drifted ? PUBLICATION_MESSAGE_ID : null,
    operationKeyHash: operationKeyHash(value.operationKey),
    planDigest: verified || drifted
      ? `hmac-sha256:${"f".repeat(64)}`
      : null,
    readbackMatched: verified,
    reason: verified
      ? null
      : blocked
        ? "request-mismatch"
        : drifted
          ? "message-state-mismatch"
          : "operation-not-found",
    receiptStatus: verified || drifted ? "completed" : blocked ? "pending" : null,
    requestMatched: verified || drifted,
    schemaVersion: 1,
    status,
    timestamp: verified || drifted ? NOW : null,
    url: verified
      ? `https://discord.com/channels/${GUILD_ID}/${value.channelId}/${PUBLICATION_MESSAGE_ID}`
      : null,
  }
}

function componentReceiptBlocker(
  value: ComponentMessageRequest,
  reason: Exclude<
    ComponentMessageVerificationResult["reason"],
    "operation-not-found" | "request-mismatch" | null
  >,
): ComponentMessageVerificationResult {
  const drifted = reason === "message-missing" || reason === "message-state-mismatch"
  const receiptStatus = reason === "operation-pending"
    ? "pending" as const
    : reason === "operation-failed"
      ? "failed" as const
      : reason === "operation-uncertain"
        ? "uncertain" as const
        : "completed" as const
  return {
    ...componentVerification(value, drifted ? "drifted" : "blocked"),
    activityId: "activity-publication",
    guildId: GUILD_ID,
    messageId: reason === "operation-pending" || reason === "operation-failed"
      ? null
      : reason === "receipt-target-mismatch"
        ? "malformed-target"
        : PUBLICATION_MESSAGE_ID,
    planDigest: `hmac-sha256:${"f".repeat(64)}`,
    reason,
    receiptStatus,
    requestMatched: true,
    status: drifted ? "drifted" : "blocked",
    timestamp: NOW,
  }
}

interface FixtureOptions {
  autoModerationPlan?: (
    request: AutoModerationChangeRequest,
    index: number,
  ) => AutoModerationPlan
  autoModerationRules?: ProjectedAutoModerationRule[]
  autoModerationVerification?: (
    request: AutoModerationChangeRequest,
    index: number,
  ) => AutoModerationVerificationResult
  channelMetadataWrite?: boolean
  channelPermissionOverwritePlanTransform?: (
    plan: ChannelPermissionOverwritePlan,
    request: ChannelPermissionOverwriteRequest,
  ) => ChannelPermissionOverwritePlan
  channelPermissionOverwriteWrite?: boolean
  componentPlanTransform?: (
    plan: ComponentMessagePlan,
    request: ComponentMessageRequest,
    index: number,
  ) => ComponentMessagePlan
  componentVerification?: (
    request: ComponentMessageRequest,
    index: number,
  ) => ComponentMessageVerificationResult
  componentWrite?: boolean
  communityAuditTransform?: (
    audit: GuildCommunityAuditResult,
  ) => GuildCommunityAuditResult
  communityEnabled?: boolean
  communityPlanTransform?: (
    plan: GuildCommunityChangePlan,
    request: GuildCommunityChangeRequest,
  ) => GuildCommunityChangePlan
  communityWrite?: boolean
  onboardingWrite?: boolean
  profileWrite?: boolean
  roleConfigurationWrite?: boolean
  roleOrderingPlanTransform?: (
    plan: RoleOrderingPlan,
    request: RoleOrderingRequest,
  ) => RoleOrderingPlan
  roleOrderingWrite?: boolean
  scaffoldTransform?: (plan: GuildScaffoldPlan) => GuildScaffoldPlan
  scaffoldStatus?: GuildScaffoldPlan["status"]
  settingsWrite?: boolean
  welcomeScreenWrite?: boolean
}

function fixture(options: FixtureOptions = {}) {
  const calls: string[] = []
  const resolvedAutoModeration: AutoModerationChangeRequest[] = []
  const resolvedChannelMetadata: ChannelMetadataChangeRequest[] = []
  const resolvedChannelPermissionOverwrites: ChannelPermissionOverwriteRequest[] = []
  let resolvedOnboarding: OnboardingChangeRequest | null = null
  const resolvedPublications: ComponentMessageRequest[] = []
  const resolvedRoleConfigurations: RoleConfigurationRequest[] = []
  const resolvedRoleOrderings: RoleOrderingRequest[] = []
  let resolvedCommunity: GuildCommunityChangeRequest | null = null
  let resolvedSettings: GuildSettingsChangeRequest | null = null
  let resolvedWelcomeScreen: WelcomeScreenChangeRequest | null = null
  const domains: GuildBlueprintDomainServices = {
    automod: {
      async get(_botId, guildId, ruleId) {
        calls.push("get-automod")
        const rule = options.autoModerationRules?.find((entry) => (
          entry.guildId === guildId && entry.ruleId === ruleId
        ))
        if (!rule) {
          throw new DiscordApiError({
            message: "Unknown AutoMod rule",
            method: "GET",
            route: "/guilds/:guildId/auto-moderation/rules/:ruleId",
            status: 404,
          })
        }
        return {
          guild: { id: guildId, name: "Private Guild" },
          permission: {} as never,
          privacy: {} as never,
          references: {} as never,
          rule,
          schemaVersion: 1,
          status: "ok",
        }
      },
      async list(_botId, guildId) {
        calls.push("list-automod")
        const rules = options.autoModerationRules ?? []
        return {
          guild: { id: guildId, name: "Private Guild" },
          page: {
            returned: rules.length,
            safetyLimit: 10,
            visibility: "connector-visible" as const,
          },
          permission: {} as never,
          privacy: {} as never,
          rules: rules.map((rule) => ({
            actionTypes: rule.actions.map((action) => action.type),
            creatorUserId: rule.creatorUserId,
            enabled: rule.enabled,
            eventType: rule.eventType,
            exemptChannelCount: rule.exemptChannelIds.length,
            exemptRoleCount: rule.exemptRoleIds.length,
            guildId: rule.guildId,
            name: rule.name,
            policyEntryCounts: {
              allowList: 0,
              keywordFilter: 0,
              presets: 0,
              regexPatterns: 0,
            },
            references: { healthy: true },
            ruleId: rule.ruleId,
            triggerType: rule.trigger.type,
          })),
          schemaVersion: 1,
          status: "ok" as const,
        }
      },
      async plan(_applicationId, _botId, value) {
        calls.push("plan-automod")
        const index = resolvedAutoModeration.length
        resolvedAutoModeration.push(value)
        if (options.autoModerationPlan) {
          return options.autoModerationPlan(value, index)
        }
        throw new Error("Unexpected AutoMod blueprint plan")
      },
      async verify(_applicationId, _botId, value) {
        calls.push("verify-automod")
        const index = resolvedAutoModeration.length
        resolvedAutoModeration.push(value)
        return options.autoModerationVerification?.(value, index) ?? {
          action: value.action,
          activityId: null,
          guildId: value.guildId,
          operationKeyHash: operationKeyHash(value.operationKey),
          planDigest: null,
          readbackMatched: false,
          reason: "operation-not-found",
          receiptStatus: null,
          requestMatched: false,
          ruleId: null,
          schemaVersion: 1,
          status: "not-found",
          timestamp: null,
        }
      },
    },
    channelMetadata: {
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-channel-metadata")
        resolvedChannelMetadata.push(value)
        return channelMetadataPlan(
          value,
          options.channelMetadataWrite ?? false,
        )
      },
    },
    channelPermissionOverwrite: {
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-channel-permission-overwrite")
        resolvedChannelPermissionOverwrites.push(value)
        const plan = channelPermissionOverwritePlan(
          value,
          options.channelPermissionOverwriteWrite ?? false,
        )
        return options.channelPermissionOverwritePlanTransform?.(plan, value)
          ?? plan
      },
    },
    component: {
      async plan(_applicationId, _botId, intent, value) {
        calls.push("plan-publication")
        if (intent !== MESSAGE_CONTENT_INTENT) {
          throw new RangeError(
            "Discord component-message planning requires confirmed Message Content intent",
          )
        }
        const index = resolvedPublications.findIndex((request) => request === value)
        const plan = componentPlan(value, options.componentWrite ?? true)
        return options.componentPlanTransform?.(plan, value, index) ?? plan
      },
      async verify(_applicationId, _botId, intent, value) {
        calls.push("verify-publication")
        if (intent !== MESSAGE_CONTENT_INTENT) {
          throw new RangeError(
            "Discord component-message verification requires confirmed Message Content intent",
          )
        }
        const index = resolvedPublications.length
        resolvedPublications.push(value)
        return options.componentVerification?.(value, index)
          ?? componentVerification(value)
      },
    },
    community: {
      async get() {
        calls.push("get-community")
        const audit = communityAudit(options.communityEnabled ?? true)
        return options.communityAuditTransform?.(audit) ?? audit
      },
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-community")
        resolvedCommunity = value
        const plan = communityPlan(value, options.communityWrite ?? false)
        return options.communityPlanTransform?.(plan, value) ?? plan
      },
    },
    onboarding: {
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-onboarding")
        resolvedOnboarding = value
        return onboardingPlan(value, options.onboardingWrite ?? false)
      },
    },
    profile: {
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-profile")
        return profilePlan(value, options.profileWrite ?? false)
      },
    },
    roleConfiguration: {
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-role-configuration")
        resolvedRoleConfigurations.push(value)
        return roleConfigurationPlan(
          value,
          options.roleConfigurationWrite ?? false,
        )
      },
    },
    roleOrdering: {
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-role-ordering")
        resolvedRoleOrderings.push(value)
        const plan = roleOrderingPlan(value, options.roleOrderingWrite ?? false)
        return options.roleOrderingPlanTransform?.(plan, value) ?? plan
      },
    },
    scaffold: {
      async plan(_applicationId, _botId, value) {
        calls.push("plan-structure")
        const plan = scaffoldPlan(value, options.scaffoldStatus ?? "already-current")
        return options.scaffoldTransform?.(plan) ?? plan
      },
    },
    settings: {
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-settings")
        resolvedSettings = value
        return settingsPlan(value, options.settingsWrite ?? false)
      },
    },
    welcomeScreen: {
      async reconcilePlan(_applicationId, _botId, value) {
        calls.push("plan-welcome-screen")
        resolvedWelcomeScreen = value
        return welcomeScreenPlan(value, options.welcomeScreenWrite ?? false)
      },
    },
  }
  const blueprintService = new GuildBlueprintService({
    clock: () => new Date(NOW),
    domains,
    planKey: PLAN_KEY,
  })
  const service = {
    execute(
      applicationId: string,
      botId: string,
      value: GuildBlueprintRequest,
      planDigest: string,
      domainExecutors: GuildBlueprintExecutors,
    ) {
      return blueprintService.execute(
        applicationId,
        botId,
        MESSAGE_CONTENT_INTENT,
        value,
        planDigest,
        domainExecutors,
      )
    },
    plan(applicationId: string, botId: string, value: GuildBlueprintRequest) {
      return blueprintService.plan(
        applicationId,
        botId,
        MESSAGE_CONTENT_INTENT,
        value,
      )
    },
    verify(applicationId: string, botId: string, value: GuildBlueprintRequest) {
      return blueprintService.verify(
        applicationId,
        botId,
        MESSAGE_CONTENT_INTENT,
        value,
      )
    },
  }
  return {
    blueprintService,
    calls,
    get resolvedOnboarding() {
      return resolvedOnboarding
    },
    get resolvedAutoModeration() {
      return resolvedAutoModeration
    },
    get resolvedChannelMetadata() {
      return resolvedChannelMetadata
    },
    get resolvedChannelPermissionOverwrites() {
      return resolvedChannelPermissionOverwrites
    },
    get resolvedPublications() {
      return resolvedPublications
    },
    get resolvedRoleConfigurations() {
      return resolvedRoleConfigurations
    },
    get resolvedRoleOrderings() {
      return resolvedRoleOrderings
    },
    get resolvedCommunity() {
      return resolvedCommunity
    },
    get resolvedSettings() {
      return resolvedSettings
    },
    get resolvedWelcomeScreen() {
      return resolvedWelcomeScreen
    },
    service,
  }
}

function executors(calls: string[]): GuildBlueprintExecutors {
  return {
    async executeAutoModeration(value, planDigest) {
      calls.push(`execute-automod:${planDigest}`)
      const normalized = normalizeAutoModerationChangeRequest(value)
      const ruleId = normalized.action === "create"
        ? CREATED_AUTOMOD_RULE_ID
        : normalized.ruleId
      return {
        action: normalized.action,
        activityId: "activity-automod",
        guildId: normalized.guildId,
        observed: null,
        operationKeyHash: normalized.operationKeyHash,
        planDigest,
        ruleId,
        schemaVersion: 1,
        status: "completed",
      } as AutoModerationResult
    },
    async executeChannelMetadata(value, planDigest) {
      calls.push(`execute-channel-metadata:${planDigest}`)
      return {
        activityId: "activity-channel-metadata",
        channelId: value.channelId,
        guildId: value.guildId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        schemaVersion: 1,
        status: "completed",
      } as ChannelMetadataChangeResult
    },
    async executeChannelPermissionOverwrite(value, planDigest) {
      calls.push(`execute-channel-permission-overwrite:${planDigest}`)
      return {
        activityId: "activity-channel-permission-overwrite",
        channelId: value.channelId,
        guildId: GUILD_ID,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        schemaVersion: 1,
        status: "completed",
        targetId: value.targetId,
        targetType: value.targetType,
      } as ChannelPermissionOverwriteResult
    },
    async executeComponent(value, planDigest) {
      calls.push("execute-publication")
      return {
        action: value.action,
        activityId: "activity-publication",
        channelId: value.channelId,
        guildId: GUILD_ID,
        messageId: value.action === "edit"
          ? value.messageId as string
          : PUBLICATION_MESSAGE_ID,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        readbackMatched: true,
        responseMatched: true,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${value.channelId}/${PUBLICATION_MESSAGE_ID}`,
      } as ComponentMessageResult
    },
    async executeCommunity(value, planDigest) {
      calls.push(`execute-community:${planDigest}`)
      return {
        activityId: "activity-community",
        changedFields: ["communityEnabled"],
        enablementRequired: true,
        guildId: value.guildId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        schemaVersion: 1,
        status: "completed",
        verification: "match",
        warnings: [],
      } as GuildCommunityChangeResult
    },
    async executeOnboarding(value, planDigest) {
      calls.push(`execute-onboarding:${planDigest}`)
      return {
        activityId: "activity-onboarding",
        guildId: value.guildId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        schemaVersion: 1,
        status: "completed",
        verification: "match",
      } as OnboardingChangeResult
    },
    async executeProfile(value, planDigest) {
      calls.push(`execute-profile:${planDigest}`)
      return {
        activityId: "activity-profile",
        driftFields: [],
        guildId: value.guildId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        requestedFields: ["name"],
        schemaVersion: 1,
        status: "completed",
        verification: "match",
        warnings: [],
      } as GuildProfileChangeResult
    },
    async executeRoleConfiguration(value, planDigest) {
      calls.push(`execute-role-configuration:${planDigest}`)
      return {
        activityId: "activity-role-configuration",
        guildId: value.guildId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        roleId: value.roleId,
        schemaVersion: 1,
        status: "completed",
      } as RoleConfigurationResult
    },
    async executeRoleOrdering(value, planDigest) {
      calls.push(`execute-role-ordering:${planDigest}`)
      return {
        activityId: "activity-role-ordering",
        anchorRoleId: value.anchorRoleId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        roleId: value.roleId,
        schemaVersion: 1,
        status: "completed",
      } as RoleOrderingResult
    },
    async executeScaffold(value, planDigest) {
      calls.push(`execute-structure:${planDigest}`)
      return {
        applicationId: APPLICATION_ID,
        botId: BOT_ID,
        executedSteps: [],
        guildId: value.guildId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        remaining: { ready: 0, waitingForParent: 0 },
        requestDigest: `hmac-sha256:${"a".repeat(64)}`,
        schemaVersion: 1,
        status: "completed",
      } as GuildScaffoldResult
    },
    async executeSettings(value, planDigest) {
      calls.push(`execute-settings:${planDigest}`)
      return {
        activityId: "activity-settings",
        driftFields: [],
        guildId: value.guildId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        requestedFields: ["verificationLevel"],
        schemaVersion: 1,
        status: "completed",
        verification: "match",
        warnings: [],
      } as GuildSettingsChangeResult
    },
    async executeWelcomeScreen(value, planDigest) {
      calls.push(`execute-welcome-screen:${planDigest}`)
      return {
        activityId: "activity-welcome-screen",
        guildId: value.guildId,
        operationKeyHash: operationKeyHash(value.operationKey),
        planDigest,
        schemaVersion: 1,
        status: "completed",
        verification: "match",
      } as WelcomeScreenChangeResult
    },
  }
}

test("guild blueprint validation is strict and binds deterministic phase identities", () => {
  const normalized = normalizeGuildBlueprintRequest(request())
  assert.equal(normalized.operationKeyHash, operationKeyHash(OPERATION_KEY))
  assert.deepEqual(
    normalized.scaffold.channels.map((channel) => channel.key),
    ["private-category", "private-system-channel"],
  )
  const structureKey = guildBlueprintStepOperationKey(OPERATION_KEY, "structure")
  const profileKey = guildBlueprintStepOperationKey(OPERATION_KEY, "profile")
  const communityKey = guildBlueprintStepOperationKey(OPERATION_KEY, "community")
  const automodKey = guildBlueprintAutoModerationOperationKey(
    OPERATION_KEY,
    AUTOMOD_KEY,
    "configure",
  )
  assert.equal(structureKey, guildBlueprintStepOperationKey(OPERATION_KEY, "structure"))
  assert.notEqual(structureKey, profileKey)
  assert.notEqual(communityKey, profileKey)
  assert.notEqual(automodKey, structureKey)
  assert.notEqual(
    automodKey,
    guildBlueprintAutoModerationOperationKey(OPERATION_KEY, AUTOMOD_KEY, "enable"),
  )
  assert.equal(structureKey.includes(OPERATION_KEY), false)
  assert.match(guildBlueprintRequestDigest(request()), /^hmac-sha256:[a-f0-9]{64}$/)
  assert.notEqual(
    guildBlueprintRequestDigest(request()),
    guildBlueprintRequestDigest(request({
      profile: { name: "Different Private Guild Name" },
    })),
  )

  const noPostPhase = request()
  delete noPostPhase.profile
  delete noPostPhase.settings
  assert.throws(
    () => normalizeGuildBlueprintRequest(noPostPhase),
    /requires a role, channel, profile, settings, Community, Welcome Screen, onboarding, AutoMod, or publication phase/u,
  )
  const unknownReference = request({
    settings: {
      systemChannel: { key: "missing", kind: "scaffold" },
    },
  })
  assert.throws(
    () => normalizeGuildBlueprintRequest(unknownReference),
    /does not reference a requested channel/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      settings: {
        systemChannel: { channelId: "0", kind: "exact" },
      },
    })),
    /positive Discord snowflake/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      guildId: "18446744073709551616",
    })),
    /guild ID must be a positive Discord snowflake/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      settings: {
        afkChannel: {
          key: "private-system-channel",
          kind: "scaffold",
        } as never,
      },
    })),
    /AFK channel scaffold key is not a compatible requested channel/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      settings: {
        systemChannel: { key: "private-category", kind: "scaffold" },
      },
    })),
    /system channel scaffold key is not a compatible requested channel/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      community: {
        ...community(),
        acknowledgeCommunityEnablement: false,
      } as never,
    })),
    /requires explicit enablement acknowledgement/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      community: {
        ...community(),
        publicUpdatesChannel: {
          key: "private-system-channel",
          kind: "scaffold",
        },
      },
    })),
    /must be distinct/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      community: {
        ...community(),
        rulesChannel: { key: "private-category", kind: "scaffold" },
      },
    })),
    /not a compatible requested channel/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      scaffold: {
        ...request().scaffold,
        roles: [{
          key: "private-role",
          name: "Private Role",
          unexpected: true,
        } as never],
      },
    })),
    /scaffold role must be an exact object/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest({
      ...request(),
      unexpected: true,
    } as GuildBlueprintRequest),
    /must be an exact object/u,
  )
})

test("guild blueprint canonicalizes exact convergence targets and identities", () => {
  const value = request({
    channelMetadata: [
      { channelId: SECOND_CHANNEL_ID, topic: null },
      { channelId: CHANNEL_ID, name: "private-renamed-channel" },
    ],
    roleConfigurations: [
      { permissions: ["VIEW_CHANNEL"], roleId: SECOND_ROLE_ID },
      { hoist: true, roleId: ROLE_ID },
    ],
  })
  delete value.profile
  delete value.settings
  const normalized = normalizeGuildBlueprintRequest(value)
  assert.deepEqual(
    normalized.roleConfigurations?.map(({ roleId }) => roleId),
    [ROLE_ID, SECOND_ROLE_ID],
  )
  assert.deepEqual(
    normalized.channelMetadata?.map(({ channelId }) => channelId),
    [CHANNEL_ID, SECOND_CHANNEL_ID],
  )
  const roleKey = guildBlueprintExactTargetOperationKey(
    OPERATION_KEY,
    "role-configuration",
    ROLE_ID,
  )
  const channelKey = guildBlueprintExactTargetOperationKey(
    OPERATION_KEY,
    "channel-metadata",
    CHANNEL_ID,
  )
  assert.notEqual(roleKey, channelKey)
  assert.equal(roleKey.includes(OPERATION_KEY), false)
  assert.equal(
    roleKey,
    guildBlueprintExactTargetOperationKey(
      OPERATION_KEY,
      "role-configuration",
      ROLE_ID,
    ),
  )
  assert.equal(
    guildBlueprintRequestDigest(value),
    guildBlueprintRequestDigest({
      ...value,
      channelMetadata: [...(value.channelMetadata ?? [])].reverse(),
      roleConfigurations: [...(value.roleConfigurations ?? [])].reverse(),
    }),
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      channelMetadata: [
        { channelId: CHANNEL_ID, name: "one" },
        { channelId: CHANNEL_ID, name: "two" },
      ],
    })),
    /target .* is duplicated/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      roleConfigurations: [{
        grantPermissions: ["SEND_MESSAGES"],
        permissions: ["VIEW_CHANNEL"],
        roleId: ROLE_ID,
      }],
    })),
    /cannot be combined/u,
  )
})

test("guild blueprint normalizes role order and one-target permission convergence", () => {
  const value = request({
    channelPermissionOverwrites: [
      {
        changes: [
          { permission: "SEND_MESSAGES", state: "deny" },
          { permission: "VIEW_CHANNEL", state: "allow" },
        ],
        channelId: CHANNEL_ID,
        mode: "update",
        target: {
          kind: "role",
          role: { key: "private-role", kind: "scaffold" },
        },
      },
      {
        channelId: SECOND_CHANNEL_ID,
        mode: "delete",
        target: { kind: "member", userId: NOTIFICATION_USER_ID },
      },
    ],
    roleOrder: [
      { kind: "exact", roleId: SECOND_ROLE_ID },
      { kind: "exact", roleId: THIRD_ROLE_ID },
      { key: "private-role", kind: "scaffold" },
    ],
  })
  delete value.profile
  delete value.settings
  const normalized = normalizeGuildBlueprintRequest(value)

  assert.deepEqual(normalized.roleOrder, value.roleOrder)
  assert.deepEqual(
    normalized.channelPermissionOverwrites?.map((entry) => [
      entry.channelId,
      entry.target.kind,
      entry.mode,
    ]),
    [
      [CHANNEL_ID, "role", "update"],
      [SECOND_CHANNEL_ID, "member", "delete"],
    ],
  )
  const update = normalized.channelPermissionOverwrites?.[0]
  assert.equal(update?.mode, "update")
  if (update?.mode !== "update") throw new Error("Expected update overwrite")
  assert.deepEqual(update.changes.map(({ permission }) => permission), [
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
  ])
  assert.notEqual(
    guildBlueprintRequestDigest(value),
    guildBlueprintRequestDigest({
      ...value,
      roleOrder: [...(value.roleOrder ?? [])].reverse(),
    }),
  )

  assert.throws(
    () => normalizeGuildBlueprintRequest({
      ...value,
      roleOrder: [
        { kind: "exact", roleId: SECOND_ROLE_ID },
        { kind: "exact", roleId: SECOND_ROLE_ID },
      ],
    }),
    /role-order references must be unique/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest({
      ...value,
      channelPermissionOverwrites: [
        value.channelPermissionOverwrites?.[0] as NonNullable<
          GuildBlueprintRequest["channelPermissionOverwrites"]
        >[number],
        value.channelPermissionOverwrites?.[0] as NonNullable<
          GuildBlueprintRequest["channelPermissionOverwrites"]
        >[number],
      ],
    }),
    /permission-overwrite targets must be unique/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest({
      ...value,
      channelPermissionOverwrites: [{
        changes: [{ permission: "VIEW_CHANNEL", state: "allow" }],
        channelId: CHANNEL_ID,
        mode: "delete",
        target: { kind: "member", userId: NOTIFICATION_USER_ID },
      }] as unknown as NonNullable<
        GuildBlueprintRequest["channelPermissionOverwrites"]
      >,
    }),
    /delete shape is invalid/u,
  )
})

test("guild blueprint sequences bottom-up role order before exact permission targets", async () => {
  const manifest = request({
    channelPermissionOverwrites: [{
      changes: [{ permission: "VIEW_CHANNEL", state: "allow" }],
      channelId: CHANNEL_ID,
      mode: "update",
      target: {
        kind: "role",
        role: { key: "private-role", kind: "scaffold" },
      },
    }],
    roleOrder: [
      { kind: "exact", roleId: SECOND_ROLE_ID },
      { kind: "exact", roleId: THIRD_ROLE_ID },
      { key: "private-role", kind: "scaffold" },
    ],
  })
  delete manifest.profile
  delete manifest.settings

  const ordering = fixture({ roleOrderingWrite: true })
  const orderingPlan = await ordering.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(orderingPlan.frontier?.kind, "role-ordering")
  if (orderingPlan.frontier?.kind !== "role-ordering") {
    throw new Error("Expected role-ordering frontier")
  }
  assert.equal(orderingPlan.frontier.index, 1)
  assert.equal(orderingPlan.frontier.roleId, THIRD_ROLE_ID)
  assert.equal(orderingPlan.frontier.anchorRoleId, ROLE_ID)
  assert.deepEqual(ordering.calls, ["plan-structure", "plan-role-ordering"])
  assert.deepEqual(
    orderingPlan.steps.map((step) => [
      step.kind,
      "index" in step ? step.index : null,
      step.state,
    ]),
    [
      ["structure", null, "satisfied"],
      ["role-ordering", 1, "ready"],
      ["role-ordering", 0, "waiting"],
      ["channel-permission-overwrite", 0, "waiting"],
    ],
  )

  const overwrite = fixture({ channelPermissionOverwriteWrite: true })
  const overwritePlan = await overwrite.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(overwritePlan.frontier?.kind, "channel-permission-overwrite")
  if (overwritePlan.frontier?.kind !== "channel-permission-overwrite") {
    throw new Error("Expected permission-overwrite frontier")
  }
  assert.equal(overwritePlan.frontier.channelId, CHANNEL_ID)
  assert.equal(overwritePlan.frontier.targetId, ROLE_ID)
  assert.deepEqual(overwrite.resolvedRoleOrderings.map((entry) => [
    entry.roleId,
    entry.anchorRoleId,
  ]), [
    [THIRD_ROLE_ID, ROLE_ID],
    [SECOND_ROLE_ID, THIRD_ROLE_ID],
  ])
  assert.equal(overwrite.resolvedChannelPermissionOverwrites[0]?.targetId, ROLE_ID)
  assert.deepEqual(overwritePlan.manifestPreview.entries.map(({ id }) => id), [
    "structure",
    "role-ordering:1",
    "role-ordering:0",
    "channel-permission-overwrite:0",
  ])
  const lowerOrderingPreview = overwritePlan.manifestPreview.entries.find(({ id }) => (
    id === "role-ordering:1"
  ))
  assert.equal(lowerOrderingPreview?.manifestPath, "$.roleOrder[1:3]")
  assert.deepEqual(
    lowerOrderingPreview?.references.map(({ path }) => path),
    ["$.roleOrder[1].roleId", "$.roleOrder[2].key"],
  )
  assert.deepEqual(
    lowerOrderingPreview?.potentialWriteStages,
    ["order-resolved-role-adjacency"],
  )
  assert.deepEqual(
    overwritePlan.manifestPreview.entries.find(({ id }) => (
      id === "channel-permission-overwrite:0"
    ))?.potentialWriteStages,
    ["converge-exact-channel-target-overwrite"],
  )
})

test("guild blueprint rejects duplicate role identities after scaffold resolution", async () => {
  const roleManifest = request({
    roleOrder: [
      { kind: "exact", roleId: ROLE_ID },
      { kind: "exact", roleId: THIRD_ROLE_ID },
      { key: "private-role", kind: "scaffold" },
    ],
  })
  delete roleManifest.profile
  delete roleManifest.settings
  const roleFixture = fixture()
  await assert.rejects(
    roleFixture.service.plan(APPLICATION_ID, BOT_ID, roleManifest),
    /resolved role-order references must be unique/u,
  )
  assert.deepEqual(roleFixture.calls, ["plan-structure"])

  const overwriteManifest = request({
    channelPermissionOverwrites: [{
      changes: [{ permission: "VIEW_CHANNEL", state: "allow" }],
      channelId: CHANNEL_ID,
      mode: "update",
      target: {
        kind: "role",
        role: { kind: "exact", roleId: ROLE_ID },
      },
    }, {
      changes: [{ permission: "SEND_MESSAGES", state: "deny" }],
      channelId: CHANNEL_ID,
      mode: "update",
      target: {
        kind: "role",
        role: { key: "private-role", kind: "scaffold" },
      },
    }],
  })
  delete overwriteManifest.profile
  delete overwriteManifest.settings
  const overwriteFixture = fixture()
  await assert.rejects(
    overwriteFixture.service.plan(
      APPLICATION_ID,
      BOT_ID,
      overwriteManifest,
    ),
    /resolved channel permission-overwrite targets must be unique/u,
  )
  assert.deepEqual(overwriteFixture.calls, ["plan-structure"])
})

test("guild blueprint rejects changed hierarchy-domain plan bindings", async () => {
  const roleManifest = request({
    roleOrder: [
      { kind: "exact", roleId: SECOND_ROLE_ID },
      { key: "private-role", kind: "scaffold" },
    ],
  })
  delete roleManifest.profile
  delete roleManifest.settings
  const changedRole = fixture({
    roleOrderingPlanTransform(plan) {
      plan.anchor.id = THIRD_ROLE_ID
      return plan
    },
  })
  await assert.rejects(
    changedRole.service.plan(APPLICATION_ID, BOT_ID, roleManifest),
    /role-ordering target changed/u,
  )

  const overwriteManifest = request({
    channelPermissionOverwrites: [{
      changes: [{ permission: "VIEW_CHANNEL", state: "allow" }],
      channelId: CHANNEL_ID,
      mode: "update",
      target: { kind: "member", userId: NOTIFICATION_USER_ID },
    }],
  })
  delete overwriteManifest.profile
  delete overwriteManifest.settings
  const changedOverwrite = fixture({
    channelPermissionOverwritePlanTransform(plan) {
      plan.target.id = SECOND_ROLE_ID
      return plan
    },
  })
  await assert.rejects(
    changedOverwrite.service.plan(APPLICATION_ID, BOT_ID, overwriteManifest),
    /permission-overwrite target changed/u,
  )
  const changedOverwriteAction = fixture({
    channelPermissionOverwritePlanTransform(plan) {
      plan.action = "delete"
      return plan
    },
  })
  await assert.rejects(
    changedOverwriteAction.service.plan(
      APPLICATION_ID,
      BOT_ID,
      overwriteManifest,
    ),
    /permission-overwrite target changed/u,
  )
})

test("guild blueprint AutoMod rules normalize strict references and identities", () => {
  const normalized = normalizeGuildBlueprintRequest(request({
    autoModerationRules: autoModerationRules(),
  }))
  const rule = normalized.autoModerationRules?.[0]

  assert.equal(rule?.key, AUTOMOD_KEY)
  assert.equal(rule?.enabled, true)
  assert.deepEqual(rule?.actions.map((action) => action.type), [
    "block-message",
    "send-alert-message",
  ])
  assert.deepEqual(rule?.exemptChannels, [{
    key: "private-system-channel",
    kind: "scaffold",
  }])
  assert.equal("operationKey" in (rule ?? {}), false)

  const maximumSnowflake = DISCORD_SNOWFLAKE_MAX.toString()
  const collisionSafe = normalizeGuildBlueprintRequest(request({
    autoModerationRules: autoModerationRules({
      exemptChannels: [{
        channelId: maximumSnowflake,
        kind: "exact",
      }, {
        key: "private-system-channel",
        kind: "scaffold",
      }],
    }),
  }))
  assert.deepEqual(collisionSafe.autoModerationRules?.[0]?.exemptChannels, [{
    channelId: maximumSnowflake,
    kind: "exact",
  }, {
    key: "private-system-channel",
    kind: "scaffold",
  }])

  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      autoModerationRules: [
        ...autoModerationRules(),
        ...autoModerationRules(),
      ],
    })),
    /keys must be valid and unique/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      autoModerationRules: autoModerationRules({
        actions: [{
          channel: { key: "private-category", kind: "scaffold" },
          type: "send-alert-message",
        }],
      }),
    })),
    /alert channel scaffold key is not a compatible requested channel/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      autoModerationRules: autoModerationRules({
        ruleId: "0",
      }),
    })),
    /must be a positive Discord snowflake/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      autoModerationRules: autoModerationRules({
        actions: [{ durationSeconds: 60, type: "timeout" }],
        trigger: { type: "spam" },
      }),
    })),
    /timeout is incompatible/u,
  )
})

test("guild blueprint publications normalize one strict bounded manifest contract", () => {
  const { profile: _profile, settings: _settings, ...base } = request()
  const manifest: GuildBlueprintRequest = {
    ...base,
    publications: publications(),
  }
  const normalized = normalizeGuildBlueprintRequest(manifest)
  assert.equal(normalized.publications?.[0]?.key, PUBLICATION_KEY)
  assert.deepEqual(normalized.publications?.[0]?.components, [{
    content: PUBLICATION_TEXT,
    kind: "text",
  }])
  const publicationKey = guildBlueprintPublicationOperationKey(
    OPERATION_KEY,
    PUBLICATION_KEY,
  )
  assert.equal(
    publicationKey,
    guildBlueprintPublicationOperationKey(OPERATION_KEY, PUBLICATION_KEY),
  )
  assert.notEqual(
    publicationKey,
    guildBlueprintPublicationOperationKey(OPERATION_KEY, "another-publication"),
  )
  assert.notEqual(
    publicationKey,
    guildBlueprintStepOperationKey(OPERATION_KEY, "structure"),
  )
  const reorderedPublications = [
    ...publications(),
    { ...publications()[0]!, key: "another-publication" },
  ]
  assert.notEqual(
    guildBlueprintRequestDigest({ ...manifest, publications: reorderedPublications }),
    guildBlueprintRequestDigest({
      ...manifest,
      publications: [...reorderedPublications].reverse(),
    }),
  )
  assert.deepEqual(
    reorderedPublications.map((publication) => (
      guildBlueprintPublicationOperationKey(OPERATION_KEY, publication.key)
    )).sort(),
    [...reorderedPublications].reverse().map((publication) => (
      guildBlueprintPublicationOperationKey(OPERATION_KEY, publication.key)
    )).sort(),
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest({ ...manifest, publications: [] }),
    /publications are invalid/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest({
      ...manifest,
      publications: [...publications(), ...publications()],
    }),
    /publication keys must be unique/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest({
      ...manifest,
      publications: [{
        ...publications()[0]!,
        channel: { key: "private-category", kind: "scaffold" },
      }],
    }),
    /not a compatible requested channel/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest({
      ...manifest,
      publications: Array.from(
        { length: CONNECTOR_LIMITS.guildBlueprintPublications + 1 },
        (_, index) => ({
          ...publications()[0]!,
          key: `publication-${index}`,
        }),
      ),
    }),
    /publications are invalid/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest({
      ...manifest,
      publications: [{
        ...publications()[0]!,
        messageId: PUBLICATION_MESSAGE_ID,
      } as GuildBlueprintRequest["publications"] extends readonly (infer Entry)[]
        ? Entry
        : never],
    }),
    /create shape is invalid/u,
  )
})

test("guild blueprint preview exposes the complete normalized intent without authority", () => {
  const manifest = request({
    autoModerationRules: autoModerationRules(),
    channelMetadata: [{ channelId: CHANNEL_ID, topic: null }],
    community: community(),
    onboarding: onboarding(),
    publications: publications(),
    roleConfigurations: [{ hoist: true, roleId: ROLE_ID }],
    welcomeScreen: welcomeScreen(),
  })
  const preview = previewGuildBlueprintManifest(manifest)

  assert.equal(preview.status, "previewed")
  assert.deepEqual(preview.authority, {
    discordContacted: false,
    executablePlanCreated: false,
    liveStateAssessed: false,
    requestDigestAuthority: "comparison-only-not-an-approval",
    writeAuthorityGranted: false,
  })
  assert.equal("operationKey" in preview.normalizedManifest, false)
  assert.equal(preview.normalizedManifest.operationKeyHash, operationKeyHash(OPERATION_KEY))
  assert.equal(preview.operationKeyHash, operationKeyHash(OPERATION_KEY))
  assert.equal(preview.requestDigest, guildBlueprintRequestDigest(manifest))
  assert.deepEqual(
    preview.sequence.map((entry) => entry.id),
    [
      "structure",
      "role-configuration:0",
      "channel-metadata:0",
      "profile",
      "settings",
      "community",
      "welcome-screen",
      "onboarding",
      "auto-moderation:0",
      "publication:0",
    ],
  )
  assert.deepEqual(
    preview.sequence.map((entry) => entry.dependsOn),
    [
      [],
      ["structure"],
      ["role-configuration:0"],
      ["channel-metadata:0"],
      ["profile"],
      ["settings"],
      ["community"],
      ["welcome-screen"],
      ["onboarding"],
      ["auto-moderation:0"],
    ],
  )
  const references = preview.sequence.flatMap((entry) => entry.references)
  assert.equal(references.some((reference) => (
    reference.kind === "exact"
    && reference.resource === "channel"
    && reference.id === PUBLICATION_CHANNEL_ID
  )), true)
  assert.equal(references.some((reference) => (
    reference.kind === "exact"
    && reference.resource === "user"
    && reference.id === NOTIFICATION_USER_ID
  )), true)
  assert.equal(references.some((reference) => (
    reference.kind === "scaffold"
    && reference.resource === "role"
    && reference.key === "private-role"
    && reference.relationship === "uses"
  )), true)
  assert.deepEqual(
    preview.sequence.find((entry) => entry.id === "auto-moderation:0")
      ?.potentialWriteStages,
    ["disable-if-required", "configure", "enable"],
  )
  assert.match(preview.warnings.join("\n"), /does not contact Discord/u)
  assert.match(preview.warnings.join("\n"), /not an executable plan digest/u)
  assert.deepEqual(preview, previewGuildBlueprintManifest(manifest))
})

test("guild blueprint preview rejects inconsistent live planner projections", () => {
  const preview = previewGuildBlueprintManifest(request())
  const projectedStep = (
    kind: "community" | "profile" | "settings" | "structure",
    state: GuildBlueprintPlanStep["state"],
    writeRequired: boolean,
  ): GuildBlueprintPlanStep => ({
    kind,
    nestedPlanDigest: null,
    operationKeyHash: operationKeyHash(OPERATION_KEY),
    state,
    writeRequired,
  })

  assert.throws(
    () => projectGuildBlueprintPlanManifestPreview(
      preview,
      [
        projectedStep("structure", "ready", true),
        projectedStep("profile", "waiting", false),
        projectedStep("settings", "waiting", false),
      ],
      null,
    ),
    /frontier is inconsistent/u,
  )
  assert.throws(
    () => projectGuildBlueprintPlanManifestPreview(
      preview,
      [
        projectedStep("structure", "satisfied", false),
        projectedStep("profile", "satisfied", false),
        projectedStep("settings", "satisfied", false),
        projectedStep("community", "satisfied", false),
      ],
      null,
    ),
    /unsupported live prerequisite/u,
  )
})

test("guild blueprint publications recover in order and expose one exact frontier", async () => {
  const state = fixture({
    componentVerification(value, index) {
      return componentVerification(value, index === 0 ? "verified" : "not-found")
    },
  })
  const desired: NonNullable<GuildBlueprintRequest["publications"]> = [
    {
      ...publications()[0]!,
      channel: { channelId: PUBLICATION_CHANNEL_ID, kind: "exact" },
    },
    {
      ...publications()[0]!,
      key: "second-publication",
    },
  ]
  const plan = await state.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ publications: desired }),
  )
  assert.equal(plan.status, "planned")
  assert.equal(plan.frontier?.kind, "publication")
  if (plan.frontier?.kind !== "publication") {
    throw new Error("Expected a publication frontier")
  }
  assert.equal(plan.frontier.index, 1)
  assert.equal(plan.frontier.key, "second-publication")
  assert.deepEqual(state.calls.slice(-3), [
    "verify-publication",
    "verify-publication",
    "plan-publication",
  ])
  const publicationSteps = plan.steps.filter((step) => step.kind === "publication")
  assert.deepEqual(
    publicationSteps.map((step) => [
      step.index,
      step.key,
      step.state,
      step.messageId,
      step.verificationStatus,
    ]),
    [
      [0, PUBLICATION_KEY, "satisfied", PUBLICATION_MESSAGE_ID, "verified"],
      [1, "second-publication", "ready", null, "not-found"],
    ],
  )
  assert.equal(state.resolvedPublications[0]?.channelId, PUBLICATION_CHANNEL_ID)
  assert.equal(state.resolvedPublications[1]?.channelId, CHANNEL_ID)
  assert.equal(
    state.resolvedPublications[1]?.operationKey,
    guildBlueprintPublicationOperationKey(OPERATION_KEY, "second-publication"),
  )
})

test("guild blueprint publication blockers stop without planning or writing", async () => {
  const state = fixture({
    componentVerification(value) {
      return componentVerification(value, "blocked")
    },
  })
  const manifest = request({
    publications: [
      ...publications(),
      { ...publications()[0]!, key: "later-publication" },
    ],
  })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(plan.status, "blocked")
  assert.equal(plan.frontier, null)
  assert.equal(plan.blocker?.kind, "publication")
  if (plan.blocker?.kind !== "publication") assert.fail("Expected publication blocker")
  assert.equal(plan.blocker.index, 0)
  assert.equal(plan.blocker.verificationStatus, "blocked")
  assert.equal(state.calls.includes("plan-publication"), false)
  assert.deepEqual(
    plan.steps.filter((step) => step.kind === "publication")
      .map((step) => step.state),
    ["blocked", "waiting"],
  )
  state.calls.length = 0
  const executionCalls: string[] = []
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    manifest,
    plan.digest,
    executors(executionCalls),
  )
  assert.equal(result.status, "blocked")
  assert.equal(result.nextAction, "inspect")
  assert.equal(result.blocker?.verificationReason, "request-mismatch")
  assert.deepEqual(executionCalls, [])
  assert.equal(state.calls.includes("plan-publication"), false)
})

test("guild blueprint publications preserve every receipt and readback blocker", async () => {
  const reasons = [
    "operation-pending",
    "operation-failed",
    "operation-uncertain",
    "receipt-target-mismatch",
    "message-missing",
    "message-state-mismatch",
  ] as const
  for (const reason of reasons) {
    const state = fixture({
      componentVerification(value) {
        return componentReceiptBlocker(value, reason)
      },
    })
    const plan = await state.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ publications: publications() }),
    )
    assert.equal(plan.status, "blocked", reason)
    assert.equal(plan.frontier, null, reason)
    assert.equal(plan.blocker?.verificationReason, reason)
    assert.equal(
      plan.blocker?.verificationStatus,
      reason === "message-missing" || reason === "message-state-mismatch"
        ? "drifted"
        : "blocked",
      reason,
    )
    assert.equal(
      plan.blocker?.messageId,
      reason === "receipt-target-mismatch"
        || reason === "operation-pending"
        || reason === "operation-failed"
        ? null
        : PUBLICATION_MESSAGE_ID,
      reason,
    )
    assert.equal(state.calls.includes("plan-publication"), false, reason)
  }
})

test("guild blueprint publications fail closed on intent and nested identity changes", async () => {
  const intentState = fixture()
  await assert.rejects(
    intentState.blueprintService.plan(
      APPLICATION_ID,
      BOT_ID,
      "disabled",
      request({ publications: publications() }),
    ),
    /requires confirmed Message Content intent/u,
  )

  for (const changedIdentity of [
    { applicationId: "100000000000000002" },
    { botId: "300000000000000002" },
  ]) {
    const state = fixture({
      componentPlanTransform(plan) {
        return { ...plan, ...changedIdentity }
      },
    })
    await assert.rejects(
      state.service.plan(
        APPLICATION_ID,
        BOT_ID,
        request({ publications: publications() }),
      ),
      /nested plan identity changed/u,
    )
  }
})

test("guild blueprint publications reject inconsistent verifier evidence", async () => {
  const transforms: Array<(
    value: ComponentMessageRequest,
  ) => ComponentMessageVerificationResult> = [
    (value) => ({
      ...componentVerification(value),
      operationKeyHash: operationKeyHash("different-publication-operation-key"),
    }),
    (value) => ({
      ...componentVerification(value, "verified"),
      receiptStatus: "pending",
    }),
    (value) => ({
      ...componentReceiptBlocker(value, "operation-pending"),
      reason: "operation-failed",
    }),
    (value) => ({
      ...componentReceiptBlocker(value, "message-missing"),
      messageId: null,
    }),
  ]
  for (const transform of transforms) {
    const state = fixture({ componentVerification: transform })
    await assert.rejects(
      state.service.plan(
        APPLICATION_ID,
        BOT_ID,
        request({ publications: publications() }),
      ),
      /component .* (binding|evidence) changed/u,
    )
  }
})

test("guild blueprint accepts an exact already-current publication edit", async () => {
  const state = fixture({ componentWrite: false })
  const manifest = request({
    publications: [{
      action: "edit",
      channel: { channelId: PUBLICATION_CHANNEL_ID, kind: "exact" },
      components: [{ content: PUBLICATION_TEXT, kind: "text" }],
      key: PUBLICATION_KEY,
      messageId: PUBLICATION_MESSAGE_ID,
    }],
  })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(plan.status, "already-current")
  assert.equal(plan.frontier, null)
  const publicationStep = plan.steps.find((step) => step.kind === "publication")
  assert.equal(publicationStep?.state, "satisfied")
  assert.equal(publicationStep?.messageId, PUBLICATION_MESSAGE_ID)
  assert.equal(publicationStep?.verificationStatus, "not-found")
})

test("guild blueprint publication verification omits caller content and keys", async () => {
  const state = fixture({
    componentVerification(value) {
      return componentVerification(value, "verified")
    },
  })
  const manifest = request({ publications: publications() })
  const result = await state.service.verify(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(result.status, "verified")
  assert.equal(result.steps.at(-1)?.kind, "publication")
  assert.equal(result.steps.at(-1)?.messageId, PUBLICATION_MESSAGE_ID)
  const serialized = JSON.stringify(result)
  for (const privateValue of [
    PUBLICATION_KEY,
    PUBLICATION_TEXT,
    NOTIFICATION_USER_ID,
    OPERATION_KEY,
  ]) assert.equal(serialized.includes(privateValue), false)
})

test("guild blueprint executes one publication through the component executor", async () => {
  const state = fixture()
  const manifest = request({ publications: publications() })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(plan.frontier?.kind, "publication")
  state.calls.length = 0
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    manifest,
    plan.digest,
    executors(state.calls),
  )
  assert.equal(result.status, "frontier-executed")
  assert.equal(result.executedPhase, "publication")
  assert.equal(result.executedPublicationIndex, 0)
  assert.equal(result.nestedResult?.status, "completed")
  assert.equal(state.calls.filter((call) => call === "execute-publication").length, 1)
})

test("guild blueprint accepts Welcome Screen as its only post-scaffold phase", () => {
  const manifest = request({ welcomeScreen: welcomeScreen() })
  delete manifest.profile
  delete manifest.settings
  const normalized = normalizeGuildBlueprintRequest(manifest)
  assert.equal(normalized.profile, undefined)
  assert.equal(normalized.settings, undefined)
  assert.deepEqual(
    normalized.welcomeScreen?.channels.map((entry) => entry.channel),
    [{ key: "private-system-channel", kind: "scaffold" }],
  )
  assert.notEqual(
    guildBlueprintStepOperationKey(OPERATION_KEY, "welcome-screen"),
    guildBlueprintStepOperationKey(OPERATION_KEY, "settings"),
  )
  const changedManifest = request({
    welcomeScreen: {
      ...welcomeScreen(),
      description: "Different private Welcome Screen description",
    },
  })
  delete changedManifest.profile
  delete changedManifest.settings
  assert.notEqual(
    guildBlueprintRequestDigest(manifest),
    guildBlueprintRequestDigest(changedManifest),
  )

  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      welcomeScreen: {
        ...welcomeScreen(),
        channels: [{
          channel: { key: "private-category", kind: "scaffold" },
          description: WELCOME_CHANNEL_DESCRIPTION,
          emoji: { kind: "none" },
        }],
      },
    })),
    /Welcome Screen channel scaffold key is not a compatible requested channel/u,
  )
  const desired = welcomeScreen()
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      welcomeScreen: {
        ...desired,
        channels: [...desired.channels, ...desired.channels],
      },
    })),
    /Welcome Screen channel references must be unique/u,
  )
})

test("guild blueprint accepts onboarding as its only post-scaffold phase", () => {
  const manifest = request({ onboarding: onboarding() })
  delete manifest.profile
  delete manifest.settings
  const normalized = normalizeGuildBlueprintRequest(manifest)
  assert.equal(normalized.profile, undefined)
  assert.equal(normalized.settings, undefined)
  assert.deepEqual(normalized.onboarding?.defaultChannels, [
    { key: "private-system-channel", kind: "scaffold" },
  ])
  assert.deepEqual(normalized.onboarding?.prompts[0]?.options[0]?.roles, [
    { key: "private-role", kind: "scaffold" },
  ])
  assert.notEqual(
    guildBlueprintStepOperationKey(OPERATION_KEY, "onboarding"),
    guildBlueprintStepOperationKey(OPERATION_KEY, "welcome-screen"),
  )
  const changedManifest = request({
    onboarding: {
      ...onboarding(),
      prompts: [{
        ...onboarding().prompts[0]!,
        title: "Different private onboarding prompt title",
      }],
    },
  })
  delete changedManifest.profile
  delete changedManifest.settings
  assert.notEqual(
    guildBlueprintRequestDigest(manifest),
    guildBlueprintRequestDigest(changedManifest),
  )

  const retained = onboarding()
  retained.prompts = [{
    ...retained.prompts[0]!,
    options: [{
      ...retained.prompts[0]!.options[0]!,
      optionId: ONBOARDING_OPTION_ID,
    }],
    promptId: ONBOARDING_PROMPT_ID,
  }]
  const retainedManifest = request({ onboarding: retained })
  delete retainedManifest.profile
  delete retainedManifest.settings
  const normalizedRetained = normalizeGuildBlueprintRequest(retainedManifest)
  assert.equal(
    normalizedRetained.onboarding?.prompts[0]?.promptId,
    ONBOARDING_PROMPT_ID,
  )
  assert.equal(
    normalizedRetained.onboarding?.prompts[0]?.options[0]?.optionId,
    ONBOARDING_OPTION_ID,
  )

  const desired = onboarding()
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      onboarding: {
        ...desired,
        defaultChannels: [{ key: "private-category", kind: "scaffold" }],
      },
    })),
    /onboarding default channel references scaffold key is not a compatible requested channel/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      onboarding: {
        ...desired,
        prompts: [{
          ...desired.prompts[0]!,
          options: [{
            ...desired.prompts[0]!.options[0]!,
            roles: [{ key: "missing-role", kind: "scaffold" }],
          }],
        }],
      },
    })),
    /does not reference a requested role/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      onboarding: {
        ...desired,
        defaultChannels: [
          ...desired.defaultChannels,
          ...desired.defaultChannels,
        ],
      },
    })),
    /onboarding default channel references must be unique/u,
  )
  assert.throws(
    () => normalizeGuildBlueprintRequest(request({
      onboarding: {
        ...desired,
        prompts: [{
          ...desired.prompts[0]!,
          options: [{
            ...desired.prompts[0]!.options[0]!,
            roles: [
              ...desired.prompts[0]!.options[0]!.roles,
              ...desired.prompts[0]!.options[0]!.roles,
            ],
          }],
        }],
      },
    })),
    /onboarding option role references must be unique/u,
  )
})

test("guild blueprint exposes only the structure frontier before later planning", async () => {
  const state = fixture({ scaffoldStatus: "planned" })
  const plan = await state.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ onboarding: onboarding(), welcomeScreen: welcomeScreen() }),
  )
  assert.equal(plan.status, "planned")
  assert.equal(plan.frontier?.kind, "structure")
  assert.deepEqual(state.calls, ["plan-structure"])
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.state]),
    [
      ["structure", "ready"],
      ["profile", "waiting"],
      ["settings", "waiting"],
      ["welcome-screen", "waiting"],
      ["onboarding", "waiting"],
    ],
  )
  assert.deepEqual(plan.bindings, [])
  assert.equal(plan.manifestPreview.coverage, "complete-intent-sequence-current-frontier-only")
  assert.equal(plan.manifestPreview.frontierEntryId, "structure")
  assert.equal(plan.manifestPreview.executableEntryId, "structure")
  assert.equal(plan.manifestPreview.summary.assessed, 1)
  assert.equal(plan.manifestPreview.summary.deferred, 4)
  assert.deepEqual(
    plan.manifestPreview.entries.map((entry) => [
      entry.id,
      entry.assessment.state,
      entry.assessment.executable,
    ]),
    [
      ["structure", "ready", true],
      ["profile", "waiting", false],
      ["settings", "waiting", false],
      ["welcome-screen", "waiting", false],
      ["onboarding", "waiting", false],
    ],
  )
})

test("guild blueprint sequences and executes exact convergence one target at a time", async () => {
  const value = request({
    channelMetadata: [{ channelId: CHANNEL_ID, topic: null }],
    roleConfigurations: [{
      permissions: ["VIEW_CHANNEL", "SEND_MESSAGES"],
      roleId: ROLE_ID,
    }],
  })
  delete value.profile
  delete value.settings
  const roleFixture = fixture({
    channelMetadataWrite: true,
    roleConfigurationWrite: true,
  })
  const rolePlan = await roleFixture.service.plan(APPLICATION_ID, BOT_ID, value)
  assert.equal(rolePlan.frontier?.kind, "role-configuration")
  assert.equal(rolePlan.steps[1]?.kind, "role-configuration")
  assert.equal(rolePlan.steps[1]?.state, "ready")
  assert.equal(rolePlan.steps[2]?.kind, "channel-metadata")
  assert.equal(rolePlan.steps[2]?.state, "waiting")
  assert.deepEqual(roleFixture.calls, [
    "plan-structure",
    "plan-role-configuration",
  ])
  assert.deepEqual(roleFixture.resolvedRoleConfigurations[0], {
    auditReason: AUDIT_REASON,
    guildId: GUILD_ID,
    operationKey: guildBlueprintExactTargetOperationKey(
      OPERATION_KEY,
      "role-configuration",
      ROLE_ID,
    ),
    permissions: ["VIEW_CHANNEL", "SEND_MESSAGES"],
    roleId: ROLE_ID,
  })
  const roleExecutionCalls: string[] = []
  const roleResult = await roleFixture.service.execute(
    APPLICATION_ID,
    BOT_ID,
    value,
    rolePlan.digest,
    executors(roleExecutionCalls),
  )
  assert.equal(roleResult.executedPhase, "role-configuration")
  assert.equal(roleResult.executedRoleConfigurationIndex, 0)
  assert.equal(roleResult.executedChannelMetadataIndex, null)
  assert.match(roleExecutionCalls[0] as string, /^execute-role-configuration:/u)

  const channelFixture = fixture({
    channelMetadataWrite: true,
    roleConfigurationWrite: false,
  })
  const channelPlan = await channelFixture.service.plan(
    APPLICATION_ID,
    BOT_ID,
    value,
  )
  assert.equal(channelPlan.frontier?.kind, "channel-metadata")
  assert.equal(channelPlan.steps[1]?.state, "satisfied")
  assert.equal(channelPlan.steps[2]?.state, "ready")
  assert.deepEqual(channelFixture.calls, [
    "plan-structure",
    "plan-role-configuration",
    "plan-channel-metadata",
  ])
  const channelExecutionCalls: string[] = []
  const channelResult = await channelFixture.service.execute(
    APPLICATION_ID,
    BOT_ID,
    value,
    channelPlan.digest,
    executors(channelExecutionCalls),
  )
  assert.equal(channelResult.executedPhase, "channel-metadata")
  assert.equal(channelResult.executedChannelMetadataIndex, 0)
  assert.equal(channelResult.executedRoleConfigurationIndex, null)
  assert.match(channelExecutionCalls[0] as string, /^execute-channel-metadata:/u)
})

test("guild blueprint stops at profile before planning settings", async () => {
  const state = fixture({ profileWrite: true })
  const plan = await state.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ onboarding: onboarding(), welcomeScreen: welcomeScreen() }),
  )
  assert.equal(plan.frontier?.kind, "profile")
  assert.deepEqual(state.calls, ["plan-structure", "plan-profile"])
  assert.equal(plan.bindings.length, 3)
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.state]),
    [
      ["structure", "satisfied"],
      ["profile", "ready"],
      ["settings", "waiting"],
      ["welcome-screen", "waiting"],
      ["onboarding", "waiting"],
    ],
  )
})

test("guild blueprint resolves settings only from exact scaffold evidence", async () => {
  const state = fixture({ settingsWrite: true })
  const plan = await state.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ onboarding: onboarding(), welcomeScreen: welcomeScreen() }),
  )
  assert.equal(plan.frontier?.kind, "settings")
  assert.deepEqual(state.calls, ["plan-structure", "plan-profile", "plan-settings"])
  assert.equal(state.resolvedSettings?.systemChannelId, CHANNEL_ID)
  assert.equal(
    state.resolvedSettings?.operationKey,
    guildBlueprintStepOperationKey(OPERATION_KEY, "settings"),
  )
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.state]),
    [
      ["structure", "satisfied"],
      ["profile", "satisfied"],
      ["settings", "ready"],
      ["welcome-screen", "waiting"],
      ["onboarding", "waiting"],
    ],
  )
  assert.equal(state.resolvedWelcomeScreen, null)
})

test("guild blueprint resolves and executes Community before dependent phases", async () => {
  const state = fixture({ communityWrite: true })
  const manifest = request({
    community: community(),
    onboarding: { ...onboarding(), enabled: true },
    welcomeScreen: welcomeScreen(),
  })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)

  assert.equal(plan.frontier?.kind, "community")
  assert.deepEqual(state.calls, [
    "plan-structure",
    "plan-profile",
    "plan-settings",
    "plan-community",
  ])
  assert.equal(state.resolvedCommunity?.rulesChannelId, CHANNEL_ID)
  assert.equal(
    state.resolvedCommunity?.publicUpdatesChannelId,
    PUBLICATION_CHANNEL_ID,
  )
  assert.equal(
    state.resolvedCommunity?.operationKey,
    guildBlueprintStepOperationKey(OPERATION_KEY, "community"),
  )
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.state]),
    [
      ["structure", "satisfied"],
      ["profile", "satisfied"],
      ["settings", "satisfied"],
      ["community", "ready"],
      ["welcome-screen", "waiting"],
      ["onboarding", "waiting"],
    ],
  )

  const executionCalls: string[] = []
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    manifest,
    plan.digest,
    executors(executionCalls),
  )
  assert.equal(result.status, "frontier-executed")
  assert.equal(result.executedPhase, "community")
  assert.equal(result.nestedResult?.status, "completed")
  assert.equal(executionCalls.length, 1)
  assert.match(executionCalls[0] as string, /^execute-community:hmac-sha256:/u)
})

test("guild blueprint advances past an already-current Community phase", async () => {
  const state = fixture({ communityWrite: false, welcomeScreenWrite: true })
  const plan = await state.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ community: community(), welcomeScreen: welcomeScreen() }),
  )

  assert.equal(plan.frontier?.kind, "welcome-screen")
  assert.deepEqual(state.calls, [
    "plan-structure",
    "plan-profile",
    "plan-settings",
    "plan-community",
    "plan-welcome-screen",
  ])
  assert.equal(
    plan.steps.find((step) => step.kind === "community")?.state,
    "satisfied",
  )
})

test("guild blueprint rejects malformed Community plan bindings", async () => {
  const transforms: Array<NonNullable<FixtureOptions["communityPlanTransform"]>> = [
    (plan) => ({
      ...plan,
      desired: {
        ...plan.desired,
        publicUpdatesChannelId: CHANNEL_ID,
      },
    }),
    (plan) => ({
      ...plan,
      status: "future-status",
      writeRequired: false,
    } as unknown as GuildCommunityChangePlan),
  ]
  for (const communityPlanTransform of transforms) {
    const state = fixture({ communityPlanTransform })
    await assert.rejects(
      state.service.plan(
        APPLICATION_ID,
        BOT_ID,
        request({ community: community() }),
      ),
      /Community plan target changed/u,
    )
  }
})

test("guild blueprint rejects mismatched Community dependency identity", async () => {
  const state = fixture({
    communityAuditTransform(audit) {
      return { ...audit, botId: "300000000000000002" }
    },
  })
  await assert.rejects(
    state.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({ welcomeScreen: welcomeScreen() }),
    ),
    /nested plan identity changed/u,
  )
})

test("guild blueprint blocks Community-dependent enablement before downstream planning", async () => {
  const state = fixture({ communityEnabled: false })
  const manifest = request({
    onboarding: { ...onboarding(), enabled: true },
    welcomeScreen: welcomeScreen(),
  })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)

  assert.equal(plan.status, "blocked")
  assert.equal(plan.frontier, null)
  assert.equal(plan.blocker?.kind, "community")
  if (plan.blocker?.kind !== "community") assert.fail("Expected Community blocker")
  assert.deepEqual(plan.blocker.requiredBy, ["welcome-screen", "onboarding"])
  assert.equal(plan.blocker.verificationReason, "community-phase-required")
  assert.deepEqual(state.calls, [
    "plan-structure",
    "plan-profile",
    "plan-settings",
    "get-community",
  ])
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.state]),
    [
      ["structure", "satisfied"],
      ["profile", "satisfied"],
      ["settings", "satisfied"],
      ["community", "blocked"],
      ["welcome-screen", "waiting"],
      ["onboarding", "waiting"],
    ],
  )
  assert.deepEqual(plan.manifestPreview.livePrerequisites, [{
    assessment: {
      deferred: false,
      executable: false,
      freshlyAssessed: true,
      nestedPlanDigest: null,
      state: "blocked",
      writeRequired: false,
    },
    id: "community",
    kind: "community",
  }])
  assert.equal(plan.manifestPreview.summary.prerequisites, 1)
  assert.equal(plan.manifestPreview.executableEntryId, null)

  const executionCalls: string[] = []
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    manifest,
    plan.digest,
    executors(executionCalls),
  )
  assert.equal(result.status, "blocked")
  assert.equal(result.nextAction, "inspect")
  assert.deepEqual(executionCalls, [])
})

test("guild blueprint resolves and plans Welcome Screen only after earlier phases", async () => {
  const state = fixture({ welcomeScreenWrite: true })
  const manifest = request({
    onboarding: onboarding(),
    welcomeScreen: welcomeScreen(),
  })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(plan.frontier?.kind, "welcome-screen")
  assert.deepEqual(state.calls, [
    "plan-structure",
    "plan-profile",
    "plan-settings",
    "get-community",
    "plan-welcome-screen",
  ])
  assert.equal(state.resolvedWelcomeScreen?.channels[0]?.channelId, CHANNEL_ID)
  assert.equal(
    state.resolvedWelcomeScreen?.operationKey,
    guildBlueprintStepOperationKey(OPERATION_KEY, "welcome-screen"),
  )
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.state]),
    [
      ["structure", "satisfied"],
      ["profile", "satisfied"],
      ["settings", "satisfied"],
      ["welcome-screen", "ready"],
      ["onboarding", "waiting"],
    ],
  )
  assert.equal(state.resolvedOnboarding, null)
})

test("guild blueprint rejects Welcome Screen references that resolve to one channel", async () => {
  const state = fixture()
  const desired = welcomeScreen()
  await assert.rejects(
    () => state.service.plan(APPLICATION_ID, BOT_ID, request({
      welcomeScreen: {
        ...desired,
        channels: [
          ...desired.channels,
          {
            channel: { channelId: CHANNEL_ID, kind: "exact" },
            description: "Another private channel description",
            emoji: { kind: "none" },
          },
        ],
      },
    })),
    /Welcome Screen channel IDs must be unique/u,
  )
})

test("guild blueprint resolves and plans onboarding only after earlier phases", async () => {
  const state = fixture({ onboardingWrite: true })
  const manifest = request({
    onboarding: onboarding(),
    welcomeScreen: welcomeScreen(),
  })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(plan.frontier?.kind, "onboarding")
  assert.deepEqual(state.calls, [
    "plan-structure",
    "plan-profile",
    "plan-settings",
    "get-community",
    "plan-welcome-screen",
    "plan-onboarding",
  ])
  assert.deepEqual(state.resolvedOnboarding?.defaultChannelIds, [CHANNEL_ID])
  assert.deepEqual(
    state.resolvedOnboarding?.prompts[0]?.options[0]?.channelIds,
    [CHANNEL_ID],
  )
  assert.deepEqual(
    state.resolvedOnboarding?.prompts[0]?.options[0]?.roleIds,
    [ROLE_ID],
  )
  assert.equal(
    state.resolvedOnboarding?.operationKey,
    guildBlueprintStepOperationKey(OPERATION_KEY, "onboarding"),
  )
  assert.deepEqual(
    plan.steps.map((step) => [step.kind, step.state]),
    [
      ["structure", "satisfied"],
      ["profile", "satisfied"],
      ["settings", "satisfied"],
      ["welcome-screen", "satisfied"],
      ["onboarding", "ready"],
    ],
  )
})

test("guild blueprint rejects onboarding references that resolve to one resource", async () => {
  const state = fixture()
  const desired = onboarding()
  await assert.rejects(
    () => state.service.plan(APPLICATION_ID, BOT_ID, request({
      onboarding: {
        ...desired,
        defaultChannels: [
          ...desired.defaultChannels,
          { channelId: CHANNEL_ID, kind: "exact" },
        ],
      },
    })),
    /default channel IDs must be unique/u,
  )
  await assert.rejects(
    () => state.service.plan(APPLICATION_ID, BOT_ID, request({
      onboarding: {
        ...desired,
        prompts: [{
          ...desired.prompts[0]!,
          options: [{
            ...desired.prompts[0]!.options[0]!,
            roles: [
              ...desired.prompts[0]!.options[0]!.roles,
              { kind: "exact", roleId: ROLE_ID },
            ],
          }],
        }],
      },
    })),
    /role IDs must be unique/u,
  )
})

test("guild blueprint rejects duplicate or mismatched scaffold evidence", async () => {
  const duplicate = fixture({
    scaffoldTransform(plan) {
      const first = plan.steps[0]
      const second = plan.steps[1]
      if (first && second) second.existingResourceId = first.existingResourceId
      return plan
    },
  })
  await assert.rejects(
    () => duplicate.service.plan(APPLICATION_ID, BOT_ID, request()),
    /did not return complete exact resource bindings/u,
  )

  const mismatched = fixture({
    scaffoldTransform(plan) {
      const first = plan.steps[0]
      if (first) first.index += 1
      return plan
    },
  })
  await assert.rejects(
    () => mismatched.service.plan(APPLICATION_ID, BOT_ID, request()),
    /did not return complete exact resource bindings/u,
  )

  const wrongBinding = fixture({
    scaffoldTransform(plan) {
      plan.operation.operationKeyHash = operationKeyHash("different-operation-key-0001")
      return plan
    },
  })
  await assert.rejects(
    () => wrongBinding.service.plan(APPLICATION_ID, BOT_ID, request()),
    /nested plan binding changed/u,
  )
})

test("guild blueprint plans unbound AutoMod creation without fuzzy adoption", async () => {
  const state = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(value)
    },
  })
  const { profile: _profile, settings: _settings, ...base } = request()
  const manifest: GuildBlueprintRequest = {
    ...base,
    autoModerationRules: autoModerationRules(),
  }

  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)

  assert.equal(plan.frontier?.kind, "auto-moderation")
  if (plan.frontier?.kind !== "auto-moderation") {
    throw new Error("Expected AutoMod blueprint frontier")
  }
  assert.equal(plan.frontier.stage, "configure")
  assert.equal(plan.frontier.plan.action, "create")
  assert.deepEqual(state.calls, [
    "plan-structure",
    "verify-automod",
    "list-automod",
    "plan-automod",
  ])
  const resolved = state.resolvedAutoModeration.at(-1)
  assert.equal(resolved?.action, "create")
  if (resolved?.action !== "create") throw new Error("Expected resolved create")
  assert.deepEqual(resolved.exemptChannelIds, [CHANNEL_ID])
  assert.deepEqual(resolved.exemptRoleIds, [ROLE_ID])
  assert.deepEqual(resolved.actions, [{
    customMessage: "Private AutoMod response",
    type: "block-message",
  }, {
    channelId: CHANNEL_ID,
    type: "send-alert-message",
  }])
  assert.equal(
    resolved.operationKey,
    guildBlueprintAutoModerationOperationKey(
      OPERATION_KEY,
      AUTOMOD_KEY,
      "configure",
    ),
  )
})

test("guild blueprint recovers new AutoMod identity only from a matching receipt", async () => {
  const state = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(
        value,
        projectedAutoModerationRule({ ruleId: CREATED_AUTOMOD_RULE_ID }),
      )
    },
    autoModerationVerification(value) {
      return value.action === "create"
        ? autoModerationVerification(value, "verified", CREATED_AUTOMOD_RULE_ID)
        : autoModerationVerification(value, "not-found")
    },
  })
  const { profile: _profile, settings: _settings, ...base } = request()
  const manifest: GuildBlueprintRequest = {
    ...base,
    autoModerationRules: autoModerationRules(),
  }

  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)

  assert.equal(plan.frontier?.kind, "auto-moderation")
  if (plan.frontier?.kind !== "auto-moderation") {
    throw new Error("Expected AutoMod blueprint frontier")
  }
  assert.equal(plan.frontier.stage, "enable")
  assert.equal(plan.frontier.plan.action, "set-enabled")
  assert.equal(plan.frontier.plan.existing?.ruleId, CREATED_AUTOMOD_RULE_ID)
  assert.equal(state.calls.includes("list-automod"), false)
  assert.equal(state.calls.includes("get-automod"), false)
  const step = plan.steps.find((entry) => entry.kind === "auto-moderation")
  assert.equal(step?.ruleId, CREATED_AUTOMOD_RULE_ID)
  assert.equal(step?.receiptStatus, null)
  assert.equal(step?.verificationStatus, "not-found")
  assert.equal(state.calls.filter((call) => call === "verify-automod").length, 2)
})

test("guild blueprint reconciles disabled state after recovering created AutoMod identity", async () => {
  const enabledRule = projectedAutoModerationRule({
    enabled: true,
    ruleId: CREATED_AUTOMOD_RULE_ID,
  })
  const state = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(value, enabledRule)
    },
    autoModerationVerification(value) {
      return value.action === "create"
        ? autoModerationVerification(value, "verified", CREATED_AUTOMOD_RULE_ID)
        : autoModerationVerification(value, "not-found")
    },
  })
  const { profile: _profile, settings: _settings, ...base } = request()
  const manifest: GuildBlueprintRequest = {
    ...base,
    autoModerationRules: autoModerationRules({ enabled: false }),
  }

  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)

  assert.equal(plan.frontier?.kind, "auto-moderation")
  if (plan.frontier?.kind !== "auto-moderation") {
    throw new Error("Expected AutoMod blueprint frontier")
  }
  assert.equal(plan.frontier.stage, "disable")
  assert.equal(plan.frontier.plan.action, "set-enabled")
  assert.equal(plan.frontier.plan.desired?.enabled, false)
})

test("guild blueprint stages exact AutoMod disable, configure, and enable frontiers", async () => {
  const { profile: _profile, settings: _settings, ...base } = request()
  const manifest: GuildBlueprintRequest = {
    ...base,
    autoModerationRules: autoModerationRules({ ruleId: AUTOMOD_RULE_ID }),
  }

  const enabledDrift = projectedAutoModerationRule({
    enabled: true,
    name: "Old private policy",
  })
  const disable = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(value, enabledDrift)
    },
    autoModerationRules: [enabledDrift],
  })
  const disablePlan = await disable.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(disablePlan.frontier?.kind, "auto-moderation")
  if (disablePlan.frontier?.kind !== "auto-moderation") {
    throw new Error("Expected disable frontier")
  }
  assert.equal(disablePlan.frontier.stage, "disable")
  assert.equal(disablePlan.frontier.plan.action, "set-enabled")
  assert.equal(disablePlan.frontier.plan.desired?.enabled, false)

  const disabledDrift = projectedAutoModerationRule({ name: "Old private policy" })
  const configure = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(value, disabledDrift)
    },
    autoModerationRules: [disabledDrift],
  })
  const configurePlan = await configure.service.plan(
    APPLICATION_ID,
    BOT_ID,
    manifest,
  )
  assert.equal(configurePlan.frontier?.kind, "auto-moderation")
  if (configurePlan.frontier?.kind !== "auto-moderation") {
    throw new Error("Expected configure frontier")
  }
  assert.equal(configurePlan.frontier.stage, "configure")
  assert.equal(configurePlan.frontier.plan.action, "update")

  const disabledCurrent = projectedAutoModerationRule()
  const enable = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(value, disabledCurrent)
    },
    autoModerationRules: [disabledCurrent],
  })
  const enablePlan = await enable.service.plan(APPLICATION_ID, BOT_ID, manifest)
  assert.equal(enablePlan.frontier?.kind, "auto-moderation")
  if (enablePlan.frontier?.kind !== "auto-moderation") {
    throw new Error("Expected enable frontier")
  }
  assert.equal(enablePlan.frontier.stage, "enable")
  assert.equal(enablePlan.frontier.plan.action, "set-enabled")

  const enabledCurrent = projectedAutoModerationRule({ enabled: true })
  const satisfied = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(value, enabledCurrent, "none")
    },
    autoModerationRules: [enabledCurrent],
  })
  const satisfiedPlan = await satisfied.service.plan(
    APPLICATION_ID,
    BOT_ID,
    manifest,
  )
  assert.equal(satisfiedPlan.status, "already-current")
  assert.equal(satisfiedPlan.frontier, null)
  assert.equal(
    satisfiedPlan.steps.find((step) => step.kind === "auto-moderation")?.state,
    "satisfied",
  )
})

test("guild blueprint blocks ambiguous, missing, immutable, and unsafe AutoMod recovery", async () => {
  const { profile: _profile, settings: _settings, ...base } = request()
  const unbound: GuildBlueprintRequest = {
    ...base,
    autoModerationRules: autoModerationRules(),
  }
  const collisionRule = projectedAutoModerationRule()
  const collision = fixture({ autoModerationRules: [collisionRule] })
  const collisionPlan = await collision.service.plan(APPLICATION_ID, BOT_ID, unbound)
  assert.equal(collisionPlan.status, "blocked")
  assert.equal(collisionPlan.blocker?.kind, "auto-moderation")
  assert.equal(collisionPlan.blocker?.verificationReason, "unbound-name-collision")
  if (collisionPlan.blocker?.kind !== "auto-moderation") {
    throw new Error("Expected AutoMod collision blocker")
  }
  assert.deepEqual(collisionPlan.blocker.ruleIds, [AUTOMOD_RULE_ID])
  assert.equal(collision.calls.includes("plan-automod"), false)

  const exact: GuildBlueprintRequest = {
    ...base,
    autoModerationRules: autoModerationRules({ ruleId: AUTOMOD_RULE_ID }),
  }
  const missing = fixture()
  const missingPlan = await missing.service.plan(APPLICATION_ID, BOT_ID, exact)
  assert.equal(missingPlan.blocker?.verificationReason, "exact-rule-missing")

  const incompatibleRule = projectedAutoModerationRule({
    actions: [{ customMessage: null, type: "block-message" }],
    trigger: { type: "spam" },
  })
  const incompatible = fixture({ autoModerationRules: [incompatibleRule] })
  const incompatiblePlan = await incompatible.service.plan(
    APPLICATION_ID,
    BOT_ID,
    exact,
  )
  assert.equal(incompatiblePlan.blocker?.verificationReason, "trigger-type-mismatch")

  const pending = fixture({
    autoModerationVerification(value) {
      return autoModerationVerification(value, "blocked")
    },
  })
  const pendingPlan = await pending.service.plan(APPLICATION_ID, BOT_ID, unbound)
  assert.equal(pendingPlan.blocker?.verificationReason, "operation-pending")
  assert.equal(pending.calls.includes("list-automod"), false)

  const enabledCurrent = projectedAutoModerationRule({ enabled: true })
  const stagePending = fixture({
    autoModerationRules: [enabledCurrent],
    autoModerationVerification(value) {
      return autoModerationVerification(value, "blocked")
    },
  })
  const stagePendingPlan = await stagePending.service.plan(
    APPLICATION_ID,
    BOT_ID,
    exact,
  )
  assert.equal(stagePendingPlan.blocker?.verificationReason, "operation-pending")
  assert.equal(stagePendingPlan.blocker?.kind, "auto-moderation")
  assert.equal(stagePending.calls.includes("plan-automod"), false)
})

test("guild blueprint executes one AutoMod frontier and verifies content-free identity", async () => {
  const state = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(value)
    },
  })
  const { profile: _profile, settings: _settings, ...base } = request()
  const manifest: GuildBlueprintRequest = {
    ...base,
    autoModerationRules: autoModerationRules(),
  }
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)
  state.calls.length = 0
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    manifest,
    plan.digest,
    executors(state.calls),
  )

  assert.equal(result.executedPhase, "auto-moderation")
  assert.equal(result.executedAutoModerationRuleIndex, 0)
  assert.equal(state.calls.filter((call) => call.startsWith("execute-")).length, 1)
  assert.match(state.calls.at(-1) as string, /^execute-automod:/u)

  const recovered = fixture({
    autoModerationPlan(value) {
      return autoModerationPlan(
        value,
        projectedAutoModerationRule({ ruleId: CREATED_AUTOMOD_RULE_ID }),
        "none",
      )
    },
    autoModerationVerification(value) {
      return autoModerationVerification(value, "verified", CREATED_AUTOMOD_RULE_ID)
    },
  })
  const disabledManifest = {
    ...manifest,
    autoModerationRules: autoModerationRules({ enabled: false }),
  }
  const verification = await recovered.service.verify(
    APPLICATION_ID,
    BOT_ID,
    disabledManifest,
  )
  assert.equal(verification.status, "verified")
  assert.deepEqual(verification.autoModerationRules, [{
    index: 0,
    ruleId: CREATED_AUTOMOD_RULE_ID,
  }])
  assert.equal(recovered.calls.includes("plan-automod"), false)
  assert.equal(
    recovered.calls.filter((call) => call === "verify-automod").length,
    2,
  )
  const serialized = JSON.stringify(verification)
  assert.equal(serialized.includes(AUTOMOD_KEY), false)
  assert.equal(serialized.includes("Private AutoMod policy"), false)
  assert.equal(serialized.includes("private blocked phrase"), false)
})

test("guild blueprint verification is live and content-free", async () => {
  const state = fixture()
  const result = await state.service.verify(
    APPLICATION_ID,
    BOT_ID,
    request({ onboarding: onboarding(), welcomeScreen: welcomeScreen() }),
  )
  assert.equal(result.status, "verified")
  assert.equal(result.resources.length, 3)
  const serialized = JSON.stringify(result)
  for (const privateValue of [
    AUDIT_REASON,
    OPERATION_KEY,
    "Private Guild Name",
    "Private profile description",
    "Private Category",
    "private-system-channel",
    "Private channel topic",
    "private-role",
    WELCOME_DESCRIPTION,
    WELCOME_CHANNEL_DESCRIPTION,
    "\u{1F44B}",
    ONBOARDING_PROMPT_TITLE,
    ONBOARDING_OPTION_TITLE,
    ONBOARDING_OPTION_DESCRIPTION,
    "\u{1F3AE}",
  ]) assert.equal(serialized.includes(privateValue), false)
})

test("guild blueprint execution dispatches exactly one fresh frontier", async () => {
  const state = fixture({ settingsWrite: true })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, request())
  state.calls.length = 0
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
    executors(state.calls),
  )
  assert.equal(result.status, "frontier-executed")
  assert.equal(result.executedPhase, "settings")
  assert.equal(result.nextAction, "replan")
  assert.deepEqual(state.calls.slice(0, 3), [
    "plan-structure",
    "plan-profile",
    "plan-settings",
  ])
  assert.equal(state.calls.filter((call) => call.startsWith("execute-")).length, 1)
  assert.match(state.calls.at(-1) as string, /^execute-settings:/u)
})

test("guild blueprint execution dispatches one hierarchy convergence frontier", async () => {
  const roleManifest = request({
    roleOrder: [
      { kind: "exact", roleId: SECOND_ROLE_ID },
      { key: "private-role", kind: "scaffold" },
    ],
  })
  delete roleManifest.profile
  delete roleManifest.settings
  const roleState = fixture({ roleOrderingWrite: true })
  const rolePlan = await roleState.service.plan(
    APPLICATION_ID,
    BOT_ID,
    roleManifest,
  )
  roleState.calls.length = 0
  const roleResult = await roleState.service.execute(
    APPLICATION_ID,
    BOT_ID,
    roleManifest,
    rolePlan.digest,
    executors(roleState.calls),
  )
  assert.equal(roleResult.executedPhase, "role-ordering")
  assert.equal(roleResult.executedRoleOrderingIndex, 0)
  assert.equal(roleResult.executedChannelPermissionOverwriteIndex, null)
  assert.equal(
    roleState.calls.filter((call) => call.startsWith("execute-")).length,
    1,
  )
  assert.match(roleState.calls.at(-1) as string, /^execute-role-ordering:/u)

  const overwriteManifest = request({
    channelPermissionOverwrites: [{
      channelId: CHANNEL_ID,
      mode: "delete",
      target: { kind: "member", userId: NOTIFICATION_USER_ID },
    }],
  })
  delete overwriteManifest.profile
  delete overwriteManifest.settings
  const overwriteState = fixture({ channelPermissionOverwriteWrite: true })
  const overwritePlan = await overwriteState.service.plan(
    APPLICATION_ID,
    BOT_ID,
    overwriteManifest,
  )
  overwriteState.calls.length = 0
  const overwriteResult = await overwriteState.service.execute(
    APPLICATION_ID,
    BOT_ID,
    overwriteManifest,
    overwritePlan.digest,
    executors(overwriteState.calls),
  )
  assert.equal(overwriteResult.executedPhase, "channel-permission-overwrite")
  assert.equal(overwriteResult.executedChannelPermissionOverwriteIndex, 0)
  assert.equal(overwriteResult.executedRoleOrderingIndex, null)
  assert.equal(
    overwriteState.calls.filter((call) => call.startsWith("execute-")).length,
    1,
  )
  assert.match(
    overwriteState.calls.at(-1) as string,
    /^execute-channel-permission-overwrite:/u,
  )
})

test("guild blueprint execution dispatches one Welcome Screen frontier", async () => {
  const state = fixture({ welcomeScreenWrite: true })
  const manifest = request({ welcomeScreen: welcomeScreen() })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)
  state.calls.length = 0
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    manifest,
    plan.digest,
    executors(state.calls),
  )
  assert.equal(result.executedPhase, "welcome-screen")
  assert.equal(state.calls.filter((call) => call.startsWith("execute-")).length, 1)
  assert.match(state.calls.at(-1) as string, /^execute-welcome-screen:/u)
})

test("guild blueprint execution dispatches one onboarding frontier", async () => {
  const state = fixture({ onboardingWrite: true })
  const manifest = request({ onboarding: onboarding() })
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, manifest)
  state.calls.length = 0
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    manifest,
    plan.digest,
    executors(state.calls),
  )
  assert.equal(result.executedPhase, "onboarding")
  assert.equal(state.calls.filter((call) => call.startsWith("execute-")).length, 1)
  assert.match(state.calls.at(-1) as string, /^execute-onboarding:/u)
})

test("guild blueprint execution rejects a changed aggregate plan", async () => {
  const planned = fixture({ scaffoldStatus: "planned" })
  const plan = await planned.service.plan(APPLICATION_ID, BOT_ID, request())
  const changed = fixture({ profileWrite: true })
  const executeCalls: string[] = []
  await assert.rejects(
    () => changed.service.execute(
      APPLICATION_ID,
      BOT_ID,
      request(),
      plan.digest,
      executors(executeCalls),
    ),
    GuildBlueprintPlanChangedError,
  )
  assert.deepEqual(executeCalls, [])
})

test("guild blueprint no-write execution has no confirmation-worthy dispatch", async () => {
  const state = fixture()
  const plan = await state.service.plan(APPLICATION_ID, BOT_ID, request())
  state.calls.length = 0
  const executeCalls: string[] = []
  const result = await state.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    plan.digest,
    executors(executeCalls),
  )
  assert.equal(result.status, "already-current")
  assert.equal(result.nextAction, "done")
  assert.deepEqual(executeCalls, [])
})
