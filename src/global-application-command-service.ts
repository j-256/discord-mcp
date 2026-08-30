import { createHash, randomUUID } from "node:crypto"

import type {
  ActivityStore,
  GlobalApplicationCommandActivity,
  GlobalApplicationCommandActivityStatus,
} from "./activity-log.js"
import {
  projectApplicationFlagEvidence,
  projectApplicationPosture,
} from "./application-posture.js"
import {
  DISCORD_APPLICATION_FLAGS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  DiscordApiError,
  GlobalApplicationCommandEvidenceError,
  GlobalApplicationCommandExecutionError,
  GlobalApplicationCommandOperationConflictError,
  GlobalApplicationCommandPlanChangedError,
} from "./errors.js"
import {
  globalApplicationCommandDefinitionDigest,
  type GlobalApplicationCommandDefinition,
  GlobalApplicationCommandDefinitionError,
  type GlobalApplicationCommandIntegrationType,
  type GlobalApplicationCommandType,
  normalizeGlobalApplicationCommandDefinition,
  type ProjectedGlobalApplicationCommand,
  projectGlobalApplicationCommand,
  sameGlobalApplicationCommandDefinition,
} from "./global-application-command-definition.js"
import { stableString } from "./normalize.js"
import {
  type ApplicationOperationReceipt,
  type ApplicationOperationStore,
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
  DiscordApplication,
  DiscordApplicationCommand,
  RequestOptions,
} from "./types.js"

export const GLOBAL_APPLICATION_COMMAND_ACTIONS = Object.freeze([
  "create",
  "delete",
  "update",
] as const)

export type GlobalApplicationCommandAction =
  typeof GLOBAL_APPLICATION_COMMAND_ACTIONS[number]

export interface CreateGlobalApplicationCommandRequest {
  acknowledgeGlobalExposure: true
  action: "create"
  definition: GlobalApplicationCommandDefinition
  operationKey: string
}

export interface UpdateGlobalApplicationCommandRequest {
  acknowledgeGlobalExposure: true
  acknowledgePermissionResetAcrossGuilds?: true
  action: "update"
  commandId: string
  definition: GlobalApplicationCommandDefinition
  operationKey: string
}

export interface DeleteGlobalApplicationCommandRequest {
  acknowledgeGlobalDeletion: true
  acknowledgePermissionResetAcrossGuilds: true
  action: "delete"
  commandId: string
  operationKey: string
}

export type GlobalApplicationCommandChangeRequest =
  | CreateGlobalApplicationCommandRequest
  | DeleteGlobalApplicationCommandRequest
  | UpdateGlobalApplicationCommandRequest

interface NormalizedRequestBase {
  action: GlobalApplicationCommandAction
  operationKeyHash: string
}

export type NormalizedGlobalApplicationCommandChangeRequest =
  | (Omit<CreateGlobalApplicationCommandRequest, "operationKey"> & NormalizedRequestBase)
  | (Omit<DeleteGlobalApplicationCommandRequest, "operationKey"> & NormalizedRequestBase)
  | (Omit<UpdateGlobalApplicationCommandRequest, "operationKey"> & NormalizedRequestBase)

export interface GlobalApplicationCommandInventoryEntry {
  commandId: string
  definitionDigest: string
  name: string
  type: GlobalApplicationCommandType
  version: string
}

export interface GlobalApplicationCommandPlan {
  action: GlobalApplicationCommandAction
  application: {
    embedded: boolean | null
    installationTypes: GlobalApplicationCommandIntegrationType[]
    installationTypesComplete: true
  }
  applicationId: string
  botId: string
  commandId: string | null
  commandType: GlobalApplicationCommandType | null
  createdAt: string
  desiredDefinition: GlobalApplicationCommandDefinition | null
  desiredDefinitionDigest: string | null
  digest: string
  effect: "change" | "none"
  existingDefinition: GlobalApplicationCommandDefinition | null
  existingDefinitionDigest: string | null
  inventory: {
    counts: Record<GlobalApplicationCommandType, number>
    digest: string
    entries: GlobalApplicationCommandInventoryEntry[]
    limits: Record<GlobalApplicationCommandType, number>
    returned: number
    totalLimit: number
  }
  operationKeyHash: string
  permissionEffect: "all-guild-overwrites-cleared-by-discord" | "none"
  privacy: {
    definitionsPersisted: false
    namesPersisted: false
    permissionTargetsEnumerated: false
    planTextTransient: true
  }
  risks: string[]
  schemaVersion: number
  status: "already-absent" | "already-current" | "planned"
  verification: {
    commandInventory: "exact-full-localization-api-readback"
    clientPropagation: "discord-read-repair"
    retriesAfterReservation: false
  }
  warnings: string[]
  writeRequired: boolean
}

export interface GlobalApplicationCommandResult {
  action: GlobalApplicationCommandAction
  activityId: string | null
  applicationId: string
  commandId: string
  commandType: GlobalApplicationCommandType | null
  observed: ProjectedGlobalApplicationCommand | null
  observedInventoryDigest: string
  operationKeyHash: string
  planDigest: string
  readbackMatched: true
  schemaVersion: number
  status: "already-absent" | "already-current" | "completed"
}

export interface GlobalApplicationCommandServiceClient extends Pick<
  DiscordClient,
  | "createGlobalApplicationCommand"
  | "deleteGlobalApplicationCommand"
  | "editGlobalApplicationCommand"
  | "listGlobalApplicationCommandsWithLocalizations"
> {}

export interface GlobalApplicationCommandServiceOptions {
  activityStore: ActivityStore
  client: GlobalApplicationCommandServiceClient
  clock?: () => Date
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: Pick<ScopePolicy, "assertGlobalApplicationCommandChangeAllowed">
  randomId?: () => string
}

interface ExactApplicationEvidence {
  embedded: boolean | null
  id: string
  installationTypes: GlobalApplicationCommandIntegrationType[]
}

interface ExactState {
  application: ExactApplicationEvidence
  inventory: ProjectedGlobalApplicationCommand[]
  inventoryDigest: string
}

interface BuiltPlan {
  plan: GlobalApplicationCommandPlan
  state: ExactState
}

type ApplicationTargetOutcome = "settled" | "uncertain"

const GLOBAL_APPLICATION_COMMAND_STATE_UNAVAILABLE =
  "global-application-command-state-unavailable"
const GLOBAL_APPLICATION_COMMAND_LOCKS = new Map<
  string,
  Promise<ApplicationTargetOutcome>
>()
const GLOBAL_APPLICATION_COMMAND_UNCERTAIN_APPLICATIONS = new Set<string>()
const APPLICATION_COMMAND_LIMITS: Readonly<Record<GlobalApplicationCommandType, number>> =
  Object.freeze({
    "chat-input": DISCORD_LIMITS.applicationCommandGlobalChatInputCommands,
    message: DISCORD_LIMITS.applicationCommandGlobalMessageCommands,
    "primary-entry-point": DISCORD_LIMITS.applicationCommandGlobalPrimaryEntryPointCommands,
    user: DISCORD_LIMITS.applicationCommandGlobalUserCommands,
  })
const CREATE_REQUEST_KEYS = [
  "acknowledgeGlobalExposure",
  "action",
  "definition",
  "operationKey",
] as const
const UPDATE_REQUEST_KEYS = [
  "acknowledgeGlobalExposure",
  "acknowledgePermissionResetAcrossGuilds",
  "action",
  "commandId",
  "definition",
  "operationKey",
] as const
const UPDATE_REQUIRED_KEYS = [
  "acknowledgeGlobalExposure",
  "action",
  "commandId",
  "definition",
  "operationKey",
] as const
const DELETE_REQUEST_KEYS = [
  "acknowledgeGlobalDeletion",
  "acknowledgePermissionResetAcrossGuilds",
  "action",
  "commandId",
  "operationKey",
] as const

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed,
): boolean {
  const actual = Object.keys(value)
  const known = new Set(allowed)
  return actual.every((key) => known.has(key))
    && required.every((key) => Object.hasOwn(value, key))
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

export function normalizeGlobalApplicationCommandChangeRequest(
  request: GlobalApplicationCommandChangeRequest,
): NormalizedGlobalApplicationCommandChangeRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord global application-command request must be an exact object")
  }
  const record = request as unknown as Record<string, unknown>
  if (record.action === "create") {
    if (
      !exactKeys(record, CREATE_REQUEST_KEYS)
      || record.acknowledgeGlobalExposure !== true
    ) {
      throw new RangeError(
        "Discord global application-command creation requires acknowledgeGlobalExposure=true",
      )
    }
    return {
      acknowledgeGlobalExposure: true,
      action: "create",
      definition: normalizeGlobalApplicationCommandDefinition(record.definition),
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  if (record.action === "update") {
    if (
      !exactKeys(record, UPDATE_REQUEST_KEYS, UPDATE_REQUIRED_KEYS)
      || record.acknowledgeGlobalExposure !== true
      || (
        record.acknowledgePermissionResetAcrossGuilds !== undefined
        && record.acknowledgePermissionResetAcrossGuilds !== true
      )
    ) {
      throw new RangeError(
        "Discord global application-command update requires exact global exposure acknowledgement",
      )
    }
    assertSnowflake(record.commandId, "Discord global application-command ID")
    return {
      acknowledgeGlobalExposure: true,
      ...(record.acknowledgePermissionResetAcrossGuilds === true
        ? { acknowledgePermissionResetAcrossGuilds: true as const }
        : {}),
      action: "update",
      commandId: record.commandId,
      definition: normalizeGlobalApplicationCommandDefinition(record.definition),
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  if (record.action === "delete") {
    if (
      !exactKeys(record, DELETE_REQUEST_KEYS)
      || record.acknowledgeGlobalDeletion !== true
      || record.acknowledgePermissionResetAcrossGuilds !== true
    ) {
      throw new RangeError(
        "Discord global application-command deletion requires global deletion and cross-guild permission-reset acknowledgements",
      )
    }
    assertSnowflake(record.commandId, "Discord global application-command ID")
    return {
      acknowledgeGlobalDeletion: true,
      acknowledgePermissionResetAcrossGuilds: true,
      action: "delete",
      commandId: record.commandId,
      operationKeyHash: operationKeyHash(record.operationKey as string),
    }
  }
  throw new RangeError(
    "Discord global application-command action must be create, update, or delete",
  )
}

function evidenceDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(stableString(value))
    .digest("hex")}`
}

function exactApplication(
  value: DiscordApplication,
  expectedApplicationId: string,
  expectedBotId: string,
): ExactApplicationEvidence {
  assertSnowflake(expectedApplicationId, "Discord application ID")
  assertSnowflake(expectedBotId, "Discord bot ID")
  let posture
  try {
    posture = projectApplicationPosture(value, expectedBotId, {
      guildMembersIntentRequired: false,
      messageContentIntent: "not-required",
      nativeInteractionIngressRequired: false,
    })
  } catch (error) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord returned incomplete global application-command capability evidence",
      { cause: error },
    )
  }
  if (
    posture.applicationId !== expectedApplicationId
    || posture.botId !== expectedBotId
    || value.bot?.id !== undefined && value.bot.id !== expectedBotId
    || !posture.installation.contextsReported
    || posture.installation.unknownContextCount !== 0
  ) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord returned mismatched or incomplete global application-command identity evidence",
    )
  }
  const installationTypes: GlobalApplicationCommandIntegrationType[] = []
  if (posture.installation.guild.supported === true) {
    installationTypes.push("guild-install")
  }
  if (posture.installation.user.supported === true) {
    installationTypes.push("user-install")
  }
  if (installationTypes.length === 0) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord application reports no supported installation type for global commands",
    )
  }
  const flags = projectApplicationFlagEvidence(value)?.value ?? null
  return {
    embedded: flags === null
      ? null
      : (flags & DISCORD_APPLICATION_FLAGS.embedded) !== 0n,
    id: expectedApplicationId,
    installationTypes,
  }
}

function projectedCommand(
  command: DiscordApplicationCommand,
  application: ExactApplicationEvidence,
): ProjectedGlobalApplicationCommand {
  try {
    return projectGlobalApplicationCommand(
      command,
      application.id,
      application.installationTypes,
    )
  } catch (error) {
    if (error instanceof GlobalApplicationCommandDefinitionError) {
      throw new GlobalApplicationCommandEvidenceError(
        "Discord returned incomplete or unsupported global application-command evidence",
        { cause: error },
      )
    }
    throw error
  }
}

function commandCounts(
  inventory: readonly ProjectedGlobalApplicationCommand[],
): Record<GlobalApplicationCommandType, number> {
  const counts: Record<GlobalApplicationCommandType, number> = {
    "chat-input": 0,
    message: 0,
    "primary-entry-point": 0,
    user: 0,
  }
  for (const command of inventory) counts[command.definition.type] += 1
  return counts
}

function supportedDefinition(
  definition: GlobalApplicationCommandDefinition,
  application: ExactApplicationEvidence,
): boolean {
  return definition.integrationTypes.every((type) => (
    application.installationTypes.includes(type)
  ))
}

function exactInventory(
  value: DiscordApplicationCommand[],
  application: ExactApplicationEvidence,
): ProjectedGlobalApplicationCommand[] {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.applicationCommandGlobalCommands
  ) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord returned an invalid global application-command inventory",
    )
  }
  const inventory = value.map((command) => (
    projectedCommand(command, application)
  )).sort((left, right) => compareSnowflakes(left.commandId, right.commandId))
  if (new Set(inventory.map(({ commandId }) => commandId)).size !== inventory.length) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord returned duplicate global application-command IDs",
    )
  }
  if (inventory.some(({ commandId }) => commandId === application.id)) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord returned a global command ID that conflicts with application defaults",
    )
  }
  const nameTypes = inventory.map(({ definition }) => (
    `${definition.type}\0${definition.name}`
  ))
  if (new Set(nameTypes).size !== nameTypes.length) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord returned duplicate global application-command name and type pairs",
    )
  }
  if (inventory.some(({ definition }) => !supportedDefinition(definition, application))) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord returned a global command outside the application's supported installation types",
    )
  }
  const counts = commandCounts(inventory)
  for (const type of Object.keys(APPLICATION_COMMAND_LIMITS) as GlobalApplicationCommandType[]) {
    if (counts[type] > APPLICATION_COMMAND_LIMITS[type]) {
      throw new GlobalApplicationCommandEvidenceError(
        `Discord returned more ${type} global commands than the documented capacity`,
      )
    }
  }
  return inventory
}

function inventoryDigest(
  applicationId: string,
  inventory: readonly ProjectedGlobalApplicationCommand[],
): string {
  return evidenceDigest("guildcontrol:global-application-command-inventory:v1", {
    applicationId,
    inventory,
  })
}

function inventoryEntries(
  inventory: readonly ProjectedGlobalApplicationCommand[],
): GlobalApplicationCommandInventoryEntry[] {
  return inventory.map((command) => ({
    commandId: command.commandId,
    definitionDigest: globalApplicationCommandDefinitionDigest(command.definition),
    name: command.definition.name,
    type: command.definition.type,
    version: command.version,
  }))
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableString(left) === stableString(right)
}

function targetId(
  request: NormalizedGlobalApplicationCommandChangeRequest,
): string | null {
  return request.action === "create" ? null : request.commandId
}

function desiredDefinition(
  request: NormalizedGlobalApplicationCommandChangeRequest,
): GlobalApplicationCommandDefinition | null {
  return request.action === "delete" ? null : request.definition
}

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  return name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128) || "UnknownError"
}

function requiredCommandType(
  plan: GlobalApplicationCommandPlan,
): GlobalApplicationCommandType {
  if (plan.commandType === null) {
    throw new GlobalApplicationCommandEvidenceError(
      "Discord global application-command mutation lost its exact command type",
    )
  }
  return plan.commandType
}

function applicationOperationStore(store: OperationStore): ApplicationOperationStore {
  if (!store.finishApplication || !store.getApplication || !store.reserveApplication) {
    throw new GlobalApplicationCommandExecutionError(
      "Discord global application-command changes require an application-scoped operation store",
      { status: "blocked-operation-store-incompatible" },
    )
  }
  return store as ApplicationOperationStore
}

function activityEntry(options: {
  activityId: string
  commandId?: string | null
  error?: string | null
  plan: GlobalApplicationCommandPlan
  status: GlobalApplicationCommandActivityStatus
  timestamp: string
  verification?: "match" | null
}): GlobalApplicationCommandActivity {
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
    id: options.activityId,
    inventoryDigest: options.plan.inventory.digest,
    kind: "global-application-command-change",
    operationKeyHash: options.plan.operationKeyHash,
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
  plan: GlobalApplicationCommandPlan
  status: ApplicationOperationReceipt["status"]
  timestamp: string
  verification?: "match" | null
}): ApplicationOperationReceipt {
  const commandId = options.commandId === undefined
    ? options.plan.commandId
    : options.commandId
  return {
    activityId: options.activityId,
    applicationId: options.plan.applicationId,
    error: options.error ?? null,
    kind: "global-application-command-change",
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

function receiptView(receipt: ApplicationOperationReceipt) {
  return {
    activityId: receipt.activityId,
    applicationId: receipt.applicationId,
    error: receipt.error,
    operationKeyHash: receipt.operationKeyHash,
    resourceId: receipt.resourceId,
    status: receipt.status,
    timestamp: receipt.timestamp,
    verification: receipt.verification,
  }
}

function executionBlocksApplication(error: unknown): boolean {
  if (
    !(error instanceof GlobalApplicationCommandExecutionError)
    || !error.result
    || typeof error.result !== "object"
    || !("status" in error.result)
  ) return false
  return ["completed-record-failed", "uncertain"].includes(String(error.result.status))
}

async function withApplicationLock<T>(
  applicationId: string,
  operation: () => Promise<T>,
  priorUncertainError: () => GlobalApplicationCommandExecutionError,
): Promise<T> {
  const prior = GLOBAL_APPLICATION_COMMAND_LOCKS.get(applicationId)
    ?? Promise.resolve("settled" as const)
  let release: (outcome: ApplicationTargetOutcome) => void = () => undefined
  const tail = new Promise<ApplicationTargetOutcome>((resolve) => {
    release = resolve
  })
  GLOBAL_APPLICATION_COMMAND_LOCKS.set(applicationId, tail)
  let outcome: ApplicationTargetOutcome = "settled"
  try {
    await prior
    if (GLOBAL_APPLICATION_COMMAND_UNCERTAIN_APPLICATIONS.has(applicationId)) {
      outcome = "uncertain"
      throw priorUncertainError()
    }
    return await operation()
  } catch (error) {
    if (executionBlocksApplication(error)) {
      outcome = "uncertain"
      GLOBAL_APPLICATION_COMMAND_UNCERTAIN_APPLICATIONS.add(applicationId)
    }
    throw error
  } finally {
    release(outcome)
    if (GLOBAL_APPLICATION_COMMAND_LOCKS.get(applicationId) === tail) {
      GLOBAL_APPLICATION_COMMAND_LOCKS.delete(applicationId)
    }
  }
}

function assertCommandCollectionEqual(
  actual: readonly ProjectedGlobalApplicationCommand[],
  expected: readonly ProjectedGlobalApplicationCommand[],
  message: string,
): void {
  if (!sameValue(actual, expected)) {
    throw new GlobalApplicationCommandEvidenceError(message)
  }
}

function withoutCommand<T extends { commandId: string }>(
  values: readonly T[],
  commandId: string,
): T[] {
  return values.filter((entry) => entry.commandId !== commandId)
}

export class GlobalApplicationCommandService {
  readonly #activityStore: ActivityStore
  readonly #client: GlobalApplicationCommandServiceClient
  readonly #clock: () => Date
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: Pick<ScopePolicy, "assertGlobalApplicationCommandChangeAllowed">
  readonly #randomId: () => string

  constructor(options: GlobalApplicationCommandServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock ?? (() => new Date())
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey ?? createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId ?? randomUUID
  }

  async #buildPlan(
    applicationValue: DiscordApplication,
    botId: string,
    request: NormalizedGlobalApplicationCommandChangeRequest,
    options: RequestOptions,
  ): Promise<BuiltPlan> {
    this.#policy.assertGlobalApplicationCommandChangeAllowed()
    const applicationId = applicationValue.id
    const application = exactApplication(applicationValue, applicationId, botId)
    const inventory = exactInventory(
      await this.#client.listGlobalApplicationCommandsWithLocalizations(
        applicationId,
        options,
      ),
      application,
    )
    const commandId = targetId(request)
    const existing = commandId === null
      ? null
      : inventory.find((command) => command.commandId === commandId) ?? null
    const desired = desiredDefinition(request)

    if (desired && !supportedDefinition(desired, application)) {
      throw new GlobalApplicationCommandEvidenceError(
        "Discord global application-command definition requests an unsupported installation type",
      )
    }
    if (desired?.type === "primary-entry-point" && application.embedded !== true) {
      throw new GlobalApplicationCommandEvidenceError(
        "Discord Primary Entry Point commands require fresh EMBEDDED application evidence",
      )
    }
    if (request.action === "create") {
      if (inventory.some(({ definition }) => (
        definition.type === request.definition.type
        && definition.name === request.definition.name
      ))) {
        throw new GlobalApplicationCommandEvidenceError(
          "Discord global application-command creation collides with an exact name and type pair",
        )
      }
      const counts = commandCounts(inventory)
      if (
        inventory.length >= DISCORD_LIMITS.applicationCommandGlobalCommands
        || counts[request.definition.type] >= APPLICATION_COMMAND_LIMITS[request.definition.type]
      ) {
        throw new GlobalApplicationCommandEvidenceError(
          `Discord global ${request.definition.type} application-command capacity is exhausted`,
        )
      }
    }
    if (request.action === "update") {
      if (!existing) {
        throw new GlobalApplicationCommandEvidenceError(
          "Discord global application-command update target is absent",
        )
      }
      if (existing.definition.type !== request.definition.type) {
        throw new GlobalApplicationCommandEvidenceError(
          "Discord global application-command updates cannot change command type",
        )
      }
      if (inventory.some((command) => (
        command.commandId !== request.commandId
        && command.definition.type === request.definition.type
        && command.definition.name === request.definition.name
      ))) {
        throw new GlobalApplicationCommandEvidenceError(
          "Discord global application-command update collides with an exact name and type pair",
        )
      }
      if (
        existing.definition.name !== request.definition.name
        && request.acknowledgePermissionResetAcrossGuilds !== true
      ) {
        throw new RangeError(
          "Discord global application-command rename requires acknowledgePermissionResetAcrossGuilds=true",
        )
      }
    }

    const effect = request.action === "delete"
      ? existing === null ? "none" : "change"
      : request.action === "update" && existing
        && sameGlobalApplicationCommandDefinition(existing.definition, request.definition)
        ? "none"
        : "change"
    const renamed = request.action === "update"
      && existing !== null
      && existing.definition.name !== request.definition.name
    const permissionEffect = existing !== null
      && (request.action === "delete" || renamed)
      ? "all-guild-overwrites-cleared-by-discord"
      : "none"
    const exactInventoryDigest = inventoryDigest(applicationId, inventory)
    const risks = [
      "The full localized global command inventory is freshness-bound, so concurrent changes invalidate execution",
      "Each write is one-shot after operation-key reservation and is never automatically retried",
      "Global command client propagation uses Discord read-repair after the authoritative API state changes",
      "The connector cannot enumerate command-specific permissions across every installation with a bot token",
      "Discord does not document audit-log reason support for application-command writes",
      ...(request.action === "delete" && existing
        ? ["Deletion is irreversible and permanently clears this command's permissions in every guild"]
        : []),
      ...(renamed
        ? ["Renaming permanently clears this command's permissions in every guild"]
        : []),
      ...(request.action === "update"
        ? ["Update submits one complete definition, so every reviewed field replaces its prior value"]
        : []),
    ]
    const warnings = [
      "Command names, descriptions, localizations, choices, and option text are transient untrusted evidence and are never persisted",
      "Command-specific permission mutation remains unsupported because Discord requires a user Bearer token",
      "Every requested installation type and interaction context is explicit rather than inherited from mutable application defaults",
      ...(request.action === "create"
        ? ["Creation fails closed on Discord's 200 upsert response instead of overwriting a same-name command"]
        : []),
      ...(desired?.type === "primary-entry-point"
        ? ["Primary Entry Point handling is allowed only with fresh EMBEDDED application evidence"]
        : []),
    ]
    const existingDefinition = existing?.definition ?? null
    const existingDefinitionDigest = existingDefinition
      ? globalApplicationCommandDefinitionDigest(existingDefinition)
      : null
    const desiredDefinitionDigest = desired
      ? globalApplicationCommandDefinitionDigest(desired)
      : null
    const digest = reviewedPlanDigest(this.#planKey, {
      action: request.action,
      application,
      applicationId,
      botId,
      commandId,
      desired,
      desiredDefinitionDigest,
      effect,
      existing: existingDefinition,
      existingDefinitionDigest,
      inventoryDigest: exactInventoryDigest,
      operationKeyHash: request.operationKeyHash,
      permissionEffect,
      risks,
      warnings,
    })
    const status = effect === "change"
      ? "planned"
      : request.action === "delete"
        ? "already-absent"
        : "already-current"
    const plan: GlobalApplicationCommandPlan = {
      action: request.action,
      application: {
        embedded: application.embedded,
        installationTypes: [...application.installationTypes],
        installationTypesComplete: true,
      },
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
      inventory: {
        counts: commandCounts(inventory),
        digest: exactInventoryDigest,
        entries: inventoryEntries(inventory),
        limits: { ...APPLICATION_COMMAND_LIMITS },
        returned: inventory.length,
        totalLimit: DISCORD_LIMITS.applicationCommandGlobalCommands,
      },
      operationKeyHash: request.operationKeyHash,
      permissionEffect,
      privacy: {
        definitionsPersisted: false,
        namesPersisted: false,
        permissionTargetsEnumerated: false,
        planTextTransient: true,
      },
      risks,
      schemaVersion: SCHEMA_VERSION,
      status,
      verification: {
        commandInventory: "exact-full-localization-api-readback",
        clientPropagation: "discord-read-repair",
        retriesAfterReservation: false,
      },
      warnings,
      writeRequired: effect === "change",
    }
    return {
      plan,
      state: {
        application,
        inventory,
        inventoryDigest: exactInventoryDigest,
      },
    }
  }

  async plan(
    application: DiscordApplication,
    botId: string,
    request: GlobalApplicationCommandChangeRequest,
    options: RequestOptions = {},
  ): Promise<GlobalApplicationCommandPlan> {
    return (await this.#buildPlan(
      application,
      botId,
      normalizeGlobalApplicationCommandChangeRequest(request),
      options,
    )).plan
  }

  execute(
    application: DiscordApplication,
    botId: string,
    request: GlobalApplicationCommandChangeRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<GlobalApplicationCommandResult> {
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord global application-command plan digest is invalid")
    }
    const normalized = normalizeGlobalApplicationCommandChangeRequest(request)
    const applicationId = application.id
    return withApplicationLock(
      applicationId,
      () => this.#executeLocked(
        application,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new GlobalApplicationCommandExecutionError(
        "Discord global application-command changes are blocked after an uncertain application-wide collection outcome",
        {
          applicationId,
          operationKeyHash: normalized.operationKeyHash,
          planDigest: expectedDigest,
          status: "blocked-prior-uncertain",
        },
      ),
    )
  }

  async #executeLocked(
    application: DiscordApplication,
    botId: string,
    request: NormalizedGlobalApplicationCommandChangeRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<GlobalApplicationCommandResult> {
    let built: BuiltPlan
    try {
      built = await this.#buildPlan(application, botId, request, options)
    } catch (error) {
      if (
        error instanceof GlobalApplicationCommandEvidenceError
        || error instanceof GlobalApplicationCommandDefinitionError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new GlobalApplicationCommandPlanChangedError(
          expectedDigest,
          GLOBAL_APPLICATION_COMMAND_STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new GlobalApplicationCommandPlanChangedError(expectedDigest, plan.digest)
    }
    const fallbackCommandId = request.action === "create"
      ? null
      : request.commandId
    const baseResult = {
      action: request.action,
      applicationId: plan.applicationId,
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
        readbackMatched: true,
        status: request.action === "delete" ? "already-absent" : "already-current",
      }
    }

    const operationStore = applicationOperationStore(this.#operationStore)
    const activityId = this.#randomId()
    const reservation = await operationStore.reserveApplication(operationReceipt({
      activityId,
      plan,
      status: "pending",
      timestamp: this.#clock().toISOString(),
    }))
    if (!reservation.created) {
      throw new GlobalApplicationCommandOperationConflictError(
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
        await operationStore.finishApplication(operationReceipt({
          activityId,
          error: safeErrorCode(error),
          plan,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch (receiptError) {
        operationRecordError = safeErrorCode(receiptError)
      }
      throw new GlobalApplicationCommandExecutionError(
        "Discord global application-command change was blocked because pending activity could not be recorded",
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
    let observed: ProjectedGlobalApplicationCommand | null = null
    let observedInventoryDigest = state.inventoryDigest
    try {
      let response: ProjectedGlobalApplicationCommand | null = null
      mutationStarted = true
      if (request.action === "create") {
        response = projectedCommand(
          await this.#client.createGlobalApplicationCommand(
            plan.applicationId,
            request.definition,
            options,
          ),
          state.application,
        )
        mutationAcknowledged = true
        commandId = response.commandId
        if (
          state.inventory.some((command) => command.commandId === commandId)
          || !sameGlobalApplicationCommandDefinition(
            response.definition,
            request.definition,
          )
        ) {
          throw new GlobalApplicationCommandEvidenceError(
            "Discord global application-command creation response did not match the reviewed definition",
          )
        }
      } else if (request.action === "update") {
        response = projectedCommand(
          await this.#client.editGlobalApplicationCommand(
            plan.applicationId,
            request.commandId,
            request.definition,
            options,
          ),
          state.application,
        )
        mutationAcknowledged = true
        if (
          response.commandId !== request.commandId
          || !sameGlobalApplicationCommandDefinition(
            response.definition,
            request.definition,
          )
        ) {
          throw new GlobalApplicationCommandEvidenceError(
            "Discord global application-command update response did not match the reviewed target and definition",
          )
        }
      } else {
        await this.#client.deleteGlobalApplicationCommand(
          plan.applicationId,
          request.commandId,
          options,
        )
        mutationAcknowledged = true
      }

      const inventory = exactInventory(
        await this.#client.listGlobalApplicationCommandsWithLocalizations(
          plan.applicationId,
          options,
        ),
        state.application,
      )
      observedInventoryDigest = inventoryDigest(plan.applicationId, inventory)
      if (!commandId) {
        throw new GlobalApplicationCommandEvidenceError(
          "Discord global application-command mutation returned no exact command identity",
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
          throw new GlobalApplicationCommandEvidenceError(
            "Discord global application-command creation readback did not match the exact response",
          )
        }
        assertCommandCollectionEqual(
          withoutCommand(inventory, commandId),
          state.inventory,
          "Discord global application-command creation changed the unrelated inventory",
        )
      } else if (request.action === "update") {
        observed = inventory.find((command) => command.commandId === commandId) ?? null
        if (
          !response
          || !observed
          || !sameValue(observed, response)
          || inventory.length !== state.inventory.length
        ) {
          throw new GlobalApplicationCommandEvidenceError(
            "Discord global application-command update readback did not match the exact response",
          )
        }
        assertCommandCollectionEqual(
          withoutCommand(inventory, commandId),
          withoutCommand(state.inventory, commandId),
          "Discord global application-command update changed the unrelated inventory",
        )
      } else {
        observed = inventory.find((command) => command.commandId === commandId) ?? null
        if (observed || inventory.length !== state.inventory.length - 1) {
          throw new GlobalApplicationCommandEvidenceError(
            "Discord global application-command deletion readback retained the exact target",
          )
        }
        assertCommandCollectionEqual(
          inventory,
          withoutCommand(state.inventory, commandId),
          "Discord global application-command deletion changed the survivor inventory",
        )
      }
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
        await operationStore.finishApplication(operationReceipt({
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
      throw new GlobalApplicationCommandExecutionError(
        knownRejected
          ? "Discord rejected the global application-command change before applying it"
          : "Discord global application-command change has an uncertain outcome and must not be retried",
        {
          ...baseResult,
          activityId,
          activityRecordError,
          commandId,
          error: errorCode,
          observedInventoryDigest,
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
      throw new GlobalApplicationCommandExecutionError(
        "Discord global application-command verification returned no exact command identity",
        { ...baseResult, activityId, status: "uncertain" },
      )
    }
    const result: GlobalApplicationCommandResult = {
      ...baseResult,
      activityId,
      commandId,
      commandType: requiredCommandType(plan),
      observed,
      observedInventoryDigest,
      readbackMatched: true,
      status: "completed",
    }
    let recordError: string | null = null
    try {
      await operationStore.finishApplication(operationReceipt({
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
      throw new GlobalApplicationCommandExecutionError(
        "Discord global application-command change completed but durable completion recording failed",
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
