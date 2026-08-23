import assert from "node:assert/strict"
import { once } from "node:events"
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { spawn } from "node:child_process"
import test from "node:test"

import {
  WriteCoordinationConflictError,
  WriteCoordinationQuarantinedError,
  WriteCoordinationResolutionError,
  WriteCoordinationStateError,
} from "../src/errors.js"
import {
  FileOperationStore,
  operationKeyHash,
  type OperationKind,
  type OperationReceipt,
  type OperationReservation,
  type OperationStore,
} from "../src/operation-store.js"
import {
  FileWriteCoordinator,
  writeApplicationCollectionTarget,
  writeCoordinationTargetHash,
  writeGuildCollectionTarget,
  writeResourceTarget,
  type WriteCoordinationIntent,
  type WriteCoordinationTarget,
} from "../src/write-coordination.js"

const CHANNEL_ID = "200000000000000001"
const APPLICATION_ID = "150000000000000001"
const OTHER_CHANNEL_ID = "200000000000000002"
const GUILD_ID = "100000000000000001"
const MESSAGE_ID = "300000000000000001"
const OPERATION_KEY = "coordination-operation-0001"
const OTHER_OPERATION_KEY = "coordination-operation-0002"
const PLAN_DIGEST = `hmac-sha256:${"a".repeat(64)}`
const OTHER_PLAN_DIGEST = `hmac-sha256:${"b".repeat(64)}`
const CLAIM_ID = `claim_${"c".repeat(32)}`
const OTHER_CLAIM_ID = `claim_${"d".repeat(32)}`
const DEAD_PID = 2_000_000_000

class MemoryOperationStore implements OperationStore {
  readonly receipts = new Map<string, OperationReceipt>()

  #key(kind: OperationKind, hash: string): string {
    return `${kind}\0${hash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), receipt)
  }

  async get(
    kind: OperationKind,
    hash: string,
  ): Promise<OperationReceipt | undefined> {
    return this.receipts.get(this.#key(kind, hash))
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

class UnreadableOperationStore extends MemoryOperationStore {
  override async get(): Promise<OperationReceipt | undefined> {
    throw new Error("receipt store unavailable")
  }
}

function intent(
  targets: readonly WriteCoordinationTarget[] = [
    writeResourceTarget("channel", CHANNEL_ID),
  ],
  options: {
    kind?: OperationKind
    operationKey?: string
    planDigest?: string
  } = {},
): WriteCoordinationIntent {
  return {
    kind: options.kind || "channel-metadata-change",
    operationKeyHash: operationKeyHash(options.operationKey || OPERATION_KEY),
    planDigest: options.planDigest || PLAN_DIGEST,
    targets,
  }
}

function receipt(
  status: OperationReceipt["status"],
  options: {
    kind?: OperationReceipt["kind"]
    operationKey?: string
    planDigest?: string
  } = {},
): OperationReceipt {
  const kind = options.kind || "channel-metadata-change"
  const operationKeyHashValue = operationKeyHash(options.operationKey || OPERATION_KEY)
  return {
    activityId: "activity-0001",
    error: ["failed", "uncertain"].includes(status) ? "DiscordApiError.unknown" : null,
    guildId: GUILD_ID,
    kind,
    operationKeyHash: operationKeyHashValue,
    planDigest: options.planDigest || PLAN_DIGEST,
    resourceId: status === "completed" ? CHANNEL_ID : null,
    schemaVersion: 1,
    status,
    timestamp: "2026-08-22T01:00:00.000Z",
    verification: status === "completed" ? "match" : null,
  }
}

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-coordination-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const directory = join(root, "coordination")
  const operationStore = new MemoryOperationStore()
  const coordinator = new FileWriteCoordinator(directory, operationStore)
  return { coordinator, directory, operationStore, root }
}

async function initializeState(directory: string): Promise<void> {
  await mkdir(join(directory, "claims"), { mode: 0o700, recursive: true })
  await mkdir(join(directory, "staging"), { mode: 0o700, recursive: true })
  await mkdir(join(directory, "retired"), { mode: 0o700, recursive: true })
  await mkdir(join(directory, "resolutions"), { mode: 0o700, recursive: true })
}

async function writeStaleClaim(options: {
  claimId?: string
  directory: string
  kind?: OperationKind
  operationKey?: string
  ownerPid?: number
  planDigest?: string
  targets?: readonly WriteCoordinationTarget[]
}): Promise<void> {
  await initializeState(options.directory)
  const targets = [...(options.targets || [writeResourceTarget("channel", CHANNEL_ID)])]
  const record = {
    claimId: options.claimId || CLAIM_ID,
    createdAt: "2026-08-22T00:00:00.000Z",
    kind: options.kind || "channel-metadata-change",
    operationKeyHash: operationKeyHash(options.operationKey || OPERATION_KEY),
    ownerPid: options.ownerPid || DEAD_PID,
    planDigest: options.planDigest || PLAN_DIGEST,
    schemaVersion: 1,
    targets,
  }
  for (const target of targets) {
    const directory = join(
      options.directory,
      "claims",
      writeCoordinationTargetHash(target),
    )
    await mkdir(directory, { mode: 0o700 })
    await writeFile(
      join(directory, "claim.json"),
      `${JSON.stringify(record)}\n`,
      { mode: 0o600 },
    )
  }
}

async function claimFiles(directory: string): Promise<string[]> {
  const claims = join(directory, "claims")
  const targetDirectories = await readdir(claims).catch(() => [])
  return targetDirectories.map((target) => join(claims, target, "claim.json"))
}

test("write targets are strict, domain-hashed, and collection-aware", () => {
  const channel = writeResourceTarget("channel", CHANNEL_ID)
  const collection = writeGuildCollectionTarget("channels", GUILD_ID)
  const integration = writeResourceTarget("integration", MESSAGE_ID)
  const integrations = writeGuildCollectionTarget("integrations", GUILD_ID)
  const webhooks = writeGuildCollectionTarget("webhooks", GUILD_ID)
  const applicationEmojis = writeApplicationCollectionTarget(
    "emojis",
    APPLICATION_ID,
  )

  assert.deepEqual(channel, { id: CHANNEL_ID, kind: "channel" })
  assert.deepEqual(collection, {
    collection: "channels",
    guildId: GUILD_ID,
    kind: "guild-collection",
  })
  assert.deepEqual(integration, { id: MESSAGE_ID, kind: "integration" })
  assert.deepEqual(integrations, {
    collection: "integrations",
    guildId: GUILD_ID,
    kind: "guild-collection",
  })
  assert.deepEqual(webhooks, {
    collection: "webhooks",
    guildId: GUILD_ID,
    kind: "guild-collection",
  })
  assert.deepEqual(applicationEmojis, {
    applicationId: APPLICATION_ID,
    collection: "emojis",
    kind: "application-collection",
  })
  assert.match(writeCoordinationTargetHash(channel), /^[a-f0-9]{64}$/)
  assert.equal(
    writeCoordinationTargetHash(channel),
    writeCoordinationTargetHash(channel),
  )
  assert.notEqual(
    writeCoordinationTargetHash(channel),
    writeCoordinationTargetHash(writeResourceTarget("message", CHANNEL_ID)),
  )
  assert.throws(() => writeResourceTarget("channel", "invalid"), /target is invalid/)
  assert.throws(
    () => writeGuildCollectionTarget("channels", "invalid"),
    /target is invalid/,
  )
  assert.throws(
    () => writeApplicationCollectionTarget("emojis", "invalid"),
    /target is invalid/,
  )
})

test("coordination rejects invalid construction and intent identities", async (context) => {
  const operationStore = new MemoryOperationStore()
  assert.throws(
    () => new FileWriteCoordinator("relative", operationStore),
    /normalized absolute path/,
  )
  assert.throws(
    () => new FileWriteCoordinator("/test/coordination", operationStore, {
      ownerPid: 0,
    }),
    /owner PID is invalid/,
  )

  const { directory } = await fixture(context)
  const invalidClaimId = new FileWriteCoordinator(directory, operationStore, {
    randomId: () => "invalid",
  })
  await assert.rejects(
    () => invalidClaimId.run(intent(), async () => "unsafe"),
    WriteCoordinationStateError,
  )
  const coordinator = new FileWriteCoordinator(directory, operationStore)
  await assert.rejects(
    () => coordinator.run({
      ...intent(),
      operationKeyHash: "invalid",
    }, async () => "unsafe"),
    WriteCoordinationStateError,
  )
  assert.deepEqual(await claimFiles(directory), [])

  await assert.rejects(
    () => invalidClaimId.run(intent([
      writeApplicationCollectionTarget("emojis", APPLICATION_ID),
    ]), async () => "unsafe"),
    /target scope does not match its operation/,
  )
  await assert.rejects(
    () => invalidClaimId.run(intent([
      writeGuildCollectionTarget("emojis", GUILD_ID),
    ], {
      kind: "application-emoji-change",
    }), async () => "unsafe"),
    /target scope does not match its operation/,
  )
  await assert.rejects(
    () => invalidClaimId.run(intent([
      writeApplicationCollectionTarget("emojis", APPLICATION_ID),
      writeApplicationCollectionTarget("emojis", GUILD_ID),
    ], {
      kind: "application-emoji-change",
    }), async () => "unsafe"),
    /requires one application collection target/,
  )
})

test("application emoji claims use one application-wide target", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-application-coordination-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const directory = join(root, "coordination")
  const operationStore = new FileOperationStore(join(root, "operations"))
  const coordinator = new FileWriteCoordinator(directory, operationStore)
  const target = writeApplicationCollectionTarget("emojis", APPLICATION_ID)
  const operationKeyHashValue = operationKeyHash(OPERATION_KEY)
  const result = await coordinator.run(intent([target], {
    kind: "application-emoji-change",
  }), async () => {
    const pending = {
      activityId: "application-emoji-activity-0001",
      applicationId: APPLICATION_ID,
      error: null,
      kind: "application-emoji-change" as const,
      operationKeyHash: operationKeyHashValue,
      planDigest: PLAN_DIGEST,
      resourceId: null,
      schemaVersion: 1 as const,
      status: "pending" as const,
      timestamp: "2026-08-23T00:00:00.000Z",
      verification: null,
    }
    await operationStore.reserveApplication(pending)
    await operationStore.finishApplication({
      ...pending,
      resourceId: MESSAGE_ID,
      status: "completed",
      timestamp: "2026-08-23T00:00:01.000Z",
      verification: "match",
    })
    return "application-wide"
  })

  assert.equal(result, "application-wide")
  assert.deepEqual(await claimFiles(directory), [])
  assert.notEqual(
    writeCoordinationTargetHash(target),
    writeCoordinationTargetHash(writeGuildCollectionTarget("emojis", APPLICATION_ID)),
  )
})

test("coordination accepts one exact maximum-size deletion batch and rejects expansion", async (context) => {
  const { coordinator, directory } = await fixture(context)
  const messageTargets = Array.from(
    { length: 100 },
    (_, index) => writeResourceTarget(
      "message",
      (300_000_000_000_000_001n + BigInt(index)).toString(),
    ),
  )
  let publishedTargets = 0

  const result = await coordinator.run({
    kind: "message-deletion",
    operationKeyHash: operationKeyHash(OPERATION_KEY),
    planDigest: PLAN_DIGEST,
    targets: messageTargets,
  }, async () => {
    publishedTargets = (await claimFiles(directory)).length
    return "done"
  })

  assert.equal(result, "done")
  assert.equal(publishedTargets, 100)
  assert.deepEqual(await claimFiles(directory), [])
  await assert.rejects(
    () => coordinator.run({
      kind: "message-deletion",
      operationKeyHash: operationKeyHash(OTHER_OPERATION_KEY),
      planDigest: PLAN_DIGEST,
      targets: [
        ...messageTargets,
        writeResourceTarget("message", "300000000000000101"),
      ],
    }, async () => "unsafe"),
    /requires 1-100 targets/,
  )
  await assert.rejects(
    () => coordinator.run(intent(messageTargets.slice(0, 9)), async () => "unsafe"),
    /requires 1-8 targets for channel-metadata-change/,
  )
})

test("file coordinator publishes private content-free claims and releases them", async (context) => {
  const { coordinator, directory } = await fixture(context)
  let release: (() => void) | undefined
  let started: (() => void) | undefined
  const operationStarted = new Promise<void>((resolvePromise) => {
    started = resolvePromise
  })
  const operationRelease = new Promise<void>((resolvePromise) => {
    release = resolvePromise
  })

  const running = coordinator.run(intent([
    writeResourceTarget("message", MESSAGE_ID),
    writeResourceTarget("channel", CHANNEL_ID),
    writeResourceTarget("channel", CHANNEL_ID),
  ]), async () => {
    started?.()
    await operationRelease
    return "done"
  })
  await operationStarted

  const files = await claimFiles(directory)
  assert.equal(files.length, 2)
  const serialized = (await Promise.all(files.map((file) => readFile(file, "utf8"))))
    .join("\n")
  assert.doesNotMatch(serialized, new RegExp(OPERATION_KEY))
  assert.doesNotMatch(serialized, /private content|audit reason|https?:\/\//)
  assert.equal((await lstat(directory)).mode & 0o777, 0o700)
  for (const file of files) {
    assert.equal((await lstat(file)).mode & 0o777, 0o600)
    assert.equal((await lstat(join(file, ".."))).mode & 0o777, 0o700)
  }
  const listed = await coordinator.list()
  assert.equal(listed.claims.length, 1)
  assert.equal(listed.claims[0]?.publishedTargetCount, 2)
  assert.equal(listed.claims[0]?.state, "active")

  release?.()
  assert.equal(await running, "done")
  assert.deepEqual(await claimFiles(directory), [])
})

test("claim listing tolerates an atomic concurrent release", async (context) => {
  const { coordinator } = await fixture(context)
  let release: (() => void) | undefined
  let started: (() => void) | undefined
  const operationStarted = new Promise<void>((resolvePromise) => {
    started = resolvePromise
  })
  const operationRelease = new Promise<void>((resolvePromise) => {
    release = resolvePromise
  })
  const running = coordinator.run(intent(), async () => {
    started?.()
    await operationRelease
    return "done"
  })
  await operationStarted

  const listings = Array.from({ length: 100 }, () => coordinator.list())
  release?.()
  const reports = await Promise.all(listings)
  assert.equal(await running, "done")
  assert.equal(
    reports.every((report) => report.status === "ok"),
    true,
  )
})

test("claim listing rejects an incomplete state hierarchy", async (context) => {
  const { coordinator, directory } = await fixture(context)
  await initializeState(directory)
  await rm(join(directory, "resolutions"), { recursive: true })

  await assert.rejects(
    () => coordinator.list(),
    /coordination directory is incomplete/,
  )
})

test("overlapping same-process claims wait while disjoint targets remain concurrent", async (context) => {
  const { directory, operationStore, root } = await fixture(context)
  const aliasRoot = join(root, "alias")
  await symlink(root, aliasRoot)
  const first = new FileWriteCoordinator(directory, operationStore)
  const second = new FileWriteCoordinator(
    join(aliasRoot, "coordination"),
    operationStore,
  )
  let releaseFirst: (() => void) | undefined
  let firstStarted: (() => void) | undefined
  let secondStarted = false
  let disjointStarted = false
  const firstReady = new Promise<void>((resolvePromise) => {
    firstStarted = resolvePromise
  })
  const firstRelease = new Promise<void>((resolvePromise) => {
    releaseFirst = resolvePromise
  })
  let markDisjointStarted: (() => void) | undefined
  const disjointReady = new Promise<void>((resolvePromise) => {
    markDisjointStarted = resolvePromise
  })

  const firstRun = first.run(intent(), async () => {
    firstStarted?.()
    await firstRelease
    return "first"
  })
  await firstReady
  const secondRun = second.run(intent(undefined, {
    operationKey: OTHER_OPERATION_KEY,
    planDigest: OTHER_PLAN_DIGEST,
  }), async () => {
    secondStarted = true
    return "second"
  })
  const disjointRun = second.run(intent([
    writeResourceTarget("channel", OTHER_CHANNEL_ID),
  ], {
    operationKey: "coordination-operation-0003",
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
  }), async () => {
    disjointStarted = true
    markDisjointStarted?.()
    return "disjoint"
  })

  await disjointReady
  assert.equal(secondStarted, false)
  assert.equal(disjointStarted, true)
  assert.equal(await disjointRun, "disjoint")
  releaseFirst?.()
  assert.equal(await firstRun, "first")
  assert.equal(await secondRun, "second")
  assert.equal(secondStarted, true)
})

test("failed partial acquisition releases owned targets without running the callback", async (context) => {
  const { directory, operationStore } = await fixture(context)
  const blockedTarget = writeResourceTarget("message", MESSAGE_ID)
  await writeStaleClaim({
    directory,
    targets: [blockedTarget],
  })
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive: (pid) => pid === DEAD_PID,
  })
  let callbackCalled = false

  await assert.rejects(
    () => coordinator.run(intent([
      writeResourceTarget("channel", CHANNEL_ID),
      blockedTarget,
    ], {
      operationKey: OTHER_OPERATION_KEY,
      planDigest: OTHER_PLAN_DIGEST,
    }), async () => {
      callbackCalled = true
      return "unsafe"
    }),
    WriteCoordinationConflictError,
  )
  assert.equal(callbackCalled, false)
  const files = await claimFiles(directory)
  assert.deepEqual(files, [join(
    directory,
    "claims",
    writeCoordinationTargetHash(blockedTarget),
    "claim.json",
  )])
})

test("dead claims recover only from safe receipt evidence", async (context) => {
  const { directory, operationStore } = await fixture(context)
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive: (pid) => pid !== DEAD_PID,
  })

  await writeStaleClaim({ directory })
  assert.equal(await coordinator.run(intent(undefined, {
    operationKey: OTHER_OPERATION_KEY,
    planDigest: OTHER_PLAN_DIGEST,
  }), async () => "recovered-missing"), "recovered-missing")

  await writeStaleClaim({ directory })
  operationStore.receipts.set(
    `channel-metadata-change\0${operationKeyHash(OPERATION_KEY)}`,
    receipt("completed"),
  )
  assert.equal(await coordinator.run(intent(undefined, {
    operationKey: OTHER_OPERATION_KEY,
    planDigest: OTHER_PLAN_DIGEST,
  }), async () => "recovered-terminal"), "recovered-terminal")

  await writeStaleClaim({ directory })
  operationStore.receipts.set(
    `channel-metadata-change\0${operationKeyHash(OPERATION_KEY)}`,
    receipt("failed"),
  )
  assert.equal(await coordinator.run(intent(undefined, {
    operationKey: OTHER_OPERATION_KEY,
    planDigest: OTHER_PLAN_DIGEST,
  }), async () => "recovered-failed"), "recovered-failed")

  await writeStaleClaim({ directory, planDigest: OTHER_PLAN_DIGEST })
  assert.equal(await coordinator.run(intent(undefined, {
    operationKey: OTHER_OPERATION_KEY,
    planDigest: OTHER_PLAN_DIGEST,
  }), async () => "recovered-different-plan"), "recovered-different-plan")
})

test("pending and uncertain dead claims remain quarantined", async (context) => {
  const { directory, operationStore } = await fixture(context)
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive: () => false,
  })

  await writeStaleClaim({ directory })
  operationStore.receipts.set(
    `channel-metadata-change\0${operationKeyHash(OPERATION_KEY)}`,
    receipt("pending"),
  )
  await assert.rejects(
    () => coordinator.run(intent(undefined, {
      operationKey: OTHER_OPERATION_KEY,
      planDigest: OTHER_PLAN_DIGEST,
    }), async () => "unsafe"),
    WriteCoordinationQuarantinedError,
  )
  assert.equal((await coordinator.list()).claims[0]?.state, "review-required")

  operationStore.receipts.set(
    `channel-metadata-change\0${operationKeyHash(OPERATION_KEY)}`,
    receipt("uncertain"),
  )
  await assert.rejects(
    () => coordinator.run(intent(undefined, {
      operationKey: OTHER_OPERATION_KEY,
      planDigest: OTHER_PLAN_DIGEST,
    }), async () => "unsafe"),
    WriteCoordinationQuarantinedError,
  )
})

test("unknown owner liveness remains quarantined", async (context) => {
  const { directory, operationStore } = await fixture(context)
  await writeStaleClaim({ directory })
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive() {
      throw new Error("liveness unavailable")
    },
  })

  const [listed] = (await coordinator.list()).claims
  assert.equal(listed?.ownerState, "unknown")
  assert.equal(listed?.state, "review-required")
  await assert.rejects(
    () => coordinator.run(intent(undefined, {
      operationKey: OTHER_OPERATION_KEY,
      planDigest: OTHER_PLAN_DIGEST,
    }), async () => "unsafe"),
    WriteCoordinationQuarantinedError,
  )
})

test("unreadable receipt evidence remains quarantined", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-coordination-unreadable-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const directory = join(root, "coordination")
  const coordinator = new FileWriteCoordinator(
    directory,
    new UnreadableOperationStore(),
    { processAlive: () => false },
  )
  await writeStaleClaim({ directory })

  const listed = await coordinator.list()
  assert.equal(listed.claims[0]?.receiptState, "unreadable")
  assert.equal(listed.claims[0]?.state, "review-required")
  await assert.rejects(
    () => coordinator.run(intent(undefined, {
      operationKey: OTHER_OPERATION_KEY,
      planDigest: OTHER_PLAN_DIGEST,
    }), async () => "unsafe"),
    WriteCoordinationQuarantinedError,
  )
})

test("application claims stay quarantined when application receipt evidence is unsupported", async (context) => {
  const { directory, operationStore } = await fixture(context)
  const target = writeApplicationCollectionTarget("emojis", APPLICATION_ID)
  await writeStaleClaim({
    directory,
    kind: "application-emoji-change",
    targets: [target],
  })
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive: () => false,
  })

  const [listed] = (await coordinator.list()).claims
  assert.equal(listed?.receiptState, "unreadable")
  assert.equal(listed?.state, "review-required")
  await assert.rejects(
    () => coordinator.run(intent([target], {
      kind: "application-emoji-change",
      operationKey: OTHER_OPERATION_KEY,
      planDigest: OTHER_PLAN_DIGEST,
    }), async () => "unsafe"),
    WriteCoordinationQuarantinedError,
  )
})

test("partial multi-target publication remains recoverable without widening scope", async (context) => {
  const { directory, operationStore } = await fixture(context)
  const targets = [
    writeResourceTarget("channel", CHANNEL_ID),
    writeResourceTarget("message", MESSAGE_ID),
  ] as const
  await writeStaleClaim({ directory, targets })
  await rm(join(
    directory,
    "claims",
    writeCoordinationTargetHash(targets[1]),
  ), { recursive: true })
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive: () => false,
  })

  const [listed] = (await coordinator.list()).claims
  assert.equal(listed?.publishedTargetCount, 1)
  assert.equal(listed?.state, "auto-reclaimable")
  assert.deepEqual(listed?.targets, targets)
  assert.equal(await coordinator.run(intent([targets[0]], {
    operationKey: OTHER_OPERATION_KEY,
    planDigest: OTHER_PLAN_DIGEST,
  }), async () => "recovered"), "recovered")
  assert.deepEqual(await claimFiles(directory), [])
})

test("callback outcomes release settled claims and retain ambiguous claims", async (context) => {
  const { coordinator, directory, operationStore } = await fixture(context)
  const preReservation = new Error("pre-reservation")
  await assert.rejects(
    () => coordinator.run(intent(), async () => {
      throw preReservation
    }),
    (error: unknown) => error === preReservation,
  )
  assert.deepEqual(await claimFiles(directory), [])

  const terminal = new Error("known-terminal")
  await assert.rejects(
    () => coordinator.run(intent(), async () => {
      await operationStore.reserve(receipt("pending"))
      await operationStore.finish(receipt("failed"))
      throw terminal
    }),
    (error: unknown) => error === terminal,
  )
  assert.deepEqual(await claimFiles(directory), [])

  operationStore.receipts.clear()
  await assert.rejects(
    () => coordinator.run(intent(), async () => {
      await operationStore.reserve(receipt("pending"))
      throw new Error("ambiguous")
    }),
    WriteCoordinationQuarantinedError,
  )
  assert.equal((await claimFiles(directory)).length, 1)

  await coordinator.resolve(
    (await coordinator.list()).claims[0]!.claimId,
    (await coordinator.list()).claims[0]!.claimId,
  )
  operationStore.receipts.clear()
  await assert.rejects(
    () => coordinator.run(intent(), async () => {
      await operationStore.reserve(receipt("pending"))
      return "ambiguous-success"
    }),
    WriteCoordinationQuarantinedError,
  )
  assert.equal((await coordinator.list()).claims[0]?.receiptState, "pending")
})

test("only a normally paused guild scaffold may release a matching pending receipt", async (context) => {
  const normal = await fixture(context)
  const scaffoldIntent = intent([
    writeGuildCollectionTarget("channels", GUILD_ID),
    writeGuildCollectionTarget("roles", GUILD_ID),
  ], { kind: "guild-scaffold" })
  const result = await normal.coordinator.run(
    scaffoldIntent,
    async () => {
      await normal.operationStore.reserve(receipt("pending", {
        kind: "guild-scaffold",
      }))
      return { status: "paused" as const }
    },
    { releasePendingScaffoldOnVerifiedPause: true },
  )
  assert.equal(result.status, "paused")
  assert.deepEqual(await claimFiles(normal.directory), [])
  assert.equal(
    normal.operationStore.receipts.get(
      `guild-scaffold\0${operationKeyHash(OPERATION_KEY)}`,
    )?.status,
    "pending",
  )

  const unsupported = await fixture(context)
  let called = false
  await assert.rejects(
    () => unsupported.coordinator.run(
      intent(),
      async () => {
        called = true
        return "unsafe"
      },
      { releasePendingScaffoldOnVerifiedPause: true },
    ),
    /Only Discord guild scaffolds/,
  )
  assert.equal(called, false)
  assert.deepEqual(await claimFiles(unsupported.directory), [])

  const notPaused = await fixture(context)
  await assert.rejects(
    () => notPaused.coordinator.run(
      scaffoldIntent,
      async () => {
        await notPaused.operationStore.reserve(receipt("pending", {
          kind: "guild-scaffold",
        }))
        return { status: "completed" as const }
      },
      { releasePendingScaffoldOnVerifiedPause: true },
    ),
    WriteCoordinationQuarantinedError,
  )
  assert.equal(
    (await notPaused.coordinator.list()).claims[0]?.state,
    "review-required",
  )

  const interrupted = await fixture(context)
  await assert.rejects(
    () => interrupted.coordinator.run(
      scaffoldIntent,
      async () => {
        await interrupted.operationStore.reserve(receipt("pending", {
          kind: "guild-scaffold",
        }))
        throw new Error("interrupted")
      },
      { releasePendingScaffoldOnVerifiedPause: true },
    ),
    WriteCoordinationQuarantinedError,
  )
  assert.equal(
    (await interrupted.coordinator.list()).claims[0]?.state,
    "review-required",
  )
  assert.equal((await claimFiles(interrupted.directory)).length, 2)
})

test("claim cleanup failure reports safely and remains recoverable", async (context) => {
  const { coordinator, directory } = await fixture(context)
  try {
    await assert.rejects(
      () => coordinator.run(intent(), async () => {
        await chmod(join(directory, "claims"), 0o500)
        return "completed-before-cleanup"
      }),
      WriteCoordinationStateError,
    )
  } finally {
    await chmod(join(directory, "claims"), 0o700)
  }

  const [listed] = (await coordinator.list()).claims
  assert.equal(listed?.state, "auto-reclaimable")
  assert.equal(await coordinator.run(intent(undefined, {
    operationKey: OTHER_OPERATION_KEY,
    planDigest: OTHER_PLAN_DIGEST,
  }), async () => "recovered"), "recovered")
  assert.deepEqual(await claimFiles(directory), [])
})

test("operator resolution requires exact confirmation and a stopped owner", async (context) => {
  const { directory, operationStore } = await fixture(context)
  await writeStaleClaim({ directory })
  operationStore.receipts.set(
    `channel-metadata-change\0${operationKeyHash(OPERATION_KEY)}`,
    receipt("pending"),
  )
  const live = new FileWriteCoordinator(directory, operationStore, {
    processAlive: () => true,
  })
  await assert.rejects(
    () => live.resolve(CLAIM_ID, CLAIM_ID),
    /owner must be stopped/,
  )

  const stopped = new FileWriteCoordinator(directory, operationStore, {
    clock: () => new Date("2026-08-22T02:00:00.000Z"),
    processAlive: () => false,
  })
  await assert.rejects(
    () => stopped.resolve(CLAIM_ID, OTHER_CLAIM_ID),
    WriteCoordinationResolutionError,
  )
  assert.deepEqual(await stopped.resolve(CLAIM_ID, CLAIM_ID), {
    claimId: CLAIM_ID,
    releasedTargetCount: 1,
    schemaVersion: 1,
    status: "resolved",
  })
  assert.deepEqual(await claimFiles(directory), [])
  const acknowledgement = await readFile(
    join(directory, "resolutions", CLAIM_ID, "acknowledgement.json"),
    "utf8",
  )
  assert.match(acknowledgement, /operator-reviewed/)
  assert.doesNotMatch(acknowledgement, new RegExp(OPERATION_KEY))
  assert.deepEqual(await stopped.resolve(CLAIM_ID, CLAIM_ID), {
    claimId: CLAIM_ID,
    releasedTargetCount: 0,
    schemaVersion: 1,
    status: "already-resolved",
  })
})

test("operator resolution resumes after acknowledgement and partial release", async (context) => {
  const { directory, operationStore } = await fixture(context)
  const targets = [
    writeResourceTarget("channel", CHANNEL_ID),
    writeResourceTarget("message", MESSAGE_ID),
  ] as const
  await writeStaleClaim({ directory, targets })
  const firstHash = writeCoordinationTargetHash(targets[0])
  const firstClaimDirectory = join(directory, "claims", firstHash)
  const claim = JSON.parse(await readFile(
    join(firstClaimDirectory, "claim.json"),
    "utf8",
  )) as Record<string, unknown>
  const resolutionDirectory = join(directory, "resolutions", CLAIM_ID)
  await mkdir(resolutionDirectory, { mode: 0o700 })
  await writeFile(
    join(resolutionDirectory, "acknowledgement.json"),
    `${JSON.stringify({
      claim,
      reason: "operator-reviewed",
      resolvedAt: "2026-08-22T02:00:00.000Z",
      resolverPid: 1234,
      schemaVersion: 1,
    })}\n`,
    { mode: 0o600 },
  )
  await rename(
    firstClaimDirectory,
    join(directory, "retired", `${CLAIM_ID}-${firstHash}`),
  )
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive: () => false,
  })

  assert.deepEqual(await coordinator.resolve(CLAIM_ID, CLAIM_ID), {
    claimId: CLAIM_ID,
    releasedTargetCount: 1,
    schemaVersion: 1,
    status: "resolved",
  })
  assert.deepEqual(await claimFiles(directory), [])
  assert.deepEqual(await readdir(join(directory, "retired")), [])
  assert.equal(
    (await coordinator.resolve(CLAIM_ID, CLAIM_ID)).status,
    "already-resolved",
  )
})

test("concurrent operator resolution publishes one immutable acknowledgement", async (context) => {
  const { directory, operationStore } = await fixture(context)
  await writeStaleClaim({ directory })
  const first = new FileWriteCoordinator(directory, operationStore, {
    ownerPid: 1234,
    processAlive: () => false,
  })
  const second = new FileWriteCoordinator(directory, operationStore, {
    ownerPid: 5678,
    processAlive: () => false,
  })

  const results = await Promise.all([
    first.resolve(CLAIM_ID, CLAIM_ID),
    second.resolve(CLAIM_ID, CLAIM_ID),
  ])
  assert.equal(
    results.reduce((sum, result) => sum + result.releasedTargetCount, 0),
    1,
  )
  assert.deepEqual(await claimFiles(directory), [])
  const acknowledgement = JSON.parse(await readFile(
    join(directory, "resolutions", CLAIM_ID, "acknowledgement.json"),
    "utf8",
  )) as Record<string, unknown>
  assert.equal(acknowledgement.reason, "operator-reviewed")
})

test("coordination state rejects public, linked, malformed, and oversized records", async (context) => {
  const { directory, operationStore, root } = await fixture(context)
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive: () => false,
  })
  await writeStaleClaim({ directory })
  const [file] = await claimFiles(directory)
  if (!file) throw new Error("claim fixture missing")
  const original = await readFile(file, "utf8")

  await chmod(file, 0o644)
  await assert.rejects(() => coordinator.list(), WriteCoordinationStateError)
  await chmod(file, 0o600)
  const linked = join(root, "linked-claim.json")
  await link(file, linked)
  await assert.rejects(() => coordinator.list(), WriteCoordinationStateError)
  await rm(linked)

  await writeFile(file, "{\n")
  await assert.rejects(() => coordinator.list(), WriteCoordinationStateError)
  await writeFile(file, `${original}\n`)
  await assert.rejects(() => coordinator.list(), WriteCoordinationStateError)
  await writeFile(file, `${"x".repeat(16_384)}\n`)
  await assert.rejects(() => coordinator.list(), WriteCoordinationStateError)

  const symlinkTarget = join(root, "symlink-target.json")
  await writeFile(symlinkTarget, original, { mode: 0o600 })
  await rm(file)
  await symlink(symlinkTarget, file)
  await assert.rejects(() => coordinator.list(), WriteCoordinationStateError)
})

test("coordination state rejects inconsistent multi-target records", async (context) => {
  const { directory, operationStore } = await fixture(context)
  const targets = [
    writeResourceTarget("channel", CHANNEL_ID),
    writeResourceTarget("message", MESSAGE_ID),
  ] as const
  await writeStaleClaim({ directory, targets })
  const messageFile = join(
    directory,
    "claims",
    writeCoordinationTargetHash(targets[1]),
    "claim.json",
  )
  const changed = JSON.parse(await readFile(messageFile, "utf8")) as Record<string, unknown>
  changed.planDigest = OTHER_PLAN_DIGEST
  await writeFile(messageFile, `${JSON.stringify(changed)}\n`)
  const coordinator = new FileWriteCoordinator(directory, operationStore, {
    processAlive: () => false,
  })

  await assert.rejects(
    () => coordinator.list(),
    /claim ID has conflicting records/,
  )
})

test("a live child process owns its target and a dead pre-reservation child is recovered", async (context) => {
  const { directory, operationStore } = await fixture(context)
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "src", "write-coordination.ts"),
  ).href
  const storeUrl = pathToFileURL(join(process.cwd(), "src", "operation-store.ts")).href
  const script = `
    import { FileWriteCoordinator, writeResourceTarget } from ${JSON.stringify(moduleUrl)}
    import { operationKeyHash } from ${JSON.stringify(storeUrl)}
    const store = { finish: async () => {}, get: async () => undefined, reserve: async (receipt) => ({ created: true, receipt }) }
    const coordinator = new FileWriteCoordinator(${JSON.stringify(directory)}, store)
    await coordinator.run({
      kind: "channel-metadata-change",
      operationKeyHash: operationKeyHash(${JSON.stringify(OPERATION_KEY)}),
      planDigest: ${JSON.stringify(PLAN_DIGEST)},
      targets: [writeResourceTarget("channel", ${JSON.stringify(CHANNEL_ID)})],
    }, async () => {
      process.stdout.write("held\\n")
      setInterval(() => {}, 1000)
      await new Promise(() => {})
    })
  `
  const child = spawn(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    script,
  ], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  })
  context.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM")
  })
  const [chunk] = await once(child.stdout, "data") as [Buffer]
  assert.equal(chunk.toString("utf8"), "held\n")

  const coordinator = new FileWriteCoordinator(directory, operationStore)
  await assert.rejects(
    () => coordinator.run(intent(undefined, {
      operationKey: OTHER_OPERATION_KEY,
      planDigest: OTHER_PLAN_DIGEST,
    }), async () => "blocked"),
    WriteCoordinationConflictError,
  )
  child.kill("SIGTERM")
  await once(child, "close")

  assert.equal(await coordinator.run(intent(undefined, {
    operationKey: OTHER_OPERATION_KEY,
    planDigest: OTHER_PLAN_DIGEST,
  }), async () => "recovered"), "recovered")
})
