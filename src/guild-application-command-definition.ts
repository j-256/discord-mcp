import { createHash } from "node:crypto"

import {
  CHANNEL_TYPE_NAMES,
  DISCORD_LOCALES,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  type DiscordLocale,
} from "./constants.js"
import { stableString } from "./normalize.js"
import {
  ALL_KNOWN_PERMISSION_BITS,
  DISCORD_PERMISSION_NAMES,
  DISCORD_PERMISSIONS,
  parseDiscordPermissionBits,
  type DiscordPermissionName,
} from "./permissions.js"
import type {
  DiscordApplicationCommand,
  DiscordApplicationCommandOption,
  DiscordApplicationCommandOptionChoice,
} from "./types.js"

export const GUILD_APPLICATION_COMMAND_TYPES = Object.freeze([
  "chat-input",
  "user",
  "message",
] as const)

export type GuildApplicationCommandType =
  typeof GUILD_APPLICATION_COMMAND_TYPES[number]

export const GUILD_APPLICATION_COMMAND_OPTION_TYPES = Object.freeze([
  "subcommand",
  "subcommand-group",
  "string",
  "integer",
  "boolean",
  "user",
  "channel",
  "role",
  "mentionable",
  "number",
  "attachment",
] as const)

export type GuildApplicationCommandOptionType =
  typeof GUILD_APPLICATION_COMMAND_OPTION_TYPES[number]

export const DISCORD_APPLICATION_COMMAND_LOCALES = DISCORD_LOCALES

export type DiscordApplicationCommandLocale = DiscordLocale

export const GUILD_APPLICATION_COMMAND_CHANNEL_TYPES = Object.freeze([
  "guild-text",
  "guild-voice",
  "guild-category",
  "guild-announcement",
  "announcement-thread",
  "public-thread",
  "private-thread",
  "guild-stage-voice",
  "guild-directory",
  "guild-forum",
  "guild-media",
] as const)

export type GuildApplicationCommandChannelType =
  typeof GUILD_APPLICATION_COMMAND_CHANNEL_TYPES[number]

export const GUILD_APPLICATION_COMMAND_FILE_TYPE_GROUPS = Object.freeze([
  "image",
  "video",
  "audio",
] as const)

export type GuildApplicationCommandFileTypeGroup =
  typeof GUILD_APPLICATION_COMMAND_FILE_TYPE_GROUPS[number]

export type GuildApplicationCommandFileType =
  | GuildApplicationCommandFileTypeGroup
  | `.${string}`

export interface GuildApplicationCommandLocalization {
  locale: DiscordApplicationCommandLocale
  value: string
}

export interface GuildApplicationCommandChoice {
  name: string
  nameLocalizations: GuildApplicationCommandLocalization[]
  value: number | string
}

interface GuildApplicationCommandOptionBase {
  description: string
  descriptionLocalizations: GuildApplicationCommandLocalization[]
  name: string
  nameLocalizations: GuildApplicationCommandLocalization[]
  type: GuildApplicationCommandOptionType
}

export interface GuildApplicationCommandSubcommandOption
  extends GuildApplicationCommandOptionBase {
  options: GuildApplicationCommandScalarOption[]
  type: "subcommand"
}

export interface GuildApplicationCommandSubcommandGroupOption
  extends GuildApplicationCommandOptionBase {
  options: GuildApplicationCommandSubcommandOption[]
  type: "subcommand-group"
}

interface GuildApplicationCommandScalarOptionBase
  extends GuildApplicationCommandOptionBase {
  required: boolean
}

export interface GuildApplicationCommandStringOption
  extends GuildApplicationCommandScalarOptionBase {
  autocomplete: boolean
  choices: GuildApplicationCommandChoice[]
  maxLength?: number
  minLength?: number
  type: "string"
}

export interface GuildApplicationCommandIntegerOption
  extends GuildApplicationCommandScalarOptionBase {
  autocomplete: boolean
  choices: GuildApplicationCommandChoice[]
  maximum?: number
  minimum?: number
  type: "integer"
}

export interface GuildApplicationCommandNumberOption
  extends GuildApplicationCommandScalarOptionBase {
  autocomplete: boolean
  choices: GuildApplicationCommandChoice[]
  maximum?: number
  minimum?: number
  type: "number"
}

export interface GuildApplicationCommandChannelOption
  extends GuildApplicationCommandScalarOptionBase {
  channelTypes: GuildApplicationCommandChannelType[]
  type: "channel"
}

export interface GuildApplicationCommandAttachmentOption
  extends GuildApplicationCommandScalarOptionBase {
  fileTypes: GuildApplicationCommandFileType[]
  type: "attachment"
}

export interface GuildApplicationCommandSimpleOption
  extends GuildApplicationCommandScalarOptionBase {
  type: "boolean" | "mentionable" | "role" | "user"
}

export type GuildApplicationCommandScalarOption =
  | GuildApplicationCommandAttachmentOption
  | GuildApplicationCommandChannelOption
  | GuildApplicationCommandIntegerOption
  | GuildApplicationCommandNumberOption
  | GuildApplicationCommandSimpleOption
  | GuildApplicationCommandStringOption

export type GuildApplicationCommandOption =
  | GuildApplicationCommandScalarOption
  | GuildApplicationCommandSubcommandGroupOption
  | GuildApplicationCommandSubcommandOption

interface GuildApplicationCommandDefinitionBase {
  defaultMemberPermissions: DiscordPermissionName[] | null
  name: string
  nameLocalizations: GuildApplicationCommandLocalization[]
  nsfw: boolean
  type: GuildApplicationCommandType
}

export interface GuildChatInputApplicationCommandDefinition
  extends GuildApplicationCommandDefinitionBase {
  description: string
  descriptionLocalizations: GuildApplicationCommandLocalization[]
  options: GuildApplicationCommandOption[]
  type: "chat-input"
}

export interface GuildContextApplicationCommandDefinition
  extends GuildApplicationCommandDefinitionBase {
  type: "message" | "user"
}

export type GuildApplicationCommandDefinition =
  | GuildChatInputApplicationCommandDefinition
  | GuildContextApplicationCommandDefinition

export interface GuildApplicationCommandApiChoice {
  name: string
  name_localizations: Record<string, string> | null
  value: number | string
}

export interface GuildApplicationCommandApiOption {
  autocomplete?: boolean
  channel_types?: number[]
  choices?: GuildApplicationCommandApiChoice[]
  description: string
  description_localizations: Record<string, string> | null
  file_types?: string[]
  max_length?: number
  max_value?: number
  min_length?: number
  min_value?: number
  name: string
  name_localizations: Record<string, string> | null
  options?: GuildApplicationCommandApiOption[]
  required?: boolean
  type: number
}

export interface GuildApplicationCommandApiBody {
  default_member_permissions: string | null
  description?: string
  description_localizations?: Record<string, string> | null
  name: string
  name_localizations: Record<string, string> | null
  nsfw: boolean
  options?: GuildApplicationCommandApiOption[]
  type: number
}

export interface ProjectedGuildApplicationCommand {
  applicationId: string
  commandId: string
  definition: GuildApplicationCommandDefinition
  guildId: string
  immutableEvidence: {
    contexts: number[] | null
    defaultPermission: boolean | null
    dmPermission: boolean | null
    integrationTypes: number[] | null
  }
  version: string
}

export class GuildApplicationCommandDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GuildApplicationCommandDefinitionError"
  }
}

const COMMAND_TYPE_CODES = Object.freeze({
  "chat-input": 1,
  user: 2,
  message: 3,
} as const satisfies Record<GuildApplicationCommandType, number>)

const OPTION_TYPE_CODES = Object.freeze({
  subcommand: 1,
  "subcommand-group": 2,
  string: 3,
  integer: 4,
  boolean: 5,
  user: 6,
  channel: 7,
  role: 8,
  mentionable: 9,
  number: 10,
  attachment: 11,
} as const satisfies Record<GuildApplicationCommandOptionType, number>)

const COMMAND_TYPES_BY_CODE = new Map<number, GuildApplicationCommandType>(
  Object.entries(COMMAND_TYPE_CODES).map(([name, code]) => [
    code,
    name as GuildApplicationCommandType,
  ]),
)

const OPTION_TYPES_BY_CODE = new Map<number, GuildApplicationCommandOptionType>(
  Object.entries(OPTION_TYPE_CODES).map(([name, code]) => [
    code,
    name as GuildApplicationCommandOptionType,
  ]),
)

const CHANNEL_TYPE_CODES = new Map<GuildApplicationCommandChannelType, number>(
  Object.entries(CHANNEL_TYPE_NAMES)
    .map(([code, name]) => [
      name as GuildApplicationCommandChannelType,
      Number(code),
    ] as const)
    .filter(([name]) => (
      (GUILD_APPLICATION_COMMAND_CHANNEL_TYPES as readonly string[]).includes(name)
    )),
)

const CHANNEL_TYPES_BY_CODE = new Map<number, GuildApplicationCommandChannelType>(
  [...CHANNEL_TYPE_CODES].map(([name, code]) => [code, name]),
)

const LOCALE_ORDER = new Map(
  DISCORD_APPLICATION_COMMAND_LOCALES.map((locale, index) => [locale, index]),
)

const PERMISSION_ORDER = new Map(
  DISCORD_PERMISSION_NAMES.map((name, index) => [name, index]),
)

const FILE_TYPE_GROUP_ORDER = new Map(
  GUILD_APPLICATION_COMMAND_FILE_TYPE_GROUPS.map((name, index) => [name, index]),
)

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u
const CHAT_INPUT_NAME_PATTERN = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u
const FILE_EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9._+-]{0,31}$/u
const BASE_DEFINITION_KEYS = [
  "defaultMemberPermissions",
  "name",
  "nameLocalizations",
  "nsfw",
  "type",
] as const
const CHAT_INPUT_DEFINITION_KEYS = [
  ...BASE_DEFINITION_KEYS,
  "description",
  "descriptionLocalizations",
  "options",
] as const
const OPTION_BASE_KEYS = [
  "description",
  "descriptionLocalizations",
  "name",
  "nameLocalizations",
  "type",
] as const
const OPTION_REQUIRED_KEYS = ["description", "name", "type"] as const
const SCALAR_OPTION_KEYS = [...OPTION_BASE_KEYS, "required"] as const
const CHOICE_OPTION_KEYS = [...SCALAR_OPTION_KEYS, "autocomplete", "choices"] as const
const STRING_OPTION_KEYS = [...CHOICE_OPTION_KEYS, "maxLength", "minLength"] as const
const NUMBER_OPTION_KEYS = [...CHOICE_OPTION_KEYS, "maximum", "minimum"] as const
const CHANNEL_OPTION_KEYS = [...SCALAR_OPTION_KEYS, "channelTypes"] as const
const ATTACHMENT_OPTION_KEYS = [...SCALAR_OPTION_KEYS, "fileTypes"] as const
const NESTED_OPTION_KEYS = [...OPTION_BASE_KEYS, "options"] as const
const LOCALIZATION_KEYS = ["locale", "value"] as const
const CHOICE_KEYS = ["name", "nameLocalizations", "value"] as const
const RAW_COMMAND_KEYS = [
  "application_id",
  "contexts",
  "default_member_permissions",
  "default_permission",
  "description",
  "description_localizations",
  "dm_permission",
  "guild_id",
  "handler",
  "id",
  "integration_types",
  "name",
  "name_localizations",
  "nsfw",
  "options",
  "type",
  "version",
] as const
const RAW_OPTION_BASE_KEYS = [
  "description",
  "description_localizations",
  "name",
  "name_localizations",
  "type",
] as const
const RAW_OPTION_REQUIRED_KEYS = ["description", "name", "type"] as const
const RAW_SCALAR_OPTION_KEYS = [...RAW_OPTION_BASE_KEYS, "required"] as const
const RAW_CHOICE_OPTION_KEYS = [
  ...RAW_SCALAR_OPTION_KEYS,
  "autocomplete",
  "choices",
] as const
const RAW_STRING_OPTION_KEYS = [
  ...RAW_CHOICE_OPTION_KEYS,
  "max_length",
  "min_length",
] as const
const RAW_NUMBER_OPTION_KEYS = [
  ...RAW_CHOICE_OPTION_KEYS,
  "max_value",
  "min_value",
] as const
const RAW_CHANNEL_OPTION_KEYS = [...RAW_SCALAR_OPTION_KEYS, "channel_types"] as const
const RAW_ATTACHMENT_OPTION_KEYS = [...RAW_SCALAR_OPTION_KEYS, "file_types"] as const
const RAW_NESTED_OPTION_KEYS = [...RAW_OPTION_BASE_KEYS, "options"] as const
const RAW_CHOICE_KEYS = ["name", "name_localizations", "value"] as const
const NUMBER_BOUND = 2 ** 53

function fail(path: string, message: string): never {
  throw new GuildApplicationCommandDefinitionError(`${path} ${message}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be an object")
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  if (
    actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])
  ) {
    fail(path, `must contain exactly ${canonical.join(", ")}`)
  }
}

function exactOptionalKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const known = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !known.has(key))
  const missing = required.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0 || missing.length > 0) {
    const details = [
      unknown.length > 0 ? `unknown fields ${unknown.sort().join(", ")}` : "",
      missing.length > 0 ? `missing fields ${missing.join(", ")}` : "",
    ].filter(Boolean).join("; ")
    fail(path, details)
  }
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "must be a string")
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean")
  return value
}

function characterLength(value: string): number {
  return [...value].length
}

function safeText(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): string {
  const text = stringValue(value, path)
  const characters = characterLength(text)
  if (
    characters < minimum
    || characters > maximum
    || text.trim() !== text
    || text.normalize("NFC") !== text
    || CONTROL_CHARACTER_PATTERN.test(text)
  ) {
    fail(path, `must be canonical control-free text of ${minimum}-${maximum} characters`)
  }
  return text
}

function chatInputName(value: unknown, path: string): string {
  const name = safeText(
    value,
    1,
    DISCORD_LIMITS.applicationCommandNameCharacters,
    path,
  )
  if (!CHAT_INPUT_NAME_PATTERN.test(name) || name.toLowerCase() !== name) {
    fail(path, "must use Discord's lowercase chat-input name syntax")
  }
  return name
}

function contextName(value: unknown, path: string): string {
  return safeText(
    value,
    1,
    DISCORD_LIMITS.applicationCommandNameCharacters,
    path,
  )
}

function description(value: unknown, path: string): string {
  return safeText(
    value,
    1,
    DISCORD_LIMITS.applicationCommandDescriptionCharacters,
    path,
  )
}

function choiceText(value: unknown, path: string): string {
  return safeText(
    value,
    1,
    DISCORD_LIMITS.applicationCommandChoiceCharacters,
    path,
  )
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(path, `must be one of ${values.join(", ")}`)
  }
  return value as T
}

function optionalArray(value: unknown, path: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(path, "must be an array")
  return value
}

function localizationValues(
  value: unknown,
  valueParser: (entry: unknown, path: string) => string,
  path: string,
): GuildApplicationCommandLocalization[] {
  const entries = optionalArray(value, path)
  if (entries.length > DISCORD_APPLICATION_COMMAND_LOCALES.length) {
    fail(path, "contains too many locale values")
  }
  let previousIndex = -1
  const seen = new Set<DiscordApplicationCommandLocale>()
  return entries.map((entry, index) => {
    const item = record(entry, `${path}[${index}]`)
    exactKeys(item, LOCALIZATION_KEYS, `${path}[${index}]`)
    const locale = enumValue(
      item.locale,
      DISCORD_APPLICATION_COMMAND_LOCALES,
      `${path}[${index}].locale`,
    )
    const localeIndex = LOCALE_ORDER.get(locale) as number
    if (seen.has(locale) || localeIndex <= previousIndex) {
      fail(path, "must contain unique locales in canonical order")
    }
    seen.add(locale)
    previousIndex = localeIndex
    return {
      locale,
      value: valueParser(item.value, `${path}[${index}].value`),
    }
  })
}

function canonicalPermissions(
  value: unknown,
  path: string,
): DiscordPermissionName[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) fail(path, "must be null or an array")
  let previousIndex = -1
  const seen = new Set<DiscordPermissionName>()
  return value.map((entry, index) => {
    const name = enumValue(
      entry,
      DISCORD_PERMISSION_NAMES,
      `${path}[${index}]`,
    )
    const permissionIndex = PERMISSION_ORDER.get(name) as number
    if (seen.has(name) || permissionIndex <= previousIndex) {
      fail(path, "must contain unique permission names in canonical order")
    }
    seen.add(name)
    previousIndex = permissionIndex
    return name
  })
}

function scalarRequired(value: unknown, path: string): boolean {
  return value === undefined ? false : booleanValue(value, path)
}

function optionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(path, `must be a safe integer from ${minimum} through ${maximum}`)
  }
  return value as number
}

function optionalNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number from ${minimum} through ${maximum}`)
  }
  return value
}

function choiceValue(
  value: unknown,
  type: "integer" | "number" | "string",
  path: string,
): number | string {
  if (type === "string") return choiceText(value, path)
  if (type === "integer") {
    const parsed = optionalInteger(
      value,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      path,
    )
    if (parsed === undefined) fail(path, "must be an integer")
    return parsed
  }
  const parsed = optionalNumber(value, -NUMBER_BOUND, NUMBER_BOUND, path)
  if (parsed === undefined) fail(path, "must be a number")
  return parsed
}

function choices(
  value: unknown,
  type: "integer" | "number" | "string",
  path: string,
): GuildApplicationCommandChoice[] {
  const entries = optionalArray(value, path)
  if (entries.length > DISCORD_LIMITS.applicationCommandChoices) {
    fail(path, `must contain at most ${DISCORD_LIMITS.applicationCommandChoices} choices`)
  }
  const names = new Set<string>()
  const values = new Set<string>()
  return entries.map((entry, index) => {
    const item = record(entry, `${path}[${index}]`)
    exactOptionalKeys(item, CHOICE_KEYS, ["name", "value"], `${path}[${index}]`)
    const name = choiceText(item.name, `${path}[${index}].name`)
    const parsedValue = choiceValue(item.value, type, `${path}[${index}].value`)
    const valueKey = `${typeof parsedValue}:${String(parsedValue)}`
    if (names.has(name) || values.has(valueKey)) {
      fail(path, "must contain unique choice names and values")
    }
    names.add(name)
    values.add(valueKey)
    return {
      name,
      nameLocalizations: localizationValues(
        item.nameLocalizations,
        choiceText,
        `${path}[${index}].nameLocalizations`,
      ),
      value: parsedValue,
    }
  })
}

function canonicalChannelTypes(
  value: unknown,
  path: string,
): GuildApplicationCommandChannelType[] {
  const entries = optionalArray(value, path)
  let previousCode = -1
  const seen = new Set<GuildApplicationCommandChannelType>()
  return entries.map((entry, index) => {
    const name = enumValue(
      entry,
      GUILD_APPLICATION_COMMAND_CHANNEL_TYPES,
      `${path}[${index}]`,
    )
    const code = CHANNEL_TYPE_CODES.get(name) as number
    if (seen.has(name) || code <= previousCode) {
      fail(path, "must contain unique guild channel types in numeric order")
    }
    seen.add(name)
    previousCode = code
    return name
  })
}

function fileTypeOrder(left: string, right: string): number {
  const leftGroup = FILE_TYPE_GROUP_ORDER.get(left as GuildApplicationCommandFileTypeGroup)
  const rightGroup = FILE_TYPE_GROUP_ORDER.get(right as GuildApplicationCommandFileTypeGroup)
  if (leftGroup !== undefined || rightGroup !== undefined) {
    if (leftGroup === undefined) return 1
    if (rightGroup === undefined) return -1
    return leftGroup - rightGroup
  }
  return left.localeCompare(right)
}

function canonicalFileTypes(
  value: unknown,
  path: string,
): GuildApplicationCommandFileType[] {
  const entries = optionalArray(value, path)
  if (entries.length > DISCORD_LIMITS.applicationCommandFileTypes) {
    fail(path, `must contain at most ${DISCORD_LIMITS.applicationCommandFileTypes} file types`)
  }
  const parsed = entries.map((entry, index) => {
    const fileType = stringValue(entry, `${path}[${index}]`)
    if (
      !(GUILD_APPLICATION_COMMAND_FILE_TYPE_GROUPS as readonly string[]).includes(fileType)
      && !FILE_EXTENSION_PATTERN.test(fileType)
    ) {
      fail(`${path}[${index}]`, "must be image, video, audio, or a bounded lowercase extension")
    }
    return fileType as GuildApplicationCommandFileType
  })
  const canonical = [...new Set(parsed)].sort(fileTypeOrder)
  if (
    canonical.length !== parsed.length
    || canonical.some((entry, index) => entry !== parsed[index])
  ) {
    fail(path, "must contain unique file types in canonical order")
  }
  return parsed
}

function baseOption(
  item: Record<string, unknown>,
  type: GuildApplicationCommandOptionType,
  path: string,
): GuildApplicationCommandOptionBase {
  return {
    description: description(item.description, `${path}.description`),
    descriptionLocalizations: localizationValues(
      item.descriptionLocalizations,
      description,
      `${path}.descriptionLocalizations`,
    ),
    name: chatInputName(item.name, `${path}.name`),
    nameLocalizations: localizationValues(
      item.nameLocalizations,
      chatInputName,
      `${path}.nameLocalizations`,
    ),
    type,
  }
}

function scalarOption(
  item: Record<string, unknown>,
  type: Exclude<GuildApplicationCommandOptionType, "subcommand" | "subcommand-group">,
  path: string,
): GuildApplicationCommandScalarOption {
  if (type === "string") {
    exactOptionalKeys(item, STRING_OPTION_KEYS, OPTION_REQUIRED_KEYS, path)
    const parsedChoices = choices(item.choices, type, `${path}.choices`)
    const autocomplete = item.autocomplete === undefined
      ? false
      : booleanValue(item.autocomplete, `${path}.autocomplete`)
    if (autocomplete && parsedChoices.length > 0) {
      fail(path, "cannot combine autocomplete with choices")
    }
    const minLength = optionalInteger(
      item.minLength,
      0,
      DISCORD_LIMITS.applicationCommandStringCharacters,
      `${path}.minLength`,
    )
    const maxLength = optionalInteger(
      item.maxLength,
      1,
      DISCORD_LIMITS.applicationCommandStringCharacters,
      `${path}.maxLength`,
    )
    if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) {
      fail(path, "must not set minLength above maxLength")
    }
    return {
      ...baseOption(item, type, path),
      autocomplete,
      choices: parsedChoices,
      ...(maxLength === undefined ? {} : { maxLength }),
      ...(minLength === undefined ? {} : { minLength }),
      required: scalarRequired(item.required, `${path}.required`),
      type,
    }
  }
  if (type === "integer" || type === "number") {
    exactOptionalKeys(item, NUMBER_OPTION_KEYS, OPTION_REQUIRED_KEYS, path)
    const parsedChoices = choices(item.choices, type, `${path}.choices`)
    const autocomplete = item.autocomplete === undefined
      ? false
      : booleanValue(item.autocomplete, `${path}.autocomplete`)
    if (autocomplete && parsedChoices.length > 0) {
      fail(path, "cannot combine autocomplete with choices")
    }
    const minimum = type === "integer"
      ? optionalInteger(
        item.minimum,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        `${path}.minimum`,
      )
      : optionalNumber(item.minimum, -NUMBER_BOUND, NUMBER_BOUND, `${path}.minimum`)
    const maximum = type === "integer"
      ? optionalInteger(
        item.maximum,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        `${path}.maximum`,
      )
      : optionalNumber(item.maximum, -NUMBER_BOUND, NUMBER_BOUND, `${path}.maximum`)
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      fail(path, "must not set minimum above maximum")
    }
    return {
      ...baseOption(item, type, path),
      autocomplete,
      choices: parsedChoices,
      ...(maximum === undefined ? {} : { maximum }),
      ...(minimum === undefined ? {} : { minimum }),
      required: scalarRequired(item.required, `${path}.required`),
      type,
    }
  }
  if (type === "channel") {
    exactOptionalKeys(item, CHANNEL_OPTION_KEYS, OPTION_REQUIRED_KEYS, path)
    return {
      ...baseOption(item, type, path),
      channelTypes: canonicalChannelTypes(item.channelTypes, `${path}.channelTypes`),
      required: scalarRequired(item.required, `${path}.required`),
      type,
    }
  }
  if (type === "attachment") {
    exactOptionalKeys(item, ATTACHMENT_OPTION_KEYS, OPTION_REQUIRED_KEYS, path)
    return {
      ...baseOption(item, type, path),
      fileTypes: canonicalFileTypes(item.fileTypes, `${path}.fileTypes`),
      required: scalarRequired(item.required, `${path}.required`),
      type,
    }
  }
  exactOptionalKeys(item, SCALAR_OPTION_KEYS, OPTION_REQUIRED_KEYS, path)
  return {
    ...baseOption(item, type, path),
    required: scalarRequired(item.required, `${path}.required`),
    type,
  }
}

type OptionLevel = "group" | "subcommand" | "top"

function commandOptions(
  value: unknown,
  level: OptionLevel,
  path: string,
): GuildApplicationCommandOption[] {
  const entries = optionalArray(value, path)
  if (entries.length > DISCORD_LIMITS.applicationCommandOptions) {
    fail(path, `must contain at most ${DISCORD_LIMITS.applicationCommandOptions} options`)
  }
  const names = new Set<string>()
  let optionalScalarSeen = false
  let scalarMode: boolean | null = null
  return entries.map((entry, index) => {
    const item = record(entry, `${path}[${index}]`)
    const type = enumValue(
      item.type,
      GUILD_APPLICATION_COMMAND_OPTION_TYPES,
      `${path}[${index}].type`,
    )
    const optionPath = `${path}[${index}]`
    if (level === "group" && type !== "subcommand") {
      fail(optionPath, "must be a subcommand inside a subcommand group")
    }
    if (level === "subcommand" && (type === "subcommand" || type === "subcommand-group")) {
      fail(optionPath, "must be a scalar option inside a subcommand")
    }
    if (level === "top") {
      const scalar = type !== "subcommand" && type !== "subcommand-group"
      if (scalarMode === null) scalarMode = scalar
      if (scalarMode !== scalar) {
        fail(path, "cannot mix scalar options with subcommands or subcommand groups")
      }
    }
    let parsed: GuildApplicationCommandOption
    if (type === "subcommand") {
      exactOptionalKeys(item, NESTED_OPTION_KEYS, OPTION_REQUIRED_KEYS, optionPath)
      parsed = {
        ...baseOption(item, type, optionPath),
        options: commandOptions(item.options, "subcommand", `${optionPath}.options`) as GuildApplicationCommandScalarOption[],
        type,
      }
    } else if (type === "subcommand-group") {
      if (level !== "top") fail(optionPath, "subcommand groups are top-level only")
      exactOptionalKeys(item, NESTED_OPTION_KEYS, OPTION_REQUIRED_KEYS, optionPath)
      const nested = commandOptions(item.options, "group", `${optionPath}.options`)
      if (nested.length === 0) fail(`${optionPath}.options`, "must contain at least one subcommand")
      parsed = {
        ...baseOption(item, type, optionPath),
        options: nested as GuildApplicationCommandSubcommandOption[],
        type,
      }
    } else {
      parsed = scalarOption(item, type, optionPath)
      if (parsed.required && optionalScalarSeen) {
        fail(path, "must list required scalar options before optional scalar options")
      }
      if (!parsed.required) optionalScalarSeen = true
    }
    if (names.has(parsed.name)) fail(path, "must contain unique sibling option names")
    names.add(parsed.name)
    return parsed
  })
}

function longestLocalizedLength(
  value: string,
  localizations: readonly GuildApplicationCommandLocalization[],
): number {
  return Math.max(
    characterLength(value),
    ...localizations.map((entry) => characterLength(entry.value)),
  )
}

function choiceCharacters(choice: GuildApplicationCommandChoice): number {
  return longestLocalizedLength(choice.name, choice.nameLocalizations)
    + characterLength(String(choice.value))
}

function optionCharacters(option: GuildApplicationCommandOption): number {
  let total = longestLocalizedLength(option.name, option.nameLocalizations)
    + longestLocalizedLength(option.description, option.descriptionLocalizations)
  if (option.type === "subcommand" || option.type === "subcommand-group") {
    return total + option.options.reduce((sum, nested) => sum + optionCharacters(nested), 0)
  }
  if (option.type === "string" || option.type === "integer" || option.type === "number") {
    total += option.choices.reduce((sum, choice) => sum + choiceCharacters(choice), 0)
  }
  return total
}

export function guildApplicationCommandCharacterCount(
  definition: GuildApplicationCommandDefinition,
): number {
  let total = longestLocalizedLength(definition.name, definition.nameLocalizations)
  if (definition.type === "chat-input") {
    total += longestLocalizedLength(
      definition.description,
      definition.descriptionLocalizations,
    )
    total += definition.options.reduce((sum, option) => sum + optionCharacters(option), 0)
  }
  return total
}

export function normalizeGuildApplicationCommandDefinition(
  value: unknown,
): GuildApplicationCommandDefinition {
  const item = record(value, "definition")
  const type = enumValue(
    item.type,
    GUILD_APPLICATION_COMMAND_TYPES,
    "definition.type",
  )
  const expected = type === "chat-input"
    ? CHAT_INPUT_DEFINITION_KEYS
    : BASE_DEFINITION_KEYS
  exactOptionalKeys(
    item,
    expected,
    type === "chat-input"
      ? ["defaultMemberPermissions", "description", "name", "nsfw", "type"]
      : ["defaultMemberPermissions", "name", "nsfw", "type"],
    "definition",
  )
  const nameParser = type === "chat-input" ? chatInputName : contextName
  const base: GuildApplicationCommandDefinitionBase = {
    defaultMemberPermissions: canonicalPermissions(
      item.defaultMemberPermissions,
      "definition.defaultMemberPermissions",
    ),
    name: nameParser(item.name, "definition.name"),
    nameLocalizations: localizationValues(
      item.nameLocalizations,
      nameParser,
      "definition.nameLocalizations",
    ),
    nsfw: booleanValue(item.nsfw, "definition.nsfw"),
    type,
  }
  const normalized: GuildApplicationCommandDefinition = type === "chat-input"
    ? {
        ...base,
        description: description(item.description, "definition.description"),
        descriptionLocalizations: localizationValues(
          item.descriptionLocalizations,
          description,
          "definition.descriptionLocalizations",
        ),
        options: commandOptions(item.options, "top", "definition.options"),
        type,
      }
    : { ...base, type }
  const characters = guildApplicationCommandCharacterCount(normalized)
  if (characters > DISCORD_LIMITS.applicationCommandAggregateCharacters) {
    fail(
      "definition",
      `contains ${characters} aggregate characters, above Discord's ${DISCORD_LIMITS.applicationCommandAggregateCharacters} limit`,
    )
  }
  return normalized
}

function localizationObject(
  values: readonly GuildApplicationCommandLocalization[],
): Record<string, string> | null {
  if (values.length === 0) return null
  return Object.fromEntries(values.map(({ locale, value }) => [locale, value]))
}

function permissionBits(names: readonly DiscordPermissionName[] | null): string | null {
  if (names === null) return null
  return names.reduce((bits, name) => bits | DISCORD_PERMISSIONS[name], 0n).toString()
}

function apiChoice(choice: GuildApplicationCommandChoice): GuildApplicationCommandApiChoice {
  return {
    name: choice.name,
    name_localizations: localizationObject(choice.nameLocalizations),
    value: choice.value,
  }
}

function apiOption(option: GuildApplicationCommandOption): GuildApplicationCommandApiOption {
  const base = {
    description: option.description,
    description_localizations: localizationObject(option.descriptionLocalizations),
    name: option.name,
    name_localizations: localizationObject(option.nameLocalizations),
    type: OPTION_TYPE_CODES[option.type],
  }
  if (option.type === "subcommand" || option.type === "subcommand-group") {
    return {
      ...base,
      options: option.options.map(apiOption),
    }
  }
  if (option.type === "string") {
    return {
      ...base,
      autocomplete: option.autocomplete,
      choices: option.choices.map(apiChoice),
      ...(option.maxLength === undefined ? {} : { max_length: option.maxLength }),
      ...(option.minLength === undefined ? {} : { min_length: option.minLength }),
      required: option.required,
    }
  }
  if (option.type === "integer" || option.type === "number") {
    return {
      ...base,
      autocomplete: option.autocomplete,
      choices: option.choices.map(apiChoice),
      ...(option.maximum === undefined ? {} : { max_value: option.maximum }),
      ...(option.minimum === undefined ? {} : { min_value: option.minimum }),
      required: option.required,
    }
  }
  if (option.type === "channel") {
    return {
      ...base,
      channel_types: option.channelTypes.map((name) => CHANNEL_TYPE_CODES.get(name) as number),
      required: option.required,
    }
  }
  if (option.type === "attachment") {
    return {
      ...base,
      file_types: [...option.fileTypes],
      required: option.required,
    }
  }
  return { ...base, required: option.required }
}

export function guildApplicationCommandApiBody(
  value: unknown,
): GuildApplicationCommandApiBody {
  const definition = normalizeGuildApplicationCommandDefinition(value)
  const base = {
    default_member_permissions: permissionBits(definition.defaultMemberPermissions),
    name: definition.name,
    name_localizations: localizationObject(definition.nameLocalizations),
    nsfw: definition.nsfw,
    type: COMMAND_TYPE_CODES[definition.type],
  }
  if (definition.type !== "chat-input") return base
  return {
    ...base,
    description: definition.description,
    description_localizations: localizationObject(definition.descriptionLocalizations),
    options: definition.options.map(apiOption),
  }
}

function rawLocalizationValues(
  value: unknown,
  path: string,
): GuildApplicationCommandLocalization[] {
  if (value === undefined || value === null) return []
  const item = record(value, path)
  return Object.entries(item)
    .map(([locale, localized]) => ({
      locale: enumValue(locale, DISCORD_APPLICATION_COMMAND_LOCALES, `${path}.${locale}`),
      value: stringValue(localized, `${path}.${locale}`),
    }))
    .sort((left, right) => (
      (LOCALE_ORDER.get(left.locale) as number) - (LOCALE_ORDER.get(right.locale) as number)
    ))
}

function rawChoice(
  value: DiscordApplicationCommandOptionChoice,
  path: string,
): Record<string, unknown> {
  const item = record(value, path)
  exactOptionalKeys(item, RAW_CHOICE_KEYS, ["name", "value"], path)
  return {
    name: item.name,
    nameLocalizations: rawLocalizationValues(item.name_localizations, `${path}.name_localizations`),
    value: item.value,
  }
}

function rawOption(
  value: DiscordApplicationCommandOption,
  path: string,
): Record<string, unknown> {
  const item = record(value, path)
  const type = typeof item.type === "number" ? OPTION_TYPES_BY_CODE.get(item.type) : undefined
  if (!type) fail(`${path}.type`, "is not a supported Discord option type")
  const base = {
    description: item.description,
    descriptionLocalizations: rawLocalizationValues(
      item.description_localizations,
      `${path}.description_localizations`,
    ),
    name: item.name,
    nameLocalizations: rawLocalizationValues(
      item.name_localizations,
      `${path}.name_localizations`,
    ),
    type,
  }
  if (type === "subcommand" || type === "subcommand-group") {
    exactOptionalKeys(item, RAW_NESTED_OPTION_KEYS, RAW_OPTION_REQUIRED_KEYS, path)
    return {
      ...base,
      options: (item.options === undefined ? [] : optionalArray(item.options, `${path}.options`))
        .map((entry, index) => rawOption(
          entry as DiscordApplicationCommandOption,
          `${path}.options[${index}]`,
        )),
    }
  }
  if (type === "string") {
    exactOptionalKeys(item, RAW_STRING_OPTION_KEYS, RAW_OPTION_REQUIRED_KEYS, path)
    return {
      ...base,
      autocomplete: item.autocomplete ?? false,
      choices: (item.choices === undefined ? [] : optionalArray(item.choices, `${path}.choices`))
        .map((entry, index) => rawChoice(
          entry as DiscordApplicationCommandOptionChoice,
          `${path}.choices[${index}]`,
        )),
      ...(item.max_length === undefined ? {} : { maxLength: item.max_length }),
      ...(item.min_length === undefined ? {} : { minLength: item.min_length }),
      required: item.required ?? false,
    }
  }
  if (type === "integer" || type === "number") {
    exactOptionalKeys(item, RAW_NUMBER_OPTION_KEYS, RAW_OPTION_REQUIRED_KEYS, path)
    return {
      ...base,
      autocomplete: item.autocomplete ?? false,
      choices: (item.choices === undefined ? [] : optionalArray(item.choices, `${path}.choices`))
        .map((entry, index) => rawChoice(
          entry as DiscordApplicationCommandOptionChoice,
          `${path}.choices[${index}]`,
        )),
      ...(item.max_value === undefined ? {} : { maximum: item.max_value }),
      ...(item.min_value === undefined ? {} : { minimum: item.min_value }),
      required: item.required ?? false,
    }
  }
  if (type === "channel") {
    exactOptionalKeys(item, RAW_CHANNEL_OPTION_KEYS, RAW_OPTION_REQUIRED_KEYS, path)
    const channelTypes = (item.channel_types === undefined
      ? []
      : optionalArray(item.channel_types, `${path}.channel_types`)
    ).map((entry, index) => {
      const name = typeof entry === "number" ? CHANNEL_TYPES_BY_CODE.get(entry) : undefined
      if (!name) fail(`${path}.channel_types[${index}]`, "is not a supported guild channel type")
      return name
    }).sort((left, right) => (
      (CHANNEL_TYPE_CODES.get(left) as number) - (CHANNEL_TYPE_CODES.get(right) as number)
    ))
    return {
      ...base,
      channelTypes,
      required: item.required ?? false,
    }
  }
  if (type === "attachment") {
    exactOptionalKeys(item, RAW_ATTACHMENT_OPTION_KEYS, RAW_OPTION_REQUIRED_KEYS, path)
    const fileTypes = (item.file_types === undefined
      ? []
      : optionalArray(item.file_types, `${path}.file_types`)
    ).map((entry, index) => (
      stringValue(entry, `${path}.file_types[${index}]`)
    )).sort(fileTypeOrder)
    return {
      ...base,
      fileTypes,
      required: item.required ?? false,
    }
  }
  exactOptionalKeys(item, RAW_SCALAR_OPTION_KEYS, RAW_OPTION_REQUIRED_KEYS, path)
  return { ...base, required: item.required ?? false }
}

function rawPermissions(value: unknown, path: string): DiscordPermissionName[] | null {
  if (value === undefined || value === null) return null
  const text = stringValue(value, path)
  let bits: bigint
  try {
    bits = parseDiscordPermissionBits(text, "application command")
  } catch {
    fail(path, "is not a valid Discord permission bitfield")
  }
  if ((bits & ~ALL_KNOWN_PERMISSION_BITS) !== 0n) {
    fail(path, "contains unknown Discord permission bits")
  }
  return DISCORD_PERMISSION_NAMES.filter((name) => (bits & DISCORD_PERMISSIONS[name]) !== 0n)
}

function snowflake(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || !DISCORD_SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) === 0n
    || BigInt(value) > DISCORD_SNOWFLAKE_MAX
  ) {
    fail(path, "must be a positive Discord snowflake")
  }
  return value
}

function optionalExactArray(
  value: unknown,
  expected: readonly number[],
  path: string,
): number[] | null {
  if (value === undefined || value === null) return null
  if (
    !Array.isArray(value)
    || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])
  ) {
    fail(path, `must be omitted or exactly ${JSON.stringify(expected)}`)
  }
  return [...expected]
}

export function projectGuildApplicationCommand(
  value: DiscordApplicationCommand,
  expectedApplicationId: string,
  expectedGuildId: string,
): ProjectedGuildApplicationCommand {
  const item = record(value, "Discord command")
  exactOptionalKeys(
    item,
    RAW_COMMAND_KEYS,
    ["application_id", "description", "id", "name", "type", "version"],
    "Discord command",
  )
  const applicationId = snowflake(item.application_id, "Discord command.application_id")
  const guildId = snowflake(item.guild_id, "Discord command.guild_id")
  if (applicationId !== expectedApplicationId || guildId !== expectedGuildId) {
    fail("Discord command", "does not match the expected application and guild")
  }
  const type = typeof item.type === "number" ? COMMAND_TYPES_BY_CODE.get(item.type) : undefined
  if (!type) fail("Discord command.type", "is not a supported guild command type")
  if (item.handler !== undefined) fail("Discord command.handler", "is unavailable for guild commands")
  if (item.default_permission !== undefined && item.default_permission !== true) {
    fail("Discord command.default_permission", "must be omitted or true")
  }
  if (item.dm_permission !== undefined && item.dm_permission !== false) {
    fail("Discord command.dm_permission", "must be omitted or false for guild scope")
  }
  const definitionInput: Record<string, unknown> = {
    defaultMemberPermissions: rawPermissions(
      item.default_member_permissions,
      "Discord command.default_member_permissions",
    ),
    name: item.name,
    nameLocalizations: rawLocalizationValues(
      item.name_localizations,
      "Discord command.name_localizations",
    ),
    nsfw: item.nsfw ?? false,
    type,
  }
  if (type === "chat-input") {
    definitionInput.description = item.description
    definitionInput.descriptionLocalizations = rawLocalizationValues(
      item.description_localizations,
      "Discord command.description_localizations",
    )
    definitionInput.options = (item.options === undefined
      ? []
      : optionalArray(item.options, "Discord command.options")
    ).map((entry, index) => rawOption(
      entry as DiscordApplicationCommandOption,
      `Discord command.options[${index}]`,
    ))
  } else if (item.description !== "") {
    fail("Discord command.description", "must be empty for user and message commands")
  } else if (
    item.description_localizations !== undefined
    && item.description_localizations !== null
    && Object.keys(record(
      item.description_localizations,
      "Discord command.description_localizations",
    )).length > 0
  ) {
    fail("Discord command.description_localizations", "must be empty for user and message commands")
  } else if (
    item.options !== undefined
    && (!Array.isArray(item.options) || item.options.length > 0)
  ) {
    fail("Discord command.options", "must be empty for user and message commands")
  }
  return {
    applicationId,
    commandId: snowflake(item.id, "Discord command.id"),
    definition: normalizeGuildApplicationCommandDefinition(definitionInput),
    guildId,
    immutableEvidence: {
      contexts: optionalExactArray(item.contexts, [0], "Discord command.contexts"),
      defaultPermission: item.default_permission === undefined
        ? null
        : booleanValue(item.default_permission, "Discord command.default_permission"),
      dmPermission: item.dm_permission === undefined
        ? null
        : booleanValue(item.dm_permission, "Discord command.dm_permission"),
      integrationTypes: optionalExactArray(
        item.integration_types,
        [0],
        "Discord command.integration_types",
      ),
    },
    version: snowflake(item.version, "Discord command.version"),
  }
}

export function guildApplicationCommandDefinitionDigest(
  definition: GuildApplicationCommandDefinition,
): string {
  return `sha256:${createHash("sha256")
    .update("discord-mcp:guild-application-command-definition:v1\0")
    .update(stableString(definition))
    .digest("hex")}`
}

export function sameGuildApplicationCommandDefinition(
  left: GuildApplicationCommandDefinition,
  right: GuildApplicationCommandDefinition,
): boolean {
  return stableString(left) === stableString(right)
}

export function guildApplicationCommandTypeCode(
  type: GuildApplicationCommandType,
): number {
  return COMMAND_TYPE_CODES[type]
}
