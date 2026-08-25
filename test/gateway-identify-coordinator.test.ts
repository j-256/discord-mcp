import assert from "node:assert/strict"
import test from "node:test"

import { GATEWAY_DEFAULTS } from "../src/constants.js"
import {
  GatewayIdentifyCoordinator,
  type GatewayIdentifyFailureCategory,
  type GatewayIdentifyScheduler,
} from "../src/gateway-identify-coordinator.js"

class FakeScheduler implements GatewayIdentifyScheduler {
  #nextId = 1
  readonly jobs = new Map<number, { due: number; handler: () => void }>()
  now = 0

  clearTimeout(handle: unknown): void {
    this.jobs.delete(handle as number)
  }

  setTimeout(handler: () => void, milliseconds: number): unknown {
    const id = this.#nextId
    this.#nextId += 1
    this.jobs.set(id, { due: this.now + milliseconds, handler })
    return id
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
}

function fixture(options: {
  maxConcurrency?: number
  remaining?: number
  shardCount?: number
  shardIds?: readonly number[]
} = {}) {
  const failures: GatewayIdentifyFailureCategory[] = []
  const identifies: number[] = []
  const scheduler = new FakeScheduler()
  const shardIds = options.shardIds ?? [0, 1, 2, 3]
  const coordinator = new GatewayIdentifyCoordinator({
    clock: () => scheduler.now,
    maxConcurrency: options.maxConcurrency ?? 2,
    onFailure(category) {
      failures.push(category)
    },
    onIdentify() {
      identifies.push(scheduler.now)
    },
    remaining: options.remaining ?? 100,
    scheduler,
    shardCount: options.shardCount ?? Math.max(...shardIds) + 1,
    shardIds,
  })
  return { coordinator, failures, identifies, scheduler }
}

test("Gateway Identify coordinator runs independent keys concurrently in shard order", () => {
  const { coordinator, identifies, scheduler } = fixture()
  const sent: number[] = []

  coordinator.request(2, () => { sent.push(2); return true })
  coordinator.request(3, () => { sent.push(3); return true })
  coordinator.request(1, () => { sent.push(1); return true })
  coordinator.request(0, () => { sent.push(0); return true })

  assert.deepEqual(sent, [1, 0])
  assert.deepEqual(identifies, [0, 0])
  assert.equal(scheduler.jobs.size, 2)
  assert.equal(scheduler.runNext(), GATEWAY_DEFAULTS.identifyMinimumIntervalMs)
  assert.equal(scheduler.runNext(), 0)
  assert.deepEqual(sent, [1, 0, 3, 2])
  assert.deepEqual(identifies, [0, 0, 5_000, 5_000])
  assert.equal(coordinator.remaining, 96)
})

test("Gateway Identify coordinator cancels a queued retry without spending allowance", () => {
  const { coordinator, identifies, scheduler } = fixture({ shardIds: [0] })
  const sent: string[] = []
  coordinator.request(0, () => { sent.push("initial"); return true })
  const cancel = coordinator.request(0, () => { sent.push("retry"); return true })

  assert.equal(scheduler.jobs.size, 1)
  cancel()
  assert.equal(scheduler.jobs.size, 1)
  assert.equal(scheduler.runNext(), GATEWAY_DEFAULTS.identifyMinimumIntervalMs)
  assert.deepEqual(sent, ["initial"])
  assert.deepEqual(identifies, [0])
  assert.equal(coordinator.remaining, 99)
})

test("Gateway Identify coordinator retries an unsent initial position before its follower", () => {
  const { coordinator, scheduler } = fixture({ maxConcurrency: 1, shardIds: [0, 1] })
  const sent: string[] = []
  coordinator.request(0, () => false)
  coordinator.request(1, () => { sent.push("one"); return true })

  assert.equal(sent.length, 0)
  coordinator.request(0, () => { sent.push("zero"); return true })
  assert.deepEqual(sent, ["zero"])
  assert.equal(scheduler.runNext(), GATEWAY_DEFAULTS.identifyMinimumIntervalMs)
  assert.deepEqual(sent, ["zero", "one"])
})

test("Gateway Identify coordinator shares the observed remaining allowance", () => {
  const { coordinator, failures } = fixture({ remaining: 1, shardIds: [0, 1] })
  const sent: number[] = []
  coordinator.request(0, () => { sent.push(0); return true })
  coordinator.request(1, () => { sent.push(1); return true })

  assert.deepEqual(sent, [0])
  assert.deepEqual(failures, ["session-start-limit-exhausted"])
  assert.equal(coordinator.remaining, 0)
})

test("Gateway Identify loop budgets are isolated per shard", () => {
  const { coordinator, failures, scheduler } = fixture({
    maxConcurrency: 2,
    shardIds: [0, 1],
  })
  const sent = new Map([[0, 0], [1, 0]])
  const request = (shardId: number) => coordinator.request(shardId, () => {
    sent.set(shardId, (sent.get(shardId) || 0) + 1)
    return true
  })

  request(0)
  request(1)
  for (let index = 1; index < GATEWAY_DEFAULTS.identifyBudget; index += 1) {
    request(0)
    request(1)
    assert.equal(scheduler.runNext(), GATEWAY_DEFAULTS.identifyMinimumIntervalMs)
    assert.equal(scheduler.runNext(), 0)
  }
  assert.deepEqual([...sent.values()], [10, 10])
  request(0)
  assert.equal(scheduler.runNext(), GATEWAY_DEFAULTS.identifyMinimumIntervalMs)
  assert.deepEqual(failures, ["identify-budget-exhausted"])
  assert.equal(sent.get(0), 10)
})

test("Gateway Identify stop cancels timers and rejects later requests", () => {
  const { coordinator, scheduler } = fixture({ shardIds: [0] })
  coordinator.request(0, () => true)
  coordinator.request(0, () => true)
  assert.equal(scheduler.jobs.size, 1)

  coordinator.stop()

  assert.equal(scheduler.jobs.size, 0)
  assert.throws(() => coordinator.request(0, () => true), /request is invalid/)
  assert.equal(scheduler.runNext(), undefined)
})

test("Gateway Identify coordinator validates its topology", () => {
  const scheduler = new FakeScheduler()
  for (const shardIds of [[], [1, 0], [0, 0], [-1]]) {
    assert.throws(
      () => new GatewayIdentifyCoordinator({
        maxConcurrency: 1,
        onFailure() {},
        remaining: 1,
        scheduler,
        shardCount: 4,
        shardIds,
      }),
      /coordinator options are invalid|unique and ascending/,
    )
  }
  assert.throws(
    () => new GatewayIdentifyCoordinator({
      maxConcurrency: 1,
      onFailure() {},
      remaining: 1,
      scheduler,
      shardCount: 1,
      shardIds: [1],
    }),
    /unique and ascending/,
  )
})
