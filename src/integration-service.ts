import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  IntegrationDeletionActivity,
  IntegrationDeletionActivityStatus,
} from "./activity-log.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import {
  encodeDiscordAuditReason,
  type DiscordClient,
  type DiscordGuildIntegrationSummary,
  type DiscordGuildIntegrationType,
} from "./discord-client.js"
import {
  DiscordApiError,
  IntegrationDeletionExecutionError,
  IntegrationDeletionOperationConflictError,
  IntegrationDeletionPlanChangedError,
  IntegrationEvidenceError,
} from "./errors.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import {
  evaluateGuildMemberPermissions,
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
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
  RequestOptions,
} from "./types.js"

const STATE_UNAVAILABLE = "integration-state-unavailable"
const INTEGRATION_TYPES: readonly DiscordGuildIntegrationType[] = [
  "discord",
  "guild_subscription",
  "twitch",
  "unknown",
  "youtube",
]
const INTEGRATION_SUMMARY_KEYS = [
  "accountPresent",
  "applicationId",
  "associatedBotUserId",
  "enableEmoticons",
  "enabled",
  "expireBehavior",
  "expireGracePeriod",
  "id",
  "knownScopes",
  "linkedUserPresent",
  "revoked",
  "roleId",
  "subscriberCount",
  "syncedAt",
  "syncing",
  "type",
  "unknownFieldCounts",
  "unknownScopeCount",
] as const
const INTEGRATION_DELETION_REQUEST_KEYS = [
  "acknowledgeAssociatedBotKicked",
  "acknowledgeAssociatedWebhooksRemoved",
  "auditReason",
  "guildId",
  "integrationId",
  "operationKey",
] as const
const UNKNOWN_FIELD_COUNT_KEYS = [
  "account",
  "application",
  "bot",
  "integration",
  "user",
] as const
const PRIVACY_OMITTED_FIELDS = [
  "account.id",
  "account.name",
  "application.description",
  "application.icon",
  "application.name",
  "application.owner",
  "application.team",
  "integration.name",
  "rawPayload",
  "user.avatar",
  "user.discriminator",
  "user.email",
  "user.globalName",
  "user.username",
] as const
const KNOWN_SCOPE_PATTERN = /^[a-z0-9._:-]{1,128}$/
type IntegrationTargetOutcome = "settled" | "uncertain"
const INTEGRATION_GUILD_LOCKS = new Map<string, Promise<IntegrationTargetOutcome>>()

export interface IntegrationDeletionRequest {
  acknowledgeAssociatedBotKicked: boolean
  acknowledgeAssociatedWebhooksRemoved: boolean
  auditReason: string
  guildId: string
  integrationId: string
  operationKey: string
}

export interface NormalizedIntegrationDeletionRequest extends Omit<
  IntegrationDeletionRequest,
  "operationKey"
> {
  operationKeyHash: string
}

export interface IntegrationAccessEvidence {
  appliedRoleIds: string[]
  botAdministrator: boolean
  botIsGuildOwner: boolean
  complete: true
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  manageGuild: true
  requiredPermission: "MANAGE_GUILD"
  unknownPermissionBits: string
}

export interface IntegrationPrivacyProjection {
  externalAccountIdentitiesProjectedOut: true
  namesAndProfilesProjectedOut: true
  omittedFields: typeof PRIVACY_OMITTED_FIELDS
  persistence: "none"
  rawPayloads: "omitted"
}

export interface IntegrationInventoryResult {
  access: IntegrationAccessEvidence
  applicationId: string
  botId: string
  guild: {
    id: string
    name: string
  }
  integrations: DiscordGuildIntegrationSummary[]
  page: {
    inventoryComplete: boolean
    returned: number
    safetyLimit: number
  }
  privacy: IntegrationPrivacyProjection
  schemaVersion: number
  status: "ok"
}

export interface IntegrationDeletionPlan {
  access: IntegrationAccessEvidence
  acknowledgments: {
    associatedBotKicked: boolean
    associatedWebhooksRemoved: true
  }
  action: "delete"
  applicationId: string
  associatedBotMembership: {
    present: boolean
    userId: string | null
  }
  auditReason: string
  botId: string
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  inventory: DiscordGuildIntegrationSummary[]
  operationKeyHash: string
  page: {
    inventoryComplete: true
    returned: number
    safetyLimit: number
  }
  privacy: IntegrationPrivacyProjection
  schemaVersion: number
  status: "planned"
  target: DiscordGuildIntegrationSummary
  warnings: string[]
}

export interface IntegrationDeletionResult {
  activityId: string
  associatedBotUserId: string | null
  guildId: string
  integrationId: string
  operationKeyHash: string
  planDigest: string
  schemaVersion: number
  status: "completed"
  targetApplicationId: string | null
  verifiedAbsent: true
  verifiedUnchanged: true
}

export interface IntegrationServiceClient extends Pick<
  DiscordClient,
  | "deleteGuildIntegration"
  | "getGuild"
  | "getGuildMember"
  | "getGuildRoles"
  | "listGuildIntegrations"
> {}

export interface IntegrationServiceOptions {
  activityStore: ActivityStore
  client: IntegrationServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface IntegrationState {
  access: IntegrationAccessEvidence
  botMember: DiscordGuildMember
  guild: DiscordGuild
  integrations: DiscordGuildIntegrationSummary[]
  inventoryComplete: boolean
  roles: DiscordRole[]
}

function evidenceError(message: string, cause?: unknown): IntegrationEvidenceError {
  return new IntegrationEvidenceError(
    message,
    cause === undefined ? undefined : { cause },
  )
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertPositiveSnowflake(value: unknown, description: string): asserts value is string {
  if (!positiveSnowflake(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function validText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string"
    || [...value].length < 1
    || [...value].length > maximum
    || /[\u0000-\u001F\u007F]/u.test(value)
  ) return false
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
}

export function normalizeIntegrationDeletionRequest(
  request: IntegrationDeletionRequest,
): NormalizedIntegrationDeletionRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord integration deletion request must be an object")
  }
  if (!hasExactKeys(
    request as unknown as Record<string, unknown>,
    INTEGRATION_DELETION_REQUEST_KEYS,
  )) {
    throw new RangeError("Discord integration deletion request must contain exact fields")
  }
  assertPositiveSnowflake(request.guildId, "Discord integration guild ID")
  assertPositiveSnowflake(request.integrationId, "Discord integration ID")
  if (
    typeof request.acknowledgeAssociatedBotKicked !== "boolean"
    || typeof request.acknowledgeAssociatedWebhooksRemoved !== "boolean"
    || typeof request.auditReason !== "string"
  ) {
    throw new RangeError("Discord integration deletion request fields are invalid")
  }
  encodeDiscordAuditReason(request.auditReason)
  return {
    acknowledgeAssociatedBotKicked: request.acknowledgeAssociatedBotKicked,
    acknowledgeAssociatedWebhooksRemoved: request.acknowledgeAssociatedWebhooksRemoved,
    auditReason: request.auditReason,
    guildId: request.guildId,
    integrationId: request.integrationId,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

function exactGuild(value: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.id !== guildId
    || !validText(value.name, DISCORD_LIMITS.channelNameCharacters)
    || !positiveSnowflake(value.owner_id)
  ) {
    throw evidenceError("Discord returned invalid integration guild evidence")
  }
  return value
}

function exactMember(
  value: DiscordGuildMember,
  userId: string,
  description: string,
): DiscordGuildMember {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !Array.isArray(value.roles)
    || value.roles.length > DISCORD_LIMITS.guildRoles
    || new Set(value.roles).size !== value.roles.length
    || value.roles.some((roleId) => !positiveSnowflake(roleId))
    || !value.user
    || value.user.id !== userId
    || value.user.bot !== true
  ) {
    throw evidenceError(`Discord returned invalid ${description} member evidence`)
  }
  return value
}

function exactRoles(value: readonly DiscordRole[], guildId: string): DiscordRole[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildRoles) {
    throw evidenceError("Discord returned an invalid bounded integration role inventory")
  }
  const ids = new Set<string>()
  const roles = value.map((role) => {
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
      throw evidenceError("Discord returned invalid or duplicate integration role evidence")
    }
    try {
      parseDiscordPermissionBits(role.permissions, `role ${role.id}`)
    } catch (error) {
      throw evidenceError("Discord returned invalid integration role permissions", error)
    }
    ids.add(role.id)
    return role
  })
  const everyone = roles.find((role) => role.id === guildId)
  if (
    !everyone
    || everyone.name !== "@everyone"
    || everyone.managed
    || everyone.position !== 0
  ) {
    throw evidenceError("Discord returned invalid integration @everyone role evidence")
  }
  return roles.sort((left, right) => left.id.localeCompare(right.id))
}

function optionalSnowflake(value: unknown): value is string | null {
  return value === null || positiveSnowflake(value)
}

function optionalBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean"
}

function optionalCount(value: unknown): value is number | null {
  return value === null || Number.isSafeInteger(value) && (value as number) >= 0
}

function exactIntegration(
  value: DiscordGuildIntegrationSummary,
): DiscordGuildIntegrationSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw evidenceError("Discord returned an invalid integration inventory item")
  }
  const record = value as unknown as Record<string, unknown>
  const unknownFieldCounts = record.unknownFieldCounts
  if (
    !hasExactKeys(record, INTEGRATION_SUMMARY_KEYS)
    || record.accountPresent !== true
    || !positiveSnowflake(record.id)
    || !optionalSnowflake(record.applicationId)
    || !optionalSnowflake(record.associatedBotUserId)
    || !optionalSnowflake(record.roleId)
    || typeof record.enabled !== "boolean"
    || !optionalBoolean(record.enableEmoticons)
    || !(record.expireBehavior === null || record.expireBehavior === 0 || record.expireBehavior === 1)
    || !optionalCount(record.expireGracePeriod)
    || typeof record.linkedUserPresent !== "boolean"
    || !optionalBoolean(record.revoked)
    || !optionalCount(record.subscriberCount)
    || !(record.syncedAt === null || (
      typeof record.syncedAt === "string"
      && !Number.isNaN(Date.parse(record.syncedAt))
      && new Date(record.syncedAt).toISOString() === record.syncedAt
    ))
    || !optionalBoolean(record.syncing)
    || !INTEGRATION_TYPES.includes(record.type as DiscordGuildIntegrationType)
    || !Array.isArray(record.knownScopes)
    || record.knownScopes.length > CONNECTOR_LIMITS.integrationOauthScopes
    || record.knownScopes.some((scope) => (
      typeof scope !== "string" || !KNOWN_SCOPE_PATTERN.test(scope)
    ))
    || new Set(record.knownScopes).size !== record.knownScopes.length
    || [...record.knownScopes].sort().join("\0") !== record.knownScopes.join("\0")
    || !Number.isSafeInteger(record.unknownScopeCount)
    || (record.unknownScopeCount as number) < 0
    || !unknownFieldCounts
    || typeof unknownFieldCounts !== "object"
    || Array.isArray(unknownFieldCounts)
    || !hasExactKeys(
      unknownFieldCounts as Record<string, unknown>,
      UNKNOWN_FIELD_COUNT_KEYS,
    )
    || UNKNOWN_FIELD_COUNT_KEYS.some((key) => (
      !Number.isSafeInteger((unknownFieldCounts as Record<string, unknown>)[key])
      || ((unknownFieldCounts as Record<string, unknown>)[key] as number) < 0
    ))
  ) {
    throw evidenceError("Discord returned an invalid integration inventory item")
  }
  return value
}

function exactInventory(
  value: readonly DiscordGuildIntegrationSummary[],
): DiscordGuildIntegrationSummary[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildIntegrations) {
    throw evidenceError("Discord returned an invalid bounded integration inventory")
  }
  const ids = new Set<string>()
  const integrations = value.map((entry) => {
    const integration = exactIntegration(entry)
    if (ids.has(integration.id)) {
      throw evidenceError("Discord returned duplicate integrations in one guild inventory")
    }
    ids.add(integration.id)
    return integration
  })
  return integrations.sort((left, right) => left.id.localeCompare(right.id))
}

function completePermissions(
  member: DiscordGuildMember,
  guildId: string,
  roles: readonly DiscordRole[],
): GuildMemberPermissionResult {
  let result: GuildMemberPermissionResult
  try {
    result = evaluateGuildMemberPermissions({ guildId, member, roles })
  } catch (error) {
    throw evidenceError("Discord returned invalid integration permission evidence", error)
  }
  if (!result.complete) {
    throw evidenceError("Discord returned incomplete integration permission evidence")
  }
  return result
}

function accessEvidence(
  permissions: GuildMemberPermissionResult,
  botIsGuildOwner: boolean,
): IntegrationAccessEvidence {
  return {
    appliedRoleIds: permissions.appliedRoleIds,
    botAdministrator: permissions.administrator,
    botIsGuildOwner,
    complete: true,
    effectivePermissionNames: permissions.effectivePermissionNames,
    effectivePermissions: permissions.effectivePermissions,
    manageGuild: true,
    requiredPermission: "MANAGE_GUILD",
    unknownPermissionBits: unknownDiscordPermissionBits(
      BigInt(permissions.effectivePermissions),
    ).toString(),
  }
}

function privacyProjection(): IntegrationPrivacyProjection {
  return {
    externalAccountIdentitiesProjectedOut: true,
    namesAndProfilesProjectedOut: true,
    omittedFields: PRIVACY_OMITTED_FIELDS,
    persistence: "none",
    rawPayloads: "omitted",
  }
}

function unknownEvidenceCount(integration: DiscordGuildIntegrationSummary): number {
  return integration.unknownScopeCount
    + UNKNOWN_FIELD_COUNT_KEYS.reduce(
      (total, key) => total + integration.unknownFieldCounts[key],
      0,
    )
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
    integrationId: receipt.resourceId,
    operationKeyHash: receipt.operationKeyHash,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function activityEntry(options: {
  activityId: string
  error?: string | null
  plan: IntegrationDeletionPlan
  request: NormalizedIntegrationDeletionRequest
  status: IntegrationDeletionActivityStatus
  timestamp: string
  verification?: "match" | null
}): IntegrationDeletionActivity {
  return {
    associatedBotUserId: options.plan.target.associatedBotUserId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    id: options.activityId,
    integrationId: options.request.integrationId,
    kind: "integration-deletion",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    targetApplicationId: options.plan.target.applicationId,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  error?: string | null
  plan: IntegrationDeletionPlan
  request: NormalizedIntegrationDeletionRequest
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.request.guildId,
    kind: "integration-deletion",
    operationKeyHash: options.request.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "completed" ? options.request.integrationId : null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (
    !(error instanceof IntegrationDeletionExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return error.result.status === "uncertain"
    || error.result.status === "completed-operation-record-failed"
}

async function withGuildLock<T>(
  guildId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => IntegrationDeletionExecutionError,
): Promise<T> {
  const prior = INTEGRATION_GUILD_LOCKS.get(guildId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: IntegrationTargetOutcome) => void = () => undefined
  const tail = new Promise<IntegrationTargetOutcome>((resolve) => {
    release = resolve
  })
  INTEGRATION_GUILD_LOCKS.set(guildId, tail)
  let outcome: IntegrationTargetOutcome = "settled"
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
    if (outcome === "settled" && INTEGRATION_GUILD_LOCKS.get(guildId) === tail) {
      INTEGRATION_GUILD_LOCKS.delete(guildId)
    }
  }
}

export class IntegrationService {
  readonly #activityStore: ActivityStore
  readonly #client: IntegrationServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: IntegrationServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #state(
    botId: string,
    guildId: string,
    mode: "audit" | "delete",
    options: RequestOptions,
    operationKeyHashValue?: string,
    integrationId?: string,
  ): Promise<IntegrationState> {
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    assertPositiveSnowflake(guildId, "Discord integration guild ID")
    if (mode === "delete") {
      if (!integrationId) throw new RangeError("Discord integration ID is required")
      this.#policy.assertGuildIntegrationDeletable(guildId, integrationId)
    } else {
      this.#policy.assertGuildIntegrationAuditable(guildId)
    }
    if (operationKeyHashValue) {
      const receipt = await this.#operationStore.get(
        "integration-deletion",
        operationKeyHashValue,
      )
      if (receipt) {
        throw new IntegrationDeletionOperationConflictError(receiptView(receipt))
      }
    }
    const [rawGuild, rawMember, rawRoles, rawIntegrations] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.getGuildMember(guildId, botId, options),
      this.#client.getGuildRoles(guildId, options),
      this.#client.listGuildIntegrations(guildId, options),
    ])
    const guild = exactGuild(rawGuild, guildId)
    const botMember = exactMember(rawMember, botId, "connector bot")
    const roles = exactRoles(rawRoles, guildId)
    const permissions = completePermissions(botMember, guildId, roles)
    const botIsGuildOwner = guild.owner_id === botId
    if (!botIsGuildOwner && !hasGuildPermission(permissions, "MANAGE_GUILD")) {
      throw evidenceError("Discord connector bot lacks guild-level MANAGE_GUILD")
    }
    return {
      access: accessEvidence(permissions, botIsGuildOwner),
      botMember,
      guild,
      integrations: exactInventory(rawIntegrations),
      inventoryComplete: rawIntegrations.length < DISCORD_LIMITS.guildIntegrations,
      roles,
    }
  }

  async list(
    applicationId: string,
    botId: string,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<IntegrationInventoryResult> {
    assertPositiveSnowflake(applicationId, "Discord integration application ID")
    assertPositiveSnowflake(botId, "Discord integration bot ID")
    assertPositiveSnowflake(guildId, "Discord integration guild ID")
    const state = await this.#state(botId, guildId, "audit", options)
    return {
      access: state.access,
      applicationId,
      botId,
      guild: { id: state.guild.id, name: state.guild.name },
      integrations: state.integrations,
      page: {
        inventoryComplete: state.inventoryComplete,
        returned: state.integrations.length,
        safetyLimit: DISCORD_LIMITS.guildIntegrations,
      },
      privacy: privacyProjection(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async #associatedBotPresent(
    guildId: string,
    userId: string,
    options: RequestOptions,
  ): Promise<boolean> {
    try {
      const member = await this.#client.getGuildMember(guildId, userId, options)
      exactMember(member, userId, "associated bot")
      return true
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) return false
      throw error
    }
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedIntegrationDeletionRequest,
    options: RequestOptions,
  ): Promise<IntegrationDeletionPlan> {
    assertPositiveSnowflake(applicationId, "Discord connector application ID")
    assertPositiveSnowflake(botId, "Discord connector bot ID")
    const state = await this.#state(
      botId,
      request.guildId,
      "delete",
      options,
      request.operationKeyHash,
      request.integrationId,
    )
    if (!state.inventoryComplete) {
      throw evidenceError(
        "Discord integration inventory is ambiguous at the endpoint safety limit",
      )
    }
    const target = state.integrations.find(
      (integration) => integration.id === request.integrationId,
    )
    if (!target) {
      throw evidenceError("Discord integration is absent from the complete guild inventory")
    }
    if (state.integrations.some((integration) => (
      integration.type === "unknown" || unknownEvidenceCount(integration) > 0
    ))) {
      throw evidenceError("Discord integration deletion requires fully understood inventory evidence")
    }
    if (target.type === "guild_subscription") {
      throw evidenceError("Discord guild subscription integrations are audit-only")
    }
    if (
      target.applicationId === applicationId
      || target.associatedBotUserId === botId
    ) {
      throw evidenceError("Discord connector identity cannot delete its own integration")
    }
    if (target.associatedBotUserId !== null) {
      this.#policy.assertUserNotProtected(target.associatedBotUserId)
    }
    if (!request.acknowledgeAssociatedWebhooksRemoved) {
      throw new RangeError(
        "Discord integration deletion requires acknowledging associated webhook removal",
      )
    }
    if (
      target.associatedBotUserId !== null
      && !request.acknowledgeAssociatedBotKicked
    ) {
      throw new RangeError(
        "Discord integration deletion requires acknowledging the associated bot kick",
      )
    }
    const associatedBotPresent = target.associatedBotUserId === null
      ? false
      : await this.#associatedBotPresent(
          request.guildId,
          target.associatedBotUserId,
          options,
        )
    const privacy = privacyProjection()
    const warnings = [
      ...(state.access.botAdministrator
        ? ["Discord connector bot has ADMINISTRATOR; replace it with narrowly scoped MANAGE_GUILD"]
        : []),
      "Integration deletion is permanent and Discord can remove associated webhooks",
      ...(target.associatedBotUserId === null
        ? []
        : ["Integration deletion can kick the associated bot from the guild"]),
      "Discord does not expose the exact associated webhook impact set before deletion",
      "External account identities, names, descriptions, icons, profiles, and raw payloads are projected out",
      "Same-guild serialization is process-local; do not run overlapping integration deletion scope in multiple connector processes",
      "The operation key is one-shot and cannot be retried after reservation, including after an uncertain outcome",
      "Discord deletes by integration ID after a non-atomic inventory read; prevent concurrent integration administration during execution",
    ]
    const roleSnapshot = state.roles.map((role) => ({
      id: role.id,
      managed: role.managed,
      permissions: role.permissions,
      position: role.position,
    }))
    const acknowledgments = {
      associatedBotKicked: request.acknowledgeAssociatedBotKicked,
      associatedWebhooksRemoved: true as const,
    }
    const digest = reviewedPlanDigest(this.#planKey, {
      access: state.access,
      acknowledgments,
      applicationId,
      associatedBotMembership: {
        present: associatedBotPresent,
        userId: target.associatedBotUserId,
      },
      botId,
      botMemberRoleIds: [...state.botMember.roles].sort(),
      domain: "discord-mcp-integration-deletion-plan.v1",
      guild: {
        id: state.guild.id,
        name: state.guild.name,
        ownerId: state.guild.owner_id,
      },
      integrations: state.integrations,
      privacy,
      request,
      roles: roleSnapshot,
      warnings,
    })
    return {
      access: state.access,
      acknowledgments,
      action: "delete",
      applicationId,
      associatedBotMembership: {
        present: associatedBotPresent,
        userId: target.associatedBotUserId,
      },
      auditReason: request.auditReason,
      botId,
      createdAt: this.#clock().toISOString(),
      digest,
      guild: { id: state.guild.id, name: state.guild.name },
      inventory: state.integrations,
      operationKeyHash: request.operationKeyHash,
      page: {
        inventoryComplete: true,
        returned: state.integrations.length,
        safetyLimit: DISCORD_LIMITS.guildIntegrations,
      },
      privacy,
      schemaVersion: SCHEMA_VERSION,
      status: "planned",
      target,
      warnings,
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: IntegrationDeletionRequest,
    options: RequestOptions = {},
  ): Promise<IntegrationDeletionPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeIntegrationDeletionRequest(request),
      options,
    )
  }

  execute(
    applicationId: string,
    botId: string,
    request: IntegrationDeletionRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<IntegrationDeletionResult> {
    const normalized = normalizeIntegrationDeletionRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord integration deletion plan digest is invalid")
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
      () => new IntegrationDeletionExecutionError(
        "Discord integration deletion was blocked because a prior same-guild operation ended with an uncertain outcome",
        {
          guildId: normalized.guildId,
          integrationId: normalized.integrationId,
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
    request: NormalizedIntegrationDeletionRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<IntegrationDeletionResult> {
    let plan: IntegrationDeletionPlan
    try {
      plan = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof IntegrationEvidenceError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new IntegrationDeletionPlanChangedError(expectedDigest, STATE_UNAVAILABLE)
      }
      throw error
    }
    if (plan.digest !== expectedDigest) {
      throw new IntegrationDeletionPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      associatedBotUserId: plan.target.associatedBotUserId,
      guildId: request.guildId,
      integrationId: request.integrationId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
      targetApplicationId: plan.target.applicationId,
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
      throw new IntegrationDeletionOperationConflictError(receiptView(reservation.receipt))
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
      throw new IntegrationDeletionExecutionError(
        "Discord integration deletion was blocked because pending activity could not be recorded",
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

    let mutationCompleted = false
    try {
      await this.#client.deleteGuildIntegration(
        request.guildId,
        request.integrationId,
        request.auditReason,
        options,
      )
      mutationCompleted = true
      const observed = await this.#state(botId, request.guildId, "audit", options)
      if (!observed.inventoryComplete) {
        throw evidenceError("Discord integration deletion readback is incomplete")
      }
      const expected = plan.inventory.filter(
        (integration) => integration.id !== request.integrationId,
      )
      if (stableString(observed.integrations) !== stableString(expected)) {
        throw evidenceError("Discord integration deletion readback contains unexpected drift")
      }
    } catch (error) {
      const settledClientFailure = !mutationCompleted
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 408
        && error.status !== 429
      const status = settledClientFailure ? "failed" : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: errorCode,
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
          error: errorCode,
          plan,
          request,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new IntegrationDeletionExecutionError(
        "Discord integration deletion did not complete with exact verified state",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          error: errorCode,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
          verifiedAbsent: null,
          verifiedUnchanged: null,
        },
        { cause: error },
      )
    }

    const result: IntegrationDeletionResult = {
      ...baseResult,
      activityId,
      status: "completed",
      verifiedAbsent: true,
      verifiedUnchanged: true,
    }
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        request,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      let activityRecordError: string | null = null
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          error: safeErrorCode(error),
          plan,
          request,
          status: "uncertain",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new IntegrationDeletionExecutionError(
        "Discord integration deletion completed but the operation receipt failed",
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
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      throw new IntegrationDeletionExecutionError(
        "Discord integration deletion completed but the final activity record failed",
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
