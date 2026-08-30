import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import {
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { DISCORD_LIMITS } from "../src/constants.js"
import { readSoundboardFileSnapshot } from "../src/soundboard-file.js"

const OGG_CRC_POLYNOMIAL = 0x04C11DB7
const OGG_SERIAL = 0x12345678

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-soundboard-"))
  const root = await realpath(temporary)
  return {
    async cleanup() {
      await rm(temporary, { force: true, recursive: true })
    },
    root,
  }
}

function mp3Frame(options: {
  bitrateIndex?: number
  sampleRateIndex?: number
  versionBits?: 0 | 2 | 3
} = {}): Buffer {
  const versionBits = options.versionBits ?? 3
  const bitrateIndex = options.bitrateIndex ?? 9
  const sampleRateIndex = options.sampleRateIndex ?? 0
  const bitrates = versionBits === 3
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  const rates = versionBits === 3
    ? [44_100, 48_000, 32_000]
    : versionBits === 2
      ? [22_050, 24_000, 16_000]
      : [11_025, 12_000, 8_000]
  const coefficient = versionBits === 3 ? 144 : 72
  const frameBytes = Math.floor(
    (coefficient * (bitrates[bitrateIndex] as number) * 1_000)
      / (rates[sampleRateIndex] as number),
  )
  const frame = Buffer.alloc(frameBytes)
  frame[0] = 0xFF
  frame[1] = 0xE0 | (versionBits << 3) | (1 << 1) | 1
  frame[2] = (bitrateIndex << 4) | (sampleRateIndex << 2)
  return frame
}

function id3v2(): Buffer {
  return Buffer.from([
    0x49, 0x44, 0x33,
    0x04, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ])
}

function writeU64Le(buffer: Buffer, value: bigint, offset: number): void {
  let remaining = value
  for (let index = 0; index < 8; index += 1) {
    buffer[offset + index] = Number(remaining & 0xFFn)
    remaining >>= 8n
  }
}

function oggCrc(bytes: Buffer): number {
  let checksum = 0
  for (const value of bytes) {
    checksum = (checksum ^ (value << 24)) >>> 0
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum & 0x80000000) !== 0
        ? (((checksum << 1) ^ OGG_CRC_POLYNOMIAL) >>> 0)
        : ((checksum << 1) >>> 0)
    }
  }
  return checksum >>> 0
}

function oggPage(options: {
  flags: number
  granule: bigint
  packet: Buffer
  sequence: number
  serial?: number
}): Buffer {
  assert.ok(options.packet.byteLength < 255)
  const page = Buffer.alloc(28 + options.packet.byteLength)
  page.write("OggS", 0, "ascii")
  page[4] = 0
  page[5] = options.flags
  writeU64Le(page, options.granule, 6)
  page.writeUInt32LE(options.serial ?? OGG_SERIAL, 14)
  page.writeUInt32LE(options.sequence, 18)
  page[26] = 1
  page[27] = options.packet.byteLength
  options.packet.copy(page, 28)
  page.writeUInt32LE(oggCrc(page), 22)
  return page
}

function commentBody(prefix: Buffer, trailing = Buffer.alloc(0)): Buffer {
  const counts = Buffer.alloc(8)
  return Buffer.concat([prefix, counts, trailing])
}

function opus(durationSeconds = 1): Buffer {
  const head = Buffer.alloc(19)
  head.write("OpusHead", 0, "ascii")
  head[8] = 1
  head[9] = 2
  head.writeUInt16LE(312, 10)
  head.writeUInt32LE(48_000, 12)
  const comments = commentBody(Buffer.from("OpusTags", "ascii"))
  return Buffer.concat([
    oggPage({ flags: 0x02, granule: 0n, packet: head, sequence: 0 }),
    oggPage({ flags: 0, granule: 0n, packet: comments, sequence: 1 }),
    oggPage({
      flags: 0x04,
      granule: 312n + BigInt(Math.round(durationSeconds * 48_000)),
      packet: Buffer.from([0xF8]),
      sequence: 2,
    }),
  ])
}

function vorbis(durationSeconds = 1): Buffer {
  const head = Buffer.alloc(30)
  head[0] = 1
  head.write("vorbis", 1, "ascii")
  head[11] = 2
  head.writeUInt32LE(48_000, 12)
  head[28] = 0xB8
  head[29] = 1
  const comments = commentBody(
    Buffer.concat([Buffer.from([3]), Buffer.from("vorbis", "ascii")]),
    Buffer.from([1]),
  )
  const setup = Buffer.concat([Buffer.from([5]), Buffer.from("vorbis", "ascii")])
  return Buffer.concat([
    oggPage({ flags: 0x02, granule: 0n, packet: head, sequence: 0 }),
    oggPage({ flags: 0, granule: 0n, packet: comments, sequence: 1 }),
    oggPage({ flags: 0, granule: 0n, packet: setup, sequence: 2 }),
    oggPage({
      flags: 0x04,
      granule: BigInt(Math.round(durationSeconds * 48_000)),
      packet: Buffer.from([0]),
      sequence: 3,
    }),
  ])
}

test("soundboard snapshots validate MP3 frames, metadata, and provenance", async () => {
  const { cleanup, root } = await fixture()
  try {
    const path = join(root, "alert.mp3")
    const bytes = Buffer.concat([
      id3v2(),
      mp3Frame(),
      mp3Frame(),
      Buffer.concat([Buffer.from("TAG", "ascii"), Buffer.alloc(125)]),
    ])
    await writeFile(path, bytes)
    const snapshot = await readSoundboardFileSnapshot({
      filePath: path,
      planKey: randomBytes(32),
      roots: [root],
    })

    assert.equal(snapshot.review.canonicalPath, path)
    assert.equal(snapshot.review.codec, "mpeg-1-layer-3")
    assert.equal(snapshot.review.format, "mp3")
    assert.equal(snapshot.review.mediaType, "audio/mpeg")
    assert.equal(snapshot.review.durationSeconds, 0.052245)
    assert.equal(snapshot.review.sizeBytes, bytes.byteLength)
    assert.equal(snapshot.review.ownerMatchesProcess, true)
    assert.match(snapshot.contentDigest, /^hmac-sha256:[a-f0-9]{64}$/)
  } finally {
    await cleanup()
  }
})

test("soundboard snapshots validate single-stream Opus and Vorbis Ogg files", async () => {
  const { cleanup, root } = await fixture()
  try {
    const examples = new Map([
      ["opus", opus(1.25)],
      ["vorbis", vorbis(2.5)],
    ])
    for (const [codec, bytes] of examples) {
      const path = join(root, `${codec}.ogg`)
      await writeFile(path, bytes)
      const snapshot = await readSoundboardFileSnapshot({
        filePath: path,
        planKey: randomBytes(32),
        roots: [root],
      })
      assert.equal(snapshot.review.codec, codec)
      assert.equal(snapshot.review.format, "ogg")
      assert.equal(snapshot.review.mediaType, "audio/ogg")
      assert.equal(snapshot.review.durationSeconds, codec === "opus" ? 1.25 : 2.5)
    }
  } finally {
    await cleanup()
  }
})

test("soundboard snapshots reject undocumented and malformed audio", async () => {
  const { cleanup, root } = await fixture()
  try {
    const invalid = new Map([
      ["audio.wav", Buffer.from("RIFF0000WAVE", "ascii")],
      ["truncated.mp3", Buffer.from([0xFF, 0xFB, 0x90, 0x00])],
      ["free-bitrate.mp3", mp3Frame().subarray(0, 4)],
    ])
    for (const [name, bytes] of invalid) {
      const path = join(root, name)
      await writeFile(path, bytes)
      await assert.rejects(
        readSoundboardFileSnapshot({
          filePath: path,
          planKey: randomBytes(32),
          roots: [root],
        }),
        /Discord soundboard/,
      )
    }
  } finally {
    await cleanup()
  }
})

test("soundboard snapshots reject over-duration MP3 and Ogg streams", async () => {
  const { cleanup, root } = await fixture()
  try {
    const longMp3 = Buffer.concat(Array.from({ length: 200 }, () => mp3Frame()))
    const examples = new Map([
      ["long.mp3", longMp3],
      ["long.ogg", opus(DISCORD_LIMITS.soundboardDurationSeconds + 0.01)],
    ])
    for (const [name, bytes] of examples) {
      const path = join(root, name)
      await writeFile(path, bytes)
      await assert.rejects(
        readSoundboardFileSnapshot({
          filePath: path,
          planKey: randomBytes(32),
          roots: [root],
        }),
        /duration/,
      )
    }
  } finally {
    await cleanup()
  }
})

test("soundboard snapshots reject Ogg checksum, sequence, and comment corruption", async () => {
  const { cleanup, root } = await fixture()
  try {
    const checksum = opus()
    checksum[checksum.byteLength - 1] = (checksum[checksum.byteLength - 1] as number) ^ 0x01

    const sequence = opus()
    const secondPage = sequence.indexOf(Buffer.from("OggS", "ascii"), 4)
    sequence.writeUInt32LE(9, secondPage + 18)
    sequence.writeUInt32LE(0, secondPage + 22)
    const secondPageEnd = sequence.indexOf(Buffer.from("OggS", "ascii"), secondPage + 4)
    sequence.writeUInt32LE(oggCrc(sequence.subarray(secondPage, secondPageEnd)), secondPage + 22)

    const comments = opus()
    const tags = comments.indexOf(Buffer.from("OpusTags", "ascii"))
    comments.writeUInt32LE(100, tags + 8)
    const commentsPage = comments.lastIndexOf(Buffer.from("OggS", "ascii"), tags)
    const commentsEnd = comments.indexOf(Buffer.from("OggS", "ascii"), commentsPage + 4)
    comments.writeUInt32LE(0, commentsPage + 22)
    comments.writeUInt32LE(oggCrc(comments.subarray(commentsPage, commentsEnd)), commentsPage + 22)

    for (const [name, bytes] of new Map([
      ["checksum.ogg", checksum],
      ["sequence.ogg", sequence],
      ["comments.ogg", comments],
    ])) {
      const path = join(root, name)
      await writeFile(path, bytes)
      await assert.rejects(
        readSoundboardFileSnapshot({
          filePath: path,
          planKey: randomBytes(32),
          roots: [root],
        }),
        /Discord soundboard Ogg/,
      )
    }
  } finally {
    await cleanup()
  }
})

test("soundboard snapshots enforce the local byte limit before media parsing", async () => {
  const { cleanup, root } = await fixture()
  try {
    const path = join(root, "too-large.mp3")
    await writeFile(path, Buffer.alloc(DISCORD_LIMITS.soundboardBytes + 1, 0xFF))
    await assert.rejects(
      readSoundboardFileSnapshot({
        filePath: path,
        planKey: randomBytes(32),
        roots: [root],
      }),
      /must contain between 1 and 524288 bytes/,
    )
  } finally {
    await cleanup()
  }
})
