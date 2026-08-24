# Discord MCP

<img src="https://raw.githubusercontent.com/j-256/discord-mcp/v0.1.0/assets/discord-mcp-icon.png" alt="Discord MCP shield and reviewed connection icon" width="128">

Discord MCP is a local stdio Model Context Protocol server for reading and safely administering Discord guilds through a caller-owned bot. It combines broad, typed Discord coverage with exact scope, privacy-minimized results, reviewed writes, durable content-free evidence, and explicit uncertain-outcome handling.

**Least privilege. Review before mutation. Verifiable outcomes. No Discord-content persistence.**

[Quick start](#quick-start) | [Capability map](#capability-map) | [Safety model](#safety-model) | [Trust and verification](#trust-and-verification) | [Complete reference](docs/reference.md) | [Security](SECURITY.md)

## Why this connector

| Concern | Enforced behavior |
| --- | --- |
| Discord reach | One strict non-secret policy file with verified application and bot identities, exact guild and channel scope, risk-separated toolsets, and read-only setup presets |
| Read safety | Bounded requests, strict response validation, privacy-tiered projections, untrusted-content handling, and no hidden direct-message access |
| Write safety | Exact-ID requests, keyed fresh plans, signed interactive approval, a final fresh-plan match, and action-specific Discord permission proof |
| Outcome integrity | Pending content-free evidence before mutation, one non-retried write, exact readback, durable coordination, and quarantine after ambiguity |
| Privacy | Tokens stay in the caller's environment; Discord content, profiles, URLs, audit reasons, and raw operation keys are not persisted |
| Release integrity | Exact dependency and base-image pins, credential-free contract fingerprints, reproducible package and hardened OCI checks, an SPDX SBOM, and signed-release automation |

The [complete reference](docs/reference.md) documents every tool family, policy gate, permission boundary, privacy tier, resource, prompt, Gateway mode, operator command, and known limitation.

## Quick start

Requirements:

- Node.js 22 or newer
- A Discord application with a bot user
- One strict non-secret JSON policy file
- The bot token available only through an environment variable
- Only the Discord permissions needed for the selected read or reviewed-write scope

Each deployment uses a Discord application and bot controlled by that operator. Discord MCP does not provide a shared bot, hosted relay, or shared token: create your own application, invite its bot only to guilds you control, and keep its credential in the local launcher or secret store.

Do not grant the bot `Administrator`. Generate the exact initial permission grant from a read-only preset, then narrow the installed bot role with category or channel overrides. The [bot setup guide](docs/reference.md#discord-bot-setup) explains bot ownership, optional intents, and later feature-specific permissions.

### Inspect before connecting

For an exact published version, inspect the real production contract and the recommended read-only preset without a token or Discord request:

```sh
npx --yes @j-256/discord-mcp@0.1.0 catalog --check
npx --yes @j-256/discord-mcp@0.1.0 preset show server-observer
```

`catalog --check` launches a credential-free, execution-disabled MCP server, negotiates its real tools, prompts, resources, and templates, and verifies that every tool call is blocked by the catalog-only guard.

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
  --guild-id YOUR_GUILD_ID
```

Open the printed URL while signed in as a member allowed to manage that server. It requests only `View Channel` for `server-observer`, locks the server selector to the supplied ID, requests no user token, and never sends the bot token to the connector command. Keep Public Bot disabled unless other people should be able to install your application. Use `channel-reader` instead to request `View Channel` plus `Read Message History`; its plan also identifies Message Content as the recommended Developer Portal intent.

### Create the safest first configuration

Keep the token in the launching environment, verify one exact guild, save the complete non-secret policy in one file, and test the full MCP path:

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

The `server-observer` preset exposes guild metadata, roles, permission diagnostics, connector health, content-free activity, and tool discovery. It cannot enable writes, the Gateway, telemetry export, activity persistence, or Message Content access. Setup stores the credential variable name and verified public IDs, never the token value, and prints a portable stdio launch descriptor for a compatible MCP client.

The versioned file is the canonical policy boundary. It covers identity, read scope, tools, capabilities, feature scopes, limits, local storage paths, Gateway behavior, runtime settings, and privacy-safe observability. A typical deployment has two inputs: one JSON policy file and one bot-token secret. Tokens and optional authenticated-collector headers remain environment-only secret references. The checked-in [JSON Schema](discord-mcp.config.schema.json) supports editor validation, while `config show` and `config explain` provide secret-free inspection. Schema-v2 managed profiles use the same document when private per-user storage is preferable.

Operational commands require `--config FILE`, `--profile NAME`, or the non-secret `DISCORD_MCP_CONFIG_FILE` selector. Policy environment variables are accepted only by `config migrate`; they cannot silently extend or override a selected document. Running `setup` without a preset verifies an existing schema-v2 policy without rewriting it, while a preset explicitly creates or replaces the selected target.

New feature policy follows the same document shape. For example, reviewed role retirement uses `capabilities.roleDeletionAudit`, `capabilities.roleDeletions`, `scopes.roleDeletionIds`, `gateway.enabled`, and the `role-deletion` toolset. Equivalent `DISCORD_MCP_*` policy variables are compatibility inputs for migration, not the recommended setup interface.

Use `channel-reader` only when bounded message history and native search are needed. It requires at least one exact channel:

```sh
npx --yes @j-256/discord-mcp@0.1.0 setup \
  --config ./discord-reader.json \
  --preset channel-reader \
  --guild-id YOUR_GUILD_ID \
  --channel-id YOUR_CHANNEL_ID
```

The online doctor verifies identity, the bounded guild-membership page, and a privacy-safe application security posture covering installation settings, privileged intents, Interaction delivery, event webhooks, and least-privilege fit. The smoke command verifies the real MCP path without listing channels, reading messages, opening the Gateway, exporting telemetry, or writing to Discord.

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
| Discovery and reads | Guilds, channels, global and guild voice regions, exact transient voice-channel status, roles, effective permissions, member-safe audits, message history, indexed search, threads, forums, polls, reactions, audit history, integrations, invites, templates, guild and application-owned emojis, stickers, soundboard, events, Stage instances, onboarding, Welcome Screens, profiles, settings, and webhooks |
| Messages and communities | Idempotent sends and edits, exact pins, reactions, announcement crossposts and subscriptions, immutable forwarding, attachments, static Components V2, forum posts, thread creation, native polls, and exact deletion |
| Guild structure | Additive channels and roles, reviewed exact channel and standard-role retirement, resumable scaffolds, atomic channel cloning, relative channel and role ordering, boost-aware voice and Stage channel metadata, connection-sensitive voice-channel status changes, permission overwrites, forum tags, exact role configuration with reviewed local or Unicode icons, guild settings, and guild profile text |
| Members and moderation | Privacy-minimized member and ban reads, exact nickname, role, voice, thread-membership, kick, ban, unban, and timeout workflows with hierarchy and permission proof |
| Community configuration | Native command management, Guild Templates, integrations, invites, webhooks, onboarding, Welcome Screens, authenticated widget settings, application-owned emojis, guild expressions, soundboard, AutoMod, scheduled events, and Stage lifecycle |
| Operations | Full or progressive tool discovery, resources, prompts, strict non-secret policy files and managed profiles, deterministic presets, privacy-safe application posture audits, content-free activity, durable cross-process write coordination, optional privacy-safe Gateway events, native Interaction ingress, and local or OpenTelemetry diagnostics |

Capabilities are exposed only when their toolset and policy gates are selected. A toolset narrows the callable surface but never grants Discord or local write authority. Browse the exact [tool reference](docs/reference.md#tools), [resources](docs/reference.md#resources), and [prompts](docs/reference.md#prompts).

## Safety model

Discord permissions are the outer boundary. Connector policy narrows that authority further.

- Production traffic uses fixed Discord REST and vetted Gateway origins; runtime configuration cannot redirect credentials
- Exact guild, channel, role, member, and feature allowlists constrain each surface independently
- Direct messages are rejected, mentions default to suppressed, and anti-spam limits precede message writes
- Discord names, messages, embeds, components, filenames, URLs, and other remote text are treated as untrusted data rather than instructions
- Discord content may be returned transiently when explicitly requested, but it is not cached, journaled, exported, or persisted by the connector
- Every consequential write retains its domain-specific permission, freshness, approval, audit, readback, and uncertainty gates
- Message deletion accepts exact message IDs only and preserves every independent deletion gate
- Channel deletion requires one exact allowlisted channel, complete dependency and permission evidence, explicit irreversible-content-loss acknowledgement, signed review, and newer complete Gateway absence proof; it never reads message content to estimate impact
- Role deletion requires one exact allowlisted unheld standard role, complete holder, hierarchy, permission, and discoverable dependency evidence, explicit irreversible-role-loss acknowledgement, signed review, and fresh absence plus survivor-preservation proof

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
| `discord-mcp catalog --check --json` | Exact production MCP inventories, schemas, annotations, fixed execution guard, and stable contract plus safety digests | None |
| `discord-mcp preset show server-observer --json` | Exact read-only tools, scope requirements, intents, and zero-write boundary for the recommended preset | None |
| `discord-mcp preset install server-observer --application-id ID --guild-id ID --json` | Fixed-origin, guild-locked bot authorization URL, exact permission bitfield, intent guidance, and post-install commands | None |
| `discord-mcp doctor --config FILE` | Local Node.js, credential-variable, identity-pin, policy, scope, tool-surface, Gateway, observability, and write-gate diagnostics | None |
| `discord-mcp doctor --config FILE --online` | Strict policy, pinned application and bot identity, intent flags, and bounded guild membership | Read-only |
| `discord-mcp smoke --config FILE` | Real MCP negotiation, annotations, discovery, static guidance, and connector identity through the selected policy | Read-only |
| `npm run container:verify` | Pinned-base build, non-root filesystem and process restrictions, secret-free metadata, deterministic catalog identity, MCP behavior, and safe credential failure | None |
| `npm run container:index:verify` | Exact multi-architecture index, platform configurations and blobs, and per-platform provenance plus SBOM records | Public image registries only |
| `npm run pack:verify` | Reproducible archives, exact package contents, isolated install, installed CLI, catalog evidence, and content-free MCP handshake | None |
| `npm run security:check` | Dependency vulnerabilities, registry signatures, and attestations | Public package registry only |

`catalog --check --json` is designed for independent comparison. It needs no credential, ignores ambient connector authority, executes no Discord operation, opens no Gateway, exports no telemetry, and creates no activity record. Matching contract digests identify matching normalized MCP instructions, tool schemas and annotations, prompt declarations, resource declarations, templates, safety response, and execution guard.

The release workflow rebuilds candidates from source, packs them twice, installs them without lifecycle scripts, compares them across supported Node.js lines, builds an exact-version multi-architecture OCI image, tests the image under a read-only root filesystem with no capabilities or network, generates an SPDX SBOM, and retains signed provenance, SBOM, and catalog attestations. The [release runbook](docs/releasing.md) documents the human-controlled publication gates and independent verification path.

## Architecture

The stdio transport, Discord REST client, scope policy, domain services, reviewed planning, durable coordination, activity log, observability, Gateway, and MCP adapter remain separate. Production uses native `fetch`, TypeScript ESM, and a small exactly pinned dependency set.

This separation keeps Discord transport behavior, permission evidence, local authority, destructive planning, persistent records, and MCP presentation independently testable. New capabilities must fit those boundaries instead of bypassing them through a generic Discord dispatcher.

## Documentation

- [Complete operator and capability reference](docs/reference.md)
- [Legacy environment-policy migration guide](docs/environment-migration.md)
- [Security model and reporting](SECURITY.md)
- [Release and independent verification runbook](docs/releasing.md)
- [MCP Registry manifest](server.json)
- [AGPL-3.0-only license](LICENSE)

## Development

The default tests use injected transports and do not contact Discord:

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
