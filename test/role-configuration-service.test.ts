import assert from "node:assert/strict"
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import type {
  ActivityEntry,
  ActivityList,
  ActivityStore,
} from "../src/activity-log.js"
import type {
  DiscordGuildRoleMemberCounts,
  ModifyGuildRoleInput,
} from "../src/discord-client.js"
import {
  DiscordApiError,
  RoleConfigurationEvidenceError,
  RoleConfigurationExecutionError,
  RoleConfigurationPlanChangedError,
} from "../src/errors.js"
import type {
  OperationKind,
  OperationReceipt,
  OperationReservation,
  OperationStore,
} from "../src/operation-store.js"
import { DISCORD_PERMISSIONS } from "../src/permissions.js"
import { ScopePolicy } from "../src/policy.js"
import {
  normalizeRoleConfigurationRequest,
  RoleConfigurationService,
  ROLE_HOLOGRAPHIC_COLORS,
  type RoleConfigurationRequest,
  type RoleConfigurationServiceClient,
} from "../src/role-configuration-service.js"
import type {
  DiscordGuild,
  DiscordGuildMember,
  DiscordRole,
} from "../src/types.js"

const APPLICATION_ID = "510000000000000001"
const BOT_ID = "520000000000000001"
const GUILD_ID = "530000000000000001"
const OWNER_ID = "530000000000000002"
const BOT_ROLE_ID = "540000000000000001"
const TARGET_ROLE_ID = "550000000000000001"
const OTHER_ROLE_ID = "550000000000000002"
const UNCERTAIN_ROLE_ID = "550000000000000003"
const OPERATION_KEY = "role-configuration-op-001"
const PLAN_KEY = new Uint8Array(32).fill(12)
const ROLE_ICON_HASH = "reviewed-role-icon-hash"
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    u32(data.byteLength),
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ])
}

function roleIconPng(marker = 0): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(64, 0)
  ihdr.writeUInt32BE(64, 4)
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Buffer.from([marker])),
    pngChunk("IEND"),
  ])
}

function role(
  id: string,
  name: string,
  permissions: bigint,
  position: number,
  overrides: Partial<DiscordRole> = {},
): DiscordRole {
  return {
    color: 0,
    colors: {
      primary_color: 0,
      secondary_color: null,
      tertiary_color: null,
    },
    flags: 0,
    hoist: false,
    icon: null,
    id,
    managed: false,
    mentionable: false,
    name,
    permissions: permissions.toString(),
    position,
    unicode_emoji: null,
    ...overrides,
  }
}

function cloneRole(value: DiscordRole): DiscordRole {
  return structuredClone(value)
}

class MemoryActivityStore implements ActivityStore {
  readonly entries: ActivityEntry[] = []
  failAt: number | null = null
  calls = 0

  async append(entry: ActivityEntry): Promise<void> {
    this.calls += 1
    if (this.failAt === this.calls) throw new Error("activity unavailable")
    this.entries.push(structuredClone(entry))
  }

  async list(): Promise<ActivityList> {
    return {
      entries: structuredClone(this.entries),
      file: "/private/activity.jsonl",
      skippedLines: 0,
    }
  }
}

class MemoryOperationStore implements OperationStore {
  readonly receipts = new Map<string, OperationReceipt>()
  failFinish = false
  finishCalls = 0
  reserveCalls = 0

  #key(kind: OperationKind, hash: string): string {
    return `${kind}:${hash}`
  }

  async finish(receipt: OperationReceipt): Promise<void> {
    this.finishCalls += 1
    if (this.failFinish) throw new Error("operation receipt unavailable")
    this.receipts.set(this.#key(receipt.kind, receipt.operationKeyHash), structuredClone(receipt))
  }

  async get(
    kind: OperationKind,
    operationKeyHash: string,
  ): Promise<OperationReceipt | undefined> {
    const value = this.receipts.get(this.#key(kind, operationKeyHash))
    return value ? structuredClone(value) : undefined
  }

  async reserve(receipt: OperationReceipt): Promise<OperationReservation> {
    this.reserveCalls += 1
    const key = this.#key(receipt.kind, receipt.operationKeyHash)
    const existing = this.receipts.get(key)
    if (existing) return { created: false, receipt: structuredClone(existing) }
    this.receipts.set(key, structuredClone(receipt))
    return { created: true, receipt: structuredClone(receipt) }
  }
}

class FixtureClient implements RoleConfigurationServiceClient {
  counts: Record<string, number>
  exactReadbackDrift = false
  guild: DiscordGuild
  member: DiscordGuildMember
  modifyError: unknown
  modifyGate: Promise<void> | null = null
  modifyStarted: (() => void) | null = null
  patchCalls: Array<{
    auditReason: string
    guildId: string
    input: ModifyGuildRoleInput
    roleId: string
  }> = []
  responseDrift = false
  roles: DiscordRole[]

  constructor(targetId = TARGET_ROLE_ID) {
    const botPermissions = DISCORD_PERMISSIONS.MANAGE_ROLES
      | DISCORD_PERMISSIONS.VIEW_CHANNEL
      | DISCORD_PERMISSIONS.SEND_MESSAGES
      | DISCORD_PERMISSIONS.BAN_MEMBERS
    this.roles = [
      role(GUILD_ID, "@everyone", 0n, 0),
      role(BOT_ROLE_ID, "connector", botPermissions, 10, {
        managed: true,
        tags: { bot_id: BOT_ID },
      }),
      role(targetId, "Support", DISCORD_PERMISSIONS.VIEW_CHANNEL, 2),
      role(OTHER_ROLE_ID, "Helpers", DISCORD_PERMISSIONS.VIEW_CHANNEL, 1),
    ]
    this.counts = {
      [BOT_ROLE_ID]: 1,
      [targetId]: 3,
      [OTHER_ROLE_ID]: 2,
    }
    this.guild = {
      features: [],
      id: GUILD_ID,
      name: "Private guild name",
      owner_id: OWNER_ID,
    }
    this.member = {
      roles: [BOT_ROLE_ID],
      user: { bot: true, id: BOT_ID, username: "connector" },
    }
  }

  async getGuild() {
    return structuredClone(this.guild)
  }

  async getGuildMember() {
    return structuredClone(this.member)
  }

  async getGuildRole(_guildId: string, roleId: string) {
    const target = this.roles.find((entry) => entry.id === roleId)
    assert.ok(target)
    const result = cloneRole(target)
    if (this.exactReadbackDrift) result.hoist = !result.hoist
    return result
  }

  async getGuildRoleMemberCounts(): Promise<DiscordGuildRoleMemberCounts> {
    return structuredClone(this.counts)
  }

  async getGuildRoles() {
    return structuredClone(this.roles)
  }

  async modifyGuildRole(
    guildId: string,
    roleId: string,
    input: ModifyGuildRoleInput,
    auditReason: string,
  ) {
    this.patchCalls.push({
      auditReason,
      guildId,
      input: structuredClone(input),
      roleId,
    })
    this.modifyStarted?.()
    if (this.modifyGate) await this.modifyGate
    if (this.modifyError) throw this.modifyError
    const index = this.roles.findIndex((entry) => entry.id === roleId)
    assert.notEqual(index, -1)
    const current = this.roles[index] as DiscordRole
    const updated: DiscordRole = {
      ...current,
      ...(input.colors
        ? {
            color: input.colors.primaryColor,
            colors: {
              primary_color: input.colors.primaryColor,
              secondary_color: input.colors.secondaryColor,
              tertiary_color: input.colors.tertiaryColor,
            },
          }
        : {}),
      ...(input.hoist !== undefined ? { hoist: input.hoist } : {}),
      ...(input.mentionable !== undefined ? { mentionable: input.mentionable } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
      ...(input.roleIcon?.kind === "clear"
        ? { icon: null, unicode_emoji: null }
        : input.roleIcon?.kind === "unicode"
          ? { icon: null, unicode_emoji: input.roleIcon.value }
          : input.roleIcon?.kind === "image"
            ? { icon: ROLE_ICON_HASH, unicode_emoji: null }
            : {}),
    }
    this.roles[index] = updated
    const response = cloneRole(updated)
    if (this.responseDrift) response.position += 1
    return response
  }
}

function policy(roleId = TARGET_ROLE_ID, enabled = true) {
  return new ScopePolicy({
    adminGuildIds: new Set<string>(),
    allowedChannelIds: new Set<string>(),
    allowedGuildIds: new Set([GUILD_ID]),
    allowAdministration: false,
    allowDeletions: false,
    allowInteractions: false,
    allowRoleConfiguration: enabled,
    deleteChannelIds: new Set<string>(),
    interactionChannelIds: new Set<string>(),
    interactionMaxWritesPerMinute: 10,
    interactionMinWriteIntervalMs: 500,
    mentionUserIds: new Set<string>(),
    protectedUserIds: new Set<string>(),
    roleConfigurationIds: new Set([roleId]),
  })
}

type RequestOverrides = {
  [Key in keyof RoleConfigurationRequest]?: RoleConfigurationRequest[Key] | undefined
}

function request(overrides: RequestOverrides = {}): RoleConfigurationRequest {
  const value: Record<string, unknown> = {
    auditReason: "Reviewed role configuration",
    grantPermissions: ["SEND_MESSAGES"],
    guildId: GUILD_ID,
    name: "Member Support",
    operationKey: OPERATION_KEY,
    roleId: TARGET_ROLE_ID,
    ...overrides,
  }
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) delete value[key]
  }
  return value as unknown as RoleConfigurationRequest
}

function fixture(options: {
  client?: FixtureClient
  fileRoots?: readonly string[]
  policy?: ScopePolicy
} = {}) {
  const activityStore = new MemoryActivityStore()
  const client = options.client || new FixtureClient()
  const operationStore = new MemoryOperationStore()
  const service = new RoleConfigurationService({
    activityStore,
    client,
    clock: () => new Date("2026-08-21T18:00:00.000Z"),
    fileRoots: options.fileRoots || [],
    operationStore,
    planKey: PLAN_KEY,
    policy: options.policy || policy(),
    randomId: () => "activity-role-configuration-001",
  })
  return { activityStore, client, operationStore, service }
}

function executionResult(error: unknown): Record<string, unknown> {
  assert.ok(error instanceof RoleConfigurationExecutionError)
  assert.ok(error.result && typeof error.result === "object")
  return error.result as Record<string, unknown>
}

test("role configuration normalization preserves explicit fields and canonical named deltas", () => {
  const normalized = normalizeRoleConfigurationRequest({
    auditReason: "Reviewed",
    grantPermissions: ["SEND_MESSAGES", "VIEW_CHANNEL"],
    guildId: GUILD_ID,
    hoist: false,
    operationKey: OPERATION_KEY,
    revokePermissions: ["BAN_MEMBERS"],
    roleId: TARGET_ROLE_ID,
    secondaryColor: null,
  })

  assert.deepEqual(normalized.requestedFields, [
    "grantPermissions",
    "hoist",
    "revokePermissions",
    "secondaryColor",
  ])
  assert.deepEqual(normalized.grantPermissions, ["VIEW_CHANNEL", "SEND_MESSAGES"])
  assert.deepEqual(normalized.revokePermissions, ["BAN_MEMBERS"])
  assert.equal(normalized.secondaryColor, null)
  assert.match(normalized.operationKeyHash, /^sha256:[a-f0-9]{64}$/)

  const exact = normalizeRoleConfigurationRequest({
    auditReason: "Reviewed",
    guildId: GUILD_ID,
    operationKey: OPERATION_KEY,
    permissions: [],
    roleId: TARGET_ROLE_ID,
  })
  assert.deepEqual(exact.requestedFields, ["permissions"])
  assert.deepEqual(exact.permissions, [])
})

test("role configuration normalization rejects ambiguous, empty, and dangerous input", () => {
  assert.throws(
    () => normalizeRoleConfigurationRequest({
      auditReason: "Reviewed",
      guildId: GUILD_ID,
      operationKey: OPERATION_KEY,
      roleId: TARGET_ROLE_ID,
    }),
    /at least one explicit field/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest({
      ...request(),
      name: undefined,
    } as unknown as RoleConfigurationRequest),
    /cannot be undefined/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({ grantPermissions: [] })),
    /at least one permission/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({
      grantPermissions: ["SEND_MESSAGES"],
      revokePermissions: ["SEND_MESSAGES"],
    })),
    /cannot be granted and revoked together/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({ grantPermissions: ["ADMINISTRATOR"] })),
    /never grants ADMINISTRATOR/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({
      grantPermissions: undefined,
      name: undefined,
      permissions: ["ADMINISTRATOR"],
    })),
    /never sets ADMINISTRATOR/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({
      permissions: ["VIEW_CHANNEL"],
    })),
    /cannot be combined with permission grants/u,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({ name: "@everyone" })),
    /invalid or reserved/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({
      grantPermissions: undefined,
      name: undefined,
      roleIcon: { kind: "unicode", value: "not-an-emoji" },
    })),
    /one NFC emoji grapheme/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({
      grantPermissions: undefined,
      name: undefined,
      roleIcon: {
        kind: "clear",
        value: "unexpected",
      } as unknown as RoleConfigurationRequest["roleIcon"],
    })),
    /intent is invalid/,
  )
  assert.throws(
    () => normalizeRoleConfigurationRequest(request({
      grantPermissions: undefined,
      name: undefined,
      roleIcon: {
        filePath: `/${"x".repeat(4_096)}`,
        kind: "local-image",
      },
    })),
    /intent is invalid/,
  )
})

test("role configuration planning binds complete hierarchy, holder, and permission evidence", async () => {
  const { service } = fixture()

  const plan = await service.plan(APPLICATION_ID, BOT_ID, request())

  assert.equal(plan.status, "planned")
  assert.equal(plan.memberCount, 3)
  assert.deepEqual(plan.changedFields, ["name", "permissions"])
  assert.deepEqual(plan.grantedPermissions, ["SEND_MESSAGES"])
  assert.deepEqual(plan.revokedPermissions, [])
  assert.equal(plan.current.colors.primaryColor, 0)
  assert.equal(plan.desired.name, "Member Support")
  assert.deepEqual(plan.desired.permissionNames, ["VIEW_CHANNEL", "SEND_MESSAGES"])
  assert.equal(plan.permission.guildManageRoles, true)
  assert.equal(plan.permission.permissionChangeRequired, true)
  assert.equal(plan.permission.desiredPermissionSubset, true)
  assert.equal(plan.permission.targetBelowBot, true)
  assert.equal(plan.permission.botHighestRolePosition, 10)
  assert.match(plan.digest, /^hmac-sha256:[a-f0-9]{64}$/)
  assert.match(plan.warnings.join("\n"), /held by 3 guild members/)
})

test("role configuration enforces modern gradient and holographic color contracts", async () => {
  const basic = fixture()
  await assert.rejects(
    basic.service.plan(APPLICATION_ID, BOT_ID, request({
      grantPermissions: undefined,
      name: undefined,
      primaryColor: 1,
      secondaryColor: 2,
    })),
    /ENHANCED_ROLE_COLORS/,
  )

  const enhancedClient = new FixtureClient()
  enhancedClient.guild.features = ["ENHANCED_ROLE_COLORS"]
  const enhanced = fixture({ client: enhancedClient })
  await assert.rejects(
    enhanced.service.plan(APPLICATION_ID, BOT_ID, request({
      grantPermissions: undefined,
      name: undefined,
      primaryColor: 1,
      secondaryColor: 2,
      tertiaryColor: 3,
    })),
    /holographic color triple/,
  )
  const plan = await enhanced.service.plan(APPLICATION_ID, BOT_ID, request({
    grantPermissions: undefined,
    name: undefined,
    ...ROLE_HOLOGRAPHIC_COLORS,
  }))
  assert.deepEqual(plan.desired.colors, ROLE_HOLOGRAPHIC_COLORS)
})

test("role configuration binds reviewed local icon bytes and response-assigned hash", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-role-config-icon-"))
  const root = await realpath(temporary)
  const filePath = join(root, "icon.png")
  try {
    await writeFile(filePath, roleIconPng())
    const client = new FixtureClient()
    client.guild.features = ["ROLE_ICONS"]
    const target = fixture({ client, fileRoots: [root] })
    const selected = request({
      grantPermissions: undefined,
      name: undefined,
      roleIcon: { filePath, kind: "local-image" },
    })
    const plan = await target.service.plan(APPLICATION_ID, BOT_ID, selected)

    assert.deepEqual(plan.changedFields, ["roleIcon"])
    assert.deepEqual(plan.currentRoleIcon, { kind: "none" })
    assert.equal(plan.desiredRoleIcon.kind, "local-image")
    assert.equal(plan.roleIconFile?.review.canonicalPath, filePath)
    assert.equal(plan.verificationMode, "response-bound-image-hash")

    const result = await target.service.execute(
      APPLICATION_ID,
      BOT_ID,
      selected,
      plan.digest,
    )
    assert.equal(result.status, "completed")
    assert.equal(result.observed.icon, ROLE_ICON_HASH)
    assert.equal(result.observed.unicodeEmoji, null)
    const iconInput = target.client.patchCalls[0]?.input.roleIcon
    assert.equal(iconInput?.kind, "image")
    if (iconInput?.kind === "image") {
      assert.equal(iconInput.format, "png")
      assert.deepEqual(Buffer.from(iconInput.bytes), roleIconPng())
    }
    const persisted = JSON.stringify({
      activities: target.activityStore.entries,
      receipts: [...target.operationStore.receipts.values()],
    })
    assert.doesNotMatch(
      persisted,
      /canonicalPath|contentDigest|icon\.png|reviewed-role-icon-hash/,
    )

    const staleClient = new FixtureClient()
    staleClient.guild.features = ["ROLE_ICONS"]
    const stale = fixture({ client: staleClient, fileRoots: [root] })
    const stalePlan = await stale.service.plan(APPLICATION_ID, BOT_ID, selected)
    await writeFile(filePath, roleIconPng(1))
    await assert.rejects(
      stale.service.execute(APPLICATION_ID, BOT_ID, selected, stalePlan.digest),
      RoleConfigurationPlanChangedError,
    )
    assert.equal(staleClient.patchCalls.length, 0)

    const driftClient = new FixtureClient()
    driftClient.guild.features = ["ROLE_ICONS"]
    const originalModify = driftClient.modifyGuildRole.bind(driftClient)
    driftClient.modifyGuildRole = async (...args) => {
      const response = await originalModify(...args)
      const changed = driftClient.roles.find(
        (entry) => entry.id === TARGET_ROLE_ID,
      ) as DiscordRole
      changed.icon = "different-readback-hash"
      return response
    }
    const drift = fixture({ client: driftClient, fileRoots: [root] })
    const driftPlan = await drift.service.plan(APPLICATION_ID, BOT_ID, selected)
    const driftResult = await drift.service.execute(
      APPLICATION_ID,
      BOT_ID,
      selected,
      driftPlan.digest,
    )
    assert.equal(driftResult.status, "completed-with-drift")
    assert.equal(driftResult.responseMatched, true)
    assert.equal(driftResult.readbackMatched, false)
    assert.equal(driftResult.inventoryMatched, false)
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
})

test("role configuration supports exact Unicode and clear icon intents", async () => {
  const unicodeClient = new FixtureClient()
  unicodeClient.guild.features = ["ROLE_ICONS"]
  const unicode = fixture({ client: unicodeClient })
  const unicodeRequest = request({
    grantPermissions: undefined,
    name: undefined,
    roleIcon: { kind: "unicode", value: "🩵" },
  })
  const unicodePlan = await unicode.service.plan(
    APPLICATION_ID,
    BOT_ID,
    unicodeRequest,
  )
  const unicodeResult = await unicode.service.execute(
    APPLICATION_ID,
    BOT_ID,
    unicodeRequest,
    unicodePlan.digest,
  )
  assert.equal(unicodeResult.status, "completed")
  assert.deepEqual(unicodeClient.patchCalls[0]?.input.roleIcon, {
    kind: "unicode",
    value: "🩵",
  })

  const clearClient = new FixtureClient()
  const clearRole = clearClient.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole
  clearRole.unicode_emoji = "🩵"
  const clear = fixture({ client: clearClient })
  const clearRequest = request({
    grantPermissions: undefined,
    name: undefined,
    operationKey: "role-icon-clear-001",
    roleIcon: { kind: "clear" },
  })
  const clearPlan = await clear.service.plan(APPLICATION_ID, BOT_ID, clearRequest)
  assert.deepEqual(clearPlan.currentRoleIcon, { kind: "unicode", value: "🩵" })
  assert.deepEqual(clearPlan.desiredRoleIcon, { kind: "none" })
  const clearResult = await clear.service.execute(
    APPLICATION_ID,
    BOT_ID,
    clearRequest,
    clearPlan.digest,
  )
  assert.equal(clearResult.status, "completed")
  assert.deepEqual(clearClient.patchCalls[0]?.input.roleIcon, { kind: "clear" })

  await assert.rejects(
    fixture().service.plan(APPLICATION_ID, BOT_ID, unicodeRequest),
    /ROLE_ICONS guild feature/,
  )
})

test("role configuration fails closed on scope, management, hierarchy, and future evidence", async () => {
  const disabled = fixture({ policy: policy(TARGET_ROLE_ID, false) })
  await assert.rejects(
    disabled.service.plan(APPLICATION_ID, BOT_ID, request()),
    /disabled/,
  )

  const managedClient = new FixtureClient()
  const target = managedClient.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole
  target.managed = true
  target.tags = { integration_id: "560000000000000001" }
  await assert.rejects(
    fixture({ client: managedClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /standard unmanaged roles/,
  )

  const hierarchyClient = new FixtureClient()
  ;(hierarchyClient.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole).position = 10
  await assert.rejects(
    fixture({ client: hierarchyClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /strictly above/,
  )

  const unknownClient = new FixtureClient()
  Object.assign(
    unknownClient.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole,
    { future_field: true },
  )
  await assert.rejects(
    fixture({ client: unknownClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    /unknown target fields/,
  )

  const malformedCountsClient = new FixtureClient()
  malformedCountsClient.counts = { invalid: 1 }
  await assert.rejects(
    fixture({ client: malformedCountsClient }).service.plan(APPLICATION_ID, BOT_ID, request()),
    RoleConfigurationEvidenceError,
  )
})

test("role permission changes preserve unrelated bits and enforce grantability and future bits", async () => {
  const client = new FixtureClient()
  const target = client.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole
  target.permissions = (
    DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.BAN_MEMBERS
  ).toString()
  const plan = await fixture({ client }).service.plan(APPLICATION_ID, BOT_ID, request({
    grantPermissions: ["SEND_MESSAGES"],
    name: undefined,
    revokePermissions: ["BAN_MEMBERS"],
  }))
  assert.deepEqual(plan.desired.permissionNames, ["VIEW_CHANNEL", "SEND_MESSAGES"])
  assert.deepEqual(plan.highRiskRevokedPermissions, ["BAN_MEMBERS"])
  assert.deepEqual(plan.revokedPermissions, ["BAN_MEMBERS"])

  const unavailableClient = new FixtureClient()
  await assert.rejects(
    fixture({ client: unavailableClient }).service.plan(APPLICATION_ID, BOT_ID, request({
      grantPermissions: ["MANAGE_GUILD"],
      name: undefined,
    })),
    /cannot grant the complete desired/,
  )

  const futureClient = new FixtureClient()
  ;(futureClient.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole).permissions = (
    DISCORD_PERMISSIONS.VIEW_CHANNEL | (1n << 60n)
  ).toString()
  await assert.rejects(
    fixture({ client: futureClient }).service.plan(APPLICATION_ID, BOT_ID, request({
      grantPermissions: ["SEND_MESSAGES"],
      name: undefined,
    })),
    /unknown permission bits/,
  )

  const exactFutureClient = new FixtureClient()
  const futureBit = 1n << 60n
  ;(exactFutureClient.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole)
    .permissions = (DISCORD_PERMISSIONS.VIEW_CHANNEL | futureBit).toString()
  const exactFuturePlan = await fixture({ client: exactFutureClient }).service.plan(
    APPLICATION_ID,
    BOT_ID,
    request({
      grantPermissions: undefined,
      name: undefined,
      permissions: ["VIEW_CHANNEL", "SEND_MESSAGES"],
    }),
  )
  assert.equal(
    exactFuturePlan.desired.permissions,
    (DISCORD_PERMISSIONS.VIEW_CHANNEL
      | DISCORD_PERMISSIONS.SEND_MESSAGES
      | futureBit).toString(),
  )
  assert.equal(exactFuturePlan.desired.unknownPermissionBits, futureBit.toString())
  assert.deepEqual(exactFuturePlan.requestedPermissions, [
    "VIEW_CHANNEL",
    "SEND_MESSAGES",
  ])

  const metadataClient = new FixtureClient()
  ;(metadataClient.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole).permissions = (
    DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.MANAGE_GUILD
  ).toString()
  const metadata = fixture({ client: metadataClient })
  const metadataRequest = request({
    grantPermissions: undefined,
    name: "Escalation Support",
  })
  const metadataPlan = await metadata.service.plan(
    APPLICATION_ID,
    BOT_ID,
    metadataRequest,
  )
  assert.equal(metadataPlan.permission.permissionChangeRequired, false)
  assert.equal(metadataPlan.permission.desiredPermissionSubset, false)
  assert.deepEqual(metadataPlan.changedFields, ["name"])
  await metadata.service.execute(
    APPLICATION_ID,
    BOT_ID,
    metadataRequest,
    metadataPlan.digest,
  )
  assert.deepEqual(metadataClient.patchCalls[0]?.input, { name: "Escalation Support" })
})

test("role configuration no-op skips approval-side state and mutation", async () => {
  const { activityStore, client, operationStore, service } = fixture()
  const plan = await service.plan(APPLICATION_ID, BOT_ID, request({
    grantPermissions: ["VIEW_CHANNEL"],
    name: "Support",
  }))

  assert.equal(plan.status, "already-current")
  const result = await service.execute(APPLICATION_ID, BOT_ID, request({
    grantPermissions: ["VIEW_CHANNEL"],
    name: "Support",
  }), plan.digest)

  assert.equal(result.status, "already-current")
  assert.equal(result.activityId, null)
  assert.equal(client.patchCalls.length, 0)
  assert.equal(operationStore.reserveCalls, 0)
  assert.equal(activityStore.entries.length, 0)
})

test("role configuration reserves, audits, patches only changed fields, and verifies all readbacks", async () => {
  const { activityStore, client, operationStore, service } = fixture()
  const selected = request({
    grantPermissions: ["SEND_MESSAGES"],
    hoist: true,
    name: undefined,
  })
  const plan = await service.plan(APPLICATION_ID, BOT_ID, selected)
  const result = await service.execute(APPLICATION_ID, BOT_ID, selected, plan.digest)

  assert.equal(result.status, "completed")
  assert.equal(result.verification, "match")
  assert.deepEqual(client.patchCalls[0], {
    auditReason: "Reviewed role configuration",
    guildId: GUILD_ID,
    input: {
      hoist: true,
      permissions: (
        DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.SEND_MESSAGES
      ).toString(),
    },
    roleId: TARGET_ROLE_ID,
  })
  assert.deepEqual(
    activityStore.entries.map((entry) => ({
      kind: entry.kind,
      status: entry.status,
      text: JSON.stringify(entry),
    })),
    [
      {
        kind: "role-configuration",
        status: "pending",
        text: JSON.stringify(activityStore.entries[0]),
      },
      {
        kind: "role-configuration",
        status: "completed",
        text: JSON.stringify(activityStore.entries[1]),
      },
    ],
  )
  const persisted = JSON.stringify({
    activities: activityStore.entries,
    receipts: [...operationStore.receipts.values()],
  })
  assert.doesNotMatch(persisted, /Member Support|Reviewed role configuration|SEND_MESSAGES/)
})

test("role configuration rejects stale plans and spent keys", async () => {
  const target = fixture()
  const selected = request({ name: "New Support", grantPermissions: undefined })
  const plan = await target.service.plan(APPLICATION_ID, BOT_ID, selected)
  ;(target.client.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole).name = "Drift"

  await assert.rejects(
    target.service.execute(APPLICATION_ID, BOT_ID, selected, plan.digest),
    RoleConfigurationPlanChangedError,
  )

  const spent = fixture()
  const spentPlan = await spent.service.plan(APPLICATION_ID, BOT_ID, selected)
  await spent.service.execute(APPLICATION_ID, BOT_ID, selected, spentPlan.digest)
  await assert.rejects(
    spent.service.plan(APPLICATION_ID, BOT_ID, selected),
    /already been reserved/,
  )
  const converged = await spent.service.reconcilePlan(
    APPLICATION_ID,
    BOT_ID,
    selected,
  )
  assert.equal(converged.writeRequired, false)
  ;(spent.client.roles.find((entry) => entry.id === TARGET_ROLE_ID) as DiscordRole).name
    = "Later drift"
  await assert.rejects(
    spent.service.reconcilePlan(APPLICATION_ID, BOT_ID, selected),
    /already been reserved/,
  )
})

test("role configuration reports valid response, inventory, exact-read, and count drift", async () => {
  const responseTarget = fixture()
  responseTarget.client.responseDrift = true
  const responsePlan = await responseTarget.service.plan(APPLICATION_ID, BOT_ID, request())
  const responseResult = await responseTarget.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    responsePlan.digest,
  )
  assert.equal(responseResult.status, "completed-with-drift")
  assert.equal(responseResult.responseMatched, false)

  const countTarget = fixture()
  const countPlan = await countTarget.service.plan(APPLICATION_ID, BOT_ID, request())
  const originalModify = countTarget.client.modifyGuildRole.bind(countTarget.client)
  countTarget.client.modifyGuildRole = async (...args) => {
    const result = await originalModify(...args)
    countTarget.client.counts[TARGET_ROLE_ID] = 4
    return result
  }
  const countResult = await countTarget.service.execute(
    APPLICATION_ID,
    BOT_ID,
    request(),
    countPlan.digest,
  )
  assert.equal(countResult.status, "completed-with-drift")
  assert.equal(countResult.memberCountsMatched, false)
  assert.equal(countResult.memberCount, 4)
})

test("role configuration blocks pending-audit failure and surfaces completed record failures", async () => {
  const blocked = fixture()
  blocked.activityStore.failAt = 1
  const blockedPlan = await blocked.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    blocked.service.execute(APPLICATION_ID, BOT_ID, request(), blockedPlan.digest),
    (error) => executionResult(error).status === "blocked-audit-failed",
  )
  assert.equal(blocked.client.patchCalls.length, 0)

  const completed = fixture()
  completed.operationStore.failFinish = true
  const completedPlan = await completed.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    completed.service.execute(APPLICATION_ID, BOT_ID, request(), completedPlan.digest),
    (error) => executionResult(error).status === "completed-operation-record-failed",
  )
  assert.equal(completed.client.patchCalls.length, 1)
})

test("role configuration serializes same-role writes", async () => {
  const target = fixture()
  let release: (() => void) | undefined
  target.client.modifyGate = new Promise<void>((resolve) => {
    release = resolve
  })
  let started: (() => void) | undefined
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve
  })
  target.client.modifyStarted = started ?? null
  const firstRequest = request({ operationKey: "role-lock-first-001", name: "First" })
  const secondRequest = request({ operationKey: "role-lock-second-001", name: "Second" })
  const firstPlan = await target.service.plan(APPLICATION_ID, BOT_ID, firstRequest)
  const secondPlan = await target.service.plan(APPLICATION_ID, BOT_ID, secondRequest)
  const first = target.service.execute(APPLICATION_ID, BOT_ID, firstRequest, firstPlan.digest)
  await startedPromise
  const second = target.service.execute(APPLICATION_ID, BOT_ID, secondRequest, secondPlan.digest)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(target.client.patchCalls.length, 1)
  release?.()
  await first
  await assert.rejects(second, RoleConfigurationPlanChangedError)
})

test("role configuration distinguishes known refusal from uncertainty and blocks a poisoned target", async () => {
  const knownClient = new FixtureClient()
  const known = fixture({ client: knownClient })
  knownClient.modifyError = new DiscordApiError({
    code: 50_013,
    message: "refused",
    method: "PATCH",
    route: `/guilds/${GUILD_ID}/roles/${TARGET_ROLE_ID}`,
    status: 403,
  })
  const knownPlan = await known.service.plan(APPLICATION_ID, BOT_ID, request())
  await assert.rejects(
    known.service.execute(APPLICATION_ID, BOT_ID, request(), knownPlan.digest),
    (error) => executionResult(error).status === "failed",
  )

  const uncertainClient = new FixtureClient(UNCERTAIN_ROLE_ID)
  const uncertainPolicy = policy(UNCERTAIN_ROLE_ID)
  const uncertain = fixture({ client: uncertainClient, policy: uncertainPolicy })
  const uncertainRequest = request({
    operationKey: "role-uncertain-first",
    roleId: UNCERTAIN_ROLE_ID,
  })
  uncertainClient.modifyError = new Error("socket reset")
  const uncertainPlan = await uncertain.service.plan(
    APPLICATION_ID,
    BOT_ID,
    uncertainRequest,
  )
  await assert.rejects(
    uncertain.service.execute(
      APPLICATION_ID,
      BOT_ID,
      uncertainRequest,
      uncertainPlan.digest,
    ),
    (error) => executionResult(error).status === "uncertain",
  )

  const sibling = fixture({ client: uncertainClient, policy: uncertainPolicy })
  const nextRequest = request({
    operationKey: "role-uncertain-second",
    roleId: UNCERTAIN_ROLE_ID,
  })
  const nextDigest = `hmac-sha256:${"a".repeat(64)}`
  await assert.rejects(
    sibling.service.execute(APPLICATION_ID, BOT_ID, nextRequest, nextDigest),
    (error) => executionResult(error).status === "blocked-prior-uncertain",
  )
  assert.equal(uncertainClient.patchCalls.length, 1)
})
