import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_LIMITS,
  ENVIRONMENT_NAMES,
  MCP_DISCOVERY_TOOL_NAME,
} from "../src/constants.js"
import { selectedCanonicalMcpToolNames } from "../src/mcp-tool-catalog.js"
import { MCP_TOOL_RISK_CLASSES } from "../src/observability-catalog.js"
import {
  applySetupPreset,
  getSetupPreset,
  normalizeSetupPresetName,
  SETUP_PRESETS,
  SETUP_PRESET_NAMES,
} from "../src/setup-presets.js"

const TOKEN = "test-discord-token"
const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const GUILD_ID = "300000000000000001"
const SECOND_GUILD_ID = "300000000000000002"
const CHANNEL_ID = "400000000000000001"
const SECOND_CHANNEL_ID = "400000000000000002"

test("setup presets expose deterministic exact read-only contracts", () => {
  assert.equal(Object.isFrozen(SETUP_PRESETS), true)
  assert.deepEqual(
    SETUP_PRESETS.map((preset) => preset.name),
    SETUP_PRESET_NAMES,
  )
  assert.equal(SETUP_PRESETS.filter((preset) => preset.recommended).length, 1)
  assert.equal(SETUP_PRESETS[0]?.recommended, true)
  assert.equal(SETUP_PRESETS[0]?.requirements.messageContentIntent, "not-required")
  assert.equal(SETUP_PRESETS[1]?.requirements.channelIds, "required")
  assert.equal(SETUP_PRESETS[1]?.requirements.messageContentIntent, "recommended")

  for (const preset of SETUP_PRESETS) {
    assert.equal(Object.isFrozen(preset), true)
    assert.equal(Object.isFrozen(preset.requirements), true)
    assert.equal(Object.isFrozen(preset.riskClasses), true)
    assert.equal(Object.isFrozen(preset.toolNames), true)
    assert.equal(Object.isFrozen(preset.toolsets), true)
    assert.equal(preset.gatewayEnabled, false)
    assert.equal(
      preset.requirements.threadScope,
      "inherits-allowlisted-parent",
    )
    assert.equal(preset.toolSurface, "full")
    assert.equal(preset.writeCapable, false)
    assert.deepEqual(
      preset.toolNames,
      [
        MCP_DISCOVERY_TOOL_NAME,
        ...selectedCanonicalMcpToolNames(new Set(preset.toolsets)),
      ].sort(),
    )
    assert.equal(
      preset.toolNames.every((name) => (
        MCP_TOOL_RISK_CLASSES[name] === "discord-read"
        || MCP_TOOL_RISK_CLASSES[name] === "local-read"
      )),
      true,
    )
  }
})

test("setup preset names normalize and reject unknown values", () => {
  assert.equal(normalizeSetupPresetName(" CHANNEL-READER "), "channel-reader")
  assert.equal(getSetupPreset("SERVER-OBSERVER").recommended, true)
  assert.throws(
    () => normalizeSetupPresetName(null as unknown as string),
    /must be a string/,
  )
  assert.throws(
    () => normalizeSetupPresetName("writer"),
    /server-observer, channel-reader/,
  )
})

test("server observer materializes exact scope and removes ambient authority", () => {
  const source = {
    [ENVIRONMENT_NAMES.token]: TOKEN,
    [ENVIRONMENT_NAMES.applicationId]: APPLICATION_ID,
    [ENVIRONMENT_NAMES.botId]: BOT_ID,
    [ENVIRONMENT_NAMES.allowedGuildIds]: "999999999999999999",
    [ENVIRONMENT_NAMES.allowedChannelIds]: "999999999999999998",
    [ENVIRONMENT_NAMES.allowDeletions]: "true",
    [ENVIRONMENT_NAMES.deleteChannelIds]: CHANNEL_ID,
    [ENVIRONMENT_NAMES.allowGateway]: "true",
    [ENVIRONMENT_NAMES.auditFile]: "/private/activity.jsonl",
    [ENVIRONMENT_NAMES.allowObservabilityExport]: "true",
    [ENVIRONMENT_NAMES.otelEndpoint]: "https://telemetry.invalid",
    DISCORD_MCP_FUTURE_WRITE_POLICY: "true",
    OTEL_EXPORTER_OTLP_CERTIFICATE: "/private/certificate.pem",
    UNRELATED_VALUE: "preserved",
  }
  const before = { ...source }
  const result = applySetupPreset({
    channelIds: [SECOND_CHANNEL_ID, CHANNEL_ID],
    environment: source,
    guildIds: [SECOND_GUILD_ID, GUILD_ID],
    name: "server-observer",
  })

  assert.deepEqual(source, before)
  assert.equal(result.preset.name, "server-observer")
  assert.equal(
    result.environment[ENVIRONMENT_NAMES.allowedGuildIds],
    `${GUILD_ID},${SECOND_GUILD_ID}`,
  )
  assert.equal(
    result.environment[ENVIRONMENT_NAMES.allowedChannelIds],
    `${CHANNEL_ID},${SECOND_CHANNEL_ID}`,
  )
  assert.equal(result.environment[ENVIRONMENT_NAMES.allowGateway], "false")
  assert.equal(result.environment[ENVIRONMENT_NAMES.toolSurface], "full")
  assert.equal(
    result.environment[ENVIRONMENT_NAMES.toolsets],
    result.preset.toolsets.join(","),
  )
  assert.equal(result.environment[ENVIRONMENT_NAMES.token], TOKEN)
  assert.equal(result.environment[ENVIRONMENT_NAMES.applicationId], APPLICATION_ID)
  assert.equal(result.environment[ENVIRONMENT_NAMES.botId], BOT_ID)
  assert.equal(result.environment[ENVIRONMENT_NAMES.allowDeletions], undefined)
  assert.equal(result.environment[ENVIRONMENT_NAMES.deleteChannelIds], undefined)
  assert.equal(result.environment[ENVIRONMENT_NAMES.auditFile], undefined)
  assert.equal(result.environment[ENVIRONMENT_NAMES.allowObservabilityExport], undefined)
  assert.equal(result.environment[ENVIRONMENT_NAMES.otelEndpoint], undefined)
  assert.equal(result.environment.DISCORD_MCP_FUTURE_WRITE_POLICY, undefined)
  assert.equal(result.environment.OTEL_EXPORTER_OTLP_CERTIFICATE, undefined)
  assert.equal(result.environment.UNRELATED_VALUE, "preserved")
})

test("preset scope validation rejects missing, duplicate, invalid, and excessive IDs", () => {
  assert.throws(
    () => applySetupPreset({ guildIds: [], name: "server-observer" }),
    /guild scope must contain 1-/,
  )
  assert.throws(
    () => applySetupPreset({ guildIds: [GUILD_ID, GUILD_ID], name: "server-observer" }),
    /guild scope must contain unique/,
  )
  assert.throws(
    () => applySetupPreset({ guildIds: ["not-an-id"], name: "server-observer" }),
    /guild scope must contain Discord snowflakes/,
  )
  assert.throws(
    () => applySetupPreset({ guildIds: [GUILD_ID], name: "channel-reader" }),
    /channel scope must contain 1-/,
  )
  assert.throws(
    () => applySetupPreset({
      channelIds: [CHANNEL_ID, CHANNEL_ID],
      guildIds: [GUILD_ID],
      name: "channel-reader",
    }),
    /channel scope must contain unique/,
  )
  assert.throws(
    () => applySetupPreset({
      channelIds: Array.from(
        { length: DISCORD_LIMITS.searchChannelIds + 1 },
        (_, index) => String(1_000_000_000_000_000_000n + BigInt(index)),
      ),
      guildIds: [GUILD_ID],
      name: "channel-reader",
    }),
    /channel scope must contain 1-/,
  )
})
