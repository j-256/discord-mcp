import type { ConnectorConfig } from "./config.js"
import { PolicyError } from "./errors.js"
import type { DiscordChannel, DiscordGuild } from "./types.js"

export interface PolicyDescription {
  allowedChannelIds: string[]
  allowedGuildIds: string[]
  deleteChannelIds: string[]
  deletionsEnabled: boolean
  interactionChannelIds: string[]
  interactionMaxWritesPerMinute: number
  interactionMinWriteIntervalMs: number
  interactionsEnabled: boolean
  mentionUserCount: number
  readChannelScope: "all-visible" | "allowlist"
  readGuildScope: "all-visible" | "allowlist"
}

export class ScopePolicy {
  readonly #allowedChannelIds: ReadonlySet<string>
  readonly #allowedGuildIds: ReadonlySet<string>
  readonly #allowDeletions: boolean
  readonly #allowInteractions: boolean
  readonly #deleteChannelIds: ReadonlySet<string>
  readonly #interactionChannelIds: ReadonlySet<string>
  readonly #interactionMaxWritesPerMinute: number
  readonly #interactionMinWriteIntervalMs: number
  readonly #mentionUserIds: ReadonlySet<string>

  constructor(config: Pick<
    ConnectorConfig,
    | "allowedChannelIds"
    | "allowedGuildIds"
    | "allowDeletions"
    | "allowInteractions"
    | "deleteChannelIds"
    | "interactionChannelIds"
    | "interactionMaxWritesPerMinute"
    | "interactionMinWriteIntervalMs"
    | "mentionUserIds"
  >) {
    this.#allowedChannelIds = config.allowedChannelIds
    this.#allowedGuildIds = config.allowedGuildIds
    this.#allowDeletions = config.allowDeletions
    this.#allowInteractions = config.allowInteractions
    this.#deleteChannelIds = config.deleteChannelIds
    this.#interactionChannelIds = config.interactionChannelIds
    this.#interactionMaxWritesPerMinute = config.interactionMaxWritesPerMinute
    this.#interactionMinWriteIntervalMs = config.interactionMinWriteIntervalMs
    this.#mentionUserIds = config.mentionUserIds
  }

  describe(): PolicyDescription {
    return {
      allowedChannelIds: [...this.#allowedChannelIds].sort(),
      allowedGuildIds: [...this.#allowedGuildIds].sort(),
      deleteChannelIds: [...this.#deleteChannelIds].sort(),
      deletionsEnabled: this.#allowDeletions && this.#deleteChannelIds.size > 0,
      interactionChannelIds: [...this.#interactionChannelIds].sort(),
      interactionMaxWritesPerMinute: this.#interactionMaxWritesPerMinute,
      interactionMinWriteIntervalMs: this.#interactionMinWriteIntervalMs,
      interactionsEnabled: this.#allowInteractions && this.#interactionChannelIds.size > 0,
      mentionUserCount: this.#mentionUserIds.size,
      readChannelScope: this.#allowedChannelIds.size > 0 ? "allowlist" : "all-visible",
      readGuildScope: this.#allowedGuildIds.size > 0 ? "allowlist" : "all-visible",
    }
  }

  filterGuilds(guilds: readonly DiscordGuild[]): DiscordGuild[] {
    return guilds.filter((guild) => this.guildAllowed(guild.id))
  }

  filterChannels(channels: readonly DiscordChannel[]): DiscordChannel[] {
    return channels.filter((channel) => this.channelIdReadable(
      channel.id,
      channel.parent_id,
    ))
  }

  guildAllowed(guildId: string): boolean {
    return this.#allowedGuildIds.size === 0 || this.#allowedGuildIds.has(guildId)
  }

  assertGuildAllowed(guildId: string): void {
    if (!this.guildAllowed(guildId)) {
      throw new PolicyError(`Discord guild ${guildId} is outside the configured read scope`)
    }
  }

  channelIdReadable(channelId: string, parentId?: string | null): boolean {
    return this.#allowedChannelIds.size === 0
      || this.#allowedChannelIds.has(channelId)
      || Boolean(parentId && this.#allowedChannelIds.has(parentId))
  }

  constrainSearchChannelIds(
    requestedChannelIds: readonly string[] | undefined,
    maximum: number,
  ): string[] | undefined {
    if (this.#allowedChannelIds.size === 0) {
      return requestedChannelIds ? [...requestedChannelIds] : undefined
    }
    if (requestedChannelIds) {
      for (const channelId of requestedChannelIds) {
        if (!this.#allowedChannelIds.has(channelId)) {
          throw new PolicyError(
            `Discord channel ${channelId} is outside the exact configured search scope`,
          )
        }
      }
      return [...requestedChannelIds]
    }
    if (this.#allowedChannelIds.size > maximum) {
      throw new PolicyError(
        `Configured channel scope exceeds Discord's ${maximum}-channel search filter; provide an exact subset`,
      )
    }
    return [...this.#allowedChannelIds].sort()
  }

  assertChannelReadable(channel: DiscordChannel): string {
    const guildId = channel.guild_id
    if (!guildId) throw new PolicyError("Direct-message channels are outside connector scope")
    this.assertGuildAllowed(guildId)
    if (!this.channelIdReadable(channel.id, channel.parent_id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the configured read scope`)
    }
    return guildId
  }

  assertChannelDeletable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowDeletions) {
      throw new PolicyError("Discord deletion is disabled by connector configuration")
    }
    if (this.#deleteChannelIds.size === 0) {
      throw new PolicyError("Discord deletion requires an explicit deletion-channel allowlist")
    }
    if (!this.#deleteChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the deletion scope`)
    }
    return guildId
  }

  assertChannelInteractable(channel: DiscordChannel): string {
    const guildId = this.assertChannelReadable(channel)
    if (!this.#allowInteractions) {
      throw new PolicyError("Discord interactions are disabled by connector configuration")
    }
    if (this.#interactionChannelIds.size === 0) {
      throw new PolicyError("Discord interactions require an explicit interaction-channel allowlist")
    }
    if (!this.#interactionChannelIds.has(channel.id)) {
      throw new PolicyError(`Discord channel ${channel.id} is outside the interaction scope`)
    }
    return guildId
  }

  assertNotificationUsers(userIds: readonly string[]): void {
    for (const userId of userIds) {
      if (!this.#mentionUserIds.has(userId)) {
        throw new PolicyError(`Discord user ${userId} is outside the notification scope`)
      }
    }
  }
}
