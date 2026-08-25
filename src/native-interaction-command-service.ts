import { randomUUID } from "node:crypto"

import type {
  ActivityStore,
  NativeInteractionCommandActivity,
  NativeInteractionCommandActivityStatus,
} from "./activity-log.js"
import {
  DISCORD_SNOWFLAKE_PATTERN,
  NATIVE_INTERACTION_DEFAULTS,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  CreateGuildApplicationCommandInput,
  DiscordClient,
} from "./discord-client.js"
import {
  DiscordApiError,
  NativeInteractionCommandConflictError,
  NativeInteractionCommandExecutionError,
  NativeInteractionCommandPlanChangedError,
} from "./errors.js"
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
  DiscordApplicationCommandOption,
  DiscordGuild,
  RequestOptions,
} from "./types.js"

export const NATIVE_INTERACTION_COMMAND_ACTIONS = [
  "install",
  "remove",
] as const

export type NativeInteractionCommandAction =
  typeof NATIVE_INTERACTION_COMMAND_ACTIONS[number]

export interface NativeInteractionCommandRequest {
  action: NativeInteractionCommandAction
  guildId: string
  operationKey: string
}

export interface NativeInteractionCommandContract {
  defaultMemberPermissions: "0"
  description: string
  guildOnly: true
  name: string
  nsfw: false
  option: {
    description: string
    maximumLength: number
    minimumLength: 1
    name: "request"
    required: true
    type: "string"
  }
  type: "chat-input"
}

export interface NativeInteractionCommandPlan {
  action: NativeInteractionCommandAction
  applicationId: string
  botId: string
  command: {
    contract: NativeInteractionCommandContract
    id: string | null
    version: string | null
  }
  createdAt: string
  digest: string
  guild: {
    id: string
    name: string
  }
  inventory: {
    chatInputCount: number
    chatInputLimit: number
    totalCount: number
  }
  mutation: "create" | "delete" | "none"
  operationKeyHash: string
  schemaVersion: number
  status: "already-absent" | "already-installed" | "planned"
  warnings: string[]
}

export interface NativeInteractionCommandResult {
  action: NativeInteractionCommandAction
  activityId: string | null
  commandId: string | null
  guildId: string
  operationKeyHash: string
  planDigest: string
  readbackMatched: boolean
  schemaVersion: number
  status: "already-absent" | "already-installed" | "completed"
}

export interface NativeInteractionCommandServiceClient extends Pick<
  DiscordClient,
  | "createGuildApplicationCommand"
  | "deleteGuildApplicationCommand"
  | "getGuild"
  | "listGuildApplicationCommands"
> {}

export interface NativeInteractionCommandServiceOptions {
  activityStore: ActivityStore
  client: NativeInteractionCommandServiceClient
  clock?: () => Date
  commandName: string
  operationStore: OperationStore
  planKey?: Uint8Array
  policy: ScopePolicy
  randomId?: () => string
}

interface NormalizedRequest {
  action: NativeInteractionCommandAction
  guildId: string
  operationKeyHash: string
}

interface StateEvidence {
  command: DiscordApplicationCommand | null
  guild: DiscordGuild
  inventory: DiscordApplicationCommand[]
}

interface BuiltPlan {
  plan: NativeInteractionCommandPlan
  state: StateEvidence
}

const CHAT_INPUT_COMMAND_TYPE = 1
const STRING_OPTION_TYPE = 3
const CHAT_INPUT_COMMAND_LIMIT = 100
const MAXIMUM_GUILD_COMMANDS = 250
const COMMAND_DESCRIPTION = "Send a private request to the configured MCP workflow"
const REQUEST_OPTION_DESCRIPTION = "The private request to process"
const REQUEST_OPTION_NAME = "request"
const STATE_UNAVAILABLE = "native-interaction-command-state-unavailable"
type TargetOutcome = "settled" | "uncertain"

interface TargetLockState {
  tails: Map<string, Promise<TargetOutcome>>
  uncertainTargets: Set<string>
}

class NativeInteractionCommandStateError extends Error {
  override name = "NativeInteractionCommandStateError"
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}

function normalizeRequest(request: NativeInteractionCommandRequest): NormalizedRequest {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new RangeError("Discord native Interaction command request must be an object")
  }
  if (
    Object.keys(request).length !== 3
    || !("action" in request)
    || !("guildId" in request)
    || !("operationKey" in request)
  ) {
    throw new RangeError("Discord native Interaction command request fields are invalid")
  }
  if (!NATIVE_INTERACTION_COMMAND_ACTIONS.includes(request.action)) {
    throw new RangeError("Discord native Interaction command action is invalid")
  }
  assertSnowflake(request.guildId, "Discord native Interaction command guild ID")
  return {
    action: request.action,
    guildId: request.guildId,
    operationKeyHash: operationKeyHash(request.operationKey),
  }
}

export function nativeInteractionCommandContract(
  commandName: string,
): NativeInteractionCommandContract {
  return {
    defaultMemberPermissions: "0",
    description: COMMAND_DESCRIPTION,
    guildOnly: true,
    name: commandName,
    nsfw: false,
    option: {
      description: REQUEST_OPTION_DESCRIPTION,
      maximumLength: NATIVE_INTERACTION_DEFAULTS.requestCharacters,
      minimumLength: 1,
      name: REQUEST_OPTION_NAME,
      required: true,
      type: "string",
    },
    type: "chat-input",
  }
}

function commandInput(contract: NativeInteractionCommandContract): CreateGuildApplicationCommandInput {
  return {
    defaultMemberPermissions: [],
    description: contract.description,
    descriptionLocalizations: [],
    name: contract.name,
    nameLocalizations: [],
    nsfw: contract.nsfw,
    options: [{
      autocomplete: false,
      choices: [],
      description: contract.option.description,
      descriptionLocalizations: [],
      maxLength: contract.option.maximumLength,
      minLength: contract.option.minimumLength,
      name: contract.option.name,
      nameLocalizations: [],
      required: contract.option.required,
      type: contract.option.type,
    }],
    type: contract.type,
  }
}

function exactGuild(guild: DiscordGuild, guildId: string): DiscordGuild {
  if (
    !guild
    || typeof guild !== "object"
    || guild.id !== guildId
    || typeof guild.name !== "string"
    || guild.name.length < 1
  ) {
    throw new NativeInteractionCommandStateError(
      "Discord returned incomplete or mismatched native Interaction guild evidence",
    )
  }
  return guild
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function exactIntegerList(value: unknown, expected: readonly number[]): boolean {
  if (value === undefined || value === null) return true
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index])
}

function exactOption(
  option: DiscordApplicationCommandOption,
  contract: NativeInteractionCommandContract,
): boolean {
  const record = recordValue(option)
  if (!record) return false
  const allowedKeys = new Set([
    "autocomplete",
    "description",
    "description_localizations",
    "max_length",
    "min_length",
    "name",
    "name_localizations",
    "required",
    "type",
  ])
  return Object.keys(record).every((key) => allowedKeys.has(key))
    && record.type === STRING_OPTION_TYPE
    && record.name === contract.option.name
    && (record.name_localizations === undefined || record.name_localizations === null)
    && record.description === contract.option.description
    && (
      record.description_localizations === undefined
      || record.description_localizations === null
    )
    && record.required === true
    && (record.autocomplete === undefined || record.autocomplete === false)
    && record.min_length === contract.option.minimumLength
    && record.max_length === contract.option.maximumLength
}

export function exactNativeInteractionCommand(
  value: unknown,
  applicationId: string,
  guildId: string,
  contract: NativeInteractionCommandContract,
): DiscordApplicationCommand | undefined {
  const command = recordValue(value)
  if (!command) return undefined
  const options = command.options
  if (
    !DISCORD_SNOWFLAKE_PATTERN.test(String(command.id))
    || !DISCORD_SNOWFLAKE_PATTERN.test(String(command.version))
    || command.application_id !== applicationId
    || command.guild_id !== guildId
    || command.type !== CHAT_INPUT_COMMAND_TYPE
    || command.name !== contract.name
    || (command.name_localizations !== undefined && command.name_localizations !== null)
    || command.description !== contract.description
    || (
      command.description_localizations !== undefined
      && command.description_localizations !== null
    )
    || command.default_member_permissions !== contract.defaultMemberPermissions
    || (command.nsfw !== undefined && command.nsfw !== false)
    || (command.dm_permission !== undefined && command.dm_permission !== false)
    || !exactIntegerList(command.integration_types, [0])
    || !exactIntegerList(command.contexts, [0])
    || !Array.isArray(options)
    || options.length !== 1
    || !exactOption(options[0] as DiscordApplicationCommandOption, contract)
  ) {
    return undefined
  }
  return command as unknown as DiscordApplicationCommand
}

function inventorySnapshot(
  inventory: readonly DiscordApplicationCommand[],
  applicationId: string,
  guildId: string,
) {
  if (!Array.isArray(inventory) || inventory.length > MAXIMUM_GUILD_COMMANDS) {
    throw new NativeInteractionCommandStateError(
      "Discord returned an invalid native Interaction command inventory",
    )
  }
  const ids = new Set<string>()
  return inventory.map((command) => {
    if (
      !command
      || typeof command !== "object"
      || !DISCORD_SNOWFLAKE_PATTERN.test(command.id)
      || !DISCORD_SNOWFLAKE_PATTERN.test(command.version)
      || command.application_id !== applicationId
      || command.guild_id !== guildId
      || !Number.isSafeInteger(command.type)
      || typeof command.name !== "string"
      || command.name.length < 1
      || command.name.length > 32
      || ids.has(command.id)
    ) {
      throw new NativeInteractionCommandStateError(
        "Discord returned incomplete or mismatched native Interaction command inventory evidence",
      )
    }
    ids.add(command.id)
    return {
      id: command.id,
      name: command.name,
      type: command.type,
      version: command.version,
    }
  }).sort((left, right) => left.id.localeCompare(right.id))
}

function matchingCommands(
  inventory: readonly DiscordApplicationCommand[],
  commandName: string,
): DiscordApplicationCommand[] {
  return inventory.filter((command) => (
    command.type === CHAT_INPUT_COMMAND_TYPE && command.name === commandName
  ))
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

function safeErrorCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `DiscordApiError.${error.status}.${error.code ?? "unknown"}`
  }
  const name = error instanceof Error ? error.name : "UnknownError"
  return name.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128) || "UnknownError"
}

function activityEntry(options: {
  activityId: string
  commandId?: string | null
  error?: string | null
  plan: NativeInteractionCommandPlan
  status: NativeInteractionCommandActivityStatus
  timestamp: string
  verification?: "drift" | "match" | null
}): NativeInteractionCommandActivity {
  return {
    action: options.plan.action,
    commandId: options.commandId === undefined
      ? options.plan.command.id
      : options.commandId,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    id: options.activityId,
    kind: "native-interaction-command-change",
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
  error?: string | null
  plan: NativeInteractionCommandPlan
  resourceId?: string | null
  status: OperationReceipt["status"]
  timestamp: string
  verification?: "drift" | "match" | null
}): OperationReceipt {
  return {
    activityId: options.activityId,
    error: options.error ?? null,
    guildId: options.plan.guild.id,
    kind: "native-interaction-command-change",
    operationKeyHash: options.plan.operationKeyHash,
    planDigest: options.plan.digest,
    resourceId: options.resourceId ?? null,
    schemaVersion: 1,
    status: options.status,
    timestamp: options.timestamp,
    verification: options.verification ?? null,
  }
}

function uncertainExecution(error: unknown): boolean {
  if (!(error instanceof NativeInteractionCommandExecutionError)) return false
  const result = recordValue(error.result)
  return result?.status === "uncertain"
    || result?.status === "completed-record-failed"
}

async function withTargetLock<T>(
  state: TargetLockState,
  key: string,
  operation: () => Promise<T>,
  priorUncertainError: () => NativeInteractionCommandExecutionError,
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
    if (uncertainExecution(error)) {
      outcome = "uncertain"
      state.uncertainTargets.add(key)
    }
    throw error
  } finally {
    release(outcome)
    if (state.tails.get(key) === tail) state.tails.delete(key)
  }
}

export class NativeInteractionCommandService {
  readonly #activityStore: ActivityStore
  readonly #client: NativeInteractionCommandServiceClient
  readonly #clock: () => Date
  readonly #commandName: string
  readonly #lockState: TargetLockState = {
    tails: new Map(),
    uncertainTargets: new Set(),
  }
  readonly #operationStore: OperationStore
  readonly #planKey: Uint8Array
  readonly #policy: ScopePolicy
  readonly #randomId: () => string

  constructor(options: NativeInteractionCommandServiceOptions) {
    this.#activityStore = options.activityStore
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#commandName = options.commandName
    this.#operationStore = options.operationStore
    this.#planKey = options.planKey || createReviewedPlanKey()
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
  }

  async #buildPlan(
    applicationId: string,
    botId: string,
    request: NormalizedRequest,
    options: RequestOptions,
  ): Promise<BuiltPlan> {
    assertSnowflake(applicationId, "Discord connector application ID")
    assertSnowflake(botId, "Discord connector bot ID")
    this.#policy.assertNativeCommandChangeAllowed(request.guildId)
    const existingReceipt = await this.#operationStore.get(
      "native-interaction-command-change",
      request.operationKeyHash,
    )
    if (existingReceipt) {
      throw new NativeInteractionCommandConflictError(receiptView(existingReceipt))
    }
    const [guild, inventory] = await Promise.all([
      this.#client.getGuild(request.guildId, options),
      this.#client.listGuildApplicationCommands(
        applicationId,
        request.guildId,
        options,
      ),
    ])
    exactGuild(guild, request.guildId)
    const snapshot = inventorySnapshot(inventory, applicationId, request.guildId)
    const contract = nativeInteractionCommandContract(this.#commandName)
    const matches = matchingCommands(inventory, this.#commandName)
    if (matches.length > 1) {
      throw new NativeInteractionCommandStateError(
        "Discord returned duplicate same-name chat-input command evidence",
      )
    }
    const candidate = matches[0] ?? null
    if (candidate && !exactNativeInteractionCommand(
      candidate,
      applicationId,
      request.guildId,
      contract,
    )) {
      throw new NativeInteractionCommandStateError(
        "A same-name Discord command exists but does not exactly match the managed contract",
      )
    }
    const chatInputCount = inventory.filter(({ type }) => type === CHAT_INPUT_COMMAND_TYPE).length
    if (request.action === "install" && !candidate && chatInputCount >= CHAT_INPUT_COMMAND_LIMIT) {
      throw new NativeInteractionCommandStateError(
        "Discord guild chat-input command capacity is exhausted",
      )
    }
    const mutation = request.action === "install"
      ? candidate ? "none" : "create"
      : candidate ? "delete" : "none"
    const digest = reviewedPlanDigest(this.#planKey, {
      applicationId,
      botId,
      contract,
      inventory: snapshot,
      mutation,
      request,
    })
    const plan: NativeInteractionCommandPlan = {
      action: request.action,
      applicationId,
      botId,
      command: {
        contract,
        id: candidate?.id ?? null,
        version: candidate?.version ?? null,
      },
      createdAt: this.#clock().toISOString(),
      digest,
      guild: {
        id: guild.id,
        name: guild.name,
      },
      inventory: {
        chatInputCount,
        chatInputLimit: CHAT_INPUT_COMMAND_LIMIT,
        totalCount: inventory.length,
      },
      mutation,
      operationKeyHash: request.operationKeyHash,
      schemaVersion: SCHEMA_VERSION,
      status: mutation === "none"
        ? request.action === "install" ? "already-installed" : "already-absent"
        : "planned",
      warnings: [
        "The command is guild-scoped, administrator-only by default, and accepts one bounded private request string",
        "Discord command-specific permission overwrites are intentionally unsupported because they require a user Bearer token",
        "A same-name command with any contract drift blocks both installation and removal instead of being overwritten or deleted",
        "The full guild command inventory is freshness-bound so concurrent command changes invalidate execution",
        "Command creation and deletion are one-shot and are never automatically retried after reservation",
      ],
    }
    return {
      plan,
      state: {
        command: candidate,
        guild,
        inventory,
      },
    }
  }

  plan(
    applicationId: string,
    botId: string,
    request: NativeInteractionCommandRequest,
    options: RequestOptions = {},
  ): Promise<NativeInteractionCommandPlan> {
    return this.#buildPlan(
      applicationId,
      botId,
      normalizeRequest(request),
      options,
    ).then(({ plan }) => plan)
  }

  execute(
    applicationId: string,
    botId: string,
    request: NativeInteractionCommandRequest,
    expectedDigest: string,
    options: RequestOptions = {},
  ): Promise<NativeInteractionCommandResult> {
    const normalized = normalizeRequest(request)
    if (!REVIEWED_PLAN_DIGEST_PATTERN.test(expectedDigest)) {
      throw new RangeError("Discord native Interaction command plan digest is invalid")
    }
    return withTargetLock(
      this.#lockState,
      normalized.guildId,
      () => this.#executeNormalized(
        applicationId,
        botId,
        normalized,
        expectedDigest,
        options,
      ),
      () => new NativeInteractionCommandExecutionError(
        "Discord native Interaction command change was blocked because a prior guild command operation ended with an uncertain outcome",
        {
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
    request: NormalizedRequest,
    expectedDigest: string,
    options: RequestOptions,
  ): Promise<NativeInteractionCommandResult> {
    let built: BuiltPlan
    try {
      built = await this.#buildPlan(applicationId, botId, request, options)
    } catch (error) {
      if (
        error instanceof NativeInteractionCommandStateError
        || error instanceof DiscordApiError && error.status === 404
      ) {
        throw new NativeInteractionCommandPlanChangedError(
          expectedDigest,
          STATE_UNAVAILABLE,
        )
      }
      throw error
    }
    const { plan, state } = built
    if (plan.digest !== expectedDigest) {
      throw new NativeInteractionCommandPlanChangedError(expectedDigest, plan.digest)
    }
    const baseResult = {
      action: request.action,
      guildId: request.guildId,
      operationKeyHash: request.operationKeyHash,
      planDigest: plan.digest,
      schemaVersion: SCHEMA_VERSION,
    }
    if (plan.mutation === "none") {
      return {
        ...baseResult,
        activityId: null,
        commandId: plan.command.id,
        readbackMatched: true,
        status: plan.status as "already-absent" | "already-installed",
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
      throw new NativeInteractionCommandConflictError(receiptView(reservation.receipt))
    }
    try {
      await this.#activityStore.append(activityEntry({
        activityId,
        plan,
        status: "pending",
        timestamp: this.#clock().toISOString(),
      }))
    } catch (error) {
      const category = safeErrorCode(error)
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: category,
          plan,
          status: "failed",
          timestamp: this.#clock().toISOString(),
        }))
      } catch {}
      throw new NativeInteractionCommandExecutionError(
        "Discord native Interaction command change was blocked because pending activity could not be recorded",
        {
          ...baseResult,
          activityId,
          error: category,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }

    let mutationStarted = false
    let mutationAcknowledged = false
    let commandId = plan.command.id
    try {
      mutationStarted = true
      if (plan.mutation === "create") {
        const created = await this.#client.createGuildApplicationCommand(
          applicationId,
          request.guildId,
          commandInput(plan.command.contract),
          options,
        )
        mutationAcknowledged = true
        const exact = exactNativeInteractionCommand(
          created,
          applicationId,
          request.guildId,
          plan.command.contract,
        )
        if (!exact) {
          throw new NativeInteractionCommandStateError(
            "Discord returned an invalid managed-command creation response",
          )
        }
        commandId = exact.id
        const inventory = await this.#client.listGuildApplicationCommands(
          applicationId,
          request.guildId,
          options,
        )
        const observedSnapshot = inventorySnapshot(
          inventory,
          applicationId,
          request.guildId,
        )
        const readback = matchingCommands(inventory, this.#commandName)
        const observed = readback.length === 1
          ? exactNativeInteractionCommand(
              readback[0],
              applicationId,
              request.guildId,
              plan.command.contract,
            )
          : undefined
        if (!observed || observed.id !== exact.id || observed.version !== exact.version) {
          throw new NativeInteractionCommandStateError(
            "Discord managed-command creation readback did not match the response",
          )
        }
        const expectedSnapshot = [
          ...inventorySnapshot(state.inventory, applicationId, request.guildId),
          ...inventorySnapshot([exact], applicationId, request.guildId),
        ].sort((left, right) => left.id.localeCompare(right.id))
        if (JSON.stringify(observedSnapshot) !== JSON.stringify(expectedSnapshot)) {
          throw new NativeInteractionCommandStateError(
            "Discord managed-command creation changed the full guild command inventory unexpectedly",
          )
        }
      } else {
        if (!state.command || !plan.command.id) {
          throw new NativeInteractionCommandStateError(
            "Discord managed-command removal lost its exact target",
          )
        }
        await this.#client.deleteGuildApplicationCommand(
          applicationId,
          request.guildId,
          plan.command.id,
          options,
        )
        mutationAcknowledged = true
        const inventory = await this.#client.listGuildApplicationCommands(
          applicationId,
          request.guildId,
          options,
        )
        const observedSnapshot = inventorySnapshot(
          inventory,
          applicationId,
          request.guildId,
        )
        if (
          inventory.some(({ id }) => id === plan.command.id)
          || matchingCommands(inventory, this.#commandName).length > 0
        ) {
          throw new NativeInteractionCommandStateError(
            "Discord managed-command removal readback still contains the target",
          )
        }
        const expectedSnapshot = inventorySnapshot(
          state.inventory,
          applicationId,
          request.guildId,
        ).filter(({ id }) => id !== plan.command.id)
        if (JSON.stringify(observedSnapshot) !== JSON.stringify(expectedSnapshot)) {
          throw new NativeInteractionCommandStateError(
            "Discord managed-command removal changed the full guild command inventory unexpectedly",
          )
        }
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
      const category = safeErrorCode(error)
      let recordError: string | null = null
      try {
        await this.#operationStore.finish(operationReceipt({
          activityId,
          error: category,
          plan,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (recordFailure) {
        recordError = safeErrorCode(recordFailure)
      }
      try {
        await this.#activityStore.append(activityEntry({
          activityId,
          commandId,
          error: category,
          plan,
          status,
          timestamp: this.#clock().toISOString(),
        }))
      } catch (recordFailure) {
        recordError = recordError ?? safeErrorCode(recordFailure)
      }
      throw new NativeInteractionCommandExecutionError(
        status === "uncertain"
          ? "Discord native Interaction command change has an uncertain outcome and must not be retried"
          : "Discord rejected the native Interaction command change before applying it",
        {
          ...baseResult,
          activityId,
          commandId,
          error: category,
          recordError,
          status,
        },
        { cause: error },
      )
    }

    if (!commandId) {
      throw new NativeInteractionCommandExecutionError(
        "Discord native Interaction command verification did not identify the command",
        {
          ...baseResult,
          activityId,
          status: "uncertain",
        },
      )
    }
    let recordError: string | null = null
    try {
      await this.#operationStore.finish(operationReceipt({
        activityId,
        plan,
        resourceId: commandId,
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
      throw new NativeInteractionCommandExecutionError(
        "Discord native Interaction command change completed but durable completion recording failed",
        {
          ...baseResult,
          activityId,
          commandId,
          error: recordError,
          status: "completed-record-failed",
        },
      )
    }
    return {
      ...baseResult,
      activityId,
      commandId,
      readbackMatched: true,
      status: "completed",
    }
  }
}
