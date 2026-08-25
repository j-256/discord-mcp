import { GATEWAY_DEFAULTS } from "./constants.js"

export type GatewayIdentifyFailureCategory =
  | "identify-budget-exhausted"
  | "session-start-limit-exhausted"

export interface GatewayIdentifyScheduler {
  clearTimeout(handle: unknown): void
  setTimeout(handler: () => void, milliseconds: number): unknown
}

export interface GatewayIdentifyCoordinatorOptions {
  clock?: () => number
  maxConcurrency: number
  onFailure: (category: GatewayIdentifyFailureCategory) => void
  onIdentify?: () => void
  remaining: number
  scheduler: GatewayIdentifyScheduler
  shardCount: number
  shardIds: readonly number[]
}

interface IdentifyEntry {
  initial: boolean
  send?: () => boolean
  shardId: number
}

interface IdentifyQueue {
  entries: IdentifyEntry[]
  nextAt: number
  timer?: unknown
}

export class GatewayIdentifyCoordinator {
  readonly #clock: () => number
  readonly #histories = new Map<number, number[]>()
  readonly #initial = new Map<number, IdentifyEntry>()
  readonly #maxConcurrency: number
  readonly #onFailure: GatewayIdentifyCoordinatorOptions["onFailure"]
  readonly #onIdentify: () => void
  readonly #pending = new Map<number, IdentifyEntry>()
  readonly #queues = new Map<number, IdentifyQueue>()
  #remaining: number
  readonly #scheduler: GatewayIdentifyScheduler
  readonly #shardIds: ReadonlySet<number>
  #stopped = false

  constructor(options: GatewayIdentifyCoordinatorOptions) {
    if (
      !options
      || !Array.isArray(options.shardIds)
      || options.shardIds.length < 1
      || !Number.isSafeInteger(options.maxConcurrency)
      || options.maxConcurrency < 1
      || !Number.isSafeInteger(options.remaining)
      || options.remaining < 0
      || !Number.isSafeInteger(options.shardCount)
      || options.shardCount < 1
      || typeof options.onFailure !== "function"
      || !options.scheduler
      || typeof options.scheduler.clearTimeout !== "function"
      || typeof options.scheduler.setTimeout !== "function"
    ) {
      throw new RangeError("Gateway Identify coordinator options are invalid")
    }
    const shardIds = [...options.shardIds]
    if (
      shardIds.some((shardId) => (
        !Number.isSafeInteger(shardId)
        || shardId < 0
        || shardId >= options.shardCount
      ))
      || new Set(shardIds).size !== shardIds.length
      || shardIds.some((shardId, index) => index > 0 && shardId <= shardIds[index - 1]!)
    ) {
      throw new RangeError("Gateway Identify shard IDs must be unique and ascending")
    }
    this.#clock = options.clock || Date.now
    this.#maxConcurrency = options.maxConcurrency
    this.#onFailure = options.onFailure
    this.#onIdentify = options.onIdentify || (() => undefined)
    this.#remaining = options.remaining
    this.#scheduler = options.scheduler
    this.#shardIds = new Set(shardIds)
    for (const shardId of shardIds) {
      const entry: IdentifyEntry = { initial: true, shardId }
      this.#initial.set(shardId, entry)
      this.#queue(shardId).entries.push(entry)
    }
  }

  get remaining(): number {
    return this.#remaining
  }

  request(shardId: number, send: () => boolean): () => void {
    if (
      this.#stopped
      || !this.#shardIds.has(shardId)
      || typeof send !== "function"
      || this.#pending.has(shardId)
    ) {
      throw new RangeError("Gateway Identify request is invalid")
    }
    const entry = this.#initial.get(shardId) || { initial: false, shardId }
    if (!entry.initial) this.#queue(shardId).entries.push(entry)
    entry.send = send
    this.#pending.set(shardId, entry)
    this.#process(this.#key(shardId))
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.#pending.get(shardId) !== entry) return
      this.#pending.delete(shardId)
      delete entry.send
      if (!entry.initial) {
        const queue = this.#queue(shardId)
        const index = queue.entries.indexOf(entry)
        if (index >= 0) queue.entries.splice(index, 1)
        this.#process(this.#key(shardId))
      }
    }
  }

  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    for (const queue of this.#queues.values()) {
      if (queue.timer !== undefined) this.#scheduler.clearTimeout(queue.timer)
      queue.timer = undefined
      queue.entries.length = 0
    }
    this.#pending.clear()
    this.#initial.clear()
  }

  #key(shardId: number): number {
    return shardId % this.#maxConcurrency
  }

  #queue(shardId: number): IdentifyQueue {
    const key = this.#key(shardId)
    let queue = this.#queues.get(key)
    if (!queue) {
      queue = { entries: [], nextAt: Number.NEGATIVE_INFINITY }
      this.#queues.set(key, queue)
    }
    return queue
  }

  #fail(category: GatewayIdentifyFailureCategory): void {
    if (this.#stopped) return
    this.stop()
    try {
      this.#onFailure(category)
    } catch {}
  }

  #process(key: number): void {
    if (this.#stopped) return
    const queue = this.#queues.get(key)
    if (!queue || queue.timer !== undefined) return
    const entry = queue.entries[0]
    if (!entry?.send) return
    const now = this.#clock()
    if (!Number.isFinite(now)) {
      this.#fail("identify-budget-exhausted")
      return
    }
    const delay = Math.max(0, queue.nextAt - now)
    if (delay > 0) {
      queue.timer = this.#scheduler.setTimeout(() => {
        queue.timer = undefined
        this.#process(key)
      }, delay)
      return
    }
    const history = this.#histories.get(entry.shardId) || []
    const cutoff = now - GATEWAY_DEFAULTS.identifyBudgetWindowMs
    while (history[0] !== undefined && history[0] < cutoff) history.shift()
    if (history.length >= GATEWAY_DEFAULTS.identifyBudget) {
      this.#fail("identify-budget-exhausted")
      return
    }
    if (this.#remaining < 1) {
      this.#fail("session-start-limit-exhausted")
      return
    }
    let sent = false
    try {
      sent = entry.send()
    } catch {}
    if (!sent) {
      this.#pending.delete(entry.shardId)
      delete entry.send
      if (!entry.initial) queue.entries.shift()
      this.#process(key)
      return
    }
    this.#remaining -= 1
    history.push(now)
    this.#histories.set(entry.shardId, history)
    this.#pending.delete(entry.shardId)
    this.#initial.delete(entry.shardId)
    queue.entries.shift()
    queue.nextAt = now + GATEWAY_DEFAULTS.identifyMinimumIntervalMs
    try {
      this.#onIdentify()
    } catch {}
    this.#process(key)
  }
}
