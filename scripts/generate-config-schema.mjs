import {
  readFile,
  writeFile,
} from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { connectorConfigJsonSchema } from "../src/config-document.ts"

const OUTPUT_URL = new URL("../guildcontrol.config.schema.json", import.meta.url)
const output = `${JSON.stringify(connectorConfigJsonSchema(), null, 2)}\n`

if (process.argv.includes("--check")) {
  let current
  try {
    current = await readFile(OUTPUT_URL, "utf8")
  } catch {
    current = undefined
  }
  if (current !== output) {
    console.error(`${fileURLToPath(OUTPUT_URL)} is stale; run npm run config:schema`)
    process.exitCode = 1
  }
} else {
  await writeFile(OUTPUT_URL, output, "utf8")
}
