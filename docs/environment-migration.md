# Migrate legacy environment policy to a configuration file

[Project overview](../README.md) | [Complete reference](reference.md#configuration)

Discord MCP operational commands require one schema-v2 configuration file or managed profile. Legacy policy environment variables remain accepted only as inputs to the migration command and lower-level compatibility APIs. The runtime environment should contain the secret variables referenced by the selected document, plus `DISCORD_MCP_CONFIG_FILE` only when it is used instead of `--config`.

> Do not use this catalog to configure a new deployment. Use one strict JSON policy file plus the bot-token secret it references. Add collector-header secrets only when the document enables an authenticated telemetry exporter.

The configuration document is deliberately non-secret. It owns verified public identity, exact Discord scope, tool selection, capabilities, limits, storage, Gateway behavior, runtime settings, and observability policy. Bot tokens and collector headers stay in the launcher's secret store and appear in the document only as environment-variable references.

## Convert an environment policy

Export the legacy policy once in a trusted local process, then write and validate a strict document:

```sh
discord-mcp config migrate ./discord-mcp.json --name discord
discord-mcp config validate ./discord-mcp.json
discord-mcp config show ./discord-mcp.json
```

The migration fails on missing required identity or scope, unknown or conflicting policy, unsafe paths, invalid cross-field combinations, and a destination that already exists. Add `--force` only after inspecting the existing target; replacement preserves a recoverable hidden backup and refuses an identity change.

After conversion, remove legacy policy variables from the MCP launch configuration. Keep only each secret variable named by the document and select the policy explicitly:

```sh
discord-mcp doctor --config ./discord-mcp.json
discord-mcp doctor --config ./discord-mcp.json --online
discord-mcp smoke --config ./discord-mcp.json
discord-mcp serve --config ./discord-mcp.json
```

A schema-v1 managed profile converts through the same boundary:

```sh
discord-mcp config migrate ./discord-mcp.json --profile PROFILE_NAME
```

Schema-v1 profiles remain inspectable so operators can recover their settings, but `serve`, `doctor`, `smoke`, `setup`, and `coordination` reject them until conversion. This prevents ambient variables from silently extending an incomplete legacy profile.

Use `discord-mcp config explain [PATH]` for schema-backed operational descriptions and the published [JSON Schema](../discord-mcp.config.schema.json) for editor validation. Add `--migration` only when a legacy environment-variable name is needed during conversion.

## Legacy input catalog

The catalog below documents migration inputs. Except for referenced secrets and the optional config-file selector, these variables are not an operational configuration interface.

<details>
<summary>Show migration-only environment variable catalog</summary>

| Environment variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot authentication |
| `DISCORD_MCP_CONFIG_FILE` | Alternative to `--config` | Absolute path to one strict versioned non-secret configuration document |
| `DISCORD_MCP_APPLICATION_ID` | Recommended | Reject a token belonging to a different application |
| `DISCORD_MCP_BOT_ID` | Recommended | Reject a token belonging to a different bot user |
| `DISCORD_MCP_ALLOWED_GUILD_IDS` | No | Comma- or whitespace-separated read guild allowlist |
| `DISCORD_MCP_ALLOWED_CHANNEL_IDS` | No | Comma- or whitespace-separated read channel allowlist |
| `DISCORD_MCP_TOOL_SURFACE` | No | `full` advertises every selected canonical tool; `progressive` initially advertises only exact-tool discovery; defaults to `full` |
| `DISCORD_MCP_TOOLSETS` | No | `all` or a comma-separated selection of `activity`, `announcement-crossposts`, `announcement-subscriptions`, `application-emojis`, `attachments`, `audit-logs`, `automod`, `bans`, `channel-cloning`, `channel-creation`, `channel-deletion`, `channel-metadata`, `channel-ordering`, `connector`, `deletion`, `forum-posts`, `forum-tags`, `gateway`, `guild-expressions`, `guild-profile`, `guild-scaffolds`, `guild-settings`, `guild-templates`, `guilds`, `integrations`, `interactions`, `invites`, `member-nicknames`, `member-roles`, `members`, `message-forwarding`, `messages`, `moderation`, `native-interactions`, `observability`, `onboarding`, `permission-overwrites`, `permissions`, `pins`, `polls`, `role-configuration`, `role-creation`, `role-deletion`, `role-ordering`, `roles`, `scheduled-events`, `soundboard`, `stage-instances`, `thread-governance`, `threads`, `voice-moderation`, `webhooks`, `welcome-screen`, and `widget-settings`; defaults to `all` |
| `DISCORD_MCP_ALLOW_GATEWAY` | For real-time events | Must be exactly `true`; also requires application and bot IDs plus at least one exact read allowlist |
| `DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE` | No | Process-local content-free event capacity from 1 to 1000; defaults to 100 |
| `DISCORD_MCP_ALLOW_NATIVE_COMMAND_CHANGES` | For managed command installation or removal | Must be exactly `true`; also requires pinned application and bot IDs plus exact native Interaction guild scope |
| `DISCORD_MCP_ALLOW_NATIVE_INTERACTIONS` | For native Interaction ingress | Must be exactly `true`; also requires pinned application and bot IDs plus non-empty exact guild, channel, and user allowlists |
| `DISCORD_MCP_NATIVE_COMMAND_NAME` | No | Exact lowercase managed command name; defaults to `discord-mcp` |
| `DISCORD_MCP_NATIVE_INTERACTION_GUILD_IDS` | For command changes or ingress | Exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_NATIVE_INTERACTION_CHANNEL_IDS` | For ingress | Exact direct guild channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_NATIVE_INTERACTION_USER_IDS` | For ingress | Exact user allowlist for command submitters |
| `DISCORD_MCP_NATIVE_INTERACTION_MAX_PENDING` | No | Process-local pending-request capacity from 1 to 100; defaults to 25 |
| `DISCORD_MCP_NATIVE_INTERACTION_TTL_SECONDS` | No | Pending-request lifetime from 30 to 840 seconds; defaults to 600 |
| `DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT` | For OTLP export | Must be exactly `true` before any collector connection can open |
| `DISCORD_MCP_OBSERVABILITY_LOGS` | No | Emit privacy-safe one-line operational JSON to stderr; defaults to `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Credential-free base collector URL; defaults to `http://localhost:4318` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | No | Exact per-signal endpoints overriding the base; HTTPS is required except for loopback |
| `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS`, `OTEL_EXPORTER_OTLP_METRICS_HEADERS` | No | Percent-encoded `key=value` collector headers; per-signal values override shared names |
| `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | No | Must resolve to `http/protobuf` |
| `OTEL_EXPORTER_OTLP_COMPRESSION`, `OTEL_EXPORTER_OTLP_TRACES_COMPRESSION`, `OTEL_EXPORTER_OTLP_METRICS_COMPRESSION` | No | `none` or `gzip`; per-signal values override the shared value |
| `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`, `OTEL_EXPORTER_OTLP_METRICS_TIMEOUT` | No | Export timeout from 1 to 60000 milliseconds; defaults to 10000 |
| `OTEL_SERVICE_NAME` | No | Safe exported service name; defaults to `discord-mcp` |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | No | Bounded sampler and optional ratio from 0 through 1 |
| `DISCORD_MCP_ALLOW_ATTACHMENTS` | For attachment messages | Must be exactly `true` to enable reviewed local-file attachment messages |
| `DISCORD_MCP_ATTACHMENT_CHANNEL_IDS` | For attachment messages | Non-empty exact channel or thread allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ATTACHMENT_ROOTS` | For attachment messages | One absolute canonical owned directory, or a JSON array of such directories, containing eligible local files |
| `DISCORD_MCP_ATTACHMENT_MAX_BYTES` | No | Per-file ceiling from 1 byte through 10 MiB; defaults to 10 MiB |
| `DISCORD_MCP_ALLOW_ADMINISTRATION` | For member moderation | Must be exactly `true` to enable reviewed member administration |
| `DISCORD_MCP_ADMIN_GUILD_IDS` | For member moderation | Non-empty exact administration-guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_PROTECTED_USER_IDS` | No | Exact user IDs that other-member nickname changes, member administration, member-role changes, member voice changes, thread-member removals, and reaction-user moderation must never target; defaults empty and is bounded to 100 configured IDs |
| `DISCORD_MCP_ALLOW_MEMBER_DIRECTORY` | For member reads | Must be exactly `true` to enable privacy-minimized exact, cursor, and prefix member reads |
| `DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS` | For member reads | Non-empty exact member-directory guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_BAN_AUDIT` | For guild ban audit | Must be exactly `true` to enable privacy-minimized exact and cursor ban reads |
| `DISCORD_MCP_BAN_AUDIT_GUILD_IDS` | For guild ban audit | Non-empty exact ban-audit guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_NICKNAME_CHANGES` | For current-bot nickname changes | Must be exactly `true` to enable reviewed self-only nickname changes or clearing; requires pinned application and bot IDs |
| `DISCORD_MCP_ALLOW_OTHER_MEMBER_NICKNAME_CHANGES` | For other-member nickname changes | Must be exactly `true` in addition to the base nickname gate to enable the broader exact-member route |
| `DISCORD_MCP_NICKNAME_GUILD_IDS` | For nickname changes | Non-empty exact guild allowlist bounded to 100 IDs and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES` | For member-role changes | Must be exactly `true` to enable reviewed exact role additions and removals; activates nonprivileged layout evidence and requires pinned application and bot IDs |
| `DISCORD_MCP_MEMBER_ROLE_GUILD_IDS` | For member-role changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_MEMBER_ROLE_IDS` | For member-role changes | Non-empty exact role allowlist bounded to 100 configured IDs |
| `DISCORD_MCP_ALLOW_MEMBER_VOICE_AUDIT` | For member voice-state reads | Must be exactly `true` to enable exact privacy-minimized member voice-state audit |
| `DISCORD_MCP_ALLOW_MEMBER_VOICE_CHANGES` | For member voice changes | Must be exactly `true` in addition to voice audit to enable reviewed move, disconnect, server-mute, and server-deafen changes |
| `DISCORD_MCP_MEMBER_VOICE_GUILD_IDS` | For member voice audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_MEMBER_VOICE_CHANNEL_IDS` | For member voice audit or changes | Non-empty exact ordinary voice or read-only Stage channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_CHANNEL_CREATION` | For channel creation | Must be exactly `true` to enable reviewed additive channel creation |
| `DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS` | For channel creation | Non-empty exact channel-creation guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_CHANNEL_CLONE_AUDIT` | For channel-clone planning | Must be exactly `true` to activate complete obfuscation-safe Gateway and HTTP evidence for exact clone sources; also requires pinned application and bot IDs |
| `DISCORD_MCP_ALLOW_CHANNEL_CLONING` | For channel cloning | Must be exactly `true` in addition to clone audit to enable reviewed atomic same-guild clones |
| `DISCORD_MCP_CHANNEL_CLONE_GUILD_IDS` | For channel-clone planning or execution | Non-empty exact guild allowlist bounded to 100 IDs and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_CHANNEL_CLONE_SOURCE_IDS` | For channel-clone planning or execution | Non-empty exact direct source-channel allowlist bounded to 100 IDs and a subset of ordinary readable scope |
| `DISCORD_MCP_ALLOW_CHANNEL_METADATA_CHANGES` | For channel metadata and voice-status changes | Must be exactly `true` to enable reviewed partial metadata changes and exact ordinary voice-channel status reads or changes |
| `DISCORD_MCP_CHANNEL_METADATA_IDS` | For channel metadata and voice-status changes | Non-empty exact non-thread guild-channel allowlist and a subset of the read channel allowlist when one exists; voice-status tools reject every type except ordinary voice |
| `DISCORD_MCP_ALLOW_CHANNEL_ORDERING_AUDIT` | For channel-order audit | Must be exactly `true` to activate complete obfuscation-safe Gateway layout evidence for exact guilds; also requires pinned application and bot IDs |
| `DISCORD_MCP_ALLOW_CHANNEL_ORDERING_CHANGES` | For channel-order changes | Must be exactly `true` in addition to channel-order audit to enable reviewed exact relative changes |
| `DISCORD_MCP_CHANNEL_ORDERING_GUILD_IDS` | For channel-order audit or changes | Non-empty exact guild allowlist bounded to 100 IDs and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_CHANNEL_DELETION_AUDIT` | For channel-retirement readiness | Must be exactly `true` to activate complete Gateway topology plus exact dependency and permission evidence; also requires pinned application and bot IDs and Gateway mode |
| `DISCORD_MCP_ALLOW_CHANNEL_DELETIONS` | For channel retirement | Must be exactly `true` in addition to channel-deletion audit to enable reviewed irreversible deletion |
| `DISCORD_MCP_CHANNEL_DELETION_IDS` | For channel-retirement audit or execution | Non-empty exact direct-channel allowlist bounded to 100 IDs and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_FORUM_POSTS` | For forum posts | Must be exactly `true` to enable reviewed public forum-post creation |
| `DISCORD_MCP_FORUM_POST_CHANNEL_IDS` | For forum posts | Non-empty exact forum-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_FORUM_TAG_AUDIT` | For forum-tag inventory | Must be exactly `true` to enable complete transient ordered tag audit for stable forums |
| `DISCORD_MCP_ALLOW_FORUM_TAG_CHANGES` | For forum-tag changes | Must be exactly `true` in addition to forum-tag audit to enable reviewed exact create, metadata update, or deletion |
| `DISCORD_MCP_FORUM_TAG_CHANNEL_IDS` | For forum-tag audit or changes | Non-empty exact stable-forum allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_THREAD_CREATION` | For thread creation | Must be exactly `true` to enable reviewed message-anchored, standalone public, or standalone private thread creation |
| `DISCORD_MCP_THREAD_PARENT_IDS` | For thread creation | Non-empty exact text or announcement parent-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_THREAD_AUDIT` | For exact thread-state or membership reads | Must be exactly `true` to enable privacy-minimized exact thread audit without member enumeration |
| `DISCORD_MCP_ALLOW_THREAD_CHANGES` | For thread governance | Must be exactly `true` in addition to thread audit to enable reviewed lifecycle, metadata, and membership changes |
| `DISCORD_MCP_THREAD_GUILD_IDS` | For thread audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_THREAD_IDS` | For thread audit or changes | Non-empty exact thread allowlist and a subset of the read channel allowlist |
| `DISCORD_MCP_THREAD_MEMBER_USER_IDS` | For exact thread-membership reads or changes | Exact target-user allowlist bounded to 100 configured IDs; member actions require an entry |
| `DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS` | For guild scaffolds | Must be exactly `true` to enable reviewed resumable additive guild scaffolds |
| `DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS` | For guild scaffolds | Non-empty exact scaffold-guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_GUILD_TEMPLATE_AUDIT` | For Guild Template inventory | Must be exactly `true` to enable capability-safe native Guild Template reads; activates nonprivileged layout evidence and requires pinned application and bot IDs |
| `DISCORD_MCP_ALLOW_GUILD_TEMPLATE_CHANGES` | For Guild Template changes | Must be exactly `true` in addition to Guild Template audit to enable reviewed create, synchronize, metadata-update, or delete actions |
| `DISCORD_MCP_GUILD_TEMPLATE_GUILD_IDS` | For Guild Template audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_ROLE_CREATION` | For role creation | Must be exactly `true` to enable reviewed additive role creation |
| `DISCORD_MCP_ROLE_CREATION_GUILD_IDS` | For role creation | Non-empty exact role-creation guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_ROLE_CONFIGURATION` | For role configuration | Must be exactly `true` to enable reviewed partial changes to exact standard roles |
| `DISCORD_MCP_ROLE_CONFIGURATION_IDS` | For role configuration | Non-empty exact standard-role allowlist bounded to 100 configured IDs |
| `DISCORD_MCP_ALLOW_ROLE_DELETION_AUDIT` | Compatibility only for role-retirement readiness | Must be exactly `true` to activate complete holder, hierarchy, dependency, permission, and Gateway-layout evidence; also requires pinned application and bot IDs, exact read-guild scope, and Gateway mode |
| `DISCORD_MCP_ALLOW_ROLE_DELETIONS` | Compatibility only for role retirement | Must be exactly `true` in addition to role-deletion audit to enable reviewed irreversible deletion |
| `DISCORD_MCP_ROLE_DELETION_IDS` | Compatibility only for role-retirement audit or execution | Non-empty exact standard-role allowlist bounded to 100 configured IDs |
| `DISCORD_MCP_ALLOW_ROLE_ORDERING_AUDIT` | For role-order audit | Must be exactly `true` to enable complete privacy-safe role-hierarchy evidence |
| `DISCORD_MCP_ALLOW_ROLE_ORDERING_CHANGES` | For role-order changes | Must be exactly `true` in addition to role-order audit to enable reviewed exact relative changes |
| `DISCORD_MCP_ROLE_ORDERING_GUILD_IDS` | For role-order audit or changes | Non-empty exact guild allowlist bounded to 100 IDs and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_INTERACTIONS` | For interactions | Must be exactly `true` to enable sends, own-message edits, own-reaction additions and removals, or reviewed static Components V2 messages |
| `DISCORD_MCP_INTERACTION_CHANNEL_IDS` | For interactions | Non-empty exact interaction-channel or thread allowlist and a subset of the read channel allowlist when one exists; static component messages require confirmed Message Content intent |
| `DISCORD_MCP_MENTION_USER_IDS` | No | Exact user IDs that interaction calls may explicitly notify; defaults empty and is bounded to 100 configured IDs |
| `DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE` | No | Process-local rolling interaction budget from 1 to 60; defaults to 10 |
| `DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS` | No | Process-local spacing per interaction channel from 0 to 60000 milliseconds; defaults to 500 |
| `DISCORD_MCP_ALLOW_REACTION_USER_AUDIT` | For reaction-user pages | Must be exactly `true` to enable bounded ID-and-bot-only reaction user reads |
| `DISCORD_MCP_ALLOW_REACTION_MODERATION` | For reaction moderation | Must be exactly `true` to enable reviewed user, emoji, or complete reaction removal; also requires pinned application and bot IDs |
| `DISCORD_MCP_REACTION_CHANNEL_IDS` | For reaction-user audit or moderation | Non-empty exact channel or thread allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_DELETIONS` | For deletion | Must be exactly `true` to enable deletion |
| `DISCORD_MCP_DELETE_CHANNEL_IDS` | For deletion | Non-empty deletion-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_PIN_MANAGEMENT` | For pin changes | Must be exactly `true` to enable reviewed pin and unpin changes |
| `DISCORD_MCP_PIN_CHANNEL_IDS` | For pin changes | Non-empty exact pin-channel or thread allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_ANNOUNCEMENT_CROSSPOSTS` | For announcement crossposts | Must be exactly `true` to enable reviewed irreversible exact-message crossposts |
| `DISCORD_MCP_ANNOUNCEMENT_CROSSPOST_CHANNEL_IDS` | For announcement crossposts | Non-empty exact direct announcement-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_MESSAGE_FORWARDING` | For native message forwarding | Must be exactly `true` to enable reviewed immutable snapshot forwarding; also requires pinned application and bot IDs |
| `DISCORD_MCP_ALLOW_CROSS_GUILD_MESSAGE_FORWARDING` | For cross-guild forwarding | Must be exactly `true` in addition to message forwarding; same-guild forwarding remains the default boundary |
| `DISCORD_MCP_MESSAGE_FORWARD_SOURCE_CHANNEL_IDS` | For native message forwarding | Non-empty exact direct text or announcement source-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_MESSAGE_FORWARD_TARGET_CHANNEL_IDS` | For native message forwarding | Non-empty exact direct text or announcement target-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_AUDIT` | For announcement-subscription inventory | Must be exactly `true` to enable credential-redacted target-channel subscription audit |
| `DISCORD_MCP_ALLOW_ANNOUNCEMENT_SUBSCRIPTION_CHANGES` | For announcement subscribe or unsubscribe | Must be exactly `true` in addition to subscription audit to enable reviewed changes |
| `DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_SOURCE_CHANNEL_IDS` | For new subscriptions | Non-empty exact direct announcement-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ANNOUNCEMENT_SUBSCRIPTION_TARGET_CHANNEL_IDS` | For audit or changes | Non-empty exact direct text-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_POLL_AUDIT` | For poll reads | Must be exactly `true` to enable bounded native poll result reads |
| `DISCORD_MCP_ALLOW_POLL_VOTER_AUDIT` | For voter reads | Must be exactly `true` in addition to poll audit to enable bounded ID-only voter pages |
| `DISCORD_MCP_ALLOW_POLL_CREATION` | For poll creation | Must be exactly `true` in addition to poll audit to enable reviewed immutable native poll creation |
| `DISCORD_MCP_ALLOW_POLL_ENDING` | For poll ending | Must be exactly `true` in addition to poll audit to enable reviewed irreversible native poll ending |
| `DISCORD_MCP_POLL_CHANNEL_IDS` | For poll audit or changes | Non-empty exact channel or thread allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_WEBHOOK_AUDIT` | For webhook inventory | Must be exactly `true` to enable credential-redacted webhook reads |
| `DISCORD_MCP_ALLOW_WEBHOOK_CREATION` | For webhook creation | Must be exactly `true` in addition to webhook audit to enable reviewed credential-safe Incoming-webhook creation |
| `DISCORD_MCP_ALLOW_WEBHOOK_CHANGES` | For webhook rename or move | Must be exactly `true` in addition to webhook audit to enable reviewed exact Incoming-webhook changes |
| `DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS` | For webhook deletion | Must be exactly `true` in addition to webhook audit to enable reviewed exact Incoming-webhook deletion |
| `DISCORD_MCP_WEBHOOK_CHANNEL_IDS` | For webhook audit or administration | Non-empty exact direct guild-channel allowlist and a subset of the read channel allowlist when one exists; both source and destination must be listed for a move |
| `DISCORD_MCP_ALLOW_INTEGRATION_AUDIT` | For guild integration inventory | Must be exactly `true` to enable privacy-safe integration reads |
| `DISCORD_MCP_ALLOW_INTEGRATION_DELETIONS` | For guild integration cleanup | Must be exactly `true` in addition to integration audit to enable reviewed exact-ID deletion |
| `DISCORD_MCP_INTEGRATION_GUILD_IDS` | For integration audit or cleanup | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_INTEGRATION_IDS` | For integration cleanup | Non-empty bounded exact integration deletion allowlist |
| `DISCORD_MCP_ALLOW_INVITE_AUDIT` | For invite inventory | Must be exactly `true` to enable capability-safe guild invite reads |
| `DISCORD_MCP_ALLOW_INVITE_DELETIONS` | For invite revocation | Must be exactly `true` in addition to invite audit to enable reviewed invite deletion |
| `DISCORD_MCP_INVITE_GUILD_IDS` | For invite audit or revocation | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_ONBOARDING_AUDIT` | For guild onboarding inspection | Must be exactly `true` to enable privacy-minimized complete onboarding reads; activates nonprivileged layout evidence and requires pinned application and bot IDs |
| `DISCORD_MCP_ALLOW_ONBOARDING_CHANGES` | For onboarding replacement | Must be exactly `true` in addition to onboarding audit to enable reviewed complete-state replacement |
| `DISCORD_MCP_ONBOARDING_GUILD_IDS` | For onboarding audit or replacement | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_WELCOME_SCREEN_AUDIT` | For Welcome Screen inspection | Must be exactly `true` to enable privacy-minimized complete Welcome Screen reads |
| `DISCORD_MCP_ALLOW_WELCOME_SCREEN_CHANGES` | For Welcome Screen replacement | Must be exactly `true` in addition to Welcome Screen audit to enable reviewed complete ordered replacement |
| `DISCORD_MCP_WELCOME_SCREEN_GUILD_IDS` | For Welcome Screen audit or replacement | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_GUILD_PROFILE_AUDIT` | For guild-profile text inspection | Must be exactly `true` to enable privacy-bounded transient name and description reads with presence-only media state |
| `DISCORD_MCP_ALLOW_GUILD_PROFILE_CHANGES` | For sparse guild-profile text changes | Must be exactly `true` in addition to guild-profile audit to enable reviewed name or description changes |
| `DISCORD_MCP_GUILD_PROFILE_GUILD_IDS` | For guild-profile audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_GUILD_SETTINGS_AUDIT` | For named guild-settings inspection | Must be exactly `true` to enable privacy-minimized guild-settings reads; activates nonprivileged layout evidence and requires pinned application and bot IDs |
| `DISCORD_MCP_ALLOW_GUILD_SETTINGS_CHANGES` | For sparse guild-settings changes | Must be exactly `true` in addition to guild-settings audit to enable reviewed named-field changes |
| `DISCORD_MCP_GUILD_SETTINGS_GUILD_IDS` | For guild-settings audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_WIDGET_SETTINGS_AUDIT` | For authenticated widget-settings inspection | Must be exactly `true` to enable privacy-minimized authenticated widget-settings reads |
| `DISCORD_MCP_ALLOW_WIDGET_SETTINGS_CHANGES` | For widget-settings replacement | Must be exactly `true` in addition to widget-settings audit to enable reviewed complete-state replacement |
| `DISCORD_MCP_ALLOW_WIDGET_PUBLIC_EXPOSURE` | For enabling or retargeting widget exposure | Must be exactly `true` in addition to widget-settings changes before a real write may enable the widget or select a different non-null channel |
| `DISCORD_MCP_WIDGET_SETTINGS_GUILD_IDS` | For widget-settings audit or replacement | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_APPLICATION_EMOJI_AUDIT` | For application-owned emoji inventory | Must be exactly `true` to enable identity-bound privacy-safe application-emoji reads |
| `DISCORD_MCP_ALLOW_APPLICATION_EMOJI_CHANGES` | For application-owned emoji changes | Must be exactly `true` in addition to application-emoji audit to enable reviewed create, rename, or delete |
| `DISCORD_MCP_APPLICATION_EMOJI_ROOTS` | For application-owned emoji creation | One absolute canonical owned directory, or a JSON array of such directories, containing eligible local image files; rename and delete do not require roots |
| `DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT` | For emoji or sticker inventory | Must be exactly `true` to enable privacy-safe guild-expression reads |
| `DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES` | For emoji or sticker changes | Must be exactly `true` in addition to expression audit to enable reviewed create, update, or delete |
| `DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS` | For expression audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_GUILD_EXPRESSION_ROOTS` | For expression creation or local role icons | One absolute canonical owned directory, or a JSON array of such directories, containing eligible local emoji, sticker, and reviewed 64 by 64 role-icon files; expression updates and deletions plus role metadata, clear, and Unicode icon changes do not require roots |
| `DISCORD_MCP_ALLOW_AUTOMOD_AUDIT` | For AutoMod inventory | Must be exactly `true` to enable privacy-safe AutoMod rule reads |
| `DISCORD_MCP_ALLOW_AUTOMOD_CHANGES` | For AutoMod changes | Must be exactly `true` in addition to AutoMod audit to enable reviewed create, update, enable, disable, or delete |
| `DISCORD_MCP_AUTOMOD_GUILD_IDS` | For AutoMod audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_AUTOMOD_ALERT_CHANNEL_IDS` | For AutoMod alert actions | Exact text or announcement channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT` | For scheduled-event inventory | Must be exactly `true` to enable privacy-safe scheduled-event reads |
| `DISCORD_MCP_ALLOW_SCHEDULED_EVENT_USER_AUDIT` | For subscriber identity reads | Must be exactly `true` in addition to scheduled-event audit to enable bounded ID-and-bot-only subscriber pages |
| `DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES` | For scheduled-event changes | Must be exactly `true` in addition to scheduled-event audit to enable reviewed create, update, transition, or delete |
| `DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS` | For scheduled-event audit, subscriber audit, or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_SCHEDULED_EVENT_ROOTS` | For scheduled-event cover changes | One absolute canonical owned directory, or a JSON array of such directories, containing eligible JPEG or non-animated PNG covers; metadata-only changes do not require roots |
| `DISCORD_MCP_ALLOW_SOUNDBOARD_AUDIT` | For soundboard inventory | Must be exactly `true` to enable privacy-safe default and guild soundboard reads |
| `DISCORD_MCP_ALLOW_SOUNDBOARD_CHANGES` | For soundboard changes | Must be exactly `true` in addition to soundboard audit to enable reviewed create, update, or delete |
| `DISCORD_MCP_SOUNDBOARD_GUILD_IDS` | For soundboard audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_SOUNDBOARD_ROOTS` | For soundboard creation | One absolute canonical owned directory, or a JSON array of such directories, containing eligible MP3 or Ogg files; updates and deletions do not require roots |
| `DISCORD_MCP_ALLOW_STAGE_INSTANCE_AUDIT` | For Stage-instance inventory | Must be exactly `true` to enable privacy-safe active or inactive Stage-instance reads |
| `DISCORD_MCP_ALLOW_STAGE_INSTANCE_CHANGES` | For Stage-instance changes | Must be exactly `true` in addition to Stage-instance audit to enable reviewed start, topic update, or end |
| `DISCORD_MCP_ALLOW_STAGE_START_NOTIFICATIONS` | For guild-wide Stage start notifications | Must be exactly `true` in addition to Stage-instance changes; disabled by default and separately requires `MENTION_EVERYONE` |
| `DISCORD_MCP_STAGE_CHANNEL_IDS` | For Stage-instance audit or changes | Non-empty exact Stage-channel allowlist bounded to 25 IDs and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES` | For permission-overwrite changes | Must be exactly `true` to enable reviewed exact-target permission-overwrite updates or deletions |
| `DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS` | For permission-overwrite changes | Non-empty exact direct guild-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_AUDIT_FILE` | No | Activity JSONL path; reviewed-write operation receipts and durable coordination claims use separate adjacent private directories; defaults under the user's local state directory |

</details>

An unset read allowlist in legacy input means all guild channels Discord allows the bot to view. The migration command preserves that meaning in the generated document, while the bot's Discord role remains authoritative.
