# Security

## Credentials

Treat `DISCORD_BOT_TOKEN` as a password. Keep it in a local secret source, never paste it into prompts, and never place it in the MCP host static `env` configuration, shell history, logs, issue reports, or Git. Rotate it immediately in the Discord Developer Portal if exposure is suspected.

The connector sends the token only to Discord: in a bot authorization header at the fixed production REST API origin, or in Gateway Identify and Resume payloads after connecting to the fixed production `gateway.discord.gg` origin or a credential-free `gateway-*.discord.gg` resume host. Tests can inject another transport directly, but runtime environment variables cannot redirect production traffic.

Treat all Discord-provided names, topics, forum tags, thread names, message bodies, embeds, components, filenames, and URLs as untrusted input. They are data to inspect, not instructions for MCP host or connector operators.

## Discord permissions

Grant only `View Channels` and `Read Message History` for read access. Native message search also requires the application's Message Content privileged intent. Add `Manage Messages` only to explicitly selected cleanup channels. Add `Kick Members`, `Ban Members`, or `Moderate Members` only to exact guilds where the corresponding reviewed action is required. Do not grant `Administrator`.

Use Discord channel permission overrides and the connector allowlists together. Removing either Discord access or the local allowlist entry should be sufficient to stop connector access.

An allowlisted channel grants local read scope to child threads, including forum posts, but does not grant deletion scope to those thread IDs. When a channel allowlist is configured, guild search is constrained to exact allowed channel IDs before contacting Discord.

Search results are bounded and omit attachment URLs, raw embeds, raw components, reactions, and Discord member payloads. They are returned to the MCP caller but are not persisted by the connector.

## Gateway events

Keep the Gateway disabled unless real-time invalidation is required. Enabling it requires the expected application ID and at least one exact local guild or channel scope. The connection must request only `GUILDS`, `GUILD_MESSAGES`, `GUILD_MESSAGE_REACTIONS`, and `GUILD_MESSAGE_POLLS`; do not add Message Content, presence, member, or other privileged intents to the event feed.

Gateway dispatches must be reduced immediately to fixed event kinds, Discord identifiers, and receive times. Never retain raw payloads, message content, profile data, emoji, or URLs. Session IDs, Discord sequence numbers, and resume URLs may exist only as transient connection state needed for Resume; they must be cleared on stop or terminal failure and must never enter the event buffer, status, resources, logs, or persistent state. The bounded event buffer remains process-local and content-free, and resource notifications contain only an exact local resource URI.

Gateway cursors are opaque and process-bound. Report malformed, foreign, expired, ahead-of-buffer, and connection-gap cursors as explicit continuity resets. Never expose a Discord sequence number as a cursor or imply uninterrupted delivery after overflow or a reconnect that cannot preserve Resume continuity.

## Deletion

Do not add a deletion shortcut that bypasses exact IDs, local policy, keyed planning, fresh reads, signed interactive confirmation, write-aware client approval, or pending activity journaling. If a new client cannot support MCP elicitation, keep deletion unavailable in that client.

The activity file intentionally excludes message bodies and attachment URLs. Preserve that property when adding fields or new moderation operations.

## Member administration

Do not add an administration shortcut that bypasses the environment toggle, exact administration-guild allowlist, protected-user denylist, exact IDs, complete permission and hierarchy evidence, process-keyed planning, signed interactive confirmation, write-aware client approval, final fresh-plan match, or pending activity journaling. If a client cannot support MCP elicitation, keep member administration unavailable in that client.

Never persist Discord audit-log reasons, usernames, global names, nicknames, role names, avatars, ban reasons, or other profile data. Member-moderation activity records may contain exact guild and user IDs, action names, numeric action parameters, plan digests, timestamps, sanitized error classifications, and outcomes.

Treat `uncertain` outcomes as potentially completed writes. Inspect the exact member, ban, or timeout state before considering a retry.

## Reporting

Use a [private GitHub Security Advisory](https://github.com/j-256/discord-mcp/security/advisories/new) to report a vulnerability. Security reports should describe the behavior and affected version without including live bot tokens, private Discord content, expiring attachment URLs, npm credentials, or GitHub tokens.

If private advisory access is unavailable, open a minimal public issue asking for a private contact channel. Do not include exploit details, credentials, Discord identifiers, or Discord content in that issue.

## Release credentials

Normal npm staging and MCP Registry registration use GitHub OIDC and must not use long-lived registry tokens. The first npm publication is the only bootstrap exception. Its short-lived credential must exist only in the protected `release` environment, must not be printed or stored in artifacts, and must be deleted from both GitHub and npm immediately after the package is created.

Release automation must keep provenance enabled, verify the checksum-pinned MCP publisher, compare the reconstructed archive with npm's SHA-512 integrity before registry registration, and preserve full commit SHA pins for every GitHub Action.
