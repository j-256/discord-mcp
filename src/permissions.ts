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
  roles: readonly DiscordRole[]
}

export interface EvaluateGuildMemberPermissionsOptions {
  guildId: string
  member: DiscordGuildMember
  roles: readonly DiscordRole[]
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
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
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
  const rolesById = new Map<string, DiscordRole>()
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
    if (!DISCORD_SNOWFLAKE_PATTERN.test(roleId)) {
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
  const appliedRoles: DiscordRole[] = []
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
