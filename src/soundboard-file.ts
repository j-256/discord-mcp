import { DISCORD_LIMITS } from "./constants.js"
import {
  OwnedLocalFileError,
  readOwnedLocalFileSnapshot,
  type OwnedLocalFileSnapshot,
} from "./local-file.js"

export const SOUNDBOARD_FILE_FORMATS = [
  "mp3",
  "ogg",
] as const

export const SOUNDBOARD_CODECS = [
  "mpeg-1-layer-3",
  "mpeg-2-layer-3",
  "mpeg-2.5-layer-3",
  "opus",
  "vorbis",
] as const

export type SoundboardFileFormat = typeof SOUNDBOARD_FILE_FORMATS[number]
export type SoundboardCodec = typeof SOUNDBOARD_CODECS[number]

export interface SoundboardFileReview {
  canonicalPath: string
  codec: SoundboardCodec
  containedByConfiguredRoot: true
  durationSeconds: number
  format: SoundboardFileFormat
  mediaType: "audio/mpeg" | "audio/ogg"
  ownerMatchesProcess: true
  regularFile: true
  singleLink: true
  sizeBytes: number
  stableRead: true
}

export interface SoundboardFileSnapshot extends Omit<
  OwnedLocalFileSnapshot,
  "review"
> {
  review: SoundboardFileReview
}

export interface ReadSoundboardFileOptions {
  filePath: string
  planKey: Uint8Array
  roots: readonly string[]
}

export class SoundboardFileError extends Error {
  override name = "SoundboardFileError"
}

interface AudioDetails {
  codec: SoundboardCodec
  durationSeconds: number
  format: SoundboardFileFormat
  mediaType: "audio/mpeg" | "audio/ogg"
}

const ID3V1_BYTES = 128
const MAX_UINT64 = (1n << 64n) - 1n
const MP3_BITRATES_MPEG_1 = Object.freeze([
  0,
  32,
  40,
  48,
  56,
  64,
  80,
  96,
  112,
  128,
  160,
  192,
  224,
  256,
  320,
] as const)
const MP3_BITRATES_MPEG_2 = Object.freeze([
  0,
  8,
  16,
  24,
  32,
  40,
  48,
  56,
  64,
  80,
  96,
  112,
  128,
  144,
  160,
] as const)
const MP3_SAMPLE_RATES = Object.freeze({
  0: [11_025, 12_000, 8_000],
  2: [22_050, 24_000, 16_000],
  3: [44_100, 48_000, 32_000],
} as const)
const OGG_CRC_POLYNOMIAL = 0x04C11DB7

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
    throw new SoundboardFileError("Discord soundboard audio is truncated")
  }
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function u16le(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  if (a === undefined || b === undefined) {
    throw new SoundboardFileError("Discord soundboard audio is truncated")
  }
  return a | (b << 8)
}

function u32le(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset]
  const b = bytes[offset + 1]
  const c = bytes[offset + 2]
  const d = bytes[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new SoundboardFileError("Discord soundboard audio is truncated")
  }
  return (a + (b << 8) + (c << 16) + (d * 0x1000000)) >>> 0
}

function u64le(bytes: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 8 > bytes.byteLength) {
    throw new SoundboardFileError("Discord soundboard audio is truncated")
  }
  let value = 0n
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] as number)
  }
  return value
}

function roundedDuration(seconds: number): number {
  return Math.round(seconds * 1_000_000) / 1_000_000
}

function assertDuration(durationSeconds: number): number {
  if (
    !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || durationSeconds > DISCORD_LIMITS.soundboardDurationSeconds
  ) {
    throw new SoundboardFileError(
      `Discord soundboard audio duration must be greater than zero and at most ${DISCORD_LIMITS.soundboardDurationSeconds} seconds`,
    )
  }
  return roundedDuration(durationSeconds)
}

function synchsafeSize(bytes: Uint8Array, offset: number): number {
  const values = bytes.subarray(offset, offset + 4)
  if (values.byteLength !== 4 || [...values].some((value) => (value & 0x80) !== 0)) {
    throw new SoundboardFileError("Discord soundboard MP3 ID3 size is invalid")
  }
  return [...values].reduce((result, value) => (result << 7) | value, 0)
}

function mp3Start(bytes: Uint8Array): number {
  if (ascii(bytes, 0, Math.min(3, bytes.byteLength)) !== "ID3") return 0
  if (bytes.byteLength < 10) {
    throw new SoundboardFileError("Discord soundboard MP3 ID3 header is truncated")
  }
  const version = bytes[3] as number
  const revision = bytes[4] as number
  const flags = bytes[5] as number
  if (version < 2 || version > 4 || revision === 0xFF) {
    throw new SoundboardFileError("Discord soundboard MP3 ID3 version is unsupported")
  }
  if (
    (version === 2 && (flags & ~0xC0) !== 0)
    || (version === 3 && (flags & ~0xE0) !== 0)
    || (version === 4 && (flags & ~0xF0) !== 0)
  ) {
    throw new SoundboardFileError("Discord soundboard MP3 ID3 flags are invalid")
  }
  const footerBytes = version === 4 && (flags & 0x10) !== 0 ? 10 : 0
  const start = 10 + synchsafeSize(bytes, 6) + footerBytes
  if (start >= bytes.byteLength) {
    throw new SoundboardFileError("Discord soundboard MP3 contains no audio after ID3 metadata")
  }
  return start
}

function mp3End(bytes: Uint8Array, start: number): number {
  const tagOffset = bytes.byteLength - ID3V1_BYTES
  if (tagOffset > start && ascii(bytes, tagOffset, 3) === "TAG") return tagOffset
  return bytes.byteLength
}

function parseMp3(bytes: Uint8Array): AudioDetails {
  let offset = mp3Start(bytes)
  const end = mp3End(bytes, offset)
  let frames = 0
  let durationSeconds = 0
  let codec: SoundboardCodec | undefined
  while (offset < end) {
    if (offset + 4 > end) {
      throw new SoundboardFileError("Discord soundboard MP3 frame header is truncated")
    }
    const first = bytes[offset] as number
    const second = bytes[offset + 1] as number
    const third = bytes[offset + 2] as number
    if (first !== 0xFF || (second & 0xE0) !== 0xE0) {
      throw new SoundboardFileError("Discord soundboard MP3 frame synchronization is invalid")
    }
    const versionBits = (second >> 3) & 0x03
    const layerBits = (second >> 1) & 0x03
    if (versionBits === 1 || layerBits !== 1) {
      throw new SoundboardFileError("Discord soundboard MP3 must contain MPEG Layer III audio")
    }
    const bitrateIndex = (third >> 4) & 0x0F
    const sampleRateIndex = (third >> 2) & 0x03
    if (bitrateIndex === 0 || bitrateIndex === 0x0F || sampleRateIndex === 0x03) {
      throw new SoundboardFileError("Discord soundboard MP3 frame rate is unsupported")
    }
    const bitrateTable = versionBits === 3
      ? MP3_BITRATES_MPEG_1
      : MP3_BITRATES_MPEG_2
    const bitrateKbps = bitrateTable[bitrateIndex]
    const sampleRates = MP3_SAMPLE_RATES[versionBits as keyof typeof MP3_SAMPLE_RATES]
    const sampleRate = sampleRates?.[sampleRateIndex]
    if (bitrateKbps === undefined || sampleRate === undefined) {
      throw new SoundboardFileError("Discord soundboard MP3 frame rate is unsupported")
    }
    const padding = (third >> 1) & 0x01
    const samples = versionBits === 3 ? 1_152 : 576
    const coefficient = versionBits === 3 ? 144 : 72
    const frameBytes = Math.floor(
      (coefficient * bitrateKbps * 1_000) / sampleRate,
    ) + padding
    if (frameBytes < 4 || offset + frameBytes > end) {
      throw new SoundboardFileError("Discord soundboard MP3 frame is truncated")
    }
    const frameCodec: SoundboardCodec = versionBits === 3
      ? "mpeg-1-layer-3"
      : versionBits === 2
        ? "mpeg-2-layer-3"
        : "mpeg-2.5-layer-3"
    if (codec !== undefined && codec !== frameCodec) {
      throw new SoundboardFileError("Discord soundboard MP3 changes MPEG version between frames")
    }
    codec = frameCodec
    durationSeconds += samples / sampleRate
    frames += 1
    offset += frameBytes
  }
  if (frames < 1 || codec === undefined || offset !== end) {
    throw new SoundboardFileError("Discord soundboard MP3 contains no complete audio frames")
  }
  return {
    codec,
    durationSeconds: assertDuration(durationSeconds),
    format: "mp3",
    mediaType: "audio/mpeg",
  }
}

function oggCrc(bytes: Uint8Array): number {
  let checksum = 0
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const value = index >= 22 && index < 26 ? 0 : bytes[index] as number
    checksum = (checksum ^ (value << 24)) >>> 0
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum & 0x80000000) !== 0
        ? (((checksum << 1) ^ OGG_CRC_POLYNOMIAL) >>> 0)
        : ((checksum << 1) >>> 0)
    }
  }
  return checksum >>> 0
}

function concatPacket(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const packet = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    packet.set(part, offset)
    offset += part.byteLength
  }
  return packet
}

interface ParsedOgg {
  finalGranule: bigint
  packets: Uint8Array[]
}

function validateCommentPacket(
  packet: Uint8Array,
  offset: number,
  trailingBytes: number,
): void {
  if (offset + 8 + trailingBytes > packet.byteLength) {
    throw new SoundboardFileError("Discord soundboard Ogg comment header is truncated")
  }
  const vendorBytes = u32le(packet, offset)
  let cursor = offset + 4 + vendorBytes
  if (cursor + 4 + trailingBytes > packet.byteLength) {
    throw new SoundboardFileError("Discord soundboard Ogg comment vendor is truncated")
  }
  const comments = u32le(packet, cursor)
  cursor += 4
  for (let index = 0; index < comments; index += 1) {
    if (cursor + 4 + trailingBytes > packet.byteLength) {
      throw new SoundboardFileError("Discord soundboard Ogg comment list is truncated")
    }
    const length = u32le(packet, cursor)
    cursor += 4 + length
    if (cursor + trailingBytes > packet.byteLength) {
      throw new SoundboardFileError("Discord soundboard Ogg comment value is truncated")
    }
  }
  if (cursor + trailingBytes !== packet.byteLength) {
    throw new SoundboardFileError("Discord soundboard Ogg comment header has trailing bytes")
  }
}

function parseOggPages(bytes: Uint8Array): ParsedOgg {
  let offset = 0
  let serial: number | undefined
  let sequence = 0
  let pendingPacket: Uint8Array[] = []
  let continuationExpected = false
  let finalGranule: bigint | undefined
  let ended = false
  const packets: Uint8Array[] = []
  while (offset < bytes.byteLength) {
    if (ended || offset + 27 > bytes.byteLength || ascii(bytes, offset, 4) !== "OggS") {
      throw new SoundboardFileError("Discord soundboard Ogg page framing is invalid")
    }
    if (bytes[offset + 4] !== 0) {
      throw new SoundboardFileError("Discord soundboard Ogg version is unsupported")
    }
    const flags = bytes[offset + 5] as number
    if ((flags & ~0x07) !== 0) {
      throw new SoundboardFileError("Discord soundboard Ogg page flags are invalid")
    }
    const continued = (flags & 0x01) !== 0
    const beginning = (flags & 0x02) !== 0
    const endOfStream = (flags & 0x04) !== 0
    if (continued !== continuationExpected || beginning !== (sequence === 0)) {
      throw new SoundboardFileError("Discord soundboard Ogg page sequence is invalid")
    }
    const pageSerial = u32le(bytes, offset + 14)
    const pageSequence = u32le(bytes, offset + 18)
    if (
      (serial !== undefined && pageSerial !== serial)
      || pageSequence !== sequence
    ) {
      throw new SoundboardFileError("Discord soundboard Ogg must contain one ordered logical stream")
    }
    serial = pageSerial
    const segmentCount = bytes[offset + 26] as number
    const segmentOffset = offset + 27
    const bodyOffset = segmentOffset + segmentCount
    if (bodyOffset > bytes.byteLength) {
      throw new SoundboardFileError("Discord soundboard Ogg segment table is truncated")
    }
    let bodyBytes = 0
    for (let index = 0; index < segmentCount; index += 1) {
      bodyBytes += bytes[segmentOffset + index] as number
    }
    const pageEnd = bodyOffset + bodyBytes
    if (pageEnd > bytes.byteLength) {
      throw new SoundboardFileError("Discord soundboard Ogg page body is truncated")
    }
    const page = bytes.subarray(offset, pageEnd)
    if (oggCrc(page) !== u32le(bytes, offset + 22)) {
      throw new SoundboardFileError("Discord soundboard Ogg page checksum is invalid")
    }
    let bodyCursor = bodyOffset
    for (let index = 0; index < segmentCount; index += 1) {
      const length = bytes[segmentOffset + index] as number
      pendingPacket.push(bytes.subarray(bodyCursor, bodyCursor + length))
      bodyCursor += length
      if (length < 255) {
        packets.push(concatPacket(pendingPacket))
        pendingPacket = []
      }
    }
    continuationExpected = segmentCount > 0
      && bytes[segmentOffset + segmentCount - 1] === 255
    const granule = u64le(bytes, offset + 6)
    if (granule !== MAX_UINT64) finalGranule = granule
    if (endOfStream) {
      if (pageEnd !== bytes.byteLength || continuationExpected) {
        throw new SoundboardFileError("Discord soundboard Ogg end-of-stream page is incomplete")
      }
      ended = true
    }
    sequence += 1
    offset = pageEnd
  }
  if (!ended || pendingPacket.length > 0 || packets.length < 3 || finalGranule === undefined) {
    throw new SoundboardFileError("Discord soundboard Ogg stream is incomplete")
  }
  return { finalGranule, packets }
}

function parseOgg(bytes: Uint8Array): AudioDetails {
  const { finalGranule, packets } = parseOggPages(bytes)
  const identification = packets[0] as Uint8Array
  const comments = packets[1] as Uint8Array
  let codec: SoundboardCodec
  let durationSeconds: number
  if (ascii(identification, 0, Math.min(8, identification.byteLength)) === "OpusHead") {
    if (
      identification.byteLength !== 19
      || (identification[8] as number) > 15
      || (identification[9] as number) < 1
      || (identification[9] as number) > 2
      || identification[18] !== 0
      || ascii(comments, 0, Math.min(8, comments.byteLength)) !== "OpusTags"
    ) {
      throw new SoundboardFileError("Discord soundboard Ogg Opus headers are invalid")
    }
    validateCommentPacket(comments, 8, 0)
    const preSkip = BigInt(u16le(identification, 10))
    if (finalGranule <= preSkip) {
      throw new SoundboardFileError("Discord soundboard Ogg Opus duration is invalid")
    }
    durationSeconds = Number(finalGranule - preSkip) / 48_000
    codec = "opus"
  } else if (
    identification.byteLength >= 30
    && identification[0] === 1
    && ascii(identification, 1, 6) === "vorbis"
  ) {
    const sampleRate = u32le(identification, 12)
    const blockSizes = identification[28] as number
    const smallBlock = blockSizes & 0x0F
    const largeBlock = blockSizes >> 4
    const setup = packets[2] as Uint8Array
    if (
      u32le(identification, 7) !== 0
      || identification[11] === 0
      || sampleRate < 1
      || smallBlock < 6
      || largeBlock > 13
      || smallBlock > largeBlock
      || identification[29] !== 1
      || comments.byteLength < 7
      || comments[0] !== 3
      || ascii(comments, 1, 6) !== "vorbis"
      || setup.byteLength < 7
      || setup[0] !== 5
      || ascii(setup, 1, 6) !== "vorbis"
      || packets.length < 4
    ) {
      throw new SoundboardFileError("Discord soundboard Ogg Vorbis headers are invalid")
    }
    validateCommentPacket(comments, 7, 1)
    if (comments[comments.byteLength - 1] !== 1) {
      throw new SoundboardFileError("Discord soundboard Ogg Vorbis comment framing is invalid")
    }
    durationSeconds = Number(finalGranule) / sampleRate
    codec = "vorbis"
  } else {
    throw new SoundboardFileError("Discord soundboard Ogg codec must be Opus or Vorbis")
  }
  return {
    codec,
    durationSeconds: assertDuration(durationSeconds),
    format: "ogg",
    mediaType: "audio/ogg",
  }
}

function inspectAudio(bytes: Uint8Array): AudioDetails {
  if (matches(bytes, 0, [0x4F, 0x67, 0x67, 0x53])) return parseOgg(bytes)
  if (
    matches(bytes, 0, [0x49, 0x44, 0x33])
    || (bytes.byteLength >= 2 && bytes[0] === 0xFF && ((bytes[1] as number) & 0xE0) === 0xE0)
  ) {
    return parseMp3(bytes)
  }
  throw new SoundboardFileError("Discord soundboard audio must be MP3 or Ogg")
}

export async function readSoundboardFileSnapshot(
  options: ReadSoundboardFileOptions,
): Promise<SoundboardFileSnapshot> {
  let snapshot: OwnedLocalFileSnapshot
  try {
    snapshot = await readOwnedLocalFileSnapshot({
      description: "Discord soundboard audio",
      digestDomain: "guildcontrol-soundboard-audio.v1",
      filePath: options.filePath,
      maxBytes: DISCORD_LIMITS.soundboardBytes,
      planKey: options.planKey,
      roots: options.roots,
    })
  } catch (error) {
    if (error instanceof OwnedLocalFileError) {
      throw new SoundboardFileError(error.message, { cause: error })
    }
    throw error
  }
  return {
    binding: snapshot.binding,
    bytes: snapshot.bytes,
    contentDigest: snapshot.contentDigest,
    review: {
      ...snapshot.review,
      ...inspectAudio(snapshot.bytes),
    },
  }
}
