import assert from "node:assert/strict"
import test from "node:test"

import { loadFixtureConfig as loadConnectorConfig } from "./config-fixture.js"
import { DiscordApiError } from "../src/errors.js"
import { PermissionService } from "../src/permission-service.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const TOKEN = "test-discord-token"
const GUILD_ID = "100000000000000001"
const OWNER_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const USER_ID = "400000000000000001"
const TARGET_ID = "400000000000000002"
const CHANNEL_ID = "500000000000000001"
const THREAD_ID = "500000000000000002"
const ROLE_ID = "600000000000000001"
const TARGET_ROLE_ID = "600000000000000002"

function role(
  id: string,
  permissions: bigint,
  position: number,
  name = "role",
  overrides: Partial<DiscordRole> = {},
): DiscordRole {
  return {
    color: 0,
    colors: {
      primary_color: 0,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: false,
    icon: null,
    id,
    managed: false,
    mentionable: false,
    name,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
    ...overrides,
  }
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    name: "general",
    permission_overwrites: [],
    position: 1,
    type: 0,
    ...overrides,
  }
}

function member(userId: string, roles: string[] = []): DiscordGuildMember {
  return {
    roles,
    user: { id: userId, username: `user-${userId}` },
  }
}

function policy(channelIds: readonly string[] = [CHANNEL_ID]): ScopePolicy {
  return new ScopePolicy(loadConnectorConfig({
    readScope: {
      channelIds,
      guildIds: [GUILD_ID],
    },
    token: TOKEN,
  }, { homeDirectory: "/test/home" }))
}

function fixture(overrides: Record<string, unknown> = {}) {
  const roles = [
    role(
      GUILD_ID,
      DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY,
      0,
      "@everyone",
    ),
    role(ROLE_ID, DISCORD_PERMISSIONS.SEND_MESSAGES, 10, "operator"),
    role(TARGET_ROLE_ID, 0n, 5, "target"),
  ]
  const client = {
    async getChannel(channelId: string) {
      return channelId === CHANNEL_ID ? channel() : channel({
        id: THREAD_ID,
        parent_id: CHANNEL_ID,
        type: 12,
      })
    },
    async getGuild() {
      return { id: GUILD_ID, name: "Guild", owner_id: OWNER_ID }
    },
    async getGuildMember(_guildId: string, userId: string) {
      if (userId === BOT_ID || userId === USER_ID) return member(userId, [ROLE_ID])
      return member(userId, [TARGET_ROLE_ID])
    },
    async getGuildRoles() {
      return roles
    },
    async getThreadMember(threadId: string, userId: string) {
      return {
        flags: 0,
        id: threadId,
        join_timestamp: "2026-08-20T00:00:00.000Z",
        user_id: userId,
      }
    },
    ...overrides,
  }
  return {
    client,
    roles,
    service: new PermissionService({
      client,
      clock: () => new Date("2026-08-20T00:00:00.000Z"),
      policy: policy(),
    }),
  }
}

test("permission service explains one exact scoped member without returning profile data", async () => {
  const { service } = fixture()

  const result = await service.explain(BOT_ID, {
    action: "send-message",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    subjectId: USER_ID,
    subjectKind: "member",
  })

  assert.equal(result.permissions.allowed, true)
  assert.equal(result.permissions.subjectId, USER_ID)
  assert.equal(result.permissions.subjectKind, "member")
  assert.deepEqual(result.permissions.requestedPermissions, [
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
  ])
  assert.equal(result.channel?.id, CHANNEL_ID)
  assert.equal("username" in result.permissions, false)
})

test("permission service explains an exact role without fetching member or guild profiles", async () => {
  const { service } = fixture({
    async getGuild() {
      throw new Error("Role explanations must not fetch guild metadata")
    },
    async getGuildMember() {
      throw new Error("Role explanations must not fetch member profiles")
    },
  })

  const result = await service.explain(BOT_ID, {
    action: "view-channel",
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    subjectId: ROLE_ID,
    subjectKind: "role",
  })

  assert.equal(result.permissions.subjectKind, "role")
  assert.equal(result.permissions.allowed, true)
})

test("permission service verifies exact private-thread membership and handles a 404", async () => {
  const joined = fixture()
  const joinedResult = await joined.service.explain(BOT_ID, {
    action: "read-messages",
    channelId: THREAD_ID,
    guildId: GUILD_ID,
    subjectId: USER_ID,
    subjectKind: "member",
  })
  const absent = fixture({
    async getThreadMember() {
      throw new DiscordApiError({
        message: "not found",
        method: "GET",
        route: `/channels/${THREAD_ID}/thread-members/${USER_ID}`,
        status: 404,
      })
    },
  })
  const absentResult = await absent.service.explain(BOT_ID, {
    action: "read-messages",
    channelId: THREAD_ID,
    guildId: GUILD_ID,
    subjectId: USER_ID,
    subjectKind: "member",
  })

  assert.equal(joinedResult.permissions.privateThreadAccess, "member")
  assert.equal(joinedResult.permissions.allowed, true)
  assert.equal(absentResult.permissions.privateThreadAccess, "not-member")
  assert.equal(absentResult.permissions.allowed, false)
})

test("permission service validates Discord response identities", async () => {
  const { service } = fixture({
    async getGuildMember() {
      return member(TARGET_ID, [ROLE_ID])
    },
  })

  await assert.rejects(
    () => service.explain(BOT_ID, {
      guildId: GUILD_ID,
      requestedPermissions: ["BAN_MEMBERS"],
      subjectId: USER_ID,
      subjectKind: "member",
    }),
    /mismatched subject member evidence/,
  )
})

test("permission service combines exact target hierarchy with permission evidence", async () => {
  const { service } = fixture()

  const result = await service.explain(BOT_ID, {
    action: "kick-member",
    guildId: GUILD_ID,
    subjectKind: "connector",
    targetUserId: TARGET_ID,
  })

  assert.equal(result.permissions.allowed, false)
  assert.deepEqual(result.permissions.missingPermissions, ["KICK_MEMBERS"])
  assert.equal(result.permissions.hierarchy.status, "allowed")
  assert.deepEqual(result.target, { id: TARGET_ID, kind: "member" })
})

test("permission service audits a bounded deterministic role page with full counts", async () => {
  const { service } = fixture({
    async getChannel() {
      return channel({
        permission_overwrites: [
          {
            allow: "0",
            deny: DISCORD_PERMISSIONS.SEND_MESSAGES.toString(),
            id: TARGET_ROLE_ID,
            type: 0,
          },
          {
            allow: DISCORD_PERMISSIONS.SEND_MESSAGES.toString(),
            deny: "0",
            id: USER_ID,
            type: 1,
          },
        ],
      })
    },
    async getGuild() {
      throw new Error("Role audit must not fetch guild metadata")
    },
  })

  const first = await service.auditChannelRoles({
    actions: ["view-channel", "send-message"],
    channelId: CHANNEL_ID,
    limit: 2,
  })
  const second = await service.auditChannelRoles({
    actions: ["view-channel", "send-message"],
    afterRoleId: first.page.nextCursor as string,
    channelId: CHANNEL_ID,
    limit: 2,
  })

  assert.deepEqual(first.roles.map(({ id }) => id), [ROLE_ID, TARGET_ROLE_ID])
  assert.equal(first.page.hasMore, true)
  assert.equal(first.memberOverwriteCount, 1)
  assert.equal(first.permissionSourceChannelId, CHANNEL_ID)
  assert.deepEqual(first.summary["view-channel"], {
    allowed: 3,
    denied: 0,
    unknown: 0,
  })
  assert.deepEqual(first.summary["send-message"], {
    allowed: 1,
    denied: 2,
    unknown: 0,
  })
  assert.deepEqual(second.roles.map(({ id }) => id), [GUILD_ID])
  assert.equal(second.page.hasMore, false)
  assert.equal(first.unknownPermissionBits, "0")
  assert.match(first.warnings.join("\n"), /member-specific channel overwrites/)
})

test("permission service makes private-thread role baselines unknown without moderation", async () => {
  const { service } = fixture()

  const result = await service.auditChannelRoles({
    actions: ["view-channel"],
    channelId: THREAD_ID,
  })

  assert.equal(result.confidence, "partial")
  assert.deepEqual(result.summary["view-channel"], {
    allowed: 0,
    denied: 0,
    unknown: 3,
  })
})

test("permission service rejects unsafe schemas, stale cursors, and scope escapes", async () => {
  const { service } = fixture()
  await assert.rejects(
    () => service.explain(BOT_ID, {
      guildId: GUILD_ID,
      requestedPermissions: ["VIEW_CHANNEL", "VIEW_CHANNEL"],
      subjectKind: "connector",
    }),
    /duplicated/,
  )
  await assert.rejects(
    () => service.explain(BOT_ID, {
      action: "kick-member",
      channelId: CHANNEL_ID,
      guildId: GUILD_ID,
      subjectKind: "connector",
      targetUserId: TARGET_ID,
    }),
    /does not accept channelId/,
  )
  await assert.rejects(
    () => service.auditChannelRoles({
      afterRoleId: "999999999999999999",
      channelId: CHANNEL_ID,
    }),
    /cursor is absent/,
  )
  const outside = fixture()
  const scopedService = new PermissionService({
    client: outside.client,
    policy: policy(["999999999999999999"]),
  })
  await assert.rejects(
    () => scopedService.auditChannelRoles({ channelId: CHANNEL_ID }),
    /outside the configured read scope/,
  )
})
