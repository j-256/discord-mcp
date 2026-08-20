import {
  DISCORD_CHANNEL_TYPES,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordPermissionOverwrite,
  DiscordRole,
} from "./types.js"

export const DISCORD_PERMISSIONS = Object.freeze({
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 1n << 41n,
  USE_SOUNDBOARD: 1n << 42n,
  CREATE_GUILD_EXPRESSIONS: 1n << 43n,
  CREATE_EVENTS: 1n << 44n,
  USE_EXTERNAL_SOUNDS: 1n << 45n,
  SEND_VOICE_MESSAGES: 1n << 46n,
  SET_VOICE_CHANNEL_STATUS: 1n << 48n,
  SEND_POLLS: 1n << 49n,
  USE_EXTERNAL_APPS: 1n << 50n,
  PIN_MESSAGES: 1n << 51n,
  BYPASS_SLOWMODE: 1n << 52n,
})

export type DiscordPermissionName = keyof typeof DISCORD_PERMISSIONS

export const DISCORD_PERMISSION_NAMES = Object.freeze(
  Object.keys(DISCORD_PERMISSIONS) as DiscordPermissionName[],
)

const PERMISSION_ENTRIES = Object.entries(DISCORD_PERMISSIONS) as Array<[
  DiscordPermissionName,
  bigint,
]>

export const ALL_KNOWN_PERMISSION_BITS = PERMISSION_ENTRIES.reduce(
  (mask, [, permission]) => mask | permission,
  0n,
)

export interface PermissionDecisionTrace {
  after: string
  allow: string
  before: string
  deny: string
  note: string
  stage: string
}

export interface BotChannelPermissionResult {
  administrator: boolean
  appliedRoleIds: string[]
  basePermissions: string
  canReadMessages: boolean | null
  confidence: "complete" | "partial"
  decisionTrace: PermissionDecisionTrace[]
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  missingReadPermissions: DiscordPermissionName[]
  permissionSourceChannelId: string
  privateThreadAccess: "lookup-succeeded" | "not-applicable"
  requiredReadPermissions: DiscordPermissionName[]
  unknownPermissionBits: string
  warnings: string[]
}

export interface EvaluateBotChannelPermissionsOptions {
  botId: string
  channel: DiscordChannel
  guildId: string
  member: DiscordGuildMember
  permissionChannel: DiscordChannel
  roles: readonly PermissionRoleEvidence[]
}

export type PermissionRoleEvidence = Pick<
  DiscordRole,
  "id" | "managed" | "name" | "permissions" | "position"
>

export interface EvaluateGuildMemberPermissionsOptions {
  guildId: string
  member: DiscordGuildMember
  roles: readonly PermissionRoleEvidence[]
}

export interface GuildMemberPermissionResult {
  administrator: boolean
  appliedRoleIds: string[]
  complete: boolean
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  highestRoleIds: string[]
  highestRolePosition: number
  warnings: string[]
}

interface PermissionBits {
  allow: bigint
  deny: bigint
}

export function parseDiscordPermissionBits(
  value: string,
  description = "role",
): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Discord returned an invalid ${description} permission bitfield`)
  }
  return BigInt(value)
}

function overwriteBits(
  overwrite: DiscordPermissionOverwrite | undefined,
  description: string,
): PermissionBits {
  return {
    allow: parseDiscordPermissionBits(overwrite?.allow ?? "0", `${description} allow`),
    deny: parseDiscordPermissionBits(overwrite?.deny ?? "0", `${description} deny`),
  }
}

function applyBits(
  trace: PermissionDecisionTrace[],
  stage: string,
  before: bigint,
  bits: PermissionBits,
  note: string,
): bigint {
  const after = (before & ~bits.deny) | bits.allow
  trace.push({
    after: after.toString(),
    allow: bits.allow.toString(),
    before: before.toString(),
    deny: bits.deny.toString(),
    note,
    stage,
  })
  return after
}

function combinedRoleOverwrites(
  overwrites: readonly DiscordPermissionOverwrite[],
  roleIds: ReadonlySet<string>,
): PermissionBits {
  let allow = 0n
  let deny = 0n
  for (const overwrite of overwrites) {
    if (overwrite.type !== 0 || !roleIds.has(overwrite.id)) continue
    const bits = overwriteBits(overwrite, `role ${overwrite.id} overwrite`)
    allow |= bits.allow
    deny |= bits.deny
  }
  return { allow, deny }
}

export function discordPermissionNames(bits: bigint): DiscordPermissionName[] {
  return PERMISSION_ENTRIES
    .filter(([, permission]) => (bits & permission) === permission)
    .map(([name]) => name)
}

export function discordPermissionBitfield(
  names: readonly DiscordPermissionName[],
): bigint {
  const unique = new Set<DiscordPermissionName>()
  let bits = 0n
  for (const name of names) {
    if (unique.has(name)) {
      throw new RangeError(`Discord permission ${name} is duplicated`)
    }
    unique.add(name)
    bits |= DISCORD_PERMISSIONS[name]
  }
  return bits
}

export function unknownDiscordPermissionBits(bits: bigint): bigint {
  return bits & ~ALL_KNOWN_PERMISSION_BITS
}

export function evaluateGuildMemberPermissions(
  options: EvaluateGuildMemberPermissionsOptions,
): GuildMemberPermissionResult {
  const warnings: string[] = []
  let complete = true
  const rolesById = new Map<string, PermissionRoleEvidence>()
  for (const role of options.roles) {
    if (!DISCORD_SNOWFLAKE_PATTERN.test(role.id)) {
      complete = false
      warnings.push("Discord role evidence contains an invalid role ID")
    }
    if (rolesById.has(role.id)) {
      complete = false
      warnings.push(`Discord role evidence contains duplicate role ${role.id}`)
      continue
    }
    if (!Number.isInteger(role.position) || role.position < 0) {
      complete = false
      warnings.push(`Discord role ${role.id} has an invalid position`)
    }
    rolesById.set(role.id, role)
  }

  const memberRoleIds = new Set<string>()
  for (const roleId of options.member.roles) {
    if (typeof roleId !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(roleId)) {
      complete = false
      warnings.push("Discord member evidence contains an invalid role ID")
    }
    if (memberRoleIds.has(roleId)) {
      complete = false
      warnings.push(`Discord member evidence contains duplicate role ${roleId}`)
    }
    memberRoleIds.add(roleId)
  }

  const everyone = rolesById.get(options.guildId)
  let effective = 0n
  const appliedRoles: PermissionRoleEvidence[] = []
  if (!everyone) {
    complete = false
    warnings.push("Discord role evidence omitted the guild @everyone role")
  } else {
    effective |= parseDiscordPermissionBits(everyone.permissions, "@everyone role")
    appliedRoles.push(everyone)
  }
  for (const roleId of [...memberRoleIds].sort()) {
    if (roleId === options.guildId) continue
    const role = rolesById.get(roleId)
    if (!role) {
      complete = false
      warnings.push(`Discord member evidence references missing role ${roleId}`)
      continue
    }
    effective |= parseDiscordPermissionBits(role.permissions, `role ${roleId}`)
    appliedRoles.push(role)
  }

  const highestRolePosition = appliedRoles.reduce(
    (highest, role) => Math.max(highest, role.position),
    0,
  )
  const highestRoleIds = appliedRoles
    .filter((role) => role.position === highestRolePosition)
    .map((role) => role.id)
    .sort()
  const administrator = (
    effective & DISCORD_PERMISSIONS.ADMINISTRATOR
  ) === DISCORD_PERMISSIONS.ADMINISTRATOR
  return {
    administrator,
    appliedRoleIds: appliedRoles.map((role) => role.id).sort(),
    complete,
    effectivePermissionNames: discordPermissionNames(effective),
    effectivePermissions: effective.toString(),
    highestRoleIds,
    highestRolePosition,
    warnings,
  }
}

export function hasGuildPermission(
  result: GuildMemberPermissionResult,
  permission: DiscordPermissionName,
): boolean {
  if (result.administrator) return true
  const effective = BigInt(result.effectivePermissions)
  const required = DISCORD_PERMISSIONS[permission]
  return (effective & required) === required
}

function requiredReadPermissions(channelType: number): DiscordPermissionName[] {
  const permissions: DiscordPermissionName[] = [
    "VIEW_CHANNEL",
    "READ_MESSAGE_HISTORY",
  ]
  if (
    channelType === DISCORD_CHANNEL_TYPES.voice
    || channelType === DISCORD_CHANNEL_TYPES.stageVoice
  ) {
    permissions.push("CONNECT")
  }
  return permissions
}

export function evaluateBotChannelPermissions(
  options: EvaluateBotChannelPermissionsOptions,
): BotChannelPermissionResult {
  const warnings: string[] = []
  const trace: PermissionDecisionTrace[] = []
  const rolesById = new Map(options.roles.map((role) => [role.id, role]))
  const memberRoleIds = new Set([...options.member.roles].sort())
  const everyone = rolesById.get(options.guildId)
  let complete = true
  let observed = 0n
  let effective = 0n
  const appliedRoleIds: string[] = []

  if (!everyone) {
    complete = false
    warnings.push("Discord role evidence omitted the guild @everyone role")
  } else {
    const everyoneBits = parseDiscordPermissionBits(everyone.permissions, "@everyone role")
    observed |= everyoneBits
    effective = applyBits(
      trace,
      "guild-everyone",
      effective,
      { allow: everyoneBits, deny: 0n },
      "Apply the guild @everyone role",
    )
    appliedRoleIds.push(everyone.id)
  }

  let roleBits = 0n
  for (const roleId of memberRoleIds) {
    if (roleId === options.guildId) continue
    const role = rolesById.get(roleId)
    if (!role) {
      complete = false
      warnings.push(`Discord member evidence references missing role ${roleId}`)
      continue
    }
    const bits = parseDiscordPermissionBits(role.permissions, `role ${roleId}`)
    observed |= bits
    roleBits |= bits
    appliedRoleIds.push(roleId)
  }
  effective = applyBits(
    trace,
    "guild-roles",
    effective,
    { allow: roleBits, deny: 0n },
    `Union ${appliedRoleIds.length - (everyone ? 1 : 0)} connector bot roles`,
  )
  const basePermissions = effective
  const administrator = (
    effective & DISCORD_PERMISSIONS.ADMINISTRATOR
  ) === DISCORD_PERMISSIONS.ADMINISTRATOR

  if (administrator) {
    effective = applyBits(
      trace,
      "administrator",
      effective,
      { allow: ALL_KNOWN_PERMISSION_BITS | effective, deny: 0n },
      "ADMINISTRATOR grants every known permission and bypasses channel overwrites",
    )
  } else if (options.permissionChannel.permission_overwrites === undefined) {
    complete = false
    warnings.push("Discord channel evidence omitted permission_overwrites")
  } else {
    const overwrites = options.permissionChannel.permission_overwrites
    for (const overwrite of overwrites) {
      const bits = overwriteBits(overwrite, `channel ${overwrite.id} overwrite`)
      observed |= bits.allow | bits.deny
      if (overwrite.type !== 0 && overwrite.type !== 1) {
        complete = false
        warnings.push(`Discord returned unknown overwrite type ${overwrite.type}`)
      }
    }

    const everyoneOverwrite = overwrites.find((overwrite) => (
      overwrite.type === 0 && overwrite.id === options.guildId
    ))
    effective = applyBits(
      trace,
      "channel-everyone",
      effective,
      overwriteBits(everyoneOverwrite, "channel @everyone overwrite"),
      "Apply the channel @everyone overwrite with deny before allow",
    )
    effective = applyBits(
      trace,
      "channel-roles",
      effective,
      combinedRoleOverwrites(overwrites, memberRoleIds),
      "Combine connector bot role overwrites and apply deny before allow",
    )
    const memberOverwrite = overwrites.find((overwrite) => (
      overwrite.type === 1 && overwrite.id === options.botId
    ))
    effective = applyBits(
      trace,
      "channel-member",
      effective,
      overwriteBits(memberOverwrite, "channel member overwrite"),
      "Apply the connector bot member overwrite last",
    )
  }

  const required = requiredReadPermissions(options.channel.type)
  const missing = required.filter((name) => {
    const permission = DISCORD_PERMISSIONS[name]
    return (effective & permission) !== permission
  })
  const unknown = observed & ~ALL_KNOWN_PERMISSION_BITS
  if (unknown !== 0n) {
    warnings.push(`Discord returned permission bits unknown to this build: ${unknown}`)
  }

  return {
    administrator,
    appliedRoleIds,
    basePermissions: basePermissions.toString(),
    canReadMessages: complete ? missing.length === 0 : null,
    confidence: complete ? "complete" : "partial",
    decisionTrace: trace,
    effectivePermissionNames: discordPermissionNames(effective),
    effectivePermissions: effective.toString(),
    missingReadPermissions: missing,
    permissionSourceChannelId: options.permissionChannel.id,
    privateThreadAccess: options.channel.type === DISCORD_CHANNEL_TYPES.privateThread
      ? "lookup-succeeded"
      : "not-applicable",
    requiredReadPermissions: required,
    unknownPermissionBits: unknown.toString(),
    warnings,
  }
}

export const DISCORD_PERMISSION_ACTIONS = [
  "view-channel",
  "read-messages",
  "send-message",
  "attach-file",
  "add-reaction",
  "delete-message",
  "manage-channel",
  "assign-role",
  "remove-role",
  "kick-member",
  "ban-member",
  "timeout-member",
] as const

export type DiscordPermissionAction = typeof DISCORD_PERMISSION_ACTIONS[number]

export const DISCORD_CHANNEL_PERMISSION_ACTIONS = [
  "view-channel",
  "read-messages",
  "send-message",
  "attach-file",
  "add-reaction",
  "delete-message",
  "manage-channel",
] as const satisfies readonly DiscordPermissionAction[]

export type DiscordChannelPermissionAction =
  typeof DISCORD_CHANNEL_PERMISSION_ACTIONS[number]

export const DEFAULT_DISCORD_CHANNEL_PERMISSION_ACTIONS = [
  "view-channel",
  "read-messages",
  "send-message",
] as const satisfies readonly DiscordChannelPermissionAction[]

export type PrincipalPermissionSubject =
  | {
    id: string
    kind: "connector" | "member"
    member: DiscordGuildMember
  }
  | {
    id: string
    kind: "role"
  }

export type PrincipalPermissionTarget =
  | {
    id: string
    kind: "member"
    member: DiscordGuildMember
  }
  | {
    id: string
    kind: "role"
  }

export type PrivateThreadMembershipEvidence =
  | "member"
  | "not-member"
  | "unknown"

export type PrivateThreadAccess =
  | "member"
  | "moderator"
  | "not-applicable"
  | "not-member"
  | "unknown"

export interface RoleHierarchyCheck {
  actorHighestRoleIds: string[]
  actorHighestRolePosition: number | null
  allowed: boolean | null
  reason: string
  status: "allowed" | "denied" | "not-applicable" | "unknown"
  targetHighestRoleIds: string[]
  targetHighestRolePosition: number | null
}

export interface ImplicitPermissionDeny {
  missingPrerequisites: DiscordPermissionName[]
  permission: DiscordPermissionName
  reason: string
}

export interface PrincipalPermissionResult {
  action: DiscordPermissionAction | null
  administrator: boolean
  allowed: boolean | null
  appliedRoleIds: string[]
  basePermissions: string
  confidence: "complete" | "partial"
  decisionTrace: PermissionDecisionTrace[]
  effectivePermissionNames: DiscordPermissionName[]
  effectivePermissions: string
  guildOwner: boolean
  hierarchy: RoleHierarchyCheck
  ignoredMemberOverwriteCount: number
  implicitDenies: ImplicitPermissionDeny[]
  ineffectivePermissions: DiscordPermissionName[]
  memberOverwriteCount: number
  missingPermissions: DiscordPermissionName[]
  permissionSourceChannelId: string | null
  privateThreadAccess: PrivateThreadAccess
  requestedPermissions: DiscordPermissionName[]
  subjectId: string
  subjectKind: PrincipalPermissionSubject["kind"]
  subjectTimedOut: boolean
  unknownPermissionBits: string
  warnings: string[]
}

export interface EvaluatePrincipalPermissionsOptions {
  action?: DiscordPermissionAction
  channel?: DiscordChannel
  guildId: string
  guildOwnerId: string
  now?: Date
  permissionChannel?: DiscordChannel
  privateThreadMembership?: PrivateThreadMembershipEvidence
  requestedPermissions?: readonly DiscordPermissionName[]
  roles: readonly PermissionRoleEvidence[]
  subject: PrincipalPermissionSubject
  target?: PrincipalPermissionTarget
}

interface PermissionOverwriteIndex {
  memberCount: number
  members: ReadonlyMap<string, PermissionBits>
  observed: bigint
  roles: ReadonlyMap<string, PermissionBits>
}

const CHANNEL_ACTION_SET: ReadonlySet<DiscordPermissionAction> = new Set(
  DISCORD_CHANNEL_PERMISSION_ACTIONS,
)
const HIERARCHY_ACTION_SET: ReadonlySet<DiscordPermissionAction> = new Set([
  "assign-role",
  "ban-member",
  "kick-member",
  "remove-role",
  "timeout-member",
])
const ROLE_TARGET_ACTION_SET: ReadonlySet<DiscordPermissionAction> = new Set([
  "assign-role",
  "remove-role",
])
const MEMBER_TARGET_ACTION_SET: ReadonlySet<DiscordPermissionAction> = new Set([
  "ban-member",
  "kick-member",
  "timeout-member",
])
const THREAD_CHANNEL_TYPE_SET: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.announcementThread,
  DISCORD_CHANNEL_TYPES.privateThread,
  DISCORD_CHANNEL_TYPES.publicThread,
])
const VOICE_CHANNEL_TYPE_SET: ReadonlySet<number> = new Set([
  DISCORD_CHANNEL_TYPES.stageVoice,
  DISCORD_CHANNEL_TYPES.voice,
])
const CHANNEL_SCOPED_PERMISSION_SET: ReadonlySet<DiscordPermissionName> = new Set([
  "CREATE_INSTANT_INVITE",
  "MANAGE_CHANNELS",
  "ADD_REACTIONS",
  "PRIORITY_SPEAKER",
  "STREAM",
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "SEND_TTS_MESSAGES",
  "MANAGE_MESSAGES",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "READ_MESSAGE_HISTORY",
  "MENTION_EVERYONE",
  "USE_EXTERNAL_EMOJIS",
  "CONNECT",
  "SPEAK",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
  "USE_VAD",
  "MANAGE_ROLES",
  "MANAGE_WEBHOOKS",
  "USE_APPLICATION_COMMANDS",
  "REQUEST_TO_SPEAK",
  "MANAGE_THREADS",
  "CREATE_PUBLIC_THREADS",
  "CREATE_PRIVATE_THREADS",
  "USE_EXTERNAL_STICKERS",
  "SEND_MESSAGES_IN_THREADS",
  "USE_EMBEDDED_ACTIVITIES",
  "USE_SOUNDBOARD",
  "USE_EXTERNAL_SOUNDS",
  "SEND_VOICE_MESSAGES",
  "SET_VOICE_CHANNEL_STATUS",
  "SEND_POLLS",
  "USE_EXTERNAL_APPS",
  "PIN_MESSAGES",
  "BYPASS_SLOWMODE",
])
const SEND_DEPENDENT_PERMISSION_SET: ReadonlySet<DiscordPermissionName> = new Set([
  "ATTACH_FILES",
  "EMBED_LINKS",
  "MENTION_EVERYONE",
  "SEND_POLLS",
  "SEND_TTS_MESSAGES",
  "SEND_VOICE_MESSAGES",
])
const CONNECT_DEPENDENT_PERMISSION_SET: ReadonlySet<DiscordPermissionName> = new Set([
  "DEAFEN_MEMBERS",
  "MANAGE_CHANNELS",
  "MOVE_MEMBERS",
  "MUTE_MEMBERS",
  "PRIORITY_SPEAKER",
  "REQUEST_TO_SPEAK",
  "SET_VOICE_CHANNEL_STATUS",
  "SPEAK",
  "STREAM",
  "USE_EXTERNAL_SOUNDS",
  "USE_SOUNDBOARD",
  "USE_VAD",
])
const PERMISSION_ORDER = new Map(
  DISCORD_PERMISSION_NAMES.map((name, index) => [name, index]),
)

function canonicalPermissionNames(
  names: readonly DiscordPermissionName[],
): DiscordPermissionName[] {
  const known = new Set<DiscordPermissionName>(DISCORD_PERMISSION_NAMES)
  const seen = new Set<DiscordPermissionName>()
  for (const name of names) {
    if (!known.has(name)) {
      throw new RangeError(`Discord permission ${String(name)} is not known`)
    }
    if (seen.has(name)) {
      throw new RangeError(`Discord permission ${name} is duplicated`)
    }
    seen.add(name)
  }
  return [...seen].sort((left, right) => (
    (PERMISSION_ORDER.get(left) as number) - (PERMISSION_ORDER.get(right) as number)
  ))
}

function isThreadChannel(type: number): boolean {
  return THREAD_CHANNEL_TYPE_SET.has(type)
}

function actionPermissions(
  action: DiscordPermissionAction,
  channel: DiscordChannel | undefined,
): DiscordPermissionName[] {
  const isThread = channel ? isThreadChannel(channel.type) : false
  const voice = channel ? VOICE_CHANNEL_TYPE_SET.has(channel.type) : false
  const withVoiceConnect = (permissions: DiscordPermissionName[]) => (
    voice ? [...permissions, "CONNECT" as const] : permissions
  )
  if (action === "view-channel") return ["VIEW_CHANNEL"]
  if (action === "read-messages") {
    return withVoiceConnect(["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"])
  }
  if (action === "send-message") {
    return withVoiceConnect([
      "VIEW_CHANNEL",
      isThread ? "SEND_MESSAGES_IN_THREADS" : "SEND_MESSAGES",
    ])
  }
  if (action === "attach-file") {
    return withVoiceConnect([
      "VIEW_CHANNEL",
      isThread ? "SEND_MESSAGES_IN_THREADS" : "SEND_MESSAGES",
      "ATTACH_FILES",
    ])
  }
  if (action === "add-reaction") {
    return withVoiceConnect([
      "VIEW_CHANNEL",
      "READ_MESSAGE_HISTORY",
      "ADD_REACTIONS",
    ])
  }
  if (action === "delete-message") {
    return withVoiceConnect([
      "VIEW_CHANNEL",
      "READ_MESSAGE_HISTORY",
      "MANAGE_MESSAGES",
    ])
  }
  if (action === "manage-channel") {
    return withVoiceConnect([
      "VIEW_CHANNEL",
      isThread ? "MANAGE_THREADS" : "MANAGE_CHANNELS",
    ])
  }
  if (action === "assign-role" || action === "remove-role") return ["MANAGE_ROLES"]
  if (action === "kick-member") return ["KICK_MEMBERS"]
  if (action === "ban-member") return ["BAN_MEMBERS"]
  return ["MODERATE_MEMBERS"]
}

function indexPermissionOverwrites(
  overwrites: readonly DiscordPermissionOverwrite[],
): PermissionOverwriteIndex {
  const members = new Map<string, PermissionBits>()
  const roles = new Map<string, PermissionBits>()
  let observed = 0n
  for (const value of overwrites as readonly unknown[]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Discord returned an invalid permission overwrite object")
    }
    const overwrite = value as Partial<DiscordPermissionOverwrite>
    if (
      typeof overwrite.id !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(overwrite.id)
    ) {
      throw new Error("Discord returned an invalid permission overwrite target ID")
    }
    if (overwrite.type !== 0 && overwrite.type !== 1) {
      throw new Error(`Discord returned unsupported overwrite type ${overwrite.type}`)
    }
    const bits = overwriteBits(
      overwrite as DiscordPermissionOverwrite,
      `channel ${overwrite.id} overwrite`,
    )
    if ((bits.allow & bits.deny) !== 0n) {
      throw new Error(`Discord returned overlapping permission overwrite bits for ${overwrite.id}`)
    }
    const targets = overwrite.type === 0 ? roles : members
    if (targets.has(overwrite.id)) {
      throw new Error(`Discord returned duplicate permission overwrite ${overwrite.id}`)
    }
    targets.set(overwrite.id, bits)
    observed |= bits.allow | bits.deny
  }
  return {
    memberCount: members.size,
    members,
    observed,
    roles,
  }
}

function combineIndexedRoleOverwrites(
  index: PermissionOverwriteIndex,
  roleIds: readonly string[],
): PermissionBits {
  let allow = 0n
  let deny = 0n
  for (const roleId of roleIds) {
    const bits = index.roles.get(roleId)
    if (!bits) continue
    allow |= bits.allow
    deny |= bits.deny
  }
  return { allow, deny }
}

function timeoutActive(member: DiscordGuildMember, now: Date): boolean {
  const value = member.communication_disabled_until
  if (value === undefined || value === null) return false
  if (typeof value !== "string") {
    throw new Error("Discord returned an invalid member timeout timestamp")
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    throw new Error("Discord returned an invalid member timeout timestamp")
  }
  return timestamp > now.getTime()
}

function hasPermission(bits: bigint, name: DiscordPermissionName): boolean {
  const permission = DISCORD_PERMISSIONS[name]
  return (bits & permission) === permission
}

function implicitPermissionDenies(
  requested: readonly DiscordPermissionName[],
  effective: bigint,
  channel: DiscordChannel | undefined,
): ImplicitPermissionDeny[] {
  if (!channel) return []
  const isThread = isThreadChannel(channel.type)
  const isVoice = VOICE_CHANNEL_TYPE_SET.has(channel.type)
  const results: ImplicitPermissionDeny[] = []
  for (const permission of requested) {
    if (!hasPermission(effective, permission)) continue
    const missing = new Set<DiscordPermissionName>()
    if (
      permission !== "VIEW_CHANNEL"
      && CHANNEL_SCOPED_PERMISSION_SET.has(permission)
      && !hasPermission(effective, "VIEW_CHANNEL")
    ) {
      missing.add("VIEW_CHANNEL")
    }
    if (SEND_DEPENDENT_PERMISSION_SET.has(permission)) {
      const sendPermission = isThread ? "SEND_MESSAGES_IN_THREADS" : "SEND_MESSAGES"
      if (!hasPermission(effective, sendPermission)) missing.add(sendPermission)
    }
    if (
      isVoice
      && CONNECT_DEPENDENT_PERMISSION_SET.has(permission)
      && !hasPermission(effective, "CONNECT")
    ) {
      missing.add("CONNECT")
    }
    let reason = "One or more prerequisite permissions are missing"
    if (isThread && permission === "SEND_MESSAGES") {
      if (!hasPermission(effective, "SEND_MESSAGES_IN_THREADS")) {
        missing.add("SEND_MESSAGES_IN_THREADS")
      }
      reason = "SEND_MESSAGES has no effect in threads"
    } else if (isThread && permission === "MANAGE_CHANNELS") {
      if (!hasPermission(effective, "MANAGE_THREADS")) missing.add("MANAGE_THREADS")
      reason = "MANAGE_CHANNELS does not manage a thread"
    } else if (!isThread && permission === "SEND_MESSAGES_IN_THREADS") {
      reason = "SEND_MESSAGES_IN_THREADS has no effect outside a thread"
    } else if (missing.size === 0) {
      continue
    }
    results.push({
      missingPrerequisites: canonicalPermissionNames([...missing]),
      permission,
      reason,
    })
  }
  return results
}

function hierarchyNotApplicable(): RoleHierarchyCheck {
  return {
    actorHighestRoleIds: [],
    actorHighestRolePosition: null,
    allowed: null,
    reason: "The requested permission check does not depend on role hierarchy",
    status: "not-applicable",
    targetHighestRoleIds: [],
    targetHighestRolePosition: null,
  }
}

function hierarchyCheck(
  action: DiscordPermissionAction | undefined,
  options: EvaluatePrincipalPermissionsOptions,
  actor: GuildMemberPermissionResult,
  rolesById: ReadonlyMap<string, PermissionRoleEvidence>,
): RoleHierarchyCheck {
  if (!action || !HIERARCHY_ACTION_SET.has(action)) return hierarchyNotApplicable()
  const base = {
    actorHighestRoleIds: actor.highestRoleIds,
    actorHighestRolePosition: actor.highestRolePosition,
  }
  if (options.subject.kind === "role") {
    return {
      ...base,
      allowed: null,
      reason: "Hierarchy actions require a member subject",
      status: "unknown",
      targetHighestRoleIds: [],
      targetHighestRolePosition: null,
    }
  }
  if (!actor.complete) {
    return {
      ...base,
      allowed: null,
      reason: "The subject's role hierarchy evidence is incomplete",
      status: "unknown",
      targetHighestRoleIds: [],
      targetHighestRolePosition: null,
    }
  }
  const target = options.target
  if (!target) {
    return {
      ...base,
      allowed: null,
      reason: "The hierarchy target is missing",
      status: "unknown",
      targetHighestRoleIds: [],
      targetHighestRolePosition: null,
    }
  }
  if (ROLE_TARGET_ACTION_SET.has(action)) {
    if (target.kind !== "role") {
      return {
        ...base,
        allowed: null,
        reason: "The hierarchy action requires a role target",
        status: "unknown",
        targetHighestRoleIds: [],
        targetHighestRolePosition: null,
      }
    }
    const role = rolesById.get(target.id)
    const targetBase = {
      targetHighestRoleIds: role ? [role.id] : [],
      targetHighestRolePosition: role?.position ?? null,
    }
    if (!role) {
      return {
        ...base,
        ...targetBase,
        allowed: null,
        reason: "The target role is absent from the guild role inventory",
        status: "unknown",
      }
    }
    if (role.id === options.guildId) {
      return {
        ...base,
        ...targetBase,
        allowed: false,
        reason: "The @everyone role cannot be assigned or removed",
        status: "denied",
      }
    }
    if (role.managed) {
      return {
        ...base,
        ...targetBase,
        allowed: false,
        reason: "Discord-managed roles cannot be assigned or removed manually",
        status: "denied",
      }
    }
    if (options.subject.id === options.guildOwnerId) {
      return {
        ...base,
        ...targetBase,
        allowed: true,
        reason: "The guild owner bypasses role position comparison",
        status: "allowed",
      }
    }
    const allowed = actor.highestRolePosition > role.position
    return {
      ...base,
      ...targetBase,
      allowed,
      reason: allowed
        ? "The subject's highest role is above the target role"
        : "The subject's highest role must be strictly above the target role",
      status: allowed ? "allowed" : "denied",
    }
  }
  if (target.kind !== "member") {
    return {
      ...base,
      allowed: null,
      reason: "The hierarchy action requires a member target",
      status: "unknown",
      targetHighestRoleIds: [],
      targetHighestRolePosition: null,
    }
  }
  const targetPermissions = evaluateGuildMemberPermissions({
    guildId: options.guildId,
    member: target.member,
    roles: options.roles,
  })
  const targetBase = {
    targetHighestRoleIds: targetPermissions.highestRoleIds,
    targetHighestRolePosition: targetPermissions.highestRolePosition,
  }
  if (!targetPermissions.complete) {
    return {
      ...base,
      ...targetBase,
      allowed: null,
      reason: "The target member's role hierarchy evidence is incomplete",
      status: "unknown",
    }
  }
  if (target.id === options.guildOwnerId) {
    return {
      ...base,
      ...targetBase,
      allowed: false,
      reason: "The guild owner cannot be targeted by this hierarchy action",
      status: "denied",
    }
  }
  if (target.id === options.subject.id) {
    return {
      ...base,
      ...targetBase,
      allowed: false,
      reason: "A member cannot apply this hierarchy action to itself",
      status: "denied",
    }
  }
  if (action === "timeout-member" && targetPermissions.administrator) {
    return {
      ...base,
      ...targetBase,
      allowed: false,
      reason: "Discord rejects timeouts for administrators",
      status: "denied",
    }
  }
  if (options.subject.id === options.guildOwnerId) {
    return {
      ...base,
      ...targetBase,
      allowed: true,
      reason: "The guild owner bypasses member role position comparison",
      status: "allowed",
    }
  }
  const allowed = actor.highestRolePosition > targetPermissions.highestRolePosition
  return {
    ...base,
    ...targetBase,
    allowed,
    reason: allowed
      ? "The subject's highest role is above the target member's highest role"
      : "The subject's highest role must be strictly above the target member's highest role",
    status: allowed ? "allowed" : "denied",
  }
}

export function evaluatePrincipalPermissions(
  options: EvaluatePrincipalPermissionsOptions,
): PrincipalPermissionResult {
  if (!DISCORD_SNOWFLAKE_PATTERN.test(options.guildId)) {
    throw new RangeError("Principal permission evaluation requires an exact guild snowflake")
  }
  if (!DISCORD_SNOWFLAKE_PATTERN.test(options.guildOwnerId)) {
    throw new RangeError("Principal permission evaluation requires an exact owner snowflake")
  }
  if (!DISCORD_SNOWFLAKE_PATTERN.test(options.subject.id)) {
    throw new RangeError("Principal permission evaluation requires an exact subject snowflake")
  }
  if (options.action && !DISCORD_PERMISSION_ACTIONS.includes(options.action)) {
    throw new RangeError("Principal permission evaluation action is not supported")
  }
  if (options.action && CHANNEL_ACTION_SET.has(options.action) && !options.channel) {
    throw new RangeError(`Discord permission action ${options.action} requires a channel`)
  }
  if (options.action && HIERARCHY_ACTION_SET.has(options.action) && options.channel) {
    throw new RangeError(`Discord permission action ${options.action} does not accept a channel`)
  }
  if (options.channel && !options.permissionChannel) {
    throw new RangeError("Channel permission evaluation requires overwrite evidence")
  }
  if (!options.channel && options.permissionChannel) {
    throw new RangeError("Channel overwrite evidence requires a channel")
  }
  if (options.target && !DISCORD_SNOWFLAKE_PATTERN.test(options.target.id)) {
    throw new RangeError("Principal permission evaluation requires an exact target snowflake")
  }
  if (options.action && ROLE_TARGET_ACTION_SET.has(options.action)) {
    if (options.target?.kind !== "role") {
      throw new RangeError(`Discord permission action ${options.action} requires a role target`)
    }
  } else if (options.action && MEMBER_TARGET_ACTION_SET.has(options.action)) {
    if (options.target?.kind !== "member") {
      throw new RangeError(`Discord permission action ${options.action} requires a member target`)
    }
  } else if (options.target) {
    throw new RangeError("A permission target is only valid for a hierarchy action")
  }
  if (options.action && HIERARCHY_ACTION_SET.has(options.action) && options.subject.kind === "role") {
    throw new RangeError("Discord hierarchy actions require a member subject")
  }

  const explicitPermissions = canonicalPermissionNames(options.requestedPermissions ?? [])
  const actionRequirements = options.action
    ? actionPermissions(options.action, options.channel)
    : []
  const requested = canonicalPermissionNames([
    ...new Set([...explicitPermissions, ...actionRequirements]),
  ])
  if (requested.length === 0) {
    throw new RangeError("Principal permission evaluation requires an action or permission")
  }
  const requestsChannelPermission = Boolean(options.channel)
    && requested.some((permission) => CHANNEL_SCOPED_PERMISSION_SET.has(permission))

  const subjectRoleIds = options.subject.kind === "role"
    ? [options.subject.id]
    : options.subject.member.roles
  const subjectMember = options.subject.kind === "role"
    ? { roles: subjectRoleIds }
    : options.subject.member
  const base = evaluateGuildMemberPermissions({
    guildId: options.guildId,
    member: subjectMember,
    roles: options.roles,
  })
  const rolesById = new Map(options.roles.map((role) => [role.id, role]))
  const warnings = [...base.warnings]
  const trace: PermissionDecisionTrace[] = []
  const everyone = rolesById.get(options.guildId)
  const everyoneBits = everyone
    ? parseDiscordPermissionBits(everyone.permissions, "@everyone role")
    : 0n
  let effective = applyBits(
    trace,
    "guild-everyone",
    0n,
    { allow: everyoneBits, deny: 0n },
    "Apply the guild @everyone role",
  )
  let observed = everyoneBits
  let roleBits = 0n
  for (const roleId of [...new Set(subjectRoleIds)].sort()) {
    if (roleId === options.guildId) continue
    const role = rolesById.get(roleId)
    if (!role) continue
    const bits = parseDiscordPermissionBits(role.permissions, `role ${roleId}`)
    roleBits |= bits
    observed |= bits
  }
  effective = applyBits(
    trace,
    "guild-roles",
    effective,
    { allow: roleBits, deny: 0n },
    `Union ${base.appliedRoleIds.filter((id) => id !== options.guildId).length} subject roles`,
  )
  const basePermissions = effective
  const guildOwner = options.subject.kind !== "role"
    && options.subject.id === options.guildOwnerId
  const administrator = base.administrator
  let evidenceComplete = base.complete
  let memberOverwriteCount = 0
  let ignoredMemberOverwriteCount = 0
  let overwriteIndex: PermissionOverwriteIndex | undefined

  if (
    options.channel
    && options.permissionChannel
    && options.permissionChannel.permission_overwrites !== undefined
  ) {
    if (!Array.isArray(options.permissionChannel.permission_overwrites)) {
      throw new Error("Discord returned invalid channel permission overwrite evidence")
    }
    overwriteIndex = indexPermissionOverwrites(
      options.permissionChannel.permission_overwrites,
    )
    observed |= overwriteIndex.observed
    memberOverwriteCount = overwriteIndex.memberCount
    if (options.subject.kind === "role") {
      ignoredMemberOverwriteCount = memberOverwriteCount
    }
  }

  if (guildOwner) {
    effective = applyBits(
      trace,
      "guild-owner",
      effective,
      { allow: ALL_KNOWN_PERMISSION_BITS | effective, deny: 0n },
      "Guild ownership grants every known permission and bypasses channel overwrites",
    )
  } else if (administrator) {
    effective = applyBits(
      trace,
      "administrator",
      effective,
      { allow: ALL_KNOWN_PERMISSION_BITS | effective, deny: 0n },
      "ADMINISTRATOR grants every known permission and bypasses channel overwrites",
    )
  } else if (options.channel && options.permissionChannel) {
    if (!overwriteIndex) {
      evidenceComplete = false
      warnings.push("Discord channel evidence omitted permission_overwrites")
    } else {
      const everyoneOverwrite = overwriteIndex.roles.get(options.guildId)
      effective = applyBits(
        trace,
        "channel-everyone",
        effective,
        everyoneOverwrite ?? { allow: 0n, deny: 0n },
        "Apply the channel @everyone overwrite with deny before allow",
      )
      effective = applyBits(
        trace,
        "channel-roles",
        effective,
        combineIndexedRoleOverwrites(overwriteIndex, subjectRoleIds),
        "Combine subject role overwrites and apply deny before allow",
      )
      if (options.subject.kind !== "role") {
        effective = applyBits(
          trace,
          "channel-member",
          effective,
          overwriteIndex.members.get(options.subject.id) ?? { allow: 0n, deny: 0n },
          "Apply the subject member overwrite last",
        )
      }
    }
  }

  const now = options.now ?? new Date()
  const subjectTimedOut = options.subject.kind !== "role"
    && timeoutActive(options.subject.member, now)
  if (subjectTimedOut && !guildOwner && !administrator) {
    const retained = DISCORD_PERMISSIONS.VIEW_CHANNEL
      | DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY
    effective = applyBits(
      trace,
      "member-timeout",
      effective,
      { allow: 0n, deny: effective & ~retained },
      "An active timeout leaves only VIEW_CHANNEL and READ_MESSAGE_HISTORY effective",
    )
  }

  let privateThreadAccess: PrivateThreadAccess = "not-applicable"
  if (options.channel?.type === DISCORD_CHANNEL_TYPES.privateThread) {
    if (guildOwner || administrator || hasPermission(effective, "MANAGE_THREADS")) {
      privateThreadAccess = "moderator"
    } else if (options.subject.kind === "role") {
      privateThreadAccess = "unknown"
    } else {
      privateThreadAccess = options.privateThreadMembership ?? "unknown"
    }
    if (requestsChannelPermission && privateThreadAccess === "unknown") {
      evidenceComplete = false
      warnings.push("Private-thread membership evidence is unavailable for this subject")
    }
  }
  if (ignoredMemberOverwriteCount > 0) {
    warnings.push(
      `${ignoredMemberOverwriteCount} member-specific channel overwrites are excluded from this standalone role baseline`,
    )
  }

  const missingPermissions = requested.filter((permission) => (
    !hasPermission(effective, permission)
  ))
  const implicitDenies = implicitPermissionDenies(
    requested,
    effective,
    options.channel,
  )
  const ineffectivePermissions = implicitDenies.map(({ permission }) => permission)
  const hierarchy = hierarchyCheck(options.action, options, base, rolesById)
  if (hierarchy.status === "unknown") evidenceComplete = false
  const unknown = observed & ~ALL_KNOWN_PERMISSION_BITS
  if (unknown !== 0n) {
    warnings.push(`Discord returned permission bits unknown to this build: ${unknown}`)
  }
  const privateThreadDenied = requestsChannelPermission
    && privateThreadAccess === "not-member"
  const permissionDenied = missingPermissions.length > 0
    || ineffectivePermissions.length > 0
  let allowed: boolean | null
  if (hierarchy.status === "denied" || privateThreadDenied) allowed = false
  else if (!evidenceComplete) allowed = null
  else allowed = !permissionDenied

  return {
    action: options.action ?? null,
    administrator,
    allowed,
    appliedRoleIds: base.appliedRoleIds,
    basePermissions: basePermissions.toString(),
    confidence: evidenceComplete ? "complete" : "partial",
    decisionTrace: trace,
    effectivePermissionNames: discordPermissionNames(effective),
    effectivePermissions: effective.toString(),
    guildOwner,
    hierarchy,
    ignoredMemberOverwriteCount,
    implicitDenies,
    ineffectivePermissions,
    memberOverwriteCount,
    missingPermissions,
    permissionSourceChannelId: options.permissionChannel?.id ?? null,
    privateThreadAccess,
    requestedPermissions: requested,
    subjectId: options.subject.id,
    subjectKind: options.subject.kind,
    subjectTimedOut,
    unknownPermissionBits: unknown.toString(),
    warnings,
  }
}
