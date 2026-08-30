import { createHash } from "node:crypto"

import {
  DISCORD_LIMITS,
  DISCORD_LOCALES,
  type DiscordLocale,
} from "./constants.js"
import { stableString } from "./normalize.js"

export const APPLICATION_ROLE_CONNECTION_METADATA_TYPES = Object.freeze([
  "integer-less-than-or-equal",
  "integer-greater-than-or-equal",
  "integer-equal",
  "integer-not-equal",
  "datetime-less-than-or-equal",
  "datetime-greater-than-or-equal",
  "boolean-equal",
  "boolean-not-equal",
] as const)

export type ApplicationRoleConnectionMetadataType =
  typeof APPLICATION_ROLE_CONNECTION_METADATA_TYPES[number]

export interface ApplicationRoleConnectionMetadataLocalization {
  locale: DiscordLocale
  value: string
}

export interface ApplicationRoleConnectionMetadataDefinition {
  description: string
  descriptionLocalizations: ApplicationRoleConnectionMetadataLocalization[]
  key: string
  name: string
  nameLocalizations: ApplicationRoleConnectionMetadataLocalization[]
  type: ApplicationRoleConnectionMetadataType
}

export interface DiscordApplicationRoleConnectionMetadataBody {
  description: string
  description_localizations?: Record<string, string>
  key: string
  name: string
  name_localizations?: Record<string, string>
  type: number
}

export class ApplicationRoleConnectionMetadataDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ApplicationRoleConnectionMetadataDefinitionError"
  }
}

const TYPE_CODES = Object.freeze({
  "integer-less-than-or-equal": 1,
  "integer-greater-than-or-equal": 2,
  "integer-equal": 3,
  "integer-not-equal": 4,
  "datetime-less-than-or-equal": 5,
  "datetime-greater-than-or-equal": 6,
  "boolean-equal": 7,
  "boolean-not-equal": 8,
} as const satisfies Record<ApplicationRoleConnectionMetadataType, number>)

const TYPES_BY_CODE = new Map<number, ApplicationRoleConnectionMetadataType>(
  Object.entries(TYPE_CODES).map(([name, code]) => [
    code,
    name as ApplicationRoleConnectionMetadataType,
  ]),
)

const LOCALE_ORDER = new Map(
  DISCORD_LOCALES.map((locale, index) => [locale, index]),
)
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u
const KEY_PATTERN = /^[a-z0-9_]+$/u
const DEFINITION_KEYS = [
  "description",
  "descriptionLocalizations",
  "key",
  "name",
  "nameLocalizations",
  "type",
] as const
const LOCALIZATION_KEYS = ["locale", "value"] as const
const RAW_DEFINITION_KEYS = [
  "description",
  "description_localizations",
  "key",
  "name",
  "name_localizations",
  "type",
] as const

function fail(path: string, message: string): never {
  throw new ApplicationRoleConnectionMetadataDefinitionError(`${path} ${message}`)
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
    fail(path, `must contain exactly ${expected.join(", ")}`)
  }
}

function allowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  if (
    Object.keys(value).some((key) => !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(value, key))
  ) {
    fail(path, `must contain required supported fields ${required.join(", ")}`)
  }
}

function validUnicode(value: string): boolean {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

function characterCount(value: string): number {
  return [...value].length
}

function canonicalText(
  value: unknown,
  path: string,
  maximumCharacters: number,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
    || characterCount(value) > maximumCharacters
    || CONTROL_CHARACTER_PATTERN.test(value)
    || !validUnicode(value)
  ) {
    fail(path, `must contain 1-${maximumCharacters} safe unpadded characters`)
  }
  return value
}

function canonicalKey(value: unknown, path: string): string {
  const key = canonicalText(
    value,
    path,
    DISCORD_LIMITS.applicationRoleConnectionMetadataKeyCharacters,
  )
  if (!KEY_PATTERN.test(key)) {
    fail(path, "must contain only lowercase ASCII letters, digits, or underscores")
  }
  return key
}

function canonicalType(
  value: unknown,
  path: string,
): ApplicationRoleConnectionMetadataType {
  if (
    typeof value !== "string"
    || !(APPLICATION_ROLE_CONNECTION_METADATA_TYPES as readonly string[]).includes(value)
  ) {
    fail(path, "must be a supported named comparison type")
  }
  return value as ApplicationRoleConnectionMetadataType
}

function canonicalLocalizations(
  value: unknown,
  path: string,
  maximumCharacters: number,
): ApplicationRoleConnectionMetadataLocalization[] {
  if (!Array.isArray(value) || value.length > DISCORD_LOCALES.length) {
    fail(path, `must be an array with at most ${DISCORD_LOCALES.length} entries`)
  }
  const seen = new Set<DiscordLocale>()
  let previousOrder = -1
  return value.map((entry, index) => {
    const itemPath = `${path}[${index}]`
    const item = record(entry, itemPath)
    exactKeys(item, LOCALIZATION_KEYS, itemPath)
    if (
      typeof item.locale !== "string"
      || !(DISCORD_LOCALES as readonly string[]).includes(item.locale)
    ) {
      fail(`${itemPath}.locale`, "must be an official Discord locale")
    }
    const locale = item.locale as DiscordLocale
    if (seen.has(locale)) fail(`${itemPath}.locale`, "must be unique")
    seen.add(locale)
    const order = LOCALE_ORDER.get(locale)
    if (order === undefined || order <= previousOrder) {
      fail(path, "must use canonical Discord locale order")
    }
    previousOrder = order
    return {
      locale,
      value: canonicalText(item.value, `${itemPath}.value`, maximumCharacters),
    }
  })
}

function canonicalDefinition(
  value: unknown,
  path: string,
): ApplicationRoleConnectionMetadataDefinition {
  const item = record(value, path)
  exactKeys(item, DEFINITION_KEYS, path)
  return {
    description: canonicalText(
      item.description,
      `${path}.description`,
      DISCORD_LIMITS.applicationRoleConnectionMetadataDescriptionCharacters,
    ),
    descriptionLocalizations: canonicalLocalizations(
      item.descriptionLocalizations,
      `${path}.descriptionLocalizations`,
      DISCORD_LIMITS.applicationRoleConnectionMetadataDescriptionCharacters,
    ),
    key: canonicalKey(item.key, `${path}.key`),
    name: canonicalText(
      item.name,
      `${path}.name`,
      DISCORD_LIMITS.applicationRoleConnectionMetadataNameCharacters,
    ),
    nameLocalizations: canonicalLocalizations(
      item.nameLocalizations,
      `${path}.nameLocalizations`,
      DISCORD_LIMITS.applicationRoleConnectionMetadataNameCharacters,
    ),
    type: canonicalType(item.type, `${path}.type`),
  }
}

function localizationRecord(
  localizations: readonly ApplicationRoleConnectionMetadataLocalization[],
): Record<string, string> | undefined {
  if (localizations.length === 0) return undefined
  return Object.fromEntries(localizations.map(({ locale, value }) => [locale, value]))
}

function rawLocalizations(
  value: unknown,
  path: string,
  maximumCharacters: number,
): ApplicationRoleConnectionMetadataLocalization[] {
  if (value === undefined || value === null) return []
  const localizations = record(value, path)
  if (Object.keys(localizations).length > DISCORD_LOCALES.length) {
    fail(path, `must contain at most ${DISCORD_LOCALES.length} entries`)
  }
  const unknownLocales = Object.keys(localizations).filter(
    (locale) => !(DISCORD_LOCALES as readonly string[]).includes(locale),
  )
  if (unknownLocales.length > 0) fail(path, "contains an unsupported locale")
  return DISCORD_LOCALES
    .filter((locale) => Object.hasOwn(localizations, locale))
    .map((locale) => ({
      locale,
      value: canonicalText(localizations[locale], `${path}.${locale}`, maximumCharacters),
    }))
}

function rawDefinition(
  value: unknown,
  path: string,
): ApplicationRoleConnectionMetadataDefinition {
  const item = record(value, path)
  allowedKeys(
    item,
    RAW_DEFINITION_KEYS,
    ["description", "key", "name", "type"],
    path,
  )
  if (!Number.isInteger(item.type)) fail(`${path}.type`, "must be an integer")
  const type = TYPES_BY_CODE.get(item.type as number)
  if (!type) fail(`${path}.type`, "is not a supported comparison type")
  return canonicalDefinition({
    description: item.description,
    descriptionLocalizations: rawLocalizations(
      item.description_localizations,
      `${path}.description_localizations`,
      DISCORD_LIMITS.applicationRoleConnectionMetadataDescriptionCharacters,
    ),
    key: item.key,
    name: item.name,
    nameLocalizations: rawLocalizations(
      item.name_localizations,
      `${path}.name_localizations`,
      DISCORD_LIMITS.applicationRoleConnectionMetadataNameCharacters,
    ),
    type,
  }, path)
}

function assertUniqueKeys(
  definitions: readonly ApplicationRoleConnectionMetadataDefinition[],
  path: string,
): void {
  const seen = new Set<string>()
  for (const [index, definition] of definitions.entries()) {
    if (seen.has(definition.key)) fail(`${path}[${index}].key`, "must be unique")
    seen.add(definition.key)
  }
}

export function normalizeApplicationRoleConnectionMetadataSchema(
  value: unknown,
): ApplicationRoleConnectionMetadataDefinition[] {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.applicationRoleConnectionMetadataRecords
  ) {
    fail(
      "Discord linked-role metadata schema",
      `must be an array with at most ${DISCORD_LIMITS.applicationRoleConnectionMetadataRecords} records`,
    )
  }
  const definitions = value.map((entry, index) => canonicalDefinition(
    entry,
    `Discord linked-role metadata schema[${index}]`,
  ))
  assertUniqueKeys(definitions, "Discord linked-role metadata schema")
  return definitions
}

export function projectApplicationRoleConnectionMetadataSchema(
  value: unknown,
): ApplicationRoleConnectionMetadataDefinition[] {
  if (
    !Array.isArray(value)
    || value.length > DISCORD_LIMITS.applicationRoleConnectionMetadataRecords
  ) {
    fail(
      "Discord linked-role metadata response",
      `must be an array with at most ${DISCORD_LIMITS.applicationRoleConnectionMetadataRecords} records`,
    )
  }
  const definitions = value.map((entry, index) => rawDefinition(
    entry,
    `Discord linked-role metadata response[${index}]`,
  ))
  assertUniqueKeys(definitions, "Discord linked-role metadata response")
  return definitions
}

export function applicationRoleConnectionMetadataSchemaBody(
  schema: readonly ApplicationRoleConnectionMetadataDefinition[],
): DiscordApplicationRoleConnectionMetadataBody[] {
  const canonical = normalizeApplicationRoleConnectionMetadataSchema(schema)
  const body = canonical.map((definition) => {
    const descriptionLocalizations = localizationRecord(
      definition.descriptionLocalizations,
    )
    const nameLocalizations = localizationRecord(definition.nameLocalizations)
    return {
      description: definition.description,
      ...(descriptionLocalizations
        ? { description_localizations: descriptionLocalizations }
        : {}),
      key: definition.key,
      name: definition.name,
      ...(nameLocalizations ? { name_localizations: nameLocalizations } : {}),
      type: TYPE_CODES[definition.type],
    }
  })
  if (
    new TextEncoder().encode(JSON.stringify(body)).byteLength
    > DISCORD_LIMITS.applicationRoleConnectionMetadataRequestBytes
  ) {
    fail("Discord linked-role metadata schema", "exceeds the local request-size bound")
  }
  return body
}

export function sameApplicationRoleConnectionMetadataSchema(
  left: readonly ApplicationRoleConnectionMetadataDefinition[],
  right: readonly ApplicationRoleConnectionMetadataDefinition[],
): boolean {
  return stableString(normalizeApplicationRoleConnectionMetadataSchema(left))
    === stableString(normalizeApplicationRoleConnectionMetadataSchema(right))
}

export function applicationRoleConnectionMetadataSchemaDigest(
  schema: readonly ApplicationRoleConnectionMetadataDefinition[],
): string {
  return `sha256:${createHash("sha256")
    .update("guildcontrol:application-role-connection-metadata-schema:v1\0")
    .update(stableString(normalizeApplicationRoleConnectionMetadataSchema(schema)))
    .digest("hex")}`
}

export function applicationRoleConnectionMetadataRecordDigest(
  definition: ApplicationRoleConnectionMetadataDefinition,
): string {
  return `sha256:${createHash("sha256")
    .update("guildcontrol:application-role-connection-metadata-record:v1\0")
    .update(stableString(normalizeApplicationRoleConnectionMetadataSchema([definition])[0]))
    .digest("hex")}`
}
