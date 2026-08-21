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

import { readAttachmentFileSnapshot } from "../src/attachment-file.js"
import { readGuildExpressionFileSnapshot } from "../src/guild-expression-file.js"

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

function png(options: { animated?: boolean; delay?: number; height: number; width: number }): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(options.width, 0)
  ihdr.writeUInt32BE(options.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const chunks = [PNG_SIGNATURE, pngChunk("IHDR", ihdr)]
  if (options.animated) {
    const animation = Buffer.alloc(8)
    animation.writeUInt32BE(1, 0)
    chunks.push(pngChunk("acTL", animation))
    const frame = Buffer.alloc(26)
    frame.writeUInt32BE(options.width, 4)
    frame.writeUInt32BE(options.height, 8)
    frame.writeUInt16BE(options.delay ?? 100, 20)
    frame.writeUInt16BE(100, 22)
    chunks.push(pngChunk("fcTL", frame))
  }
  chunks.push(pngChunk("IEND"))
  return Buffer.concat(chunks)
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(28)
  bytes.write("GIF89a", 0, "ascii")
  bytes.writeUInt16LE(width, 6)
  bytes.writeUInt16LE(height, 8)
  bytes[13] = 0x2C
  bytes.writeUInt16LE(width, 18)
  bytes.writeUInt16LE(height, 20)
  bytes[23] = 2
  bytes[24] = 1
  bytes[25] = 0
  bytes[27] = 0x3B
  return bytes
}

function animatedGif(width: number, height: number, delayHundredths: number): Buffer {
  const base = gif(width, height)
  const control = Buffer.from([
    0x21,
    0xF9,
    0x04,
    0x00,
    delayHundredths & 0xFF,
    (delayHundredths >>> 8) & 0xFF,
    0x00,
    0x00,
  ])
  const frame = base.subarray(13, 27)
  return Buffer.concat([
    base.subarray(0, 13),
    control,
    frame,
    control,
    frame,
    Buffer.from([0x3B]),
  ])
}

function jpeg(width: number, height: number): Buffer {
  const segment = Buffer.from([
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
  return segment
}

function webp(width: number, height: number, animated = false): Buffer {
  const bytes = Buffer.alloc(30)
  bytes.write("RIFF", 0, "ascii")
  bytes.writeUInt32LE(22, 4)
  bytes.write("WEBP", 8, "ascii")
  bytes.write("VP8X", 12, "ascii")
  bytes.writeUInt32LE(10, 16)
  bytes[20] = animated ? 0x02 : 0
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

function avif(animated = false): Buffer {
  return Buffer.concat([
    u32(24),
    Buffer.from(`ftyp${animated ? "avis" : "avif"}`, "ascii"),
    Buffer.alloc(4),
    Buffer.from(`${animated ? "avis" : "avif"}mif1`, "ascii"),
  ])
}

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-expression-"))
  const root = await realpath(temporary)
  return {
    async cleanup() {
      await rm(temporary, { force: true, recursive: true })
    },
    root,
  }
}

test("emoji snapshots detect every supported format from reviewed local bytes", async () => {
  const { cleanup, root } = await fixture()
  try {
    const files = new Map([
      ["avif", avif()],
      ["gif", gif(128, 128)],
      ["jpeg", jpeg(128, 128)],
      ["png", png({ height: 128, width: 128 })],
      ["webp", webp(128, 128)],
    ])
    const planKey = randomBytes(32)
    for (const [format, bytes] of files) {
      const filePath = join(root, `emoji-${format}`)
      await writeFile(filePath, bytes)
      const snapshot = await readGuildExpressionFileSnapshot({
        filePath,
        kind: "emoji",
        planKey,
        roots: [root],
      })
      assert.equal(snapshot.review.format, format)
      assert.equal(snapshot.review.canonicalPath, filePath)
      assert.equal(snapshot.review.sizeBytes, bytes.byteLength)
      assert.equal(snapshot.review.animated, false)
    }

    const animatedPngPath = join(root, "animated.png")
    await writeFile(animatedPngPath, png({ animated: true, height: 128, width: 128 }))
    const animatedPng = await readGuildExpressionFileSnapshot({
      filePath: animatedPngPath,
      kind: "emoji",
      planKey,
      roots: [root],
    })
    assert.equal(animatedPng.review.format, "png")
    assert.equal(animatedPng.review.animated, true)

    const animatedWebpPath = join(root, "animated.webp")
    await writeFile(animatedWebpPath, webp(128, 128, true))
    const animatedWebp = await readGuildExpressionFileSnapshot({
      filePath: animatedWebpPath,
      kind: "emoji",
      planKey,
      roots: [root],
    })
    assert.equal(animatedWebp.review.animated, true)

    const animatedAvifPath = join(root, "animated.avif")
    await writeFile(animatedAvifPath, avif(true))
    const animatedAvif = await readGuildExpressionFileSnapshot({
      filePath: animatedAvifPath,
      kind: "emoji",
      planKey,
      roots: [root],
    })
    assert.equal(animatedAvif.review.animated, true)
  } finally {
    await cleanup()
  }
})

test("sticker snapshots validate format, dimensions, and animation duration", async () => {
  const { cleanup, root } = await fixture()
  try {
    const planKey = randomBytes(32)
    const examples = new Map<string, { bytes: Buffer; duration: number | null; format: string }>([
      ["static.png", {
        bytes: png({ height: 320, width: 320 }),
        duration: null,
        format: "png",
      }],
      ["animated.png", {
        bytes: png({ animated: true, delay: 500, height: 320, width: 320 }),
        duration: 5,
        format: "apng",
      }],
      ["sticker.gif", {
        bytes: animatedGif(320, 320, 250),
        duration: 5,
        format: "gif",
      }],
      ["sticker.json", {
        bytes: Buffer.from(JSON.stringify({ fr: 30, h: 320, ip: 0, op: 150, w: 320 })),
        duration: 5,
        format: "lottie",
      }],
    ])
    for (const [name, example] of examples) {
      const filePath = join(root, name)
      await writeFile(filePath, example.bytes)
      const snapshot = await readGuildExpressionFileSnapshot({
        filePath,
        kind: "sticker",
        planKey,
        roots: [root],
      })
      assert.equal(snapshot.review.format, example.format)
      assert.equal(snapshot.review.durationSeconds, example.duration)
      assert.equal(snapshot.review.width, 320)
      assert.equal(snapshot.review.height, 320)
      assert.equal(snapshot.review.animated, example.duration !== null)
    }

    const wrongSizePath = join(root, "wrong-size.png")
    await writeFile(wrongSizePath, png({ height: 128, width: 128 }))
    await assert.rejects(
      readGuildExpressionFileSnapshot({
        filePath: wrongSizePath,
        kind: "sticker",
        planKey,
        roots: [root],
      }),
      /320 by 320/,
    )

    const tooLongPath = join(root, "too-long.json")
    await writeFile(tooLongPath, JSON.stringify({ fr: 30, h: 320, ip: 0, op: 151, w: 320 }))
    await assert.rejects(
      readGuildExpressionFileSnapshot({
        filePath: tooLongPath,
        kind: "sticker",
        planKey,
        roots: [root],
      }),
      /must not exceed 5 seconds/,
    )
  } finally {
    await cleanup()
  }
})

test("expression and attachment snapshots use distinct keyed digest domains", async () => {
  const { cleanup, root } = await fixture()
  try {
    const filePath = join(root, "image.png")
    await writeFile(filePath, png({ height: 128, width: 128 }))
    const planKey = randomBytes(32)
    const expression = await readGuildExpressionFileSnapshot({
      filePath,
      kind: "emoji",
      planKey,
      roots: [root],
    })
    const attachment = await readAttachmentFileSnapshot({
      filePath,
      maxBytes: 1_024,
      planKey,
      roots: [root],
    })
    assert.notEqual(expression.contentDigest, attachment.contentDigest)

    const invalidPath = join(root, "invalid.bin")
    await writeFile(invalidPath, "not an image")
    await assert.rejects(
      readGuildExpressionFileSnapshot({
        filePath: invalidPath,
        kind: "emoji",
        planKey,
        roots: [root],
      }),
      /must be JPEG, PNG, GIF, WebP, or AVIF/,
    )
  } finally {
    await cleanup()
  }
})

test("expression snapshots reject truncated and contradictory media containers", async () => {
  const { cleanup, root } = await fixture()
  try {
    const planKey = randomBytes(32)
    const zeroWidthPng = png({ height: 128, width: 0 })
    const inconsistentApng = png({ animated: true, height: 320, width: 320 })
    inconsistentApng.writeUInt32BE(2, 41)
    const invalidRiffSize = webp(128, 128)
    invalidRiffSize.writeUInt32LE(21, 4)
    const truncatedWebpChunk = webp(128, 128)
    truncatedWebpChunk.writeUInt32LE(100, 16)
    const unsupportedWebp = webp(128, 128)
    unsupportedWebp.write("JUNK", 12, "ascii")
    const malformedGif = gif(128, 128)
    malformedGif[13] = 0
    const cases: Array<{
      bytes: Buffer
      kind: "emoji" | "sticker"
      message: RegExp
      name: string
    }> = [{
      bytes: PNG_SIGNATURE,
      kind: "emoji",
      message: /PNG is incomplete/,
      name: "truncated.png",
    }, {
      bytes: Buffer.concat([PNG_SIGNATURE, pngChunk("IEND")]),
      kind: "emoji",
      message: /lacks a leading IHDR/,
      name: "missing-ihdr.png",
    }, {
      bytes: zeroWidthPng,
      kind: "emoji",
      message: /PNG dimensions are invalid/,
      name: "zero-width.png",
    }, {
      bytes: inconsistentApng,
      kind: "sticker",
      message: /APNG frame count is inconsistent/,
      name: "inconsistent-apng.png",
    }, {
      bytes: Buffer.from("GIF89a", "ascii"),
      kind: "emoji",
      message: /GIF is truncated/,
      name: "truncated.gif",
    }, {
      bytes: gif(0, 128),
      kind: "emoji",
      message: /GIF dimensions are invalid/,
      name: "zero-width.gif",
    }, {
      bytes: malformedGif,
      kind: "emoji",
      message: /GIF structure is invalid/,
      name: "malformed.gif",
    }, {
      bytes: Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]),
      kind: "emoji",
      message: /JPEG lacks dimensions/,
      name: "missing-dimensions.jpeg",
    }, {
      bytes: Buffer.from([0xFF, 0xD8, 0x00, 0x00]),
      kind: "emoji",
      message: /JPEG framing is invalid/,
      name: "bad-framing.jpeg",
    }, {
      bytes: invalidRiffSize,
      kind: "emoji",
      message: /WebP container size is invalid/,
      name: "bad-size.webp",
    }, {
      bytes: truncatedWebpChunk,
      kind: "emoji",
      message: /WebP chunk is truncated/,
      name: "truncated-chunk.webp",
    }, {
      bytes: unsupportedWebp,
      kind: "emoji",
      message: /WebP container is unsupported/,
      name: "unsupported.webp",
    }, {
      bytes: Buffer.concat([
        u32(16),
        Buffer.from("ftypmif1", "ascii"),
        Buffer.alloc(4),
      ]),
      kind: "emoji",
      message: /AVIF brand is missing/,
      name: "missing-brand.avif",
    }, {
      bytes: Buffer.from([0xFF]),
      kind: "sticker",
      message: /Lottie JSON is not UTF-8/,
      name: "invalid-utf8.json",
    }, {
      bytes: Buffer.from("not-json"),
      kind: "sticker",
      message: /Lottie JSON is invalid/,
      name: "invalid.json",
    }, {
      bytes: Buffer.from("[]"),
      kind: "sticker",
      message: /Lottie root must be an object/,
      name: "array.json",
    }, {
      bytes: Buffer.from("{}"),
      kind: "sticker",
      message: /Lottie dimensions or timing are invalid/,
      name: "missing-timing.json",
    }]

    for (const example of cases) {
      const filePath = join(root, example.name)
      await writeFile(filePath, example.bytes)
      await assert.rejects(
        readGuildExpressionFileSnapshot({
          filePath,
          kind: example.kind,
          planKey,
          roots: [root],
        }),
        example.message,
      )
    }
  } finally {
    await cleanup()
  }
})
