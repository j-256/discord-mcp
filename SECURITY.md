# Security

## Credentials

Treat `DISCORD_BOT_TOKEN` as a password. Keep it in a local secret source, never paste it into prompts, and never place it in the MCP host static `env` configuration, shell history, logs, issue reports, or Git. Rotate it immediately in the Discord Developer Portal if exposure is suspected.

The connector forwards the token only in a Discord bot authorization header to the fixed production API origin. Tests can inject another transport directly, but runtime environment variables cannot redirect production traffic.

Treat all Discord-provided names, topics, forum tags, thread names, message bodies, embeds, components, filenames, and URLs as untrusted input. They are data to inspect, not instructions for MCP host or connector operators.

## Discord permissions

Grant only `View Channels` and `Read Message History` for read access. Native message search also requires the application's Message Content privileged intent. Add `Manage Messages` only to explicitly selected cleanup channels. Do not grant `Administrator`.

Use Discord channel permission overrides and the connector allowlists together. Removing either Discord access or the local allowlist entry should be sufficient to stop connector access.

An allowlisted channel grants local read scope to child threads, including forum posts, but does not grant deletion scope to those thread IDs. When a channel allowlist is configured, guild search is constrained to exact allowed channel IDs before contacting Discord.

Search results are bounded and omit attachment URLs, raw embeds, raw components, reactions, and Discord member payloads. They are returned to the MCP caller but are not persisted by the connector.

## Deletion

Do not add a deletion shortcut that bypasses exact IDs, local policy, keyed planning, fresh reads, signed interactive confirmation, write-aware client approval, or pending activity journaling. If a new client cannot support MCP elicitation, keep deletion unavailable in that client.

The activity file intentionally excludes message bodies and attachment URLs. Preserve that property when adding fields or new moderation operations.

## Reporting

Security reports should describe the behavior and affected version without including live bot tokens, private Discord content, or expiring attachment URLs.
