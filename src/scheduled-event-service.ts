import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  ScheduledEventActivity,
  ScheduledEventActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  DISCORD_SCHEDULED_EVENT_ENTITY_TYPES,
  DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES,
  DISCORD_SCHEDULED_EVENT_STATUSES,
  encodeDiscordAuditReason,
  type CreateGuildScheduledEventInput,
  type DiscordClient,
  type DiscordScheduledEventEntityType,
  type DiscordScheduledEventRecurrenceInput,
  type DiscordScheduledEventRecurrenceRule,
  type DiscordScheduledEventStatus,
  type DiscordScheduledEventSummary,
  type DiscordScheduledEventUserSummary,
  type ModifyGuildScheduledEventInput,
  type ScheduledEventReadOptions,
  type ScheduledEventUserPageOptions,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  ScheduledEventEvidenceError,
  ScheduledEventExecutionError,
  ScheduledEventOperationConflictError,
  ScheduledEventPlanChangedError,
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
  type BotChannelPermissionResult,
  type DiscordPermissionName,
  type GuildMemberPermissionResult,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import {
  readScheduledEventCoverFileSnapshot,
  ScheduledEventCoverFileError,
  type ScheduledEventCoverFileReview,
  type ScheduledEventCoverFileSnapshot,
} from "./scheduled-event-file.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export const SCHEDULED_EVENT_ENTITY_TYPES = [
  "external",
  "stage",
  "voice",
] as const

export const SCHEDULED_EVENT_STATUSES = [
  "active",
  "canceled",
  "completed",
  "scheduled",
] as const

export const SCHEDULED_EVENT_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const

export const SCHEDULED_EVENT_OMITTED_FIELDS = Object.freeze([
  "coverImageCdnUrl",
  "coverImageHash",
  "creatorProfile",
  "rawDiscordObject",
  "subscriberProfiles",
] as const)

export const SCHEDULED_EVENT_USER_OMITTED_FIELDS = Object.freeze([
  "avatars",
  "displayNames",
  "memberData",
  "rawDiscordObjects",
  "usernames",
] as const)

export type ScheduledEventAction = "create" | "delete" | "transition" | "update"
export type ScheduledEventEntityType = typeof SCHEDULED_EVENT_ENTITY_TYPES[number]
export type ScheduledEventStatus = typeof SCHEDULED_EVENT_STATUSES[number]
export type ScheduledEventWeekday = typeof SCHEDULED_EVENT_WEEKDAYS[number]
export type ScheduledEventTransitionTarget = Exclude<ScheduledEventStatus, "scheduled">

export type ScheduledEventHosting =
  | {
      channelId: string
      entityType: "stage" | "voice"
    }
  | {
      entityType: "external"
      location: string
    }

export type ScheduledEventRecurrenceRequest =
  | {
      frequency: "daily"
      weekdays?: readonly ScheduledEventWeekday[]
    }
  | {
      frequency: "monthly"
      week: 1 | 2 | 3 | 4 | 5
      weekday: ScheduledEventWeekday
    }
  | {
      frequency: "weekly"
      interval?: 1 | 2
      weekday: ScheduledEventWeekday
    }
  | {
      frequency: "yearly"
      month: number
      monthDay: number
    }

interface ScheduledEventRequestBase {
  action: ScheduledEventAction
  auditReason: string
  guildId: string
  operationKey: string
}

export interface CreateScheduledEventRequest extends ScheduledEventRequestBase {
  action: "create"
  coverImagePath?: string
  description?: string
  hosting: ScheduledEventHosting
  name: string
  recurrence?: ScheduledEventRecurrenceRequest
  scheduledEndTime?: string
  scheduledStartTime: string
}

export interface UpdateScheduledEventRequest extends ScheduledEventRequestBase {
  action: "update"
  coverImagePath?: string | null
  description?: string | null
  eventId: string
  hosting?: ScheduledEventHosting
  name?: string
  recurrence?: ScheduledEventRecurrenceRequest | null
  scheduledEndTime?: string
  scheduledStartTime?: string
}

export interface TransitionScheduledEventRequest extends ScheduledEventRequestBase {
  action: "transition"
  eventId: string
  targetStatus: ScheduledEventTransitionTarget
}

export interface DeleteScheduledEventRequest extends ScheduledEventRequestBase {
  action: "delete"
  eventId: string
}

export type ScheduledEventChangeRequest =
  | CreateScheduledEventRequest
  | DeleteScheduledEventRequest
  | TransitionScheduledEventRequest
  | UpdateScheduledEventRequest

interface NormalizedRequestBase {
  action: ScheduledEventAction
  auditReason: string
  guildId: string
  operationKeyHash: string
}

interface DailyRecurrencePattern {
  frequency: "daily"
  weekdays: ScheduledEventWeekday[] | null
}

interface MonthlyRecurrencePattern {
  frequency: "monthly"
  week: 1 | 2 | 3 | 4 | 5
  weekday: ScheduledEventWeekday
}

interface WeeklyRecurrencePattern {
  frequency: "weekly"
  interval: 1 | 2
  weekday: ScheduledEventWeekday
}

interface YearlyRecurrencePattern {
  frequency: "yearly"
  month: number
  monthDay: number
}

export type NormalizedScheduledEventRecurrence =
  | DailyRecurrencePattern
  | MonthlyRecurrencePattern
  | WeeklyRecurrencePattern
  | YearlyRecurrencePattern

export type NormalizedScheduledEventChangeRequest =
  | (Omit<
      CreateScheduledEventRequest,
      keyof ScheduledEventRequestBase | "hosting" | "recurrence"
    > & NormalizedRequestBase & {
      action: "create"
      hosting: ScheduledEventHosting
      recurrence?: NormalizedScheduledEventRecurrence
    })
  | (Omit<DeleteScheduledEventRequest, keyof ScheduledEventRequestBase>
    & NormalizedRequestBase
    & { action: "delete" })
  | (Omit<TransitionScheduledEventRequest, keyof ScheduledEventRequestBase>
    & NormalizedRequestBase
    & { action: "transition" })
  | (Omit<
      UpdateScheduledEventRequest,
      keyof ScheduledEventRequestBase | "hosting" | "recurrence"
    > & NormalizedRequestBase & {
      action: "update"
      hosting?: ScheduledEventHosting
      recurrence?: NormalizedScheduledEventRecurrence | null
    })

export interface ProjectedScheduledEventRecurrence {
  count: number | null
  endTime: string | null
  frequency: "daily" | "monthly" | "weekly" | "yearly"
  interval: number
  monthDays: number[] | null
  months: number[] | null
  numberedWeekdays: Array<{
    week: number
    weekday: ScheduledEventWeekday
  }> | null
  startTime: string
  weekdays: ScheduledEventWeekday[] | null
  yearDays: number[] | null
}

export interface ProjectedScheduledEvent {
  channelId: string | null
  creatorUserId: string | null
  description: string | null
  entityId: string | null
  entityType: ScheduledEventEntityType
  eventId: string
  guildId: string
  hasCoverImage: boolean
  location: string | null
  name: string
  privacyLevel: "guild-only"
  recurrence: ProjectedScheduledEventRecurrence | null
  scheduledEndTime: string | null
  scheduledStartTime: string
  status: ScheduledEventStatus
  subscriberCount: number | null
}

export type PlannedScheduledEvent = Omit<ProjectedScheduledEvent, "eventId"> & {
  eventId: string | null
}

export interface ScheduledEventAccessEvidence {
  administrator: boolean
  channelId: string | null
  confidence: "complete"
  effectivePermissions: string
  entityType: ScheduledEventEntityType
  guildOwner: boolean
  missingPermissions: []
  permissionScope: "channel" | "guild"
  requiredPermissions: DiscordPermissionName[]
}

export interface ScheduledEventChangePermissionEvidence {
  botOwned: boolean | null
  current: ScheduledEventAccessEvidence
  destination: ScheduledEventAccessEvidence | null
  ownershipRequired: boolean
}

export interface ScheduledEventPrivacyProjection {
  omittedFields: typeof SCHEDULED_EVENT_OMITTED_FIELDS
  privateFieldsProjectedOut: true
  subscriberIdentitiesExposed: false
}

export interface ScheduledEventInventoryResult {
  events: Array<{
    access: ScheduledEventAccessEvidence
    event: ProjectedScheduledEvent
  }>
  guild: {
    id: string
    name: string
  }
  page: {
    returned: number
    safetyLimit: number
    visibility: "connector-visible"
  }
  privacy: ScheduledEventPrivacyProjection
  schemaVersion: number
  status: "ok"
  subscriberCountsIncluded: boolean
}

export interface ScheduledEventLookupResult {
  access: ScheduledEventAccessEvidence
  event: ProjectedScheduledEvent
  guild: {
    id: string
    name: string
  }
  privacy: ScheduledEventPrivacyProjection
  schemaVersion: number
  status: "ok"
  subscriberCountIncluded: boolean
}

export interface ScheduledEventUserPageResult {
  access: ScheduledEventAccessEvidence
  event: ProjectedScheduledEvent
  guild: {
    id: string
    name: string
  }
  page: {
    nextAfter: string | null
    requestedAfter: string | null
    requestedLimit: number
    returned: number
  }
  privacy: {
    memberDataRequested: false
    omittedFields: typeof SCHEDULED_EVENT_USER_OMITTED_FIELDS
    persistence: "none"
    profileFieldsProjectedOut: true
    rawPayloads: "omitted"
    userIdsExposed: true
  }
  schemaVersion: number
  status: "ok"
  users: Array<{
    bot: boolean
    id: string
  }>
}

export interface ScheduledEventPlan {
  action: ScheduledEventAction
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  desired: PlannedScheduledEvent | null
  digest: string
  effect: "create" | "delete" | "none" | "transition" | "update"
  existing: ProjectedScheduledEvent | null
  file: {
    contentDigest: string
    review: ScheduledEventCoverFileReview
  } | null
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  permission: ScheduledEventChangePermissionEvidence
  privacy: ScheduledEventPrivacyProjection
  schemaVersion: number
  status: "already-current" | "planned"
  visibleInventory: {
    digest: string | null
    returned: number | null
    safetyLimit: number
    visibility: "connector-visible"
  }
  warnings: string[]
}

export interface ScheduledEventResult {
  action: ScheduledEventAction
  activityId: string | null
  eventId: string
  guildId: string
  observed: ProjectedScheduledEvent | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "completed-with-drift"
}

export interface ScheduledEventServiceClient extends Pick<
  DiscordClient,
  | "createGuildScheduledEvent"
  | "deleteGuildScheduledEvent"
  | "getGuild"
  | "getGuildChannels"
  | "getGuildMember"
  | "getGuildRoles"
  | "getGuildScheduledEvent"
  | "listGuildScheduledEvents"
  | "listGuildScheduledEventUsers"
  | "modifyGuildScheduledEvent"
> {}

export interface ScheduledEventServiceOptions {
  activityStore: ActivityStore
  client: ScheduledEventServiceClient
  clock?: () => Date
  fileRoots: readonly string[]
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface EventEvidenceState {
  botMember: DiscordGuildMember
  channels: DiscordChannel[]
  guild: DiscordGuild & { owner_id: string }
  guildPermissions: GuildMemberPermissionResult
  roles: DiscordRole[]
}

interface BuiltScheduledEventPlan {
  fileSnapshot: ScheduledEventCoverFileSnapshot | null
  plan: ScheduledEventPlan
}

const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const STATE_UNAVAILABLE = "scheduled-event-state-unavailable"
const SCHEDULED_EVENT_GUILD_LOCKS = new Map<string, Promise<"settled" | "uncertain">>()
const ENTITY_TYPE_NAMES: Readonly<Record<number, ScheduledEventEntityType>> = Object.freeze({
  [DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external]: "external",
  [DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.stage]: "stage",
  [DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.voice]: "voice",
})
const ENTITY_TYPE_VALUES: Readonly<Record<ScheduledEventEntityType, DiscordScheduledEventEntityType>> = Object.freeze({
  external: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.external,
  stage: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.stage,
  voice: DISCORD_SCHEDULED_EVENT_ENTITY_TYPES.voice,
})
const STATUS_NAMES: Readonly<Record<number, ScheduledEventStatus>> = Object.freeze({
  [DISCORD_SCHEDULED_EVENT_STATUSES.active]: "active",
  [DISCORD_SCHEDULED_EVENT_STATUSES.canceled]: "canceled",
  [DISCORD_SCHEDULED_EVENT_STATUSES.completed]: "completed",
  [DISCORD_SCHEDULED_EVENT_STATUSES.scheduled]: "scheduled",
})
const TRANSITION_STATUS_VALUES: Readonly<Record<
  ScheduledEventTransitionTarget,
  Exclude<DiscordScheduledEventStatus, 1>
>> = Object.freeze({
  active: DISCORD_SCHEDULED_EVENT_STATUSES.active,
  canceled: DISCORD_SCHEDULED_EVENT_STATUSES.canceled,
  completed: DISCORD_SCHEDULED_EVENT_STATUSES.completed,
})
const FREQUENCY_NAMES = Object.freeze({
  [DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.daily]: "daily",
  [DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.monthly]: "monthly",
  [DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.weekly]: "weekly",
  [DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.yearly]: "yearly",
} as const)
const WEEKDAY_VALUES: Readonly<Record<ScheduledEventWeekday, number>> = Object.freeze({
  friday: 4,
  monday: 0,
  saturday: 5,
  sunday: 6,
  thursday: 3,
  tuesday: 1,
  wednesday: 2,
})
const WEEKDAY_NAMES: Readonly<Record<number, ScheduledEventWeekday>> = Object.freeze({
  0: "monday",
  1: "tuesday",
  2: "wednesday",
  3: "thursday",
  4: "friday",
  5: "saturday",
  6: "sunday",
})
const DAILY_WEEKDAY_SETS: readonly ScheduledEventWeekday[][] = Object.freeze([
  ["monday", "tuesday", "wednesday", "thursday", "friday"],
  ["tuesday", "wednesday", "thursday", "friday", "saturday"],
  ["sunday", "monday", "tuesday", "wednesday", "thursday"],
  ["friday", "saturday"],
  ["saturday", "sunday"],
  ["sunday", "monday"],
])

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
  minimum: number,
  maximum: number,
  description: string,
): asserts value is string {
  if (
    typeof value !== "string"
    || value.length < minimum
    || value.length > maximum
    || value.trim() !== value
    || TEXT_CONTROL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `${description} must contain ${minimum}-${maximum} trimmed characters without controls`,
    )
  }
  assertValidUnicode(value, description)
}

function canonicalTimestamp(value: unknown, description: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new RangeError(`${description} must be an ISO 8601 timestamp with an offset`)
  }
  return new Date(Date.parse(value)).toISOString()
}

function normalizeHosting(value: unknown): ScheduledEventHosting {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord scheduled event hosting must be an object")
  }
  const hosting = value as Record<string, unknown>
  if (hosting.entityType === "external") {
    if (Object.keys(hosting).sort().join("\0") !== "entityType\0location") {
      throw new RangeError("Discord external scheduled event hosting fields are invalid")
    }
    assertText(
      hosting.location,
      1,
      DISCORD_LIMITS.scheduledEventLocationCharacters,
      "Discord scheduled event location",
    )
    return { entityType: "external", location: hosting.location }
  }
  if (hosting.entityType !== "stage" && hosting.entityType !== "voice") {
    throw new RangeError("Discord scheduled event entity type is invalid")
  }
  if (Object.keys(hosting).sort().join("\0") !== "channelId\0entityType") {
    throw new RangeError("Discord channel scheduled event hosting fields are invalid")
  }
  assertSnowflake(hosting.channelId, "Discord scheduled event channel ID")
  return {
    channelId: hosting.channelId,
    entityType: hosting.entityType,
  }
}

function weekday(value: unknown): ScheduledEventWeekday {
  if (
    typeof value !== "string"
    || !(SCHEDULED_EVENT_WEEKDAYS as readonly string[]).includes(value)
  ) {
    throw new RangeError("Discord scheduled event recurrence weekday is invalid")
  }
  return value as ScheduledEventWeekday
}

function sameWeekdaySet(
  left: readonly ScheduledEventWeekday[],
  right: readonly ScheduledEventWeekday[],
): boolean {
  return left.length === right.length
    && left.every((entry) => right.includes(entry))
}

function normalizeRecurrence(
  value: ScheduledEventRecurrenceRequest,
): NormalizedScheduledEventRecurrence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord scheduled event recurrence must be an object")
  }
  if (value.frequency === "daily") {
    const keys = Object.keys(value).sort().join("\0")
    if (keys !== "frequency" && keys !== "frequency\0weekdays") {
      throw new RangeError("Discord daily recurrence fields are invalid")
    }
    if (value.weekdays === undefined) {
      return { frequency: "daily", weekdays: null }
    }
    if (
      !Array.isArray(value.weekdays)
      || value.weekdays.length < 1
      || new Set(value.weekdays).size !== value.weekdays.length
    ) {
      throw new RangeError("Discord daily recurrence weekdays are invalid")
    }
    const weekdays = value.weekdays.map(weekday)
    const canonical = DAILY_WEEKDAY_SETS.find((candidate) => (
      sameWeekdaySet(candidate, weekdays)
    ))
    if (!canonical) {
      throw new RangeError("Discord daily recurrence must use a documented weekday set")
    }
    return { frequency: "daily", weekdays: [...canonical] }
  }
  if (value.frequency === "weekly") {
    const keys = Object.keys(value).sort().join("\0")
    if (keys !== "frequency\0weekday" && keys !== "frequency\0interval\0weekday") {
      throw new RangeError("Discord weekly recurrence fields are invalid")
    }
    const interval = value.interval ?? 1
    if (interval !== 1 && interval !== 2) {
      throw new RangeError("Discord weekly recurrence interval must be 1 or 2")
    }
    return {
      frequency: "weekly",
      interval,
      weekday: weekday(value.weekday),
    }
  }
  if (value.frequency === "monthly") {
    if (Object.keys(value).sort().join("\0") !== "frequency\0week\0weekday") {
      throw new RangeError("Discord monthly recurrence fields are invalid")
    }
    if (!Number.isInteger(value.week) || value.week < 1 || value.week > 5) {
      throw new RangeError("Discord monthly recurrence week must be between 1 and 5")
    }
    return {
      frequency: "monthly",
      week: value.week,
      weekday: weekday(value.weekday),
    }
  }
  if (value.frequency === "yearly") {
    if (Object.keys(value).sort().join("\0") !== "frequency\0month\0monthDay") {
      throw new RangeError("Discord yearly recurrence fields are invalid")
    }
    if (
      !Number.isInteger(value.month)
      || value.month < 1
      || value.month > 12
      || !Number.isInteger(value.monthDay)
      || value.monthDay < 1
      || value.monthDay > 31
    ) {
      throw new RangeError("Discord yearly recurrence date is invalid")
    }
    const date = new Date(Date.UTC(2000, value.month - 1, value.monthDay))
    if (
      date.getUTCMonth() !== value.month - 1
      || date.getUTCDate() !== value.monthDay
    ) {
      throw new RangeError("Discord yearly recurrence date is invalid")
    }
    return {
      frequency: "yearly",
      month: value.month,
      monthDay: value.monthDay,
    }
  }
  throw new RangeError("Discord scheduled event recurrence frequency is invalid")
}

function normalizeCoverPath(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 4_096
    || value.trim() !== value
    || value.includes("\0")
  ) {
    throw new RangeError("Discord scheduled event cover path is invalid")
  }
  return value
}

export function normalizeScheduledEventChangeRequest(
  request: ScheduledEventChangeRequest,
): NormalizedScheduledEventChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord scheduled event change request must be an object")
  }
  assertSnowflake(request.guildId, "Discord scheduled event guild ID")
  if (!["create", "delete", "transition", "update"].includes(request.action)) {
    throw new RangeError("Discord scheduled event action is invalid")
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord scheduled event audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  const base: NormalizedRequestBase = {
    action: request.action,
    auditReason: request.auditReason,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
  if (request.action === "create") {
    assertText(
      request.name,
      1,
      DISCORD_LIMITS.scheduledEventNameCharacters,
      "Discord scheduled event name",
    )
    if (request.description !== undefined) {
      assertText(
        request.description,
        1,
        DISCORD_LIMITS.scheduledEventDescriptionCharacters,
        "Discord scheduled event description",
      )
    }
    const scheduledStartTime = canonicalTimestamp(
      request.scheduledStartTime,
      "Discord scheduled event start time",
    )
    const scheduledEndTime = request.scheduledEndTime === undefined
      ? undefined
      : canonicalTimestamp(
          request.scheduledEndTime,
          "Discord scheduled event end time",
        )
    if (
      scheduledEndTime !== undefined
      && Date.parse(scheduledEndTime) <= Date.parse(scheduledStartTime)
    ) {
      throw new RangeError("Discord scheduled event end time must be after its start")
    }
    const hosting = normalizeHosting(request.hosting)
    if (hosting.entityType === "external" && scheduledEndTime === undefined) {
      throw new RangeError("Discord external scheduled event requires an end time")
    }
    return {
      ...base,
      action: "create",
      ...(request.coverImagePath !== undefined
        ? { coverImagePath: normalizeCoverPath(request.coverImagePath) }
        : {}),
      ...(request.description !== undefined
        ? { description: request.description }
        : {}),
      hosting,
      name: request.name,
      ...(request.recurrence !== undefined
        ? { recurrence: normalizeRecurrence(request.recurrence) }
        : {}),
      ...(scheduledEndTime !== undefined ? { scheduledEndTime } : {}),
      scheduledStartTime,
    }
  }
  assertSnowflake(request.eventId, "Discord scheduled event ID")
  if (request.action === "delete") {
    return { ...base, action: "delete", eventId: request.eventId }
  }
  if (request.action === "transition") {
    if (!(["active", "canceled", "completed"] as const).includes(request.targetStatus)) {
      throw new RangeError("Discord scheduled event transition target is invalid")
    }
    return {
      ...base,
      action: "transition",
      eventId: request.eventId,
      targetStatus: request.targetStatus,
    }
  }
  if (
    request.name === undefined
    && request.description === undefined
    && request.scheduledStartTime === undefined
    && request.scheduledEndTime === undefined
    && request.hosting === undefined
    && request.recurrence === undefined
    && request.coverImagePath === undefined
  ) {
    throw new RangeError("Discord scheduled event update must contain a change")
  }
  if (request.name !== undefined) {
    assertText(
      request.name,
      1,
      DISCORD_LIMITS.scheduledEventNameCharacters,
      "Discord scheduled event name",
    )
  }
  if (request.description !== undefined && request.description !== null) {
    assertText(
      request.description,
      1,
      DISCORD_LIMITS.scheduledEventDescriptionCharacters,
      "Discord scheduled event description",
    )
  }
  const scheduledStartTime = request.scheduledStartTime === undefined
    ? undefined
    : canonicalTimestamp(
        request.scheduledStartTime,
        "Discord scheduled event start time",
      )
  const scheduledEndTime = request.scheduledEndTime === undefined
    ? undefined
    : canonicalTimestamp(
        request.scheduledEndTime,
        "Discord scheduled event end time",
      )
  return {
    ...base,
    action: "update",
    ...(request.coverImagePath !== undefined
      ? {
          coverImagePath: request.coverImagePath === null
            ? null
            : normalizeCoverPath(request.coverImagePath),
        }
      : {}),
    ...(request.description !== undefined
      ? { description: request.description }
      : {}),
    eventId: request.eventId,
    ...(request.hosting !== undefined
      ? { hosting: normalizeHosting(request.hosting) }
      : {}),
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.recurrence !== undefined
      ? {
          recurrence: request.recurrence === null
            ? null
            : normalizeRecurrence(request.recurrence),
        }
      : {}),
    ...(scheduledEndTime !== undefined ? { scheduledEndTime } : {}),
    ...(scheduledStartTime !== undefined ? { scheduledStartTime } : {}),
  }
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
    throw new ScheduledEventEvidenceError(
      "Discord returned invalid scheduled event guild evidence",
    )
  }
  try {
    assertValidUnicode(guild.name, "Discord guild name")
  } catch (error) {
    throw new ScheduledEventEvidenceError(
      "Discord returned invalid scheduled event guild evidence",
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
    throw new ScheduledEventEvidenceError(
      "Discord returned invalid scheduled event bot-member evidence",
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
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event role inventory",
    )
  }
  const seen = new Set<string>()
  for (const role of roles) {
    if (
      !role
      || typeof role !== "object"
      || !validSnowflake(role.id)
      || seen.has(role.id)
      || typeof role.permissions !== "string"
      || !/^(0|[1-9][0-9]*)$/u.test(role.permissions)
      || !Number.isInteger(role.position)
      || role.position < 0
      || typeof role.managed !== "boolean"
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned an invalid scheduled event role inventory",
      )
    }
    seen.add(role.id)
  }
  if (!seen.has(guildId)) {
    throw new ScheduledEventEvidenceError(
      "Discord scheduled event role inventory omitted the @everyone role",
    )
  }
  return [...roles]
}

function exactChannels(
  channels: readonly DiscordChannel[],
  guildId: string,
): DiscordChannel[] {
  if (
    !Array.isArray(channels)
    || channels.length > DISCORD_LIMITS.guildChannels
  ) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event channel inventory",
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
      || !(channel.guild_id === undefined || channel.guild_id === guildId)
      || !Array.isArray(channel.permission_overwrites)
      || channel.permission_overwrites.length > DISCORD_LIMITS.channelPermissionOverwrites
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned an invalid scheduled event channel inventory",
      )
    }
    const overwriteIds = new Set<string>()
    for (const overwrite of channel.permission_overwrites) {
      if (
        !overwrite
        || typeof overwrite !== "object"
        || !validSnowflake(overwrite.id)
        || overwriteIds.has(`${overwrite.type}:${overwrite.id}`)
        || (overwrite.type !== 0 && overwrite.type !== 1)
        || !(overwrite.allow === undefined || overwrite.allow === null
          || /^(0|[1-9][0-9]*)$/u.test(overwrite.allow))
        || !(overwrite.deny === undefined || overwrite.deny === null
          || /^(0|[1-9][0-9]*)$/u.test(overwrite.deny))
      ) {
        throw new ScheduledEventEvidenceError(
          "Discord returned invalid scheduled event channel overwrite evidence",
        )
      }
      overwriteIds.add(`${overwrite.type}:${overwrite.id}`)
    }
    seen.add(channel.id)
  }
  return [...channels]
}

function projectedRecurrence(
  recurrence: DiscordScheduledEventRecurrenceRule | null,
): ProjectedScheduledEventRecurrence | null {
  if (recurrence === null) return null
  const frequency = FREQUENCY_NAMES[recurrence.frequency]
  if (!frequency) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an unsupported scheduled event recurrence frequency",
    )
  }
  const mapWeekday = (value: number): ScheduledEventWeekday => {
    const result = WEEKDAY_NAMES[value]
    if (!result) {
      throw new ScheduledEventEvidenceError(
        "Discord returned an unsupported scheduled event recurrence weekday",
      )
    }
    return result
  }
  return {
    count: recurrence.count,
    endTime: recurrence.endTime,
    frequency,
    interval: recurrence.interval,
    monthDays: recurrence.byMonthDay === null ? null : [...recurrence.byMonthDay],
    months: recurrence.byMonth === null ? null : [...recurrence.byMonth],
    numberedWeekdays: recurrence.byNWeekday === null
      ? null
      : recurrence.byNWeekday.map((entry) => ({
          week: entry.n,
          weekday: mapWeekday(entry.day),
        })),
    startTime: recurrence.startTime,
    weekdays: recurrence.byWeekday === null
      ? null
      : recurrence.byWeekday.map(mapWeekday),
    yearDays: recurrence.byYearDay === null ? null : [...recurrence.byYearDay],
  }
}

function projectedEvent(event: DiscordScheduledEventSummary): ProjectedScheduledEvent {
  const entityType = ENTITY_TYPE_NAMES[event.entityType]
  const status = STATUS_NAMES[event.status]
  if (!entityType || !status) {
    throw new ScheduledEventEvidenceError(
      "Discord returned unsupported scheduled event metadata",
    )
  }
  return {
    channelId: event.channelId,
    creatorUserId: event.creatorUserId,
    description: event.description,
    entityId: event.entityId,
    entityType,
    eventId: event.id,
    guildId: event.guildId,
    hasCoverImage: event.hasCoverImage,
    location: event.location,
    name: event.name,
    privacyLevel: "guild-only",
    recurrence: projectedRecurrence(event.recurrenceRule),
    scheduledEndTime: event.scheduledEndTime,
    scheduledStartTime: event.scheduledStartTime,
    status,
    subscriberCount: event.subscriberCount,
  }
}

function exactEvents(
  events: readonly DiscordScheduledEventSummary[],
  guildId: string,
): ProjectedScheduledEvent[] {
  if (!Array.isArray(events) || events.length > DISCORD_LIMITS.scheduledEvents) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid scheduled event inventory",
    )
  }
  const projected = events.map(projectedEvent)
  const seen = new Set<string>()
  for (const event of projected) {
    if (event.guildId !== guildId || seen.has(event.eventId)) {
      throw new ScheduledEventEvidenceError(
        "Discord returned invalid or duplicate scheduled event identities",
      )
    }
    seen.add(event.eventId)
  }
  return projected.sort((left, right) => {
    const leftId = BigInt(left.eventId)
    const rightId = BigInt(right.eventId)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

function privacyProjection(): ScheduledEventPrivacyProjection {
  return {
    omittedFields: SCHEDULED_EVENT_OMITTED_FIELDS,
    privateFieldsProjectedOut: true,
    subscriberIdentitiesExposed: false,
  }
}

function exactScheduledEventUsers(
  value: readonly DiscordScheduledEventUserSummary[],
  eventId: string,
  limit: number,
  after: string | undefined,
): Array<{ bot: boolean; id: string }> {
  if (!Array.isArray(value) || value.length > limit) {
    throw new ScheduledEventEvidenceError(
      "Discord returned an invalid bounded scheduled event user page",
    )
  }
  const users: Array<{ bot: boolean; id: string }> = []
  let previousId = after === undefined ? 0n : BigInt(after)
  for (const user of value) {
    if (
      !user
      || typeof user !== "object"
      || Array.isArray(user)
      || user.eventId !== eventId
      || !validSnowflake(user.userId)
      || typeof user.bot !== "boolean"
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord returned invalid scheduled event user identity evidence",
      )
    }
    const userId = BigInt(user.userId)
    if (userId <= previousId) {
      throw new ScheduledEventEvidenceError(
        "Discord returned unordered or duplicate scheduled event user identities",
      )
    }
    users.push({ bot: user.bot, id: user.userId })
    previousId = userId
  }
  return users
}

function scheduledEventUserPrivacy(): ScheduledEventUserPageResult["privacy"] {
  return {
    memberDataRequested: false,
    omittedFields: SCHEDULED_EVENT_USER_OMITTED_FIELDS,
    persistence: "none",
    profileFieldsProjectedOut: true,
    rawPayloads: "omitted",
    userIdsExposed: true,
  }
}

function channelForEvent(
  state: EventEvidenceState,
  entityType: ScheduledEventEntityType,
  channelId: string | null,
): DiscordChannel | null {
  if (entityType === "external") {
    if (channelId !== null) {
      throw new ScheduledEventEvidenceError(
        "Discord external scheduled event unexpectedly references a channel",
      )
    }
    return null
  }
  if (channelId === null) {
    throw new ScheduledEventEvidenceError(
      "Discord channel scheduled event omitted its channel",
    )
  }
  const channel = state.channels.find((candidate) => candidate.id === channelId)
  if (!channel) {
    throw new ScheduledEventEvidenceError(
      "Discord scheduled event channel is absent from the visible guild inventory",
    )
  }
  const expected = entityType === "stage"
    ? DISCORD_CHANNEL_TYPES.stageVoice
    : DISCORD_CHANNEL_TYPES.voice
  if (channel.type !== expected) {
    throw new ScheduledEventEvidenceError(
      `Discord ${entityType} scheduled event references the wrong channel type`,
    )
  }
  return channel
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

function accessEvidence(
  state: EventEvidenceState,
  entityType: ScheduledEventEntityType,
  channelId: string | null,
  requiredPermissions: readonly DiscordPermissionName[],
): ScheduledEventAccessEvidence {
  const guildOwner = state.guild.owner_id === state.botMember.user?.id
  const channel = channelForEvent(state, entityType, channelId)
  let administrator: boolean
  let effectivePermissions: string
  let confidence: "complete" | "partial"
  if (channel === null) {
    administrator = state.guildPermissions.administrator
    effectivePermissions = state.guildPermissions.effectivePermissions
    confidence = state.guildPermissions.complete ? "complete" : "partial"
  } else {
    let result: BotChannelPermissionResult
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
      throw new ScheduledEventEvidenceError(
        `Discord scheduled event channel permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    administrator = result.administrator
    effectivePermissions = result.effectivePermissions
    confidence = result.confidence
  }
  if (confidence !== "complete") {
    throw new ScheduledEventEvidenceError(
      "Discord scheduled event permission evidence is incomplete",
    )
  }
  const missingPermissions = permissionNamesMissing(
    effectivePermissions,
    administrator,
    guildOwner,
    requiredPermissions,
  )
  if (missingPermissions.length > 0) {
    throw new ScheduledEventEvidenceError(
      `Discord connector bot lacks scheduled event permissions: ${missingPermissions.join(", ")}`,
    )
  }
  return {
    administrator,
    channelId,
    confidence: "complete",
    effectivePermissions,
    entityType,
    guildOwner,
    missingPermissions: [],
    permissionScope: channel === null ? "guild" : "channel",
    requiredPermissions: [...requiredPermissions],
  }
}

function readPermissions(entityType: ScheduledEventEntityType): DiscordPermissionName[] {
  return entityType === "external" ? [] : ["VIEW_CHANNEL"]
}

function createPermissions(entityType: ScheduledEventEntityType): DiscordPermissionName[] {
  if (entityType === "external") return ["CREATE_EVENTS"]
  if (entityType === "voice") {
    return ["CREATE_EVENTS", "VIEW_CHANNEL", "CONNECT"]
  }
  return ["CREATE_EVENTS", "MANAGE_CHANNELS", "MUTE_MEMBERS", "MOVE_MEMBERS"]
}

function modifyChannelPermissions(
  entityType: ScheduledEventEntityType,
): DiscordPermissionName[] {
  if (entityType === "external") return []
  if (entityType === "voice") return ["VIEW_CHANNEL", "CONNECT"]
  return ["MANAGE_CHANNELS", "MUTE_MEMBERS", "MOVE_MEMBERS"]
}

function hasEffectivePermission(
  evidence: ScheduledEventAccessEvidence,
  permission: DiscordPermissionName,
): boolean {
  if (evidence.administrator || evidence.guildOwner) return true
  const bits = BigInt(evidence.effectivePermissions)
  return (bits & DISCORD_PERMISSIONS[permission]) === DISCORD_PERMISSIONS[permission]
}

function hostingForEvent(event: ProjectedScheduledEvent): ScheduledEventHosting {
  if (event.entityType === "external") {
    if (event.location === null) {
      throw new ScheduledEventEvidenceError(
        "Discord external scheduled event lacks a location",
      )
    }
    return { entityType: "external", location: event.location }
  }
  if (event.channelId === null) {
    throw new ScheduledEventEvidenceError(
      "Discord channel scheduled event lacks a channel",
    )
  }
  return { channelId: event.channelId, entityType: event.entityType }
}

function hostingIdentity(hosting: ScheduledEventHosting): string {
  return hosting.entityType === "external"
    ? `external:${hosting.location}`
    : `${hosting.entityType}:${hosting.channelId}`
}

function recurrenceInput(
  recurrence: NormalizedScheduledEventRecurrence,
  startTime: string,
): DiscordScheduledEventRecurrenceInput {
  if (recurrence.frequency === "daily") {
    return {
      byMonth: null,
      byMonthDay: null,
      byNWeekday: null,
      byWeekday: recurrence.weekdays === null
        ? null
        : recurrence.weekdays.map((entry) => WEEKDAY_VALUES[entry]),
      frequency: DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.daily,
      interval: 1,
      startTime,
    }
  }
  if (recurrence.frequency === "weekly") {
    return {
      byMonth: null,
      byMonthDay: null,
      byNWeekday: null,
      byWeekday: [WEEKDAY_VALUES[recurrence.weekday]],
      frequency: DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.weekly,
      interval: recurrence.interval,
      startTime,
    }
  }
  if (recurrence.frequency === "monthly") {
    return {
      byMonth: null,
      byMonthDay: null,
      byNWeekday: [{
        day: WEEKDAY_VALUES[recurrence.weekday],
        n: recurrence.week,
      }],
      byWeekday: null,
      frequency: DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.monthly,
      interval: 1,
      startTime,
    }
  }
  return {
    byMonth: [recurrence.month],
    byMonthDay: [recurrence.monthDay],
    byNWeekday: null,
    byWeekday: null,
    frequency: DISCORD_SCHEDULED_EVENT_RECURRENCE_FREQUENCIES.yearly,
    interval: 1,
    startTime,
  }
}

function projectedInputRecurrence(
  recurrence: NormalizedScheduledEventRecurrence,
  startTime: string,
): ProjectedScheduledEventRecurrence {
  const input = recurrenceInput(recurrence, startTime)
  return projectedRecurrence({
    ...input,
    byYearDay: null,
    count: null,
    endTime: null,
  })!
}

function roleSnapshot(
  roles: readonly DiscordRole[],
  appliedRoleIds: readonly string[],
) {
  const relevant = new Set(appliedRoleIds)
  return roles
    .filter((role) => relevant.has(role.id))
    .map((role) => ({
      id: role.id,
      managed: role.managed,
      permissions: role.permissions,
      position: role.position,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function controlledEvent(event: PlannedScheduledEvent) {
  return {
    channelId: event.channelId,
    creatorUserId: event.creatorUserId,
    description: event.description,
    entityType: event.entityType,
    eventId: event.eventId,
    guildId: event.guildId,
    hasCoverImage: event.hasCoverImage,
    location: event.location,
    name: event.name,
    privacyLevel: event.privacyLevel,
    recurrence: event.recurrence,
    scheduledEndTime: event.scheduledEndTime,
    scheduledStartTime: event.scheduledStartTime,
    status: event.status,
  }
}

function sameControlledEvent(
  left: PlannedScheduledEvent,
  right: PlannedScheduledEvent,
): boolean {
  return JSON.stringify(controlledEvent(left)) === JSON.stringify(controlledEvent(right))
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "UnknownError"
}

function targetId(request: NormalizedScheduledEventChangeRequest): string | null {
  return request.action === "create" ? null : request.eventId
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    eventId: receipt.resourceId,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  entityType: ScheduledEventEntityType
  error?: string | null
  eventId?: string | null
  plan: ScheduledEventPlan
  request: NormalizedScheduledEventChangeRequest
  status: ScheduledEventActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): ScheduledEventActivity {
  return {
    action: options.request.action,
    entityType: options.entityType,
    error: options.error ?? null,
    eventId: options.eventId === undefined
      ? targetId(options.request)
      : options.eventId,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "scheduled-event-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    targetStatus: options.request.action === "transition"
      ? options.request.targetStatus
      : null,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  eventId?: string | null
  plan: ScheduledEventPlan
  request: NormalizedScheduledEventChangeRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "scheduled-event-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.eventId ?? targetId(options.request),
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof ScheduledEventExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
}

async function withGuildLock<T>(
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => ScheduledEventExecutionError,
): Promise<T> {
  const prior = SCHEDULED_EVENT_GUILD_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: "settled" | "uncertain") => void = () => undefined
  const tail = new Promise<"settled" | "uncertain">((resolve) => {
    release = resolve
  })
  SCHEDULED_EVENT_GUILD_LOCKS.set(guildId, tail)
  let outcome: "settled" | "uncertain" = "settled"
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
    if (SCHEDULED_EVENT_GUILD_LOCKS.get(guildId) === tail) {
      SCHEDULED_EVENT_GUILD_LOCKS.delete(guildId)
    }
  }
}

export class ScheduledEventService {
  readonly #activityStore: ActivityStore
  readonly #client: ScheduledEventServiceClient
  readonly #clock: () => Date
  readonly #fileRoots: readonly string[]
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: ScheduledEventServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#fileRoots = [...options.fileRoots]
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
  ): Promise<EventEvidenceState> {
    assertSnowflake(botId, "Discord connector bot ID")
    assertSnowflake(guildId, "Discord scheduled event guild ID")
    if (mode === "change") {
      this.#policy.assertScheduledEventChangeAllowed(guildId)
    } else {
      this.#policy.assertScheduledEventAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "scheduled-event-change",
        operationKeyHashValue,
      )
      if (receipt) {
        throw new ScheduledEventOperationConflictError(receiptView(receipt))
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
      throw new ScheduledEventEvidenceError(
        `Discord scheduled event guild permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    if (!guildPermissions.complete) {
      throw new ScheduledEventEvidenceError(
        "Discord scheduled event guild permission evidence is incomplete",
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
    options: ScheduledEventReadOptions = {},
  ): Promise<ScheduledEventInventoryResult> {
    this.#policy.assertScheduledEventAuditable(guildId)
    const [state, rawEvents] = await Promise.all([
      this.#evidence(botId, guildId, "audit", options),
      this.#client.listGuildScheduledEvents(guildId, options),
    ])
    const events = exactEvents(rawEvents, guildId).map((event) => ({
      access: accessEvidence(
        state,
        event.entityType,
        event.channelId,
        readPermissions(event.entityType),
      ),
      event,
    }))
    return {
      events,
      guild: { id: guildId, name: state.guild.name },
      page: {
        returned: events.length,
        safetyLimit: DISCORD_LIMITS.scheduledEvents,
        visibility: "connector-visible",
      },
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      subscriberCountsIncluded: options.includeSubscriberCount === true,
    }
  }

  async get(
    botId: string,
    guildId: string,
    eventId: string,
    options: ScheduledEventReadOptions = {},
  ): Promise<ScheduledEventLookupResult> {
    assertSnowflake(eventId, "Discord scheduled event ID")
    this.#policy.assertScheduledEventAuditable(guildId)
    const [state, rawEvent] = await Promise.all([
      this.#evidence(botId, guildId, "audit", options),
      this.#client.getGuildScheduledEvent(guildId, eventId, options),
    ])
    const event = projectedEvent(rawEvent)
    if (event.guildId !== guildId || event.eventId !== eventId) {
      throw new ScheduledEventEvidenceError(
        "Discord returned another scheduled event for an exact lookup",
      )
    }
    return {
      access: accessEvidence(
        state,
        event.entityType,
        event.channelId,
        readPermissions(event.entityType),
      ),
      event,
      guild: { id: guildId, name: state.guild.name },
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      subscriberCountIncluded: options.includeSubscriberCount === true,
    }
  }

  async listUsers(
    botId: string,
    guildId: string,
    eventId: string,
    options: ScheduledEventUserPageOptions = {},
  ): Promise<ScheduledEventUserPageResult> {
    assertSnowflake(eventId, "Discord scheduled event ID")
    if (options.after !== undefined) {
      assertSnowflake(options.after, "Discord scheduled event user cursor")
    }
    const limit = options.limit ?? CONNECTOR_LIMITS.scheduledEventUserPageDefault
    if (
      !Number.isInteger(limit)
      || limit < 1
      || limit > DISCORD_LIMITS.scheduledEventUsers
    ) {
      throw new RangeError(
        `Discord scheduled event user page limit must be an integer between 1 and ${DISCORD_LIMITS.scheduledEventUsers}`,
      )
    }
    this.#policy.assertScheduledEventUsersAuditable(guildId)
    const requestOptions = options.signal ? { signal: options.signal } : {}
    const [state, rawEvent] = await Promise.all([
      this.#evidence(botId, guildId, "audit", requestOptions),
      this.#client.getGuildScheduledEvent(guildId, eventId, requestOptions),
    ])
    const event = projectedEvent(rawEvent)
    if (event.guildId !== guildId || event.eventId !== eventId) {
      throw new ScheduledEventEvidenceError(
        "Discord returned another scheduled event for an exact user audit",
      )
    }
    const access = accessEvidence(
      state,
      event.entityType,
      event.channelId,
      readPermissions(event.entityType),
    )
    const rawUsers = await this.#client.listGuildScheduledEventUsers(
      guildId,
      eventId,
      {
        ...(options.after ? { after: options.after } : {}),
        limit,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    )
    const users = exactScheduledEventUsers(rawUsers, eventId, limit, options.after)
    return {
      access,
      event,
      guild: { id: guildId, name: state.guild.name },
      page: {
        nextAfter: users.length === limit ? users.at(-1)?.id ?? null : null,
        requestedAfter: options.after ?? null,
        requestedLimit: limit,
        returned: users.length,
      },
      privacy: scheduledEventUserPrivacy(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      users,
    }
  }

  #changePermission(
    state: EventEvidenceState,
    botId: string,
    event: ProjectedScheduledEvent,
  ): ScheduledEventChangePermissionEvidence {
    const base = accessEvidence(
      state,
      event.entityType,
      event.channelId,
      modifyChannelPermissions(event.entityType),
    )
    const botOwned = event.creatorUserId === null
      ? null
      : event.creatorUserId === botId
    const manageEvents = hasEffectivePermission(base, "MANAGE_EVENTS")
    const createEvents = hasEffectivePermission(base, "CREATE_EVENTS")
    let ownershipRequired = false
    let authority: DiscordPermissionName
    if (manageEvents) {
      authority = "MANAGE_EVENTS"
    } else if (botOwned === true && createEvents) {
      authority = "CREATE_EVENTS"
      ownershipRequired = true
    } else {
      throw new ScheduledEventEvidenceError(
        "Discord connector bot lacks authority over this scheduled event; MANAGE_EVENTS or bot ownership with CREATE_EVENTS is required",
      )
    }
    return {
      botOwned,
      current: accessEvidence(
        state,
        event.entityType,
        event.channelId,
        [authority, ...modifyChannelPermissions(event.entityType)],
      ),
      destination: null,
      ownershipRequired,
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedScheduledEventChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltScheduledEventPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#evidence(
      botId,
      request.guildId,
      "change",
      options,
      request.operationKeyHash,
    )
    let existing: ProjectedScheduledEvent | null = null
    let inventory: ProjectedScheduledEvent[] = []
    if (request.action === "create") {
      inventory = exactEvents(
        await this.#client.listGuildScheduledEvents(request.guildId, options),
        request.guildId,
      )
      for (const event of inventory) {
        accessEvidence(
          state,
          event.entityType,
          event.channelId,
          readPermissions(event.entityType),
        )
      }
      if (inventory.length >= DISCORD_LIMITS.scheduledEvents) {
        throw new ScheduledEventEvidenceError(
          `Discord scheduled event inventory reached the local ${DISCORD_LIMITS.scheduledEvents}-item safety limit`,
        )
      }
    } else {
      const rawEvent = await this.#client.getGuildScheduledEvent(
        request.guildId,
        request.eventId,
        options,
      )
      existing = projectedEvent(rawEvent)
      if (
        existing.guildId !== request.guildId
        || existing.eventId !== request.eventId
      ) {
        throw new ScheduledEventEvidenceError(
          "Discord returned another scheduled event for an exact change target",
        )
      }
    }

    let permission: ScheduledEventChangePermissionEvidence
    if (request.action === "create") {
      const hosting = request.hosting
      const current = accessEvidence(
        state,
        hosting.entityType,
        hosting.entityType === "external" ? null : hosting.channelId,
        createPermissions(hosting.entityType),
      )
      permission = {
        botOwned: null,
        current,
        destination: null,
        ownershipRequired: false,
      }
    } else {
      permission = this.#changePermission(state, botId, existing!)
    }

    if (
      request.action === "update"
      && (existing!.status === "canceled" || existing!.status === "completed")
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord terminal scheduled events cannot be updated",
      )
    }
    if (
      request.action === "update"
      && existing!.status === "active"
      && (
        request.hosting !== undefined
        || request.recurrence !== undefined
        || request.scheduledEndTime !== undefined
        || request.scheduledStartTime !== undefined
      )
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord active scheduled events allow only name, description, or cover updates through this connector",
      )
    }

    const now = this.#clock()
    if (Number.isNaN(now.getTime())) {
      throw new ScheduledEventEvidenceError(
        "Discord scheduled event planning clock is invalid",
      )
    }
    if (
      (
        request.action === "create"
        && Date.parse(request.scheduledStartTime) <= now.getTime()
      ) || (
        request.action === "update"
        && request.scheduledStartTime !== undefined
        && Date.parse(request.scheduledStartTime) <= now.getTime()
      )
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord scheduled event start time must remain in the future",
      )
    }

    let fileSnapshot: ScheduledEventCoverFileSnapshot | null = null
    if (
      (
        request.action === "create"
        && request.coverImagePath !== undefined
      ) || (
        request.action === "update"
        && typeof request.coverImagePath === "string"
      )
    ) {
      fileSnapshot = await readScheduledEventCoverFileSnapshot({
        filePath: request.coverImagePath as string,
        planKey: this.#planKey,
        roots: this.#fileRoots,
      })
    }

    let desired: PlannedScheduledEvent | null
    if (request.action === "delete") {
      desired = null
    } else if (request.action === "create") {
      const hosting = request.hosting
      desired = {
        channelId: hosting.entityType === "external" ? null : hosting.channelId,
        creatorUserId: botId,
        description: request.description ?? null,
        entityId: null,
        entityType: hosting.entityType,
        eventId: null,
        guildId: request.guildId,
        hasCoverImage: fileSnapshot !== null,
        location: hosting.entityType === "external" ? hosting.location : null,
        name: request.name,
        privacyLevel: "guild-only",
        recurrence: request.recurrence === undefined
          ? null
          : projectedInputRecurrence(
              request.recurrence,
              request.scheduledStartTime,
            ),
        scheduledEndTime: request.scheduledEndTime ?? null,
        scheduledStartTime: request.scheduledStartTime,
        status: "scheduled",
        subscriberCount: null,
      }
    } else if (request.action === "transition") {
      if (existing!.status === request.targetStatus) {
        desired = { ...existing! }
      } else {
        const valid = (
          existing!.status === "scheduled"
          && (request.targetStatus === "active" || request.targetStatus === "canceled")
        ) || (
          existing!.status === "active"
          && request.targetStatus === "completed"
        )
        if (!valid) {
          throw new ScheduledEventEvidenceError(
            `Discord scheduled event transition ${existing!.status} to ${request.targetStatus} is invalid`,
          )
        }
        desired = { ...existing!, status: request.targetStatus }
      }
    } else {
      if (
        request.scheduledStartTime !== undefined
        && existing!.recurrence !== null
        && request.recurrence === undefined
      ) {
        throw new ScheduledEventEvidenceError(
          "Discord recurring event start changes require an explicit recurrence replacement or removal",
        )
      }
      const hosting = request.hosting ?? hostingForEvent(existing!)
      const scheduledStartTime = request.scheduledStartTime
        ?? existing!.scheduledStartTime
      const scheduledEndTime = request.scheduledEndTime
        ?? existing!.scheduledEndTime
      if (hosting.entityType === "external" && scheduledEndTime === null) {
        throw new ScheduledEventEvidenceError(
          "Discord external scheduled event requires an end time",
        )
      }
      if (
        scheduledEndTime !== null
        && Date.parse(scheduledEndTime) <= Date.parse(scheduledStartTime)
      ) {
        throw new ScheduledEventEvidenceError(
          "Discord scheduled event end time must be after its start",
        )
      }
      const existingHosting = hostingForEvent(existing!)
      if (hostingIdentity(hosting) !== hostingIdentity(existingHosting)) {
        permission = {
          ...permission,
          destination: accessEvidence(
            state,
            hosting.entityType,
            hosting.entityType === "external" ? null : hosting.channelId,
            createPermissions(hosting.entityType),
          ),
        }
      }
      desired = {
        ...existing!,
        channelId: hosting.entityType === "external" ? null : hosting.channelId,
        ...(request.description !== undefined
          ? { description: request.description }
          : {}),
        entityType: hosting.entityType,
        hasCoverImage: request.coverImagePath === undefined
          ? existing!.hasCoverImage
          : request.coverImagePath !== null,
        location: hosting.entityType === "external" ? hosting.location : null,
        ...(request.name !== undefined ? { name: request.name } : {}),
        recurrence: request.recurrence === undefined
          ? existing!.recurrence
          : request.recurrence === null
            ? null
            : projectedInputRecurrence(request.recurrence, scheduledStartTime),
        scheduledEndTime,
        scheduledStartTime,
      }
    }

    if (
      desired !== null
      && desired.scheduledEndTime !== null
      && Date.parse(desired.scheduledEndTime) <= Date.parse(desired.scheduledStartTime)
    ) {
      throw new ScheduledEventEvidenceError(
        "Discord scheduled event end time must be after its start",
      )
    }
    const effect: ScheduledEventPlan["effect"] = request.action === "update"
      && desired !== null
      && existing !== null
      && sameControlledEvent(existing, desired)
      && typeof request.coverImagePath !== "string"
      ? "none"
      : request.action === "transition"
        && desired !== null
        && existing !== null
        && sameControlledEvent(existing, desired)
        ? "none"
        : request.action
    const inventoryDigest = request.action === "create"
      ? reviewedPlanDigest(this.#planKey, { events: inventory })
      : null
    const privacy = privacyProjection()
    const entityType = existing?.entityType ?? desired!.entityType
    const warnings = [
      ...(permission.current.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped scheduled-event permissions"]
        : []),
      ...(permission.ownershipRequired
        ? ["The change relies on Discord's bot-ownership rule and will be rejected if fresh creator evidence changes"]
        : []),
      ...(request.action === "create"
        ? ["Discord enforces the global event capacity after this connector-visible bounded inventory check"]
        : []),
      ...(entityType === "external"
        ? ["Discord automatically starts and completes external events at their scheduled times"]
        : ["Discord can automatically complete an active channel event after its channel empties"]),
      ...(fileSnapshot
        ? ["Cover-image verification confirms exact reviewed bytes were sent and that a cover exists after the write; Discord does not expose a byte-level readback"]
        : []),
      ...(request.action === "delete"
        ? ["Deletion permanently removes the exact scheduled event"]
        : []),
      "Event names, descriptions, and locations are untrusted Discord data and are never persisted by this workflow",
      "Scheduled-event serialization is process-local; do not run connector processes with overlapping scheduled-event scope",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      desired,
      existing,
      file: fileSnapshot
        ? {
            binding: fileSnapshot.binding,
            contentDigest: fileSnapshot.contentDigest,
            review: fileSnapshot.review,
          }
        : null,
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      inventoryDigest,
      inventorySize: request.action === "create" ? inventory.length : null,
      permission,
      request,
      roles: roleSnapshot(
        state.roles,
        state.botMember.roles.concat(request.guildId),
      ),
      warnings,
    })
    return {
      fileSnapshot,
      plan: {
        action: request.action,
        applicationId,
        auditReason: request.auditReason,
        botId,
        createdAt: now.toISOString(),
        desired,
        digest,
        effect,
        existing,
        file: fileSnapshot
          ? {
              contentDigest: fileSnapshot.contentDigest,
              review: fileSnapshot.review,
            }
          : null,
        guild: { id: request.guildId, name: state.guild.name },
        operationKeyHash: request.operationKeyHash,
        permission,
        privacy,
        schemaVersion: SCHEMA_VERSION,
        status: effect === "none" ? "already-current" : "planned",
        visibleInventory: {
          digest: inventoryDigest,
          returned: request.action === "create" ? inventory.length : null,
          safetyLimit: DISCORD_LIMITS.scheduledEvents,
          visibility: "connector-visible",
        },
        warnings,
      },
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: ScheduledEventChangeRequest,
    options: RequestOptions = {},
  ): Promise<ScheduledEventPlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      normalizeScheduledEventChangeRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: ScheduledEventChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<ScheduledEventResult> {
    const normalized = normalizeScheduledEventChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord scheduled event plan digest is invalid")
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
      () => new ScheduledEventExecutionError(
        "Discord scheduled event change was blocked because a prior same-guild operation ended with an uncertain outcome",
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
    request: NormalizedScheduledEventChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<ScheduledEventResult> {
    let built: BuiltScheduledEventPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof ScheduledEventEvidenceError
        || error instanceof ScheduledEventCoverFileError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new ScheduledEventPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    const { fileSnapshot, plan } = built
    if (plan.digest !== expectedDigest) {
      throw new ScheduledEventPlanChangedError(expectedDigest, plan.digest)
    }
    const entityType = plan.existing?.entityType ?? plan.desired!.entityType
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
        eventId: (plan.existing as ProjectedScheduledEvent).eventId,
        observed: plan.existing,
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
      throw new ScheduledEventOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        entityType,
        plan,
        request,
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
          request,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new ScheduledEventExecutionError(
        "Discord scheduled event change was blocked because pending activity could not be recorded",
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

    let eventId = targetId(request)
    let mutationCompleted = false
    let observed: ProjectedScheduledEvent | null = null
    try {
      if (request.action === "create") {
        const recurrenceRule = request.recurrence === undefined
          ? undefined
          : recurrenceInput(request.recurrence, request.scheduledStartTime)
        const input: CreateGuildScheduledEventInput = {
          channelId: request.hosting.entityType === "external"
            ? null
            : request.hosting.channelId,
          ...(fileSnapshot
            ? {
                cover: {
                  bytes: fileSnapshot.bytes,
                  format: fileSnapshot.review.format,
                },
              }
            : {}),
          ...(request.description !== undefined
            ? { description: request.description }
            : {}),
          entityType: ENTITY_TYPE_VALUES[request.hosting.entityType],
          location: request.hosting.entityType === "external"
            ? request.hosting.location
            : null,
          name: request.name,
          ...(recurrenceRule ? { recurrenceRule } : {}),
          ...(request.scheduledEndTime !== undefined
            ? { scheduledEndTime: request.scheduledEndTime }
            : {}),
          scheduledStartTime: request.scheduledStartTime,
        }
        const created = await this.#client.createGuildScheduledEvent(
          request.guildId,
          input,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        assertSnowflake(created.id, "Created Discord scheduled event ID")
        eventId = created.id
        observed = projectedEvent(await this.#client.getGuildScheduledEvent(
          request.guildId,
          created.id,
          options,
        ))
      } else if (request.action === "update") {
        const desired = plan.desired!
        const input: ModifyGuildScheduledEventInput = {
          ...(request.coverImagePath !== undefined
            ? {
                cover: request.coverImagePath === null
                  ? null
                  : {
                      bytes: fileSnapshot!.bytes,
                      format: fileSnapshot!.review.format,
                    },
              }
            : {}),
          ...(request.description !== undefined
            ? { description: request.description }
            : {}),
          ...(request.hosting !== undefined
            ? {
                channelId: request.hosting.entityType === "external"
                  ? null
                  : request.hosting.channelId,
                entityType: ENTITY_TYPE_VALUES[request.hosting.entityType],
                location: request.hosting.entityType === "external"
                  ? request.hosting.location
                  : null,
              }
            : {}),
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(request.recurrence !== undefined
            ? {
                recurrenceRule: request.recurrence === null
                  ? null
                  : recurrenceInput(
                      request.recurrence,
                      desired.scheduledStartTime,
                    ),
              }
            : {}),
          ...(
            request.scheduledEndTime !== undefined
            || request.hosting?.entityType === "external"
              ? { scheduledEndTime: desired.scheduledEndTime! }
              : {}
          ),
          ...(request.scheduledStartTime !== undefined
            ? { scheduledStartTime: request.scheduledStartTime }
            : {}),
        }
        await this.#client.modifyGuildScheduledEvent(
          request.guildId,
          request.eventId,
          input,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        observed = projectedEvent(await this.#client.getGuildScheduledEvent(
          request.guildId,
          request.eventId,
          options,
        ))
      } else if (request.action === "transition") {
        await this.#client.modifyGuildScheduledEvent(
          request.guildId,
          request.eventId,
          { status: TRANSITION_STATUS_VALUES[request.targetStatus] },
          request.auditReason,
          options,
        )
        mutationCompleted = true
        observed = projectedEvent(await this.#client.getGuildScheduledEvent(
          request.guildId,
          request.eventId,
          options,
        ))
      } else {
        await this.#client.deleteGuildScheduledEvent(
          request.guildId,
          request.eventId,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        try {
          observed = projectedEvent(await this.#client.getGuildScheduledEvent(
            request.guildId,
            request.eventId,
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
          eventId,
          plan,
          request,
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
          entityType,
          error: errorCode,
          eventId,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ScheduledEventExecutionError(
        "Discord scheduled event change did not complete with a verified successful outcome",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          eventId,
          observed,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    if (!eventId) {
      throw new ScheduledEventExecutionError(
        "Discord scheduled event change returned no exact resource identity",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    const matched = request.action === "delete"
      ? observed === null
      : observed !== null
        && sameControlledEvent(
          { ...plan.desired!, eventId },
          observed,
        )
    const verification = matched ? "match" : "drift"
    const status = matched ? "completed" : "completed-with-drift"
    const result: ScheduledEventResult = {
      ...baseResult,
      activityId,
      eventId,
      observed,
      status,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        eventId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          entityType,
          error: safeErrorCode(error),
          eventId,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
          verification,
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new ScheduledEventExecutionError(
        "Discord scheduled event change completed but the operation receipt failed",
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
        entityType,
        eventId,
        plan,
        request,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new ScheduledEventExecutionError(
        "Discord scheduled event change completed but the final activity record failed",
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
