import assert from "node:assert/strict"
import test from "node:test"

import {
  GuildAuditLogService,
  type GuildAuditLogClient,
} from "../src/audit-log-service.js"
import { AUDIT_LOG_LIMITS } from "../src/constants.js"
import type { GuildAuditLogPageOptions } from "../src/discord-client.js"
import { DiscordAuditEvidenceError } from "../src/errors.js"
import type {
  DiscordGuildAuditLog,
  DiscordGuildAuditLogEntry,
} from "../src/types.js"

const GUILD_ID = "100000000000000001"
const ACTOR_ID = "200000000000000001"
const TARGET_ID = "300000000000000001"
const ENTRY_IDS = [
  "400000000000000001",
  "400000000000000002",
  "400000000000000003",
] as const
const SECRET_REASON = "sensitive moderator explanation"
const SECRET_VALUE = "sensitive change value"
const SECRET_EMBEDDED_NAME = "sensitive executor name"

function entry(
  id: string,
  overrides: Partial<DiscordGuildAuditLogEntry> = {},
): DiscordGuildAuditLogEntry {
  return {
    action_type: 11,
    id,
    target_id: TARGET_ID,
    user_id: ACTOR_ID,
    ...overrides,
  }
}

function response(
  entries: DiscordGuildAuditLogEntry[],
  overrides: Partial<DiscordGuildAuditLog> = {},
): DiscordGuildAuditLog {
  return {
    audit_log_entries: entries,
    ...overrides,
  }
}

function fixture(value: unknown) {
  const calls: Array<{ guildId: string; options: GuildAuditLogPageOptions }> = []
  const client: GuildAuditLogClient = {
    async getGuildAuditLog(guildId, options = {}) {
      calls.push({ guildId, options })
      return value as DiscordGuildAuditLog
    },
  }
  return {
    calls,
    service: new GuildAuditLogService({ client }),
  }
}

test("guild audit-log list returns bounded structural summaries with exact lookahead", async () => {
  const { calls, service } = fixture(response([
    entry(ENTRY_IDS[2], {
      changes: [
        { key: "name", new_value: SECRET_VALUE, old_value: SECRET_VALUE },
        { key: "name", new_value: SECRET_VALUE },
        { key: "unsafe key", new_value: SECRET_VALUE },
      ],
      options: {
        channel_id: SECRET_VALUE,
        "unsafe option": SECRET_VALUE,
      },
      reason: SECRET_REASON,
      target_id: "private-invite-code",
    }),
    entry(ENTRY_IDS[1]),
    entry(ENTRY_IDS[0]),
  ], {
    users: [{ id: ACTOR_ID, username: SECRET_EMBEDDED_NAME }],
  }))

  const result = await service.list(GUILD_ID, { limit: 2 })

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.guildId, GUILD_ID)
  assert.deepEqual(calls[0]?.options, { limit: 3 })
  assert.equal(result.entries.length, 2)
  assert.deepEqual(result.page, {
    beforeEntryId: null,
    hasMore: true,
    nextBeforeEntryId: ENTRY_IDS[1],
    requestedLimit: 2,
    returned: 2,
  })
  assert.deepEqual(result.entries[0], {
    actionName: "CHANNEL_UPDATE",
    actionType: 11,
    actorUserId: ACTOR_ID,
    changeCount: 3,
    changeKeys: ["name"],
    createdAt: new Date(
      Number((BigInt(ENTRY_IDS[2]) >> 22n) + 1_420_070_400_000n),
    ).toISOString(),
    hasReason: true,
    id: ENTRY_IDS[2],
    optionKeys: ["channel_id"],
    redactedChangeKeyCount: 2,
    redactedOptionKeyCount: 1,
    targetId: null,
    targetIdentifierRedacted: true,
  })
  assert.deepEqual(result.privacy, {
    changeValues: "omitted",
    embeddedObjects: "omitted",
    nonSnowflakeTargets: "redacted",
    optionValues: "omitted",
    persistence: "none",
    reasons: "omitted",
  })
  const serialized = JSON.stringify(result)
  for (const secret of [
    SECRET_REASON,
    SECRET_VALUE,
    SECRET_EMBEDDED_NAME,
    "private-invite-code",
    "unsafe key",
    "unsafe option",
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
})

test("guild audit-log list forwards exact filters and includes reasons only by opt-in", async () => {
  const { calls, service } = fixture(response([
    entry(ENTRY_IDS[1], { action_type: 22, reason: SECRET_REASON }),
  ]))

  const result = await service.list(GUILD_ID, {
    actionType: 22,
    actorUserId: ACTOR_ID,
    beforeEntryId: ENTRY_IDS[2],
    includeReasons: true,
    limit: 5,
  })

  assert.deepEqual(calls[0]?.options, {
    actionType: 22,
    actorUserId: ACTOR_ID,
    before: ENTRY_IDS[2],
    limit: 6,
  })
  assert.equal(result.entries[0]?.reason, SECRET_REASON)
  assert.equal(result.privacy.reasons, "included")
  assert.equal(result.page.hasMore, false)
  assert.equal(result.page.nextBeforeEntryId, null)
})

test("guild audit-log exact lookup uses the predecessor cursor and never returns a neighbor", async () => {
  const foundFixture = fixture(response([
    entry(ENTRY_IDS[1], { action_type: 999, reason: SECRET_REASON }),
  ]))

  const found = await foundFixture.service.get(GUILD_ID, ENTRY_IDS[1], {
    includeReason: true,
  })

  assert.deepEqual(foundFixture.calls[0]?.options, {
    after: (BigInt(ENTRY_IDS[1]) - 1n).toString(),
    limit: 1,
  })
  assert.equal(found.found, true)
  assert.equal(found.status, "ok")
  if (!found.found) throw new Error("Expected exact guild audit entry")
  assert.equal(found.entry.actionName, null)
  assert.equal(found.entry.reason, SECRET_REASON)

  const missingFixture = fixture(response([entry(ENTRY_IDS[2])]))
  const missing = await missingFixture.service.get(GUILD_ID, ENTRY_IDS[1])

  assert.deepEqual(missing, {
    entryId: ENTRY_IDS[1],
    found: false,
    guildId: GUILD_ID,
    privacy: {
      changeValues: "omitted",
      embeddedObjects: "omitted",
      nonSnowflakeTargets: "redacted",
      optionValues: "omitted",
      persistence: "none",
      reasons: "omitted",
    },
    schemaVersion: 1,
    status: "not-found",
  })
})

test("guild audit-log service validates input independently from MCP", async () => {
  const { service } = fixture(response([]))

  await assert.rejects(() => service.list("not-a-snowflake"), /guild ID/)
  await assert.rejects(() => service.list("18446744073709551616"), /guild ID/)
  await assert.rejects(() => service.list(GUILD_ID, { limit: 0 }), /between 1 and 50/)
  await assert.rejects(
    () => service.list(GUILD_ID, { actionType: Number.MAX_SAFE_INTEGER + 1 }),
    /action type/,
  )
  await assert.rejects(
    () => service.list(GUILD_ID, { actorUserId: "invalid" }),
    /actor user ID/,
  )
  await assert.rejects(() => service.get(GUILD_ID, "0"), /entry ID/)
})

test("guild audit-log service rejects malformed, excessive, and contradictory evidence", async (context) => {
  const cases: Array<{ name: string; value: unknown; invoke?: (service: GuildAuditLogService) => Promise<unknown> }> = [
    { name: "non-object response", value: [] },
    { name: "missing entry collection", value: {} },
    {
      name: "response beyond requested fetch size",
      value: response(Array.from({ length: 3 }, (_, index) => entry(String(30 - index)))),
      invoke: (service) => service.list(GUILD_ID, { limit: 1 }),
    },
    {
      name: "duplicate entry identifiers",
      value: response([entry(ENTRY_IDS[1]), entry(ENTRY_IDS[1])]),
    },
    {
      name: "ascending before page",
      value: response([entry(ENTRY_IDS[0]), entry(ENTRY_IDS[1])]),
    },
    {
      name: "entry outside before cursor",
      value: response([entry(ENTRY_IDS[2])]),
      invoke: (service) => service.list(GUILD_ID, { beforeEntryId: ENTRY_IDS[2] }),
    },
    {
      name: "mismatched actor filter",
      value: response([entry(ENTRY_IDS[1], { user_id: TARGET_ID })]),
      invoke: (service) => service.list(GUILD_ID, { actorUserId: ACTOR_ID }),
    },
    {
      name: "mismatched action filter",
      value: response([entry(ENTRY_IDS[1], { action_type: 12 })]),
      invoke: (service) => service.list(GUILD_ID, { actionType: 11 }),
    },
    { name: "non-object entry", value: response([null as never]) },
    { name: "invalid entry identifier", value: response([entry("invalid")]) },
    { name: "entry identifier beyond uint64", value: response([entry("18446744073709551616")]) },
    { name: "zero action type", value: response([entry(ENTRY_IDS[1], { action_type: 0 })]) },
    { name: "invalid actor identifier", value: response([entry(ENTRY_IDS[1], { user_id: "invalid" })]) },
    { name: "non-string target", value: response([entry(ENTRY_IDS[1], { target_id: 5 as never })]) },
    { name: "non-string reason", value: response([entry(ENTRY_IDS[1], { reason: 5 as never })]) },
    { name: "empty reason", value: response([entry(ENTRY_IDS[1], { reason: "" })]) },
    {
      name: "oversized reason",
      value: response([entry(ENTRY_IDS[1], { reason: "x".repeat(AUDIT_LOG_LIMITS.reasonCharacters + 1) })]),
    },
    { name: "invalid Unicode reason", value: response([entry(ENTRY_IDS[1], { reason: "\ud800" })]) },
    { name: "non-array changes", value: response([entry(ENTRY_IDS[1], { changes: {} as never })]) },
    {
      name: "excessive changes",
      value: response([entry(ENTRY_IDS[1], {
        changes: Array.from(
          { length: AUDIT_LOG_LIMITS.changes + 1 },
          () => ({ key: "name" }),
        ),
      })]),
    },
    { name: "non-object change", value: response([entry(ENTRY_IDS[1], { changes: [null as never] })]) },
    { name: "non-string change key", value: response([entry(ENTRY_IDS[1], { changes: [{ key: 5 as never }] })]) },
    { name: "array options", value: response([entry(ENTRY_IDS[1], { options: [] as never })]) },
    {
      name: "excessive options",
      value: response([entry(ENTRY_IDS[1], {
        options: Object.fromEntries(Array.from(
          { length: AUDIT_LOG_LIMITS.options + 1 },
          (_, index) => [`key_${index}`, index],
        )),
      })]),
    },
  ]

  for (const item of cases) {
    await context.test(item.name, async () => {
      const { service } = fixture(item.value)
      await assert.rejects(
        () => item.invoke?.(service) ?? service.list(GUILD_ID),
        DiscordAuditEvidenceError,
      )
    })
  }
})
