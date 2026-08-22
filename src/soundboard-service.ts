import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  SoundboardActivity,
  SoundboardActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
  type SoundboardAction,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildEmojiSummary,
  type DiscordSoundboardSoundSummary,
} from "./discord-client.js"
import {
  DiscordApiError,
  errorMessage,
  SoundboardEvidenceError,
  SoundboardExecutionError,
  SoundboardOperationConflictError,
  SoundboardPlanChangedError,
} from "./errors.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
  hasGuildPermission,
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
  readSoundboardFileSnapshot,
  SoundboardFileError,
  type SoundboardFileReview,
  type SoundboardFileSnapshot,
} from "./soundboard-file.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

export const SOUNDBOARD_OMITTED_FIELDS = Object.freeze([
  "audioBytes",
  "cdnUrl",
  "creatorProfile",
  "rawDiscordObject",
] as const)

const EMOJI_CODE_POINT_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3)/u
const EMOJI_CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007F]/u
const SOUNDBOARD_STATE_UNAVAILABLE = "guild-soundboard-state-unavailable"
const TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

export type SoundboardEmoji =
  | { kind: "custom"; emojiId: string }
  | { kind: "none" }
  | { kind: "unicode"; emojiName: string }

interface SoundboardRequestBase {
  action: SoundboardAction
  auditReason: string
  guildId: string
  operationKey: string
}

export interface CreateSoundboardSoundRequest extends SoundboardRequestBase {
  action: "create"
  emoji: SoundboardEmoji
  filePath: string
  name: string
  volume: number
}

export interface UpdateSoundboardSoundRequest extends SoundboardRequestBase {
  action: "update"
  emoji?: SoundboardEmoji
  name?: string
  soundId: string
  volume?: number
}

export interface DeleteSoundboardSoundRequest extends SoundboardRequestBase {
  action: "delete"
  soundId: string
}

export type SoundboardChangeRequest =
  | CreateSoundboardSoundRequest
  | DeleteSoundboardSoundRequest
  | UpdateSoundboardSoundRequest

interface NormalizedSoundboardRequestBase {
  action: SoundboardAction
  auditReason: string
  guildId: string
  operationKeyHash: string
}

export type NormalizedSoundboardChangeRequest =
  | (Omit<CreateSoundboardSoundRequest, keyof SoundboardRequestBase | "emoji"> & NormalizedSoundboardRequestBase & {
      action: "create"
      emoji: SoundboardEmoji
    })
  | (Omit<UpdateSoundboardSoundRequest, keyof SoundboardRequestBase | "emoji"> & NormalizedSoundboardRequestBase & {
      action: "update"
      emoji?: SoundboardEmoji
    })
  | (Omit<DeleteSoundboardSoundRequest, keyof SoundboardRequestBase> & NormalizedSoundboardRequestBase & {
      action: "delete"
    })

export interface ProjectedSoundboardSound {
  available: boolean
  creatorUserId: string | null
  emoji: SoundboardEmoji
  guildId: string | null
  name: string
  soundId: string
  unknownFieldCount: number
  volume: number
}

export interface PlannedSoundboardSound {
  available: boolean
  creatorUserId: string
  emoji: SoundboardEmoji
  guildId: string
  name: string
  soundId: string | null
  volume: number
}

export interface SoundboardPermissionEvidence {
  administrator: boolean
  appliedRoleIds: string[]
  confidence: "complete"
  createGuildExpressions: boolean
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  guildOwner: boolean
  manageGuildExpressions: boolean
  ownershipRequired: boolean
  warnings: string[]
}

export interface SoundboardPrivacyProjection {
  audioPersisted: false
  creatorProfilesExposed: false
  omittedFields: typeof SOUNDBOARD_OMITTED_FIELDS
  privateFieldsProjectedOut: true
}

export interface DefaultSoundboardInventoryResult {
  page: {
    returned: number
    safetyLimit: number
  }
  privacy: SoundboardPrivacyProjection
  schemaVersion: number
  sounds: ProjectedSoundboardSound[]
  status: "ok"
}

export interface GuildSoundboardInventoryResult extends DefaultSoundboardInventoryResult {
  guild: {
    id: string
    name: string
  }
  permission: SoundboardPermissionEvidence
}

export interface GuildSoundboardLookupResult extends Omit<
  GuildSoundboardInventoryResult,
  "page" | "sounds"
> {
  sound: ProjectedSoundboardSound
}

export interface SoundboardCustomEmojiEvidence {
  animated: boolean
  available: boolean
  emojiId: string
  managed: boolean
  name: string
}

export interface SoundboardPlan {
  action: SoundboardAction
  applicationId: string
  auditReason: string
  botId: string
  createdAt: string
  customEmoji: SoundboardCustomEmojiEvidence | null
  desired: PlannedSoundboardSound | null
  digest: string
  effect: "change" | "none"
  existing: ProjectedSoundboardSound | null
  file: {
    contentDigest: string
    review: SoundboardFileReview
  } | null
  guild: {
    id: string
    name: string
  }
  operationKeyHash: string
  permission: SoundboardPermissionEvidence
  privacy: SoundboardPrivacyProjection
  schemaVersion: number
  soundId: string | null
  status: "already-current" | "planned"
  visibleInventory: {
    returned: number
    safetyLimit: number
  }
  warnings: string[]
}

export interface SoundboardResult {
  action: SoundboardAction
  activityId: string | null
  guildId: string
  observed: ProjectedSoundboardSound | null
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  soundId: string
  status: "already-current" | "completed" | "completed-with-drift"
}

export interface SoundboardServiceClient extends Pick<
  DiscordClient,
  | "createGuildSoundboardSound"
  | "deleteGuildSoundboardSound"
  | "getGuild"
  | "getGuildEmoji"
  | "getGuildMember"
  | "getGuildRoles"
  | "getGuildSoundboardSound"
  | "listDefaultSoundboardSounds"
  | "listGuildSoundboardSounds"
  | "modifyGuildSoundboardSound"
> {}

export interface SoundboardServiceOptions {
  activityStore: ActivityStore
  client: SoundboardServiceClient
  clock?: () => Date
  fileRoots: readonly string[]
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface SoundboardState {
  botMember: DiscordGuildMember
  guild: DiscordGuild & { name: string; owner_id: string }
  inventory: ProjectedSoundboardSound[]
  permission: SoundboardPermissionEvidence
  roles: DiscordRole[]
}

interface BuiltSoundboardPlan {
  fileSnapshot: SoundboardFileSnapshot | null
  plan: SoundboardPlan
}

interface SoundboardLockState {
  tails: Map<string, Promise<"settled" | "uncertain">>
  uncertainGuilds: Set<string>
}

const SOUNDBOARD_LOCKS = new WeakMap<OperationStore, SoundboardLockState>()

function soundboardLocks(operationStore: OperationStore): SoundboardLockState {
  let state = SOUNDBOARD_LOCKS.get(operationStore)
  if (!state) {
    state = {
      tails: new Map(),
      uncertainGuilds: new Set(),
    }
    SOUNDBOARD_LOCKS.set(operationStore, state)
  }
  return state
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (!validSnowflake(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function assertName(value: unknown): asserts value is string {
  if (
    typeof value !== "string"
    || [...value].length < DISCORD_LIMITS.soundboardNameMinimumCharacters
    || [...value].length > DISCORD_LIMITS.soundboardNameCharacters
    || value.trim() !== value
    || value.normalize("NFC") !== value
    || TEXT_CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    throw new RangeError(
      `Discord soundboard name must contain ${DISCORD_LIMITS.soundboardNameMinimumCharacters}-${DISCORD_LIMITS.soundboardNameCharacters} trimmed NFC characters without controls`,
    )
  }
}

function assertVolume(value: unknown): asserts value is number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 1
  ) {
    throw new RangeError("Discord soundboard volume must be a finite number from 0 through 1")
  }
}

function normalizedEmoji(value: unknown): SoundboardEmoji {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord soundboard emoji must be a tagged object")
  }
  const emoji = value as Record<string, unknown>
  if (emoji.kind === "none" && Object.keys(emoji).length === 1) {
    return { kind: "none" }
  }
  if (
    emoji.kind === "custom"
    && Object.keys(emoji).length === 2
    && validSnowflake(emoji.emojiId)
  ) {
    return { emojiId: emoji.emojiId, kind: "custom" }
  }
  if (
    emoji.kind === "unicode"
    && Object.keys(emoji).length === 2
    && typeof emoji.emojiName === "string"
    && emoji.emojiName.length <= CONNECTOR_LIMITS.interactionEmojiCharacters
    && validUnicode(emoji.emojiName)
    && !EMOJI_CONTROL_OR_SPACE_PATTERN.test(emoji.emojiName)
  ) {
    const graphemes = [
      ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(emoji.emojiName),
    ]
    if (graphemes.length === 1 && EMOJI_CODE_POINT_PATTERN.test(emoji.emojiName)) {
      return { emojiName: emoji.emojiName, kind: "unicode" }
    }
  }
  throw new RangeError(
    "Discord soundboard emoji must be none, one exact custom emoji ID, or one Unicode emoji grapheme",
  )
}

export function normalizeSoundboardChangeRequest(
  request: SoundboardChangeRequest,
): NormalizedSoundboardChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord soundboard change request must be an object")
  }
  assertSnowflake(request.guildId, "Discord soundboard guild ID")
  if (!(request.action === "create" || request.action === "delete" || request.action === "update")) {
    throw new RangeError("Discord soundboard action must be create, update, or delete")
  }
  if (typeof request.auditReason !== "string") {
    throw new RangeError("Discord soundboard audit reason must be a string")
  }
  encodeDiscordAuditReason(request.auditReason)
  const base = {
    action: request.action,
    auditReason: request.auditReason,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
  if (request.action === "delete") {
    assertSnowflake(request.soundId, "Discord soundboard sound ID")
    return { ...base, action: "delete", soundId: request.soundId }
  }
  if (request.action === "create") {
    assertName(request.name)
    assertVolume(request.volume)
    if (typeof request.filePath !== "string") {
      throw new RangeError("Discord soundboard creation requires one local file path")
    }
    return {
      ...base,
      action: "create",
      emoji: normalizedEmoji(request.emoji),
      filePath: request.filePath,
      name: request.name,
      volume: request.volume,
    }
  }
  assertSnowflake(request.soundId, "Discord soundboard sound ID")
  if (request.name === undefined && request.volume === undefined && request.emoji === undefined) {
    throw new RangeError("Discord soundboard update must contain a name, volume, or emoji")
  }
  if (request.name !== undefined) assertName(request.name)
  if (request.volume !== undefined) assertVolume(request.volume)
  return {
    ...base,
    action: "update",
    soundId: request.soundId,
    ...(request.emoji !== undefined ? { emoji: normalizedEmoji(request.emoji) } : {}),
    ...(request.name !== undefined ? { name: request.name } : {}),
    ...(request.volume !== undefined ? { volume: request.volume } : {}),
  }
}

function exactGuild(
  guild: DiscordGuild,
  guildId: string,
): DiscordGuild & { name: string; owner_id: string } {
  if (
    !guild
    || typeof guild !== "object"
    || Array.isArray(guild)
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || guild.name.length > DISCORD_LIMITS.channelNameCharacters
    || TEXT_CONTROL_PATTERN.test(guild.name)
    || !validUnicode(guild.name)
    || !validSnowflake(guild.owner_id)
  ) {
    throw new SoundboardEvidenceError("Discord returned invalid soundboard guild evidence")
  }
  return guild as DiscordGuild & { name: string; owner_id: string }
}

function exactBotMember(member: DiscordGuildMember, botId: string): DiscordGuildMember {
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
    throw new SoundboardEvidenceError("Discord returned invalid soundboard bot-member evidence")
  }
  return member
}

function exactRoles(roles: readonly DiscordRole[], guildId: string): DiscordRole[] {
  if (!Array.isArray(roles) || roles.length < 1 || roles.length > DISCORD_LIMITS.guildRoles) {
    throw new SoundboardEvidenceError("Discord returned an invalid soundboard role inventory")
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
      throw new SoundboardEvidenceError("Discord returned an invalid soundboard role inventory")
    }
    seen.add(role.id)
  }
  if (!seen.has(guildId)) {
    throw new SoundboardEvidenceError("Discord soundboard role inventory omitted the @everyone role")
  }
  return [...roles]
}

function projectedEmoji(emojiId: string | null, emojiName: string | null): SoundboardEmoji {
  if (emojiId !== null) {
    if (!validSnowflake(emojiId) || emojiName !== null) {
      throw new SoundboardEvidenceError("Discord returned invalid soundboard emoji evidence")
    }
    return { emojiId, kind: "custom" }
  }
  if (emojiName === null) return { kind: "none" }
  try {
    return normalizedEmoji({ emojiName, kind: "unicode" })
  } catch (error) {
    throw new SoundboardEvidenceError("Discord returned invalid soundboard emoji evidence", {
      cause: error,
    })
  }
}

function projectSound(
  sound: DiscordSoundboardSoundSummary,
  expectedGuildId: string | null,
): ProjectedSoundboardSound {
  if (
    !sound
    || typeof sound !== "object"
    || Array.isArray(sound)
    || !validSnowflake(sound.id)
    || sound.guildId !== expectedGuildId
    || typeof sound.available !== "boolean"
    || !(sound.creatorUserId === null || validSnowflake(sound.creatorUserId))
    || !Number.isSafeInteger(sound.unknownFieldCount)
    || sound.unknownFieldCount < 0
  ) {
    throw new SoundboardEvidenceError("Discord returned invalid soundboard sound evidence")
  }
  try {
    assertName(sound.name)
    assertVolume(sound.volume)
  } catch (error) {
    throw new SoundboardEvidenceError("Discord returned invalid soundboard sound evidence", {
      cause: error,
    })
  }
  return {
    available: sound.available,
    creatorUserId: sound.creatorUserId,
    emoji: projectedEmoji(sound.emojiId, sound.emojiName),
    guildId: expectedGuildId,
    name: sound.name,
    soundId: sound.id,
    unknownFieldCount: sound.unknownFieldCount,
    volume: sound.volume,
  }
}

function exactInventory(
  sounds: readonly DiscordSoundboardSoundSummary[],
  guildId: string | null,
): ProjectedSoundboardSound[] {
  if (!Array.isArray(sounds) || sounds.length > DISCORD_LIMITS.soundboardSounds) {
    throw new SoundboardEvidenceError("Discord returned an invalid soundboard inventory")
  }
  const projected = sounds.map((sound) => projectSound(sound, guildId))
  if (new Set(projected.map((sound) => sound.soundId)).size !== projected.length) {
    throw new SoundboardEvidenceError("Discord returned duplicate soundboard sound IDs")
  }
  return projected.sort((left, right) => {
    const leftId = BigInt(left.soundId)
    const rightId = BigInt(right.soundId)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  })
}

function permissionEvidence(
  permissions: GuildMemberPermissionResult,
  guildOwner: boolean,
): SoundboardPermissionEvidence {
  const createGuildExpressions = guildOwner
    || hasGuildPermission(permissions, "CREATE_GUILD_EXPRESSIONS")
  const manageGuildExpressions = guildOwner
    || hasGuildPermission(permissions, "MANAGE_GUILD_EXPRESSIONS")
  return {
    administrator: permissions.administrator,
    appliedRoleIds: [...permissions.appliedRoleIds],
    confidence: "complete",
    createGuildExpressions,
    effectivePermissionNames: [...permissions.effectivePermissionNames],
    effectivePermissions: permissions.effectivePermissions,
    guildOwner,
    manageGuildExpressions,
    ownershipRequired: !manageGuildExpressions,
    warnings: [...permissions.warnings],
  }
}

function privacyProjection(): SoundboardPrivacyProjection {
  return {
    audioPersisted: false,
    creatorProfilesExposed: false,
    omittedFields: SOUNDBOARD_OMITTED_FIELDS,
    privateFieldsProjectedOut: true,
  }
}

function emojiPair(emoji: SoundboardEmoji): {
  emojiId: string | null
  emojiName: string | null
} {
  if (emoji.kind === "custom") return { emojiId: emoji.emojiId, emojiName: null }
  if (emoji.kind === "unicode") return { emojiId: null, emojiName: emoji.emojiName }
  return { emojiId: null, emojiName: null }
}

function nameKey(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("en-US")
}

function plannedSound(sound: ProjectedSoundboardSound): PlannedSoundboardSound {
  if (sound.guildId === null || sound.creatorUserId === null) {
    throw new SoundboardEvidenceError(
      "Discord returned incomplete soundboard identity evidence for a reviewed change",
    )
  }
  return {
    available: sound.available,
    creatorUserId: sound.creatorUserId,
    emoji: sound.emoji,
    guildId: sound.guildId,
    name: sound.name,
    soundId: sound.soundId,
    volume: sound.volume,
  }
}

function matchesDesired(
  observed: ProjectedSoundboardSound | null,
  desired: PlannedSoundboardSound | null,
  expectedId: string,
): boolean {
  if (desired === null) return observed === null
  return observed !== null
    && observed.unknownFieldCount === 0
    && JSON.stringify({
      available: observed.available,
      creatorUserId: observed.creatorUserId,
      emoji: observed.emoji,
      guildId: observed.guildId,
      name: observed.name,
      soundId: observed.soundId,
      volume: observed.volume,
    }) === JSON.stringify({ ...desired, soundId: expectedId })
}

function roleSnapshot(
  roles: readonly DiscordRole[],
  appliedRoleIds: readonly string[],
  guildId: string,
) {
  const relevant = new Set([...appliedRoleIds, guildId])
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

function customEmojiEvidence(
  emoji: DiscordGuildEmojiSummary,
  expectedId: string,
): SoundboardCustomEmojiEvidence {
  if (
    !emoji
    || typeof emoji !== "object"
    || emoji.id !== expectedId
    || !validSnowflake(emoji.id)
    || typeof emoji.animated !== "boolean"
    || typeof emoji.available !== "boolean"
    || typeof emoji.managed !== "boolean"
  ) {
    throw new SoundboardEvidenceError("Discord returned invalid custom emoji evidence")
  }
  try {
    if (typeof emoji.name !== "string") throw new RangeError("invalid")
    assertName(emoji.name)
  } catch (error) {
    throw new SoundboardEvidenceError("Discord returned invalid custom emoji evidence", {
      cause: error,
    })
  }
  if (!emoji.available) {
    throw new SoundboardEvidenceError("Discord custom emoji is unavailable")
  }
  return {
    animated: emoji.animated,
    available: emoji.available,
    emojiId: emoji.id,
    managed: emoji.managed,
    name: emoji.name,
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
    soundId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function targetId(request: NormalizedSoundboardChangeRequest): string | null {
  return request.action === "create" ? null : request.soundId
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: SoundboardPlan
  request: NormalizedSoundboardChangeRequest
  soundId?: string | null
  status: SoundboardActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): SoundboardActivity {
  return {
    action: options.request.action,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    kind: "guild-soundboard-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    soundId: options.soundId === undefined ? targetId(options.request) : options.soundId,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: SoundboardPlan
  request: NormalizedSoundboardChangeRequest
  soundId?: string | null
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "guild-soundboard-change",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : options.soundId ?? targetId(options.request),
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function executionBlocksGuild(error: unknown): boolean {
  if (
    !(error instanceof SoundboardExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["completed-operation-record-failed", "uncertain"]
    .includes(String(error.result.status))
}

async function withGuildLock<T>(
  locks: SoundboardLockState,
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => SoundboardExecutionError,
): Promise<T> {
  const prior = locks.tails.get(guildId)
    ?? Promise.resolve(
      locks.uncertainGuilds.has(guildId) ? "uncertain" as const : "settled" as const,
    )
  let release: (outcome: "settled" | "uncertain") => void = () => undefined
  const tail = new Promise<"settled" | "uncertain">((resolve) => {
    release = resolve
  })
  locks.tails.set(guildId, tail)
  let outcome: "settled" | "uncertain" = "settled"
  try {
    if (await prior === "uncertain" || locks.uncertainGuilds.has(guildId)) {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksGuild(error)) {
      outcome = "uncertain"
      locks.uncertainGuilds.add(guildId)
    }
    throw error
  } finally {
    release(outcome)
    if (locks.tails.get(guildId) === tail) locks.tails.delete(guildId)
  }
}

export class SoundboardService {
  readonly #activityStore: ActivityStore
  readonly #client: SoundboardServiceClient
  readonly #clock: () => Date
  readonly #fileRoots: readonly string[]
  readonly #locks: SoundboardLockState
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: SoundboardServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#fileRoots = [...options.fileRoots]
    this.#locks = soundboardLocks(options.operationStore)
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    botId: string,
    guildId: string,
    mode: "audit" | "change",
    options: RequestOptions,
    operationKeyHashValue?: string,
  ): Promise<SoundboardState> {
    assertSnowflake(botId, "Discord connector bot ID")
    assertSnowflake(guildId, "Discord soundboard guild ID")
    if (mode === "change") {
      this.#policy.assertSoundboardChangeAllowed(guildId)
    } else {
      this.#policy.assertSoundboardAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "guild-soundboard-change",
        operationKeyHashValue,
      )
      if (receipt) throw new SoundboardOperationConflictError(receiptView(receipt))
    }
    const [rawGuild, rawMember, rawRoles, rawInventory] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.listGuildSoundboardSounds(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactBotMember(rawMember, botId)
    const roles = exactRoles(rawRoles, guildId)
    let permissions: GuildMemberPermissionResult
    try {
      permissions = evaluateGuildMemberPermissions({ guildId, member: botMember, roles })
    } catch (error) {
      throw new SoundboardEvidenceError(
        `Discord connector bot soundboard permission evidence is invalid: ${errorMessage(error)}`,
        { cause: error },
      )
    }
    if (!permissions.complete) {
      throw new SoundboardEvidenceError(
        "Discord connector bot soundboard permission evidence is incomplete",
      )
    }
    return {
      botMember,
      guild,
      inventory: exactInventory(rawInventory, guildId),
      permission: permissionEvidence(permissions, guild.owner_id === botId),
      roles,
    }
  }

  async listDefaults(
    options: RequestOptions = {},
  ): Promise<DefaultSoundboardInventoryResult> {
    this.#policy.assertSoundboardAuditEnabled()
    const sounds = exactInventory(
      await this.#client.listDefaultSoundboardSounds(options),
      null,
    )
    return {
      page: { returned: sounds.length, safetyLimit: DISCORD_LIMITS.soundboardSounds },
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      sounds,
      status: "ok",
    }
  }

  async listGuild(
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<GuildSoundboardInventoryResult> {
    const state = await this.#state(botId, guildId, "audit", options)
    return {
      guild: { id: guildId, name: state.guild.name },
      page: {
        returned: state.inventory.length,
        safetyLimit: DISCORD_LIMITS.soundboardSounds,
      },
      permission: state.permission,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      sounds: state.inventory,
      status: "ok",
    }
  }

  async getGuild(
    botId: string,
    guildId: string,
    soundId: string,
    options: RequestOptions = {},
  ): Promise<GuildSoundboardLookupResult> {
    assertSnowflake(soundId, "Discord soundboard sound ID")
    const state = await this.#state(botId, guildId, "audit", options)
    const inventorySound = state.inventory.find((sound) => sound.soundId === soundId)
    if (!inventorySound) {
      throw new SoundboardEvidenceError(
        "Discord soundboard sound is absent from the exact guild inventory",
      )
    }
    const exact = projectSound(
      await this.#client.getGuildSoundboardSound(guildId, soundId, options),
      guildId,
    )
    if (JSON.stringify(exact) !== JSON.stringify(inventorySound)) {
      throw new SoundboardEvidenceError(
        "Discord exact soundboard lookup differs from the fresh guild inventory",
      )
    }
    return {
      guild: { id: guildId, name: state.guild.name },
      permission: state.permission,
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      sound: exact,
      status: "ok",
    }
  }

  #assertChangeAuthority(
    request: NormalizedSoundboardChangeRequest,
    state: SoundboardState,
    existing: ProjectedSoundboardSound | null,
  ): void {
    if (request.action === "create") {
      if (!state.permission.createGuildExpressions) {
        throw new SoundboardEvidenceError(
          "Discord connector bot lacks CREATE_GUILD_EXPRESSIONS for soundboard creation",
        )
      }
      return
    }
    if (!existing) {
      if (request.action === "delete") return
      throw new SoundboardEvidenceError(
        "Discord soundboard sound is absent from the exact guild inventory",
      )
    }
    if (existing.unknownFieldCount !== 0) {
      throw new SoundboardEvidenceError(
        "Discord returned unknown soundboard fields, so changes are blocked",
      )
    }
    if (state.permission.manageGuildExpressions) return
    if (
      state.permission.createGuildExpressions
      && existing.creatorUserId !== null
      && existing.creatorUserId === state.botMember.user?.id
    ) return
    throw new SoundboardEvidenceError(
      "Discord connector bot lacks authority over this sound; MANAGE_GUILD_EXPRESSIONS or exact bot ownership with CREATE_GUILD_EXPRESSIONS is required",
    )
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedSoundboardChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltSoundboardPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(
      botId,
      request.guildId,
      "change",
      options,
      request.operationKeyHash,
    )
    const existing = request.action === "create"
      ? null
      : state.inventory.find((sound) => sound.soundId === request.soundId) ?? null
    this.#assertChangeAuthority(request, state, existing)

    if (request.action === "create") {
      if (state.inventory.length >= DISCORD_LIMITS.soundboardSounds) {
        throw new SoundboardEvidenceError(
          "Discord soundboard inventory reached the local safety limit",
        )
      }
      if (state.inventory.some((sound) => nameKey(sound.name) === nameKey(request.name))) {
        throw new SoundboardEvidenceError(
          "Discord soundboard creation conflicts with an existing normalized name",
        )
      }
    } else if (
      request.action === "update"
      && request.name !== undefined
      && state.inventory.some((sound) => (
        sound.soundId !== request.soundId
        && nameKey(sound.name) === nameKey(request.name!)
      ))
    ) {
      throw new SoundboardEvidenceError(
        "Discord soundboard update conflicts with an existing normalized name",
      )
    }

    const requestedEmoji = request.action === "delete" ? undefined : request.emoji
    const customEmoji = requestedEmoji?.kind === "custom"
      ? customEmojiEvidence(
          await this.#client.getGuildEmoji(
            request.guildId,
            requestedEmoji.emojiId,
            options,
          ),
          requestedEmoji.emojiId,
        )
      : null
    let fileSnapshot: SoundboardFileSnapshot | null = null
    if (request.action === "create") {
      fileSnapshot = await readSoundboardFileSnapshot({
        filePath: request.filePath,
        planKey: this.#planKey,
        roots: this.#fileRoots,
      })
    }

    let desired: PlannedSoundboardSound | null
    if (request.action === "delete") {
      desired = null
    } else if (request.action === "create") {
      desired = {
        available: true,
        creatorUserId: botId,
        emoji: request.emoji,
        guildId: request.guildId,
        name: request.name,
        soundId: null,
        volume: request.volume,
      }
    } else {
      const current = plannedSound(existing as ProjectedSoundboardSound)
      desired = {
        ...current,
        ...(request.emoji !== undefined ? { emoji: request.emoji } : {}),
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.volume !== undefined ? { volume: request.volume } : {}),
      }
    }
    const effect = request.action === "delete"
      ? existing === null ? "none" : "change"
      : request.action === "update"
        && existing !== null
        && desired !== null
        && matchesDesired(existing, desired, request.soundId)
        ? "none"
        : "change"
    const planPermission = {
      ...state.permission,
      ownershipRequired: request.action !== "create"
        && existing !== null
        && state.permission.ownershipRequired,
    }
    const warnings = [
      ...(state.permission.administrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped guild-expression permissions"]
        : []),
      ...(planPermission.ownershipRequired
        ? ["The change relies on Discord's exact bot-ownership rule and will fail if fresh creator evidence changes"]
        : []),
      ...(request.action === "create"
        ? ["Discord tier-specific soundboard slots remain server-enforced after the bounded local inventory check"]
        : []),
      ...(requestedEmoji?.kind === "custom"
        ? ["The selected custom emoji was resolved by exact ID in the target guild"]
        : []),
      "Audio bytes and CDN URLs cannot be read back; verification covers exact identity and stable metadata",
      "Guild, sound, and emoji names are untrusted Discord data and are never persisted by this workflow",
      "Soundboard serialization is process-local; do not run connector processes with overlapping soundboard guild scope",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
    ]
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: {
        roles: [...state.botMember.roles].sort(),
        userId: state.botMember.user?.id ?? null,
      },
      customEmoji,
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
      inventory: state.inventory,
      permission: planPermission,
      request,
      roles: roleSnapshot(state.roles, state.permission.appliedRoleIds, request.guildId),
      warnings,
    })
    return {
      fileSnapshot,
      plan: {
        action: request.action,
        applicationId,
        auditReason: request.auditReason,
        botId,
        createdAt: this.#clock().toISOString(),
        customEmoji,
        desired,
        digest,
        effect,
        existing,
        file: fileSnapshot
          ? { contentDigest: fileSnapshot.contentDigest, review: fileSnapshot.review }
          : null,
        guild: { id: request.guildId, name: state.guild.name },
        operationKeyHash: request.operationKeyHash,
        permission: planPermission,
        privacy: privacyProjection(),
        schemaVersion: SCHEMA_VERSION,
        soundId: targetId(request),
        status: effect === "none" ? "already-current" : "planned",
        visibleInventory: {
          returned: state.inventory.length,
          safetyLimit: DISCORD_LIMITS.soundboardSounds,
        },
        warnings,
      },
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: SoundboardChangeRequest,
    options: RequestOptions = {},
  ): Promise<SoundboardPlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      normalizeSoundboardChangeRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: SoundboardChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<SoundboardResult> {
    const normalized = normalizeSoundboardChangeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord soundboard plan digest is invalid")
    }
    return withGuildLock(
      this.#locks,
      normalized.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new SoundboardExecutionError(
        "Discord soundboard change was blocked because a prior same-guild operation ended with an uncertain outcome",
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
    request: NormalizedSoundboardChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<SoundboardResult> {
    let built: BuiltSoundboardPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof SoundboardEvidenceError
        || error instanceof SoundboardFileError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new SoundboardPlanChangedError(expectedDigest, SOUNDBOARD_STATE_UNAVAILABLE)
      }
      throw error
    }
    const { fileSnapshot, plan } = built
    if (plan.digest !== expectedDigest) {
      throw new SoundboardPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: request.action,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.effect === "none") {
      if (request.action === "create") {
        throw new SoundboardEvidenceError(
          "Discord soundboard creation cannot produce an already-current plan",
        )
      }
      return {
        ...baseResult,
        activityId: null,
        observed: plan.existing,
        soundId: request.soundId,
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
      throw new SoundboardOperationConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
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
      throw new SoundboardExecutionError(
        "Discord soundboard change was blocked because pending activity could not be recorded",
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

    let soundId = targetId(request)
    let mutationCompleted = false
    let observed: ProjectedSoundboardSound | null = null
    try {
      if (request.action === "create") {
        const pair = emojiPair(request.emoji)
        const created = projectSound(await this.#client.createGuildSoundboardSound(
          request.guildId,
          {
            bytes: fileSnapshot!.bytes,
            ...pair,
            format: fileSnapshot!.review.format,
            name: request.name,
            volume: request.volume,
          },
          request.auditReason,
          options,
        ), request.guildId)
        mutationCompleted = true
        soundId = created.soundId
        observed = projectSound(await this.#client.getGuildSoundboardSound(
          request.guildId,
          soundId,
          options,
        ), request.guildId)
      } else if (request.action === "update") {
        const pair = request.emoji === undefined ? {} : emojiPair(request.emoji)
        await this.#client.modifyGuildSoundboardSound(
          request.guildId,
          request.soundId,
          {
            ...pair,
            ...(request.name !== undefined ? { name: request.name } : {}),
            ...(request.volume !== undefined ? { volume: request.volume } : {}),
          },
          request.auditReason,
          options,
        )
        mutationCompleted = true
        observed = projectSound(await this.#client.getGuildSoundboardSound(
          request.guildId,
          request.soundId,
          options,
        ), request.guildId)
      } else {
        await this.#client.deleteGuildSoundboardSound(
          request.guildId,
          request.soundId,
          request.auditReason,
          options,
        )
        mutationCompleted = true
        try {
          observed = projectSound(await this.#client.getGuildSoundboardSound(
            request.guildId,
            request.soundId,
            options,
          ), request.guildId)
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
          soundId,
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
          soundId,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new SoundboardExecutionError(
        "Discord soundboard change did not complete with a verified successful outcome",
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
          soundId,
          status,
        },
        { cause: error },
      )
    }

    if (!soundId) {
      throw new SoundboardExecutionError(
        "Discord soundboard change returned no exact resource identity",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    const matched = matchesDesired(observed, plan.desired, soundId)
    const verification = matched ? "match" : "drift"
    const status = matched ? "completed" : "completed-with-drift"
    const result: SoundboardResult = {
      ...baseResult,
      activityId,
      observed,
      soundId,
      status,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        soundId,
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
          soundId,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new SoundboardExecutionError(
        "Discord soundboard change completed but the operation receipt failed",
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
        soundId,
        status,
        timestamp: this.#clock().toISOString(),
        verification,
      }))
    } catch (error) {
      throw new SoundboardExecutionError(
        "Discord soundboard change completed but the final activity record failed",
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
