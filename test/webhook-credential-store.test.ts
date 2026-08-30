import assert from "node:assert/strict"
import {
  chmod,
  link,
  lstat,
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
  DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM,
  WebhookCredentialStore,
  WebhookCredentialStoreError,
} from "../src/webhook-credential-store.js"

const WEBHOOK_ID = "200000000000000001"
const OTHER_WEBHOOK_ID = "200000000000000002"
const TOKEN = "private_webhook_token.test-value"

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guildcontrol-webhook-credentials-"))
  await chmod(root, 0o700)
  return realpath(root)
}

test("webhook credential store writes, reads, and removes one private exact-ID file", async () => {
  const root = await privateRoot()
  try {
    const store = new WebhookCredentialStore(root)
    await store.write(WEBHOOK_ID, TOKEN)

    const path = join(root, `${WEBHOOK_ID}.token`)
    const metadata = await lstat(path)
    assert.equal(metadata.mode & 0o777, 0o600)
    assert.equal(metadata.nlink, 1)
    assert.equal(await readFile(path, "utf8"), `${TOKEN}\n`)
    assert.equal(await store.read(WEBHOOK_ID), TOKEN)
    assert.equal(await store.remove(WEBHOOK_ID), true)
    assert.equal(await store.remove(WEBHOOK_ID), false)
    await assert.rejects(
      store.read(WEBHOOK_ID),
      (error: unknown) => (
        error instanceof WebhookCredentialStoreError
        && error.code === "missing"
      ),
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("webhook credential store never overwrites an existing exact credential", async () => {
  const root = await privateRoot()
  try {
    const store = new WebhookCredentialStore(root)
    await store.write(WEBHOOK_ID, TOKEN)
    await assert.rejects(
      store.write(WEBHOOK_ID, "replacement"),
      (error: unknown) => (
        error instanceof WebhookCredentialStoreError
        && error.code === "exists"
      ),
    )
    assert.equal(await store.read(WEBHOOK_ID), TOKEN)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("webhook credential store removes its exact reservation after post-open inspection fails", async () => {
  const root = await privateRoot()
  try {
    const path = join(root, `${WEBHOOK_ID}.token`)
    const store = new WebhookCredentialStore(root, {
      ...DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM,
      async realpath(candidate) {
        if (candidate === path) throw new Error("injected inspection failure")
        return DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM.realpath(candidate)
      },
    })
    await assert.rejects(store.write(WEBHOOK_ID, TOKEN), /could not be stored/)
    await assert.rejects(lstat(path), { code: "ENOENT" })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("webhook credential store cleans a new file when directory synchronization fails", async () => {
  const root = await privateRoot()
  try {
    const path = join(root, `${WEBHOOK_ID}.token`)
    const store = new WebhookCredentialStore(root, {
      ...DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM,
      async open(candidate, flags, mode) {
        if (candidate === root) throw new Error("injected directory sync failure")
        return DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM.open(candidate, flags, mode)
      },
    })
    await assert.rejects(store.write(WEBHOOK_ID, TOKEN), /could not be synchronized/)
    await assert.rejects(lstat(path), { code: "ENOENT" })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("webhook credential store reports removal synchronization failure conservatively", async () => {
  const root = await privateRoot()
  try {
    let failRootOpen = false
    const path = join(root, `${WEBHOOK_ID}.token`)
    const store = new WebhookCredentialStore(root, {
      ...DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM,
      async open(candidate, flags, mode) {
        if (candidate === root && failRootOpen) {
          throw new Error("injected directory sync failure")
        }
        return DEFAULT_WEBHOOK_CREDENTIAL_FILE_SYSTEM.open(candidate, flags, mode)
      },
    })
    await store.write(WEBHOOK_ID, TOKEN)
    failRootOpen = true
    await assert.rejects(store.remove(WEBHOOK_ID), /could not be synchronized/)
    await assert.rejects(lstat(path), { code: "ENOENT" })
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("webhook credential store rejects malformed IDs and secret content", async () => {
  const root = await privateRoot()
  try {
    const store = new WebhookCredentialStore(root)
    assert.throws(() => store.pathFor("../credential"), WebhookCredentialStoreError)
    await assert.rejects(store.write(WEBHOOK_ID, "contains whitespace"), /content is invalid/)
    await assert.rejects(store.write(WEBHOOK_ID, "contains\nnewline"), /content is invalid/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("webhook credential store rejects permissive roots and files", async () => {
  const root = await privateRoot()
  try {
    const store = new WebhookCredentialStore(root)
    await chmod(root, 0o750)
    await assert.rejects(store.write(WEBHOOK_ID, TOKEN), /root must be canonical/)
    await chmod(root, 0o600)
    await assert.rejects(store.write(WEBHOOK_ID, TOKEN), /root must be canonical/)
    await chmod(root, 0o700)

    const path = join(root, `${WEBHOOK_ID}.token`)
    await writeFile(path, `${TOKEN}\n`, { mode: 0o644 })
    await assert.rejects(store.read(WEBHOOK_ID), /0600 regular file/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("webhook credential store rejects symlink and hard-link credential aliases", async () => {
  const root = await privateRoot()
  try {
    const store = new WebhookCredentialStore(root)
    const source = join(root, "source")
    await writeFile(source, `${TOKEN}\n`, { mode: 0o600 })
    await symlink(source, join(root, `${WEBHOOK_ID}.token`))
    await assert.rejects(store.read(WEBHOOK_ID), WebhookCredentialStoreError)

    await rm(join(root, `${WEBHOOK_ID}.token`))
    await link(source, join(root, `${OTHER_WEBHOOK_ID}.token`))
    await assert.rejects(store.read(OTHER_WEBHOOK_ID), /one bounded process-owned/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("webhook credential store requires one newline-terminated UTF-8 token", async () => {
  const root = await privateRoot()
  try {
    const store = new WebhookCredentialStore(root)
    const path = join(root, `${WEBHOOK_ID}.token`)
    await writeFile(path, TOKEN, { mode: 0o600 })
    await assert.rejects(store.read(WEBHOOK_ID), /newline-terminated/)
    await writeFile(path, `${TOKEN}\nextra\n`, { mode: 0o600 })
    await assert.rejects(store.read(WEBHOOK_ID), /newline-terminated/)
    await writeFile(path, new Uint8Array([0xC3, 0x28, 0x0A]), { mode: 0o600 })
    await assert.rejects(store.read(WEBHOOK_ID), /not valid UTF-8/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
