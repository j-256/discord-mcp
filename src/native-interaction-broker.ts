import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto"

import type {
  ActivityStore,
  NativeInteractionActivity,
  NativeInteractionActivityStatus,
} from "./activity-log.js"
import type { ConnectorConfig } from "./config.js"
import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_MESSAGE_FLAGS,
  DISCORD_SNOWFLAKE_PATTERN,
  NATIVE_INTERACTION_DEFAULTS,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import {
  DiscordApiError,
  NativeInteractionResponseError,
} from "./errors.js"
import type { GatewayInteractionHandler } from "./discord-gateway.js"
import {
  exactNativeInteractionCommand,
  nativeInteractionCommandContract,
  type NativeInteractionCommandContract,
} from "./native-interaction-command-service.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordApplicationCommand,
  DiscordChannel,
  DiscordMessage,
  RequestOptions,
} from "./types.js"

export type NativeInteractionChangeKind = "pending" | "status"
export type NativeInteractionChangeListener = (
  kind: NativeInteractionChangeKind,
) => void

export type NativeInteractionBrokerPhase =
  | "checking"
  | "disabled"
  | "failed"
  | "ready"
  | "stopped"

export type NativeInteractionErrorCategory =
  | "activity-unavailable"
  | "application-endpoint-conflict"
  | "callback-rejected"
  | "callback-uncertain"
  | "capacity-rejected"
  | "channel-evidence-invalid"
  | "command-contract-mismatch"
  | "command-inventory-invalid"
  | "identity-mismatch"
  | "payload-invalid"
  | "reference-unavailable"
  | "response-evidence-invalid"
  | "response-rejected"
  | "response-uncertain"
  | "scope-rejected"
  | "validation-evidence-unavailable"

export interface PendingNativeInteraction {
  channelId: string
  commandId: string
  commandVersion: string
  createdAt: string
  expiresAt: string
  guildId: string
  interactionId: string
  reference: string
  request: string
  schemaVersion: number
  userId: string
}

export interface PendingNativeInteractionList {
  interactions: PendingNativeInteraction[]
  page: {
    capacity: number
    returned: number
  }
  schemaVersion: number
  status: "disabled" | "ok" | "unavailable"
}

export interface NativeInteractionBrokerStatus {
  command: {
    guildCount: number
    name: string
    verifiedGuildCount: number
  }
  enabled: boolean
  lastError: {
    at: string
    category: NativeInteractionErrorCategory
  } | null
  limits: {
    maximumPending: number
    pendingPerUser: number
    requestCharacters: number
    responseCharacters: number
    ttlSeconds: number
  }
  pending: {
    count: number
    validating: number
  }
  phase: NativeInteractionBrokerPhase
  schemaVersion: number
  totals: {
    accepted: number
    expired: number
    rejected: number
    responded: number
    uncertain: number
  }
}

export interface NativeInteractionResponseResult {
  channelId: string
  guildId: string
  interactionId: string
  reference: string
  responseMessageId: string
  schemaVersion: number
  status: "completed"
}

export interface NativeInteractionSource {
  readonly enabled: boolean
  getStatus(): NativeInteractionBrokerStatus
  listPending(): Promise<PendingNativeInteractionList>
  respond(
    reference: string,
    response: string,
    options?: RequestOptions,
  ): Promise<NativeInteractionResponseResult>
  subscribe(listener: NativeInteractionChangeListener): () => void
}

export interface NativeInteractionRuntime
  extends NativeInteractionSource, GatewayInteractionHandler {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface NativeInteractionBrokerClient extends Pick<
  DiscordClient,
  | "createDeferredInteractionResponse"
  | "createImmediateInteractionResponse"
  | "editOriginalInteractionResponse"
  | "getChannel"
  | "getCurrentApplication"
  | "getCurrentUser"
  | "listGuildApplicationCommands"
> {}

export interface NativeInteractionScheduler {
  clearTimeout(handle: unknown): void
  setTimeout(handler: () => void, milliseconds: number): unknown
}

export interface NativeInteractionBrokerOptions {
  activityStore: ActivityStore
  applicationId: string
  botId: string
  client: NativeInteractionBrokerClient
  clock?: () => Date
  config: Pick<
    ConnectorConfig,
    | "allowNativeInteractions"
    | "nativeCommandName"
    | "nativeInteractionGuildIds"
    | "nativeInteractionMaxPending"
    | "nativeInteractionTtlSeconds"
  >
  policy: ScopePolicy
  randomId?: () => string
  randomReference?: () => string
  scheduler?: NativeInteractionScheduler
}

interface ParsedInteraction {
  channelId: string
  commandId: string
  commandVersion: string
  guildId: string
  interactionId: string
  request: string
  token: string
  userId: string
}

interface ParsedInteractionResult {
  interaction: ParsedInteraction
  rejection: {
    category: "payload-invalid" | "scope-rejected"
    content: string
  } | null
}

interface StoredInteraction extends PendingNativeInteraction {
  ready: boolean
  timer: unknown
  token: string
}

const INTERACTION_TYPE_APPLICATION_COMMAND = 2
const APPLICATION_COMMAND_TYPE_CHAT_INPUT = 1
const APPLICATION_COMMAND_OPTION_TYPE_STRING = 3
const INTERACTION_CONTEXT_GUILD = 0
const MESSAGE_TYPE_CHAT_INPUT_COMMAND = 20
const ADMINISTRATOR_PERMISSION = 1n << 3n
const MAXIMUM_PERMISSION_BITS = (1n << 128n) - 1n
const INTERACTION_REFERENCE_PATTERN = /^iref_[a-f0-9]{32}$/
const INTERACTION_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{1,512}$/
const INITIAL_RESPONSE_TIMEOUT_MS = 2_500
const SEEN_INTERACTION_TTL_MS = 15 * 60 * 1_000
const SEEN_INTERACTION_MINIMUM_CAPACITY = 4_096
const SEEN_INTERACTION_CAPACITY_MULTIPLIER = 128
const SHUTDOWN_TIMEOUT_MS = 3_000
const STATIC_BUSY_RESPONSE = "This private request could not be accepted because the queue is full."
const STATIC_EXPIRED_RESPONSE = "This private request expired before it could be completed."
const STATIC_REJECTED_RESPONSE = "This private request is not authorized for this server, channel, or user."
const STATIC_VALIDATION_RESPONSE = "This private request could not be validated against the managed command configuration."
const SUPPORTED_CHANNEL_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.text,
])

function defaultScheduler(): NativeInteractionScheduler {
  return {
    clearTimeout(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    setTimeout(handler, milliseconds) {
      return setTimeout(handler, milliseconds)
    },
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function snowflake(value: unknown): string | undefined {
  return typeof value === "string" && DISCORD_SNOWFLAKE_PATTERN.test(value)
    ? value
    : undefined
}

function permissionBits(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined
  try {
    const parsed = BigInt(value)
    return parsed <= MAXIMUM_PERMISSION_BITS ? parsed : undefined
  } catch {
    return undefined
  }
}

function referenceHash(reference: string): string {
  return `sha256:${createHash("sha256")
    .update("discord-mcp-native-interaction-reference.v1\0")
    .update(reference)
    .digest("hex")}`
}

function safeErrorCategory(
  error: unknown,
): "response-rejected" | "response-uncertain" {
  if (error instanceof DiscordApiError) {
    return error.status >= 400
      && error.status < 500
      && error.status !== 408
      && error.status !== 429
      ? "response-rejected"
      : "response-uncertain"
  }
  return "response-uncertain"
}

function exactChannel(
  channel: DiscordChannel,
  guildId: string,
  channelId: string,
): boolean {
  return Boolean(
    channel
    && typeof channel === "object"
    && channel.id === channelId
    && channel.guild_id === guildId
    && SUPPORTED_CHANNEL_TYPES.has(channel.type)
    && (
      channel.parent_id === undefined
      || channel.parent_id === null
      || DISCORD_SNOWFLAKE_PATTERN.test(channel.parent_id)
    )
  )
}

function validatedCommandInventory(
  value: unknown,
  applicationId: string,
  guildId: string,
): DiscordApplicationCommand[] | undefined {
  if (!Array.isArray(value) || value.length > 250) return undefined
  const ids = new Set<string>()
  for (const entry of value) {
    const command = recordValue(entry)
    const id = snowflake(command?.id)
    if (
      !command
      || !id
      || ids.has(id)
      || !snowflake(command.version)
      || command.application_id !== applicationId
      || command.guild_id !== guildId
      || !Number.isSafeInteger(command.type)
      || typeof command.name !== "string"
      || command.name.length < 1
      || command.name.length > 32
    ) {
      return undefined
    }
    ids.add(id)
  }
  return value as DiscordApplicationCommand[]
}

function exactResponseMessage(
  message: DiscordMessage,
  applicationId: string,
  botId: string,
  entry: StoredInteraction,
  response: string,
): message is DiscordMessage {
  return Boolean(
    message
    && typeof message === "object"
    && DISCORD_SNOWFLAKE_PATTERN.test(message.id)
    && message.channel_id === entry.channelId
    && message.author?.id === botId
    && message.author.bot === true
    && message.application_id === applicationId
    && (message.guild_id === undefined || message.guild_id === entry.guildId)
    && message.content === response
    && Array.isArray(message.attachments)
    && message.attachments.length === 0
    && Array.isArray(message.embeds)
    && message.embeds.length === 0
    && Array.isArray(message.components)
    && message.components.length === 0
    && Array.isArray(message.mentions)
    && message.mentions.length === 0
    && Array.isArray(message.mention_roles)
    && message.mention_roles.length === 0
    && message.mention_everyone === false
    && message.pinned === false
    && message.tts === false
    && message.poll === undefined
    && message.flags === DISCORD_MESSAGE_FLAGS.ephemeral
    && message.type === MESSAGE_TYPE_CHAT_INPUT_COMMAND
    && message.webhook_id === applicationId
    && message.interaction_metadata?.id === entry.interactionId
    && message.interaction_metadata.type === INTERACTION_TYPE_APPLICATION_COMMAND
    && message.interaction_metadata.user?.id === entry.userId
    && message.interaction_metadata.authorizing_integration_owners?.["0"] === entry.guildId
  )
}

function parseInteraction(
  payload: unknown,
  applicationId: string,
  commandByGuild: ReadonlyMap<string, DiscordApplicationCommand | undefined>,
  contract: NativeInteractionCommandContract,
): ParsedInteractionResult | undefined {
  const interaction = recordValue(payload)
  const interactionId = snowflake(interaction?.id)
  const guildId = snowflake(interaction?.guild_id)
  const channelId = snowflake(interaction?.channel_id)
  const token = interaction?.token
  const member = recordValue(interaction?.member)
  const user = recordValue(member?.user)
  const userId = snowflake(user?.id)
  const memberPermissions = permissionBits(member?.permissions)
  const data = recordValue(interaction?.data)
  const commandId = snowflake(data?.id)
  const options = data?.options
  const option = Array.isArray(options) && options.length === 1
    ? recordValue(options[0])
    : undefined
  const owners = recordValue(interaction?.authorizing_integration_owners)
  const managed = guildId ? commandByGuild.get(guildId) : undefined
  const request = option?.value
  if (
    !interactionId
    || interaction?.application_id !== applicationId
    || interaction?.type !== INTERACTION_TYPE_APPLICATION_COMMAND
    || interaction?.version !== 1
    || interaction?.context !== INTERACTION_CONTEXT_GUILD
    || !guildId
    || !channelId
    || !userId
    || !commandId
    || typeof token !== "string"
    || !INTERACTION_TOKEN_PATTERN.test(token)
    || owners?.["0"] !== guildId
    || !managed
    || managed.id !== commandId
    || data?.type !== APPLICATION_COMMAND_TYPE_CHAT_INPUT
    || data?.name !== contract.name
    || (data.guild_id !== undefined && data.guild_id !== guildId)
  ) {
    return undefined
  }
  const parsed: ParsedInteraction = {
    channelId,
    commandId,
    commandVersion: managed.version,
    guildId,
    interactionId,
    request: typeof request === "string" ? request : "",
    token,
    userId,
  }
  if (memberPermissions === undefined) {
    return {
      interaction: parsed,
      rejection: {
        category: "payload-invalid",
        content: STATIC_VALIDATION_RESPONSE,
      },
    }
  }
  if ((memberPermissions & ADMINISTRATOR_PERMISSION) !== ADMINISTRATOR_PERMISSION) {
    return {
      interaction: parsed,
      rejection: {
        category: "scope-rejected",
        content: STATIC_REJECTED_RESPONSE,
      },
    }
  }
  if (
    !option
    || option.name !== contract.option.name
    || option.type !== APPLICATION_COMMAND_OPTION_TYPE_STRING
    || (option.focused !== undefined && option.focused !== false)
    || typeof request !== "string"
    || request.length < 1
    || request.length > contract.option.maximumLength
    || !request.trim()
    || request.includes("\0")
  ) {
    return {
      interaction: parsed,
      rejection: {
        category: "payload-invalid",
        content: STATIC_VALIDATION_RESPONSE,
      },
    }
  }
  return { interaction: parsed, rejection: null }
}

function activityEntry(options: {
  activityId: string
  entry: Pick<
    StoredInteraction,
    "channelId" | "guildId" | "interactionId" | "reference" | "userId"
  >
  error?: string | null
  status: NativeInteractionActivityStatus
  timestamp: string
}): NativeInteractionActivity {
  return {
    channelId: options.entry.channelId,
    error: options.error ?? null,
    guildId: options.entry.guildId,
    id: options.activityId,
    interactionId: options.entry.interactionId,
    kind: "native-interaction",
    referenceHash: referenceHash(options.entry.reference),
    schemaVersion: SCHEMA_VERSION,
    status: options.status,
    timestamp: options.timestamp,
    userId: options.entry.userId,
  }
}

export class NativeInteractionBroker implements NativeInteractionRuntime {
  readonly #activityStore: ActivityStore
  readonly #applicationId: string
  #accepted = 0
  readonly #botId: string
  readonly #client: NativeInteractionBrokerClient
  readonly #clock: () => Date
  #closed = false
  readonly #commandByGuild = new Map<string, DiscordApplicationCommand | undefined>()
  readonly #commandName: string
  readonly #contract: NativeInteractionCommandContract
  #expired = 0
  readonly #ingestTasks = new Set<Promise<void>>()
  #lastError: NativeInteractionBrokerStatus["lastError"] = null
  readonly #lifecycleAbortController = new AbortController()
  readonly #listeners = new Set<NativeInteractionChangeListener>()
  readonly #maximumPending: number
  readonly #maximumSeen: number
  readonly #pending = new Map<string, StoredInteraction>()
  #phase: NativeInteractionBrokerPhase
  readonly #policy: ScopePolicy
  readonly #randomId: () => string
  readonly #randomReference: () => string
  #rejected = 0
  #responded = 0
  readonly #scheduler: NativeInteractionScheduler
  readonly #seen = new Map<string, number>()
  #startPromise: Promise<void> | undefined
  readonly #ttlMs: number
  #uncertain = 0

  constructor(options: NativeInteractionBrokerOptions) {
    assertSnowflake(options.applicationId, "Discord native Interaction application ID")
    assertSnowflake(options.botId, "Discord native Interaction bot ID")
    this.#activityStore = options.activityStore
    this.#applicationId = options.applicationId
    this.#botId = options.botId
    this.#client = options.client
    this.#clock = options.clock || (() => new Date())
    this.#commandName = options.config.nativeCommandName
    this.#contract = nativeInteractionCommandContract(this.#commandName)
    this.#maximumPending = options.config.nativeInteractionMaxPending
    this.#maximumSeen = Math.max(
      SEEN_INTERACTION_MINIMUM_CAPACITY,
      this.#maximumPending * SEEN_INTERACTION_CAPACITY_MULTIPLIER,
    )
    this.#phase = options.config.allowNativeInteractions ? "stopped" : "disabled"
    this.#policy = options.policy
    this.#randomId = options.randomId || randomUUID
    this.#randomReference = options.randomReference
      || (() => `iref_${randomBytes(16).toString("hex")}`)
    this.#scheduler = options.scheduler || defaultScheduler()
    this.#ttlMs = options.config.nativeInteractionTtlSeconds * 1_000
    for (const guildId of options.config.nativeInteractionGuildIds) {
      assertSnowflake(guildId, "Discord native Interaction guild ID")
      this.#commandByGuild.set(guildId, undefined)
    }
  }

  get enabled(): boolean {
    return this.#phase !== "disabled"
  }

  #now(): Date {
    return this.#clock()
  }

  #emit(kind: NativeInteractionChangeKind): void {
    for (const listener of this.#listeners) {
      try {
        listener(kind)
      } catch {}
    }
  }

  #setError(category: NativeInteractionErrorCategory): void {
    this.#lastError = {
      at: this.#now().toISOString(),
      category,
    }
    this.#emit("status")
  }

  async start(): Promise<void> {
    if (this.#phase === "disabled" || this.#phase === "ready") return
    if (this.#closed) return
    if (this.#startPromise) return this.#startPromise
    this.#phase = "checking"
    this.#emit("status")
    this.#startPromise = this.#preflight().then(() => {
      if (this.#closed) return
      this.#phase = "ready"
      this.#lastError = null
      this.#emit("status")
    }).catch((error: unknown) => {
      if (!this.#closed) {
        this.#phase = "failed"
        if (!this.#lastError) this.#setError("command-contract-mismatch")
      }
      throw error
    })
    return this.#startPromise
  }

  async #preflight(): Promise<void> {
    const [application, bot] = await Promise.all([
      this.#client.getCurrentApplication(),
      this.#client.getCurrentUser(),
    ])
    if (application.id !== this.#applicationId || bot.id !== this.#botId || bot.bot !== true) {
      this.#setError("identity-mismatch")
      throw new Error("Discord native Interaction identity preflight failed")
    }
    if (application.interactions_endpoint_url !== null) {
      this.#setError("application-endpoint-conflict")
      throw new Error(
        "Discord application has an HTTP Interaction endpoint configured, which disables Gateway Interaction delivery",
      )
    }
    const guildIds = [...this.#commandByGuild.keys()]
    const inventories = await Promise.all(guildIds.map((guildId) => (
      this.#client.listGuildApplicationCommands(this.#applicationId, guildId)
    )))
    for (const [index, guildId] of guildIds.entries()) {
      const inventory = validatedCommandInventory(
        inventories[index],
        this.#applicationId,
        guildId,
      )
      if (!inventory) {
        this.#setError("command-inventory-invalid")
        throw new Error("Discord native Interaction command preflight inventory is invalid")
      }
      const matches = inventory.filter((command) => (
        command.type === APPLICATION_COMMAND_TYPE_CHAT_INPUT
        && command.name === this.#commandName
      ))
      const exact = matches.length === 1
        ? exactNativeInteractionCommand(
            matches[0],
            this.#applicationId,
            guildId,
            this.#contract,
          )
        : undefined
      if (!exact) {
        this.#setError("command-contract-mismatch")
        throw new Error("Discord native Interaction managed-command preflight failed")
      }
      this.#commandByGuild.set(guildId, exact)
    }
  }

  getStatus(): NativeInteractionBrokerStatus {
    let validating = 0
    for (const entry of this.#pending.values()) {
      if (!entry.ready) validating += 1
    }
    let verifiedGuildCount = 0
    for (const command of this.#commandByGuild.values()) {
      if (command) verifiedGuildCount += 1
    }
    return {
      command: {
        guildCount: this.#commandByGuild.size,
        name: this.#commandName,
        verifiedGuildCount,
      },
      enabled: this.enabled,
      lastError: this.#lastError ? { ...this.#lastError } : null,
      limits: {
        maximumPending: this.#maximumPending,
        pendingPerUser: NATIVE_INTERACTION_DEFAULTS.pendingPerUser,
        requestCharacters: NATIVE_INTERACTION_DEFAULTS.requestCharacters,
        responseCharacters: NATIVE_INTERACTION_DEFAULTS.responseCharacters,
        ttlSeconds: this.#ttlMs / 1_000,
      },
      pending: {
        count: this.#pending.size,
        validating,
      },
      phase: this.#phase,
      schemaVersion: SCHEMA_VERSION,
      totals: {
        accepted: this.#accepted,
        expired: this.#expired,
        rejected: this.#rejected,
        responded: this.#responded,
        uncertain: this.#uncertain,
      },
    }
  }

  subscribe(listener: NativeInteractionChangeListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #cleanSeen(now: number): void {
    for (const [interactionId, expiresAt] of this.#seen) {
      if (expiresAt <= now) this.#seen.delete(interactionId)
    }
  }

  #userPending(userId: string): number {
    let count = 0
    for (const entry of this.#pending.values()) {
      if (entry.userId === userId) count += 1
    }
    return count
  }

  async #appendActivity(
    entry: StoredInteraction,
    status: NativeInteractionActivityStatus,
    error: string | null = null,
  ): Promise<void> {
    await this.#activityStore.append(activityEntry({
      activityId: this.#randomId(),
      entry,
      error,
      status,
      timestamp: this.#now().toISOString(),
    }))
  }

  async #initialReject(
    interaction: ParsedInteraction,
    content: string,
    category: NativeInteractionErrorCategory,
  ): Promise<void> {
    this.#rejected += 1
    this.#setError(category)
    let callbackCategory: "callback-rejected" | "callback-uncertain" | undefined
    try {
      await this.#client.createImmediateInteractionResponse(
        interaction.interactionId,
        interaction.token,
        content,
        { signal: AbortSignal.timeout(INITIAL_RESPONSE_TIMEOUT_MS) },
      )
    } catch (error) {
      callbackCategory = safeErrorCategory(error) === "response-rejected"
        ? "callback-rejected"
        : "callback-uncertain"
      if (callbackCategory === "callback-uncertain") this.#uncertain += 1
      this.#setError(callbackCategory)
    }
    const timestamp = this.#now().toISOString()
    const entry: StoredInteraction = {
      ...interaction,
      createdAt: timestamp,
      expiresAt: timestamp,
      ready: false,
      reference: this.#randomReference(),
      schemaVersion: SCHEMA_VERSION,
      timer: undefined,
    }
    try {
      await this.#appendActivity(entry, "rejected", category)
      if (callbackCategory) {
        await this.#appendActivity(
          entry,
          callbackCategory === "callback-rejected"
            ? "response-failed"
            : "response-uncertain",
          callbackCategory,
        )
      }
    } catch {
      this.#setError("activity-unavailable")
    }
    this.#emit("status")
  }

  ingestInteraction(payload: unknown): Promise<void> {
    if (this.#phase !== "ready") return Promise.resolve()
    const task = this.#ingestInteraction(payload)
    this.#ingestTasks.add(task)
    void task.then(
      () => this.#ingestTasks.delete(task),
      () => this.#ingestTasks.delete(task),
    )
    return task
  }

  async #ingestInteraction(payload: unknown): Promise<void> {
    const parsed = parseInteraction(
      payload,
      this.#applicationId,
      this.#commandByGuild,
      this.#contract,
    )
    if (!parsed) return
    const { interaction } = parsed
    const now = this.#now().getTime()
    this.#cleanSeen(now)
    if (this.#seen.has(interaction.interactionId)) return
    if (this.#seen.size >= this.#maximumSeen) {
      await this.#initialReject(interaction, STATIC_BUSY_RESPONSE, "capacity-rejected")
      return
    }
    this.#seen.set(interaction.interactionId, now + SEEN_INTERACTION_TTL_MS)
    if (parsed.rejection) {
      await this.#initialReject(
        interaction,
        parsed.rejection.content,
        parsed.rejection.category,
      )
      return
    }
    try {
      this.#policy.assertNativeInteractionAllowed(
        interaction.guildId,
        interaction.channelId,
        interaction.userId,
      )
    } catch {
      await this.#initialReject(interaction, STATIC_REJECTED_RESPONSE, "scope-rejected")
      return
    }
    if (
      this.#pending.size >= this.#maximumPending
      || this.#userPending(interaction.userId) >= NATIVE_INTERACTION_DEFAULTS.pendingPerUser
    ) {
      await this.#initialReject(interaction, STATIC_BUSY_RESPONSE, "capacity-rejected")
      return
    }
    const reference = this.#randomReference()
    if (!INTERACTION_REFERENCE_PATTERN.test(reference) || this.#pending.has(reference)) {
      await this.#initialReject(interaction, STATIC_BUSY_RESPONSE, "reference-unavailable")
      return
    }
    const createdAt = this.#now()
    const expiresAt = new Date(createdAt.getTime() + this.#ttlMs)
    const entry: StoredInteraction = {
      ...interaction,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ready: false,
      reference,
      schemaVersion: SCHEMA_VERSION,
      timer: undefined,
    }
    this.#pending.set(reference, entry)
    this.#emit("status")
    try {
      await this.#client.createDeferredInteractionResponse(
        interaction.interactionId,
        interaction.token,
        { signal: AbortSignal.timeout(INITIAL_RESPONSE_TIMEOUT_MS) },
      )
    } catch (error) {
      this.#pending.delete(reference)
      const knownRejected = safeErrorCategory(error) === "response-rejected"
      if (knownRejected) this.#rejected += 1
      else this.#uncertain += 1
      const category = knownRejected ? "callback-rejected" : "callback-uncertain"
      this.#setError(category)
      try {
        await this.#appendActivity(
          entry,
          knownRejected ? "rejected" : "response-uncertain",
          category,
        )
      } catch {
        this.#setError("activity-unavailable")
      }
      this.#emit("status")
      return
    }
    if (this.#closed || this.#pending.get(reference) !== entry) return

    let category: NativeInteractionErrorCategory | undefined
    let channel: DiscordChannel | undefined
    let inventory: DiscordApplicationCommand[] | undefined
    try {
      ;[channel, inventory] = await Promise.all([
        this.#client.getChannel(interaction.channelId, {
          signal: this.#lifecycleAbortController.signal,
        }),
        this.#client.listGuildApplicationCommands(
          this.#applicationId,
          interaction.guildId,
          { signal: this.#lifecycleAbortController.signal },
        ),
      ])
    } catch {
      category = "validation-evidence-unavailable"
    }
    if (this.#closed || this.#pending.get(reference) !== entry) return
    if (!category) {
      if (!exactChannel(channel!, interaction.guildId, interaction.channelId)) {
        category = "channel-evidence-invalid"
      } else if (!(inventory = validatedCommandInventory(
        inventory,
        this.#applicationId,
        interaction.guildId,
      ))) {
        category = "command-inventory-invalid"
      } else {
        const matches = inventory.filter((command) => (
          command.type === APPLICATION_COMMAND_TYPE_CHAT_INPUT
          && command.name === this.#commandName
        ))
        const exact = matches.length === 1
          ? exactNativeInteractionCommand(
              matches[0],
              this.#applicationId,
              interaction.guildId,
              this.#contract,
            )
          : undefined
        if (
          !exact
          || exact.id !== interaction.commandId
        ) {
          category = "command-contract-mismatch"
        } else {
          entry.commandVersion = exact.version
        }
      }
    }
    if (!category) {
      try {
        await this.#appendActivity(entry, "accepted")
        this.#accepted += 1
      } catch {
        category = "activity-unavailable"
      }
    }
    if (this.#closed || this.#pending.get(reference) !== entry) return
    if (category) {
      this.#pending.delete(reference)
      this.#rejected += 1
      this.#setError(category)
      try {
        await this.#appendActivity(entry, "rejected", category)
      } catch {
        this.#setError("activity-unavailable")
      }
      try {
        await this.#client.editOriginalInteractionResponse(
          this.#applicationId,
          interaction.token,
          STATIC_VALIDATION_RESPONSE,
          { signal: this.#lifecycleAbortController.signal },
        )
      } catch (error) {
        const responseCategory = safeErrorCategory(error)
        if (responseCategory === "response-uncertain") this.#uncertain += 1
        this.#setError(responseCategory)
        try {
          await this.#appendActivity(
            entry,
            responseCategory === "response-rejected"
              ? "response-failed"
              : "response-uncertain",
            responseCategory,
          )
        } catch {
          this.#setError("activity-unavailable")
        }
      }
      this.#emit("status")
      return
    }
    if (this.#now().getTime() >= expiresAt.getTime()) {
      await this.#expire(reference)
      return
    }
    entry.ready = true
    entry.timer = this.#scheduler.setTimeout(() => {
      void this.#expire(reference)
    }, Math.max(0, expiresAt.getTime() - this.#now().getTime()))
    this.#emit("pending")
    this.#emit("status")
  }

  async #expire(reference: string): Promise<void> {
    const entry = this.#pending.get(reference)
    if (!entry) return
    this.#pending.delete(reference)
    if (entry.timer !== undefined) this.#scheduler.clearTimeout(entry.timer)
    this.#expired += 1
    this.#emit("pending")
    this.#emit("status")
    let responseCategory: "response-rejected" | "response-uncertain" | undefined
    try {
      await this.#client.editOriginalInteractionResponse(
        this.#applicationId,
        entry.token,
        STATIC_EXPIRED_RESPONSE,
      )
    } catch (error) {
      responseCategory = safeErrorCategory(error)
      if (responseCategory === "response-uncertain") this.#uncertain += 1
      this.#setError(responseCategory)
    }
    try {
      await this.#appendActivity(
        entry,
        responseCategory === undefined
          ? "expired"
          : responseCategory === "response-rejected"
            ? "response-failed"
            : "response-uncertain",
        responseCategory ?? null,
      )
    } catch {
      this.#setError("activity-unavailable")
    }
  }

  async listPending(): Promise<PendingNativeInteractionList> {
    const now = this.#now().getTime()
    const expired = [...this.#pending.values()]
      .filter((entry) => Date.parse(entry.expiresAt) <= now)
      .map(({ reference }) => reference)
    await Promise.all(expired.map((reference) => this.#expire(reference)))
    const interactions = [...this.#pending.values()]
      .filter(({ ready }) => ready)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(({ ready: _ready, timer: _timer, token: _token, ...entry }) => ({
        ...entry,
      }))
    return {
      interactions,
      page: {
        capacity: this.#maximumPending,
        returned: interactions.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: this.#phase === "ready"
        ? "ok"
        : this.#phase === "disabled" ? "disabled" : "unavailable",
    }
  }

  async respond(
    reference: string,
    response: string,
    options: RequestOptions = {},
  ): Promise<NativeInteractionResponseResult> {
    if (!INTERACTION_REFERENCE_PATTERN.test(reference)) {
      throw new RangeError("Discord native Interaction reference is invalid")
    }
    if (
      typeof response !== "string"
      || response.length < 1
      || response.length > NATIVE_INTERACTION_DEFAULTS.responseCharacters
      || !response.trim()
      || response.includes("\0")
    ) {
      throw new RangeError(
        `Discord native Interaction response must be 1-${NATIVE_INTERACTION_DEFAULTS.responseCharacters} nonempty characters`,
      )
    }
    const entry = this.#pending.get(reference)
    if (!entry || !entry.ready) {
      throw new RangeError("Discord native Interaction reference is unavailable or expired")
    }
    if (Date.parse(entry.expiresAt) <= this.#now().getTime()) {
      await this.#expire(reference)
      throw new RangeError("Discord native Interaction reference is unavailable or expired")
    }
    entry.ready = false
    if (entry.timer !== undefined) this.#scheduler.clearTimeout(entry.timer)
    entry.timer = undefined
    try {
      await this.#appendActivity(entry, "response-pending")
    } catch (error) {
      if (this.#pending.get(reference) === entry) {
        entry.ready = true
        const remaining = Date.parse(entry.expiresAt) - this.#now().getTime()
        if (remaining > 0) {
          entry.timer = this.#scheduler.setTimeout(() => {
            void this.#expire(reference)
          }, remaining)
        } else {
          void this.#expire(reference)
        }
      }
      this.#setError("activity-unavailable")
      throw new NativeInteractionResponseError(
        "Discord native Interaction response was blocked because pending activity could not be recorded",
        {
          interactionId: entry.interactionId,
          reference,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }
    if (this.#pending.get(reference) !== entry) {
      throw new RangeError("Discord native Interaction reference expired during response preparation")
    }
    if (Date.parse(entry.expiresAt) <= this.#now().getTime()) {
      await this.#expire(reference)
      throw new RangeError("Discord native Interaction reference expired during response preparation")
    }
    this.#pending.delete(reference)
    this.#emit("pending")
    this.#emit("status")

    let message: DiscordMessage
    try {
      message = await this.#client.editOriginalInteractionResponse(
        this.#applicationId,
        entry.token,
        response,
        options,
      )
      if (!exactResponseMessage(
        message,
        this.#applicationId,
        this.#botId,
        entry,
        response,
      )) {
        throw new NativeInteractionResponseError(
          "Discord returned invalid native Interaction response evidence",
          {
            interactionId: entry.interactionId,
            reference,
            schemaVersion: SCHEMA_VERSION,
            status: "uncertain",
          },
        )
      }
    } catch (error) {
      const category = error instanceof NativeInteractionResponseError
        ? "response-evidence-invalid"
        : safeErrorCategory(error)
      const knownRejected = category === "response-rejected"
      if (knownRejected) this.#rejected += 1
      else this.#uncertain += 1
      this.#setError(category)
      try {
        await this.#appendActivity(
          entry,
          knownRejected ? "response-failed" : "response-uncertain",
          category,
        )
      } catch {
        this.#setError("activity-unavailable")
      }
      if (error instanceof NativeInteractionResponseError) throw error
      throw new NativeInteractionResponseError(
        knownRejected
          ? "Discord rejected the native Interaction response before applying it"
          : "Discord native Interaction response has an uncertain outcome and must not be retried",
        {
          interactionId: entry.interactionId,
          reference,
          schemaVersion: SCHEMA_VERSION,
          status: knownRejected ? "failed" : "uncertain",
        },
        { cause: error },
      )
    }

    this.#responded += 1
    let recordError = false
    try {
      await this.#appendActivity(entry, "response-completed")
    } catch {
      recordError = true
      this.#setError("activity-unavailable")
    }
    if (recordError) {
      throw new NativeInteractionResponseError(
        "Discord native Interaction response completed but durable completion recording failed",
        {
          interactionId: entry.interactionId,
          reference,
          responseMessageId: message.id,
          schemaVersion: SCHEMA_VERSION,
          status: "completed-record-failed",
        },
      )
    }
    this.#emit("status")
    return {
      channelId: entry.channelId,
      guildId: entry.guildId,
      interactionId: entry.interactionId,
      reference,
      responseMessageId: message.id,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
    }
  }

  async stop(): Promise<void> {
    if (this.#phase === "disabled" || this.#closed) return
    this.#closed = true
    this.#phase = "stopped"
    this.#lifecycleAbortController.abort()
    for (const entry of this.#pending.values()) {
      entry.ready = false
      if (entry.timer !== undefined) this.#scheduler.clearTimeout(entry.timer)
      entry.timer = undefined
    }
    await Promise.allSettled([...this.#ingestTasks])
    const entries = [...this.#pending.values()]
    this.#pending.clear()
    this.#expired += entries.length
    this.#emit("pending")
    this.#emit("status")
    const signal = AbortSignal.timeout(SHUTDOWN_TIMEOUT_MS)
    await Promise.allSettled(entries.map(async (entry) => {
      let responseCategory: "response-rejected" | "response-uncertain" | undefined
      try {
        await this.#client.editOriginalInteractionResponse(
          this.#applicationId,
          entry.token,
          STATIC_EXPIRED_RESPONSE,
          { signal },
        )
      } catch (error) {
        responseCategory = safeErrorCategory(error)
        if (responseCategory === "response-uncertain") this.#uncertain += 1
      }
      try {
        await this.#appendActivity(
          entry,
          responseCategory === undefined
            ? "expired"
            : responseCategory === "response-rejected"
              ? "response-failed"
              : "response-uncertain",
          responseCategory ?? null,
        )
      } catch {}
    }))
    if (entries.length > 0) this.#emit("status")
  }
}

export function createDisabledNativeInteractionSource(config: Pick<
  ConnectorConfig,
  | "nativeCommandName"
  | "nativeInteractionGuildIds"
  | "nativeInteractionMaxPending"
  | "nativeInteractionTtlSeconds"
>): NativeInteractionSource {
  const status: NativeInteractionBrokerStatus = {
    command: {
      guildCount: config.nativeInteractionGuildIds.size,
      name: config.nativeCommandName,
      verifiedGuildCount: 0,
    },
    enabled: false,
    lastError: null,
    limits: {
      maximumPending: config.nativeInteractionMaxPending,
      pendingPerUser: NATIVE_INTERACTION_DEFAULTS.pendingPerUser,
      requestCharacters: NATIVE_INTERACTION_DEFAULTS.requestCharacters,
      responseCharacters: NATIVE_INTERACTION_DEFAULTS.responseCharacters,
      ttlSeconds: config.nativeInteractionTtlSeconds,
    },
    pending: {
      count: 0,
      validating: 0,
    },
    phase: "disabled",
    schemaVersion: SCHEMA_VERSION,
    totals: {
      accepted: 0,
      expired: 0,
      rejected: 0,
      responded: 0,
      uncertain: 0,
    },
  }
  return {
    enabled: false,
    getStatus: () => ({ ...status }),
    listPending: async () => ({
      interactions: [],
      page: {
        capacity: config.nativeInteractionMaxPending,
        returned: 0,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "disabled",
    }),
    respond: async () => {
      throw new RangeError("Discord native Interactions are disabled")
    },
    subscribe: () => () => undefined,
  }
}

function assertSnowflake(value: unknown, description: string): asserts value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${description} must be an exact Discord snowflake`)
  }
}
