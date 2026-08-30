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
import {
  inspectRoleIconBytes,
  readRoleIconFileSnapshot,
  RoleIconFileError,
} from "../src/role-icon-file.js"

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value)
  return buffer
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  return Buffer.concat([
    u32(data.byteLength),
    Buffer.from(type, "ascii"),
    data,
    Buffer.alloc(4),
  ])
}

function png(width: number, height: number, animated = false): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  const chunks = [PNG_SIGNATURE, pngChunk("IHDR", ihdr)]
  if (animated) chunks.push(pngChunk("acTL", Buffer.alloc(8)))
  chunks.push(pngChunk("IEND"))
  return Buffer.concat(chunks)
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xFF, 0xD8,
    0xFF, 0xC0,
    0x00, 0x0B,
    0x08,
    (height >>> 8) & 0xFF, height & 0xFF,
    (width >>> 8) & 0xFF, width & 0xFF,
    0x01,
    0x01, 0x11, 0x00,
    0xFF, 0xD9,
  ])
}

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "guildcontrol-role-icon-"))
  const root = await realpath(temporary)
  return {
    async cleanup() {
      await rm(temporary, { force: true, recursive: true })
    },
    root,
  }
}

test("role icon snapshots inspect exact owned PNG and JPEG images", async () => {
  const { cleanup, root } = await fixture()
  try {
    const planKey = randomBytes(32)
    const examples = new Map([
      ["icon.png", { bytes: png(64, 64), format: "png" }],
      ["icon.jpg", { bytes: jpeg(64, 64), format: "jpeg" }],
    ])
    for (const [name, example] of examples) {
      const filePath = join(root, name)
      await writeFile(filePath, example.bytes)
      const snapshot = await readRoleIconFileSnapshot({
        filePath,
        planKey,
        roots: [root],
      })
      assert.equal(snapshot.review.canonicalPath, filePath)
      assert.equal(snapshot.review.format, example.format)
      assert.equal(snapshot.review.height, DISCORD_LIMITS.roleIconPixels)
      assert.equal(snapshot.review.sizeBytes, example.bytes.byteLength)
      assert.equal(snapshot.review.width, DISCORD_LIMITS.roleIconPixels)
      assert.match(snapshot.contentDigest, /^hmac-sha256:[a-f0-9]{64}$/)
    }
  } finally {
    await cleanup()
  }
})

test("role icon snapshots reject animation, wrong dimensions, and unsupported data", async () => {
  const { cleanup, root } = await fixture()
  try {
    const cases = new Map<string, { bytes: Buffer; message: RegExp }>([
      ["animated.png", { bytes: png(64, 64, true), message: /must not be animated/ }],
      ["large.png", { bytes: png(128, 64), message: /64 by 64 pixels/ }],
      ["icon.webp", { bytes: Buffer.from("RIFF0000WEBP", "ascii"), message: /PNG or JPEG/ }],
    ])
    for (const [name, example] of cases) {
      const filePath = join(root, name)
      await writeFile(filePath, example.bytes)
      await assert.rejects(
        readRoleIconFileSnapshot({
          filePath,
          planKey: randomBytes(32),
          roots: [root],
        }),
        (error: unknown) => (
          error instanceof RoleIconFileError
          && example.message.test(error.message)
        ),
      )
    }
  } finally {
    await cleanup()
  }
})

test("role icon snapshots enforce configured roots and the byte ceiling", async () => {
  const { cleanup, root } = await fixture()
  try {
    const filePath = join(root, "icon.png")
    await writeFile(filePath, png(64, 64))
    await assert.rejects(
      readRoleIconFileSnapshot({
        filePath,
        planKey: randomBytes(32),
        roots: [],
      }),
      (error: unknown) => (
        error instanceof RoleIconFileError
        && /roots are not configured/.test(error.message)
      ),
    )

    const oversizedPath = join(root, "oversized.png")
    await writeFile(oversizedPath, Buffer.alloc(DISCORD_LIMITS.roleIconBytes + 1, 1))
    await assert.rejects(
      readRoleIconFileSnapshot({
        filePath: oversizedPath,
        planKey: randomBytes(32),
        roots: [root],
      }),
      (error: unknown) => (
        error instanceof RoleIconFileError
        && /between 1 and 262144 bytes/.test(error.message)
      ),
    )
  } finally {
    await cleanup()
  }
})

test("role icon byte inspection rejects truncated and incoherent structures", () => {
  const malformedJpegSegment = Buffer.from([
    0xFF, 0xD8,
    0xFF, 0xE0,
    0x00, 0x20,
    0xFF, 0xD9,
  ])
  const shortJpegDimensions = Buffer.from([
    0xFF, 0xD8,
    0xFF, 0xC0,
    0x00, 0x06,
    0, 0, 0, 0,
    0xFF, 0xD9,
  ])
  const markerOnlyJpeg = Buffer.from([
    0xFF, 0xD8,
    0xFF, 0xE0,
    0x00, 0x02,
    0xFF, 0xD9,
  ])
  const malformedPngChunk = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", Buffer.alloc(13)),
    u32(128),
    Buffer.from("IDAT", "ascii"),
    Buffer.alloc(24),
  ])
  const wrongPngHeader = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IDAT", Buffer.alloc(13)),
    pngChunk("IEND"),
  ])
  const cases = new Map<Uint8Array, RegExp>([
    [PNG_SIGNATURE, /PNG is invalid/],
    [wrongPngHeader, /leading IHDR/],
    [malformedPngChunk, /chunk is truncated/],
    [Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", Buffer.alloc(13))]), /incomplete/],
    [Buffer.from([0xFF, 0xD8, 0x00, 0x00]), /framing is invalid/],
    [Buffer.from([0xFF, 0xD8, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xD9]), /marker is invalid/],
    [malformedJpegSegment, /segment is truncated/],
    [shortJpegDimensions, /dimensions are truncated/],
    [jpeg(0, 64), /dimensions are invalid/],
    [markerOnlyJpeg, /lacks dimensions/],
  ])
  for (const [bytes, message] of cases) {
    assert.throws(
      () => inspectRoleIconBytes(bytes),
      (error: unknown) => error instanceof RoleIconFileError && message.test(error.message),
    )
  }
})
