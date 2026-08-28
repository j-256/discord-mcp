import assert from "node:assert/strict"
import test from "node:test"

import {
  BOT_INSTALLATION_AUDIT_LIMITS,
  BOT_INSTALLATION_AUDIT_PRIVACY,
  BOT_INSTALLATION_AUDIT_SCHEMA_VERSION,
  BotInstallationAuditService,
  type BotInstallationAuditClient,
} from "../src/bot-installation-audit-service.js"
import { BotInstallationAuditEvidenceError } from "../src/errors.js"

const APPLICATION_ID = "100000000000000001"
const BOT_ID = "200000000000000001"
const BASE_GUILD_ID = 300000000000000000n

function guildId(offset: number): string {
  return (BASE_GUILD_ID + BigInt(offset)).toString()
}

test("bot installation audit proves complete drift with ID-only pages", async () => {
  const signal = AbortSignal.timeout(5_000)
  const requests: Array<{ after?: string; limit?: number; signal?: AbortSignal }> = []
  const firstPage = Array.from(
    { length: BOT_INSTALLATION_AUDIT_LIMITS.pageSize },
    (_, index) => guildId(index + 1),
  )
  const secondPage = [guildId(202), guildId(201)]
  const client: BotInstallationAuditClient = {
    async listCurrentUserGuildMemberships(options = {}) {
      requests.push(options)
      return options.after === "0"
        ? { discardedFieldCount: 800, guildIds: firstPage }
        : { discardedFieldCount: 8, guildIds: secondPage }
    },
  }
  const configuredGuildIds = new Set([
    guildId(202),
    guildId(1),
    guildId(250),
  ])
  const service = new BotInstallationAuditService({
    client,
    configuredGuildIds,
  })

  const result = await service.audit(APPLICATION_ID, BOT_ID, { signal })

  assert.deepEqual(requests, [
    { after: "0", limit: 200, signal },
    { after: guildId(200), limit: 200, signal },
  ])
  assert.deepEqual(result.completeness, {
    complete: true,
    maximumGuilds: 400,
    pageSize: 200,
    pagesRead: 2,
  })
  assert.deepEqual(result.configuredGuildIds, [
    guildId(1),
    guildId(202),
    guildId(250),
  ])
  assert.equal(result.discardedGuildFieldCount, 808)
  assert.deepEqual(result.drift.missingConfiguredGuildIds, [guildId(250)])
  assert.equal(result.drift.detected, true)
  assert.equal(result.drift.unexpectedGuildIds.length, 200)
  assert.equal(result.installedGuildIds.length, 202)
  assert.deepEqual(result.installedInScopeGuildIds, [guildId(1), guildId(202)])
  assert.deepEqual(result.identity, {
    applicationId: APPLICATION_ID,
    botId: BOT_ID,
  })
  assert.deepEqual(result.privacy, BOT_INSTALLATION_AUDIT_PRIVACY)
  assert.equal(result.schemaVersion, BOT_INSTALLATION_AUDIT_SCHEMA_VERSION)
  assert.equal(result.status, "complete")
})

test("bot installation audit reports an exact configured match", async () => {
  const installedGuildIds = [guildId(2), guildId(1)]
  const service = new BotInstallationAuditService({
    client: {
      async listCurrentUserGuildMemberships() {
        return { discardedFieldCount: 4, guildIds: installedGuildIds }
      },
    },
    configuredGuildIds: new Set(installedGuildIds),
  })

  const result = await service.audit(APPLICATION_ID, BOT_ID)

  assert.deepEqual(result.installedGuildIds, [guildId(1), guildId(2)])
  assert.deepEqual(result.drift, {
    detected: false,
    missingConfiguredGuildIds: [],
    unexpectedGuildIds: [],
  })
})

test("bot installation audit rejects malformed configured guild IDs", () => {
  assert.throws(
    () => new BotInstallationAuditService({
      client: {
        async listCurrentUserGuildMemberships() {
          return { discardedFieldCount: 0, guildIds: [] }
        },
      },
      configuredGuildIds: new Set(["01"]),
    }),
    /Configured Discord guild ID is invalid/,
  )
})

test("bot installation audit requests an empty terminator after an exact full bound", async () => {
  const requests: string[] = []
  const service = new BotInstallationAuditService({
    client: {
      async listCurrentUserGuildMemberships(options = {}) {
        requests.push(options.after || "")
        if (options.after === "0") {
          return {
            discardedFieldCount: 0,
            guildIds: Array.from({ length: 200 }, (_, index) => guildId(index + 1)),
          }
        }
        if (options.after === guildId(200)) {
          return {
            discardedFieldCount: 0,
            guildIds: Array.from({ length: 200 }, (_, index) => guildId(index + 201)),
          }
        }
        return { discardedFieldCount: 0, guildIds: [] }
      },
    },
    configuredGuildIds: new Set(),
  })

  const result = await service.audit(APPLICATION_ID, BOT_ID)

  assert.deepEqual(requests, ["0", guildId(200), guildId(400)])
  assert.equal(result.completeness.pagesRead, 3)
  assert.equal(result.installedGuildIds.length, 400)
})

test("bot installation audit fails whole on malformed, duplicate, cursor, and bound evidence", async () => {
  const cases: Array<{
    client: BotInstallationAuditClient
    message: RegExp
  }> = [
    {
      client: {
        async listCurrentUserGuildMemberships() {
          return { discardedFieldCount: -1, guildIds: [] }
        },
      },
      message: /malformed membership page/,
    },
    {
      client: {
        async listCurrentUserGuildMemberships() {
          return {
            discardedFieldCount: 0,
            guildIds: [guildId(1), guildId(1)],
          }
        },
      },
      message: /duplicate guild ID/,
    },
    {
      client: {
        async listCurrentUserGuildMemberships() {
          return { discardedFieldCount: 0, guildIds: ["0"] }
        },
      },
      message: /malformed guild ID/,
    },
    {
      client: {
        async listCurrentUserGuildMemberships(options = {}) {
          if (options.after === "0") {
            return {
              discardedFieldCount: 0,
              guildIds: Array.from({ length: 200 }, (_, index) => guildId(index + 1)),
            }
          }
          return { discardedFieldCount: 0, guildIds: [guildId(200)] }
        },
      },
      message: /non-advancing guild cursor/,
    },
    {
      client: {
        async listCurrentUserGuildMemberships(options = {}) {
          if (options.after === "0") {
            return {
              discardedFieldCount: Number.MAX_SAFE_INTEGER,
              guildIds: Array.from({ length: 200 }, (_, index) => guildId(index + 1)),
            }
          }
          return { discardedFieldCount: 1, guildIds: [] }
        },
      },
      message: /discarded metadata evidence exceeded the local count bound/,
    },
    {
      client: {
        async listCurrentUserGuildMemberships(options = {}) {
          const after = BigInt(options.after || "0")
          return {
            discardedFieldCount: 0,
            guildIds: Array.from(
              { length: 200 },
              (_, index) => (after + BigInt(index + 1)).toString(),
            ),
          }
        },
      },
      message: /exceeds the local audit bound/,
    },
  ]

  for (const fixture of cases) {
    const service = new BotInstallationAuditService({
      client: fixture.client,
      configuredGuildIds: new Set(),
    })
    await assert.rejects(
      service.audit(APPLICATION_ID, BOT_ID),
      (error: unknown) => (
        error instanceof BotInstallationAuditEvidenceError
        && fixture.message.test(error.message)
      ),
    )
  }
})
