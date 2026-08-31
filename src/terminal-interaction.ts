import { spawn } from "node:child_process"
import { Writable } from "node:stream"
import { createInterface } from "node:readline/promises"

import { ConfigurationError } from "./errors.js"

export interface CliInteraction {
  openExternal(uri: string): Promise<void>
  promptSecret(message: string): Promise<string>
  promptText(message: string): Promise<string>
}

export class CliInteractionCancelledError extends Error {
  constructor(options: ErrorOptions = {}) {
    super("Interactive command canceled", options)
    this.name = "CliInteractionCancelledError"
  }
}

function readlineCancellation(error: unknown): boolean {
  return error instanceof Error
    && error.name === "AbortError"
    && "code" in error
    && error.code === "ABORT_ERR"
}

async function question(
  message: string,
  secret: boolean,
): Promise<string> {
  let muted = false
  const output = secret
    ? new Writable({
        write(chunk, encoding, callback) {
          if (!muted) process.stdout.write(chunk, encoding as BufferEncoding)
          callback()
        },
      })
    : process.stdout
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  })
  try {
    if (secret) process.stdout.write(message)
    muted = secret
    const pending = terminal.question(secret ? "" : message)
    const answer = await pending.catch((error: unknown) => {
      if (readlineCancellation(error)) {
        throw new CliInteractionCancelledError({ cause: error })
      }
      throw error
    })
    if (secret) process.stdout.write("\n")
    return answer.trim()
  } finally {
    muted = false
    terminal.close()
  }
}

export function externalOpenCommand(
  uri: string,
  platform: NodeJS.Platform = process.platform,
): { args: string[]; command: string } {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch (error) {
    throw new ConfigurationError("Browser opening requires a valid absolute URI", {
      cause: error,
    })
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "file:") {
    throw new ConfigurationError("Browser opening permits only HTTPS and local file URIs")
  }
  if (platform === "darwin") return { args: [parsed.href], command: "open" }
  if (platform === "win32") {
    return {
      args: ["url.dll,FileProtocolHandler", parsed.href],
      command: "rundll32.exe",
    }
  }
  return { args: [parsed.href], command: "xdg-open" }
}

export async function openExternal(uri: string): Promise<void> {
  const launch = externalOpenCommand(uri)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: "ignore",
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  }).catch((error: unknown) => {
    throw new ConfigurationError("Unable to open the browser", { cause: error })
  })
}

export const DEFAULT_CLI_INTERACTION: CliInteraction = Object.freeze({
  openExternal,
  promptSecret: (message: string) => question(message, true),
  promptText: (message: string) => question(message, false),
})
