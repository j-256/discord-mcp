import assert from "node:assert/strict"
import test from "node:test"

import { GATEWAY_DEFAULTS } from "../src/constants.js"
import {
  GatewayOutboundBudget,
  type GatewayOutboundBudgetScheduler,
} from "../src/gateway-outbound-budget.js"

class FakeScheduler implements GatewayOutboundBudgetScheduler {
  #nextId = 1
  readonly jobs = new Map<number, { due: number; handler: () => void }>()
  now = 0

  advanceTo(now: number): void {
    assert.ok(now >= this.now)
    this.now = now
  }

  clearTimeout(handle: unknown): void {
    this.jobs.delete(handle as number)
  }

  runNext(): number | undefined {
    const next = [...this.jobs].sort((left, right) => (
      left[1].due - right[1].due || left[0] - right[0]
    ))[0]
    if (!next) return undefined
    const [id, job] = next
    this.jobs.delete(id)
    const delay = job.due - this.now
    this.now = job.due
    job.handler()
    return delay
  }

  setTimeout(handler: () => void, milliseconds: number): unknown {
    const id = this.#nextId
    this.#nextId += 1
    this.jobs.set(id, { due: this.now + milliseconds, handler })
    return id
  }
}

function fixture(write?: (serialized: string) => boolean) {
  const scheduler = new FakeScheduler()
  const writes: string[] = []
  const budget = new GatewayOutboundBudget({
    clock: () => scheduler.now,
    scheduler,
    write: write || ((serialized) => {
      writes.push(serialized)
      return true
    }),
  })
  return { budget, scheduler, writes }
}

test("Gateway outbound budget reserves half the connection window for control traffic", async () => {
  const { budget, scheduler, writes } = fixture()
  assert.equal(budget.sendControl("control-identify"), "sent")
  for (let index = 1; index < GATEWAY_DEFAULTS.outboundCommandAdmissionLimit; index += 1) {
    assert.equal(await budget.sendCommand(`command-${index}`), "sent")
  }
  assert.equal(budget.snapshot.eventsInWindow, GATEWAY_DEFAULTS.outboundCommandAdmissionLimit)

  const queued = budget.sendCommand("queued-command")
  assert.equal(budget.snapshot.queuedCommands, 1)
  assert.equal(writes.includes("queued-command"), false)
  for (let index = 0; index < 10; index += 1) {
    assert.equal(budget.sendControl(`control-${index}`), "sent")
  }
  assert.equal(scheduler.runNext(), GATEWAY_DEFAULTS.outboundCommandQueueTimeoutMs)
  assert.equal(await queued, "queue-timeout")
  assert.equal(budget.snapshot.queuedCommands, 0)
  assert.equal(budget.snapshot.timerActive, false)
})

test("Gateway outbound budget expires a rolling window and preserves command FIFO order", async () => {
  const { budget, scheduler, writes } = fixture()
  for (let index = 0; index < GATEWAY_DEFAULTS.outboundCommandAdmissionLimit; index += 1) {
    assert.equal(await budget.sendCommand(`initial-${index}`), "sent")
  }
  scheduler.advanceTo(
    GATEWAY_DEFAULTS.outboundWindowMs
      - Math.floor(GATEWAY_DEFAULTS.outboundCommandQueueTimeoutMs / 2),
  )
  const first = budget.sendCommand("queued-first")
  const second = budget.sendCommand("queued-second")
  assert.deepEqual(budget.snapshot, {
    eventsInWindow: GATEWAY_DEFAULTS.outboundCommandAdmissionLimit,
    queuedCommands: 2,
    timerActive: true,
  })

  assert.equal(
    scheduler.runNext(),
    Math.floor(GATEWAY_DEFAULTS.outboundCommandQueueTimeoutMs / 2),
  )
  assert.deepEqual(await Promise.all([first, second]), ["sent", "sent"])
  assert.deepEqual(writes.slice(-2), ["queued-first", "queued-second"])
  assert.equal(budget.snapshot.eventsInWindow, 2)
})

test("Gateway outbound budget refuses control traffic at the absolute official ceiling", () => {
  const { budget, writes } = fixture()
  for (let index = 0; index < GATEWAY_DEFAULTS.outboundEventLimit; index += 1) {
    assert.equal(budget.sendControl(`control-${index}`), "sent")
  }
  assert.equal(budget.sendControl("control-excess"), "exhausted")
  assert.equal(writes.length, GATEWAY_DEFAULTS.outboundEventLimit)
  assert.equal(writes.includes("control-excess"), false)

  budget.reset()
  assert.equal(budget.sendControl("new-connection"), "sent")
  assert.deepEqual(budget.snapshot, {
    eventsInWindow: 1,
    queuedCommands: 0,
    timerActive: false,
  })
})

test("Gateway outbound budget counts only successful writes", async () => {
  const scheduler = new FakeScheduler()
  const attempts: string[] = []
  const budget = new GatewayOutboundBudget({
    clock: () => scheduler.now,
    scheduler,
    write(serialized) {
      attempts.push(serialized)
      return !serialized.includes("fail")
    },
  })

  assert.equal(budget.sendControl("control-fail"), "unavailable")
  assert.equal(budget.snapshot.eventsInWindow, 0)
  assert.equal(await budget.sendCommand("command-fail"), "unavailable")
  assert.equal(budget.snapshot.eventsInWindow, 0)
  assert.equal(await budget.sendCommand("command-success"), "sent")
  assert.equal(budget.snapshot.eventsInWindow, 1)
  assert.deepEqual(attempts, ["control-fail", "command-fail", "command-success"])
})

test("Gateway outbound budget bounds and resets its pending command queue", async () => {
  const { budget, scheduler } = fixture()
  for (let index = 0; index < GATEWAY_DEFAULTS.outboundCommandAdmissionLimit; index += 1) {
    assert.equal(budget.sendControl(`control-${index}`), "sent")
  }
  const pending = Array.from(
    { length: GATEWAY_DEFAULTS.outboundCommandQueueCapacity },
    (_, index) => budget.sendCommand(`pending-${index}`),
  )
  assert.equal(budget.snapshot.queuedCommands, GATEWAY_DEFAULTS.outboundCommandQueueCapacity)
  assert.equal(await budget.sendCommand("queue-excess"), "queue-full")

  budget.reset()
  assert.deepEqual(
    await Promise.all(pending),
    Array.from(
      { length: GATEWAY_DEFAULTS.outboundCommandQueueCapacity },
      () => "unavailable",
    ),
  )
  assert.deepEqual(budget.snapshot, {
    eventsInWindow: 0,
    queuedCommands: 0,
    timerActive: false,
  })
  assert.equal(scheduler.jobs.size, 0)
})

test("Gateway outbound budget removes an aborted command and its timer", async () => {
  const { budget, scheduler, writes } = fixture()
  for (let index = 0; index < GATEWAY_DEFAULTS.outboundCommandAdmissionLimit; index += 1) {
    assert.equal(budget.sendControl(`control-${index}`), "sent")
  }
  const controller = new AbortController()
  const pending = budget.sendCommand("private-guild-id", controller.signal)
  assert.equal(budget.snapshot.queuedCommands, 1)
  controller.abort()

  assert.equal(await pending, "cancelled")
  assert.equal(budget.snapshot.queuedCommands, 0)
  assert.equal(budget.snapshot.timerActive, false)
  assert.equal(scheduler.jobs.size, 0)
  assert.equal(writes.includes("private-guild-id"), false)
})

test("Gateway outbound budget fails closed on invalid clocks and scheduler failure", async () => {
  let now = Number.NaN
  const scheduler = new FakeScheduler()
  const invalidClock = new GatewayOutboundBudget({
    clock: () => now,
    scheduler,
    write: () => true,
  })
  assert.equal(invalidClock.sendControl("control"), "unavailable")
  assert.equal(await invalidClock.sendCommand("command"), "unavailable")
  now = 10
  assert.equal(invalidClock.sendControl("control"), "sent")
  now = 9
  assert.equal(invalidClock.sendControl("rollback"), "unavailable")

  const throwingScheduler = new GatewayOutboundBudget({
    clock: () => 0,
    scheduler: {
      clearTimeout() {},
      setTimeout() {
        throw new Error("private scheduler failure")
      },
    },
    write: () => true,
  })
  for (let index = 0; index < GATEWAY_DEFAULTS.outboundCommandAdmissionLimit; index += 1) {
    assert.equal(throwingScheduler.sendControl(`control-${index}`), "sent")
  }
  assert.equal(await throwingScheduler.sendCommand("command"), "unavailable")
  assert.equal(throwingScheduler.snapshot.queuedCommands, 0)
})

test("Gateway outbound budget rejects malformed construction and oversized payloads", async () => {
  assert.throws(
    () => new GatewayOutboundBudget({
      scheduler: {} as GatewayOutboundBudgetScheduler,
      write: () => true,
    }),
    /options are invalid/,
  )
  const { budget, writes } = fixture()
  const oversized = "x".repeat(GATEWAY_DEFAULTS.outboundPayloadBytes + 1)
  assert.equal(budget.sendControl(oversized), "unavailable")
  assert.equal(await budget.sendCommand(oversized), "unavailable")
  assert.deepEqual(writes, [])
})
