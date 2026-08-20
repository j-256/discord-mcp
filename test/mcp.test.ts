import assert from "node:assert/strict"
import process from "node:process"
import { PassThrough } from "node:stream"
import test, { type TestContext } from "node:test"

import {
  Client,
  InMemoryTransport,
  type ClientOptions,
  type Tool,
} from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

import {
  MCP_DISCOVERY_TOOL_NAME,
  MCP_TOOLSET_NAMES,
} from "../src/constants.js"
import type { ChannelCreationRequest } from "../src/channel-administration-service.js"
import {
  ROLE_CREATION_HIGH_RISK_PERMISSIONS,
  type NormalizedDiscordRole,
  type RoleCreationPlan,
  type RoleCreationRequest,
} from "../src/role-administration-service.js"
import {
  AdministrationExecutionError,
  ChannelCreationExecutionError,
  ChannelCreationOperationConflictError,
  DiscordApiError,
  InteractionExecutionError,
  InteractionRateLimitError,
  RoleCreationExecutionError,
  RoleCreationOperationConflictError,
} from "../src/errors.js"
import {
  createDiscordMcpServer,
  runDiscordMcpServer,
  type DiscordMcpRunOptions,
  type DiscordToolService,
} from "../src/mcp.js"
import { GatewayEventStore, type GatewayEventSource } from "../src/gateway-events.js"
import { MCP_RESOURCE_URIS } from "../src/mcp-guidance.js"
import { normalizeChannel, normalizeMessage } from "../src/normalize.js"
import { loadObservabilityConfig } from "../src/observability-config.js"
import { OperationalTelemetry } from "../src/observability.js"
import {
  DISCORD_PERMISSIONS,
  discordPermissionBitfield,
  discordPermissionNames,
  evaluateBotChannelPermissions,
} from "../src/permissions.js"
import type { PolicyDescription } from "../src/policy.js"
import type { DiscordChannel, DiscordMessage } from "../src/types.js"

const TOKEN = "test-discord-token"
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1_000
const LIST_CHANGED_TIMEOUT_MS = 2_000
const STATIC_RESOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const GUILD_ID = "100000000000000001"
const CHANNEL_ID = "200000000000000001"
const PARENT_ID = "200000000000000002"
const MESSAGE_ID = "300000000000000001"
const ROLE_ID = "350000000000000001"
const USER_ID = "400000000000000001"
const AUDIT_REASON = "Reviewed safety incident 42"
const OPERATION_KEY = "channel-create-attempt-0001"
const ROLE_OPERATION_KEY = "role-create-attempt-0001"
const OPERATION_KEY_HASH = `sha256:${"c".repeat(64)}`
const DIGEST = `hmac-sha256:${"a".repeat(64)}`
const DIFFERENT_DIGEST = `hmac-sha256:${"b".repeat(64)}`

function rawChannel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    guild_id: GUILD_ID,
    id: CHANNEL_ID,
    last_message_id: MESSAGE_ID,
    name: "general",
    nsfw: false,
    parent_id: null,
    permission_overwrites: [],
    position: 1,
    type: 0,
    ...overrides,
  }
}

function rawMessage(content = "hello"): DiscordMessage {
  return {
    attachments: [],
    author: {
      bot: false,
      global_name: null,
      id: "400000000000000001",
      username: "member",
    },
    channel_id: CHANNEL_ID,
    components: [],
    content,
    edited_timestamp: null,
    embeds: [],
    flags: 0,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
    mention_everyone: false,
    mention_roles: [],
    mentions: [],
    pinned: false,
    reactions: [],
    timestamp: "2026-08-14T00:00:00.000Z",
    tts: false,
    type: 0,
  }
}

function plan(digest = DIGEST) {
  return {
    channelId: CHANNEL_ID,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    guildId: GUILD_ID,
    messageIds: [MESSAGE_ID],
    messages: [{
      attachmentFilenames: [],
      author: {
        bot: false,
        globalName: null,
        id: "400000000000000001",
        username: "member",
      },
      contentLength: 5,
      contentPreview: "hello",
      editedTimestamp: null,
      id: MESSAGE_ID,
      timestamp: "2026-08-14T00:00:00.000Z",
      truncated: false,
    }],
    operations: [{
      kind: "individual" as const,
      messageIds: [MESSAGE_ID],
    }],
    schemaVersion: 1,
    status: "planned" as const,
  }
}

function moderationPlan(digest = DIGEST) {
  return {
    action: "kick" as const,
    auditReason: AUDIT_REASON,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    guildId: GUILD_ID,
    parameters: {
      deleteMessageSeconds: null,
      durationMinutes: null,
      estimatedTimeoutUntil: null,
    },
    permission: {
      botAdministrator: false,
      botHighestRolePosition: 2,
      required: "KICK_MEMBERS" as const,
      targetAdministrator: false,
      targetHighestRolePosition: 1,
    },
    schemaVersion: 1,
    status: "planned" as const,
    target: {
      banState: "not-banned" as const,
      bot: false,
      currentTimeoutUntil: null,
      globalName: null,
      id: USER_ID,
      membership: "member" as const,
      nickname: null,
      username: "member",
    },
  }
}

function channelPlan(
  request: ChannelCreationRequest,
  digest = DIGEST,
  action: "create" | "none" = "create",
) {
  const category = request.kind === "category"
  const observed = {
    defaultAutoArchiveDuration: category
      ? null
      : request.defaultAutoArchiveDuration ?? 1_440,
    id: CHANNEL_ID,
    name: request.name,
    nsfw: category ? null : request.nsfw ?? false,
    parentId: request.parentId ?? null,
    rateLimitPerUser: category ? null : request.rateLimitPerUser ?? 0,
    topic: category ? null : request.topic ?? null,
    type: category ? 4 : request.kind === "forum" ? 15 : 0,
  }
  return {
    action,
    auditReason: request.auditReason,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    existingChannel: action === "none" ? observed : null,
    guild: {
      id: request.guildId,
      name: "Guild",
      ownerId: USER_ID,
    },
    operationKeyHash: OPERATION_KEY_HASH,
    parent: request.parentId
      ? { id: request.parentId, name: "Parent", visibleChildren: 2 }
      : null,
    permission: {
      botAdministrator: false,
      guildManageChannels: true,
      guildViewChannel: true,
      parentManageChannels: request.parentId ? true : null,
      parentViewChannel: request.parentId ? true : null,
    },
    schemaVersion: 1,
    status: action === "none" ? "already-current" as const : "planned" as const,
    target: {
      defaultAutoArchiveDuration: observed.defaultAutoArchiveDuration,
      kind: request.kind,
      name: request.name,
      nsfw: observed.nsfw,
      parentId: observed.parentId,
      rateLimitPerUser: observed.rateLimitPerUser,
      topic: observed.topic,
      type: observed.type,
    },
    visibleInventory: {
      guildChannels: 8,
      guildLimit: 500,
      parentChildren: request.parentId ? 2 : null,
      parentLimit: request.parentId ? 50 : null,
    },
    warnings: ["Visible inventory is bounded by Discord visibility"],
  }
}

function normalizedCreatedRole(
  request: RoleCreationRequest,
): NormalizedDiscordRole {
  const permissionBits = discordPermissionBitfield(request.permissions || [])
  return {
    colors: {
      primaryColor: request.primaryColor ?? 0,
      secondaryColor: null,
      tertiaryColor: null,
    },
    flags: 0,
    hoist: request.hoist ?? false,
    icon: null,
    id: ROLE_ID,
    managed: false,
    management: { id: null, type: "standard" },
    mentionable: request.mentionable ?? false,
    name: request.name,
    permissionNames: discordPermissionNames(permissionBits),
    permissions: permissionBits.toString(),
    position: 1,
    unicodeEmoji: null,
    unknownPermissionBits: "0",
  }
}

function rolePlan(
  request: RoleCreationRequest,
  digest = DIGEST,
  action: "create" | "none" = "create",
): RoleCreationPlan {
  const permissions = [...(request.permissions || [])]
  const permissionBits = discordPermissionBitfield(permissions)
  const botPermissionBits = permissionBits | DISCORD_PERMISSIONS.MANAGE_ROLES
  const observed = normalizedCreatedRole(request)
  const highRiskPermissionSet = new Set<string>(ROLE_CREATION_HIGH_RISK_PERMISSIONS)
  return {
    action,
    auditReason: request.auditReason,
    createdAt: "2026-08-14T00:00:00.000Z",
    digest,
    existingRole: action === "none" ? observed : null,
    guild: {
      features: [],
      id: request.guildId,
      name: "Guild",
      ownerId: USER_ID,
    },
    highRiskPermissions: permissions.filter((permission) => (
      highRiskPermissionSet.has(permission)
    )),
    operationKeyHash: OPERATION_KEY_HASH,
    permission: {
      botAdministrator: false,
      botEffectivePermissionNames: discordPermissionNames(botPermissionBits),
      botEffectivePermissions: botPermissionBits.toString(),
      botHighestRoleIds: ["350000000000000002"],
      botHighestRolePosition: 2,
      guildManageRoles: true,
      requestedSubset: true,
    },
    schemaVersion: 1,
    status: action === "none" ? "already-current" : "planned",
    target: {
      hoist: request.hoist ?? false,
      mentionable: request.mentionable ?? false,
      name: request.name,
      permissionBits: permissionBits.toString(),
      permissions,
      primaryColor: request.primaryColor ?? 0,
    },
    visibleInventory: {
      guildLimit: 250,
      guildRoles: action === "none" ? 3 : 2,
    },
    warnings: ["New Discord roles begin at the bottom of the hierarchy"],
  }
}

function fixturePolicy(): PolicyDescription {
  return {
    administrationEnabled: false,
    administrationGuildIds: [],
    allowedChannelIds: [],
    allowedGuildIds: [],
    channelCreationEnabled: false,
    channelCreationGuildIds: [],
    deleteChannelIds: [],
    deletionsEnabled: false,
    gatewayEnabled: false,
    gatewayEventBufferSize: 100,
    interactionChannelIds: [],
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    interactionsEnabled: false,
    mentionUserCount: 0,
    mcpToolsets: [...MCP_TOOLSET_NAMES],
    mcpToolSurface: "full",
    protectedUserCount: 0,
    readChannelScope: "all-visible",
    roleCreationEnabled: false,
    roleCreationGuildIds: [],
    readGuildScope: "all-visible",
  }
}

function serviceFixture(overrides: {
  administrationError?: Error
  activityError?: Error
  channelCreationAction?: "create" | "none"
  channelCreationError?: Error
  channelCreationPlanDigest?: string
  interactionError?: Error
  messageContent?: string
  planDigest?: string
  roleCreationAction?: "create" | "none"
  roleCreationError?: Error
  roleCreationPlanDigest?: string
} = {}) {
  const calls = {
    active: 0,
    addReaction: 0,
    archived: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    channelCreationExecute: 0,
    channelCreationPlan: 0,
    delete: 0,
    edit: 0,
    explain: 0,
    getRole: 0,
    listRoles: 0,
    plan: 0,
    roleCreationExecute: 0,
    roleCreationPlan: 0,
    search: 0,
    send: 0,
  }
  const service: DiscordToolService = {
    async addReaction(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.addReaction += 1
      return {
        activityId: "activity-reaction",
        channelId: input.channelId,
        guildId: GUILD_ID,
        messageId: input.messageId,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${input.messageId}`,
      }
    },
    async deleteMessages(channelId, messageIds, planDigest) {
      calls.delete += 1
      return {
        activityId: "activity-one",
        channelId,
        deletedMessageIds: [...messageIds],
        guildId: GUILD_ID,
        planDigest,
        schemaVersion: 1,
        status: "completed",
      }
    },
    describePolicy: fixturePolicy,
    async executeChannelCreation(request, planDigest) {
      if (overrides.channelCreationError) throw overrides.channelCreationError
      calls.channelCreationExecute += 1
      const planned = channelPlan(
        request,
        planDigest,
        overrides.channelCreationAction,
      )
      const observed = planned.existingChannel || {
        ...planned.target,
        id: CHANNEL_ID,
      }
      return {
        activityId: planned.action === "none" ? null : "activity-channel-create",
        channelId: observed.id,
        guildId: request.guildId,
        observed,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        schemaVersion: 1,
        status: planned.action === "none" ? "already-current" : "completed",
      }
    },
    async executeMemberModeration(request, planDigest) {
      if (overrides.administrationError) throw overrides.administrationError
      calls.administrationExecute += 1
      return {
        action: request.action,
        activityId: "activity-moderation",
        guildId: request.guildId,
        planDigest,
        schemaVersion: 1,
        status: "completed",
        timeoutUntil: null,
        userId: request.userId,
      }
    },
    async executeRoleCreation(request, planDigest) {
      if (overrides.roleCreationError) throw overrides.roleCreationError
      calls.roleCreationExecute += 1
      const planned = rolePlan(
        request,
        planDigest,
        overrides.roleCreationAction,
      )
      const observed = planned.existingRole || normalizedCreatedRole(request)
      return {
        activityId: planned.action === "none" ? null : "activity-role-create",
        guildId: request.guildId,
        observed,
        operationKeyHash: planned.operationKeyHash,
        planDigest,
        roleId: observed.id,
        schemaVersion: 1,
        status: planned.action === "none" ? "already-current" : "completed",
      }
    },
    async explainChannelAccess(channelId) {
      calls.explain += 1
      const discordChannel = rawChannel({ id: channelId })
      return {
        botId: "600000000000000001",
        channel: normalizeChannel(discordChannel),
        guildId: GUILD_ID,
        permissions: evaluateBotChannelPermissions({
          botId: "600000000000000001",
          channel: discordChannel,
          guildId: GUILD_ID,
          member: { roles: [] },
          permissionChannel: discordChannel,
          roles: [{
            id: GUILD_ID,
            managed: false,
            name: "@everyone",
            permissions: (
              DISCORD_PERMISSIONS.VIEW_CHANNEL
              | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
            ).toString(),
            position: 0,
          }],
        }),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async editOwnMessage(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.edit += 1
      return {
        activityId: "activity-edit",
        channelId: input.channelId,
        guildId: GUILD_ID,
        messageId: input.messageId,
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${input.messageId}`,
      }
    },
    async getMessage() {
      return {
        channel: normalizeChannel(rawChannel()),
        guildId: GUILD_ID,
        message: normalizeMessage(rawMessage(overrides.messageContent), GUILD_ID),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async getRole(guildId) {
      calls.getRole += 1
      return {
        guildId,
        role: normalizedCreatedRole({
          auditReason: AUDIT_REASON,
          guildId,
          name: "reviewer",
          operationKey: OPERATION_KEY,
          permissions: ["VIEW_CHANNEL"],
        }),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async getStatus() {
      return {
        application: {
          id: "500000000000000001",
          messageContentIntent: "enabled" as const,
          name: "Connector",
        },
        auditFile: "/memory/activity.jsonl",
        bot: { id: "600000000000000001", username: "bot" },
        guildPage: { accessible: 1, inScope: 1 },
        policy: fixturePolicy(),
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listActivity() {
      if (overrides.activityError) throw overrides.activityError
      return {
        entries: [],
        file: "/memory/activity.jsonl",
        skippedLines: 0,
      }
    },
    async listActiveThreads(guildId, options) {
      calls.active += 1
      return {
        guildId,
        page: {
          requestedLimit: options?.limit ?? 50,
          returned: 0,
          totalVisible: 0,
          truncated: false,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
      }
    },
    async listArchivedThreads(channelId, options) {
      calls.archived += 1
      const visibility = options?.visibility ?? "public"
      return {
        channel: normalizeChannel(rawChannel({ id: channelId })),
        guildId: GUILD_ID,
        page: {
          hasMore: false,
          nextCursor: null,
          requestedLimit: options?.limit ?? null,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
        visibility,
      }
    },
    async listChannels(guildId) {
      return {
        channels: [],
        guildId,
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listGuilds() {
      return {
        guilds: [],
        page: {
          after: null,
          before: null,
          requestedLimit: 200,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async listRoles(guildId) {
      calls.listRoles += 1
      return {
        guildId,
        page: { documentedLimit: 250, returned: 1 },
        roles: [normalizedCreatedRole({
          auditReason: AUDIT_REASON,
          guildId,
          name: "reviewer",
          operationKey: OPERATION_KEY,
          permissions: ["VIEW_CHANNEL"],
        })],
        schemaVersion: 1,
        status: "ok",
      }
    },
    async planMessageDeletion() {
      calls.plan += 1
      return plan(overrides.planDigest)
    },
    async planChannelCreation(request) {
      calls.channelCreationPlan += 1
      return channelPlan(
        request,
        overrides.channelCreationPlanDigest || DIGEST,
        overrides.channelCreationAction,
      )
    },
    async planMemberModeration() {
      calls.administrationPlan += 1
      return moderationPlan(overrides.planDigest || DIGEST)
    },
    async planRoleCreation(request) {
      calls.roleCreationPlan += 1
      return rolePlan(
        request,
        overrides.roleCreationPlanDigest || DIGEST,
        overrides.roleCreationAction,
      )
    },
    async readMessages() {
      return {
        channel: normalizeChannel(rawChannel()),
        guildId: GUILD_ID,
        messages: [],
        page: {
          after: null,
          around: null,
          before: null,
          requestedLimit: 50,
          returned: 0,
        },
        schemaVersion: 1,
        status: "ok",
      }
    },
    async searchMessages(guildId, options) {
      calls.search += 1
      return {
        documentsIndexed: null,
        doingDeepHistoricalIndex: false,
        guildId,
        messages: [],
        page: {
          nextOffset: null,
          offset: options?.offset ?? 0,
          requestedLimit: options?.limit ?? 25,
          returned: 0,
          totalResultsEstimate: 0,
        },
        schemaVersion: 1,
        status: "ok",
        threads: [],
      }
    },
    async sendMessage(input) {
      if (overrides.interactionError) throw overrides.interactionError
      calls.send += 1
      return {
        activityId: "activity-send",
        channelId: input.channelId,
        guildId: GUILD_ID,
        localReplay: false,
        messageId: MESSAGE_ID,
        nonce: "stable-nonce",
        schemaVersion: 1,
        status: "completed",
        url: `https://discord.com/channels/${GUILD_ID}/${input.channelId}/${MESSAGE_ID}`,
      }
    },
  }
  return { calls, service }
}

async function connectedFixture(
  context: TestContext,
  options: {
    elicitationHandler?: (request: {
      params: {
        message: string
        requestedSchema: {
          properties: Record<string, unknown>
          required?: string[]
        }
      }
    }) => Promise<{
      action: "accept" | "cancel" | "decline"
      content?: { approve: boolean }
    }>
    environment?: NodeJS.ProcessEnv
    listChanged?: ClientOptions["listChanged"]
    serverMessages?: unknown[]
    serviceOverrides?: Parameters<typeof serviceFixture>[0]
    gateway?: GatewayEventSource
  } = {},
) {
  const serviceData = serviceFixture(options.serviceOverrides)
  const server = createDiscordMcpServer({
    environment: {
      DISCORD_BOT_TOKEN: TOKEN,
      ...options.environment,
    },
    ...(options.gateway ? { gateway: options.gateway } : {}),
    requestStateKey: new Uint8Array(32).fill(9),
    service: serviceData.service,
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  if (options.serverMessages) {
    const send = serverTransport.send.bind(serverTransport)
    serverTransport.send = async (message, sendOptions) => {
      options.serverMessages?.push(structuredClone(message))
      await send(message, sendOptions)
    }
  }
  await server.connect(serverTransport)
  const client = new Client(
    { name: "discord-mcp-test", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      ...(options.listChanged ? { listChanged: options.listChanged } : {}),
    },
  )
  if (options.elicitationHandler) {
    client.setRequestHandler(
      "elicitation/create",
      options.elicitationHandler as never,
    )
  }
  await client.connect(clientTransport)
  context.after(async () => {
    try {
      await client.close()
    } catch {}
    try {
      await server.close()
    } catch {}
  })
  return {
    client,
    ...serviceData,
  }
}

function structuredContent(result: { structuredContent?: unknown }): Record<string, unknown> {
  assert.ok(result.structuredContent)
  return result.structuredContent as Record<string, unknown>
}

function listedTool(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((entry) => entry.name === name)
  assert.ok(tool, `Expected MCP tool ${name}`)
  return tool
}

async function settleNotifications(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test("MCP server advertises bounded tools with accurate write annotations", async (context) => {
  const { client } = await connectedFixture(context)

  const result = await client.listTools()

  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    [
      "get_connector_status",
      "get_observability_status",
      "get_gateway_status",
      "get_gateway_events",
      "list_guilds",
      "list_channels",
      "list_roles",
      "get_role",
      "list_active_threads",
      "list_archived_threads",
      "explain_channel_access",
      "read_messages",
      "search_messages",
      "get_message",
      "send_message",
      "edit_own_message",
      "add_reaction",
      "plan_message_deletion",
      "delete_messages",
      "plan_channel_creation",
      "execute_channel_creation",
      "plan_role_creation",
      "execute_role_creation",
      "plan_member_moderation",
      "execute_member_moderation",
      "list_activity",
      "discover_discord_tools",
    ],
  )
  const deletion = result.tools.find((tool) => tool.name === "delete_messages")
  const administration = result.tools.find((tool) => (
    tool.name === "execute_member_moderation"
  ))
  for (const tool of [deletion, administration]) {
    assert.deepEqual(tool?.annotations, {
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    })
  }
  const administrationPlan = result.tools.find((tool) => (
    tool.name === "plan_member_moderation"
  ))
  assert.deepEqual(administrationPlan?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const channelCreationPlan = result.tools.find((tool) => (
    tool.name === "plan_channel_creation"
  ))
  assert.deepEqual(channelCreationPlan?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const channelCreation = result.tools.find((tool) => (
    tool.name === "execute_channel_creation"
  ))
  assert.deepEqual(channelCreation?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const roleCreationPlanTool = result.tools.find((tool) => (
    tool.name === "plan_role_creation"
  ))
  assert.deepEqual(roleCreationPlanTool?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: true,
  })
  const roleCreation = result.tools.find((tool) => (
    tool.name === "execute_role_creation"
  ))
  assert.deepEqual(roleCreation?.annotations, {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  })
  const discovery = result.tools.find((tool) => (
    tool.name === "discover_discord_tools"
  ))
  assert.deepEqual(discovery?.annotations, {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  })
  const send = result.tools.find((tool) => tool.name === "send_message")
  const reaction = result.tools.find((tool) => tool.name === "add_reaction")
  for (const tool of [send, reaction]) {
    assert.deepEqual(tool?.annotations, {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: false,
    })
  }
  const edit = result.tools.find((tool) => tool.name === "edit_own_message")
  assert.deepEqual(edit?.annotations, {
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
    readOnlyHint: false,
  })
  for (const name of [
    "get_gateway_status",
    "get_gateway_events",
    "get_observability_status",
  ]) {
    const gatewayTool = result.tools.find((tool) => tool.name === name)
    assert.deepEqual(gatewayTool?.annotations, {
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    })
  }
  const activity = result.tools.find((tool) => tool.name === "list_activity")
  assert.equal(activity?.annotations?.openWorldHint, false)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
})

test("MCP tool discovery returns bounded exact contracts without contacting Discord", async (context) => {
  const { calls, client } = await connectedFixture(context)
  const advertised = await client.listTools()

  const exact = structuredContent(await client.callTool({
    arguments: { query: "delete_messages" },
    name: "discover_discord_tools",
  }))
  const exactMatches = exact.matches as Array<Record<string, unknown>>
  assert.equal(exact.status, "ok")
  assert.equal(exact.surface, "full")
  assert.equal(exact.refreshToolsList, false)
  assert.deepEqual(exact.newlyEnabledToolNames, [])
  assert.equal(exactMatches.length, 1)
  assert.equal(exactMatches[0]?.name, "delete_messages")
  assert.equal(exactMatches[0]?.risk, "destructive")
  assert.deepEqual(
    exactMatches[0]?.annotations,
    listedTool(advertised.tools, "delete_messages").annotations,
  )
  assert.deepEqual(
    exactMatches[0]?.inputSchema,
    listedTool(advertised.tools, "delete_messages").inputSchema,
  )

  const bounded = structuredContent(await client.callTool({
    arguments: { detail: "full", limit: 1, risk: "destructive" },
    name: "discover_discord_tools",
  }))
  const boundedMatches = bounded.matches as Array<Record<string, unknown>>
  assert.equal(boundedMatches.length, 1)
  assert.equal(boundedMatches[0]?.risk, "destructive")
  assert.ok(Number(bounded.totalMatches) > boundedMatches.length)
  assert.ok(boundedMatches[0]?.inputSchema)

  const secretQuery = structuredContent(await client.callTool({
    arguments: { query: TOKEN },
    name: "discover_discord_tools",
  }))
  assert.equal((secretQuery.matches as unknown[]).length, 0)
  assert.doesNotMatch(JSON.stringify(secretQuery), new RegExp(TOKEN))
  assert.equal(Object.values(calls).every((count) => count === 0), true)
})

test("progressive discovery enables exact reviewed workflows and emits list changes", async (context) => {
  const full = await connectedFixture(context)
  const fullTools = (await full.client.listTools()).tools
  let changedTools: Tool[] | null = null
  let notificationCount = 0
  let resolveFirstNotification: (() => void) | undefined
  let rejectFirstNotification: ((error: Error) => void) | undefined
  const firstNotification = new Promise<void>((resolve, reject) => {
    resolveFirstNotification = resolve
    rejectFirstNotification = reject
  })
  const progressive = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
    listChanged: {
      tools: {
        debounceMs: 0,
        onChanged(error, tools) {
          notificationCount += 1
          if (error) {
            rejectFirstNotification?.(error)
            return
          }
          changedTools = tools
          resolveFirstNotification?.()
        },
      },
    },
  })

  assert.deepEqual(
    (await progressive.client.listTools()).tools.map(({ name }) => name),
    ["discover_discord_tools"],
  )
  await assert.rejects(
    () => progressive.client.callTool({
      arguments: {
        channelId: CHANNEL_ID,
        messageIds: [MESSAGE_ID],
        planDigest: DIGEST,
      },
      name: "delete_messages",
    }),
    /disabled|not found|not registered|unknown/i,
  )

  const discovery = structuredContent(await progressive.client.callTool({
    arguments: { query: "delete_messages" },
    name: "discover_discord_tools",
  }))
  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "delete_messages",
    "plan_message_deletion",
  ])
  assert.equal(discovery.refreshToolsList, true)
  await firstNotification
  await settleNotifications()
  assert.ok(notificationCount >= 1)
  assert.ok(changedTools)
  assert.deepEqual((changedTools as Tool[]).map(({ name }) => name), [
    "plan_message_deletion",
    "delete_messages",
    MCP_DISCOVERY_TOOL_NAME,
  ])

  const refreshed = (await progressive.client.listTools()).tools
  assert.deepEqual(
    refreshed.map(({ name }) => name),
    [
      "plan_message_deletion",
      "delete_messages",
      "discover_discord_tools",
    ],
  )
  for (const name of ["plan_message_deletion", "delete_messages"]) {
    assert.deepEqual(
      listedTool(refreshed, name),
      listedTool(fullTools, name),
    )
  }

  const notificationsAfterFirstDiscovery = notificationCount
  const repeated = structuredContent(await progressive.client.callTool({
    arguments: { query: "delete_messages" },
    name: "discover_discord_tools",
  }))
  await settleNotifications()
  assert.deepEqual(repeated.newlyEnabledToolNames, [])
  assert.equal(repeated.refreshToolsList, false)
  assert.equal(notificationCount, notificationsAfterFirstDiscovery)
})

test("progressive discovery enables the complete reviewed channel-creation workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_channel_creation" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_channel_creation",
    "plan_channel_creation",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_channel_creation",
      "execute_channel_creation",
      "discover_discord_tools",
    ],
  )
})

test("progressive discovery enables the complete reviewed role-creation workflow", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOL_SURFACE: "progressive" },
  })

  const discovery = structuredContent(await client.callTool({
    arguments: { query: "execute_role_creation" },
    name: "discover_discord_tools",
  }))

  assert.deepEqual(discovery.newlyEnabledToolNames, [
    "execute_role_creation",
    "plan_role_creation",
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_role_creation",
      "execute_role_creation",
      "discover_discord_tools",
    ],
  )
})

test("MCP toolsets exclude unavailable tools from direct and discovered surfaces", async (context) => {
  const { client } = await connectedFixture(context, {
    environment: { DISCORD_MCP_TOOLSETS: "messages,connector" },
  })

  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "get_connector_status",
      "read_messages",
      "search_messages",
      "get_message",
      "discover_discord_tools",
    ],
  )
  assert.deepEqual(
    (await client.listPrompts()).prompts.map(({ name }) => name),
    ["summarize_channel", "search_guild_messages"],
  )
  const unavailable = structuredContent(await client.callTool({
    arguments: { query: "moderation" },
    name: "discover_discord_tools",
  }))
  assert.equal(unavailable.totalMatches, 0)
  assert.deepEqual(unavailable.matches, [])
  assert.deepEqual(
    (unavailable.toolsets as Array<Record<string, unknown>>)
      .map(({ name }) => name),
    ["connector", "messages"],
  )
  await assert.rejects(
    () => client.callTool({ arguments: {}, name: "list_guilds" }),
    /not found|not registered|unknown/i,
  )
})

test("MCP message search requires a substantive filter and forwards bounded input", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const valid = await client.callTool({
    arguments: {
      content: "deploy",
      guildId: GUILD_ID,
      limit: 12,
      sortBy: "timestamp",
    },
    name: "search_messages",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "search_messages",
  })

  assert.equal(structuredContent(valid).status, "ok")
  assert.equal(calls.search, 1)
  assert.equal(invalid.isError, true)
  assert.equal(calls.search, 1)
})

test("MCP thread and permission tools validate cursors and invoke read-only services", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const active = await client.callTool({
    arguments: {
      guildId: GUILD_ID,
      limit: 3,
      parentChannelId: CHANNEL_ID,
    },
    name: "list_active_threads",
  })
  const archived = await client.callTool({
    arguments: {
      beforeTimestamp: "2026-08-14T00:00:00.000Z",
      channelId: CHANNEL_ID,
      limit: 4,
      visibility: "public",
    },
    name: "list_archived_threads",
  })
  const invalidCursor = await client.callTool({
    arguments: {
      beforeTimestamp: "not-an-iso-timestamp",
      channelId: CHANNEL_ID,
      visibility: "public",
    },
    name: "list_archived_threads",
  })
  const access = await client.callTool({
    arguments: { channelId: CHANNEL_ID },
    name: "explain_channel_access",
  })

  assert.equal(structuredContent(active).status, "ok")
  assert.equal(structuredContent(archived).status, "ok")
  assert.equal(invalidCursor.isError, true)
  assert.equal(structuredContent(access).status, "ok")
  assert.deepEqual(calls, {
    active: 1,
    addReaction: 0,
    administrationExecute: 0,
    administrationPlan: 0,
    archived: 1,
    channelCreationExecute: 0,
    channelCreationPlan: 0,
    delete: 0,
    edit: 0,
    explain: 1,
    getRole: 0,
    listRoles: 0,
    plan: 0,
    roleCreationExecute: 0,
    roleCreationPlan: 0,
    search: 0,
    send: 0,
  })
})

test("MCP role reads expose complete inventory and exact lookup with snowflake validation", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const inventory = await client.callTool({
    arguments: { guildId: GUILD_ID },
    name: "list_roles",
  })
  const exact = await client.callTool({
    arguments: { guildId: GUILD_ID, roleId: ROLE_ID },
    name: "get_role",
  })
  const invalid = await client.callTool({
    arguments: { guildId: GUILD_ID, roleId: "not-a-snowflake" },
    name: "get_role",
  })

  assert.equal(structuredContent(inventory).status, "ok")
  assert.equal(structuredContent(exact).status, "ok")
  assert.equal(invalid.isError, true)
  assert.equal(calls.listRoles, 1)
  assert.equal(calls.getRole, 1)
})

test("MCP Gateway tools expose local health and cursor continuity without content", async (context) => {
  const gateway = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    clock: () => new Date("2026-08-19T00:00:00.000Z"),
    cursorNamespace: "mcptooltest1",
    enabled: true,
  })
  const { client } = await connectedFixture(context, { gateway })
  gateway.transition("ready")
  gateway.ingestDispatch("MESSAGE_CREATE", {
    author: { username: TOKEN },
    channel_id: CHANNEL_ID,
    content: TOKEN,
    guild_id: GUILD_ID,
    id: MESSAGE_ID,
  })

  const status = structuredContent(await client.callTool({
    arguments: {},
    name: "get_gateway_status",
  }))
  const events = structuredContent(await client.callTool({
    arguments: {
      afterCursor: "gw1.foreigncursor.0.0",
      limit: 10,
    },
    name: "get_gateway_events",
  }))
  assert.equal(
    (status.connection as Record<string, unknown>).state,
    "ready",
  )
  assert.equal(
    (events.page as Record<string, unknown>).resetReason,
    "foreign-cursor",
  )
  assert.equal((events.events as unknown[]).length, 1)
  assert.doesNotMatch(JSON.stringify({ events, status }), new RegExp(TOKEN))
  assert.doesNotMatch(JSON.stringify(events), /author|attachment|embed|component|emoji|userId/)
})

test("MCP observability reports successful, returned-error, and thrown-error tool outcomes", async (context) => {
  const privateDetail = "private activity failure 999999999999999999"
  const { client } = await connectedFixture(context, {
    serviceOverrides: { activityError: new Error(privateDetail) },
  })

  await client.callTool({ arguments: {}, name: "list_guilds" })
  const returnedError = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIFFERENT_DIGEST,
    },
    name: "delete_messages",
  })
  assert.equal(returnedError.isError, true)
  const thrownError = await client.callTool({ arguments: {}, name: "list_activity" })
  assert.equal(thrownError.isError, true)

  const statusResult = await client.callTool({
    arguments: {},
    name: "get_observability_status",
  })
  const status = structuredContent(statusResult) as unknown as {
    operations: {
      mcpTools: Array<{
        active: number
        calls: number
        duration: unknown
        errors: number
        operation: string
        outcomes: Record<string, number>
        retries: number
      }>
    }
    privacy: Record<string, boolean>
  }
  const byName = new Map(status.operations.mcpTools.map((entry) => [entry.operation, entry]))
  assert.deepEqual(byName.get("list_guilds")?.outcomes, {
    error: 0,
    ok: 1,
    "tool-error": 0,
  })
  assert.deepEqual(byName.get("delete_messages")?.outcomes, {
    error: 0,
    ok: 0,
    "tool-error": 1,
  })
  assert.deepEqual(byName.get("list_activity")?.outcomes, {
    error: 1,
    ok: 0,
    "tool-error": 0,
  })
  assert.deepEqual(byName.get("get_observability_status"), {
    active: 1,
    calls: 0,
    duration: byName.get("get_observability_status")?.duration,
    errors: 0,
    operation: "get_observability_status",
    outcomes: { error: 0, ok: 0, "tool-error": 0 },
    retries: 0,
  })
  assert.deepEqual(status.privacy, {
    argumentsStored: false,
    contentStored: false,
    discordIdentifiersStored: false,
    errorDetailsStored: false,
    persistent: false,
    rawRoutesStored: false,
  })
  assert.equal(JSON.stringify(status).includes(privateDetail), false)

  const resource = await client.readResource({ uri: MCP_RESOURCE_URIS.observability })
  const content = resource.contents[0]
  assert.ok(content && "text" in content)
  if (!content || !("text" in content)) throw new Error("Expected observability text")
  const envelope = JSON.parse(content.text) as {
    data: { operations: { mcpTools: Array<{ active: number; calls: number; operation: string }> } }
  }
  const completedStatus = envelope.data.operations.mcpTools.find(
    ({ operation }) => operation === "get_observability_status",
  )
  assert.equal(completedStatus?.active, 0)
  assert.equal(completedStatus?.calls, 1)
  assert.equal(content.text.includes(privateDetail), false)
  assert.equal(content.text.includes(TOKEN), false)
})

test("MCP interaction tools enforce bounded schemas and invoke idempotent services", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const sent = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const edited = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "replacement",
      messageId: MESSAGE_ID,
    },
    name: "edit_own_message",
  })
  const reacted = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      emoji: "🔥",
      messageId: MESSAGE_ID,
    },
    name: "add_reaction",
  })
  const invalid = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "unsafe retry key",
      idempotencyKey: "short",
    },
    name: "send_message",
  })

  assert.equal(structuredContent(sent).status, "completed")
  assert.equal(structuredContent(edited).status, "completed")
  assert.equal(structuredContent(reacted).status, "completed")
  assert.equal(invalid.isError, true)
  assert.equal(calls.send, 1)
  assert.equal(calls.edit, 1)
  assert.equal(calls.addReaction, 1)
})

test("MCP interaction errors expose local retry timing without secrets", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionRateLimitError(750),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const structured = structuredContent(result)

  assert.equal(result.isError, true)
  assert.equal(structured.status, "rate-limited")
  assert.equal((structured.error as Record<string, unknown>).retryAfterMs, 750)
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
})

test("MCP interaction errors preserve Discord rate-limit timing", async (context) => {
  const discordError = new DiscordApiError({
    message: "Discord rate limit",
    method: "POST",
    retryAfterMs: 1_250,
    route: `/channels/${CHANNEL_ID}/messages`,
    status: 429,
  })
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionExecutionError(
        "Discord interaction did not complete with a verified outcome",
        {
          activityId: "activity-rate-limit",
          channelId: CHANNEL_ID,
          guildId: GUILD_ID,
          messageId: null,
          retryAfterMs: 1_250,
          schemaVersion: 1,
          status: "failed",
        },
        { cause: discordError },
      ),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })
  const structured = structuredContent(result)

  assert.equal(result.isError, true)
  assert.equal(structured.status, "rate-limited")
  assert.equal((structured.error as Record<string, unknown>).retryAfterMs, 1_250)
})

test("MCP interaction errors distinguish uncertain external outcomes", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      interactionError: new InteractionExecutionError(
        "Discord interaction outcome is uncertain",
        {
          activityId: "activity-uncertain",
          channelId: CHANNEL_ID,
          guildId: GUILD_ID,
          messageId: null,
          retryAfterMs: null,
          schemaVersion: 1,
          status: "uncertain",
        },
      ),
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      content: "safe message",
      idempotencyKey: "request-1234567890",
    },
    name: "send_message",
  })

  assert.equal(result.isError, true)
  assert.equal(structuredContent(result).status, "outcome-uncertain")
})

test("MCP deletion elicits exact confirmation before invoking the write service", async (context) => {
  let confirmationMessage = ""
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.plan, 1)
  assert.equal(calls.delete, 1)
  assert.match(confirmationMessage, new RegExp(MESSAGE_ID))
  assert.match(confirmationMessage, /Content: "hello"/)
  assert.match(confirmationMessage, new RegExp(DIGEST))
})

test("MCP deletion stops without writing when confirmation is declined", async (context) => {
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "confirmation-declined")
  assert.equal(calls.delete, 0)
})

test("MCP deletion rejects an accepted confirmation without approval", async (context) => {
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "confirmation-invalid")
  assert.equal(result.isError, true)
  assert.equal(calls.delete, 0)
})

test("MCP deletion refuses a changed plan before requesting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { planDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageIds: [MESSAGE_ID],
      planDigest: DIGEST,
    },
    name: "delete_messages",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.delete, 0)
})

test("MCP channel creation plans bounded additive types and rejects category settings", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const planned = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      defaultAutoArchiveDuration: 1_440,
      guildId: GUILD_ID,
      kind: "forum",
      name: "launches",
      nsfw: false,
      operationKey: OPERATION_KEY,
      parentId: PARENT_ID,
      rateLimitPerUser: 30,
      topic: "Reviewed releases",
    },
    name: "plan_channel_creation",
  })
  const invalidCategory = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "category",
      name: "launches",
      operationKey: OPERATION_KEY,
      topic: "not accepted",
    },
    name: "plan_channel_creation",
  })
  const invalidKey = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: "short",
    },
    name: "plan_channel_creation",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(invalidCategory.isError, true)
  assert.equal(invalidKey.isError, true)
  assert.equal(calls.channelCreationPlan, 1)
})

test("MCP channel creation binds signed approval to the exact additive request", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      defaultAutoArchiveDuration: 4_320,
      guildId: GUILD_ID,
      kind: "forum",
      name: "launches",
      nsfw: false,
      operationKey: OPERATION_KEY,
      parentId: PARENT_ID,
      planDigest: DIGEST,
      rateLimitPerUser: 30,
      topic: "Reviewed releases",
    },
    name: "execute_channel_creation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.channelCreationPlan, 1)
  assert.equal(calls.channelCreationExecute, 1)
  assert.match(confirmationMessage, /Action: create/)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(PARENT_ID))
  assert.match(confirmationMessage, /Channel kind: forum/)
  assert.match(confirmationMessage, /Reviewed releases/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(OPERATION_KEY))
})

test("MCP channel creation returns an already-current no-op without confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { channelCreationAction: "none" },
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })

  assert.equal(structuredContent(result).status, "already-current")
  assert.equal(confirmations, 0)
  assert.equal(calls.channelCreationPlan, 1)
  assert.equal(calls.channelCreationExecute, 1)
})

test("MCP channel creation declines or rejects approval without reserving execution", async (context) => {
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.channelCreationExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.channelCreationExecute, 0)
})

test("MCP channel creation refuses changed plans before requesting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { channelCreationPlanDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.channelCreationExecute, 0)
})

test("MCP channel creation exposes uncertain and one-shot conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCreationError: new ChannelCreationExecutionError(
        "Discord channel creation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const blocked = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCreationError: new ChannelCreationExecutionError(
        "A concurrent logical target ended uncertain",
        { status: "blocked-prior-uncertain" },
      ),
    },
  })
  const blockedResult = await blocked.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(
    structuredContent(blockedResult).status,
    "blocked-prior-uncertain",
  )

  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCreationError: new ChannelCreationOperationConflictError({
        operationKeyHash: OPERATION_KEY_HASH,
        operationKey: OPERATION_KEY,
        status: "uncertain",
      }),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    { status: "unavailable" },
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(OPERATION_KEY))

  const receipt = {
    activityId: "activity-0001",
    channelId: CHANNEL_ID,
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    status: "completed",
    timestamp: "2026-08-14T00:00:00.000Z",
    verification: "match",
  }
  const completedConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      channelCreationError: new ChannelCreationOperationConflictError(receipt),
    },
  })
  const completedConflictResult = await completedConflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      kind: "text",
      name: "launches",
      operationKey: OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_channel_creation",
  })
  assert.equal(
    structuredContent(completedConflictResult).status,
    "operation-key-conflict",
  )
  assert.deepEqual(
    (structuredContent(completedConflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
})

test("MCP role creation plans named permissions and rejects unsafe schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const planned = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      hoist: true,
      mentionable: false,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      primaryColor: 0x12_34_56,
    },
    name: "plan_role_creation",
  })
  const administrator = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "admin",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["ADMINISTRATOR"],
    },
    name: "plan_role_creation",
  })
  const duplicate = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["VIEW_CHANNEL", "VIEW_CHANNEL"],
    },
    name: "plan_role_creation",
  })
  const reserved = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "@everyone",
      operationKey: ROLE_OPERATION_KEY,
    },
    name: "plan_role_creation",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(administrator.isError, true)
  assert.equal(duplicate.isError, true)
  assert.equal(reserved.isError, true)
  assert.equal(calls.roleCreationPlan, 1)
})

test("MCP role creation binds signed approval to exact properties and permissions", async (context) => {
  let confirmationMessage = ""
  const serverMessages: unknown[] = []
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
    serverMessages,
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      hoist: true,
      mentionable: false,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"],
      planDigest: DIGEST,
      primaryColor: 0x12_34_56,
    },
    name: "execute_role_creation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.roleCreationPlan, 1)
  assert.equal(calls.roleCreationExecute, 1)
  assert.match(confirmationMessage, /Action: create/)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, /Role name: "reviewer"/)
  assert.match(confirmationMessage, /VIEW_CHANNEL, READ_MESSAGE_HISTORY/)
  assert.match(confirmationMessage, /Primary color: 1193046/)
  assert.match(confirmationMessage, new RegExp(OPERATION_KEY_HASH))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
  assert.match(confirmationMessage, /cannot be reused/)
  assert.doesNotMatch(confirmationMessage, new RegExp(ROLE_OPERATION_KEY))
  assert.doesNotMatch(JSON.stringify(serverMessages), new RegExp(ROLE_OPERATION_KEY))
})

test("MCP role creation handles no-op and refused confirmation without unsafe writes", async (context) => {
  let confirmations = 0
  const current = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { roleCreationAction: "none" },
  })
  const currentResult = await current.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      permissions: ["VIEW_CHANNEL"],
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(currentResult).status, "already-current")
  assert.equal(confirmations, 0)
  assert.equal(current.calls.roleCreationExecute, 1)

  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.roleCreationExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.roleCreationExecute, 0)
})

test("MCP role creation refuses changed plans before requesting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { roleCreationPlanDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.roleCreationExecute, 0)
})

test("MCP role creation exposes uncertain and one-shot conflict outcomes", async (context) => {
  const approve = async () => ({
    action: "accept" as const,
    content: { approve: true },
  })
  const uncertain = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleCreationError: new RoleCreationExecutionError(
        "Discord role creation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const blocked = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleCreationError: new RoleCreationExecutionError(
        "A concurrent logical target ended uncertain",
        { status: "blocked-prior-uncertain" },
      ),
    },
  })
  const blockedResult = await blocked.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(
    structuredContent(blockedResult).status,
    "blocked-prior-uncertain",
  )

  const conflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleCreationError: new RoleCreationOperationConflictError({
        operationKey: ROLE_OPERATION_KEY,
        operationKeyHash: OPERATION_KEY_HASH,
        status: "uncertain",
      }),
    },
  })
  const conflictResult = await conflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(structuredContent(conflictResult).status, "operation-key-conflict")
  assert.deepEqual(
    (structuredContent(conflictResult).error as Record<string, unknown>).receipt,
    { status: "unavailable" },
  )
  assert.doesNotMatch(JSON.stringify(conflictResult), new RegExp(ROLE_OPERATION_KEY))

  const receipt = {
    activityId: "activity-role-create",
    error: null,
    guildId: GUILD_ID,
    operationKeyHash: OPERATION_KEY_HASH,
    roleId: ROLE_ID,
    status: "completed",
    timestamp: "2026-08-14T00:00:00.000Z",
    verification: "match",
  }
  const completedConflict = await connectedFixture(context, {
    elicitationHandler: approve,
    serviceOverrides: {
      roleCreationError: new RoleCreationOperationConflictError(receipt),
    },
  })
  const completedConflictResult = await completedConflict.client.callTool({
    arguments: {
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      name: "reviewer",
      operationKey: ROLE_OPERATION_KEY,
      planDigest: DIGEST,
    },
    name: "execute_role_creation",
  })
  assert.equal(
    structuredContent(completedConflictResult).status,
    "operation-key-conflict",
  )
  assert.deepEqual(
    (structuredContent(completedConflictResult).error as Record<string, unknown>).receipt,
    receipt,
  )
})

test("MCP member moderation plans exact targets and enforces action-specific schemas", async (context) => {
  const { calls, client } = await connectedFixture(context)

  const planned = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })
  const invalid = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      deleteMessageSeconds: 0,
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })
  const oversizedReason = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: "é".repeat(200),
      guildId: GUILD_ID,
      userId: USER_ID,
    },
    name: "plan_member_moderation",
  })

  assert.equal(structuredContent(planned).status, "planned")
  assert.equal(calls.administrationPlan, 1)
  assert.equal(invalid.isError, true)
  assert.equal(oversizedReason.isError, true)
  assert.equal(calls.administrationPlan, 1)
})

test("MCP member moderation binds signed confirmation to target, action, reason, and digest", async (context) => {
  let confirmationMessage = ""
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async (request) => {
      confirmationMessage = request.params.message
      return {
        action: "accept",
        content: { approve: true },
      }
    },
  })

  const result = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })

  assert.equal(structuredContent(result).status, "completed")
  assert.equal(calls.administrationPlan, 1)
  assert.equal(calls.administrationExecute, 1)
  assert.match(confirmationMessage, /Action: kick/)
  assert.match(confirmationMessage, new RegExp(GUILD_ID))
  assert.match(confirmationMessage, new RegExp(USER_ID))
  assert.match(confirmationMessage, new RegExp(AUDIT_REASON))
  assert.match(confirmationMessage, new RegExp(DIGEST))
  assert.match(confirmationMessage, /untrusted data/)
})

test("MCP member moderation declines or rejects approval without invoking execution", async (context) => {
  const declined = await connectedFixture(context, {
    elicitationHandler: async () => ({ action: "decline" }),
  })
  const declinedResult = await declined.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(declinedResult).status, "confirmation-declined")
  assert.equal(declined.calls.administrationExecute, 0)

  const rejected = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: false },
    }),
  })
  const rejectedResult = await rejected.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(rejectedResult).status, "confirmation-invalid")
  assert.equal(rejectedResult.isError, true)
  assert.equal(rejected.calls.administrationExecute, 0)
})

test("MCP member moderation refuses a changed plan before eliciting confirmation", async (context) => {
  let confirmations = 0
  const { calls, client } = await connectedFixture(context, {
    elicitationHandler: async () => {
      confirmations += 1
      return { action: "cancel" }
    },
    serviceOverrides: { planDigest: DIFFERENT_DIGEST },
  })

  const result = await client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })

  assert.equal(structuredContent(result).status, "plan-changed")
  assert.equal(result.isError, true)
  assert.equal(confirmations, 0)
  assert.equal(calls.administrationExecute, 0)
})

test("MCP member moderation reports uncertain and rate-limited execution outcomes", async (context) => {
  const uncertain = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: true },
    }),
    serviceOverrides: {
      administrationError: new AdministrationExecutionError(
        "Discord moderation outcome is uncertain",
        { status: "uncertain" },
      ),
    },
  })
  const uncertainResult = await uncertain.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  assert.equal(structuredContent(uncertainResult).status, "outcome-uncertain")

  const rateLimit = new DiscordApiError({
    message: "Discord rate limit",
    method: "DELETE",
    retryAfterMs: 2_500,
    route: `/guilds/${GUILD_ID}/members/${USER_ID}`,
    status: 429,
  })
  const limited = await connectedFixture(context, {
    elicitationHandler: async () => ({
      action: "accept",
      content: { approve: true },
    }),
    serviceOverrides: {
      administrationError: new AdministrationExecutionError(
        "Discord moderation was rate limited",
        { status: "failed" },
        { cause: rateLimit },
      ),
    },
  })
  const limitedResult = await limited.client.callTool({
    arguments: {
      action: "kick",
      auditReason: AUDIT_REASON,
      guildId: GUILD_ID,
      planDigest: DIGEST,
      userId: USER_ID,
    },
    name: "execute_member_moderation",
  })
  const limitedStructured = structuredContent(limitedResult)
  assert.equal(limitedStructured.status, "rate-limited")
  assert.equal(
    (limitedStructured.error as Record<string, unknown>).retryAfterMs,
    2_500,
  )
})

test("MCP tool errors redact the Discord token", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      activityError: new Error(`activity failed with ${TOKEN}`),
    },
  })

  const result = await client.callTool({
    arguments: {},
    name: "list_activity",
  })

  assert.equal(result.isError, true)
  assert.equal(structuredContent(result).status, "error")
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
  assert.match(JSON.stringify(result), /\[redacted\]/)
})

test("MCP tool results redact the Discord token if Discord returns it as data", async (context) => {
  const { client } = await connectedFixture(context, {
    serviceOverrides: {
      messageContent: `message containing ${TOKEN}`,
    },
  })

  const result = await client.callTool({
    arguments: {
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
    },
    name: "get_message",
  })

  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN))
  assert.match(JSON.stringify(result), /\[redacted\]/)
})

test("MCP stdio progressive discovery negotiates modern tool-list changes", async (context) => {
  const transport = new StdioClientTransport({
    args: ["--import", "tsx", "src/cli.ts", "serve"],
    command: process.execPath,
    cwd: process.cwd(),
    env: {
      DISCORD_BOT_TOKEN: TOKEN,
      DISCORD_MCP_TOOLSETS: "deletion",
      DISCORD_MCP_TOOL_SURFACE: "progressive",
      PATH: process.env.PATH || "",
    },
    stderr: "pipe",
  })
  let diagnostics = ""
  transport.stderr?.on("data", (chunk) => {
    diagnostics += String(chunk)
  })
  let changedTools: Tool[] | null = null
  let resolveNotification: (() => void) | undefined
  let rejectNotification: ((error: Error) => void) | undefined
  const notification = new Promise<void>((resolve, reject) => {
    resolveNotification = resolve
    rejectNotification = reject
  })
  const client = new Client(
    { name: "discord-mcp-stdio-progressive-test", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      listChanged: {
        tools: {
          debounceMs: 0,
          onChanged(error, tools) {
            if (error) {
              rejectNotification?.(error)
              return
            }
            changedTools = tools
            resolveNotification?.()
          },
        },
      },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  )
  context.after(async () => {
    try {
      await client.close()
    } catch {}
  })

  await client.connect(transport)
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [MCP_DISCOVERY_TOOL_NAME],
  )
  const discovered = structuredContent(await client.callTool({
    arguments: { query: "plan_message_deletion" },
    name: MCP_DISCOVERY_TOOL_NAME,
  }))
  assert.deepEqual(discovered.newlyEnabledToolNames, [
    "delete_messages",
    "plan_message_deletion",
  ])

  let notificationTimer: NodeJS.Timeout | undefined
  await Promise.race([
    notification,
    new Promise<never>((_resolve, reject) => {
      notificationTimer = setTimeout(
        () => reject(new Error("Timed out waiting for MCP tool-list change")),
        LIST_CHANGED_TIMEOUT_MS,
      )
    }),
  ]).finally(() => {
    if (notificationTimer) clearTimeout(notificationTimer)
  })
  assert.ok(changedTools)
  assert.deepEqual((changedTools as Tool[]).map(({ name }) => name), [
    "plan_message_deletion",
    "delete_messages",
    MCP_DISCOVERY_TOOL_NAME,
  ])
  assert.deepEqual(
    (await client.listTools()).tools.map(({ name }) => name),
    [
      "plan_message_deletion",
      "delete_messages",
      MCP_DISCOVERY_TOOL_NAME,
    ],
  )
  assert.match(diagnostics, /stdio server ready/)
  assert.doesNotMatch(diagnostics, new RegExp(TOKEN))
})

test("MCP stdio entrypoint negotiates modern catalogs without stdout noise", async (context) => {
  const transport = new StdioClientTransport({
    args: ["--import", "tsx", "src/cli.ts", "serve"],
    command: process.execPath,
    cwd: process.cwd(),
    env: {
      DISCORD_BOT_TOKEN: TOKEN,
      PATH: process.env.PATH || "",
    },
    stderr: "pipe",
  })
  let diagnostics = ""
  transport.stderr?.on("data", (chunk) => {
    diagnostics += String(chunk)
  })
  const client = new Client(
    { name: "discord-mcp-stdio-test", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      versionNegotiation: { mode: { pin: "2026-07-28" } },
    },
  )
  context.after(async () => {
    try {
      await client.close()
    } catch {}
  })

  await client.connect(transport)
  const [tools, prompts, resources, templates, safety] = await Promise.all([
    client.listTools(),
    client.listPrompts(),
    client.listResources(),
    client.listResourceTemplates(),
    client.readResource({ uri: "discord://connector/safety" }),
  ])

  assert.equal(tools.tools.length, 27)
  assert.equal(prompts.prompts.length, 6)
  assert.equal(resources.resources.length, 7)
  assert.equal(templates.resourceTemplates.length, 5)
  for (const catalog of [tools, prompts, resources, templates]) {
    assert.equal(catalog.cacheScope, "public")
    assert.equal(catalog.ttlMs, CATALOG_CACHE_TTL_MS)
  }
  assert.equal(safety.cacheScope, "public")
  assert.equal(safety.ttlMs, STATIC_RESOURCE_CACHE_TTL_MS)
  assert.match(diagnostics, /stdio server ready/)
  assert.doesNotMatch(diagnostics, new RegExp(TOKEN))
})

test("MCP stdio startup fails before reporting ready when the token is absent", () => {
  let diagnostics = ""

  assert.throws(
    () => runDiscordMcpServer({
      environment: {},
      stderr: {
        write(value) {
          diagnostics += String(value)
          return true
        },
      },
    }),
    /DISCORD_BOT_TOKEN is required/,
  )
  assert.equal(diagnostics, "")
})

test("MCP stdio runner stops Gateway and observability runtimes idempotently", async () => {
  const feed = new GatewayEventStore({
    allowedChannelIds: new Set([CHANNEL_ID]),
    allowedGuildIds: new Set([GUILD_ID]),
    cursorNamespace: "runnergateway",
    enabled: true,
  })
  let starts = 0
  let stops = 0
  let reportStopped: (() => void) | undefined
  const stopped = new Promise<void>((resolve) => {
    reportStopped = resolve
  })
  const gatewayRuntime: NonNullable<DiscordMcpRunOptions["gatewayRuntime"]> = {
    enabled: true,
    getStatus: () => feed.getStatus(),
    listEvents: (options) => feed.listEvents(options),
    start() {
      starts += 1
    },
    async stop() {
      stops += 1
      reportStopped?.()
    },
    subscribe: (listener) => feed.subscribe(listener),
  }
  let flushes = 0
  let telemetryStops = 0
  const observabilityRuntime = new OperationalTelemetry({
    config: loadObservabilityConfig({
      DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT: "true",
    }, [TOKEN]),
    otlpFactory(_config, sink) {
      sink.transitionExporter("running")
      return {
        async forceFlush() {
          flushes += 1
        },
        async shutdown() {
          telemetryStops += 1
          sink.transitionExporter("stopped")
        },
      }
    },
  })
  let diagnostics = ""
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const handle = runDiscordMcpServer({
    environment: { DISCORD_BOT_TOKEN: TOKEN },
    gatewayRuntime,
    stdin,
    observabilityRuntime,
    stderr: {
      write(value) {
        diagnostics += String(value)
        return true
      },
    },
    stdout,
  })

  assert.equal(starts, 1)
  assert.equal(observabilityRuntime.getObservabilityStatus().exporter.state, "running")
  assert.match(diagnostics, /stdio server ready/)
  stdin.end()
  await stopped
  await handle.close()
  assert.equal(stops, 1)
  assert.equal(flushes, 1)
  assert.equal(telemetryStops, 1)
  assert.equal(observabilityRuntime.getObservabilityStatus().exporter.state, "stopped")
})
