import { invariant } from "./release-lib.mjs"
import { inspectAuthenticatedOciTag, parseOciReference } from "./oci-registry.mjs"

function parseArguments(args) {
  let image
  let json = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--json") {
      json = true
      continue
    }
    const value = args[index + 1]
    invariant(value, `Option ${argument} requires a value`)
    index += 1
    if (argument === "--image") image = value
    else throw new Error(`Unknown option ${argument}`)
  }
  invariant(image, "--image is required")
  parseOciReference(image)
  return { image, json }
}

const options = parseArguments(process.argv.slice(2))
const result = await inspectAuthenticatedOciTag({
  reference: options.image,
  token: process.env.GITHUB_TOKEN,
  username: process.env.GITHUB_ACTOR,
})
const report = { image: options.image, ...result }
process.stdout.write(options.json ? `${JSON.stringify(report)}\n` : [
  `OCI image tag: ${report.state}`,
  ...(report.digest ? [`OCI image digest: ${report.digest}`] : []),
].join("\n") + "\n")
