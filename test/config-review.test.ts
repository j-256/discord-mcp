import assert from "node:assert/strict"
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  CONFIG_CHANGE_PLAN_DIGEST_PATTERN,
  applyConfigChange,
  planConfigChange,
} from "../src/config-review.js"
import {
  createConnectorConfigDocument,
  loadConnectorConfigDocumentFile,
  type ConnectorConfigDocument,
} from "../src/config-document.js"
import { writeConnectorConfigDocumentFile } from "../src/config-operator.js"
import {
  MCP_READ_RESPONSE_DEFAULTS,
  MCP_TOOLSET_NAMES,
  type McpToolsetName,
} from "../src/constants.js"

const APPLICATION_ID = "300000000000000001"
const BOT_ID = "400000000000000001"
const OTHER_BOT_ID = "400000000000000002"
const GUILD_ID = "100000000000000001"
const OTHER_GUILD_ID = "100000000000000002"
const CHANNEL_ID = "200000000000000001"
const OTHER_CHANNEL_ID = "200000000000000002"
const USER_ID = "500000000000000001"
const OTHER_USER_ID = "500000000000000002"
const TOKEN_ALIAS = "DISCORD_SUPPORT_BOT_TOKEN"
const HEADER_ALIAS = "PRIVATE_OTLP_HEADERS"

function toolsets(...names: McpToolsetName[]): McpToolsetName[] {
  return MCP_TOOLSET_NAMES.filter((name) => names.includes(name))
}

function document(
  overrides: Partial<Parameters<typeof createConnectorConfigDocument>[0]> = {},
): ConnectorConfigDocument {
  return createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    channelIds: [CHANNEL_ID],
    ...(overrides.credentialFile === undefined && overrides.credentialVariable === undefined
      ? { credentialVariable: TOKEN_ALIAS }
      : {}),
    guildIds: [GUILD_ID],
    name: "support-bot",
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
    ...overrides,
  })
}

async function reviewRoot(context: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guildcontrol-config-review-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  return realpath(root)
}

async function configPair(
  context: test.TestContext,
  current: ConnectorConfigDocument,
  candidate: ConnectorConfigDocument,
): Promise<{ candidateFile: string; file: string; root: string }> {
  const root = await reviewRoot(context)
  const file = join(root, "active.json")
  const candidateFile = join(root, "candidate.json")
  await writeConnectorConfigDocumentFile(file, current)
  await writeConnectorConfigDocumentFile(candidateFile, candidate)
  return { candidateFile, file, root }
}

function change(
  report: ReturnType<typeof planConfigChange>,
  path: string,
) {
  const result = report.changes.find((entry) => entry.path === path)
  assert.ok(result, `Missing change ${path}`)
  return result
}

test("configuration change plans are deterministic, credential-free, and exact no-ops", async (context) => {
  const original = document()
  const paths = await configPair(context, original, original)
  const first = planConfigChange(paths)
  const second = planConfigChange(paths)

  assert.deepEqual(first, second)
  assert.equal(first.status, "already-current")
  assert.deepEqual(first.changes, [])
  assert.deepEqual(first.tools, { added: [], removed: [] })
  assert.deepEqual(first.impact, {
    authorityExpansions: 0,
    authorityReductions: 0,
    authorityRedistributions: 0,
    metadataOnly: 0,
    operationalChanges: 0,
    total: 0,
  })
  assert.equal(CONFIG_CHANGE_PLAN_DIGEST_PATTERN.test(first.planDigest), true)
  assert.equal(first.confirmation.requiredValue, "support-bot")
  assert.deepEqual(first.candidateDocument, original)
  assert.equal(first.execution.configurationWritten, false)
  assert.equal(first.execution.discordContacted, false)
  assert.equal(first.execution.secretValuesRead, false)
  assert.deepEqual(first.nextChecks, [
    { args: ["config", "validate", paths.file], command: "guildctl" },
    { args: ["doctor", "--config", paths.file, "--online"], command: "guildctl" },
    { args: ["smoke", "--config", paths.file], command: "guildctl" },
  ])
  assert.equal(JSON.stringify(first).includes("test-discord-token"), false)

  const alternateCandidateFile = join(paths.root, "alternate-candidate.json")
  await writeConnectorConfigDocumentFile(alternateCandidateFile, original)
  const alternate = planConfigChange({
    candidateFile: alternateCandidateFile,
    file: paths.file,
  })
  assert.equal(alternate.candidateDocumentDigest, first.candidateDocumentDigest)
  assert.notEqual(alternate.planDigest, first.planDigest)
})

test("configuration change plans classify exact authority and operating changes", async (context) => {
  const root = await reviewRoot(context)
  const firstRoot = join(root, "first-root")
  const secondRoot = join(root, "second-root")
  await mkdir(firstRoot)
  await mkdir(secondRoot)
  const current = document({
    capabilities: { interactions: true },
    limits: {
      interactionMaxWritesPerMinute: 20,
      interactionMinWriteIntervalMs: 500,
    },
    scopes: {
      interactionChannelIds: [CHANNEL_ID],
      protectedUserIds: [USER_ID],
    },
    storage: { attachmentRoots: [firstRoot] },
  })
  const candidate = document({
    capabilities: { interactions: false },
    channelIds: [],
    credentialFile: "/run/secrets/discord_bot_token",
    guildIds: [GUILD_ID, OTHER_GUILD_ID],
    limits: {
      interactionMaxWritesPerMinute: 5,
      interactionMinWriteIntervalMs: 100,
    },
    name: "reviewed-bot",
    observability: {
      endpoint: "https://collector.invalid",
      exportEnabled: true,
      headers: { provider: "environment", variable: HEADER_ALIAS },
    },
    runtime: { nativeCommandName: "private-request" },
    scopes: {
      interactionChannelIds: [OTHER_CHANNEL_ID],
      protectedUserIds: [USER_ID, OTHER_USER_ID],
    },
    storage: { attachmentRoots: [secondRoot] },
    toolsets: toolsets("connector", "gateway", "roles"),
    toolSurface: "full",
    threadMessageWriteMode: "inherit",
    threadReadMode: "exact",
    userMentionMode: "reviewed",
    gatewayEnabled: true,
    gatewayEventBufferSize: 200,
  })
  const file = join(root, "active.json")
  const candidateFile = join(root, "candidate.json")
  await writeConnectorConfigDocumentFile(file, current)
  await writeConnectorConfigDocumentFile(candidateFile, candidate)
  const report = planConfigChange({ candidateFile, file })

  assert.equal(report.status, "planned")
  assert.equal(
    new Set(report.changes.map(({ path }) => path)).size,
    report.changes.length,
  )
  assert.equal(change(report, "$.readScope.channelIds").impact, "authority-reduction")
  assert.equal(change(report, "$.readScope.channelMode").impact, "authority-expansion")
  assert.equal(change(report, "$.readScope.guildIds").impact, "authority-expansion")
  assert.equal(change(report, "$.capabilities.interactions").impact, "authority-reduction")
  assert.equal(change(report, "$.scopes.interactionChannelIds").impact, "authority-redistribution")
  assert.equal(change(report, "$.scopes.protectedUserIds").impact, "authority-reduction")
  assert.equal(change(report, "$.tools.toolsets").impact, "authority-redistribution")
  assert.equal(change(report, "$.tools.surface").impact, "operational-change")
  assert.equal(change(report, "$.gateway.enabled").impact, "authority-expansion")
  assert.equal(change(report, "$.gateway.eventBufferSize").impact, "authority-expansion")
  assert.equal(change(report, "$.limits.interactionMaxWritesPerMinute").impact, "authority-reduction")
  assert.equal(change(report, "$.limits.interactionMinWriteIntervalMs").impact, "authority-expansion")
  assert.equal(change(report, "$.storage.attachmentRoots").impact, "authority-redistribution")
  assert.equal(change(report, "$.observability.exportEnabled").impact, "authority-expansion")
  assert.equal(change(report, "$.observability.endpoint").impact, "authority-redistribution")
  assert.equal(change(report, "$.runtime.nativeCommandName").impact, "operational-change")
  assert.equal(change(report, "$.credential").impact, "authority-redistribution")
  assert.equal(change(report, "$.name").impact, "metadata-only")
  assert.equal(
    change(report, "$.notifications.userMentions").impact,
    "authority-expansion",
  )
  assert.equal(change(report, "$.threads.messageWrites").impact, "authority-expansion")
  assert.equal(change(report, "$.threads.reads").impact, "authority-reduction")
  assert.ok(report.impact.authorityExpansions > 0)
  assert.ok(report.impact.authorityReductions > 0)
  assert.ok(report.impact.authorityRedistributions > 0)
  assert.ok(report.impact.operationalChanges > 0)
  assert.ok(report.impact.metadataOnly > 0)
  assert.ok(report.tools.added.length > 0)
  assert.ok(report.tools.removed.length > 0)
  assert.ok(report.warnings.some((warning) => warning.includes("outer Discord read boundary")))
  assert.ok(report.warnings.some((warning) => warning.includes("Gateway")))
  assert.ok(report.warnings.some((warning) => warning.includes("telemetry")))
  assert.ok(report.warnings.some((warning) => warning.includes("external credential")))
  assert.ok(report.warnings.some((warning) => warning.includes("no channel allowlist")))
  assert.deepEqual(report.candidateSummary.credential, {
    path: "/run/secrets/discord_bot_token",
    provider: "file",
  })
})

test("configuration change plans use field-specific limit and inverse-boundary direction", async (context) => {
  const current = document({
    limits: {
      attachmentMaxBytes: 1_024,
      interactionMaxWritesPerMinute: 5,
      interactionMinWriteIntervalMs: 5_000,
      mcpReadResponseMaxBytes: 65_536,
      nativeInteractionMaxPending: 5,
      nativeInteractionTtlSeconds: 60,
    },
    scopes: { protectedUserIds: [USER_ID, OTHER_USER_ID] },
  })
  const candidate = document({
    limits: {
      attachmentMaxBytes: 2_048,
      interactionMaxWritesPerMinute: 10,
      interactionMinWriteIntervalMs: 10_000,
      mcpReadResponseMaxBytes: 131_072,
      nativeInteractionMaxPending: 10,
      nativeInteractionTtlSeconds: 120,
    },
    scopes: { protectedUserIds: [USER_ID] },
  })
  const paths = await configPair(context, current, candidate)
  const report = planConfigChange(paths)

  for (const path of [
    "$.limits.attachmentMaxBytes",
    "$.limits.interactionMaxWritesPerMinute",
    "$.limits.mcpReadResponseMaxBytes",
    "$.limits.nativeInteractionMaxPending",
    "$.limits.nativeInteractionTtlSeconds",
  ]) {
    assert.equal(change(report, path).impact, "authority-expansion")
  }
  assert.equal(
    change(report, "$.limits.interactionMinWriteIntervalMs").impact,
    "authority-reduction",
  )
  assert.equal(
    change(report, "$.scopes.protectedUserIds").impact,
    "authority-expansion",
  )
})

test("configuration change plans retain explicit default representation as metadata", async (context) => {
  const current = document()
  const candidate = createConnectorConfigDocument({
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
    capabilities: { interactions: false },
    channelIds: [CHANNEL_ID],
    credentialVariable: TOKEN_ALIAS,
    guildIds: [GUILD_ID],
    limits: {
      interactionMaxWritesPerMinute: 10,
      mcpReadResponseMaxBytes: MCP_READ_RESPONSE_DEFAULTS.maxBytes,
    },
    name: "support-bot",
    observability: { exportEnabled: false, jsonLogsEnabled: false },
    runtime: { nativeCommandName: "guildcontrol" },
    scopes: { protectedUserIds: [] },
    storage: { attachmentRoots: [] },
    toolsets: ["connector", "messages"],
    toolSurface: "progressive",
  })
  const paths = await configPair(context, current, candidate)
  const report = planConfigChange(paths)

  assert.equal(report.status, "planned")
  for (const path of [
    "$.capabilities.interactions",
    "$.limits.interactionMaxWritesPerMinute",
    "$.limits.mcpReadResponseMaxBytes",
    "$.observability.exportEnabled",
    "$.observability.jsonLogsEnabled",
    "$.runtime.nativeCommandName",
    "$.scopes.protectedUserIds",
    "$.storage.attachmentRoots",
  ]) {
    assert.equal(change(report, path).impact, "metadata-only")
  }
  assert.equal(report.impact.total, report.impact.metadataOnly)
})

test("configuration change planning rejects same-file, unsafe, and identity-changing candidates", async (context) => {
  const root = await reviewRoot(context)
  const file = join(root, "active.json")
  const candidateFile = join(root, "candidate.json")
  await writeConnectorConfigDocumentFile(file, document())
  await writeConnectorConfigDocumentFile(candidateFile, document({ botId: OTHER_BOT_ID }))

  assert.throws(
    () => planConfigChange({ candidateFile: file, file }),
    /distinct active and candidate files/,
  )
  assert.throws(
    () => planConfigChange({ candidateFile, file }),
    /identity must exactly match/,
  )

  const validCandidate = join(root, "valid-candidate.json")
  const candidateLink = join(root, "candidate-link.json")
  await writeConnectorConfigDocumentFile(validCandidate, document())
  await symlink(validCandidate, candidateLink)
  assert.throws(
    () => planConfigChange({ candidateFile: candidateLink, file }),
    /candidate configuration is unavailable or invalid/,
  )
})

test("configuration change apply requires exact fresh review and preserves the candidate", async (context) => {
  const original = document()
  const candidate = document({
    capabilities: { interactions: true },
    name: "reviewed-bot",
    scopes: { interactionChannelIds: [CHANNEL_ID] },
    toolsets: toolsets("connector", "interactions", "messages"),
  })
  const paths = await configPair(context, original, candidate)
  const candidateBytes = await readFile(paths.candidateFile, "utf8")
  const plan = planConfigChange(paths)

  await assert.rejects(
    () => applyConfigChange({
      ...paths,
      confirmation: "wrong",
      planDigest: plan.planDigest,
    }),
    /confirmation must exactly match support-bot/,
  )
  await assert.rejects(
    () => applyConfigChange({
      ...paths,
      confirmation: "support-bot",
      planDigest: "not-a-digest",
    }),
    /plan digest is invalid/,
  )

  const applied = await applyConfigChange({
    ...paths,
    confirmation: "support-bot",
    planDigest: plan.planDigest,
  })
  assert.equal(applied.status, "applied")
  assert.equal(applied.applied, true)
  assert.equal(applied.execution.configurationWritten, true)
  assert.ok(applied.backupFile)
  assert.deepEqual(loadConnectorConfigDocumentFile(paths.file), candidate)
  assert.deepEqual(loadConnectorConfigDocumentFile(applied.backupFile), original)
  assert.equal((await lstat(paths.file)).mode & 0o777, 0o600)
  assert.equal(await readFile(paths.candidateFile, "utf8"), candidateBytes)

  const noOpPlan = planConfigChange(paths)
  assert.equal(noOpPlan.status, "already-current")
  const noOp = await applyConfigChange({
    ...paths,
    confirmation: "reviewed-bot",
    planDigest: noOpPlan.planDigest,
  })
  assert.equal(noOp.status, "already-current")
  assert.equal(noOp.applied, false)
  assert.equal(noOp.execution.configurationWritten, false)
  assert.equal(noOp.backupFile, undefined)
})

test("configuration change apply rejects stale active or candidate documents", async (context) => {
  const candidate = document({ name: "candidate" })
  const first = await configPair(context, document(), candidate)
  const firstPlan = planConfigChange(first)
  const changedCandidate = document({
    capabilities: { interactions: true },
    name: "candidate",
    scopes: { interactionChannelIds: [CHANNEL_ID] },
  })
  await writeConnectorConfigDocumentFile(first.candidateFile, changedCandidate, {
    expectedCurrent: candidate,
    overwrite: true,
  })
  await assert.rejects(
    () => applyConfigChange({
      ...first,
      confirmation: "support-bot",
      planDigest: firstPlan.planDigest,
    }),
    /stale or does not match/,
  )

  const second = await configPair(context, document(), candidate)
  const secondPlan = planConfigChange(second)
  const changedCurrent = document({
    capabilities: { interactions: true },
    scopes: { interactionChannelIds: [CHANNEL_ID] },
  })
  await writeConnectorConfigDocumentFile(second.file, changedCurrent, {
    expectedCurrent: document(),
    overwrite: true,
  })
  await assert.rejects(
    () => applyConfigChange({
      ...second,
      confirmation: "support-bot",
      planDigest: secondPlan.planDigest,
    }),
    /stale or does not match/,
  )
})
