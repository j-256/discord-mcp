# Safety and usability decision record

[Project overview](../README.md) | [Getting started](getting-started.md) | [Complete reference](reference.md) | [Fit and boundaries](limitations.md) | [Security requirements](../SECURITY.md)

GuildControl separates restrictions that create a real security boundary from ceremony that merely exposes internal machinery. This document records the risk analysis behind that separation. It covers configuration, discovery, reviewed writes, messages, threads, retries, scaffolds, host setup, and local policy files. The endpoint-specific requirements in the [complete reference](reference.md) and [security requirements](../SECURITY.md) remain authoritative.

## Decision method

Each decision considers five failure classes: selecting the wrong Discord principal or resource, widening authority beyond the operator's intent, exposing credentials or Discord content, repeating a mutation after an ambiguous response, and presenting incomplete evidence as proof. Usability cost is evaluated separately. A control is not retained merely because it is strict, and it is not removed merely because it is inconvenient.

The dispositions used below are:

- **Retained**: the operator still supplies or acknowledges the control because it carries information that the connector cannot safely infer
- **Internalized**: the control remains enforced, but the connector computes or coordinates it instead of requiring the operator to shuttle implementation data
- **Optional**: the operator chooses between bounded modes with different usability and residual-risk tradeoffs
- **Relaxed**: a narrower restriction was removed after stronger controls were found to cover its threat at lower usability cost

## Decision summary

| Decision | Disposition | Usability result | Boundary that remains |
| --- | --- | --- | --- |
| Bot-token and private capability custody | Retained | Secret values stay outside policy and MCP arguments | Fixed Discord origins, external secret references, private capability files, and redaction |
| Pinned application and bot identities | Retained | Setup discovers and records the bot ID once | Every live operation verifies both identities |
| Exact resource and principal IDs | Retained | Canonical links and typed mentions can be parsed locally | Names never select a write target or grant scope |
| Guild and channel read modes | Internalized and explicit | No empty-array sentinel is needed in authored policy | `allowlist` remains exact; `all-visible` is explicit and bounded by Discord plus guild policy |
| Reusable scope groups | Optional | Repeated IDs can be named once | Typed deterministic expansion produces the same bounded exact IDs before runtime |
| User notification policy | Optional | No list is needed when no notification is requested; occasional recipients can use signed review | Exact visible user IDs and suppression of role and mass-mention parsing remain |
| Workflow recipes and dependency assistance | Optional | Common outcomes add their fixed prerequisites together | Recipes are additive, require review before application, and never grant Discord permission |
| Interactive configuration and recipe application | Internalized | `config replace` and `recipe enable` remove digest copy and paste | Complete review, named confirmation, fresh recomputation, backup, and readback remain |
| Progressive tool discovery | Optional | A small initial surface routes ordinary outcome language | Discovery reveals only configured canonical tools and grants no authority |
| MCP plan-digest handling | Internalized | A reviewed execute call can begin without a caller-supplied digest | Fresh planning, signed state, host approval, final service re-plan, and detached digest mode remain |
| Stable operation keys | Retained | Schemas explain that a client may generate a UUID | Restart-safe intent identity, one-shot reservation, and recovery remain caller-retained |
| Parent-scoped thread conversations | Optional | Eligible active child threads do not need repeated policy edits | Fresh child-parent proof, membership, permissions, and message-only scope limits remain |
| Automatic retries for safe reads | Internalized | Transient GET failures can recover without another tool call | Bounded wait, cancellation, response validation, and final errors remain visible |
| Automatic retries for mutations | Retained prohibition | Ambiguous writes stop instead of creating duplicates | No non-GET retry, exact readback, spent keys, and quarantine remain |
| Human-readable names and impact summaries | Relaxed for presentation only | Operators can recognize targets and consequences more easily | Exact IDs remain authoritative and names are transient untrusted text |
| Scaffold continuation | Internalized guidance with retained frontier | The result says what to call next with the retained request | A new category still forces a fresh plan before any child can be created |
| MCP host detection | Optional | `host detect` and `onboard --detect-host` can reduce setup questions | Explicit opt-in, metadata-only inspection, single-candidate selection, and operator choice on ambiguity remain |
| Non-secret policy symlinks and hard links | Relaxed | Managed dotfiles and declarative systems can own the policy | Stable resolved target, regular-file type, ownership, mode, size, identity, and apply-time retarget checks remain |
| Permission, hierarchy, protected-target, acknowledgement, readback, and uncertainty gates | Retained | Evidence is presented more clearly, but no gate is collapsed | Each gate answers a different question and remains independently enforced |

## Credentials remain outside ergonomic shortcuts

**Threat.** A bot token, webhook credential, invite code, or similar bearer value can bypass every local policy decision if disclosed. Convenience that copies a credential into static host configuration, a policy document, a tool argument, or a report would enlarge both the exposure surface and the lifetime of the secret.

**Decision.** Credential custody is retained. Policy stores only an environment-variable name or a protected absolute file reference. Host activation carries the reference, not the value. Private bearer outputs use exclusive local files or opaque process-local references where the workflow defines them.

**Usability treatment.** Onboarding can reuse an already available protected environment or file source and explains the host-side handoff. It can detect plausible hosts only after explicit opt-in, but detection never reads credentials or candidate configuration content.

**Residual risk and recovery.** The launching environment and MCP host remain trusted with the token. If exposure is suspected, rotate the token or revoke the capability at its authoritative source, then update the external secret source. No connector setting can retract a copied bearer value.

## Exact IDs remain the authority language

**Threat.** Discord names can collide, change, contain deceptive Unicode, or be supplied as untrusted content. A name-based write can select a different user, channel, role, command, webhook, or message than the operator intended.

**Decision.** Exact Discord snowflakes remain required for scope and consequential targets. Exact command, webhook, message, and other typed IDs remain required where Discord defines them. Canonical Discord links and official typed mentions may be converted locally into exact IDs, but that conversion performs no lookup, proves no access, and grants no authority.

**Usability treatment.** Discovery and plan views may show a bounded name that was already fetched for the same decision. The display always accompanies the exact ID. Names help a person notice a mistake, but cannot populate an input, satisfy an allowlist, survive in a durable record, or affect plan freshness unless a workflow explicitly treats the text itself as the requested content.

**Residual risk and recovery.** A person can still copy the wrong exact ID. Review the ID and transient label together, use exact read tools before a high-impact change, and stop if Discord identity evidence is incomplete or contradictory.

## Read scope is explicit instead of encoded by an empty list

**Threat.** An empty list that secretly means "all visible" is easy to misread during review. Replacing it with an unqualified broad default would be worse because a small edit could expose every guild or channel visible to the bot.

**Decision.** `readScope.guildMode` and `readScope.channelMode` state `allowlist` or `all-visible` directly. `allowlist` requires at least one exact expanded ID. `all-visible` requires an empty authored list. Generated policies write both modes. Policies that omit them preserve their prior list-based meaning so loading an old policy does not silently change authority.

**Usability treatment.** The common `server-observer` shape can allow all channels visible to the bot inside one exact guild without listing every channel. Portable profiles still require a finite exact guild boundary. Review output names the mode rather than expecting an operator to infer it from a count.

**Residual risk and recovery.** `all-visible` follows Discord-side visibility, so a later role or overwrite change can widen what the bot sees without a policy edit. Use `allowlist` when Discord administrators and connector policy should be independent narrowing boundaries. Run online diagnostics after Discord permission changes.

## Typed scope groups reduce repetition without introducing aliases at runtime

**Threat.** Repeating the same IDs across read and feature scopes creates copy mistakes. A reusable group can solve that problem, but one group edit can also widen several consumers at once, and an untyped alias could place a user ID where a role or channel ID was expected.

**Decision.** `groups.guilds`, `groups.channels`, `groups.users`, and `groups.roles` are optional authoring aids. A compatible scope can contain an exact ID or an `@group-name` reference. Groups contain exact IDs only, do not nest, and expand deterministically before `ScopePolicy` is constructed. Unknown groups, cross-type references, duplicate IDs after expansion, and destination-limit overflow fail validation.

```json
{
  "groups": {
    "channels": {
      "support": ["123456789012345678", "234567890123456789"]
    },
    "users": {
      "on-call": ["345678901234567890"]
    }
  },
  "readScope": {
    "channelIds": ["@support"],
    "channelMode": "allowlist",
    "guildIds": ["456789012345678901"],
    "guildMode": "allowlist"
  },
  "scopes": {
    "interactionChannelIds": ["@support"],
    "mentionUserIds": ["@on-call"]
  }
}
```

**Usability treatment.** Review reports show authored group changes and the resulting expanded authority counts. Runtime policy, permissions, plans, and durable evidence continue to operate on exact IDs, not aliases.

**Residual risk and recovery.** Editing a widely referenced group intentionally changes every consumer. Inspect the complete configuration plan before applying it. For independent change control, split a group or replace a reference with literal exact IDs.

## User mentions are a policy choice, not a prerequisite for sending text

Discord message content and Discord notifications are separate effects. A message containing no requested notification does not need a user ID list. GuildControl sends an explicit `allowed_mentions` object so role mentions, `@everyone`, `@here`, and unintended parsed mentions stay suppressed.

### Why a strict user ID list still exists

**Threat.** A visible `<@user-id>` token can create an attention side effect for another person. Content can be copied from untrusted Discord text, generated from a mistaken target, or sent by unattended automation, turning a broad message write into spam, phishing, or accidental escalation. Names are not safe substitutes because they collide and change. Discord's parsing rules also make a raw text check insufficient unless the request constrains `allowed_mentions` explicitly.

**Benefit of `allowlist`.** `scopes.mentionUserIds` provides a durable, auditable ceiling for unattended or repetitive notification workflows. Each requested recipient must be an exact ID, must also appear visibly in the submitted content, must fit the bounded per-message recipient limit, and must remain eligible under the target workflow. Reply-author notification is a separate choice bound to the freshly observed exact author. Role and mass notifications remain unavailable.

**Limit of `allowlist`.** A configured ID does not prove consent, urgency, or that a notification is appropriate at a particular moment. Requiring a permanent policy edit for every occasional recipient adds friction without resolving those social questions.

### The three notification modes

- `notifications.userMentions: "disabled"` permits messages but no user notification. This is the generated-policy default unless a selected workflow deliberately chooses otherwise
- `notifications.userMentions: "allowlist"` permits direct notification only for exact IDs in `scopes.mentionUserIds`. This is the predictable choice for unattended automation and tightly controlled deployments
- `notifications.userMentions: "reviewed"` keeps allowlisted users on the direct path and allows an unlisted exact visible user only through a workflow that performs signed interactive mention review

The reviewed exception binds the exact target channel or thread, visible mention set, relevant reply identity, and a digest of the requested content to the confirmation round. Changed content, recipients, reply target, or destination invalidates the response. A path that does not implement signed mention review remains allowlist-only even when the policy mode is `reviewed`.

**Residual risk and recovery.** Signed review proves that the presented exact notification was accepted through the MCP round; it does not prove recipient consent or identify the human approver. Use `disabled` for no-notification environments, `allowlist` for automation, and `reviewed` for occasional human-supervised contact. After an unintended notification, edit or delete only through the relevant exact reviewed workflow if appropriate; Discord cannot retract attention already delivered.

## Recipes and interactive policy changes internalize dependency work

**Threat.** Hand-enabling one write capability without its audit capability, exact feature scope, toolset, permission requirement, or Gateway evidence can leave a confusing partial workflow. Automatically inferring write authority from a neighboring read would silently widen policy.

**Decision.** Named recipes add a closed, locally defined bundle of prerequisites and disclose capabilities, exact scope destinations, toolsets, Discord permissions, privileged intents, Gateway evidence, risks, warnings, and exclusions. They are additive only. They never infer exact targets, protected identities, local storage roots, privileged intent, destructive acknowledgement, or Discord permission from another field.

**Usability treatment.** `guildctl recipe enable NAME FILE ...` computes and prints the complete plan, asks for the recipe name, recomputes under the file lock, writes atomically, retains a backup, and verifies the result. `guildctl config replace ACTIVE CANDIDATE` provides the same integrated review for a complete policy candidate. JSON automation can use explicit current-plan acceptance plus the existing textual confirmation. Detached `plan` and digest-bound `apply` remain available for independent review systems.

**Residual risk and recovery.** A recipe can add meaningful authority across several policy fields, and the bot may already possess broader Discord permissions than the recipe requests. Review the complete delta and narrow the Discord role separately. Restore the retained backup through a new reviewed replacement rather than assuming policy rollback reverses a Discord mutation.

## Progressive discovery reduces catalog load but never authorizes a tool

**Threat.** A very large initial tool catalog burdens operators and models, but treating a hidden tool as a security boundary would be unsafe because discovery state is presentation, not authorization.

**Decision.** Generated policies use `tools.surface: "progressive"`. The always-visible discovery tool accepts ordinary outcome language and returns compact workflow guidance with impact, risk tier, policy requirements, Discord permissions, review requirements, companion tools, and a preferred next action. Revealing a match enables only the same canonical registration already allowed by `tools.toolsets` and emits the standard list-change notification.

**Usability treatment.** Reviewed workflows identify the execute tool as the normal entry point. Exact-name searches retain complete schemas, while ordinary outcome searches rank likely workflows and their audit, preview, plan, execute, or verify companions. Packaged documentation search remains available without a credential or Discord request.

**Residual risk and recovery.** Some hosts do not refresh tool lists reliably. Use `tools.surface: "full"` for those hosts. Full mode increases presentation size but does not widen policy or Discord authority.

## Reviewed execution starts with intent, not an internal digest

**Threat.** A plan digest binds an execution to fresh evidence, but requiring a caller to invoke a plan tool and copy the digest into the execute tool exposes internal plumbing. It also creates opportunities to paste the wrong digest without adding meaningful human judgment.

**Decision.** Every reviewed MCP execute tool accepts an optional `planDigest`. In the normal path, the caller sends the exact desired operation without it. The connector computes a fresh complete plan. A verified no-op returns without confirmation or mutation. A real change is displayed through MCP elicitation, and signed request state binds the unchanged request projection to the computed digest. After acceptance, the existing service performs its final fresh plan comparison and every endpoint-specific gate before writing.

```text
exact execute request without planDigest
  -> fresh complete plan
  -> signed interactive review and host write approval
  -> final service re-plan
  -> pending content-free evidence
  -> one non-retried mutation
  -> exact readback or quarantine
```

**Detached mode.** Standalone plan tools remain available. A caller may retain the returned digest and supply it explicitly to execute. The supplied digest must match the connector's fresh plan and the signed response state. This supports independent review, automation, and hosts that separate planning from execution. A host without elicitation can inspect plans but cannot gain an immediate mutation path.

**Controls retained.** Exact targets, operation keys, destructive acknowledgement literals, permissions, hierarchy, protected identities, capability and scope checks, write annotations, host approval, signed state, freshness, coordination, pending records, response validation, readback, and uncertainty handling remain unchanged.

**Residual risk and recovery.** The connector cannot attest who accepted the host UI or how prominently the host rendered it. Use a host with reliable write approval and elicitation. If request state is absent, changed, expired, mismatched, or replayed, execution fails closed and a new fresh review is required.

## Stable operation keys remain visible because they are recovery identities

**Threat.** Many Discord mutations have no server-side idempotency token. After a restart or lost response, an implicit process-local identifier cannot prove whether a retry is the same intent or a second operation.

**Decision.** Workflows that need one-shot reservation or restart-safe verification retain an `operationKey` or idempotency key. It is not a secret or a confirmation phrase. A client may generate a UUID automatically, but the caller must retain and reuse it only for the identical intent. Durable state stores only a domain-separated hash, never the raw key.

**Usability treatment.** Discovery and schemas describe the key as stable intent identity and explain when to reuse it. The connector derives subordinate keys for batches and blueprints where one caller-retained master key can safely identify the whole request.

**Residual risk and recovery.** Losing the key can remove a workflow's strongest restart-safe verification route. Reusing it for changed intent fails closed; inventing a new key after an uncertain result can duplicate the effect. Retain the original request and key privately until terminal verification or operator reconciliation.

## Parent thread inheritance is limited to conversation operations

**Threat.** Requiring every active thread ID in policy makes ordinary conversation awkward because threads are dynamic. Treating a parent channel as authority for every child action would silently expand administration, deletion, reaction, and permission scope.

**Decision.** `threads.reads` and `threads.messageWrites` each select `exact` or `inherit`. Read compatibility retains parent inheritance. Message-write inheritance is explicit, and message-oriented recipes can enable it for their exact parent channels. The connector fetches the exact child and parent, verifies their guild and relationship, checks supported active lifecycle state, proves private-thread membership when applicable, and evaluates effective permissions before each operation.

Inheritance is limited to the documented message-class reads and publications. Thread governance, membership changes, reactions, typing acknowledgement, deletion, channel metadata, permission overwrites, and other structural or destructive operations retain exact child scope.

**Residual risk and recovery.** Parent inheritance includes eligible child threads created after the policy was reviewed. Use `exact` plus explicit child IDs when future children must not become eligible. An archived, locked, unsupported, mismatched, inaccessible, or privately unjoined child fails closed rather than inheriting on name or listing position.

## Reads retry safely; mutations do not

**Threat.** A transient network failure or rate limit can make a read unnecessarily brittle. Retrying a mutation after a lost response can create duplicate messages, roles, channels, bans, or other effects.

**Decision.** The REST boundary derives replay safety from the HTTP method. Bounded GET requests can retry transport or response-body failures, trustworthy rate-limit delays, and selected transient gateway or service responses. Backoff is bounded by the configured wait ceiling, honors cancellation, increments only fixed observability counters, and still applies the original response-size and shape validation.

Every non-GET method defaults to no automatic retry even if an endpoint adapter omits a legacy opt-out flag. Existing mutation services still reserve once, write once, and classify a lost or malformed outcome as uncertain. A future exception would require a Discord-supported idempotency mechanism and an explicit service contract; no generic retry switch exists.

**Residual risk and recovery.** Repeated reads can observe different Discord states because the service is changing. The final accepted response must still satisfy ordering, identity, completeness, and freshness checks. For a write, inspect exact state and use its verify or coordination-recovery workflow; never translate a transport error into permission to resend.

## Human-readable evidence is presentation, not authority

**Threat.** A digest-first plan is hard for a person to evaluate, while a name-first plan can make mutable untrusted text look authoritative.

**Decision.** Discovery cards and plan review lead with plain-language impact, risk tier, exact targets, transient untrusted labels already available to the workflow, permission results, and the decision requested from the operator. Digests, hashes, coordination targets, and privacy evidence remain available as supporting proof.

Unknown evidence is handled by relevance. An unknown field that could change authority or cause a full replacement to discard state blocks the plan. An unknown field outside the decision projection can be discarded and represented by a bounded count or warning where the workflow permits it.

**Residual risk and recovery.** Presentation can be stale by the time approval is rendered. The final fresh plan check binds authoritative evidence, not the display name. Cancel when the exact ID and label do not agree with operator intent.

## Scaffold continuation stays restart-safe and frontier-based

**Threat.** A convenient loop that creates a category and its children from one stale snapshot cannot prove the new category ID, capacity, parent relationship, or permissions before creating the children. Best-effort continuation after an error can compound partial state.

**Decision.** Scaffolds remain additive-only and execute one freshly reviewed frontier at a time. A newly created category forces a verified pause and a fresh plan before child creation. Results expose a stable continuation status and preferred next call so the caller can retain the unchanged request and operation key without guessing what to do next.

**Residual risk and recovery.** Another Discord actor can change the guild between frontiers. Replanning is expected, not a failure. Stop on mismatch, uncertainty, or an unverified checkpoint. Scaffolds do not edit, move, assign, overwrite, delete, roll back, or skip failed steps.

## Host detection is explicit, metadata-only, and advisory

**Threat.** Searching home directories or reading host configuration without permission leaks local state. Picking one host merely because several markers exist can configure the wrong application. Marker presence also cannot prove that a host is installed, running, compatible, or intended.

**Decision.** `guildctl host detect` and `guildctl onboard --detect-host` are opt-in. Detection checks only the existence and expected file-or-directory type of documented host-owned markers. It reads no candidate configuration content or credential, contacts no network endpoint, and changes nothing. Onboarding selects the detected host only when exactly one plausible candidate is found. Zero or multiple candidates require an explicit choice, and an explicit `--host` always wins without invoking detection.

**Privacy and residual risk.** Human and JSON results can contain private local paths. A stale marker can produce a false positive and a fresh installation can produce no marker. Keep the report private and treat it as a setup hint. Static host changes still require the separate adapter-bound `host plan` and `host apply` workflow, exact confirmation, backup, atomic publication, and owned-projection verification.

## Non-secret policy links are relaxed; secret links are not

**Threat.** Symlink and hard-link rejection protects against target substitution, but it also breaks managed dotfiles, declarative configuration systems, and synchronized non-secret policy layouts. For a policy that contains no credential value, link count alone adds little protection once target ownership, mode, identity, and stability are enforced.

**Decision.** An explicitly selected policy may be a stable symlink to one bounded regular target and may have additional hard links. Loading resolves the target, verifies process-user or root ownership, rejects group or world write access, bounds the file, and confirms stable canonical target, inode, metadata, and bytes around the read. Reviewed replacement binds the resolved target and refuses link retargeting between plan and application.

Credential files retain their stricter final-target, ownership, privacy, stability, and single-link rules. This relaxation never applies to bot tokens, webhook credentials, invite files, operation state, activity records, host configuration, or other private capability-bearing files.

**Residual risk and recovery.** Another trusted writer to the same inode can change a non-secret policy and cause a later load or plan to fail or reflect the new policy. Use the reviewed configuration workflow, inspect the resolved target in configuration reports, and keep write access restricted to trusted local principals.

## Independent write gates remain independent

Several controls look repetitive because they answer different questions:

| Gate | Question it answers |
| --- | --- |
| Capability and toolset | Did local policy intentionally expose this workflow? |
| Exact feature scope | Is this guild, channel, role, user, message, command, or other target eligible? |
| Pinned identity | Is the credential still for the reviewed application and bot? |
| Discord permission and hierarchy | Can this bot perform this action against this target under live Discord rules? |
| Protected-target policy | Is the target excluded even when Discord would permit the action? |
| Strong acknowledgement | Did the caller explicitly accept an irreversible, application-wide, non-exact, or persistent consequence? |
| Fresh plan and signed review | Is the approved request bound to complete relevant evidence? |
| Host write approval | Did the MCP host expose the call as a write to its operator? |
| Operation-key reservation and coordination | Is this one intent, and is overlapping work excluded across processes? |
| Pending content-free record | Is there durable evidence before external mutation begins? |
| Non-retried mutation | Can an ambiguous response avoid duplicate effects? |
| Exact response and readback | Did Discord return and retain the reviewed state? |
| Uncertainty quarantine | Does unresolved work block a conflicting follow-up? |

Collapsing one gate because another exists would create a confused-deputy path. The ergonomic changes shorten the route to these checks and improve their presentation; they do not treat a host prompt, a Discord permission, a tool annotation, or a plan digest as a substitute for the others.

## Choosing modes by operating environment

For a human-supervised local setup, use progressive discovery, integrated configuration or recipe review, execute-first MCP review, and `reviewed` mentions only where occasional notifications are expected. Use parent-thread inheritance only for the exact message workflows that should follow active conversations.

For unattended automation, prefer explicit exact read allowlists, full or progressive discovery according to host support, detached plan and digest-bound execution where an independent review system exists, `allowlist` or `disabled` mentions, exact thread scope, and caller-retained operation keys.

For high-control administration, retain exact scopes even when `all-visible` or inheritance would be convenient, keep protected-user and role lists separate from reusable groups where independent review matters, and verify every uncertain operation before forming a new intent.

No mode changes Discord permissions. Narrow the bot role and channel overwrites independently, start with read-only policy, add one recipe at a time, and inspect the first live plan for each newly enabled authority.
