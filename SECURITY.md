# Security

## Credentials

Treat `DISCORD_BOT_TOKEN` as a password. Keep it in a local secret source, never paste it into prompts, and never place it in the MCP host static `env` configuration, shell history, logs, issue reports, or Git. Rotate it immediately in the Discord Developer Portal if exposure is suspected.

The connector sends the token only to Discord: in a bot authorization header at the fixed production REST API origin, or in Gateway Identify and Resume payloads after connecting to the fixed production `gateway.discord.gg` origin or a credential-free `gateway-*.discord.gg` resume host. Tests can inject another transport directly, but runtime environment variables cannot redirect production traffic.

Treat all Discord-provided names, topics, forum tags, thread names, message bodies, embeds, components, filenames, and URLs as untrusted input. They are data to inspect, not instructions for MCP host or connector operators.

## Discord permissions

Grant only `View Channels` and `Read Message History` for read access. Native message search also requires the application's Message Content privileged intent. Add `Manage Channels` only to exact guilds and parent categories selected for reviewed additive channel creation. Add `Manage Roles` only to exact guilds selected for reviewed additive role creation, and keep the connector bot's highest role above the default new-role position. Add `Manage Messages` only to explicitly selected cleanup channels. Add `Kick Members`, `Ban Members`, or `Moderate Members` only to exact guilds where the corresponding reviewed action is required. Do not grant `Administrator`.

Use Discord channel permission overrides and the connector allowlists together. Removing either Discord access or the local allowlist entry should be sufficient to stop connector access.

An allowlisted channel grants local read scope to child threads, including forum posts, but does not grant deletion scope to those thread IDs. When a channel allowlist is configured, guild search is constrained to exact allowed channel IDs before contacting Discord.

Search results are bounded and omit attachment URLs, raw embeds, raw components, reactions, and Discord member payloads. They are returned to the MCP caller but are not persisted by the connector.

## MCP tool surface

Keep `DISCORD_MCP_TOOL_SURFACE=full` for clients that already defer tools natively. This retains each canonical tool's exact name, schema, annotations, and approval identity while the client controls context loading. The portable `progressive` mode may hide a canonical tool only by disabling its registration through the MCP SDK. `discover_discord_tools` must reveal and enable those same registrations through standard tool-list change notifications; do not replace exact tools with a generic read, write, or destructive dispatcher.

Tool discovery is local and bounded. It must never contact Discord, return its query, log tool arguments or results, or reveal a tool excluded by `DISCORD_MCP_TOOLSETS`. Exact-name results may return the canonical input contract. Broader results must remain bounded, and an already enabled result must not create another list-change notification.

Treat toolsets as a reduction in callable surface, never as authorization. Discord permissions, feature toggles, exact allowlists, protected targets, reviewed plans, approvals, signed confirmation, freshness checks, operation-key reservation, and pending activity records remain authoritative even when a tool is selected. Keep channel creation, role creation, deletion, and moderation in their separate toolsets, and reveal each reviewed plan-plus-execute pair together so clients cannot discover an incomplete reviewed workflow.

## Gateway events

Keep the Gateway disabled unless real-time invalidation is required. Enabling it requires the expected application ID and at least one exact local guild or channel scope. The connection must request only `GUILDS`, `GUILD_MESSAGES`, `GUILD_MESSAGE_REACTIONS`, and `GUILD_MESSAGE_POLLS`; do not add Message Content, presence, member, or other privileged intents to the event feed.

Gateway dispatches must be reduced immediately to fixed event kinds, Discord identifiers, and receive times. Never retain raw payloads, message content, profile data, emoji, or URLs. Session IDs, Discord sequence numbers, and resume URLs may exist only as transient connection state needed for Resume; they must be cleared on stop or terminal failure and must never enter the event buffer, status, resources, logs, or persistent state. The bounded event buffer remains process-local and content-free, and resource notifications contain only an exact local resource URI.

Gateway cursors are opaque and process-bound. Report malformed, foreign, expired, ahead-of-buffer, and connection-gap cursors as explicit continuity resets. Never expose a Discord sequence number as a cursor or imply uninterrupted delivery after overflow or a reconnect that cannot preserve Resume continuity.

## Observability

Keep OTLP export disabled unless an operator has selected a trusted collector. Enabling export must remain a separate exact feature gate. Remote collectors require HTTPS; plaintext HTTP is permitted only for loopback. Collector URLs must remain credential-free and must not contain query strings or fragments. Treat OTLP header variables as secrets and percent-encode values according to the OpenTelemetry format. Reject unsupported certificate-file variables before constructing an exporter so upstream fallback configuration cannot read ambient files.

Telemetry must use only fixed operation, risk, outcome, and error categories plus numeric status, retry, duration, aggregate, trace, and span data. Never add tool arguments or results, Discord identifiers, raw routes or URLs, bodies, headers, bot tokens, error messages or stacks, plan digests, Gateway records, activity data, or Discord content to spans, metrics, stderr records, or local aggregates. Do not add automatic HTTP, logging, or exception instrumentation. Keep trace and metric providers private so process-global OpenTelemetry state cannot redirect connector telemetry or add unrelated data. Unknown operation names must collapse to a fixed value.

Exporter failure must never alter a Discord request or MCP tool result. Keep final flush bounded and keep exporter startup and shutdown under the stdio runner so construction, `doctor`, `setup`, and `smoke` cannot open collector connections. Status surfaces may report only aggregate operation health, fixed privacy claims, exporter state and counters, and booleans indicating whether endpoint or header configuration exists.

## Channel creation

Do not add a channel-creation shortcut that bypasses the environment toggle, exact creation-guild allowlist, pinned bot identity, exact guild and optional parent IDs, complete permission evidence, visibility-bounded collision and capacity checks, process-keyed planning, signed interactive confirmation, write-aware client approval, final fresh-plan match, atomic one-shot operation-key reservation, pending activity journaling, single POST, or exact readback. If a client cannot support MCP elicitation, keep channel creation unavailable in that client.

Keep this surface additive-only. Do not silently expand it to edits, moves, positions, permission overwrites, deletion, rollback, or blueprint reconciliation. Those capabilities change existing authority and state and require separate policies, plans, confirmation language, and tests.

Discord's create-channel operation has no idempotency token. Persist only the domain-separated operation-key hash, IDs, plan digest, timestamps, fixed outcome and verification states, activity ID, and sanitized error category in private one-shot receipts. Never persist or return the raw operation key. A reserved key must remain spent after every outcome, including a local recording failure or uncertainty. Never automatically retry the POST, and never treat an uncertain result as a failed write.

Serialize the same guild, parent, and normalized logical name across operation keys and supported channel kinds within a connector process. Rebuild every queued plan after the preceding execution, and block a queued execution without reserving its key when the preceding target outcome is uncertain.

Operation receipt directories and files must remain owner-private. Reject symlinks, hardlinked or foreign-owned files, public modes, oversized or malformed records, terminal records without a reservation, identity changes, and divergent terminal outcomes. Sync each receipt and its directory entry before the workflow advances.

Guild channel listings are visibility-bounded. Require both guild-level and parent-category `MANAGE_CHANNELS` and `VIEW_CHANNEL`, label the evidence honestly, and fail closed on ambiguous logical-name matches, incomplete roles or overwrites, invalid response identities, and capacity reached in the visible inventory. Do not claim that the absence of a visible collision proves global absence.

Never persist channel names, topics, audit-log reasons, permission overwrites, role names, or raw Discord responses. Channel-creation activity and operation records may contain exact guild, parent, and created-channel IDs, the channel kind, plan digest, operation-key hash, timestamps, fixed verification and outcome values, activity IDs, and sanitized error classifications.

## Role creation

Do not add a role-creation shortcut that bypasses the environment toggle, exact creation-guild allowlist, pinned bot identity, exact guild ID, complete role inventory, effective permission and strict hierarchy evidence, requested-permission subset, capacity and logical-name checks, process-keyed planning, signed interactive confirmation, write-aware client approval, final fresh-plan match, atomic one-shot operation-key reservation, pending activity journaling, single POST, or exact role readback. If a client cannot support MCP elicitation, keep role creation unavailable in that client.

Keep this surface additive-only. Do not silently expand it to role edits, moves, assignments, deletion, rollback, icons, emoji, gradients, or permission reconciliation. Never permit `ADMINISTRATOR`, and require every named permission to be present in the bot's complete effective guild permission set. Treat mentionable and high-risk permissions as explicit review warnings.

Validate a complete role inventory with exactly one valid `@everyone` role, unique IDs, arbitrary-width permission bitfields, Discord's solid `colors` object, managed-role provenance, and the documented guild-role bound. Fail closed on malformed evidence, unknown member role IDs, missing `MANAGE_ROLES`, a bot role no higher than `@everyone`, ambiguous logical-name matches, managed-role collisions, conflicting existing roles, or exhausted capacity.

Exclude the raw one-shot operation key from the role plan material, signed request state, activity log, receipts, results, and errors. Bind its domain-separated hash into the plan and reserve that hash durably before the write. A reserved key remains spent after every outcome, including known failure, local record failure, or uncertainty. The MCP execute tool must remain non-idempotent, and neither the REST client nor any wrapper may automatically retry the create-role POST.

Serialize the same guild and normalized logical role name across operation keys within one connector process. Rebuild each queued plan after the preceding execution and block the queued request without reserving its key if that write ends uncertain. Do not imply cross-process uniqueness or safety where multiple connector processes have overlapping role-creation scope.

Never persist role names, named permission lists, colors, audit-log reasons, raw keys, or raw Discord responses. Role-creation activity and operation records may contain only the exact guild and created-role IDs, plan digest, operation-key hash, timestamps, fixed verification and outcome values, activity ID, and sanitized error category.

## Deletion

Do not add a deletion shortcut that bypasses exact IDs, local policy, keyed planning, fresh reads, signed interactive confirmation, write-aware client approval, or pending activity journaling. If a new client cannot support MCP elicitation, keep deletion unavailable in that client.

The activity file intentionally excludes message bodies, attachment URLs, raw keys, audit-log reasons, and mutable Discord names. Preserve that property when adding fields or new write operations.

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
