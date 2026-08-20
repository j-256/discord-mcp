import { setTimeout as wait } from "node:timers/promises"

import {
  CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS,
  CONNECTOR_LIMITS,
  DISCORD_API_BASE_URL,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  DISCORD_MESSAGE_REFERENCE_TYPES,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_USER_AGENT,
} from "./constants.js"
import { DiscordApiError, errorMessage, redactText } from "./errors.js"
import {
  DISCORD_REST_OPERATIONS,
  type DiscordRestOperation,
} from "./observability-catalog.js"
import type {
  OperationObservation,
  OperationalErrorCategory,
  OperationalObserver,
} from "./observability.js"
import type {
  DiscordApplication,
  DiscordBan,
  DiscordChannel,
  DiscordErrorBody,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordMessageSearchIndexing,
  DiscordMessageSearchResponse,
  DiscordRole,
  DiscordThreadList,
  DiscordThreadMember,
  DiscordUser,
  MessageCursor,
  RequestOptions,
} from "./types.js"

export type FetchImplementation = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>

export type SleepImplementation = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>

export interface DiscordClientOptions {
  apiBaseUrl?: string
  fetchImplementation?: FetchImplementation
  maxAutomaticRetryWaitMs?: number
  maxRetries?: number
  observer?: Pick<OperationalObserver, "startDiscordRequest">
  requestTimeoutMs?: number
  sleep?: SleepImplementation
  token: string
}

export interface GuildPageOptions extends RequestOptions {
  after?: string
  before?: string
  limit?: number
}

export interface MessagePageOptions extends MessageCursor, RequestOptions {
  limit?: number
}

export type SearchAuthorType =
  | "-bot"
  | "-user"
  | "-webhook"
  | "bot"
  | "user"
  | "webhook"

export type SearchHasType =
  | "-embed"
  | "-file"
  | "-image"
  | "-link"
  | "-poll"
  | "-snapshot"
  | "-sound"
  | "-sticker"
  | "-video"
  | "embed"
  | "file"
  | "image"
  | "link"
  | "poll"
  | "snapshot"
  | "sound"
  | "sticker"
  | "video"

export type SearchEmbedType = "article" | "gif" | "image" | "sound" | "video"
export type SearchSortBy = "relevance" | "timestamp"
export type SearchSortOrder = "asc" | "desc"

const SEARCH_AUTHOR_TYPES: ReadonlySet<string> = new Set([
  "-bot",
  "-user",
  "-webhook",
  "bot",
  "user",
  "webhook",
])
const SEARCH_EMBED_TYPES: ReadonlySet<string> = new Set([
  "article",
  "gif",
  "image",
  "sound",
  "video",
])
const SEARCH_HAS_TYPES: ReadonlySet<string> = new Set([
  "-embed",
  "-file",
  "-image",
  "-link",
  "-poll",
  "-snapshot",
  "-sound",
  "-sticker",
  "-video",
  "embed",
  "file",
  "image",
  "link",
  "poll",
  "snapshot",
  "sound",
  "sticker",
  "video",
])
const SEARCH_SORT_BY_VALUES: ReadonlySet<string> = new Set(["relevance", "timestamp"])
const SEARCH_SORT_ORDER_VALUES: ReadonlySet<string> = new Set(["asc", "desc"])
const ISO_8601_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
const CHANNEL_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const CHANNEL_TOPIC_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u
const ROLE_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u

export interface GuildMessageSearchOptions extends RequestOptions {
  attachmentExtensions?: readonly string[]
  attachmentFilenames?: readonly string[]
  authorIds?: readonly string[]
  authorTypes?: readonly SearchAuthorType[]
  channelIds?: readonly string[]
  content?: string
  embedProviders?: readonly string[]
  embedTypes?: readonly SearchEmbedType[]
  has?: readonly SearchHasType[]
  includeNsfw?: boolean
  limit?: number
  linkHostnames?: readonly string[]
  maxId?: string
  mentionEveryone?: boolean
  mentionRoleIds?: readonly string[]
  mentionUserIds?: readonly string[]
  minId?: string
  offset?: number
  pinned?: boolean
  repliedToMessageIds?: readonly string[]
  repliedToUserIds?: readonly string[]
  slop?: number
  sortBy?: SearchSortBy
  sortOrder?: SearchSortOrder
}

export interface ArchivedThreadPageOptions extends RequestOptions {
  before?: string
  limit?: number
}

export type DiscordAllowedMentions =
  | {
    parse: readonly []
    replied_user: boolean
  }
  | {
    replied_user: boolean
    users: readonly string[]
  }

export interface CreateMessageInput {
  allowedMentions: DiscordAllowedMentions
  content: string
  nonce: string
  reply?: {
    guildId: string
    messageId: string
  }
}

export interface CreateAttachmentMessageInput {
  allowedMentions: DiscordAllowedMentions
  bytes: Uint8Array
  content?: string
  description?: string
  filename: string
  nonce: string
  reply?: {
    guildId: string
    messageId: string
  }
}

export interface CreateGuildChannelInput {
  defaultAutoArchiveDuration?: number
  name: string
  nsfw?: boolean
  parentId?: string
  rateLimitPerUser?: number
  topic?: string | null
  type: number
}

export interface CreateGuildRoleInput {
  hoist: boolean
  mentionable: boolean
  name: string
  permissions: string
  primaryColor: number
}

export interface EditMessageInput {
  allowedMentions: DiscordAllowedMentions
  content: string
}

export interface ModifyGuildMemberTimeoutInput {
  communicationDisabledUntil: string | null
}

interface RequestParameters extends RequestOptions {
  auditReason?: string
  automaticRateLimitRetry?: boolean
  body?: unknown
  multipartBody?: FormData
}

class DiscordTransportError extends Error {
  readonly operationalCategory: OperationalErrorCategory

  constructor(
    message: string,
    operationalCategory: OperationalErrorCategory,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "DiscordTransportError"
    this.operationalCategory = operationalCategory
  }
}

function finishObservation(
  observation: OperationObservation | undefined,
  completion: Parameters<OperationObservation["end"]>[0],
): void {
  try {
    observation?.end(completion)
  } catch {}
}

function requestErrorCategory(error: unknown): OperationalErrorCategory {
  if (error instanceof DiscordTransportError) return error.operationalCategory
  if (error instanceof DiscordApiError) {
    if (error.status === 429) return "discord-rate-limited"
    if (error.status >= 500) return "discord-server-error"
    return "discord-client-error"
  }
  if (error instanceof Error && error.name === "AbortError") return "cancelled"
  return "network-error"
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return wait(milliseconds, undefined, signal ? { signal } : undefined)
}

function errorBody(value: unknown): DiscordErrorBody | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as DiscordErrorBody
}

function parseJson(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function retryAfterMilliseconds(
  body: DiscordErrorBody | undefined,
  headers: Headers,
): number | undefined {
  const bodySeconds = body?.retry_after
  if (typeof bodySeconds === "number" && Number.isFinite(bodySeconds)) {
    return Math.max(0, Math.ceil(bodySeconds * 1_000))
  }
  for (const name of ["retry-after", "x-ratelimit-reset-after"]) {
    const header = headers.get(name)
    if (!header) continue
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1_000))
    const date = Date.parse(header)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  }
  return undefined
}

type QueryScalar = boolean | number | string
type QueryValue = QueryScalar | readonly QueryScalar[] | undefined

function queryString(values: Record<string, QueryValue>): string {
  const parameters = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const entry of value) parameters.append(name, String(entry))
      continue
    }
    parameters.set(name, String(value))
  }
  const query = parameters.toString()
  return query ? `?${query}` : ""
}

function assertIntegerRange(
  value: number | undefined,
  minimum: number,
  maximum: number,
  name: string,
): void {
  if (
    value !== undefined
    && (!Number.isInteger(value) || value < minimum || value > maximum)
  ) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
}

function assertBoundedLimit(
  value: number | undefined,
  maximum: number,
  name: string,
): void {
  if (
    value !== undefined
    && (!Number.isInteger(value) || value < 1 || value > maximum)
  ) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`)
  }
}

function assertBoundedArray(
  values: readonly string[] | undefined,
  maximum: number,
  name: string,
): void {
  if (!values) return
  if (values.length < 1 || values.length > maximum) {
    throw new RangeError(`${name} must contain between 1 and ${maximum} values`)
  }
  if (new Set(values).size !== values.length) {
    throw new RangeError(`${name} must not contain duplicates`)
  }
}

function assertBoundedStrings(
  values: readonly string[] | undefined,
  maximumValues: number,
  maximumLength: number,
  name: string,
): void {
  assertBoundedArray(values, maximumValues, name)
  if (values?.some((value) => value.length < 1 || value.length > maximumLength)) {
    throw new RangeError(`${name} values must contain between 1 and ${maximumLength} characters`)
  }
}

function assertAllowedValue(
  value: string | undefined,
  allowed: ReadonlySet<string>,
  name: string,
): void {
  if (value !== undefined && !allowed.has(value)) {
    throw new RangeError(`${name} is not supported by Discord`)
  }
}

function assertAllowedValues(
  values: readonly string[] | undefined,
  allowed: ReadonlySet<string>,
  name: string,
): void {
  const invalid = values?.find((value) => !allowed.has(value))
  if (invalid !== undefined) {
    throw new RangeError(`${name} contains unsupported value ${JSON.stringify(invalid)}`)
  }
}

function assertSearchSnowflake(value: string | undefined, name: string): void {
  if (value !== undefined && !DISCORD_SNOWFLAKE_PATTERN.test(value)) {
    throw new RangeError(`${name} must be a Discord snowflake`)
  }
}

function assertSearchSnowflakes(
  values: readonly string[] | undefined,
  name: string,
): void {
  if (values?.some((value) => !DISCORD_SNOWFLAKE_PATTERN.test(value))) {
    throw new RangeError(`${name} values must be Discord snowflakes`)
  }
}

function assertIsoTimestamp(value: string | undefined, name: string): void {
  if (
    value !== undefined
    && (
      !ISO_8601_TIMESTAMP_PATTERN.test(value)
      || Number.isNaN(Date.parse(value))
    )
  ) {
    throw new RangeError(`${name} must be an ISO 8601 timestamp`)
  }
}

function assertExclusiveCursors(
  values: Record<string, string | undefined>,
): void {
  const present = Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name)
  if (present.length > 1) {
    throw new RangeError(`${present.join(", ")} are mutually exclusive`)
  }
}

function assertMessageContent(content: string): void {
  if (!content.trim()) throw new RangeError("Discord message content must not be blank")
  if (content.length > DISCORD_LIMITS.messageContentCharacters) {
    throw new RangeError(
      `Discord message content must not exceed ${DISCORD_LIMITS.messageContentCharacters} characters`,
    )
  }
}

function assertAttachmentFilename(filename: string): void {
  if (
    typeof filename !== "string"
    || filename.length < 1
    || filename.length > DISCORD_LIMITS.attachmentFilenameCharacters
    || filename.trim() !== filename
    || filename === "."
    || filename === ".."
    || /[\\/\u0000-\u001F\u007F]/u.test(filename)
  ) {
    throw new RangeError("Discord attachment filename is invalid")
  }
  assertValidUnicode(filename, "Discord attachment filename")
}

function assertValidUnicode(value: string, name: string): void {
  try {
    encodeURIComponent(value)
  } catch (error) {
    throw new RangeError(`${name} contains invalid Unicode`, { cause: error })
  }
}

function assertCreateGuildChannelInput(input: CreateGuildChannelInput): void {
  const supportedTypes: ReadonlySet<number> = new Set([
    DISCORD_CHANNEL_TYPES.category,
    DISCORD_CHANNEL_TYPES.forum,
    DISCORD_CHANNEL_TYPES.text,
  ])
  if (!supportedTypes.has(input.type)) {
    throw new RangeError("Discord channel creation type is not supported")
  }
  if (
    typeof input.name !== "string"
    || input.name.length < 1
    || input.name.length > DISCORD_LIMITS.channelNameCharacters
    || input.name.trim() !== input.name
    || CHANNEL_NAME_CONTROL_PATTERN.test(input.name)
  ) {
    throw new RangeError(
      `Discord channel name must contain 1-${DISCORD_LIMITS.channelNameCharacters} characters without surrounding whitespace or controls`,
    )
  }
  assertValidUnicode(input.name, "Discord channel name")
  if (
    input.parentId !== undefined
    && (
      typeof input.parentId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(input.parentId)
    )
  ) {
    throw new RangeError("Discord channel parent ID must be a snowflake")
  }
  if (input.topic !== undefined && input.topic !== null) {
    if (
      typeof input.topic !== "string"
      || !input.topic.trim()
      || input.topic.length > DISCORD_LIMITS.channelTopicCharacters
      || CHANNEL_TOPIC_CONTROL_PATTERN.test(input.topic)
    ) {
      throw new RangeError(
        `Discord channel topic must be nonblank and at most ${DISCORD_LIMITS.channelTopicCharacters} characters without unsupported controls`,
      )
    }
    assertValidUnicode(input.topic, "Discord channel topic")
  }
  if (input.nsfw !== undefined && typeof input.nsfw !== "boolean") {
    throw new RangeError("Discord channel NSFW setting must be a boolean")
  }
  assertIntegerRange(
    input.rateLimitPerUser,
    0,
    DISCORD_LIMITS.channelRateLimitSeconds,
    "Discord channel slowmode seconds",
  )
  if (
    input.defaultAutoArchiveDuration !== undefined
    && !(CHANNEL_DEFAULT_AUTO_ARCHIVE_DURATIONS as readonly number[])
      .includes(input.defaultAutoArchiveDuration)
  ) {
    throw new RangeError("Discord channel default auto-archive duration is not supported")
  }
  if (
    input.type === DISCORD_CHANNEL_TYPES.category
    && (
      input.defaultAutoArchiveDuration !== undefined
      || input.nsfw !== undefined
      || input.parentId !== undefined
      || input.rateLimitPerUser !== undefined
      || input.topic !== undefined
    )
  ) {
    throw new RangeError("Discord category creation does not accept channel-specific settings")
  }
}

function assertCreateGuildRoleInput(input: CreateGuildRoleInput): void {
  if (
    typeof input.name !== "string"
    || input.name.length < 1
    || input.name.length > DISCORD_LIMITS.roleNameCharacters
    || input.name.trim() !== input.name
    || ROLE_NAME_CONTROL_PATTERN.test(input.name)
  ) {
    throw new RangeError(
      `Discord role name must contain 1-${DISCORD_LIMITS.roleNameCharacters} characters without surrounding whitespace or controls`,
    )
  }
  assertValidUnicode(input.name, "Discord role name")
  if (
    typeof input.permissions !== "string"
    || !/^(0|[1-9][0-9]*)$/.test(input.permissions)
  ) {
    throw new RangeError("Discord role permissions must be a canonical decimal bitfield")
  }
  if (typeof input.primaryColor !== "number") {
    throw new RangeError("Discord role primary color must be a number")
  }
  assertIntegerRange(
    input.primaryColor,
    0,
    DISCORD_LIMITS.roleColor,
    "Discord role primary color",
  )
  if (typeof input.hoist !== "boolean") {
    throw new RangeError("Discord role hoist setting must be a boolean")
  }
  if (typeof input.mentionable !== "boolean") {
    throw new RangeError("Discord role mentionable setting must be a boolean")
  }
}

export function encodeDiscordAuditReason(auditReason: string): string {
  if (!auditReason.trim()) {
    throw new RangeError("Discord audit reason must not be blank")
  }
  let encoded: string
  try {
    encoded = encodeURIComponent(auditReason)
  } catch (error) {
    throw new RangeError("Discord audit reason contains invalid Unicode", { cause: error })
  }
  if (encoded.length > DISCORD_LIMITS.auditReasonEncodedCharacters) {
    throw new RangeError(
      `Discord audit reason must not exceed ${DISCORD_LIMITS.auditReasonEncodedCharacters} URL-encoded characters`,
    )
  }
  return encoded
}

function assertAllowedMentions(allowedMentions: DiscordAllowedMentions): void {
  if ("parse" in allowedMentions) {
    if (allowedMentions.parse.length !== 0) {
      throw new RangeError("Discord allowed mention parsing must be empty")
    }
    return
  }
  assertBoundedArray(
    allowedMentions.users,
    DISCORD_LIMITS.allowedMentionUsers,
    "Discord allowed mention user IDs",
  )
  assertSearchSnowflakes(
    allowedMentions.users,
    "Discord allowed mention user IDs",
  )
  if (new Set(allowedMentions.users).size !== allowedMentions.users.length) {
    throw new RangeError("Discord allowed mention user IDs must be unique")
  }
}

export class DiscordClient {
  readonly #apiBaseUrl: string
  readonly #fetch: FetchImplementation
  readonly #maxAutomaticRetryWaitMs: number
  readonly #maxRetries: number
  readonly #observer: Pick<OperationalObserver, "startDiscordRequest"> | undefined
  readonly #requestTimeoutMs: number
  readonly #sleep: SleepImplementation
  readonly #token: string

  constructor(options: DiscordClientOptions) {
    this.#apiBaseUrl = (options.apiBaseUrl || DISCORD_API_BASE_URL).replace(/\/+$/, "")
    this.#fetch = options.fetchImplementation || globalThis.fetch
    this.#maxAutomaticRetryWaitMs = options.maxAutomaticRetryWaitMs
      ?? DISCORD_LIMITS.automaticRetryWaitMs
    this.#maxRetries = options.maxRetries ?? DISCORD_LIMITS.retries
    this.#observer = options.observer
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DISCORD_LIMITS.requestTimeoutMs
    this.#sleep = options.sleep || defaultSleep
    this.#token = options.token
  }

  async #request<T>(
    operation: DiscordRestOperation,
    route: string,
    parameters: RequestParameters = {},
  ): Promise<T> {
    const method = DISCORD_REST_OPERATIONS[operation]
    const url = new URL(`${this.#apiBaseUrl}${route}`)
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bot ${this.#token}`,
      "User-Agent": DISCORD_USER_AGENT,
    })
    if (parameters.body !== undefined && parameters.multipartBody !== undefined) {
      throw new TypeError("Discord request cannot contain JSON and multipart bodies")
    }
    let body: RequestInit["body"]
    if (parameters.body !== undefined) {
      body = JSON.stringify(parameters.body)
      headers.set("Content-Type", "application/json")
    } else if (parameters.multipartBody !== undefined) {
      body = parameters.multipartBody
    }
    if (parameters.auditReason !== undefined) {
      headers.set("X-Audit-Log-Reason", encodeDiscordAuditReason(parameters.auditReason))
    }
    let observation: OperationObservation | undefined
    try {
      observation = this.#observer?.startDiscordRequest(operation)
    } catch {}

    const execute = async (): Promise<T> => {
      for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
        const timeoutSignal = AbortSignal.timeout(this.#requestTimeoutMs)
        const signal = parameters.signal
          ? AbortSignal.any([parameters.signal, timeoutSignal])
          : timeoutSignal
        let response: Response
        try {
          const requestInit: RequestInit = {
            headers,
            method,
            redirect: "error",
            signal,
          }
          if (body !== undefined) requestInit.body = body
          response = await this.#fetch(url, requestInit)
        } catch (error) {
          const category = timeoutSignal.aborted && !parameters.signal?.aborted
            ? "timeout"
            : parameters.signal?.aborted
              ? "cancelled"
              : "network-error"
          const message = redactText(errorMessage(error), [this.#token])
          throw new DiscordTransportError(
            `Discord API ${method} ${route} failed: ${message}`,
            category,
            { cause: error },
          )
        }

        const responseText = await response.text()
        const parsedBody = parseJson(responseText)
        const discordError = errorBody(parsedBody)
        const retryAfterMs = response.status === 429
          ? retryAfterMilliseconds(discordError, response.headers)
          : undefined

        if (
          response.status === 429
          && parameters.automaticRateLimitRetry !== false
          && attempt < this.#maxRetries
          && retryAfterMs !== undefined
          && retryAfterMs <= this.#maxAutomaticRetryWaitMs
        ) {
          try {
            observation?.retry()
          } catch {}
          await this.#sleep(retryAfterMs, parameters.signal)
          continue
        }

        if (!response.ok) {
          const detail = discordError?.message || response.statusText || "request failed"
          throw new DiscordApiError({
            ...(discordError?.code !== undefined ? { code: discordError.code } : {}),
            message: redactText(
              `Discord API ${method} ${route} returned ${response.status}: ${detail}`,
              [this.#token],
            ),
            method,
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            route,
            status: response.status,
          })
        }

        return parsedBody as T
      }
      throw new DiscordTransportError(
        `Discord API ${method} ${route} exhausted retries`,
        "network-error",
      )
    }

    try {
      const result = observation ? await observation.run(execute) : await execute()
      finishObservation(observation, { outcome: "ok" })
      return result
    } catch (error) {
      finishObservation(observation, {
        errorCategory: requestErrorCategory(error),
        outcome: "error",
        ...(error instanceof DiscordApiError ? { statusCode: error.status } : {}),
      })
      throw error
    }
  }

  getCurrentApplication(options: RequestOptions = {}): Promise<DiscordApplication> {
    return this.#request("get_current_application", "/oauth2/applications/@me", options)
  }

  getCurrentUser(options: RequestOptions = {}): Promise<DiscordUser> {
    return this.#request("get_current_user", "/users/@me", options)
  }

  getUser(userId: string, options: RequestOptions = {}): Promise<DiscordUser> {
    return this.#request("get_user", `/users/${userId}`, options)
  }

  listCurrentUserGuilds(options: GuildPageOptions = {}): Promise<DiscordGuild[]> {
    assertBoundedLimit(
      options.limit,
      DISCORD_LIMITS.currentUserGuilds,
      "Discord guild page limit",
    )
    assertExclusiveCursors({ after: options.after, before: options.before })
    const route = `/users/@me/guilds${queryString({
      after: options.after,
      before: options.before,
      limit: options.limit,
      with_counts: false,
    })}`
    return this.#request("list_current_user_guilds", route, options)
  }

  getGuildChannels(guildId: string, options: RequestOptions = {}): Promise<DiscordChannel[]> {
    return this.#request("get_guild_channels", `/guilds/${guildId}/channels`, options)
  }

  createGuildChannel(
    guildId: string,
    input: CreateGuildChannelInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordChannel> {
    if (
      typeof guildId !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(guildId)
    ) {
      throw new RangeError("Discord channel creation guild ID must be a snowflake")
    }
    assertCreateGuildChannelInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord channel creation audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("create_guild_channel", `/guilds/${guildId}/channels`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: {
        ...(input.defaultAutoArchiveDuration !== undefined
          ? { default_auto_archive_duration: input.defaultAutoArchiveDuration }
          : {}),
        name: input.name,
        ...(input.nsfw !== undefined ? { nsfw: input.nsfw } : {}),
        ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
        ...(input.rateLimitPerUser !== undefined
          ? { rate_limit_per_user: input.rateLimitPerUser }
          : {}),
        ...(input.topic !== undefined ? { topic: input.topic } : {}),
        type: input.type,
      },
    })
  }

  getGuild(guildId: string, options: RequestOptions = {}): Promise<DiscordGuild> {
    return this.#request("get_guild", `/guilds/${guildId}`, options)
  }

  getGuildMember(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMember> {
    return this.#request("get_guild_member", `/guilds/${guildId}/members/${userId}`, options)
  }

  getGuildRoles(guildId: string, options: RequestOptions = {}): Promise<DiscordRole[]> {
    return this.#request("get_guild_roles", `/guilds/${guildId}/roles`, options)
  }

  getGuildRole(
    guildId: string,
    roleId: string,
    options: RequestOptions = {},
  ): Promise<DiscordRole> {
    if (
      !DISCORD_SNOWFLAKE_PATTERN.test(guildId)
      || !DISCORD_SNOWFLAKE_PATTERN.test(roleId)
    ) {
      throw new RangeError("Discord exact role lookup requires snowflake IDs")
    }
    return this.#request(
      "get_guild_role",
      `/guilds/${guildId}/roles/${roleId}`,
      options,
    )
  }

  createGuildRole(
    guildId: string,
    input: CreateGuildRoleInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordRole> {
    if (!DISCORD_SNOWFLAKE_PATTERN.test(guildId)) {
      throw new RangeError("Discord role creation guild ID must be a snowflake")
    }
    assertCreateGuildRoleInput(input)
    if (typeof auditReason !== "string") {
      throw new RangeError("Discord role creation audit reason must be a string")
    }
    encodeDiscordAuditReason(auditReason)
    return this.#request("create_guild_role", `/guilds/${guildId}/roles`, {
      ...options,
      auditReason,
      automaticRateLimitRetry: false,
      body: {
        colors: {
          primary_color: input.primaryColor,
          secondary_color: null,
          tertiary_color: null,
        },
        hoist: input.hoist,
        mentionable: input.mentionable,
        name: input.name,
        permissions: input.permissions,
      },
    })
  }

  getGuildBan(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<DiscordBan> {
    return this.#request("get_guild_ban", `/guilds/${guildId}/bans/${userId}`, options)
  }

  modifyGuildMemberTimeout(
    guildId: string,
    userId: string,
    input: ModifyGuildMemberTimeoutInput,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMember> {
    if (input.communicationDisabledUntil !== null) {
      assertIsoTimestamp(
        input.communicationDisabledUntil,
        "Discord member timeout expiration",
      )
    }
    return this.#request("modify_guild_member_timeout", `/guilds/${guildId}/members/${userId}`, {
      ...options,
      auditReason,
      body: {
        communication_disabled_until: input.communicationDisabledUntil,
      },
    })
  }

  async removeGuildMember(
    guildId: string,
    userId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>("remove_guild_member", `/guilds/${guildId}/members/${userId}`, {
      ...options,
      auditReason,
    })
  }

  async createGuildBan(
    guildId: string,
    userId: string,
    deleteMessageSeconds: number,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    assertIntegerRange(
      deleteMessageSeconds,
      0,
      DISCORD_LIMITS.banDeleteMessageSeconds,
      "Discord ban message-history deletion seconds",
    )
    await this.#request<void>("create_guild_ban", `/guilds/${guildId}/bans/${userId}`, {
      ...options,
      auditReason,
      body: { delete_message_seconds: deleteMessageSeconds },
    })
  }

  async removeGuildBan(
    guildId: string,
    userId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>("remove_guild_ban", `/guilds/${guildId}/bans/${userId}`, {
      ...options,
      auditReason,
    })
  }

  getChannel(channelId: string, options: RequestOptions = {}): Promise<DiscordChannel> {
    return this.#request("get_channel", `/channels/${channelId}`, options)
  }

  getThreadMember(
    threadId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<DiscordThreadMember> {
    if (
      !DISCORD_SNOWFLAKE_PATTERN.test(threadId)
      || !DISCORD_SNOWFLAKE_PATTERN.test(userId)
    ) {
      throw new RangeError("Discord exact thread-member lookup requires snowflake IDs")
    }
    return this.#request(
      "get_thread_member",
      `/channels/${threadId}/thread-members/${userId}?with_member=false`,
      options,
    )
  }

  listMessages(channelId: string, options: MessagePageOptions = {}): Promise<DiscordMessage[]> {
    assertBoundedLimit(
      options.limit,
      DISCORD_LIMITS.channelMessages,
      "Discord message page limit",
    )
    assertExclusiveCursors({
      after: options.after,
      around: options.around,
      before: options.before,
    })
    const route = `/channels/${channelId}/messages${queryString({
      after: options.after,
      around: options.around,
      before: options.before,
      limit: options.limit,
    })}`
    return this.#request("list_messages", route, options)
  }

  getMessage(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    return this.#request("get_message", `/channels/${channelId}/messages/${messageId}`, options)
  }

  createMessage(
    channelId: string,
    input: CreateMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertMessageContent(input.content)
    if (!input.nonce || input.nonce.length > DISCORD_LIMITS.messageNonceCharacters) {
      throw new RangeError(
        `Discord message nonce must contain between 1 and ${DISCORD_LIMITS.messageNonceCharacters} characters`,
      )
    }
    assertAllowedMentions(input.allowedMentions)
    const messageReference = input.reply
      ? {
          channel_id: channelId,
          fail_if_not_exists: true,
          guild_id: input.reply.guildId,
          message_id: input.reply.messageId,
          type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
        }
      : undefined
    return this.#request("create_message", `/channels/${channelId}/messages`, {
      ...options,
      body: {
        allowed_mentions: input.allowedMentions,
        content: input.content,
        enforce_nonce: true,
        ...(messageReference ? { message_reference: messageReference } : {}),
        nonce: input.nonce,
      },
    })
  }

  createAttachmentMessage(
    channelId: string,
    input: CreateAttachmentMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertSearchSnowflake(channelId, "Discord attachment channel ID")
    if (input.content !== undefined) assertMessageContent(input.content)
    if (
      !(input.bytes instanceof Uint8Array)
      || input.bytes.byteLength < 1
      || input.bytes.byteLength > DISCORD_LIMITS.attachmentBytes
    ) {
      throw new RangeError(
        `Discord attachment bytes must contain between 1 and ${DISCORD_LIMITS.attachmentBytes} bytes`,
      )
    }
    assertAttachmentFilename(input.filename)
    if (
      input.description !== undefined
      && (
        !input.description.trim()
        || input.description.length > DISCORD_LIMITS.attachmentDescriptionCharacters
      )
    ) {
      throw new RangeError(
        `Discord attachment description must contain 1-${DISCORD_LIMITS.attachmentDescriptionCharacters} characters`,
      )
    }
    if (input.description !== undefined) {
      assertValidUnicode(input.description, "Discord attachment description")
    }
    if (!input.nonce || input.nonce.length > DISCORD_LIMITS.messageNonceCharacters) {
      throw new RangeError(
        `Discord message nonce must contain between 1 and ${DISCORD_LIMITS.messageNonceCharacters} characters`,
      )
    }
    assertAllowedMentions(input.allowedMentions)
    if (input.reply) {
      assertSearchSnowflake(input.reply.guildId, "Discord attachment reply guild ID")
      assertSearchSnowflake(input.reply.messageId, "Discord attachment reply message ID")
    }
    const messageReference = input.reply
      ? {
          channel_id: channelId,
          fail_if_not_exists: true,
          guild_id: input.reply.guildId,
          message_id: input.reply.messageId,
          type: DISCORD_MESSAGE_REFERENCE_TYPES.default,
        }
      : undefined
    const payload = {
      allowed_mentions: input.allowedMentions,
      attachments: [{
        ...(input.description !== undefined ? { description: input.description } : {}),
        filename: input.filename,
        id: "0",
      }],
      ...(input.content !== undefined ? { content: input.content } : {}),
      enforce_nonce: true,
      ...(messageReference ? { message_reference: messageReference } : {}),
      nonce: input.nonce,
    }
    const form = new FormData()
    form.set("payload_json", JSON.stringify(payload))
    form.set("files[0]", new Blob([Uint8Array.from(input.bytes)]), input.filename)
    return this.#request("create_attachment_message", `/channels/${channelId}/messages`, {
      ...options,
      automaticRateLimitRetry: false,
      multipartBody: form,
    })
  }

  editMessage(
    channelId: string,
    messageId: string,
    input: EditMessageInput,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    assertMessageContent(input.content)
    assertAllowedMentions(input.allowedMentions)
    return this.#request("edit_message", `/channels/${channelId}/messages/${messageId}`, {
      ...options,
      body: {
        allowed_mentions: input.allowedMentions,
        content: input.content,
      },
    })
  }

  async addOwnReaction(
    channelId: string,
    messageId: string,
    emoji: string,
    options: RequestOptions = {},
  ): Promise<void> {
    if (!emoji || emoji.length > CONNECTOR_LIMITS.interactionEmojiCharacters) {
      throw new RangeError(
        `Discord reaction emoji must contain between 1 and ${CONNECTOR_LIMITS.interactionEmojiCharacters} characters`,
      )
    }
    let encodedEmoji: string
    try {
      encodedEmoji = encodeURIComponent(emoji)
    } catch (error) {
      throw new RangeError("Discord reaction emoji contains invalid Unicode", { cause: error })
    }
    await this.#request<void>(
      "add_own_reaction",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      options,
    )
  }

  searchGuildMessages(
    guildId: string,
    options: GuildMessageSearchOptions = {},
  ): Promise<DiscordMessageSearchIndexing | DiscordMessageSearchResponse> {
    assertBoundedLimit(
      options.limit,
      DISCORD_LIMITS.guildMessageSearch,
      "Discord guild message search limit",
    )
    assertIntegerRange(
      options.offset,
      0,
      DISCORD_LIMITS.searchOffset,
      "Discord guild message search offset",
    )
    assertIntegerRange(
      options.slop,
      0,
      DISCORD_LIMITS.searchSlop,
      "Discord guild message search slop",
    )
    if (
      options.content !== undefined
      && options.content.length > DISCORD_LIMITS.searchContentCharacters
    ) {
      throw new RangeError(
        `Discord guild message search content must not exceed ${DISCORD_LIMITS.searchContentCharacters} characters`,
      )
    }
    assertBoundedArray(
      options.channelIds,
      DISCORD_LIMITS.searchChannelIds,
      "Discord guild message search channel IDs",
    )
    assertSearchSnowflakes(
      options.channelIds,
      "Discord guild message search channel IDs",
    )
    for (const [name, values] of [
      ["author IDs", options.authorIds],
      ["mentioned role IDs", options.mentionRoleIds],
      ["mentioned user IDs", options.mentionUserIds],
      ["replied-to message IDs", options.repliedToMessageIds],
      ["replied-to user IDs", options.repliedToUserIds],
    ] as const) {
      assertBoundedArray(
        values,
        DISCORD_LIMITS.searchFilterIds,
        `Discord guild message search ${name}`,
      )
      assertSearchSnowflakes(values, `Discord guild message search ${name}`)
    }
    assertBoundedArray(
      options.authorTypes,
      DISCORD_LIMITS.searchFilterStrings,
      "Discord guild message search author types",
    )
    assertBoundedArray(
      options.embedTypes,
      DISCORD_LIMITS.searchFilterStrings,
      "Discord guild message search embed types",
    )
    assertBoundedArray(
      options.has,
      DISCORD_LIMITS.searchFilterStrings,
      "Discord guild message search has filters",
    )
    assertAllowedValues(
      options.authorTypes,
      SEARCH_AUTHOR_TYPES,
      "Discord guild message search author types",
    )
    assertAllowedValues(
      options.embedTypes,
      SEARCH_EMBED_TYPES,
      "Discord guild message search embed types",
    )
    assertAllowedValues(
      options.has,
      SEARCH_HAS_TYPES,
      "Discord guild message search has filters",
    )
    assertBoundedStrings(
      options.attachmentFilenames,
      DISCORD_LIMITS.searchFilterStrings,
      DISCORD_LIMITS.searchFilenameCharacters,
      "Discord guild message search attachment filenames",
    )
    for (const [name, values] of [
      ["attachment extensions", options.attachmentExtensions],
      ["embed providers", options.embedProviders],
      ["link hostnames", options.linkHostnames],
    ] as const) {
      assertBoundedStrings(
        values,
        DISCORD_LIMITS.searchFilterStrings,
        DISCORD_LIMITS.searchFilterCharacters,
        `Discord guild message search ${name}`,
      )
    }
    assertAllowedValue(
      options.sortBy,
      SEARCH_SORT_BY_VALUES,
      "Discord guild message search sort field",
    )
    assertAllowedValue(
      options.sortOrder,
      SEARCH_SORT_ORDER_VALUES,
      "Discord guild message search sort order",
    )
    assertSearchSnowflake(options.minId, "Discord guild message search minimum ID")
    assertSearchSnowflake(options.maxId, "Discord guild message search maximum ID")
    if (options.minId && options.maxId && BigInt(options.minId) >= BigInt(options.maxId)) {
      throw new RangeError("Discord guild message search minimum ID must be less than maximum ID")
    }
    if (options.slop !== undefined && !options.content?.trim()) {
      throw new RangeError("Discord guild message search slop requires content")
    }
    if (options.sortBy === "relevance" && options.sortOrder !== undefined) {
      throw new RangeError("Discord guild message search sort order cannot accompany relevance")
    }
    const route = `/guilds/${guildId}/messages/search${queryString({
      attachment_extension: options.attachmentExtensions,
      attachment_filename: options.attachmentFilenames,
      author_id: options.authorIds,
      author_type: options.authorTypes,
      channel_id: options.channelIds,
      content: options.content,
      embed_provider: options.embedProviders,
      embed_type: options.embedTypes,
      has: options.has,
      include_nsfw: options.includeNsfw,
      limit: options.limit,
      link_hostname: options.linkHostnames,
      max_id: options.maxId,
      mention_everyone: options.mentionEveryone,
      mentions: options.mentionUserIds,
      mentions_role_id: options.mentionRoleIds,
      min_id: options.minId,
      offset: options.offset,
      pinned: options.pinned,
      replied_to_message_id: options.repliedToMessageIds,
      replied_to_user_id: options.repliedToUserIds,
      slop: options.slop,
      sort_by: options.sortBy,
      sort_order: options.sortOrder,
    })}`
    return this.#request("search_guild_messages", route, options)
  }

  listActiveGuildThreads(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordThreadList> {
    return this.#request("list_active_guild_threads", `/guilds/${guildId}/threads/active`, options)
  }

  listPublicArchivedThreads(
    channelId: string,
    options: ArchivedThreadPageOptions = {},
  ): Promise<DiscordThreadList> {
    assertIntegerRange(
      options.limit,
      DISCORD_LIMITS.archivedThreadsMinimum,
      DISCORD_LIMITS.archivedThreads,
      "Discord archived thread limit",
    )
    assertIsoTimestamp(options.before, "Discord public archived thread cursor")
    return this.#request(
      "list_public_archived_threads",
      `/channels/${channelId}/threads/archived/public${queryString({
        before: options.before,
        limit: options.limit,
      })}`,
      options,
    )
  }

  listPrivateArchivedThreads(
    channelId: string,
    options: ArchivedThreadPageOptions = {},
  ): Promise<DiscordThreadList> {
    assertIntegerRange(
      options.limit,
      DISCORD_LIMITS.archivedThreadsMinimum,
      DISCORD_LIMITS.archivedThreads,
      "Discord archived thread limit",
    )
    assertIsoTimestamp(options.before, "Discord private archived thread cursor")
    return this.#request(
      "list_private_archived_threads",
      `/channels/${channelId}/threads/archived/private${queryString({
        before: options.before,
        limit: options.limit,
      })}`,
      options,
    )
  }

  listJoinedPrivateArchivedThreads(
    channelId: string,
    options: ArchivedThreadPageOptions = {},
  ): Promise<DiscordThreadList> {
    assertIntegerRange(
      options.limit,
      DISCORD_LIMITS.archivedThreadsMinimum,
      DISCORD_LIMITS.archivedThreads,
      "Discord archived thread limit",
    )
    assertSearchSnowflake(options.before, "Discord joined-private archived thread cursor")
    return this.#request(
      "list_joined_private_archived_threads",
      `/channels/${channelId}/users/@me/threads/archived/private${queryString({
        before: options.before,
        limit: options.limit,
      })}`,
      options,
    )
  }

  async deleteMessage(
    channelId: string,
    messageId: string,
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>("delete_message", `/channels/${channelId}/messages/${messageId}`, {
      ...options,
      auditReason,
    })
  }

  async bulkDeleteMessages(
    channelId: string,
    messageIds: readonly string[],
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>("bulk_delete_messages", `/channels/${channelId}/messages/bulk-delete`, {
      ...options,
      auditReason,
      body: { messages: messageIds },
    })
  }
}
