import type {
  ActivityList,
  ActivityStore,
} from "./activity-log.js"
import { JsonlActivityLog } from "./activity-log.js"
import type {
  AttachmentMessagePlan,
  AttachmentMessageRequest,
  AttachmentMessageResult,
  AttachmentMessageServiceOptions,
} from "./attachment-message-service.js"
import { AttachmentMessageService } from "./attachment-message-service.js"
import type {
  AdministrationServiceOptions,
  MemberModerationPlan,
  MemberModerationRequest,
  MemberModerationResult,
} from "./administration-service.js"
import { AdministrationService } from "./administration-service.js"
import type {
  ChannelAdministrationServiceOptions,
  ChannelCreationPlan,
  ChannelCreationRequest,
  ChannelCreationResult,
} from "./channel-administration-service.js"
import { ChannelAdministrationService } from "./channel-administration-service.js"
import type { ConnectorConfig } from "./config.js"
import {
  CONNECTOR_LIMITS,
  DISCORD_APPLICATION_FLAGS,
  DISCORD_CHANNEL_TYPES,
  DISCORD_LIMITS,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DeletionPlan,
  DeletionResult,
  DeletionServiceOptions,
} from "./deletion-service.js"
import { DeletionService } from "./deletion-service.js"
import type {
  DiscordClientOptions,
  GuildPageOptions,
  GuildMessageSearchOptions,
  MessagePageOptions,
} from "./discord-client.js"
import { DiscordClient } from "./discord-client.js"
import { ConfigurationError } from "./errors.js"
import type {
  AddReactionRequest,
  EditOwnMessageRequest,
  InteractionServiceOptions,
  SendMessageRequest,
} from "./interaction-service.js"
import { InteractionService } from "./interaction-service.js"
import { InteractionLimiter } from "./interaction-limiter.js"
import {
  normalizeChannel,
  normalizeGuild,
  normalizeMessage,
  normalizeSearchMessage,
} from "./normalize.js"
import { evaluateBotChannelPermissions } from "./permissions.js"
import { ScopePolicy } from "./policy.js"
import type {
  RoleAdministrationServiceOptions,
  RoleCreationPlan,
  RoleCreationRequest,
  RoleCreationResult,
} from "./role-administration-service.js"
import {
  normalizeDiscordRole,
  normalizeDiscordRoleInventory,
  RoleAdministrationService,
} from "./role-administration-service.js"
import {
  FileOperationStore,
  operationReceiptDirectory,
  type OperationStore,
} from "./operation-store.js"
import type {
  DiscordApplication,
  DiscordChannel,
  DiscordGuild,
  DiscordMessageSearchIndexing,
  DiscordMessage,
  DiscordThreadList,
  DiscordUser,
  RequestOptions,
} from "./types.js"

export interface DiscordServiceClient {
  addOwnReaction: DiscordClient["addOwnReaction"]
  bulkDeleteMessages: DiscordClient["bulkDeleteMessages"]
  createGuildBan: DiscordClient["createGuildBan"]
  createGuildChannel: DiscordClient["createGuildChannel"]
  createGuildRole: DiscordClient["createGuildRole"]
  createAttachmentMessage: DiscordClient["createAttachmentMessage"]
  createMessage: DiscordClient["createMessage"]
  deleteMessage: DiscordClient["deleteMessage"]
  editMessage: DiscordClient["editMessage"]
  getChannel: DiscordClient["getChannel"]
  getCurrentApplication: DiscordClient["getCurrentApplication"]
  getCurrentUser: DiscordClient["getCurrentUser"]
  getGuild: DiscordClient["getGuild"]
  getGuildBan: DiscordClient["getGuildBan"]
  getGuildChannels: DiscordClient["getGuildChannels"]
  getGuildMember: DiscordClient["getGuildMember"]
  getGuildRole: DiscordClient["getGuildRole"]
  getGuildRoles: DiscordClient["getGuildRoles"]
  getMessage: DiscordClient["getMessage"]
  getUser: DiscordClient["getUser"]
  listActiveGuildThreads: DiscordClient["listActiveGuildThreads"]
  listCurrentUserGuilds: DiscordClient["listCurrentUserGuilds"]
  listJoinedPrivateArchivedThreads: DiscordClient["listJoinedPrivateArchivedThreads"]
  listMessages: DiscordClient["listMessages"]
  listPrivateArchivedThreads: DiscordClient["listPrivateArchivedThreads"]
  listPublicArchivedThreads: DiscordClient["listPublicArchivedThreads"]
  modifyGuildMemberTimeout: DiscordClient["modifyGuildMemberTimeout"]
  removeGuildBan: DiscordClient["removeGuildBan"]
  removeGuildMember: DiscordClient["removeGuildMember"]
  searchGuildMessages: DiscordClient["searchGuildMessages"]
}

export interface ActiveThreadListOptions extends RequestOptions {
  limit?: number
  parentChannelId?: string
}

export type ArchivedThreadVisibility = "joined-private" | "private" | "public"

export interface ArchivedThreadListOptions extends RequestOptions {
  beforeThreadId?: string
  beforeTimestamp?: string
  limit?: number
  visibility?: ArchivedThreadVisibility
}

export interface ConnectorServiceOptions {
  administrationOptions?: Pick<
    AdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  activityStore?: ActivityStore
  attachmentMessageOptions?: Pick<
    AttachmentMessageServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  channelAdministrationOptions?: Pick<
    ChannelAdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
  client?: DiscordServiceClient
  clientOptions?: Omit<DiscordClientOptions, "token">
  config: ConnectorConfig
  deletionOptions?: Pick<DeletionServiceOptions, "clock" | "planKey" | "randomId">
  interactionOptions?: Pick<
    InteractionServiceOptions,
    "clock" | "ledgerTtlMs" | "limiter" | "randomId"
  >
  operationStore?: OperationStore
  policy?: ScopePolicy
  roleAdministrationOptions?: Pick<
    RoleAdministrationServiceOptions,
    "clock" | "planKey" | "randomId"
  >
}

interface VerifiedIdentity {
  application: DiscordApplication
  bot: DiscordUser
}

function applicationMessageContentIntent(
  application: DiscordApplication,
): "disabled" | "enabled" | "unknown" {
  let flags: bigint
  try {
    if (application.flags_new !== undefined) flags = BigInt(application.flags_new)
    else if (application.flags !== undefined) flags = BigInt(application.flags)
    else return "unknown"
  } catch {
    return "unknown"
  }
  const intentFlags = DISCORD_APPLICATION_FLAGS.gatewayMessageContent
    | DISCORD_APPLICATION_FLAGS.gatewayMessageContentLimited
  return (flags & intentFlags) !== 0n ? "enabled" : "disabled"
}

function assertConnectorLimit(
  value: number | undefined,
  minimum: number,
  maximum: number,
  name: string,
): void {
  if (
    value !== undefined
    && (!Number.isInteger(value) || value < minimum || value > maximum)
  ) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
}

function hasSearchFilter(options: GuildMessageSearchOptions): boolean {
  return Boolean(
    options.content?.trim()
    || options.channelIds?.length
    || options.authorIds?.length
    || options.authorTypes?.length
    || options.mentionUserIds?.length
    || options.mentionRoleIds?.length
    || options.repliedToUserIds?.length
    || options.repliedToMessageIds?.length
    || options.has?.length
    || options.embedTypes?.length
    || options.embedProviders?.length
    || options.linkHostnames?.length
    || options.attachmentFilenames?.length
    || options.attachmentExtensions?.length
    || options.minId
    || options.maxId
    || options.pinned !== undefined
    || options.mentionEveryone !== undefined
  )
}

function searchIndexing(
  value: DiscordMessageSearchIndexing | unknown,
): value is DiscordMessageSearchIndexing {
  return Boolean(
    value
    && typeof value === "object"
    && "code" in value
    && value.code === 110000,
  )
}

function isThreadType(type: number): boolean {
  const threadTypes: readonly number[] = [
    DISCORD_CHANNEL_TYPES.announcementThread,
    DISCORD_CHANNEL_TYPES.privateThread,
    DISCORD_CHANNEL_TYPES.publicThread,
  ]
  return threadTypes.includes(type)
}

const ARCHIVED_THREAD_VISIBILITIES: ReadonlySet<string> = new Set([
  "joined-private",
  "private",
  "public",
])
const THREAD_PARENT_TYPES: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcement,
  DISCORD_CHANNEL_TYPES.forum,
  DISCORD_CHANNEL_TYPES.media,
  DISCORD_CHANNEL_TYPES.text,
])

function normalizedGuildChannel(channel: DiscordChannel, guildId: string) {
  return normalizeChannel({
    ...channel,
    guild_id: channel.guild_id || guildId,
  })
}

export class ConnectorService {
  readonly #administrationService: AdministrationService
  readonly #activityStore: ActivityStore
  readonly #attachmentMessageService: AttachmentMessageService
  readonly #channelAdministrationService: ChannelAdministrationService
  readonly #client: DiscordServiceClient
  readonly #config: ConnectorConfig
  readonly #deletionService: DeletionService
  #identityPromise: Promise<VerifiedIdentity> | undefined
  readonly #interactionService: InteractionService
  readonly #policy: ScopePolicy
  readonly #roleAdministrationService: RoleAdministrationService

  constructor(options: ConnectorServiceOptions) {
    this.#config = options.config
    this.#client = options.client || new DiscordClient({
      ...options.clientOptions,
      token: options.config.token,
    })
    this.#policy = options.policy || new ScopePolicy(options.config)
    this.#activityStore = options.activityStore || new JsonlActivityLog(options.config.auditFile)
    const operationStore = options.operationStore || new FileOperationStore(
      operationReceiptDirectory(options.config.auditFile),
    )
    const interactionClock = options.interactionOptions?.clock || (() => new Date())
    const interactionLimiter = options.interactionOptions?.limiter || new InteractionLimiter({
      clock: () => interactionClock().getTime(),
      maxWritesPerMinute: options.config.interactionMaxWritesPerMinute,
      minWriteIntervalMs: options.config.interactionMinWriteIntervalMs,
    })
    this.#administrationService = new AdministrationService({
      activityStore: this.#activityStore,
      client: this.#client,
      policy: this.#policy,
      ...options.administrationOptions,
    })
    this.#channelAdministrationService = new ChannelAdministrationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.channelAdministrationOptions,
    })
    this.#deletionService = new DeletionService({
      activityStore: this.#activityStore,
      client: this.#client,
      policy: this.#policy,
      ...options.deletionOptions,
    })
    this.#attachmentMessageService = new AttachmentMessageService({
      activityStore: this.#activityStore,
      attachmentMaxBytes: options.config.attachmentMaxBytes,
      attachmentRoots: options.config.attachmentRoots,
      client: this.#client,
      limiter: interactionLimiter,
      operationStore,
      policy: this.#policy,
      ...options.attachmentMessageOptions,
    })
    this.#interactionService = new InteractionService({
      activityStore: this.#activityStore,
      client: this.#client,
      maxWritesPerMinute: options.config.interactionMaxWritesPerMinute,
      minWriteIntervalMs: options.config.interactionMinWriteIntervalMs,
      policy: this.#policy,
      ...options.interactionOptions,
      limiter: interactionLimiter,
    })
    this.#roleAdministrationService = new RoleAdministrationService({
      activityStore: this.#activityStore,
      client: this.#client,
      operationStore,
      policy: this.#policy,
      ...options.roleAdministrationOptions,
    })
  }

  describePolicy() {
    return this.#policy.describe()
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
        messageContentIntent: applicationMessageContentIntent(identity.application),
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
      policy: this.describePolicy(),
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
    const scopedChannels = this.#policy.filterChannels(
      channels.filter((channel) => !channel.guild_id || channel.guild_id === guildId),
    )
    return {
      channels: scopedChannels
        .map((channel) => normalizedGuildChannel(channel, guildId))
        .sort((left, right) => (
          (left.position ?? Number.MAX_SAFE_INTEGER)
          - (right.position ?? Number.MAX_SAFE_INTEGER)
        )),
      guildId,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async listRoles(guildId: string, options: RequestOptions = {}) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    const roles = normalizeDiscordRoleInventory(
      await this.#client.getGuildRoles(guildId, options),
      guildId,
    )
    return {
      guildId,
      page: {
        documentedLimit: DISCORD_LIMITS.guildRoles,
        returned: roles.length,
      },
      roles,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async getRole(
    guildId: string,
    roleId: string,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    const role = normalizeDiscordRole(
      await this.#client.getGuildRole(guildId, roleId, options),
      guildId,
      roleId,
    )
    return {
      guildId,
      role,
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async readMessages(channelId: string, options: MessagePageOptions = {}) {
    await this.#verifyIdentity(options)
    const channel = await this.#client.getChannel(channelId, options)
    if (channel.id !== channelId) {
      throw new ConfigurationError("Discord returned a different channel for message history")
    }
    const guildId = this.#policy.assertChannelReadable(channel)
    const messages: DiscordMessage[] = await this.#client.listMessages(channelId, options)
    if (messages.some((message) => (
      message.channel_id !== channelId
      || Boolean(message.guild_id && message.guild_id !== guildId)
    ))) {
      throw new ConfigurationError("Discord returned message history outside the requested channel")
    }
    return {
      channel: normalizedGuildChannel(channel, guildId),
      guildId,
      messages: messages.map((message) => normalizeMessage(message, guildId)),
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
    if (channel.id !== channelId) {
      throw new ConfigurationError("Discord returned a different channel for message lookup")
    }
    const guildId = this.#policy.assertChannelReadable(channel)
    const message: DiscordMessage = await this.#client.getMessage(
      channelId,
      messageId,
      options,
    )
    if (
      message.id !== messageId
      || message.channel_id !== channelId
      || Boolean(message.guild_id && message.guild_id !== guildId)
    ) {
      throw new ConfigurationError("Discord returned a different message than requested")
    }
    return {
      channel: normalizedGuildChannel(channel, guildId),
      guildId,
      message: normalizeMessage(message, guildId),
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }

  async searchMessages(
    guildId: string,
    options: GuildMessageSearchOptions = {},
  ) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    if (!hasSearchFilter(options)) {
      throw new ConfigurationError("Discord message search requires at least one substantive filter")
    }
    const channelIds = this.#policy.constrainSearchChannelIds(
      options.channelIds,
      DISCORD_LIMITS.searchChannelIds,
    )
    const response = await this.#client.searchGuildMessages(guildId, {
      ...options,
      ...(channelIds ? { channelIds } : {}),
    })
    if (searchIndexing(response)) {
      return {
        documentsIndexed: response.documents_indexed ?? null,
        guildId,
        retryAfterMs: Math.max(0, Math.ceil(response.retry_after * 1_000)),
        schemaVersion: SCHEMA_VERSION,
        status: "indexing" as const,
      }
    }

    const responseThreads = (response.threads || []).filter((thread) => (
      !thread.guild_id || thread.guild_id === guildId
    ))
    const threadParents = new Map(
      responseThreads.map((thread) => [thread.id, thread.parent_id ?? null]),
    )
    const outboundChannelIds = channelIds ? new Set(channelIds) : undefined
    const messagesById = new Map<string, DiscordMessage>()
    for (const message of response.messages.flat()) {
      if (message.guild_id && message.guild_id !== guildId) continue
      const parentId = threadParents.get(message.channel_id)
      if (
        outboundChannelIds
        && !outboundChannelIds.has(message.channel_id)
        && !(parentId && outboundChannelIds.has(parentId))
      ) continue
      if (!this.#policy.channelIdReadable(
        message.channel_id,
        parentId,
      )) continue
      if (!messagesById.has(message.id)) messagesById.set(message.id, message)
    }
    const requestedLimit = options.limit ?? DISCORD_LIMITS.guildMessageSearch
    const messages = [...messagesById.values()]
      .slice(0, requestedLimit)
      .map((message) => normalizeSearchMessage(message, guildId))
    const returnedChannelIds = new Set(messages.map((message) => message.channelId))
    const threads = responseThreads
      .filter((thread) => returnedChannelIds.has(thread.id))
      .filter((thread) => this.#policy.channelIdReadable(thread.id, thread.parent_id))
      .map((thread) => normalizedGuildChannel(thread, guildId))
    const offset = options.offset ?? 0
    const candidateNextOffset = offset + requestedLimit
    const nextOffset = candidateNextOffset <= DISCORD_LIMITS.searchOffset
      && candidateNextOffset < response.total_results
      ? candidateNextOffset
      : null
    return {
      documentsIndexed: response.documents_indexed ?? null,
      doingDeepHistoricalIndex: response.doing_deep_historical_index,
      guildId,
      messages,
      page: {
        nextOffset,
        offset,
        requestedLimit,
        returned: messages.length,
        totalResultsEstimate: response.total_results,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok" as const,
      threads,
    }
  }

  async listActiveThreads(
    guildId: string,
    options: ActiveThreadListOptions = {},
  ) {
    await this.#verifyIdentity(options)
    this.#policy.assertGuildAllowed(guildId)
    assertConnectorLimit(
      options.limit,
      1,
      CONNECTOR_LIMITS.activeThreads,
      "Active thread result limit",
    )
    if (options.parentChannelId) {
      const parent = await this.#client.getChannel(options.parentChannelId, options)
      if (parent.id !== options.parentChannelId) {
        throw new ConfigurationError("Discord returned a different thread parent channel")
      }
      const parentGuildId = this.#policy.assertChannelReadable(parent)
      if (parentGuildId !== guildId) {
        throw new ConfigurationError("Discord thread parent does not belong to the requested guild")
      }
      if (!THREAD_PARENT_TYPES.has(parent.type)) {
        throw new ConfigurationError("Discord channel type does not support threads")
      }
    }
    const response = await this.#client.listActiveGuildThreads(guildId, options)
    const visible = response.threads
      .filter((thread) => !thread.guild_id || thread.guild_id === guildId)
      .filter((thread) => this.#policy.channelIdReadable(thread.id, thread.parent_id))
      .filter((thread) => (
        !options.parentChannelId || thread.parent_id === options.parentChannelId
      ))
    const limit = options.limit ?? CONNECTOR_LIMITS.threadPageDefault
    return {
      guildId,
      page: {
        requestedLimit: limit,
        returned: Math.min(visible.length, limit),
        totalVisible: visible.length,
        truncated: visible.length > limit,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      threads: visible
        .slice(0, limit)
        .map((thread) => normalizedGuildChannel(thread, guildId)),
    }
  }

  async listArchivedThreads(
    channelId: string,
    options: ArchivedThreadListOptions = {},
  ) {
    await this.#verifyIdentity(options)
    assertConnectorLimit(
      options.limit,
      DISCORD_LIMITS.archivedThreadsMinimum,
      DISCORD_LIMITS.archivedThreads,
      "Archived thread result limit",
    )
    const visibility = options.visibility ?? "public"
    if (!ARCHIVED_THREAD_VISIBILITIES.has(visibility)) {
      throw new ConfigurationError("Archived thread visibility is not supported")
    }
    if (visibility === "joined-private" && options.beforeTimestamp) {
      throw new ConfigurationError("Joined-private archived threads use beforeThreadId")
    }
    if (visibility !== "joined-private" && options.beforeThreadId) {
      throw new ConfigurationError("Public and private archived threads use beforeTimestamp")
    }
    const parent = await this.#client.getChannel(channelId, options)
    if (parent.id !== channelId) {
      throw new ConfigurationError("Discord returned a different archived-thread parent channel")
    }
    const guildId = this.#policy.assertChannelReadable(parent)
    if (visibility === "public" && !THREAD_PARENT_TYPES.has(parent.type)) {
      throw new ConfigurationError("Discord channel type does not support public archived threads")
    }
    if (
      visibility !== "public"
      && parent.type !== DISCORD_CHANNEL_TYPES.text
    ) {
      throw new ConfigurationError("Discord private archived threads require a guild text channel")
    }
    const before = visibility === "joined-private"
      ? options.beforeThreadId
      : options.beforeTimestamp
    const pageOptions = {
      ...(before ? { before } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    }
    let response: DiscordThreadList
    if (visibility === "joined-private") {
      response = await this.#client.listJoinedPrivateArchivedThreads(channelId, pageOptions)
    } else if (visibility === "private") {
      response = await this.#client.listPrivateArchivedThreads(channelId, pageOptions)
    } else {
      response = await this.#client.listPublicArchivedThreads(channelId, pageOptions)
    }
    const threads = response.threads
      .filter((thread) => thread.parent_id === channelId)
      .filter((thread) => !thread.guild_id || thread.guild_id === guildId)
      .filter((thread) => this.#policy.channelIdReadable(thread.id, thread.parent_id))
      .map((thread) => normalizedGuildChannel(thread, guildId))
    const lastRaw = response.threads.at(-1)
    const cursorValue = visibility === "joined-private"
      ? lastRaw?.id
      : lastRaw?.thread_metadata?.archive_timestamp
    return {
      channel: normalizedGuildChannel(parent, guildId),
      guildId,
      page: {
        hasMore: response.has_more || false,
        nextCursor: response.has_more && cursorValue
          ? { value: cursorValue, visibility }
          : null,
        requestedLimit: options.limit ?? null,
        returned: threads.length,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      threads,
      visibility,
    }
  }

  async explainChannelAccess(
    channelId: string,
    options: RequestOptions = {},
  ) {
    const identity = await this.#verifyIdentity(options)
    const channel = await this.#client.getChannel(channelId, options)
    if (channel.id !== channelId) {
      throw new ConfigurationError("Discord returned a different channel for permission evaluation")
    }
    const guildId = this.#policy.assertChannelReadable(channel)
    let permissionChannel = channel
    if (isThreadType(channel.type)) {
      if (!channel.parent_id) {
        throw new ConfigurationError("Discord thread omitted its parent channel ID")
      }
      permissionChannel = await this.#client.getChannel(channel.parent_id, options)
      if (permissionChannel.id !== channel.parent_id) {
        throw new ConfigurationError("Discord returned a different thread permission source")
      }
      const parentGuildId = this.#policy.assertChannelReadable(permissionChannel)
      if (parentGuildId !== guildId) {
        throw new ConfigurationError("Discord thread parent belongs to another guild")
      }
    }
    const [member, roles] = await Promise.all([
      this.#client.getGuildMember(guildId, identity.bot.id, options),
      this.#client.getGuildRoles(guildId, options),
    ])
    if (member.user && member.user.id !== identity.bot.id) {
      throw new ConfigurationError("Discord returned a different guild member for permission evaluation")
    }
    return {
      botId: identity.bot.id,
      channel: normalizedGuildChannel(channel, guildId),
      guildId,
      permissions: evaluateBotChannelPermissions({
        botId: identity.bot.id,
        channel,
        guildId,
        member,
        permissionChannel,
        roles,
      }),
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

  async planMemberModeration(
    request: MemberModerationRequest,
    options: RequestOptions = {},
  ): Promise<MemberModerationPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#administrationService.plan(identity.bot.id, request, options)
  }

  async planChannelCreation(
    request: ChannelCreationRequest,
    options: RequestOptions = {},
  ): Promise<ChannelCreationPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#channelAdministrationService.plan(identity.bot.id, request, options)
  }

  async planRoleCreation(
    request: RoleCreationRequest,
    options: RequestOptions = {},
  ): Promise<RoleCreationPlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#roleAdministrationService.plan(identity.bot.id, request, options)
  }

  async planAttachmentMessage(
    request: AttachmentMessageRequest,
    options: RequestOptions = {},
  ): Promise<AttachmentMessagePlan> {
    const identity = await this.#verifyIdentity(options)
    return this.#attachmentMessageService.plan(identity.bot.id, request, options)
  }

  async executeChannelCreation(
    request: ChannelCreationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<ChannelCreationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#channelAdministrationService.execute(
      identity.bot.id,
      request,
      planDigest,
      options,
    )
  }

  async executeRoleCreation(
    request: RoleCreationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<RoleCreationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#roleAdministrationService.execute(
      identity.bot.id,
      request,
      planDigest,
      options,
    )
  }

  async executeAttachmentMessage(
    request: AttachmentMessageRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<AttachmentMessageResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#attachmentMessageService.execute(
      identity.bot.id,
      request,
      planDigest,
      options,
    )
  }

  async executeMemberModeration(
    request: MemberModerationRequest,
    planDigest: string,
    options: RequestOptions = {},
  ): Promise<MemberModerationResult> {
    const identity = await this.#verifyIdentity(options)
    return this.#administrationService.execute(
      identity.bot.id,
      request,
      planDigest,
      options,
    )
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

  async sendMessage(
    request: SendMessageRequest,
    options: RequestOptions = {},
  ) {
    const identity = await this.#verifyIdentity(options)
    return this.#interactionService.sendMessage(identity.bot.id, request, options)
  }

  async editOwnMessage(
    request: EditOwnMessageRequest,
    options: RequestOptions = {},
  ) {
    const identity = await this.#verifyIdentity(options)
    return this.#interactionService.editOwnMessage(identity.bot.id, request, options)
  }

  async addReaction(
    request: AddReactionRequest,
    options: RequestOptions = {},
  ) {
    await this.#verifyIdentity(options)
    return this.#interactionService.addReaction(request, options)
  }

  listActivity(limit?: number): Promise<ActivityList> {
    return this.#activityStore.list(limit)
  }
}
