import assert from "node:assert/strict"
import test from "node:test"

import {
  ONBOARD_DETECTABLE_HOST_IDS,
  ONBOARD_HOST_IDS,
  assertReusableOnboardPolicy,
  createOnboardReport,
  isDetectableOnboardHostId,
  isOnboardHostId,
  resolveAvailableOnboardHtmlFile,
  resolveDefaultOnboardConfigFile,
  reusableOnboardInstallPlan,
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
  assert.deepEqual(ONBOARD_DETECTABLE_HOST_IDS, [
    "claude-desktop",
    "claude-code",
    "codex",
    "cursor",
    "vscode",
    "gemini-extension",
  ])
  for (const id of ONBOARD_DETECTABLE_HOST_IDS) {
    assert.equal(isDetectableOnboardHostId(id), true)
  }
  assert.equal(isDetectableOnboardHostId("mcp-json"), false)
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

test("onboarding reuses only an exact existing observer policy", () => {
  const fixture = onboardFixture("/private/guildcontrol.json")
  assert.deepEqual(
    reusableOnboardInstallPlan(fixture.document, fixture.configFile),
    fixture.install,
  )
  assert.doesNotThrow(() => assertReusableOnboardPolicy(
    fixture.document,
    fixture.configFile,
    fixture.install,
  ))
  assert.throws(
    () => assertReusableOnboardPolicy(
      {
        ...fixture.document,
        gateway: {
          ...fixture.document.gateway,
          enabled: true,
        },
      },
      fixture.configFile,
      fixture.install,
    ),
    /does not exactly match/,
  )
  assert.throws(
    () => reusableOnboardInstallPlan(
      {
        ...fixture.document,
        readScope: {
          ...fixture.document.readScope,
          guildIds: [fixture.install.guildId, "222222222222222222"],
        },
      },
      fixture.configFile,
    ),
    /does not exactly match/,
  )
})

test("onboarding allocates the first unoccupied private guide filename", () => {
  const occupied = new Set([
    "/private/guildcontrol-onboarding.html",
    "/private/guildcontrol-onboarding-2.html",
  ])
  assert.equal(
    resolveAvailableOnboardHtmlFile(
      "/private/guildcontrol.json",
      (file) => occupied.has(file),
    ),
    "/private/guildcontrol-onboarding-3.html",
  )
  assert.throws(
    () => resolveAvailableOnboardHtmlFile(
      "/private/guildcontrol.json",
      () => true,
    ),
    /choose an explicit --html path/,
  )
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
  assert.equal(report.credentialHandoff.setupAccess, "existing-environment")
  assert.equal(report.credentialHandoff.hostAction, "inherit-environment")
  assert.equal(
    report.credentialHandoff.additionalTokenEntry,
    "not-required-if-inherited",
  )
  assert.match(report.credentialHandoff.summary, /Reuse DISCORD_BOT_TOKEN/)
  assert.equal(report.firstRead.guildId, fixture.install.guildId)
  assert.equal(report.policyDisposition, "created")
  assert.equal(report.privacy.credentialValuesEmbedded, false)
  assert.match(report.onboardDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(verifyOnboardReport(report), true)
  const reused = createOnboardReport({
    ...fixture,
    hostId: "codex",
    policyDisposition: "reused",
  })
  assert.equal(reused.policyDisposition, "reused")
  assert.notEqual(reused.onboardDigest, report.onboardDigest)
  assert.equal(verifyOnboardReport(reused), true)
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
  assert.equal(report.credentialHandoff.hostAction, "enter-in-host")
  assert.equal(report.credentialHandoff.additionalTokenEntry, "required")
  assert.equal(verifyOnboardReport(report), true)
})

test("onboarding distinguishes cleared prompts from reusable protected files", () => {
  const environmentFixture = onboardFixture()
  const prompted = createOnboardReport({
    ...environmentFixture,
    credentialAccess: "one-time-prompt",
    hostId: "codex",
  })
  assert.equal(prompted.credentialHandoff.hostAction, "enter-in-host")
  assert.equal(prompted.credentialHandoff.additionalTokenEntry, "required")
  assert.match(prompted.credentialHandoff.details.join(" "), /cleared after the verified smoke test/)

  const fileFixture = onboardFixture(
    "/private/guildcontrol.json",
    "/run/secrets/discord_bot_token",
  )
  const fileBacked = createOnboardReport({
    ...fileFixture,
    hostId: "vscode",
  })
  assert.equal(fileBacked.credentialHandoff.hostAction, "reuse-protected-file")
  assert.equal(fileBacked.credentialHandoff.additionalTokenEntry, "not-required")
  assert.match(fileBacked.credentialHandoff.details.join(" "), /No second token entry is needed/)
  assert.equal(verifyOnboardReport(fileBacked), true)
})

test("onboarding rejects credential access claims that contradict policy custody", () => {
  const fixture = onboardFixture()
  assert.throws(
    () => createOnboardReport({
      ...fixture,
      credentialAccess: "protected-file",
      hostId: "codex",
    }),
    /does not match the selected host and policy/,
  )
})

test("onboarding rejects an unknown policy disposition", () => {
  const fixture = onboardFixture()
  assert.throws(
    () => createOnboardReport({
      ...fixture,
      hostId: "codex",
      policyDisposition: "changed" as "created",
    }),
    /exact policy disposition/,
  )
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
