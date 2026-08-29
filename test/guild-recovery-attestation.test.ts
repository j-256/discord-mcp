import assert from "node:assert/strict"
import test from "node:test"

import {
  createGuildRecoveryAttestation,
  createGuildRecoveryAttestationKey,
  GUILD_RECOVERY_ATTESTATION_LIFETIME_MS,
  guildDeletionRecoveryRequestDigestView,
  guildRecoveryAttestationHash,
  guildRecoveryTargetStateDigest,
  noGuildRecoveryArtifactEvidence,
  normalizeGuildDeletionRecoveryRequest,
  type GuildRecoveryAttestationExpectedTarget,
  verifyGuildRecoveryAttestation,
} from "../src/guild-recovery-attestation.js"

const CAPTURED_AT = "2026-08-29T12:00:00.000Z"
const KEY = new Uint8Array(32).fill(7)
const TARGET = Object.freeze({
  applicationId: "100000000000000001",
  botId: "100000000000000002",
  guildId: "100000000000000003",
  resourceId: "100000000000000004",
  resourceType: "channel" as const,
  targetStateDigest: guildRecoveryTargetStateDigest({
    id: "100000000000000004",
    name: "general",
    type: 0,
  }),
})

function attested() {
  return createGuildRecoveryAttestation(KEY, {
    ...TARGET,
    blueprintKey: "channel-100000000000000004",
    captureDigest: guildRecoveryTargetStateDigest({ capture: "stable" }),
    capturedAt: CAPTURED_AT,
    omissionCodes: [
      "CHANNEL_PERMISSION_OVERWRITES_OMITTED",
      "CHANNEL_ORDER_OMITTED",
      "CHANNEL_ORDER_OMITTED",
    ],
  })
}

test("guild recovery attestations bind canonical target evidence and omissions", () => {
  const binding = attested()
  const evidence = verifyGuildRecoveryAttestation(
    KEY,
    binding.attestation,
    TARGET,
    new Date("2026-08-29T12:10:00.000Z"),
  )

  assert.equal(binding.expiresAt, "2026-08-29T12:30:00.000Z")
  assert.deepEqual(binding.omissionCodes, [
    "CHANNEL_ORDER_OMITTED",
    "CHANNEL_PERMISSION_OVERWRITES_OMITTED",
  ])
  assert.deepEqual(evidence, {
    capture: {
      blueprintKey: binding.blueprintKey,
      captureDigest: binding.captureDigest,
      capturedAt: CAPTURED_AT,
      expiresAt: binding.expiresAt,
      omissionCodes: binding.omissionCodes,
      targetStateDigest: TARGET.targetStateDigest,
    },
    limitations: {
      atomicSnapshot: false,
      automaticRollback: false,
      completeBackup: false,
      connectorPersistence: false,
      crossGuildPortable: false,
      losslessRestore: false,
      messageRecovery: false,
      originalIdRestoration: false,
    },
    mode: "verified-blueprint-capture",
    verified: true,
  })
  assert.ok(!JSON.stringify(evidence).includes(binding.attestation))
})

test("guild recovery attestations reject tampering, mismatches, stale targets, and expiry", () => {
  const binding = attested()
  const validTime = new Date("2026-08-29T12:10:00.000Z")
  const reject = (
    attestation: string,
    expected: GuildRecoveryAttestationExpectedTarget = TARGET,
    now = validTime,
  ) => assert.throws(
    () => verifyGuildRecoveryAttestation(KEY, attestation, expected, now),
    /invalid, expired, mismatched, or stale/u,
  )

  reject(`${binding.attestation.slice(0, -1)}${binding.attestation.endsWith("0") ? "1" : "0"}`)
  assert.throws(
    () => verifyGuildRecoveryAttestation(
      new Uint8Array(32).fill(8),
      binding.attestation,
      TARGET,
      validTime,
    ),
    /invalid, expired, mismatched, or stale/u,
  )
  reject(binding.attestation, { ...TARGET, applicationId: "100000000000000099" })
  reject(binding.attestation, { ...TARGET, botId: "100000000000000099" })
  reject(binding.attestation, { ...TARGET, guildId: "100000000000000099" })
  reject(binding.attestation, { ...TARGET, resourceId: "100000000000000099" })
  reject(binding.attestation, { ...TARGET, resourceType: "role" })
  reject(binding.attestation, {
    ...TARGET,
    targetStateDigest: guildRecoveryTargetStateDigest({ changed: true }),
  })
  reject(
    binding.attestation,
    TARGET,
    new Date(Date.parse(CAPTURED_AT) + GUILD_RECOVERY_ATTESTATION_LIFETIME_MS),
  )
  reject(
    binding.attestation,
    TARGET,
    new Date(Date.parse(CAPTURED_AT) - 1),
  )
})

test("guild deletion recovery choices are strict and digest raw attestations", () => {
  const binding = attested()
  const captured = normalizeGuildDeletionRecoveryRequest({
    acknowledgeCallerRetentionAndLimitations: true,
    attestation: binding.attestation,
    mode: "verified-blueprint-capture",
  })
  const none = normalizeGuildDeletionRecoveryRequest({
    acknowledgeNoRecoveryArtifact: true,
    mode: "none",
  })

  assert.deepEqual(guildDeletionRecoveryRequestDigestView(captured), {
    acknowledgeCallerRetentionAndLimitations: true,
    attestationHash: guildRecoveryAttestationHash(binding.attestation),
    mode: "verified-blueprint-capture",
  })
  assert.deepEqual(guildDeletionRecoveryRequestDigestView(none), {
    acknowledgeNoRecoveryArtifact: true,
    mode: "none",
  })
  assert.deepEqual(noGuildRecoveryArtifactEvidence(), {
    capture: null,
    limitations: {
      atomicSnapshot: false,
      automaticRollback: false,
      completeBackup: false,
      connectorPersistence: false,
      crossGuildPortable: false,
      losslessRestore: false,
      messageRecovery: false,
      originalIdRestoration: false,
    },
    mode: "none",
    verified: false,
  })
  assert.throws(
    () => normalizeGuildDeletionRecoveryRequest({ mode: "none" } as never),
    /exact acknowledgement/u,
  )
  assert.throws(
    () => normalizeGuildDeletionRecoveryRequest({
      acknowledgeNoRecoveryArtifact: true,
      extra: true,
      mode: "none",
    } as never),
    /exact acknowledgement/u,
  )
  assert.throws(
    () => normalizeGuildDeletionRecoveryRequest({
      acknowledgeCallerRetentionAndLimitations: true,
      attestation: "invalid",
      mode: "verified-blueprint-capture",
    }),
    /exact attestation/u,
  )
})

test("guild recovery attestation keys are independently generated and validated", () => {
  const first = createGuildRecoveryAttestationKey()
  const second = createGuildRecoveryAttestationKey()

  assert.equal(first.byteLength, 32)
  assert.equal(second.byteLength, 32)
  assert.notDeepEqual(first, second)
  assert.throws(
    () => createGuildRecoveryAttestation(new Uint8Array(31), {
      ...TARGET,
      blueprintKey: "channel-100000000000000004",
      captureDigest: guildRecoveryTargetStateDigest({ capture: "stable" }),
      capturedAt: CAPTURED_AT,
      omissionCodes: [],
    }),
    /key is invalid/u,
  )
})
