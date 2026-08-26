## Summary

Describe one logical change and the operator outcome it improves.

## Authority and privacy impact

Identify every affected toolset, capability, exact scope, Discord permission, privileged intent, local path, secret reference, returned Discord value, and persistent field. State `None` for an unaffected category.

## Failure and recovery impact

Describe freshness, concurrency, retry, readback, restart, and uncertain-outcome behavior for every changed write or asynchronous workflow. State `Read-only` when no write can occur.

## Verification

List the offline commands run and any explicit privacy-safe live probe. Do not paste raw logs, configurations, Discord payloads, content, identifiers, or credentials.

## Checklist

- [ ] The change uses exact IDs and the narrowest policy and Discord authority
- [ ] No bot token, bearer credential, Discord content, private identifier, machine-local path, or raw live output is included
- [ ] Fixed production Discord origins, content non-persistence, and secret redaction remain intact
- [ ] Every write retains planning, host approval, signed confirmation, freshness, durable evidence, non-retry, exact readback, and quarantine where applicable
- [ ] Tests cover success, refusal, drift, malformed evidence, ambiguity, restart, and privacy boundaries in proportion to risk
- [ ] Public documentation, generated schemas, MCP guidance, and release metadata are updated where applicable
- [ ] Dependencies and external actions remain minimal, exactly pinned, and justified
