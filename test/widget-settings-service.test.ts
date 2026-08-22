import assert from "node:assert/strict"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityStore,
} from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"
import type {
  DiscordGuildWidgetSettings,
  ModifyGuildWidgetSettingsInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  PolicyError,
  WidgetSettingsEvidenceError,
  WidgetSettingsExecutionError,
  WidgetSettingsOperationConflictError,
  WidgetSettingsPlanChangedError,
} from "../src/errors.js"
import type {
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"
import {
  normalizeWidgetSettingsChangeRequest,
  WidgetSettingsService,
  type WidgetSettingsChangeRequest,
  type WidgetSettingsServiceOptions,
} from "../src/widget-settings-service.js"

const APPLICATION_ID = "100000000000000001"
const GUILD_ID = "200000000000000001"
const OWNER_ID = "200000000000000002"
const READBACK_GUILD_ID = "200000000000000003"
const FINALIZATION_GUILD_ID = "200000000000000004"
const UNSAFE_READBACK_GUILD_ID = "200000000000000005"
const BOT_ID = "300000000000000001"
const BOT_ROLE_ID = "400000000000000001"
const CHANNEL_ID = "600000000000000001"
const SECOND_CHANNEL_ID = "600000000000000002"
const CATEGORY_ID = "600000000000000003"
const OPERATION_KEY = "widget-settings-operation-0001"
const AUDIT_REASON = "Reviewed widget launch"
const NOW = "2026-08-22T00:00:00.000Z"

function role(
  id: string,
  permissions: bigint,
  position: number,
  guildId = GUILD_ID,
): DiscordRole {
  return {
    id,
    managed: false,
    name: id === guildId ? "@everyone" : `private-role-${id}`,
    permissions: permissions.toString(),
    position,
  }
}

function channel(
  id: string,
  options: {
    guildId?: string
    overwrites?: DiscordChannel["permission_overwrites"]
    parentId?: string | null
    type?: number
  } = {},
): DiscordChannel {
  return {
    guild_id: options.guildId ?? GUILD_ID,
    id,
    name: `private-channel-${id}`,
    nsfw: false,
    parent_id: options.parentId ?? null,
    permission_overwrites: options.overwrites ?? [],
    type: options.type ?? DISCORD_CHANNEL_TYPES.text,
  }
}

function settings(
  enabled = false,
  channelId: string | null = null,
): DiscordGuildWidgetSettings {
  return { channelId, enabled, unknownFieldCount: 0 }
}

class MemoryOperationStore implements OperationStore {
  finishFailure: unknown
  readonly events: string[]
  lastReceipt: OperationReceipt | undefined
  readonly receipts = new Map<string, OperationReceipt>()

  constructor(events: string[]) {
    this.events = events
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.events.push(`operation:${receipt.status}`)
    if (this.finishFailure) throw this.finishFailure
    this.lastReceipt = receipt
    this.receipts.set(`${receipt.kind}:${receipt.operationKeyHash}`, receipt)
  }

  async get(kind: OperationReceipt["kind"], hash: string) {
    return this.receipts.get(`${kind}:${hash}`)
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.events.push("operation:reserve")
    const key = `${receipt.kind}:${receipt.operationKeyHash}`
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: existing }
    this.lastReceipt = receipt
    this.receipts.set(key, receipt)
    return { created: true, receipt }
  }
}

interface FixtureState {
  activityFailureAt: number | null
  botMember: DiscordGuildMember
  channels: DiscordChannel[]
  guildCrossCheck: "full" | "none" | "partial-channel" | "partial-enabled"
  guildChannelOverride: string | null | undefined
  guildEnabledOverride: boolean | undefined
  mutationError: unknown
  mutationUpdatesState: boolean
  ownerId: string
  readbackChannels: DiscordChannel[] | null
  readbackError: unknown
  responseDrift: boolean
  responseUnknown: boolean
  roles: DiscordRole[]
  settings: DiscordGuildWidgetSettings
}

function fixture(options: {
  allowAudit?: boolean
  allowChanges?: boolean
  allowPublicExposure?: boolean
  guildId?: string
  state?: Partial<FixtureState>
} = {}) {
  const guildId = options.guildId ?? GUILD_ID
  const state: FixtureState = {
    activityFailureAt: null,
    botMember: {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    },
    channels: [
      channel(CHANNEL_ID, { guildId }),
      channel(SECOND_CHANNEL_ID, { guildId }),
    ],
    guildCrossCheck: "none",
    guildChannelOverride: undefined,
    guildEnabledOverride: undefined,
    mutationError: undefined,
    mutationUpdatesState: true,
    ownerId: OWNER_ID,
    readbackChannels: null,
    readbackError: undefined,
    responseDrift: false,
    responseUnknown: false,
    roles: [
      role(guildId, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0, guildId),
      role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD, 10, guildId),
    ],
    settings: settings(),
    ...options.state,
  }
  const activities: ActivityEntry[] = []
  const events: string[] = []
  const writes: ModifyGuildWidgetSettingsInput[] = []
  let activityCalls = 0
  let mutationCompleted = false
  let publicExposureCalls = 0
  const activityStore: ActivityStore = {
    async append(entry) {
      activityCalls += 1
      events.push(`activity:${entry.status}`)
      if (state.activityFailureAt === activityCalls) {
        throw new Error("activity unavailable")
      }
      activities.push(entry)
    },
    async list() {
      return { entries: activities, file: "/memory/activity.jsonl", skippedLines: 0 }
    },
  }
  const operationStore = new MemoryOperationStore(events)
  const policy: WidgetSettingsServiceOptions["policy"] = {
    assertGuildWidgetPublicExposureChangeable(guildId) {
      publicExposureCalls += 1
      if (!(options.allowPublicExposure ?? true) || guildId !== (options.guildId ?? GUILD_ID)) {
        throw new PolicyError("Discord widget public exposure is outside scope")
      }
    },
    assertGuildWidgetSettingsAuditable(guildId) {
      if (!(options.allowAudit ?? true) || guildId !== (options.guildId ?? GUILD_ID)) {
        throw new PolicyError("Discord widget-settings audit is outside scope")
      }
    },
    assertGuildWidgetSettingsChangeable(guildId) {
      if (!(options.allowChanges ?? true) || guildId !== (options.guildId ?? GUILD_ID)) {
        throw new PolicyError("Discord widget-settings change is outside scope")
      }
    },
  }
  const client: WidgetSettingsServiceOptions["client"] = {
    async getGuild() {
      events.push("read:guild")
      const current = state.settings
      const crossCheck = state.guildCrossCheck
      return {
        features: [],
        id: guildId,
        name: "Private Guild",
        owner_id: state.ownerId,
        ...(crossCheck === "full" || crossCheck === "partial-channel"
          ? { widget_channel_id: state.guildChannelOverride ?? current.channelId }
          : {}),
        ...(crossCheck === "full" || crossCheck === "partial-enabled"
          ? { widget_enabled: state.guildEnabledOverride ?? current.enabled }
          : {}),
      }
    },
    async getGuildChannels() {
      events.push("read:channels")
      return structuredClone(
        mutationCompleted && state.readbackChannels
          ? state.readbackChannels
          : state.channels,
      )
    },
    async getGuildMember() {
      events.push("read:member")
      return structuredClone(state.botMember)
    },
    async getGuildRoles() {
      events.push("read:roles")
      return structuredClone(state.roles)
    },
    async getGuildWidgetSettings() {
      events.push(mutationCompleted ? "read:readback" : "read:widget-settings")
      if (mutationCompleted && state.readbackError) throw state.readbackError
      return structuredClone(state.settings)
    },
    async modifyGuildWidgetSettings(_guildId, input, reason) {
      events.push(`write:widget-settings:${reason}`)
      writes.push(structuredClone(input))
      if (state.mutationError) throw state.mutationError
      mutationCompleted = true
      const response = settings(input.enabled, input.channelId)
      if (state.responseDrift) response.enabled = !input.enabled
      if (state.responseUnknown) response.unknownFieldCount = 1
      if (state.mutationUpdatesState) {
        state.settings = settings(input.enabled, input.channelId)
      }
      return response
    },
  }
  const service = new WidgetSettingsService({
    activityStore,
    client,
    clock: () => new Date(NOW),
    operationStore,
    planKey: new Uint8Array(32).fill(19),
    policy,
    randomId: () => "activity-widget-settings-0001",
  })
  return {
    activities,
    events,
    getPublicExposureCalls: () => publicExposureCalls,
    guildId,
    operationStore,
    service,
    state,
    writes,
  }
}

function request(
  overrides: Partial<WidgetSettingsChangeRequest> = {},
): WidgetSettingsChangeRequest {
  return {
    auditReason: AUDIT_REASON,
    channelId: CHANNEL_ID,
    enabled: true,
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    ...overrides,
  }
}

function apiError(status: number): DiscordApiError {
  return new DiscordApiError({
    message: "Discord rejected widget-settings change",
    method: "PATCH",
    route: "/guilds/{guild.id}/widget",
    status,
  })
}

test("widget-settings normalization requires one exact complete state", () => {
  const normalized = normalizeWidgetSettingsChangeRequest(request())
  assert.equal(normalized.channelId, CHANNEL_ID)
  assert.equal(normalized.operationKeyHash.includes(OPERATION_KEY), false)
  assert.throws(
    () => normalizeWidgetSettingsChangeRequest(request({ channelId: "bad" })),
    /positive Discord snowflake/,
  )
  assert.throws(
    () => normalizeWidgetSettingsChangeRequest({
      ...request(),
      future: true,
    } as unknown as WidgetSettingsChangeRequest),
    /request is invalid/,
  )
})

test("widget-settings audit is authenticated, bounded, and anonymous-route free", async () => {
  const audited = fixture({
    state: {
      guildCrossCheck: "full",
      settings: settings(true, CHANNEL_ID),
    },
  })
  const result = await audited.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)

  assert.equal(result.configuration.enabled, true)
  assert.equal(result.configuration.channel?.channelId, CHANNEL_ID)
  assert.equal(result.configuration.channel?.everyoneCanView, true)
  assert.equal(result.configuration.channel?.everyoneCanCreateInvites, false)
  assert.equal(result.guildCrossCheck.status, "match")
  assert.equal(result.publicExposure.serverProfileVisibility, "public-by-widget")
  assert.equal(result.publicExposure.anonymousInviteGenerationPotential, true)
  assert.equal(result.privacy.anonymousEndpoints, "not-called")
  assert.equal(result.verificationBoundary.anonymousWidgetReadbackPerformed, false)
  assert.equal(audited.events.some((entry) => /widget\.json|widget-image/u.test(entry)), false)

  const partial = fixture({ state: { guildCrossCheck: "partial-enabled" } })
  assert.equal(
    (await partial.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)).guildCrossCheck.status,
    "partial-match",
  )

  const disabled = fixture()
  const disabledResult = await disabled.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.equal(disabledResult.configuration.enabled, false)
  assert.equal(disabledResult.configuration.channel, null)
  assert.equal(disabledResult.publicExposure.serverProfileVisibility, "not-verifiable")
  assert.equal(disabledResult.publicExposure.privateProfileStateObserved, false)
})

test("widget-settings accepts exact owner, Administrator, and MANAGE_GUILD authority", async () => {
  const owner = fixture({
    state: {
      ownerId: BOT_ID,
      roles: [role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0), role(BOT_ROLE_ID, 0n, 10)],
    },
  })
  const ownerPlan = await owner.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(ownerPlan.access.botIsGuildOwner, true)
  assert.equal(ownerPlan.access.manageGuild, false)
  assert.equal(ownerPlan.access.authorizedForChange, true)

  const administrator = fixture({
    state: {
      roles: [
        role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.ADMINISTRATOR, 10),
      ],
    },
  })
  const administratorPlan = await administrator.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ operationKey: "widget-settings-administrator-0001" }),
  )
  assert.equal(administratorPlan.access.botAdministrator, true)
  assert.equal(administratorPlan.access.manageGuild, true)
  assert.equal(
    administratorPlan.access.effectivePermissionNames.includes("ADMINISTRATOR"),
    true,
  )

  const manager = fixture()
  const managerPlan = await manager.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ operationKey: "widget-settings-manager-0001" }),
  )
  assert.equal(managerPlan.access.botIsGuildOwner, false)
  assert.equal(managerPlan.access.botAdministrator, false)
  assert.equal(managerPlan.access.manageGuild, true)
})

test("widget-settings binds parent overwrite evidence and rejects unknown permission bits", async () => {
  const parented = fixture({
    state: {
      channels: [
        channel(CATEGORY_ID, {
          overwrites: [{
            allow: "0",
            deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
            id: GUILD_ID,
            type: 0,
          }],
          type: DISCORD_CHANNEL_TYPES.category,
        }),
        channel(CHANNEL_ID, { parentId: CATEGORY_ID }),
        channel(SECOND_CHANNEL_ID),
      ],
    },
  })
  const firstPlan = await parented.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(firstPlan.desired.channel?.parentId, CATEGORY_ID)
  assert.equal(firstPlan.desired.channel?.everyoneCanView, true)
  const parentChannel = parented.state.channels[0]
  assert.ok(parentChannel)
  parentChannel.permission_overwrites = []
  const changedPlan = await parented.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.notEqual(changedPlan.digest, firstPlan.digest)

  const roleBound = fixture({
    state: {
      roles: [
        role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
        role(
          BOT_ROLE_ID,
          DISCORD_PERMISSIONS.MANAGE_GUILD
            | DISCORD_PERMISSIONS.CREATE_INSTANT_INVITE,
          10,
        ),
      ],
    },
  })
  const beforeRoleChange = await roleBound.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ operationKey: "widget-settings-role-evidence-0001" }),
  )
  const everyoneRole = roleBound.state.roles.find((entry) => entry.id === GUILD_ID)
  assert.ok(everyoneRole)
  everyoneRole.permissions = (
    DISCORD_PERMISSIONS.VIEW_CHANNEL
    | DISCORD_PERMISSIONS.CREATE_INSTANT_INVITE
  ).toString()
  const afterRoleChange = await roleBound.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ operationKey: "widget-settings-role-evidence-0001" }),
  )
  assert.equal(beforeRoleChange.access.effectivePermissions, afterRoleChange.access.effectivePermissions)
  assert.equal(beforeRoleChange.desired.channel?.everyoneCanCreateInvites, false)
  assert.equal(afterRoleChange.desired.channel?.everyoneCanCreateInvites, true)
  assert.notEqual(beforeRoleChange.digest, afterRoleChange.digest)

  const unknownRole = fixture({
    state: {
      roles: [
        role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0),
        role(BOT_ROLE_ID, DISCORD_PERMISSIONS.MANAGE_GUILD | (1n << 80n), 10),
      ],
    },
  })
  await assert.rejects(
    () => unknownRole.service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown permission bits/u,
  )

  const unknownOverwrite = fixture()
  const selectedChannel = unknownOverwrite.state.channels[0]
  assert.ok(selectedChannel)
  selectedChannel.permission_overwrites = [{
    allow: (1n << 80n).toString(),
    deny: "0",
    id: GUILD_ID,
    type: 0,
  }]
  await assert.rejects(
    () => unknownOverwrite.service.plan(APPLICATION_ID, BOT_ID, request()),
    /complete permission evidence/u,
  )
})

test("widget-settings planning uses an action-sensitive public-exposure gate", async () => {
  const enabled = fixture()
  const enabledPlan = await enabled.service.plan(APPLICATION_ID, BOT_ID, request())
  assert.equal(enabledPlan.publicExposureAuthorization.required, true)
  assert.equal(enabled.getPublicExposureCalls(), 1)
  assert.equal(enabledPlan.risks.some((risk) => /Server Profile public/u.test(risk)), true)

  const denied = fixture({ allowPublicExposure: false })
  await assert.rejects(
    () => denied.service.plan(APPLICATION_ID, BOT_ID, request()),
    PolicyError,
  )

  const disabling = fixture({
    allowPublicExposure: false,
    state: { settings: settings(true, CHANNEL_ID) },
  })
  const disablingPlan = await disabling.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({ enabled: false, operationKey: "widget-disable-operation-0001" }),
  )
  assert.equal(disablingPlan.publicExposureAuthorization.required, false)
  assert.equal(disabling.getPublicExposureCalls(), 0)

  const clearing = fixture({
    allowPublicExposure: false,
    state: { settings: settings(false, CHANNEL_ID) },
  })
  const clearingPlan = await clearing.service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({
      channelId: null,
      enabled: false,
      operationKey: "widget-clear-operation-0001",
    }),
  )
  assert.equal(clearingPlan.publicExposureAuthorization.required, false)
  assert.equal(clearing.getPublicExposureCalls(), 0)
  assert.match(clearingPlan.warnings.join(" "), /manual restoration/u)
  const clearingResult = await clearing.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request({
      channelId: null,
      enabled: false,
      operationKey: "widget-clear-operation-0001",
    }),
    clearingPlan.digest,
  )
  assert.equal(clearingResult.status, "completed")

  const latentTarget = fixture({
    allowPublicExposure: false,
    state: { settings: settings(false, CHANNEL_ID) },
  })
  await assert.rejects(
    () => latentTarget.service.plan(
      APPLICATION_ID,
      BOT_ID,
      request({
        channelId: SECOND_CHANNEL_ID,
        enabled: false,
        operationKey: "widget-latent-target-0001",
      }),
    ),
    PolicyError,
  )
})

test("widget-settings planning fails closed on unsafe channels and unknown state", async () => {
  const hidden = fixture()
  hidden.state.channels[0] = channel(CHANNEL_ID, {
    overwrites: [{
      allow: "0",
      deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
      id: GUILD_ID,
      type: 0,
    }],
  })
  await assert.rejects(
    () => hidden.service.plan(APPLICATION_ID, BOT_ID, request()),
    /visible to @everyone/,
  )

  const unsupported = fixture()
  unsupported.state.channels[0] = channel(CHANNEL_ID, {
    type: DISCORD_CHANNEL_TYPES.category,
  })
  await assert.rejects(
    () => unsupported.service.plan(APPLICATION_ID, BOT_ID, request()),
    /supported direct channel/,
  )

  const missing = fixture()
  missing.state.channels = [channel(SECOND_CHANNEL_ID)]
  await assert.rejects(
    () => missing.service.plan(APPLICATION_ID, BOT_ID, request()),
    /supported direct channel/,
  )

  const unknown = fixture()
  unknown.state.settings.unknownFieldCount = 1
  const audit = await unknown.service.get(APPLICATION_ID, BOT_ID, GUILD_ID)
  assert.deepEqual(audit.configuration.changeBlockedReasons, ["unknown-fields"])
  await assert.rejects(
    () => unknown.service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown state/,
  )
})

test("widget-settings fails closed on scope, authority, malformed evidence, and cross-check contradiction", async () => {
  const outOfScope = fixture({ allowAudit: false })
  await assert.rejects(
    () => outOfScope.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    PolicyError,
  )
  assert.equal(outOfScope.events.length, 0)

  const noAuthority = fixture({
    state: {
      roles: [role(GUILD_ID, DISCORD_PERMISSIONS.VIEW_CHANNEL, 0), role(BOT_ROLE_ID, 0n, 10)],
    },
  })
  await assert.rejects(
    () => noAuthority.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    /MANAGE_GUILD authority/,
  )

  const malformed = fixture()
  malformed.state.settings = {
    channelId: "bad",
    enabled: false,
    unknownFieldCount: 0,
  }
  await assert.rejects(
    () => malformed.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    WidgetSettingsEvidenceError,
  )

  const contradictory = fixture({
    state: { guildCrossCheck: "full", guildEnabledOverride: true },
  })
  await assert.rejects(
    () => contradictory.service.get(APPLICATION_ID, BOT_ID, GUILD_ID),
    WidgetSettingsEvidenceError,
  )
})

test("widget-settings no-op does not require exposure authorization or write", async () => {
  const current = settings(true, CHANNEL_ID)
  const noOp = fixture({
    allowPublicExposure: false,
    state: { settings: current },
  })
  const desired = request()
  const plan = await noOp.service.plan(APPLICATION_ID, BOT_ID, desired)
  noOp.events.length = 0
  const result = await noOp.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(plan.status, "already-current")
  assert.equal(plan.publicExposureAuthorization.required, false)
  assert.equal(result.status, "already-current")
  assert.equal(result.verification, "not-required")
  assert.equal(noOp.operationStore.lastReceipt, undefined)
  assert.equal(noOp.writes.length, 0)
  assert.equal(noOp.events.includes("operation:reserve"), false)
})

test("widget-settings execution journals before one write and verifies fresh readback", async () => {
  const executed = fixture()
  const desired = request()
  const plan = await executed.service.plan(APPLICATION_ID, BOT_ID, desired)
  executed.events.length = 0
  const result = await executed.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.deepEqual(executed.writes, [{ channelId: CHANNEL_ID, enabled: true }])
  const reserveIndex = executed.events.indexOf("operation:reserve")
  const pendingIndex = executed.events.indexOf("activity:pending")
  const writeIndex = executed.events.indexOf(`write:widget-settings:${AUDIT_REASON}`)
  assert.equal(reserveIndex >= 0 && reserveIndex < pendingIndex && pendingIndex < writeIndex, true)
  assert.equal(executed.operationStore.lastReceipt?.status, "completed")
  assert.equal(executed.operationStore.lastReceipt?.verification, "match")
  const persisted = JSON.stringify({
    activities: executed.activities,
    receipt: executed.operationStore.lastReceipt,
  })
  assert.equal(persisted.includes(AUDIT_REASON), false)
  assert.equal(persisted.includes(CHANNEL_ID), false)
})

test("widget-settings execution reports valid drift and spends the key", async () => {
  const drifted = fixture({
    state: { mutationUpdatesState: false, responseDrift: true },
  })
  const desired = request()
  const plan = await drifted.service.plan(APPLICATION_ID, BOT_ID, desired)
  const result = await drifted.service.execute(
    APPLICATION_ID,
    BOT_ID,
    desired,
    plan.digest,
  )

  assert.equal(result.status, "completed-with-drift")
  assert.equal(result.verification, "drift")
  assert.equal(drifted.operationStore.lastReceipt?.verification, "drift")
  await assert.rejects(
    () => drifted.service.plan(APPLICATION_ID, BOT_ID, desired),
    WidgetSettingsOperationConflictError,
  )
})

test("widget-settings execution rejects stale plans and blocks when pending activity fails", async () => {
  const stale = fixture()
  const desired = request()
  const plan = await stale.service.plan(APPLICATION_ID, BOT_ID, desired)
  stale.state.settings = settings(false, SECOND_CHANNEL_ID)
  await assert.rejects(
    () => stale.service.execute(APPLICATION_ID, BOT_ID, desired, plan.digest),
    WidgetSettingsPlanChangedError,
  )
  assert.equal(stale.writes.length, 0)

  const blocked = fixture({ state: { activityFailureAt: 1 } })
  const blockedPlan = await blocked.service.plan(APPLICATION_ID, BOT_ID, desired)
  await assert.rejects(
    () => blocked.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      blockedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status === "blocked-audit-failed"
    ),
  )
  assert.equal(blocked.writes.length, 0)
  assert.equal(blocked.operationStore.lastReceipt?.status, "failed")
})

test("widget-settings treats failed authenticated readback as uncertain and quarantines the guild", async () => {
  const unreadable = fixture({
    guildId: READBACK_GUILD_ID,
    state: { readbackError: new Error("readback unavailable") },
  })
  const desired = request({
    guildId: READBACK_GUILD_ID,
    operationKey: "widget-settings-readback-0001",
  })
  const plan = await unreadable.service.plan(APPLICATION_ID, BOT_ID, desired)
  await assert.rejects(
    () => unreadable.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal(unreadable.writes.length, 1)
  assert.equal(unreadable.operationStore.lastReceipt?.status, "uncertain")

  unreadable.state.readbackError = undefined
  const next = request({
    guildId: READBACK_GUILD_ID,
    operationKey: "widget-settings-readback-next-0001",
  })
  const nextPlan = await unreadable.service.plan(APPLICATION_ID, BOT_ID, next)
  unreadable.events.length = 0
  await assert.rejects(
    () => unreadable.service.execute(
      APPLICATION_ID,
      BOT_ID,
      next,
      nextPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.deepEqual(unreadable.events, [])
})

test("widget-settings quarantines a completed write whose durable receipt cannot finalize", async () => {
  const finalization = fixture({ guildId: FINALIZATION_GUILD_ID })
  const desired = request({
    guildId: FINALIZATION_GUILD_ID,
    operationKey: "widget-settings-finalization-0001",
  })
  const plan = await finalization.service.plan(APPLICATION_ID, BOT_ID, desired)
  finalization.operationStore.finishFailure = new Error("receipt unavailable")
  await assert.rejects(
    () => finalization.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status
        === "completed-operation-record-failed"
    ),
  )
  assert.equal(finalization.writes.length, 1)
  assert.equal(
    finalization.activities.at(-1)?.status,
    "uncertain",
  )

  const next = request({
    guildId: FINALIZATION_GUILD_ID,
    operationKey: "widget-settings-finalization-next-0001",
  })
  const nextPlan = await finalization.service.plan(APPLICATION_ID, BOT_ID, next)
  finalization.events.length = 0
  await assert.rejects(
    () => finalization.service.execute(
      APPLICATION_ID,
      BOT_ID,
      next,
      nextPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.deepEqual(finalization.events, [])
})

test("widget-settings treats an unsafe authenticated readback as uncertain", async () => {
  const unsafeReadback = fixture({
    guildId: UNSAFE_READBACK_GUILD_ID,
    state: {
      readbackChannels: [
        channel(CHANNEL_ID, {
          guildId: UNSAFE_READBACK_GUILD_ID,
          overwrites: [{
            allow: "0",
            deny: DISCORD_PERMISSIONS.VIEW_CHANNEL.toString(),
            id: UNSAFE_READBACK_GUILD_ID,
            type: 0,
          }],
        }),
        channel(SECOND_CHANNEL_ID, { guildId: UNSAFE_READBACK_GUILD_ID }),
      ],
    },
  })
  const desired = request({
    guildId: UNSAFE_READBACK_GUILD_ID,
    operationKey: "widget-settings-unsafe-readback-0001",
  })
  const plan = await unsafeReadback.service.plan(APPLICATION_ID, BOT_ID, desired)
  await assert.rejects(
    () => unsafeReadback.service.execute(
      APPLICATION_ID,
      BOT_ID,
      desired,
      plan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal(unsafeReadback.operationStore.lastReceipt?.status, "uncertain")
  assert.equal(unsafeReadback.writes.length, 1)
})

test("widget-settings separates known refusal from malformed success and quarantines the guild", async () => {
  const rejected = fixture({ state: { mutationError: apiError(403) } })
  const rejectedRequest = request({ operationKey: "widget-settings-rejected-0001" })
  const rejectedPlan = await rejected.service.plan(
    APPLICATION_ID,
    BOT_ID,
    rejectedRequest,
  )
  await assert.rejects(
    () => rejected.service.execute(
      APPLICATION_ID,
      BOT_ID,
      rejectedRequest,
      rejectedPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status === "failed"
    ),
  )

  const uncertain = fixture({ state: { responseUnknown: true } })
  const uncertainRequest = request({ operationKey: "widget-settings-uncertain-0001" })
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status === "uncertain"
    ),
  )
  assert.equal(uncertain.operationStore.lastReceipt?.status, "uncertain")

  uncertain.state.mutationError = undefined
  const nextRequest = request({ operationKey: "widget-settings-after-uncertain-0001" })
  const nextPlan = await uncertain.service.plan(APPLICATION_ID, BOT_ID, nextRequest)
  uncertain.events.length = 0
  await assert.rejects(
    () => uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      nextRequest,
      nextPlan.digest,
    ),
    (error: unknown) => (
      error instanceof WidgetSettingsExecutionError
      && (error.result as { status?: string }).status === "blocked-prior-uncertain"
    ),
  )
  assert.deepEqual(uncertain.events, [])
})
