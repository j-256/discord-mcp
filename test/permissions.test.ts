import assert from "node:assert/strict"
import test from "node:test"

import {
  DISCORD_PERMISSIONS,
  evaluateBotChannelPermissions,
  evaluateGuildMemberPermissions,
  evaluatePrincipalPermissions,
  hasGuildPermission,
} from "../src/permissions.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const ROLE_ID = "300000000000000001"
const CHANNEL_ID = "400000000000000001"
const THREAD_ID = "500000000000000001"
const OWNER_ID = "600000000000000001"
const TARGET_ID = "700000000000000001"
const TARGET_ROLE_ID = "800000000000000001"

function role(id: string, permissions: bigint, name = "role"): DiscordRole {
  return {
    id,
    managed: false,
    name,
    permissions: permissions.toString(),
    position: 0,
  }
}

function member(roles: string[] = []): DiscordGuildMember {
  return { roles }
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    permission_overwrites: [],
    type: 0,
    ...overrides,
  }
}

test("permission evaluator follows Discord overwrite precedence with an explainable trace", () => {
  const result = evaluateBotChannelPermissions({
    botId: BOT_ID,
    channel: channel(),
    guildId: GUILD_ID,
    member: member([ROLE_ID]),
    permissionChannel: channel({
      permission_overwrites: [
        {
          allow: "0",
          deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
          id: GUILD_ID,
          type: 0,
        },
        {
          allow: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
          deny: "0",
          id: ROLE_ID,
          type: 0,
        },
        {
          allow: "0",
          deny: DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY.toString(),
          id: BOT_ID,
          type: 1,
        },
      ],
    }),
    roles: [
      role(
        GUILD_ID,
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
        "@everyone",
      ),
      role(ROLE_ID, DISCORD_PERMISSIONS.SEND_MESSAGES),
    ],
  })

  assert.equal(result.confidence, "complete")
  assert.equal(result.canReadMessages, false)
  assert.equal(result.effectivePermissionNames.includes("VIEW_CHANNEL"), true)
  assert.equal(result.effectivePermissionNames.includes("READ_MESSAGE_HISTORY"), false)
  assert.deepEqual(result.missingReadPermissions, ["READ_MESSAGE_HISTORY"])
  assert.deepEqual(
    result.decisionTrace.map((entry) => entry.stage),
    [
      "guild-everyone",
      "guild-roles",
      "channel-everyone",
      "channel-roles",
      "channel-member",
    ],
  )
})

test("permission evaluator treats ADMINISTRATOR as an overwrite bypass and preserves unknown bits", () => {
  const unknown = 1n << 47n
  const result = evaluateBotChannelPermissions({
    botId: BOT_ID,
    channel: channel(),
    guildId: GUILD_ID,
    member: member(),
    permissionChannel: channel({
      permission_overwrites: [{
        allow: "0",
        deny: (
          DISCORD_PERMISSIONS.VIEW_CHANNEL
          | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
        ).toString(),
        id: BOT_ID,
        type: 1,
      }],
    }),
    roles: [role(
      GUILD_ID,
      DISCORD_PERMISSIONS.ADMINISTRATOR | unknown,
      "@everyone",
    )],
  })

  assert.equal(result.administrator, true)
  assert.equal(result.canReadMessages, true)
  assert.equal(result.unknownPermissionBits, unknown.toString())
  assert.equal((BigInt(result.effectivePermissions) & unknown) === unknown, true)
  assert.equal(result.decisionTrace.at(-1)?.stage, "administrator")
})

test("permission evaluator marks incomplete Discord evidence as partial", () => {
  const incompleteChannel = channel()
  delete incompleteChannel.permission_overwrites
  const result = evaluateBotChannelPermissions({
    botId: BOT_ID,
    channel: channel(),
    guildId: GUILD_ID,
    member: member([ROLE_ID]),
    permissionChannel: incompleteChannel,
    roles: [],
  })

  assert.equal(result.confidence, "partial")
  assert.equal(result.canReadMessages, null)
  assert.match(result.warnings.join("\n"), /omitted the guild @everyone role/)
  assert.match(result.warnings.join("\n"), /missing role/)
  assert.match(result.warnings.join("\n"), /omitted permission_overwrites/)
})

test("permission evaluator rejects malformed permission bitfields", () => {
  assert.throws(
    () => evaluateBotChannelPermissions({
      botId: BOT_ID,
      channel: channel(),
      guildId: GUILD_ID,
      member: member(),
      permissionChannel: channel(),
      roles: [{
        ...role(GUILD_ID, 0n, "@everyone"),
        permissions: "not-a-bitfield",
      }],
    }),
    /invalid @everyone role permission bitfield/,
  )
})

test("permission evaluator reports unknown overwrite types without hiding their bits", () => {
  const unknown = 1n << 47n
  const result = evaluateBotChannelPermissions({
    botId: BOT_ID,
    channel: channel(),
    guildId: GUILD_ID,
    member: member(),
    permissionChannel: channel({
      permission_overwrites: [{
        allow: unknown.toString(),
        deny: "0",
        id: ROLE_ID,
        type: 2,
      }],
    }),
    roles: [role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "@everyone")],
  })

  assert.equal(result.confidence, "partial")
  assert.equal(result.canReadMessages, null)
  assert.equal(result.unknownPermissionBits, unknown.toString())
  assert.match(result.warnings.join("\n"), /unknown overwrite type 2/)
})

test("permission evaluator uses a thread parent as its permission source", () => {
  const parent = channel()
  const thread = channel({
    id: THREAD_ID,
    parent_id: CHANNEL_ID,
    type: 12,
  })
  const result = evaluateBotChannelPermissions({
    botId: BOT_ID,
    channel: thread,
    guildId: GUILD_ID,
    member: member(),
    permissionChannel: parent,
    roles: [role(
      GUILD_ID,
      DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
      "@everyone",
    )],
  })

  assert.equal(result.permissionSourceChannelId, CHANNEL_ID)
  assert.equal(result.privateThreadAccess, "lookup-succeeded")
  assert.equal(result.canReadMessages, true)
})

test("permission evaluator requires CONNECT to read voice-channel messages", () => {
  const result = evaluateBotChannelPermissions({
    botId: BOT_ID,
    channel: channel({ type: 2 }),
    guildId: GUILD_ID,
    member: member(),
    permissionChannel: channel({ type: 2 }),
    roles: [role(
      GUILD_ID,
      DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
      "@everyone",
    )],
  })

  assert.equal(result.canReadMessages, false)
  assert.deepEqual(result.missingReadPermissions, ["CONNECT"])
})

test("guild permission evaluator unions arbitrary-width roles and exposes strict hierarchy evidence", () => {
  const futurePermission = 1n << 70n
  const result = evaluateGuildMemberPermissions({
    guildId: GUILD_ID,
    member: member([ROLE_ID]),
    roles: [
      role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "@everyone"),
      {
        ...role(
          ROLE_ID,
          DISCORD_PERMISSIONS.KICK_MEMBERS | futurePermission,
        ),
        position: 7,
      },
    ],
  })

  assert.equal(result.complete, true)
  assert.equal(result.highestRolePosition, 7)
  assert.deepEqual(result.highestRoleIds, [ROLE_ID])
  assert.equal(hasGuildPermission(result, "KICK_MEMBERS"), true)
  assert.equal(hasGuildPermission(result, "BAN_MEMBERS"), false)
  assert.equal(
    BigInt(result.effectivePermissions) & futurePermission,
    futurePermission,
  )
})

test("guild permission evaluator fails completeness for missing and duplicate role evidence", () => {
  const missing = evaluateGuildMemberPermissions({
    guildId: GUILD_ID,
    member: member([ROLE_ID, ROLE_ID, "invalid-role-id"]),
    roles: [role(GUILD_ID, 0n, "@everyone")],
  })
  const duplicate = evaluateGuildMemberPermissions({
    guildId: GUILD_ID,
    member: member(),
    roles: [
      role(GUILD_ID, 0n, "@everyone"),
      role(GUILD_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, "duplicate"),
    ],
  })

  assert.equal(missing.complete, false)
  assert.match(missing.warnings.join("\n"), /duplicate role/)
  assert.match(missing.warnings.join("\n"), /invalid role ID/)
  assert.match(missing.warnings.join("\n"), /missing role/)
  assert.equal(duplicate.complete, false)
})

test("guild permission evaluator treats administrator as satisfying action permissions", () => {
  const result = evaluateGuildMemberPermissions({
    guildId: GUILD_ID,
    member: member(),
    roles: [role(GUILD_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, "@everyone")],
  })

  assert.equal(result.administrator, true)
  assert.equal(hasGuildPermission(result, "MODERATE_MEMBERS"), true)
})

test("principal evaluator reports missing and implicitly ineffective channel permissions", () => {
  const result = evaluatePrincipalPermissions({
    action: "attach-file",
    channel: channel(),
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    permissionChannel: channel(),
    roles: [role(
      GUILD_ID,
      DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.ATTACH_FILES,
      "@everyone",
    )],
    subject: {
      id: BOT_ID,
      kind: "member",
      member: { roles: [], user: { id: BOT_ID, username: "subject" } },
    },
  })

  assert.equal(result.allowed, false)
  assert.equal(result.confidence, "complete")
  assert.deepEqual(result.missingPermissions, ["SEND_MESSAGES"])
  assert.deepEqual(result.ineffectivePermissions, ["ATTACH_FILES"])
  assert.deepEqual(result.implicitDenies, [{
    missingPrerequisites: ["SEND_MESSAGES"],
    permission: "ATTACH_FILES",
    reason: "One or more prerequisite permissions are missing",
  }])
})

test("principal evaluator applies timeout restrictions after channel overwrites", () => {
  const result = evaluatePrincipalPermissions({
    action: "send-message",
    channel: channel(),
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    now: new Date("2026-08-20T00:00:00.000Z"),
    permissionChannel: channel(),
    roles: [role(
      GUILD_ID,
      DISCORD_PERMISSIONS.VIEW_CHANNEL
        | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
        | DISCORD_PERMISSIONS.SEND_MESSAGES,
      "@everyone",
    )],
    subject: {
      id: BOT_ID,
      kind: "member",
      member: {
        communication_disabled_until: "2026-08-21T00:00:00.000Z",
        roles: [],
        user: { id: BOT_ID, username: "subject" },
      },
    },
  })

  assert.equal(result.subjectTimedOut, true)
  assert.equal(result.allowed, false)
  assert.deepEqual(result.missingPermissions, ["SEND_MESSAGES"])
  assert.equal(result.decisionTrace.at(-1)?.stage, "member-timeout")
})

test("principal evaluator distinguishes exact private-thread membership from role baselines", () => {
  const privateThread = channel({
    id: THREAD_ID,
    parent_id: CHANNEL_ID,
    type: 12,
  })
  const parent = channel()
  const roles = [role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, "@everyone")]
  const nonMember = evaluatePrincipalPermissions({
    action: "view-channel",
    channel: privateThread,
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    permissionChannel: parent,
    privateThreadMembership: "not-member",
    roles,
    subject: {
      id: BOT_ID,
      kind: "member",
      member: { roles: [], user: { id: BOT_ID, username: "subject" } },
    },
  })
  const roleBaseline = evaluatePrincipalPermissions({
    action: "view-channel",
    channel: privateThread,
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    permissionChannel: parent,
    privateThreadMembership: "unknown",
    roles,
    subject: { id: GUILD_ID, kind: "role" },
  })

  assert.equal(nonMember.privateThreadAccess, "not-member")
  assert.equal(nonMember.allowed, false)
  assert.equal(nonMember.confidence, "complete")
  assert.equal(roleBaseline.privateThreadAccess, "unknown")
  assert.equal(roleBaseline.allowed, null)
  assert.equal(roleBaseline.confidence, "partial")
})

test("principal evaluator gives owners a known-permission bypass", () => {
  const result = evaluatePrincipalPermissions({
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    requestedPermissions: ["BAN_MEMBERS"],
    roles: [role(GUILD_ID, 0n, "@everyone")],
    subject: {
      id: OWNER_ID,
      kind: "member",
      member: { roles: [], user: { id: OWNER_ID, username: "owner" } },
    },
  })

  assert.equal(result.guildOwner, true)
  assert.equal(result.allowed, true)
  assert.equal(result.effectivePermissionNames.includes("BAN_MEMBERS"), true)
  assert.equal(result.decisionTrace.at(-1)?.stage, "guild-owner")
})

test("principal evaluator combines permissions with strict member hierarchy", () => {
  const roles = [
    role(GUILD_ID, 0n, "@everyone"),
    { ...role(ROLE_ID, DISCORD_PERMISSIONS.KICK_MEMBERS), position: 10 },
    { ...role(TARGET_ROLE_ID, 0n), position: 5 },
  ]
  const result = evaluatePrincipalPermissions({
    action: "kick-member",
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    roles,
    subject: {
      id: BOT_ID,
      kind: "member",
      member: { roles: [ROLE_ID], user: { id: BOT_ID, username: "actor" } },
    },
    target: {
      id: TARGET_ID,
      kind: "member",
      member: {
        roles: [TARGET_ROLE_ID],
        user: { id: TARGET_ID, username: "target" },
      },
    },
  })

  assert.equal(result.allowed, true)
  assert.equal(result.hierarchy.status, "allowed")
  assert.equal(result.hierarchy.actorHighestRolePosition, 10)
  assert.equal(result.hierarchy.targetHighestRolePosition, 5)
})

test("principal evaluator keeps hierarchy actions at guild scope", () => {
  assert.throws(
    () => evaluatePrincipalPermissions({
      action: "kick-member",
      channel: channel(),
      guildId: GUILD_ID,
      guildOwnerId: OWNER_ID,
      permissionChannel: channel(),
      roles: [role(GUILD_ID, DISCORD_PERMISSIONS.KICK_MEMBERS, "@everyone")],
      subject: {
        id: BOT_ID,
        kind: "member",
        member: { roles: [], user: { id: BOT_ID, username: "actor" } },
      },
      target: {
        id: TARGET_ID,
        kind: "member",
        member: { roles: [], user: { id: TARGET_ID, username: "target" } },
      },
    }),
    /does not accept a channel/,
  )
})

test("principal evaluator rejects protected hierarchy targets from evidence", () => {
  const roles = [
    role(GUILD_ID, 0n, "@everyone"),
    { ...role(ROLE_ID, DISCORD_PERMISSIONS.MANAGE_ROLES), position: 10 },
    { ...role(TARGET_ROLE_ID, 0n), managed: true, position: 5 },
  ]
  const result = evaluatePrincipalPermissions({
    action: "assign-role",
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    roles,
    subject: {
      id: BOT_ID,
      kind: "member",
      member: { roles: [ROLE_ID], user: { id: BOT_ID, username: "actor" } },
    },
    target: { id: TARGET_ROLE_ID, kind: "role" },
  })

  assert.equal(result.allowed, false)
  assert.equal(result.hierarchy.status, "denied")
  assert.match(result.hierarchy.reason, /Discord-managed roles/)
})

test("principal evaluator rejects ambiguous overwrite evidence", () => {
  const permissionChannel = channel({
    permission_overwrites: [
      {
        allow: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
        deny: "0",
        id: ROLE_ID,
        type: 0,
      },
      {
        allow: "0",
        deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
        id: ROLE_ID,
        type: 0,
      },
    ],
  })

  assert.throws(
    () => evaluatePrincipalPermissions({
      action: "view-channel",
      channel: channel(),
      guildId: GUILD_ID,
      guildOwnerId: OWNER_ID,
      permissionChannel,
      roles: [role(GUILD_ID, 0n, "@everyone"), role(ROLE_ID, 0n)],
      subject: { id: ROLE_ID, kind: "role" },
    }),
    /duplicate permission overwrite/,
  )
})

test("principal evaluator validates overwrite evidence before administrator bypass", () => {
  const permissionChannel = channel({
    permission_overwrites: [null as unknown as DiscordPermissionOverwrite],
  })

  assert.throws(
    () => evaluatePrincipalPermissions({
      action: "view-channel",
      channel: channel(),
      guildId: GUILD_ID,
      guildOwnerId: OWNER_ID,
      permissionChannel,
      roles: [role(
        GUILD_ID,
        DISCORD_PERMISSIONS.ADMINISTRATOR,
        "@everyone",
      )],
      subject: {
        id: BOT_ID,
        kind: "member",
        member: { roles: [], user: { id: BOT_ID, username: "subject" } },
      },
    }),
    /invalid permission overwrite object/,
  )
})

test("principal evaluator returns unknown when member role evidence is stale", () => {
  const result = evaluatePrincipalPermissions({
    guildId: GUILD_ID,
    guildOwnerId: OWNER_ID,
    requestedPermissions: ["BAN_MEMBERS"],
    roles: [role(GUILD_ID, 0n, "@everyone")],
    subject: {
      id: BOT_ID,
      kind: "member",
      member: { roles: [ROLE_ID], user: { id: BOT_ID, username: "subject" } },
    },
  })

  assert.equal(result.confidence, "partial")
  assert.equal(result.allowed, null)
  assert.match(result.warnings.join("\n"), /missing role/)
})
