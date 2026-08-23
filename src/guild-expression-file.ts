import { DISCORD_LIMITS } from "./constants.js"
import {
  OwnedLocalFileError,
  readOwnedLocalFileSnapshot,
  type OwnedLocalFileSnapshot,
} from "./local-file.js"

export const EMOJI_FILE_FORMATS = [
  "avif",
  "gif",
  "jpeg",
  "png",
  "webp",
] as const

export const STICKER_FILE_FORMATS = [
  "apng",
  "gif",
  "lottie",
  "png",
] as const

export type EmojiFileFormat = typeof EMOJI_FILE_FORMATS[number]
export type StickerFileFormat = typeof STICKER_FILE_FORMATS[number]
export type GuildExpressionFileFormat = EmojiFileFormat | StickerFileFormat
export type GuildExpressionFileKind = "emoji" | "sticker"

export interface GuildExpressionFileReview {
  animated: boolean
  canonicalPath: string
  containedByConfiguredRoot: true
  durationSeconds: number | null
  format: GuildExpressionFileFormat
  height: number | null
  mediaType: string
  ownerMatchesProcess: true
  regularFile: true
  singleLink: true
  sizeBytes: number
  stableRead: true
  width: number | null
}

export interface GuildExpressionFileSnapshot extends Omit<
  OwnedLocalFileSnapshot,
  "review"
> {
  review: GuildExpressionFileReview
}

export interface ReadGuildExpressionFileOptions {
  filePath: string
  kind: GuildExpressionFileKind
  planKey: Uint8Array
  roots: readonly string[]
}

export interface ReadApplicationEmojiFileOptions {
  filePath: string
  planKey: Uint8Array
  roots: readonly string[]
}

export class GuildExpressionFileError extends Error {
  override name = "GuildExpressionFileError"
}

interface MediaDetails {
  animated: boolean
  durationSeconds: number | null
  format: GuildExpressionFileFormat
  height: number | null
  mediaType: string
  width: number | null
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const
const JPEG_SOF_MARKERS = new Set([
  0xC0,
  0xC1,
  0xC2,
  0xC3,
  0xC5,
  0xC6,
  0xC7,
  0xC9,
  0xCA,
  0xCB,
  0xCD,
  0xCE,
  0xCF,
])

function matches(bytes: Uint8Array, offset: number, values: readonly number[]): boolean {
  if (offset < 0 || offset + values.length > bytes.byteLength) return false
  return values.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new GuildExpressionFileError("Discord guild expression file is truncated")
  }
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function u16be(bytes: Uint8Array, offset: number): number {
  const left = bytes[offset]
  const right = bytes[offset + 1]
  if (left === undefined || right === undefined) {
    throw new GuildExpressionFileError("Discord guild expression file is truncated")
  }
  return (left << 8) | right
}

function u16le(bytes: Uint8Array, offset: number): number {
  const left = bytes[offset]
  const right = bytes[offset + 1]
  if (left === undefined || right === undefined) {
    throw new GuildExpressionFileError("Discord guild expression file is truncated")
  }
  return left | (right << 8)
}

function u24le(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  const c = bytes[offset + 2]
  if (a === undefined || b === undefined || c === undefined) {
    throw new GuildExpressionFileError("Discord guild expression file is truncated")
  }
  return a | (b << 8) | (c << 16)
}

function u32be(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  const c = bytes[offset + 2]
  const d = bytes[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new GuildExpressionFileError("Discord guild expression file is truncated")
  }
  return ((a * 0x1000000) + (b << 16) + (c << 8) + d) >>> 0
}

function u32le(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  const c = bytes[offset + 2]
  const d = bytes[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new GuildExpressionFileError("Discord guild expression file is truncated")
  }
  return (a + (b << 8) + (c << 16) + (d * 0x1000000)) >>> 0
}

function roundedDuration(seconds: number): number {
  return Math.round(seconds * 1_000_000) / 1_000_000
}

function parsePng(bytes: Uint8Array): MediaDetails {
  if (!matches(bytes, 0, PNG_SIGNATURE)) {
    throw new GuildExpressionFileError("Discord guild expression PNG signature is invalid")
  }
  let offset: number = PNG_SIGNATURE.length
  let width: number | null = null
  let height: number | null = null
  let animated = false
  let animationFrames: number | null = null
  let frameCount = 0
  let durationSeconds = 0
  let ended = false
  while (offset + 12 <= bytes.byteLength) {
    const length = u32be(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    const dataOffset = offset + 8
    const next = dataOffset + length + 4
    if (next > bytes.byteLength) {
      throw new GuildExpressionFileError("Discord guild expression PNG chunk is truncated")
    }
    if (width === null) {
      if (type !== "IHDR" || length !== 13) {
        throw new GuildExpressionFileError("Discord guild expression PNG lacks a leading IHDR")
      }
      width = u32be(bytes, dataOffset)
      height = u32be(bytes, dataOffset + 4)
      if (width < 1 || height < 1) {
        throw new GuildExpressionFileError("Discord guild expression PNG dimensions are invalid")
      }
    } else if (type === "acTL") {
      if (length !== 8 || animated) {
        throw new GuildExpressionFileError("Discord guild expression APNG control is invalid")
      }
      animated = true
      animationFrames = u32be(bytes, dataOffset)
      if (animationFrames < 1) {
        throw new GuildExpressionFileError("Discord guild expression APNG has no frames")
      }
    } else if (type === "fcTL") {
      if (!animated || length !== 26) {
        throw new GuildExpressionFileError("Discord guild expression APNG frame control is invalid")
      }
      frameCount += 1
      const delayNumerator = u16be(bytes, dataOffset + 20)
      const delayDenominator = u16be(bytes, dataOffset + 22) || 100
      durationSeconds += delayNumerator / delayDenominator
    }
    if (type === "IEND") {
      if (length !== 0 || next !== bytes.byteLength) {
        throw new GuildExpressionFileError("Discord guild expression PNG trailer is invalid")
      }
      ended = true
      break
    }
    offset = next
  }
  if (!ended || width === null || height === null) {
    throw new GuildExpressionFileError("Discord guild expression PNG is incomplete")
  }
  if (animated && animationFrames !== frameCount) {
    throw new GuildExpressionFileError("Discord guild expression APNG frame count is inconsistent")
  }
  return {
    animated,
    durationSeconds: animated ? roundedDuration(durationSeconds) : null,
    format: animated ? "apng" : "png",
    height,
    mediaType: "image/png",
    width,
  }
}

function skipGifSubBlocks(bytes: Uint8Array, initialOffset: number): number {
  let offset = initialOffset
  while (offset < bytes.byteLength) {
    const length = bytes[offset]
    if (length === undefined) break
    offset += 1
    if (length === 0) return offset
    if (offset + length > bytes.byteLength) break
    offset += length
  }
  throw new GuildExpressionFileError("Discord guild expression GIF block is truncated")
}

function parseGif(bytes: Uint8Array): MediaDetails {
  const signature = ascii(bytes, 0, Math.min(6, bytes.byteLength))
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new GuildExpressionFileError("Discord guild expression GIF signature is invalid")
  }
  if (bytes.byteLength < 14) {
    throw new GuildExpressionFileError("Discord guild expression GIF is truncated")
  }
  const width = u16le(bytes, 6)
  const height = u16le(bytes, 8)
  if (width < 1 || height < 1) {
    throw new GuildExpressionFileError("Discord guild expression GIF dimensions are invalid")
  }
  const packed = bytes[10] as number
  let offset = 13
  if ((packed & 0x80) !== 0) {
    offset += 3 * (2 ** ((packed & 0x07) + 1))
  }
  let pendingDelay = 0
  let durationSeconds = 0
  let frames = 0
  let ended = false
  while (offset < bytes.byteLength) {
    const marker = bytes[offset]
    if (marker === 0x3B) {
      ended = offset + 1 === bytes.byteLength
      break
    }
    if (marker === 0x21) {
      const label = bytes[offset + 1]
      if (label === undefined) {
        throw new GuildExpressionFileError("Discord guild expression GIF extension is truncated")
      }
      if (label === 0xF9) {
        if (bytes[offset + 2] !== 4 || bytes[offset + 7] !== 0) {
          throw new GuildExpressionFileError("Discord guild expression GIF frame control is invalid")
        }
        pendingDelay = u16le(bytes, offset + 4) / 100
        offset += 8
      } else {
        offset = skipGifSubBlocks(bytes, offset + 2)
      }
      continue
    }
    if (marker !== 0x2C || offset + 10 > bytes.byteLength) {
      throw new GuildExpressionFileError("Discord guild expression GIF structure is invalid")
    }
    const imagePacked = bytes[offset + 9] as number
    offset += 10
    if ((imagePacked & 0x80) !== 0) {
      offset += 3 * (2 ** ((imagePacked & 0x07) + 1))
    }
    if (offset >= bytes.byteLength) {
      throw new GuildExpressionFileError("Discord guild expression GIF image is truncated")
    }
    offset = skipGifSubBlocks(bytes, offset + 1)
    frames += 1
    durationSeconds += pendingDelay
    pendingDelay = 0
  }
  if (!ended || frames < 1) {
    throw new GuildExpressionFileError("Discord guild expression GIF is incomplete")
  }
  return {
    animated: frames > 1,
    durationSeconds: frames > 1 ? roundedDuration(durationSeconds) : null,
    format: "gif",
    height,
    mediaType: "image/gif",
    width,
  }
}

function parseJpeg(bytes: Uint8Array): MediaDetails {
  if (!matches(bytes, 0, [0xFF, 0xD8]) || !matches(bytes, bytes.byteLength - 2, [0xFF, 0xD9])) {
    throw new GuildExpressionFileError("Discord guild expression JPEG framing is invalid")
  }
  let offset = 2
  while (offset + 4 <= bytes.byteLength - 2) {
    if (bytes[offset] !== 0xFF) {
      throw new GuildExpressionFileError("Discord guild expression JPEG marker is invalid")
    }
    while (bytes[offset] === 0xFF) offset += 1
    const marker = bytes[offset]
    if (marker === undefined) break
    offset += 1
    if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      continue
    }
    const length = u16be(bytes, offset)
    if (length < 2 || offset + length > bytes.byteLength) {
      throw new GuildExpressionFileError("Discord guild expression JPEG segment is truncated")
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) {
        throw new GuildExpressionFileError("Discord guild expression JPEG dimensions are truncated")
      }
      const height = u16be(bytes, offset + 3)
      const width = u16be(bytes, offset + 5)
      if (width < 1 || height < 1) {
        throw new GuildExpressionFileError("Discord guild expression JPEG dimensions are invalid")
      }
      return {
        animated: false,
        durationSeconds: null,
        format: "jpeg",
        height,
        mediaType: "image/jpeg",
        width,
      }
    }
    offset += length
  }
  throw new GuildExpressionFileError("Discord guild expression JPEG lacks dimensions")
}

function parseWebp(bytes: Uint8Array): MediaDetails {
  if (ascii(bytes, 0, Math.min(4, bytes.byteLength)) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    throw new GuildExpressionFileError("Discord guild expression WebP signature is invalid")
  }
  if (u32le(bytes, 4) + 8 !== bytes.byteLength) {
    throw new GuildExpressionFileError("Discord guild expression WebP container size is invalid")
  }
  const chunk = ascii(bytes, 12, 4)
  const chunkSize = u32le(bytes, 16)
  if (20 + chunkSize + (chunkSize % 2) > bytes.byteLength) {
    throw new GuildExpressionFileError("Discord guild expression WebP chunk is truncated")
  }
  let width: number | null = null
  let height: number | null = null
  let animated = false
  if (chunk === "VP8X" && bytes.byteLength >= 30 && chunkSize === 10) {
    animated = ((bytes[20] as number) & 0x02) !== 0
    width = u24le(bytes, 24) + 1
    height = u24le(bytes, 27) + 1
  } else if (
    chunk === "VP8 "
    && bytes.byteLength >= 30
    && chunkSize >= 10
    && matches(bytes, 23, [0x9D, 0x01, 0x2A])
  ) {
    width = u16le(bytes, 26) & 0x3FFF
    height = u16le(bytes, 28) & 0x3FFF
  } else if (
    chunk === "VP8L"
    && bytes.byteLength >= 25
    && chunkSize >= 5
    && bytes[20] === 0x2F
  ) {
    const bits = (bytes[21] as number)
      | ((bytes[22] as number) << 8)
      | ((bytes[23] as number) << 16)
      | ((bytes[24] as number) << 24)
    width = (bits & 0x3FFF) + 1
    height = ((bits >>> 14) & 0x3FFF) + 1
  } else {
    throw new GuildExpressionFileError("Discord guild expression WebP container is unsupported")
  }
  if (width < 1 || height < 1) {
    throw new GuildExpressionFileError("Discord guild expression WebP dimensions are invalid")
  }
  return {
    animated,
    durationSeconds: null,
    format: "webp",
    height,
    mediaType: "image/webp",
    width,
  }
}

function parseAvif(bytes: Uint8Array): MediaDetails {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 4) !== "ftyp") {
    throw new GuildExpressionFileError("Discord guild expression AVIF container is invalid")
  }
  const boxSize = u32be(bytes, 0)
  if (boxSize < 16 || boxSize > bytes.byteLength) {
    throw new GuildExpressionFileError("Discord guild expression AVIF file-type box is invalid")
  }
  const brands = new Set<string>([ascii(bytes, 8, 4)])
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.add(ascii(bytes, offset, 4))
  }
  if (!brands.has("avif") && !brands.has("avis")) {
    throw new GuildExpressionFileError("Discord guild expression AVIF brand is missing")
  }
  return {
    animated: brands.has("avis"),
    durationSeconds: null,
    format: "avif",
    height: null,
    mediaType: "image/avif",
    width: null,
  }
}

function parseLottie(bytes: Uint8Array): MediaDetails {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new GuildExpressionFileError("Discord guild expression Lottie JSON is not UTF-8", {
      cause: error,
    })
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (error) {
    throw new GuildExpressionFileError("Discord guild expression Lottie JSON is invalid", {
      cause: error,
    })
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuildExpressionFileError("Discord guild expression Lottie root must be an object")
  }
  const record = value as Record<string, unknown>
  const width = record.w
  const height = record.h
  const frameRate = record.fr
  const firstFrame = record.ip
  const lastFrame = record.op
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || typeof frameRate !== "number"
    || typeof firstFrame !== "number"
    || typeof lastFrame !== "number"
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || !Number.isFinite(frameRate)
    || !Number.isFinite(firstFrame)
    || !Number.isFinite(lastFrame)
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || frameRate <= 0
    || lastFrame <= firstFrame
  ) {
    throw new GuildExpressionFileError("Discord guild expression Lottie dimensions or timing are invalid")
  }
  return {
    animated: true,
    durationSeconds: roundedDuration((lastFrame - firstFrame) / frameRate),
    format: "lottie",
    height,
    mediaType: "application/json",
    width,
  }
}

function emojiDetails(bytes: Uint8Array): MediaDetails {
  if (matches(bytes, 0, PNG_SIGNATURE)) {
    const details = parsePng(bytes)
    if (details.format === "apng") {
      return { ...details, format: "png" }
    }
    return details
  }
  const prefix = bytes.byteLength >= 6 ? ascii(bytes, 0, 6) : ""
  if (prefix === "GIF87a" || prefix === "GIF89a") return parseGif(bytes)
  if (matches(bytes, 0, [0xFF, 0xD8])) return parseJpeg(bytes)
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF") return parseWebp(bytes)
  if (bytes.byteLength >= 12 && ascii(bytes, 4, 4) === "ftyp") return parseAvif(bytes)
  throw new GuildExpressionFileError(
    "Discord emoji file must be JPEG, PNG, GIF, WebP, or AVIF",
  )
}

function stickerDetails(bytes: Uint8Array): MediaDetails {
  let details: MediaDetails
  if (matches(bytes, 0, PNG_SIGNATURE)) {
    details = parsePng(bytes)
  } else {
    const prefix = bytes.byteLength >= 6 ? ascii(bytes, 0, 6) : ""
    if (prefix === "GIF87a" || prefix === "GIF89a") {
      details = parseGif(bytes)
    } else {
      details = parseLottie(bytes)
    }
  }
  if (
    details.width !== DISCORD_LIMITS.stickerPixels
    || details.height !== DISCORD_LIMITS.stickerPixels
  ) {
    throw new GuildExpressionFileError(
      `Discord sticker must be ${DISCORD_LIMITS.stickerPixels} by ${DISCORD_LIMITS.stickerPixels} pixels`,
    )
  }
  if (
    details.durationSeconds !== null
    && details.durationSeconds > DISCORD_LIMITS.stickerDurationSeconds
  ) {
    throw new GuildExpressionFileError(
      `Discord animated sticker must not exceed ${DISCORD_LIMITS.stickerDurationSeconds} seconds`,
    )
  }
  return details
}

async function readExpressionFileSnapshot(
  options: ReadGuildExpressionFileOptions & {
    description: string
    digestDomain: string
  },
): Promise<GuildExpressionFileSnapshot> {
  if (options.kind !== "emoji" && options.kind !== "sticker") {
    throw new RangeError("Discord guild expression kind must be emoji or sticker")
  }
  let snapshot: OwnedLocalFileSnapshot
  try {
    snapshot = await readOwnedLocalFileSnapshot({
      description: options.description,
      digestDomain: options.digestDomain,
      filePath: options.filePath,
      maxBytes: options.kind === "emoji"
        ? DISCORD_LIMITS.emojiBytes
        : DISCORD_LIMITS.stickerBytes,
      planKey: options.planKey,
      roots: options.roots,
    })
  } catch (error) {
    if (error instanceof OwnedLocalFileError) {
      throw new GuildExpressionFileError(error.message, { cause: error })
    }
    throw error
  }
  const details = options.kind === "emoji"
    ? emojiDetails(snapshot.bytes)
    : stickerDetails(snapshot.bytes)
  return {
    binding: snapshot.binding,
    bytes: snapshot.bytes,
    contentDigest: snapshot.contentDigest,
    review: {
      ...snapshot.review,
      ...details,
    },
  }
}

export async function readGuildExpressionFileSnapshot(
  options: ReadGuildExpressionFileOptions,
): Promise<GuildExpressionFileSnapshot> {
  return readExpressionFileSnapshot({
    ...options,
    description: `Discord ${options.kind}`,
    digestDomain: `discord-mcp-guild-expression-${options.kind}.v1`,
  })
}

export async function readApplicationEmojiFileSnapshot(
  options: ReadApplicationEmojiFileOptions,
): Promise<GuildExpressionFileSnapshot> {
  return readExpressionFileSnapshot({
    ...options,
    description: "Discord application emoji",
    digestDomain: "discord-mcp-application-emoji.v1",
    kind: "emoji",
  })
}
