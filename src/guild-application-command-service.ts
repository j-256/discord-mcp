import { createHash, randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GuildApplicationCommandActivity,
  GuildApplicationCommandActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordClient,
  DiscordGuildApplicationCommandPermissions,
} from "./discord-client.js"
import {
  DiscordApiError,
  GuildApplicationCommandEvidenceError,
  GuildApplicationCommandExecutionError,
  GuildApplicationCommandOperationConflictError,
  GuildApplicationCommandPlanChangedError,
} from "./errors.js"
import {
  guildApplicationCommandDefinitionDigest,
  type GuildApplicationCommandDefinition,
  GuildApplicationCommandDefinitionError,
  type GuildApplicationCommandType,
  normalizeGuildApplicationCommandDefinition,
  type ProjectedGuildApplicationCommand,
  projectGuildApplicationCommand,
  sameGuildApplicationCommandDefinition,
} from "./guild-application-command-definition.js"
import { stableString } from "./normalize.js"
import {
  type OperationReceipt,
  type OperationStore,
  operationKeyHash,
} from "./operation-store.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordApplicationCommand,
  DiscordGuild,
  DiscordGuildMember,
  RequestOptions,
} from "./types.js"

export const GUILD_APPLICATION_COMMAND_ACTIONS = Object.freeze([
  "create",
  "delete",
  "update",
] as const)

export type GuildApplicationCommandAction =
  typeof GUILD_APPLICATION_COMMAND_ACTIONS[number]

export interface CreateGuildApplicationCommandRequest {
  action: "create"
  definition: GuildApplicationCommandDefinition
  guildId: string
  operationKey: string
}

export interface UpdateGuildApplicationCommandRequest {
  action: "update"
  commandId: string
  definition: GuildApplicationCommandDefinition
  guildId: string
  operationKey: string
}

export interface DeleteGuildApplicationCommandRequest {
  acknowledgeDeletion: true
  action: "delete"
  commandId: string
  guildId: string
  operationKey: string
}

export type GuildApplicationCommandChangeRequest =
  | CreateGuildApplicationCommandRequest
  | DeleteGuildApplicationCommandRequest
  | UpdateGuildApplicationCommandRequest

interface NormalizedRequestBase {
  action: GuildApplicationCommandAction
  guildId: string
  operationKeyHash: string
}

export type NormalizedGuildApplicationCommandChangeRequest =
  | (Omit<CreateGuildApplicationCommandRequest, "operationKey"> & NormalizedRequestBase)
  | (Omit<DeleteGuildApplicationCommandRequest, "operationKey"> & NormalizedRequestBase)
  | (Omit<UpdateGuildApplicationCommandRequest, "operationKey"> & NormalizedRequestBase)

export interface GuildApplicationCommandInventoryEntry {
  commandId: string
  definitionDigest: string
  name: string
  type: GuildApplicationCommandType
  version: string
}

export interface GuildApplicationCommandPermissionOverwrite {
  allowed: boolean
  id: string
  type: 1 | 2 | 3
}

export interface GuildApplicationCommandPermissionEntry {
  commandId: string
  entryDigest: string
  overwriteCount: number
}

export interface GuildApplicationCommandPermissionTarget {
  commandId: string
  entryDigest: string
  overwrites: GuildApplicationCommandPermissionOverwrite[]
}

export interface GuildApplicationCommandPlan {
  action: GuildApplicationCommandAction
  applicationId: string
  botId: string
  commandId: string | null
  commandType: GuildApplicationCommandType | null
  createdAt: string
  desiredDefinition: GuildApplicationCommandDefinition | null
  desiredDefinitionDigest: string | null
  digest: string
  effect: "change" | "none"
  existingDefinition: GuildApplicationCommandDefinition | null
  existingDefinitionDigest: string | null
  guild: {
    id: string
    name: string
  }
  inventory: {
    counts: Record<GuildApplicationCommandType, number>
    digest: string
    entries: GuildApplicationCommandInventoryEntry[]
    limits: Record<GuildApplicationCommandType, number>
    returned: number
    totalLimit: number
  }
  operationKeyHash: string
  permissionEffect: "none" | "target-overwrites-cleared-by-discord"
  permissions: {
    digest: string
    entries: GuildApplicationCommandPermissionEntry[]
    returned: number
    target: GuildApplicationCommandPermissionTarget | null
  }
  privacy: {
    definitionsPersisted: false
    namesPersisted: false
    permissionTargetsPersisted: false
    planTextTransient: true
  }
  risks: string[]
  schemaVersion: number
  status: "already-absent" | "already-current" | "planned"
  verification: {
    commandInventory: "exact-full-localization-readback"
    permissionInventory: "exact-survivor-readback"
    retriesAfterReservation: false
  }
  warnings: string[]
  writeRequired: boolean
}

export interface GuildApplicationCommandResult {
  action: GuildApplicationCommandAction
  activityId: string | null
  applicationId: string
  commandId: string
  commandType: GuildApplicationCommandType | null
  guildId: string
  observed: ProjectedGuildApplicationCommand | null
  observedInventoryDigest: string
  observedPermissionDigest: string
  operationKeyHash: string
  planDigest: string
  readbackMatched: true
  schemaVersion: number
  status: "already-absent" | "already-current" | "completed"
}

export interface GuildApplicationCommandServiceClient extends Pick<
  DiscordClient,
  | "createGuildApplicationCommand"
  | "deleteGuildApplicationCommand"
  | "editGuildApplicationCommand"
  | "getGuild"
  | "getGuildMember"
  | "listGuildApplicationCommandPermissions"
  | "listGuildApplicationCommandsWithLocalizations"
> {}

export interface GuildApplicationCommandServiceOptions {
  activityStore: ActivityStore
  client: GuildApplicationCommandServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface ExactPermissionEntry {
  commandId: string
  overwrites: GuildApplicationCommandPermissionOverwrite[]
}

interface ExactState {
  bot: {
    id: string
  }
  guild: DiscordGuild
  inventory: ProjectedGuildApplicationCommand[]
  inventoryDigest: string
  permissions: ExactPermissionEntry[]
  permissionDigest: string
}

interface BuiltPlan {
  plan: GuildApplicationCommandPlan
  state: ExactState
}

interface TargetLockState {
  tails: Map<string, Promise<TargetOutcome>>
  uncertainTargets: Set<string>
}

type TargetOutcome = "settled" | "uncertain"

const GUILD_APPLICATION_COMMAND_STATE_UNAVAILABLE =
  "guild-application-command-state-unavailable"
const APPLICATION_COMMAND_LIMITS: Readonly<Record<GuildApplicationCommandType, number>> =
  Object.freeze({
    "chat-input": DISCORD_LIMITS.applicationCommandGuildChatInputCommands,
    message: DISCORD_LIMITS.applicationCommandGuildMessageCommands,
    user: DISCORD_LIMITS.applicationCommandGuildUserCommands,
  })
const CREATE_REQUEST_KEYS = ["action", "definition", "guildId", "operationKey"] as const
const UPDATE_REQUEST_KEYS = [
  "action",
  "commandId",
  "definition",
  "guildId",
  "operationKey",
] as const
const DELETE_REQUEST_KEYS = [
  "acknowledgeDeletion",
  "action",
  "commandId",
  "guildId",
  "operationKey",
] as const
const PERMISSION_ENTRY_KEYS = [
  "applicationId",
  "commandId",
  "guildId",
  "permissions",
  "unknownFieldCount",
] as const
const PERMISSION_OVERWRITE_KEYS = [
  "allowed",
  "id",
  "type",
  "unknownFieldCount",
] as const

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  return actual.length === canonical.length
    && actual.every((key, index) => key === canonical[index])
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) < 1n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) {
    throw new RangeError(`${description} must be a positive Discord snowflake ID`)
  }
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  if (leftId < rightId) return -1
  if (leftId > rightId) return 1
  return 0
}

export function normalizeGuildApplicationCommandChangeRequest(
  request: GuildApplicationCommandChangeRequest,
): NormalizedGuildApplicationCommandChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord guild application-command request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  assertSnowflake(record.guildId, "Discord guild application-command guild ID")
  if (record.action === "create") {
    if (!exactKeys(record, CREATE_REQUEST_KEYS)) {
      throw new RangeError("Discord guild application-command create request is invalid")
    }
    return {
      action: "create",
      definition: normalizeGuildApplicationCommandDefinition(record.definition),
      guildId: record.guildId,
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  if (record.action === "update") {
    if (!exactKeys(record, UPDATE_REQUEST_KEYS)) {
      throw new RangeError("Discord guild application-command update request is invalid")
    }
    assertSnowflake(record.commandId, "Discord guild application-command ID")
    return {
      action: "update",
      commandId: record.commandId,
      definition: normalizeGuildApplicationCommandDefinition(record.definition),
      guildId: record.guildId,
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  if (record.action === "delete") {
    if (
      !exactKeys(record, DELETE_REQUEST_KEYS)
      || record.acknowledgeDeletion !== true
    ) {
      throw new RangeError(
        "Discord guild application-command deletion requires acknowledgeDeletion=true",
      )
    }
    assertSnowflake(record.commandId, "Discord guild application-command ID")
    return {
      acknowledgeDeletion: true,
      action: "delete",
      commandId: record.commandId,
      guildId: record.guildId,
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  throw new RangeError(
    "Discord guild application-command action must be create, update, or delete",
  )
}

function evidenceDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(stableString(value))
    .digest("hex")}`
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !guild
    || typeof guild !== "object"
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
    || guild.name.length > DISCORD_LIMITS.guildNameCharacters
  ) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord returned incomplete or mismatched application-command guild evidence",
    )
  }
  return guild
}

function exactBotMember(member: DiscordGuildMember, botId: string): { id: string } {
  if (
    !member
    || typeof member !== "object"
    || !member.user
    || member.user.id !== botId
    || member.user.bot !== true
    || !Array.isArray(member.roles)
    || member.roles.length > DISCORD_LIMITS.guildRoles
    || member.pending === true
  ) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord returned incomplete or mismatched application-command bot membership evidence",
    )
  }
  const roleIds = new Set<string>()
  try {
    for (const roleId of member.roles) {
      assertSnowflake(roleId, "Discord application-command bot role ID")
      if (roleIds.has(roleId)) throw new Error("duplicate role")
      roleIds.add(roleId)
    }
  } catch (error) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord returned invalid application-command bot membership evidence",
      { cause: error },
    )
  }
  return { id: botId }
}

function projectedCommand(
  command: DiscordApplicationCommand,
  applicationId: string,
  guildId: string,
): ProjectedGuildApplicationCommand {
  try {
    return projectGuildApplicationCommand(command, applicationId, guildId)
  } catch (error) {
    if (error instanceof GuildApplicationCommandDefinitionError) {
      throw new GuildApplicationCommandEvidenceError(
        "Discord returned incomplete or unsupported guild application-command evidence",
        { cause: error },
      )
    }
    throw error
  }
}

function commandCounts(
  inventory: readonly ProjectedGuildApplicationCommand[],
): Record<GuildApplicationCommandType, number> {
  const counts: Record<GuildApplicationCommandType, number> = {
    "chat-input": 0,
    message: 0,
    user: 0,
  }
  for (const command of inventory) counts[command.definition.type] += 1
  return counts
}

function exactInventory(
  value: DiscordApplicationCommand[],
  applicationId: string,
  guildId: string,
): ProjectedGuildApplicationCommand[] {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.applicationCommandGuildCommands
  ) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord returned an invalid guild application-command inventory",
    )
  }
  const inventory = value.map((command) => (
    projectedCommand(command, applicationId, guildId)
  )).sort((left, right) => compareSnowflakes(left.commandId, right.commandId))
  if (new Set(inventory.map(({ commandId }) => commandId)).size !== inventory.length) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord returned duplicate guild application-command IDs",
    )
  }
  if (inventory.some(({ commandId }) => commandId === applicationId)) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord returned an application-command ID that conflicts with application defaults",
    )
  }
  const nameTypes = inventory.map(({ definition }) => (
    `${definition.type}\0${definition.name}`
  ))
  if (new Set(nameTypes).size !== nameTypes.length) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord returned duplicate guild application-command name and type pairs",
    )
  }
  const counts = commandCounts(inventory)
  for (const type of Object.keys(APPLICATION_COMMAND_LIMITS) as GuildApplicationCommandType[]) {
    if (counts[type] > APPLICATION_COMMAND_LIMITS[type]) {
      throw new GuildApplicationCommandEvidenceError(
        `Discord returned more ${type} guild commands than the documented capacity`,
      )
    }
  }
  return inventory
}

function exactPermissions(
  value: DiscordGuildApplicationCommandPermissions[],
  applicationId: string,
  guildId: string,
  inventory: readonly ProjectedGuildApplicationCommand[],
): ExactPermissionEntry[] {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.guildApplicationCommandPermissions
  ) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord returned an invalid guild application-command permission inventory",
    )
  }
  const commandIds = new Set(inventory.map(({ commandId }) => commandId))
  const seenEntries = new Set<string>()
  const permissions = value.map((entry) => {
    if (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || !exactKeys(entry as unknown as Record<string, unknown>, PERMISSION_ENTRY_KEYS)
      || entry.applicationId !== applicationId
      || entry.guildId !== guildId
      || entry.unknownFieldCount !== 0
      || !Array.isArray(entry.permissions)
      || entry.permissions.length > DISCORD_LIMITS.applicationCommandPermissionOverwrites
    ) {
      throw new GuildApplicationCommandEvidenceError(
        "Discord returned incomplete guild application-command permission evidence",
      )
    }
    try {
      assertSnowflake(entry.commandId, "Discord guild application-command permission ID")
    } catch (error) {
      throw new GuildApplicationCommandEvidenceError(
        "Discord returned invalid guild application-command permission evidence",
        { cause: error },
      )
    }
    if (
      seenEntries.has(entry.commandId)
      || (entry.commandId !== applicationId && !commandIds.has(entry.commandId))
    ) {
      throw new GuildApplicationCommandEvidenceError(
        "Discord returned unrelated or duplicate guild application-command permission evidence",
      )
    }
    seenEntries.add(entry.commandId)
    const seenOverwrites = new Set<string>()
    const overwrites = entry.permissions.map((overwrite) => {
      if (
        !overwrite
        || typeof overwrite !== "object"
        || Array.isArray(overwrite)
        || !exactKeys(
          overwrite as unknown as Record<string, unknown>,
          PERMISSION_OVERWRITE_KEYS,
        )
        || typeof overwrite.allowed !== "boolean"
        || ![1, 2, 3].includes(overwrite.type)
        || overwrite.unknownFieldCount !== 0
      ) {
        throw new GuildApplicationCommandEvidenceError(
          "Discord returned incomplete guild application-command overwrite evidence",
        )
      }
      try {
        assertSnowflake(overwrite.id, "Discord guild application-command overwrite target ID")
      } catch (error) {
        throw new GuildApplicationCommandEvidenceError(
          "Discord returned invalid guild application-command overwrite evidence",
          { cause: error },
        )
      }
      const key = `${overwrite.type}:${overwrite.id}`
      if (seenOverwrites.has(key)) {
        throw new GuildApplicationCommandEvidenceError(
          "Discord returned duplicate guild application-command overwrite evidence",
        )
      }
      seenOverwrites.add(key)
      return {
        allowed: overwrite.allowed,
        id: overwrite.id,
        type: overwrite.type,
      }
    }).sort((left, right) => (
      left.type - right.type || compareSnowflakes(left.id, right.id)
    ))
    return {
      commandId: entry.commandId,
      overwrites,
    }
  }).sort((left, right) => compareSnowflakes(left.commandId, right.commandId))
  return permissions
}

function inventoryDigest(
  applicationId: string,
  guildId: string,
  inventory: readonly ProjectedGuildApplicationCommand[],
): string {
  return evidenceDigest("guildcontrol:guild-application-command-inventory:v1", {
    applicationId,
    guildId,
    inventory,
  })
}

function permissionDigest(
  applicationId: string,
  guildId: string,
  permissions: readonly ExactPermissionEntry[],
): string {
  return evidenceDigest("guildcontrol:guild-application-command-permissions:v1", {
    applicationId,
    guildId,
    permissions,
  })
}

function inventoryEntries(
  inventory: readonly ProjectedGuildApplicationCommand[],
): GuildApplicationCommandInventoryEntry[] {
  return inventory.map((command) => ({
    commandId: command.commandId,
    definitionDigest: guildApplicationCommandDefinitionDigest(command.definition),
    name: command.definition.name,
    type: command.definition.type,
    version: command.version,
  }))
}

function permissionEntryDigest(entry: ExactPermissionEntry): string {
  return evidenceDigest("guildcontrol:guild-application-command-permission-entry:v1", entry)
}

function permissionEntries(
  permissions: readonly ExactPermissionEntry[],
): GuildApplicationCommandPermissionEntry[] {
  return permissions.map((entry) => ({
    commandId: entry.commandId,
    entryDigest: permissionEntryDigest(entry),
    overwriteCount: entry.overwrites.length,
  }))
}

function permissionTarget(
  permissions: readonly ExactPermissionEntry[],
  commandId: string | null,
): GuildApplicationCommandPermissionTarget | null {
  if (commandId === null) return null
  const target = permissions.find((entry) => entry.commandId === commandId)
  if (!target) return null
  return {
    commandId: target.commandId,
    entryDigest: permissionEntryDigest(target),
    overwrites: target.overwrites.map((overwrite) => ({ ...overwrite })),
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableString(left) === stableString(right)
}

function targetId(
  request: NormalizedGuildApplicationCommandChangeRequest,
): string | null {
  return request.action === "create" ? null : request.commandId
}

function desiredDefinition(
  request: NormalizedGuildApplicationCommandChangeRequest,
): GuildApplicationCommandDefinition | null {
  return request.action === "delete" ? null : request.definition
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  return name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128) || "UnknownError"
}

function requiredCommandType(plan: GuildApplicationCommandPlan): GuildApplicationCommandType {
  if (plan.commandType === null) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord guild application-command mutation lost its exact command type",
    )
  }
  return plan.commandType
}

function activityEntry(options: {
  activityId: string
  commandId?: string | null
  error?: string | null
  plan: GuildApplicationCommandPlan
  status: GuildApplicationCommandActivityStatus
  timestamp: string
  verification?: "match" | null
}): GuildApplicationCommandActivity {
  return {
    action: options.plan.action,
    applicationId: options.plan.applicationId,
    botId: options.plan.botId,
    commandId: options.commandId === undefined
      ? options.plan.commandId
      : options.commandId,
    commandType: requiredCommandType(options.plan),
    desiredDefinitionDigest: options.plan.desiredDefinitionDigest,
    error: options.error ?? null,
    existingDefinitionDigest: options.plan.existingDefinitionDigest,
    guildId: options.plan.guild.id,
    id: options.activityId,
    inventoryDigest: options.plan.inventory.digest,
    kind: "guild-application-command-change",
    operationKeyHash: options.plan.operationKeyHash,
    permissionDigest: options.plan.permissions.digest,
    planDigest: options.plan.digest,
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function operationReceipt(options: {
  activityId: string
  commandId?: string | null
  error?: string | null
  plan: GuildApplicationCommandPlan
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): OperationReceipt {
  const commandId = options.commandId === undefined
    ? options.plan.commandId
    : options.commandId
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    kind: "guild-application-command-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.status === "pending" || options.status === "failed"
      ? null
      : commandId,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function receiptView(receipt: OperationReceipt) {
  return {
    activityId: receipt.activityId,
    error: receipt.error,
    guildId: receipt.guildId,
    operationKeyHash: receipt.operationKeyHash,
    resourceId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function executionBlocksTarget(error: unknown): boolean {
  if (
    !(error instanceof GuildApplicationCommandExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["completed-record-failed", "uncertain"].includes(
    String(error.result.status),
  )
}

async function withTargetLock<T>(
  state: TargetLockState,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => GuildApplicationCommandExecutionError,
): Promise<T> {
  const prior = state.tails.get(key) ?? Promise.resolve("settled" as const)
  let release: (outcome: TargetOutcome) => void = () => undefined
  const tail = new Promise<TargetOutcome>((resolve) => {
    release = resolve
  })
  state.tails.set(key, tail)
  let outcome: TargetOutcome = "settled"
  try {
    await prior
    if (state.uncertainTargets.has(key)) {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksTarget(error)) {
      outcome = "uncertain"
      state.uncertainTargets.add(key)
    }
    throw error
  } finally {
    release(outcome)
    if (state.tails.get(key) === tail) state.tails.delete(key)
  }
}

function assertCommandCollectionEqual(
  actual: readonly ProjectedGuildApplicationCommand[],
  expected: readonly ProjectedGuildApplicationCommand[],
  message: string,
): void {
  if (!sameValue(actual, expected)) {
    throw new GuildApplicationCommandEvidenceError(message)
  }
}

function assertPermissionCollectionEqual(
  actual: readonly ExactPermissionEntry[],
  expected: readonly ExactPermissionEntry[],
  message: string,
): void {
  if (!sameValue(actual, expected)) {
    throw new GuildApplicationCommandEvidenceError(message)
  }
}

function withoutCommand<T extends { commandId: string }>(
  values: readonly T[],
  commandId: string,
): T[] {
  return values.filter((entry) => entry.commandId !== commandId)
}

function verifyPermissionTransition(
  action: GuildApplicationCommandAction,
  renamed: boolean,
  commandId: string,
  before: readonly ExactPermissionEntry[],
  after: readonly ExactPermissionEntry[],
): void {
  if (action === "create") {
    assertPermissionCollectionEqual(
      withoutCommand(after, commandId),
      before,
      "Discord application-command creation changed unrelated permission evidence",
    )
    const created = after.find((entry) => entry.commandId === commandId)
    if (created && created.overwrites.length > 0) {
      throw new GuildApplicationCommandEvidenceError(
        "Discord application-command creation unexpectedly added command overwrites",
      )
    }
    return
  }
  if (action === "update" && !renamed) {
    assertPermissionCollectionEqual(
      after,
      before,
      "Discord application-command update changed permission evidence unexpectedly",
    )
    return
  }
  assertPermissionCollectionEqual(
    withoutCommand(after, commandId),
    withoutCommand(before, commandId),
    "Discord application-command mutation changed unrelated permission evidence",
  )
  const target = after.find((entry) => entry.commandId === commandId)
  if (target && target.overwrites.length > 0) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord application-command rename or deletion retained unexpected target overwrites",
    )
  }
  if (action === "delete" && target) {
    throw new GuildApplicationCommandEvidenceError(
      "Discord application-command deletion retained target permission evidence",
    )
  }
}

export class GuildApplicationCommandService {
  readonly #activityStore: ActivityStore
  readonly #client: GuildApplicationCommandServiceClient
  readonly #clock: () => Date
  readonly #lockState: TargetLockState = {
    tails: new Map(),
    uncertainTargets: new Set(),
  }
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: GuildApplicationCommandServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedGuildApplicationCommandChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltPlan> {
    this.#policy.assertGuildApplicationCommandChangeAllowed(request.guildId)
    assertSnowflake(applicationId, "Discord application ID")
    assertSnowflake(botId, "Discord bot ID")
    const [guildValue, memberValue, inventoryValue, permissionValue] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.getGuildMember(request.guildId, botId, options),
      this.#client.listGuildApplicationCommandsWithLocalizations(
        applicationId,
        request.guildId,
        options,
      ),
      this.#client.listGuildApplicationCommandPermissions(
        applicationId,
        request.guildId,
        options,
      ),
    ])
    const guild = exactGuild(guildValue, request.guildId)
    const bot = exactBotMember(memberValue, botId)
    const inventory = exactInventory(inventoryValue, applicationId, request.guildId)
    const permissions = exactPermissions(
      permissionValue,
      applicationId,
      request.guildId,
      inventory,
    )
    const commandId = targetId(request)
    const existing = commandId === null
      ? null
      : inventory.find((command) => command.commandId === commandId) ?? null
    const desired = desiredDefinition(request)

    if (request.action === "create") {
      if (inventory.some(({ definition }) => (
        definition.type === request.definition.type
        && definition.name === request.definition.name
      ))) {
        throw new GuildApplicationCommandEvidenceError(
          "Discord guild application-command creation collides with an exact name and type pair",
        )
      }
      const counts = commandCounts(inventory)
      if (
        inventory.length >= DISCORD_LIMITS.applicationCommandGuildCommands
        || counts[request.definition.type] >= APPLICATION_COMMAND_LIMITS[request.definition.type]
      ) {
        throw new GuildApplicationCommandEvidenceError(
          `Discord guild ${request.definition.type} application-command capacity is exhausted`,
        )
      }
    }
    if (request.action === "update") {
      if (!existing) {
        throw new GuildApplicationCommandEvidenceError(
          "Discord guild application-command update target is absent",
        )
      }
      if (existing.definition.type !== request.definition.type) {
        throw new GuildApplicationCommandEvidenceError(
          "Discord guild application-command updates cannot change command type",
        )
      }
      if (inventory.some((command) => (
        command.commandId !== request.commandId
        && command.definition.type === request.definition.type
        && command.definition.name === request.definition.name
      ))) {
        throw new GuildApplicationCommandEvidenceError(
          "Discord guild application-command update collides with an exact name and type pair",
        )
      }
    }

    const effect = request.action === "delete"
      ? existing === null ? "none" : "change"
      : request.action === "update" && existing
        && sameGuildApplicationCommandDefinition(existing.definition, request.definition)
        ? "none"
        : "change"
    const renamed = request.action === "update"
      && existing !== null
      && existing.definition.name !== request.definition.name
    const permissionEffect = existing !== null
      && (request.action === "delete" || renamed)
      ? "target-overwrites-cleared-by-discord"
      : "none"
    const exactInventoryDigest = inventoryDigest(
      applicationId,
      request.guildId,
      inventory,
    )
    const exactPermissionDigest = permissionDigest(
      applicationId,
      request.guildId,
      permissions,
    )
    const risks = [
      "The full localized guild command and permission inventories are freshness-bound, so concurrent changes invalidate execution",
      "Each write is one-shot after operation-key reservation and is never automatically retried",
      "Discord does not document audit-log reason support for application-command writes",
      ...(request.action === "delete" && existing
        ? ["Deletion is irreversible and Discord permanently deletes the command's permission overwrites"]
        : []),
      ...(renamed
        ? ["Renaming permanently deletes the command's permission overwrites in Discord"]
        : []),
      ...(request.action === "update"
        ? ["Update submits one complete definition, so every reviewed aggregate field replaces its prior value"]
        : []),
    ]
    const warnings = [
      "Command names, descriptions, localizations, choices, and permission targets are transient untrusted evidence and are never persisted",
      "Command-specific permission writes remain unsupported because Discord requires a user Bearer token",
      "The connector bot must be an exact non-pending member of the selected guild",
      ...(request.action === "create"
        ? ["Creation fails closed on Discord's 200 upsert response instead of overwriting a same-name command"]
        : []),
    ]
    const existingDefinition = existing?.definition ?? null
    const existingDefinitionDigest = existingDefinition
      ? guildApplicationCommandDefinitionDigest(existingDefinition)
      : null
    const desiredDefinitionDigest = desired
      ? guildApplicationCommandDefinitionDigest(desired)
      : null
    const digest = reviewedPlanDigest(this.#planKey, {
      action: request.action,
      applicationId,
      bot,
      botId,
      commandId,
      desired,
      desiredDefinitionDigest,
      effect,
      existing: existingDefinition,
      existingDefinitionDigest,
      guildId: request.guildId,
      inventoryDigest: exactInventoryDigest,
      operationKeyHash: request.operationKeyHash,
      permissionDigest: exactPermissionDigest,
      permissionEffect,
      risks,
      warnings,
    })
    const status = effect === "change"
      ? "planned"
      : request.action === "delete"
        ? "already-absent"
        : "already-current"
    const plan: GuildApplicationCommandPlan = {
      action: request.action,
      applicationId,
      botId,
      commandId,
      commandType: request.action === "create"
        ? request.definition.type
        : existing?.definition.type ?? null,
      createdAt: this.#clock().toISOString(),
      desiredDefinition: desired,
      desiredDefinitionDigest,
      digest,
      effect,
      existingDefinition,
      existingDefinitionDigest,
      guild: {
        id: request.guildId,
        name: guild.name,
      },
      inventory: {
        counts: commandCounts(inventory),
        digest: exactInventoryDigest,
        entries: inventoryEntries(inventory),
        limits: { ...APPLICATION_COMMAND_LIMITS },
        returned: inventory.length,
        totalLimit: DISCORD_LIMITS.applicationCommandGuildCommands,
      },
      operationKeyHash: request.operationKeyHash,
      permissionEffect,
      permissions: {
        digest: exactPermissionDigest,
        entries: permissionEntries(permissions),
        returned: permissions.length,
        target: permissionTarget(permissions, commandId),
      },
      privacy: {
        definitionsPersisted: false,
        namesPersisted: false,
        permissionTargetsPersisted: false,
        planTextTransient: true,
      },
      risks,
      schemaVersion: SCHEMA_VERSION,
      status,
      verification: {
        commandInventory: "exact-full-localization-readback",
        permissionInventory: "exact-survivor-readback",
        retriesAfterReservation: false,
      },
      warnings,
      writeRequired: effect === "change",
    }
    return {
      plan,
      state: {
        bot,
        guild,
        inventory,
        inventoryDigest: exactInventoryDigest,
        permissions,
        permissionDigest: exactPermissionDigest,
      },
    }
  }

  async plan(
    applicationId: string,
    botId: string,
    request: GuildApplicationCommandChangeRequest,
    options: RequestOptions = {},
  ): Promise<GuildApplicationCommandPlan> {
    return (await this.#buildPlan(
      applicationId,
      botId,
      normalizeGuildApplicationCommandChangeRequest(request),
      options,
    )).plan
  }

  execute(
    applicationId: string,
    botId: string,
    request: GuildApplicationCommandChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GuildApplicationCommandResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord guild application-command plan digest is invalid")
    }
    const normalized = normalizeGuildApplicationCommandChangeRequest(request)
    const target = `${applicationId}:${normalized.guildId}`
    return withTargetLock(
      this.#lockState,
      target,
      () => this.#executeLocked(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new GuildApplicationCommandExecutionError(
        "Discord guild application-command changes are blocked after an uncertain same-guild collection outcome",
        {
          applicationId,
          guildId: normalized.guildId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeLocked(
    applicationId: string,
    botId: string,
    request: NormalizedGuildApplicationCommandChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GuildApplicationCommandResult> {
    let built: BuiltPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof GuildApplicationCommandEvidenceError
        || error instanceof GuildApplicationCommandDefinitionError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GuildApplicationCommandPlanChangedError(
          expectedDigest,
          GUILD_APPLICATION_COMMAND_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new GuildApplicationCommandPlanChangedError(expectedDigest, plan.digest)
    }
    const fallbackCommandId = request.action === "create"
      ? null
      : request.commandId
    const baseResult = {
      action: request.action,
      applicationId,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.effect === "none") {
      return {
        ...baseResult,
        activityId: null,
        commandId: fallbackCommandId as string,
        commandType: plan.commandType,
        observed: request.action === "delete"
          ? null
          : state.inventory.find(({ commandId }) => commandId === fallbackCommandId) ?? null,
        observedInventoryDigest: state.inventoryDigest,
        observedPermissionDigest: state.permissionDigest,
        readbackMatched: true,
        status: request.action === "delete" ? "already-absent" : "already-current",
      }
    }

    const activityId = this.#randomId()
    const reservation = await this.#operationStore.reserve(operationReceipt({
      activityId,
      plan,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new GuildApplicationCommandOperationConflictError(
        receiptView(reservation.receipt),
      )
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
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
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new GuildApplicationCommandExecutionError(
        "Discord guild application-command change was blocked because pending activity could not be recorded",
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

    let commandId = fallbackCommandId
    let mutationAcknowledged = false
    let mutationStarted = false
    let observed: ProjectedGuildApplicationCommand | null = null
    let observedInventoryDigest = state.inventoryDigest
    let observedPermissionDigest = state.permissionDigest
    try {
      let response: ProjectedGuildApplicationCommand | null = null
      mutationStarted = true
      if (request.action === "create") {
        response = projectedCommand(
          await this.#client.createGuildApplicationCommand(
            applicationId,
            request.guildId,
            request.definition,
            options,
          ),
          applicationId,
          request.guildId,
        )
        mutationAcknowledged = true
        commandId = response.commandId
        if (
          state.inventory.some((command) => command.commandId === commandId)
          || !sameGuildApplicationCommandDefinition(
            response.definition,
            request.definition,
          )
        ) {
          throw new GuildApplicationCommandEvidenceError(
            "Discord application-command creation response did not match the reviewed definition",
          )
        }
      } else if (request.action === "update") {
        response = projectedCommand(
          await this.#client.editGuildApplicationCommand(
            applicationId,
            request.guildId,
            request.commandId,
            request.definition,
            options,
          ),
          applicationId,
          request.guildId,
        )
        mutationAcknowledged = true
        if (
          response.commandId !== request.commandId
          || !sameGuildApplicationCommandDefinition(
            response.definition,
            request.definition,
          )
        ) {
          throw new GuildApplicationCommandEvidenceError(
            "Discord application-command update response did not match the reviewed target and definition",
          )
        }
      } else {
        await this.#client.deleteGuildApplicationCommand(
          applicationId,
          request.guildId,
          request.commandId,
          options,
        )
        mutationAcknowledged = true
      }

      const [inventoryValue, permissionValue] = await Promise.all([
        this.#client.listGuildApplicationCommandsWithLocalizations(
          applicationId,
          request.guildId,
          options,
        ),
        this.#client.listGuildApplicationCommandPermissions(
          applicationId,
          request.guildId,
          options,
        ),
      ])
      const inventory = exactInventory(inventoryValue, applicationId, request.guildId)
      const permissions = exactPermissions(
        permissionValue,
        applicationId,
        request.guildId,
        inventory,
      )
      observedInventoryDigest = inventoryDigest(applicationId, request.guildId, inventory)
      observedPermissionDigest = permissionDigest(applicationId, request.guildId, permissions)
      if (!commandId) {
        throw new GuildApplicationCommandEvidenceError(
          "Discord application-command mutation returned no exact command identity",
        )
      }
      if (request.action === "create") {
        observed = inventory.find((command) => command.commandId === commandId) ?? null
        if (
          !response
          || !observed
          || !sameValue(observed, response)
          || inventory.length !== state.inventory.length + 1
        ) {
          throw new GuildApplicationCommandEvidenceError(
            "Discord application-command creation readback did not match the exact response",
          )
        }
        assertCommandCollectionEqual(
          withoutCommand(inventory, commandId),
          state.inventory,
          "Discord application-command creation changed the unrelated command inventory",
        )
      } else if (request.action === "update") {
        observed = inventory.find((command) => command.commandId === commandId) ?? null
        if (
          !response
          || !observed
          || !sameValue(observed, response)
          || inventory.length !== state.inventory.length
        ) {
          throw new GuildApplicationCommandEvidenceError(
            "Discord application-command update readback did not match the exact response",
          )
        }
        assertCommandCollectionEqual(
          withoutCommand(inventory, commandId),
          withoutCommand(state.inventory, commandId),
          "Discord application-command update changed the unrelated command inventory",
        )
      } else {
        observed = inventory.find((command) => command.commandId === commandId) ?? null
        if (observed || inventory.length !== state.inventory.length - 1) {
          throw new GuildApplicationCommandEvidenceError(
            "Discord application-command deletion readback retained the exact target",
          )
        }
        assertCommandCollectionEqual(
          inventory,
          withoutCommand(state.inventory, commandId),
          "Discord application-command deletion changed the survivor inventory",
        )
      }
      const renamed = request.action === "update"
        && plan.existingDefinition?.name !== request.definition.name
      verifyPermissionTransition(
        request.action,
        renamed,
        commandId,
        state.permissions,
        permissions,
      )
    } catch (error) {
      const knownRejected = mutationStarted
        && !mutationAcknowledged
        && error instanceof DiscordApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 408
        && error.status !== 429
      const status = knownRejected ? "failed" : "uncertain"
      const errorCode = safeErrorCode(error)
      let operationRecordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          commandId,
          error: errorCode,
          plan,
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
          commandId,
          error: errorCode,
          plan,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (activityError) {
        activityRecordError = safeErrorCode(activityError)
      }
      throw new GuildApplicationCommandExecutionError(
        knownRejected
          ? "Discord rejected the guild application-command change before applying it"
          : "Discord guild application-command change has an uncertain outcome and must not be retried",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          commandId,
          error: errorCode,
          observedInventoryDigest,
          observedPermissionDigest,
          operationRecordError,
          retryAfterMs: error instanceof DiscordApiError
            ? error.retryAfterMs ?? null
            : null,
          status,
        },
        { cause: error },
      )
    }

    if (!commandId) {
      throw new GuildApplicationCommandExecutionError(
        "Discord guild application-command verification returned no exact command identity",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    const result: GuildApplicationCommandResult = {
      ...baseResult,
      activityId,
      commandId,
      commandType: requiredCommandType(plan),
      observed,
      observedInventoryDigest,
      observedPermissionDigest,
      readbackMatched: true,
      status: "completed",
    }
    let recordError: string | null = null
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        commandId,
        plan,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
      await this.#activityStore.append(activityEntry({
        activityId,
        commandId,
        plan,
        status: "completed",
        timestamp: this.#clock().toISOString(),
        verification: "match",
      }))
    } catch (error) {
      recordError = safeErrorCode(error)
    }
    if (recordError) {
      throw new GuildApplicationCommandExecutionError(
        "Discord guild application-command change completed but durable completion recording failed",
        {
          ...result,
          error: recordError,
          status: "completed-record-failed",
        },
      )
    }
    return result
  }
}
