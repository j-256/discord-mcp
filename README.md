# Discord MCP

<img src="https://raw.githubusercontent.com/j-256/discord-mcp/v0.1.0/assets/discord-mcp-icon.png" alt="Discord MCP shield and reviewed connection icon" width="128">

Discord MCP is a local stdio Model Context Protocol server for safe Discord guild and separately allowlisted one-to-one access through an operator-owned bot. It combines broad typed coverage with exact scope, privacy-minimized results, reviewed writes, content-free evidence, and explicit ambiguity handling.

**Least privilege. Review before mutation. Verifiable outcomes. No Discord-content persistence.**

[Quick start](#quick-start) | [Capability map](#capability-map) | [Safety model](#safety-model) | [Trust and verification](#trust-and-verification) | [Complete reference](docs/reference.md) | [Security](SECURITY.md)

## Why this connector

| Concern | Enforced behavior |
| --- | --- |
| Discord reach | One strict non-secret policy file with verified application and bot identities, exact guild and channel scope, a separate exact-user private-message scope, risk-separated toolsets, and read-only setup presets |
| Exact targeting | Canonical Discord jump links and official typed mentions convert locally into exact IDs without name lookup, Discord contact, input echo, persistence, or downstream authority |
| Read safety | Bounded requests, lossless whole-result byte budgets, strict response validation, privacy-tiered projections, untrusted-content handling, and no private-channel discovery or scope inheritance |
| Write safety | Exact-ID requests, keyed fresh plans, signed interactive approval, a final fresh-plan match, and action-specific Discord permission proof |
| Outcome integrity | Pending content-free evidence, non-retried writes, exact readback, durable coordination, ambiguity quarantine, and bounded local invalid-request pressure |
| Privacy | Tokens stay in a caller-owned secret source; Discord content, profiles, URLs, audit reasons, and raw operation keys are not persisted |
| Plan review | Every plan tool returns complete text and structured evidence and can add display-only, authority-free review in MCP Apps hosts |
| Release integrity | Exact dependency and base-image pins, credential-free contract fingerprints, reproducible package and hardened OCI checks, an SPDX SBOM, and signed-release automation |

The [complete reference](docs/reference.md) documents every tool family, policy gate, permission boundary, privacy tier, resource, prompt, Gateway mode, operator command, and known limitation.

## Quick start

Requirements:

- Node.js 22 or newer
- A Discord application with a bot user
- One strict non-secret JSON policy file
- The bot token available through an environment variable or protected file
- Only the Discord permissions needed for the selected read or reviewed-write scope

Each deployment uses a Discord application and bot controlled by that operator. Discord MCP does not provide a shared bot, hosted relay, or shared token: create your own application, invite its bot only to guilds you control, and keep its credential in the local launcher or secret store.

Do not grant the bot `Administrator`. Generate the exact initial permission grant from a read-only preset, then narrow the installed bot role with category or channel overrides. The [bot setup guide](docs/reference.md#discord-bot-setup) explains bot ownership, optional intents, and later feature-specific permissions.

### Inspect before connecting

For an exact published version, inspect the real production contract and the recommended read-only preset without a token or Discord request:

```sh
npx --yes @j-256/discord-mcp@0.1.0 catalog --check
npx --yes @j-256/discord-mcp@0.1.0 catalog --html ./discord-mcp-contract.html
npx --yes @j-256/discord-mcp@0.1.0 preset show server-observer
```

`catalog --check` launches a credential-free, execution-disabled MCP server, negotiates its real tools, prompts, resources, templates, completion capability, and optional plan-review MCP App, verifies every policy-completion route with zero returned identifiers, fingerprints the app's exact HTML and authority boundary, and verifies that every tool call is blocked by the catalog-only guard.

`catalog --html FILE` writes a deterministic standalone explorer for that same negotiated contract. Open it locally to search and filter every tool, inspect exact input and output schemas, review prompts, resources, policy-completion routes, and the complete plan-review app source, and compare the embedded contract, safety, and app digests. The export contains no credential or identifier completion value, uses no external asset, makes no network request, and refuses to replace an existing file.

The exact release image exposes the same safe catalog without a token and defaults to catalog mode instead of operational service:

```sh
docker run --rm -i \
  --network=none \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  --pids-limit=64 \
  ghcr.io/j-256/discord-mcp:0.1.0 catalog --check
```

### Install your owner-managed bot

Create a Discord application and bot in the [Developer Portal](https://discord.com/developers/applications), copy the public Application ID and target Server ID, and generate a callback-free install link whose guild and least-privilege permission grant come from the recommended preset:

```sh
npx --yes @j-256/discord-mcp@0.1.0 preset install server-observer \
  --application-id YOUR_APPLICATION_ID \
  --guild-id YOUR_GUILD_ID \
  --html ./discord-mcp-onboarding.html
```

Open the printed URL while signed in as a member allowed to manage that server. It requests only `View Channel` for `server-observer`, locks the server selector to the supplied ID, requests no user token, and never sends the bot token to the connector command. Keep Public Bot disabled unless other people should be able to install your application. Use `channel-reader` instead to request `View Channel` plus `Read Message History`; its plan also identifies Message Content as the recommended Developer Portal intent.

The optional `--html FILE` output is a deterministic standalone guide derived from that exact validated installation plan. It provides an in-memory checklist, non-secret copy controls, the explicit Discord install navigation, strict-policy commands, and exact plan evidence without accepting a token, loading an external asset, making a background request, persisting browser state, opening a browser, or replacing an existing file. The terminal plan remains complete when HTML is not wanted.

### Create the safest first configuration

Keep the token in a secret-capable launching environment, verify one exact guild, save the complete non-secret policy in one file, and test the full MCP path:

```sh
export DISCORD_BOT_TOKEN="YOUR_DISCORD_BOT_TOKEN"
npx --yes @j-256/discord-mcp@0.1.0 setup \
  --config ./discord-mcp.json \
  --preset server-observer \
  --guild-id YOUR_GUILD_ID
npx --yes @j-256/discord-mcp@0.1.0 config validate ./discord-mcp.json
npx --yes @j-256/discord-mcp@0.1.0 doctor --config ./discord-mcp.json --online
npx --yes @j-256/discord-mcp@0.1.0 smoke --config ./discord-mcp.json
```

On PowerShell, set the token in the current process before running the same commands:

```powershell
$env:DISCORD_BOT_TOKEN = "YOUR_DISCORD_BOT_TOKEN"
```

If the launcher, container runtime, or orchestrator mounts the token as a file, select that input instead. The path must be absolute, the file must already exist for verified setup, and `--token-file` cannot be combined with `--token-env` or an ambient `DISCORD_BOT_TOKEN`:

```sh
npx --yes @j-256/discord-mcp@0.1.0 setup \
  --config ./discord-mcp.json \
  --preset server-observer \
  --guild-id YOUR_GUILD_ID \
  --token-file /run/secrets/discord_bot_token
```

The `server-observer` preset exposes guild metadata, roles, permission diagnostics, connector health, content-free activity, and tool discovery. It cannot enable writes, the Gateway, telemetry export, activity persistence, or Message Content access. Setup stores the credential reference and verified public IDs, never the token value, and prints a portable stdio launch descriptor for a compatible MCP client. `route_discord_goal` gives every prompt-capable client one safe entry point: standard catalog discovery, bounded reads, and at most a reviewed plan for a write, never a mutation.

The versioned file is the only policy boundary. It covers identity, read scope, tools, capabilities, feature scopes, limits, local storage paths, Gateway behavior, runtime settings, and privacy-safe observability. A typical deployment has two inputs: one JSON policy file and one external bot-token secret. The bot token may be referenced through an environment variable or a strictly validated file; optional authenticated-collector headers remain environment references. The checked-in [JSON Schema](discord-mcp.config.schema.json) supports editor validation, while `config show` and `config explain` provide secret-free inspection. Managed profiles use the same document when private per-user storage is preferable.

`limits.mcpReadResponseMaxBytes` bounds one complete redacted MCP application read result by compact UTF-8 JSON bytes. It defaults to 1 MiB and accepts 64 KiB through 8 MiB. An oversized tool read returns a fixed content-free `response-too-large` error; an oversized resource or prompt fails with a fixed protocol error. The connector never clips structured JSON, emits a preview, spills withheld data, or reports the measured size. Final results from mutation-capable tools are always preserved because Discord may already have changed. Protocol discovery and notifications are outside this result boundary; use toolsets and progressive discovery to control catalog size.

Credential-authenticated Incoming-webhook messages use `storage.webhookCredentialRoot`, an existing canonical process-owned `0700` directory. Connector-created credentials become available through separately gated exact lookup, bounded plain-text delivery, editing, and reviewed deletion, with exclusive `0600` files and durable directory synchronization. MCP accepts no credential, execution URL, path, identity override, thread target, rich payload, file, component, poll, or raw webhook payload. Allowlist direct text or announcement channels in `scopes.webhookMessageChannelIds`, then enable only the required webhook-message capability.

Operational commands require `--config FILE`, `--profile NAME`, or the non-secret `DISCORD_MCP_CONFIG_FILE` selector. Ambient policy variables are rejected and there is no alternate environment-policy or migration mode. Running `setup` without a preset verifies an existing policy without rewriting it, while a preset explicitly creates or replaces the selected target.

Offline `doctor` remains useful before a secret is mounted or when its referenced file is unavailable. It reports credential availability as a separate failure and continues validating the strict policy, identity pins, scope, tool surface, effective read-response budget, and safety gates. `doctor --online` contacts Discord only when the real selected credential is available.

### Review any policy replacement

Keep the active policy unchanged while editing a separate candidate, then review and apply only an exact fresh plan:

```sh
npx --yes @j-256/discord-mcp@0.1.0 config workbench \
  ./discord-mcp.json \
  --html ./discord-mcp-workbench.html
npx --yes @j-256/discord-mcp@0.1.0 config plan \
  ./discord-mcp.json \
  ./discord-mcp.candidate.json
npx --yes @j-256/discord-mcp@0.1.0 config apply \
  ./discord-mcp.json \
  ./discord-mcp.candidate.json \
  --plan-digest SHA256_FROM_THE_PLAN \
  --confirm ACTIVE_POLICY_NAME
```

The optional workbench validates the active schema-v2 document, then writes an exclusive private standalone editor. It embeds the complete non-secret policy, including public Discord IDs, local paths, and external secret reference names, so treat the HTML as private. Edits stay in browser memory until an explicit candidate download. The page has no secret field, network or external navigation authority, browser persistence, Discord access, active-file write, or approval authority, and it does not open a browser automatically. Its local checks and preliminary impact labels are guidance only.

Planning remains authoritative. It reads two protected non-secret documents and reports every exact field change, its authority or operational impact, canonical tool additions and removals, warnings, both document digests, the complete candidate, and structured post-application checks. It never resolves a referenced secret or contacts Discord. Application rereads both files, requires the exact digest and active-policy-name confirmation, rejects identity drift or either stale document, preserves a recoverable backup, and leaves the candidate untouched. The active document remains the only policy source; there is no legacy environment fallback or migration layer.

Review recent write outcomes and durable cross-process claims from the same selected policy without making a Discord request or resolving its credential:

```sh
npx --yes @j-256/discord-mcp@0.1.0 activity \
  --config ./discord-mcp.json \
  --html ./discord-mcp-activity.html
```

The bounded review collapses each activity ID into its newest current outcome while retaining older records as superseded history. Pending, uncertain, failed, drifted, malformed, and review-required evidence produces warning exit status instead of looking like a clean run. Matching reviewed operations are joined to durable claims only through both their content-free operation-key hash and plan digest, while claims without a match in the bounded window remain explicitly labeled. The digest binds the exact collected report, while its independent-read marker avoids implying that separate local files were captured under one global state lock. The optional private standalone explorer adds search and filters but cannot contact Discord, resolve a claim, retry an operation, persist browser state, or expose the selected activity-file path. Use the separate exact-confirmation `coordination resolve` command only after stopping the owning process and checking the exact Discord state and audit log.

Feature policy uses the same document shape. Bulk bans, bulk member-role changes, guild pruning, and other reviewed features each have separate capabilities, exact scopes, bounded limits, and documented toolsets. Single-member authority never grants batch authority. No environment-policy interface, legacy alias, fallback parser, or migration layer exists.

Use `channel-reader` only when bounded message history and native search are needed. It requires at least one exact channel:

```sh
npx --yes @j-256/discord-mcp@0.1.0 setup \
  --config ./discord-reader.json \
  --preset channel-reader \
  --guild-id YOUR_GUILD_ID \
  --channel-id YOUR_CHANNEL_ID
```

### Expand the policy through review

Keep first setup read-only, then plan an additive recipe when a write workflow is needed. `guild-builder` adds model-neutral, caller-retained authoring and two-pass capture for guild structure, profile, settings, Community, Welcome Screen, onboarding, staged AutoMod, and static publications without storing the objective or blueprint. Its settings, Community, and onboarding evidence uses a nonprivileged `GUILDS`-only layout-evidence connection without changing the event feed. `incident-response` adds privacy-minimized incident audit and reviewed time-bounded lockdown changes with no Gateway or privileged intent. `channel-publisher` adds bounded text, static Components V2, and remote-free rich-embed publication and reports the required Message Content intent. [`direct-messenger`](docs/reference.md#exact-one-to-one-private-message-lifecycle) adds exact-user reads plus reviewed text and static Components V2 delivery, same-format edits, and deletion. Optional private-file delivery requires a separate capability and owned attachment root; the recipe does not grant it. Private messaging adds no guild permission, privileged intent, Gateway feed, group DM, recipient discovery, remote-file fetch, interactive callback, or immediate write path.

```sh
npx --yes @j-256/discord-mcp@0.1.0 recipe list
npx --yes @j-256/discord-mcp@0.1.0 recipe plan guild-builder ./discord-mcp.json \
  --guild-id YOUR_GUILD_ID
npx --yes @j-256/discord-mcp@0.1.0 recipe apply guild-builder ./discord-mcp.json \
  --guild-id YOUR_GUILD_ID \
  --plan-digest SHA256_FROM_THE_PLAN \
  --confirm guild-builder
npx --yes @j-256/discord-mcp@0.1.0 recipe plan direct-messenger ./discord-mcp.json \
  --user-id EXPECTED_RECIPIENT_USER_ID
npx --yes @j-256/discord-mcp@0.1.0 recipe apply direct-messenger ./discord-mcp.json \
  --user-id EXPECTED_RECIPIENT_USER_ID \
  --plan-digest SHA256_FROM_THE_PLAN \
  --confirm direct-messenger
```

Planning prints the complete proposed non-secret document, exact field changes, permissions, intents, risks, warnings, and a path-bound digest without resolving a secret or contacting Discord. Application recomputes that plan, requires the exact digest and recipe-name confirmation, rejects a concurrent source change, preserves a recoverable backup, and still grants no Discord authority by itself. Run the printed offline validation, online doctor, and smoke checks after applying. Recipes add policy only; they never remove an existing capability, scope, or toolset.

Online doctor verifies identity, bounded guild membership, and application posture. Smoke launches the selected policy through the real `serve` entrypoint, negotiates stable MCP over stdio, validates catalogs, annotations, and read-only status, and writes nothing to Discord. Configured optional runtimes start and stop with the child; see the [operator reference](docs/reference.md#operator-cli).

### Build from source

```sh
git clone https://github.com/j-256/discord-mcp.git
cd discord-mcp
npm run deps:locked
npm run build
node dist/cli.js catalog --check
```

The exact [installation](docs/reference.md#install), [operator CLI](docs/reference.md#operator-cli), and [configuration](docs/reference.md#configuration) references cover standalone configuration, managed profiles, OCI bind mounts, progressive discovery, toolsets, allowlists, optional Gateway modes, observability, and every independently gated feature.

## Capability map

| Area | Selected capabilities |
| --- | --- |
| Discovery and reads | Local exact-ID conversion from canonical jump links and typed mentions, guilds, channels, exact allowlisted one-to-one private messages, global and guild voice regions, exact transient voice-channel status, roles, effective permissions, member-safe audits, message history, indexed search, threads, forums, polls, reactions, audit history, integrations, invites, templates, guild and application-owned emojis, stickers, soundboard, events, Stage instances, onboarding, Welcome Screens, profiles, settings, Community routing, incident actions, and channel webhooks |
| Messages and communities | Idempotent guild bot sends and edits, reviewed exact-recipient private-message plain-text or static Components V2 send, reply, same-format edit, deletion, and receipt verification, privately credentialed Incoming-webhook message lookup, plain-text delivery, exact editing and reviewed deletion, exact pins, reactions, announcement crossposts and subscriptions, immutable forwarding, attachments, reviewed and restart-verifiable static Components V2 and remote-free rich embeds, forum posts, thread creation, native polls, and exact deletion |
| Guild structure | Model-neutral authoring and two-pass capture into caller-retained guild blueprints across additive structure, profile, settings, monotonic Community, complete Welcome Screens and onboarding, staged AutoMod, and ordered restart-verifiable static Components V2 publications; additive channels and roles; reviewed exact channel and standard-role retirement; resumable scaffolds; atomic channel cloning; relative channel and role ordering; boost-aware voice and Stage channel metadata; connection-sensitive voice-channel status changes; permission overwrites; forum tags; and exact role configuration with reviewed local or Unicode icons |
| Members and moderation | Privacy-minimized member and ban reads; exact nickname, named Membership Screening bypass, role, voice, thread-membership, kick, ban, unban, and timeout workflows; reviewed exact-role batches with per-target evidence, checkpoints, and approved resumption; reviewed native bulk bans with complete target-set evidence and per-target readback; and bounded non-exact guild pruning with protected-identity role shields and count-only outcomes |
| Community configuration | Current-application command, linked-role, SKU, exact beneficiary entitlement, and subscription audits, reviewed guild and global command lifecycles, native command management, reviewed application schema and intent changes, reviewed Community enablement and routing, Guild Templates, integrations, finite role-aware private-file invites, capability-safe invite audit and revocation, credential-safe webhooks and private messages, onboarding, Welcome Screens, authenticated widget settings, time-bounded incident actions, application-owned emojis, guild expressions, soundboard, AutoMod, scheduled events, and Stage lifecycle |
| Operations | Full or progressive tool discovery, resources, prompts, policy-aware exact-ID completion, optional display-only MCP App plan review, strict non-secret policy files and managed profiles, private offline policy workbench, deterministic read-only presets, review-first additive policy recipes, privacy-safe application posture, command, linked-role schema, SKU catalog, and guild webhook exposure audits, digest-bound content-free activity review with optional private HTML, durable cross-process write coordination, optional privacy-safe Gateway events with authenticated exact-route sparse sharding, shared session-start preflight, and per-shard outbound budgeting, native Interaction ingress, and local or W3C-parented OpenTelemetry diagnostics |

Capabilities are exposed only when their toolset and policy gates are selected. A toolset narrows the callable surface but never grants Discord or local write authority. Browse the exact [tool reference](docs/reference.md#tools), [resources](docs/reference.md#resources), and [prompts](docs/reference.md#prompts).

## Safety model

Discord permissions are the outer boundary. Connector policy narrows that authority further.

- Production traffic uses fixed Discord REST and vetted Gateway origins; runtime configuration cannot redirect credentials
- Each Gateway shard counts every successful outbound event in one rolling connection budget, bounds caller-command pressure below reserved lifecycle capacity, and discards queued exact-ID requests on every connection boundary
- Exact guild, channel, role, member, and feature allowlists constrain each surface independently
- Every guild tool rejects direct and group-direct channels. The dedicated private-message tools instead require an independent exact ordinary-user allowlist and caller-known one-to-one channel IDs, support only plain text or bounded static Components V2, suppress all mentions, use fixed anti-spam limits, and provide no discovery, bulk targeting, interactive components, arbitrary embed URLs, or Gateway feed
- Discord names, messages, embeds, components, filenames, URLs, and other remote text are treated as untrusted data rather than instructions
- Discord content may be returned transiently when explicitly requested, but it is not cached, journaled, exported, or persisted by the connector
- New invite codes and URLs are delivered only through a caller-selected exclusive private file; MCP results, lifecycle records, errors, logs, and telemetry remain bearer-capability-free
- Incoming-webhook credentials remain in exclusive exact-ID private files; MCP accepts only webhook and message IDs, and persistent activity, receipts, errors, logs, and telemetry remain credential- and content-free
- Every consequential write retains its domain-specific permission, freshness, approval, audit, readback, and uncertainty gates
- Message deletion accepts exact message IDs only and preserves every independent deletion gate
- Channel deletion requires one exact allowlisted channel, complete dependency and permission evidence, explicit irreversible-content-loss acknowledgement, signed review, and newer complete Gateway absence proof; it never reads message content to estimate impact
- Role deletion requires one exact allowlisted unheld standard role, complete holder, hierarchy, permission, and discoverable dependency evidence, explicit irreversible-role-loss acknowledgement, signed review, and fresh absence plus survivor-preservation proof
- Guild pruning requires a separate exact guild allowlist, optional exact include-role allowlist, explicit acknowledgement that Discord does not reveal the candidate IDs, protected-identity role shields, a fresh native estimate below both requested and configured ceilings, signed review, and one non-retried request with strict count-only outcome evidence
- Guild incident actions require one exact allowlisted guild, complete known `MANAGE_GUILD` or owner evidence, future deadlines no more than 24 hours ahead, signed review, one non-retried sparse write, and exact response plus fresh readback; clearing protection early is treated as destructive
- Privileged-intent enablement accepts only Guild Members or Message Content when the strict policy proves that intent is required or recommended, preserves every observed non-target application flag, and excludes Presence, disabling, generic application editing, and automatic remediation

The common reviewed-write sequence is:

```text
exact request -> fresh keyed plan -> human review -> signed approval
             -> final fresh-plan match -> pending content-free evidence
             -> one non-retried write -> exact readback or quarantine
```

Already-current requests are record-free no-ops where the Discord operation permits that proof. A known client rejection settles as failed. A transport failure, server failure, malformed success response, or missing readback is uncertain and must not be retried blindly. Durable claims keep the affected exact targets quarantined across connector processes until safe receipt evidence or explicit operator resolution proves what may proceed.

Read the [complete safety model](docs/reference.md#safety-model) and [security policy](SECURITY.md) before enabling a write surface.

## Trust and verification

| Command | What it proves | Discord access |
| --- | --- | --- |
| `discord-mcp catalog --check --json` | Exact production MCP inventories, schemas, annotations, policy-completion manifest and zero-value catalog proof, plan-review app bytes and authority, fixed execution guard, and stable contract, safety, and app digests | None |
| `discord-mcp catalog --html FILE` | Searchable standalone rendering of that exact negotiated contract, including schemas, workflow and risk filters, completion routes, app source, instructions, resources, and safety guidance | None |
| `discord-mcp preset show server-observer --json` | Exact read-only tools, scope requirements, intents, and zero-write boundary for the recommended preset | None |
| `discord-mcp preset install server-observer --application-id ID --guild-id ID [--html FILE]` | Fixed-origin, guild-locked bot authorization plan plus an optional credential-free standalone checklist with exact digests and post-install commands | None |
| `discord-mcp config workbench ACTIVE --html FILE` | Private offline in-memory editor and explicit candidate download for one validated schema-v2 policy, with no active-file write or approval authority | None |
| `discord-mcp config plan ACTIVE CANDIDATE --json` | Complete candidate policy, exact semantic changes, authority impacts, tool exposure, warnings, identity lock, and fresh path-bound digest | None |
| `discord-mcp config apply ACTIVE CANDIDATE --plan-digest DIGEST --confirm ACTIVE_NAME` | Exact fresh local policy replacement with stale-file rejection, atomic publication, and a recoverable prior version | None |
| `discord-mcp recipe show guild-builder --json` | Exact additive capability, scope, toolset, permission, intent, Gateway-evidence, and risk contract | None |
| `discord-mcp recipe plan guild-builder FILE --guild-id ID --json` | Complete proposed policy, exact changes, requirements, warnings, and source-, path-, request-, and contract-bound digest | None |
| `discord-mcp activity --config FILE [--html FILE] [--json]` | Bounded current write lifecycles, superseded history, exact content-free evidence, and correlated durable claims with warning status when operator attention is required | None |
| `discord-mcp doctor --config FILE` | Local Node.js, credential availability, identity pins, policy, scope, tool surface, lossless read-response budget, Gateway, observability, and write-gate diagnostics, even before a secret is available | None |
| `discord-mcp doctor --config FILE --online` | Strict policy, pinned application and bot identity, intent flags, and bounded guild membership | Read-only |
| `discord-mcp smoke --config FILE` | Spawned stdio negotiation, discovery, annotations, and connector identity through the selected policy | Read-only |
| `npm run container:verify` | Pinned-base build, non-root filesystem and process restrictions, secret-free metadata, deterministic catalog identity, MCP behavior, and safe credential failure | None |
| `npm run container:index:verify` | Exact multi-architecture index, platform configurations and blobs, and per-platform provenance plus SBOM records | Public image registries only |
| `npm run pack:verify` | Reproducible archives, exact package contents, isolated install, installed CLI, deterministic catalog evidence and HTML, and content-free MCP handshake | None |
| `npm run security:check` | Dependency vulnerabilities, registry signatures, and attestations | Public package registry only |

`catalog --check --json` is designed for independent comparison. It needs no credential, ignores ambient connector authority, returns no completion identifiers, executes no Discord operation, opens no Gateway, exports no telemetry, and creates no activity record. Matching contract digests identify matching normalized MCP instructions, server capabilities, policy-completion bindings, tool schemas and annotations, prompt declarations, resource declarations, templates, safety response, plan-review app response, and execution guard.

The release workflow rebuilds candidates from source, packs them twice, installs them without lifecycle scripts, compares them across supported Node.js lines, builds an exact-version multi-architecture OCI image, tests the image under a read-only root filesystem with no capabilities or network, generates an SPDX SBOM, and retains signed provenance, SBOM, and catalog attestations. The [release runbook](docs/releasing.md) documents the human-controlled publication gates and independent verification path.

## Architecture

The stdio transport, Discord REST client, scope policy, domain services, reviewed planning, durable coordination, activity log, observability, Gateway, and MCP adapter remain separate. Production uses native `fetch`, TypeScript ESM, and a small exactly pinned dependency set.

This keeps transport, permission evidence, local authority, reviewed writes, persistence, and MCP presentation independently testable. New capabilities must fit those boundaries rather than add a generic Discord dispatcher.

## Documentation

- [Complete operator and capability reference](docs/reference.md)
- [Security model and reporting](SECURITY.md)
- [Release and independent verification runbook](docs/releasing.md)
- [MCP Registry manifest](server.json)
- [AGPL-3.0-only license](LICENSE)

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for changes and [SUPPORT.md](SUPPORT.md) for setup and operator questions. Default tests use injected transports and do not contact Discord:

```sh
npm run metadata:check
npm run config:schema:check
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run pack:verify
npm run container:verify
npm run container:index:verify
npm run security:check
```

Live probes are explicit and read-only by default. No default verification command fetches message content or performs a Discord mutation.

## License

AGPL-3.0-only
