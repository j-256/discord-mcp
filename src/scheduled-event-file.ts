import { DISCORD_LIMITS } from "./constants.js"
import {
  OwnedLocalFileError,
  readOwnedLocalFileSnapshot,
  type OwnedLocalFileSnapshot,
} from "./local-file.js"

export const SCHEDULED_EVENT_COVER_FORMATS = [
  "jpeg",
  "png",
] as const

export type ScheduledEventCoverFormat =
  typeof SCHEDULED_EVENT_COVER_FORMATS[number]

export interface ScheduledEventCoverFileReview {
  canonicalPath: string
  containedByConfiguredRoot: true
  format: ScheduledEventCoverFormat
  height: number
  mediaType: "image/jpeg" | "image/png"
  ownerMatchesProcess: true
  regularFile: true
  singleLink: true
  sizeBytes: number
  stableRead: true
  width: number
}

export interface ScheduledEventCoverFileSnapshot extends Omit<
  OwnedLocalFileSnapshot,
  "review"
> {
  review: ScheduledEventCoverFileReview
}

export interface ReadScheduledEventCoverFileOptions {
  filePath: string
  planKey: Uint8Array
  roots: readonly string[]
}

export class ScheduledEventCoverFileError extends Error {
  override name = "ScheduledEventCoverFileError"
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const
const JPEG_START_OF_FRAME_MARKERS = new Set([
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

interface CoverDetails {
  format: ScheduledEventCoverFormat
  height: number
  mediaType: "image/jpeg" | "image/png"
  width: number
}

function matches(
  bytes: Uint8Array,
  offset: number,
  values: readonly number[],
): boolean {
  if (offset < 0 || offset + values.length > bytes.byteLength) return false
  return values.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new ScheduledEventCoverFileError("Discord scheduled event cover is truncated")
  }
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function u16be(bytes: Uint8Array, offset: number): number {
  const left = bytes[offset]
  const right = bytes[offset + 1]
  if (left === undefined || right === undefined) {
    throw new ScheduledEventCoverFileError("Discord scheduled event cover is truncated")
  }
  return (left << 8) | right
}

function u32be(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  const c = bytes[offset + 2]
  const d = bytes[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new ScheduledEventCoverFileError("Discord scheduled event cover is truncated")
  }
  return ((a * 0x1000000) + (b << 16) + (c << 8) + d) >>> 0
}

function pngDetails(bytes: Uint8Array): CoverDetails {
  if (!matches(bytes, 0, PNG_SIGNATURE) || bytes.byteLength < 33) {
    throw new ScheduledEventCoverFileError("Discord scheduled event PNG cover is invalid")
  }
  if (u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") {
    throw new ScheduledEventCoverFileError(
      "Discord scheduled event PNG cover lacks a leading IHDR",
    )
  }
  const width = u32be(bytes, 16)
  const height = u32be(bytes, 20)
  let offset = 8
  let ended = false
  while (offset + 12 <= bytes.byteLength) {
    const length = u32be(bytes, offset)
    const type = ascii(bytes, offset + 4, 4)
    const next = offset + 12 + length
    if (next > bytes.byteLength) {
      throw new ScheduledEventCoverFileError(
        "Discord scheduled event PNG cover chunk is truncated",
      )
    }
    if (type === "acTL") {
      throw new ScheduledEventCoverFileError(
        "Discord scheduled event cover must not be animated",
      )
    }
    if (type === "IEND") {
      ended = length === 0 && next === bytes.byteLength
      break
    }
    offset = next
  }
  if (!ended || width < 1 || height < 1) {
    throw new ScheduledEventCoverFileError("Discord scheduled event PNG cover is incomplete")
  }
  return { format: "png", height, mediaType: "image/png", width }
}

function jpegDetails(bytes: Uint8Array): CoverDetails {
  if (!matches(bytes, 0, [0xFF, 0xD8]) || !matches(bytes, bytes.byteLength - 2, [0xFF, 0xD9])) {
    throw new ScheduledEventCoverFileError("Discord scheduled event JPEG cover framing is invalid")
  }
  let offset = 2
  while (offset + 4 <= bytes.byteLength - 2) {
    if (bytes[offset] !== 0xFF) {
      throw new ScheduledEventCoverFileError("Discord scheduled event JPEG cover marker is invalid")
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
      throw new ScheduledEventCoverFileError(
        "Discord scheduled event JPEG cover segment is truncated",
      )
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (length < 7) {
        throw new ScheduledEventCoverFileError(
          "Discord scheduled event JPEG cover dimensions are truncated",
        )
      }
      const height = u16be(bytes, offset + 3)
      const width = u16be(bytes, offset + 5)
      if (width < 1 || height < 1) {
        throw new ScheduledEventCoverFileError(
          "Discord scheduled event JPEG cover dimensions are invalid",
        )
      }
      return { format: "jpeg", height, mediaType: "image/jpeg", width }
    }
    offset += length
  }
  throw new ScheduledEventCoverFileError(
    "Discord scheduled event JPEG cover lacks dimensions",
  )
}

function inspectCover(bytes: Uint8Array): CoverDetails {
  if (matches(bytes, 0, PNG_SIGNATURE)) return pngDetails(bytes)
  if (matches(bytes, 0, [0xFF, 0xD8])) return jpegDetails(bytes)
  throw new ScheduledEventCoverFileError(
    "Discord scheduled event cover must be JPEG or non-animated PNG",
  )
}

export async function readScheduledEventCoverFileSnapshot(
  options: ReadScheduledEventCoverFileOptions,
): Promise<ScheduledEventCoverFileSnapshot> {
  let snapshot: OwnedLocalFileSnapshot
  try {
    snapshot = await readOwnedLocalFileSnapshot({
      description: "Discord scheduled event cover",
      digestDomain: "discord-mcp-scheduled-event-cover.v1",
      filePath: options.filePath,
      maxBytes: DISCORD_LIMITS.scheduledEventCoverBytes,
      planKey: options.planKey,
      roots: options.roots,
    })
  } catch (error) {
    if (error instanceof OwnedLocalFileError) {
      throw new ScheduledEventCoverFileError(error.message, { cause: error })
    }
    throw error
  }
  return {
    binding: snapshot.binding,
    bytes: snapshot.bytes,
    contentDigest: snapshot.contentDigest,
    review: {
      ...snapshot.review,
      ...inspectCover(snapshot.bytes),
    },
  }
}
