# Product boundaries and host compatibility

[Getting started](getting-started.md) | [Complete reference](reference.md) | [Project overview](../README.md) | [Support](../SUPPORT.md)

Discord MCP is designed for an operator-owned bot, a local stdio MCP host, exact least-privilege policy, transient Discord content, and review before consequential changes. This guide helps decide whether that model fits before a token is created, a host is configured, or a write capability is enabled.

The [complete reference](reference.md) remains authoritative for each tool's exact permissions, privacy projection, unsupported Discord states, planning evidence, and recovery behavior.

## Fit check

| Need | Fit | Product behavior |
| --- | --- | --- |
| Inspect or administer exact guilds through your own bot | Designed fit | The operator owns the Discord application, bot installation, token custody, policy, and effective Discord permissions |
| Start read-only and add narrowly reviewed capabilities | Designed fit | Presets establish bounded reads; additive recipes and explicit policy gates expose later workflows without granting Discord authority themselves |
| Keep Discord content out of connector-owned storage and telemetry | Designed fit | Content is projected transiently and excluded from activity, operation, coordination, diagnostic, and telemetry records |
| Use a local MCP host that can launch stdio and forward a secret reference | Designed fit | `host` emits a pinned model-neutral launch contract and optional private interactive field-mapping guide |
| Use read and planning tools in a host without interactive elicitation | Partial fit | Reads and plans remain usable, but reviewed writes cannot execute through that host |
| Use a third-party shared bot or hosted remote endpoint | Not provided | Each operator runs a local process with their own bot; the project operates no bot, relay, HTTP service, or account |
| Use a Discord user account or selfbot | Not supported | The connector accepts a Discord bot token and verifies the pinned application and bot identities |
| Mirror, archive, index, or train on Discord content | Not supported | The connector provides bounded transient reads, not a background content database or retrieval corpus |
| Target destructive work by display name or let the connector guess | Not supported | Consequential workflows use exact IDs and fail closed on incomplete or changed evidence |
| Run unattended destructive automation with retries or rollback | Not supported | Reviewed writes require interactive confirmation and stop on ambiguity; external effects are never guessed, blindly retried, or automatically reversed |
| Create a complete Discord backup or lossless restore point | Not supported | Blueprints and native Guild Templates are bounded authoring aids, not backups, and omit content and unsupported Discord state |

## Custody and privacy boundary

The operator creates and installs the Discord bot, chooses its Discord permissions, stores its token, selects exact local policy, and controls the MCP host. The connector does not create a shared service identity and does not receive operator credentials through a maintainer-operated service.

Standalone configuration and portable profiles store a credential reference, never the token value. The runtime still has to read that referenced secret to authenticate to Discord. Protect the secret at its source and in the host's process environment; the connector cannot make a token safe after it is copied into a host configuration, shell history, transcript, crash report, screenshot, or untrusted secret facility.

The connector's non-persistence claims cover connector-owned profiles, activity, operation and coordination state, generated evidence, diagnostics, and telemetry. They do not control retention by Discord, the MCP host, the model provider, the operating system, terminal capture, reverse proxies added by an operator, or other software on the machine. Tool inputs and transient results may contain Discord content when a selected capability requires it, so the host's transcript and data policy remain part of the trust boundary.

Discord permissions remain the outer authority boundary. Local policy can only narrow what the bot can do; it cannot grant a Discord permission, bypass channel overwrites or role hierarchy, or prove consent from a message recipient.

## MCP host compatibility

`host --npx --config FILE --html PRIVATE_FILE` validates one policy without reading its credential and produces the compatibility contract to translate into a host. Its optional mode-0600 interactive guide maps exact fields by meaning, supplies copy controls and a read-only verification request, and states its own limitations. The command intentionally does not contact Discord or the network, start a process, discover or edit a host, open a browser, or assume one product's schema. The private artifact contains Discord identifiers and may contain local paths, so it must not be shared or committed.

| Host capability | Requirement | Behavior when absent or incomplete |
| --- | --- | --- |
| Local process execution over stdio | Required | The connector exposes no Streamable HTTP or hosted transport |
| Node.js 22 or newer and the exact generated command and arguments | Required | Use `smoke --config FILE` to separate package or stdio failure from host translation failure |
| Forwarding the named environment secret or preserving access to a referenced private credential file | Required | Startup fails without falling back to another token or legacy policy source |
| MCP initialization, `tools/list`, and `tools/call` | Required | The operational server cannot negotiate or expose its typed tools |
| A host that can accept the complete tool catalog | Required for `tools.surface: full` | Use the progressive surface only when the host reliably refreshes tools after `notifications/tools/list_changed` |
| `notifications/tools/list_changed` refresh | Required for progressive discovery | Hidden canonical tools stay unavailable until the host refreshes; discovery never grants a tool omitted by policy |
| MCP resources and prompts | Optional | Equivalent canonical tools remain available; prompts never execute a write |
| MCP Apps support | Optional | Plan results still include complete text and structured JSON; the app adds display-only review and has no approval or execution authority |
| Interactive MCP elicitation | Required for reviewed writes | Execution returns a signed input request and performs no mutation unless the host returns the exact accepted response bound to that request |
| Write-aware host approval | Required operator control for writes | Tool annotations expose read, write, and destructive intent, but the connector cannot attest how a host renders or enforces its own approval interface |

Signed elicitation state detects a changed or orphaned confirmation round and binds the response to the reviewed request. It does not identify the human approver, certify the host's user interface, or replace the host's own write approval. A host without elicitation remains suitable for read-only and plan-only policy.

Progressive discovery is an ergonomics mode, not an authority mechanism. It reveals only canonical schemas already permitted by configured toolsets. Choose `full` when a host does not implement reliable list-change refresh, even if that means presenting a larger initial catalog.

## Discord and operational constraints

- Effective access is the intersection of Discord installation grants, bot-role hierarchy, guild and channel overwrites, privileged-intent state, connector policy, selected toolsets, and action-specific gates
- A bot cannot manage a member or role at or above its own highest role, and some Discord resources remain invisible without the exact permissions needed to prove a safe result
- Message Content, Guild Members, and other sensitive surfaces remain unavailable unless the relevant feature documents and verifies their separate requirement; setup does not enable privileged intents by default
- A current-bot username, avatar, or banner change affects every guild installation and direct conversation for that bot; Discord exposes post-upload media state but not enough evidence to prove remote image-byte equality
- Discord rate limits are dynamic and may include traffic outside this process. Connector diagnostics report only observed local evidence and never claim a complete IP-wide total
- Discord can change between planning, confirmation, mutation, and readback. Relevant drift invalidates a plan; a known post-write difference may complete with drift, while an ambiguous boundary is reported as uncertain
- Discord server errors, rate limits, timeouts, lost responses, malformed success evidence, and failed readback can make a write's external result unknowable. Once a one-shot operation is reserved, the connector does not retry it automatically
- Unknown future fields, unsupported channel or message types, incomplete inventories, hidden permission overwrites, and malformed Discord responses are rejected or projected out according to the exact workflow rather than guessed
- A successful exact workflow proves only that operation and readback. It does not establish future Discord availability, permission stability, recipient consent, or correctness of another capability

For an uncertain write, inspect the exact Discord target and audit evidence, retain the caller's original request and operation key, and use the workflow's documented verification or coordination-resolution path. Resolution releases a local quarantine only after operator review; it does not undo Discord state or make blind replay safe.

## Deliberately unsupported

| Shortcut or surface | Boundary | Supported direction |
| --- | --- | --- |
| Generic Discord REST dispatcher or raw request body | No broad escape hatch around typed schemas and policy | Use the narrow canonical tool whose evidence and privacy projection match the action |
| Fuzzy name, ordinal, or model-selected destructive targets | Names are untrusted presentation, not authority | Discover the resource, retain its exact ID, then plan the exact action |
| Immediate delete, moderation, administration, or structural mutation | A destructive annotation alone is not sufficient protection | Use the dedicated plan, digest, signed elicitation, final fresh check, one-shot record, and readback sequence |
| Blind retry, best-effort continuation, compensation, or automatic rollback after uncertainty | Discord may have accepted an operation whose response was lost | Stop, inspect exact state, and follow the workflow's recovery contract |
| Remote URL, arbitrary media fetch, or raw attachment forwarding | External fetches add credential, tracking, substitution, and content risks | Use only a separately enabled bounded local-file workflow where one exists |
| Connector-owned message archive, vector index, or Gateway content cache | Persistent content expands privacy and breach impact | Use bounded live reads and keep any caller-owned downstream retention outside the connector's claims |
| Shared bot, multi-tenant relay, public HTTP listener, or hosted control plane | Shared custody changes the threat and authorization model | Run one local stdio connector per operator-managed bot boundary |
| Environment-variable policy compatibility layer | Multiple ambient policy sources make effective authority harder to review | Use one strict non-secret configuration file or one managed profile; environment input is limited to the config selector and referenced secrets |
| Full server backup, cross-guild clone, or lossless restore | Discord APIs and privacy rules do not expose a complete reversible image | Use caller-retained blueprints or native Guild Templates only within their documented omissions |
| Automatic adoption of unknown Discord fields or object types | Silent interpretation can expand authority or leak data | Upgrade to a version that explicitly models and tests the new contract |

These are architectural boundaries, not a backlog promise. A future capability needs its own authority, privacy, failure, recovery, and verification design before it can become supported.

## What verification proves

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| `catalog --check --json` | The installed credential-free MCP contract is internally consistent and execution is guarded | Bot identity, Discord access, host configuration, or live tool behavior |
| `config validate FILE` | The non-secret policy matches the strict schema and local invariants | Credential validity, Discord permissions, or MCP negotiation |
| `doctor --config FILE` | Local runtime, policy, path, and credential-availability diagnostics without contacting Discord | Whether the token authenticates or the bot can access the intended guild |
| `doctor --config FILE --online` | Pinned application and bot identity, bounded guild membership, and application posture through documented read-only calls | Message visibility, every feature permission, a host launch, or any Discord write |
| `smoke --config FILE` | The selected packaged stdio entrypoint negotiates MCP, exposes the expected catalogs, starts configured optional runtimes, and completes its documented read-only identity path | Correct translation into a third-party host or every operational tool |
| `host --npx --config FILE --html PRIVATE_FILE` | One exact credential-free policy-to-stdio mapping, private guide bytes, and a read-only host verification request | Correct host-specific translation, credential availability, process startup, Discord access, or host approval behavior |
| Default automated tests and coverage | Deterministic contracts against injected transports, malformed evidence, policy boundaries, and failure cases without contacting Discord | Universal correctness against Discord's live service or every host implementation |
| Package and container verification | Reproducible contents, safe packaged startup, contract identity, and documented runtime constraints | Live Discord behavior or absence of software defects |
| Provenance, SBOMs, and attestations | Artifact origin, build inputs and process claims, component inventories, and digest bindings within their documented trust model | Security certification, vulnerability absence, license compliance, or completeness |
| A completed reviewed write with exact readback | The exact requested operation reached its workflow's terminal evidence state | Future stability, another workflow, or an unobserved side effect outside Discord's returned evidence |

The default suite is intentionally offline and uses injected transports. Treat a passing release as strong contract evidence, not as a claim that every Discord mutation has been exercised against every guild shape, host, permission layout, and API response. Test newly enabled authority in a private guild with the narrowest policy and inspect the first plan before execution.

See [provenance, SBOM, and attestation boundaries](reference.md#provenance-sbom-and-attestation-boundaries) for the precise supply-chain claims.

## Choose the next path

- If the fit and custody model work, complete the [first verified read](getting-started.md) before enabling writes
- If the host lacks dynamic tool refresh, use the full tool surface; if it lacks elicitation, keep the policy read-only or plan-only
- If a specific capability is needed, inspect its toolset, scope, permissions, gates, privacy projection, and recovery contract in the [complete reference](reference.md)
- If setup or negotiation fails, use the [recovery ladder](getting-started.md#recovery-ladder) and [support guide](../SUPPORT.md)
- If the question concerns secrets, stored evidence, or vulnerability reporting, read the [security policy](../SECURITY.md)
- If artifact identity matters, use the [release and independent verification runbook](releasing.md)
