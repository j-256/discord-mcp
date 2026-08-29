import assert from "node:assert/strict"
import { readdirSync, unlinkSync, writeFileSync } from "node:fs"
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import test from "node:test"

import { createConnectorConfigDocument } from "../src/config-document.js"
import { CONNECTOR_VERSION } from "../src/constants.js"
import {
  createHostAdapterCatalog,
  findHostAdapter,
  HOST_ADAPTER_IDS,
} from "../src/host-adapters.js"
import { createHostActivationPlan } from "../src/host-activation.js"
import {
  HOST_JSON_MAX_BYTES,
  HOST_JSON_MAX_NODES,
} from "../src/host-file.js"
import {
  applyHostAdapterFile,
  planHostAdapterFile,
} from "../src/host-installation.js"
import { createStdioLaunchDescriptor } from "../src/operator.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const POLICY_FILE = "/configuration/discord-mcp.json"
const TOKEN_ALIAS = "DISCORD_HOST_INSTALL_TOKEN"
const RAW_SECRET = "host-install-secret-that-must-never-escape"
const SERVER_NAME = "discord-install"

function activationPlan(serverName = SERVER_NAME) {
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "host-install-policy",
    toolsets: ["connector", "guilds"],
    toolSurface: "progressive",
  })
  const launch = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    args: ["--yes", `@j-256/discord-mcp@${CONNECTOR_VERSION}`, "serve"],
    botId: BOT_ID,
    command: "npx",
    config: { document, file: POLICY_FILE },
    serverName,
  })
  return createHostActivationPlan({
    document,
    launch,
    source: { file: POLICY_FILE, kind: "config" },
  })
}

function fileCredentialActivationPlan() {
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialFile: "/run/secrets/discord-bot-token",
    guildIds: [GUILD_ID],
    name: "host-install-file-policy",
    toolsets: ["connector", "guilds"],
    toolSurface: "progressive",
  })
  return createHostActivationPlan({
    document,
    launch: createStdioLaunchDescriptor({
      applicationId: APPLICATION_ID,
      botId: BOT_ID,
      profile: document,
      serverName: SERVER_NAME,
    }),
    source: { kind: "profile", name: document.name },
  })
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
}

async function fixture(context: test.TestContext, name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `discord-mcp-${name}-`))
  context.after(() => rm(directory, { force: true, recursive: true }))
  return realpath(directory)
}

test("host change plan and apply preserve unrelated shared JSON with a private exact backup", async (context) => {
  const directory = await fixture(context, "host-install-shared")
  const file = join(directory, "mcp.json")
  const activation = activationPlan()
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), "cursor")
  const original = {
    mcpServers: {
      [SERVER_NAME]: { args: ["stale"], command: "stale" },
      unrelated: { command: "private", env: { PRIVATE: RAW_SECRET } },
    },
    privateSetting: RAW_SECRET,
  }
  await writeJson(file, original)
  const originalBytes = await readFile(file)

  const first = planHostAdapterFile(activation, "cursor", file)
  const second = planHostAdapterFile(activation, "cursor", file)

  assert.deepEqual(second, first)
  assert.equal(first.status, "ready")
  assert.equal(first.change.operation, "update")
  assert.equal(first.change.serverEntry, "replace")
  assert.equal(first.change.strategy, "merge-owned-records")
  assert.equal(first.change.unrelatedState, "preserved")
  assert.equal(first.change.backupRequired, true)
  assert.equal(first.privacy.privateHostBytesHashed, false)
  assert.equal(first.privacy.hostPathReturned, false)
  assert.ok(first.limitations.some((value) => value.includes("portable filesystem semantics")))
  assert.doesNotMatch(JSON.stringify(first), new RegExp(RAW_SECRET, "u"))
  assert.equal(JSON.stringify(first).includes(directory), false)

  assert.throws(
    () => applyHostAdapterFile(activation, "cursor", file, {
      confirmation: "wrong-server",
      planDigest: first.planDigest,
    }),
    /confirmation must exactly match/u,
  )
  assert.deepEqual(await readFile(file), originalBytes)

  const applied = applyHostAdapterFile(activation, "cursor", file, {
    confirmation: SERVER_NAME,
    planDigest: first.planDigest,
  })

  assert.equal(applied.status, "applied")
  assert.equal(applied.backup.created, true)
  assert.ok(applied.backup.file)
  assert.equal(applied.privacy.hostConfigurationChanged, true)
  assert.equal(applied.privacy.hostPathReturned, true)
  assert.equal(applied.inspection.status, "match")
  assert.deepEqual(await readFile(applied.backup.file), originalBytes)
  const installed = JSON.parse(await readFile(file, "utf8")) as {
    mcpServers: Record<string, unknown>
    privateSetting: string
  }
  const expected = adapter.configuration.mcpServers as Record<string, unknown>
  assert.deepEqual(installed.mcpServers[SERVER_NAME], expected[SERVER_NAME])
  assert.deepEqual(installed.mcpServers.unrelated, original.mcpServers.unrelated)
  assert.equal(installed.privateSetting, RAW_SECRET)
  assert.doesNotMatch(JSON.stringify(applied), new RegExp(RAW_SECRET, "u"))

  const exactPlan = planHostAdapterFile(activation, "cursor", file)
  assert.equal(exactPlan.change.operation, "unchanged")
  const beforeRejectedNoop = await stat(file, { bigint: true })
  assert.throws(
    () => applyHostAdapterFile(activation, "cursor", file, {
      confirmation: SERVER_NAME,
      inspect() {
        return { ...applied.inspection, status: "drift" }
      },
      planDigest: exactPlan.planDigest,
    }),
    /Host adapter projection did not verify exactly/u,
  )
  const afterRejectedNoop = await stat(file, { bigint: true })
  assert.equal(afterRejectedNoop.ino, beforeRejectedNoop.ino)
  assert.equal(afterRejectedNoop.mtimeNs, beforeRejectedNoop.mtimeNs)
  const beforeNoop = await stat(file, { bigint: true })
  const unchanged = applyHostAdapterFile(activation, "cursor", file, {
    confirmation: SERVER_NAME,
    planDigest: exactPlan.planDigest,
  })
  const afterNoop = await stat(file, { bigint: true })
  assert.equal(unchanged.status, "unchanged")
  assert.equal(unchanged.backup.created, false)
  assert.equal(unchanged.privacy.hostConfigurationChanged, false)
  assert.equal(unchanged.privacy.hostPathReturned, false)
  assert.equal(afterNoop.ino, beforeNoop.ino)
  assert.equal(afterNoop.mtimeNs, beforeNoop.mtimeNs)
})

test("host apply safely creates every adapter document without a backup", async (context) => {
  const directory = await fixture(context, "host-install-create")
  const activation = activationPlan()
  const catalog = createHostAdapterCatalog(activation)

  for (const adapterId of HOST_ADAPTER_IDS) {
    const file = join(directory, `${adapterId}.json`)
    const planned = planHostAdapterFile(activation, adapterId, file)
    assert.equal(planned.fileReview.state, "absent")
    assert.equal(planned.change.operation, "create")
    assert.equal(planned.change.serverEntry, "add")
    assert.equal(planned.privacy.hostConfigurationRead, false)
    const applied = applyHostAdapterFile(activation, adapterId, file, {
      confirmation: planned.confirmation.requiredValue,
      planDigest: planned.planDigest,
    })
    assert.equal(applied.status, "applied")
    assert.equal(applied.backup.created, false)
    assert.equal(applied.inspection.status, "match")
    assert.equal(applied.privacy.hostConfigurationRead, true)
    assert.equal(applied.privacy.possibleCredentialMaterialRead, false)
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.deepEqual(
      JSON.parse(await readFile(file, "utf8")),
      clone(findHostAdapter(catalog, adapterId).configuration),
    )
  }
})

test("host merge treats every valid custom server name as an own JSON key", async (context) => {
  const directory = await fixture(context, "host-install-own-key")
  const file = join(directory, "mcp.json")
  const serverName = "__proto__"
  const activation = activationPlan(serverName)
  await writeJson(file, { mcpServers: { unrelated: { command: "private" } } })

  const planned = planHostAdapterFile(activation, "mcp-json", file)
  assert.equal(planned.change.serverEntry, "add")
  applyHostAdapterFile(activation, "mcp-json", file, {
    confirmation: serverName,
    planDigest: planned.planDigest,
  })

  const installed = JSON.parse(await readFile(file, "utf8")) as {
    mcpServers: Record<string, unknown>
  }
  const expected = findHostAdapter(
    createHostAdapterCatalog(activation),
    "mcp-json",
  ).configuration.mcpServers as Record<string, unknown>
  assert.equal(Object.hasOwn(installed.mcpServers, serverName), true)
  assert.deepEqual(installed.mcpServers[serverName], expected[serverName])
  assert.ok(installed.mcpServers.unrelated)
})

test("VS Code host merge changes only generated inputs and rejects ambiguity", async (context) => {
  const directory = await fixture(context, "host-install-vscode")
  const activation = activationPlan()
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), "vscode")
  const expectedInput = (adapter.configuration.inputs as Array<Record<string, unknown>>)[0]
  assert.ok(expectedInput)
  const file = join(directory, "vscode.json")
  await writeJson(file, {
    inputs: [
      { id: "unrelated-input", password: true, value: RAW_SECRET },
      { ...expectedInput, password: false },
    ],
    servers: {
      unrelated: { command: "private", env: { PRIVATE: RAW_SECRET } },
    },
  })

  const planned = planHostAdapterFile(activation, "vscode", file)
  assert.deepEqual(planned.change.sensitiveInputs, {
    added: 0,
    replaced: 1,
    unchanged: 0,
  })
  assert.equal(planned.change.serverEntry, "add")
  applyHostAdapterFile(activation, "vscode", file, {
    confirmation: SERVER_NAME,
    planDigest: planned.planDigest,
  })
  const installed = JSON.parse(await readFile(file, "utf8")) as {
    inputs: Array<Record<string, unknown>>
    servers: Record<string, unknown>
  }
  assert.deepEqual(installed.inputs[0], {
    id: "unrelated-input",
    password: true,
    value: RAW_SECRET,
  })
  assert.deepEqual(installed.inputs[1], expectedInput)
  assert.ok(installed.servers.unrelated)
  assert.ok(installed.servers[SERVER_NAME])

  const duplicate = join(directory, "duplicate.json")
  await writeJson(duplicate, {
    inputs: [expectedInput, expectedInput],
    servers: {},
  })
  assert.throws(
    () => planHostAdapterFile(activation, "vscode", duplicate),
    /ambiguous generated input/u,
  )
})

test("dedicated extension apply replaces the document and retains the original backup", async (context) => {
  const directory = await fixture(context, "host-install-extension")
  const activation = activationPlan()
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), "gemini-extension")
  const file = join(directory, "gemini-extension.json")
  const original = { unrelated: RAW_SECRET }
  await writeJson(file, original)

  const planned = planHostAdapterFile(activation, "gemini-extension", file)
  assert.equal(planned.change.strategy, "replace-dedicated-document")
  assert.equal(planned.change.unrelatedState, "replaced")
  assert.equal(planned.change.operation, "update")
  const applied = applyHostAdapterFile(activation, "gemini-extension", file, {
    confirmation: planned.confirmation.requiredValue,
    planDigest: planned.planDigest,
  })

  assert.ok(applied.backup.file)
  assert.deepEqual(JSON.parse(await readFile(applied.backup.file, "utf8")), original)
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), clone(adapter.configuration))
})

test("host apply rejects stale plans, target creation, and active locks without mutation", async (context) => {
  const directory = await fixture(context, "host-install-stale")
  const activation = activationPlan()
  const file = join(directory, "mcp.json")
  await writeJson(file, { mcpServers: {} })
  const planned = planHostAdapterFile(activation, "mcp-json", file)
  assert.throws(
    () => applyHostAdapterFile(activation, "mcp-json", file, {
      confirmation: SERVER_NAME,
      planDigest: "sha256:invalid",
    }),
    /plan digest is invalid/u,
  )
  await writeJson(file, { mcpServers: {}, unrelated: true })
  const changedBytes = await readFile(file)
  assert.throws(
    () => applyHostAdapterFile(activation, "mcp-json", file, {
      confirmation: SERVER_NAME,
      planDigest: planned.planDigest,
    }),
    /rerun host plan/u,
  )
  assert.deepEqual(await readFile(file), changedBytes)

  const absent = join(directory, "created-later.json")
  const absentPlan = planHostAdapterFile(activation, "mcp-json", absent)
  await writeJson(absent, { mcpServers: {} })
  assert.throws(
    () => applyHostAdapterFile(activation, "mcp-json", absent, {
      confirmation: SERVER_NAME,
      planDigest: absentPlan.planDigest,
    }),
    /rerun host plan/u,
  )

  const lockPlan = planHostAdapterFile(activation, "mcp-json", file)
  const lock = join(directory, `.${basename(file)}.discord-mcp.lock`)
  await writeFile(lock, "", { mode: 0o600 })
  assert.throws(
    () => applyHostAdapterFile(activation, "mcp-json", file, {
      confirmation: SERVER_NAME,
      planDigest: lockPlan.planDigest,
    }),
    /locked by another installation operation/u,
  )
  await rm(lock)
})

test("host apply rolls back existing and new files after post-publication verification failure", async (context) => {
  const directory = await fixture(context, "host-install-rollback")
  const activation = activationPlan()
  const existing = join(directory, "existing.json")
  await writeJson(existing, { mcpServers: {}, privateSetting: RAW_SECRET })
  const original = await readFile(existing)
  const existingPlan = planHostAdapterFile(activation, "mcp-json", existing)

  assert.throws(
    () => applyHostAdapterFile(activation, "mcp-json", existing, {
      confirmation: SERVER_NAME,
      inspect() {
        throw new Error("injected inspection failure")
      },
      planDigest: existingPlan.planDigest,
    }),
    /failed exact verification and was rolled back/u,
  )
  assert.deepEqual(await readFile(existing), original)
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.includes("backup")),
    [],
  )

  const absent = join(directory, "absent.json")
  const absentPlan = planHostAdapterFile(activation, "mcp-json", absent)
  assert.throws(
    () => applyHostAdapterFile(activation, "mcp-json", absent, {
      confirmation: SERVER_NAME,
      inspect() {
        throw new Error("injected inspection failure")
      },
      planDigest: absentPlan.planDigest,
    }),
    /failed exact verification and was rolled back/u,
  )
  await assert.rejects(readFile(absent), /ENOENT/u)
})

test("host apply reports uncertainty when a published replacement cannot recover its backup", async (context) => {
  const directory = await fixture(context, "host-install-rollback-uncertain")
  const activation = activationPlan()
  const file = join(directory, "mcp.json")
  await writeJson(file, { mcpServers: {}, privateSetting: RAW_SECRET })
  const planned = planHostAdapterFile(activation, "mcp-json", file)

  assert.throws(
    () => applyHostAdapterFile(activation, "mcp-json", file, {
      confirmation: SERVER_NAME,
      inspect() {
        const backup = readdirSync(directory).find((name) => name.includes(".backup."))
        assert.ok(backup)
        unlinkSync(join(directory, backup))
        throw new Error("injected inspection and backup loss")
      },
      planDigest: planned.planDigest,
    }),
    /could not be verified or rolled back/u,
  )
  assert.ok(JSON.parse(await readFile(file, "utf8")))
})

test("host apply preserves an external destination change instead of rolling it back", async (context) => {
  const directory = await fixture(context, "host-install-external-race")
  const activation = activationPlan()
  const file = join(directory, "mcp.json")
  await writeJson(file, { mcpServers: {}, privateSetting: RAW_SECRET })
  const planned = planHostAdapterFile(activation, "mcp-json", file)
  const external = `${JSON.stringify({ externalWriter: true }, null, 2)}\n`

  assert.throws(
    () => applyHostAdapterFile(activation, "mcp-json", file, {
      confirmation: SERVER_NAME,
      inspect() {
        writeFileSync(file, external, { encoding: "utf8", mode: 0o600 })
        throw new Error("injected external write")
      },
      planDigest: planned.planDigest,
    }),
    /could not be verified or rolled back/u,
  )
  assert.equal(await readFile(file, "utf8"), external)
  assert.equal(
    (await readdir(directory)).filter((name) => name.includes("backup")).length,
    1,
  )
})

test("host planning fails closed on unsafe directories and ambiguous JSON structures", async (context) => {
  const directory = await fixture(context, "host-install-unsafe")
  const activation = activationPlan()
  const invalidRoot = join(directory, "root.json")
  await writeJson(invalidRoot, [])
  assert.throws(
    () => planHostAdapterFile(activation, "mcp-json", invalidRoot),
    /root must be one JSON object/u,
  )

  const invalidCollection = join(directory, "collection.json")
  await writeJson(invalidCollection, { mcpServers: [] })
  assert.throws(
    () => planHostAdapterFile(activation, "mcp-json", invalidCollection),
    /server collection must be one JSON object/u,
  )

  const invalidInputs = join(directory, "inputs.json")
  await writeJson(invalidInputs, { inputs: {}, servers: {} })
  assert.throws(
    () => planHostAdapterFile(activation, "vscode", invalidInputs),
    /inputs must be an array/u,
  )

  const invalidUnusedInputs = join(directory, "unused-inputs.json")
  await writeJson(invalidUnusedInputs, { inputs: {}, servers: {} })
  assert.throws(
    () => planHostAdapterFile(fileCredentialActivationPlan(), "vscode", invalidUnusedInputs),
    /inputs must be an array/u,
  )

  const invalidExtension = join(directory, "extension.json")
  await writeJson(invalidExtension, [])
  assert.throws(
    () => planHostAdapterFile(activation, "gemini-extension", invalidExtension),
    /extension root must be one JSON object/u,
  )

  const oversizedMerge = join(directory, "oversized-merge.json")
  await writeJson(oversizedMerge, { padding: "x".repeat(HOST_JSON_MAX_BYTES - 64) })
  assert.ok((await stat(oversizedMerge)).size <= HOST_JSON_MAX_BYTES)
  assert.throws(
    () => planHostAdapterFile(activation, "mcp-json", oversizedMerge),
    /Merged host configuration exceeds/u,
  )

  for (const [name, value] of [
    ["overflow", "1e999"],
    ["unsafe-integer", "9007199254740993"],
    ["negative-zero", "-0"],
  ] as const) {
    const unsafeNumber = join(directory, `${name}.json`)
    await writeFile(unsafeNumber, `{"value":${value}}\n`, { mode: 0o600 })
    assert.throws(
      () => planHostAdapterFile(activation, "mcp-json", unsafeNumber),
      /number that cannot be safely rewritten/u,
    )
  }

  const oversizedStructure = join(directory, "oversized-structure.json")
  await writeFile(
    oversizedStructure,
    `{"values":[${new Array(HOST_JSON_MAX_NODES).fill("0").join(",")}]}\n`,
    { mode: 0o600 },
  )
  assert.throws(
    () => planHostAdapterFile(activation, "mcp-json", oversizedStructure),
    /bounded JSON structure/u,
  )

  if (process.platform !== "win32") {
    await chmod(directory, 0o777)
    assert.throws(
      () => planHostAdapterFile(activation, "mcp-json", join(directory, "missing.json")),
      /must not be group or world writable/u,
    )
    await chmod(directory, 0o700)
  }
})
