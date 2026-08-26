import { createHash } from "node:crypto"

import {
  guildApplicationCommandApiBody,
  type GuildChatInputApplicationCommandDefinition,
  type GuildContextApplicationCommandDefinition,
  type GuildApplicationCommandApiBody,
  type GuildApplicationCommandDefinition,
  type GuildApplicationCommandLocalization,
  type GuildApplicationCommandType,
  normalizeGuildApplicationCommandDefinition,
  projectGuildApplicationCommand,
} from "./guild-application-command-definition.js"
import { stableString } from "./normalize.js"
import type { DiscordPermissionName } from "./permissions.js"
import type { DiscordApplicationCommand } from "./types.js"

export const GLOBAL_APPLICATION_COMMAND_TYPES = Object.freeze([
  "chat-input",
  "user",
  "message",
  "primary-entry-point",
] as const)

export type GlobalApplicationCommandType =
  typeof GLOBAL_APPLICATION_COMMAND_TYPES[number]

export const GLOBAL_APPLICATION_COMMAND_CONTEXTS = Object.freeze([
  "guild",
  "bot-dm",
  "private-channel",
] as const)

export type GlobalApplicationCommandContext =
  typeof GLOBAL_APPLICATION_COMMAND_CONTEXTS[number]

export const GLOBAL_APPLICATION_COMMAND_INTEGRATION_TYPES = Object.freeze([
  "guild-install",
  "user-install",
] as const)

export type GlobalApplicationCommandIntegrationType =
  typeof GLOBAL_APPLICATION_COMMAND_INTEGRATION_TYPES[number]

export const GLOBAL_APPLICATION_COMMAND_HANDLERS = Object.freeze([
  "application",
  "discord-launch-activity",
] as const)

export type GlobalApplicationCommandHandler =
  typeof GLOBAL_APPLICATION_COMMAND_HANDLERS[number]

interface GlobalApplicationCommandScopeDefinition {
  contexts: GlobalApplicationCommandContext[]
  integrationTypes: GlobalApplicationCommandIntegrationType[]
}

export type GlobalStandardApplicationCommandDefinition =
  | (GuildChatInputApplicationCommandDefinition & GlobalApplicationCommandScopeDefinition)
  | (
      Omit<GuildContextApplicationCommandDefinition, "type">
      & { type: "message" }
      & GlobalApplicationCommandScopeDefinition
    )
  | (
      Omit<GuildContextApplicationCommandDefinition, "type">
      & { type: "user" }
      & GlobalApplicationCommandScopeDefinition
    )

export interface GlobalPrimaryEntryPointApplicationCommandDefinition
  extends GlobalApplicationCommandScopeDefinition {
  defaultMemberPermissions: DiscordPermissionName[] | null
  description: string
  descriptionLocalizations: GuildApplicationCommandLocalization[]
  handler: GlobalApplicationCommandHandler
  name: string
  nameLocalizations: GuildApplicationCommandLocalization[]
  nsfw: boolean
  type: "primary-entry-point"
}

export type GlobalApplicationCommandDefinition =
  | GlobalPrimaryEntryPointApplicationCommandDefinition
  | GlobalStandardApplicationCommandDefinition

export interface GlobalApplicationCommandApiBody
  extends Omit<GuildApplicationCommandApiBody, "type"> {
  contexts: number[]
  handler?: number
  integration_types: number[]
  type: number
}

export interface ProjectedGlobalApplicationCommand {
  applicationId: string
  commandId: string
  definition: GlobalApplicationCommandDefinition
  version: string
}

export class GlobalApplicationCommandDefinitionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "GlobalApplicationCommandDefinitionError"
  }
}

const COMMAND_TYPE_CODES = Object.freeze({
  "chat-input": 1,
  user: 2,
  message: 3,
  "primary-entry-point": 4,
} as const satisfies Record<GlobalApplicationCommandType, number>)
const CONTEXT_CODES = Object.freeze({
  guild: 0,
  "bot-dm": 1,
  "private-channel": 2,
} as const satisfies Record<GlobalApplicationCommandContext, number>)
const INTEGRATION_TYPE_CODES = Object.freeze({
  "guild-install": 0,
  "user-install": 1,
} as const satisfies Record<GlobalApplicationCommandIntegrationType, number>)
const HANDLER_CODES = Object.freeze({
  application: 1,
  "discord-launch-activity": 2,
} as const satisfies Record<GlobalApplicationCommandHandler, number>)
const TYPES_BY_CODE = new Map<number, GlobalApplicationCommandType>(
  Object.entries(COMMAND_TYPE_CODES).map(([name, code]) => [
    code,
    name as GlobalApplicationCommandType,
  ]),
)
const CONTEXTS_BY_CODE = new Map<number, GlobalApplicationCommandContext>(
  Object.entries(CONTEXT_CODES).map(([name, code]) => [
    code,
    name as GlobalApplicationCommandContext,
  ]),
)
const INTEGRATION_TYPES_BY_CODE = new Map<
  number,
  GlobalApplicationCommandIntegrationType
>(Object.entries(INTEGRATION_TYPE_CODES).map(([name, code]) => [
  code,
  name as GlobalApplicationCommandIntegrationType,
]))
const HANDLERS_BY_CODE = new Map<number, GlobalApplicationCommandHandler>(
  Object.entries(HANDLER_CODES).map(([name, code]) => [
    code,
    name as GlobalApplicationCommandHandler,
  ]),
)
const STANDARD_BASE_KEYS = [
  "contexts",
  "defaultMemberPermissions",
  "integrationTypes",
  "name",
  "nameLocalizations",
  "nsfw",
  "type",
] as const
const STANDARD_CHAT_INPUT_KEYS = [
  ...STANDARD_BASE_KEYS,
  "description",
  "descriptionLocalizations",
  "options",
] as const
const PRIMARY_ENTRY_POINT_KEYS = [
  "contexts",
  "defaultMemberPermissions",
  "description",
  "descriptionLocalizations",
  "handler",
  "integrationTypes",
  "name",
  "nameLocalizations",
  "nsfw",
  "type",
] as const
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
const DEFAULT_GLOBAL_CONTEXT_CODES = [0, 1, 2] as const
const PROJECTION_GUILD_ID = "1"
const SNOWFLAKE_PATTERN = /^(?:[1-9][0-9]{0,19})$/u
const SNOWFLAKE_MAXIMUM = (1n << 64n) - 1n

function fail(message: string, options?: ErrorOptions): never {
  throw new GlobalApplicationCommandDefinitionError(message, options)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`)
  }
  return value as Record<string, unknown>
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
    fail(`${path} ${details}`)
  }
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(`${path} must be one of ${values.join(", ")}`)
  }
  return value as T
}

function canonicalNames<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > values.length) {
    fail(`${path} must be a nonempty bounded array`)
  }
  let previous = -1
  return value.map((entry, index) => {
    const name = enumValue(entry, values, `${path}[${index}]`)
    const position = values.indexOf(name)
    if (position <= previous) fail(`${path} must contain unique values in canonical order`)
    previous = position
    return name
  })
}

function canonicalNumbers<T extends string>(
  value: unknown,
  fallback: readonly number[],
  vocabulary: ReadonlyMap<number, T>,
  path: string,
): T[] {
  const entries = value === undefined || value === null ? [...fallback] : value
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > vocabulary.size) {
    fail(`${path} must be a nonempty bounded numeric array`)
  }
  const numbers = entries.map((entry, index) => {
    if (!Number.isInteger(entry) || !vocabulary.has(entry as number)) {
      fail(`${path}[${index}] is unsupported`)
    }
    return entry as number
  }).sort((left, right) => left - right)
  if (new Set(numbers).size !== numbers.length) fail(`${path} contains duplicate values`)
  return numbers.map((entry) => vocabulary.get(entry) as T)
}

function snowflake(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || !SNOWFLAKE_PATTERN.test(value)
    || BigInt(value) > SNOWFLAKE_MAXIMUM
  ) {
    fail(`${path} must be a positive Discord snowflake`)
  }
  return value
}

function assertContextCompatibility(
  contexts: readonly GlobalApplicationCommandContext[],
  integrationTypes: readonly GlobalApplicationCommandIntegrationType[],
): void {
  if (
    contexts.includes("private-channel")
    && !integrationTypes.includes("user-install")
  ) {
    fail("definition.contexts private-channel requires user-install integration")
  }
}

function standardDefinitionInput(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const {
    contexts: _contexts,
    integrationTypes: _integrationTypes,
    ...definition
  } = item
  return definition
}

export function normalizeGlobalApplicationCommandDefinition(
  value: unknown,
): GlobalApplicationCommandDefinition {
  const item = record(value, "definition")
  const type = enumValue(
    item.type,
    GLOBAL_APPLICATION_COMMAND_TYPES,
    "definition.type",
  )
  const contexts = canonicalNames(
    item.contexts,
    GLOBAL_APPLICATION_COMMAND_CONTEXTS,
    "definition.contexts",
  )
  const integrationTypes = canonicalNames(
    item.integrationTypes,
    GLOBAL_APPLICATION_COMMAND_INTEGRATION_TYPES,
    "definition.integrationTypes",
  )
  assertContextCompatibility(contexts, integrationTypes)
  if (type !== "primary-entry-point") {
    exactOptionalKeys(
      item,
      type === "chat-input" ? STANDARD_CHAT_INPUT_KEYS : STANDARD_BASE_KEYS,
      type === "chat-input"
        ? [
            "contexts",
            "defaultMemberPermissions",
            "description",
            "integrationTypes",
            "name",
            "nsfw",
            "type",
          ]
        : [
            "contexts",
            "defaultMemberPermissions",
            "integrationTypes",
            "name",
            "nsfw",
            "type",
          ],
      "definition",
    )
    let definition: GuildApplicationCommandDefinition
    try {
      definition = normalizeGuildApplicationCommandDefinition(
        standardDefinitionInput(item),
      )
    } catch (error) {
      fail("definition is not a valid complete global command", { cause: error })
    }
    return { ...definition, contexts, integrationTypes } as GlobalStandardApplicationCommandDefinition
  }
  exactOptionalKeys(
    item,
    PRIMARY_ENTRY_POINT_KEYS,
    [
      "contexts",
      "defaultMemberPermissions",
      "description",
      "handler",
      "integrationTypes",
      "name",
      "nsfw",
      "type",
    ],
    "definition",
  )
  let shell: GuildApplicationCommandDefinition
  try {
    shell = normalizeGuildApplicationCommandDefinition({
      defaultMemberPermissions: item.defaultMemberPermissions,
      description: item.description,
      descriptionLocalizations: item.descriptionLocalizations,
      name: item.name,
      nameLocalizations: item.nameLocalizations,
      nsfw: item.nsfw,
      options: [],
      type: "chat-input",
    })
  } catch (error) {
    fail("definition is not a valid complete Primary Entry Point command", { cause: error })
  }
  if (shell.type !== "chat-input") fail("definition Primary Entry Point shell is invalid")
  return {
    contexts,
    defaultMemberPermissions: shell.defaultMemberPermissions,
    description: shell.description,
    descriptionLocalizations: shell.descriptionLocalizations,
    handler: enumValue(
      item.handler,
      GLOBAL_APPLICATION_COMMAND_HANDLERS,
      "definition.handler",
    ),
    integrationTypes,
    name: shell.name,
    nameLocalizations: shell.nameLocalizations,
    nsfw: shell.nsfw,
    type,
  }
}

function standardDefinition(
  definition: GlobalStandardApplicationCommandDefinition,
): GuildApplicationCommandDefinition {
  const {
    contexts: _contexts,
    integrationTypes: _integrationTypes,
    ...standard
  } = definition
  return standard
}

function scopeBody(definition: GlobalApplicationCommandDefinition): {
  contexts: number[]
  integration_types: number[]
} {
  return {
    contexts: definition.contexts.map((name) => CONTEXT_CODES[name]),
    integration_types: definition.integrationTypes.map((name) => (
      INTEGRATION_TYPE_CODES[name]
    )),
  }
}

export function globalApplicationCommandApiBody(
  value: unknown,
): GlobalApplicationCommandApiBody {
  const definition = normalizeGlobalApplicationCommandDefinition(value)
  if (definition.type !== "primary-entry-point") {
    return {
      ...guildApplicationCommandApiBody(standardDefinition(definition)),
      ...scopeBody(definition),
    }
  }
  const shell = guildApplicationCommandApiBody({
    defaultMemberPermissions: definition.defaultMemberPermissions,
    description: definition.description,
    descriptionLocalizations: definition.descriptionLocalizations,
    name: definition.name,
    nameLocalizations: definition.nameLocalizations,
    nsfw: definition.nsfw,
    options: [],
    type: "chat-input",
  })
  const { options: _options, type: _type, ...base } = shell
  return {
    ...base,
    ...scopeBody(definition),
    handler: HANDLER_CODES[definition.handler],
    type: COMMAND_TYPE_CODES[definition.type],
  }
}

function projectionCommand(
  item: Record<string, unknown>,
  type: GuildApplicationCommandType,
): DiscordApplicationCommand {
  const {
    contexts: _contexts,
    dm_permission: _dmPermission,
    guild_id: _guildId,
    handler: _handler,
    integration_types: _integrationTypes,
    ...shared
  } = item
  return {
    ...shared,
    contexts: [0],
    dm_permission: false,
    guild_id: PROJECTION_GUILD_ID,
    integration_types: [0],
    type: COMMAND_TYPE_CODES[type],
  } as unknown as DiscordApplicationCommand
}

export function projectGlobalApplicationCommand(
  value: DiscordApplicationCommand,
  expectedApplicationId: string,
  defaultIntegrationTypes: readonly GlobalApplicationCommandIntegrationType[],
): ProjectedGlobalApplicationCommand {
  const item = record(value, "Discord global command")
  exactOptionalKeys(
    item,
    RAW_COMMAND_KEYS,
    ["application_id", "description", "id", "name", "type", "version"],
    "Discord global command",
  )
  const applicationId = snowflake(
    item.application_id,
    "Discord global command.application_id",
  )
  if (applicationId !== expectedApplicationId) {
    fail("Discord global command does not match the expected application")
  }
  if (item.guild_id !== undefined && item.guild_id !== null) {
    fail("Discord global command contains a guild ID")
  }
  if (item.default_permission !== undefined && item.default_permission !== true) {
    fail("Discord global command.default_permission must be omitted or true")
  }
  const type = typeof item.type === "number"
    ? TYPES_BY_CODE.get(item.type)
    : undefined
  if (!type) fail("Discord global command.type is unsupported")
  if (item.dm_permission !== undefined && item.contexts === undefined) {
    fail("Discord global command uses ambiguous deprecated DM permission evidence")
  }
  const fallbackIntegrations = defaultIntegrationTypes.map((name) => (
    INTEGRATION_TYPE_CODES[name]
  ))
  const contexts = canonicalNumbers(
    item.contexts,
    DEFAULT_GLOBAL_CONTEXT_CODES,
    CONTEXTS_BY_CODE,
    "Discord global command.contexts",
  )
  const integrationTypes = canonicalNumbers(
    item.integration_types,
    fallbackIntegrations,
    INTEGRATION_TYPES_BY_CODE,
    "Discord global command.integration_types",
  )
  assertContextCompatibility(contexts, integrationTypes)
  if (
    item.dm_permission !== undefined
    && item.dm_permission !== contexts.includes("bot-dm")
  ) {
    fail("Discord global command contains inconsistent deprecated DM permission evidence")
  }
  let definition: GlobalApplicationCommandDefinition
  if (type === "primary-entry-point") {
    if (item.handler === undefined || !HANDLERS_BY_CODE.has(item.handler as number)) {
      fail("Discord global command.handler is unsupported")
    }
    if (item.options !== undefined && (!Array.isArray(item.options) || item.options.length > 0)) {
      fail("Discord Primary Entry Point command must not contain options")
    }
    const shell = projectGuildApplicationCommand(
      projectionCommand({ ...item, options: [] }, "chat-input"),
      expectedApplicationId,
      PROJECTION_GUILD_ID,
    ).definition
    if (shell.type !== "chat-input") fail("Discord Primary Entry Point evidence is invalid")
    definition = normalizeGlobalApplicationCommandDefinition({
      contexts,
      defaultMemberPermissions: shell.defaultMemberPermissions,
      description: shell.description,
      descriptionLocalizations: shell.descriptionLocalizations,
      handler: HANDLERS_BY_CODE.get(item.handler as number),
      integrationTypes,
      name: shell.name,
      nameLocalizations: shell.nameLocalizations,
      nsfw: shell.nsfw,
      type,
    })
  } else {
    if (item.handler !== undefined) {
      fail("Discord non-entry-point global command contains a handler")
    }
    const projected = projectGuildApplicationCommand(
      projectionCommand(item, type),
      expectedApplicationId,
      PROJECTION_GUILD_ID,
    )
    definition = normalizeGlobalApplicationCommandDefinition({
      ...projected.definition,
      contexts,
      integrationTypes,
    })
  }
  return {
    applicationId,
    commandId: snowflake(item.id, "Discord global command.id"),
    definition,
    version: snowflake(item.version, "Discord global command.version"),
  }
}

export function globalApplicationCommandDefinitionDigest(
  definition: GlobalApplicationCommandDefinition,
): string {
  return `sha256:${createHash("sha256")
    .update("discord-mcp:global-application-command-definition:v1\0")
    .update(stableString(definition))
    .digest("hex")}`
}

export function sameGlobalApplicationCommandDefinition(
  left: GlobalApplicationCommandDefinition,
  right: GlobalApplicationCommandDefinition,
): boolean {
  return stableString(left) === stableString(right)
}

export function globalApplicationCommandTypeCode(
  type: GlobalApplicationCommandType,
): number {
  return COMMAND_TYPE_CODES[type]
}
