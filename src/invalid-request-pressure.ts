export const DISCORD_INVALID_REQUEST_PRESSURE = Object.freeze({
  documentedLimit: 10_000,
  documentedWindowMs: 10 * 60 * 1_000,
  resolutionMs: 1_000,
})

export interface DiscordResponseObservation {
  sharedRateLimit: boolean
  statusCode: number
}

export interface InvalidRequestPressureSnapshot {
  coverage: "this-process-only"
  discordDocumentedLimit: number
  discordDocumentedWindowMs: number
  ipWideTotalKnown: false
  observed: {
    forbidden403: number
    rateLimited429: number
    total: number
    unauthorized401: number
  }
  sharedScope429Excluded: true
  state: "clear" | "documented-limit-reached" | "observed"
  thresholdReachedByThisProcess: boolean
  windowResolutionMs: number
}

interface MutableInvalidRequestBucket {
  forbidden403: number
  rateLimited429: number
  unauthorized401: number
}

function emptyBucket(): MutableInvalidRequestBucket {
  return {
    forbidden403: 0,
    rateLimited429: 0,
    unauthorized401: 0,
  }
}

function finiteMonotonicTime(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

export class InvalidRequestPressureTracker {
  readonly #buckets = new Map<number, MutableInvalidRequestBucket>()
  readonly #clock: () => number

  constructor(clock: () => number) {
    this.#clock = clock
  }

  #currentBucket(): number {
    return Math.floor(
      finiteMonotonicTime(this.#clock()) / DISCORD_INVALID_REQUEST_PRESSURE.resolutionMs,
    )
  }

  #prune(currentBucket: number): void {
    const retainedBucketCount = Math.ceil(
      DISCORD_INVALID_REQUEST_PRESSURE.documentedWindowMs
        / DISCORD_INVALID_REQUEST_PRESSURE.resolutionMs,
    )
    const minimumBucket = currentBucket - retainedBucketCount + 1
    for (const bucket of this.#buckets.keys()) {
      if (bucket < minimumBucket || bucket > currentBucket) this.#buckets.delete(bucket)
    }
  }

  record(response: DiscordResponseObservation): boolean {
    const field = response.statusCode === 401
      ? "unauthorized401"
      : response.statusCode === 403
        ? "forbidden403"
        : response.statusCode === 429
          && !response.sharedRateLimit
          ? "rateLimited429"
          : undefined
    if (!field) return false

    const currentBucket = this.#currentBucket()
    this.#prune(currentBucket)
    const bucket = this.#buckets.get(currentBucket) || emptyBucket()
    bucket[field] += 1
    this.#buckets.set(currentBucket, bucket)
    return true
  }

  snapshot(): InvalidRequestPressureSnapshot {
    const currentBucket = this.#currentBucket()
    this.#prune(currentBucket)
    const observed = {
      forbidden403: 0,
      rateLimited429: 0,
      total: 0,
      unauthorized401: 0,
    }
    for (const bucket of this.#buckets.values()) {
      observed.forbidden403 += bucket.forbidden403
      observed.rateLimited429 += bucket.rateLimited429
      observed.unauthorized401 += bucket.unauthorized401
    }
    observed.total = observed.forbidden403
      + observed.rateLimited429
      + observed.unauthorized401
    const thresholdReached = observed.total
      >= DISCORD_INVALID_REQUEST_PRESSURE.documentedLimit
    return {
      coverage: "this-process-only",
      discordDocumentedLimit: DISCORD_INVALID_REQUEST_PRESSURE.documentedLimit,
      discordDocumentedWindowMs: DISCORD_INVALID_REQUEST_PRESSURE.documentedWindowMs,
      ipWideTotalKnown: false,
      observed,
      sharedScope429Excluded: true,
      state: observed.total === 0
        ? "clear"
        : thresholdReached
          ? "documented-limit-reached"
          : "observed",
      thresholdReachedByThisProcess: thresholdReached,
      windowResolutionMs: DISCORD_INVALID_REQUEST_PRESSURE.resolutionMs,
    }
  }
}
