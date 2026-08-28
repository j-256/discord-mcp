import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { verifyPublicDocumentation } from "./documentation-manifest.mjs"

const HELP = `Usage: node scripts/check-public-documentation.mjs [options]

Verify that the canonical public documentation manifest matches this source tree.

Options:
  -h, --help            Show this help and exit
      --manifest FILE   Require exact equality with a verified local manifest
      --attempts N      Try up to N times from 1 through 12 (default: 1)
      --delay-ms N      Wait up to 10000 milliseconds between attempts (default: 0)
      --json             Write the verification report as JSON

The command requires Node.js network access to the fixed project documentation URL.
Exit status 0 means matching, 1 means verification failed, and 2 means invalid usage.
`

export class UsageError extends Error {}

function optionValue(args, index, inlineValue, option) {
  if (inlineValue !== undefined) {
    if (inlineValue.length === 0) throw new UsageError(`${option} requires a non-empty value`)
    return { nextIndex: index, value: inlineValue }
  }
  const value = args[index + 1]
  if (value === undefined || value === "--" || value.startsWith("-")) {
    throw new UsageError(`${option} requires a value`)
  }
  return { nextIndex: index + 1, value }
}

function parseInteger(value, option, minimum, maximum) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new UsageError(`${option} requires an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new UsageError(`${option} must be between ${minimum} and ${maximum}`)
  }
  return parsed
}

export function parseArguments(args) {
  const options = {
    attempts: 1,
    delayMs: 0,
    help: false,
    json: false,
    manifest: undefined,
  }
  const seen = new Set()
  let optionsEnded = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (optionsEnded) throw new UsageError(`Unexpected positional argument ${argument}`)
    if (argument === "--") {
      optionsEnded = true
      continue
    }
    if (argument === "-h" || argument === "--help") {
      options.help = true
      continue
    }
    if (argument === "--json") {
      if (seen.has("json")) throw new UsageError("--json may be supplied only once")
      seen.add("json")
      options.json = true
      continue
    }
    if (!argument.startsWith("--")) throw new UsageError(`Unknown option ${argument}`)
    const equalsIndex = argument.indexOf("=")
    const option = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex)
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1)
    const key = option.slice(2)
    if (!["attempts", "delay-ms", "manifest"].includes(key)) {
      throw new UsageError(`Unknown option ${option}`)
    }
    if (seen.has(key)) throw new UsageError(`${option} may be supplied only once`)
    seen.add(key)
    const parsed = optionValue(args, index, inlineValue, option)
    index = parsed.nextIndex
    if (key === "attempts") options.attempts = parseInteger(parsed.value, option, 1, 12)
    else if (key === "delay-ms") options.delayMs = parseInteger(parsed.value, option, 0, 10_000)
    else options.manifest = resolve(parsed.value)
  }
  return options
}

async function main(args) {
  const options = parseArguments(args)
  if (options.help) {
    process.stdout.write(HELP)
    return
  }
  const expectedManifest = options.manifest === undefined
    ? undefined
    : JSON.parse(await readFile(options.manifest, "utf8"))
  const report = await verifyPublicDocumentation({
    attempts: options.attempts,
    delayMs: options.delayMs,
    expectedManifest,
    onRetry(error, attempt, attempts) {
      process.stderr.write(`Public documentation is not exact after attempt ${attempt} of ${attempts}: ${error.message}\n`)
    },
  })
  process.stdout.write(options.json
    ? `${JSON.stringify(report)}\n`
    : `Public documentation: exact ${report.version}\n`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`)
    if (error instanceof UsageError) process.stderr.write("Try --help for usage.\n")
    process.exitCode = error instanceof UsageError ? 2 : 1
  })
}
