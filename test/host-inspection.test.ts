import assert from "node:assert/strict"
import {
  chmod,
  link,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createConnectorConfigDocument } from "../src/config-document.js"
import { CONNECTOR_VERSION } from "../src/constants.js"
import {
  HOST_ADAPTER_IDS,
  createHostAdapterCatalog,
  findHostAdapter,
  type HostAdapter,
  type HostAdapterId,
} from "../src/host-adapters.js"
import { createHostActivationPlan } from "../src/host-activation.js"
import {
  HOST_INSPECTION_FORMAT,
  HOST_INSPECTION_MAX_BYTES,
  HOST_INSPECTION_MIN_BYTES,
  inspectHostAdapterFile,
  type HostInspectionDifference,
} from "../src/host-inspection.js"
import { createStdioLaunchDescriptor } from "../src/operator.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const CONFIG_FILE = "/configuration/guildcontrol.json"
const TOKEN_ALIAS = "DISCORD_HOST_INSPECTION_TOKEN"
const RAW_SECRET = "host-file-secret-that-must-never-escape"
const SERVER_NAME = "discord-inspection"

function plan() {
  const document = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    name: "host-inspection-policy",
    toolsets: ["connector", "guilds"],
    toolSurface: "progressive",
  })
  const launch = createStdioLaunchDescriptor({
    applicationId: APPLICATION_ID,
    args: ["--yes", `guildctl@${CONNECTOR_VERSION}`, "serve"],
    botId: BOT_ID,
    command: "npx",
    config: { document, file: CONFIG_FILE },
    serverName: SERVER_NAME,
  })
  return createHostActivationPlan({
    document,
    launch,
    source: { file: CONFIG_FILE, kind: "config" },
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

function addUnrelatedState(adapter: HostAdapter): Record<string, unknown> {
  const configuration = clone(adapter.configuration) as Record<string, unknown>
  const collectionName = adapter.id === "vscode" ? "servers" : "mcpServers"
  const collection = configuration[collectionName] as Record<string, unknown>
  collection.unrelated_private_server = {
    command: RAW_SECRET,
    env: { UNRELATED_SECRET: RAW_SECRET },
  }
  configuration.unrelated_private_key = RAW_SECRET
  if (adapter.id === "vscode") {
    ;(configuration.inputs as unknown[]).push({
      id: "unrelated-private-input",
      value: RAW_SECRET,
    })
  }
  return configuration
}

test("host inspection matches every exact adapter and ignores unrelated shared state", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-host-inspection-"))
  context.after(() => rm(directory, { force: true, recursive: true }))
  const root = await realpath(directory)
  const activation = plan()
  const catalog = createHostAdapterCatalog(activation)

  for (const adapterId of HOST_ADAPTER_IDS) {
    const adapter = findHostAdapter(catalog, adapterId)
    const file = join(root, `${adapterId}.json`)
    await writeJson(
      file,
      adapterId === "gemini-extension"
        ? adapter.configuration
        : addUnrelatedState(adapter),
    )

    const first = inspectHostAdapterFile(activation, adapterId, file)
    const second = inspectHostAdapterFile(activation, adapterId, file)

    assert.deepEqual(second, first)
    assert.equal(first.format, HOST_INSPECTION_FORMAT)
    assert.equal(first.status, "match")
    assert.equal(first.comparison.serverEntry, "exact")
    assert.deepEqual(first.comparison.differences, [])
    assert.equal(first.adapter.adapterDigest, adapter.adapterDigest)
    assert.equal(first.adapter.activationDigest, activation.activationDigest)
    assert.equal(first.comparison.unrelatedState, adapterId === "gemini-extension" ? "not-applicable" : "ignored")
    assert.equal(first.comparison.expectedSensitiveInputCount, ["vscode", "gemini-extension"].includes(adapterId) ? 1 : 0)
    assert.equal(first.comparison.matchedSensitiveInputCount, first.comparison.expectedSensitiveInputCount)
    assert.match(first.inspectionDigest, /^sha256:[a-f0-9]{64}$/u)
    assert.equal(Object.isFrozen(first), true)
    assert.equal(Object.isFrozen(first.comparison.differences), true)
    assert.deepEqual(first.fileReview, {
      access: process.platform === "win32" ? "platform-unverified" : "owner-private",
      bounded: true,
      canonical: true,
      owner: process.platform === "win32" ? "platform-unverified" : "trusted",
      regularFile: true,
      singleLink: true,
      stableRead: true,
    })
    const output = JSON.stringify(first)
    assert.doesNotMatch(output, new RegExp(RAW_SECRET, "u"))
    assert.equal(output.includes(root), false)
    assert.equal(first.privacy.possibleCredentialMaterialRead, true)
    assert.equal(first.privacy.credentialValuesReturned, false)
    assert.equal(first.privacy.unrelatedHostStateReturned, false)
  }
})

test("host inspection reports canonical fixed server drift without returning observed values", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-host-drift-"))
  context.after(() => rm(directory, { force: true, recursive: true }))
  const root = await realpath(directory)
  const activation = plan()
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), "cursor")
  const configuration = clone(adapter.configuration) as {
    mcpServers: Record<string, Record<string, unknown>>
  }
  configuration.mcpServers[SERVER_NAME] = {
    args: [RAW_SECRET],
    command: RAW_SECRET,
    env: { [TOKEN_ALIAS]: RAW_SECRET },
    extraPrivateOption: RAW_SECRET,
    type: "http",
  }
  const file = join(root, "drift.json")
  await writeJson(file, configuration)

  const report = inspectHostAdapterFile(activation, "cursor", file)

  assert.equal(report.status, "drift")
  assert.equal(report.comparison.serverEntry, "drifted")
  assert.deepEqual(report.comparison.differences, [
    "command-mismatch",
    "arguments-mismatch",
    "transport-mismatch",
    "environment-reference-mismatch",
    "server-options-mismatch",
  ])
  assert.doesNotMatch(JSON.stringify(report), new RegExp(RAW_SECRET, "u"))
})

test("host inspection distinguishes missing and invalid server projections", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-host-structure-"))
  context.after(() => rm(directory, { force: true, recursive: true }))
  const root = await realpath(directory)
  const activation = plan()
  const cases: Array<{
    difference: string
    entry: string
    id: HostAdapterId
    value: unknown
  }> = [
    { difference: "host-root-invalid", entry: "invalid", id: "mcp-json", value: [] },
    { difference: "server-collection-missing", entry: "invalid", id: "mcp-json", value: {} },
    { difference: "server-entry-missing", entry: "missing", id: "mcp-json", value: { mcpServers: {} } },
    { difference: "server-entry-invalid", entry: "invalid", id: "mcp-json", value: { mcpServers: { [SERVER_NAME]: RAW_SECRET } } },
  ]

  for (const [index, item] of cases.entries()) {
    const file = join(root, `${index}.json`)
    await writeJson(file, item.value)
    const report = inspectHostAdapterFile(activation, item.id, file)
    assert.equal(report.status, "drift")
    assert.equal(report.comparison.serverEntry, item.entry)
    assert.ok(report.comparison.differences.includes(item.difference as HostInspectionDifference))
    assert.doesNotMatch(JSON.stringify(report), new RegExp(RAW_SECRET, "u"))
  }
})

test("VS Code inspection requires each generated sensitive input exactly once", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-host-vscode-"))
  context.after(() => rm(directory, { force: true, recursive: true }))
  const root = await realpath(directory)
  const activation = plan()
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), "vscode")
  const base = clone(adapter.configuration) as {
    inputs: Array<Record<string, unknown>>
  }
  const cases: Array<[unknown, string]> = [
    [{ ...base, inputs: undefined }, "sensitive-input-collection-missing"],
    [{ ...base, inputs: [] }, "sensitive-input-missing"],
    [{ ...base, inputs: [base.inputs[0], base.inputs[0]] }, "sensitive-input-ambiguous"],
    [{ ...base, inputs: [{ ...base.inputs[0], password: false, value: RAW_SECRET }] }, "sensitive-input-mismatch"],
  ]

  for (const [index, [value, difference]] of cases.entries()) {
    const file = join(root, `${index}.json`)
    await writeJson(file, value)
    const report = inspectHostAdapterFile(activation, "vscode", file)
    assert.equal(report.status, "drift")
    assert.ok(report.comparison.differences.includes(difference as HostInspectionDifference))
    assert.equal(report.comparison.matchedSensitiveInputCount, 0)
    assert.doesNotMatch(JSON.stringify(report), new RegExp(RAW_SECRET, "u"))
  }
})

test("Gemini extension inspection compares the dedicated manifest completely", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-host-gemini-"))
  context.after(() => rm(directory, { force: true, recursive: true }))
  const root = await realpath(directory)
  const activation = plan()
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), "gemini-extension")
  const changed = {
    ...clone(adapter.configuration),
    description: RAW_SECRET,
    name: "different-extension",
    settings: [{ value: RAW_SECRET }],
    unrelated: RAW_SECRET,
    version: "0.0.0",
  }
  const file = join(root, "extension.json")
  await writeJson(file, changed)

  const report = inspectHostAdapterFile(activation, "gemini-extension", file)

  assert.equal(report.status, "drift")
  assert.equal(report.comparison.serverEntry, "exact")
  assert.deepEqual(report.comparison.differences, [
    "extension-name-mismatch",
    "extension-version-mismatch",
    "extension-description-mismatch",
    "extension-settings-mismatch",
    "extension-options-mismatch",
  ])
  assert.doesNotMatch(JSON.stringify(report), new RegExp(RAW_SECRET, "u"))
})

test("host inspection rejects unsafe or ambiguous files without leaking paths or content", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "guildcontrol-host-files-"))
  context.after(() => rm(directory, { force: true, recursive: true }))
  const root = await realpath(directory)
  const activation = plan()
  const adapter = findHostAdapter(createHostAdapterCatalog(activation), "mcp-json")
  const valid = join(root, "valid.json")
  await writeJson(valid, adapter.configuration)

  const duplicate = join(root, "duplicate.json")
  await writeFile(
    duplicate,
    `{"mcpServers":{},"mcpServers":{"${SERVER_NAME}":{"command":"${RAW_SECRET}"}}}`,
    { encoding: "utf8", mode: 0o600 },
  )
  assert.throws(
    () => inspectHostAdapterFile(activation, "mcp-json", duplicate),
    (error: unknown) => error instanceof Error
      && error.message === "Host configuration is not valid strict JSON"
      && !error.message.includes(root)
      && !error.message.includes(RAW_SECRET),
  )

  const oversized = join(root, "oversized.json")
  await writeFile(oversized, Buffer.alloc(HOST_INSPECTION_MAX_BYTES + 1, 0x20), { mode: 0o600 })
  assert.throws(
    () => inspectHostAdapterFile(activation, "mcp-json", oversized),
    /bounded JSON file size/u,
  )

  const undersized = join(root, "undersized.json")
  await writeFile(undersized, Buffer.alloc(HOST_INSPECTION_MIN_BYTES - 1, 0x7b), { mode: 0o600 })
  assert.throws(
    () => inspectHostAdapterFile(activation, "mcp-json", undersized),
    /bounded JSON file size/u,
  )

  const invalidUtf8 = join(root, "invalid-utf8.json")
  await writeFile(invalidUtf8, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), { mode: 0o600 })
  assert.throws(
    () => inspectHostAdapterFile(activation, "mcp-json", invalidUtf8),
    /not valid strict JSON/u,
  )

  if (process.platform !== "win32") {
    const exposed = join(root, "exposed.json")
    await writeJson(exposed, adapter.configuration)
    await chmod(exposed, 0o644)
    assert.throws(
      () => inspectHostAdapterFile(activation, "mcp-json", exposed),
      /must not grant group or world access/u,
    )

    const linked = join(root, "linked.json")
    await link(valid, linked)
    assert.throws(
      () => inspectHostAdapterFile(activation, "mcp-json", valid),
      /exactly one hard link/u,
    )

    const symbolic = join(root, "symbolic.json")
    await symlink(duplicate, symbolic)
    assert.throws(
      () => inspectHostAdapterFile(activation, "mcp-json", symbolic),
      /must not contain symbolic links/u,
    )
  }
})
