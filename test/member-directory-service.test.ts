import assert from "node:assert/strict"
import test from "node:test"

import {
  type MemberDirectoryClient,
  MemberDirectoryService,
} from "../src/member-directory-service.js"
import { PolicyError } from "../src/errors.js"
import type { DiscordGuildMember } from "../src/types.js"

const GUILD_ID = "100000000000000001"
const USER_ID = "200000000000000001"
const NEXT_USER_ID = "200000000000000002"
const ROLE_ID = "300000000000000001"
const SECRET_AVATAR = "private-avatar-hash"
const SECRET_BOOST = "2026-08-20T00:00:00.000Z"

function member(
  userId: string,
  overrides: Partial<DiscordGuildMember> = {},
): DiscordGuildMember {
  return {
    communication_disabled_until: "2026-08-22T00:00:00.000Z",
    joined_at: "2026-08-01T00:00:00.000Z",
    nick: "Guild nickname",
    pending: false,
    roles: [ROLE_ID],
    user: {
      avatar: SECRET_AVATAR,
      bot: false,
      global_name: "Global name",
      id: userId,
      username: "member_name",
    },
    ...overrides,
  }
}

function fixture(options: {
  exact?: unknown
  list?: unknown
  policyError?: Error
  search?: unknown
} = {}) {
  const calls: Array<{ kind: string; guildId: string; value: unknown }> = []
  const client: MemberDirectoryClient = {
    async getGuildMember(guildId, userId, request = {}) {
      calls.push({ guildId, kind: "get", value: { request, userId } })
      return (options.exact ?? member(userId)) as DiscordGuildMember
    },
    async listGuildMembers(guildId, request = {}) {
      calls.push({ guildId, kind: "list", value: request })
      return (options.list ?? []) as DiscordGuildMember[]
    },
    async searchGuildMembers(guildId, request) {
      calls.push({ guildId, kind: "search", value: request })
      return (options.search ?? []) as DiscordGuildMember[]
    },
  }
  const service = new MemberDirectoryService({
    client,
    policy: {
      assertMemberDirectoryAllowed(guildId) {
        calls.push({ guildId, kind: "policy", value: null })
        if (options.policyError) throw options.policyError
      },
    },
  })
  return { calls, service }
}

test("member directory exact lookup minimizes profile data and validates identity", async () => {
  const raw = member(USER_ID) as DiscordGuildMember & Record<string, unknown>
  raw.premium_since = SECRET_BOOST
  raw.presence = { status: "online" }
  const { calls, service } = fixture({ exact: raw })

  const result = await service.get(GUILD_ID, USER_ID)

  assert.deepEqual(calls.map(({ kind }) => kind), ["policy", "get"])
  assert.deepEqual(result, {
    guildId: GUILD_ID,
    member: {
      bot: false,
      globalName: "Global name",
      joinedAt: "2026-08-01T00:00:00.000Z",
      nickname: "Guild nickname",
      pending: false,
      roleIds: [ROLE_ID],
      timeoutUntil: "2026-08-22T00:00:00.000Z",
      userId: USER_ID,
      username: "member_name",
    },
    schemaVersion: 1,
    status: "ok",
  })
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(SECRET_AVATAR), false)
  assert.equal(serialized.includes(SECRET_BOOST), false)
  assert.equal(serialized.includes("presence"), false)

  await assert.rejects(
    () => fixture({ exact: member(NEXT_USER_ID) }).service.get(GUILD_ID, USER_ID),
    /malformed member-directory evidence/,
  )
})

test("member directory list returns strict ascending continuation evidence", async () => {
  const abort = new AbortController()
  const { calls, service } = fixture({
    list: [member(USER_ID), member(NEXT_USER_ID, { roles: [] })],
  })

  const result = await service.list(GUILD_ID, {
    afterUserId: "199999999999999999",
    limit: 2,
    signal: abort.signal,
  })

  assert.deepEqual(calls.map(({ kind }) => kind), ["policy", "list"])
  assert.deepEqual(calls[1]?.value, {
    after: "199999999999999999",
    limit: 2,
    signal: abort.signal,
  })
  assert.deepEqual(result.page, {
    afterUserId: "199999999999999999",
    exhausted: false,
    nextAfterUserId: NEXT_USER_ID,
    requestedLimit: 2,
    returned: 2,
  })
  assert.deepEqual(result.members.map(({ userId }) => userId), [USER_ID, NEXT_USER_ID])

  const short = await fixture({ list: [member(USER_ID)] }).service.list(GUILD_ID, {
    limit: 2,
  })
  assert.deepEqual(short.page, {
    afterUserId: null,
    exhausted: true,
    nextAfterUserId: null,
    requestedLimit: 2,
    returned: 1,
  })
})

test("member directory search uses a bounded trimmed prefix without reflecting it", async () => {
  const { calls, service } = fixture({
    search: [member(NEXT_USER_ID), member(USER_ID)],
  })

  const result = await service.search(GUILD_ID, {
    limit: 2,
    query: "  member  ",
  })

  assert.deepEqual(calls.map(({ kind }) => kind), ["policy", "search"])
  assert.deepEqual(calls[1]?.value, { limit: 2, query: "member" })
  assert.equal(result.match, "username-or-nickname-prefix")
  assert.equal(result.page.returned, 2)
  assert.equal(JSON.stringify(result).includes("member  "), false)
})

test("member directory applies scope before any member request", async () => {
  const { calls, service } = fixture({
    policyError: new PolicyError("blocked"),
  })

  await assert.rejects(() => service.get(GUILD_ID, USER_ID), /blocked/)
  await assert.rejects(() => service.list(GUILD_ID), /blocked/)
  await assert.rejects(
    () => service.search(GUILD_ID, { query: "me" }),
    /blocked/,
  )
  assert.deepEqual(calls.map(({ kind }) => kind), ["policy", "policy", "policy"])
})

test("member directory validates local limits, cursors, and queries", async () => {
  const { calls, service } = fixture()

  await assert.rejects(() => service.list(GUILD_ID, { limit: 0 }), /between 1 and 100/)
  await assert.rejects(
    () => service.list(GUILD_ID, { afterUserId: "invalid" }),
    /after cursor/,
  )
  await assert.rejects(
    () => service.search(GUILD_ID, { query: "x" }),
    /2-100/,
  )
  await assert.rejects(
    () => service.search(GUILD_ID, { query: "valid\nquery" }),
    /without controls/,
  )
  assert.deepEqual(calls.map(({ kind }) => kind), [
    "policy",
    "policy",
    "policy",
    "policy",
  ])
})

test("member directory rejects contradictory and malformed remote evidence", async (context) => {
  const missingUser = member(USER_ID)
  delete missingUser.user
  const missingJoinedAt = member(USER_ID)
  delete missingJoinedAt.joined_at
  const malformedCases: Array<{
    list: unknown
    name: string
    options?: { afterUserId?: string; limit?: number }
  }> = [
    { list: {}, name: "non-array response" },
    { list: [member(USER_ID), member(NEXT_USER_ID)], name: "oversized response", options: { limit: 1 } },
    { list: [member(USER_ID), member(USER_ID)], name: "duplicate users" },
    { list: [member(NEXT_USER_ID), member(USER_ID)], name: "out-of-order users" },
    { list: [member(USER_ID)], name: "user at cursor", options: { afterUserId: USER_ID } },
    { list: [missingUser], name: "missing user" },
    { list: [member(USER_ID, { roles: ["invalid"] })], name: "invalid role" },
    { list: [member(USER_ID, { roles: [ROLE_ID, ROLE_ID] })], name: "duplicate roles" },
    { list: [missingJoinedAt], name: "missing join timestamp" },
    { list: [member(USER_ID, { joined_at: "yesterday" })], name: "invalid join timestamp" },
    { list: [member(USER_ID, { pending: "yes" as unknown as boolean })], name: "invalid pending state" },
    { list: [member(USER_ID, { nick: "bad\nname" })], name: "control in nickname" },
    {
      list: [member(USER_ID, {
        roles: Array.from({ length: 251 }, (_, index) => String(400000000000000000n + BigInt(index))),
      })],
      name: "excessive roles",
    },
  ]

  for (const entry of malformedCases) {
    await context.test(entry.name, async () => {
      await assert.rejects(
        () => fixture({ list: entry.list }).service.list(GUILD_ID, entry.options),
        /malformed member-directory evidence/,
      )
    })
  }

  await assert.rejects(
    () => fixture({
      search: [member(USER_ID), member(USER_ID)],
    }).service.search(GUILD_ID, { query: "member" }),
    /malformed member-directory evidence/,
  )
})
