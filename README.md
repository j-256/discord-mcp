# Discord MCP

<img src="https://raw.githubusercontent.com/j-256/discord-mcp/v0.1.0/assets/discord-mcp-icon.png" alt="Discord MCP shield and reviewed connection icon" width="128">

Discord MCP is a local stdio Model Context Protocol server that lets MCP host inspect Discord guilds, channels, threads, forums, permissions, and indexed message history through a dedicated bot. It includes privacy-tiered MCP resources, validated read-only and plan-only prompts, a credential-safe operator CLI, compact bounded search, safe idempotent message interactions, exact reviewed message deletion, exact reviewed member moderation, and content-free local activity records.

## Safety model

The connector treats Discord permissions as its outer boundary and adds local policy inside that boundary.

- Production requests always target Discord API v10 at a fixed origin
- Direct-message channels are rejected
- Discord names, topics, forum tags, thread names, message bodies, embeds, components, filenames, and URLs are treated as untrusted data rather than instructions
- Resource discovery is content-free; live resource templates require exact IDs and never enumerate messages
- Prompt rendering validates literal inputs without contacting Discord or invoking a service method, and destructive prompts stop after read-only planning
- Optional guild and channel allowlists can narrow read access
- Threads inherit local read scope from an allowlisted parent, while native search requests are attenuated to exact allowlisted channel IDs
- Message interactions are disabled unless an explicit environment toggle and exact interaction-channel allowlist are both present
- Interaction scope never inherits from a thread parent, mentions notify nobody by default, and roles, `@everyone`, and `@here` cannot be enabled
- Every actual send, edit, or reaction write requires a pending content-free activity record and passes process-local anti-spam guards
- Sends require caller-provided idempotency keys, coalesce concurrent retries, and use deterministic Discord nonces with uniqueness enforcement
- Only non-webhook messages owned by the verified bot can be edited
- Deletion is disabled unless an explicit environment toggle and deletion-channel allowlist are both present
- Deletion accepts exact message IDs rather than free-form filters
- A keyed snapshot digest detects message edits or replacements
- MCP host write approval and signed MCP elicitation both precede deletion
- The connector re-reads the plan immediately before writing
- A content-free pending activity record must succeed before deletion starts
- Member administration is disabled unless a separate toggle and non-empty exact guild allowlist are both configured
- Kick, ban, timeout, timeout removal, and unban accept exact guild and user IDs only, reject the bot, guild owner, and configured protected users, and fail closed on incomplete permission or role-hierarchy evidence
- Every moderation write is bound to a keyed snapshot of the exact action, target state, permission evidence, action parameters, and Discord audit-log reason
- MCP host write approval, signed MCP elicitation, a final fresh plan match, and a content-free pending activity record all precede member moderation
- The bot token, message content, content hashes, embeds, components, attachment URLs, emoji, notification user IDs, raw idempotency keys, Discord audit-log reasons, profile names, role names, and Discord Interaction public key are never written to the activity log

Treat message deletion and member moderation as consequential even though the connector records identifiers and outcomes.

## Requirements

- Node.js 22 or newer
- A Discord application with a bot user
- The bot token available as `DISCORD_BOT_TOKEN`
- `View Channels` and `Read Message History` in every channel the connector should read
- The Message Content privileged intent enabled for full message bodies
- `Send Messages` only in channels where message sends or edits will be enabled
- `Add Reactions` only in channels where reaction writes will be enabled
- `Manage Messages` only in channels where deletion will eventually be enabled
- `Kick Members`, `Ban Members`, or `Moderate Members` only in exact guilds where the corresponding member administration action will be enabled

Do not grant the bot `Administrator`. Restrict its Discord role at the category or channel level wherever possible.

The application public key is not used by this local REST connector. It becomes relevant only if Discord Interaction webhooks or slash commands are added later.

## Discord bot setup

1. Open the application in the Discord Developer Portal.
2. On the Bot page, enable the Message Content privileged intent.
3. On the Installation page, enable Guild Install and add the `bot` scope.
4. Select `View Channels` and `Read Message History` as the initial bot permissions.
5. Use the generated install link while signed in as a server administrator and add the bot to the intended server.
6. Restrict the bot role to the intended categories or channels.
7. Run `discord-mcp setup` and confirm that Discord reports the expected application, bot, and scoped guild access.

Add `Send Messages` and `Add Reactions` later only for exact channels selected for interactions. Add `Manage Messages` only after selecting deletion channels. Add only the specific member permission needed for planned guild administration, keep the bot's highest role above eligible targets, and keep the local administration toggle disabled until exact guild and protected-user IDs are configured.

Discord documents bot installation in its [getting started guide](https://docs.discord.com/developers/quick-start/getting-started), message content access in its [Gateway reference](https://docs.discord.com/developers/events/gateway), message deletion in its [message resource reference](https://docs.discord.com/developers/resources/message), and member moderation in its [guild resource reference](https://docs.discord.com/developers/resources/guild).

## Install

After a release is published, run an exact version from npm:

```sh
npx --yes @j-256/discord-mcp@0.1.0 help
```

Pinning the version keeps the executable stable across restarts. The MCP Registry manifest uses the same exact npm version.

For development from source:

```sh
npm run deps:locked
npm run typecheck
npm test
npm run build
```

The source build's CLI entrypoint is `dist/cli.js`. Running either entrypoint without a command starts the stdio MCP server.

## Operator CLI

The CLI provides a safe path from environment configuration to a verified MCP connection:

```sh
node dist/cli.js doctor
node dist/cli.js doctor --online
node dist/cli.js setup
node dist/cli.js smoke
```

`doctor` checks the Node.js version, required token variable, configuration syntax, application identity pin, local allowlists, interaction policy, deletion policy, and administration policy. Offline checks do not contact Discord. Add `--online` to verify the application, bot identity, Message Content intent flag, and first guild-membership page without listing channels or reading messages.

`setup` performs the same safe online identity check, requires at least one accessible guild inside local scope, and prints a MCP host configuration fragment. When invoked through the built CLI, the fragment points at that exact Node.js executable and CLI entrypoint. It embeds the verified public application ID but only refers to the bot token by environment-variable name.

`smoke` connects an official MCP client to the real adapter over linked protocol transports, validates the tool, resource, resource-template, and prompt catalogs, checks every write tool's risk annotations, and calls only `get_connector_status`. Catalog discovery is local and content-free. The command does not list Discord channels, read messages, or write to Discord.

Add `--json` to `setup`, `doctor`, or `smoke` for a versioned machine-readable report. Run `node dist/cli.js help` for the complete command summary.

## Configuration

| Environment variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot authentication |
| `DISCORD_MCP_APPLICATION_ID` | Recommended | Reject a token belonging to a different application |
| `DISCORD_MCP_ALLOWED_GUILD_IDS` | No | Comma- or whitespace-separated read guild allowlist |
| `DISCORD_MCP_ALLOWED_CHANNEL_IDS` | No | Comma- or whitespace-separated read channel allowlist |
| `DISCORD_MCP_ALLOW_ADMINISTRATION` | For member moderation | Must be exactly `true` to enable reviewed member administration |
| `DISCORD_MCP_ADMIN_GUILD_IDS` | For member moderation | Non-empty exact administration-guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_PROTECTED_USER_IDS` | No | Exact user IDs that member administration must never target; defaults empty and is bounded to 100 configured IDs |
| `DISCORD_MCP_ALLOW_INTERACTIONS` | For interactions | Must be exactly `true` to enable sends, own-message edits, or own-reaction adds |
| `DISCORD_MCP_INTERACTION_CHANNEL_IDS` | For interactions | Non-empty exact interaction-channel or thread allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_MENTION_USER_IDS` | No | Exact user IDs that interaction calls may explicitly notify; defaults empty and is bounded to 100 configured IDs |
| `DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE` | No | Process-local rolling interaction budget from 1 to 60; defaults to 10 |
| `DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS` | No | Process-local spacing per interaction channel from 0 to 60000 milliseconds; defaults to 500 |
| `DISCORD_MCP_ALLOW_DELETIONS` | For deletion | Must be exactly `true` to enable deletion |
| `DISCORD_MCP_DELETE_CHANNEL_IDS` | For deletion | Non-empty deletion-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_AUDIT_FILE` | No | Activity JSONL path; defaults under the user's local state directory |

An unset read allowlist means all guild channels Discord allows the bot to view. The bot's Discord role remains authoritative.

Configure the MCP host with a local stdio server:

```toml
[mcp_servers.discord]
command = "node"
args = ["/absolute/path/to/discord-mcp/dist/cli.js", "serve"]
required = true
startup_timeout_sec = 30
tool_timeout_sec = 180
env_vars = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_MCP_ALLOWED_GUILD_IDS",
  "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  "DISCORD_MCP_ALLOW_ADMINISTRATION",
  "DISCORD_MCP_ADMIN_GUILD_IDS",
  "DISCORD_MCP_PROTECTED_USER_IDS",
  "DISCORD_MCP_ALLOW_INTERACTIONS",
  "DISCORD_MCP_INTERACTION_CHANNEL_IDS",
  "DISCORD_MCP_MENTION_USER_IDS",
  "DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE",
  "DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS",
  "DISCORD_MCP_ALLOW_DELETIONS",
  "DISCORD_MCP_DELETE_CHANNEL_IDS",
  "DISCORD_MCP_AUDIT_FILE",
]
default_tools_approval_mode = "writes"

[mcp_servers.discord.env]
DISCORD_MCP_APPLICATION_ID = "your-application-id"
```

For the published package, replace the local `command` and `args` fields with an exact npm version:

```toml
command = "npx"
args = ["--yes", "@j-256/discord-mcp@0.1.0", "serve"]
```

Restart the local MCP host after changing MCP configuration. Use `/mcp` in the MCP host to inspect the connected server.

The [official MCP host configuration reference](https://modelcontextprotocol.io/docs) documents the stdio command, argument, environment-forwarding, approval, required-server, and timeout fields emitted by `setup`.

## Tools

| Tool | Access | Purpose |
| --- | --- | --- |
| `get_connector_status` | Discord read | Verify application and bot identity and report effective policy |
| `list_guilds` | Discord read | List scoped bot guild memberships |
| `list_channels` | Discord read | List scoped channels, thread metadata, and forum configuration without message content |
| `list_active_threads` | Discord read | List a bounded set of active threads and forum posts, optionally beneath one parent |
| `list_archived_threads` | Discord read | Page through public, private, or joined-private archived threads with typed cursors |
| `explain_channel_access` | Discord read | Explain the current bot's effective permissions and evidence confidence |
| `read_messages` | Discord read | Read a bounded page of normalized messages |
| `search_messages` | Discord read | Search indexed guild history with bounded official Discord filters and compact results |
| `get_message` | Discord read | Read one exact message |
| `send_message` | Discord write | Send one idempotent plain-text message or exact reply with notifications suppressed by default |
| `edit_own_message` | Discord write | Replace one exact non-webhook message owned by the verified bot |
| `add_reaction` | Discord write | Idempotently add the bot's own single reaction to one exact message |
| `plan_message_deletion` | Discord read | Prepare exact previews and a keyed deletion digest |
| `delete_messages` | Discord write | Confirm, revalidate, journal, and delete the reviewed IDs |
| `plan_member_moderation` | Discord read | Verify one exact target, permission and hierarchy evidence, action state, and keyed moderation digest |
| `execute_member_moderation` | Discord write | Confirm, revalidate, journal, and execute the reviewed exact-ID member action |
| `list_activity` | Local read | Read content-free deletion, interaction, and member-moderation activity |

## Resources

MCP resource discovery lists only stable metadata. Listing resources or templates does not call the connector service or Discord. Fixed resources are:

| Resource | Source | Purpose |
| --- | --- | --- |
| `discord://connector/safety` | Static | Explain trust boundaries and reviewed workflows without identity or Discord data |
| `discord://connector/policy` | Local | Report effective scope and write policy without credentials or Discord access |
| `discord://connector/activity` | Local | Return a bounded content-free activity page without exposing the local file path |
| `discord://guilds` | Discord read | Return one bounded page of normalized in-scope guild metadata |

Live templates are non-enumerable and require exact IDs:

| Resource template | Purpose |
| --- | --- |
| `discord://guilds/{guildId}/channels` | Read normalized in-scope channel metadata for one guild |
| `discord://channels/{channelId}/access` | Explain the verified bot's effective access to one channel or thread |
| `discord://channels/{channelId}/messages/{messageId}` | Read one exact message from one permitted channel |

Every Discord-backed JSON resource carries an `untrusted-external-data` classification and an instruction to treat returned strings as data. The exact-message resource is deliberately compact: it includes message content, author identity, timestamps, jump URL, compact attachment metadata, and counts while omitting attachment URLs and raw embeds, components, reactions, and mention payloads. Existing service checks still verify the bot identity, exact returned IDs, guild and channel scope, and fixed Discord API origin before the resource is returned.

Resource payloads and failures pass through the same recursive token-redaction boundary as tools. Live reads use private zero-lifetime cache hints. Only the identity-free static safety guide is eligible for shared caching.

## Prompts

MCP prompts are explicit user-selected workflow templates. Rendering a prompt performs no Discord, local activity, planning, or write call. Arguments remain flat MCP strings but are strictly validated and converted into a one-line JSON input object so arbitrary text cannot escape into workflow instructions. Rendered prompts pass through the connector's token-redaction boundary before they are returned.

| Prompt | Workflow boundary |
| --- | --- |
| `summarize_channel` | Read one bounded message page, cite evidence, and make no search or write call |
| `search_guild_messages` | Run one bounded native content search, preserve indexing status, and make no write call |
| `review_message_deletion` | Build and review an exact keyed deletion plan, then stop before execution |
| `review_member_moderation` | Build and review one exact keyed moderation plan, then stop before execution |

The deletion and moderation prompts do not collapse approval stages. They explicitly forbid their execution tools, leaving client write approval, signed elicitation, fresh-plan verification, interactive confirmation, and pending content-free journaling on the separate destructive call.

## Search

`search_messages` uses Discord's native guild search endpoint rather than scanning a recent-message window. It requires at least one substantive filter and supports content, channel, author, mention, reply, attachment, embed, link, pin, message-ID, and sort filters. The connector accepts at most 25 filters of each list type through MCP and at most 25 returned messages per request, even where Discord permits larger filter arrays.

Search is scoped before the request leaves the process. If a local channel allowlist exists and the call omits `channelIds`, the connector injects the exact allowlist into Discord's request. A caller-supplied channel list must be an exact subset. If the configured allowlist exceeds Discord's channel-filter capacity, the caller must provide a bounded subset instead of falling back to guild-wide search.

Results include message content, author identity, jump URLs, counts, and compact attachment metadata. They omit attachment URLs, raw embeds, raw components, reactions, and Discord's member payload. Discord can report approximate totals, return fewer results than requested, or answer with an indexing status. The connector advances pagination by the requested page size and returns indexing progress plus a retry delay without sleeping inside an MCP call.

Discord restricts native search based on the application's Message Content privileged intent. `get_connector_status`, online `doctor`, and `setup` report whether the application flags confirm that intent. See Discord's [message search reference](https://docs.discord.com/developers/resources/message#search-guild-messages).

## Threads and forums

`list_active_threads` returns a bounded view of active guild threads and can restrict results to one permitted parent. Forum and media posts are represented by Discord as public threads, so normalized results preserve their parent IDs and applied tag IDs. `list_channels` also preserves forum tag definitions, default reaction, layout, sort order, auto-archive duration, slowmode, and channel jump URLs.

`list_archived_threads` supports three views. `public` includes archived forum and media posts and uses an ISO 8601 timestamp cursor. `private` lists all private archived threads and additionally requires Discord's `Manage Threads` permission. `joined-private` lists only private threads joined by the bot and uses a thread-ID cursor. The result returns a visibility-tagged next cursor so callers cannot accidentally reuse the wrong cursor type.

An allowlisted parent grants local read scope to its child threads. This inheritance does not broaden deletion: a thread must still appear by its own exact ID in the deletion-channel allowlist. Discord's [channel resource reference](https://docs.discord.com/developers/resources/channel) documents thread and forum behavior.

## Permission explanations

`explain_channel_access` evaluates only the authenticated connector bot. It unions the guild `@everyone` role with the bot's roles, applies channel overwrites in Discord's documented everyone, combined-role, and member order, and treats permission bitfields as arbitrary-width integers. `ADMINISTRATOR` bypasses channel overwrites, unknown future bits are preserved and reported, and incomplete role or overwrite evidence yields `partial` confidence instead of a false access claim.

Threads use their parent's overwrites. A successful lookup of a private thread is also reported as evidence that Discord exposed that thread to the bot. The explanation identifies required and missing read permissions, but it remains a diagnostic snapshot rather than a guarantee that a later Discord request will succeed. See Discord's [permissions reference](https://docs.discord.com/developers/topics/permissions).

## Safe message interactions

Message interactions are a separate exact-ID policy boundary from reads and deletion. Set `DISCORD_MCP_ALLOW_INTERACTIONS=true` and list every writable channel or thread by its own ID in `DISCORD_MCP_INTERACTION_CHANNEL_IDS`. An allowlisted parent grants read access to its threads but never grants interaction access to them. The MCP host treats all three tools as writes, so the recommended `default_tools_approval_mode = "writes"` keeps client approval in front of each call.

`send_message` accepts plain text only and requires an idempotency key between 16 and 128 safe ASCII characters. Generate one key for one intended message, such as a UUID, and reuse that exact key with unchanged arguments for every retry. The connector derives a channel-bound 25-character nonce without sending, logging, or returning the raw key. Matching concurrent and recent in-process calls share one result. Discord also enforces nonce uniqueness for the past few minutes, which covers a connector restart inside that window. Reusing a key with different arguments is rejected, including when Discord returns an earlier nonce match whose content differs.

Idempotency is intentionally bounded rather than permanent. The local result ledger retains identifiers for ten minutes, and Discord documents only a past-few-minutes nonce window. If an uncertain send is left unresolved beyond those windows, inspect `list_activity` and the target channel before retrying. Never choose a fresh key merely because a result was uncertain, since that would authorize a second message.

All mention classes are suppressed by default. A call can notify only exact IDs present in `DISCORD_MCP_MENTION_USER_IDS`, up to ten per message, and each ID must also appear as a visible `<@user-id>` mention in the submitted content. Role, `@everyone`, and `@here` notifications remain suppressed. Reply-author notification is a separate explicit boolean; the connector fetches the exact reply target and permits that notification only when its author ID is configured. Replies use Discord's fail-if-target-missing behavior.

`edit_own_message` replaces the complete plain-text content of one exact message after a fresh ownership check. Webhook messages and messages owned by anyone other than the verified bot are rejected. An exact same-content request with no notification users is a journaled no-op that consumes no write budget. `add_reaction` accepts one Unicode emoji or custom `name:snowflake` value and uses Discord's naturally idempotent own-reaction PUT.

Every actual interaction write first reserves a local rolling budget and per-channel interval. These limits reject immediately with `retryAfterMs`; they do not sleep and are not hardcoded assumptions about Discord's dynamic rate limits. A content-free pending activity record must then succeed before the request leaves the process. Terminal records distinguish completed, failed, and uncertain outcomes. A success whose terminal journal write fails is reported as `completed-audit-failed` rather than hiding the external write.

The interaction tools return identifiers, jump URLs, status, activity IDs, and send nonces, but do not echo message content. Discord's [message resource reference](https://docs.discord.com/developers/resources/message) documents allowed mentions, enforced nonces, replies, edits, reactions, and dynamic rate-limit behavior.

## Deletion workflow

1. Use `read_messages` or `get_message` to identify exact message IDs.
2. Call `plan_message_deletion` with one channel and those exact IDs.
3. Review every author, timestamp, content preview, attachment filename, execution strategy, and plan digest.
4. Call `delete_messages` with the unchanged channel, IDs, and digest.
5. Approve the MCP confirmation only if every displayed message is intended.
6. Review the returned activity ID and outcome.

Outstanding plan digests expire with the MCP process and are invalid after a restart. A changed or missing message also invalidates the plan.

Discord does not offer a conditional message-delete operation. The connector performs its final fresh read immediately before deletion, but a message can still be edited or removed in the narrow interval between that read and Discord processing the delete request. Exact IDs prevent a different message from being substituted at the target ID, and any resulting missing-message or partial failure is reported and journaled.

Discord's bulk deletion endpoint is used only for messages safely inside its supported age window. The connector deletes other reviewed messages individually and stops bounded individual execution after a failure.

## Member moderation workflow

Member moderation uses one reviewed action at a time and has no immediate-call path. Set `DISCORD_MCP_ALLOW_ADMINISTRATION=true`, list every eligible guild in `DISCORD_MCP_ADMIN_GUILD_IDS`, and list the bot operators, service accounts, break-glass accounts, or other ineligible targets in `DISCORD_MCP_PROTECTED_USER_IDS`. The administration guild allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the read allowlist is present.

Supported actions are `kick`, `ban`, `timeout`, `remove-timeout`, and `unban`. Ban accepts `deleteMessageSeconds` from 0 through 604800 and defaults to 0. Timeout requires `durationMinutes` from 1 through 40319, staying conservatively below Discord's 28-day limit. Every action requires a non-blank Discord audit-log reason whose URL-encoded form fits Discord's 512-character limit.

1. Call `plan_member_moderation` with the exact guild ID, user ID, action, audit reason, and action parameters.
2. Review the target ID and untrusted profile preview, current member, ban, or timeout state, required bot permission, role positions, parameters, reason, and keyed digest.
3. Call `execute_member_moderation` with identical inputs plus the digest.
4. Approve the signed MCP confirmation only if the exact target, action, parameters, reason, and digest remain intended.
5. Review the returned activity ID and outcome before attempting any follow-up.

Planning verifies the guild owner, current connector bot membership, complete guild roles, the exact target identity, and the action's current state. `KICK_MEMBERS` is required for kick, `BAN_MEMBERS` for ban and unban, and `MODERATE_MEMBERS` for timeout changes unless the bot has `ADMINISTRATOR`, which is still discouraged. For actions against a current member, the bot's highest role must be strictly above the target's highest role. The guild owner, the connector bot, configured protected IDs, and administrators targeted by timeout actions are rejected.

Kick, timeout, and timeout removal require a current exact member. Ban accepts a current member or an exact Discord user outside the guild, but rejects an existing ban. Unban requires an existing exact ban, and timeout removal requires a currently active timeout. Missing roles, duplicate or invalid role evidence, unknown member role IDs, mismatched Discord response identities, and equal role positions all fail closed.

The plan digest is process-keyed and covers the action, exact IDs, audit reason, numeric parameters, guild owner, bot and target roles, effective permissions, current ban state, and current timeout state. Display names and avatars do not affect freshness. Timeout plans bind the reviewed duration rather than an early wall-clock expiration; execution calculates the final expiration after approval. A connector restart invalidates outstanding digests.

Immediately before mutation, the service rebuilds the complete plan and requires the same digest. It then writes a pending activity record containing only IDs, action, digest, numeric parameters, timestamps, and status. Audit reasons, usernames, nicknames, role names, avatars, and Discord content are never persisted. Known Discord 4xx rejections are `failed`, transport failures and Discord 5xx responses are `uncertain`, and Discord 429 results preserve `retryAfterMs`. Do not retry an uncertain action until the target's current Discord state has been inspected.

## Verification

The default suite uses injected transports and does not contact Discord:

```sh
npm run metadata:check
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run pack:verify
npm run security:check
```

`pack:verify` rebuilds and packs twice under one npm toolchain, requires byte-identical archives, enforces the published-file allowlist, scans for sensitive environment values, installs the archive without lifecycle scripts, exercises the packaged CLI, negotiates the installed MCP catalogs, and reads only the static safety resource. CI also requires byte-identical decompressed tar payloads across supported Node lines because npm patch releases can encode the same payload with different gzip bytes. Neither check contacts Discord.

Generate and validate an SPDX production-dependency SBOM with `npm run --silent sbom -- --output sbom.spdx.json`. The release workflow attests the verified archive with that SBOM.

After building, verify the compiled CLI without contacting Discord:

```sh
node dist/cli.js doctor
node dist/cli.js help
node dist/cli.js version
```

The online doctor and MCP smoke verify the token, expected application ID, bot identity, guild membership page, content-free MCP catalogs, and read-only protocol path without listing Discord channels, reading messages, or performing member moderation:

```sh
node dist/cli.js doctor --online
node dist/cli.js smoke
```

`npm run probe:live` remains an alias for the online doctor JSON report. Operator reports print identifiers, counts, effective policy diagnostics, intent state, tool names, resource URIs, template URIs, and prompt names but never print the token. No default live command fetches message or search content.

## Release integrity

The npm package, source constant, lockfile root, MCP Registry manifest, versioned icon URL, and release tag are checked as one identity. Production and development dependencies are exactly pinned to the public npm registry. Dependency installation disables lifecycle scripts and explicitly rebuilds only the reviewed esbuild version. CI also audits known vulnerabilities and npm registry signatures.

Release candidates are reconstructed from the selected tag, packed twice, installed into an isolated consumer, accompanied by an SPDX SBOM, and signed through GitHub artifact attestations. Normal npm releases use trusted publishing to create a private stage. A human approves that stage with two-factor authentication before a separate workflow proves npm's SHA-512 integrity and registers the exact metadata through GitHub OIDC.

To verify a downloaded release archive:

```sh
npm pack @j-256/discord-mcp@0.1.0
gh attestation verify j-256-discord-mcp-0.1.0.tgz \
  --repo j-256/discord-mcp \
  --signer-workflow j-256/discord-mcp/.github/workflows/release.yml \
  --source-ref refs/tags/v0.1.0 \
  --deny-self-hosted-runners
gh attestation verify j-256-discord-mcp-0.1.0.tgz \
  --repo j-256/discord-mcp \
  --signer-workflow j-256/discord-mcp/.github/workflows/release.yml \
  --source-ref refs/tags/v0.1.0 \
  --deny-self-hosted-runners \
  --predicate-type https://spdx.dev/Document/v2.3
```

The [release runbook](docs/releasing.md) covers the one-time bootstrap, protected npm staging, human approval, registry registration, and independent verification.

## Expansion

New Discord capabilities should follow the existing layers:

1. Add a narrow REST method to `DiscordClient`.
2. Apply guild and channel scope in `ScopePolicy`.
3. Normalize Discord data in the service layer.
4. Register an accurately annotated MCP tool.
5. Add transport, policy, service, and MCP contract tests.

Gateway subscriptions, channel and role administration through the reviewed-plan core, slash commands, and client-native progressive discovery can be added without changing the interaction, deletion, member-moderation, resource, prompt, or distribution safety paths. Discord Interaction endpoints must verify Discord signatures with the application public key and should remain separate from the local stdio process.

## License

AGPL-3.0-only
