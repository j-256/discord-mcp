import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  AutoModerationActivity,
  AutoModerationActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  DISCORD_AUTO_MODERATION_ACTION_TYPES,
  DISCORD_AUTO_MODERATION_EVENT_TYPES,
  DISCORD_AUTO_MODERATION_KEYWORD_PRESETS,
  DISCORD_AUTO_MODERATION_TRIGGER_TYPES,
  encodeDiscordAuditReason,
  type CreateGuildAutoModerationRuleInput,
  type DiscordAutoModerationAction,
  type DiscordAutoModerationRuleSummary,
  type DiscordAutoModerationTrigger,
  type DiscordClient,
  type ModifyGuildAutoModerationRuleInput,
} from "./discord-client.js"
import {
  AutoModerationEvidenceError,
  AutoModerationExecutionError,
  AutoModerationOperationConflictError,
  AutoModerationPlanChangedError,
  DiscordApiError,
  errorMessage,
} from "./errors.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  DISCORD_PERMISSIONS,
  evaluateBotChannelPermissions,
  evaluateGuildMemberPermissions,
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
  DiscordRole,
  RequestOptions,
} from "./types.js"

export const AUTOMOD_TRIGGER_TYPES = [
  "keyword",
  "keyword-preset",
  "member-profile",
  "mention-spam",
  "spam",
] as const

export const AUTOMOD_ACTION_TYPES = [
  "block-member-interaction",
  "block-message",
  "send-alert-message",
  "timeout",
] as const

export const AUTOMOD_KEYWORD_PRESETS = [
  "profanity",
  "sexual-content",
  "slurs",
] as const

export const AUTOMOD_OMITTED_FIELDS = Object.freeze([
  "actionExecutionContent",
  "matchedContent",
  "matchedKeyword",
  "rawDiscordObject",
] as const)

export type AutoModerationChangeAction =
  | "create"
  | "delete"
  | "set-enabled"
  | "update"
export type AutoModerationTriggerType = typeof AUTOMOD_TRIGGER_TYPES[number]
export type AutoModerationActionType = typeof AUTOMOD_ACTION_TYPES[number]
export type AutoModerationKeywordPreset = typeof AUTOMOD_KEYWORD_PRESETS[number]
export type AutoModerationEventType = "member-update" | "message-send"

export type AutoModerationTriggerRequest =
  | {
      allowList?: readonly string[]
      keywordFilter?: readonly string[]
      regexPatterns?: readonly string[]
      type: "keyword" | "member-profile"
    }
  | {
      allowList?: readonly string[]
      presets: readonly AutoModerationKeywordPreset[]
      type: "keyword-preset"
    }
  | {
      mentionRaidProtectionEnabled?: boolean
      mentionTotalLimit: number
      type: "mention-spam"
    }
  | {
      type: "spam"
    }

export type AutoModerationActionRequest =
  | {
      customMessage?: string
      type: "block-message"
    }
  | {
      channelId: string
      type: "send-alert-message"
    }
  | {
      durationSeconds: number
      type: "timeout"
    }
  | {
      type: "block-member-interaction"
    }

interface AutoModerationRequestBase {
  action: AutoModerationChangeAction
  auditReason: string
  guildId: string
  operationKey: string
}

export interface CreateAutoModerationRuleRequest extends AutoModerationRequestBase {
  action: "create"
  actions: readonly AutoModerationActionRequest[]
  exemptChannelIds?: readonly string[]
  exemptRoleIds?: readonly string[]
  name: string
  trigger: AutoModerationTriggerRequest
}

export interface UpdateAutoModerationRuleRequest extends AutoModerationRequestBase {
  action: "update"
  actions?: readonly AutoModerationActionRequest[]
  exemptChannelIds?: readonly string[]
  exemptRoleIds?: readonly string[]
  name?: string
  ruleId: string
  trigger?: AutoModerationTriggerRequest
}

export interface SetAutoModerationRuleEnabledRequest extends AutoModerationRequestBase {
  action: "set-enabled"
  enabled: boolean
  ruleId: string
}

export interface DeleteAutoModerationRuleRequest extends AutoModerationRequestBase {
  action: "delete"
  ruleId: string
}

export type AutoModerationChangeRequest =
  | CreateAutoModerationRuleRequest
  | DeleteAutoModerationRuleRequest
  | SetAutoModerationRuleEnabledRequest
  | UpdateAutoModerationRuleRequest

export type NormalizedAutoModerationTrigger =
  | {
      allowList: string[]
      keywordFilter: string[]
      regexPatterns: string[]
      type: "keyword"
    }
  | {
      allowList: string[]
      keywordFilter: string[]
      regexPatterns: string[]
      type: "member-profile"
    }
  | {
      allowList: string[]
      presets: AutoModerationKeywordPreset[]
      type: "keyword-preset"
    }
  | {
      mentionRaidProtectionEnabled: boolean
      mentionTotalLimit: number
      type: "mention-spam"
    }
  | {
      type: "spam"
    }

export type NormalizedAutoModerationAction =
  | {
      customMessage: string | null
      type: "block-message"
    }
  | {
      channelId: string
      type: "send-alert-message"
    }
  | {
      durationSeconds: number
      type: "timeout"
    }
  | {
      type: "block-member-interaction"
    }

interface NormalizedRequestBase {
  action: AutoModerationChangeAction
  auditReason: string
  guildId: string
  operationKeyHash: string
}

export type NormalizedAutoModerationChangeRequest =
  | (NormalizedRequestBase & {
      action: "create"
      actions: NormalizedAutoModerationAction[]
      exemptChannelIds: string[]
      exemptRoleIds: string[]
      name: string
      trigger: NormalizedAutoModerationTrigger
    })
  | (NormalizedRequestBase & {
      action: "delete"
      ruleId: string
    })
  | (NormalizedRequestBase & {
      action: "set-enabled"
      enabled: boolean
      ruleId: string
    })
  | (NormalizedRequestBase & {
      action: "update"
      actions?: NormalizedAutoModerationAction[]
      exemptChannelIds?: string[]
      exemptRoleIds?: string[]
      name?: string
      ruleId: string
      trigger?: NormalizedAutoModerationTrigger
    })

export interface ProjectedAutoModerationRule {
  actions: NormalizedAutoModerationAction[]
  creatorUserId: string
  enabled: boolean
  eventType: AutoModerationEventType
  exemptChannelIds: string[]
  exemptRoleIds: string[]
  guildId: string
  name: string
  ruleId: string
  trigger: NormalizedAutoModerationTrigger
}

export type PlannedAutoModerationRule = Omit<ProjectedAutoModerationRule, "ruleId"> & {
  ruleId: string | null
}

export interface AutoModerationPermissionEvidence {
  administrator: boolean
  confidence: "complete"
  effectivePermissions: string
  guildOwner: boolean
  missingPermissions: []
  requiredPermissions: DiscordPermissionName[]
}

export interface AutoModerationRoleReference {
  exists: boolean
  id: string
  name: string | null
}

export interface AutoModerationChannelReference {
  alertAllowed: boolean
  connectorCanView: boolean | null
  effectivePermissions: string | null
  exists: boolean
  id: string
  name: string | null
  permissionConfidence: "complete" | null
  type: number | null
}

export interface AutoModerationReferenceEvidence {
  alertChannels: AutoModerationChannelReference[]
  exemptChannels: AutoModerationChannelReference[]
  exemptRoles: AutoModerationRoleReference[]
  healthy: boolean
}

export interface AutoModerationPrivacyProjection {
  actionExecutionEventsExposed: false
  omittedFields: typeof AUTOMOD_OMITTED_FIELDS
  policyContentPersisted: false
}

export interface AutoModerationInventoryRule {
  actionTypes: AutoModerationActionType[]
  creatorUserId: string
  enabled: boolean
  eventType: AutoModerationEventType
  exemptChannelCount: number
  exemptRoleCount: number
  guildId: string
  name: string
  policyEntryCounts: {
    allowList: number
    keywordFilter: number
    presets: number
    regexPatterns: number
  }
  references: {
    healthy: boolean
  }
  ruleId: string
  triggerType: AutoModerationTriggerType
}

export interface AutoModerationInventoryResult {
  guild: {
    id: string
    name: string
  }
  page: {
    returned: number
    safetyLimit: number
    visibility: "connector-visible"
  }
  permission: AutoModerationPermissionEvidence
  privacy: AutoModerationPrivacyProjection
  rules: AutoModerationInventoryRule[]
  schemaVersion: number
  status: "ok"
}

export interface AutoModerationLookupResult {
  guild: {
    id: string
    name: string
  }
  permission: AutoModerationPermissionEvidence
  privacy: AutoModerationPrivacyProjection
  references: AutoModerationReferenceEvidence
  rule: ProjectedAutoModerationRule
  schemaVersion: number
  status: "ok"
}

export interface AutoModerationPlan {
  action: AutoModerationChangeAction
  applicationId: string
  auditReason: string
  botId: string
  capacity: {
    inventoryDigest: string
    limitForTrigger: number
    observedForTrigger: number
    safetyLimit: number
    visibleRules: number
  } | null
  createdAt: string
  desired: PlannedAutoModerationRule | null
  digest: string
  effect: "create" | "delete" | "none" | "set-enabled" | "update"
  existing: ProjectedAutoModerationRule | null
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  permission: AutoModerationPermissionEvidence
  privacy: AutoModerationPrivacyProjection
  references: {
    desired: AutoModerationReferenceEvidence | null
    existing: AutoModerationReferenceEvidence | null
  }
  schemaVersion: number
  status: "already-current" | "planned"
  warnings: string[]
}

export interface AutoModerationResult {
  action: AutoModerationChangeAction
  activityId: string | null
  guildId: string
  observed: ProjectedAutoModerationRule | null
  operationKeyHash: string
  planDigest: string
  ruleId: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
}

export interface AutoModerationServiceClient extends Pick<
  DiscordClient,
  | "createGuildAutoModerationRule"
  | "deleteGuildAutoModerationRule"
  | "getGuild"
  | "getGuildAutoModerationRule"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "listGuildAutoModerationRules"
  | "modifyGuildAutoModerationRule"
> {}

export interface AutoModerationServiceOptions {
  activityStore: ActivityStore
  client: AutoModerationServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface AutoModerationEvidenceState {
  botMember: DiscordGuildMember
  channels: DiscordChannel[]
  guild: DiscordGuild & { owner_id: string }
  guildPermissions: GuildMemberPermissionResult
  roles: DiscordRole[]
}

const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const STATE_UNAVAILABLE = "automod-state-unavailable"
const AUTOMOD_GUILD_LOCKS = new Map<string, Promise<"settled" | "uncertain">>()
const ALERT_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.text,
])
const ACTION_ORDER = new Map(
  AUTOMOD_ACTION_TYPES.map((name, index) => [name, index]),
)
const TRIGGER_CAPACITY: Readonly<Record<AutoModerationTriggerType, number>> = Object.freeze({
  keyword: 6,
  "keyword-preset": 1,
  "member-profile": 1,
  "mention-spam": 1,
  spam: 1,
})
const PRESET_VALUES: Readonly<Record<
  AutoModerationKeywordPreset,
  1 | 2 | 3
>> = Object.freeze({
  profanity: DISCORD_AUTO_MODERATION_KEYWORD_PRESETS.profanity,
  "sexual-content": DISCORD_AUTO_MODERATION_KEYWORD_PRESETS.sexualContent,
  slurs: DISCORD_AUTO_MODERATION_KEYWORD_PRESETS.slurs,
})
const PRESET_NAMES: Readonly<Record<number, AutoModerationKeywordPreset>> = Object.freeze({
  [DISCORD_AUTO_MODERATION_KEYWORD_PRESETS.profanity]: "profanity",
  [DISCORD_AUTO_MODERATION_KEYWORD_PRESETS.sexualContent]: "sexual-content",
  [DISCORD_AUTO_MODERATION_KEYWORD_PRESETS.slurs]: "slurs",
})

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (!validSnowflake(value)) {
    throw new RangeError(`${description} must be a positive Discord snowflake`)
  }
}

function assertValidUnicode(value: string, description: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${description} contains invalid Unicode`, { cause: error })
  }
}

function assertText(
  value: unknown,
  maximum: number,
  description: string,
): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < 1
    || [...value].length > maximum
    || value.trim() !== value
    || TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `${description} must contain 1-${maximum} trimmed characters without controls`,
    )
  }
  assertValidUnicode(value, description)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function normalizeStrings(
  value: unknown,
  maximumEntries: number,
  maximumCharacters: number,
  description: string,
): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximumEntries) {
    throw new RangeError(`${description} are invalid`)
  }
  const result = value.map((entry) => {
    assertText(entry, maximumCharacters, description)
    return entry
  }).sort()
  if (new Set(result).size !== result.length) {
    throw new RangeError(`${description} contain duplicates`)
  }
  return result
}

function normalizeSnowflakes(
  value: unknown,
  maximum: number,
  description: string,
): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximum) {
    throw new RangeError(`${description} are invalid`)
  }
  const result = value.map((entry) => {
    assertSnowflake(entry, description)
    return entry
  })
  if (new Set(result).size !== result.length) {
    throw new RangeError(`${description} contain duplicates`)
  }
  return result.sort((left, right) => {
    const leftId = BigInt(left)
    const rightId = BigInt(right)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

function normalizeTrigger(value: unknown): NormalizedAutoModerationTrigger {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord AutoMod trigger must be an object")
  }
  const trigger = value as Record<string, unknown>
  if (
    trigger.type === "keyword"
    || trigger.type === "member-profile"
  ) {
    if (!hasOnlyKeys(trigger, ["allowList", "keywordFilter", "regexPatterns", "type"])) {
      throw new RangeError("Discord AutoMod keyword trigger fields are invalid")
    }
    const keywordFilter = normalizeStrings(
      trigger.keywordFilter,
      DISCORD_LIMITS.autoModerationKeywordEntries,
      DISCORD_LIMITS.autoModerationKeywordCharacters,
      "Discord AutoMod keyword filter",
    )
    const regexPatterns = normalizeStrings(
      trigger.regexPatterns,
      DISCORD_LIMITS.autoModerationRegexPatterns,
      DISCORD_LIMITS.autoModerationRegexCharacters,
      "Discord AutoMod regex patterns",
    )
    if (keywordFilter.length === 0 && regexPatterns.length === 0) {
      throw new RangeError("Discord AutoMod keyword trigger requires a keyword or regex")
    }
    return {
      allowList: normalizeStrings(
        trigger.allowList,
        DISCORD_LIMITS.autoModerationAllowListKeywords,
        DISCORD_LIMITS.autoModerationKeywordCharacters,
        "Discord AutoMod allow list",
      ),
      keywordFilter,
      regexPatterns,
      type: trigger.type,
    }
  }
  if (trigger.type === "spam") {
    if (!hasOnlyKeys(trigger, ["type"])) {
      throw new RangeError("Discord AutoMod spam trigger fields are invalid")
    }
    return { type: "spam" }
  }
  if (trigger.type === "keyword-preset") {
    if (!hasOnlyKeys(trigger, ["allowList", "presets", "type"])) {
      throw new RangeError("Discord AutoMod preset trigger fields are invalid")
    }
    if (
      !Array.isArray(trigger.presets)
      || trigger.presets.length < 1
      || trigger.presets.some((entry) => (
        typeof entry !== "string"
        || !(AUTOMOD_KEYWORD_PRESETS as readonly string[]).includes(entry)
      ))
    ) {
      throw new RangeError("Discord AutoMod keyword presets are invalid")
    }
    const presets = [...trigger.presets as AutoModerationKeywordPreset[]].sort()
    if (new Set(presets).size !== presets.length) {
      throw new RangeError("Discord AutoMod keyword presets contain duplicates")
    }
    return {
      allowList: normalizeStrings(
        trigger.allowList,
        DISCORD_LIMITS.autoModerationAllowListPresetKeywords,
        DISCORD_LIMITS.autoModerationKeywordCharacters,
        "Discord AutoMod preset allow list",
      ),
      presets,
      type: "keyword-preset",
    }
  }
  if (trigger.type === "mention-spam") {
    if (!hasOnlyKeys(trigger, [
      "mentionRaidProtectionEnabled",
      "mentionTotalLimit",
      "type",
    ])) {
      throw new RangeError("Discord AutoMod mention trigger fields are invalid")
    }
    if (
      !Number.isSafeInteger(trigger.mentionTotalLimit)
      || (trigger.mentionTotalLimit as number) < 1
      || (trigger.mentionTotalLimit as number) > DISCORD_LIMITS.autoModerationMentionLimit
      || !(
        trigger.mentionRaidProtectionEnabled === undefined
        || typeof trigger.mentionRaidProtectionEnabled === "boolean"
      )
    ) {
      throw new RangeError("Discord AutoMod mention trigger metadata is invalid")
    }
    return {
      mentionRaidProtectionEnabled: trigger.mentionRaidProtectionEnabled === true,
      mentionTotalLimit: trigger.mentionTotalLimit as number,
      type: "mention-spam",
    }
  }
  throw new RangeError("Discord AutoMod trigger type is invalid")
}

function normalizeActions(value: unknown): NormalizedAutoModerationAction[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > DISCORD_LIMITS.autoModerationActions
  ) {
    throw new RangeError("Discord AutoMod actions are invalid")
  }
  const result = value.map((entry): NormalizedAutoModerationAction => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RangeError("Discord AutoMod action must be an object")
    }
    const action = entry as Record<string, unknown>
    if (action.type === "block-message") {
      if (!hasOnlyKeys(action, ["customMessage", "type"])) {
        throw new RangeError("Discord AutoMod block-message action fields are invalid")
      }
      if (action.customMessage !== undefined) {
        assertText(
          action.customMessage,
          DISCORD_LIMITS.autoModerationCustomMessageCharacters,
          "Discord AutoMod custom block message",
        )
      }
      return {
        customMessage: action.customMessage === undefined
          ? null
          : action.customMessage as string,
        type: "block-message",
      }
    }
    if (action.type === "send-alert-message") {
      if (!hasOnlyKeys(action, ["channelId", "type"])) {
        throw new RangeError("Discord AutoMod alert action fields are invalid")
      }
      assertSnowflake(action.channelId, "Discord AutoMod alert channel ID")
      return { channelId: action.channelId, type: "send-alert-message" }
    }
    if (action.type === "timeout") {
      if (
        !hasOnlyKeys(action, ["durationSeconds", "type"])
        || !Number.isSafeInteger(action.durationSeconds)
        || (action.durationSeconds as number) < 1
        || (action.durationSeconds as number) > DISCORD_LIMITS.autoModerationTimeoutSeconds
      ) {
        throw new RangeError("Discord AutoMod timeout duration is invalid")
      }
      return {
        durationSeconds: action.durationSeconds as number,
        type: "timeout",
      }
    }
    if (action.type === "block-member-interaction") {
      if (!hasOnlyKeys(action, ["type"])) {
        throw new RangeError("Discord AutoMod interaction-block action fields are invalid")
      }
      return { type: "block-member-interaction" }
    }
    throw new RangeError("Discord AutoMod action type is invalid")
  }).sort((left, right) => (
    (ACTION_ORDER.get(left.type) as number) - (ACTION_ORDER.get(right.type) as number)
  ))
  if (new Set(result.map((action) => action.type)).size !== result.length) {
    throw new RangeError("Discord AutoMod action types contain duplicates")
  }
  return result
}

function assertCompatibility(
  trigger: NormalizedAutoModerationTrigger,
  actions: readonly NormalizedAutoModerationAction[],
  exemptChannelIds: readonly string[],
): void {
  if (trigger.type === "member-profile") {
    if (
      actions.length !== 1
      || actions[0]?.type !== "block-member-interaction"
      || exemptChannelIds.length > 0
    ) {
      throw new RangeError(
        "Discord member-profile AutoMod rules require only interaction blocking and no channel exemptions",
      )
    }
    return
  }
  if (actions.some((action) => action.type === "block-member-interaction")) {
    throw new RangeError("Discord AutoMod interaction blocking is profile-only")
  }
  if (
    actions.some((action) => action.type === "timeout")
    && trigger.type !== "keyword"
    && trigger.type !== "mention-spam"
  ) {
    throw new RangeError("Discord AutoMod timeout is incompatible with this trigger")
  }
}

export function normalizeAutoModerationChangeRequest(
  request: AutoModerationChangeRequest,
): NormalizedAutoModerationChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord AutoMod change request must be an object")
  }
  const record = request as unknown as Record<string, unknown>
  if (![
    "create",
    "delete",
    "set-enabled",
    "update",
  ].includes(String(record.action))) {
    throw new RangeError("Discord AutoMod change action is invalid")
  }
  assertSnowflake(record.guildId, "Discord AutoMod guild ID")
  if (typeof record.auditReason !== "string") {
    throw new RangeError("Discord AutoMod audit reason must be a string")
  }
  encodeDiscordAuditReason(record.auditReason)
  const base: NormalizedRequestBase = {
    action: record.action as AutoModerationChangeAction,
    auditReason: record.auditReason,
    guildId: record.guildId,
    operationKeyHash: operationKeyHash(record.operationKey as string),
  }
  if (record.action === "create") {
    if (!hasOnlyKeys(record, [
      "action",
      "actions",
      "auditReason",
      "exemptChannelIds",
      "exemptRoleIds",
      "guildId",
      "name",
      "operationKey",
      "trigger",
    ])) {
      throw new RangeError("Discord AutoMod create fields are invalid")
    }
    assertText(
      record.name,
      DISCORD_LIMITS.autoModerationRuleNameCharacters,
      "Discord AutoMod rule name",
    )
    const trigger = normalizeTrigger(record.trigger)
    const actions = normalizeActions(record.actions)
    const exemptChannelIds = normalizeSnowflakes(
      record.exemptChannelIds,
      DISCORD_LIMITS.autoModerationExemptChannels,
      "Discord AutoMod exempt channel IDs",
    )
    const exemptRoleIds = normalizeSnowflakes(
      record.exemptRoleIds,
      DISCORD_LIMITS.autoModerationExemptRoles,
      "Discord AutoMod exempt role IDs",
    )
    assertCompatibility(trigger, actions, exemptChannelIds)
    return {
      ...base,
      action: "create",
      actions,
      exemptChannelIds,
      exemptRoleIds,
      name: record.name,
      trigger,
    }
  }
  assertSnowflake(record.ruleId, "Discord AutoMod rule ID")
  if (record.action === "delete") {
    if (!hasOnlyKeys(record, [
      "action",
      "auditReason",
      "guildId",
      "operationKey",
      "ruleId",
    ])) {
      throw new RangeError("Discord AutoMod delete fields are invalid")
    }
    return { ...base, action: "delete", ruleId: record.ruleId }
  }
  if (record.action === "set-enabled") {
    if (
      !hasOnlyKeys(record, [
        "action",
        "auditReason",
        "enabled",
        "guildId",
        "operationKey",
        "ruleId",
      ])
      || typeof record.enabled !== "boolean"
    ) {
      throw new RangeError("Discord AutoMod enable-state fields are invalid")
    }
    return {
      ...base,
      action: "set-enabled",
      enabled: record.enabled,
      ruleId: record.ruleId,
    }
  }
  if (
    !hasOnlyKeys(record, [
      "action",
      "actions",
      "auditReason",
      "exemptChannelIds",
      "exemptRoleIds",
      "guildId",
      "name",
      "operationKey",
      "ruleId",
      "trigger",
    ])
    || (
      record.actions === undefined
      && record.exemptChannelIds === undefined
      && record.exemptRoleIds === undefined
      && record.name === undefined
      && record.trigger === undefined
    )
  ) {
    throw new RangeError("Discord AutoMod update must contain only supported changes")
  }
  if (record.name !== undefined) {
    assertText(
      record.name,
      DISCORD_LIMITS.autoModerationRuleNameCharacters,
      "Discord AutoMod rule name",
    )
  }
  return {
    ...base,
    action: "update",
    ...(record.actions === undefined ? {} : { actions: normalizeActions(record.actions) }),
    ...(record.exemptChannelIds === undefined
      ? {}
      : {
          exemptChannelIds: normalizeSnowflakes(
            record.exemptChannelIds,
            DISCORD_LIMITS.autoModerationExemptChannels,
            "Discord AutoMod exempt channel IDs",
          ),
        }),
    ...(record.exemptRoleIds === undefined
      ? {}
      : {
          exemptRoleIds: normalizeSnowflakes(
            record.exemptRoleIds,
            DISCORD_LIMITS.autoModerationExemptRoles,
            "Discord AutoMod exempt role IDs",
          ),
        }),
    ...(record.name === undefined ? {} : { name: record.name }),
    ruleId: record.ruleId,
    ...(record.trigger === undefined ? {} : { trigger: normalizeTrigger(record.trigger) }),
  }
}

function projectedTrigger(
  trigger: DiscordAutoModerationTrigger,
): NormalizedAutoModerationTrigger {
  if (trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword) {
    return {
      allowList: [...trigger.allowList],
      keywordFilter: [...trigger.keywordFilter],
      regexPatterns: [...trigger.regexPatterns],
      type: "keyword",
    }
  }
  if (trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile) {
    return {
      allowList: [...trigger.allowList],
      keywordFilter: [...trigger.keywordFilter],
      regexPatterns: [...trigger.regexPatterns],
      type: "member-profile",
    }
  }
  if (trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam) {
    return { type: "spam" }
  }
  if (trigger.type === DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keywordPreset) {
    const presets = trigger.presets.map((preset) => {
      const name = PRESET_NAMES[preset]
      if (!name) {
        throw new AutoModerationEvidenceError(
          "Discord returned an unsupported AutoMod keyword preset",
        )
      }
      return name
    }).sort()
    return {
      allowList: [...trigger.allowList],
      presets,
      type: "keyword-preset",
    }
  }
  return {
    mentionRaidProtectionEnabled: trigger.mentionRaidProtectionEnabled,
    mentionTotalLimit: trigger.mentionTotalLimit,
    type: "mention-spam",
  }
}

function projectedActions(
  actions: readonly DiscordAutoModerationAction[],
): NormalizedAutoModerationAction[] {
  return actions.map((action): NormalizedAutoModerationAction => {
    if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage) {
      return { customMessage: action.customMessage, type: "block-message" }
    }
    if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage) {
      return { channelId: action.channelId, type: "send-alert-message" }
    }
    if (action.type === DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout) {
      return { durationSeconds: action.durationSeconds, type: "timeout" }
    }
    return { type: "block-member-interaction" }
  }).sort((left, right) => (
    (ACTION_ORDER.get(left.type) as number) - (ACTION_ORDER.get(right.type) as number)
  ))
}

function projectedRule(
  rule: DiscordAutoModerationRuleSummary,
): ProjectedAutoModerationRule {
  const trigger = projectedTrigger(rule.trigger)
  const eventType: AutoModerationEventType =
    rule.eventType === DISCORD_AUTO_MODERATION_EVENT_TYPES.memberUpdate
      ? "member-update"
      : "message-send"
  const expectedEvent = trigger.type === "member-profile"
    ? "member-update"
    : "message-send"
  if (eventType !== expectedEvent) {
    throw new AutoModerationEvidenceError(
      "Discord returned incompatible AutoMod event evidence",
    )
  }
  const actions = projectedActions(rule.actions)
  try {
    assertCompatibility(trigger, actions, rule.exemptChannelIds)
  } catch (error) {
    throw new AutoModerationEvidenceError(
      `Discord returned incompatible AutoMod policy: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  return {
    actions,
    creatorUserId: rule.creatorUserId,
    enabled: rule.enabled,
    eventType,
    exemptChannelIds: [...rule.exemptChannelIds],
    exemptRoleIds: [...rule.exemptRoleIds],
    guildId: rule.guildId,
    name: rule.name,
    ruleId: rule.id,
    trigger,
  }
}

function exactRules(
  rules: readonly DiscordAutoModerationRuleSummary[],
  guildId: string,
): ProjectedAutoModerationRule[] {
  if (!Array.isArray(rules) || rules.length > DISCORD_LIMITS.autoModerationRules) {
    throw new AutoModerationEvidenceError(
      "Discord returned an invalid AutoMod rule inventory",
    )
  }
  const projected = rules.map(projectedRule)
  const seen = new Set<string>()
  for (const rule of projected) {
    if (rule.guildId !== guildId || seen.has(rule.ruleId)) {
      throw new AutoModerationEvidenceError(
        "Discord returned invalid or duplicate AutoMod rule identities",
      )
    }
    seen.add(rule.ruleId)
  }
  return projected.sort((left, right) => {
    const leftId = BigInt(left.ruleId)
    const rightId = BigInt(right.ruleId)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

function exactGuild(
  guild: DiscordGuild,
  guildId: string,
): DiscordGuild & { owner_id: string } {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || guild.name.length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(guild.name)
    || !validSnowflake(guild.owner_id)
  ) {
    throw new AutoModerationEvidenceError(
      "Discord returned invalid AutoMod guild evidence",
    )
  }
  try {
    assertValidUnicode(guild.name, "Discord guild name")
  } catch (error) {
    throw new AutoModerationEvidenceError(
      "Discord returned invalid AutoMod guild evidence",
      { cause: error },
    )
  }
  return guild as DiscordGuild & { owner_id: string }
}

function exactBotMember(
  member: DiscordGuildMember,
  botId: string,
): DiscordGuildMember {
  if (
    !member
    || typeof member !== "object"
    || Array.isArray(member)
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(member.roles).size !== member.roles.length
    || member.roles.some((roleId) => !validSnowflake(roleId))
    || member.user?.id !== botId
    || member.user.bot !== true
  ) {
    throw new AutoModerationEvidenceError(
      "Discord returned invalid AutoMod bot-member evidence",
    )
  }
  return member
}

function exactRoles(
  roles: readonly DiscordRole[],
  guildId: string,
): DiscordRole[] {
  if (
    !Array.isArray(roles)
    || roles.length < 1
    || roles.length > DISCORD_LIMITS.guildRoles
  ) {
    throw new AutoModerationEvidenceError(
      "Discord returned an invalid AutoMod role inventory",
    )
  }
  const seen = new Set<string>()
  for (const role of roles) {
    if (
      !role
      || typeof role !== "object"
      || !validSnowflake(role.id)
      || seen.has(role.id)
      || typeof role.name !== "string"
      || role.name.length < 1
      || role.name.length > DISCORD_LIMITS.roleNameCharacters
      || TEXT_CONTROL_PATTERN.test(role.name)
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(role.permissions)
      || !Number.isInteger(role.position)
      || role.position < 0
      || typeof role.managed !== "boolean"
    ) {
      throw new AutoModerationEvidenceError(
        "Discord returned an invalid AutoMod role inventory",
      )
    }
    try {
      assertValidUnicode(role.name, "Discord role name")
    } catch (error) {
      throw new AutoModerationEvidenceError(
        "Discord returned an invalid AutoMod role inventory",
        { cause: error },
      )
    }
    seen.add(role.id)
  }
  if (!seen.has(guildId)) {
    throw new AutoModerationEvidenceError(
      "Discord AutoMod role inventory omitted the @everyone role",
    )
  }
  return [...roles]
}

function exactChannels(
  channels: readonly DiscordChannel[],
  guildId: string,
): DiscordChannel[] {
  if (!Array.isArray(channels) || channels.length > DISCORD_LIMITS.guildChannels) {
    throw new AutoModerationEvidenceError(
      "Discord returned an invalid AutoMod channel inventory",
    )
  }
  const seen = new Set<string>()
  for (const channel of channels) {
    if (
      !channel
      || typeof channel !== "object"
      || Array.isArray(channel)
      || !validSnowflake(channel.id)
      || seen.has(channel.id)
      || !Number.isSafeInteger(channel.type)
      || channel.guild_id !== guildId
      || typeof channel.name !== "string"
      || channel.name.length < 1
      || channel.name.length > DISCORD_LIMITS.channelNameCharacters
      || TEXT_CONTROL_PATTERN.test(channel.name)
      || !Array.isArray(channel.permission_overwrites)
      || channel.permission_overwrites.length > DISCORD_LIMITS.channelPermissionOverwrites
    ) {
      throw new AutoModerationEvidenceError(
        "Discord returned an invalid AutoMod channel inventory",
      )
    }
    const overwriteIds = new Set<string>()
    for (const overwrite of channel.permission_overwrites) {
      const identity = `${overwrite.type}:${overwrite.id}`
      if (
        !overwrite
        || typeof overwrite !== "object"
        || !validSnowflake(overwrite.id)
        || overwriteIds.has(identity)
        || (overwrite.type !== 0 && overwrite.type !== 1)
        || !(overwrite.allow === undefined || overwrite.allow === null
          || /^(0|[1-9][0-9]*)$/u.test(overwrite.allow))
        || !(overwrite.deny === undefined || overwrite.deny === null
          || /^(0|[1-9][0-9]*)$/u.test(overwrite.deny))
      ) {
        throw new AutoModerationEvidenceError(
          "Discord returned invalid AutoMod channel overwrite evidence",
        )
      }
      overwriteIds.add(identity)
    }
    try {
      assertValidUnicode(channel.name, "Discord channel name")
    } catch (error) {
      throw new AutoModerationEvidenceError(
        "Discord returned an invalid AutoMod channel inventory",
        { cause: error },
      )
    }
    seen.add(channel.id)
  }
  return [...channels]
}

function permissionNamesMissing(
  effectivePermissions: string,
  administrator: boolean,
  guildOwner: boolean,
  requiredPermissions: readonly DiscordPermissionName[],
): DiscordPermissionName[] {
  if (administrator || guildOwner) return []
  const bits = BigInt(effectivePermissions)
  return requiredPermissions.filter((name) => (
    (bits & DISCORD_PERMISSIONS[name]) !== DISCORD_PERMISSIONS[name]
  ))
}

function permissionEvidence(
  state: AutoModerationEvidenceState,
  requiredPermissions: readonly DiscordPermissionName[],
): AutoModerationPermissionEvidence {
  if (!state.guildPermissions.complete) {
    throw new AutoModerationEvidenceError(
      "Discord AutoMod permission evidence is incomplete",
    )
  }
  const guildOwner = state.guild.owner_id === state.botMember.user?.id
  const missingPermissions = permissionNamesMissing(
    state.guildPermissions.effectivePermissions,
    state.guildPermissions.administrator,
    guildOwner,
    requiredPermissions,
  )
  if (missingPermissions.length > 0) {
    throw new AutoModerationEvidenceError(
      `Discord connector bot lacks AutoMod permissions: ${missingPermissions.join(", ")}`,
    )
  }
  return {
    administrator: state.guildPermissions.administrator,
    confidence: "complete",
    effectivePermissions: state.guildPermissions.effectivePermissions,
    guildOwner,
    missingPermissions: [],
    requiredPermissions: [...requiredPermissions],
  }
}

function channelPermissionEvidence(
  state: AutoModerationEvidenceState,
  channel: DiscordChannel,
): {
  canView: boolean
  effectivePermissions: string
} {
  let result
  try {
    result = evaluateBotChannelPermissions({
      botId: state.botMember.user!.id,
      channel,
      guildId: state.guild.id,
      member: state.botMember,
      permissionChannel: channel,
      roles: state.roles,
    })
  } catch (error) {
    throw new AutoModerationEvidenceError(
      `Discord AutoMod alert-channel permission evidence is invalid: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  if (result.confidence !== "complete") {
    throw new AutoModerationEvidenceError(
      "Discord AutoMod alert-channel permission evidence is incomplete",
    )
  }
  return {
    canView: result.administrator
      || state.guild.owner_id === state.botMember.user?.id
      || (BigInt(result.effectivePermissions) & DISCORD_PERMISSIONS.VIEW_CHANNEL)
        === DISCORD_PERMISSIONS.VIEW_CHANNEL,
    effectivePermissions: result.effectivePermissions,
  }
}

function channelReference(
  state: AutoModerationEvidenceState,
  policy: ScopePolicy,
  channelId: string,
  alert: boolean,
): AutoModerationChannelReference {
  const channel = state.channels.find((candidate) => candidate.id === channelId)
  const permission = channel ? channelPermissionEvidence(state, channel) : null
  return {
    alertAllowed: alert && policy.automodAlertChannelAllowed(channelId),
    connectorCanView: permission?.canView ?? null,
    effectivePermissions: permission?.effectivePermissions ?? null,
    exists: channel !== undefined,
    id: channelId,
    name: channel?.name ?? null,
    permissionConfidence: channel ? "complete" : null,
    type: channel?.type ?? null,
  }
}

function referenceEvidence(
  state: AutoModerationEvidenceState,
  policy: ScopePolicy,
  rule: PlannedAutoModerationRule | ProjectedAutoModerationRule,
): AutoModerationReferenceEvidence {
  const alertChannelIds = rule.actions
    .filter((action): action is Extract<
      NormalizedAutoModerationAction,
      { type: "send-alert-message" }
    > => action.type === "send-alert-message")
    .map((action) => action.channelId)
  const alertChannels = alertChannelIds.map((id) => channelReference(
    state,
    policy,
    id,
    true,
  ))
  const exemptChannels = rule.exemptChannelIds.map((id) => channelReference(
    state,
    policy,
    id,
    false,
  ))
  const exemptRoles = rule.exemptRoleIds.map((id) => {
    const role = state.roles.find((candidate) => candidate.id === id)
    return {
      exists: role !== undefined,
      id,
      name: role?.name ?? null,
    }
  })
  return {
    alertChannels,
    exemptChannels,
    exemptRoles,
    healthy: alertChannels.every((channel) => (
      channel.exists
      && channel.alertAllowed
      && channel.connectorCanView === true
      && channel.type !== null
      && ALERT_CHANNEL_TYPES.has(channel.type)
    ))
      && exemptChannels.every((channel) => channel.exists)
      && exemptRoles.every((role) => role.exists && role.id !== state.guild.id),
  }
}

function assertDesiredReferences(
  state: AutoModerationEvidenceState,
  evidence: AutoModerationReferenceEvidence,
): void {
  const invalidRole = evidence.exemptRoles.find((role) => (
    !role.exists || role.id === state.guild.id
  ))
  if (invalidRole) {
    throw new AutoModerationEvidenceError(
      `Discord AutoMod exemption role ${invalidRole.id} is invalid or unresolved`,
    )
  }
  const invalidChannel = evidence.exemptChannels.find((channel) => !channel.exists)
  if (invalidChannel) {
    throw new AutoModerationEvidenceError(
      `Discord AutoMod exemption channel ${invalidChannel.id} is unresolved`,
    )
  }
  const invalidAlert = evidence.alertChannels.find((channel) => (
    !channel.exists
    || !channel.alertAllowed
    || channel.connectorCanView !== true
    || channel.type === null
    || !ALERT_CHANNEL_TYPES.has(channel.type)
  ))
  if (invalidAlert) {
    throw new AutoModerationEvidenceError(
      `Discord AutoMod alert channel ${invalidAlert.id} must be an existing allowlisted visible text or announcement channel`,
    )
  }
}

function privacyProjection(): AutoModerationPrivacyProjection {
  return {
    actionExecutionEventsExposed: false,
    omittedFields: AUTOMOD_OMITTED_FIELDS,
    policyContentPersisted: false,
  }
}

function inventoryRule(
  rule: ProjectedAutoModerationRule,
  references: AutoModerationReferenceEvidence,
): AutoModerationInventoryRule {
  const trigger = rule.trigger
  return {
    actionTypes: rule.actions.map((action) => action.type),
    creatorUserId: rule.creatorUserId,
    enabled: rule.enabled,
    eventType: rule.eventType,
    exemptChannelCount: rule.exemptChannelIds.length,
    exemptRoleCount: rule.exemptRoleIds.length,
    guildId: rule.guildId,
    name: rule.name,
    policyEntryCounts: {
      allowList: "allowList" in trigger ? trigger.allowList.length : 0,
      keywordFilter: "keywordFilter" in trigger ? trigger.keywordFilter.length : 0,
      presets: "presets" in trigger ? trigger.presets.length : 0,
      regexPatterns: "regexPatterns" in trigger ? trigger.regexPatterns.length : 0,
    },
    references: { healthy: references.healthy },
    ruleId: rule.ruleId,
    triggerType: trigger.type,
  }
}

function eventTypeForTrigger(
  trigger: NormalizedAutoModerationTrigger,
): AutoModerationEventType {
  return trigger.type === "member-profile" ? "member-update" : "message-send"
}

function wireTrigger(
  trigger: NormalizedAutoModerationTrigger,
): DiscordAutoModerationTrigger {
  if (trigger.type === "keyword") {
    return {
      allowList: [...trigger.allowList],
      keywordFilter: [...trigger.keywordFilter],
      regexPatterns: [...trigger.regexPatterns],
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keyword,
    }
  }
  if (trigger.type === "member-profile") {
    return {
      allowList: [...trigger.allowList],
      keywordFilter: [...trigger.keywordFilter],
      regexPatterns: [...trigger.regexPatterns],
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.memberProfile,
    }
  }
  if (trigger.type === "spam") {
    return { type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.spam }
  }
  if (trigger.type === "keyword-preset") {
    return {
      allowList: [...trigger.allowList],
      presets: trigger.presets.map((preset) => PRESET_VALUES[preset]),
      type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.keywordPreset,
    }
  }
  return {
    mentionRaidProtectionEnabled: trigger.mentionRaidProtectionEnabled,
    mentionTotalLimit: trigger.mentionTotalLimit,
    type: DISCORD_AUTO_MODERATION_TRIGGER_TYPES.mentionSpam,
  }
}

function wireActions(
  actions: readonly NormalizedAutoModerationAction[],
): DiscordAutoModerationAction[] {
  return actions.map((action): DiscordAutoModerationAction => {
    if (action.type === "block-message") {
      return {
        customMessage: action.customMessage,
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMessage,
      }
    }
    if (action.type === "send-alert-message") {
      return {
        channelId: action.channelId,
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.sendAlertMessage,
      }
    }
    if (action.type === "timeout") {
      return {
        durationSeconds: action.durationSeconds,
        type: DISCORD_AUTO_MODERATION_ACTION_TYPES.timeout,
      }
    }
    return { type: DISCORD_AUTO_MODERATION_ACTION_TYPES.blockMemberInteraction }
  })
}

function sameRule(
  left: PlannedAutoModerationRule | ProjectedAutoModerationRule,
  right: PlannedAutoModerationRule | ProjectedAutoModerationRule,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function hasTimeout(rule: PlannedAutoModerationRule): boolean {
  return rule.actions.some((action) => action.type === "timeout")
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) return `discord-api-${error.status}`
  if (error instanceof AutoModerationEvidenceError) return "automod-evidence"
  const name = error instanceof Error ? error.name : "unknown"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/gu, "-").slice(0, 128)
  return normalized && /^[A-Za-z]/u.test(normalized) ? normalized : "unknown"
}

function targetId(request: NormalizedAutoModerationChangeRequest): string | null {
  return request.action === "create" ? null : request.ruleId
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    ruleId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string
  plan: AutoModerationPlan
  request: NormalizedAutoModerationChangeRequest
  ruleId?: string | null
  status: AutoModerationActivityStatus
  timestamp: string
  triggerType: AutoModerationTriggerType
  verification?: "drift" | "match"
}): AutoModerationActivity {
  return {
    action: options.request.action,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "automod-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    ruleId: options.ruleId ?? targetId(options.request),
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    targetEnabled: options.request.action === "set-enabled"
      ? options.request.enabled
      : null,
    timestamp: options.timestamp,
    triggerType: options.triggerType,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string
  plan: AutoModerationPlan
  request: NormalizedAutoModerationChangeRequest
  ruleId?: string | null
  status: "completed" | "failed" | "pending" | "uncertain"
  timestamp: string
  verification?: "drift" | "match"
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "automod-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.ruleId ?? targetId(options.request),
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  return error instanceof AutoModerationExecutionError
    && Boolean(
      error.result
      && typeof error.result === "object"
      && "status" in error.result
      && (error.result as { status?: unknown }).status === "uncertain",
    )
}

async function withGuildLock<T>(
  guildId: string,
  operation: () => Promise<T>,
  blockedError: () => Error,
): Promise<T> {
  const previous = AUTOMOD_GUILD_LOCKS.get(guildId) ?? Promise.resolve("settled")
  let release!: (outcome: "settled" | "uncertain") => void
  const tail = new Promise<"settled" | "uncertain">((resolve) => {
    release = resolve
  })
  AUTOMOD_GUILD_LOCKS.set(guildId, tail)
  const priorOutcome = await previous.catch(() => "uncertain" as const)
  if (priorOutcome === "uncertain") {
    release("uncertain")
    throw blockedError()
  }
  let outcome: "settled" | "uncertain" = "settled"
  try {
    return await operation()
  } catch (error) {
    if (uncertainExecution(error)) outcome = "uncertain"
    throw error
  } finally {
    release(outcome)
    if (AUTOMOD_GUILD_LOCKS.get(guildId) === tail) {
      AUTOMOD_GUILD_LOCKS.delete(guildId)
    }
  }
}

export class AutoModerationService {
  readonly #activityStore: ActivityStore
  readonly #client: AutoModerationServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: AutoModerationServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #evidence(
    botId: string,
    guildId: string,
    mode: "audit" | "change",
    options: RequestOptions,
    operationKeyHashValue?: string,
  ): Promise<AutoModerationEvidenceState> {
    assertSnowflake(botId, "Discord connector bot ID")
    assertSnowflake(guildId, "Discord AutoMod guild ID")
    if (mode === "change") {
      this.#policy.assertAutomodChangeAllowed(guildId)
    } else {
      this.#policy.assertAutomodAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "automod-change",
        operationKeyHashValue,
      )
      if (receipt) {
        throw new AutoModerationOperationConflictError(receiptView(receipt))
      }
    }
    const [rawGuild, rawMember, rawRoles, rawChannels] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.getGuildChannels(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, botId)
    const roles = exactRoles(rawRoles, guildId)
    let guildPermissions: GuildMemberPermissionResult
    try {
      guildPermissions = evaluateGuildMemberPermissions({
        guildId,
        member: botMember,
        roles,
      })
    } catch (error) {
      throw new AutoModerationEvidenceError(
        `Discord AutoMod guild permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    if (!guildPermissions.complete) {
      throw new AutoModerationEvidenceError(
        "Discord AutoMod guild permission evidence is incomplete",
      )
    }
    return {
      botMember,
      channels: exactChannels(rawChannels, guildId),
      guild,
      guildPermissions,
      roles,
    }
  }

  async list(
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<AutoModerationInventoryResult> {
    this.#policy.assertAutomodAuditable(guildId)
    const [state, rawRules] = await Promise.all([
      this.#evidence(botId, guildId, "audit", options),
      this.#client.listGuildAutoModerationRules(guildId, options),
    ])
    const permission = permissionEvidence(state, ["MANAGE_GUILD"])
    const rules = exactRules(rawRules, guildId).map((rule) => inventoryRule(
      rule,
      referenceEvidence(state, this.#policy, rule),
    ))
    return {
      guild: { id: guildId, name: state.guild.name },
      page: {
        returned: rules.length,
        safetyLimit: DISCORD_LIMITS.autoModerationRules,
        visibility: "connector-visible",
      },
      permission,
      privacy: privacyProjection(),
      rules,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async get(
    botId: string,
    guildId: string,
    ruleId: string,
    options: RequestOptions = {},
  ): Promise<AutoModerationLookupResult> {
    assertSnowflake(ruleId, "Discord AutoMod rule ID")
    this.#policy.assertAutomodAuditable(guildId)
    const [state, rawRule] = await Promise.all([
      this.#evidence(botId, guildId, "audit", options),
      this.#client.getGuildAutoModerationRule(guildId, ruleId, options),
    ])
    const rule = projectedRule(rawRule)
    if (rule.guildId !== guildId || rule.ruleId !== ruleId) {
      throw new AutoModerationEvidenceError(
        "Discord returned another AutoMod rule for an exact lookup",
      )
    }
    return {
      guild: { id: guildId, name: state.guild.name },
      permission: permissionEvidence(state, ["MANAGE_GUILD"]),
      privacy: privacyProjection(),
      references: referenceEvidence(state, this.#policy, rule),
      rule,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedAutoModerationChangeRequest,
    options: RequestOptions,
  ): Promise<AutoModerationPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#evidence(
      botId,
      request.guildId,
      "change",
      options,
      request.operationKeyHash,
    )
    let existing: ProjectedAutoModerationRule | null = null
    let inventory: ProjectedAutoModerationRule[] = []
    if (request.action === "create") {
      inventory = exactRules(
        await this.#client.listGuildAutoModerationRules(request.guildId, options),
        request.guildId,
      )
    } else {
      const rawRule = await this.#client.getGuildAutoModerationRule(
        request.guildId,
        request.ruleId,
        options,
      )
      existing = projectedRule(rawRule)
      if (
        existing.guildId !== request.guildId
        || existing.ruleId !== request.ruleId
      ) {
        throw new AutoModerationEvidenceError(
          "Discord returned another AutoMod rule for an exact change target",
        )
      }
    }

    let desired: PlannedAutoModerationRule | null
    if (request.action === "create") {
      desired = {
        actions: request.actions,
        creatorUserId: botId,
        enabled: false,
        eventType: eventTypeForTrigger(request.trigger),
        exemptChannelIds: request.exemptChannelIds,
        exemptRoleIds: request.exemptRoleIds,
        guildId: request.guildId,
        name: request.name,
        ruleId: null,
        trigger: request.trigger,
      }
    } else if (request.action === "delete") {
      if (existing!.enabled) {
        throw new AutoModerationEvidenceError(
          "Discord AutoMod rule must be disabled in a separate reviewed change before deletion",
        )
      }
      desired = null
    } else if (request.action === "set-enabled") {
      desired = { ...existing!, enabled: request.enabled }
    } else {
      if (existing!.enabled) {
        throw new AutoModerationEvidenceError(
          "Discord AutoMod rule must be disabled in a separate reviewed change before editing",
        )
      }
      if (
        request.trigger !== undefined
        && request.trigger.type !== existing!.trigger.type
      ) {
        throw new AutoModerationEvidenceError(
          "Discord AutoMod trigger type is immutable; delete and recreate the disabled rule",
        )
      }
      const trigger = request.trigger ?? existing!.trigger
      const actions = request.actions ?? existing!.actions
      const exemptChannelIds = request.exemptChannelIds ?? existing!.exemptChannelIds
      try {
        assertCompatibility(trigger, actions, exemptChannelIds)
      } catch (error) {
        throw new AutoModerationEvidenceError(
          `Discord AutoMod update is incompatible: ${errorMessage(error)}`,
          { cause: error },
        )
      }
      desired = {
        ...existing!,
        actions,
        eventType: eventTypeForTrigger(trigger),
        exemptChannelIds,
        exemptRoleIds: request.exemptRoleIds ?? existing!.exemptRoleIds,
        ...(request.name === undefined ? {} : { name: request.name }),
        trigger,
      }
    }

    let capacity: AutoModerationPlan["capacity"] = null
    if (request.action === "create") {
      const triggerType = request.trigger.type
      const observedForTrigger = inventory.filter((rule) => (
        rule.trigger.type === triggerType
      )).length
      const limitForTrigger = TRIGGER_CAPACITY[triggerType]
      if (
        inventory.length >= DISCORD_LIMITS.autoModerationRules
        || observedForTrigger >= limitForTrigger
      ) {
        throw new AutoModerationEvidenceError(
          `Discord AutoMod ${triggerType} rule capacity is exhausted`,
        )
      }
      capacity = {
        inventoryDigest: reviewedPlanDigest(this.#planKey, { rules: inventory }),
        limitForTrigger,
        observedForTrigger,
        safetyLimit: DISCORD_LIMITS.autoModerationRules,
        visibleRules: inventory.length,
      }
    }

    const existingReferences = existing
      ? referenceEvidence(state, this.#policy, existing)
      : null
    const desiredReferences = desired
      ? referenceEvidence(state, this.#policy, desired)
      : null
    if (
      desiredReferences
      && (
        request.action === "create"
        || request.action === "update"
        || request.action === "set-enabled" && request.enabled
      )
    ) {
      assertDesiredReferences(state, desiredReferences)
    }

    const requiredPermissions: DiscordPermissionName[] = ["MANAGE_GUILD"]
    if (
      desired
      && hasTimeout(desired)
      && (
        request.action === "create"
        || request.action === "update"
        || request.action === "set-enabled" && request.enabled
      )
    ) {
      requiredPermissions.push("MODERATE_MEMBERS")
    }
    const permission = permissionEvidence(state, requiredPermissions)
    const effect: AutoModerationPlan["effect"] = request.action === "update"
      && desired !== null
      && existing !== null
      && sameRule(existing, desired)
      ? "none"
      : request.action === "set-enabled"
        && desired !== null
        && existing !== null
        && sameRule(existing, desired)
        ? "none"
        : request.action
    const privacy = privacyProjection()
    const triggerType = existing?.trigger.type ?? desired!.trigger.type
    const hasAlert = Boolean(desired?.actions.some((action) => (
      action.type === "send-alert-message"
    )))
    const hasRegex = Boolean(
      desired
      && "regexPatterns" in desired.trigger
      && desired.trigger.regexPatterns.length > 0,
    )
    const warnings = [
      ...(permission.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped AutoMod permissions"]
        : []),
      ...(request.action === "create"
        ? ["The rule will be created disabled and requires a separate reviewed enable change"]
        : []),
      ...(request.action === "set-enabled" && request.enabled
        ? ["Enabling this rule can immediately block content or member interactions"]
        : []),
      ...(request.action === "set-enabled" && !request.enabled
        ? ["Disabling this rule immediately removes its automated protection"]
        : []),
      ...(request.action === "delete"
        ? ["Deletion permanently removes the exact disabled AutoMod rule"]
        : []),
      ...(hasAlert
        ? ["Alert actions copy matched user content into the reviewed allowlisted channel"]
        : []),
      ...(desired && hasTimeout(desired)
        ? ["Timeout actions can temporarily prevent members from interacting in the guild"]
        : []),
      ...(triggerType === "member-profile"
        ? ["Member-profile interaction blocking quarantines matching members until their profile changes or the rule is disabled"]
        : []),
      ...(hasRegex
        ? ["Regex patterns use Discord's Rust-flavored validator and are not executed locally"]
        : []),
      ...(desiredReferences && !desiredReferences.healthy
        ? ["The desired rule contains unresolved or locally disallowed references"]
        : []),
      "Rule names and policy strings are untrusted Discord data and are never persisted by this workflow",
      "AutoMod serialization is process-local; do not run connector processes with overlapping AutoMod scope",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const selectedRoleIds = new Set([
      request.guildId,
      ...state.botMember.roles,
      ...(existing?.exemptRoleIds ?? []),
      ...(desired?.exemptRoleIds ?? []),
    ])
    const selectedChannelIds = new Set([
      ...(existing?.exemptChannelIds ?? []),
      ...(desired?.exemptChannelIds ?? []),
      ...(existing?.actions.flatMap((action) => (
        action.type === "send-alert-message" ? [action.channelId] : []
      )) ?? []),
      ...(desired?.actions.flatMap((action) => (
        action.type === "send-alert-message" ? [action.channelId] : []
      )) ?? []),
    ])
    const createdAt = this.#clock()
    if (Number.isNaN(createdAt.getTime())) {
      throw new AutoModerationEvidenceError("Discord AutoMod planning clock is invalid")
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      capacity,
      channels: state.channels
        .filter((channel) => selectedChannelIds.has(channel.id))
        .map((channel) => ({
          id: channel.id,
          name: channel.name ?? null,
          permissionOverwrites: channel.permission_overwrites,
          type: channel.type,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      desired,
      existing,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      permission,
      references: {
        desired: desiredReferences,
        existing: existingReferences,
      },
      request,
      roles: state.roles
        .filter((role) => selectedRoleIds.has(role.id))
        .map((role) => ({
          id: role.id,
          managed: role.managed,
          name: role.name,
          permissions: role.permissions,
          position: role.position,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      warnings,
    })
    return {
      action: request.action,
      applicationId,
      auditReason: request.auditReason,
      botId,
      capacity,
      createdAt: createdAt.toISOString(),
      desired,
      digest,
      effect,
      existing,
      guild: { id: request.guildId, name: state.guild.name },
      operationKeyHash: request.operationKeyHash,
      permission,
      privacy,
      references: {
        desired: desiredReferences,
        existing: existingReferences,
      },
      schemaVersion: SCHEMA_VERSION,
      status: effect === "none" ? "already-current" : "planned",
      warnings,
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: AutoModerationChangeRequest,
    options: RequestOptions = {},
  ): Promise<AutoModerationPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeAutoModerationChangeRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: AutoModerationChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<AutoModerationResult> {
    const normalized = normalizeAutoModerationChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord AutoMod plan digest is invalid")
    }
    return withGuildLock(
      normalized.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new AutoModerationExecutionError(
        "Discord AutoMod change was blocked because a prior same-guild operation ended with an uncertain outcome",
        {
          action: normalized.action,
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
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
    request: NormalizedAutoModerationChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<AutoModerationResult> {
    let plan: AutoModerationPlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof AutoModerationEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new AutoModerationPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new AutoModerationPlanChangedError(expectedDigest, plan.digest)
    }
    const triggerType = plan.existing?.trigger.type ?? plan.desired!.trigger.type
    const baseResult = {
      action: request.action,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.effect === "none") {
      return {
        ...baseResult,
        activityId: null,
        observed: plan.existing,
        ruleId: (plan.existing as ProjectedAutoModerationRule).ruleId,
        status: "already-current",
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      request,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new AutoModerationOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request,
        status: "pending",
        timestamp: this.#clock().toISOString(),
        triggerType,
      }))
    } catch (error) {
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          plan,
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new AutoModerationExecutionError(
        "Discord AutoMod change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: safeErrorCode(error),
          operationRecordError,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let ruleId = targetId(request)
    let mutationCompleted = false
    let observed: ProjectedAutoModerationRule | null = null
    try {
      if (request.action === "create") {
        const input: CreateGuildAutoModerationRuleInput = {
          actions: wireActions(request.actions),
          exemptChannelIds: request.exemptChannelIds,
          exemptRoleIds: request.exemptRoleIds,
          name: request.name,
          trigger: wireTrigger(request.trigger),
        }
        const created = await this.#client.createGuildAutoModerationRule(
          request.guildId,
          input,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        assertSnowflake(created.id, "Created Discord AutoMod rule ID")
        ruleId = created.id
        observed = projectedRule(await this.#client.getGuildAutoModerationRule(
          request.guildId,
          created.id,
          options,
        ))
      } else if (request.action === "update") {
        const input: ModifyGuildAutoModerationRuleInput = {
          ...(request.actions === undefined
            ? {}
            : { actions: wireActions(request.actions) }),
          ...(request.exemptChannelIds === undefined
            ? {}
            : { exemptChannelIds: request.exemptChannelIds }),
          ...(request.exemptRoleIds === undefined
            ? {}
            : { exemptRoleIds: request.exemptRoleIds }),
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.trigger === undefined
            ? {}
            : { trigger: wireTrigger(request.trigger) }),
        }
        await this.#client.modifyGuildAutoModerationRule(
          request.guildId,
          request.ruleId,
          input,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        observed = projectedRule(await this.#client.getGuildAutoModerationRule(
          request.guildId,
          request.ruleId,
          options,
        ))
      } else if (request.action === "set-enabled") {
        await this.#client.modifyGuildAutoModerationRule(
          request.guildId,
          request.ruleId,
          { enabled: request.enabled },
          request.auditReason,
          options,
        )
        mutationCompleted = true
        observed = projectedRule(await this.#client.getGuildAutoModerationRule(
          request.guildId,
          request.ruleId,
          options,
        ))
      } else {
        await this.#client.deleteGuildAutoModerationRule(
          request.guildId,
          request.ruleId,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        try {
          observed = projectedRule(await this.#client.getGuildAutoModerationRule(
            request.guildId,
            request.ruleId,
            options,
          ))
        } catch (error) {
          if (error instanceof DiscordApiError && error.status === 404) {
            observed = null
          } else {
            throw error
          }
        }
      }
    } catch (error) {
      const status = !mutationCompleted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        ? "failed"
        : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
          plan,
          request,
          ruleId,
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
          request,
          ruleId,
          status,
          timestamp: this.#clock().toISOString(),
          triggerType,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AutoModerationExecutionError(
        "Discord AutoMod change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          observed,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          ruleId,
          status,
        },
        { cause: error },
      )
    }

    if (!ruleId) {
      throw new AutoModerationExecutionError(
        "Discord AutoMod change returned no exact resource identity",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    const matched = request.action === "delete"
      ? observed === null
      : observed !== null
        && sameRule({ ...plan.desired!, ruleId }, observed)
    const verification = matched ? "match" : "drift"
    const status = matched ? "completed" : "completed-with-drift"
    const result: AutoModerationResult = {
      ...baseResult,
      activityId,
      observed,
      ruleId,
      status,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        ruleId,
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
          request,
          ruleId,
          status,
          timestamp: this.#clock().toISOString(),
          triggerType,
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new AutoModerationExecutionError(
        "Discord AutoMod change completed but the operation receipt failed",
        {
          ...result,
          activityRecordError,
          operationRecordError: safeErrorCode(error),
          status: "completed-operation-record-failed",
        },
        { cause: error },
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        request,
        ruleId,
        status,
        timestamp: this.#clock().toISOString(),
        triggerType,
        verification,
      }))
    } catch (error) {
      throw new AutoModerationExecutionError(
        "Discord AutoMod change completed but the final activity record failed",
        {
          ...result,
          activityRecordError: safeErrorCode(error),
          status: "completed-audit-failed",
        },
        { cause: error },
      )
    }
    return result
  }
}
