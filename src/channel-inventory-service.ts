import {
  createHmac,
  timingSafeEqual,
} from "node:crypto"

import {
  CHANNEL_INVENTORY_CURSOR_PATTERN,
  CHANNEL_INVENTORY_LIMITS,
  DISCORD_LIMITS,
  DISCORD_SNOWFLAKE_PATTERN,
  SCHEMA_VERSION,
} from "./constants.js"
import type { DiscordClient } from "./discord-client.js"
import { ChannelInventoryEvidenceError } from "./errors.js"
import {
  normalizeChannel,
  stableString,
} from "./normalize.js"
import type { ScopePolicy } from "./policy.js"
import {
  createReviewedPlanKey,
  REVIEWED_PLAN_DIGEST_PATTERN,
  reviewedPlanDigest,
} from "./reviewed-plan.js"
import type {
  DiscordChannel,
  RequestOptions,
} from "./types.js"

const CHANNEL_INVENTORY_CURSOR_PREFIX = "ccur_hmac_sha256_"
const CHANNEL_INVENTORY_CURSOR_DOMAIN = "guildcontrol-channel-inventory-cursor.v1"
const CHANNEL_INVENTORY_DIGEST_DOMAIN = "guildcontrol-channel-inventory.v1"

export const CHANNEL_INVENTORY_DETAILS = ["compact", "full"] as const

export type ChannelInventoryDetail = typeof CHANNEL_INVENTORY_DETAILS[number]
export type NormalizedGuildChannel = ReturnType<typeof normalizeChannel>

export interface CompactGuildChannel {
  id: string
  name: string | null
  parentId: string | null
  position: number | null
  type: number
  typeName: string
}

export interface ChannelInventoryListOptions extends RequestOptions {
  cursor?: string
  detail?: ChannelInventoryDetail
  limit?: number
}

export interface CompleteChannelInventoryResult {
  channels: NormalizedGuildChannel[]
  guildId: string
  inventory: {
    completeness: "visibility-bounded"
    returned: number
    scope: "configured-policy-and-discord-visibility"
  }
  schemaVersion: number
  status: "ok"
}

export interface ChannelInventoryPageResult {
  channels: Array<CompactGuildChannel | NormalizedGuildChannel>
  guildId: string
  inventory: {
    completeness: "visibility-bounded"
    scope: "configured-policy-and-discord-visibility"
  }
  page: {
    continuation: "process-local-fresh-ordered-inventory-bound"
    cursor: string | null
    hasMore: boolean
    nextCursor: string | null
    requestedLimit: number
    returned: number
    totalVisible: number
  }
  projection: {
    detail: ChannelInventoryDetail
    exactMetadataTool: "get_channel" | null
  }
  schemaVersion: number
  status: "ok"
}

export type ChannelInventoryResult =
  | ChannelInventoryPageResult
  | CompleteChannelInventoryResult

interface ChannelInventoryCursorPayload {
  detail: ChannelInventoryDetail
  guildId: string
  inventoryDigest: string
  offset: number
  version: 1
}

export interface ChannelInventoryServiceClient {
  getGuildChannels: DiscordClient["getGuildChannels"]
}

export interface ChannelInventoryServiceOptions {
  client: ChannelInventoryServiceClient
  cursorKey?: Uint8Array
  policy: Pick<ScopePolicy, "assertGuildAllowed" | "filterChannels">
}

function evidenceError(message: string): ChannelInventoryEvidenceError {
  return new ChannelInventoryEvidenceError(message)
}

function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  if (leftValue < rightValue) return -1
  if (leftValue > rightValue) return 1
  return 0
}

function compareChannels(
  left: NormalizedGuildChannel,
  right: NormalizedGuildChannel,
): number {
  const positionDifference = (
    left.position ?? Number.MAX_SAFE_INTEGER
  ) - (
    right.position ?? Number.MAX_SAFE_INTEGER
  )
  if (positionDifference !== 0) return positionDifference
  if (left.type !== right.type) return left.type - right.type
  return compareSnowflakes(left.id, right.id)
}

function compactChannel(channel: NormalizedGuildChannel): CompactGuildChannel {
  return {
    id: channel.id,
    name: channel.name,
    parentId: channel.parentId,
    position: channel.position,
    type: channel.type,
    typeName: channel.typeName,
  }
}

function assertRawInventory(
  channels: readonly DiscordChannel[],
  guildId: string,
): void {
  if (channels.length > DISCORD_LIMITS.guildChannels) {
    throw evidenceError("Discord returned a guild channel inventory above the documented limit")
  }
  const ids = new Set<string>()
  for (const channel of channels) {
    if (
      typeof channel.id !== "string"
      || !DISCORD_SNOWFLAKE_PATTERN.test(channel.id)
      || !Number.isSafeInteger(channel.type)
      || channel.type < 0
      || (channel.guild_id !== undefined && channel.guild_id !== guildId)
      || !(
        channel.parent_id === undefined
        || channel.parent_id === null
        || (
          typeof channel.parent_id === "string"
          && DISCORD_SNOWFLAKE_PATTERN.test(channel.parent_id)
        )
      )
      || !(
        channel.position === undefined
        || (Number.isSafeInteger(channel.position) && channel.position >= 0)
      )
    ) {
      throw evidenceError("Discord returned invalid or mismatched guild channel evidence")
    }
    if (ids.has(channel.id)) {
      throw evidenceError("Discord returned duplicate guild channel evidence")
    }
    ids.add(channel.id)
  }
}

function cursorSignature(key: Uint8Array, encodedPayload: string): string {
  return createHmac("sha256", key)
    .update(CHANNEL_INVENTORY_CURSOR_DOMAIN)
    .update("\0")
    .update(encodedPayload)
    .digest("hex")
}

function encodeCursor(
  key: Uint8Array,
  payload: ChannelInventoryCursorPayload,
): string {
  const encoded = Buffer.from(stableString(payload), "utf8").toString("base64url")
  const cursor = `${CHANNEL_INVENTORY_CURSOR_PREFIX}${encoded}.${cursorSignature(key, encoded)}`
  if (cursor.length > CHANNEL_INVENTORY_LIMITS.cursorCharacters) {
    throw evidenceError("Discord channel inventory cursor exceeded its local safety bound")
  }
  return cursor
}

function decodeCursor(
  key: Uint8Array,
  cursor: string,
  guildId: string,
): ChannelInventoryCursorPayload {
  if (
    cursor.length > CHANNEL_INVENTORY_LIMITS.cursorCharacters
    || !CHANNEL_INVENTORY_CURSOR_PATTERN.test(cursor)
  ) {
    throw new RangeError("Discord channel inventory cursor is invalid or expired")
  }
  const separator = cursor.lastIndexOf(".")
  const encoded = cursor.slice(CHANNEL_INVENTORY_CURSOR_PREFIX.length, separator)
  const signature = cursor.slice(separator + 1)
  const expected = cursorSignature(key, encoded)
  const signatureBytes = Buffer.from(signature, "hex")
  const expectedBytes = Buffer.from(expected, "hex")
  if (
    signatureBytes.length !== expectedBytes.length
    || !timingSafeEqual(signatureBytes, expectedBytes)
  ) {
    throw new RangeError("Discord channel inventory cursor is invalid or expired")
  }
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown
  } catch {
    throw new RangeError("Discord channel inventory cursor is invalid or expired")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("Discord channel inventory cursor is invalid or expired")
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).sort().join("\0") !== [
      "detail",
      "guildId",
      "inventoryDigest",
      "offset",
      "version",
    ].join("\0")
    || !CHANNEL_INVENTORY_DETAILS.includes(record.detail as ChannelInventoryDetail)
    || record.guildId !== guildId
    || typeof record.inventoryDigest !== "string"
    || !REVIEWED_PLAN_DIGEST_PATTERN.test(record.inventoryDigest)
    || !Number.isSafeInteger(record.offset)
    || (record.offset as number) < 1
    || (record.offset as number) > DISCORD_LIMITS.guildChannels
    || record.version !== 1
  ) {
    throw new RangeError("Discord channel inventory cursor is invalid or expired")
  }
  return record as unknown as ChannelInventoryCursorPayload
}

function assertListOptions(options: ChannelInventoryListOptions): void {
  if (
    options.detail !== undefined
    && !CHANNEL_INVENTORY_DETAILS.includes(options.detail)
  ) {
    throw new RangeError("Discord channel inventory detail is unsupported")
  }
  if (
    options.limit !== undefined
    && (
      !Number.isSafeInteger(options.limit)
      || options.limit < 1
      || options.limit > CHANNEL_INVENTORY_LIMITS.page
    )
  ) {
    throw new RangeError(
      `Discord channel inventory limit must be an integer between 1 and ${CHANNEL_INVENTORY_LIMITS.page}`,
    )
  }
  if (options.cursor !== undefined && typeof options.cursor !== "string") {
    throw new RangeError("Discord channel inventory cursor must be a string")
  }
}

export class ChannelInventoryService {
  readonly #client: ChannelInventoryServiceClient
  readonly #cursorKey: Uint8Array
  readonly #policy: Pick<ScopePolicy, "assertGuildAllowed" | "filterChannels">

  constructor(options: ChannelInventoryServiceOptions) {
    this.#client = options.client
    this.#cursorKey = new Uint8Array(options.cursorKey ?? createReviewedPlanKey())
    this.#policy = options.policy
  }

  async list(
    guildId: string,
    options: ChannelInventoryListOptions = {},
  ): Promise<ChannelInventoryResult> {
    assertListOptions(options)
    this.#policy.assertGuildAllowed(guildId)
    const cursor = options.cursor !== undefined
      ? decodeCursor(this.#cursorKey, options.cursor, guildId)
      : undefined
    if (cursor && options.detail && cursor.detail !== options.detail) {
      throw new RangeError("Discord channel inventory cursor projection does not match detail")
    }
    const channels = await this.#client.getGuildChannels(guildId, options)
    assertRawInventory(channels, guildId)
    const projected = this.#policy.filterChannels(channels)
      .map((channel) => normalizeChannel({
        ...channel,
        guild_id: channel.guild_id || guildId,
      }))
      .sort(compareChannels)
    const pageRequested = (
      options.cursor !== undefined
      || options.detail !== undefined
      || options.limit !== undefined
    )
    if (!pageRequested) {
      return {
        channels: projected,
        guildId,
        inventory: {
          completeness: "visibility-bounded",
          returned: projected.length,
          scope: "configured-policy-and-discord-visibility",
        },
        schemaVersion: SCHEMA_VERSION,
        status: "ok",
      }
    }
    const detail = cursor?.detail ?? options.detail ?? "compact"
    const inventoryDigest = reviewedPlanDigest(this.#cursorKey, {
      channels: projected.map((channel) => ({
        id: channel.id,
        parentId: channel.parentId,
        position: channel.position,
        type: channel.type,
      })),
      domain: CHANNEL_INVENTORY_DIGEST_DOMAIN,
      guildId,
    })
    if (cursor && cursor.inventoryDigest !== inventoryDigest) {
      throw evidenceError("Discord channel inventory changed; restart pagination")
    }
    const offset = cursor?.offset ?? 0
    if (offset > projected.length) {
      throw evidenceError("Discord channel inventory cursor is outside the fresh inventory")
    }
    const limit = options.limit ?? CHANNEL_INVENTORY_LIMITS.pageDefault
    const page = projected.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    const hasMore = nextOffset < projected.length
    return {
      channels: detail === "compact" ? page.map(compactChannel) : page,
      guildId,
      inventory: {
        completeness: "visibility-bounded",
        scope: "configured-policy-and-discord-visibility",
      },
      page: {
        continuation: "process-local-fresh-ordered-inventory-bound",
        cursor: options.cursor ?? null,
        hasMore,
        nextCursor: hasMore
          ? encodeCursor(this.#cursorKey, {
              detail,
              guildId,
              inventoryDigest,
              offset: nextOffset,
              version: 1,
            })
          : null,
        requestedLimit: limit,
        returned: page.length,
        totalVisible: projected.length,
      },
      projection: {
        detail,
        exactMetadataTool: detail === "compact" ? "get_channel" : null,
      },
      schemaVersion: SCHEMA_VERSION,
      status: "ok",
    }
  }
}
