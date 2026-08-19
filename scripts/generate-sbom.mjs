import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import {
  canonicalJson,
  invariant,
  readJson,
  REPOSITORY_ROOT,
  run,
} from "./release-lib.mjs"

function parseOutput(args) {
  if (args.length === 0) return undefined
  invariant(args.length === 2 && args[0] === "--output", "Usage: generate-sbom.mjs [--output FILE]")
  return resolve(args[1])
}

function dependencyName(path) {
  const marker = "node_modules/"
  const index = path.lastIndexOf(marker)
  invariant(index >= 0, `Unexpected lockfile package path ${path}`)
  return path.slice(index + marker.length)
}

function packageIdentity(entry) {
  return `${entry.name}@${entry.versionInfo}`
}

const output = parseOutput(process.argv.slice(2))
const packageJson = await readJson(join(REPOSITORY_ROOT, "package.json"))
const lock = await readJson(join(REPOSITORY_ROOT, "package-lock.json"))
const result = await run(
  "npm",
  ["sbom", "--omit=dev", "--sbom-format=spdx"],
  { capture: true },
)
const document = JSON.parse(result.stdout)
const namespacePackage = encodeURIComponent(packageJson.name).replace("%40", "@").toLowerCase()
invariant(document.spdxVersion === "SPDX-2.3", "SBOM must use SPDX 2.3")
invariant(document.dataLicense === "CC0-1.0", "SBOM data license is invalid")
invariant(document.SPDXID === "SPDXRef-DOCUMENT", "SBOM document identity is invalid")
invariant(typeof document.documentNamespace === "string" && document.documentNamespace.startsWith(`http://spdx.org/spdxdocs/${namespacePackage}-${packageJson.version}-`), "SBOM namespace does not match the package")
invariant(Array.isArray(document.packages), "SBOM packages are missing")
invariant(Array.isArray(document.relationships) && document.relationships.length > 0, "SBOM relationships are missing")

const productionLockEntries = Object.entries(lock.packages)
  .filter(([path, metadata]) => path && metadata.dev !== true)
  .map(([path, metadata]) => ({
    identity: `${dependencyName(path)}@${metadata.version}`,
    metadata,
  }))
const expectedMetadata = new Map(productionLockEntries.map((entry) => [entry.identity, entry.metadata]))
invariant(expectedMetadata.size === productionLockEntries.length, "production lockfile contains duplicate package identities")
const expectedPackages = [
  `${packageJson.name}@${packageJson.version}`,
  ...productionLockEntries.map((entry) => entry.identity),
].sort()
const actualPackages = document.packages.map(packageIdentity).sort()
invariant(canonicalJson(actualPackages) === canonicalJson(expectedPackages), "SBOM production package set does not match the lockfile")

for (const entry of document.packages) {
  invariant(entry.filesAnalyzed === false, `SBOM package ${entry.name} must not claim file analysis`)
  const expectedPackageUrl = `pkg:npm/${entry.name.replace(/^@/, "%40")}@${entry.versionInfo}`
  const packageUrls = (entry.externalRefs || [])
    .filter((reference) => reference.referenceType === "purl")
    .map((reference) => ({
      category: reference.referenceCategory,
      locator: reference.referenceLocator,
    }))
  invariant(canonicalJson(packageUrls) === canonicalJson([{
    category: "PACKAGE-MANAGER",
    locator: expectedPackageUrl,
  }]), `SBOM package ${entry.name} has an unexpected package URL`)
  if (entry.name === packageJson.name) {
    invariant(entry.licenseDeclared === packageJson.license, "SBOM root license is out of sync")
    continue
  }
  const metadata = expectedMetadata.get(packageIdentity(entry))
  invariant(metadata, `SBOM package ${entry.name} is absent from the lockfile`)
  invariant(entry.downloadLocation === metadata.resolved, `SBOM package ${entry.name} has an unexpected origin`)
  invariant(entry.checksums?.length === 1, `SBOM package ${entry.name} must have one checksum`)
  invariant(entry.checksums[0].algorithm === "SHA512", `SBOM package ${entry.name} must use SHA-512`)
  invariant(/^[0-9a-f]{128}$/.test(entry.checksums[0].checksumValue), `SBOM package ${entry.name} has an invalid checksum`)
  const lockChecksum = Buffer.from(metadata.integrity.slice("sha512-".length), "base64").toString("hex")
  invariant(entry.checksums[0].checksumValue === lockChecksum, `SBOM package ${entry.name} checksum differs from the lockfile`)
}

const serialized = `${JSON.stringify(document, null, 2)}\n`
if (output) {
  await writeFile(output, serialized, { flag: "wx" })
  process.stdout.write(`Validated SPDX SBOM written to ${output}\n`)
} else {
  process.stdout.write(serialized)
}
