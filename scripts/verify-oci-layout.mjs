import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  IMAGE_NAME,
  OCI_DESCRIPTION,
  REPOSITORY_URL,
  SBOM_GENERATOR_IMAGE,
  SUPPORTED_PLATFORMS,
  validateOciAttestationConfig,
  validateOciAttestationManifest,
  validateOciConfig,
  validateInTotoStatement,
  validateOciImageManifest,
  validateOciIndex,
} from "./oci-registry.mjs"
import {
  invariant,
  readJson,
  REPOSITORY_ROOT,
  run,
} from "./release-lib.mjs"

const EVIDENCE_FILENAME = "oci-index-evidence.json"
const EVIDENCE_FORMAT = "discord-mcp.oci-index-evidence.v1"
const EVIDENCE_BYTE_LIMIT = 16 * 1024 * 1024
const IMAGE_INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json"
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u

function parseArguments(args) {
  const options = {
    output: undefined,
    revision: "local",
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    const value = args[index + 1]
    invariant(value, `Option ${argument} requires a value`)
    index += 1
    if (argument === "--output") options.output = resolve(value)
    else if (argument === "--revision") options.revision = value
    else throw new Error(`Unknown option ${argument}`)
  }
  invariant(options.revision === "local" || /^[a-f0-9]{40}$/u.test(options.revision), "revision must be local or an exact Git commit")
  return options
}

async function sha256File(path) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return `sha256:${hash.digest("hex")}`
}

function descriptorPath(root, descriptor) {
  invariant(SHA256_DIGEST_PATTERN.test(descriptor?.digest), "OCI layout descriptor digest is invalid")
  invariant(Number.isSafeInteger(descriptor.size) && descriptor.size > 0, "OCI layout descriptor size is invalid")
  return join(root, "blobs", "sha256", descriptor.digest.slice("sha256:".length))
}

async function verifyBlob(root, descriptor, label, byteLimit) {
  const path = descriptorPath(root, descriptor)
  if (byteLimit !== undefined) {
    invariant(descriptor.size <= byteLimit, `${label} exceeds the size limit`)
  }
  const metadata = await stat(path)
  invariant(metadata.isFile() && metadata.size === descriptor.size, `${label} size does not match its descriptor`)
  invariant(await sha256File(path) === descriptor.digest, `${label} digest does not match its descriptor`)
  return path
}

async function readJsonBlob(root, descriptor, label, byteLimit) {
  const path = await verifyBlob(root, descriptor, label, byteLimit)
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    throw new Error(`${label} contains invalid JSON`)
  }
}

async function inspectLayout(root, expected) {
  const layoutMarker = await readJson(join(root, "oci-layout"))
  assert.deepEqual(layoutMarker, { imageLayoutVersion: "1.0.0" })
  const outerIndex = await readJson(join(root, "index.json"))
  invariant(outerIndex.schemaVersion === 2 && outerIndex.mediaType === IMAGE_INDEX_MEDIA_TYPE, "OCI layout root index is invalid")
  invariant(Array.isArray(outerIndex.manifests) && outerIndex.manifests.length === 1, "OCI layout must contain one release index")
  const releaseDescriptor = outerIndex.manifests[0]
  invariant(releaseDescriptor.mediaType === IMAGE_INDEX_MEDIA_TYPE, "OCI layout release descriptor is not an image index")
  const index = await readJsonBlob(root, releaseDescriptor, "OCI release index")
  const validatedIndex = validateOciIndex(index)
  const platforms = {}
  for (const descriptor of validatedIndex.platformDescriptors) {
    const platform = `${descriptor.platform.os}/${descriptor.platform.architecture}`
    const manifest = await readJsonBlob(root, descriptor, `OCI ${platform} manifest`)
    const validatedManifest = validateOciImageManifest(manifest, `OCI ${platform} manifest`)
    const config = await readJsonBlob(root, validatedManifest.configDescriptor, `OCI ${platform} configuration`)
    const labels = validateOciConfig(config, {
      architecture: descriptor.platform.architecture,
      layerCount: validatedManifest.layerDescriptors.length,
      revision: expected.revision,
      version: expected.version,
    })
    for (const layer of validatedManifest.layerDescriptors) {
      await verifyBlob(root, layer, `OCI ${platform} layer`)
    }
    platforms[platform] = {
      configDigest: validatedManifest.configDescriptor.digest,
      labels,
      layerCount: validatedManifest.layerDescriptors.length,
      manifestDigest: descriptor.digest,
    }
  }
  const buildkitEvidence = {}
  for (const descriptor of validatedIndex.attestationDescriptors) {
    const subjectDigest = descriptor.annotations["vnd.docker.reference.digest"]
    const manifest = await readJsonBlob(root, descriptor, "OCI attestation manifest")
    const validatedManifest = validateOciAttestationManifest(manifest)
    const attestationConfig = await readJsonBlob(
      root,
      validatedManifest.configDescriptor,
      "OCI attestation configuration",
    )
    validateOciAttestationConfig(attestationConfig, validatedManifest.layerDescriptors)
    for (const layer of validatedManifest.layerDescriptors) {
      const statement = await readJsonBlob(root, layer, "OCI attestation layer", EVIDENCE_BYTE_LIMIT)
      validateInTotoStatement(statement, layer.annotations["in-toto.io/predicate-type"])
    }
    buildkitEvidence[subjectDigest] = {
      attestationDigest: descriptor.digest,
      predicateTypes: validatedManifest.predicateTypes,
    }
  }
  assert.deepEqual(Object.keys(platforms).sort(), SUPPORTED_PLATFORMS)
  return {
    buildkitEvidence,
    evidenceFormat: EVIDENCE_FORMAT,
    image: `${IMAGE_NAME}:${expected.version}`,
    indexAnnotations: index.annotations,
    indexDigest: releaseDescriptor.digest,
    platforms,
    revision: expected.revision,
  }
}

async function writeEvidence(outputDirectory, evidence) {
  if (!outputDirectory) return
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, EVIDENCE_FILENAME), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" })
}

const options = parseArguments(process.argv.slice(2))
const packageJson = await readJson(join(REPOSITORY_ROOT, "package.json"))
const temporaryDirectory = await mkdtemp(join(tmpdir(), "discord-mcp-oci-layout-"))
const layout = join(temporaryDirectory, "layout")
try {
  await run(process.execPath, ["scripts/check-release-metadata.mjs"])
  await run("docker", ["info", "--format", "{{.ServerVersion}}"])
  await run("docker", [
    "buildx",
    "build",
    "--file",
    "Dockerfile",
    "--platform",
    SUPPORTED_PLATFORMS.join(","),
    "--provenance=mode=max",
    `--sbom=generator=${SBOM_GENERATOR_IMAGE}`,
    "--annotation",
    `index:org.opencontainers.image.description=${OCI_DESCRIPTION}`,
    "--annotation",
    `index:org.opencontainers.image.source=${REPOSITORY_URL}`,
    "--build-arg",
    `VERSION=${packageJson.version}`,
    "--build-arg",
    `REVISION=${options.revision}`,
    "--output",
    `type=oci,dest=${layout},tar=false`,
    ".",
  ])
  const evidence = await inspectLayout(layout, {
    revision: options.revision,
    version: packageJson.version,
  })
  await writeEvidence(options.output, evidence)
  process.stdout.write([
    `Verified OCI index ${evidence.indexDigest}`,
    `Platforms ${Object.keys(evidence.platforms).sort().join(", ")}`,
    `BuildKit evidence ${Object.keys(evidence.buildkitEvidence).length}/${Object.keys(evidence.platforms).length}`,
  ].join("\n") + "\n")
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
