import { resolve } from "node:path"

import { buildAndVerifyMcpb } from "./mcpb-artifact.mjs"
import { invariant, readJson, REPOSITORY_ROOT } from "./release-lib.mjs"

const ALLOW_REGISTRY_MISMATCH_OPTION = "--allow-registry-mismatch"

function parseArguments(args) {
  const options = {
    allowRegistryMismatch: false,
    catalogEvidencePath: undefined,
    outputDirectory: undefined,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === ALLOW_REGISTRY_MISMATCH_OPTION) {
      invariant(!options.allowRegistryMismatch, `Duplicate option ${argument}`)
      options.allowRegistryMismatch = true
      continue
    }
    const value = args[index + 1]
    invariant(value, `Option ${argument} requires a value`)
    index += 1
    if (argument === "--catalog-evidence") options.catalogEvidencePath = resolve(value)
    else if (argument === "--output") options.outputDirectory = resolve(value)
    else throw new Error(`Unknown option ${argument}`)
  }
  return options
}

const options = parseArguments(process.argv.slice(2))
const report = await buildAndVerifyMcpb(options)
if (!options.allowRegistryMismatch) {
  const server = await readJson(`${REPOSITORY_ROOT}/server.json`)
  const packages = server.packages?.filter(({ registryType }) => registryType === "mcpb")
  invariant(packages?.length === 1, "server.json must declare one MCPB package")
  invariant(/^[0-9a-f]{64}$/.test(packages[0].fileSha256), "server.json MCPB digest is invalid")
  invariant(
    report.digest === `sha256:${packages[0].fileSha256}`,
    `MCPB artifact digest differs from server.json; use ${ALLOW_REGISTRY_MISMATCH_OPTION} only while preparing a new reviewed release digest`,
  )
}
process.stdout.write(`${JSON.stringify(report)}\n`)
