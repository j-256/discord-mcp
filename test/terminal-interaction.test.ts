import assert from "node:assert/strict"
import test from "node:test"

import { externalOpenCommand } from "../src/terminal-interaction.js"

const HTTPS_URI = "https://example.com/install?guild=100&exact=true"
const FILE_URI = "file:///private/GuildControl%20guide.html"

test("external browser commands preserve one validated URI argument without a shell", () => {
  assert.deepEqual(externalOpenCommand(HTTPS_URI, "darwin"), {
    args: [HTTPS_URI],
    command: "open",
  })
  assert.deepEqual(externalOpenCommand(FILE_URI, "linux"), {
    args: [FILE_URI],
    command: "xdg-open",
  })
  assert.deepEqual(externalOpenCommand(HTTPS_URI, "win32"), {
    args: ["url.dll,FileProtocolHandler", HTTPS_URI],
    command: "rundll32.exe",
  })
})

test("external browser commands reject relative and active-content locations", () => {
  assert.throws(
    () => externalOpenCommand("./guide.html", "darwin"),
    /valid absolute URI/,
  )
  assert.throws(
    () => externalOpenCommand("http://example.com/", "darwin"),
    /only HTTPS and local file URIs/,
  )
  assert.throws(
    () => externalOpenCommand("javascript:alert(1)", "darwin"),
    /only HTTPS and local file URIs/,
  )
})
