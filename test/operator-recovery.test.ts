import assert from "node:assert/strict"
import test from "node:test"

import {
  ConfigDocumentError,
  ConfigurationError,
  DiscordApiError,
  ProfileError,
  WriteCoordinationConflictError,
  WriteCoordinationQuarantinedError,
  WriteCoordinationResolutionError,
  WriteCoordinationStateError,
} from "../src/errors.js"
import {
  classifyCliFailure,
  safeCliFailureMessage,
} from "../src/operator-recovery.js"

const COMMAND_CONTEXT = Object.freeze({ usage: false })

function discordFailure(status: number, retryAfterMs?: number): DiscordApiError {
  return new DiscordApiError({
    message: `Remote route /guilds/100 returned ${status}`,
    method: "GET",
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    route: "/guilds/100",
    status,
  })
}

test("operator recovery classifies bounded Discord failures without routes", () => {
  const authentication = classifyCliFailure(discordFailure(401), COMMAND_CONTEXT)
  const permission = classifyCliFailure(discordFailure(403), COMMAND_CONTEXT)
  const limited = classifyCliFailure(discordFailure(429), COMMAND_CONTEXT)
  const server = classifyCliFailure(discordFailure(503), COMMAND_CONTEXT)
  const request = classifyCliFailure(discordFailure(404), COMMAND_CONTEXT)

  assert.equal(authentication.category, "discord-authentication")
  assert.equal(authentication.recovery.retry, "after-correction")
  assert.equal(permission.category, "discord-permission")
  assert.equal(permission.recovery.retry, "after-correction")
  assert.equal(limited.category, "discord-rate-limit")
  assert.equal(limited.recovery.retry, "after-delay")
  assert.match(limited.recovery.action, /reported Discord retry window/)
  assert.equal("retryAfterMs" in limited, false)
  assert.equal(server.category, "discord-remote")
  assert.equal(server.recovery.retry, "after-delay")
  assert.equal(request.category, "discord-remote")
  assert.equal(request.recovery.retry, "after-correction")
  for (const status of [401, 403, 404, 429, 503]) {
    const message = safeCliFailureMessage(discordFailure(status), COMMAND_CONTEXT)
    assert.equal(message, `Discord API request returned status ${status}`)
    assert.doesNotMatch(message, /guilds/)
  }
})

test("operator recovery distinguishes configuration, profile, and usage correction", () => {
  const credential = new ConfigDocumentError("credential is required")
  const profile = new ProfileError("Profile not found")
  const configuration = new ConfigurationError("Configuration is invalid")
  const usage = { helpTopic: "setup", usage: true }
  const genericUsage = { usage: true }

  assert.equal(classifyCliFailure(credential, COMMAND_CONTEXT).category, "configuration")
  assert.match(classifyCliFailure(credential, COMMAND_CONTEXT).recovery.action, /doctor/)
  assert.equal(classifyCliFailure(profile, COMMAND_CONTEXT).category, "profile")
  assert.equal(classifyCliFailure(configuration, COMMAND_CONTEXT).category, "configuration")
  assert.match(classifyCliFailure(new Error("ignored"), usage).recovery.action, /help setup/)
  assert.match(classifyCliFailure(new Error("ignored"), genericUsage).recovery.action, /discord-mcp help/)
  assert.equal(safeCliFailureMessage(credential, COMMAND_CONTEXT), "credential is required")
  assert.equal(safeCliFailureMessage(profile, COMMAND_CONTEXT), "Profile not found")
  assert.equal(safeCliFailureMessage(configuration, COMMAND_CONTEXT), "Configuration is invalid")
  assert.equal(safeCliFailureMessage(new Error("argument secret"), usage), "Invalid command usage")
})

test("operator recovery requires inspection for every coordination error", () => {
  const claimId = `claim_${"a".repeat(32)}`
  const errors = [
    new WriteCoordinationConflictError(claimId),
    new WriteCoordinationQuarantinedError(claimId),
    new WriteCoordinationResolutionError("resolution failed"),
    new WriteCoordinationStateError("state failed"),
  ]

  for (const error of errors) {
    const result = classifyCliFailure(error, COMMAND_CONTEXT)
    assert.equal(result.category, "write-coordination")
    assert.equal(result.recovery.retry, "after-inspection")
    assert.match(result.recovery.action, /coordination list/)
    assert.equal(safeCliFailureMessage(error, COMMAND_CONTEXT), error.message)
  }
  assert.equal(
    safeCliFailureMessage(new Error("private path"), COMMAND_CONTEXT),
    "Operator command failed",
  )
})
