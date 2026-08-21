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

import {
  readScheduledEventCoverFileSnapshot,
  ScheduledEventCoverFileError,
} from "../src/scheduled-event-file.js"

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
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-event-cover-"))
  const root = await realpath(temporary)
  return {
    async cleanup() {
      await rm(temporary, { force: true, recursive: true })
    },
    root,
  }
}

test("scheduled event cover snapshots inspect owned JPEG and PNG bytes", async () => {
  const { cleanup, root } = await fixture()
  try {
    const planKey = randomBytes(32)
    const examples = new Map([
      ["cover.jpg", { bytes: jpeg(1280, 720), format: "jpeg" }],
      ["cover.png", { bytes: png(1920, 1080), format: "png" }],
    ])
    for (const [name, example] of examples) {
      const filePath = join(root, name)
      await writeFile(filePath, example.bytes)
      const snapshot = await readScheduledEventCoverFileSnapshot({
        filePath,
        planKey,
        roots: [root],
      })
      assert.equal(snapshot.review.canonicalPath, filePath)
      assert.equal(snapshot.review.format, example.format)
      assert.equal(snapshot.review.ownerMatchesProcess, true)
      assert.equal(snapshot.review.sizeBytes, example.bytes.byteLength)
      assert.equal(snapshot.review.stableRead, true)
      assert.match(snapshot.contentDigest, /^hmac-sha256:[a-f0-9]{64}$/)
    }
  } finally {
    await cleanup()
  }
})

test("scheduled event cover snapshots reject animation and unsupported formats", async () => {
  const { cleanup, root } = await fixture()
  try {
    const planKey = randomBytes(32)
    const animatedPath = join(root, "animated.png")
    await writeFile(animatedPath, png(320, 180, true))
    await assert.rejects(
      readScheduledEventCoverFileSnapshot({
        filePath: animatedPath,
        planKey,
        roots: [root],
      }),
      (error: unknown) => (
        error instanceof ScheduledEventCoverFileError
        && /must not be animated/.test(error.message)
      ),
    )

    const unsupportedPath = join(root, "cover.webp")
    await writeFile(unsupportedPath, Buffer.from("RIFF0000WEBP", "ascii"))
    await assert.rejects(
      readScheduledEventCoverFileSnapshot({
        filePath: unsupportedPath,
        planKey,
        roots: [root],
      }),
      /must be JPEG or non-animated PNG/,
    )
  } finally {
    await cleanup()
  }
})

test("scheduled event cover snapshots preserve the generic local-file boundary", async () => {
  const { cleanup, root } = await fixture()
  try {
    const filePath = join(root, "cover.png")
    await writeFile(filePath, png(640, 360))
    await assert.rejects(
      readScheduledEventCoverFileSnapshot({
        filePath,
        planKey: randomBytes(32),
        roots: [],
      }),
      (error: unknown) => (
        error instanceof ScheduledEventCoverFileError
        && /roots are not configured/.test(error.message)
      ),
    )
  } finally {
    await cleanup()
  }
})
