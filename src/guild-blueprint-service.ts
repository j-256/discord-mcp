import { createHmac } from "node:crypto"

import {
  CONNECTOR_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_SCAFFOLD_SYMBOL_PATTERN,
  ONBOARDING_LIMITS,
  SCHEMA_VERSION,
  WELCOME_SCREEN_LIMITS,
} from "./constants.js"
import type {
  ComponentLayoutInput,
  NormalizedComponentLayout,
} from "./component-layout.js"
import {
  type ComponentMessageContentIntentStatus,
  type ComponentMessagePlan,
  type ComponentMessageRequest,
  type ComponentMessageResult,
  type ComponentMessageVerificationReason,
  type ComponentMessageVerificationResult,
  normalizeComponentMessageRequest,
} from "./component-message-service.js"
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
import {
  type OnboardingChangePlan,
  type OnboardingChangeRequest,
  type OnboardingChangeResult,
  normalizeOnboardingChangeRequest,
} from "./onboarding-service.js"
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
  "onboarding",
  "operationKey",
  "profile",
  "publications",
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
const BLUEPRINT_ONBOARDING_KEYS = Object.freeze([
  "defaultChannels",
  "enabled",
  "mode",
  "prompts",
] as const)
const BLUEPRINT_ONBOARDING_PROMPT_KEYS = Object.freeze([
  "inOnboarding",
  "options",
  "promptId",
  "required",
  "singleSelect",
  "title",
  "type",
] as const)
const BLUEPRINT_ONBOARDING_OPTION_KEYS = Object.freeze([
  "channels",
  "description",
  "emoji",
  "optionId",
  "roles",
  "title",
] as const)
const BLUEPRINT_PUBLICATION_CREATE_KEYS = Object.freeze([
  "action",
  "channel",
  "components",
  "key",
  "notifyUserIds",
] as const)
const BLUEPRINT_PUBLICATION_EDIT_KEYS = Object.freeze([
  ...BLUEPRINT_PUBLICATION_CREATE_KEYS,
  "messageId",
] as const)

export const GUILD_BLUEPRINT_PHASES = Object.freeze([
  "structure",
  "profile",
  "settings",
  "welcome-screen",
  "onboarding",
  "publication",
] as const)

export type GuildBlueprintPhase = typeof GUILD_BLUEPRINT_PHASES[number]
export type GuildBlueprintSingletonPhase = Exclude<GuildBlueprintPhase, "publication">
export type GuildBlueprintPhaseState = "blocked" | "ready" | "satisfied" | "waiting"
const GUILD_BLUEPRINT_SINGLETON_PHASES: ReadonlySet<string> = new Set(
  GUILD_BLUEPRINT_PHASES.filter((phase) => phase !== "publication"),
)

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

export interface GuildBlueprintExactRoleReference {
  kind: "exact"
  roleId: string
}

export interface GuildBlueprintScaffoldRoleReference {
  key: string
  kind: "scaffold"
}

export type GuildBlueprintRoleReference =
  | GuildBlueprintExactRoleReference
  | GuildBlueprintScaffoldRoleReference

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

export interface GuildBlueprintOnboardingOptionInput extends Omit<
  OnboardingChangeRequest["prompts"][number]["options"][number],
  "channelIds" | "roleIds"
> {
  channels: readonly GuildBlueprintChannelReference[]
  roles: readonly GuildBlueprintRoleReference[]
}

export interface GuildBlueprintOnboardingPromptInput extends Omit<
  OnboardingChangeRequest["prompts"][number],
  "options"
> {
  options: readonly GuildBlueprintOnboardingOptionInput[]
}

export type GuildBlueprintOnboardingInput = Omit<
  OnboardingChangeRequest,
  "auditReason" | "defaultChannelIds" | "guildId" | "operationKey" | "prompts"
> & {
  defaultChannels: readonly GuildBlueprintChannelReference[]
  prompts: readonly GuildBlueprintOnboardingPromptInput[]
}

interface GuildBlueprintPublicationBaseInput {
  channel: GuildBlueprintChannelReference
  components: readonly ComponentLayoutInput[]
  key: string
  notifyUserIds?: readonly string[]
}

export interface GuildBlueprintCreatePublicationInput
  extends GuildBlueprintPublicationBaseInput {
  action: "create"
}

export interface GuildBlueprintEditPublicationInput
  extends GuildBlueprintPublicationBaseInput {
  action: "edit"
  messageId: string
}

export type GuildBlueprintPublicationInput =
  | GuildBlueprintCreatePublicationInput
  | GuildBlueprintEditPublicationInput

export interface GuildBlueprintRequest {
  auditReason: string
  guildId: string
  onboarding?: GuildBlueprintOnboardingInput
  operationKey: string
  profile?: GuildBlueprintProfileInput
  publications?: readonly GuildBlueprintPublicationInput[]
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

export type NormalizedGuildBlueprintPublicationInput = {
  channel: GuildBlueprintChannelReference
  components: ComponentLayoutInput[]
  key: string
  notifyUserIds: string[]
} & (
  | { action: "create" }
  | { action: "edit"; messageId: string }
)

export interface NormalizedGuildBlueprintRequest {
  auditReason: string
  guildId: string
  onboarding?: GuildBlueprintOnboardingInput
  operationKey: string
  operationKeyHash: string
  profile?: GuildBlueprintProfileInput
  publications?: NormalizedGuildBlueprintPublicationInput[]
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
const TEXT_OR_FORUM_SCAFFOLD_KINDS = new Set<GuildBlueprintBinding["kind"]>([
  "forum",
  "text",
])

interface GuildBlueprintPlanStepBase {
  nestedPlanDigest: string | null
  operationKeyHash: string
  state: GuildBlueprintPhaseState
  writeRequired: boolean
}

export interface GuildBlueprintSingletonPlanStep extends GuildBlueprintPlanStepBase {
  kind: GuildBlueprintSingletonPhase
}

export interface GuildBlueprintPublicationPlanStep extends GuildBlueprintPlanStepBase {
  channelId: string | null
  index: number
  key: string
  kind: "publication"
  messageId: string | null
  receiptStatus: ComponentMessageVerificationResult["receiptStatus"]
  verificationReason: ComponentMessageVerificationReason | null
  verificationStatus: ComponentMessageVerificationResult["status"] | null
}

export type GuildBlueprintPlanStep =
  | GuildBlueprintPublicationPlanStep
  | GuildBlueprintSingletonPlanStep

export interface GuildBlueprintPublicationBlocker {
  channelId: string
  index: number
  messageId: string | null
  operationKeyHash: string
  receiptStatus: ComponentMessageVerificationResult["receiptStatus"]
  verificationReason: ComponentMessageVerificationReason
  verificationStatus: "blocked" | "drifted"
}

export type GuildBlueprintFrontier =
  | {
      kind: "onboarding"
      plan: OnboardingChangePlan
      writeRequired: true
    }
  | {
      kind: "profile"
      plan: GuildProfileChangePlan
      writeRequired: true
    }
  | {
      index: number
      key: string
      kind: "publication"
      plan: ComponentMessagePlan
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
  blocker: GuildBlueprintPublicationBlocker | null
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
  status: "already-current" | "blocked" | "planned"
  steps: GuildBlueprintPlanStep[]
  warnings: string[]
}

export type GuildBlueprintNestedResult =
  | ComponentMessageResult
  | OnboardingChangeResult
  | GuildProfileChangeResult
  | GuildScaffoldResult
  | GuildSettingsChangeResult
  | WelcomeScreenChangeResult

export interface GuildBlueprintResult {
  blocker: GuildBlueprintPublicationBlocker | null
  digest: string
  executedPhase: GuildBlueprintPhase | null
  executedPublicationIndex: number | null
  guildId: string
  nestedResult: GuildBlueprintNestedResult | null
  nextAction: "done" | "inspect" | "replan"
  operationKeyHash: string
  requestDigest: string
  schemaVersion: number
  status: "already-current" | "blocked" | "frontier-executed"
}

export interface GuildBlueprintVerificationStep {
  channelId?: string | null
  index?: number
  kind: GuildBlueprintPhase
  messageId?: string | null
  nestedPlanDigest: string | null
  operationKeyHash: string
  receiptStatus?: ComponentMessageVerificationResult["receiptStatus"]
  state: GuildBlueprintPhaseState
  verificationReason?: ComponentMessageVerificationReason | null
  verificationStatus?: ComponentMessageVerificationResult["status"] | null
  writeRequired: boolean
}

export interface GuildBlueprintVerification {
  applicationId: string
  blocker: GuildBlueprintPublicationBlocker | null
  botId: string
  checkedAt: string
  digest: string
  evidence: {
    activityAndReceipts: "content-free-domain-records"
    callerRetainedManifestRequired: true
    historicalMutationProvenance: "domain-activity-and-receipts"
    manifestPersisted: false
    source: "live-domain-plans-and-exact-receipt-readback"
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
  status: "blocked" | "incomplete" | "verified"
  steps: GuildBlueprintVerificationStep[]
}

export interface GuildBlueprintDomainServices {
  component: {
    plan(
      applicationId: string,
      botId: string,
      intent: ComponentMessageContentIntentStatus,
      request: ComponentMessageRequest,
      options?: RequestOptions,
    ): Promise<ComponentMessagePlan>
    verify(
      applicationId: string,
      botId: string,
      intent: ComponentMessageContentIntentStatus,
      request: ComponentMessageRequest,
      options?: RequestOptions,
    ): Promise<ComponentMessageVerificationResult>
  }
  onboarding: {
    plan(
      applicationId: string,
      botId: string,
      request: OnboardingChangeRequest,
      options?: RequestOptions,
    ): Promise<OnboardingChangePlan>
  }
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
  executeComponent(
    request: ComponentMessageRequest,
    planDigest: string,
    options?: RequestOptions,
  ): Promise<ComponentMessageResult>
  executeOnboarding(
    request: OnboardingChangeRequest,
    planDigest: string,
    options?: RequestOptions,
  ): Promise<OnboardingChangeResult>
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
      kind: "onboarding"
      request: OnboardingChangeRequest
    }
  | {
      kind: "profile"
      request: GuildProfileChangeRequest
    }
  | {
      index: number
      kind: "publication"
      request: ComponentMessageRequest
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

function canonicalComponentLayoutInput(
  layout: NormalizedComponentLayout,
): ComponentLayoutInput[] {
  return layout.map((component) => {
    if (component.kind === "text") return { ...component }
    if (component.kind === "separator") return { ...component }
    return {
      ...(component.accentColor === null
        ? {}
        : { accentColor: component.accentColor }),
      components: component.components.map((child) => ({ ...child })),
      kind: "container",
      spoiler: component.spoiler,
    }
  })
}

function isPositiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function positiveSnowflake(value: unknown, description: string): string {
  if (
    !isPositiveSnowflake(value)
  ) throw new RangeError(`${description} must be a positive Discord snowflake`)
  return value
}

function derivedOperationKey(
  operationKey: string,
  phase: GuildBlueprintSingletonPhase,
): string {
  return `blueprint:${createHmac("sha256", operationKey)
    .update("discord-mcp-guild-blueprint-step.v1\0")
    .update(phase)
    .digest("hex")}`
}

export function guildBlueprintStepOperationKey(
  operationKey: string,
  phase: GuildBlueprintSingletonPhase,
): string {
  operationKeyHash(operationKey)
  if (!GUILD_BLUEPRINT_SINGLETON_PHASES.has(phase)) {
    throw new RangeError("Discord guild blueprint phase is invalid")
  }
  return derivedOperationKey(operationKey, phase)
}

function derivedPublicationOperationKey(operationKey: string, key: string): string {
  return `blueprint-publication:${createHmac("sha256", operationKey)
    .update("discord-mcp-guild-blueprint-publication.v1\0")
    .update(key)
    .digest("hex")}`
}

export function guildBlueprintPublicationOperationKey(
  operationKey: string,
  key: string,
): string {
  operationKeyHash(operationKey)
  if (
    typeof key !== "string"
    || key.length > CONNECTOR_LIMITS.scaffoldSymbolCharacters
    || !GUILD_SCAFFOLD_SYMBOL_PATTERN.test(key)
  ) {
    throw new RangeError("Discord guild blueprint publication key is invalid")
  }
  return derivedPublicationOperationKey(operationKey, key)
}

function normalizeChannelReference(
  value: unknown,
  channelKinds: ReadonlyMap<string, GuildBlueprintBinding["kind"]>,
  scaffoldKinds: ReadonlySet<GuildBlueprintBinding["kind"]>,
  description: string,
): GuildBlueprintChannelReference | null {
  if (value === null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError(`${description} must be null or one channel reference`)
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

function normalizeRoleReference(
  value: unknown,
  scaffoldRoleKeys: ReadonlySet<string>,
  description: string,
): GuildBlueprintRoleReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError(`${description} must be one role reference`)
  }
  const record = value as Record<string, unknown>
  if (record.kind === "exact") {
    exactObject(record, ["kind", "roleId"], `${description} exact reference is invalid`)
    return {
      kind: "exact",
      roleId: positiveSnowflake(record.roleId, description),
    }
  }
  if (record.kind === "scaffold") {
    exactObject(record, ["key", "kind"], `${description} scaffold reference is invalid`)
    if (typeof record.key !== "string" || !scaffoldRoleKeys.has(record.key)) {
      throw new RangeError(`${description} scaffold key does not reference a requested role`)
    }
    return { key: record.key, kind: "scaffold" }
  }
  throw new RangeError(`${description} kind is invalid`)
}

function channelReferenceKey(reference: GuildBlueprintChannelReference): string {
  return reference.kind === "exact"
    ? `exact:${reference.channelId}`
    : `scaffold:${reference.key}`
}

function roleReferenceKey(reference: GuildBlueprintRoleReference): string {
  return reference.kind === "exact"
    ? `exact:${reference.roleId}`
    : `scaffold:${reference.key}`
}

function canonicalChannelReferences(
  value: unknown,
  maximum: number,
  channelKinds: ReadonlyMap<string, GuildBlueprintBinding["kind"]>,
  scaffoldKinds: ReadonlySet<GuildBlueprintBinding["kind"]>,
  description: string,
): GuildBlueprintChannelReference[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RangeError(`${description} are invalid`)
  }
  const seen = new Set<string>()
  return value.map((item) => {
    const reference = normalizeChannelReference(
      item,
      channelKinds,
      scaffoldKinds,
      description,
    )
    if (reference === null) throw new RangeError(`${description} must not contain null`)
    const key = channelReferenceKey(reference)
    if (seen.has(key)) throw new RangeError(`${description} must be unique`)
    seen.add(key)
    return reference
  })
}

function canonicalRoleReferences(
  value: unknown,
  maximum: number,
  scaffoldRoleKeys: ReadonlySet<string>,
  description: string,
): GuildBlueprintRoleReference[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RangeError(`${description} are invalid`)
  }
  const seen = new Set<string>()
  return value.map((item) => {
    const reference = normalizeRoleReference(item, scaffoldRoleKeys, description)
    const key = roleReferenceKey(reference)
    if (seen.has(key)) throw new RangeError(`${description} must be unique`)
    seen.add(key)
    return reference
  })
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
      TEXT_OR_FORUM_SCAFFOLD_KINDS,
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

function canonicalOnboardingInput(
  request: GuildBlueprintRequest,
  operationKey: string,
  channelKinds: ReadonlyMap<string, GuildBlueprintBinding["kind"]>,
  scaffoldRoleKeys: ReadonlySet<string>,
): GuildBlueprintOnboardingInput | undefined {
  if (request.onboarding === undefined) return undefined
  exactObject(
    request.onboarding,
    BLUEPRINT_ONBOARDING_KEYS,
    "Discord guild blueprint onboarding must be an exact object",
  )
  const onboarding = request.onboarding as GuildBlueprintOnboardingInput
  const defaultChannels = canonicalChannelReferences(
    onboarding.defaultChannels,
    ONBOARDING_LIMITS.defaultChannels,
    channelKinds,
    TEXT_OR_FORUM_SCAFFOLD_KINDS,
    "Discord guild blueprint onboarding default channel references",
  )
  if (
    !Array.isArray(onboarding.prompts)
    || onboarding.prompts.length > ONBOARDING_LIMITS.prompts
  ) {
    throw new RangeError("Discord guild blueprint onboarding prompts are invalid")
  }
  const prompts = onboarding.prompts.map((promptValue) => {
    exactObject(
      promptValue,
      BLUEPRINT_ONBOARDING_PROMPT_KEYS,
      "Discord guild blueprint onboarding prompt must be an exact object",
    )
    const prompt = promptValue as unknown as GuildBlueprintOnboardingPromptInput
    if (
      !Array.isArray(prompt.options)
      || prompt.options.length > ONBOARDING_LIMITS.optionsPerPrompt
    ) {
      throw new RangeError("Discord guild blueprint onboarding prompt options are invalid")
    }
    return {
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map((optionValue) => {
        exactObject(
          optionValue,
          BLUEPRINT_ONBOARDING_OPTION_KEYS,
          "Discord guild blueprint onboarding option must be an exact object",
        )
        const option = optionValue as unknown as GuildBlueprintOnboardingOptionInput
        return {
          channels: canonicalChannelReferences(
            option.channels,
            ONBOARDING_LIMITS.optionReferences,
            channelKinds,
            TEXT_OR_FORUM_SCAFFOLD_KINDS,
            "Discord guild blueprint onboarding option channel references",
          ),
          description: option.description,
          emoji: option.emoji ?? null,
          ...(option.optionId === undefined
            ? {}
            : { optionId: option.optionId }),
          roles: canonicalRoleReferences(
            option.roles,
            ONBOARDING_LIMITS.optionReferences,
            scaffoldRoleKeys,
            "Discord guild blueprint onboarding option role references",
          ),
          title: option.title,
        }
      }),
      ...(prompt.promptId === undefined
        ? {}
        : { promptId: prompt.promptId }),
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type: prompt.type,
    }
  })
  const usedIds = new Set<string>([request.guildId])
  for (const reference of [
    ...defaultChannels,
    ...prompts.flatMap((prompt) => prompt.options.flatMap((option) => option.channels)),
  ]) {
    if (reference.kind === "exact") usedIds.add(reference.channelId)
  }
  for (const reference of prompts.flatMap((prompt) => (
    prompt.options.flatMap((option) => option.roles)
  ))) {
    if (reference.kind === "exact") usedIds.add(reference.roleId)
  }
  const temporaryIds = new Map<string, string>()
  let temporaryId = DISCORD_SNOWFLAKE_MAX
  function nextTemporaryId(key: string): string {
    const existing = temporaryIds.get(key)
    if (existing !== undefined) return existing
    while (usedIds.has(temporaryId.toString())) temporaryId -= 1n
    const result = temporaryId.toString()
    usedIds.add(result)
    temporaryIds.set(key, result)
    temporaryId -= 1n
    return result
  }
  function temporaryChannelId(reference: GuildBlueprintChannelReference): string {
    return reference.kind === "exact"
      ? reference.channelId
      : nextTemporaryId(`channel:${reference.key}`)
  }
  function temporaryRoleId(reference: GuildBlueprintRoleReference): string {
    return reference.kind === "exact"
      ? reference.roleId
      : nextTemporaryId(`role:${reference.key}`)
  }
  const normalized = normalizeOnboardingChangeRequest({
    auditReason: request.auditReason,
    defaultChannelIds: defaultChannels.map(temporaryChannelId),
    enabled: onboarding.enabled,
    guildId: request.guildId,
    mode: onboarding.mode,
    operationKey,
    prompts: prompts.map((prompt) => ({
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map((option) => ({
        channelIds: option.channels.map(temporaryChannelId),
        description: option.description,
        emoji: option.emoji ?? null,
        ...(option.optionId === undefined ? {} : { optionId: option.optionId }),
        roleIds: option.roles.map(temporaryRoleId),
        title: option.title,
      })),
      ...(prompt.promptId === undefined ? {} : { promptId: prompt.promptId }),
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type: prompt.type,
    })),
  })
  return {
    defaultChannels,
    enabled: normalized.enabled,
    mode: normalized.mode,
    prompts: normalized.prompts.map((prompt, promptIndex) => {
      const sourcePrompt = prompts[promptIndex]
      if (sourcePrompt === undefined) {
        throw new RangeError("Discord guild blueprint onboarding prompt is missing")
      }
      return {
        inOnboarding: prompt.inOnboarding,
        options: prompt.options.map((option, optionIndex) => {
          const sourceOption = sourcePrompt.options[optionIndex]
          if (sourceOption === undefined) {
            throw new RangeError("Discord guild blueprint onboarding option is missing")
          }
          return {
            channels: sourceOption.channels,
            description: option.description,
            emoji: option.emoji,
            ...(option.optionId === null ? {} : { optionId: option.optionId }),
            roles: sourceOption.roles,
            title: option.title,
          }
        }),
        ...(prompt.promptId === null ? {} : { promptId: prompt.promptId }),
        required: prompt.required,
        singleSelect: prompt.singleSelect,
        title: prompt.title,
        type: prompt.type,
      }
    }),
  }
}

function canonicalPublicationInputs(
  request: GuildBlueprintRequest,
  channelKinds: ReadonlyMap<string, GuildBlueprintBinding["kind"]>,
): NormalizedGuildBlueprintPublicationInput[] | undefined {
  if (request.publications === undefined) return undefined
  if (
    !Array.isArray(request.publications)
    || request.publications.length < 1
    || request.publications.length > CONNECTOR_LIMITS.guildBlueprintPublications
  ) {
    throw new RangeError("Discord guild blueprint publications are invalid")
  }
  const keys = new Set<string>()
  return request.publications.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RangeError(
        `Discord guild blueprint publication ${index} must be an exact object`,
      )
    }
    const publication = value as GuildBlueprintPublicationInput
    if (publication.action === "create") {
      exactObject(
        publication,
        BLUEPRINT_PUBLICATION_CREATE_KEYS,
        `Discord guild blueprint publication ${index} create shape is invalid`,
      )
    } else if (publication.action === "edit") {
      exactObject(
        publication,
        BLUEPRINT_PUBLICATION_EDIT_KEYS,
        `Discord guild blueprint publication ${index} edit shape is invalid`,
      )
    } else {
      throw new RangeError(`Discord guild blueprint publication ${index} action is invalid`)
    }
    const key = publication.key
    if (
      typeof key !== "string"
      || key.length > CONNECTOR_LIMITS.scaffoldSymbolCharacters
      || !GUILD_SCAFFOLD_SYMBOL_PATTERN.test(key)
    ) {
      throw new RangeError(`Discord guild blueprint publication ${index} key is invalid`)
    }
    if (keys.has(key)) {
      throw new RangeError("Discord guild blueprint publication keys must be unique")
    }
    keys.add(key)
    const channel = normalizeChannelReference(
      publication.channel,
      channelKinds,
      SYSTEM_CHANNEL_SCAFFOLD_KINDS,
      `Discord guild blueprint publication ${index} channel`,
    )
    if (channel === null) {
      throw new RangeError(
        `Discord guild blueprint publication ${index} requires one channel reference`,
      )
    }
    const operationKey = derivedPublicationOperationKey(request.operationKey, key)
    const channelId = channel.kind === "exact" ? channel.channelId : request.guildId
    const normalized = normalizeComponentMessageRequest(
      publication.action === "create"
        ? {
            action: "create",
            channelId,
            components: publication.components,
            ...(publication.notifyUserIds === undefined
              ? {}
              : { notifyUserIds: publication.notifyUserIds }),
            operationKey,
          }
        : {
            action: "edit",
            channelId,
            components: publication.components,
            messageId: publication.messageId,
            ...(publication.notifyUserIds === undefined
              ? {}
              : { notifyUserIds: publication.notifyUserIds }),
            operationKey,
          },
    )
    return normalized.action === "create"
      ? {
          action: "create",
          channel,
          components: canonicalComponentLayoutInput(normalized.components),
          key,
          notifyUserIds: normalized.notifyUserIds,
        }
      : {
          action: "edit",
          channel,
          components: canonicalComponentLayoutInput(normalized.components),
          key,
          messageId: normalized.messageId as string,
          notifyUserIds: normalized.notifyUserIds,
        }
  })
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
    request.onboarding === undefined
    && request.profile === undefined
    && request.publications === undefined
    && request.settings === undefined
    && request.welcomeScreen === undefined
  ) {
    throw new RangeError(
      "Discord guild blueprint requires a profile, settings, Welcome Screen, onboarding, or publication phase after the scaffold",
    )
  }
  const operationKeyHashValue = operationKeyHash(request.operationKey)
  const structureOperationKey = derivedOperationKey(request.operationKey, "structure")
  const scaffold = canonicalScaffoldRequest(request, structureOperationKey)
  const channelKinds = new Map(
    scaffold.channels.map((channel) => [channel.key, channel.kind] as const),
  )
  const scaffoldRoleKeys = new Set(scaffold.roles.map((role) => role.key))
  const onboarding = canonicalOnboardingInput(
    request,
    derivedOperationKey(request.operationKey, "onboarding"),
    channelKinds,
    scaffoldRoleKeys,
  )
  const profile = canonicalProfileRequest(
    request,
    derivedOperationKey(request.operationKey, "profile"),
  )
  const publications = canonicalPublicationInputs(request, channelKinds)
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
    ...(onboarding === undefined ? {} : { onboarding }),
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
    ...(publications === undefined ? {} : { publications }),
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
    ...(request.onboarding === undefined ? {} : { onboarding: request.onboarding }),
    operationKeyHash: request.operationKeyHash,
    ...(request.profile === undefined ? {} : { profile: request.profile }),
    ...(request.publications === undefined
      ? {}
      : { publications: request.publications }),
    scaffold: request.scaffold,
    ...(request.settings === undefined ? {} : { settings: request.settings }),
    ...(request.welcomeScreen === undefined
      ? {}
      : { welcomeScreen: request.welcomeScreen }),
  }
}

function normalizedRequestDigest(request: NormalizedGuildBlueprintRequest): string {
  const digest = createHmac("sha256", request.operationKey)
    .update("discord-mcp-guild-blueprint-request.v4\0")
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

function resolveRoleReference(
  reference: GuildBlueprintRoleReference,
  bindings: ReadonlyMap<string, GuildBlueprintBinding>,
  description: string,
): string {
  if (reference.kind === "exact") return reference.roleId
  const binding = bindings.get(reference.key)
  if (binding === undefined || binding.kind !== "role") {
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

function onboardingRequest(
  request: NormalizedGuildBlueprintRequest,
  bindings: ReadonlyMap<string, GuildBlueprintBinding>,
): OnboardingChangeRequest | undefined {
  if (request.onboarding === undefined) return undefined
  const resolved: OnboardingChangeRequest = {
    auditReason: request.auditReason,
    defaultChannelIds: request.onboarding.defaultChannels.map((reference) => {
      const channelId = resolveChannelReference(
        reference,
        bindings,
        "Discord guild blueprint onboarding default channel",
      )
      if (typeof channelId !== "string") {
        throw new RangeError(
          "Discord guild blueprint onboarding default channel reference is unresolved",
        )
      }
      return channelId
    }),
    enabled: request.onboarding.enabled,
    guildId: request.guildId,
    mode: request.onboarding.mode,
    operationKey: derivedOperationKey(request.operationKey, "onboarding"),
    prompts: request.onboarding.prompts.map((prompt) => ({
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map((option) => ({
        channelIds: option.channels.map((reference) => {
          const channelId = resolveChannelReference(
            reference,
            bindings,
            "Discord guild blueprint onboarding option channel",
          )
          if (typeof channelId !== "string") {
            throw new RangeError(
              "Discord guild blueprint onboarding option channel reference is unresolved",
            )
          }
          return channelId
        }),
        description: option.description,
        emoji: option.emoji ?? null,
        ...(option.optionId === undefined ? {} : { optionId: option.optionId }),
        roleIds: option.roles.map((reference) => resolveRoleReference(
          reference,
          bindings,
          "Discord guild blueprint onboarding option role",
        )),
        title: option.title,
      })),
      ...(prompt.promptId === undefined ? {} : { promptId: prompt.promptId }),
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type: prompt.type,
    })),
  }
  const normalized = normalizeOnboardingChangeRequest(resolved)
  return {
    auditReason: normalized.auditReason,
    defaultChannelIds: normalized.defaultChannelIds,
    enabled: normalized.enabled,
    guildId: normalized.guildId,
    mode: normalized.mode,
    operationKey: normalized.operationKey,
    prompts: normalized.prompts.map((prompt) => ({
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map((option) => ({
        channelIds: option.channelIds,
        description: option.description,
        emoji: option.emoji,
        ...(option.optionId === null ? {} : { optionId: option.optionId }),
        roleIds: option.roleIds,
        title: option.title,
      })),
      ...(prompt.promptId === null ? {} : { promptId: prompt.promptId }),
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type: prompt.type,
    })),
  }
}

function publicationRequest(
  request: NormalizedGuildBlueprintRequest,
  bindings: ReadonlyMap<string, GuildBlueprintBinding>,
  index: number,
): ComponentMessageRequest {
  const publication = request.publications?.[index]
  if (publication === undefined) {
    throw new RangeError("Discord guild blueprint publication is missing")
  }
  const channelId = resolveChannelReference(
    publication.channel,
    bindings,
    `Discord guild blueprint publication ${index} channel`,
  )
  if (typeof channelId !== "string") {
    throw new RangeError(
      `Discord guild blueprint publication ${index} channel is unresolved`,
    )
  }
  const operationKey = derivedPublicationOperationKey(
    request.operationKey,
    publication.key,
  )
  return publication.action === "create"
    ? {
        action: "create",
        channelId,
        components: publication.components,
        notifyUserIds: publication.notifyUserIds,
        operationKey,
      }
    : {
        action: "edit",
        channelId,
        components: publication.components,
        messageId: publication.messageId,
        notifyUserIds: publication.notifyUserIds,
        operationKey,
      }
}

function phaseOperationKeyHash(
  request: NormalizedGuildBlueprintRequest,
  phase: GuildBlueprintSingletonPhase,
): string {
  return operationKeyHash(derivedOperationKey(request.operationKey, phase))
}

function waitingStep(
  request: NormalizedGuildBlueprintRequest,
  kind: GuildBlueprintSingletonPhase,
): GuildBlueprintSingletonPlanStep {
  return {
    kind,
    nestedPlanDigest: null,
    operationKeyHash: phaseOperationKeyHash(request, kind),
    state: "waiting",
    writeRequired: false,
  }
}

function publicationOperationKeyHash(
  request: NormalizedGuildBlueprintRequest,
  index: number,
): string {
  const publication = request.publications?.[index]
  if (publication === undefined) {
    throw new RangeError("Discord guild blueprint publication is missing")
  }
  return operationKeyHash(
    derivedPublicationOperationKey(request.operationKey, publication.key),
  )
}

function waitingPublicationStep(
  request: NormalizedGuildBlueprintRequest,
  index: number,
): GuildBlueprintPublicationPlanStep {
  const publication = request.publications?.[index]
  if (publication === undefined) {
    throw new RangeError("Discord guild blueprint publication is missing")
  }
  return {
    channelId: publication.channel.kind === "exact"
      ? publication.channel.channelId
      : null,
    index,
    key: publication.key,
    kind: "publication",
    messageId: publication.action === "edit" ? publication.messageId : null,
    nestedPlanDigest: null,
    operationKeyHash: publicationOperationKeyHash(request, index),
    receiptStatus: null,
    state: "waiting",
    verificationReason: null,
    verificationStatus: null,
    writeRequired: false,
  }
}

function appendWaitingPublications(
  request: NormalizedGuildBlueprintRequest,
  steps: GuildBlueprintPlanStep[],
  startIndex = 0,
): void {
  for (let index = startIndex; index < (request.publications?.length ?? 0); index += 1) {
    steps.push(waitingPublicationStep(request, index))
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

function assertComponentVerificationBinding(
  guildId: string,
  request: ComponentMessageRequest,
  verification: ComponentMessageVerificationResult,
): void {
  if (
    verification.action !== request.action
    || verification.channelId !== request.channelId
    || verification.operationKeyHash !== operationKeyHash(request.operationKey)
    || verification.schemaVersion !== SCHEMA_VERSION
  ) {
    throw new RangeError(
      "Discord guild blueprint component verification binding changed",
    )
  }
  if (verification.status === "verified") {
    if (
      verification.guildId !== guildId
      || !isPositiveSnowflake(verification.messageId)
      || verification.planDigest === null
      || !REVIEWED_PLAN_DIGEST_PATTERN.test(verification.planDigest)
      || !verification.readbackMatched
      || !verification.requestMatched
      || verification.reason !== null
      || verification.receiptStatus !== "completed"
    ) {
      throw new RangeError(
        "Discord guild blueprint component verification evidence changed",
      )
    }
    return
  }
  if (verification.status === "not-found") {
    if (
      verification.reason !== "operation-not-found"
      || verification.receiptStatus !== null
      || verification.requestMatched
      || verification.readbackMatched
      || verification.guildId !== null
      || verification.messageId !== null
      || verification.planDigest !== null
    ) {
      throw new RangeError(
        "Discord guild blueprint component absence evidence changed",
      )
    }
    return
  }
  if (verification.status === "drifted") {
    if (
      verification.guildId !== guildId
      || !isPositiveSnowflake(verification.messageId)
      || verification.planDigest === null
      || !REVIEWED_PLAN_DIGEST_PATTERN.test(verification.planDigest)
      || verification.readbackMatched
      || !verification.requestMatched
      || verification.receiptStatus !== "completed"
      || !["message-missing", "message-state-mismatch"].includes(
        verification.reason as string,
      )
    ) {
      throw new RangeError(
        "Discord guild blueprint component drift evidence changed",
      )
    }
    return
  }
  if (verification.status === "blocked") {
    if (verification.reason === "request-mismatch") {
      if (
        verification.guildId !== null
        || verification.messageId !== null
        || verification.planDigest !== null
        || verification.readbackMatched
        || verification.requestMatched
        || verification.receiptStatus === null
      ) {
        throw new RangeError(
          "Discord guild blueprint component blocker evidence changed",
        )
      }
      return
    }
    const expectedReceiptStatus = verification.reason === "operation-pending"
      ? "pending"
      : verification.reason === "operation-failed"
        ? "failed"
        : verification.reason === "operation-uncertain"
          ? "uncertain"
          : verification.reason === "receipt-target-mismatch"
            ? "completed"
            : null
    if (
      expectedReceiptStatus === null
      || !isPositiveSnowflake(verification.guildId)
      || verification.planDigest === null
      || !REVIEWED_PLAN_DIGEST_PATTERN.test(verification.planDigest)
      || verification.readbackMatched
      || !verification.requestMatched
      || verification.receiptStatus !== expectedReceiptStatus
      || verification.messageId !== null
        && verification.reason !== "receipt-target-mismatch"
        && !isPositiveSnowflake(verification.messageId)
    ) {
      throw new RangeError(
        "Discord guild blueprint component blocker evidence changed",
      )
    }
    return
  }
  throw new RangeError(
    "Discord guild blueprint component verification status changed",
  )
}

function projectedComponentMessageId(
  verification: ComponentMessageVerificationResult,
): string | null {
  if (verification.messageId === null) return null
  if (!isPositiveSnowflake(verification.messageId)) {
    if (
      verification.status === "blocked"
      && verification.reason === "receipt-target-mismatch"
    ) return null
    throw new RangeError(
      "Discord guild blueprint component message identity changed",
    )
  }
  return verification.messageId
}

function digestStep(step: GuildBlueprintPlanStep) {
  const base = {
    kind: step.kind,
    nestedPlanDigest: step.nestedPlanDigest,
    operationKeyHash: step.operationKeyHash,
    state: step.state,
    writeRequired: step.writeRequired,
  }
  return step.kind === "publication"
    ? {
        ...base,
        channelId: step.channelId,
        index: step.index,
        key: step.key,
        messageId: step.messageId,
        receiptStatus: step.receiptStatus,
        verificationReason: step.verificationReason,
        verificationStatus: step.verificationStatus,
      }
    : base
}

function verificationStep(
  step: GuildBlueprintPlanStep,
): GuildBlueprintVerificationStep {
  const base: GuildBlueprintVerificationStep = {
    kind: step.kind,
    nestedPlanDigest: step.nestedPlanDigest,
    operationKeyHash: step.operationKeyHash,
    state: step.state,
    writeRequired: step.writeRequired,
  }
  return step.kind === "publication"
    ? {
        ...base,
        channelId: step.channelId,
        index: step.index,
        messageId: step.messageId,
        receiptStatus: step.receiptStatus,
        verificationReason: step.verificationReason,
        verificationStatus: step.verificationStatus,
      }
    : base
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
    intent: ComponentMessageContentIntentStatus,
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
    let blocker: GuildBlueprintPublicationBlocker | null = null
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
      if (request.onboarding !== undefined) {
        steps.push(waitingStep(request, "onboarding"))
      }
      appendWaitingPublications(request, steps)
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
          if (request.onboarding !== undefined) {
            steps.push(waitingStep(request, "onboarding"))
          }
          appendWaitingPublications(request, steps)
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
            if (request.onboarding !== undefined) {
              steps.push(waitingStep(request, "onboarding"))
            }
            appendWaitingPublications(request, steps)
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
            if (request.onboarding !== undefined) {
              steps.push(waitingStep(request, "onboarding"))
            }
            appendWaitingPublications(request, steps)
          }
        }
      }

      if (frontier === null) {
        const requestedOnboarding = onboardingRequest(
          request,
          bindingMap(bindings),
        )
        if (requestedOnboarding !== undefined) {
          const onboardingPlan = await this.#domains.onboarding.plan(
            applicationId,
            botId,
            requestedOnboarding,
            options,
          )
          assertNestedIdentity(applicationId, botId, request.guildId, onboardingPlan)
          assertNestedPlanBinding(requestedOnboarding.operationKey, onboardingPlan)
          const onboardingSatisfied = !onboardingPlan.writeRequired
          steps.push({
            kind: "onboarding",
            nestedPlanDigest: onboardingPlan.digest,
            operationKeyHash: onboardingPlan.operationKeyHash,
            state: onboardingSatisfied ? "satisfied" : "ready",
            writeRequired: !onboardingSatisfied,
          })
          if (!onboardingSatisfied) {
            frontier = {
              kind: "onboarding",
              plan: onboardingPlan,
              writeRequired: true,
            }
            frontierRequest = {
              kind: "onboarding",
              request: requestedOnboarding,
            }
            appendWaitingPublications(request, steps)
          }
        }
      }

      if (frontier === null && request.publications !== undefined) {
        const bindingsByKey = bindingMap(bindings)
        for (const [index, publication] of request.publications.entries()) {
          const requestedPublication = publicationRequest(
            request,
            bindingsByKey,
            index,
          )
          const verification = await this.#domains.component.verify(
            applicationId,
            botId,
            intent,
            requestedPublication,
            options,
          )
          assertComponentVerificationBinding(
            request.guildId,
            requestedPublication,
            verification,
          )
          const messageId = projectedComponentMessageId(verification)
          if (verification.status === "verified") {
            steps.push({
              channelId: requestedPublication.channelId,
              index,
              key: publication.key,
              kind: "publication",
              messageId,
              nestedPlanDigest: verification.planDigest,
              operationKeyHash: verification.operationKeyHash,
              receiptStatus: verification.receiptStatus,
              state: "satisfied",
              verificationReason: null,
              verificationStatus: "verified",
              writeRequired: false,
            })
            continue
          }
          if (verification.status === "blocked" || verification.status === "drifted") {
            blocker = {
              channelId: requestedPublication.channelId,
              index,
              messageId,
              operationKeyHash: verification.operationKeyHash,
              receiptStatus: verification.receiptStatus,
              verificationReason: verification.reason as ComponentMessageVerificationReason,
              verificationStatus: verification.status,
            }
            steps.push({
              channelId: requestedPublication.channelId,
              index,
              key: publication.key,
              kind: "publication",
              messageId,
              nestedPlanDigest: verification.planDigest,
              operationKeyHash: verification.operationKeyHash,
              receiptStatus: verification.receiptStatus,
              state: "blocked",
              verificationReason: verification.reason,
              verificationStatus: verification.status,
              writeRequired: false,
            })
            appendWaitingPublications(request, steps, index + 1)
            break
          }
          const publicationPlan = await this.#domains.component.plan(
            applicationId,
            botId,
            intent,
            requestedPublication,
            options,
          )
          assertNestedIdentity(
            applicationId,
            botId,
            request.guildId,
            publicationPlan,
          )
          assertNestedPlanBinding(requestedPublication.operationKey, publicationPlan)
          if (
            publicationPlan.action !== requestedPublication.action
            || publicationPlan.channel.id !== requestedPublication.channelId
          ) {
            throw new RangeError(
              "Discord guild blueprint component plan target changed",
            )
          }
          const publicationSatisfied = !publicationPlan.writeRequired
          steps.push({
            channelId: requestedPublication.channelId,
            index,
            key: publication.key,
            kind: "publication",
            messageId: publicationPlan.target.messageId,
            nestedPlanDigest: publicationPlan.digest,
            operationKeyHash: publicationPlan.operationKeyHash,
            receiptStatus: verification.receiptStatus,
            state: publicationSatisfied ? "satisfied" : "ready",
            verificationReason: verification.reason,
            verificationStatus: verification.status,
            writeRequired: !publicationSatisfied,
          })
          if (!publicationSatisfied) {
            frontier = {
              index,
              key: publication.key,
              kind: "publication",
              plan: publicationPlan,
              writeRequired: true,
            }
            frontierRequest = {
              index,
              kind: "publication",
              request: requestedPublication,
            }
            appendWaitingPublications(request, steps, index + 1)
            break
          }
        }
      }
    }

    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      bindings,
      blocker,
      botId,
      frontier: frontier === null
        ? null
        : {
            kind: frontier.kind,
            nestedPlanDigest: frontier.plan.digest,
            ...(frontier.kind === "publication" ? { index: frontier.index } : {}),
            writeRequired: frontier.writeRequired,
          },
      guildId: request.guildId,
      requestDigest,
      steps: steps.map(digestStep),
      version: "guild-blueprint-plan.v4",
    })
    const plan: GuildBlueprintPlan = {
      applicationId,
      bindings,
      blocker,
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
      status: blocker !== null
        ? "blocked"
        : frontier === null
          ? "already-current"
          : "planned",
      steps,
      warnings: [
        "The exact blueprint manifest and master operation key remain caller-retained and are not persisted by the connector",
        "One execution call can run only this fresh reviewed frontier; plan again before any later phase",
        "A failed, drifting, or uncertain nested operation remains quarantined under its existing domain workflow",
        "Publication recovery uses only exact receipt-bound message reads and never scans channel history",
      ],
    }
    return { frontierRequest, plan }
  }

  async plan(
    applicationId: string,
    botId: string,
    intent: ComponentMessageContentIntentStatus,
    request: GuildBlueprintRequest,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintPlan> {
    return (await this.#build(applicationId, botId, intent, request, options)).plan
  }

  async execute(
    applicationId: string,
    botId: string,
    intent: ComponentMessageContentIntentStatus,
    request: GuildBlueprintRequest,
    planDigest: string,
    executors: GuildBlueprintExecutors,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(planDigest)) {
      throw new RangeError("Discord guild blueprint plan digest is invalid")
    }
    const built = await this.#build(applicationId, botId, intent, request, options)
    if (built.plan.digest !== planDigest) {
      throw new GuildBlueprintPlanChangedError(planDigest, built.plan.digest)
    }
    if (built.plan.blocker !== null) {
      return {
        blocker: built.plan.blocker,
        digest: built.plan.digest,
        executedPhase: null,
        executedPublicationIndex: null,
        guildId: built.plan.guild.id,
        nestedResult: null,
        nextAction: "inspect",
        operationKeyHash: built.plan.operationKeyHash,
        requestDigest: built.plan.requestDigest,
        schemaVersion: SCHEMA_VERSION,
        status: "blocked",
      }
    }
    if (built.plan.frontier === null || built.frontierRequest === null) {
      return {
        blocker: null,
        digest: built.plan.digest,
        executedPhase: null,
        executedPublicationIndex: null,
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
    } else if (built.frontierRequest.kind === "welcome-screen") {
      nestedResult = await executors.executeWelcomeScreen(
        built.frontierRequest.request,
        built.plan.frontier.plan.digest,
        options,
      )
    } else if (built.frontierRequest.kind === "onboarding") {
      nestedResult = await executors.executeOnboarding(
        built.frontierRequest.request,
        built.plan.frontier.plan.digest,
        options,
      )
    } else {
      nestedResult = await executors.executeComponent(
        built.frontierRequest.request,
        built.plan.frontier.plan.digest,
        options,
      )
    }
    return {
      blocker: null,
      digest: built.plan.digest,
      executedPhase: built.frontierRequest.kind,
      executedPublicationIndex: built.frontierRequest.kind === "publication"
        ? built.frontierRequest.index
        : null,
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
    intent: ComponentMessageContentIntentStatus,
    request: GuildBlueprintRequest,
    options: RequestOptions = {},
  ): Promise<GuildBlueprintVerification> {
    const plan = await this.plan(applicationId, botId, intent, request, options)
    return {
      applicationId: plan.applicationId,
      blocker: plan.blocker,
      botId: plan.botId,
      checkedAt: this.#clock().toISOString(),
      digest: plan.digest,
      evidence: {
        activityAndReceipts: "content-free-domain-records",
        callerRetainedManifestRequired: true,
        historicalMutationProvenance: "domain-activity-and-receipts",
        manifestPersisted: false,
        source: "live-domain-plans-and-exact-receipt-readback",
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
      status: plan.status === "blocked"
        ? "blocked"
        : plan.status === "already-current"
          ? "verified"
          : "incomplete",
      steps: plan.steps.map(verificationStep),
    }
  }
}
