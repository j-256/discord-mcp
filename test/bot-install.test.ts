import assert from "node:assert/strict"
import test from "node:test"

import {
  BOT_INSTALL_REPORT_SCHEMA_VERSION,
  createBotInstallPlan,
} from "../src/bot-install.js"
import { DEFAULT_TOKEN_ENVIRONMENT_VARIABLE } from "../src/constants.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "300000000000000001"

test("bot installation plans are exact, fixed-origin, and credential-free", () => {
  const observer = createBotInstallPlan({
    applicationId: ` ${APPLICATION_ID} `,
    guildId: ` ${GUILD_ID} `,
    preset: "SERVER-OBSERVER",
  })

  assert.equal(Object.isFrozen(observer), true)
  assert.equal(Object.isFrozen(observer.authorization), true)
  assert.equal(Object.isFrozen(observer.authorization.scopes), true)
  assert.equal(Object.isFrozen(observer.execution), true)
  assert.equal(Object.isFrozen(observer.permissions), true)
  assert.equal(Object.isFrozen(observer.postInstall), true)
  assert.equal(Object.isFrozen(observer.postInstall.commands), true)
  assert.equal(Object.isFrozen(observer.preset), true)
  assert.equal(observer.schemaVersion, BOT_INSTALL_REPORT_SCHEMA_VERSION)
  assert.equal(observer.status, "ok")
  assert.equal(observer.applicationId, APPLICATION_ID)
  assert.equal(observer.guildId, GUILD_ID)
  assert.deepEqual(observer.authorization, {
    callbackRequired: false,
    guildSelectionLocked: true,
    installContext: "guild",
    scopes: ["bot"],
    userTokenRequested: false,
  })
  assert.deepEqual(observer.execution, {
    browserOpened: false,
    credentialsRequired: false,
    discordContacted: false,
  })
  assert.deepEqual(observer.permissions, {
    administratorRequested: false,
    bitfield: "1024",
    names: ["VIEW_CHANNEL"],
  })
  assert.deepEqual(observer.privilegedIntents, [])
  assert.equal(observer.postInstall.credentialVariable, DEFAULT_TOKEN_ENVIRONMENT_VARIABLE)
  assert.deepEqual(observer.postInstall.commands, [
    `discord-mcp setup --config ./discord-mcp.json --preset server-observer --guild-id ${GUILD_ID}`,
    "discord-mcp config validate ./discord-mcp.json",
    "discord-mcp doctor --config ./discord-mcp.json --online",
    "discord-mcp smoke --config ./discord-mcp.json",
  ])

  const url = new URL(observer.installUrl)
  assert.equal(url.origin, "https://discord.com")
  assert.equal(url.pathname, "/oauth2/authorize")
  assert.deepEqual([...url.searchParams], [
    ["client_id", APPLICATION_ID],
    ["scope", "bot"],
    ["permissions", "1024"],
    ["guild_id", GUILD_ID],
    ["disable_guild_select", "true"],
  ])
  assert.equal(url.searchParams.has("redirect_uri"), false)
  assert.equal(url.searchParams.has("response_type"), false)
  assert.equal(url.searchParams.has("state"), false)
})

test("channel reader installation plans add only history access and intent guidance", () => {
  const first = createBotInstallPlan({
    applicationId: APPLICATION_ID,
    guildId: GUILD_ID,
    preset: "channel-reader",
  })
  const second = createBotInstallPlan({
    applicationId: APPLICATION_ID,
    guildId: GUILD_ID,
    preset: "channel-reader",
  })

  assert.deepEqual(second, first)
  assert.equal(second.installUrl, first.installUrl)
  assert.deepEqual(first.permissions, {
    administratorRequested: false,
    bitfield: "66560",
    names: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
  })
  assert.deepEqual(first.privilegedIntents, [{
    name: "MESSAGE_CONTENT",
    status: "recommended",
  }])
  assert.match(first.postInstall.commands[0] || "", /--channel-id CHANNEL_ID$/)
  const serialized = JSON.stringify(first)
  assert.doesNotMatch(serialized, /client_secret|redirect_uri|response_type|user_token/iu)
  assert.doesNotMatch(serialized, /ADMINISTRATOR/)
})

test("bot installation plans reject invalid public IDs and unknown presets", () => {
  for (const applicationId of ["", "0", "not-an-id", "18446744073709551616"]) {
    assert.throws(
      () => createBotInstallPlan({
        applicationId,
        guildId: GUILD_ID,
        preset: "server-observer",
      }),
      /Application ID must be a Discord snowflake/,
    )
  }
  for (const guildId of ["", "0", "not-an-id", "18446744073709551616"]) {
    assert.throws(
      () => createBotInstallPlan({
        applicationId: APPLICATION_ID,
        guildId,
        preset: "server-observer",
      }),
      /Guild ID must be a Discord snowflake/,
    )
  }
  assert.throws(
    () => createBotInstallPlan({
      applicationId: APPLICATION_ID,
      guildId: GUILD_ID,
      preset: "writer",
    }),
    /Setup preset must be one of/,
  )
})
