import assert from "node:assert/strict"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM,
  PrivateCapabilityFileError,
  type PrivateCapabilityFileHandle,
  type PrivateCapabilityFileSystem,
  reservePrivateCapabilityFile,
  reviewPrivateCapabilityTarget,
} from "../src/private-capability-file.js"

async function privateRoot(context: test.TestContext): Promise<string> {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "discord-mcp-invite-file-")),
  )
  const root = join(parent, "capabilities")
  await mkdir(root, { mode: 0o700 })
  await chmod(root, 0o700)
  context.after(async () => rm(parent, { force: true, recursive: true }))
  return root
}

test("private capability file review and reservation produce one durable 0600 file", async (context) => {
  const root = await privateRoot(context)
  const target = join(root, "invite.json")

  const review = await reviewPrivateCapabilityTarget(target, [root])
  const reservation = await reservePrivateCapabilityFile(target, [root])
  await reservation.write("{\"secret\":true}\n")

  assert.deepEqual(review, {
    canonicalPath: target,
    directChildOfConfiguredRoot: true,
    exclusiveCreate: true,
    fileMode: "0600",
    rootCanonical: true,
    rootOwnerMatchesProcess: true,
    rootPrivate: true,
    targetAbsent: true,
  })
  assert.deepEqual(reservation.review, review)
  assert.equal(await readFile(target, "utf8"), "{\"secret\":true}\n")
  const metadata = await lstat(target)
  assert.equal(metadata.mode & 0o777, 0o600)
  assert.equal(metadata.isFile(), true)
  assert.equal(metadata.nlink, 1)
})

test("private capability target rejects unsafe roots, paths, and replacement", async (context) => {
  const root = await privateRoot(context)
  const nested = join(root, "nested")
  const existing = join(root, "existing.json")
  const permissive = join(root, "permissive")
  const linked = join(root, "linked")
  await mkdir(nested, { mode: 0o700 })
  await writeFile(existing, "preserve\n", { mode: 0o600 })
  await mkdir(permissive, { mode: 0o777 })
  await chmod(permissive, 0o777)
  await symlink(root, linked)

  await assert.rejects(
    () => reviewPrivateCapabilityTarget("relative.json", [root]),
    PrivateCapabilityFileError,
  )
  await assert.rejects(
    () => reviewPrivateCapabilityTarget(join(root, "invite\n.json"), [root]),
    /absolute canonical path/,
  )
  await assert.rejects(
    () => reviewPrivateCapabilityTarget(join(nested, "invite.json"), [root]),
    /direct child/,
  )
  await assert.rejects(
    () => reviewPrivateCapabilityTarget(existing, [root]),
    /already exists/,
  )
  await assert.rejects(
    () => reviewPrivateCapabilityTarget(join(permissive, "invite.json"), [permissive]),
    /not group or world writable/,
  )
  await assert.rejects(
    () => reviewPrivateCapabilityTarget(join(linked, "invite.json"), [linked]),
    /canonical/,
  )
  assert.equal(await readFile(existing, "utf8"), "preserve\n")
})

test("private capability reservation loses an exclusive-create race without replacing data", async (context) => {
  const root = await privateRoot(context)
  const target = join(root, "invite.json")
  await reviewPrivateCapabilityTarget(target, [root])
  await writeFile(target, "winner\n", { mode: 0o600 })

  await assert.rejects(
    () => reservePrivateCapabilityFile(target, [root]),
    /already exists/,
  )
  assert.equal(await readFile(target, "utf8"), "winner\n")
})

test("private capability reservation rejects replacement of its reviewed root", async (context) => {
  const root = await privateRoot(context)
  const movedRoot = `${root}-moved`
  const target = join(root, "invite.json")
  const fileSystem: PrivateCapabilityFileSystem = {
    ...DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM,
    async open(path, flags, mode) {
      await rename(root, movedRoot)
      await mkdir(root, { mode: 0o700 })
      await chmod(root, 0o700)
      return DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM.open(path, flags, mode)
    },
  }

  await assert.rejects(
    () => reservePrivateCapabilityFile(target, [root], fileSystem),
    /changed while it was reserved/,
  )
  await assert.rejects(() => lstat(target), { code: "ENOENT" })
})

test("private capability reservation discards only its own empty inode", async (context) => {
  const root = await privateRoot(context)
  const target = join(root, "invite.json")
  const reservation = await reservePrivateCapabilityFile(target, [root])

  assert.equal(await reservation.discard(), true)
  await assert.rejects(() => lstat(target), { code: "ENOENT" })
})

test("private capability reservation removes its target after invalid content", async (context) => {
  const root = await privateRoot(context)
  const target = join(root, "invite.json")
  const reservation = await reservePrivateCapabilityFile(target, [root])

  await assert.rejects(
    () => reservation.write("missing-newline"),
    /content is invalid/,
  )
  await assert.rejects(() => lstat(target), { code: "ENOENT" })
})

test("private capability reservation removes partial files after write or sync failure", async (context) => {
  for (const failure of ["write", "sync"] as const) {
    const root = await privateRoot(context)
    const target = join(root, `${failure}.json`)
    const fileSystem: PrivateCapabilityFileSystem = {
      ...DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM,
      async open(path, flags, mode) {
        const handle = await DEFAULT_PRIVATE_CAPABILITY_FILE_SYSTEM.open(path, flags, mode)
        const wrapped: PrivateCapabilityFileHandle = {
          chmod: (requestedMode) => handle.chmod(requestedMode),
          close: () => handle.close(),
          stat: (options) => handle.stat(options),
          sync: failure === "sync"
            ? async () => { throw new Error("sync failed") }
            : () => handle.sync(),
          writeFile: failure === "write"
            ? async () => { throw new Error("write failed") }
            : (data, encoding) => handle.writeFile(data, encoding),
        }
        return wrapped
      },
    }
    const reservation = await reservePrivateCapabilityFile(target, [root], fileSystem)

    await assert.rejects(
      () => reservation.write("secret capability\n"),
      /Unable to write private Discord invite capability file/,
    )
    await assert.rejects(() => lstat(target), { code: "ENOENT" })
  }
})

test("private capability write refuses a moved root before writing secret bytes", async (context) => {
  const root = await privateRoot(context)
  const movedRoot = `${root}-moved`
  const target = join(root, "invite.json")
  const movedTarget = join(movedRoot, "invite.json")
  const reservation = await reservePrivateCapabilityFile(target, [root])
  await rename(root, movedRoot)

  await assert.rejects(
    () => reservation.write("secret capability\n"),
    /Unable to write private Discord invite capability file/,
  )
  assert.equal(await readFile(movedTarget, "utf8"), "")
})

test("private capability write detects path substitution and preserves the replacement", async (context) => {
  const root = await privateRoot(context)
  const target = join(root, "invite.json")
  const reservation = await reservePrivateCapabilityFile(target, [root])
  await unlink(target)
  await writeFile(target, "replacement\n", { mode: 0o600 })

  await assert.rejects(
    () => reservation.write("secret capability\n"),
    /Unable to write private Discord invite capability file/,
  )
  assert.equal(await readFile(target, "utf8"), "replacement\n")
})
