import assert from "node:assert/strict"
import test from "node:test"

import {
  BanAuditService,
  type BanAuditClient,
} from "../src/ban-audit-service.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { DiscordApiError } from "../src/errors.js"
import type {
  DiscordBan,
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const BOT_ID = "300000000000000001"
const OWNER_ID = "400000000000000001"
const BOT_ROLE_ID = "500000000000000001"
const FIRST_BANNED_USER_ID = 600_000_000_000_000_000n

function role(
  id: string,
  permissions: bigint,
  position: number,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === GUILD_ID ? "@everyone" : "moderator",
    permissions: permissions.toString(),
    position,
  }
}

function guild(overrides: Partial<DiscordGuild> = {}): DiscordGuild {
  return {
    id: GUILD_ID,
    name: "Guild",
    owner_id: OWNER_ID,
    ...overrides,
  }
}

function botMember(
  overrides: Partial<DiscordGuildMember> = {},
): DiscordGuildMember {
  return {
    roles: [BOT_ROLE_ID],
    user: { bot: true, id: BOT_ID, username: "connector" },
    ...overrides,
  }
}

function defaultRoles(): DiscordRole[] {
  return [
    role(GUILD_ID, 0n, 0),
    role(BOT_ROLE_ID, DISCORD_PERMISSIONS.BAN_MEMBERS, 10),
  ]
}

function ban(
  offset: number,
  overrides: Partial<DiscordBan> = {},
): DiscordBan {
  const id = (FIRST_BANNED_USER_ID + BigInt(offset)).toString()
  return {
    reason: `Private reason ${offset}`,
    user: {
      avatar: "private-avatar",
      bot: false,
      discriminator: "0001",
      global_name: `Global ${offset}`,
      id,
      username: `user-${offset}`,
    },
    ...overrides,
  }
}

function notFound(): DiscordApiError {
  return new DiscordApiError({
    message: "Discord API GET returned 404",
    method: "GET",
    route: `/guilds/${GUILD_ID}/bans/${FIRST_BANNED_USER_ID}`,
    status: 404,
  })
}

function fixture(options: {
  bans?: DiscordBan[]
  client?: Partial<BanAuditClient>
  exactBan?: DiscordBan
  policyError?: Error
  roles?: DiscordRole[]
} = {}) {
  const calls = {
    bans: 0,
    guild: 0,
    member: 0,
    policy: 0,
    roles: 0,
  }
  let listOptions: unknown
  const client: BanAuditClient = {
    async getGuild() {
      calls.guild += 1
      return guild()
    },
    async getGuildBan() {
      return options.exactBan ?? ban(1)
    },
    async getGuildMember() {
      calls.member += 1
      return botMember()
    },
    async getGuildRoles() {
      calls.roles += 1
      return options.roles ?? defaultRoles()
    },
    async listGuildBans(_guildId, requestOptions) {
      calls.bans += 1
      listOptions = requestOptions
      return options.bans ?? []
    },
    ...options.client,
  }
  const service = new BanAuditService({
    client,
    policy: {
      assertBanAuditAllowed(guildId) {
        calls.policy += 1
        assert.equal(guildId, GUILD_ID)
        if (options.policyError) throw options.policyError
      },
    },
  })
  return { calls, getListOptions: () => listOptions, service }
}

test("ban audit lists a redacted lookahead page with complete access evidence", async () => {
  const bans = Array.from({ length: 26 }, (_, index) => ban(index + 1))
  const { calls, getListOptions, service } = fixture({ bans })

  const result = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(result.applicationId, APPLICATION_ID)
  assert.equal(result.botId, BOT_ID)
  assert.deepEqual(result.access, {
    banMembers: true,
    botAdministrator: false,
    botIsGuildOwner: false,
    complete: true,
    requiredPermission: "BAN_MEMBERS",
  })
  assert.equal(result.bans.length, 25)
  assert.deepEqual(result.page, {
    afterUserId: null,
    hasMore: true,
    nextAfterUserId: (FIRST_BANNED_USER_ID + 25n).toString(),
    requestedLimit: 25,
    returned: 25,
  })
  assert.deepEqual(result.privacy, {
    caches: "none",
    persistence: "none",
    profiles: "minimized",
    rawPayloads: "omitted",
    reasons: "omitted",
  })
  assert.equal(result.bans[0]?.hasReason, true)
  assert.equal("reason" in (result.bans[0] || {}), false)
  assert.doesNotMatch(
    JSON.stringify(result),
    /Private reason|private-avatar|"discriminator"/,
  )
  assert.deepEqual(getListOptions(), { limit: 26 })
  assert.deepEqual(calls, {
    bans: 1,
    guild: 1,
    member: 1,
    policy: 1,
    roles: 1,
  })
})

test("ban audit includes reasons only by explicit list or exact opt-in", async () => {
  const afterUserId = FIRST_BANNED_USER_ID.toString()
  const exactUserId = (FIRST_BANNED_USER_ID + 1n).toString()
  const { getListOptions, service } = fixture({
    bans: [ban(1, { reason: null }), ban(2)],
    exactBan: ban(1),
  })

  const page = await service.list(APPLICATION_ID, BOT_ID, GUILD_ID, {
    afterUserId,
    includeReasons: true,
    limit: 2,
  })
  const exact = await service.get(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    exactUserId,
    { includeReason: true },
  )

  assert.deepEqual(getListOptions(), { after: afterUserId, limit: 3 })
  assert.equal(page.page.hasMore, false)
  assert.equal(page.page.nextAfterUserId, null)
  assert.equal(page.bans[0]?.hasReason, false)
  assert.equal(page.bans[0]?.reason, null)
  assert.equal(page.bans[1]?.reason, "Private reason 2")
  assert.equal(page.privacy.reasons, "included")
  assert.equal(exact.found, true)
  if (exact.found) {
    assert.equal(exact.ban.userId, exactUserId)
    assert.equal(exact.ban.reason, "Private reason 1")
    assert.equal(exact.privacy.reasons, "included")
  }
})

test("exact ban audit returns a private not-found result for Discord 404", async () => {
  const userId = (FIRST_BANNED_USER_ID + 1n).toString()
  const { service } = fixture({
    client: {
      async getGuildBan() {
        throw notFound()
      },
    },
  })

  const result = await service.get(
    APPLICATION_ID,
    BOT_ID,
    GUILD_ID,
    userId,
  )

  assert.equal(result.found, false)
  assert.equal(result.status, "not-found")
  assert.equal(result.userId, userId)
  assert.equal(result.privacy.reasons, "omitted")
  assert.equal("ban" in result, false)
})

test("ban audit applies local scope before every Discord request", async () => {
  const { calls, service } = fixture({ policyError: new Error("blocked") })

  await assert.rejects(
    () => service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
    /blocked/,
  )

  assert.deepEqual(calls, {
    bans: 0,
    guild: 0,
    member: 0,
    policy: 1,
    roles: 0,
  })
})

test("ban audit requires exact identity and complete BAN_MEMBERS evidence", async (context) => {
  const cases: Array<{
    client?: Partial<BanAuditClient>
    name: string
    pattern: RegExp
    roles?: DiscordRole[]
  }> = [
    {
      client: { async getGuild() { return guild({ id: OWNER_ID }) } },
      name: "mismatched guild",
      pattern: /guild evidence/,
    },
    {
      client: {
        async getGuildMember() {
          return botMember({ user: { id: OWNER_ID, username: "wrong" } })
        },
      },
      name: "mismatched bot",
      pattern: /bot evidence/,
    },
    {
      name: "missing everyone role",
      pattern: /incomplete/,
      roles: [role(BOT_ROLE_ID, DISCORD_PERMISSIONS.BAN_MEMBERS, 10)],
    },
    {
      name: "missing permission",
      pattern: /lacks guild-level BAN_MEMBERS/,
      roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)],
    },
  ]
  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const { calls, service } = fixture(entry)
      await assert.rejects(
        () => service.list(APPLICATION_ID, BOT_ID, GUILD_ID),
        entry.pattern,
      )
      assert.equal(calls.bans, 0)
    })
  }

  const owner = fixture({
    client: { async getGuild() { return guild({ owner_id: BOT_ID }) } },
    roles: [role(GUILD_ID, 0n, 0), role(BOT_ROLE_ID, 0n, 10)],
  })
  const result = await owner.service.list(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(result.access.botIsGuildOwner, true)
  assert.equal(result.access.banMembers, true)
})

test("ban audit rejects malformed local inputs before ban retrieval", async () => {
  const { calls, service } = fixture()

  await assert.rejects(
    () => service.list(APPLICATION_ID, BOT_ID, GUILD_ID, { afterUserId: "bad" }),
    /after user ID/,
  )
  await assert.rejects(
    () => service.list(APPLICATION_ID, BOT_ID, GUILD_ID, { limit: 101 }),
    /between 1 and 100/,
  )
  await assert.rejects(
    () => service.list(APPLICATION_ID, BOT_ID, GUILD_ID, {
      includeReasons: "yes" as unknown as boolean,
    }),
    /includeReasons must be a boolean/,
  )
  await assert.rejects(
    () => service.get(APPLICATION_ID, BOT_ID, GUILD_ID, "bad"),
    /user ID/,
  )
  assert.equal(calls.bans, 0)
  assert.equal(calls.guild, 0)
})

test("ban audit rejects malformed list and exact evidence", async (context) => {
  const afterUserId = FIRST_BANNED_USER_ID.toString()
  const duplicate = ban(1)
  const cases: Array<{ bans: unknown; name: string; pattern: RegExp }> = [
    { bans: {}, name: "non-array page", pattern: /oversized or malformed/ },
    {
      bans: Array.from({ length: 27 }, (_, index) => ban(index + 1)),
      name: "oversized page",
      pattern: /oversized or malformed/,
    },
    {
      bans: [duplicate, duplicate],
      name: "duplicate users",
      pattern: /duplicate, unordered, or cursor-violating/,
    },
    {
      bans: [ban(2), ban(1)],
      name: "unordered users",
      pattern: /duplicate, unordered, or cursor-violating/,
    },
    {
      bans: [ban(0)],
      name: "user at cursor",
      pattern: /duplicate, unordered, or cursor-violating/,
    },
    {
      bans: [{ reason: null, user: { id: "bad", username: "name" } }],
      name: "invalid user ID",
      pattern: /ban user/,
    },
    {
      bans: [ban(1, { user: { id: (FIRST_BANNED_USER_ID + 1n).toString(), username: "bad\nname" } })],
      name: "control in username",
      pattern: /user text/,
    },
    {
      bans: [ban(1, { reason: "x".repeat(513) })],
      name: "oversized redacted reason",
      pattern: /documented bound/,
    },
  ]
  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const { service } = fixture({ bans: entry.bans as DiscordBan[] })
      const after = entry.name === "user at cursor"
        ? { afterUserId }
        : {}
      await assert.rejects(
        () => service.list(APPLICATION_ID, BOT_ID, GUILD_ID, {
          ...after,
          limit: 25,
        }),
        entry.pattern,
      )
    })
  }

  const exactUserId = (FIRST_BANNED_USER_ID + 1n).toString()
  const mismatch = fixture({ exactBan: ban(2) })
  await assert.rejects(
    () => mismatch.service.get(
      APPLICATION_ID,
      BOT_ID,
      GUILD_ID,
      exactUserId,
    ),
    /different guild ban/,
  )
})
