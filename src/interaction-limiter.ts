import { InteractionRateLimitError } from "./errors.js"

const ROLLING_WINDOW_MS = 60_000

export interface InteractionLimiterOptions {
  clock?: () => number
  maxWritesPerMinute: number
  minWriteIntervalMs: number
}

export class InteractionLimiter {
  readonly #clock: () => number
  readonly #lastWriteByChannel = new Map<string, number>()
  readonly #maxWritesPerMinute: number
  readonly #minWriteIntervalMs: number
  #writeTimestamps: number[] = []

  constructor(options: InteractionLimiterOptions) {
    if (!Number.isInteger(options.maxWritesPerMinute) || options.maxWritesPerMinute < 1) {
      throw new RangeError("Interaction write budget must be a positive integer")
    }
    if (!Number.isInteger(options.minWriteIntervalMs) || options.minWriteIntervalMs < 0) {
      throw new RangeError("Interaction write interval must be a non-negative integer")
    }
    this.#clock = options.clock || Date.now
    this.#maxWritesPerMinute = options.maxWritesPerMinute
    this.#minWriteIntervalMs = options.minWriteIntervalMs
  }

  reserve(channelId: string): void {
    const now = this.#clock()
    const cutoff = now - ROLLING_WINDOW_MS
    this.#writeTimestamps = this.#writeTimestamps.filter((timestamp) => timestamp > cutoff)
    for (const [id, timestamp] of this.#lastWriteByChannel) {
      if (timestamp + this.#minWriteIntervalMs <= now) {
        this.#lastWriteByChannel.delete(id)
      }
    }

    const oldest = this.#writeTimestamps[0]
    const rollingRetryMs = this.#writeTimestamps.length >= this.#maxWritesPerMinute
      && oldest !== undefined
      ? oldest + ROLLING_WINDOW_MS - now
      : 0
    const channelTimestamp = this.#lastWriteByChannel.get(channelId)
    const channelRetryMs = channelTimestamp === undefined
      ? 0
      : channelTimestamp + this.#minWriteIntervalMs - now
    const retryAfterMs = Math.max(rollingRetryMs, channelRetryMs)
    if (retryAfterMs > 0) {
      throw new InteractionRateLimitError(Math.ceil(retryAfterMs))
    }

    this.#writeTimestamps.push(now)
    this.#lastWriteByChannel.set(channelId, now)
  }
}
