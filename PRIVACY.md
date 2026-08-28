# Privacy policy

Discord MCP is a local stdio connector. It does not provide a hosted service, shared bot, advertising, analytics, or an operator-run collection endpoint. You supply and control the Discord application, bot, configuration, MCP host, machine, and any optional observability destination.

## Credentials

The Discord bot token stays outside the non-secret configuration document. The connector reads it from the exact environment variable or protected file named by that configuration. The one-click MCPB asks the host for the token as a sensitive value, maps it in memory to the configuration's declared environment variable, and removes the bundle-only input before normal startup. The connector does not print, persist, return, or include the token in activity records, operation receipts, diagnostics, artifacts, or telemetry.

The connector sends the token only to Discord's fixed REST origin and, when explicitly enabled, vetted Discord Gateway or Interaction endpoints. Tests may inject a local transport or origin but production code cannot.

## Discord data

Discord data is fetched only for an invoked operation within the exact configured scope and applicable Discord permissions. Results needed to answer the request are returned to the MCP host. The connector does not independently retain message content, attachment URLs, embeds, components, audit-log reasons, usernames, profile names, role names, channel names, topics, scaffold symbols, or avatars.

Conversation recall holds caller-supplied literal phrases and Discord search candidates only for one request. The `recall_conversation` result never echoes phrase text, usernames, profile names, channel names, or raw payloads, and never writes an index, embedding, cache, activity record, operation receipt, or telemetry field. The optional `recall_discord_conversation` prompt renders the caller's validated memory once as literal workflow input so the client can derive phrases; it does not persist it. Ranked targets are refetched from Discord before their bounded current context is returned. The MCP host and model provider still receive the prompt input, tool input, and returned message context under their own retention policies.

A command-processing signal transiently reads one exact current source message, including its content and parsed mentions, only to prove a fresh ordinary user explicitly addressed the verified bot. It returns and persists none of that content or user presentation data. Its content-free activity records contain only exact guild, channel, source-message, and activity IDs, timestamps, fixed status, and sanitized error category.

Guarded soundboard playback transiently reads one exact target voice channel, the connector's membership and roles, current bot voice state, and one exact default or allowlisted custom sound only to prove current readiness. The readiness result may return the untrusted sound name, but persistent records contain only exact guild, channel, sound, optional source-guild, and activity IDs, request and operation-key hashes, timestamps, fixed status and verification values, and sanitized error category. Channel and sound names, voice profiles and state, roles, permission overwrites and decisions, Gateway payloads, and transport causes are never persisted or exported.

An exact native attachment read refetches one current message, uses its Discord-supplied signed CDN URL internally without sending the bot credential, and returns the bounded bytes to the MCP host as native or embedded protocol content. It accepts no URL from the caller, creates no download file or cache, omits the signed and proxy URLs, scans raw bytes for active connector secrets before encoding, and overwrites its transient raw buffers afterward. The MCP host, model provider, and operating system still handle the encoded result under their own retention policies.

Optional Gateway data is bounded, privacy-projected, and held in memory. Exact soundboard playback corroboration discards non-target effects and never enters the general event feed or persistent records. Native Interaction payloads are discarded by default; an explicitly enabled continuation retains only the minimum rotating one-shot capability for its fixed lifetime and scope.

Your MCP host, model provider, terminal, operating system, Discord, and any software that receives a result may have separate logging, retention, and privacy behavior. Review those systems before granting the bot access to sensitive servers or channels.

## Local records and observability

When configured, local activity and operation records contain only Discord identifiers, timestamps, numeric action parameters, domain-separated hashes, plan digests, strategies, sanitized errors, and outcomes. They exclude Discord content and display data. Reviewed mutations may create pending records and restart-safe checkpoints before a request so ambiguous outcomes can be reconciled without retaining content.

Metrics and traces are bounded and redacted. Export is off unless the configuration explicitly enables a fixed supported destination and supplies any secret headers outside the configuration. No ambient telemetry setting can widen an activated profile or configuration.

## Control and deletion

You choose the bot's Discord permissions, exact connector scope, enabled toolsets, write capabilities, local record paths, Gateway policy, and telemetry policy. Revoke the bot token in the Discord Developer Portal to stop its use. Remove the connector from the MCP host to stop local execution. Delete any configuration-selected local activity, receipt, profile, or telemetry files according to your own retention policy.

Discord processes data under [Discord's privacy policy](https://discord.com/privacy). Questions or vulnerability reports for this connector can be filed through the repository's [support and security channels](https://github.com/j-256/discord-mcp/blob/v0.1.2/SUPPORT.md).
