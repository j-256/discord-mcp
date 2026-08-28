import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import {
  link,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  BotProfileImageFileError,
  readBotProfileImageFileSnapshot,
} from "../src/bot-profile-file.js"
import { CONNECTOR_LIMITS } from "../src/constants.js"

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

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IEND"),
  ])
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
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-bot-profile-"))
  const root = await realpath(temporary)
  return {
    async cleanup() {
      await rm(temporary, { force: true, recursive: true })
    },
    root,
  }
}

test("bot-profile images accept every documented Discord image-data format", async () => {
  const { cleanup, root } = await fixture()
  try {
    const files = new Map([
      ["gif", gif(320, 180)],
      ["jpeg", jpeg(512, 512)],
      ["png", png(1024, 256)],
    ])
    const planKey = randomBytes(32)
    for (const [format, bytes] of files) {
      const filePath = join(root, `profile-${format}`)
      await writeFile(filePath, bytes, { mode: 0o600 })
      const snapshot = await readBotProfileImageFileSnapshot({
        filePath,
        kind: format === "gif" ? "banner" : "avatar",
        planKey,
        roots: [root],
      })
      assert.equal(snapshot.review.format, format)
      assert.equal(snapshot.review.canonicalPath, filePath)
      assert.equal(snapshot.review.sizeBytes, bytes.byteLength)
      assert.equal(snapshot.review.ownerMatchesProcess, true)
      assert.equal(snapshot.review.singleLink, true)
      assert.match(snapshot.contentDigest, /^hmac-sha256:[a-f0-9]{64}$/u)
    }
  } finally {
    await cleanup()
  }
})

test("bot-profile images bind avatar and banner under separate digest domains", async () => {
  const { cleanup, root } = await fixture()
  try {
    const filePath = join(root, "profile.png")
    await writeFile(filePath, png(64, 64), { mode: 0o600 })
    const planKey = randomBytes(32)
    const avatar = await readBotProfileImageFileSnapshot({
      filePath,
      kind: "avatar",
      planKey,
      roots: [root],
    })
    const banner = await readBotProfileImageFileSnapshot({
      filePath,
      kind: "banner",
      planKey,
      roots: [root],
    })
    assert.notEqual(avatar.contentDigest, banner.contentDigest)
  } finally {
    await cleanup()
  }
})

test("bot-profile images reject unsupported, malformed, linked, and outside-root files", async () => {
  const { cleanup, root } = await fixture()
  const other = await fixture()
  try {
    const planKey = randomBytes(32)
    const unsupported = join(root, "profile.webp")
    await writeFile(unsupported, Buffer.from("RIFF0000WEBP"), { mode: 0o600 })
    await assert.rejects(
      readBotProfileImageFileSnapshot({
        filePath: unsupported,
        kind: "avatar",
        planKey,
        roots: [root],
      }),
      BotProfileImageFileError,
    )

    const malformed = join(root, "profile.png")
    await writeFile(malformed, PNG_SIGNATURE, { mode: 0o600 })
    await assert.rejects(
      readBotProfileImageFileSnapshot({
        filePath: malformed,
        kind: "banner",
        planKey,
        roots: [root],
      }),
      /valid JPEG, PNG, or GIF image data/u,
    )

    const linked = join(root, "linked.png")
    const secondLink = join(root, "second.png")
    await writeFile(linked, png(64, 64), { mode: 0o600 })
    await link(linked, secondLink)
    await assert.rejects(
      readBotProfileImageFileSnapshot({
        filePath: linked,
        kind: "avatar",
        planKey,
        roots: [root],
      }),
      /exactly one hard link/u,
    )

    const outside = join(other.root, "outside.png")
    await writeFile(outside, png(64, 64), { mode: 0o600 })
    await assert.rejects(
      readBotProfileImageFileSnapshot({
        filePath: outside,
        kind: "avatar",
        planKey,
        roots: [root],
      }),
      /outside configured roots/u,
    )

    const symlinkPath = join(root, "symlink.png")
    await symlink(outside, symlinkPath)
    await assert.rejects(
      readBotProfileImageFileSnapshot({
        filePath: symlinkPath,
        kind: "avatar",
        planKey,
        roots: [root],
      }),
      /symbolic links/u,
    )
  } finally {
    await Promise.all([cleanup(), other.cleanup()])
  }
})

test("bot-profile images enforce the connector byte ceiling before parsing", async () => {
  const { cleanup, root } = await fixture()
  try {
    const filePath = join(root, "oversized.png")
    await writeFile(
      filePath,
      Buffer.alloc(CONNECTOR_LIMITS.botProfileImageBytes + 1),
      { mode: 0o600 },
    )
    await assert.rejects(
      readBotProfileImageFileSnapshot({
        filePath,
        kind: "avatar",
        planKey: randomBytes(32),
        roots: [root],
      }),
      new RegExp(`between 1 and ${CONNECTOR_LIMITS.botProfileImageBytes} bytes`, "u"),
    )
  } finally {
    await cleanup()
  }
})
