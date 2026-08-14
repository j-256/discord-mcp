import { setTimeout as wait } from "node:timers/promises"

import {
  DISCORD_API_BASE_URL,
  DISCORD_LIMITS,
  DISCORD_USER_AGENT,
} from "./constants.js"
import { DiscordApiError, errorMessage, redactText } from "./errors.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordErrorBody,
  DiscordGuild,
  DiscordMessage,
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

function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const parameters = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) parameters.set(name, String(value))
  }
  const query = parameters.toString()
  return query ? `?${query}` : ""
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
      const retryAfterMs = retryAfterMilliseconds(discordError, response.headers)

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
