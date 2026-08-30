import { randomBytes } from "node:crypto"

import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import { assertDiscordMessageContent } from "./message-safety.js"

export const COORDINATION_ADDRESS_FORMAT = "guildcontrol.coordination-address.v1"
export const COORDINATION_NOTE_FORMAT = "guildcontrol.coordination-note.v1"
export const COORDINATION_NOTE_SCHEMA_VERSION = 1
export const COORDINATION_BROADCAST_RECIPIENT = "broadcast"
export const COORDINATION_ADDRESS_BYTES = 16
export const COORDINATION_NOTE_BODY_CHARACTERS = 1_500
export const COORDINATION_NOTE_TAGS = 5
export const COORDINATION_NOTE_TAG_CHARACTERS = 32

export const COORDINATION_ADDRESS_PATTERN = /^dca_[A-Za-z0-9_-]{21}[AQgw]$/
export const COORDINATION_NOTE_TAG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/

const COORDINATION_NOTE_LIMITATIONS = Object.freeze([
  "The address is a visible caller-retained routing label, not a secret, identity, session, registration, ownership claim, capability, approval, or authorization.",
  "Any participant able to publish through the same connector bot can copy, reuse, or spoof an address.",
  "The connector stores no address registry or note state; losing the caller-retained address loses the routing convention.",
])

export interface CoordinationAddressReport {
  readonly address: string
  readonly authorityGranted: false
  readonly authenticated: false
  readonly callerRetained: true
  readonly discordContacted: false
  readonly format: typeof COORDINATION_ADDRESS_FORMAT
  readonly limitations: readonly string[]
  readonly networkContacted: false
  readonly persisted: false
  readonly registered: false
  readonly schemaVersion: typeof COORDINATION_NOTE_SCHEMA_VERSION
  readonly status: "created"
}

export type CoordinationNoteRecipient =
  | { readonly kind: "address"; readonly address: string }
  | { readonly kind: "broadcast" }

export interface CoordinationNoteInput {
  readonly body: string
  readonly fromAddress: string
  readonly notifyUserId?: string
  readonly tags?: readonly string[]
  readonly to: CoordinationNoteRecipient
}

export interface CoordinationNoteSendRequest extends CoordinationNoteInput {
  readonly channelId: string
  readonly idempotencyKey: string
  readonly replyToMessageId?: string
}

export interface CoordinationNoteEnvelope {
  readonly body: string
  readonly fromAddress: string
  readonly notifyUserId: string | null
  readonly tags: readonly string[]
  readonly to: CoordinationNoteRecipient
}

function canonicalSnowflake(value: unknown): value is string {
  return typeof value === "string"
    && DISCORD_SNOWFLAKE_PATTERN.test(value)
    && BigInt(value) >= 1n
    && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
    && BigInt(value).toString() === value
}

export function assertCoordinationAddress(
  value: unknown,
  label = "Discord coordination address",
): asserts value is string {
  if (typeof value !== "string" || !COORDINATION_ADDRESS_PATTERN.test(value)) {
    throw new RangeError(`${label} is invalid`)
  }
}

export function assertCoordinationNoteTag(
  value: unknown,
  label = "Discord coordination note tag",
): asserts value is string {
  if (
    typeof value !== "string"
    || value.length > COORDINATION_NOTE_TAG_CHARACTERS
    || !COORDINATION_NOTE_TAG_PATTERN.test(value)
  ) {
    throw new RangeError(`${label} is invalid`)
  }
}

function normalizedTags(value: readonly string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    if (value === undefined) return []
    throw new RangeError("Discord coordination note tags must be an array")
  }
  if (value.length > COORDINATION_NOTE_TAGS) {
    throw new RangeError(
      `Discord coordination note tags must not exceed ${COORDINATION_NOTE_TAGS}`,
    )
  }
  const tags = [...value]
  for (const tag of tags) {
    assertCoordinationNoteTag(tag)
  }
  if (new Set(tags).size !== tags.length) {
    throw new RangeError("Discord coordination note tags must be unique")
  }
  return tags.sort()
}

function recipientValue(recipient: CoordinationNoteRecipient): string {
  if (!recipient || typeof recipient !== "object" || Array.isArray(recipient)) {
    throw new RangeError("Discord coordination note recipient is invalid")
  }
  if (recipient.kind === "broadcast" && Object.keys(recipient).length === 1) {
    return COORDINATION_BROADCAST_RECIPIENT
  }
  if (
    recipient.kind === "address"
    && Object.keys(recipient).length === 2
    && "address" in recipient
  ) {
    assertCoordinationAddress(recipient.address, "Discord coordination recipient address")
    return recipient.address
  }
  throw new RangeError("Discord coordination note recipient is invalid")
}

export function createCoordinationAddress(
  random: (size: number) => Uint8Array = randomBytes,
): CoordinationAddressReport {
  const bytes = random(COORDINATION_ADDRESS_BYTES)
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== COORDINATION_ADDRESS_BYTES) {
    throw new RangeError("Discord coordination address randomness is invalid")
  }
  const address = `dca_${Buffer.from(bytes).toString("base64url")}`
  assertCoordinationAddress(address)
  return Object.freeze({
    address,
    authorityGranted: false as const,
    authenticated: false as const,
    callerRetained: true as const,
    discordContacted: false as const,
    format: COORDINATION_ADDRESS_FORMAT as typeof COORDINATION_ADDRESS_FORMAT,
    limitations: COORDINATION_NOTE_LIMITATIONS,
    networkContacted: false as const,
    persisted: false as const,
    registered: false as const,
    schemaVersion: COORDINATION_NOTE_SCHEMA_VERSION as typeof COORDINATION_NOTE_SCHEMA_VERSION,
    status: "created" as const,
  })
}

export function encodeCoordinationNote(input: CoordinationNoteInput): string {
  assertCoordinationAddress(input.fromAddress, "Discord coordination sender address")
  const to = recipientValue(input.to)
  const tags = normalizedTags(input.tags)
  if (
    typeof input.body !== "string"
    || !input.body.trim()
    || input.body.length > COORDINATION_NOTE_BODY_CHARACTERS
  ) {
    throw new RangeError(
      `Discord coordination note body must be 1-${COORDINATION_NOTE_BODY_CHARACTERS} characters`,
    )
  }
  const notify = input.notifyUserId === undefined
    ? ""
    : canonicalSnowflake(input.notifyUserId)
      ? `<@${input.notifyUserId}>`
      : (() => {
          throw new RangeError("Discord coordination notification user ID is invalid")
        })()
  const content = [
    `[${COORDINATION_NOTE_FORMAT}]`,
    `to=${to}`,
    `from=${input.fromAddress}`,
    `tags=${tags.join(",")}`,
    `notify=${notify}`,
    "",
    input.body,
  ].join("\n")
  assertDiscordMessageContent(content)
  return content
}

export function parseCoordinationNote(content: unknown): CoordinationNoteEnvelope | undefined {
  if (typeof content !== "string") return undefined
  const separator = content.indexOf("\n\n")
  if (separator < 0) return undefined
  const header = content.slice(0, separator).split("\n")
  const body = content.slice(separator + 2)
  if (
    header.length !== 5
    || header[0] !== `[${COORDINATION_NOTE_FORMAT}]`
    || !header[1]?.startsWith("to=")
    || !header[2]?.startsWith("from=")
    || !header[3]?.startsWith("tags=")
    || !header[4]?.startsWith("notify=")
  ) {
    return undefined
  }
  const toValue = header[1].slice(3)
  const fromAddress = header[2].slice(5)
  const tagValue = header[3].slice(5)
  const notifyValue = header[4].slice(7)
  const to: CoordinationNoteRecipient = toValue === COORDINATION_BROADCAST_RECIPIENT
    ? { kind: "broadcast" }
    : { address: toValue, kind: "address" }
  const tags = tagValue ? tagValue.split(",") : []
  const notifyMatch = notifyValue.match(/^<@([0-9]{1,20})>$/)
  const notifyUserId = notifyValue === ""
    ? undefined
    : notifyMatch?.[1]
  try {
    const normalized = encodeCoordinationNote({
      body,
      fromAddress,
      ...(notifyUserId ? { notifyUserId } : {}),
      tags,
      to,
    })
    if (normalized !== content) return undefined
    return Object.freeze({
      body,
      fromAddress,
      notifyUserId: notifyUserId ?? null,
      tags: Object.freeze(tags),
      to: Object.freeze(to),
    })
  } catch {
    return undefined
  }
}
