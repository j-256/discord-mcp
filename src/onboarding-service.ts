import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  OnboardingActivity,
  OnboardingActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  ONBOARDING_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  DISCORD_ONBOARDING_MODES,
  DISCORD_ONBOARDING_PROMPT_TYPES,
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildEmojiSummary,
  type DiscordGuildOnboarding,
  type DiscordOnboardingEmoji,
  type DiscordOnboardingEmojiInput,
  type ModifyGuildOnboardingInput,
} from "./discord-client.js"
import {
  DiscordApiError,
  OnboardingEvidenceError,
  OnboardingExecutionError,
  OnboardingOperationConflictError,
  OnboardingPlanChangedError,
} from "./errors.js"
import type { GatewayChannelLayoutSource } from "./gateway-channel-layout.js"
import {
  collectGuildChannelEvidence,
  GuildChannelEvidenceError,
  type GuildChannelEvidenceView,
} from "./guild-channel-evidence.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  evaluatePrincipalPermissions,
  hasGuildPermission,
  parseDiscordPermissionBits,
  unknownDiscordPermissionBits,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export const ONBOARDING_MODE_NAMES = ["advanced", "default"] as const
export const ONBOARDING_PROMPT_TYPE_NAMES = ["dropdown", "multiple-choice"] as const

export type OnboardingModeName = typeof ONBOARDING_MODE_NAMES[number]
export type OnboardingPromptTypeName = typeof ONBOARDING_PROMPT_TYPE_NAMES[number]

const STATE_UNAVAILABLE = "onboarding-state-unavailable"
const GUILD_NAME_CHARACTERS = 100
const COMMUNITY_GUILD_FEATURE = "COMMUNITY"
const GUILD_FEATURE_PATTERN = /^[A-Z0-9_]+$/u
const ONBOARDING_TEXT_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const DIRECT_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.directory,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.text,
  DISCORD_CHANNEL_TYPES.voice,
])
const GUILD_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  ...DIRECT_CHANNEL_TYPES,
  DISCORD_CHANNEL_TYPES.category,
])
const MODE_VALUES = Object.freeze({
  advanced: DISCORD_ONBOARDING_MODES.advanced,
  default: DISCORD_ONBOARDING_MODES.default,
} as const)
const PROMPT_TYPE_VALUES = Object.freeze({
  dropdown: DISCORD_ONBOARDING_PROMPT_TYPES.dropdown,
  "multiple-choice": DISCORD_ONBOARDING_PROMPT_TYPES.multipleChoice,
} as const)
const ONBOARDING_REQUEST_KEYS = [
  "auditReason",
  "defaultChannelIds",
  "enabled",
  "guildId",
  "mode",
  "operationKey",
  "prompts",
] as const
const ONBOARDING_PROMPT_REQUEST_KEYS = [
  "inOnboarding",
  "options",
  "promptId",
  "required",
  "singleSelect",
  "title",
  "type",
] as const
const ONBOARDING_OPTION_REQUEST_KEYS = [
  "channelIds",
  "description",
  "emoji",
  "optionId",
  "roleIds",
  "title",
] as const
const ONBOARDING_GUILD_EMOJI_KEYS = ["guildEmojiId", "kind"] as const
const ONBOARDING_UNICODE_EMOJI_KEYS = ["kind", "unicode"] as const
const PROJECTED_ONBOARDING_KEYS = [
  "defaultChannelIds",
  "enabled",
  "guildId",
  "mode",
  "prompts",
  "unknownEnumCount",
  "unknownFieldCount",
] as const
const PROJECTED_ONBOARDING_PROMPT_KEYS = [
  "id",
  "inOnboarding",
  "options",
  "required",
  "singleSelect",
  "title",
  "type",
] as const
const PROJECTED_ONBOARDING_OPTION_KEYS = [
  "channelIds",
  "description",
  "emoji",
  "id",
  "roleIds",
  "title",
] as const
const PROJECTED_ONBOARDING_EMOJI_KEYS = ["animated", "id", "name"] as const
const ONBOARDING_LOCAL_LIMITS = Object.freeze({
  defaultChannels: ONBOARDING_LIMITS.defaultChannels,
  enabledDefaultChannels: ONBOARDING_LIMITS.enabledDefaultChannels,
  enabledSendableDefaultChannels: ONBOARDING_LIMITS.enabledSendableDefaultChannels,
  optionDescriptionCharacters: ONBOARDING_LIMITS.optionDescriptionCharacters,
  optionReferences: ONBOARDING_LIMITS.optionReferences,
  optionsPerPrompt: ONBOARDING_LIMITS.optionsPerPrompt,
  optionTitleCharacters: ONBOARDING_LIMITS.optionTitleCharacters,
  prompts: ONBOARDING_LIMITS.prompts,
  promptTitleCharacters: ONBOARDING_LIMITS.promptTitleCharacters,
})

type OnboardingTargetOutcome = "settled" | "uncertain"
const ONBOARDING_GUILD_LOCKS = new Map<string, Promise<OnboardingTargetOutcome>>()

export type OnboardingEmojiRequest =
  | {
      guildEmojiId: string
      kind: "guild"
    }
  | {
      kind: "unicode"
      unicode: string
    }

export interface OnboardingOptionRequest {
  channelIds: readonly string[]
  description: string | null
  emoji?: OnboardingEmojiRequest | null
  optionId?: string
  roleIds: readonly string[]
  title: string
}

export interface OnboardingPromptRequest {
  inOnboarding: boolean
  options: readonly OnboardingOptionRequest[]
  promptId?: string
  required: boolean
  singleSelect: boolean
  title: string
  type: OnboardingPromptTypeName
}

export interface OnboardingChangeRequest {
  auditReason: string
  defaultChannelIds: readonly string[]
  enabled: boolean
  guildId: string
  mode: OnboardingModeName
  operationKey: string
  prompts: readonly OnboardingPromptRequest[]
}

export interface NormalizedOnboardingOptionRequest {
  channelIds: string[]
  description: string | null
  emoji: OnboardingEmojiRequest | null
  optionId: string | null
  roleIds: string[]
  title: string
}

export interface NormalizedOnboardingPromptRequest {
  inOnboarding: boolean
  options: NormalizedOnboardingOptionRequest[]
  promptId: string | null
  required: boolean
  singleSelect: boolean
  title: string
  type: OnboardingPromptTypeName
}

export interface NormalizedOnboardingChangeRequest {
  auditReason: string
  defaultChannelIds: string[]
  enabled: boolean
  guildId: string
  mode: OnboardingModeName
  operationKey: string
  operationKeyHash: string
  prompts: NormalizedOnboardingPromptRequest[]
}

export interface OnboardingAccessEvidence {
  appliedRoleIds: string[]
  authorizedForChange: boolean
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  highestRoleIds: string[]
  highestRolePosition: number
  manageGuild: boolean
  manageRoles: boolean
  requiredChangePermissions: readonly ["MANAGE_GUILD", "MANAGE_ROLES"]
  unknownPermissionBits: string
}

export interface OnboardingChannelReferenceView {
  direct: boolean
  everyoneCanSend: boolean | null
  everyoneCanView: boolean | null
  exists: boolean
  id: string
  type: number | null
}

export interface OnboardingRoleReferenceView {
  exists: boolean
  id: string
  reasons: string[]
  safeSelfAssignable: boolean
}

export type OnboardingEmojiView =
  | {
      animated: boolean | null
      guildEmojiId: string
      healthy: boolean
      kind: "guild"
      restrictedRoleIds: string[]
      unicode: null
    }
  | {
      animated: false
      guildEmojiId: null
      healthy: boolean
      kind: "unicode"
      restrictedRoleIds: []
      unicode: string | null
    }
  | {
      animated: null
      guildEmojiId: null
      healthy: true
      kind: "none"
      restrictedRoleIds: []
      unicode: null
    }

export interface OnboardingOptionView {
  channelReferences: OnboardingChannelReferenceView[]
  description: string | null
  descriptionCharacters: number | null
  emoji: OnboardingEmojiView
  id: string | null
  roleReferences: OnboardingRoleReferenceView[]
  title: string | null
  titleCharacters: number
}

export interface OnboardingPromptView {
  id: string | null
  inOnboarding: boolean
  options: OnboardingOptionView[]
  required: boolean
  singleSelect: boolean
  title: string | null
  titleCharacters: number
  type: {
    name: OnboardingPromptTypeName | null
    value: number
  }
}

export interface OnboardingEnablementEvidence {
  constraintsMet: boolean
  defaultChannelCount: number
  distinctDefaultChannelCount: number
  requiredDefaultChannelCount: number
  requiredSendableDefaultChannelCount: number
  sendableDefaultChannelCount: number
  visibleDefaultChannelCount: number
}

export interface OnboardingConfigurationView {
  communityGuild: boolean
  defaultChannels: OnboardingChannelReferenceView[]
  enabled: boolean
  enablement: OnboardingEnablementEvidence
  issues: string[]
  mode: {
    name: OnboardingModeName | null
    value: number
  }
  prompts: OnboardingPromptView[]
  replacementBlockedReasons: string[]
  textIncluded: boolean
  unknownEnumCount: number
  unknownFieldCount: number
}

export interface OnboardingPrivacyProjection {
  persistence: "none"
  rawPayloads: "omitted"
  text: "included" | "omitted"
  unknownFields: "counts-only"
}

export interface OnboardingAuditResult {
  access: OnboardingAccessEvidence
  applicationId: string
  botId: string
  channelEvidence: GuildChannelEvidenceView
  configuration: OnboardingConfigurationView
  guild: {
    id: string
    name: string
  }
  localLimits: typeof ONBOARDING_LOCAL_LIMITS
  privacy: OnboardingPrivacyProjection
  schemaVersion: number
  status: "ok"
  verificationBoundary: {
    apiReadback: true
    freshNonStaffClientCheckRecommended: boolean
    memberExperienceVerified: false
  }
}

export interface OnboardingChangeDiff {
  channelAssignmentsAdded: number
  channelAssignmentsRemoved: number
  defaultChannelsAdded: number
  defaultChannelsRemoved: number
  emojiChanges: number
  enabledChanged: boolean
  modeChanged: boolean
  optionsAdded: number
  optionsModified: number
  optionsRemoved: number
  optionsRetained: number
  promptsAdded: number
  promptsModified: number
  promptsRemoved: number
  promptsRetained: number
  roleAssignmentsAdded: number
  roleAssignmentsRemoved: number
  textChanges: number
}

export interface OnboardingChangePlan {
  access: OnboardingAccessEvidence
  applicationId: string
  auditReason: string
  botId: string
  channelEvidence: GuildChannelEvidenceView
  createdAt: string
  current: OnboardingConfigurationView
  desired: OnboardingConfigurationView
  diff: OnboardingChangeDiff
  digest: string
  guild: {
    id: string
    name: string
  }
  localLimits: typeof ONBOARDING_LOCAL_LIMITS
  operationKeyHash: string
  privacy: OnboardingPrivacyProjection
  risks: string[]
  schemaVersion: number
  status: "already-current" | "planned"
  verificationBoundary: OnboardingAuditResult["verificationBoundary"]
  warnings: string[]
  writeRequired: boolean
}

export interface OnboardingChangeResult {
  activityId: string | null
  guildId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
  verification: "drift" | "match" | "not-required"
}

export interface OnboardingServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildOnboarding"
  | "getGuildRoles"
  | "listGuildEmojis"
  | "modifyGuildOnboarding"
> {}

export interface OnboardingServiceOptions {
  activityStore: ActivityStore
  client: OnboardingServiceClient
  clock?: () => Date
  layoutSource: GatewayChannelLayoutSource
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<
    ScopePolicy,
    "assertGuildOnboardingAuditable" | "assertGuildOnboardingChangeable"
  >
  randomId?: () => string
}

interface ValidatedRole {
  id: string
  managed: boolean
  name: string
  permissions: string
  position: number
}

interface ValidatedChannel extends DiscordChannel {
  guild_id: string
  name: string
  permission_overwrites: DiscordPermissionOverwrite[]
}

interface OnboardingState {
  access: OnboardingAccessEvidence
  botMember: DiscordGuildMember
  channelEvidence: GuildChannelEvidenceView
  channels: ValidatedChannel[]
  configuration: OnboardingConfigurationView
  emojis: DiscordGuildEmojiSummary[]
  guild: DiscordGuild & { features: string[]; owner_id: string }
  onboarding: DiscordGuildOnboarding
  roles: ValidatedRole[]
}

interface BuiltOnboardingPlan {
  desired: NormalizedOnboardingChangeRequest
  plan: OnboardingChangePlan
  state: OnboardingState
}

function evidenceError(message: string, options?: ErrorOptions): OnboardingEvidenceError {
  return new OnboardingEvidenceError(message, options)
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, name: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${name} must be a positive Discord snowflake`)
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function validText(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): value is string {
  return typeof value === "string"
    && (allowEmpty || value.length > 0)
    && [...value].length <= maximum
    && (value.length === 0 || value.trim() === value)
    && !ONBOARDING_TEXT_CONTROL_PATTERN.test(value)
    && validUnicode(value)
}

function assertInputText(
  value: unknown,
  maximum: number,
  name: string,
  allowEmpty = false,
): asserts value is string {
  if (!validText(value, maximum, allowEmpty)) {
    throw new RangeError(`${name} is invalid`)
  }
}

function canonicalInputIds(
  value: unknown,
  maximum: number,
  name: string,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RangeError(`${name} is invalid`)
  }
  const ids = value.map((entry) => {
    assertPositiveSnowflake(entry, name)
    return entry
  })
  if (new Set(ids).size !== ids.length) {
    throw new RangeError(`${name} must be unique`)
  }
  return ids.sort(compareSnowflakes)
}

function validUnicodeEmoji(value: string): boolean {
  if (!validText(value, ONBOARDING_LIMITS.optionTitleCharacters)) return false
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)]
  if (segments.length !== 1 || segments[0]?.segment !== value) return false
  return /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u.test(value)
}

function normalizeEmojiRequest(value: unknown): OnboardingEmojiRequest | null {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord onboarding option emoji must be an exact object or null")
  }
  const record = value as Record<string, unknown>
  if (record.kind === "guild") {
    if (!onlyKeys(record, ONBOARDING_GUILD_EMOJI_KEYS)) {
      throw new RangeError("Discord onboarding guild emoji fields are invalid")
    }
    assertPositiveSnowflake(record.guildEmojiId, "Discord onboarding guild emoji ID")
    return { guildEmojiId: record.guildEmojiId, kind: "guild" }
  }
  if (record.kind === "unicode") {
    if (
      !onlyKeys(record, ONBOARDING_UNICODE_EMOJI_KEYS)
      || typeof record.unicode !== "string"
      || !validUnicodeEmoji(record.unicode)
    ) {
      throw new RangeError("Discord onboarding Unicode emoji must be one emoji grapheme")
    }
    return { kind: "unicode", unicode: record.unicode }
  }
  throw new RangeError("Discord onboarding option emoji kind is unsupported")
}

function normalizedTitleKey(value: string): string {
  return value.normalize("NFC")
}

export function assertOnboardingGetInput(
  guildId: string,
  includeText: boolean,
): void {
  assertPositiveSnowflake(guildId, "Discord onboarding guild ID")
  if (typeof includeText !== "boolean") {
    throw new RangeError("Discord onboarding includeText must be a boolean")
  }
}

export function normalizeOnboardingChangeRequest(
  request: OnboardingChangeRequest,
): NormalizedOnboardingChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord onboarding change request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (
    !onlyKeys(record, ONBOARDING_REQUEST_KEYS)
    || typeof request.enabled !== "boolean"
    || !ONBOARDING_MODE_NAMES.includes(request.mode)
    || !Array.isArray(request.prompts)
    || request.prompts.length > ONBOARDING_LIMITS.prompts
  ) {
    throw new RangeError("Discord onboarding change request is invalid")
  }
  assertPositiveSnowflake(request.guildId, "Discord onboarding guild ID")
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord onboarding audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  const defaultChannelIds = canonicalInputIds(
    request.defaultChannelIds,
    ONBOARDING_LIMITS.defaultChannels,
    "Discord onboarding default channel IDs",
  )
  const promptIds = new Set<string>()
  const optionIds = new Set<string>()
  const promptTitles = new Set<string>()
  const prompts = request.prompts.map((promptValue) => {
    if (!promptValue || typeof promptValue !== "object" || Array.isArray(promptValue)) {
      throw new RangeError("Discord onboarding prompt must be an exact object")
    }
    const promptRecord = promptValue as unknown as Record<string, unknown>
    if (
      !onlyKeys(promptRecord, ONBOARDING_PROMPT_REQUEST_KEYS)
      || !(promptValue.promptId === undefined || positiveSnowflake(promptValue.promptId))
      || !ONBOARDING_PROMPT_TYPE_NAMES.includes(promptValue.type)
      || typeof promptValue.singleSelect !== "boolean"
      || typeof promptValue.required !== "boolean"
      || typeof promptValue.inOnboarding !== "boolean"
      || !Array.isArray(promptValue.options)
      || promptValue.options.length > ONBOARDING_LIMITS.optionsPerPrompt
    ) {
      throw new RangeError("Discord onboarding prompt is invalid")
    }
    assertInputText(
      promptValue.title,
      ONBOARDING_LIMITS.promptTitleCharacters,
      "Discord onboarding prompt title",
    )
    const promptTitleKey = normalizedTitleKey(promptValue.title)
    if (promptTitles.has(promptTitleKey)) {
      throw new RangeError("Discord onboarding prompt titles must be unique after normalization")
    }
    promptTitles.add(promptTitleKey)
    if (promptValue.promptId) {
      if (promptIds.has(promptValue.promptId)) {
        throw new RangeError("Discord onboarding prompt IDs must be unique")
      }
      promptIds.add(promptValue.promptId)
    }
    const optionTitles = new Set<string>()
    const options = promptValue.options.map((optionValue: OnboardingOptionRequest) => {
      if (!optionValue || typeof optionValue !== "object" || Array.isArray(optionValue)) {
        throw new RangeError("Discord onboarding option must be an exact object")
      }
      const optionRecord = optionValue as unknown as Record<string, unknown>
      if (
        !onlyKeys(optionRecord, ONBOARDING_OPTION_REQUEST_KEYS)
        || !(optionValue.optionId === undefined || positiveSnowflake(optionValue.optionId))
        || !(optionValue.description === null || typeof optionValue.description === "string")
      ) {
        throw new RangeError("Discord onboarding option is invalid")
      }
      assertInputText(
        optionValue.title,
        ONBOARDING_LIMITS.optionTitleCharacters,
        "Discord onboarding option title",
      )
      if (typeof optionValue.description === "string") {
        assertInputText(
          optionValue.description,
          ONBOARDING_LIMITS.optionDescriptionCharacters,
          "Discord onboarding option description",
          true,
        )
      }
      const optionTitleKey = normalizedTitleKey(optionValue.title)
      if (optionTitles.has(optionTitleKey)) {
        throw new RangeError("Discord onboarding option titles must be unique after normalization")
      }
      optionTitles.add(optionTitleKey)
      if (optionValue.optionId) {
        if (optionIds.has(optionValue.optionId)) {
          throw new RangeError("Discord onboarding option IDs must be globally unique")
        }
        optionIds.add(optionValue.optionId)
      }
      return {
        channelIds: canonicalInputIds(
          optionValue.channelIds,
          ONBOARDING_LIMITS.optionReferences,
          "Discord onboarding option channel IDs",
        ),
        description: optionValue.description,
        emoji: normalizeEmojiRequest(optionValue.emoji),
        optionId: optionValue.optionId ?? null,
        roleIds: canonicalInputIds(
          optionValue.roleIds,
          ONBOARDING_LIMITS.optionReferences,
          "Discord onboarding option role IDs",
        ),
        title: optionValue.title,
      }
    })
    return {
      inOnboarding: promptValue.inOnboarding,
      options,
      promptId: promptValue.promptId ?? null,
      required: promptValue.required,
      singleSelect: promptValue.singleSelect,
      title: promptValue.title,
      type: promptValue.type,
    }
  })
  return {
    auditReason: request.auditReason,
    defaultChannelIds,
    enabled: request.enabled,
    guildId: request.guildId,
    mode: request.mode,
    operationKey: request.operationKey,
    operationKeyHash: operationKeyHash(request.operationKey),
    prompts,
  }
}

function exactGuild(
  value: DiscordGuild,
  guildId: string,
): DiscordGuild & { features: string[]; owner_id: string } {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !validText(value.name, GUILD_NAME_CHARACTERS)
    || !positiveSnowflake(value.owner_id)
    || !Array.isArray(value.features)
    || value.features.length > DISCORD_LIMITS.guildFeatures
    || new Set(value.features).size !== value.features.length
    || value.features.some((feature) => (
      typeof feature !== "string"
      || feature.length < 1
      || feature.length > DISCORD_LIMITS.guildFeatureCharacters
      || !GUILD_FEATURE_PATTERN.test(feature)
    ))
  ) {
    throw evidenceError("Discord returned incomplete or mismatched onboarding guild evidence")
  }
  return value as DiscordGuild & { features: string[]; owner_id: string }
}

function exactBotMember(
  value: DiscordGuildMember,
  guildId: string,
  botId: string,
): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !value.user
    || value.user.id !== botId
    || value.user.bot !== true
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || value.roles.includes(guildId)
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || new Set(value.roles).size !== value.roles.length
  ) {
    throw evidenceError("Discord returned incomplete or mismatched onboarding bot evidence")
  }
  return value
}

function exactRoles(value: readonly DiscordRole[], guildId: string): ValidatedRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded onboarding role inventory")
  }
  const roles: ValidatedRole[] = []
  const ids = new Set<string>()
  for (const role of value) {
    if (
      !role
      || typeof role !== "object"
      || Array.isArray(role)
      || !positiveSnowflake(role.id)
      || !validText(role.name, DISCORD_LIMITS.roleNameCharacters)
      || typeof role.managed !== "boolean"
      || !Number.isInteger(role.position)
      || role.position < 0
      || ids.has(role.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate onboarding role evidence")
    }
    let permissions: bigint
    try {
      permissions = parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid onboarding role permissions", {
        cause: error,
      })
    }
    ids.add(role.id)
    roles.push({
      id: role.id,
      managed: role.managed,
      name: role.name,
      permissions: permissions.toString(),
      position: role.position,
    })
  }
  const everyone = roles.find((role) => role.id === guildId)
  if (
    !everyone
    || everyone.name !== "@everyone"
    || everyone.managed
    || everyone.position !== 0
  ) {
    throw evidenceError("Discord returned invalid onboarding @everyone role evidence")
  }
  return roles.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactOverwrites(
  value: unknown,
  roleIds: ReadonlySet<string>,
): DiscordPermissionOverwrite[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.channelPermissionOverwrites) {
    throw evidenceError("Discord returned incomplete onboarding channel overwrite evidence")
  }
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw evidenceError("Discord returned invalid onboarding channel overwrite evidence")
    }
    const overwrite = entry as DiscordPermissionOverwrite
    if (
      !positiveSnowflake(overwrite.id)
      || (overwrite.type !== 0 && overwrite.type !== 1)
      || (overwrite.type === 0 && !roleIds.has(overwrite.id))
      || seen.has(`${overwrite.type}:${overwrite.id}`)
    ) {
      throw evidenceError("Discord returned contradictory onboarding channel overwrites")
    }
    let allow: bigint
    let deny: bigint
    try {
      allow = parseDiscordPermissionBits(overwrite.allow ?? "0", "onboarding overwrite allow")
      deny = parseDiscordPermissionBits(overwrite.deny ?? "0", "onboarding overwrite deny")
    } catch (error) {
      throw evidenceError("Discord returned invalid onboarding channel overwrite bits", {
        cause: error,
      })
    }
    if ((allow & deny) !== 0n) {
      throw evidenceError("Discord returned overlapping onboarding channel overwrite bits")
    }
    seen.add(`${overwrite.type}:${overwrite.id}`)
    return {
      allow: allow.toString(),
      deny: deny.toString(),
      id: overwrite.id,
      type: overwrite.type,
    }
  })
}

function exactChannels(
  value: readonly DiscordChannel[],
  guildId: string,
  roles: readonly ValidatedRole[],
): ValidatedChannel[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildChannels) {
    throw evidenceError("Discord returned an invalid bounded onboarding channel inventory")
  }
  const roleIds = new Set(roles.map((role) => role.id))
  const ids = new Set<string>()
  const channels = value.map((channel) => {
    if (
      !channel
      || typeof channel !== "object"
      || Array.isArray(channel)
      || !positiveSnowflake(channel.id)
      || channel.guild_id !== guildId
      || !GUILD_CHANNEL_TYPES.has(channel.type)
      || !validText(channel.name, DISCORD_LIMITS.channelNameCharacters)
      || !(channel.parent_id === undefined || channel.parent_id === null
        || positiveSnowflake(channel.parent_id))
      || ids.has(channel.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate onboarding channel evidence")
    }
    ids.add(channel.id)
    return {
      guild_id: guildId,
      id: channel.id,
      name: channel.name,
      parent_id: channel.parent_id ?? null,
      permission_overwrites: exactOverwrites(channel.permission_overwrites, roleIds),
      type: channel.type,
    } satisfies ValidatedChannel
  })
  return channels.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactEmojis(
  value: readonly DiscordGuildEmojiSummary[],
  roles: readonly ValidatedRole[],
): DiscordGuildEmojiSummary[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildEmojis) {
    throw evidenceError("Discord returned an invalid bounded onboarding emoji inventory")
  }
  const roleIds = new Set(roles.map((role) => role.id))
  const ids = new Set<string>()
  const emojis = value.map((emoji) => {
    const rawRoleIds: unknown = emoji?.roleIds
    if (
      !emoji
      || typeof emoji !== "object"
      || Array.isArray(emoji)
      || !positiveSnowflake(emoji.id)
      || !validText(emoji.name, DISCORD_LIMITS.emojiNameCharacters)
      || typeof emoji.animated !== "boolean"
      || typeof emoji.available !== "boolean"
      || typeof emoji.managed !== "boolean"
      || !(emoji.creatorUserId === null || positiveSnowflake(emoji.creatorUserId))
      || typeof emoji.requiresColons !== "boolean"
      || !Array.isArray(rawRoleIds)
      || rawRoleIds.length > DISCORD_LIMITS.guildRoles
      || rawRoleIds.some((roleId: unknown) => !positiveSnowflake(roleId))
      || rawRoleIds.some((roleId: unknown) => !roleIds.has(roleId as string))
      || new Set(rawRoleIds).size !== rawRoleIds.length
      || ids.has(emoji.id)
    ) {
      throw evidenceError("Discord returned invalid or duplicate onboarding emoji evidence")
    }
    const exactRoleIds = rawRoleIds as string[]
    ids.add(emoji.id)
    return {
      animated: emoji.animated,
      available: emoji.available,
      creatorUserId: emoji.creatorUserId,
      id: emoji.id,
      managed: emoji.managed,
      name: emoji.name,
      requiresColons: emoji.requiresColons,
      roleIds: [...exactRoleIds].sort(compareSnowflakes),
    }
  })
  return emojis.sort((left, right) => compareSnowflakes(left.id, right.id))
}

function exactEvidenceIds(
  value: unknown,
  maximum: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw evidenceError("Discord returned invalid onboarding reference evidence")
  }
  return value.map((entry) => {
    if (!positiveSnowflake(entry)) {
      throw evidenceError("Discord returned invalid onboarding reference evidence")
    }
    return entry
  })
}

function exactOnboardingEmoji(value: unknown): DiscordOnboardingEmoji | null {
  if (value === null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned invalid onboarding emoji evidence")
  }
  const emoji = value as Record<string, unknown>
  if (
    !onlyKeys(emoji, PROJECTED_ONBOARDING_EMOJI_KEYS)
    || typeof emoji.animated !== "boolean"
    || !(emoji.id === null || positiveSnowflake(emoji.id))
    || !(emoji.name === null || validText(
      emoji.name,
      ONBOARDING_LIMITS.auditTextCharacters,
    ))
    || (emoji.id === null && emoji.name === null)
  ) {
    throw evidenceError("Discord returned invalid onboarding emoji evidence")
  }
  return {
    animated: emoji.animated,
    id: emoji.id,
    name: emoji.name,
  }
}

function exactOnboarding(
  value: unknown,
  guildId: string,
): DiscordGuildOnboarding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned invalid onboarding state evidence")
  }
  const onboarding = value as Record<string, unknown>
  if (
    !onlyKeys(onboarding, PROJECTED_ONBOARDING_KEYS)
    || onboarding.guildId !== guildId
    || typeof onboarding.enabled !== "boolean"
    || !Number.isSafeInteger(onboarding.mode)
    || !Array.isArray(onboarding.prompts)
    || onboarding.prompts.length > ONBOARDING_LIMITS.auditPrompts
    || !Number.isSafeInteger(onboarding.unknownFieldCount)
    || (onboarding.unknownFieldCount as number) < 0
    || !Number.isSafeInteger(onboarding.unknownEnumCount)
    || (onboarding.unknownEnumCount as number) < 0
  ) {
    throw evidenceError("Discord returned invalid onboarding state evidence")
  }
  let optionCount = 0
  let unknownEnumCount = modeName(onboarding.mode as number) === null ? 1 : 0
  const prompts = onboarding.prompts.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw evidenceError("Discord returned invalid onboarding prompt evidence")
    }
    const prompt = value as Record<string, unknown>
    if (
      !onlyKeys(prompt, PROJECTED_ONBOARDING_PROMPT_KEYS)
      || !positiveSnowflake(prompt.id)
      || !validText(prompt.title, ONBOARDING_LIMITS.auditTextCharacters)
      || !Number.isSafeInteger(prompt.type)
      || typeof prompt.singleSelect !== "boolean"
      || typeof prompt.required !== "boolean"
      || typeof prompt.inOnboarding !== "boolean"
      || !Array.isArray(prompt.options)
      || prompt.options.length > ONBOARDING_LIMITS.auditOptionsPerPrompt
    ) {
      throw evidenceError("Discord returned invalid onboarding prompt evidence")
    }
    if (promptTypeName(prompt.type as number) === null) unknownEnumCount += 1
    optionCount += prompt.options.length
    const options = prompt.options.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw evidenceError("Discord returned invalid onboarding option evidence")
      }
      const option = value as Record<string, unknown>
      if (
        !onlyKeys(option, PROJECTED_ONBOARDING_OPTION_KEYS)
        || !positiveSnowflake(option.id)
        || !validText(option.title, ONBOARDING_LIMITS.auditTextCharacters)
        || !(option.description === null || validText(
          option.description,
          ONBOARDING_LIMITS.auditTextCharacters,
          true,
        ))
      ) {
        throw evidenceError("Discord returned invalid onboarding option evidence")
      }
      return {
        channelIds: exactEvidenceIds(
          option.channelIds,
          ONBOARDING_LIMITS.auditReferencesPerOption,
        ),
        description: option.description,
        emoji: exactOnboardingEmoji(option.emoji),
        id: option.id,
        roleIds: exactEvidenceIds(
          option.roleIds,
          ONBOARDING_LIMITS.auditReferencesPerOption,
        ),
        title: option.title,
      }
    })
    return {
      id: prompt.id,
      inOnboarding: prompt.inOnboarding,
      options,
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type: prompt.type as number,
    }
  })
  if (
    optionCount > ONBOARDING_LIMITS.auditTotalOptions
    || unknownEnumCount !== onboarding.unknownEnumCount
  ) {
    throw evidenceError("Discord returned contradictory onboarding state evidence")
  }
  return {
    defaultChannelIds: exactEvidenceIds(
      onboarding.defaultChannelIds,
      DISCORD_LIMITS.guildChannels,
    ),
    enabled: onboarding.enabled,
    guildId,
    mode: onboarding.mode as number,
    prompts,
    unknownEnumCount,
    unknownFieldCount: onboarding.unknownFieldCount as number,
  }
}

function completePermissions(
  member: DiscordGuildMember,
  guildId: string,
  roles: readonly ValidatedRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError("Discord returned invalid onboarding permission evidence", {
      cause: error,
    })
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete onboarding permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): OnboardingAccessEvidence {
  const manageGuild = hasGuildPermission(permissions, "MANAGE_GUILD")
  const manageRoles = hasGuildPermission(permissions, "MANAGE_ROLES")
  return {
    appliedRoleIds: permissions.appliedRoleIds,
    authorizedForChange: botIsGuildOwner || manageGuild && manageRoles,
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    effectivePermissionNames: permissions.effectivePermissionNames,
    effectivePermissions: permissions.effectivePermissions,
    highestRoleIds: permissions.highestRoleIds,
    highestRolePosition: permissions.highestRolePosition,
    manageGuild,
    manageRoles,
    requiredChangePermissions: ["MANAGE_GUILD", "MANAGE_ROLES"],
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(permissions.effectivePermissions),
    ).toString(),
  }
}

function modeName(value: number): OnboardingModeName | null {
  if (value === DISCORD_ONBOARDING_MODES.default) return "default"
  if (value === DISCORD_ONBOARDING_MODES.advanced) return "advanced"
  return null
}

function promptTypeName(value: number): OnboardingPromptTypeName | null {
  if (value === DISCORD_ONBOARDING_PROMPT_TYPES.multipleChoice) return "multiple-choice"
  if (value === DISCORD_ONBOARDING_PROMPT_TYPES.dropdown) return "dropdown"
  return null
}

function everyoneChannelAccess(
  channel: ValidatedChannel,
  guild: DiscordGuild & { owner_id: string },
  roles: readonly ValidatedRole[],
): { send: boolean; view: boolean } {
  let result: ReturnType<typeof evaluatePrincipalPermissions>
  try {
    result = evaluatePrincipalPermissions({
      channel,
      guildId: guild.id,
      guildOwnerId: guild.owner_id,
      permissionChannel: channel,
      requestedPermissions: ["SEND_MESSAGES", "VIEW_CHANNEL"],
      roles,
      subject: { id: guild.id, kind: "role" },
    })
  } catch (error) {
    throw evidenceError("Discord returned invalid onboarding channel permission evidence", {
      cause: error,
    })
  }
  if (result.confidence !== "complete") {
    throw evidenceError("Discord returned incomplete onboarding channel permission evidence")
  }
  const allowed = (permission: DiscordPermissionName) => (
    !result.missingPermissions.includes(permission)
    && !result.ineffectivePermissions.includes(permission)
  )
  return {
    send: allowed("SEND_MESSAGES"),
    view: allowed("VIEW_CHANNEL"),
  }
}

function channelReferenceView(
  channelId: string,
  channelsById: ReadonlyMap<string, ValidatedChannel>,
  guild: DiscordGuild & { owner_id: string },
  roles: readonly ValidatedRole[],
): OnboardingChannelReferenceView {
  const channel = channelsById.get(channelId)
  if (!channel) {
    return {
      direct: false,
      everyoneCanSend: null,
      everyoneCanView: null,
      exists: false,
      id: channelId,
      type: null,
    }
  }
  const direct = DIRECT_CHANNEL_TYPES.has(channel.type)
  const access = direct ? everyoneChannelAccess(channel, guild, roles) : null
  return {
    direct,
    everyoneCanSend: access?.send ?? null,
    everyoneCanView: access?.view ?? null,
    exists: true,
    id: channel.id,
    type: channel.type,
  }
}

function roleSafetyReasons(
  roleId: string,
  guildId: string,
  botHighestRolePosition: number,
  rolesById: ReadonlyMap<string, ValidatedRole>,
  channels: readonly ValidatedChannel[],
  obfuscatedChannelCount: number,
): string[] {
  const role = rolesById.get(roleId)
  if (!role) return ["missing-role"]
  const reasons = [
    ...(role.id === guildId ? ["everyone-role"] : []),
    ...(role.managed ? ["managed-role"] : []),
    ...(role.position >= botHighestRolePosition ? ["not-below-bot"] : []),
    ...(BigInt(role.permissions) !== 0n ? ["guild-permissions"] : []),
    ...(obfuscatedChannelCount > 0
      ? ["obfuscated-channel-overwrites-unavailable"]
      : []),
  ]
  const overwriteAuthority = channels.some((channel) => (
    channel.permission_overwrites.some((overwrite) => (
      overwrite.type === 0
      && overwrite.id === roleId
      && (overwrite.allow !== "0" || overwrite.deny !== "0")
    ))
  ))
  if (overwriteAuthority) reasons.push("channel-overwrite-bits")
  return reasons.sort()
}

function roleReferenceView(
  roleId: string,
  guildId: string,
  botHighestRolePosition: number,
  rolesById: ReadonlyMap<string, ValidatedRole>,
  channels: readonly ValidatedChannel[],
  obfuscatedChannelCount: number,
): OnboardingRoleReferenceView {
  const reasons = roleSafetyReasons(
    roleId,
    guildId,
    botHighestRolePosition,
    rolesById,
    channels,
    obfuscatedChannelCount,
  )
  return {
    exists: rolesById.has(roleId),
    id: roleId,
    reasons,
    safeSelfAssignable: reasons.length === 0,
  }
}

function remoteEmojiView(
  emoji: DiscordOnboardingEmoji | null,
  emojisById: ReadonlyMap<string, DiscordGuildEmojiSummary>,
  includeText: boolean,
): OnboardingEmojiView {
  if (!emoji) {
    return {
      animated: null,
      guildEmojiId: null,
      healthy: true,
      kind: "none",
      restrictedRoleIds: [],
      unicode: null,
    }
  }
  if (emoji.id) {
    const inventory = emojisById.get(emoji.id)
    return {
      animated: inventory?.animated ?? null,
      guildEmojiId: emoji.id,
      healthy: Boolean(
        inventory
        && inventory.available
        && inventory.name === emoji.name
        && inventory.animated === emoji.animated
      ),
      kind: "guild",
      restrictedRoleIds: inventory?.roleIds ?? [],
      unicode: null,
    }
  }
  const unicode = emoji.name
  return {
    animated: false,
    guildEmojiId: null,
    healthy: emoji.animated === false
      && typeof unicode === "string"
      && validUnicodeEmoji(unicode),
    kind: "unicode",
    restrictedRoleIds: [],
    unicode: includeText ? unicode : null,
  }
}

function desiredEmojiView(
  emoji: OnboardingEmojiRequest | null,
  emojisById: ReadonlyMap<string, DiscordGuildEmojiSummary>,
): OnboardingEmojiView {
  if (!emoji) {
    return {
      animated: null,
      guildEmojiId: null,
      healthy: true,
      kind: "none",
      restrictedRoleIds: [],
      unicode: null,
    }
  }
  if (emoji.kind === "guild") {
    const inventory = emojisById.get(emoji.guildEmojiId)
    return {
      animated: inventory?.animated ?? null,
      guildEmojiId: emoji.guildEmojiId,
      healthy: Boolean(inventory?.available),
      kind: "guild",
      restrictedRoleIds: inventory?.roleIds ?? [],
      unicode: null,
    }
  }
  return {
    animated: false,
    guildEmojiId: null,
    healthy: validUnicodeEmoji(emoji.unicode),
    kind: "unicode",
    restrictedRoleIds: [],
    unicode: emoji.unicode,
  }
}

function enablementEvidence(
  defaultChannels: readonly OnboardingChannelReferenceView[],
): OnboardingEnablementEvidence {
  const distinct = new Map(defaultChannels.map((channel) => [channel.id, channel]))
  const values = [...distinct.values()]
  const visible = values.filter((channel) => channel.everyoneCanView === true).length
  const sendable = values.filter((channel) => (
    channel.everyoneCanView === true && channel.everyoneCanSend === true
  )).length
  return {
    constraintsMet:
      values.length >= ONBOARDING_LIMITS.enabledDefaultChannels
      && sendable >= ONBOARDING_LIMITS.enabledSendableDefaultChannels,
    defaultChannelCount: defaultChannels.length,
    distinctDefaultChannelCount: values.length,
    requiredDefaultChannelCount: ONBOARDING_LIMITS.enabledDefaultChannels,
    requiredSendableDefaultChannelCount:
      ONBOARDING_LIMITS.enabledSendableDefaultChannels,
    sendableDefaultChannelCount: sendable,
    visibleDefaultChannelCount: visible,
  }
}

function privacyProjection(includeText: boolean): OnboardingPrivacyProjection {
  return {
    persistence: "none",
    rawPayloads: "omitted",
    text: includeText ? "included" : "omitted",
    unknownFields: "counts-only",
  }
}

function remoteConfigurationView(
  onboarding: DiscordGuildOnboarding,
  guild: DiscordGuild & { features: string[]; owner_id: string },
  access: OnboardingAccessEvidence,
  roles: readonly ValidatedRole[],
  channels: readonly ValidatedChannel[],
  emojis: readonly DiscordGuildEmojiSummary[],
  includeText: boolean,
  obfuscatedChannelCount: number,
): OnboardingConfigurationView {
  const rolesById = new Map(roles.map((role) => [role.id, role]))
  const channelsById = new Map(channels.map((channel) => [channel.id, channel]))
  const emojisById = new Map(emojis.map((emoji) => [emoji.id, emoji]))
  const issues: string[] = []
  const replacementBlockedReasons: string[] = []
  const promptIds = new Set<string>()
  const optionIds = new Set<string>()
  if (onboarding.unknownFieldCount > 0) {
    issues.push("unknown-fields")
    replacementBlockedReasons.push("unknown-fields")
  }
  if (onboarding.unknownEnumCount > 0) {
    issues.push("unknown-enums")
    replacementBlockedReasons.push("unknown-enums")
  }
  const prompts = onboarding.prompts.map((prompt) => {
    if (promptIds.has(prompt.id)) {
      issues.push(`duplicate-prompt-id:${prompt.id}`)
      replacementBlockedReasons.push("duplicate-prompt-ids")
    }
    promptIds.add(prompt.id)
    if (!validText(prompt.title, ONBOARDING_LIMITS.promptTitleCharacters)) {
      issues.push(`prompt-title-outside-local-limits:${prompt.id}`)
    }
    if (!promptTypeName(prompt.type)) issues.push(`unknown-prompt-type:${prompt.id}`)
    const options = prompt.options.map((option) => {
      if (optionIds.has(option.id)) {
        issues.push(`duplicate-option-id:${option.id}`)
        replacementBlockedReasons.push("duplicate-option-ids")
      }
      optionIds.add(option.id)
      if (!validText(option.title, ONBOARDING_LIMITS.optionTitleCharacters)) {
        issues.push(`option-title-outside-local-limits:${option.id}`)
      }
      if (
        typeof option.description === "string"
        && !validText(
          option.description,
          ONBOARDING_LIMITS.optionDescriptionCharacters,
          true,
        )
      ) {
        issues.push(`option-description-outside-local-limits:${option.id}`)
      }
      if (new Set(option.channelIds).size !== option.channelIds.length) {
        issues.push(`duplicate-option-channel:${option.id}`)
      }
      if (new Set(option.roleIds).size !== option.roleIds.length) {
        issues.push(`duplicate-option-role:${option.id}`)
      }
      const channelReferences = option.channelIds.map((channelId) => channelReferenceView(
        channelId,
        channelsById,
        guild,
        roles,
      ))
      const roleReferences = option.roleIds.map((roleId) => roleReferenceView(
        roleId,
        guild.id,
        access.highestRolePosition,
        rolesById,
        channels,
        obfuscatedChannelCount,
      ))
      const emoji = remoteEmojiView(option.emoji, emojisById, includeText)
      if (channelReferences.some((reference) => (
        !reference.exists || !reference.direct || reference.everyoneCanView !== true
      ))) {
        issues.push(`unsafe-option-channel:${option.id}`)
      }
      if (roleReferences.some((reference) => !reference.safeSelfAssignable)) {
        issues.push(`unsafe-option-role:${option.id}`)
      }
      if (!emoji.healthy) issues.push(`unhealthy-option-emoji:${option.id}`)
      if (emoji.restrictedRoleIds.length > 0) {
        issues.push(`role-restricted-option-emoji:${option.id}`)
      }
      return {
        channelReferences,
        description: includeText ? option.description : null,
        descriptionCharacters: option.description === null
          ? null
          : [...option.description].length,
        emoji,
        id: option.id,
        roleReferences,
        title: includeText ? option.title : null,
        titleCharacters: [...option.title].length,
      }
    })
    return {
      id: prompt.id,
      inOnboarding: prompt.inOnboarding,
      options,
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: includeText ? prompt.title : null,
      titleCharacters: [...prompt.title].length,
      type: {
        name: promptTypeName(prompt.type),
        value: prompt.type,
      },
    }
  })
  if (!modeName(onboarding.mode)) issues.push("unknown-mode")
  const defaultChannels = onboarding.defaultChannelIds.map((channelId) => channelReferenceView(
    channelId,
    channelsById,
    guild,
    roles,
  ))
  if (new Set(onboarding.defaultChannelIds).size !== onboarding.defaultChannelIds.length) {
    issues.push("duplicate-default-channel")
  }
  if (defaultChannels.some((channel) => (
    !channel.exists || !channel.direct || channel.everyoneCanView !== true
  ))) {
    issues.push("unsafe-default-channel")
  }
  const enablement = enablementEvidence(defaultChannels)
  if (onboarding.enabled && !enablement.constraintsMet) {
    issues.push("enabled-constraints-not-proven")
  }
  return {
    communityGuild: guild.features.includes(COMMUNITY_GUILD_FEATURE),
    defaultChannels,
    enabled: onboarding.enabled,
    enablement,
    issues: [...new Set(issues)].sort(),
    mode: {
      name: modeName(onboarding.mode),
      value: onboarding.mode,
    },
    prompts,
    replacementBlockedReasons: [...new Set(replacementBlockedReasons)].sort(),
    textIncluded: includeText,
    unknownEnumCount: onboarding.unknownEnumCount,
    unknownFieldCount: onboarding.unknownFieldCount,
  }
}

function desiredConfigurationView(
  desired: NormalizedOnboardingChangeRequest,
  state: OnboardingState,
): OnboardingConfigurationView {
  const rolesById = new Map(state.roles.map((role) => [role.id, role]))
  const channelsById = new Map(state.channels.map((channel) => [channel.id, channel]))
  const emojisById = new Map(state.emojis.map((emoji) => [emoji.id, emoji]))
  const defaultChannels = desired.defaultChannelIds.map((channelId) => channelReferenceView(
    channelId,
    channelsById,
    state.guild,
    state.roles,
  ))
  return {
    communityGuild: state.guild.features.includes(COMMUNITY_GUILD_FEATURE),
    defaultChannels,
    enabled: desired.enabled,
    enablement: enablementEvidence(defaultChannels),
    issues: [],
    mode: {
      name: desired.mode,
      value: MODE_VALUES[desired.mode],
    },
    prompts: desired.prompts.map((prompt) => ({
      id: prompt.promptId,
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map((option) => ({
        channelReferences: option.channelIds.map((channelId) => channelReferenceView(
          channelId,
          channelsById,
          state.guild,
          state.roles,
        )),
        description: option.description,
        descriptionCharacters: option.description === null
          ? null
          : [...option.description].length,
        emoji: desiredEmojiView(option.emoji, emojisById),
        id: option.optionId,
        roleReferences: option.roleIds.map((roleId) => roleReferenceView(
          roleId,
          state.guild.id,
          state.access.highestRolePosition,
          rolesById,
          state.channels,
          state.channelEvidence.obfuscatedChannelCount,
        )),
        title: option.title,
        titleCharacters: [...option.title].length,
      })),
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      titleCharacters: [...prompt.title].length,
      type: {
        name: prompt.type,
        value: PROMPT_TYPE_VALUES[prompt.type],
      },
    })),
    replacementBlockedReasons: [],
    textIncluded: true,
    unknownEnumCount: 0,
    unknownFieldCount: 0,
  }
}

function assertDesiredStateSafe(
  desired: NormalizedOnboardingChangeRequest,
  state: OnboardingState,
  desiredView: OnboardingConfigurationView,
): void {
  if (!state.access.authorizedForChange) {
    throw evidenceError(
      "Discord connector bot lacks complete onboarding change authority",
    )
  }
  if (state.configuration.replacementBlockedReasons.length > 0) {
    throw evidenceError(
      "Discord onboarding contains unknown or ambiguous state that blocks full replacement",
    )
  }
  if (desired.enabled && !state.guild.features.includes(COMMUNITY_GUILD_FEATURE)) {
    throw evidenceError(
      "Enabled Discord onboarding requires the COMMUNITY guild feature",
    )
  }
  const currentPrompts = new Map(state.onboarding.prompts.map((prompt) => [prompt.id, prompt]))
  const currentOptionOwners = new Map<string, string>()
  for (const prompt of state.onboarding.prompts) {
    for (const option of prompt.options) currentOptionOwners.set(option.id, prompt.id)
  }
  for (const prompt of desired.prompts) {
    if (prompt.promptId !== null && !currentPrompts.has(prompt.promptId)) {
      throw evidenceError("Discord onboarding desired state references an absent prompt ID")
    }
    for (const option of prompt.options) {
      if (option.optionId === null) continue
      const owner = currentOptionOwners.get(option.optionId)
      if (!owner || prompt.promptId === null || owner !== prompt.promptId) {
        throw evidenceError(
          "Discord onboarding desired state references an option outside its fresh prompt",
        )
      }
    }
  }
  const unsafeDefaultChannel = desiredView.defaultChannels.some((channel) => (
    !channel.exists || !channel.direct || channel.everyoneCanView !== true
  ))
  if (unsafeDefaultChannel) {
    throw evidenceError(
      "Discord onboarding default channels must be direct and visible to @everyone",
    )
  }
  for (const prompt of desiredView.prompts) {
    for (const option of prompt.options) {
      if (option.channelReferences.some((channel) => (
        !channel.exists || !channel.direct || channel.everyoneCanView !== true
      ))) {
        throw evidenceError(
          "Discord onboarding option channels must be direct and visible to @everyone",
        )
      }
      if (option.roleReferences.some((role) => !role.safeSelfAssignable)) {
        throw evidenceError(
          "Discord onboarding roles must be zero-authority standard roles below the connector bot",
        )
      }
      if (!option.emoji.healthy) {
        throw evidenceError("Discord onboarding option emoji evidence is unavailable or unsafe")
      }
    }
  }
  if (desired.enabled && !desiredView.enablement.constraintsMet) {
    throw evidenceError(
      "Enabled Discord onboarding requires at least seven default channels and five @everyone-sendable defaults",
    )
  }
}

function sortedIdsEqual(left: readonly string[], right: readonly string[]): boolean {
  return stableString([...left].sort(compareSnowflakes))
    === stableString([...right].sort(compareSnowflakes))
}

function remoteEmojiMatchesDesired(
  observed: DiscordOnboardingEmoji | null,
  desired: OnboardingEmojiRequest | null,
): boolean {
  if (!desired) return observed === null
  if (!observed) return false
  if (desired.kind === "guild") return observed.id === desired.guildEmojiId
  return observed.id === null
    && observed.name === desired.unicode
    && observed.animated === false
}

function observedIdentifiersAreAuthoritative(
  observed: DiscordGuildOnboarding,
): boolean {
  if (observed.unknownFieldCount !== 0 || observed.unknownEnumCount !== 0) return false
  const promptIds = observed.prompts.map((prompt) => prompt.id)
  const optionIds = observed.prompts.flatMap((prompt) => (
    prompt.options.map((option) => option.id)
  ))
  return new Set(promptIds).size === promptIds.length
    && new Set(optionIds).size === optionIds.length
}

function onboardingSemanticallyMatches(
  observed: DiscordGuildOnboarding,
  desired: NormalizedOnboardingChangeRequest,
  before: DiscordGuildOnboarding,
  transportPromptPlaceholderIds: ReadonlySet<string> = new Set(),
): boolean {
  if (
    !observedIdentifiersAreAuthoritative(observed)
    || observed.guildId !== desired.guildId
    || observed.enabled !== desired.enabled
    || observed.mode !== MODE_VALUES[desired.mode]
    || !sortedIdsEqual(observed.defaultChannelIds, desired.defaultChannelIds)
    || observed.prompts.length !== desired.prompts.length
  ) {
    return false
  }
  const beforePromptIds = new Set(before.prompts.map((prompt) => prompt.id))
  const beforeOptionIds = new Set(before.prompts.flatMap((prompt) => (
    prompt.options.map((option) => option.id)
  )))
  for (let promptIndex = 0; promptIndex < desired.prompts.length; promptIndex += 1) {
    const expectedPrompt = desired.prompts[promptIndex]
    const actualPrompt = observed.prompts[promptIndex]
    if (!expectedPrompt || !actualPrompt) return false
    if (expectedPrompt.promptId !== null) {
      if (actualPrompt.id !== expectedPrompt.promptId) return false
    } else if (
      beforePromptIds.has(actualPrompt.id)
      || transportPromptPlaceholderIds.has(actualPrompt.id)
    ) {
      return false
    }
    if (
      actualPrompt.type !== PROMPT_TYPE_VALUES[expectedPrompt.type]
      || actualPrompt.title !== expectedPrompt.title
      || actualPrompt.singleSelect !== expectedPrompt.singleSelect
      || actualPrompt.required !== expectedPrompt.required
      || actualPrompt.inOnboarding !== expectedPrompt.inOnboarding
      || actualPrompt.options.length !== expectedPrompt.options.length
    ) {
      return false
    }
    for (let optionIndex = 0; optionIndex < expectedPrompt.options.length; optionIndex += 1) {
      const expectedOption = expectedPrompt.options[optionIndex]
      const actualOption = actualPrompt.options[optionIndex]
      if (!expectedOption || !actualOption) return false
      if (expectedOption.optionId !== null) {
        if (actualOption.id !== expectedOption.optionId) return false
      } else if (beforeOptionIds.has(actualOption.id)) {
        return false
      }
      if (
        actualOption.title !== expectedOption.title
        || actualOption.description !== expectedOption.description
        || !sortedIdsEqual(actualOption.channelIds, expectedOption.channelIds)
        || !sortedIdsEqual(actualOption.roleIds, expectedOption.roleIds)
        || !remoteEmojiMatchesDesired(actualOption.emoji, expectedOption.emoji)
      ) {
        return false
      }
    }
  }
  return true
}

function promptMetadataSnapshot(prompt: {
  inOnboarding: boolean
  required: boolean
  singleSelect: boolean
  title: string
  type: number
}) {
  return {
    inOnboarding: prompt.inOnboarding,
    required: prompt.required,
    singleSelect: prompt.singleSelect,
    title: prompt.title,
    type: prompt.type,
  }
}

function optionSnapshot(option: {
  channelIds: readonly string[]
  description: string | null
  emoji: DiscordOnboardingEmoji | null
  roleIds: readonly string[]
  title: string
}) {
  return {
    channelIds: [...option.channelIds].sort(compareSnowflakes),
    description: option.description,
    emoji: option.emoji === null
      ? null
      : option.emoji.id
        ? { id: option.emoji.id }
        : { animated: option.emoji.animated, name: option.emoji.name },
    roleIds: [...option.roleIds].sort(compareSnowflakes),
    title: option.title,
  }
}

function desiredOptionSnapshot(option: NormalizedOnboardingOptionRequest) {
  return {
    channelIds: option.channelIds,
    description: option.description,
    emoji: option.emoji === null
      ? null
      : option.emoji.kind === "guild"
        ? { id: option.emoji.guildEmojiId }
        : { animated: false, name: option.emoji.unicode },
    roleIds: option.roleIds,
    title: option.title,
  }
}

function optionTextFieldCount(option: {
  description: string | null
  title: string
}): number {
  return 1 + (option.description === null ? 0 : 1)
}

function setDifferenceCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0
  for (const value of left) if (!right.has(value)) count += 1
  return count
}

function changeDiff(
  current: DiscordGuildOnboarding,
  desired: NormalizedOnboardingChangeRequest,
): OnboardingChangeDiff {
  const currentPrompts = new Map(current.prompts.map((prompt) => [prompt.id, prompt]))
  const desiredPromptIds = new Set(
    desired.prompts.flatMap((prompt) => prompt.promptId ? [prompt.promptId] : []),
  )
  let promptsAdded = 0
  let promptsModified = 0
  let promptsRetained = 0
  let optionsAdded = 0
  let optionsModified = 0
  let optionsRemoved = 0
  let optionsRetained = 0
  let textChanges = 0
  let emojiChanges = 0
  const currentRoles = new Set<string>()
  const desiredRoles = new Set<string>()
  const currentChannels = new Set<string>()
  const desiredChannels = new Set<string>()
  for (const prompt of current.prompts) {
    for (const option of prompt.options) {
      for (const roleId of option.roleIds) currentRoles.add(`${option.id}:${roleId}`)
      for (const channelId of option.channelIds) {
        currentChannels.add(`${option.id}:${channelId}`)
      }
    }
  }
  for (let promptIndex = 0; promptIndex < desired.prompts.length; promptIndex += 1) {
    const desiredPrompt = desired.prompts[promptIndex] as NormalizedOnboardingPromptRequest
    const currentPrompt = desiredPrompt.promptId
      ? currentPrompts.get(desiredPrompt.promptId)
      : undefined
    if (!currentPrompt) {
      promptsAdded += 1
      optionsAdded += desiredPrompt.options.length
      textChanges += 1
      for (let optionIndex = 0; optionIndex < desiredPrompt.options.length; optionIndex += 1) {
        const option = desiredPrompt.options[optionIndex] as NormalizedOnboardingOptionRequest
        const key = `new:${promptIndex}:${optionIndex}`
        textChanges += optionTextFieldCount(option)
        if (option.emoji !== null) emojiChanges += 1
        for (const roleId of option.roleIds) desiredRoles.add(`${key}:${roleId}`)
        for (const channelId of option.channelIds) desiredChannels.add(`${key}:${channelId}`)
      }
      continue
    }
    const desiredPromptMetadata = {
      inOnboarding: desiredPrompt.inOnboarding,
      required: desiredPrompt.required,
      singleSelect: desiredPrompt.singleSelect,
      title: desiredPrompt.title,
      type: PROMPT_TYPE_VALUES[desiredPrompt.type],
    }
    if (stableString(promptMetadataSnapshot(currentPrompt)) === stableString(desiredPromptMetadata)) {
      promptsRetained += 1
    } else {
      promptsModified += 1
      if (currentPrompt.title !== desiredPrompt.title) textChanges += 1
    }
    const currentOptions = new Map(currentPrompt.options.map((option) => [option.id, option]))
    const desiredOptionIds = new Set(
      desiredPrompt.options.flatMap((option) => option.optionId ? [option.optionId] : []),
    )
    const removedOptions = currentPrompt.options.filter((option) => (
      !desiredOptionIds.has(option.id)
    ))
    optionsRemoved += removedOptions.length
    for (const option of removedOptions) {
      textChanges += optionTextFieldCount(option)
      if (option.emoji !== null) emojiChanges += 1
    }
    for (let optionIndex = 0; optionIndex < desiredPrompt.options.length; optionIndex += 1) {
      const desiredOption = desiredPrompt.options[optionIndex] as NormalizedOnboardingOptionRequest
      const currentOption = desiredOption.optionId
        ? currentOptions.get(desiredOption.optionId)
        : undefined
      const key = desiredOption.optionId ?? `new:${promptIndex}:${optionIndex}`
      for (const roleId of desiredOption.roleIds) desiredRoles.add(`${key}:${roleId}`)
      for (const channelId of desiredOption.channelIds) desiredChannels.add(`${key}:${channelId}`)
      if (!currentOption) {
        optionsAdded += 1
        textChanges += optionTextFieldCount(desiredOption)
        if (desiredOption.emoji !== null) emojiChanges += 1
        continue
      }
      if (stableString(optionSnapshot(currentOption)) === stableString(
        desiredOptionSnapshot(desiredOption),
      )) {
        optionsRetained += 1
      } else {
        optionsModified += 1
        if (currentOption.title !== desiredOption.title) textChanges += 1
        if (currentOption.description !== desiredOption.description) textChanges += 1
        if (!remoteEmojiMatchesDesired(currentOption.emoji, desiredOption.emoji)) {
          emojiChanges += 1
        }
      }
    }
  }
  const removedPrompts = current.prompts.filter((prompt) => !desiredPromptIds.has(prompt.id))
  optionsRemoved += removedPrompts.reduce((total, prompt) => total + prompt.options.length, 0)
  for (const prompt of removedPrompts) {
    textChanges += 1
    for (const option of prompt.options) {
      textChanges += optionTextFieldCount(option)
      if (option.emoji !== null) emojiChanges += 1
    }
  }
  const currentDefaults = new Set(current.defaultChannelIds)
  const desiredDefaults = new Set(desired.defaultChannelIds)
  return {
    channelAssignmentsAdded: setDifferenceCount(desiredChannels, currentChannels),
    channelAssignmentsRemoved: setDifferenceCount(currentChannels, desiredChannels),
    defaultChannelsAdded: setDifferenceCount(desiredDefaults, currentDefaults),
    defaultChannelsRemoved: setDifferenceCount(currentDefaults, desiredDefaults),
    emojiChanges,
    enabledChanged: current.enabled !== desired.enabled,
    modeChanged: current.mode !== MODE_VALUES[desired.mode],
    optionsAdded,
    optionsModified,
    optionsRemoved,
    optionsRetained,
    promptsAdded,
    promptsModified,
    promptsRemoved: removedPrompts.length,
    promptsRetained,
    roleAssignmentsAdded: setDifferenceCount(desiredRoles, currentRoles),
    roleAssignmentsRemoved: setDifferenceCount(currentRoles, desiredRoles),
    textChanges,
  }
}

function planRisks(
  diff: OnboardingChangeDiff,
  desiredEnabled: boolean,
  desiredView: OnboardingConfigurationView,
): string[] {
  const roleRestrictedEmoji = desiredView.prompts.some((prompt) => (
    prompt.options.some((option) => option.emoji.restrictedRoleIds.length > 0)
  ))
  return [
    "full-replacement",
    ...(diff.enabledChanged ? ["enablement-change"] : []),
    ...(diff.modeChanged ? ["mode-change"] : []),
    ...(diff.promptsRemoved > 0 ? ["prompt-deletion"] : []),
    ...(diff.optionsRemoved > 0 ? ["option-deletion"] : []),
    ...(diff.defaultChannelsRemoved > 0 ? ["default-channel-removal"] : []),
    ...(diff.roleAssignmentsAdded + diff.roleAssignmentsRemoved > 0
      ? ["role-assignment-change"]
      : []),
    ...(diff.channelAssignmentsAdded + diff.channelAssignmentsRemoved > 0
      ? ["channel-assignment-change"]
      : []),
    ...(diff.textChanges > 0 ? ["member-facing-text-change"] : []),
    ...(diff.emojiChanges > 0 ? ["emoji-change"] : []),
    ...(roleRestrictedEmoji ? ["guild-emoji-role-restriction"] : []),
    ...(desiredEnabled ? ["fresh-member-client-check-required"] : []),
  ].sort()
}

function planWarnings(
  access: OnboardingAccessEvidence,
  channelEvidence: GuildChannelEvidenceView,
): string[] {
  return [
    ...(access.botAdministrator
      ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped onboarding permissions"]
      : []),
    ...(channelEvidence.obfuscatedChannelCount > 0
      ? ["Channel metadata is visibility-bounded; role-bearing onboarding options are blocked because hidden overwrite authority cannot be evaluated"]
      : []),
    "The operation performs one complete onboarding replacement and omits no hidden state",
    "Unknown response fields or enums block replacement to prevent silent future-field loss",
    "Enabled onboarding uses the conservative seven-default and five-sendable proof in every mode",
    "The operation key is one-shot after reservation and cannot be retried after uncertainty",
    "The Discord mutation is attempted once without automatic rate-limit retry or rollback",
    "Same-guild serialization is process-local; avoid overlapping onboarding writers in other processes",
    "API readback does not verify the client join flow; test enabled onboarding with a fresh non-staff member",
    "Prompt, option, guild, role, channel, emoji, and audit-reason text never enters persistent operation records",
  ]
}

function transportInput(
  desired: NormalizedOnboardingChangeRequest,
  state: OnboardingState,
): ModifyGuildOnboardingInput {
  const usedIds = new Set<string>([
    state.guild.id,
    ...state.roles.map((role) => role.id),
    ...state.channels.map((channel) => channel.id),
    ...state.emojis.map((emoji) => emoji.id),
    ...state.onboarding.prompts.flatMap((prompt) => [
      prompt.id,
      ...prompt.options.map((option) => option.id),
    ]),
  ])
  let placeholder = DISCORD_SNOWFLAKE_MAX
  const nextPlaceholder = (): string => {
    while (usedIds.has(placeholder.toString())) placeholder -= 1n
    if (placeholder < 1n) {
      throw evidenceError("Discord onboarding prompt placeholder space is exhausted")
    }
    const id = placeholder.toString()
    usedIds.add(id)
    placeholder -= 1n
    return id
  }
  const emojisById = new Map(state.emojis.map((emoji) => [emoji.id, emoji]))
  return {
    defaultChannelIds: desired.defaultChannelIds,
    enabled: desired.enabled,
    mode: MODE_VALUES[desired.mode],
    prompts: desired.prompts.map((prompt) => ({
      id: prompt.promptId ?? nextPlaceholder(),
      inOnboarding: prompt.inOnboarding,
      options: prompt.options.map((option) => {
        let emoji: DiscordOnboardingEmojiInput | null = null
        if (option.emoji?.kind === "unicode") {
          emoji = { animated: false, id: null, name: option.emoji.unicode }
        } else if (option.emoji?.kind === "guild") {
          const inventoryEmoji = emojisById.get(option.emoji.guildEmojiId)
          if (!inventoryEmoji) {
            throw evidenceError("Discord onboarding option emoji evidence is unavailable")
          }
          emoji = {
            animated: inventoryEmoji.animated,
            id: option.emoji.guildEmojiId,
            name: inventoryEmoji.name,
          }
        }
        return {
          channelIds: option.channelIds,
          description: option.description,
          emoji,
          ...(option.optionId !== null ? { id: option.optionId } : {}),
          roleIds: option.roleIds,
          title: option.title,
        }
      }),
      required: prompt.required,
      singleSelect: prompt.singleSelect,
      title: prompt.title,
      type: PROMPT_TYPE_VALUES[prompt.type],
    })),
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "UnknownError"
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: OnboardingChangePlan
  request: NormalizedOnboardingChangeRequest
  status: OnboardingActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): OnboardingActivity {
  return {
    enabled: options.request.enabled,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "onboarding-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: OnboardingChangePlan
  request: NormalizedOnboardingChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "onboarding-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.guildId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof OnboardingExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withGuildLock<T>(
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => OnboardingExecutionError,
): Promise<T> {
  const prior = ONBOARDING_GUILD_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: OnboardingTargetOutcome) => void = () => undefined
  const tail = new Promise<OnboardingTargetOutcome>((resolve) => {
    release = resolve
  })
  ONBOARDING_GUILD_LOCKS.set(guildId, tail)
  let outcome: OnboardingTargetOutcome = "settled"
  try {
    if (await prior === "uncertain") {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (uncertainExecution(error)) outcome = "uncertain"
    throw error
  } finally {
    release(outcome)
    if (outcome === "settled" && ONBOARDING_GUILD_LOCKS.get(guildId) === tail) {
      ONBOARDING_GUILD_LOCKS.delete(guildId)
    }
  }
}

export class OnboardingService {
  readonly #activityStore: ActivityStore
  readonly #client: OnboardingServiceClient
  readonly #clock: () => Date
  readonly #layoutSource: GatewayChannelLayoutSource
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: OnboardingServiceOptions["policy"]
  readonly #randomId: () => string

  constructor(options: OnboardingServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#layoutSource = options.layoutSource
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    applicationId: string,
    botId: string,
    guildId: string,
    mode: "audit" | "change",
    includeText: boolean,
    options: RequestOptions,
    operationKeyHashValue?: string,
  ): Promise<OnboardingState> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord onboarding guild ID")
    if (mode === "change") {
      this.#policy.assertGuildOnboardingChangeable(guildId)
    } else {
      this.#policy.assertGuildOnboardingAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "onboarding-change",
        operationKeyHashValue,
      )
      if (receipt) throw new OnboardingOperationConflictError(receiptView(receipt))
    }
    let supportingEvidence: {
      botMember: DiscordGuildMember
      emojis: DiscordGuildEmojiSummary[]
      guild: DiscordGuild
      onboarding: DiscordGuildOnboarding
      roles: DiscordRole[]
    } | undefined
    let channelEvidence
    try {
      channelEvidence = await collectGuildChannelEvidence({
        guildId,
        layoutSource: this.#layoutSource,
        readChannels: async () => {
          const [guild, botMember, roles, channels, emojis, onboarding] =
            await Promise.all([
              this.#client.getGuild(guildId, options),
              this.#client.getGuildMember(guildId, botId, options),
              this.#client.getGuildRoles(guildId, options),
              this.#client.getGuildChannels(guildId, options),
              this.#client.listGuildEmojis(guildId, options),
              this.#client.getGuildOnboarding(guildId, options),
            ])
          supportingEvidence = { botMember, emojis, guild, onboarding, roles }
          return channels
        },
      })
    } catch (error) {
      if (error instanceof GuildChannelEvidenceError) {
        throw evidenceError(
          `Discord onboarding channel evidence is incomplete: ${error.message}`,
          { cause: error },
        )
      }
      throw error
    }
    if (!supportingEvidence) {
      throw evidenceError("Discord onboarding supporting evidence is unavailable")
    }
    const {
      botMember: rawBotMember,
      emojis: rawEmojis,
      guild: rawGuild,
      onboarding: rawOnboarding,
      roles: rawRoles,
    } = supportingEvidence
    const rawChannels = channelEvidence.channels
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawBotMember, guildId, botId)
    const roles = exactRoles(rawRoles, guildId)
    const channels = exactChannels(rawChannels, guildId, roles)
    const emojis = exactEmojis(rawEmojis, roles)
    const onboarding = exactOnboarding(rawOnboarding, guildId)
    const permissions = completePermissions(botMember, guildId, roles)
    const access = accessEvidence(permissions, guild.owner_id === botId)
    const configuration = remoteConfigurationView(
      onboarding,
      guild,
      access,
      roles,
      channels,
      emojis,
      includeText,
      channelEvidence.view.obfuscatedChannelCount,
    )
    if (mode === "change" && !access.authorizedForChange) {
      throw evidenceError(
        "Discord connector bot requires guild ownership or complete MANAGE_GUILD and MANAGE_ROLES authority",
      )
    }
    return {
      access,
      botMember,
      channelEvidence: channelEvidence.view,
      channels,
      configuration,
      emojis,
      guild,
      onboarding,
      roles,
    }
  }

  async get(
    applicationId: string,
    botId: string,
    guildId: string,
    includeText = false,
    options: RequestOptions = {},
  ): Promise<OnboardingAuditResult> {
    assertOnboardingGetInput(guildId, includeText)
    const state = await this.#state(
      applicationId,
      botId,
      guildId,
      "audit",
      includeText,
      options,
    )
    return {
      access: state.access,
      applicationId,
      botId,
      channelEvidence: state.channelEvidence,
      configuration: state.configuration,
      guild: { id: state.guild.id, name: state.guild.name },
      localLimits: ONBOARDING_LOCAL_LIMITS,
      privacy: privacyProjection(includeText),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      verificationBoundary: {
        apiReadback: true,
        freshNonStaffClientCheckRecommended: state.onboarding.enabled,
        memberExperienceVerified: false,
      },
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    desired: NormalizedOnboardingChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltOnboardingPlan> {
    const state = await this.#state(
      applicationId,
      botId,
      desired.guildId,
      "change",
      true,
      options,
      desired.operationKeyHash,
    )
    const desiredView = desiredConfigurationView(desired, state)
    assertDesiredStateSafe(desired, state, desiredView)
    const writeRequired = !onboardingSemanticallyMatches(
      state.onboarding,
      desired,
      state.onboarding,
    )
    const diff = changeDiff(state.onboarding, desired)
    const warnings = writeRequired
      ? planWarnings(state.access, state.channelEvidence)
      : ["The complete desired onboarding state already matches Discord"]
    const risks = writeRequired
      ? planRisks(diff, desired.enabled, desiredView)
      : []
    const privacy = privacyProjection(true)
    const verificationBoundary = {
      apiReadback: true as const,
      freshNonStaffClientCheckRecommended: desired.enabled,
      memberExperienceVerified: false as const,
    }
    const evidence = {
      access: state.access,
      botMemberRoleIds: [...state.botMember.roles].sort(compareSnowflakes),
      channelEvidence: state.channelEvidence,
      channels: state.channels.map((channel) => ({
        id: channel.id,
        parentId: channel.parent_id ?? null,
        permissionOverwrites: channel.permission_overwrites,
        type: channel.type,
      })),
      emojis: state.emojis.map((emoji) => ({
        animated: emoji.animated,
        available: emoji.available,
        id: emoji.id,
        managed: emoji.managed,
        name: emoji.name,
        requiresColons: emoji.requiresColons,
        roleIds: emoji.roleIds,
      })),
      guild: {
        features: [...state.guild.features].sort(),
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      onboarding: state.onboarding,
      roles: state.roles.map((role) => ({
        id: role.id,
        managed: role.managed,
        permissions: role.permissions,
        position: role.position,
      })),
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      desired: {
        auditReason: desired.auditReason,
        defaultChannelIds: desired.defaultChannelIds,
        enabled: desired.enabled,
        guildId: desired.guildId,
        mode: desired.mode,
        operationKeyHash: desired.operationKeyHash,
        prompts: desired.prompts,
      },
      domain: "discord-mcp-onboarding-change-plan.v1",
      evidence,
      localLimits: ONBOARDING_LOCAL_LIMITS,
      privacy,
      risks,
      verificationBoundary,
      warnings,
    })
    const plan: OnboardingChangePlan = {
      access: state.access,
      applicationId,
      auditReason: desired.auditReason,
      botId,
      channelEvidence: state.channelEvidence,
      createdAt: this.#clock().toISOString(),
      current: state.configuration,
      desired: desiredView,
      diff,
      digest,
      guild: { id: state.guild.id, name: state.guild.name },
      localLimits: ONBOARDING_LOCAL_LIMITS,
      operationKeyHash: desired.operationKeyHash,
      privacy,
      risks,
      schemaVersion: SCHEMA_VERSION,
      status: writeRequired ? "planned" : "already-current",
      verificationBoundary,
      warnings,
      writeRequired,
    }
    return { desired, plan, state }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: OnboardingChangeRequest,
    options: RequestOptions = {},
  ): Promise<OnboardingChangePlan> {
    const desired = normalizeOnboardingChangeRequest(request)
    return (await this.#buildPlan(applicationId, botId, desired, options)).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: OnboardingChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<OnboardingChangeResult> {
    const desired = normalizeOnboardingChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord onboarding plan digest is invalid")
    }
    return withGuildLock(
      desired.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        desired,
        expectedDigest,
        options,
      ),
      () => new OnboardingExecutionError(
        "Discord onboarding change was blocked because a prior same-guild operation ended with an uncertain outcome",
        {
          guildId: desired.guildId,
          operationKeyHash: desired.operationKeyHash,
          planDigest: expectedDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    desired: NormalizedOnboardingChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<OnboardingChangeResult> {
    let built: BuiltOnboardingPlan
    try {
      built = await this.#buildPlan(applicationId, botId, desired, options)
    } catch (error) {
      if (
        error instanceof OnboardingEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new OnboardingPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new OnboardingPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      guildId: desired.guildId,
      operationKeyHash: desired.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (!plan.writeRequired) {
      return {
        ...baseResult,
        activityId: null,
        status: "already-current",
        verification: "not-required",
      }
    }
    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request: desired,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new OnboardingOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: desired,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          plan,
          request: desired,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new OnboardingExecutionError(
        "Discord onboarding change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
      )
    }

    let mutationStarted = false
    let mutationReturned = false
    let responseMatches = false
    let readbackMatches = false
    try {
      const input = transportInput(desired, state)
      const transportPromptPlaceholderIds = new Set(
        input.prompts.flatMap((prompt, index) => (
          desired.prompts[index]?.promptId === null ? [prompt.id] : []
        )),
      )
      mutationStarted = true
      const rawResponse = await this.#client.modifyGuildOnboarding(
        desired.guildId,
        input,
        desired.auditReason,
        options,
      )
      mutationReturned = true
      const response = exactOnboarding(rawResponse, desired.guildId)
      if (!observedIdentifiersAreAuthoritative(response)) {
        throw evidenceError("Discord returned ambiguous onboarding mutation evidence")
      }
      responseMatches = onboardingSemanticallyMatches(
        response,
        desired,
        state.onboarding,
        transportPromptPlaceholderIds,
      )
      const readback = await this.#state(
        applicationId,
        botId,
        desired.guildId,
        "audit",
        true,
        options,
      )
      if (!observedIdentifiersAreAuthoritative(readback.onboarding)) {
        throw evidenceError("Discord returned ambiguous onboarding readback evidence")
      }
      assertDesiredStateSafe(
        desired,
        readback,
        desiredConfigurationView(desired, readback),
      )
      readbackMatches = onboardingSemanticallyMatches(
        readback.onboarding,
        desired,
        state.onboarding,
        transportPromptPlaceholderIds,
      )
    } catch (error) {
      const definiteMutationRefusal = mutationStarted
        && !mutationReturned
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
      const status = mutationStarted && !definiteMutationRefusal
        ? "uncertain"
        : "failed"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request: desired,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: errorCode,
          plan,
          request: desired,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new OnboardingExecutionError(
        "Discord onboarding change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          responseMatches,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    const verification = responseMatches && readbackMatches ? "match" : "drift"
    const status = verification === "match" ? "completed" : "completed-with-drift"
    const result: OnboardingChangeResult = {
      ...baseResult,
      activityId,
      status,
      verification,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request: desired,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: safeErrorCode(error),
          plan,
          request: desired,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new OnboardingExecutionError(
        "Discord onboarding change completed but the operation receipt failed",
        {
          ...result,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
        },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request: desired,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new OnboardingExecutionError(
        "Discord onboarding change completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
      )
    }
    return result
  }
}
