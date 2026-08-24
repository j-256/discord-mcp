import { createHmac } from "node:crypto"

import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
  WELCOME_SCREEN_LIMITS,
} from "./constants.js"
import { GuildBlueprintPlanChangedError } from "./errors.js"
import {
  type GuildProfileChangePlan,
  type GuildProfileChangeRequest,
  type GuildProfileChangeResult,
  normalizeGuildProfileChangeRequest,
} from "./guild-profile-service.js"
import {
  type GuildScaffoldPlan,
  type GuildScaffoldRequest,
  type GuildScaffoldResult,
  normalizeGuildScaffoldRequest,
} from "./guild-scaffold-service.js"
import {
  type GuildSettingsChangePlan,
  type GuildSettingsChangeRequest,
  type GuildSettingsChangeResult,
  normalizeGuildSettingsChangeRequest,
} from "./guild-settings-service.js"
import { stableString } from "./normalize.js"
import { operationKeyHash } from "./operation-store.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type { RequestOptions } from "./types.js"
import {
  type WelcomeScreenChangePlan,
  type WelcomeScreenChangeRequest,
  type WelcomeScreenChangeResult,
  normalizeWelcomeScreenChangeRequest,
} from "./welcome-screen-service.js"

const BLUEPRINT_REQUEST_DIGEST_PREFIX = "hmac-sha256:"
const BLUEPRINT_TOP_LEVEL_KEYS = Object.freeze([
  "auditReason",
  "guildId",
  "operationKey",
  "profile",
  "scaffold",
  "settings",
  "welcomeScreen",
] as const)
const BLUEPRINT_SCAFFOLD_KEYS = Object.freeze([
  "channels",
  "roles",
  "stepLimit",
] as const)
const BLUEPRINT_SCAFFOLD_CHANNEL_KEYS = Object.freeze([
  "defaultAutoArchiveDuration",
  "key",
  "kind",
  "name",
  "nsfw",
  "parentKey",
  "rateLimitPerUser",
  "topic",
] as const)
const BLUEPRINT_SCAFFOLD_ROLE_KEYS = Object.freeze([
  "hoist",
  "key",
  "mentionable",
  "name",
  "permissions",
  "primaryColor",
] as const)
const BLUEPRINT_SETTINGS_KEYS = Object.freeze([
  "afkChannel",
  "afkTimeoutSeconds",
  "defaultMessageNotifications",
  "explicitContentFilter",
  "premiumProgressBarEnabled",
  "suppressedSystemNotifications",
  "systemChannel",
  "verificationLevel",
] as const)
const BLUEPRINT_WELCOME_SCREEN_KEYS = Object.freeze([
  "channels",
  "description",
  "enabled",
] as const)
const BLUEPRINT_WELCOME_SCREEN_CHANNEL_KEYS = Object.freeze([
  "channel",
  "description",
  "emoji",
] as const)

export const GUILD_BLUEPRINT_PHASES = Object.freeze([
  "structure",
  "profile",
  "settings",
  "welcome-screen",
] as const)

export type GuildBlueprintPhase = typeof GUILD_BLUEPRINT_PHASES[number]
export type GuildBlueprintPhaseState = "ready" | "satisfied" | "waiting"

export interface GuildBlueprintExactChannelReference {
  channelId: string
  kind: "exact"
}

export interface GuildBlueprintScaffoldChannelReference {
  key: string
  kind: "scaffold"
}

export type GuildBlueprintChannelReference =
  | GuildBlueprintExactChannelReference
  | GuildBlueprintScaffoldChannelReference

export type GuildBlueprintScaffoldInput = Omit<
  GuildScaffoldRequest,
  "auditReason" | "guildId" | "operationKey"
>

export type GuildBlueprintProfileInput = Omit<
  GuildProfileChangeRequest,
  "auditReason" | "guildId" | "operationKey"
>

export type GuildBlueprintSettingsInput = Omit<
  GuildSettingsChangeRequest,
  | "afkChannelId"
  | "auditReason"
  | "guildId"
  | "operationKey"
  | "systemChannelId"
> & {
  afkChannel?: GuildBlueprintExactChannelReference | null
  systemChannel?: GuildBlueprintChannelReference | null
}

export interface GuildBlueprintWelcomeScreenChannelInput extends Omit<
  WelcomeScreenChangeRequest["channels"][number],
  "channelId"
> {
  channel: GuildBlueprintChannelReference
}

export type GuildBlueprintWelcomeScreenInput = Omit<
  WelcomeScreenChangeRequest,
  "auditReason" | "channels" | "guildId" | "operationKey"
> & {
  channels: readonly GuildBlueprintWelcomeScreenChannelInput[]
}

export interface GuildBlueprintRequest {
  auditReason: string
  guildId: string
  operationKey: string
  profile?: GuildBlueprintProfileInput
  scaffold: GuildBlueprintScaffoldInput
  settings?: GuildBlueprintSettingsInput
  welcomeScreen?: GuildBlueprintWelcomeScreenInput
}

interface NormalizedGuildBlueprintSettingsInput extends Omit<
  GuildBlueprintSettingsInput,
  "suppressedSystemNotifications"
> {
  suppressedSystemNotifications?: NonNullable<
    GuildSettingsChangeRequest["suppressedSystemNotifications"]
  >
}

export interface NormalizedGuildBlueprintRequest {
  auditReason: string
  guildId: string
  operationKey: string
  operationKeyHash: string
  profile?: GuildBlueprintProfileInput
  scaffold: GuildBlueprintScaffoldInput & { stepLimit: number }
  settings?: NormalizedGuildBlueprintSettingsInput
  welcomeScreen?: GuildBlueprintWelcomeScreenInput
}

export interface GuildBlueprintBinding {
  index: number
  key: string
  kind: "category" | "forum" | "role" | "text"
  resourceId: string
}

const AFK_CHANNEL_SCAFFOLD_KINDS = new Set<GuildBlueprintBinding["kind"]>()
const SYSTEM_CHANNEL_SCAFFOLD_KINDS = new Set<GuildBlueprintBinding["kind"]>([
  "text",
])
const WELCOME_SCREEN_SCAFFOLD_KINDS = new Set<GuildBlueprintBinding["kind"]>([
  "forum",
  "text",
])

export interface GuildBlueprintPlanStep {
  kind: GuildBlueprintPhase
  nestedPlanDigest: string | null
  operationKeyHash: string
  state: GuildBlueprintPhaseState
  writeRequired: boolean
}

export type GuildBlueprintFrontier =
  | {
      kind: "profile"
      plan: GuildProfileChangePlan
      writeRequired: true
    }
  | {
      kind: "settings"
      plan: GuildSettingsChangePlan
      writeRequired: true
    }
  | {
      kind: "structure"
      plan: GuildScaffoldPlan
      writeRequired: boolean
    }
  | {
      kind: "welcome-screen"
      plan: WelcomeScreenChangePlan
      writeRequired: true
    }

export interface GuildBlueprintPlan {
  applicationId: string
  bindings: GuildBlueprintBinding[]
  botId: string
  createdAt: string
  digest: string
  frontier: GuildBlueprintFrontier | null
  guild: {
    id: string
    name: string
    ownerId: string
  }
  operationKeyHash: string
  privacy: {
    activityAndReceipts: "content-free-domain-records"
    manifestPersistence: "none"
    planPersistence: "none"
    requestState: "digests-only"
  }
  requestDigest: string
  schemaVersion: number
  status: "already-current" | "planned"
  steps: GuildBlueprintPlanStep[]
  warnings: string[]
}

export type GuildBlueprintNestedResult =
  | GuildProfileChangeResult
  | GuildScaffoldResult
  | GuildSettingsChangeResult
  | WelcomeScreenChangeResult

export interface GuildBlueprintResult {
  digest: string
  executedPhase: GuildBlueprintPhase | null
  guildId: string
  nestedResult: GuildBlueprintNestedResult | null
  nextAction: "done" | "replan"
  operationKeyHash: string
  requestDigest: string
  schemaVersion: number
  status: "already-current" | "frontier-executed"
}

export interface GuildBlueprintVerification {
  applicationId: string
  botId: string
  checkedAt: string
  digest: string
  evidence: {
    activityAndReceipts: "content-free-domain-records"
    callerRetainedManifestRequired: true
    historicalMutationProvenance: "domain-activity-only"
    manifestPersisted: false
    source: "live-domain-plans"
  }
  guildId: string
  operationKeyHash: string
  requestDigest: string
  resources: Array<{
    index: number
    kind: GuildBlueprintBinding["kind"]
    resourceId: string
  }>
  schemaVersion: number
  status: "incomplete" | "verified"
  steps: GuildBlueprintPlanStep[]
}

export interface GuildBlueprintDomainServices {
  profile: {
    plan(
      applicationId: string,
      botId: string,
      request: GuildProfileChangeRequest,
      options?: RequestOptions,
    ): Promise<GuildProfileChangePlan>
  }
  scaffold: {
    plan(
      applicationId: string,
      botId: string,
      request: GuildScaffoldRequest,
      options?: RequestOptions,
    ): Promise<GuildScaffoldPlan>
  }
  settings: {
    plan(
      applicationId: string,
      botId: string,
      request: GuildSettingsChangeRequest,
      options?: RequestOptions,
    ): Promise<GuildSettingsChangePlan>
  }
  welcomeScreen: {
    plan(
      applicationId: string,
      botId: string,
      request: WelcomeScreenChangeRequest,
      options?: RequestOptions,
    ): Promise<WelcomeScreenChangePlan>
  }
}

export interface GuildBlueprintExecutors {
  executeProfile(
    request: GuildProfileChangeRequest,
    planDigest: string,
    options?: RequestOptions,
  ): Promise<GuildProfileChangeResult>
  executeScaffold(
    request: GuildScaffoldRequest,
    planDigest: string,
    options?: RequestOptions,
  ): Promise<GuildScaffoldResult>
  executeSettings(
    request: GuildSettingsChangeRequest,
    planDigest: string,
    options?: RequestOptions,
  ): Promise<GuildSettingsChangeResult>
  executeWelcomeScreen(
    request: WelcomeScreenChangeRequest,
    planDigest: string,
    options?: RequestOptions,
  ): Promise<WelcomeScreenChangeResult>
}

export interface GuildBlueprintServiceOptions {
  clock?: () => Date
  domains: GuildBlueprintDomainServices
  planKey?: Uint8Array
}

type GuildBlueprintFrontierRequest =
  | {
      kind: "profile"
      request: GuildProfileChangeRequest
    }
  | {
      kind: "settings"
      request: GuildSettingsChangeRequest
    }
  | {
      kind: "structure"
      request: GuildScaffoldRequest
    }
  | {
      kind: "welcome-screen"
      request: WelcomeScreenChangeRequest
    }

interface BuiltGuildBlueprintPlan {
  frontierRequest: GuildBlueprintFrontierRequest | null
  plan: GuildBlueprintPlan
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
  message: string,
): asserts value is Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) throw new RangeError(message)
}

function own(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key)
}

function positiveSnowflake(value: unknown, description: string): string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) throw new RangeError(`${description} must be a positive Discord snowflake`)
  return value
}

function derivedOperationKey(operationKey: string, phase: GuildBlueprintPhase): string {
  return `blueprint:${createHmac("sha256", operationKey)
    .update("discord-mcp-guild-blueprint-step.v1\0")
    .update(phase)
    .digest("hex")}`
}

export function guildBlueprintStepOperationKey(
  operationKey: string,
  phase: GuildBlueprintPhase,
): string {
  operationKeyHash(operationKey)
  if (!GUILD_BLUEPRINT_PHASES.includes(phase)) {
    throw new RangeError("Discord guild blueprint phase is invalid")
  }
  return derivedOperationKey(operationKey, phase)
}

function normalizeChannelReference(
  value: unknown,
  channelKinds: ReadonlyMap<string, GuildBlueprintBinding["kind"]>,
  scaffoldKinds: ReadonlySet<GuildBlueprintBinding["kind"]>,
  description: string,
): GuildBlueprintChannelReference | null {
  if (value === null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError(`${description} must be null or one exact reference`)
  }
  const record = value as Record<string, unknown>
  if (record.kind === "exact") {
    exactObject(record, ["channelId", "kind"], `${description} exact reference is invalid`)
    return {
      channelId: positiveSnowflake(record.channelId, description),
      kind: "exact",
    }
  }
  if (record.kind === "scaffold") {
    exactObject(record, ["key", "kind"], `${description} scaffold reference is invalid`)
    const key = record.key
    if (typeof key !== "string") {
      throw new RangeError(`${description} scaffold key does not reference a requested channel`)
    }
    const requestedKind = channelKinds.get(key)
    if (requestedKind === undefined) {
      throw new RangeError(`${description} scaffold key does not reference a requested channel`)
    }
    if (!scaffoldKinds.has(requestedKind)) {
      throw new RangeError(`${description} scaffold key is not a compatible requested channel`)
    }
    return { key, kind: "scaffold" }
  }
  throw new RangeError(`${description} kind is invalid`)
}

function canonicalScaffoldRequest(
  request: GuildBlueprintRequest,
  operationKey: string,
): GuildScaffoldRequest {
  exactObject(
    request.scaffold,
    BLUEPRINT_SCAFFOLD_KEYS,
    "Discord guild blueprint scaffold must be an exact object",
  )
  if (Array.isArray(request.scaffold.channels)) {
    for (const channel of request.scaffold.channels) {
      exactObject(
        channel,
        BLUEPRINT_SCAFFOLD_CHANNEL_KEYS,
        "Discord guild blueprint scaffold channel must be an exact object",
      )
    }
  }
  if (Array.isArray(request.scaffold.roles)) {
    for (const role of request.scaffold.roles) {
      exactObject(
        role,
        BLUEPRINT_SCAFFOLD_ROLE_KEYS,
        "Discord guild blueprint scaffold role must be an exact object",
      )
    }
  }
  const normalized = normalizeGuildScaffoldRequest({
    auditReason: request.auditReason,
    channels: request.scaffold.channels,
    guildId: request.guildId,
    operationKey,
    roles: request.scaffold.roles,
    ...(request.scaffold.stepLimit === undefined
      ? {}
      : { stepLimit: request.scaffold.stepLimit }),
  })
  return {
    auditReason: normalized.auditReason,
    channels: normalized.channels.map((channel) => ({
      ...(channel.request.defaultAutoArchiveDuration === undefined
        ? {}
        : { defaultAutoArchiveDuration: channel.request.defaultAutoArchiveDuration }),
      key: channel.key,
      kind: channel.kind,
      name: channel.request.name,
      ...(channel.request.nsfw === undefined ? {} : { nsfw: channel.request.nsfw }),
      ...(channel.parentKey === null ? {} : { parentKey: channel.parentKey }),
      ...(channel.request.rateLimitPerUser === undefined
        ? {}
        : { rateLimitPerUser: channel.request.rateLimitPerUser }),
      ...(channel.request.topic === undefined ? {} : { topic: channel.request.topic }),
    })),
    guildId: normalized.guildId,
    operationKey,
    roles: normalized.roles.map((role) => ({
      ...(role.request.hoist === undefined ? {} : { hoist: role.request.hoist }),
      key: role.key,
      ...(role.request.mentionable === undefined
        ? {}
        : { mentionable: role.request.mentionable }),
      name: role.request.name,
      ...(role.request.permissions === undefined
        ? {}
        : { permissions: role.request.permissions }),
      ...(role.request.primaryColor === undefined
        ? {}
        : { primaryColor: role.request.primaryColor }),
    })),
    stepLimit: normalized.stepLimit,
  }
}

function canonicalProfileRequest(
  request: GuildBlueprintRequest,
  operationKey: string,
): GuildProfileChangeRequest | undefined {
  if (request.profile === undefined) return undefined
  const normalized = normalizeGuildProfileChangeRequest({
    ...request.profile,
    auditReason: request.auditReason,
    guildId: request.guildId,
    operationKey,
  })
  return {
    auditReason: normalized.auditReason,
    ...(own(normalized, "description") ? { description: normalized.description } : {}),
    guildId: normalized.guildId,
    ...(own(normalized, "name") ? { name: normalized.name } : {}),
    operationKey,
  }
}

function canonicalSettingsInput(
  request: GuildBlueprintRequest,
  operationKey: string,
  channelKinds: ReadonlyMap<string, GuildBlueprintBinding["kind"]>,
): NormalizedGuildBlueprintSettingsInput | undefined {
  if (request.settings === undefined) return undefined
  exactObject(
    request.settings,
    BLUEPRINT_SETTINGS_KEYS,
    "Discord guild blueprint settings must be an exact object",
  )
  const afkChannel = own(request.settings, "afkChannel")
    ? normalizeChannelReference(
        request.settings.afkChannel,
        channelKinds,
        AFK_CHANNEL_SCAFFOLD_KINDS,
        "Discord guild blueprint AFK channel",
      )
    : undefined
  const systemChannel = own(request.settings, "systemChannel")
    ? normalizeChannelReference(
        request.settings.systemChannel,
        channelKinds,
        SYSTEM_CHANNEL_SCAFFOLD_KINDS,
        "Discord guild blueprint system channel",
      )
    : undefined
  const normalized = normalizeGuildSettingsChangeRequest({
    ...(own(request.settings, "afkChannel")
      ? {
          afkChannelId: afkChannel === null
            ? null
            : afkChannel?.kind === "exact"
              ? afkChannel.channelId
              : request.guildId,
        }
      : {}),
    ...(own(request.settings, "afkTimeoutSeconds")
      ? { afkTimeoutSeconds: request.settings.afkTimeoutSeconds }
      : {}),
    auditReason: request.auditReason,
    ...(own(request.settings, "defaultMessageNotifications")
      ? { defaultMessageNotifications: request.settings.defaultMessageNotifications }
      : {}),
    ...(own(request.settings, "explicitContentFilter")
      ? { explicitContentFilter: request.settings.explicitContentFilter }
      : {}),
    guildId: request.guildId,
    operationKey,
    ...(own(request.settings, "premiumProgressBarEnabled")
      ? { premiumProgressBarEnabled: request.settings.premiumProgressBarEnabled }
      : {}),
    ...(own(request.settings, "suppressedSystemNotifications")
      ? { suppressedSystemNotifications: request.settings.suppressedSystemNotifications }
      : {}),
    ...(own(request.settings, "systemChannel")
      ? {
          systemChannelId: systemChannel === null
            ? null
            : systemChannel?.kind === "exact"
              ? systemChannel.channelId
              : request.guildId,
        }
      : {}),
    ...(own(request.settings, "verificationLevel")
      ? { verificationLevel: request.settings.verificationLevel }
      : {}),
  })
  return {
    ...(own(request.settings, "afkChannel")
      ? { afkChannel: afkChannel as GuildBlueprintExactChannelReference | null }
      : {}),
    ...(own(normalized, "afkTimeoutSeconds")
      ? { afkTimeoutSeconds: normalized.afkTimeoutSeconds }
      : {}),
    ...(own(normalized, "defaultMessageNotifications")
      ? { defaultMessageNotifications: normalized.defaultMessageNotifications }
      : {}),
    ...(own(normalized, "explicitContentFilter")
      ? { explicitContentFilter: normalized.explicitContentFilter }
      : {}),
    ...(own(normalized, "premiumProgressBarEnabled")
      ? { premiumProgressBarEnabled: normalized.premiumProgressBarEnabled }
      : {}),
    ...(own(normalized, "suppressedSystemNotifications")
      ? { suppressedSystemNotifications: normalized.suppressedSystemNotifications }
      : {}),
    ...(own(request.settings, "systemChannel")
      ? { systemChannel: systemChannel as GuildBlueprintChannelReference | null }
      : {}),
    ...(own(normalized, "verificationLevel")
      ? { verificationLevel: normalized.verificationLevel }
      : {}),
  }
}

function canonicalWelcomeScreenInput(
  request: GuildBlueprintRequest,
  operationKey: string,
  channelKinds: ReadonlyMap<string, GuildBlueprintBinding["kind"]>,
): GuildBlueprintWelcomeScreenInput | undefined {
  if (request.welcomeScreen === undefined) return undefined
  exactObject(
    request.welcomeScreen,
    BLUEPRINT_WELCOME_SCREEN_KEYS,
    "Discord guild blueprint Welcome Screen must be an exact object",
  )
  if (
    !Array.isArray(request.welcomeScreen.channels)
    || request.welcomeScreen.channels.length > WELCOME_SCREEN_LIMITS.channels
  ) {
    throw new RangeError("Discord guild blueprint Welcome Screen channels are invalid")
  }
  const referenceKeys = new Set<string>()
  const references = request.welcomeScreen.channels.map((entry) => {
    exactObject(
      entry,
      BLUEPRINT_WELCOME_SCREEN_CHANNEL_KEYS,
      "Discord guild blueprint Welcome Screen channel must be an exact object",
    )
    const reference = normalizeChannelReference(
      entry.channel,
      channelKinds,
      WELCOME_SCREEN_SCAFFOLD_KINDS,
      "Discord guild blueprint Welcome Screen channel",
    )
    if (reference === null) {
      throw new RangeError(
        "Discord guild blueprint Welcome Screen channel requires one exact reference",
      )
    }
    const referenceKey = reference.kind === "exact"
      ? `exact:${reference.channelId}`
      : `scaffold:${reference.key}`
    if (referenceKeys.has(referenceKey)) {
      throw new RangeError(
        "Discord guild blueprint Welcome Screen channel references must be unique",
      )
    }
    referenceKeys.add(referenceKey)
    return reference
  })
  const usedChannelIds = new Set(
    references.flatMap((reference) => (
      reference.kind === "exact" ? [reference.channelId] : []
    )),
  )
  let temporaryId = DISCORD_SNOWFLAKE_MAX
  function nextTemporaryId(): string {
    while (usedChannelIds.has(temporaryId.toString())) temporaryId -= 1n
    const result = temporaryId.toString()
    usedChannelIds.add(result)
    temporaryId -= 1n
    return result
  }
  const normalized = normalizeWelcomeScreenChangeRequest({
    auditReason: request.auditReason,
    channels: request.welcomeScreen.channels.map((entry, index) => {
      const reference = references[index]
      if (reference === undefined) {
        throw new RangeError("Discord guild blueprint Welcome Screen channel is missing")
      }
      return {
        channelId: reference.kind === "exact"
          ? reference.channelId
          : nextTemporaryId(),
        description: entry.description,
        emoji: entry.emoji,
      }
    }),
    description: request.welcomeScreen.description,
    enabled: request.welcomeScreen.enabled,
    guildId: request.guildId,
    operationKey,
  })
  return {
    channels: normalized.channels.map((entry, index) => {
      const reference = references[index]
      if (reference === undefined) {
        throw new RangeError("Discord guild blueprint Welcome Screen channel is missing")
      }
      return {
        channel: reference,
        description: entry.description,
        emoji: entry.emoji,
      }
    }),
    description: normalized.description,
    enabled: normalized.enabled,
  }
}

export function normalizeGuildBlueprintRequest(
  request: GuildBlueprintRequest,
): NormalizedGuildBlueprintRequest {
  exactObject(
    request,
    BLUEPRINT_TOP_LEVEL_KEYS,
    "Discord guild blueprint request must be an exact object",
  )
  if (
    typeof request.auditReason !== "string"
    || typeof request.guildId !== "string"
    || typeof request.operationKey !== "string"
  ) throw new RangeError("Discord guild blueprint request is invalid")
  positiveSnowflake(request.guildId, "Discord guild blueprint guild ID")
  if (
    request.profile === undefined
    && request.settings === undefined
    && request.welcomeScreen === undefined
  ) {
    throw new RangeError(
      "Discord guild blueprint requires a profile, settings, or Welcome Screen phase after the scaffold",
    )
  }
  const operationKeyHashValue = operationKeyHash(request.operationKey)
  const structureOperationKey = derivedOperationKey(request.operationKey, "structure")
  const scaffold = canonicalScaffoldRequest(request, structureOperationKey)
  const channelKinds = new Map(
    scaffold.channels.map((channel) => [channel.key, channel.kind] as const),
  )
  const profile = canonicalProfileRequest(
    request,
    derivedOperationKey(request.operationKey, "profile"),
  )
  const settings = canonicalSettingsInput(
    request,
    derivedOperationKey(request.operationKey, "settings"),
    channelKinds,
  )
  const welcomeScreen = canonicalWelcomeScreenInput(
    request,
    derivedOperationKey(request.operationKey, "welcome-screen"),
    channelKinds,
  )
  return {
    auditReason: scaffold.auditReason,
    guildId: scaffold.guildId,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHashValue,
    ...(profile === undefined
      ? {}
      : {
          profile: {
            ...(own(profile, "description") ? { description: profile.description } : {}),
            ...(own(profile, "name") ? { name: profile.name } : {}),
          },
        }),
    scaffold: {
      channels: scaffold.channels,
      roles: scaffold.roles,
      stepLimit: scaffold.stepLimit as number,
    },
    ...(settings === undefined ? {} : { settings }),
    ...(welcomeScreen === undefined ? {} : { welcomeScreen }),
  }
}

function requestSnapshot(request: NormalizedGuildBlueprintRequest): unknown {
  return {
    auditReason: request.auditReason,
    guildId: request.guildId,
    operationKeyHash: request.operationKeyHash,
    ...(request.profile === undefined ? {} : { profile: request.profile }),
    scaffold: request.scaffold,
    ...(request.settings === undefined ? {} : { settings: request.settings }),
    ...(request.welcomeScreen === undefined
      ? {}
      : { welcomeScreen: request.welcomeScreen }),
  }
}

function normalizedRequestDigest(request: NormalizedGuildBlueprintRequest): string {
  const digest = createHmac("sha256", request.operationKey)
    .update("discord-mcp-guild-blueprint-request.v2\0")
    .update(stableString(requestSnapshot(request)))
    .digest("hex")
  return `${BLUEPRINT_REQUEST_DIGEST_PREFIX}${digest}`
}

export function guildBlueprintRequestDigest(request: GuildBlueprintRequest): string {
  return normalizedRequestDigest(normalizeGuildBlueprintRequest(request))
}

function scaffoldRequest(request: NormalizedGuildBlueprintRequest): GuildScaffoldRequest {
  return {
    auditReason: request.auditReason,
    channels: request.scaffold.channels,
    guildId: request.guildId,
    operationKey: derivedOperationKey(request.operationKey, "structure"),
    roles: request.scaffold.roles,
    stepLimit: request.scaffold.stepLimit,
  }
}

function profileRequest(
  request: NormalizedGuildBlueprintRequest,
): GuildProfileChangeRequest | undefined {
  if (request.profile === undefined) return undefined
  return {
    ...request.profile,
    auditReason: request.auditReason,
    guildId: request.guildId,
    operationKey: derivedOperationKey(request.operationKey, "profile"),
  }
}

function resolveChannelReference(
  reference: GuildBlueprintChannelReference | null | undefined,
  bindings: ReadonlyMap<string, GuildBlueprintBinding>,
  description: string,
): string | null | undefined {
  if (reference === undefined || reference === null) return reference
  if (reference.kind === "exact") return reference.channelId
  const binding = bindings.get(reference.key)
  if (binding === undefined || binding.kind === "role") {
    throw new RangeError(`${description} scaffold reference is unresolved`)
  }
  return binding.resourceId
}

function settingsRequest(
  request: NormalizedGuildBlueprintRequest,
  bindings: ReadonlyMap<string, GuildBlueprintBinding>,
): GuildSettingsChangeRequest | undefined {
  if (request.settings === undefined) return undefined
  const settings = request.settings
  const resolved: GuildSettingsChangeRequest = {
    ...(own(settings, "afkChannel")
      ? {
          afkChannelId: resolveChannelReference(
            settings.afkChannel as GuildBlueprintChannelReference | null,
            bindings,
            "Discord guild blueprint AFK channel",
          ) as string | null,
        }
      : {}),
    ...(own(settings, "afkTimeoutSeconds")
      ? { afkTimeoutSeconds: settings.afkTimeoutSeconds }
      : {}),
    auditReason: request.auditReason,
    ...(own(settings, "defaultMessageNotifications")
      ? { defaultMessageNotifications: settings.defaultMessageNotifications }
      : {}),
    ...(own(settings, "explicitContentFilter")
      ? { explicitContentFilter: settings.explicitContentFilter }
      : {}),
    guildId: request.guildId,
    operationKey: derivedOperationKey(request.operationKey, "settings"),
    ...(own(settings, "premiumProgressBarEnabled")
      ? { premiumProgressBarEnabled: settings.premiumProgressBarEnabled }
      : {}),
    ...(own(settings, "suppressedSystemNotifications")
      ? { suppressedSystemNotifications: settings.suppressedSystemNotifications }
      : {}),
    ...(own(settings, "systemChannel")
      ? {
          systemChannelId: resolveChannelReference(
            settings.systemChannel as GuildBlueprintChannelReference | null,
            bindings,
            "Discord guild blueprint system channel",
          ) as string | null,
        }
      : {}),
    ...(own(settings, "verificationLevel")
      ? { verificationLevel: settings.verificationLevel }
      : {}),
  }
  normalizeGuildSettingsChangeRequest(resolved)
  return resolved
}

function welcomeScreenRequest(
  request: NormalizedGuildBlueprintRequest,
  bindings: ReadonlyMap<string, GuildBlueprintBinding>,
): WelcomeScreenChangeRequest | undefined {
  if (request.welcomeScreen === undefined) return undefined
  const resolved: WelcomeScreenChangeRequest = {
    auditReason: request.auditReason,
    channels: request.welcomeScreen.channels.map((entry) => {
      const channelId = resolveChannelReference(
        entry.channel,
        bindings,
        "Discord guild blueprint Welcome Screen channel",
      )
      if (typeof channelId !== "string") {
        throw new RangeError(
          "Discord guild blueprint Welcome Screen channel reference is unresolved",
        )
      }
      return {
        channelId,
        description: entry.description,
        emoji: entry.emoji,
      }
    }),
    description: request.welcomeScreen.description,
    enabled: request.welcomeScreen.enabled,
    guildId: request.guildId,
    operationKey: derivedOperationKey(request.operationKey, "welcome-screen"),
  }
  normalizeWelcomeScreenChangeRequest(resolved)
  return resolved
}

function phaseOperationKeyHash(
  request: NormalizedGuildBlueprintRequest,
  phase: GuildBlueprintPhase,
): string {
  return operationKeyHash(derivedOperationKey(request.operationKey, phase))
}

function waitingStep(
  request: NormalizedGuildBlueprintRequest,
  kind: GuildBlueprintPhase,
): GuildBlueprintPlanStep {
  return {
    kind,
    nestedPlanDigest: null,
    operationKeyHash: phaseOperationKeyHash(request, kind),
    state: "waiting",
    writeRequired: false,
  }
}

function exactScaffoldBindings(
  request: NormalizedGuildBlueprintRequest,
  plan: GuildScaffoldPlan,
): GuildBlueprintBinding[] {
  const expected = new Map<string, {
    index: number
    kind: GuildBlueprintBinding["kind"]
  }>([
    ...request.scaffold.roles.map((role, index) => [
      role.key,
      { index, kind: "role" as const },
    ] as const),
    ...request.scaffold.channels.map((channel, offset) => [
      channel.key,
      { index: request.scaffold.roles.length + offset, kind: channel.kind },
    ] as const),
  ])
  const seenKeys = new Set<string>()
  const seenResourceIds = new Set<string>()
  const bindings = plan.steps.map((step): GuildBlueprintBinding => {
    const expectedStep = expected.get(step.key)
    if (
      expectedStep === undefined
      || expectedStep.index !== step.index
      || expectedStep.kind !== step.kind
      || step.existingResourceId === null
      || seenKeys.has(step.key)
      || seenResourceIds.has(step.existingResourceId)
    ) {
      throw new RangeError(
        "Discord guild blueprint scaffold did not return complete exact resource bindings",
      )
    }
    positiveSnowflake(
      step.existingResourceId,
      "Discord guild blueprint scaffold resource ID",
    )
    seenKeys.add(step.key)
    seenResourceIds.add(step.existingResourceId)
    return {
      index: step.index,
      key: step.key,
      kind: step.kind,
      resourceId: step.existingResourceId,
    }
  })
  if (bindings.length !== expected.size) {
    throw new RangeError(
      "Discord guild blueprint scaffold returned an incomplete resource graph",
    )
  }
  return bindings.sort((left, right) => left.index - right.index)
}

function bindingMap(bindings: readonly GuildBlueprintBinding[]) {
  return new Map(bindings.map((binding) => [binding.key, binding]))
}

function assertNestedIdentity(
  applicationId: string,
  botId: string,
  guildId: string,
  nested: {
    applicationId: string
    botId: string
  } & ({ guildId: string } | { guild: { id: string } }),
): void {
  const nestedGuildId = "guildId" in nested ? nested.guildId : nested.guild.id
  if (
    nested.applicationId !== applicationId
    || nested.botId !== botId
    || nestedGuildId !== guildId
  ) {
    throw new RangeError("Discord guild blueprint nested plan identity changed")
  }
}

function assertNestedPlanBinding(
  operationKey: string,
  plan: {
    digest: string
    operationKeyHash: string
  },
): void {
  if (
    plan.operationKeyHash !== operationKeyHash(operationKey)
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(plan.digest)
  ) {
    throw new RangeError("Discord guild blueprint nested plan binding changed")
  }
}

function digestStep(step: GuildBlueprintPlanStep) {
  return {
    kind: step.kind,
    nestedPlanDigest: step.nestedPlanDigest,
    operationKeyHash: step.operationKeyHash,
    state: step.state,
    writeRequired: step.writeRequired,
  }
}

export class GuildBlueprintService {
  readonly #clock: () => Date
  readonly #domains: GuildBlueprintDomainServices
  readonly #planKey: Uint8Array

  constructor(options: GuildBlueprintServiceOptions) {
    this.#clock = options.clock || (() => new Date())
    this.#domains = options.domains
    this.#planKey = options.planKey || createReviewedPlanKey()
  }

  async #build(
    applicationId: string,
    botId: string,
    requestInput: GuildBlueprintRequest,
    options: RequestOptions,
  ): Promise<BuiltGuildBlueprintPlan> {
    const request = normalizeGuildBlueprintRequest(requestInput)
    const requestDigest = normalizedRequestDigest(request)
    const structureRequest = scaffoldRequest(request)
    const structurePlan = await this.#domains.scaffold.plan(
      applicationId,
      botId,
      structureRequest,
      options,
    )
    assertNestedIdentity(applicationId, botId, request.guildId, structurePlan)
    assertNestedPlanBinding(structureRequest.operationKey, {
      digest: structurePlan.digest,
      operationKeyHash: structurePlan.operation.operationKeyHash,
    })

    const steps: GuildBlueprintPlanStep[] = []
    let bindings: GuildBlueprintBinding[] = []
    let frontier: GuildBlueprintFrontier | null = null
    let frontierRequest: GuildBlueprintFrontierRequest | null = null
    const structureSatisfied = ["already-current", "completed"].includes(
      structurePlan.status,
    )
    steps.push({
      kind: "structure",
      nestedPlanDigest: structurePlan.digest,
      operationKeyHash: structurePlan.operation.operationKeyHash,
      state: structureSatisfied ? "satisfied" : "ready",
      writeRequired: !structureSatisfied && structurePlan.counts.ready > 0,
    })
    if (!structureSatisfied) {
      frontier = {
        kind: "structure",
        plan: structurePlan,
        writeRequired: structurePlan.counts.ready > 0,
      }
      frontierRequest = { kind: "structure", request: structureRequest }
      if (request.profile !== undefined) steps.push(waitingStep(request, "profile"))
      if (request.settings !== undefined) steps.push(waitingStep(request, "settings"))
      if (request.welcomeScreen !== undefined) {
        steps.push(waitingStep(request, "welcome-screen"))
      }
    } else {
      bindings = exactScaffoldBindings(request, structurePlan)
      const requestedProfile = profileRequest(request)
      if (requestedProfile !== undefined) {
        const profilePlan = await this.#domains.profile.plan(
          applicationId,
          botId,
          requestedProfile,
          options,
        )
        assertNestedIdentity(applicationId, botId, request.guildId, profilePlan)
        assertNestedPlanBinding(requestedProfile.operationKey, profilePlan)
        const profileSatisfied = !profilePlan.writeRequired
        steps.push({
          kind: "profile",
          nestedPlanDigest: profilePlan.digest,
          operationKeyHash: profilePlan.operationKeyHash,
          state: profileSatisfied ? "satisfied" : "ready",
          writeRequired: !profileSatisfied,
        })
        if (!profileSatisfied) {
          frontier = { kind: "profile", plan: profilePlan, writeRequired: true }
          frontierRequest = { kind: "profile", request: requestedProfile }
          if (request.settings !== undefined) steps.push(waitingStep(request, "settings"))
          if (request.welcomeScreen !== undefined) {
            steps.push(waitingStep(request, "welcome-screen"))
          }
        }
      }

      if (frontier === null) {
        const requestedSettings = settingsRequest(request, bindingMap(bindings))
        if (requestedSettings !== undefined) {
          const settingsPlan = await this.#domains.settings.plan(
            applicationId,
            botId,
            requestedSettings,
            options,
          )
          assertNestedIdentity(applicationId, botId, request.guildId, settingsPlan)
          assertNestedPlanBinding(requestedSettings.operationKey, settingsPlan)
          const settingsSatisfied = !settingsPlan.writeRequired
          steps.push({
            kind: "settings",
            nestedPlanDigest: settingsPlan.digest,
            operationKeyHash: settingsPlan.operationKeyHash,
            state: settingsSatisfied ? "satisfied" : "ready",
            writeRequired: !settingsSatisfied,
          })
          if (!settingsSatisfied) {
            frontier = { kind: "settings", plan: settingsPlan, writeRequired: true }
            frontierRequest = { kind: "settings", request: requestedSettings }
            if (request.welcomeScreen !== undefined) {
              steps.push(waitingStep(request, "welcome-screen"))
            }
          }
        }
      }

      if (frontier === null) {
        const requestedWelcomeScreen = welcomeScreenRequest(
          request,
          bindingMap(bindings),
        )
        if (requestedWelcomeScreen !== undefined) {
          const welcomeScreenPlan = await this.#domains.welcomeScreen.plan(
            applicationId,
            botId,
            requestedWelcomeScreen,
            options,
          )
          assertNestedIdentity(
            applicationId,
            botId,
            request.guildId,
            welcomeScreenPlan,
          )
          assertNestedPlanBinding(
            requestedWelcomeScreen.operationKey,
            welcomeScreenPlan,
          )
          const welcomeScreenSatisfied = !welcomeScreenPlan.writeRequired
          steps.push({
            kind: "welcome-screen",
            nestedPlanDigest: welcomeScreenPlan.digest,
            operationKeyHash: welcomeScreenPlan.operationKeyHash,
            state: welcomeScreenSatisfied ? "satisfied" : "ready",
            writeRequired: !welcomeScreenSatisfied,
          })
          if (!welcomeScreenSatisfied) {
            frontier = {
              kind: "welcome-screen",
              plan: welcomeScreenPlan,
              writeRequired: true,
            }
            frontierRequest = {
              kind: "welcome-screen",
              request: requestedWelcomeScreen,
            }
          }
        }
      }
    }

    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      bindings,
      botId,
      frontier: frontier === null
        ? null
        : {
            kind: frontier.kind,
            nestedPlanDigest: frontier.plan.digest,
            writeRequired: frontier.writeRequired,
          },
      guildId: request.guildId,
      requestDigest,
      steps: steps.map(digestStep),
      version: "guild-blueprint-plan.v2",
    })
    const plan: GuildBlueprintPlan = {
      applicationId,
      bindings,
      botId,
      createdAt: this.#clock().toISOString(),
      digest,
      frontier,
      guild: { ...structurePlan.guild },
      operationKeyHash: request.operationKeyHash,
      privacy: {
        activityAndReceipts: "content-free-domain-records",
        manifestPersistence: "none",
        planPersistence: "none",
        requestState: "digests-only",
      },
      requestDigest,
      schemaVersion: SCHEMA_VERSION,
      status: frontier === null ? "already-current" : "planned",
      steps,
      warnings: [
        "The exact blueprint manifest and master operation key remain caller-retained and are not persisted by the connector",
        "One execution call can run only this fresh reviewed frontier; plan again before any later phase",
        "A failed, drifting, or uncertain nested operation remains quarantined under its existing domain workflow",
      ],
    }
    return { frontierRequest, plan }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildBlueprintRequest,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintPlan> {
    return (await this.#build(applicationId, botId, request, options)).plan
  }

  async execute(
    applicationId: string,
    botId: string,
    request: GuildBlueprintRequest,
    planDigest: string,
    executors: GuildBlueprintExecutors,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild blueprint plan digest is invalid")
    }
    const built = await this.#build(applicationId, botId, request, options)
    if (built.plan.digest !== planDigest) {
      throw new GuildBlueprintPlanChangedError(planDigest, built.plan.digest)
    }
    if (built.plan.frontier === null || built.frontierRequest === null) {
      return {
        digest: built.plan.digest,
        executedPhase: null,
        guildId: built.plan.guild.id,
        nestedResult: null,
        nextAction: "done",
        operationKeyHash: built.plan.operationKeyHash,
        requestDigest: built.plan.requestDigest,
        schemaVersion: SCHEMA_VERSION,
        status: "already-current",
      }
    }
    let nestedResult: GuildBlueprintNestedResult
    if (built.frontierRequest.kind === "structure") {
      nestedResult = await executors.executeScaffold(
        built.frontierRequest.request,
        built.plan.frontier.plan.digest,
        options,
      )
    } else if (built.frontierRequest.kind === "profile") {
      nestedResult = await executors.executeProfile(
        built.frontierRequest.request,
        built.plan.frontier.plan.digest,
        options,
      )
    } else if (built.frontierRequest.kind === "settings") {
      nestedResult = await executors.executeSettings(
        built.frontierRequest.request,
        built.plan.frontier.plan.digest,
        options,
      )
    } else {
      nestedResult = await executors.executeWelcomeScreen(
        built.frontierRequest.request,
        built.plan.frontier.plan.digest,
        options,
      )
    }
    return {
      digest: built.plan.digest,
      executedPhase: built.frontierRequest.kind,
      guildId: built.plan.guild.id,
      nestedResult,
      nextAction: "replan",
      operationKeyHash: built.plan.operationKeyHash,
      requestDigest: built.plan.requestDigest,
      schemaVersion: SCHEMA_VERSION,
      status: "frontier-executed",
    }
  }

  async verify(
    applicationId: string,
    botId: string,
    request: GuildBlueprintRequest,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintVerification> {
    const plan = await this.plan(applicationId, botId, request, options)
    return {
      applicationId: plan.applicationId,
      botId: plan.botId,
      checkedAt: this.#clock().toISOString(),
      digest: plan.digest,
      evidence: {
        activityAndReceipts: "content-free-domain-records",
        callerRetainedManifestRequired: true,
        historicalMutationProvenance: "domain-activity-only",
        manifestPersisted: false,
        source: "live-domain-plans",
      },
      guildId: plan.guild.id,
      operationKeyHash: plan.operationKeyHash,
      requestDigest: plan.requestDigest,
      resources: plan.bindings.map((binding) => ({
        index: binding.index,
        kind: binding.kind,
        resourceId: binding.resourceId,
      })),
      schemaVersion: SCHEMA_VERSION,
      status: plan.status === "already-current" ? "verified" : "incomplete",
      steps: plan.steps.map(digestStep),
    }
  }
}
