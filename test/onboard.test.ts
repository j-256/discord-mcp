import assert from "node:assert/strict"
import test from "node:test"

import {
  ONBOARD_HOST_IDS,
  createOnboardReport,
  isOnboardHostId,
  resolveDefaultOnboardConfigFile,
  verifyOnboardReport,
} from "../src/onboard.js"
import { onboardFixture } from "./onboard-fixture.js"

test("onboarding exposes the complete host-first destination catalog", () => {
  assert.deepEqual(ONBOARD_HOST_IDS, [
    "claude-desktop",
    "claude-code",
    "codex",
    "cursor",
    "vscode",
    "gemini-extension",
    "mcp-json",
  ])
  for (const id of ONBOARD_HOST_IDS) assert.equal(isOnboardHostId(id), true)
  assert.equal(isOnboardHostId("unknown"), false)
})

test("default onboarding policy follows the CLI-owned platform config root", () => {
  assert.equal(resolveDefaultOnboardConfigFile({
    environment: {},
    homeDirectory: "/Users/operator",
    platform: "darwin",
  }), "/Users/operator/Library/Application Support/guildcontrol/guildcontrol.json")
  assert.equal(resolveDefaultOnboardConfigFile({
    environment: { XDG_CONFIG_HOME: "/private/config" },
    homeDirectory: "/home/operator",
    platform: "linux",
  }), "/private/config/guildcontrol/guildcontrol.json")
  assert.equal(resolveDefaultOnboardConfigFile({
    environment: { APPDATA: "C:\\Users\\operator\\AppData\\Roaming" },
    homeDirectory: "C:\\Users\\operator",
    platform: "win32",
  }).endsWith("guildcontrol/guildcontrol.json"), true)
})

test("onboarding binds install, policy, stdio smoke, and one exact host adapter", () => {
  const fixture = onboardFixture()
  const report = createOnboardReport({
    ...fixture,
    hostId: "codex",
  })
  assert.equal(report.host.id, "codex")
  assert.equal(report.host.route.kind, "adapter")
  if (report.host.route.kind !== "adapter") assert.fail("Expected adapter route")
  assert.equal(report.host.route.adapter.id, "codex")
  assert.equal(report.firstRead.guildId, fixture.install.guildId)
  assert.equal(report.privacy.credentialValuesEmbedded, false)
  assert.match(report.onboardDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(verifyOnboardReport(report), true)
})

test("Claude Desktop onboarding selects the exact versioned MCPB route", () => {
  const fixture = onboardFixture()
  const report = createOnboardReport({
    ...fixture,
    hostId: "claude-desktop",
  })
  assert.equal(report.host.route.kind, "mcpb")
  if (report.host.route.kind !== "mcpb") assert.fail("Expected MCPB route")
  assert.match(report.host.route.archiveName, /^guildcontrol-[0-9]+\.[0-9]+\.[0-9]+\.mcpb$/)
  assert.match(report.host.route.downloadUrl, /github\.com\/j-256\/guildcontrol\/releases\/download/)
  assert.equal(verifyOnboardReport(report), true)
})

test("onboarding rejects evidence from another application or transport", () => {
  const fixture = onboardFixture()
  assert.throws(
    () => createOnboardReport({
      ...fixture,
      hostId: "cursor",
      setup: {
        ...fixture.setup,
        applicationId: "999999999999999999",
      },
    }),
    /does not match/,
  )
  assert.throws(
    () => createOnboardReport({
      ...fixture,
      hostId: "cursor",
      smoke: {
        ...fixture.smoke,
        transport: "in-memory",
      },
    }),
    /smoke evidence/,
  )
  assert.throws(
    () => createOnboardReport({
      ...fixture,
      hostId: "cursor",
      smoke: {
        ...fixture.smoke,
        writeCapableTools: ["send_message"],
      },
    }),
    /smoke evidence/,
  )
  assert.throws(
    () => createOnboardReport({
      ...fixture,
      hostId: "cursor",
      setup: {
        ...fixture.setup,
        configBackupFile: "/private/previous-config.json",
      },
    }),
    /setup evidence/,
  )
})
