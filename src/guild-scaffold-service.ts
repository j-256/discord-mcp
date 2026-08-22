import {
  createHmac,
  randomUUID,
} from "node:crypto"

import {
  assertGuildChannelInventory,
  channelMatchesRequest,
  type ChannelAdministrationService,
  type ChannelCreationPlan,
  type ChannelCreationRequest,
  type ChannelCreationResult,
  logicalChannelNameKey,
  normalizeChannelCreationRequest,
} from "./channel-administration-service.js"
import {
  CHANNEL_CREATION_KINDS,
  CONNECTOR_LIMITS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_SCAFFOLD_SYMBOL_PATTERN,
  SCHEMA_VERSION,
  type ChannelCreationKind,
} from "./constants.js"
import {
  DiscordApiError,
  GuildScaffoldExecutionError,
  GuildScaffoldOperationConflictError,
  GuildScaffoldPlanChangedError,
} from "./errors.js"
import { GUILD_SCAFFOLD_AUTHORITY } from "./guild-scaffold-authority.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  discordPermissionNames,
  evaluateBotChannelPermissions,
  evaluateGuildMemberPermissions,
  hasGuildPermission,
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
  logicalRoleNameKey,
  normalizeDiscordRoleInventory,
  normalizeRoleCreationRequest,
  ROLE_CREATION_HIGH_RISK_PERMISSIONS,
  roleMatchesRequest,
  type NormalizedDiscordRole,
  type RoleAdministrationService,
  type RoleCreationPlan,
  type RoleCreationRequest,
  type RoleCreationResult,
} from "./role-administration-service.js"
import { stableString } from "./normalize.js"
import type {
  DiscordChannel,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const SCAFFOLD_REQUEST_DIGEST_PREFIX = "hmac-sha256:"
const SCAFFOLD_LOCKS = new Map<string, Promise<void>>()
const REQUIRED_CHANNEL_PERMISSIONS = ["MANAGE_CHANNELS", "VIEW_CHANNEL"] as const
const HIGH_RISK_ROLE_PERMISSIONS = new Set<DiscordPermissionName>(
  ROLE_CREATION_HIGH_RISK_PERMISSIONS,
)

export type GuildScaffoldStepKind = "category" | "forum" | "role" | "text"
export type GuildScaffoldStepState =
  | "already-current"
  | "completed"
  | "ready"
  | "waiting-for-parent"

export interface GuildScaffoldRoleInput {
  hoist?: boolean
  key: string
  mentionable?: boolean
  name: string
  permissions?: readonly DiscordPermissionName[]
  primaryColor?: number
}

export interface GuildScaffoldChannelInput {
  defaultAutoArchiveDuration?: number
  key: string
  kind: ChannelCreationKind
  name: string
  nsfw?: boolean
  parentKey?: string
  rateLimitPerUser?: number
  topic?: string
}

export interface GuildScaffoldRequest {
  auditReason: string
  channels: readonly GuildScaffoldChannelInput[]
  guildId: string
  operationKey: string
  roles: readonly GuildScaffoldRoleInput[]
  stepLimit?: number
}

interface NormalizedGuildScaffoldRole {
  index: number
  key: string
  request: RoleCreationRequest
}

interface NormalizedGuildScaffoldChannel {
  index: number
  key: string
  kind: ChannelCreationKind
  parentKey: string | null
  request: Omit<ChannelCreationRequest, "parentId">
}

export interface NormalizedGuildScaffoldRequest {
  auditReason: string
  channels: NormalizedGuildScaffoldChannel[]
  guildId: string
  operationKey: string
  operationKeyHash: string
  roles: NormalizedGuildScaffoldRole[]
  stepLimit: number
}

export interface GuildScaffoldPlanStep {
  existingResourceId: string | null
  index: number
  key: string
  kind: GuildScaffoldStepKind
  operationKeyHash: string
  parent: {
    key: string
    permission: {
      administrator: boolean
      appliedRoleIds: string[]
      confidence: "complete"
      effectivePermissionNames: DiscordPermissionName[]
      effectivePermissions: string
      manageChannels: boolean
      permissionSourceChannelId: string
      unknownPermissionBits: string
      viewChannel: boolean
      warnings: string[]
    } | null
    resourceId: string | null
  } | null
  state: GuildScaffoldStepState
  target: {
    defaultAutoArchiveDuration?: number | null
    hoist?: boolean
    mentionable?: boolean
    name: string
    nsfw?: boolean | null
    permissionBits?: string
    permissions?: DiscordPermissionName[]
    primaryColor?: number
    rateLimitPerUser?: number | null
    topic?: string | null
  }
}

export interface GuildScaffoldPlan {
  applicationId: string
  auditReason: string
  botId: string
  counts: {
    alreadyCurrent: number
    completed: number
    ready: number
    total: number
    waitingForParent: number
  }
  createdAt: string
  digest: string
  executionFrontier: {
    stepIndexes: number[]
  }
  guild: {
    id: string
    name: string
    ownerId: string
  }
  operation: {
    operationKeyHash: string
    requestDigest: string
    status: OperationReceipt["status"] | "unreserved"
    stepLimit: number
  }
  permission: {
    botAdministrator: boolean
    botEffectivePermissionNames: DiscordPermissionName[]
    botEffectivePermissions: string
    botHighestRoleIds: string[]
    botHighestRolePosition: number
    guildManageChannels: boolean
    guildManageRoles: boolean
    guildViewChannel: boolean
  }
  schemaVersion: number
  status: "already-current" | "completed" | "planned" | "resume-ready"
  steps: GuildScaffoldPlanStep[]
  visibleInventory: {
    channels: number
    channelLimit: number
    roles: number
    roleLimit: number
  }
  warnings: string[]
}

export interface GuildScaffoldExecutedStep {
  activityId: string | null
  index: number
  key: string
  kind: GuildScaffoldStepKind
  resourceId: string
  status: "already-current" | "completed" | "completed-with-drift"
}

export interface GuildScaffoldResult {
  applicationId: string
  botId: string
  executedSteps: GuildScaffoldExecutedStep[]
  guildId: string
  operationKeyHash: string
  planDigest: string
  remaining: {
    ready: number
    waitingForParent: number
  }
  requestDigest: string
  schemaVersion: number
  status: "already-current" | "completed" | "paused"
}

export interface GuildScaffoldVerificationStep {
  index: number
  kind: GuildScaffoldStepKind
  resourceId: string | null
  state: GuildScaffoldStepState
}

export interface GuildScaffoldVerification {
  applicationId: string
  botId: string
  checkedAt: string
  counts: GuildScaffoldPlan["counts"]
  evidence: {
    callerRetainedRequestRequired: true
    persistedDiscordContent: false
    source: "live-discord-and-content-free-receipts"
  }
  guildId: string
  operation: {
    operationKeyHash: string
    receiptStatus: OperationReceipt["status"] | "unreserved"
    requestDigest: string
  }
  planDigest: string
  schemaVersion: number
  status: "incomplete" | "unrecorded" | "verified"
  steps: GuildScaffoldVerificationStep[]
}

export interface GuildScaffoldServiceOptions {
  channelService: Pick<
    ChannelAdministrationService,
    "executeForGuildScaffold" | "planForGuildScaffold"
  >
  client: {
    getGuild(guildId: string, options?: RequestOptions): Promise<DiscordGuild>
    getGuildChannels(guildId: string, options?: RequestOptions): Promise<DiscordChannel[]>
    getGuildMember(
      guildId: string,
      userId: string,
      options?: RequestOptions,
    ): Promise<DiscordGuildMember>
    getGuildRoles(guildId: string, options?: RequestOptions): Promise<DiscordRole[]>
  }
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
  roleService: Pick<
    RoleAdministrationService,
    "executeForGuildScaffold" | "planForGuildScaffold"
  >
}

interface ScaffoldEvidence {
  botMember: DiscordGuildMember
  botPermissions: GuildMemberPermissionResult
  channels: DiscordChannel[]
  guild: DiscordGuild
  rawRoles: DiscordRole[]
  roles: NormalizedDiscordRole[]
}

function assertSafeSymbol(value: string, description: string): void {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > CONNECTOR_LIMITS.scaffoldSymbolCharacters
    || !GUILD_SCAFFOLD_SYMBOL_PATTERN.test(value)
  ) {
    throw new RangeError(
      `${description} must be 1-${CONNECTOR_LIMITS.scaffoldSymbolCharacters} lowercase safe-ASCII characters beginning with a letter`,
    )
  }
}

function assertStepLimit(value: number): void {
  if (
    !Number.isInteger(value)
    || value < 1
    || value > CONNECTOR_LIMITS.scaffoldStepLimit
  ) {
    throw new RangeError(
      `Discord guild scaffold step limit must be between 1 and ${CONNECTOR_LIMITS.scaffoldStepLimit}`,
    )
  }
}

function stepOperationKey(
  operationKey: string,
  kind: GuildScaffoldStepKind,
  index: number,
): string {
  const digest = createHmac("sha256", operationKey)
    .update("discord-mcp-guild-scaffold-step.v1\0")
    .update(kind)
    .update("\0")
    .update(String(index))
    .digest("hex")
  return `scaffold:execute:${digest}`
}

function requestSnapshot(request: NormalizedGuildScaffoldRequest) {
  return {
    auditReason: request.auditReason,
    channels: request.channels.map((channel) => ({
      defaultAutoArchiveDuration: channel.request.defaultAutoArchiveDuration ?? null,
      index: channel.index,
      key: channel.key,
      kind: channel.kind,
      name: channel.request.name,
      nsfw: channel.request.nsfw ?? false,
      operationKeyHash: operationKeyHash(channel.request.operationKey),
      parentKey: channel.parentKey,
      rateLimitPerUser: channel.request.rateLimitPerUser ?? 0,
      topic: channel.request.topic ?? null,
    })),
    guildId: request.guildId,
    operationKeyHash: request.operationKeyHash,
    roles: request.roles.map((role) => {
      const normalized = normalizeRoleCreationRequest(role.request)
      return {
        hoist: normalized.hoist,
        index: role.index,
        key: role.key,
        mentionable: normalized.mentionable,
        name: normalized.name,
        operationKeyHash: normalized.operationKeyHash,
        permissionBits: normalized.permissionBits,
        permissions: normalized.permissions,
        primaryColor: normalized.primaryColor,
      }
    }),
  }
}

function scaffoldRequestDigest(
  applicationId: string,
  botId: string,
  request: NormalizedGuildScaffoldRequest,
): string {
  const digest = createHmac("sha256", request.operationKey)
    .update("discord-mcp-guild-scaffold-request.v1\0")
    .update(stableString({
      applicationId,
      auditReason: request.auditReason,
      botId,
      request: requestSnapshot(request),
    }))
    .digest("hex")
  return `${SCAFFOLD_REQUEST_DIGEST_PREFIX}${digest}`
}

function compareScaffoldSymbols(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function canonicalChannelOrder(
  left: GuildScaffoldChannelInput,
  right: GuildScaffoldChannelInput,
): number {
  const leftGroup = left.kind === "category" ? 0 : 1
  const rightGroup = right.kind === "category" ? 0 : 1
  if (leftGroup !== rightGroup) return leftGroup - rightGroup
  return compareScaffoldSymbols(
    `${left.parentKey ?? ""}\0${left.key}`,
    `${right.parentKey ?? ""}\0${right.key}`,
  )
}

export function normalizeGuildScaffoldRequest(
  request: GuildScaffoldRequest,
): NormalizedGuildScaffoldRequest {
  if (
    typeof request.guildId !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(request.guildId)
  ) {
    throw new RangeError("Discord guild scaffold requires one exact guild snowflake")
  }
  const topOperationKeyHash = operationKeyHash(request.operationKey)
  const stepLimit = request.stepLimit ?? CONNECTOR_LIMITS.scaffoldStepLimit
  assertStepLimit(stepLimit)
  if (!Array.isArray(request.roles) || !Array.isArray(request.channels)) {
    throw new RangeError("Discord guild scaffold roles and channels must be arrays")
  }
  if (request.roles.length > CONNECTOR_LIMITS.scaffoldRoles) {
    throw new RangeError(
      `Discord guild scaffold accepts at most ${CONNECTOR_LIMITS.scaffoldRoles} roles`,
    )
  }
  if (request.channels.length > CONNECTOR_LIMITS.scaffoldChannels) {
    throw new RangeError(
      `Discord guild scaffold accepts at most ${CONNECTOR_LIMITS.scaffoldChannels} channels`,
    )
  }
  const total = request.roles.length + request.channels.length
  if (total < 2 || total > CONNECTOR_LIMITS.scaffoldSteps) {
    throw new RangeError(
      `Discord guild scaffold requires 2-${CONNECTOR_LIMITS.scaffoldSteps} total resources`,
    )
  }

  const keys = new Set<string>()
  const roleNames = new Set<string>()
  for (const role of request.roles) {
    assertSafeSymbol(role.key, "Discord guild scaffold role key")
    if (keys.has(role.key)) {
      throw new RangeError("Discord guild scaffold resource keys must be globally unique")
    }
    keys.add(role.key)
    const normalized = normalizeRoleCreationRequest({
      auditReason: request.auditReason,
      guildId: request.guildId,
      hoist: role.hoist,
      mentionable: role.mentionable,
      name: role.name,
      operationKey: request.operationKey,
      permissions: role.permissions,
      primaryColor: role.primaryColor,
    })
    const logicalName = logicalRoleNameKey(normalized.name)
    if (roleNames.has(logicalName)) {
      throw new RangeError("Discord guild scaffold role names must be logically unique")
    }
    roleNames.add(logicalName)
  }

  const categoryKeys = new Set<string>()
  for (const channel of request.channels) {
    assertSafeSymbol(channel.key, "Discord guild scaffold channel key")
    if (keys.has(channel.key)) {
      throw new RangeError("Discord guild scaffold resource keys must be globally unique")
    }
    keys.add(channel.key)
    if (!CHANNEL_CREATION_KINDS.includes(channel.kind)) {
      throw new RangeError("Discord guild scaffold channel kind is not supported")
    }
    if (channel.kind === "category") {
      if (channel.parentKey !== undefined) {
        throw new RangeError("Discord guild scaffold categories cannot have parents")
      }
      categoryKeys.add(channel.key)
    }
    if (channel.parentKey !== undefined) {
      assertSafeSymbol(channel.parentKey, "Discord guild scaffold parent key")
    }
    normalizeChannelCreationRequest({
      auditReason: request.auditReason,
      defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration,
      guildId: request.guildId,
      kind: channel.kind,
      name: channel.name,
      nsfw: channel.nsfw,
      operationKey: request.operationKey,
      rateLimitPerUser: channel.rateLimitPerUser,
      topic: channel.topic,
    })
  }
  for (const channel of request.channels) {
    if (channel.parentKey && !categoryKeys.has(channel.parentKey)) {
      throw new RangeError(
        `Discord guild scaffold parent key ${channel.parentKey} does not reference a requested category`,
      )
    }
  }

  const channelLocations = new Set<string>()
  for (const channel of request.channels) {
    const location = `${channel.parentKey ?? ""}\0${logicalChannelNameKey(channel.name)}`
    if (channelLocations.has(location)) {
      throw new RangeError(
        "Discord guild scaffold channel names must be logically unique at each requested parent",
      )
    }
    channelLocations.add(location)
  }

  let nextIndex = 0
  const roles = [...request.roles]
    .sort((left, right) => compareScaffoldSymbols(left.key, right.key))
    .map((role): NormalizedGuildScaffoldRole => {
      const index = nextIndex++
      const operationKey = stepOperationKey(request.operationKey, "role", index)
      const normalized = normalizeRoleCreationRequest({
        auditReason: request.auditReason,
        guildId: request.guildId,
        hoist: role.hoist,
        mentionable: role.mentionable,
        name: role.name,
        operationKey,
        permissions: role.permissions,
        primaryColor: role.primaryColor,
      })
      return {
        index,
        key: role.key,
        request: {
          auditReason: normalized.auditReason,
          guildId: normalized.guildId,
          hoist: normalized.hoist,
          mentionable: normalized.mentionable,
          name: normalized.name,
          operationKey,
          permissions: normalized.permissions,
          primaryColor: normalized.primaryColor,
        },
      }
    })
  const channels = [...request.channels]
    .sort(canonicalChannelOrder)
    .map((channel): NormalizedGuildScaffoldChannel => {
      const index = nextIndex++
      const operationKey = stepOperationKey(
        request.operationKey,
        channel.kind,
        index,
      )
      const normalized = normalizeChannelCreationRequest({
        auditReason: request.auditReason,
        defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration,
        guildId: request.guildId,
        kind: channel.kind,
        name: channel.name,
        nsfw: channel.nsfw,
        operationKey,
        rateLimitPerUser: channel.rateLimitPerUser,
        topic: channel.topic,
      })
      return {
        index,
        key: channel.key,
        kind: normalized.kind,
        parentKey: channel.parentKey ?? null,
        request: {
          auditReason: normalized.auditReason,
          guildId: normalized.guildId,
          kind: normalized.kind,
          name: normalized.name,
          operationKey,
          ...(normalized.defaultAutoArchiveDuration !== null
            ? { defaultAutoArchiveDuration: normalized.defaultAutoArchiveDuration }
            : {}),
          ...(normalized.nsfw !== null ? { nsfw: normalized.nsfw } : {}),
          ...(normalized.rateLimitPerUser !== null
            ? { rateLimitPerUser: normalized.rateLimitPerUser }
            : {}),
          ...(normalized.topic !== null ? { topic: normalized.topic } : {}),
        },
      }
    })

  return {
    auditReason: request.auditReason,
    channels,
    guildId: request.guildId,
    operationKey: request.operationKey,
    operationKeyHash: topOperationKeyHash,
    roles,
    stepLimit,
  }
}

function channelRequest(
  channel: NormalizedGuildScaffoldChannel,
  parentId: string | null,
  topOperationKey: string,
): ChannelCreationRequest {
  return {
    ...channel.request,
    operationKey: stepOperationKey(topOperationKey, channel.kind, channel.index),
    ...(parentId ? { parentId } : {}),
  }
}

function roleRequest(
  role: NormalizedGuildScaffoldRole,
  topOperationKey: string,
): RoleCreationRequest {
  return {
    ...role.request,
    operationKey: stepOperationKey(topOperationKey, "role", role.index),
  }
}

function receiptView(receipt: OperationReceipt | undefined) {
  return receipt
    ? {
        activityId: receipt.activityId,
        error: receipt.error,
        guildId: receipt.guildId,
        operationKeyHash: receipt.operationKeyHash,
        resourceId: receipt.resourceId,
        status: receipt.status,
        timestamp: receipt.timestamp,
        verification: receipt.verification,
      }
    : null
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  const normalized = name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128)
  return normalized || "UnknownError"
}

function scaffoldReceipt(options: {
  activityId: string
  error?: string | null
  guildId: string
  operationKeyHash: string
  requestDigest: string
  resourceId?: string | null
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.guildId,
    kind: "guild-scaffold",
    operationKeyHash: options.operationKeyHash,
    planDigest: options.requestDigest,
    resourceId: options.resourceId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function assertGuildEvidence(
  guild: DiscordGuild,
  guildId: string,
  botMember: DiscordGuildMember,
  botId: string,
): void {
  if (
    guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || typeof guild.owner_id !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(guild.owner_id)
  ) {
    throw new GuildScaffoldOperationConflictError(
      "Discord returned incomplete or mismatched guild scaffold evidence",
      null,
    )
  }
  if (
    !botMember.user
    || botMember.user.id !== botId
    || botMember.user.bot !== true
  ) {
    throw new GuildScaffoldOperationConflictError(
      "Discord returned a different guild scaffold bot member than requested",
      null,
    )
  }
}

function assertCompleteBotPermissions(result: GuildMemberPermissionResult): void {
  if (!result.complete) {
    throw new GuildScaffoldOperationConflictError(
      `Discord guild scaffold bot permission evidence is incomplete: ${result.warnings.join("; ")}`,
      null,
    )
  }
}

function roleTarget(role: NormalizedGuildScaffoldRole) {
  const request = normalizeRoleCreationRequest(role.request)
  return {
    hoist: request.hoist,
    mentionable: request.mentionable,
    name: request.name,
    permissionBits: request.permissionBits,
    permissions: request.permissions,
    primaryColor: request.primaryColor,
  }
}

function channelTarget(channel: NormalizedGuildScaffoldChannel) {
  const request = normalizeChannelCreationRequest(channel.request)
  return {
    defaultAutoArchiveDuration: request.defaultAutoArchiveDuration,
    name: request.name,
    nsfw: request.nsfw,
    rateLimitPerUser: request.rateLimitPerUser,
    topic: request.topic,
  }
}

function stepCounts(steps: readonly GuildScaffoldPlanStep[]) {
  return {
    alreadyCurrent: steps.filter((step) => step.state === "already-current").length,
    completed: steps.filter((step) => step.state === "completed").length,
    ready: steps.filter((step) => step.state === "ready").length,
    total: steps.length,
    waitingForParent: steps.filter((step) => step.state === "waiting-for-parent").length,
  }
}

function parentPermissionView(result: BotChannelPermissionResult) {
  return {
    administrator: result.administrator,
    appliedRoleIds: result.appliedRoleIds,
    confidence: "complete" as const,
    effectivePermissionNames: result.effectivePermissionNames,
    effectivePermissions: result.effectivePermissions,
    manageChannels: result.effectivePermissionNames.includes("MANAGE_CHANNELS"),
    permissionSourceChannelId: result.permissionSourceChannelId,
    unknownPermissionBits: result.unknownPermissionBits,
    viewChannel: result.effectivePermissionNames.includes("VIEW_CHANNEL"),
    warnings: result.warnings,
  }
}

async function withScaffoldLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prior = SCAFFOLD_LOCKS.get(key) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = prior.then(() => current)
  SCAFFOLD_LOCKS.set(key, queued)
  await prior
  try {
    return await operation()
  } finally {
    release?.()
    if (SCAFFOLD_LOCKS.get(key) === queued) SCAFFOLD_LOCKS.delete(key)
  }
}

export class GuildScaffoldService {
  readonly #channelService: GuildScaffoldServiceOptions["channelService"]
  readonly #client: GuildScaffoldServiceOptions["client"]
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string
  readonly #roleService: GuildScaffoldServiceOptions["roleService"]

  constructor(options: GuildScaffoldServiceOptions) {
    this.#channelService = options.channelService
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
    this.#roleService = options.roleService
  }

  async #evidence(
    botId: string,
    request: NormalizedGuildScaffoldRequest,
    options: RequestOptions,
  ): Promise<ScaffoldEvidence> {
    this.#policy.assertGuildScaffoldAllowed(request.guildId)
    const [guild, botMember, rawRoles, channels] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.getGuildRoles(request.guildId, options),
      this.#client.getGuildChannels(request.guildId, options),
    ])
    assertGuildEvidence(guild, request.guildId, botMember, botId)
    const roles = normalizeDiscordRoleInventory(rawRoles, request.guildId)
    assertGuildChannelInventory(channels, request.guildId)
    const botPermissions = evaluateGuildMemberPermissions({
      guildId: request.guildId,
      member: botMember,
      roles: rawRoles,
    })
    assertCompleteBotPermissions(botPermissions)
    return { botMember, botPermissions, channels, guild, rawRoles, roles }
  }

  async #stepReceipt(
    step: NormalizedGuildScaffoldRole | NormalizedGuildScaffoldChannel,
  ): Promise<OperationReceipt | undefined> {
    return this.#operationStore.get(
      "kind" in step ? "channel-creation" : "role-creation",
      operationKeyHash(step.request.operationKey),
    )
  }

  #assertTopReceipt(
    receipt: OperationReceipt | undefined,
    request: NormalizedGuildScaffoldRequest,
    requestDigest: string,
  ): void {
    if (!receipt) return
    if (
      receipt.guildId !== request.guildId
      || receipt.planDigest !== requestDigest
      || receipt.operationKeyHash !== request.operationKeyHash
    ) {
      throw new GuildScaffoldOperationConflictError(
        "Discord guild scaffold operation key is bound to a different exact request or identity",
        receiptView(receipt),
      )
    }
    if (receipt.status === "failed" || receipt.status === "uncertain") {
      throw new GuildScaffoldOperationConflictError(
        "Discord guild scaffold operation is terminal and cannot be resumed",
        receiptView(receipt),
      )
    }
  }

  #assertRolePermission(
    permissions: GuildMemberPermissionResult,
    role: NormalizedGuildScaffoldRole,
  ): void {
    if (!hasGuildPermission(permissions, "MANAGE_ROLES")) {
      throw new GuildScaffoldOperationConflictError(
        "Discord guild scaffold bot lacks guild-level MANAGE_ROLES",
        null,
      )
    }
    if (permissions.highestRolePosition <= 0 || permissions.highestRoleIds.length < 1) {
      throw new GuildScaffoldOperationConflictError(
        "Discord guild scaffold bot has no role above @everyone",
        null,
      )
    }
    const requested = BigInt(normalizeRoleCreationRequest(role.request).permissionBits)
    const effective = BigInt(permissions.effectivePermissions)
    const grantable = permissions.administrator
      ? effective | ALL_KNOWN_PERMISSION_BITS
      : effective
    const unavailable = requested & ~grantable
    if (unavailable !== 0n) {
      throw new GuildScaffoldOperationConflictError(
        `Discord guild scaffold bot cannot grant requested permissions: ${discordPermissionNames(unavailable).join(", ") || unavailable.toString()}`,
        null,
      )
    }
  }

  #assertChannelPermission(
    evidence: ScaffoldEvidence,
    botId: string,
    parent: DiscordChannel | null,
  ): BotChannelPermissionResult | null {
    for (const permission of REQUIRED_CHANNEL_PERMISSIONS) {
      if (!hasGuildPermission(evidence.botPermissions, permission)) {
        throw new GuildScaffoldOperationConflictError(
          `Discord guild scaffold bot lacks guild-level ${permission}`,
          null,
        )
      }
    }
    if (!parent) return null
    const evaluated = evaluateBotChannelPermissions({
      botId,
      channel: parent,
      guildId: evidence.guild.id,
      member: evidence.botMember,
      permissionChannel: parent,
      roles: evidence.rawRoles,
    })
    if (evaluated.confidence !== "complete") {
      throw new GuildScaffoldOperationConflictError(
        `Discord guild scaffold parent permission evidence is incomplete: ${evaluated.warnings.join("; ")}`,
        null,
      )
    }
    for (const permission of REQUIRED_CHANNEL_PERMISSIONS) {
      if (!evaluated.effectivePermissionNames.includes(permission)) {
        throw new GuildScaffoldOperationConflictError(
          `Discord guild scaffold bot lacks parent-category ${permission}`,
          null,
        )
      }
    }
    return evaluated
  }

  async #roleStep(
    evidence: ScaffoldEvidence,
    role: NormalizedGuildScaffoldRole,
    receipt: OperationReceipt | undefined,
  ): Promise<GuildScaffoldPlanStep> {
    const normalized = normalizeRoleCreationRequest(role.request)
    const logicalName = logicalRoleNameKey(normalized.name)
    const candidates = evidence.roles.filter(
      (candidate) => logicalRoleNameKey(candidate.name) === logicalName,
    )
    if (candidates.length > 1) {
      throw new GuildScaffoldOperationConflictError(
        `Discord guild scaffold role ${role.key} has an ambiguous logical target`,
        receiptView(receipt),
      )
    }
    const candidate = candidates[0]
    if (receipt) {
      if (
        receipt.status !== "completed"
        || receipt.verification !== "match"
        || !receipt.resourceId
        || candidate?.id !== receipt.resourceId
        || candidate.managed
        || !roleMatchesRequest(candidate, normalized)
      ) {
        throw new GuildScaffoldOperationConflictError(
          `Discord guild scaffold role ${role.key} has an incomplete or drifting checkpoint`,
          receiptView(receipt),
        )
      }
      return {
        existingResourceId: receipt.resourceId,
        index: role.index,
        key: role.key,
        kind: "role",
        operationKeyHash: normalized.operationKeyHash,
        parent: null,
        state: "completed",
        target: roleTarget(role),
      }
    }
    if (candidate?.managed || (candidate && !roleMatchesRequest(candidate, normalized))) {
      throw new GuildScaffoldOperationConflictError(
        `Discord guild scaffold role ${role.key} conflicts with existing state`,
        null,
      )
    }
    return {
      existingResourceId: candidate?.id ?? null,
      index: role.index,
      key: role.key,
      kind: "role",
      operationKeyHash: normalized.operationKeyHash,
      parent: null,
      state: candidate ? "already-current" : "ready",
      target: roleTarget(role),
    }
  }

  async #channelStep(
    evidence: ScaffoldEvidence,
    channel: NormalizedGuildScaffoldChannel,
    parentId: string | null,
    receipt: OperationReceipt | undefined,
  ): Promise<GuildScaffoldPlanStep> {
    if (channel.parentKey && !parentId) {
      if (receipt) {
        throw new GuildScaffoldOperationConflictError(
          `Discord guild scaffold channel ${channel.key} has a checkpoint without a verified parent`,
          receiptView(receipt),
        )
      }
      return {
        existingResourceId: null,
        index: channel.index,
        key: channel.key,
        kind: channel.kind,
        operationKeyHash: operationKeyHash(channel.request.operationKey),
        parent: { key: channel.parentKey, permission: null, resourceId: null },
        state: "waiting-for-parent",
        target: channelTarget(channel),
      }
    }
    const request = normalizeChannelCreationRequest({
      ...channel.request,
      ...(parentId ? { parentId } : {}),
    })
    const logicalName = logicalChannelNameKey(request.name)
    const supportedTypes = new Set<number>([
      DISCORD_CHANNEL_TYPES.category,
      DISCORD_CHANNEL_TYPES.forum,
      DISCORD_CHANNEL_TYPES.text,
    ])
    const candidates = evidence.channels.filter((candidate) => (
      supportedTypes.has(candidate.type)
      && (candidate.parent_id ?? null) === parentId
      && typeof candidate.name === "string"
      && logicalChannelNameKey(candidate.name) === logicalName
    ))
    if (candidates.length > 1) {
      throw new GuildScaffoldOperationConflictError(
        `Discord guild scaffold channel ${channel.key} has an ambiguous logical target`,
        receiptView(receipt),
      )
    }
    const candidate = candidates[0]
    if (receipt) {
      if (
        receipt.status !== "completed"
        || receipt.verification !== "match"
        || !receipt.resourceId
        || candidate?.id !== receipt.resourceId
        || !channelMatchesRequest(candidate, request)
      ) {
        throw new GuildScaffoldOperationConflictError(
          `Discord guild scaffold channel ${channel.key} has an incomplete or drifting checkpoint`,
          receiptView(receipt),
        )
      }
      return {
        existingResourceId: receipt.resourceId,
        index: channel.index,
        key: channel.key,
        kind: channel.kind,
        operationKeyHash: request.operationKeyHash,
        parent: channel.parentKey
          ? { key: channel.parentKey, permission: null, resourceId: parentId }
          : null,
        state: "completed",
        target: channelTarget(channel),
      }
    }
    if (candidate && !channelMatchesRequest(candidate, request)) {
      throw new GuildScaffoldOperationConflictError(
        `Discord guild scaffold channel ${channel.key} conflicts with existing state`,
        null,
      )
    }
    return {
      existingResourceId: candidate?.id ?? null,
      index: channel.index,
      key: channel.key,
      kind: channel.kind,
      operationKeyHash: request.operationKeyHash,
      parent: channel.parentKey
        ? { key: channel.parentKey, permission: null, resourceId: parentId }
        : null,
      state: candidate ? "already-current" : "ready",
      target: channelTarget(channel),
    }
  }

  async #planNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedGuildScaffoldRequest,
    options: RequestOptions,
  ): Promise<GuildScaffoldPlan> {
    if (
      !DISCORD_SNOWFLAKE_PATTERN.test(applicationId)
      || !DISCORD_SNOWFLAKE_PATTERN.test(botId)
    ) {
      throw new RangeError("Discord guild scaffold requires exact application and bot identities")
    }
    const requestDigest = scaffoldRequestDigest(applicationId, botId, request)
    const topReceipt = await this.#operationStore.get(
      "guild-scaffold",
      request.operationKeyHash,
    )
    this.#assertTopReceipt(topReceipt, request, requestDigest)
    const evidence = await this.#evidence(botId, request, options)

    const roleSteps: GuildScaffoldPlanStep[] = []
    for (const role of request.roles) {
      const receipt = await this.#stepReceipt(role)
      const step = await this.#roleStep(evidence, role, receipt)
      if (step.state === "ready") this.#assertRolePermission(evidence.botPermissions, role)
      roleSteps.push(step)
    }

    const categoryResources = new Map<string, string>()
    const categorySteps: GuildScaffoldPlanStep[] = []
    for (const category of request.channels.filter((channel) => channel.kind === "category")) {
      const receipt = await this.#stepReceipt(category)
      const step = await this.#channelStep(evidence, category, null, receipt)
      if (step.state === "ready") this.#assertChannelPermission(evidence, botId, null)
      if (step.existingResourceId) categoryResources.set(category.key, step.existingResourceId)
      categorySteps.push(step)
    }

    const childSteps: GuildScaffoldPlanStep[] = []
    for (const channel of request.channels.filter((entry) => entry.kind !== "category")) {
      const parentId = channel.parentKey
        ? categoryResources.get(channel.parentKey) ?? null
        : null
      const receipt = await this.#stepReceipt(channel)
      const step = await this.#channelStep(evidence, channel, parentId, receipt)
      if (step.state === "ready") {
        const parent = parentId
          ? evidence.channels.find((candidate) => candidate.id === parentId) ?? null
          : null
        const permission = this.#assertChannelPermission(evidence, botId, parent)
        if (step.parent && permission) {
          step.parent.permission = parentPermissionView(permission)
        }
      }
      childSteps.push(step)
    }

    const steps = [...roleSteps, ...categorySteps, ...childSteps]
      .sort((left, right) => left.index - right.index)
    const counts = stepCounts(steps)
    const executionFrontier = steps
      .filter((step) => step.state === "ready")
      .slice(0, request.stepLimit)
      .map((step) => step.index)
    const newRoles = roleSteps.filter((step) => step.state === "ready").length
    if (evidence.roles.length + newRoles > DISCORD_LIMITS.guildRoles) {
      throw new GuildScaffoldOperationConflictError(
        "Discord guild scaffold would exceed the guild role limit",
        null,
      )
    }
    const newChannels = [...categorySteps, ...childSteps]
      .filter((step) => step.state === "ready" || step.state === "waiting-for-parent")
      .length
    if (evidence.channels.length + newChannels > DISCORD_LIMITS.guildChannels) {
      throw new GuildScaffoldOperationConflictError(
        "Discord guild scaffold would exceed the guild channel limit",
        null,
      )
    }
    for (const category of categorySteps) {
      const existingChildren = category.existingResourceId
        ? evidence.channels.filter(
            (candidate) => candidate.parent_id === category.existingResourceId,
          ).length
        : 0
      const requestedChildren = childSteps.filter(
        (step) => step.parent?.key === category.key
          && (step.state === "ready" || step.state === "waiting-for-parent"),
      ).length
      if (existingChildren + requestedChildren > DISCORD_LIMITS.categoryChannels) {
        throw new GuildScaffoldOperationConflictError(
          `Discord guild scaffold category ${category.key} would exceed its child limit`,
          null,
        )
      }
    }
    if (topReceipt?.status === "completed" && (
      counts.ready > 0
      || counts.waitingForParent > 0
    )) {
      throw new GuildScaffoldOperationConflictError(
        "Completed Discord guild scaffold receipt does not match current resource state",
        receiptView(topReceipt),
      )
    }

    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      botMember: {
        roles: [...evidence.botMember.roles].sort(),
        userId: evidence.botMember.user?.id ?? null,
      },
      botPermissions: {
        administrator: evidence.botPermissions.administrator,
        effectivePermissions: evidence.botPermissions.effectivePermissions,
        highestRoleIds: evidence.botPermissions.highestRoleIds,
        highestRolePosition: evidence.botPermissions.highestRolePosition,
      },
      channels: evidence.channels.map((channel) => ({
        defaultAutoArchiveDuration: channel.default_auto_archive_duration ?? null,
        id: channel.id,
        name: channel.name ?? null,
        nsfw: channel.nsfw ?? false,
        overwrites: channel.permission_overwrites ?? [],
        parentId: channel.parent_id ?? null,
        rateLimitPerUser: channel.rate_limit_per_user ?? 0,
        topic: channel.topic ?? null,
        type: channel.type,
      })).sort((left, right) => left.id.localeCompare(right.id)),
      guild: {
        id: evidence.guild.id,
        name: evidence.guild.name,
        ownerId: evidence.guild.owner_id,
      },
      request: requestSnapshot(request),
      requestDigest,
      roles: evidence.roles,
      executionFrontier,
      stepLimit: request.stepLimit,
      steps,
      topReceipt: receiptView(topReceipt),
    })
    const highRiskPermissions = request.roles.flatMap((role) => (
      normalizeRoleCreationRequest(role.request).permissions.filter(
        (permission) => HIGH_RISK_ROLE_PERMISSIONS.has(permission),
      )
    ))
    const status = topReceipt?.status === "completed"
      ? "completed"
      : topReceipt?.status === "pending"
        ? "resume-ready"
        : counts.ready > 0
          ? "planned"
        : "already-current"
    return {
      applicationId,
      auditReason: request.auditReason,
      botId,
      counts,
      createdAt: this.#clock().toISOString(),
      digest,
      executionFrontier: {
        stepIndexes: executionFrontier,
      },
      guild: {
        id: evidence.guild.id,
        name: evidence.guild.name,
        ownerId: evidence.guild.owner_id as string,
      },
      operation: {
        operationKeyHash: request.operationKeyHash,
        requestDigest,
        status: topReceipt?.status ?? "unreserved",
        stepLimit: request.stepLimit,
      },
      permission: {
        botAdministrator: evidence.botPermissions.administrator,
        botEffectivePermissionNames: evidence.botPermissions.effectivePermissionNames,
        botEffectivePermissions: evidence.botPermissions.effectivePermissions,
        botHighestRoleIds: evidence.botPermissions.highestRoleIds,
        botHighestRolePosition: evidence.botPermissions.highestRolePosition,
        guildManageChannels: hasGuildPermission(evidence.botPermissions, "MANAGE_CHANNELS"),
        guildManageRoles: hasGuildPermission(evidence.botPermissions, "MANAGE_ROLES"),
        guildViewChannel: hasGuildPermission(evidence.botPermissions, "VIEW_CHANNEL"),
      },
      schemaVersion: SCHEMA_VERSION,
      status,
      steps,
      visibleInventory: {
        channels: evidence.channels.length,
        channelLimit: DISCORD_LIMITS.guildChannels,
        roles: evidence.roles.length,
        roleLimit: DISCORD_LIMITS.guildRoles,
      },
      warnings: [
        ...(evidence.botPermissions.administrator
          ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped role and channel permissions"]
          : []),
        ...(highRiskPermissions.length > 0
          ? [`Requested high-risk role permissions: ${[...new Set(highRiskPermissions)].join(", ")}`]
          : []),
        "Guild scaffolds create only additive roles, categories, text channels, and forum channels",
        "A newly created category must be reviewed in a fresh plan before any child channel can be created",
        "No step is retried, rolled back, reordered, assigned, edited, or deleted",
        "An uncertain or drifting step permanently blocks this scaffold operation key",
        "Scaffold execution must claim both guild role and channel collections before any write",
      ],
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildScaffoldRequest,
    options: RequestOptions = {},
  ): Promise<GuildScaffoldPlan> {
    return this.#planNormalized(
      applicationId,
      botId,
      normalizeGuildScaffoldRequest(request),
      options,
    )
  }

  async verify(
    applicationId: string,
    botId: string,
    request: GuildScaffoldRequest,
    options: RequestOptions = {},
  ): Promise<GuildScaffoldVerification> {
    const plan = await this.#planNormalized(
      applicationId,
      botId,
      normalizeGuildScaffoldRequest(request),
      options,
    )
    const status = plan.status === "completed"
      ? "verified"
      : plan.status === "already-current"
        ? "unrecorded"
        : "incomplete"
    return {
      applicationId,
      botId,
      checkedAt: plan.createdAt,
      counts: plan.counts,
      evidence: {
        callerRetainedRequestRequired: true,
        persistedDiscordContent: false,
        source: "live-discord-and-content-free-receipts",
      },
      guildId: request.guildId,
      operation: {
        operationKeyHash: plan.operation.operationKeyHash,
        receiptStatus: plan.operation.status,
        requestDigest: plan.operation.requestDigest,
      },
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      status,
      steps: plan.steps.map((step) => ({
        index: step.index,
        kind: step.kind,
        resourceId: step.existingResourceId,
        state: step.state,
      })),
    }
  }

  async #finishTop(
    pending: OperationReceipt,
    status: "completed" | "failed" | "uncertain",
    error: string | null,
    resourceId: string | null,
  ): Promise<void> {
    await this.#operationStore.finish(scaffoldReceipt({
      activityId: pending.activityId,
      error,
      guildId: pending.guildId,
      operationKeyHash: pending.operationKeyHash,
      requestDigest: pending.planDigest,
      resourceId,
      status,
      timestamp: this.#clock().toISOString(),
      verification: status === "completed" ? "match" : null,
    }))
  }

  async #executeRoleStep(
    botId: string,
    request: NormalizedGuildScaffoldRequest,
    step: GuildScaffoldPlanStep,
    options: RequestOptions,
  ): Promise<GuildScaffoldExecutedStep> {
    const role = request.roles.find((candidate) => candidate.index === step.index)
    if (!role) throw new Error("Discord guild scaffold role step disappeared")
    const target = roleRequest(role, request.operationKey)
    const plan: RoleCreationPlan = await this.#roleService.planForGuildScaffold(
      GUILD_SCAFFOLD_AUTHORITY,
      botId,
      target,
      options,
    )
    const result: RoleCreationResult = await this.#roleService.executeForGuildScaffold(
      GUILD_SCAFFOLD_AUTHORITY,
      botId,
      target,
      plan.digest,
      options,
    )
    return {
      activityId: result.activityId,
      index: step.index,
      key: step.key,
      kind: "role",
      resourceId: result.roleId,
      status: result.status,
    }
  }

  async #executeChannelStep(
    botId: string,
    request: NormalizedGuildScaffoldRequest,
    step: GuildScaffoldPlanStep,
    options: RequestOptions,
  ): Promise<GuildScaffoldExecutedStep> {
    const channel = request.channels.find((candidate) => candidate.index === step.index)
    if (!channel) throw new Error("Discord guild scaffold channel step disappeared")
    const target = channelRequest(
      channel,
      step.parent?.resourceId ?? null,
      request.operationKey,
    )
    const plan: ChannelCreationPlan = await this.#channelService.planForGuildScaffold(
      GUILD_SCAFFOLD_AUTHORITY,
      botId,
      target,
      options,
    )
    const result: ChannelCreationResult = await this.#channelService.executeForGuildScaffold(
      GUILD_SCAFFOLD_AUTHORITY,
      botId,
      target,
      plan.digest,
      options,
    )
    return {
      activityId: result.activityId,
      index: step.index,
      key: step.key,
      kind: step.kind,
      resourceId: result.channelId,
      status: result.status,
    }
  }

  async #executeNormalized(
    applicationId: string,
    botId: string,
    request: NormalizedGuildScaffoldRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildScaffoldResult> {
    const plan = await this.#planNormalized(applicationId, botId, request, options)
    if (plan.digest !== expectedDigest) {
      throw new GuildScaffoldPlanChangedError(expectedDigest, plan.digest)
    }
    if (plan.status === "already-current" && plan.operation.status === "unreserved") {
      return {
        applicationId,
        botId,
        executedSteps: [],
        guildId: request.guildId,
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        remaining: { ready: 0, waitingForParent: 0 },
        requestDigest: plan.operation.requestDigest,
        schemaVersion: SCHEMA_VERSION,
        status: "already-current",
      }
    }
    if (plan.status === "completed") {
      return {
        applicationId,
        botId,
        executedSteps: [],
        guildId: request.guildId,
        operationKeyHash: request.operationKeyHash,
        planDigest: plan.digest,
        remaining: { ready: 0, waitingForParent: 0 },
        requestDigest: plan.operation.requestDigest,
        schemaVersion: SCHEMA_VERSION,
        status: "completed",
      }
    }

    let topReceipt = await this.#operationStore.get(
      "guild-scaffold",
      request.operationKeyHash,
    )
    if (!topReceipt) {
      const reservation = await this.#operationStore.reserve(scaffoldReceipt({
        activityId: this.#randomId(),
        guildId: request.guildId,
        operationKeyHash: request.operationKeyHash,
        requestDigest: plan.operation.requestDigest,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
      topReceipt = reservation.receipt
      if (!reservation.created) {
        this.#assertTopReceipt(topReceipt, request, plan.operation.requestDigest)
      }
    }
    if (topReceipt.status !== "pending") {
      throw new GuildScaffoldOperationConflictError(
        "Discord guild scaffold operation is not resumable",
        receiptView(topReceipt),
      )
    }

    const executionFrontier = new Set(plan.executionFrontier.stepIndexes)
    const ready = plan.steps.filter((step) => executionFrontier.has(step.index))
    const executedSteps: GuildScaffoldExecutedStep[] = []
    for (const step of ready) {
      try {
        const result = step.kind === "role"
          ? await this.#executeRoleStep(botId, request, step, options)
          : await this.#executeChannelStep(botId, request, step, options)
        executedSteps.push(result)
        if (result.status === "completed-with-drift") {
          let topRecordError: string | null = null
          try {
            await this.#finishTop(
              topReceipt,
              "uncertain",
              "GuildScaffoldStepDrift",
              result.resourceId,
            )
          } catch (error) {
            topRecordError = safeErrorCode(error)
          }
          throw new GuildScaffoldExecutionError(
            "Discord guild scaffold stopped after a step completed with observed drift",
            {
              executedSteps,
              guildId: request.guildId,
              operationKeyHash: request.operationKeyHash,
              planDigest: plan.digest,
              requestDigest: plan.operation.requestDigest,
              schemaVersion: SCHEMA_VERSION,
              status: "uncertain",
              topRecordError,
            },
          )
        }
      } catch (error) {
        if (error instanceof GuildScaffoldExecutionError) throw error
        const kind = step.kind === "role" ? "role-creation" : "channel-creation"
        const receipt = await this.#operationStore.get(kind, step.operationKeyHash)
        if (receipt?.status === "completed" && receipt.verification === "match") {
          throw new GuildScaffoldExecutionError(
            "Discord guild scaffold step completed but local terminal reporting failed; request a fresh plan with the same operation key",
            {
              executedSteps,
              guildId: request.guildId,
              operationKeyHash: request.operationKeyHash,
              planDigest: plan.digest,
              requestDigest: plan.operation.requestDigest,
              resourceId: receipt.resourceId,
              schemaVersion: SCHEMA_VERSION,
              status: "paused-step-record-error",
            },
            { cause: error },
          )
        }
        if (receipt?.status === "pending") {
          throw new GuildScaffoldExecutionError(
            "Discord guild scaffold step is already reserved; wait for the active execution or inspect an interrupted pending receipt",
            {
              executedSteps,
              guildId: request.guildId,
              operationKeyHash: request.operationKeyHash,
              planDigest: plan.digest,
              requestDigest: plan.operation.requestDigest,
              schemaVersion: SCHEMA_VERSION,
              status: "blocked-step-pending",
            },
            { cause: error },
          )
        }
        if (!receipt) {
          throw new GuildScaffoldExecutionError(
            "Discord guild scaffold stopped before the step reserved a write; request a fresh plan with the same operation key",
            {
              error: safeErrorCode(error),
              executedSteps,
              guildId: request.guildId,
              operationKeyHash: request.operationKeyHash,
              planDigest: plan.digest,
              requestDigest: plan.operation.requestDigest,
              schemaVersion: SCHEMA_VERSION,
              status: "paused-step-prewrite",
            },
            { cause: error },
          )
        }
        const status = receipt?.status === "uncertain"
          ? "uncertain"
          : "failed"
        const resourceId = receipt?.resourceId ?? null
        let topRecordError: string | null = null
        try {
          await this.#finishTop(
            topReceipt,
            status,
            safeErrorCode(error),
            resourceId,
          )
        } catch (recordError) {
          topRecordError = safeErrorCode(recordError)
        }
        throw new GuildScaffoldExecutionError(
          "Discord guild scaffold stopped after a step failed to complete with a verified outcome",
          {
            error: safeErrorCode(error),
            executedSteps,
            guildId: request.guildId,
            operationKeyHash: request.operationKeyHash,
            planDigest: plan.digest,
            requestDigest: plan.operation.requestDigest,
            resourceId,
            schemaVersion: SCHEMA_VERSION,
            status,
            topRecordError,
          },
          { cause: error },
        )
      }
    }

    let refreshed: GuildScaffoldPlan
    try {
      refreshed = await this.#planNormalized(applicationId, botId, request, options)
    } catch (error) {
      throw new GuildScaffoldExecutionError(
        "Discord guild scaffold steps completed but the fresh progress snapshot failed",
        {
          error: safeErrorCode(error),
          executedSteps,
          guildId: request.guildId,
          operationKeyHash: request.operationKeyHash,
          planDigest: plan.digest,
          requestDigest: plan.operation.requestDigest,
          schemaVersion: SCHEMA_VERSION,
          status: "paused-progress-unavailable",
        },
        { cause: error },
      )
    }
    const complete = refreshed.counts.ready === 0
      && refreshed.counts.waitingForParent === 0
    if (complete) {
      try {
        await this.#finishTop(topReceipt, "completed", null, request.guildId)
      } catch (error) {
        throw new GuildScaffoldExecutionError(
          "Discord guild scaffold completed but the top-level operation receipt failed",
          {
            error: safeErrorCode(error),
            executedSteps,
            guildId: request.guildId,
            operationKeyHash: request.operationKeyHash,
            planDigest: plan.digest,
            requestDigest: plan.operation.requestDigest,
            schemaVersion: SCHEMA_VERSION,
            status: "completed-operation-record-failed",
          },
          { cause: error },
        )
      }
    }
    return {
      applicationId,
      botId,
      executedSteps,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      remaining: {
        ready: refreshed.counts.ready,
        waitingForParent: refreshed.counts.waitingForParent,
      },
      requestDigest: plan.operation.requestDigest,
      schemaVersion: SCHEMA_VERSION,
      status: complete ? "completed" : "paused",
    }
  }

  async execute(
    applicationId: string,
    botId: string,
    request: GuildScaffoldRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildScaffoldResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild scaffold plan digest is invalid")
    }
    const normalized = normalizeGuildScaffoldRequest(request)
    return withScaffoldLock(
      `${normalized.guildId}\0${normalized.operationKeyHash}`,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
    )
  }
}
