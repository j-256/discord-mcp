import {
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type {
  DiscordClient,
  DiscordGuildApplicationCommandPermissions,
} from "./discord-client.js"
import { ApplicationCommandAuditEvidenceError } from "./errors.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  discordPermissionNames,
  parseDiscordPermissionBits,
  type DiscordPermissionName,
} from "./permissions.js"
import type { ScopePolicy } from "./policy.js"
import type {
  DiscordApplicationCommand,
  DiscordGuild,
  RequestOptions,
} from "./types.js"

export type ApplicationCommandScope = "global" | "guild"
export type ApplicationCommandType =
  | "chat-input"
  | "message"
  | "primary-entry-point"
  | "unknown"
  | "user"
export type ApplicationCommandContext =
  | "bot-dm"
  | "guild"
  | "private-channel"
export type ApplicationCommandInstallationType =
  | "guild-install"
  | "user-install"
export type ApplicationCommandContextSource =
  | "command"
  | "discord-default"
  | "guild-scope"
export type ApplicationCommandInstallationTypeSource =
  | "application-default"
  | "command"
  | "guild-scope"
export type ApplicationCommandPermissionSource =
  | "application-default"
  | "command-specific"
  | "discord-default"
export type ApplicationCommandPermissionTarget =
  | "all-channels"
  | "channel"
  | "everyone"
  | "role"
  | "user"

export interface ApplicationCommandOptionSummary {
  autocomplete: number
  channelTypeConstraints: number
  choices: number
  localizationValues: number
  maximumDepth: number
  required: number
  topLevel: number
  total: number
  typeCounts: {
    attachment: number
    boolean: number
    channel: number
    integer: number
    mentionable: number
    number: number
    role: number
    string: number
    subcommand: number
    subcommandGroup: number
    user: number
  }
  unknownChannelTypes: number
  unknownFields: number
  unknownTypes: number
}

export interface ApplicationCommandSummary {
  contexts: {
    complete: boolean
    source: ApplicationCommandContextSource
    unknownValues: number
    values: ApplicationCommandContext[]
  }
  createdAt: string
  defaultAccess:
    | "administrator-or-explicit-allow"
    | "discord-default"
    | "named-permissions"
  defaultMemberPermissionNames: DiscordPermissionName[]
  deprecatedDefaultPermission: boolean | null
  deprecatedDmPermission: boolean | null
  descriptionCharacters: number
  guildId: string | null
  handler: "application" | "discord-launch-activity" | "unknown" | null
  id: string
  installationTypes: {
    complete: boolean
    source: ApplicationCommandInstallationTypeSource
    unknownValues: number
    values: ApplicationCommandInstallationType[]
  }
  localizationValues: number
  name: string
  nameCharacters: number
  nsfw: boolean
  nsfwReported: boolean
  options: ApplicationCommandOptionSummary
  permissionSource: ApplicationCommandPermissionSource
  scope: ApplicationCommandScope
  type: {
    code: number
    name: ApplicationCommandType
  }
  unknownFieldCount: number
  unknownPermissionBits: string
  version: string
  versionCreatedAt: string
}

export interface ApplicationCommandPermissionDecision {
  allowed: boolean
  id: string
  target: ApplicationCommandPermissionTarget
  unknownFieldCount: number
}

export interface ApplicationCommandPermissionSet {
  commandId: string | null
  commandName: string | null
  decisions: ApplicationCommandPermissionDecision[]
  id: string
  scope: ApplicationCommandScope | null
  source: "application-default" | "command-specific"
  unknownFieldCount: number
}

export interface ApplicationCommandAuditResult {
  application: {
    botId: string
    id: string
    installationTypes: {
      complete: boolean
      reported: boolean
      unknownValues: number
      values: ApplicationCommandInstallationType[]
    }
  }
  commands: ApplicationCommandSummary[]
  exposure: {
    commands: {
      administratorOrExplicitAllow: number
      applicationDefaultInstallationTypes: number
      discordDefault: number
      discordDefaultContexts: number
      global: number
      guild: number
      incompleteContexts: number
      incompleteInstallationTypes: number
      knownBotDm: number
      knownPrivateChannel: number
      knownUserInstall: number
      namedPermissions: number
      nsfw: number
      total: number
      unknownContextValues: number
      unknownInstallationTypeValues: number
      unknownTypes: number
    }
    evidence: {
      commandsWithUnknownPermissionBits: number
      unknownFields: number
      unknownOptionTypes: number
    }
    permissionSets: {
      allChannelDecisions: number
      allows: number
      applicationDefaults: number
      channelDecisions: number
      commandSpecific: number
      decisions: number
      denies: number
      everyoneDecisions: number
      roleDecisions: number
      userDecisions: number
    }
  }
  guild: {
    id: string
    name: string
  }
  inventory: {
    completeness: "complete-current-application"
    global: number
    guild: number
    permissions: number
    total: number
  }
  permissions: ApplicationCommandPermissionSet[]
  privacy: {
    omitted: readonly string[]
    persistence: "none"
    rawPayloads: "omitted"
    text: "transient-untrusted"
    unknownFields: "counts-only"
  }
  schemaVersion: number
  status: "ok"
  warnings: readonly string[]
}

export interface ApplicationCommandAuditServiceClient extends Pick<
  DiscordClient,
  | "getGuild"
  | "listGlobalApplicationCommands"
  | "listGuildApplicationCommandPermissions"
  | "listGuildApplicationCommands"
> {}

export interface ApplicationCommandAuditServiceOptions {
  client: ApplicationCommandAuditServiceClient
  policy: Pick<ScopePolicy, "assertGuildAllowed">
}

export interface ApplicationCommandAuditApplicationEvidence {
  botId: string
  id: string
  installationTypes: {
    reported: boolean
    unknownValues: number
    values: ApplicationCommandInstallationType[]
  }
}

interface ProjectedCommandState {
  command: Omit<ApplicationCommandSummary, "permissionSource">
}

interface MutableOptionSummary extends ApplicationCommandOptionSummary {}

const DISCORD_EPOCH_MS = 1_420_070_400_000n
const SNOWFLAKE_TIMESTAMP_SHIFT = 22n
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u
const COMMAND_KEYS = Object.freeze([
  "application_id",
  "contexts",
  "default_member_permissions",
  "default_permission",
  "description",
  "description_localizations",
  "description_localized",
  "dm_permission",
  "guild_id",
  "handler",
  "id",
  "integration_types",
  "name",
  "name_localizations",
  "name_localized",
  "nsfw",
  "options",
  "type",
  "version",
] as const)
const OPTION_KEYS = Object.freeze([
  "autocomplete",
  "channel_types",
  "choices",
  "description",
  "description_localizations",
  "description_localized",
  "max_length",
  "max_value",
  "min_length",
  "min_value",
  "name",
  "name_localizations",
  "name_localized",
  "options",
  "required",
  "type",
] as const)
const CHOICE_KEYS = Object.freeze([
  "name",
  "name_localizations",
  "name_localized",
  "value",
] as const)
const COMMAND_TYPE_NAMES = Object.freeze({
  1: "chat-input",
  2: "user",
  3: "message",
  4: "primary-entry-point",
} as const)
const CONTEXT_NAMES = Object.freeze({
  0: "guild",
  1: "bot-dm",
  2: "private-channel",
} as const)
const INSTALLATION_TYPE_NAMES = Object.freeze({
  0: "guild-install",
  1: "user-install",
} as const)
const OPTION_TYPE_NAMES = Object.freeze({
  1: "subcommand",
  2: "subcommandGroup",
  3: "string",
  4: "integer",
  5: "boolean",
  6: "user",
  7: "channel",
  8: "role",
  9: "mentionable",
  10: "number",
  11: "attachment",
} as const)
const KNOWN_CHANNEL_TYPES = new Set([0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 16])
const MAXIMUM_COMMAND_FIELDS = 32
const MAXIMUM_OPTION_FIELDS = 32
const MAXIMUM_OPTION_NODES = 1_000
const MAXIMUM_OPTION_DEPTH = 3
const MAXIMUM_OPTIONS = 25
const MAXIMUM_CHOICES = 25
const MAXIMUM_CHANNEL_TYPES = 32
const MAXIMUM_LOCALIZATIONS = 32
const MAXIMUM_NUMERIC_VOCABULARY_VALUES = 16
const MAXIMUM_APPLICATION_INSTALLATION_TYPES = 100
const MAXIMUM_LOCALE_CHARACTERS = 20
const MAXIMUM_CHOICE_CHARACTERS = 100
const MAXIMUM_DESCRIPTION_CHARACTERS = 100
const MAXIMUM_NAME_CHARACTERS = 32
const MAXIMUM_OPTION_NAME_CHARACTERS = 32
const MAXIMUM_OPTION_DESCRIPTION_CHARACTERS = 100
const PRIVACY_OMISSIONS = Object.freeze([
  "choice-names-and-values",
  "localization-values",
  "option-descriptions",
  "raw-command-definitions",
  "raw-discord-payloads",
  "raw-permission-bitfields",
  "role-and-channel-names",
  "user-profiles",
] as const)
const AUDIT_WARNINGS = Object.freeze([
  "The audit covers only commands owned by the connector's pinned application",
  "Known context exposure counts exclude unresolved Discord-default surfaces",
  "Omitted command installation types inherit the reported application configuration",
  "Discord command permission objects do not prove effective access for any individual member",
  "Command and guild names are transient untrusted review data and are not persisted",
  "The audit cannot read or mutate command permissions owned by another application",
] as const)

function evidenceError(): ApplicationCommandAuditEvidenceError {
  return new ApplicationCommandAuditEvidenceError(
    "Discord returned invalid application-command audit evidence",
  )
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertSnowflake(value: unknown): asserts value is string {
  if (!positiveSnowflake(value)) throw evidenceError()
}

function snowflakeTimestamp(value: string): string {
  const milliseconds = (BigInt(value) >> SNOWFLAKE_TIMESTAMP_SHIFT) + DISCORD_EPOCH_MS
  const date = new Date(Number(milliseconds))
  if (Number.isNaN(date.getTime())) throw evidenceError()
  return date.toISOString()
}

function recordValue(value: unknown, maximumFields: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw evidenceError()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length > maximumFields) throw evidenceError()
  return record
}

function unknownFields(record: Record<string, unknown>, known: readonly string[]): number {
  return Object.keys(record).filter((key) => !known.includes(key)).length
}

function textValue(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string"
    || value.length < minimum
    || value.length > maximum
    || CONTROL_PATTERN.test(value)
    || !validUnicode(value)
  ) throw evidenceError()
  return value
}

function optionalTextValue(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === null) return 0
  return textValue(value, minimum, maximum).length
}

function localizationCount(value: unknown, maximumValueCharacters: number): number {
  if (value === undefined || value === null) return 0
  const record = recordValue(value, MAXIMUM_LOCALIZATIONS)
  for (const [locale, localized] of Object.entries(record)) {
    textValue(locale, 2, MAXIMUM_LOCALE_CHARACTERS)
    textValue(localized, 1, maximumValueCharacters)
  }
  return Object.keys(record).length
}

function integerValue(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw evidenceError()
  }
  return value as number
}

function projectApplicationEvidence(
  value: ApplicationCommandAuditApplicationEvidence,
): ApplicationCommandAuditResult["application"] {
  assertSnowflake(value?.id)
  assertSnowflake(value?.botId)
  const installationTypes = value?.installationTypes
  if (
    !installationTypes
    || typeof installationTypes !== "object"
    || Array.isArray(installationTypes)
    || typeof installationTypes.reported !== "boolean"
    || !Array.isArray(installationTypes.values)
  ) throw evidenceError()
  const unknownValues = integerValue(
    installationTypes.unknownValues,
    0,
    MAXIMUM_APPLICATION_INSTALLATION_TYPES,
  )
  const values = [...installationTypes.values]
  if (
    values.length > Object.keys(INSTALLATION_TYPE_NAMES).length
    || values.some((entry) => entry !== "guild-install" && entry !== "user-install")
    || new Set(values).size !== values.length
    || (!installationTypes.reported && (values.length > 0 || unknownValues > 0))
  ) throw evidenceError()
  values.sort((left, right) => (
    left === right ? 0 : left === "guild-install" ? -1 : 1
  ))
  return {
    botId: value.botId,
    id: value.id,
    installationTypes: {
      complete: installationTypes.reported && unknownValues === 0,
      reported: installationTypes.reported,
      unknownValues,
      values,
    },
  }
}

function emptyOptionSummary(): MutableOptionSummary {
  return {
    autocomplete: 0,
    channelTypeConstraints: 0,
    choices: 0,
    localizationValues: 0,
    maximumDepth: 0,
    required: 0,
    topLevel: 0,
    total: 0,
    typeCounts: {
      attachment: 0,
      boolean: 0,
      channel: 0,
      integer: 0,
      mentionable: 0,
      number: 0,
      role: 0,
      string: 0,
      subcommand: 0,
      subcommandGroup: 0,
      user: 0,
    },
    unknownChannelTypes: 0,
    unknownFields: 0,
    unknownTypes: 0,
  }
}

function summarizeChoices(value: unknown, summary: MutableOptionSummary): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > MAXIMUM_CHOICES) {
    throw evidenceError()
  }
  for (const choice of value) {
    const record = recordValue(choice, 8)
    textValue(record.name, 1, MAXIMUM_CHOICE_CHARACTERS)
    const choiceValue = record.value
    if (
      !(typeof choiceValue === "string"
        ? choiceValue.length >= 1
          && choiceValue.length <= MAXIMUM_CHOICE_CHARACTERS
          && !CONTROL_PATTERN.test(choiceValue)
          && validUnicode(choiceValue)
        : typeof choiceValue === "number" && Number.isFinite(choiceValue))
    ) throw evidenceError()
    summary.localizationValues += localizationCount(
      record.name_localizations,
      MAXIMUM_CHOICE_CHARACTERS,
    )
    summary.localizationValues += optionalTextValue(
      record.name_localized,
      1,
      MAXIMUM_CHOICE_CHARACTERS,
    ) > 0 ? 1 : 0
    summary.unknownFields += unknownFields(record, CHOICE_KEYS)
  }
  summary.choices += value.length
}

function summarizeOptionArray(
  value: unknown,
  depth: number,
  parentType: number | null,
  summary: MutableOptionSummary,
  seen: Set<object>,
): number[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_OPTIONS || depth > MAXIMUM_OPTION_DEPTH) {
    throw evidenceError()
  }
  if (depth === 1) summary.topLevel = value.length
  const types: number[] = []
  for (const option of value) {
    const record = recordValue(option, MAXIMUM_OPTION_FIELDS)
    if (seen.has(record)) throw evidenceError()
    seen.add(record)
    summary.total += 1
    if (summary.total > MAXIMUM_OPTION_NODES) throw evidenceError()
    summary.maximumDepth = Math.max(summary.maximumDepth, depth)
    const type = integerValue(record.type, 1, 100)
    types.push(type)
    const typeName = OPTION_TYPE_NAMES[type as keyof typeof OPTION_TYPE_NAMES]
    if (typeName) summary.typeCounts[typeName] += 1
    else summary.unknownTypes += 1
    textValue(record.name, 1, MAXIMUM_OPTION_NAME_CHARACTERS)
    textValue(record.description, 1, MAXIMUM_OPTION_DESCRIPTION_CHARACTERS)
    summary.localizationValues += localizationCount(
      record.name_localizations,
      MAXIMUM_OPTION_NAME_CHARACTERS,
    )
    summary.localizationValues += localizationCount(
      record.description_localizations,
      MAXIMUM_OPTION_DESCRIPTION_CHARACTERS,
    )
    summary.localizationValues += optionalTextValue(
      record.name_localized,
      1,
      MAXIMUM_OPTION_NAME_CHARACTERS,
    ) > 0 ? 1 : 0
    summary.localizationValues += optionalTextValue(
      record.description_localized,
      1,
      MAXIMUM_OPTION_DESCRIPTION_CHARACTERS,
    ) > 0 ? 1 : 0
    if (record.required !== undefined) {
      if (typeof record.required !== "boolean") throw evidenceError()
      if (record.required) summary.required += 1
    }
    if (record.autocomplete !== undefined) {
      if (typeof record.autocomplete !== "boolean") throw evidenceError()
      if (record.autocomplete) summary.autocomplete += 1
    }
    if (record.min_length !== undefined) integerValue(record.min_length, 0, 6_000)
    if (record.max_length !== undefined) integerValue(record.max_length, 1, 6_000)
    for (const key of ["min_value", "max_value"] as const) {
      if (record[key] !== undefined && (
        typeof record[key] !== "number" || !Number.isFinite(record[key])
      )) throw evidenceError()
    }
    if (record.channel_types !== undefined) {
      if (
        !Array.isArray(record.channel_types)
        || record.channel_types.length > MAXIMUM_CHANNEL_TYPES
      ) {
        throw evidenceError()
      }
      const channelTypes = record.channel_types.map((entry) => integerValue(entry, 0, 100))
      if (new Set(channelTypes).size !== channelTypes.length) throw evidenceError()
      summary.channelTypeConstraints += channelTypes.length
      summary.unknownChannelTypes += channelTypes.filter((entry) => (
        !KNOWN_CHANNEL_TYPES.has(entry)
      )).length
    }
    summarizeChoices(record.choices, summary)
    if (record.autocomplete === true && Array.isArray(record.choices)) throw evidenceError()
    if (record.options !== undefined) {
      if (type !== 1 && type !== 2) throw evidenceError()
      const childTypes = summarizeOptionArray(
        record.options,
        depth + 1,
        type,
        summary,
        seen,
      )
      if (type === 2 && childTypes.some((childType) => childType !== 1)) throw evidenceError()
      if (type === 1 && childTypes.some((childType) => childType === 1 || childType === 2)) {
        throw evidenceError()
      }
    } else if (type === 2) {
      throw evidenceError()
    }
    summary.unknownFields += unknownFields(record, OPTION_KEYS)
    seen.delete(record)
  }
  if (parentType === null) {
    const nested = types.some((type) => type === 1 || type === 2)
    if (nested && types.some((type) => type !== 1 && type !== 2)) throw evidenceError()
  }
  return types
}

function summarizeOptions(value: unknown): ApplicationCommandOptionSummary {
  const summary = emptyOptionSummary()
  if (value === undefined) return summary
  summarizeOptionArray(value, 1, null, summary, new Set())
  return summary
}

function numericVocabulary<T extends string>(
  value: unknown,
  vocabulary: Readonly<Record<number, T>>,
  maximumItems: number,
): { reported: boolean; unknownValues: number; values: T[] } {
  if (value === undefined || value === null) {
    return { reported: false, unknownValues: 0, values: [] }
  }
  if (!Array.isArray(value) || value.length > maximumItems) throw evidenceError()
  const numbers = value
    .map((entry) => integerValue(entry, 0, 100))
    .sort((left, right) => left - right)
  if (new Set(numbers).size !== numbers.length) throw evidenceError()
  const values: T[] = []
  let unknownValues = 0
  for (const entry of numbers) {
    const name = vocabulary[entry]
    if (name) values.push(name)
    else unknownValues += 1
  }
  return { reported: true, unknownValues, values }
}

function commandContexts(
  value: ReturnType<typeof numericVocabulary<ApplicationCommandContext>>,
  scope: ApplicationCommandScope,
): ApplicationCommandSummary["contexts"] {
  if (scope === "guild") {
    if (value.values.some((entry) => entry !== "guild")) throw evidenceError()
    return {
      complete: value.unknownValues === 0,
      source: "guild-scope",
      unknownValues: value.unknownValues,
      values: ["guild"],
    }
  }
  if (value.reported) {
    return {
      complete: value.unknownValues === 0,
      source: "command",
      unknownValues: value.unknownValues,
      values: value.values,
    }
  }
  return {
    complete: false,
    source: "discord-default",
    unknownValues: 0,
    values: [],
  }
}

function commandInstallationTypes(
  value: ReturnType<typeof numericVocabulary<ApplicationCommandInstallationType>>,
  scope: ApplicationCommandScope,
  application: ApplicationCommandAuditResult["application"],
): ApplicationCommandSummary["installationTypes"] {
  if (scope === "guild") {
    if (value.values.some((entry) => entry !== "guild-install")) throw evidenceError()
    return {
      complete: value.unknownValues === 0,
      source: "guild-scope",
      unknownValues: value.unknownValues,
      values: ["guild-install"],
    }
  }
  if (value.reported) {
    return {
      complete: value.unknownValues === 0,
      source: "command",
      unknownValues: value.unknownValues,
      values: value.values,
    }
  }
  return {
    complete: application.installationTypes.complete,
    source: "application-default",
    unknownValues: application.installationTypes.unknownValues,
    values: [...application.installationTypes.values],
  }
}

function commandType(value: unknown): { code: number; name: ApplicationCommandType } {
  const code = integerValue(value, 1, 100)
  return {
    code,
    name: COMMAND_TYPE_NAMES[code as keyof typeof COMMAND_TYPE_NAMES] ?? "unknown",
  }
}

function defaultPermissions(value: unknown): {
  defaultAccess: ApplicationCommandSummary["defaultAccess"]
  names: DiscordPermissionName[]
  unknownBits: string
} {
  if (value === undefined || value === null) {
    return {
      defaultAccess: "discord-default",
      names: [],
      unknownBits: "0",
    }
  }
  if (typeof value !== "string") throw evidenceError()
  let bits: bigint
  try {
    bits = parseDiscordPermissionBits(value, "application command default-member")
  } catch {
    throw evidenceError()
  }
  const unknownBits = bits & ~ALL_KNOWN_PERMISSION_BITS
  return {
    defaultAccess: bits === 0n
      ? "administrator-or-explicit-allow"
      : "named-permissions",
    names: discordPermissionNames(bits),
    unknownBits: unknownBits.toString(),
  }
}

function projectCommand(
  value: unknown,
  application: ApplicationCommandAuditResult["application"],
  guildId: string,
  scope: ApplicationCommandScope,
): ProjectedCommandState {
  const record = recordValue(value, MAXIMUM_COMMAND_FIELDS)
  assertSnowflake(record.id)
  assertSnowflake(record.version)
  if (record.application_id !== application.id) throw evidenceError()
  if (scope === "guild") {
    if (record.guild_id !== guildId) throw evidenceError()
  } else if (record.guild_id !== undefined && record.guild_id !== null) {
    throw evidenceError()
  }
  const type = commandType(record.type)
  const name = textValue(record.name, 1, MAXIMUM_NAME_CHARACTERS)
  const description = textValue(
    record.description,
    type.name === "chat-input" ? 1 : 0,
    MAXIMUM_DESCRIPTION_CHARACTERS,
  )
  const contexts = commandContexts(
    numericVocabulary(
      record.contexts,
      CONTEXT_NAMES,
      MAXIMUM_NUMERIC_VOCABULARY_VALUES,
    ),
    scope,
  )
  const installationTypes = commandInstallationTypes(
    numericVocabulary(
      record.integration_types,
      INSTALLATION_TYPE_NAMES,
      MAXIMUM_NUMERIC_VOCABULARY_VALUES,
    ),
    scope,
    application,
  )
  const permissions = defaultPermissions(record.default_member_permissions)
  if (record.nsfw !== undefined && typeof record.nsfw !== "boolean") throw evidenceError()
  if (
    record.dm_permission !== undefined
    && record.dm_permission !== null
    && typeof record.dm_permission !== "boolean"
  ) throw evidenceError()
  if (
    record.default_permission !== undefined
    && record.default_permission !== null
    && typeof record.default_permission !== "boolean"
  ) throw evidenceError()
  let handler: ApplicationCommandSummary["handler"] = null
  if (record.handler !== undefined && record.handler !== null) {
    const handlerValue = integerValue(record.handler, 1, 100)
    handler = handlerValue === 1
      ? "application"
      : handlerValue === 2 ? "discord-launch-activity" : "unknown"
  }
  const options = summarizeOptions(record.options)
  if (type.name !== "chat-input" && options.total > 0) throw evidenceError()
  const localizationValues = localizationCount(
    record.name_localizations,
    MAXIMUM_NAME_CHARACTERS,
  ) + localizationCount(
    record.description_localizations,
    MAXIMUM_DESCRIPTION_CHARACTERS,
  ) + (optionalTextValue(
    record.name_localized,
    1,
    MAXIMUM_NAME_CHARACTERS,
  ) > 0 ? 1 : 0) + (optionalTextValue(
    record.description_localized,
    1,
    MAXIMUM_DESCRIPTION_CHARACTERS,
  ) > 0 ? 1 : 0)
  return {
    command: {
      contexts,
      createdAt: snowflakeTimestamp(record.id),
      defaultAccess: permissions.defaultAccess,
      defaultMemberPermissionNames: permissions.names,
      deprecatedDefaultPermission: record.default_permission ?? null,
      deprecatedDmPermission: record.dm_permission ?? null,
      descriptionCharacters: description.length,
      guildId: scope === "guild" ? guildId : null,
      handler,
      id: record.id,
      installationTypes,
      localizationValues: localizationValues + options.localizationValues,
      name,
      nameCharacters: name.length,
      nsfw: record.nsfw ?? false,
      nsfwReported: record.nsfw !== undefined,
      options,
      scope,
      type,
      unknownFieldCount: unknownFields(record, COMMAND_KEYS),
      unknownPermissionBits: permissions.unknownBits,
      version: record.version,
      versionCreatedAt: snowflakeTimestamp(record.version),
    },
  }
}

function projectInventory(
  value: DiscordApplicationCommand[],
  maximum: number,
  application: ApplicationCommandAuditResult["application"],
  guildId: string,
  scope: ApplicationCommandScope,
  ids: Set<string>,
): ProjectedCommandState[] {
  if (!Array.isArray(value) || value.length > maximum) throw evidenceError()
  const projected = value.map((entry) => projectCommand(
    entry,
    application,
    guildId,
    scope,
  ))
  const scopeKeys = new Set<string>()
  for (const { command } of projected) {
    if (ids.has(command.id)) throw evidenceError()
    ids.add(command.id)
    const key = `${command.type.code}:${command.name}`
    if (scopeKeys.has(key)) throw evidenceError()
    scopeKeys.add(key)
  }
  return projected.sort((left, right) => (
    BigInt(left.command.id) < BigInt(right.command.id) ? -1 : 1
  ))
}

function exactGuild(value: DiscordGuild, guildId: string): { id: string; name: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.id !== guildId) {
    throw evidenceError()
  }
  return {
    id: guildId,
    name: textValue(value.name, 1, 100),
  }
}

function permissionTarget(
  type: 1 | 2 | 3,
  id: string,
  guildId: string,
): ApplicationCommandPermissionTarget {
  if (type === 1) return id === guildId ? "everyone" : "role"
  if (type === 2) return "user"
  return id === (BigInt(guildId) - 1n).toString() ? "all-channels" : "channel"
}

function projectPermissionSets(
  value: DiscordGuildApplicationCommandPermissions[],
  applicationId: string,
  guildId: string,
  commands: readonly ProjectedCommandState[],
): ApplicationCommandPermissionSet[] {
  if (!Array.isArray(value) || value.length > DISCORD_LIMITS.guildApplicationCommandPermissions) {
    throw evidenceError()
  }
  const commandById = new Map(commands.map(({ command }) => [command.id, command]))
  const seen = new Set<string>()
  return value.map((entry) => {
    const entryKeys = Object.keys(entry as unknown as Record<string, unknown>).sort()
    if (
      !entry
      || typeof entry !== "object"
      || Array.isArray(entry)
      || entry.applicationId !== applicationId
      || entry.guildId !== guildId
      || !positiveSnowflake(entry.commandId)
      || seen.has(entry.commandId)
      || !Number.isSafeInteger(entry.unknownFieldCount)
      || entry.unknownFieldCount < 0
      || !Array.isArray(entry.permissions)
      || entry.permissions.length > DISCORD_LIMITS.applicationCommandPermissionOverwrites
      || entryKeys.join("\0")
        !== "applicationId\0commandId\0guildId\0permissions\0unknownFieldCount"
    ) throw evidenceError()
    seen.add(entry.commandId)
    const applicationDefault = entry.commandId === applicationId
    const command = commandById.get(entry.commandId)
    if (!applicationDefault && !command) throw evidenceError()
    const decisionKeys = new Set<string>()
    const decisions = entry.permissions.map((permission) => {
      const permissionKeys = Object.keys(
        permission as unknown as Record<string, unknown>,
      ).sort()
      if (
        !permission
        || typeof permission !== "object"
        || Array.isArray(permission)
        || !positiveSnowflake(permission.id)
        || (permission.type !== 1 && permission.type !== 2 && permission.type !== 3)
        || typeof permission.allowed !== "boolean"
        || !Number.isSafeInteger(permission.unknownFieldCount)
        || permission.unknownFieldCount < 0
        || permissionKeys.join("\0")
          !== "allowed\0id\0type\0unknownFieldCount"
      ) throw evidenceError()
      const decisionKey = `${permission.type}:${permission.id}`
      if (decisionKeys.has(decisionKey)) throw evidenceError()
      decisionKeys.add(decisionKey)
      return {
        allowed: permission.allowed,
        id: permission.id,
        target: permissionTarget(permission.type, permission.id, guildId),
        type: permission.type,
        unknownFieldCount: permission.unknownFieldCount,
      }
    }).sort((left, right) => (
      left.type - right.type
      || (BigInt(left.id) < BigInt(right.id) ? -1 : 1)
    )).map(({ type: _type, ...decision }) => decision)
    return {
      commandId: applicationDefault ? null : entry.commandId,
      commandName: command?.name ?? null,
      decisions,
      id: entry.commandId,
      scope: command?.scope ?? null,
      source: applicationDefault
        ? "application-default" as const
        : "command-specific" as const,
      unknownFieldCount: entry.unknownFieldCount,
    }
  }).sort((left, right) => (
    left.source === right.source
      ? BigInt(left.id) < BigInt(right.id) ? -1 : 1
      : left.source === "application-default" ? -1 : 1
  ))
}

function commandPermissionSource(
  commandId: string,
  permissionSets: readonly ApplicationCommandPermissionSet[],
): ApplicationCommandPermissionSource {
  if (permissionSets.some((entry) => entry.commandId === commandId)) {
    return "command-specific"
  }
  if (permissionSets.some((entry) => entry.source === "application-default")) {
    return "application-default"
  }
  return "discord-default"
}

function exposure(
  commands: readonly ApplicationCommandSummary[],
  permissionSets: readonly ApplicationCommandPermissionSet[],
): ApplicationCommandAuditResult["exposure"] {
  const decisions = permissionSets.flatMap((entry) => entry.decisions)
  return {
    commands: {
      administratorOrExplicitAllow: commands.filter(({ defaultAccess }) => (
        defaultAccess === "administrator-or-explicit-allow"
      )).length,
      applicationDefaultInstallationTypes: commands.filter(({ installationTypes }) => (
        installationTypes.source === "application-default"
      )).length,
      discordDefault: commands.filter(({ defaultAccess }) => (
        defaultAccess === "discord-default"
      )).length,
      discordDefaultContexts: commands.filter(({ contexts }) => (
        contexts.source === "discord-default"
      )).length,
      global: commands.filter(({ scope }) => scope === "global").length,
      guild: commands.filter(({ scope }) => scope === "guild").length,
      incompleteContexts: commands.filter(({ contexts }) => !contexts.complete).length,
      incompleteInstallationTypes: commands.filter(({ installationTypes }) => (
        !installationTypes.complete
      )).length,
      knownBotDm: commands.filter(({ contexts }) => (
        contexts.values.includes("bot-dm")
      )).length,
      knownPrivateChannel: commands.filter(({ contexts }) => (
        contexts.values.includes("private-channel")
      )).length,
      knownUserInstall: commands.filter(({ installationTypes }) => (
        installationTypes.values.includes("user-install")
      )).length,
      namedPermissions: commands.filter(({ defaultAccess }) => (
        defaultAccess === "named-permissions"
      )).length,
      nsfw: commands.filter(({ nsfw }) => nsfw).length,
      total: commands.length,
      unknownContextValues: commands.reduce((sum, command) => (
        sum + command.contexts.unknownValues
      ), 0),
      unknownInstallationTypeValues: commands.reduce((sum, command) => (
        sum + (command.installationTypes.source === "command"
          ? command.installationTypes.unknownValues
          : 0)
      ), 0),
      unknownTypes: commands.filter(({ type }) => type.name === "unknown").length,
    },
    evidence: {
      commandsWithUnknownPermissionBits: commands.filter(({ unknownPermissionBits }) => (
        unknownPermissionBits !== "0"
      )).length,
      unknownFields: commands.reduce((sum, command) => (
        sum + command.unknownFieldCount + command.options.unknownFields
      ), 0) + permissionSets.reduce((sum, permissionSet) => (
        sum + permissionSet.unknownFieldCount + permissionSet.decisions.reduce((decisionSum, decision) => (
          decisionSum + decision.unknownFieldCount
        ), 0)
      ), 0),
      unknownOptionTypes: commands.reduce((sum, command) => (
        sum + command.options.unknownTypes
      ), 0),
    },
    permissionSets: {
      allChannelDecisions: decisions.filter(({ target }) => target === "all-channels").length,
      allows: decisions.filter(({ allowed }) => allowed).length,
      applicationDefaults: permissionSets.filter(({ source }) => (
        source === "application-default"
      )).length,
      channelDecisions: decisions.filter(({ target }) => target === "channel").length,
      commandSpecific: permissionSets.filter(({ source }) => (
        source === "command-specific"
      )).length,
      decisions: decisions.length,
      denies: decisions.filter(({ allowed }) => !allowed).length,
      everyoneDecisions: decisions.filter(({ target }) => target === "everyone").length,
      roleDecisions: decisions.filter(({ target }) => target === "role").length,
      userDecisions: decisions.filter(({ target }) => target === "user").length,
    },
  }
}

export class ApplicationCommandAuditService {
  readonly #client: ApplicationCommandAuditServiceClient
  readonly #policy: ApplicationCommandAuditServiceOptions["policy"]

  constructor(options: ApplicationCommandAuditServiceOptions) {
    this.#client = options.client
    this.#policy = options.policy
  }

  async audit(
    applicationValue: ApplicationCommandAuditApplicationEvidence,
    guildId: string,
    options: RequestOptions = {},
  ): Promise<ApplicationCommandAuditResult> {
    const application = projectApplicationEvidence(applicationValue)
    assertSnowflake(guildId)
    this.#policy.assertGuildAllowed(guildId)
    const [guildValue, globalValue, guildCommandsValue, permissionValue] = await Promise.all([
      this.#client.getGuild(guildId, options),
      this.#client.listGlobalApplicationCommands(application.id, options),
      this.#client.listGuildApplicationCommands(application.id, guildId, options),
      this.#client.listGuildApplicationCommandPermissions(application.id, guildId, options),
    ])
    const guild = exactGuild(guildValue, guildId)
    const ids = new Set<string>()
    const globalCommands = projectInventory(
      globalValue,
      DISCORD_LIMITS.applicationCommandGlobalCommands,
      application,
      guildId,
      "global",
      ids,
    )
    const guildCommands = projectInventory(
      guildCommandsValue,
      DISCORD_LIMITS.applicationCommandGuildCommands,
      application,
      guildId,
      "guild",
      ids,
    )
    const projected = [...globalCommands, ...guildCommands]
    const permissionSets = projectPermissionSets(
      permissionValue,
      application.id,
      guildId,
      projected,
    )
    const commands = projected.map(({ command }) => ({
      ...command,
      permissionSource: commandPermissionSource(command.id, permissionSets),
    }))
    return {
      application,
      commands,
      exposure: exposure(commands, permissionSets),
      guild,
      inventory: {
        completeness: "complete-current-application",
        global: globalCommands.length,
        guild: guildCommands.length,
        permissions: permissionSets.length,
        total: commands.length,
      },
      permissions: permissionSets,
      privacy: {
        omitted: PRIVACY_OMISSIONS,
        persistence: "none",
        rawPayloads: "omitted",
        text: "transient-untrusted",
        unknownFields: "counts-only",
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
      warnings: AUDIT_WARNINGS,
    }
  }
}
