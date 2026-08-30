import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto"

import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import { stableString } from "./normalize.js"
import { OPERATION_KEY_HASH_PATTERN } from "./operation-store.js"

export const REQUEST_BUTTON_STYLES = [
  "primary",
  "secondary",
  "success",
  "danger",
] as const

export type RequestButtonStyle = typeof REQUEST_BUTTON_STYLES[number]

export const REQUEST_BUTTON_LIMITS = Object.freeze({
  buttonsPerMessage: 40,
  buttonsPerRow: 5,
  customIdCharacters: 100,
  labelCharacters: 80,
})

export const DISCORD_REQUEST_BUTTON_STYLES = Object.freeze({
  danger: 4,
  primary: 1,
  secondary: 2,
  success: 3,
} satisfies Record<RequestButtonStyle, number>)

const REQUEST_BUTTON_CUSTOM_ID_VERSION = "dmcp1"
const REQUEST_BUTTON_ROUTE_BYTES = 16
const REQUEST_BUTTON_TAG_BYTES = 16
const REQUEST_BUTTON_ROUTE_PATTERN = /^[A-Za-z0-9_-]{22}$/
const REQUEST_BUTTON_TAG_PATTERN = /^[A-Za-z0-9_-]{22}$/
const REQUEST_BUTTON_CUSTOM_ID_PATTERN = /^dmcp1\.([A-Za-z0-9_-]{22})\.([0-9a-z]{1,2})\.([A-Za-z0-9_-]{22})$/
const REQUEST_BUTTON_LAYOUT_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

export interface RequestButtonScope {
  applicationId: string
  botId: string
  channelId: string
  guildId: string
}

export interface RequestButtonRouteBinding extends RequestButtonScope {
  operationKeyHash: string
}

export interface RequestButtonDescriptor {
  index: number
  label: string
  style: RequestButtonStyle
}

export interface ParsedRequestButtonCustomId {
  index: number
  route: string
  tag: string
}

function positiveSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
}

function assertScope(scope: RequestButtonScope): void {
  for (const [name, value] of [
    ["applicationId", scope.applicationId],
    ["botId", scope.botId],
    ["channelId", scope.channelId],
    ["guildId", scope.guildId],
  ] as const) {
    if (!positiveSnowflake(value)) {
      throw new RangeError(`Discord request-button ${name} must be an exact snowflake`)
    }
  }
}

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.byteLength < 16) {
    throw new RangeError("Discord request-button verification key is invalid")
  }
}

function assertLayoutDigest(layoutDigest: string): void {
  if (!REQUEST_BUTTON_LAYOUT_DIGEST_PATTERN.test(layoutDigest)) {
    throw new RangeError("Discord request-button layout digest is invalid")
  }
}

function assertDescriptor(descriptor: RequestButtonDescriptor): void {
  if (
    !Number.isInteger(descriptor.index)
    || descriptor.index < 0
    || descriptor.index >= REQUEST_BUTTON_LIMITS.buttonsPerMessage
  ) {
    throw new RangeError("Discord request-button index is invalid")
  }
  if (!REQUEST_BUTTON_STYLES.includes(descriptor.style)) {
    throw new RangeError("Discord request-button style is invalid")
  }
  if (
    typeof descriptor.label !== "string"
    || !descriptor.label.trim()
    || [...descriptor.label].length > REQUEST_BUTTON_LIMITS.labelCharacters
  ) {
    throw new RangeError("Discord request-button label is invalid")
  }
}

function truncatedHmac(
  key: Uint8Array,
  domain: string,
  value: unknown,
  bytes: number,
): string {
  return createHmac("sha256", key)
    .update(domain)
    .update("\0")
    .update(stableString(value))
    .digest()
    .subarray(0, bytes)
    .toString("base64url")
}

export function requestButtonVerificationKey(token: string): Uint8Array {
  if (typeof token !== "string" || !token.trim()) {
    throw new RangeError("Discord request-button verification requires a non-empty secret")
  }
  return createHmac("sha256", token)
    .update("guildcontrol-request-button-verification-key.v1\0")
    .digest()
}

export function requestButtonLayoutDigest(layout: unknown): string {
  return `sha256:${createHash("sha256")
    .update("guildcontrol-request-button-layout.v1\0")
    .update(stableString(layout))
    .digest("hex")}`
}

export function createRequestButtonRoute(
  key: Uint8Array,
  binding: RequestButtonRouteBinding,
  layoutDigest: string,
): string {
  assertKey(key)
  assertScope(binding)
  assertLayoutDigest(layoutDigest)
  if (!OPERATION_KEY_HASH_PATTERN.test(binding.operationKeyHash)) {
    throw new RangeError("Discord request-button operation-key hash is invalid")
  }
  return truncatedHmac(
    key,
    "guildcontrol-request-button-route.v1",
    {
      applicationId: binding.applicationId,
      botId: binding.botId,
      channelId: binding.channelId,
      guildId: binding.guildId,
      layoutDigest,
      operationKeyHash: binding.operationKeyHash,
    },
    REQUEST_BUTTON_ROUTE_BYTES,
  )
}

function requestButtonTag(
  key: Uint8Array,
  scope: RequestButtonScope,
  layoutDigest: string,
  route: string,
  descriptor: RequestButtonDescriptor,
): string {
  assertKey(key)
  assertScope(scope)
  assertLayoutDigest(layoutDigest)
  assertDescriptor(descriptor)
  if (!REQUEST_BUTTON_ROUTE_PATTERN.test(route)) {
    throw new RangeError("Discord request-button route is invalid")
  }
  return truncatedHmac(
    key,
    "guildcontrol-request-button-tag.v1",
    {
      applicationId: scope.applicationId,
      botId: scope.botId,
      channelId: scope.channelId,
      guildId: scope.guildId,
      index: descriptor.index,
      label: descriptor.label,
      layoutDigest,
      route,
      style: descriptor.style,
      version: REQUEST_BUTTON_CUSTOM_ID_VERSION,
    },
    REQUEST_BUTTON_TAG_BYTES,
  )
}

export function createRequestButtonCustomId(
  key: Uint8Array,
  scope: RequestButtonScope,
  layoutDigest: string,
  route: string,
  descriptor: RequestButtonDescriptor,
): string {
  const tag = requestButtonTag(key, scope, layoutDigest, route, descriptor)
  const customId = [
    REQUEST_BUTTON_CUSTOM_ID_VERSION,
    route,
    descriptor.index.toString(36),
    tag,
  ].join(".")
  if (customId.length > REQUEST_BUTTON_LIMITS.customIdCharacters) {
    throw new RangeError("Discord request-button custom ID exceeds the API limit")
  }
  return customId
}

export function parseRequestButtonCustomId(
  customId: unknown,
): ParsedRequestButtonCustomId | undefined {
  if (typeof customId !== "string") return undefined
  const match = REQUEST_BUTTON_CUSTOM_ID_PATTERN.exec(customId)
  if (!match) return undefined
  const [, route, encodedIndex, tag] = match
  if (route === undefined || encodedIndex === undefined || tag === undefined) return undefined
  const index = Number.parseInt(encodedIndex, 36)
  if (
    !Number.isInteger(index)
    || index < 0
    || index >= REQUEST_BUTTON_LIMITS.buttonsPerMessage
    || !REQUEST_BUTTON_ROUTE_PATTERN.test(route)
    || !REQUEST_BUTTON_TAG_PATTERN.test(tag)
  ) return undefined
  return {
    index,
    route,
    tag,
  }
}

export function isManagedRequestButtonCustomId(customId: unknown): boolean {
  return typeof customId === "string"
    && customId.startsWith(`${REQUEST_BUTTON_CUSTOM_ID_VERSION}.`)
}

export function verifyRequestButtonCustomId(
  key: Uint8Array,
  scope: RequestButtonScope,
  layoutDigest: string,
  customId: string,
  descriptor: RequestButtonDescriptor,
): ParsedRequestButtonCustomId | undefined {
  const parsed = parseRequestButtonCustomId(customId)
  if (!parsed || parsed.index !== descriptor.index) return undefined
  const expected = requestButtonTag(
    key,
    scope,
    layoutDigest,
    parsed.route,
    descriptor,
  )
  if (
    !REQUEST_BUTTON_TAG_PATTERN.test(parsed.tag)
    || expected.length !== parsed.tag.length
    || !timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.tag))
  ) return undefined
  return parsed
}

export function requestButtonRouteHash(route: string): string {
  if (!REQUEST_BUTTON_ROUTE_PATTERN.test(route)) {
    throw new RangeError("Discord request-button route is invalid")
  }
  return `sha256:${createHash("sha256")
    .update("guildcontrol-request-button-route-reference.v1\0")
    .update(route)
    .digest("hex")}`
}
