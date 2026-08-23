import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]),
  )
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function sha512Integrity(value) {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`
}

export async function run(command, args, options = {}) {
  const capture = options.capture === true
  const allowedExitCodes = options.allowedExitCodes || [0]
  const child = spawn(command, args, {
    cwd: options.cwd || REPOSITORY_ROOT,
    env: options.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  let stdout = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
    if (!capture) process.stdout.write(chunk)
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
    if (!capture) process.stderr.write(chunk)
  })
  const code = await new Promise((resolveCode, reject) => {
    child.on("error", reject)
    child.on("close", resolveCode)
  })
  invariant(allowedExitCodes.includes(code), `${command} exited with status ${code}`)
  return { code, stderr, stdout }
}
