import {
  lstat,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises"
import { basename, join, resolve, sep } from "node:path"

import {
  canonicalJson,
  invariant,
  readJson,
  REPOSITORY_ROOT,
  sha256,
} from "./release-lib.mjs"

const LICENSE_FILE_PATTERN = /^(?:copying|licen[cs]e|notice)(?:\..*)?$/i
const MAX_LICENSE_BYTES = 256 * 1024

function parseOutput(args) {
  if (args.length === 0) return undefined
  invariant(
    args.length === 2 && args[0] === "--output",
    "Usage: generate-third-party-notices.mjs [--output FILE]",
  )
  return resolve(args[1])
}

function dependencyName(path) {
  const marker = "node_modules/"
  const index = path.lastIndexOf(marker)
  invariant(index >= 0, `Unexpected lockfile package path ${path}`)
  return path.slice(index + marker.length)
}

function packageIdentity(name, version) {
  return `${name}@${version}`
}

function normalizeLicenseText(text, identity) {
  const normalized = text.replaceAll("\r\n", "\n").trim()
  invariant(normalized, `Third-party license text is empty for ${identity}`)
  invariant(!normalized.includes("\0"), `Third-party license text contains NUL for ${identity}`)
  invariant(!normalized.includes("```"), `Third-party license text contains an unsupported fence for ${identity}`)
  invariant(Buffer.byteLength(normalized) <= MAX_LICENSE_BYTES, `Third-party license text is too large for ${identity}`)
  return normalized
}

function packageUrl(name, version) {
  return `pkg:npm/${name.replace(/^@/, "%40")}@${version}`
}

async function collectDependency(path, lockMetadata) {
  invariant(path.startsWith("node_modules/"), `Unexpected production dependency path ${path}`)
  const directory = resolve(REPOSITORY_ROOT, path)
  invariant(
    directory.startsWith(`${resolve(REPOSITORY_ROOT, "node_modules")}${sep}`),
    `Production dependency path escapes node_modules: ${path}`,
  )
  invariant(await realpath(directory) === directory, `Production dependency path is not canonical: ${path}`)
  const packageJsonPath = join(directory, "package.json")
  const packageMetadata = await readJson(packageJsonPath)
  const name = dependencyName(path)
  invariant(packageMetadata.name === name, `Installed package name differs from the lockfile at ${path}`)
  invariant(packageMetadata.version === lockMetadata.version, `Installed package version differs from the lockfile at ${path}`)
  invariant(
    canonicalJson(packageMetadata.license) === canonicalJson(lockMetadata.license),
    `Installed package license differs from the lockfile at ${path}`,
  )
  invariant(typeof lockMetadata.license === "string" && lockMetadata.license, `Production dependency license is missing at ${path}`)
  invariant(typeof lockMetadata.resolved === "string" && lockMetadata.resolved.startsWith("https://registry.npmjs.org/"), `Production dependency origin is invalid at ${path}`)
  invariant(typeof lockMetadata.integrity === "string" && lockMetadata.integrity.startsWith("sha512-"), `Production dependency integrity is invalid at ${path}`)
  const licenseNames = (await readdir(directory))
    .filter((name) => LICENSE_FILE_PATTERN.test(name))
    .sort()
  invariant(licenseNames.length > 0, `Production dependency license file is missing at ${path}`)
  const licenses = []
  for (const filename of licenseNames) {
    invariant(basename(filename) === filename, `Production dependency license filename is invalid at ${path}`)
    const file = join(directory, filename)
    const metadata = await lstat(file)
    invariant(metadata.isFile() && !metadata.isSymbolicLink(), `Production dependency license is not a regular file at ${path}`)
    const text = normalizeLicenseText(await readFile(file, "utf8"), packageIdentity(name, lockMetadata.version))
    licenses.push({ digest: sha256(text), filename, text })
  }
  return {
    identity: packageIdentity(name, lockMetadata.version),
    integrity: lockMetadata.integrity,
    license: lockMetadata.license,
    licenses,
    name,
    packageUrl: packageUrl(name, lockMetadata.version),
    resolved: lockMetadata.resolved,
    version: lockMetadata.version,
  }
}

export async function generateThirdPartyNotices() {
  const lock = await readJson(join(REPOSITORY_ROOT, "package-lock.json"))
  const entries = Object.entries(lock.packages)
    .filter(([path, metadata]) => path && metadata.dev !== true)
    .sort(([left], [right]) => left.localeCompare(right))
  const dependencies = []
  for (const [path, metadata] of entries) {
    dependencies.push(await collectDependency(path, metadata))
  }
  const identities = dependencies.map(({ identity }) => identity)
  invariant(new Set(identities).size === identities.length, "Production dependency identities are not unique")

  const licenseGroups = new Map()
  for (const dependency of dependencies) {
    for (const license of dependency.licenses) {
      const existing = licenseGroups.get(license.digest)
      if (existing) {
        invariant(existing.text === license.text, `Third-party license digest collision for ${dependency.identity}`)
        existing.appliesTo.push({ filename: license.filename, identity: dependency.identity })
      } else {
        licenseGroups.set(license.digest, {
          appliesTo: [{ filename: license.filename, identity: dependency.identity }],
          text: license.text,
        })
      }
    }
  }

  const lines = [
    "# Third-party notices",
    "",
    "This file is generated from the exact production dependency graph in `package-lock.json` and the corresponding installed package license files. Package integrity and origins remain independently recorded in the embedded SPDX SBOM.",
    "",
    "## Dependency inventory",
    "",
    "| Package | Declared license | Package URL | Locked archive |",
    "| --- | --- | --- | --- |",
    ...dependencies.map((dependency) => (
      `| \`${dependency.identity}\` | \`${dependency.license}\` | \`${dependency.packageUrl}\` | <${dependency.resolved}> |`
    )),
    "",
    "## License texts",
    "",
  ]
  for (const [digest, group] of [...licenseGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    group.appliesTo.sort((left, right) => (
      left.identity.localeCompare(right.identity)
      || left.filename.localeCompare(right.filename)
    ))
    lines.push(
      `### \`sha256:${digest}\``,
      "",
      `Applies to ${group.appliesTo.map(({ filename, identity }) => `\`${identity}\` (\`${filename}\`)`).join(", ")}.`,
      "",
      "```text",
      group.text,
      "```",
      "",
    )
  }
  return `${lines.join("\n").trimEnd()}\n`
}

const output = parseOutput(process.argv.slice(2))
const notices = await generateThirdPartyNotices()
if (output) {
  await writeFile(output, notices, { flag: "wx" })
  process.stdout.write(`Third-party notices written to ${output}\n`)
} else {
  process.stdout.write(notices)
}
