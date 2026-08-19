import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  canonicalJson,
  invariant,
  readJson,
  REPOSITORY_ROOT,
  sha512Integrity,
} from "./release-lib.mjs"

const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org"
const MCP_REGISTRY_ORIGIN = "https://registry.modelcontextprotocol.io"
const EXPECTATIONS = new Set(["matching", "missing", "missing-or-matching"])

function parseArguments(args) {
  const options = {
    expectNpm: "missing-or-matching",
    expectPackage: "missing-or-matching",
    expectRegistry: "missing-or-matching",
    json: false,
    tarball: undefined,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--json") {
      options.json = true
      continue
    }
    const value = args[index + 1]
    invariant(value, `Option ${argument} requires a value`)
    index += 1
    if (argument === "--tarball") options.tarball = resolve(value)
    else if (argument === "--expect-package") options.expectPackage = value
    else if (argument === "--expect-npm") options.expectNpm = value
    else if (argument === "--expect-registry") options.expectRegistry = value
    else throw new Error(`Unknown option ${argument}`)
  }
  invariant(options.tarball, "--tarball is required")
  for (const [name, value] of [
    ["--expect-package", options.expectPackage],
    ["--expect-npm", options.expectNpm],
    ["--expect-registry", options.expectRegistry],
  ]) {
    invariant(EXPECTATIONS.has(value), `${name} has invalid expectation ${value}`)
  }
  return options
}

async function requestJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) return { state: "missing" }
  invariant(response.ok, `${url.origin} returned HTTP ${response.status}`)
  const contentType = response.headers.get("content-type") || ""
  invariant(contentType.includes("application/json"), `${url.origin} returned a non-JSON response`)
  return { state: "present", value: await response.json() }
}

function assertExpectation(actual, expected, label) {
  if (expected === "missing-or-matching") return
  invariant(actual === expected, `${label} is ${actual}, expected ${expected}`)
}

const options = parseArguments(process.argv.slice(2))
const packageJson = await readJson(`${REPOSITORY_ROOT}/package.json`)
const server = await readJson(`${REPOSITORY_ROOT}/server.json`)
const localIntegrity = sha512Integrity(await readFile(options.tarball))
const encodedPackage = encodeURIComponent(packageJson.name)
const packageResponse = await requestJson(new URL(`/${encodedPackage}`, NPM_REGISTRY_ORIGIN))
let packageState = "missing"
if (packageResponse.state === "present") {
  invariant(packageResponse.value?.name === packageJson.name, "npm returned a mismatched package name")
  const latestVersion = packageResponse.value?.["dist-tags"]?.latest
  invariant(typeof latestVersion === "string", "npm package does not have a latest version")
  const latestMetadata = packageResponse.value?.versions?.[latestVersion]
  invariant(latestMetadata?.mcpName === packageJson.mcpName, "npm package has a mismatched MCP identity")
  invariant(canonicalJson(latestMetadata?.repository) === canonicalJson(packageJson.repository), "npm package has a mismatched repository identity")
  packageState = "matching"
}
assertExpectation(packageState, options.expectPackage, "npm package")

const npmResponse = await requestJson(new URL(`/${encodedPackage}/${packageJson.version}`, NPM_REGISTRY_ORIGIN))
let npmState = "missing"
if (npmResponse.state === "present") {
  invariant(npmResponse.value?.name === packageJson.name, "npm returned a mismatched package name")
  invariant(npmResponse.value?.version === packageJson.version, "npm returned a mismatched package version")
  invariant(npmResponse.value?.mcpName === packageJson.mcpName, "npm version has a mismatched MCP identity")
  invariant(canonicalJson(npmResponse.value?.repository) === canonicalJson(packageJson.repository), "npm version has a mismatched repository identity")
  invariant(npmResponse.value?.dist?.integrity === localIntegrity, "published npm archive integrity does not match the local archive")
  npmState = "matching"
}
assertExpectation(npmState, options.expectNpm, "npm version")

const registryName = encodeURIComponent(server.name)
const registryResponse = await requestJson(
  new URL(`/v0.1/servers/${registryName}/versions/${server.version}`, MCP_REGISTRY_ORIGIN),
)
let registryState = "missing"
if (registryResponse.state === "present") {
  invariant(canonicalJson(registryResponse.value?.server) === canonicalJson(server), "MCP Registry metadata does not match server.json")
  registryState = "matching"
}
assertExpectation(registryState, options.expectRegistry, "MCP Registry version")

const result = {
  npmPackage: packageState,
  npmVersion: npmState,
  registryVersion: registryState,
}
process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : [
  `npm package: ${packageState}`,
  `npm version: ${npmState}`,
  `MCP Registry version: ${registryState}`,
].join("\n") + "\n")
