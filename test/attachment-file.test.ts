import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  readAttachmentFileSnapshot,
  readDirectAttachmentFileSnapshot,
} from "../src/attachment-file.js"
import { readOwnedLocalFileSnapshot } from "../src/local-file.js"

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "discord-mcp-attachment-"))
  const root = await realpath(temporary)
  return {
    async cleanup() {
      await rm(temporary, { force: true, recursive: true })
    },
    root,
  }
}

test("attachment snapshot binds stable owned bytes inside one canonical root", async () => {
  const { cleanup, root } = await fixture()
  try {
    const filePath = join(root, "report.txt")
    await writeFile(filePath, "reviewed bytes")
    const planKey = randomBytes(32)
    const first = await readAttachmentFileSnapshot({
      filePath,
      maxBytes: 1_024,
      planKey,
      roots: [root],
    })
    const second = await readAttachmentFileSnapshot({
      filePath,
      maxBytes: 1_024,
      planKey,
      roots: [root],
    })

    assert.equal(first.review.canonicalPath, filePath)
    assert.equal(first.review.sizeBytes, 14)
    assert.equal(first.review.regularFile, true)
    assert.equal(first.review.singleLink, true)
    assert.equal(first.review.stableRead, true)
    assert.equal(first.contentDigest, second.contentDigest)
    assert.deepEqual(first.bytes, new Uint8Array(await readFile(filePath)))
    const direct = await readDirectAttachmentFileSnapshot({
      filePath,
      maxBytes: 1_024,
      planKey,
      roots: [root],
    })
    assert.notEqual(first.contentDigest, direct.contentDigest)
    assert.deepEqual(first.binding, direct.binding)
    assert.deepEqual(first.review, direct.review)

    await writeFile(filePath, "different bytes")
    const changed = await readAttachmentFileSnapshot({
      filePath,
      maxBytes: 1_024,
      planKey,
      roots: [root],
    })
    assert.notEqual(first.contentDigest, changed.contentDigest)
    assert.notDeepEqual(first.binding, changed.binding)

    const otherKey = await readAttachmentFileSnapshot({
      filePath,
      maxBytes: 1_024,
      planKey: randomBytes(32),
      roots: [root],
    })
    assert.notEqual(changed.contentDigest, otherKey.contentDigest)
  } finally {
    await cleanup()
  }
})

test("attachment snapshot rejects noncanonical, linked, empty, and oversized files", async () => {
  const { cleanup, root } = await fixture()
  try {
    const regular = join(root, "regular.txt")
    const hardLink = join(root, "hard-link.txt")
    const bounded = join(root, "bounded.txt")
    const symbolicLink = join(root, "symbolic-link.txt")
    const empty = join(root, "empty.txt")
    const oversized = join(root, "oversized.txt")
    await writeFile(regular, "content")
    await link(regular, hardLink)
    await symlink(regular, symbolicLink)
    await writeFile(empty, "")
    await writeFile(bounded, "1234")
    await writeFile(oversized, "12345")
    const options = {
      maxBytes: 4,
      planKey: randomBytes(32),
      roots: [root],
    }

    const exactCeiling = await readAttachmentFileSnapshot({
      ...options,
      filePath: bounded,
    })
    assert.equal(exactCeiling.bytes.byteLength, 4)

    await assert.rejects(
      readAttachmentFileSnapshot({ ...options, filePath: regular }),
      /exactly one hard link/,
    )
    await assert.rejects(
      readAttachmentFileSnapshot({ ...options, filePath: symbolicLink }),
      /symbolic links/,
    )
    await assert.rejects(
      readAttachmentFileSnapshot({ ...options, filePath: empty }),
      /between 1 and 4 bytes/,
    )
    await assert.rejects(
      readAttachmentFileSnapshot({ ...options, filePath: oversized }),
      /between 1 and 4 bytes/,
    )
    await assert.rejects(
      readAttachmentFileSnapshot({
        ...options,
        filePath: `${root}/./oversized.txt`,
      }),
      /already be canonical/,
    )
  } finally {
    await cleanup()
  }
})

test("attachment snapshot rejects files outside configured roots", async () => {
  const first = await fixture()
  const second = await fixture()
  try {
    const filePath = join(second.root, "outside.txt")
    await writeFile(filePath, "content")
    await assert.rejects(
      readAttachmentFileSnapshot({
        filePath,
        maxBytes: 1_024,
        planKey: randomBytes(32),
        roots: [first.root],
      }),
      /outside configured roots/,
    )
  } finally {
    await Promise.all([first.cleanup(), second.cleanup()])
  }
})

test("owned local snapshots reject invalid context, bounds, roots, and file types", async () => {
  const { cleanup, root } = await fixture()
  try {
    const filePath = join(root, "reviewed.txt")
    const directoryPath = join(root, "directory")
    const missingPath = join(root, "missing.txt")
    await writeFile(filePath, "reviewed")
    await mkdir(directoryPath)
    const base = {
      description: "Reviewed file",
      digestDomain: "reviewed-file.v1",
      filePath,
      maxBytes: 1_024,
      planKey: randomBytes(32),
      roots: [root],
    }

    await assert.rejects(
      readOwnedLocalFileSnapshot({ ...base, description: "" }),
      /context is invalid/,
    )
    await assert.rejects(
      readOwnedLocalFileSnapshot({ ...base, digestDomain: "Invalid Domain" }),
      /context is invalid/,
    )
    await assert.rejects(
      readOwnedLocalFileSnapshot({ ...base, filePath: "relative.txt" }),
      /one exact absolute path/,
    )
    await assert.rejects(
      readOwnedLocalFileSnapshot({ ...base, maxBytes: 0 }),
      /positive safe integer/,
    )
    await assert.rejects(
      readOwnedLocalFileSnapshot({ ...base, roots: [] }),
      /roots are not configured/,
    )
    await assert.rejects(
      readOwnedLocalFileSnapshot({ ...base, roots: ["relative"] }),
      /roots are not configured/,
    )
    await assert.rejects(
      readOwnedLocalFileSnapshot({ ...base, filePath: missingPath }),
      /path does not exist/,
    )
    await assert.rejects(
      readOwnedLocalFileSnapshot({ ...base, filePath: directoryPath }),
      /must name a regular file/,
    )
  } finally {
    await cleanup()
  }
})
