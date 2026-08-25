import { GATEWAY_DEFAULTS } from "./constants.js"

export type GatewayCommandSendOutcome =
  | "cancelled"
  | "queue-full"
  | "queue-timeout"
  | "sent"
  | "unavailable"

export type GatewayControlSendOutcome = "exhausted" | "sent" | "unavailable"

export interface GatewayOutboundBudgetScheduler {
  clearTimeout(handle: unknown): void
  setTimeout(handler: () => void, milliseconds: number): unknown
}

export interface GatewayOutboundBudgetOptions {
  clock?: () => number
  scheduler: GatewayOutboundBudgetScheduler
  write: (serialized: string) => boolean
}

interface PendingCommand {
  abortListener?: () => void
  deadline: number
  resolve: (outcome: GatewayCommandSendOutcome) => void
  serialized: string
  settled: boolean
  signal?: AbortSignal
}

export interface GatewayOutboundBudgetSnapshot {
  eventsInWindow: number
  queuedCommands: number
  timerActive: boolean
}

function validSerializedPayload(value: string): boolean {
  return value.length > 0
    && Buffer.byteLength(value, "utf8") <= GATEWAY_DEFAULTS.outboundPayloadBytes
}

export class GatewayOutboundBudget {
  readonly #clock: () => number
  readonly #history: number[] = []
  #lastNow: number | undefined
  readonly #queue: PendingCommand[] = []
  readonly #scheduler: GatewayOutboundBudgetScheduler
  #timer: unknown
  readonly #write: (serialized: string) => boolean

  constructor(options: GatewayOutboundBudgetOptions) {
    if (
      !options
      || !options.scheduler
      || typeof options.scheduler.clearTimeout !== "function"
      || typeof options.scheduler.setTimeout !== "function"
      || typeof options.write !== "function"
      || (options.clock !== undefined && typeof options.clock !== "function")
    ) {
      throw new RangeError("Gateway outbound budget options are invalid")
    }
    this.#clock = options.clock || Date.now
    this.#scheduler = options.scheduler
    this.#write = options.write
  }

  get snapshot(): GatewayOutboundBudgetSnapshot {
    return {
      eventsInWindow: this.#history.length,
      queuedCommands: this.#queue.length,
      timerActive: this.#timer !== undefined,
    }
  }

  reset(): void {
    this.#clearTimer()
    this.#history.length = 0
    this.#lastNow = undefined
    const entries = this.#queue.splice(0)
    for (const entry of entries) this.#settle(entry, "unavailable")
  }

  sendControl(serialized: string): GatewayControlSendOutcome {
    if (!validSerializedPayload(serialized)) return "unavailable"
    const now = this.#currentTime()
    if (now === undefined) return "unavailable"
    this.#prune(now)
    if (this.#history.length >= GATEWAY_DEFAULTS.outboundEventLimit) {
      return "exhausted"
    }
    if (!this.#writeSafely(serialized)) return "unavailable"
    this.#history.push(now)
    return "sent"
  }

  sendCommand(
    serialized: string,
    signal?: AbortSignal,
  ): Promise<GatewayCommandSendOutcome> {
    if (!validSerializedPayload(serialized)) return Promise.resolve("unavailable")
    if (signal?.aborted) return Promise.resolve("cancelled")
    if (this.#queue.length >= GATEWAY_DEFAULTS.outboundCommandQueueCapacity) {
      return Promise.resolve("queue-full")
    }
    const now = this.#currentTime()
    if (now === undefined) return Promise.resolve("unavailable")
    return new Promise<GatewayCommandSendOutcome>((resolve) => {
      const entry: PendingCommand = {
        deadline: now + GATEWAY_DEFAULTS.outboundCommandQueueTimeoutMs,
        resolve,
        serialized,
        settled: false,
        ...(signal ? { signal } : {}),
      }
      if (signal) {
        entry.abortListener = () => {
          const index = this.#queue.indexOf(entry)
          if (index < 0) return
          this.#queue.splice(index, 1)
          this.#settle(entry, "cancelled")
          this.#drain()
        }
        signal.addEventListener("abort", entry.abortListener, { once: true })
      }
      this.#queue.push(entry)
      this.#drain()
    })
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) {
      try {
        this.#scheduler.clearTimeout(this.#timer)
      } catch {}
    }
    this.#timer = undefined
  }

  #currentTime(): number | undefined {
    const now = this.#clock()
    if (
      !Number.isFinite(now)
      || now < 0
      || (this.#lastNow !== undefined && now < this.#lastNow)
    ) return undefined
    this.#lastNow = now
    return now
  }

  #drain(): void {
    this.#clearTimer()
    while (this.#queue.length > 0) {
      const now = this.#currentTime()
      if (now === undefined) {
        const entries = this.#queue.splice(0)
        for (const entry of entries) this.#settle(entry, "unavailable")
        return
      }
      this.#prune(now)
      const entry = this.#queue[0]
      if (!entry) return
      if (this.#history.length < GATEWAY_DEFAULTS.outboundCommandAdmissionLimit) {
        this.#queue.shift()
        const serialized = entry.serialized
        if (!this.#writeSafely(serialized)) {
          this.#settle(entry, "unavailable")
          const entries = this.#queue.splice(0)
          for (const queued of entries) this.#settle(queued, "unavailable")
          return
        }
        this.#history.push(now)
        this.#settle(entry, "sent")
        continue
      }
      if (now >= entry.deadline) {
        this.#queue.shift()
        this.#settle(entry, "queue-timeout")
        continue
      }
      const historyIndex = this.#history.length
        - GATEWAY_DEFAULTS.outboundCommandAdmissionLimit
      const capacityAt = this.#history[historyIndex]! + GATEWAY_DEFAULTS.outboundWindowMs
      const wakeAt = Math.min(capacityAt, entry.deadline)
      try {
        this.#timer = this.#scheduler.setTimeout(
          () => {
            this.#timer = undefined
            this.#drain()
          },
          Math.max(0, wakeAt - now),
        )
      } catch {
        const entries = this.#queue.splice(0)
        for (const queued of entries) this.#settle(queued, "unavailable")
      }
      return
    }
  }

  #prune(now: number): void {
    const cutoff = now - GATEWAY_DEFAULTS.outboundWindowMs
    while (this.#history[0] !== undefined && this.#history[0] <= cutoff) {
      this.#history.shift()
    }
  }

  #settle(entry: PendingCommand, outcome: GatewayCommandSendOutcome): void {
    if (entry.settled) return
    entry.settled = true
    if (entry.abortListener && entry.signal) {
      entry.signal.removeEventListener("abort", entry.abortListener)
    }
    delete entry.abortListener
    delete entry.signal
    entry.serialized = ""
    entry.resolve(outcome)
  }

  #writeSafely(serialized: string): boolean {
    try {
      return this.#write(serialized) === true
    } catch {
      return false
    }
  }
}
