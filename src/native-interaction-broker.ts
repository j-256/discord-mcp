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
import { parseDiscordManagedComponentLayout } from "./component-layout.js"
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
import {
  isManagedRequestButtonCustomId,
  type RequestButtonStyle,
} from "./request-button.js"
import type {
  DiscordApplication,
  DiscordApplicationCommand,
  DiscordChannel,
  DiscordMessage,
  DiscordUser,
  RequestOptions,
} from "./types.js"

export type NativeInteractionChangeKind = "continuations" | "pending" | "status"
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
  | "continuation-reference-unavailable"
  | "followup-evidence-invalid"
  | "followup-rejected"
  | "followup-uncertain"
  | "identity-mismatch"
  | "payload-invalid"
  | "reference-unavailable"
  | "request-button-evidence-invalid"
  | "response-evidence-invalid"
  | "response-rejected"
  | "response-uncertain"
  | "scope-rejected"
  | "validation-evidence-unavailable"

export type NativeInteractionSourceKind = "command" | "request-button"

export interface PendingNativeInteraction {
  channelId: string
  commandId: string | null
  commandVersion: string | null
  createdAt: string
  expiresAt: string
  guildId: string
  interactionId: string
  reference: string
  request: string
  requestButtonIndex: number | null
  requestButtonStyle: RequestButtonStyle | null
  schemaVersion: number
  source: NativeInteractionSourceKind
  sourceMessageId: string | null
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

export interface NativeInteractionContinuation {
  channelId: string
  commandId: string | null
  commandVersion: string | null
  createdAt: string
  expiresAt: string
  followupsCompleted: number
  followupsRemaining: number
  guildId: string
  interactionId: string
  openedAt: string
  reference: string
  requestButtonIndex: number | null
  requestButtonStyle: RequestButtonStyle | null
  schemaVersion: number
  source: NativeInteractionSourceKind
  sourceMessageId: string | null
  userId: string
}

export interface NativeInteractionContinuationList {
  continuations: NativeInteractionContinuation[]
  page: {
    capacity: number
    returned: number
  }
  schemaVersion: number
  status: "disabled" | "ok" | "unavailable"
}

export interface NativeInteractionContinuationResult {
  expiresAt: string
  followupsRemaining: number
  reference: string
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
    maximumFollowups: number
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
  continuations: {
    count: number
  }
  phase: NativeInteractionBrokerPhase
  schemaVersion: number
  totals: {
    accepted: number
    continuationsExpired: number
    expired: number
    followups: number
    rejected: number
    responded: number
    uncertain: number
  }
}

export interface NativeInteractionRequestButtonReadiness {
  commandId: string | null
  commandVersion: string | null
  gatewayDelivery: "verified" | null
  guildId: string
  phase: NativeInteractionBrokerPhase
  ready: boolean
  schemaVersion: number
}

export interface NativeInteractionResponseResult {
  channelId: string
  guildId: string
  interactionId: string
  continuation: NativeInteractionContinuationResult | null
  reference: string
  responseMessageId: string
  schemaVersion: number
  status: "completed"
}

export interface NativeInteractionFollowupResult {
  channelId: string
  continuation: NativeInteractionContinuationResult | null
  followupsCompleted: number
  guildId: string
  interactionId: string
  reference: string
  responseMessageId: string
  schemaVersion: number
  status: "completed"
  verification: "response-and-readback-match"
}

export interface NativeInteractionResponseOptions extends RequestOptions {
  keepOpen?: boolean
}

export interface NativeInteractionSource {
  readonly enabled: boolean
  getRequestButtonReadiness(
    guildId: string,
  ): Promise<NativeInteractionRequestButtonReadiness>
  getStatus(): NativeInteractionBrokerStatus
  listContinuations(): Promise<NativeInteractionContinuationList>
  listPending(): Promise<PendingNativeInteractionList>
  followup(
    reference: string,
    response: string,
    options?: NativeInteractionResponseOptions,
  ): Promise<NativeInteractionFollowupResult>
  respond(
    reference: string,
    response: string,
    options?: NativeInteractionResponseOptions,
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
  | "createInteractionFollowup"
  | "editOriginalInteractionResponse"
  | "getChannel"
  | "getCurrentApplication"
  | "getCurrentUser"
  | "getMessage"
  | "getInteractionFollowup"
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
  randomContinuationReference?: () => string
  randomReference?: () => string
  requestButtonKey: Uint8Array
  scheduler?: NativeInteractionScheduler
}

interface ParsedInteraction {
  channelId: string
  commandId: string | null
  commandVersion: string | null
  guildId: string
  interactionId: string
  request: string
  requestButtonCustomId: string | null
  requestButtonIndex: number | null
  requestButtonStyle: RequestButtonStyle | null
  source: NativeInteractionSourceKind
  sourceMessageId: string | null
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
  requestButtonCustomId: string | null
  timer: unknown
  token: string
}

interface StoredContinuation extends NativeInteractionContinuation {
  ready: boolean
  timer: unknown
  token: string
}

const INTERACTION_TYPE_APPLICATION_COMMAND = 2
const INTERACTION_TYPE_MESSAGE_COMPONENT = 3
const COMPONENT_TYPE_BUTTON = 2
const APPLICATION_COMMAND_TYPE_CHAT_INPUT = 1
const APPLICATION_COMMAND_OPTION_TYPE_STRING = 3
const INTERACTION_CONTEXT_GUILD = 0
const MESSAGE_TYPE_DEFAULT = 0
const MESSAGE_TYPE_CHAT_INPUT_COMMAND = 20
const ADMINISTRATOR_PERMISSION = 1n << 3n
const MAXIMUM_PERMISSION_BITS = (1n << 128n) - 1n
const INTERACTION_REFERENCE_PATTERN = /^iref_[a-f0-9]{32}$/
const INTERACTION_CONTINUATION_REFERENCE_PATTERN = /^icref_[a-f0-9]{32}$/
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
const STATIC_REQUEST_BUTTON_VALIDATION_RESPONSE = "This private request could not be validated against the managed source message."
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
    .update("guildcontrol-native-interaction-reference.v1\0")
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

function assertNativeInteractionResponse(response: string): void {
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

function ingressIdentityError(
  application: DiscordApplication | undefined,
  bot: DiscordUser | undefined,
  applicationId: string,
  botId: string,
): "application-endpoint-conflict" | "identity-mismatch" | undefined {
  if (
    !application
    || application.id !== applicationId
    || !bot
    || bot.id !== botId
    || bot.bot !== true
  ) return "identity-mismatch"
  return application.interactions_endpoint_url === null
    ? undefined
    : "application-endpoint-conflict"
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
    && (entry.source === "command"
      ? message.type === MESSAGE_TYPE_CHAT_INPUT_COMMAND
      : message.type === MESSAGE_TYPE_DEFAULT)
    && message.webhook_id === applicationId
    && message.interaction_metadata?.id === entry.interactionId
    && message.interaction_metadata.type === (entry.source === "command"
      ? INTERACTION_TYPE_APPLICATION_COMMAND
      : INTERACTION_TYPE_MESSAGE_COMPONENT)
    && message.interaction_metadata.user?.id === entry.userId
    && message.interaction_metadata.authorizing_integration_owners?.["0"] === entry.guildId
    && (entry.source === "command"
      ? message.interaction_metadata.interacted_message_id === undefined
        && message.message_reference === undefined
      : message.interaction_metadata.interacted_message_id === entry.sourceMessageId
        && message.message_reference?.message_id === entry.sourceMessageId
        && message.message_reference.channel_id === entry.channelId
        && message.message_reference.guild_id === entry.guildId
        && (message.message_reference.type === undefined
          || message.message_reference.type === 0))
  )
}

function exactFollowupInteractionMetadata(
  message: DiscordMessage,
  entry: StoredContinuation,
): boolean {
  const metadata = message.interaction_metadata
  return metadata === undefined || Boolean(
    metadata.id === entry.interactionId
    && metadata.type === (entry.source === "command"
      ? INTERACTION_TYPE_APPLICATION_COMMAND
      : INTERACTION_TYPE_MESSAGE_COMPONENT)
    && metadata.user?.id === entry.userId
    && metadata.authorizing_integration_owners?.["0"] === entry.guildId
    && (entry.source === "command"
      ? metadata.interacted_message_id === undefined
      : metadata.interacted_message_id === entry.sourceMessageId)
  )
}

function exactFollowupMessage(
  message: DiscordMessage,
  applicationId: string,
  botId: string,
  entry: StoredContinuation,
  response: string,
  expectedMessageId?: string,
): message is DiscordMessage {
  return Boolean(
    message
    && typeof message === "object"
    && DISCORD_SNOWFLAKE_PATTERN.test(message.id)
    && (expectedMessageId === undefined || message.id === expectedMessageId)
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
    && message.type === MESSAGE_TYPE_DEFAULT
    && message.webhook_id === applicationId
    && exactFollowupInteractionMetadata(message, entry)
  )
}

interface ParsedRequestButtonSource {
  index: number
  label: string
  messageId: string
  style: RequestButtonStyle
}

function parseRequestButtonSourceMessage(
  input: unknown,
  applicationId: string,
  botId: string,
  guildId: string,
  channelId: string,
  customId: string,
  key: Uint8Array,
): ParsedRequestButtonSource | undefined {
  const message = recordValue(input)
  const author = recordValue(message?.author)
  const messageId = snowflake(message?.id)
  if (
    !message
    || !messageId
    || message.channel_id !== channelId
    || (message.guild_id !== undefined && message.guild_id !== guildId)
    || author?.id !== botId
    || author.bot !== true
    || (message.application_id !== undefined
      && message.application_id !== applicationId)
    || message.webhook_id !== undefined
    || message.content !== ""
    || !Array.isArray(message.attachments)
    || message.attachments.length !== 0
    || !Array.isArray(message.embeds)
    || message.embeds.length !== 0
    || !Array.isArray(message.components)
    || !Number.isSafeInteger(message.flags)
    || ((message.flags as number) & DISCORD_MESSAGE_FLAGS.isComponentsV2) === 0
    || ![MESSAGE_TYPE_DEFAULT, 19].includes(message.type as number)
    || message.poll !== undefined
    || message.tts !== false
  ) return undefined
  try {
    const parsed = parseDiscordManagedComponentLayout(message.components, {
      key,
      scope: {
        applicationId,
        botId,
        channelId,
        guildId,
      },
    })
    const button = parsed.requestButtons.find((entry) => entry.customId === customId)
    return button
      ? {
          index: button.index,
          label: button.label,
          messageId,
          style: button.style,
        }
      : undefined
  } catch {
    return undefined
  }
}

function parseInteraction(
  payload: unknown,
  applicationId: string,
  botId: string,
  requestButtonKey: Uint8Array,
  commandByGuild: ReadonlyMap<string, DiscordApplicationCommand | undefined>,
  contract: NativeInteractionCommandContract,
): ParsedInteractionResult | undefined {
  const interaction = recordValue(payload)
  const data = recordValue(interaction?.data)
  const interactionType = interaction?.type
  if (
    interactionType === INTERACTION_TYPE_MESSAGE_COMPONENT
    && !isManagedRequestButtonCustomId(data?.custom_id)
  ) return undefined
  const interactionId = snowflake(interaction?.id)
  const guildId = snowflake(interaction?.guild_id)
  const channelId = snowflake(interaction?.channel_id)
  const token = interaction?.token
  const member = recordValue(interaction?.member)
  const user = recordValue(member?.user)
  const userId = snowflake(user?.id)
  const owners = recordValue(interaction?.authorizing_integration_owners)
  if (
    !interactionId
    || interaction?.application_id !== applicationId
    || ![
      INTERACTION_TYPE_APPLICATION_COMMAND,
      INTERACTION_TYPE_MESSAGE_COMPONENT,
    ].includes(interactionType as number)
    || interaction?.version !== 1
    || interaction?.context !== INTERACTION_CONTEXT_GUILD
    || !guildId
    || !channelId
    || !userId
    || (user?.bot !== undefined && user.bot !== false)
    || typeof token !== "string"
    || !INTERACTION_TOKEN_PATTERN.test(token)
    || owners?.["0"] !== guildId
  ) return undefined
  const managed = commandByGuild.get(guildId)
  if (interactionType === INTERACTION_TYPE_MESSAGE_COMPONENT) {
    const customId = typeof data?.custom_id === "string" ? data.custom_id : ""
    const source = data?.component_type === COMPONENT_TYPE_BUTTON
      ? parseRequestButtonSourceMessage(
          interaction?.message,
          applicationId,
          botId,
          guildId,
          channelId,
          customId,
          requestButtonKey,
        )
      : undefined
    const parsed: ParsedInteraction = {
      channelId,
      commandId: null,
      commandVersion: null,
      guildId,
      interactionId,
      request: source?.label ?? "",
      requestButtonCustomId: customId,
      requestButtonIndex: source?.index ?? null,
      requestButtonStyle: source?.style ?? null,
      source: "request-button",
      sourceMessageId: source?.messageId ?? null,
      token,
      userId,
    }
    return source
      ? { interaction: parsed, rejection: null }
      : {
          interaction: parsed,
          rejection: {
            category: "payload-invalid",
            content: STATIC_REQUEST_BUTTON_VALIDATION_RESPONSE,
          },
        }
  }

  const commandId = snowflake(data?.id)
  const options = data?.options
  const option = Array.isArray(options) && options.length === 1
    ? recordValue(options[0])
    : undefined
  const request = option?.value
  if (
    !commandId
    || !managed
    || managed.id !== commandId
    || data?.type !== APPLICATION_COMMAND_TYPE_CHAT_INPUT
    || data?.name !== contract.name
    || (data.guild_id !== undefined && data.guild_id !== guildId)
  ) return undefined
  const parsed: ParsedInteraction = {
    channelId,
    commandId,
    commandVersion: managed.version,
    guildId,
    interactionId,
    request: typeof request === "string" ? request : "",
    requestButtonCustomId: null,
    requestButtonIndex: null,
    requestButtonStyle: null,
    source: "command",
    sourceMessageId: null,
    token,
    userId,
  }
  const memberPermissions = permissionBits(member?.permissions)
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
    | "channelId"
    | "guildId"
    | "interactionId"
    | "reference"
    | "requestButtonIndex"
    | "requestButtonStyle"
    | "source"
    | "sourceMessageId"
    | "userId"
  >
  error?: string | null
  responseStage?: NativeInteractionActivity["responseStage"]
  sequence?: number
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
    requestButtonIndex: options.entry.requestButtonIndex,
    requestButtonStyle: options.entry.requestButtonStyle,
    responseStage: options.responseStage ?? "initial",
    schemaVersion: SCHEMA_VERSION,
    sequence: options.sequence ?? 0,
    status: options.status,
    source: options.entry.source,
    sourceMessageId: options.entry.sourceMessageId,
    timestamp: options.timestamp,
    userId: options.entry.userId,
  }
}

function pendingInteraction(entry: StoredInteraction): PendingNativeInteraction {
  return {
    channelId: entry.channelId,
    commandId: entry.commandId,
    commandVersion: entry.commandVersion,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    guildId: entry.guildId,
    interactionId: entry.interactionId,
    reference: entry.reference,
    request: entry.request,
    requestButtonIndex: entry.requestButtonIndex,
    requestButtonStyle: entry.requestButtonStyle,
    schemaVersion: entry.schemaVersion,
    source: entry.source,
    sourceMessageId: entry.sourceMessageId,
    userId: entry.userId,
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
  readonly #continuations = new Map<string, StoredContinuation>()
  #continuationsExpired = 0
  readonly #contract: NativeInteractionCommandContract
  #expired = 0
  #followups = 0
  readonly #inFlight = new Map<
    string,
    StoredContinuation | StoredInteraction
  >()
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
  readonly #randomContinuationReference: () => string
  readonly #randomReference: () => string
  readonly #requestButtonKey: Uint8Array
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
    if (!(options.requestButtonKey instanceof Uint8Array)
      || options.requestButtonKey.byteLength < 16) {
      throw new RangeError("Discord native Interaction request-button key is invalid")
    }
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
    this.#randomContinuationReference = options.randomContinuationReference
      || (() => `icref_${randomBytes(16).toString("hex")}`)
    this.#randomReference = options.randomReference
      || (() => `iref_${randomBytes(16).toString("hex")}`)
    this.#requestButtonKey = new Uint8Array(options.requestButtonKey)
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
        maximumFollowups: NATIVE_INTERACTION_DEFAULTS.maximumFollowups,
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
      continuations: {
        count: this.#continuations.size,
      },
      phase: this.#phase,
      schemaVersion: SCHEMA_VERSION,
      totals: {
        accepted: this.#accepted,
        continuationsExpired: this.#continuationsExpired,
        expired: this.#expired,
        followups: this.#followups,
        rejected: this.#rejected,
        responded: this.#responded,
        uncertain: this.#uncertain,
      },
    }
  }

  async getRequestButtonReadiness(
    guildId: string,
  ): Promise<NativeInteractionRequestButtonReadiness> {
    assertSnowflake(guildId, "Discord request-button readiness guild ID")
    let command = this.#commandByGuild.get(guildId)
    let gatewayDeliveryVerified = false
    if (
      this.#phase === "ready"
      && !this.#closed
      && this.#commandByGuild.has(guildId)
    ) {
      let evidenceUnavailable = false
      let application: DiscordApplication | undefined
      let bot: DiscordUser | undefined
      let rawInventory: unknown
      try {
        ;[application, bot, rawInventory] = await Promise.all([
          this.#client.getCurrentApplication({
            signal: this.#lifecycleAbortController.signal,
          }),
          this.#client.getCurrentUser({
            signal: this.#lifecycleAbortController.signal,
          }),
          this.#client.listGuildApplicationCommands(
            this.#applicationId,
            guildId,
            { signal: this.#lifecycleAbortController.signal },
          ),
        ])
      } catch {
        evidenceUnavailable = true
      }
      if (this.#phase !== "ready" || this.#closed) {
        command = undefined
      } else if (evidenceUnavailable) {
        command = undefined
        this.#setError("validation-evidence-unavailable")
      } else {
        const identityError = ingressIdentityError(
          application,
          bot,
          this.#applicationId,
          this.#botId,
        )
        if (identityError) {
          command = undefined
          this.#setError(identityError)
        } else {
          gatewayDeliveryVerified = true
        }
        const inventory = validatedCommandInventory(
          rawInventory,
          this.#applicationId,
          guildId,
        )
        if (!identityError && !inventory) {
          command = undefined
          this.#commandByGuild.set(guildId, undefined)
          this.#setError("command-inventory-invalid")
        }
        if (!identityError && inventory) {
          const matches = inventory.filter((candidate) => (
            candidate.type === APPLICATION_COMMAND_TYPE_CHAT_INPUT
            && candidate.name === this.#commandName
          ))
          const exact = matches.length === 1
            ? exactNativeInteractionCommand(
                matches[0],
                this.#applicationId,
                guildId,
                this.#contract,
              )
            : undefined
          if (exact) {
            command = exact
            this.#commandByGuild.set(guildId, exact)
          } else {
            command = undefined
            this.#commandByGuild.set(guildId, undefined)
            this.#setError("command-contract-mismatch")
          }
        }
      }
    }
    const ready = this.#phase === "ready"
      && gatewayDeliveryVerified
      && command !== undefined
    return {
      commandId: command?.id ?? null,
      commandVersion: command?.version ?? null,
      gatewayDelivery: ready ? "verified" : null,
      guildId,
      phase: this.#phase,
      ready,
      schemaVersion: SCHEMA_VERSION,
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

  #activeCount(): number {
    return this.#pending.size + this.#continuations.size + this.#inFlight.size
  }

  #userActive(userId: string): number {
    let count = 0
    for (const entry of this.#pending.values()) {
      if (entry.userId === userId) count += 1
    }
    for (const entry of this.#continuations.values()) {
      if (entry.userId === userId) count += 1
    }
    for (const entry of this.#inFlight.values()) {
      if (entry.userId === userId) count += 1
    }
    return count
  }

  async #appendActivity(
    entry: Pick<
      StoredInteraction,
      | "channelId"
      | "guildId"
      | "interactionId"
      | "reference"
      | "requestButtonIndex"
      | "requestButtonStyle"
      | "source"
      | "sourceMessageId"
      | "userId"
    >,
    status: NativeInteractionActivityStatus,
    error: string | null = null,
    responseStage: NativeInteractionActivity["responseStage"] = "initial",
    sequence = 0,
  ): Promise<void> {
    await this.#activityStore.append(activityEntry({
      activityId: this.#randomId(),
      entry,
      error,
      responseStage,
      sequence,
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
      this.#botId,
      this.#requestButtonKey,
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
      this.#activeCount() >= this.#maximumPending
      || this.#userActive(interaction.userId) >= NATIVE_INTERACTION_DEFAULTS.pendingPerUser
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
    let application: DiscordApplication | undefined
    let bot: DiscordUser | undefined
    let channel: DiscordChannel | undefined
    let inventory: DiscordApplicationCommand[] | undefined
    let sourceMessage: DiscordMessage | undefined
    try {
      ;[application, bot, channel, inventory, sourceMessage] = await Promise.all([
        this.#client.getCurrentApplication({
          signal: this.#lifecycleAbortController.signal,
        }),
        this.#client.getCurrentUser({
          signal: this.#lifecycleAbortController.signal,
        }),
        this.#client.getChannel(interaction.channelId, {
          signal: this.#lifecycleAbortController.signal,
        }),
        this.#client.listGuildApplicationCommands(
          this.#applicationId,
          interaction.guildId,
          { signal: this.#lifecycleAbortController.signal },
        ),
        interaction.source === "request-button"
          && interaction.sourceMessageId !== null
          ? this.#client.getMessage(
              interaction.channelId,
              interaction.sourceMessageId,
              { signal: this.#lifecycleAbortController.signal },
            )
          : Promise.resolve(undefined),
      ])
    } catch {
      category = "validation-evidence-unavailable"
    }
    if (this.#closed || this.#pending.get(reference) !== entry) return
    if (!category) {
      category = ingressIdentityError(
        application,
        bot,
        this.#applicationId,
        this.#botId,
      )
    }
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
          || (
            interaction.source === "command"
            && exact.id !== interaction.commandId
          )
        ) {
          category = "command-contract-mismatch"
        } else {
          this.#commandByGuild.set(interaction.guildId, exact)
          if (interaction.source === "command") entry.commandVersion = exact.version
        }
      }
    }
    if (!category && interaction.source === "request-button") {
      const source = interaction.requestButtonCustomId === null
        ? undefined
        : parseRequestButtonSourceMessage(
            sourceMessage,
            this.#applicationId,
            this.#botId,
            interaction.guildId,
            interaction.channelId,
            interaction.requestButtonCustomId,
            this.#requestButtonKey,
          )
      if (
        !source
        || source.messageId !== interaction.sourceMessageId
        || source.index !== interaction.requestButtonIndex
        || source.style !== interaction.requestButtonStyle
        || source.label !== interaction.request
      ) {
        category = "request-button-evidence-invalid"
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
          interaction.source === "request-button"
            ? STATIC_REQUEST_BUTTON_VALIDATION_RESPONSE
            : STATIC_VALIDATION_RESPONSE,
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
      .map(pendingInteraction)
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

  #continuationResult(
    entry: StoredContinuation,
  ): NativeInteractionContinuationResult {
    return {
      expiresAt: entry.expiresAt,
      followupsRemaining: entry.followupsRemaining,
      reference: entry.reference,
    }
  }

  async #expireContinuation(reference: string): Promise<void> {
    const entry = this.#continuations.get(reference)
    if (!entry) return
    this.#continuations.delete(reference)
    if (entry.timer !== undefined) this.#scheduler.clearTimeout(entry.timer)
    entry.ready = false
    entry.timer = undefined
    this.#continuationsExpired += 1
    this.#emit("continuations")
    this.#emit("status")
    try {
      await this.#appendActivity(
        entry,
        "continuation-expired",
        null,
        "continuation",
        entry.followupsCompleted,
      )
    } catch {
      this.#setError("activity-unavailable")
    }
  }

  async #openContinuation(
    source: StoredContinuation | StoredInteraction,
    followupsCompleted: number,
  ): Promise<StoredContinuation | null> {
    if (
      this.#closed
      || this.#phase !== "ready"
      || followupsCompleted >= NATIVE_INTERACTION_DEFAULTS.maximumFollowups
      || Date.parse(source.expiresAt) <= this.#now().getTime()
    ) {
      return null
    }
    const reference = this.#randomContinuationReference()
    if (
      !INTERACTION_CONTINUATION_REFERENCE_PATTERN.test(reference)
      || reference === source.reference
      || this.#continuations.has(reference)
      || this.#pending.has(reference)
      || this.#inFlight.has(reference)
    ) {
      this.#setError("continuation-reference-unavailable")
      throw new Error("Discord native Interaction continuation reference is unavailable")
    }
    const entry: StoredContinuation = {
      channelId: source.channelId,
      commandId: source.commandId,
      commandVersion: source.commandVersion,
      createdAt: source.createdAt,
      expiresAt: source.expiresAt,
      followupsCompleted,
      followupsRemaining: NATIVE_INTERACTION_DEFAULTS.maximumFollowups - followupsCompleted,
      guildId: source.guildId,
      interactionId: source.interactionId,
      openedAt: this.#now().toISOString(),
      ready: false,
      reference,
      requestButtonIndex: source.requestButtonIndex,
      requestButtonStyle: source.requestButtonStyle,
      schemaVersion: SCHEMA_VERSION,
      source: source.source,
      sourceMessageId: source.sourceMessageId,
      timer: undefined,
      token: source.token,
      userId: source.userId,
    }
    try {
      await this.#appendActivity(
        entry,
        "continuation-opened",
        null,
        "continuation",
        followupsCompleted,
      )
    } catch (error) {
      this.#setError("activity-unavailable")
      throw error
    }
    if (
      this.#closed
      || this.#phase !== "ready"
      || Date.parse(entry.expiresAt) <= this.#now().getTime()
    ) {
      this.#continuationsExpired += 1
      try {
        await this.#appendActivity(
          entry,
          "continuation-expired",
          null,
          "continuation",
          followupsCompleted,
        )
      } catch {
        this.#setError("activity-unavailable")
      }
      this.#emit("status")
      return null
    }
    entry.ready = true
    entry.timer = this.#scheduler.setTimeout(() => {
      void this.#expireContinuation(reference)
    }, Date.parse(entry.expiresAt) - this.#now().getTime())
    this.#continuations.set(reference, entry)
    this.#emit("continuations")
    this.#emit("status")
    return entry
  }

  async listContinuations(): Promise<NativeInteractionContinuationList> {
    const now = this.#now().getTime()
    const expired = [...this.#continuations.values()]
      .filter((entry) => Date.parse(entry.expiresAt) <= now)
      .map(({ reference }) => reference)
    await Promise.all(expired.map((reference) => this.#expireContinuation(reference)))
    const continuations = [...this.#continuations.values()]
      .filter(({ ready }) => ready)
      .sort((left, right) => left.openedAt.localeCompare(right.openedAt))
      .map((entry): NativeInteractionContinuation => ({
        channelId: entry.channelId,
        commandId: entry.commandId,
        commandVersion: entry.commandVersion,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        followupsCompleted: entry.followupsCompleted,
        followupsRemaining: entry.followupsRemaining,
        guildId: entry.guildId,
        interactionId: entry.interactionId,
        openedAt: entry.openedAt,
        reference: entry.reference,
        requestButtonIndex: entry.requestButtonIndex,
        requestButtonStyle: entry.requestButtonStyle,
        schemaVersion: entry.schemaVersion,
        source: entry.source,
        sourceMessageId: entry.sourceMessageId,
        userId: entry.userId,
      }))
    return {
      continuations,
      page: {
        capacity: this.#maximumPending,
        returned: continuations.length,
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
    options: NativeInteractionResponseOptions = {},
  ): Promise<NativeInteractionResponseResult> {
    const { keepOpen = false, ...requestOptions } = options
    if (typeof keepOpen !== "boolean") {
      throw new RangeError("Discord native Interaction keep-open choice is invalid")
    }
    if (!INTERACTION_REFERENCE_PATTERN.test(reference)) {
      throw new RangeError("Discord native Interaction reference is invalid")
    }
    assertNativeInteractionResponse(response)
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
    this.#inFlight.set(reference, entry)
    this.#emit("pending")
    this.#emit("status")

    let message: DiscordMessage
    try {
      message = await this.#client.editOriginalInteractionResponse(
        this.#applicationId,
        entry.token,
        response,
        requestOptions,
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
      this.#inFlight.delete(reference)
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
      this.#inFlight.delete(reference)
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
    let continuation: StoredContinuation | null = null
    if (keepOpen) {
      try {
        continuation = await this.#openContinuation(entry, 0)
      } catch (error) {
        this.#inFlight.delete(reference)
        throw new NativeInteractionResponseError(
          "Discord native Interaction response completed but a requested continuation could not be opened",
          {
            interactionId: entry.interactionId,
            reference,
            responseMessageId: message.id,
            schemaVersion: SCHEMA_VERSION,
            status: "completed-continuation-unavailable",
          },
          { cause: error },
        )
      }
    }
    this.#inFlight.delete(reference)
    this.#emit("status")
    return {
      channelId: entry.channelId,
      continuation: continuation ? this.#continuationResult(continuation) : null,
      guildId: entry.guildId,
      interactionId: entry.interactionId,
      reference,
      responseMessageId: message.id,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
    }
  }

  async followup(
    reference: string,
    response: string,
    options: NativeInteractionResponseOptions = {},
  ): Promise<NativeInteractionFollowupResult> {
    const { keepOpen = false, ...requestOptions } = options
    if (typeof keepOpen !== "boolean") {
      throw new RangeError("Discord native Interaction keep-open choice is invalid")
    }
    if (!INTERACTION_CONTINUATION_REFERENCE_PATTERN.test(reference)) {
      throw new RangeError("Discord native Interaction continuation reference is invalid")
    }
    assertNativeInteractionResponse(response)
    const entry = this.#continuations.get(reference)
    if (!entry || !entry.ready) {
      throw new RangeError(
        "Discord native Interaction continuation reference is unavailable or expired",
      )
    }
    if (Date.parse(entry.expiresAt) <= this.#now().getTime()) {
      await this.#expireContinuation(reference)
      throw new RangeError(
        "Discord native Interaction continuation reference is unavailable or expired",
      )
    }
    const sequence = entry.followupsCompleted + 1
    if (sequence > NATIVE_INTERACTION_DEFAULTS.maximumFollowups) {
      await this.#expireContinuation(reference)
      throw new RangeError("Discord native Interaction follow-up allowance is exhausted")
    }
    entry.ready = false
    if (entry.timer !== undefined) this.#scheduler.clearTimeout(entry.timer)
    entry.timer = undefined
    try {
      await this.#appendActivity(
        entry,
        "followup-pending",
        null,
        "followup",
        sequence,
      )
    } catch (error) {
      if (this.#continuations.get(reference) === entry) {
        entry.ready = true
        const remaining = Date.parse(entry.expiresAt) - this.#now().getTime()
        if (remaining > 0) {
          entry.timer = this.#scheduler.setTimeout(() => {
            void this.#expireContinuation(reference)
          }, remaining)
        } else {
          void this.#expireContinuation(reference)
        }
      }
      this.#setError("activity-unavailable")
      throw new NativeInteractionResponseError(
        "Discord native Interaction follow-up was blocked because pending activity could not be recorded",
        {
          interactionId: entry.interactionId,
          reference,
          schemaVersion: SCHEMA_VERSION,
          status: "blocked-audit-failed",
        },
        { cause: error },
      )
    }
    if (this.#continuations.get(reference) !== entry) {
      throw new RangeError(
        "Discord native Interaction continuation expired during follow-up preparation",
      )
    }
    if (Date.parse(entry.expiresAt) <= this.#now().getTime()) {
      await this.#expireContinuation(reference)
      throw new RangeError(
        "Discord native Interaction continuation expired during follow-up preparation",
      )
    }
    this.#continuations.delete(reference)
    this.#inFlight.set(reference, entry)
    this.#emit("continuations")
    this.#emit("status")

    let message: DiscordMessage
    try {
      message = await this.#client.createInteractionFollowup(
        this.#applicationId,
        entry.token,
        response,
        requestOptions,
      )
    } catch (error) {
      this.#inFlight.delete(reference)
      const knownRejected = safeErrorCategory(error) === "response-rejected"
      const category: NativeInteractionErrorCategory = knownRejected
        ? "followup-rejected"
        : "followup-uncertain"
      if (knownRejected) this.#rejected += 1
      else this.#uncertain += 1
      this.#setError(category)
      try {
        await this.#appendActivity(
          entry,
          knownRejected ? "followup-failed" : "followup-uncertain",
          category,
          "followup",
          sequence,
        )
      } catch {
        this.#setError("activity-unavailable")
      }
      throw new NativeInteractionResponseError(
        knownRejected
          ? "Discord rejected the native Interaction follow-up before applying it"
          : "Discord native Interaction follow-up has an uncertain outcome and must not be retried",
        {
          interactionId: entry.interactionId,
          reference,
          schemaVersion: SCHEMA_VERSION,
          status: knownRejected ? "failed" : "uncertain",
        },
        { cause: error },
      )
    }
    if (!exactFollowupMessage(
      message,
      this.#applicationId,
      this.#botId,
      entry,
      response,
    )) {
      this.#inFlight.delete(reference)
      this.#uncertain += 1
      this.#setError("followup-evidence-invalid")
      try {
        await this.#appendActivity(
          entry,
          "followup-uncertain",
          "followup-evidence-invalid",
          "followup",
          sequence,
        )
      } catch {
        this.#setError("activity-unavailable")
      }
      throw new NativeInteractionResponseError(
        "Discord returned invalid native Interaction follow-up response evidence",
        {
          interactionId: entry.interactionId,
          reference,
          schemaVersion: SCHEMA_VERSION,
          status: "uncertain",
        },
      )
    }

    let readback: DiscordMessage
    try {
      readback = await this.#client.getInteractionFollowup(
        this.#applicationId,
        entry.token,
        message.id,
        requestOptions,
      )
    } catch (error) {
      this.#inFlight.delete(reference)
      this.#uncertain += 1
      this.#setError("followup-uncertain")
      try {
        await this.#appendActivity(
          entry,
          "followup-uncertain",
          "followup-uncertain",
          "followup",
          sequence,
        )
      } catch {
        this.#setError("activity-unavailable")
      }
      throw new NativeInteractionResponseError(
        "Discord native Interaction follow-up readback is unavailable, so the outcome is uncertain and must not be retried",
        {
          interactionId: entry.interactionId,
          reference,
          responseMessageId: message.id,
          schemaVersion: SCHEMA_VERSION,
          status: "uncertain",
        },
        { cause: error },
      )
    }
    if (!exactFollowupMessage(
      readback,
      this.#applicationId,
      this.#botId,
      entry,
      response,
      message.id,
    )) {
      this.#inFlight.delete(reference)
      this.#uncertain += 1
      this.#setError("followup-evidence-invalid")
      try {
        await this.#appendActivity(
          entry,
          "followup-uncertain",
          "followup-evidence-invalid",
          "followup",
          sequence,
        )
      } catch {
        this.#setError("activity-unavailable")
      }
      throw new NativeInteractionResponseError(
        "Discord returned drifting native Interaction follow-up readback evidence",
        {
          interactionId: entry.interactionId,
          reference,
          responseMessageId: message.id,
          schemaVersion: SCHEMA_VERSION,
          status: "uncertain",
        },
      )
    }

    this.#followups += 1
    try {
      await this.#appendActivity(
        entry,
        "followup-completed",
        null,
        "followup",
        sequence,
      )
    } catch (error) {
      this.#inFlight.delete(reference)
      this.#setError("activity-unavailable")
      throw new NativeInteractionResponseError(
        "Discord native Interaction follow-up completed but durable completion recording failed",
        {
          interactionId: entry.interactionId,
          reference,
          responseMessageId: message.id,
          schemaVersion: SCHEMA_VERSION,
          status: "completed-record-failed",
        },
        { cause: error },
      )
    }
    let continuation: StoredContinuation | null = null
    if (keepOpen && sequence < NATIVE_INTERACTION_DEFAULTS.maximumFollowups) {
      try {
        continuation = await this.#openContinuation(entry, sequence)
      } catch (error) {
        this.#inFlight.delete(reference)
        throw new NativeInteractionResponseError(
          "Discord native Interaction follow-up completed but a requested continuation could not be opened",
          {
            interactionId: entry.interactionId,
            reference,
            responseMessageId: message.id,
            schemaVersion: SCHEMA_VERSION,
            status: "completed-continuation-unavailable",
          },
          { cause: error },
        )
      }
    }
    this.#inFlight.delete(reference)
    this.#emit("status")
    return {
      channelId: entry.channelId,
      continuation: continuation ? this.#continuationResult(continuation) : null,
      followupsCompleted: sequence,
      guildId: entry.guildId,
      interactionId: entry.interactionId,
      reference,
      responseMessageId: message.id,
      schemaVersion: SCHEMA_VERSION,
      status: "completed",
      verification: "response-and-readback-match",
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
    for (const entry of this.#continuations.values()) {
      entry.ready = false
      if (entry.timer !== undefined) this.#scheduler.clearTimeout(entry.timer)
      entry.timer = undefined
    }
    await Promise.allSettled([...this.#ingestTasks])
    const entries = [...this.#pending.values()]
    const continuationEntries = [...this.#continuations.values()]
    this.#pending.clear()
    this.#continuations.clear()
    this.#expired += entries.length
    this.#continuationsExpired += continuationEntries.length
    this.#emit("pending")
    this.#emit("continuations")
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
    await Promise.allSettled(continuationEntries.map(async (entry) => {
      try {
        await this.#appendActivity(
          entry,
          "continuation-expired",
          null,
          "continuation",
          entry.followupsCompleted,
        )
      } catch {}
    }))
    if (entries.length > 0 || continuationEntries.length > 0) this.#emit("status")
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
      maximumFollowups: NATIVE_INTERACTION_DEFAULTS.maximumFollowups,
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
    continuations: {
      count: 0,
    },
    phase: "disabled",
    schemaVersion: SCHEMA_VERSION,
    totals: {
      accepted: 0,
      continuationsExpired: 0,
      expired: 0,
      followups: 0,
      rejected: 0,
      responded: 0,
      uncertain: 0,
    },
  }
  return {
    enabled: false,
    getRequestButtonReadiness: async (guildId) => {
      assertSnowflake(guildId, "Discord request-button readiness guild ID")
      return {
        commandId: null,
        commandVersion: null,
        gatewayDelivery: null,
        guildId,
        phase: "disabled",
        ready: false,
        schemaVersion: SCHEMA_VERSION,
      }
    },
    getStatus: () => ({ ...status }),
    listContinuations: async () => ({
      continuations: [],
      page: {
        capacity: config.nativeInteractionMaxPending,
        returned: 0,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "disabled",
    }),
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
    followup: async () => {
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
