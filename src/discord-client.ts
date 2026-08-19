import { setTimeout as wait } from "node:timers/promises"

import {
  DISCORD_API_BASE_URL,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  DISCORD_USER_AGENT,
} from "./constants.js"
import { DiscordApiError, errorMessage, redactText } from "./errors.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordErrorBody,
  DiscordGuild,
  DiscordGuildMember,
  DiscordMessage,
  DiscordMessageSearchIndexing,
  DiscordMessageSearchResponse,
  DiscordRole,
  DiscordThreadList,
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

interface RequestParameters extends RequestOptions {
  auditReason?: string
  body?: unknown
  method?: string
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

export class DiscordClient {
  readonly #apiBaseUrl: string
  readonly #fetch: FetchImplementation
  readonly #maxAutomaticRetryWaitMs: number
  readonly #maxRetries: number
  readonly #requestTimeoutMs: number
  readonly #sleep: SleepImplementation
  readonly #token: string

  constructor(options: DiscordClientOptions) {
    this.#apiBaseUrl = (options.apiBaseUrl || DISCORD_API_BASE_URL).replace(/\/+$/, "")
    this.#fetch = options.fetchImplementation || globalThis.fetch
    this.#maxAutomaticRetryWaitMs = options.maxAutomaticRetryWaitMs
      ?? DISCORD_LIMITS.automaticRetryWaitMs
    this.#maxRetries = options.maxRetries ?? DISCORD_LIMITS.retries
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DISCORD_LIMITS.requestTimeoutMs
    this.#sleep = options.sleep || defaultSleep
    this.#token = options.token
  }

  async #request<T>(route: string, parameters: RequestParameters = {}): Promise<T> {
    const method = parameters.method || "GET"
    const url = new URL(`${this.#apiBaseUrl}${route}`)

    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(this.#requestTimeoutMs)
      const signal = parameters.signal
        ? AbortSignal.any([parameters.signal, timeoutSignal])
        : timeoutSignal
      const headers = new Headers({
        Accept: "application/json",
        Authorization: `Bot ${this.#token}`,
        "User-Agent": DISCORD_USER_AGENT,
      })
      let body: string | undefined
      if (parameters.body !== undefined) {
        body = JSON.stringify(parameters.body)
        headers.set("Content-Type", "application/json")
      }
      if (parameters.auditReason) {
        headers.set("X-Audit-Log-Reason", encodeURIComponent(parameters.auditReason))
      }

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
        const message = redactText(errorMessage(error), [this.#token])
        throw new Error(`Discord API ${method} ${route} failed: ${message}`, { cause: error })
      }

      const responseText = await response.text()
      const parsedBody = parseJson(responseText)
      const discordError = errorBody(parsedBody)
      const retryAfterMs = response.status === 429
        ? retryAfterMilliseconds(discordError, response.headers)
        : undefined

      if (
        response.status === 429
        && attempt < this.#maxRetries
        && retryAfterMs !== undefined
        && retryAfterMs <= this.#maxAutomaticRetryWaitMs
      ) {
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

    throw new Error(`Discord API ${method} ${route} exhausted retries`)
  }

  getCurrentApplication(options: RequestOptions = {}): Promise<DiscordApplication> {
    return this.#request("/oauth2/applications/@me", options)
  }

  getCurrentUser(options: RequestOptions = {}): Promise<DiscordUser> {
    return this.#request("/users/@me", options)
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
    return this.#request(route, options)
  }

  getGuildChannels(guildId: string, options: RequestOptions = {}): Promise<DiscordChannel[]> {
    return this.#request(`/guilds/${guildId}/channels`, options)
  }

  getGuildMember(
    guildId: string,
    userId: string,
    options: RequestOptions = {},
  ): Promise<DiscordGuildMember> {
    return this.#request(`/guilds/${guildId}/members/${userId}`, options)
  }

  getGuildRoles(guildId: string, options: RequestOptions = {}): Promise<DiscordRole[]> {
    return this.#request(`/guilds/${guildId}/roles`, options)
  }

  getChannel(channelId: string, options: RequestOptions = {}): Promise<DiscordChannel> {
    return this.#request(`/channels/${channelId}`, options)
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
    return this.#request(route, options)
  }

  getMessage(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<DiscordMessage> {
    return this.#request(`/channels/${channelId}/messages/${messageId}`, options)
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
    return this.#request(route, options)
  }

  listActiveGuildThreads(
    guildId: string,
    options: RequestOptions = {},
  ): Promise<DiscordThreadList> {
    return this.#request(`/guilds/${guildId}/threads/active`, options)
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
    await this.#request<void>(`/channels/${channelId}/messages/${messageId}`, {
      ...options,
      auditReason,
      method: "DELETE",
    })
  }

  async bulkDeleteMessages(
    channelId: string,
    messageIds: readonly string[],
    auditReason: string,
    options: RequestOptions = {},
  ): Promise<void> {
    await this.#request<void>(`/channels/${channelId}/messages/bulk-delete`, {
      ...options,
      auditReason,
      body: { messages: messageIds },
      method: "POST",
    })
  }
}
