import assert from "node:assert/strict"
import test from "node:test"

import {
  projectApplicationPosture,
  type ApplicationPostureRequirements,
} from "../src/application-posture.js"
import { DISCORD_APPLICATION_FLAGS } from "../src/constants.js"
import { ApplicationPostureEvidenceError } from "../src/errors.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type { DiscordApplication } from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "100000000000000002"

const DEFAULT_REQUIREMENTS: ApplicationPostureRequirements = {
  guildMembersIntentRequired: false,
  messageContentIntent: "not-required",
  nativeInteractionIngressRequired: false,
}

function application(
  overrides: Partial<DiscordApplication> & Record<string, unknown> = {},
): DiscordApplication {
  return {
    bot_public: false,
    bot_require_code_grant: false,
    description: "private application description",
    flags: 0,
    flags_new: "0",
    id: APPLICATION_ID,
    integration_types_config: {
      "0": {},
      "1": {},
    },
    interactions_endpoint_url: null,
    name: "private application name",
    ...overrides,
  }
}

test("application posture returns bounded privacy-safe current application evidence", () => {
  const flags = DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited
    | DISCORD_APPLICATION_FLAGS.gatewayPresenceLimited
    | DISCORD_APPLICATION_FLAGS.verificationPendingGuildLimit
    | (1n << 60n)
  const result = projectApplicationPosture(application({
    event_webhooks_status: 1,
    event_webhooks_types: [],
    flags: 0,
    flags_new: flags.toString(),
    owner: { id: "private-owner" },
    redirect_uris: [],
    rpc_origins: [],
    undocumented_private_field: "private-value",
  }), BOT_ID, DEFAULT_REQUIREMENTS)

  assert.equal(result.applicationId, APPLICATION_ID)
  assert.equal(result.botId, BOT_ID)
  assert.deepEqual(result.access, {
    botPublic: false,
    botRequiresCodeGrant: false,
  })
  assert.deepEqual(result.privilegedIntents, {
    guildMembers: "disabled",
    messageContent: "enabled",
    presence: "enabled",
  })
  assert.deepEqual(result.applicationFlags, {
    unknownBitCount: 1,
    verificationPendingGuildLimit: true,
  })
  assert.equal(result.installation.contextsReported, true)
  assert.equal(result.installation.guild.supported, true)
  assert.equal(result.installation.guild.defaultAuthorization, null)
  assert.equal(result.installation.user.supported, true)
  assert.equal(result.installation.redirectUriCount, 0)
  assert.equal(result.installation.rpcOriginCount, 0)
  assert.deepEqual(result.interactions, {
    delivery: "gateway",
    endpointConfigured: false,
  })
  assert.deepEqual(result.eventWebhooks, {
    endpointConfigured: false,
    status: "disabled",
    subscriptionTypeCount: 0,
  })
  assert.equal(result.unknownFieldCount, 1)
  assert.equal(result.unknownEnumCount, 0)
  assert.deepEqual(result.findings.map(({ code }) => code), [
    "presence-intent-enabled",
  ])

  const serialized = JSON.stringify(result)
  for (const privateValue of [
    "private application description",
    "private application name",
    "private-owner",
    "private-value",
  ]) assert.doesNotMatch(serialized, new RegExp(privateValue, "u"))
})

test("application posture projects known defaults and counts unknown authority", () => {
  const permissions = DISCORD_PERMISSIONS.ADMINISTRATOR
    | DISCORD_PERMISSIONS.VIEW_CHANNEL
    | (1n << 90n)
  const result = projectApplicationPosture(application({
    install_params: {
      permissions: "0",
      scopes: ["bot"],
    },
    integration_types_config: {
      "0": {
        future_configuration: true,
        oauth2_install_params: {
          future_default: true,
          permissions: permissions.toString(),
          scopes: ["applications.commands", "bot", "future.scope"],
        },
      },
      "1": {},
      "7": { future_private_shape: { value: "omitted" } },
    } as unknown as NonNullable<DiscordApplication["integration_types_config"]>,
  }), BOT_ID, DEFAULT_REQUIREMENTS)

  assert.deepEqual(result.installation.guild.defaultAuthorization, {
    administrator: true,
    applicationCommandsScope: true,
    botScope: true,
    permissionNames: ["ADMINISTRATOR", "VIEW_CHANNEL"],
    unknownFieldCount: 1,
    unknownPermissionBitCount: 1,
    unknownScopeCount: 1,
  })
  assert.equal(result.installation.guild.unknownFieldCount, 2)
  assert.equal(result.installation.legacyDefaults?.botScope, true)
  assert.equal(result.installation.unknownContextCount, 1)
  assert.equal(result.unknownEnumCount, 1)
  assert.equal(result.unknownFieldCount, 3)
  assert.deepEqual(result.findings.map(({ code }) => code), [
    "administrator-default-permissions",
    "unknown-install-contexts",
    "unknown-install-permissions",
  ])
})

test("application posture reports connector-specific blockers and warnings", () => {
  const result = projectApplicationPosture(application({
    bot_public: true,
    bot_require_code_grant: true,
    custom_install_url: "https://install.invalid/secret",
    event_webhooks_status: 2,
    event_webhooks_types: ["private.event"],
    event_webhooks_url: "https://events.invalid/secret",
    flags_new: DISCORD_APPLICATION_FLAGS.gatewayPresence.toString(),
    integration_types_config: {
      "1": {},
    },
    interactions_endpoint_url: "https://interactions.invalid/secret",
    role_connections_verification_url: "https://roles.invalid/secret",
  }), BOT_ID, {
    guildMembersIntentRequired: true,
    messageContentIntent: "required",
    nativeInteractionIngressRequired: true,
  })

  assert.deepEqual(result.connectorFit, {
    callbackFreeGuildInstall: "blocked",
    guildMembersIntent: "blocked",
    messageContentIntent: "blocked",
    nativeInteractionIngress: "blocked",
    presenceIntent: "unnecessary",
  })
  assert.deepEqual(result.findings.map(({ code, severity }) => ({ code, severity })), [
    { code: "guild-install-unsupported", severity: "blocker" },
    { code: "oauth-code-grant-required", severity: "blocker" },
    { code: "interaction-delivery-conflict", severity: "blocker" },
    { code: "required-guild-members-intent-disabled", severity: "blocker" },
    { code: "required-message-content-intent-disabled", severity: "blocker" },
    { code: "bot-public", severity: "warning" },
    { code: "custom-install-url", severity: "warning" },
    { code: "event-webhooks-enabled", severity: "warning" },
    { code: "presence-intent-enabled", severity: "warning" },
  ])
  assert.deepEqual(result.findingCounts, { blockers: 5, warnings: 4 })
  assert.equal(result.interactions.delivery, "outgoing-webhook")
  assert.equal(result.eventWebhooks.subscriptionTypeCount, 1)
  assert.equal(result.roleConnections.verificationEndpointConfigured, true)

  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /https:\/\//u)
  assert.doesNotMatch(serialized, /private\.event/u)
})

test("application posture distinguishes recommended intent degradation and unknown flags", () => {
  const disabled = projectApplicationPosture(application(), BOT_ID, {
    ...DEFAULT_REQUIREMENTS,
    messageContentIntent: "recommended",
  })
  const unknown = projectApplicationPosture(application({
    flags_new: "not-a-bitfield",
  }), BOT_ID, {
    ...DEFAULT_REQUIREMENTS,
    guildMembersIntentRequired: true,
  })

  assert.equal(disabled.connectorFit.messageContentIntent, "degraded")
  assert.deepEqual(disabled.findings.map(({ code }) => code), [
    "recommended-message-content-intent-disabled",
  ])
  assert.equal(unknown.privilegedIntents.guildMembers, "unknown")
  assert.equal(unknown.applicationFlags.unknownBitCount, null)
  assert.equal(unknown.applicationFlags.verificationPendingGuildLimit, null)
  assert.deepEqual(unknown.findings.map(({ code }) => code), [
    "unknown-required-intent-state",
  ])
})

test("application posture preserves absent optional evidence explicitly", () => {
  const value = application()
  delete value.integration_types_config
  delete value.flags
  delete value.flags_new
  const result = projectApplicationPosture(value, BOT_ID, DEFAULT_REQUIREMENTS)

  assert.equal(result.installation.contextsReported, false)
  assert.equal(result.installation.guild.supported, null)
  assert.equal(result.installation.user.supported, null)
  assert.equal(result.connectorFit.callbackFreeGuildInstall, "unknown")
  assert.equal(result.eventWebhooks.status, "not-reported")
  assert.equal(result.eventWebhooks.subscriptionTypeCount, null)
  assert.deepEqual(result.findings.map(({ code }) => code), [
    "unknown-install-contexts",
  ])
})

test("application posture fails closed on malformed known evidence", () => {
  const tooMany = Array.from({ length: 101 }, (_, index) => `scope-${index}`)
  const missingBotPublic = application()
  delete missingBotPublic.bot_public
  const malformed: DiscordApplication[] = [
    missingBotPublic,
    application({ integration_types_config: [] as unknown as Record<string, never> }),
    application({
      integration_types_config: {
        "0": {
          oauth2_install_params: {
            permissions: "0",
            scopes: ["bot", "bot"],
          },
        },
      },
    }),
    application({
      install_params: { permissions: "-1", scopes: [] },
    }),
    application({ event_webhooks_status: "enabled" as unknown as number }),
    application({ interactions_endpoint_url: "" }),
    application({
      install_params: { permissions: "0", scopes: tooMany },
    }),
  ]

  for (const value of malformed) {
    assert.throws(
      () => projectApplicationPosture(value, BOT_ID, DEFAULT_REQUIREMENTS),
      ApplicationPostureEvidenceError,
    )
  }
})
