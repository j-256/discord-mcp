import { createHmac, randomBytes } from "node:crypto"

import { stableString } from "./normalize.js"

export const REVIEWED_PLAN_DIGEST_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/

const REVIEWED_PLAN_DIGEST_PREFIX = "hmac-sha256:"

export function createReviewedPlanKey(): Uint8Array {
  return randomBytes(32)
}

export function reviewedPlanDigest(
  key: Uint8Array,
  payload: unknown,
): string {
  const digest = createHmac("sha256", key)
    .update(stableString(payload))
    .digest("hex")
  return `${REVIEWED_PLAN_DIGEST_PREFIX}${digest}`
}
