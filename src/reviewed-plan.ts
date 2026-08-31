import { createHmac, randomBytes } from "node:crypto"

import { ConfigurationError } from "./errors.js"
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

export function requireReviewedPlanDigest(
  value: unknown,
  reason = "A valid reviewed plan digest is required",
): string {
  if (typeof value !== "string" || !REVIEWED_PLAN_DIGEST_PATTERN.test(value)) {
    throw new ConfigurationError(reason)
  }
  return value
}

export function resolveSignedReviewedPlanDigest(
  requestState: unknown,
  explicitPlanDigest?: string,
): {
  matchesSignedState: boolean
  planDigest: string
} {
  if (
    typeof requestState !== "object"
    || requestState === null
    || !Object.hasOwn(requestState, "planDigest")
  ) {
    throw new ConfigurationError(
      "Signed confirmation state does not contain a valid reviewed plan digest",
    )
  }
  const signedPlanDigest = requireReviewedPlanDigest(
    (requestState as { planDigest?: unknown }).planDigest,
    "Signed confirmation state does not contain a valid reviewed plan digest",
  )
  const planDigest = explicitPlanDigest === undefined
    ? signedPlanDigest
    : requireReviewedPlanDigest(explicitPlanDigest)
  return {
    matchesSignedState: planDigest === signedPlanDigest,
    planDigest,
  }
}
