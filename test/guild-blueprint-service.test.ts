import assert from "node:assert/strict"
import test from "node:test"

import { GuildBlueprintPlanChangedError } from "../src/errors.js"
import type {
  ComponentMessagePlan,
  ComponentMessageRequest,
  ComponentMessageResult,
  ComponentMessageVerificationResult,
} from "../src/component-message-service.js"
import { CONNECTOR_LIMITS } from "../src/constants.js"
import {
  GuildBlueprintService,
  guildBlueprintPublicationOperationKey,
  guildBlueprintRequestDigest,
  guildBlueprintStepOperationKey,
  normalizeGuildBlueprintRequest,
  type GuildBlueprintDomainServices,
  type GuildBlueprintExecutors,
  type GuildBlueprintRequest,
} from "../src/guild-blueprint-service.js"
import type {
  GuildProfileChangePlan,
  GuildProfileChangeRequest,
  GuildProfileChangeResult,
} from "../src/guild-profile-service.js"
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
const CATEGORY_ID = "600000000000000001"
const CHANNEL_ID = "700000000000000001"
const PUBLICATION_CHANNEL_ID = "700000000000000002"
const PUBLICATION_MESSAGE_ID = "700000000000000003"
const NOTIFICATION_USER_ID = "700000000000000004"
const ONBOARDING_PROMPT_ID = "800000000000000001"
const ONBOARDING_OPTION_ID = "900000000000000001"
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
  onboardingWrite?: boolean
  profileWrite?: boolean
  scaffoldTransform?: (plan: GuildScaffoldPlan) => GuildScaffoldPlan
  scaffoldStatus?: GuildScaffoldPlan["status"]
  settingsWrite?: boolean
  welcomeScreenWrite?: boolean
}

function fixture(options: FixtureOptions = {}) {
  const calls: string[] = []
  let resolvedOnboarding: OnboardingChangeRequest | null = null
  const resolvedPublications: ComponentMessageRequest[] = []
  let resolvedSettings: GuildSettingsChangeRequest | null = null
  let resolvedWelcomeScreen: WelcomeScreenChangeRequest | null = null
  const domains: GuildBlueprintDomainServices = {
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
    onboarding: {
      async plan(_applicationId, _botId, value) {
        calls.push("plan-onboarding")
        resolvedOnboarding = value
        return onboardingPlan(value, options.onboardingWrite ?? false)
      },
    },
    profile: {
      async plan(_applicationId, _botId, value) {
        calls.push("plan-profile")
        return profilePlan(value, options.profileWrite ?? false)
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
      async plan(_applicationId, _botId, value) {
        calls.push("plan-settings")
        resolvedSettings = value
        return settingsPlan(value, options.settingsWrite ?? false)
      },
    },
    welcomeScreen: {
      async plan(_applicationId, _botId, value) {
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
    get resolvedPublications() {
      return resolvedPublications
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
  assert.equal(structureKey, guildBlueprintStepOperationKey(OPERATION_KEY, "structure"))
  assert.notEqual(structureKey, profileKey)
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
    /requires a profile, settings, Welcome Screen, onboarding, or publication phase/u,
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
  assert.equal(plan.blocker?.index, 0)
  assert.equal(plan.blocker?.verificationStatus, "blocked")
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
