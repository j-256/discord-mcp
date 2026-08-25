const DISCORD_GATEWAY_HOST_PATTERN = /^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/
const MAXIMUM_GATEWAY_URL_LENGTH = 2_048

export interface GatewayBotDiscovery {
  sessionStartLimit: {
    maxConcurrency: number
    remaining: number
    resetAfterMs: number
    total: number
  }
  shards: number
  url: string
}

export class GatewayDiscoveryEvidenceError extends Error {
  constructor() {
    super("Discord Gateway Bot discovery response is invalid")
    this.name = "GatewayDiscoveryEvidenceError"
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function safeInteger(value: unknown, minimum: number): number | undefined {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    ? value
    : undefined
}

export function normalizeDiscordGatewayUrl(
  value: unknown,
  options: { rootOnly?: boolean } = {},
): string | undefined {
  if (typeof value !== "string" || value.length > MAXIMUM_GATEWAY_URL_LENGTH) {
    return undefined
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== "wss:"
    || url.username
    || url.password
    || url.port
    || !DISCORD_GATEWAY_HOST_PATTERN.test(hostname)
    || (options.rootOnly === true && (
      url.pathname !== "/"
      || url.search
      || url.hash
    ))
  ) {
    return undefined
  }
  return `${url.origin}/?v=10&encoding=json`
}

export function projectGatewayBotDiscovery(value: unknown): GatewayBotDiscovery {
  const record = recordValue(value)
  const sessionStartLimit = recordValue(record?.session_start_limit)
  const url = normalizeDiscordGatewayUrl(record?.url, { rootOnly: true })
  const shards = safeInteger(record?.shards, 1)
  const total = safeInteger(sessionStartLimit?.total, 1)
  const remaining = safeInteger(sessionStartLimit?.remaining, 0)
  const resetAfterMs = safeInteger(sessionStartLimit?.reset_after, 0)
  const maxConcurrency = safeInteger(sessionStartLimit?.max_concurrency, 1)
  if (
    !record
    || !sessionStartLimit
    || !url
    || shards === undefined
    || total === undefined
    || remaining === undefined
    || remaining > total
    || resetAfterMs === undefined
    || maxConcurrency === undefined
  ) {
    throw new GatewayDiscoveryEvidenceError()
  }
  return {
    sessionStartLimit: {
      maxConcurrency,
      remaining,
      resetAfterMs,
      total,
    },
    shards,
    url,
  }
}

export function validateGatewayBotDiscovery(value: unknown): GatewayBotDiscovery {
  const record = recordValue(value)
  const sessionStartLimit = recordValue(record?.sessionStartLimit)
  const url = normalizeDiscordGatewayUrl(record?.url)
  const shards = safeInteger(record?.shards, 1)
  const total = safeInteger(sessionStartLimit?.total, 1)
  const remaining = safeInteger(sessionStartLimit?.remaining, 0)
  const resetAfterMs = safeInteger(sessionStartLimit?.resetAfterMs, 0)
  const maxConcurrency = safeInteger(sessionStartLimit?.maxConcurrency, 1)
  if (
    !record
    || !sessionStartLimit
    || !url
    || record.url !== url
    || shards === undefined
    || total === undefined
    || remaining === undefined
    || remaining > total
    || resetAfterMs === undefined
    || maxConcurrency === undefined
  ) {
    throw new GatewayDiscoveryEvidenceError()
  }
  return {
    sessionStartLimit: {
      maxConcurrency,
      remaining,
      resetAfterMs,
      total,
    },
    shards,
    url,
  }
}
