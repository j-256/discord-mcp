import type {
  ActivityList,
  ActivityStore,
} from "./activity-log.js"
import { JsonlActivityLog } from "./activity-log.js"
import type { ConnectorConfig } from "./config.js"
import { DISCORD_LIMITS, SCHEMA_VERSION } from "./constants.js"
import type {
  DeletionPlan,
  DeletionResult,
  DeletionServiceOptions,
} from "./deletion-service.js"
import { DeletionService } from "./deletion-service.js"
import type {
  DiscordClientOptions,
  GuildPageOptions,
  MessagePageOptions,
} from "./discord-client.js"
import { DiscordClient } from "./discord-client.js"
import { ConfigurationError } from "./errors.js"
import {
  normalizeChannel,
  normalizeGuild,
  normalizeMessage,
} from "./normalize.js"
import { ScopePolicy } from "./policy.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordGuild,
  DiscordMessage,
  DiscordUser,
  RequestOptions,
} from "./types.js"

export interface DiscordServiceClient {
  bulkDeleteMessages: DiscordClient["bulkDeleteMessages"]
  deleteMessage: DiscordClient["deleteMessage"]
  getChannel: DiscordClient["getChannel"]
  getCurrentApplication: DiscordClient["getCurrentApplication"]
  getCurrentUser: DiscordClient["getCurrentUser"]
  getGuildChannels: DiscordClient["getGuildChannels"]
  getMessage: DiscordClient["getMessage"]
  listCurrentUserGuilds: DiscordClient["listCurrentUserGuilds"]
  listMessages: DiscordClient["listMessages"]
}

export interface ConnectorServiceOptions {
  activityStore?: ActivityStore
  client?: DiscordServiceClient
  clientOptions?: Omit<DiscordClientOptions, "token">
  config: ConnectorConfig
  deletionOptions?: Pick<DeletionServiceOptions, "clock" | "planKey" | "randomId">
  policy?: ScopePolicy
}

interface VerifiedIdentity {
  application: DiscordApplication
  bot: DiscordUser
}

export class ConnectorService {
  readonly #activityStore: ActivityStore
  readonly #client: DiscordServiceClient
  readonly #config: ConnectorConfig
  readonly #deletionService: DeletionService
  #identityPromise: Promise<VerifiedIdentity> | undefined
  readonly #policy: ScopePolicy

  constructor(options: ConnectorServiceOptions) {
    this.#config = options.config
    this.#client = options.client || new DiscordClient({
      ...options.clientOptions,
      token: options.config.token,
    })
    this.#policy = options.policy || new ScopePolicy(options.config)
    this.#activityStore = options.activityStore || new JsonlActivityLog(options.config.auditFile)
    this.#deletionService = new DeletionService({
      activityStore: this.#activityStore,
      client: this.#client,
      policy: this.#policy,
      ...options.deletionOptions,
    })
  }

  async #verifyIdentity(options: RequestOptions = {}): Promise<VerifiedIdentity> {
    if (!this.#identityPromise) {
      this.#identityPromise = Promise.all([
        this.#client.getCurrentApplication(options),
        this.#client.getCurrentUser(options),
      ]).then(([application, bot]) => {
        const expectedApplicationId = this.#config.expectedApplicationId
        if (expectedApplicationId && application.id !== expectedApplicationId) {
          throw new ConfigurationError(
            `Discord token belongs to application ${application.id}, expected ${expectedApplicationId}`,
          )
        }
        if (!bot.bot) {
          throw new ConfigurationError("Discord credential did not identify a bot user")
        }
        if (application.bot?.id && application.bot.id !== bot.id) {
          throw new ConfigurationError("Discord application and bot user identities do not match")
        }
        return { application, bot }
      }).catch((error: unknown) => {
        this.#identityPromise = undefined
        throw error
      })
    }
    return this.#identityPromise
  }

  async getStatus(options: RequestOptions = {}) {
    const identity = await this.#verifyIdentity(options)
    const guilds = await this.#client.listCurrentUserGuilds({
      limit: DISCORD_LIMITS.currentUserGuilds,
      ...options,
    })
    const scopedGuilds = this.#policy.filterGuilds(guilds)
    return {
      application: {
        id: identity.application.id,
        name: identity.application.name,
      },
      auditFile: this.#config.auditFile,
      bot: {
        id: identity.bot.id,
        username: identity.bot.username,
      },
      guildPage: {
        accessible: guilds.length,
        inScope: scopedGuilds.length,
      },
      policy: this.#policy.describe(),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async listGuilds(options: GuildPageOptions = {}) {
    await this.#verifyIdentity(options)
    const guilds: DiscordGuild[] = await this.#client.listCurrentUserGuilds(options)
    const scopedGuilds = this.#policy.filterGuilds(guilds)
    return {
      guilds: scopedGuilds.map(normalizeGuild),
      page: {
        after: options.after ?? null,
        before: options.before ?? null,
        requestedLimit: options.limit ?? null,
        returned: scopedGuilds.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async listChannels(guildId: string, options: RequestOptions = {}) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    const channels: DiscordChannel[] = await this.#client.getGuildChannels(guildId, options)
    const scopedChannels = this.#policy.filterChannels(channels)
    return {
      channels: scopedChannels
        .map(normalizeChannel)
        .sort((left, right) => (
          (left.position ?? Number.MAX_SAFE_INTEGER)
          - (right.position ?? Number.MAX_SAFE_INTEGER)
        )),
      guildId,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async readMessages(channelId: string, options: MessagePageOptions = {}) {
    await this.#verifyIdentity(options)
    const channel = await this.#client.getChannel(channelId, options)
    const guildId = this.#policy.assertChannelReadable(channel)
    const messages: DiscordMessage[] = await this.#client.listMessages(channelId, options)
    return {
      channel: normalizeChannel(channel),
      guildId,
      messages: messages.map(normalizeMessage),
      page: {
        after: options.after ?? null,
        around: options.around ?? null,
        before: options.before ?? null,
        requestedLimit: options.limit ?? null,
        returned: messages.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async getMessage(
    channelId: string,
    messageId: string,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    const channel = await this.#client.getChannel(channelId, options)
    const guildId = this.#policy.assertChannelReadable(channel)
    const message: DiscordMessage = await this.#client.getMessage(
      channelId,
      messageId,
      options,
    )
    return {
      channel: normalizeChannel(channel),
      guildId,
      message: normalizeMessage(message),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async planMessageDeletion(
    channelId: string,
    messageIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<DeletionPlan> {
    await this.#verifyIdentity(options)
    return this.#deletionService.plan(channelId, messageIds, options)
  }

  async deleteMessages(
    channelId: string,
    messageIds: readonly string[],
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<DeletionResult> {
    await this.#verifyIdentity(options)
    return this.#deletionService.execute(channelId, messageIds, planDigest, options)
  }

  listActivity(limit?: number): Promise<ActivityList> {
    return this.#activityStore.list(limit)
  }
}
