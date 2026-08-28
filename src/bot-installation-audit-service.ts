import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import type {
  DiscordClient,
  DiscordGuildMembershipPage,
} from "./discord-client.js"
import { BotInstallationAuditEvidenceError } from "./errors.js"
import type { RequestOptions } from "./types.js"

export const BOT_INSTALLATION_AUDIT_SCHEMA_VERSION = 1

export const BOT_INSTALLATION_AUDIT_LIMITS = Object.freeze({
  maximumGuilds: 400,
  pageSize: DISCORD_LIMITS.currentUserGuilds,
})

export const BOT_INSTALLATION_AUDIT_PRIVACY = Object.freeze({
  guildMetadata: "id-only" as const,
  memberAndPresenceCounts: "not-requested" as const,
  persistence: "none" as const,
  rawPayloads: "omitted" as const,
})

export interface BotInstallationAuditClient {
  listCurrentUserGuildMemberships:
    DiscordClient["listCurrentUserGuildMemberships"]
}

export interface BotInstallationAuditResult {
  completeness: {
    complete: true
    maximumGuilds: number
    pageSize: number
    pagesRead: number
  }
  configuredGuildIds: string[]
  discardedGuildFieldCount: number
  drift: {
    detected: boolean
    missingConfiguredGuildIds: string[]
    unexpectedGuildIds: string[]
  }
  identity: {
    applicationId: string
    botId: string
  }
  installedGuildIds: string[]
  installedInScopeGuildIds: string[]
  privacy: typeof BOT_INSTALLATION_AUDIT_PRIVACY
  schemaVersion: number
  status: "complete"
}

export interface BotInstallationAuditServiceOptions {
  client: BotInstallationAuditClient
  configuredGuildIds: ReadonlySet<string>
}

function compareSnowflakes(left: string, right: string): number {
  const leftId = BigInt(left)
  const rightId = BigInt(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function validCanonicalSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
    && BigInt(value).toString() === value
}

function evidenceError(detail: string): BotInstallationAuditEvidenceError {
  return new BotInstallationAuditEvidenceError(
    `Discord bot installation audit could not prove a complete inventory: ${detail}`,
  )
}

function assertPage(
  value: DiscordGuildMembershipPage,
): asserts value is DiscordGuildMembershipPage {
  if (
    !value
    || typeof value !== "object"
    || !Array.isArray(value.guildIds)
    || value.guildIds.length > BOT_INSTALLATION_AUDIT_LIMITS.pageSize
    || !Number.isSafeInteger(value.discardedFieldCount)
    || value.discardedFieldCount < 0
  ) throw evidenceError("Discord returned a malformed membership page")
}

export class BotInstallationAuditService {
  readonly #client: BotInstallationAuditClient
  readonly #configuredGuildIds: readonly string[]

  constructor(options: BotInstallationAuditServiceOptions) {
    this.#client = options.client
    for (const guildId of options.configuredGuildIds) {
      if (!validCanonicalSnowflake(guildId)) {
        throw new RangeError("Configured Discord guild ID is invalid")
      }
    }
    this.#configuredGuildIds = [...options.configuredGuildIds]
      .sort(compareSnowflakes)
  }

  async audit(
    applicationId: string,
    botId: string,
    options: RequestOptions = {},
  ): Promise<BotInstallationAuditResult> {
    const installedGuildIds: string[] = []
    const seenGuildIds = new Set<string>()
    let after = "0"
    let discardedGuildFieldCount = 0
    let pagesRead = 0

    while (true) {
      const page = await this.#client.listCurrentUserGuildMemberships({
        ...options,
        after,
        limit: BOT_INSTALLATION_AUDIT_LIMITS.pageSize,
      })
      pagesRead += 1
      assertPage(page)
      if (
        installedGuildIds.length + page.guildIds.length
        > BOT_INSTALLATION_AUDIT_LIMITS.maximumGuilds
      ) throw evidenceError("the installed guild count exceeds the local audit bound")

      let nextAfter = after
      for (const guildId of page.guildIds) {
        if (!validCanonicalSnowflake(guildId)) {
          throw evidenceError("Discord returned a malformed guild ID")
        }
        if (BigInt(guildId) <= BigInt(after)) {
          throw evidenceError("Discord returned a non-advancing guild cursor")
        }
        if (seenGuildIds.has(guildId)) {
          throw evidenceError("Discord returned a duplicate guild ID")
        }
        seenGuildIds.add(guildId)
        installedGuildIds.push(guildId)
        if (BigInt(guildId) > BigInt(nextAfter)) nextAfter = guildId
      }
      discardedGuildFieldCount += page.discardedFieldCount
      if (!Number.isSafeInteger(discardedGuildFieldCount)) {
        throw evidenceError("discarded metadata evidence exceeded the local count bound")
      }
      if (page.guildIds.length < BOT_INSTALLATION_AUDIT_LIMITS.pageSize) break
      after = nextAfter
    }

    installedGuildIds.sort(compareSnowflakes)
    const installed = new Set(installedGuildIds)
    const configured = new Set(this.#configuredGuildIds)
    const installedInScopeGuildIds = installedGuildIds
      .filter((guildId) => configured.has(guildId))
    const missingConfiguredGuildIds = this.#configuredGuildIds
      .filter((guildId) => !installed.has(guildId))
    const unexpectedGuildIds = installedGuildIds
      .filter((guildId) => !configured.has(guildId))
    return {
      completeness: {
        complete: true,
        maximumGuilds: BOT_INSTALLATION_AUDIT_LIMITS.maximumGuilds,
        pageSize: BOT_INSTALLATION_AUDIT_LIMITS.pageSize,
        pagesRead,
      },
      configuredGuildIds: [...this.#configuredGuildIds],
      discardedGuildFieldCount,
      drift: {
        detected: missingConfiguredGuildIds.length > 0
          || unexpectedGuildIds.length > 0,
        missingConfiguredGuildIds,
        unexpectedGuildIds,
      },
      identity: { applicationId, botId },
      installedGuildIds,
      installedInScopeGuildIds,
      privacy: BOT_INSTALLATION_AUDIT_PRIVACY,
      schemaVersion: BOT_INSTALLATION_AUDIT_SCHEMA_VERSION,
      status: "complete",
    }
  }
}
