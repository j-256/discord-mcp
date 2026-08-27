import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const COMPARISON_FILE = resolve(SCRIPT_DIRECTORY, "..", "..", "docs", "comparison.md")
const CONCURRENCY = 4
const REQUEST_TIMEOUT_MS = 20_000
const RETRY_DELAYS_MS = Object.freeze([0, 750, 2_500])
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const USER_AGENT = "discord-mcp-documentation-link-verifier/1.0"

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function externalLinks(markdown) {
  assert.doesNotMatch(markdown, /\]\(http:\/\//u, "Comparison evidence links must use HTTPS")
  const links = [...markdown.matchAll(/!?\[[^\]]*\]\((https:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/gu)]
    .map((match) => new URL(match[1]))
    .map((url) => {
      url.hash = ""
      return url.href
    })
  assert.ok(links.length > 0, "Comparison contains no external evidence links")
  return [...new Set(links)].sort()
}

async function fetchStatus(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      range: "bytes=0-0",
      "user-agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const status = response.status
  await response.body?.cancel()
  return status
}

async function verifyLink(url) {
  let lastFailure
  for (const retryDelay of RETRY_DELAYS_MS) {
    if (retryDelay > 0) await delay(retryDelay)
    try {
      const status = await fetchStatus(url)
      if (status >= 200 && status < 400) return
      lastFailure = new Error(`HTTP ${status}`)
      if (!RETRYABLE_STATUS.has(status)) break
    } catch (error) {
      lastFailure = error
    }
  }
  throw new Error(`${url}: ${lastFailure?.message || "unknown failure"}`)
}

async function main() {
  const markdown = await readFile(COMPARISON_FILE, "utf8")
  const queue = externalLinks(markdown)
  const total = queue.length
  const failures = []
  const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
    while (queue.length > 0) {
      const url = queue.shift()
      try {
        await verifyLink(url)
      } catch (error) {
        failures.push(error.message)
      }
    }
  })
  await Promise.all(workers)
  assert.deepEqual(failures, [], `Comparison evidence has unreachable links:\n${failures.join("\n")}`)
  process.stdout.write(`Verified ${total} external comparison evidence links\n`)
}

await main()
