import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_LIMITS,
  MCP_ALWAYS_AVAILABLE_TOOL_NAMES,
} from "../src/constants.js"
import { selectedCanonicalMcpToolNames } from "../src/mcp-tool-catalog.js"
import { MCP_TOOL_RISK_CLASSES } from "../src/observability-catalog.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import {
  applySetupPreset,
  getSetupPreset,
  normalizeSetupPresetName,
  SETUP_PRESETS,
  SETUP_PRESET_NAMES,
} from "../src/setup-presets.js"

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
  assert.deepEqual(SETUP_PRESETS[0]?.requirements.botPermissions, ["VIEW_CHANNEL"])
  assert.equal(SETUP_PRESETS[0]?.requirements.botPermissionBitfield, "1024")
  assert.deepEqual(SETUP_PRESETS[0]?.requirements.privilegedIntents, [])
  assert.equal(SETUP_PRESETS[1]?.requirements.channelIds, "required")
  assert.equal(SETUP_PRESETS[1]?.requirements.messageContentIntent, "recommended")
  assert.deepEqual(SETUP_PRESETS[1]?.requirements.botPermissions, [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
  ])
  assert.equal(SETUP_PRESETS[1]?.requirements.botPermissionBitfield, "66560")
  assert.deepEqual(SETUP_PRESETS[1]?.requirements.privilegedIntents, [{
    name: "MESSAGE_CONTENT",
    status: "recommended",
  }])

  for (const preset of SETUP_PRESETS) {
    assert.equal(Object.isFrozen(preset), true)
    assert.equal(Object.isFrozen(preset.requirements), true)
    assert.equal(Object.isFrozen(preset.requirements.botPermissions), true)
    assert.equal(Object.isFrozen(preset.requirements.privilegedIntents), true)
    assert.equal(Object.isFrozen(preset.riskClasses), true)
    assert.equal(Object.isFrozen(preset.toolNames), true)
    assert.equal(Object.isFrozen(preset.toolsets), true)
    assert.equal(preset.gatewayEnabled, false)
    assert.equal(
      preset.requirements.threadScope,
      "inherits-allowlisted-parent",
    )
    assert.equal(preset.toolSurface, "progressive")
    assert.equal(preset.writeCapable, false)
    assert.equal(preset.requirements.botPermissions.includes("ADMINISTRATOR"), false)
    assert.equal(
      preset.requirements.botPermissions.reduce(
        (permissions, name) => permissions | DISCORD_PERMISSIONS[name],
        0n,
      ).toString(),
      preset.requirements.botPermissionBitfield,
    )
    assert.deepEqual(
      preset.toolNames,
      [
        ...MCP_ALWAYS_AVAILABLE_TOOL_NAMES,
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

test("server observer materializes an immutable exact policy fragment", () => {
  const result = applySetupPreset({
    channelIds: [SECOND_CHANNEL_ID, CHANNEL_ID],
    guildIds: [SECOND_GUILD_ID, GUILD_ID],
    name: "server-observer",
  })

  assert.equal(result.preset.name, "server-observer")
  assert.deepEqual(result.policy.guildIds, [GUILD_ID, SECOND_GUILD_ID])
  assert.deepEqual(result.policy.channelIds, [CHANNEL_ID, SECOND_CHANNEL_ID])
  assert.equal(result.policy.gatewayEnabled, false)
  assert.equal(result.policy.toolSurface, "progressive")
  assert.deepEqual(result.policy.toolsets, result.preset.toolsets)
  assert.equal(Object.isFrozen(result.policy), true)
  assert.equal(Object.isFrozen(result.policy.guildIds), true)
  assert.equal(Object.isFrozen(result.policy.channelIds), true)
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
