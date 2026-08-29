import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

import {
  CONNECTOR_LIMITS,
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
  GUILD_SCAFFOLD_SYMBOL_PATTERN,
} from "./constants.js"
import { stableString } from "./normalize.js"

const ATTESTATION_DOMAIN = "discord-mcp-guild-recovery-attestation.v1\0"
const ATTESTATION_PREFIX = "guild-recovery.v1."
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/
const ENCODED_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/
const OMISSION_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/
const ATTESTATION_KEY_BYTES = 32
export const GUILD_RECOVERY_ATTESTATION_MAX_CHARACTERS = 4_096
export const GUILD_RECOVERY_ATTESTATION_PATTERN = /^guild-recovery\.v1\.[A-Za-z0-9_-]+\.[a-f0-9]{64}$/
const MAX_ATTESTATION_PAYLOAD_BYTES = 2_048
const MAX_OMISSION_CODES = 64
const MAX_OMISSION_CODE_CHARACTERS = 128
const NO_RECOVERY_ARTIFACT_WARNING = "No recovery artifact is attested for this deletion; the connector cannot restore Discord content or the original resource identity"
const VERIFIED_RECOVERY_LIMITATION_WARNING = "Verified recovery evidence covers a caller-retained, lossy guild blueprint projection; the connector does not persist it or provide automatic rollback, message recovery, or original ID restoration"

export const GUILD_RECOVERY_ATTESTATION_LIFETIME_MS = 30 * 60 * 1_000

export type GuildRecoveryResourceType = "channel" | "role"

export interface GuildRecoveryAttestationPayload {
  applicationId: string
  blueprintKey: string
  botId: string
  captureDigest: string
  capturedAt: string
  expiresAt: string
  guildId: string
  omissionCodes: string[]
  resourceId: string
  resourceType: GuildRecoveryResourceType
  targetStateDigest: string
  version: 1
}

export interface GuildRecoveryAttestedBinding
  extends GuildRecoveryAttestationPayload {
  attestation: string
}

export type GuildDeletionRecoveryRequest =
  | {
      acknowledgeCallerRetentionAndLimitations: true
      attestation: string
      mode: "verified-blueprint-capture"
    }
  | {
      acknowledgeNoRecoveryArtifact: true
      mode: "none"
    }

export type NormalizedGuildDeletionRecoveryRequest =
  | {
      acknowledgeCallerRetentionAndLimitations: true
      attestation: string
      attestationHash: string
      mode: "verified-blueprint-capture"
    }
  | {
      acknowledgeNoRecoveryArtifact: true
      mode: "none"
    }

export interface GuildRecoveryLimitations {
  atomicSnapshot: false
  automaticRollback: false
  completeBackup: false
  connectorPersistence: false
  crossGuildPortable: false
  losslessRestore: false
  messageRecovery: false
  originalIdRestoration: false
}

export type GuildDeletionRecoveryEvidence =
  | {
      capture: null
      limitations: GuildRecoveryLimitations
      mode: "none"
      verified: false
    }
  | {
      capture: Omit<GuildRecoveryAttestationPayload, "applicationId" | "botId" | "guildId" | "resourceId" | "resourceType" | "version">
      limitations: GuildRecoveryLimitations
      mode: "verified-blueprint-capture"
      verified: true
    }

export interface GuildRecoveryAttestationExpectedTarget {
  applicationId: string
  botId: string
  guildId: string
  resourceId: string
  resourceType: GuildRecoveryResourceType
  targetStateDigest: string
}

const GUILD_RECOVERY_LIMITATIONS: GuildRecoveryLimitations = Object.freeze({
  atomicSnapshot: false,
  automaticRollback: false,
  completeBackup: false,
  connectorPersistence: false,
  crossGuildPortable: false,
  losslessRestore: false,
  messageRecovery: false,
  originalIdRestoration: false,
})

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const observed = Object.keys(value).sort()
  return observed.length === keys.length
    && observed.every((key, index) => key === keys[index])
}

function positiveSnowflake(value: unknown): value is string {
  if (typeof value !== "string" || !DISCORD_SNOWFLAKE_PATTERN.test(value)) return false
  const parsed = BigInt(value)
  return parsed >= 1n && parsed <= DISCORD_SNOWFLAKE_MAX
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function exactOmissionCodes(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_OMISSION_CODES) return false
  if (value.some((code) => (
    typeof code !== "string"
    || code.length < 1
    || code.length > MAX_OMISSION_CODE_CHARACTERS
    || !OMISSION_CODE_PATTERN.test(code)
  ))) return false
  return value.every((code, index) => index === 0 || value[index - 1] < code)
}

function exactPayload(value: unknown): GuildRecoveryAttestationPayload | undefined {
  const record = recordValue(value)
  if (
    !record
    || !hasOnlyKeys(record, [
      "applicationId",
      "blueprintKey",
      "botId",
      "captureDigest",
      "capturedAt",
      "expiresAt",
      "guildId",
      "omissionCodes",
      "resourceId",
      "resourceType",
      "targetStateDigest",
      "version",
    ])
    || record.version !== 1
    || !positiveSnowflake(record.applicationId)
    || !positiveSnowflake(record.botId)
    || !positiveSnowflake(record.guildId)
    || !positiveSnowflake(record.resourceId)
    || (record.resourceType !== "channel" && record.resourceType !== "role")
    || typeof record.blueprintKey !== "string"
    || record.blueprintKey.length < 1
    || record.blueprintKey.length > CONNECTOR_LIMITS.scaffoldSymbolCharacters
    || !GUILD_SCAFFOLD_SYMBOL_PATTERN.test(record.blueprintKey)
    || typeof record.captureDigest !== "string"
    || !SHA256_PATTERN.test(record.captureDigest)
    || typeof record.targetStateDigest !== "string"
    || !SHA256_PATTERN.test(record.targetStateDigest)
    || !canonicalTimestamp(record.capturedAt)
    || !canonicalTimestamp(record.expiresAt)
    || !exactOmissionCodes(record.omissionCodes)
  ) return undefined
  const capturedAt = Date.parse(record.capturedAt)
  const expiresAt = Date.parse(record.expiresAt)
  if (expiresAt - capturedAt !== GUILD_RECOVERY_ATTESTATION_LIFETIME_MS) {
    return undefined
  }
  return record as unknown as GuildRecoveryAttestationPayload
}

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.byteLength !== ATTESTATION_KEY_BYTES) {
    throw new RangeError("Discord guild recovery attestation key is invalid")
  }
}

function signature(key: Uint8Array, encodedPayload: string): string {
  return createHmac("sha256", key)
    .update(ATTESTATION_DOMAIN)
    .update(encodedPayload)
    .digest("hex")
}

function invalidAttestation(): never {
  throw new RangeError(
    "Discord guild recovery attestation is invalid, expired, mismatched, or stale",
  )
}

export function createGuildRecoveryAttestationKey(): Uint8Array {
  return randomBytes(ATTESTATION_KEY_BYTES)
}

export function guildRecoveryTargetStateDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableString(value)).digest("hex")}`
}

export function guildRecoveryAttestationHash(attestation: string): string {
  return `sha256:${createHash("sha256").update(attestation, "utf8").digest("hex")}`
}

export function normalizeGuildDeletionRecoveryRequest(
  value: GuildDeletionRecoveryRequest,
): NormalizedGuildDeletionRecoveryRequest {
  const record = recordValue(value)
  if (!record || typeof record.mode !== "string") {
    throw new RangeError("Discord deletion recovery choice must be an exact object")
  }
  if (record.mode === "none") {
    if (
      !hasOnlyKeys(record, ["acknowledgeNoRecoveryArtifact", "mode"])
      || record.acknowledgeNoRecoveryArtifact !== true
    ) {
      throw new RangeError(
        "Discord deletion without a recovery artifact requires exact acknowledgement",
      )
    }
    return {
      acknowledgeNoRecoveryArtifact: true,
      mode: "none",
    }
  }
  if (
    record.mode !== "verified-blueprint-capture"
    || !hasOnlyKeys(record, [
      "acknowledgeCallerRetentionAndLimitations",
      "attestation",
      "mode",
    ])
    || record.acknowledgeCallerRetentionAndLimitations !== true
    || typeof record.attestation !== "string"
    || record.attestation.length < ATTESTATION_PREFIX.length + 66
    || record.attestation.length > GUILD_RECOVERY_ATTESTATION_MAX_CHARACTERS
    || !GUILD_RECOVERY_ATTESTATION_PATTERN.test(record.attestation)
  ) {
    throw new RangeError(
      "Discord deletion recovery capture requires an exact attestation and acknowledgement",
    )
  }
  return {
    acknowledgeCallerRetentionAndLimitations: true,
    attestation: record.attestation,
    attestationHash: guildRecoveryAttestationHash(record.attestation),
    mode: "verified-blueprint-capture",
  }
}

export function guildDeletionRecoveryRequestDigestView(
  value: NormalizedGuildDeletionRecoveryRequest,
): unknown {
  return value.mode === "none"
    ? {
        acknowledgeNoRecoveryArtifact: true,
        mode: value.mode,
      }
    : {
        acknowledgeCallerRetentionAndLimitations: true,
        attestationHash: value.attestationHash,
        mode: value.mode,
      }
}

export function createGuildRecoveryAttestation(
  key: Uint8Array,
  input: Omit<GuildRecoveryAttestationPayload, "expiresAt" | "version">,
): GuildRecoveryAttestedBinding {
  assertKey(key)
  const capturedAt = Date.parse(input.capturedAt)
  if (!Number.isFinite(capturedAt)) {
    throw new RangeError("Discord guild recovery capture timestamp is invalid")
  }
  const payload = exactPayload({
    ...input,
    expiresAt: new Date(
      capturedAt + GUILD_RECOVERY_ATTESTATION_LIFETIME_MS,
    ).toISOString(),
    omissionCodes: [...new Set(input.omissionCodes)].sort(),
    version: 1,
  })
  if (!payload) {
    throw new RangeError("Discord guild recovery attestation payload is invalid")
  }
  const encoded = Buffer.from(stableString(payload), "utf8").toString("base64url")
  const attestation = `${ATTESTATION_PREFIX}${encoded}.${signature(key, encoded)}`
  if (attestation.length > GUILD_RECOVERY_ATTESTATION_MAX_CHARACTERS) {
    throw new RangeError("Discord guild recovery attestation exceeded its safety bound")
  }
  return { ...payload, attestation }
}

export function verifyGuildRecoveryAttestation(
  key: Uint8Array,
  attestation: string,
  expected: GuildRecoveryAttestationExpectedTarget,
  now: Date,
): GuildDeletionRecoveryEvidence {
  assertKey(key)
  if (
    typeof attestation !== "string"
    || attestation.length > GUILD_RECOVERY_ATTESTATION_MAX_CHARACTERS
    || !attestation.startsWith(ATTESTATION_PREFIX)
  ) return invalidAttestation()
  const separator = attestation.lastIndexOf(".")
  if (separator <= ATTESTATION_PREFIX.length) return invalidAttestation()
  const encoded = attestation.slice(ATTESTATION_PREFIX.length, separator)
  const suppliedSignature = attestation.slice(separator + 1)
  if (
    !ENCODED_PAYLOAD_PATTERN.test(encoded)
    || !SIGNATURE_PATTERN.test(suppliedSignature)
  ) return invalidAttestation()
  const expectedSignature = signature(key, encoded)
  const suppliedBytes = Buffer.from(suppliedSignature, "hex")
  const expectedBytes = Buffer.from(expectedSignature, "hex")
  if (
    suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)
  ) return invalidAttestation()
  let decoded: Buffer
  let value: unknown
  try {
    decoded = Buffer.from(encoded, "base64url")
    if (
      decoded.byteLength > MAX_ATTESTATION_PAYLOAD_BYTES
      || decoded.toString("base64url") !== encoded
    ) return invalidAttestation()
    value = JSON.parse(decoded.toString("utf8")) as unknown
  } catch {
    return invalidAttestation()
  }
  const payload = exactPayload(value)
  if (
    !payload
    || stableString(payload) !== decoded.toString("utf8")
    || payload.applicationId !== expected.applicationId
    || payload.botId !== expected.botId
    || payload.guildId !== expected.guildId
    || payload.resourceId !== expected.resourceId
    || payload.resourceType !== expected.resourceType
    || payload.targetStateDigest !== expected.targetStateDigest
  ) return invalidAttestation()
  const nowMs = now.getTime()
  const capturedAt = Date.parse(payload.capturedAt)
  const expiresAt = Date.parse(payload.expiresAt)
  if (
    !Number.isFinite(nowMs)
    || nowMs < capturedAt
    || nowMs >= expiresAt
  ) return invalidAttestation()
  return {
    capture: {
      blueprintKey: payload.blueprintKey,
      captureDigest: payload.captureDigest,
      capturedAt: payload.capturedAt,
      expiresAt: payload.expiresAt,
      omissionCodes: [...payload.omissionCodes],
      targetStateDigest: payload.targetStateDigest,
    },
    limitations: GUILD_RECOVERY_LIMITATIONS,
    mode: "verified-blueprint-capture",
    verified: true,
  }
}

export function noGuildRecoveryArtifactEvidence(): GuildDeletionRecoveryEvidence {
  return {
    capture: null,
    limitations: GUILD_RECOVERY_LIMITATIONS,
    mode: "none",
    verified: false,
  }
}

export function guildDeletionRecoveryWarnings(
  evidence: GuildDeletionRecoveryEvidence,
): string[] {
  if (evidence.mode === "none") return [NO_RECOVERY_ARTIFACT_WARNING]
  return [
    VERIFIED_RECOVERY_LIMITATION_WARNING,
    ...(evidence.capture.omissionCodes.length > 0
      ? [`Verified recovery capture reports omissions: ${evidence.capture.omissionCodes.join(", ")}`]
      : []),
  ]
}
