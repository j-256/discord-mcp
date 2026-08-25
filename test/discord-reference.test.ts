import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_SNOWFLAKE_MAX,
  SCHEMA_VERSION,
} from "../src/constants.js"
import {
  DISCORD_REFERENCE_LIMITS,
  parseDiscordReference,
  type DiscordReferencePolicyEvaluator,
} from "../src/discord-reference.js"

const GUILD_ID = "123456789012345678"
const CHANNEL_ID = "223456789012345678"
const MESSAGE_ID = "323456789012345678"
const USER_ID = "423456789012345678"
const ROLE_ID = "523456789012345678"
const COMMAND_ID = "623456789012345678"
const EMOJI_ID = "723456789012345678"

function policy(options: {
  channels?: readonly string[]
  guilds?: readonly string[]
} = {}): DiscordReferencePolicyEvaluator {
  const channels = new Set(options.channels ?? [CHANNEL_ID])
  const guilds = new Set(options.guilds ?? [GUILD_ID])
  return {
    channelRead(channelId) {
      return channels.has(channelId) ? "allowed" : "blocked"
    },
    guildRead(guildId) {
      return guilds.has(guildId) ? "allowed" : "blocked"
    },
  }
}

test("Discord reference parser accepts exact guild and private jump links", () => {
  assert.deepEqual(
    parseDiscordReference(
      `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`,
      policy(),
    ),
    {
      ids: { channelId: CHANNEL_ID, guildId: GUILD_ID },
      kind: "guild-channel",
      policy: {
        channelRead: "allowed",
        guildRead: "allowed",
        status: "eligible",
      },
      privacy: {
        discordAccessVerified: false,
        downstreamAuthorizationRequired: true,
        namesReturned: false,
        networkContacted: false,
        persisted: false,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "parsed",
    },
  )

  assert.deepEqual(
    parseDiscordReference(
      `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`,
      policy(),
    ).ids,
    { channelId: CHANNEL_ID, guildId: GUILD_ID, messageId: MESSAGE_ID },
  )
  assert.equal(
    parseDiscordReference(
      `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`,
      policy(),
    ).kind,
    "guild-message",
  )

  const privateChannel = parseDiscordReference(
    `https://discord.com/channels/@me/${CHANNEL_ID}`,
    policy(),
  )
  assert.deepEqual(privateChannel.ids, { channelId: CHANNEL_ID })
  assert.equal(privateChannel.kind, "private-channel")
  assert.deepEqual(privateChannel.policy, {
    channelRead: "unknown",
    guildRead: "not-applicable",
    status: "incomplete",
  })

  const privateMessage = parseDiscordReference(
    `https://discord.com/channels/@me/${CHANNEL_ID}/${MESSAGE_ID}`,
    policy(),
  )
  assert.deepEqual(privateMessage.ids, {
    channelId: CHANNEL_ID,
    messageId: MESSAGE_ID,
  })
  assert.equal(privateMessage.kind, "private-message")
})

test("Discord reference parser accepts official typed mention forms and omits names", () => {
  const cases = [
    {
      expected: {
        deprecatedSyntax: false,
        ids: { userId: USER_ID },
        kind: "user-mention",
      },
      reference: `<@${USER_ID}>`,
    },
    {
      expected: {
        deprecatedSyntax: true,
        ids: { userId: USER_ID },
        kind: "user-mention",
      },
      reference: `<@!${USER_ID}>`,
    },
    {
      expected: {
        ids: { channelId: CHANNEL_ID },
        kind: "channel-mention",
      },
      reference: `<#${CHANNEL_ID}>`,
    },
    {
      expected: {
        ids: { roleId: ROLE_ID },
        kind: "role-mention",
      },
      reference: `<@&${ROLE_ID}>`,
    },
    {
      expected: {
        ids: { commandId: COMMAND_ID },
        kind: "application-command-mention",
      },
      reference: `</review member:${COMMAND_ID}>`,
    },
    {
      expected: {
        ids: { commandId: COMMAND_ID },
        kind: "application-command-mention",
      },
      reference: `</\u00fcber pr\u00fcfung:${COMMAND_ID}>`,
    },
    {
      expected: {
        animated: false,
        ids: { emojiId: EMOJI_ID },
        kind: "custom-emoji-mention",
      },
      reference: `<:private_name:${EMOJI_ID}>`,
    },
    {
      expected: {
        animated: true,
        ids: { emojiId: EMOJI_ID },
        kind: "custom-emoji-mention",
      },
      reference: `<a:animated_name:${EMOJI_ID}>`,
    },
  ] as const

  for (const { expected, reference } of cases) {
    const result = parseDiscordReference(reference, policy())
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(result).filter(([key]) => (
          key === "animated"
          || key === "deprecatedSyntax"
          || key === "ids"
          || key === "kind"
        )),
      ),
      expected,
      reference,
    )
    assert.doesNotMatch(JSON.stringify(result), /private_name|animated_name|review member/u)
    assert.deepEqual(result.privacy, {
      discordAccessVerified: false,
      downstreamAuthorizationRequired: true,
      namesReturned: false,
      networkContacted: false,
      persisted: false,
    })
  }

  assert.deepEqual(
    parseDiscordReference(`<@${DISCORD_SNOWFLAKE_MAX}>`, policy()).ids,
    { userId: DISCORD_SNOWFLAKE_MAX.toString() },
  )
})

test("Discord reference parser reports bounded local policy eligibility without Discord claims", () => {
  const guildBlocked = parseDiscordReference(
    `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`,
    policy({ guilds: [] }),
  )
  assert.deepEqual(guildBlocked.policy, {
    channelRead: "allowed",
    guildRead: "blocked",
    status: "blocked",
  })

  const channelBlocked = parseDiscordReference(
    `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`,
    policy({ channels: [] }),
  )
  assert.deepEqual(channelBlocked.policy, {
    channelRead: "blocked",
    guildRead: "allowed",
    status: "blocked",
  })

  const channelMention = parseDiscordReference(
    `<#${CHANNEL_ID}>`,
    policy(),
  )
  assert.deepEqual(channelMention.policy, {
    channelRead: "allowed",
    guildRead: "unknown",
    status: "incomplete",
  })

  const blockedMention = parseDiscordReference(
    `<#${CHANNEL_ID}>`,
    policy({ channels: [] }),
  )
  assert.deepEqual(blockedMention.policy, {
    channelRead: "blocked",
    guildRead: "unknown",
    status: "blocked",
  })

  const userMention = parseDiscordReference(`<@${USER_ID}>`, policy())
  assert.deepEqual(userMention.policy, {
    channelRead: "not-applicable",
    guildRead: "not-applicable",
    status: "not-applicable",
  })
  assert.equal(userMention.privacy.discordAccessVerified, false)
  assert.equal(userMention.privacy.downstreamAuthorizationRequired, true)
})

test("Discord reference parser rejects malformed, embedded, ambiguous, and unsupported forms", () => {
  const invalid = [
    "",
    "0",
    ` https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`,
    `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID} `,
    `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/`,
    `http://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`,
    `https://canary.discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`,
    `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}?token=private`,
    `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}#private`,
    `https://discord.com/channels/0/${CHANNEL_ID}`,
    `https://discord.com/channels/${GUILD_ID}/18446744073709551616`,
    `https://discord.com/channels/${GUILD_ID}/0${CHANNEL_ID}`,
    `See <#${CHANNEL_ID}>`,
    `<#${CHANNEL_ID}> <@${USER_ID}>`,
    `<@0>`,
    `</review  member:${COMMAND_ID}>`,
    `</review group item extra:${COMMAND_ID}>`,
    `</review*:${COMMAND_ID}>`,
    `</Review:${COMMAND_ID}>`,
    `<:x:${EMOJI_ID}>`,
    `<id:guide>`,
    `<t:1618953630>`,
    `<@${USER_ID}>\n`,
    "\uD800",
    "\uDC00",
    "x".repeat(DISCORD_REFERENCE_LIMITS.characters + 1),
  ]

  for (const reference of invalid) {
    assert.throws(
      () => parseDiscordReference(reference, policy()),
      /Discord reference/u,
      reference.slice(0, 80),
    )
  }

  assert.throws(
    () => parseDiscordReference(null, policy()),
    /Discord reference must be one string/u,
  )
})

test("Discord reference parser rejects sensitive links without echoing their values", () => {
  const privateValue = "private-capability-value"
  const sensitive = [
    `https://discord.gg/${privateValue}`,
    `https://discord.com/invite/${privateValue}`,
    `https://discord.com/api/webhooks/${CHANNEL_ID}/${privateValue}`,
    `https://discord.com/api/v10/webhooks/${CHANNEL_ID}/${privateValue}`,
    `https://discord.com/oauth2/authorize?token=${privateValue}`,
    `https://cdn.discordapp.com/attachments/${CHANNEL_ID}/${MESSAGE_ID}/${privateValue}`,
    `https://media.discordapp.net/attachments/${CHANNEL_ID}/${MESSAGE_ID}/${privateValue}`,
  ]

  for (const reference of sensitive) {
    assert.throws(
      () => parseDiscordReference(reference, policy()),
      (error) => {
        assert.ok(error instanceof Error)
        assert.doesNotMatch(error.message, new RegExp(privateValue, "u"))
        assert.match(error.message, /not accepted|unsupported/u)
        return true
      },
    )
  }
})
