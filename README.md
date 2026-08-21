# Discord MCP

<img src="https://raw.githubusercontent.com/j-256/discord-mcp/v0.1.0/assets/discord-mcp-icon.png" alt="Discord MCP shield and reviewed connection icon" width="128">

Discord MCP is a local stdio Model Context Protocol server that lets compatible MCP clients inspect Discord guilds, channels, roles, threads, forums, message pins, privacy-safe guild emojis, stickers, AutoMod rules, scheduled events, guild onboarding, and guild bans, credential-redacted webhooks, capability-safe guild invites, channel permission overwrites, effective permissions, privacy-minimized members and guild audit history, and indexed message history through a dedicated bot. It includes exact member and role permission diagnostics, bounded channel-role access audits, exact-tool progressive discovery, risk-separated toolsets, portable non-secret multi-bot profiles, an optional privacy-safe real-time Gateway feed, privacy-safe local and OpenTelemetry observability, privacy-tiered MCP resources, validated read-only and plan-only prompts, a credential-safe operator CLI, compact bounded search, safe idempotent message interactions, reviewed guild-expression, AutoMod, scheduled-event, and complete onboarding administration, reviewed webhook cleanup and invite revocation, reviewed message pin, channel permission-overwrite, and member-role changes, reviewed local-file attachment messages, reviewed forum posts, resumable additive guild scaffolds, reviewed additive channel and role creation, exact reviewed message deletion, exact reviewed member moderation, and content-free local activity records.

## Safety model

The connector treats Discord permissions as its outer boundary and adds local policy inside that boundary.

- Production requests always target Discord API v10 at a fixed origin
- Direct-message channels are rejected
- Discord names, topics, forum tags, thread names, message bodies, embeds, components, filenames, and URLs are treated as untrusted data rather than instructions
- Resource discovery is content-free; live resource templates require exact IDs and never enumerate messages
- Prompt rendering validates literal inputs without contacting Discord or invoking a service method, and reviewed write prompts stop after read-only planning
- Credential-free catalog mode advertises the exact production tools, prompts, resources, and templates while a fixed guard rejects every tool call before argument validation or execution
- Full mode advertises every configured canonical tool so clients with native deferred-tool search retain exact tool identity, schemas, annotations, and approvals
- Progressive mode starts with one local discovery tool and reveals matching canonical tools through standard `notifications/tools/list_changed` events; it never uses a generic execution dispatcher
- Toolsets separate the member directory, guild ban audit, member-role changes, guild audit logs, permission diagnostics, channel permission overwrites, message pins, guild expressions, AutoMod rules, scheduled events, guild onboarding, webhook audit and cleanup, invite audit and revocation, attachments, forum posts, guild scaffolds, channel creation, role creation, deletion, and moderation from ordinary reads and interactions, cannot expand Discord policy, and remove unavailable tools from both direct calls and discovery results
- Optional guild and channel allowlists can narrow read access
- Portable profiles bind one verified application and bot identity to exact non-empty guild scope, optional channel scope, selected tools, Gateway policy, and a caller-owned credential variable without storing the credential
- Profile activation replaces ambient read boundaries in a cloned environment while leaving reviewed-write toggles and their narrower allowlists explicit at runtime
- Profile files are private, bounded, canonical, single-link records written atomically; removal moves one exact profile to recoverable private trash instead of deleting it
- Threads inherit local read scope from an allowlisted parent, while native search requests are attenuated to exact allowlisted channel IDs
- Real-time Gateway access is disabled by default and additionally requires expected application and bot IDs plus an exact guild or channel read allowlist
- The Gateway requests only the nonprivileged `GUILDS`, `GUILD_MESSAGES`, `GUILD_MESSAGE_REACTIONS`, and `GUILD_MESSAGE_POLLS` intents, uses no Discord client cache, and immediately reduces dispatches to scoped identifiers and fixed event kinds
- Gateway events remain in a bounded process-local buffer; content, profile data, emoji, URLs, raw payloads, session IDs, sequence numbers, and resume URLs are never returned or persisted
- Member-directory reads are disabled unless a separate feature gate and non-empty exact guild allowlist are both configured
- Exact member lookup, ascending cursor pages, and username-or-nickname prefix search return privacy-minimized records and never persist, cache, journal, or export member data or queries
- Member records omit avatars, decorations, presence, voice state, boost state, permissions, flags, and raw Discord payloads; display names never become write targets
- Guild ban audit is disabled unless a separate feature gate and non-empty exact guild allowlist are both configured
- Ban pages use bounded private lookahead and strict ascending user-ID validation, while exact lookup accepts only one guild and user ID; both prove verified identity and complete `BAN_MEMBERS` permission evidence without requiring the Guild Members privileged intent
- Ban results contain minimized profiles, omit reasons by default, discard avatars, discriminators, and unknown raw fields, and never cache, persist, journal, or export the response; an exact MCP resource always omits the reason
- Process-local observability stores only bounded aggregate counts and durations under fixed operation names and never persists telemetry
- Optional OTLP export and JSON stderr records contain no tool arguments, results, Discord identifiers, routes, URLs, bodies, headers, error messages, stacks, plan digests, or activity data
- OTLP export is disabled by default, requires its own exact feature gate, and permits plaintext HTTP only to a loopback collector
- Message interactions are disabled unless an explicit environment toggle and exact interaction-channel allowlist are both present
- Interaction scope never inherits from a thread parent, mentions notify nobody by default, and roles, `@everyone`, and `@here` cannot be enabled
- Every actual send, edit, or reaction write requires a pending content-free activity record and passes process-local anti-spam guards
- Sends require caller-provided idempotency keys, coalesce concurrent retries, and use deterministic Discord nonces with uniqueness enforcement
- Only non-webhook messages owned by the verified bot can be edited
- Pin listing uses Discord's current timestamp-paginated endpoint under ordinary read scope and never persists returned messages
- Pin and unpin changes are disabled unless a separate toggle and non-empty exact channel allowlist are both configured; thread-parent scope never grants mutation authority
- A content-bound keyed plan, signed MCP elicitation, host write approval, a final fresh plan, dedicated `PIN_MESSAGES` evidence, a durable one-shot receipt, pending content-free activity, one non-retried mutation, and exact state plus review-snapshot readback surround every pin change
- Message content, attachment metadata, names, audit reasons, and raw operation keys are never persisted; uncertain pin outcomes spend the key and block queued same-target changes in the process
- Webhook inventory is disabled unless a separate audit toggle and non-empty exact direct-channel allowlist are both configured
- The Discord REST response is projected immediately to exact IDs, type, creation time, name, application ID, and creator user ID; webhook credentials, execution URLs, avatars, creator profiles, source objects, and unknown raw fields never enter the MCP result or persistent state
- Webhook creation, execution, editing, and credential-authenticated actions are deliberately absent, so obtaining a webhook credential through this server is not a supported capability
- Incoming-webhook deletion requires an independent toggle in addition to audit scope, then uses verified application and bot identity, complete channel inventory and permission evidence, a keyed plan, signed MCP elicitation, host write approval, a final fresh plan, one-shot receipt, pending content-free activity, one non-retried DELETE, and exact absence readback
- Webhook names, credentials, URLs, avatars, creator profiles, source objects, audit reasons, raw operation keys, and raw Discord responses are never persisted; uncertain outcomes spend the key and block queued same-target deletion in the process
- Guild invite inventory is disabled unless a separate audit toggle and non-empty exact guild allowlist are both configured
- Invite codes and URLs are bearer capabilities, so the REST response is projected to process-keyed opaque references and bounded security metadata before any MCP result is formed; raw codes, URLs, profiles, role names, and unknown Discord fields are omitted
- Every invite read verifies the exact application, bot, guild, owner, connector membership, complete bounded role and channel inventories, and guild-level `MANAGE_GUILD`; authenticated cursors bind every page to one complete fresh inventory and reject drift or tampering
- Invite revocation requires an independent deletion toggle, a keyed full-inventory plan, signed MCP elicitation, host write approval, a final fresh plan, durable one-shot reservation, pending content-free activity, one non-retried DELETE, returned-target validation, and complete fresh absence readback
- Invite codes, URLs, profiles, role names, audit reasons, raw operation keys, raw Discord responses, and transport causes from code-bearing routes are never persisted or returned by the connector; uncertain outcomes spend the key and permanently block later same-reference revocation in that service process
- Guild onboarding inspection is disabled unless a separate audit toggle and non-empty exact guild allowlist are both configured; prompt titles, option titles, descriptions, and Unicode emoji are omitted by default and included only transiently through explicit tool opt-in
- Every onboarding read verifies the exact application, bot, guild, owner, connector membership, and complete bounded onboarding, role, channel, overwrite, emoji, and permission evidence; unknown fields and enums are reported only as counts
- Onboarding replacement requires an independent change toggle, complete `MANAGE_GUILD` and `MANAGE_ROLES` authority, zero-authority standard roles below the connector, directly visible referenced channels, and conservative enablement proof; enabling also requires fresh `COMMUNITY` guild-feature evidence
- Every replacement is an exact complete-state operation where omitted prompts, options, assignments, and default channels are deletions; existing IDs must be owned by the current configuration and omitted IDs request creation through transport-only placeholders
- A full-state keyed plan, signed MCP elicitation, host write approval, a final fresh plan, durable one-shot reservation, pending content-free activity, one non-retried PUT, authoritative response-ID validation, and a complete fresh readback surround every onboarding change
- Onboarding text, names, Unicode emoji, audit reasons, raw operation keys, and raw payloads are never persisted; uncertain outcomes spend the key and permanently block later same-guild onboarding changes in that service process
- API readback verifies the controlled server state but cannot prove the fresh-member client experience, so enabled onboarding plans require a separate non-staff client check after execution
- Guild emoji and sticker inventory is disabled unless a separate audit toggle and non-empty exact guild allowlist are both configured
- Inventory projects Discord responses immediately to stable expression metadata and complete ownership-aware permission evidence; CDN URLs, image bytes, uploader profiles, and unknown raw fields never enter MCP results or persistent state
- Creation requires an independent change toggle, exact verified guild scope, normalized-name collision checks, complete roles and permissions, and `CREATE_GUILD_EXPRESSIONS`; update and delete additionally require either exact bot ownership with that permission or `MANAGE_GUILD_EXPRESSIONS`
- Creation accepts only one bounded canonical owned local file inside dedicated roots, never a URL or base64 payload, detects the actual container format and animation state, records dimensions where encoded, enforces byte limits plus sticker dimensions and duration, and binds the stable file snapshot into a keyed plan
- Signed MCP elicitation, host write approval, a final fresh plan, durable one-shot reservation, pending content-free activity, one non-retried mutation, and exact metadata or absence readback surround every guild-expression change; managed emojis, missing role references, insufficient ownership, and uncertain same-guild predecessors fail closed
- Expression names, descriptions, tags, role names, local paths, image bytes, uploader profiles, audit reasons, and raw operation keys are never persisted; reserved keys are never retried or rolled back automatically
- AutoMod inventory is disabled unless a separate audit toggle and non-empty exact guild allowlist are both configured; full policy strings are returned only for an exact rule read, while inventory returns rule identity, action and trigger types, counts, and reference health
- AutoMod changes require an independent toggle, exact guild scope, `MANAGE_GUILD`, complete guild, role, channel, and bot-member evidence, and `MODERATE_MEMBERS` when creating, updating, or enabling a timeout-bearing rule
- Create always produces a disabled rule, enabling and disabling are separate reviewed actions, enabled rules cannot be edited or deleted, and Discord's immutable trigger type requires disabled delete and recreate instead of implicit conversion
- Alert destinations require their own exact local allowlist, an existing text or announcement channel, and effective `VIEW_CHANNEL`; every exempt role and channel must exist, and incompatible trigger, action, exemption, or capacity combinations fail closed
- Signed MCP elicitation, host write approval, a final fresh plan, durable one-shot reservation, pending content-free activity, one non-retried mutation, and exact state or absence readback surround every AutoMod change; uncertain same-guild predecessors fail closed
- Rule names, trigger strings, custom responses, role and channel names, audit reasons, and raw operation keys are never persisted; AutoMod execution-event content and matched content are deliberately absent from the Gateway feed
- Scheduled-event inventory is disabled unless a separate audit toggle and non-empty exact guild allowlist are both configured
- Event reads project Discord responses immediately to bounded metadata and complete entity-specific permission evidence; subscriber identities, creator profiles, cover URLs and hashes, and unknown raw fields are never returned or persisted, while aggregate subscriber counts require explicit opt-in
- Event changes require an independent change toggle, exact guild scope, future and internally consistent timing, documented recurrence shapes, valid lifecycle transitions, complete channel or guild permissions, and either `MANAGE_EVENTS` or exact bot ownership with `CREATE_EVENTS`
- Cover changes accept only one bounded canonical owned local JPEG or non-animated PNG file inside dedicated roots, never a URL or base64 payload, and bind its stable bytes and provenance into the reviewed plan
- Signed MCP elicitation, host write approval, a final fresh plan, durable one-shot reservation, pending content-free activity, one non-retried mutation, and exact state or absence readback surround every scheduled-event change; uncertain same-guild predecessors fail closed
- Event names, descriptions, locations, recurrence details, subscriber counts, local paths, image bytes and digests, audit reasons, and raw operation keys are never persisted; reserved keys are never retried or rolled back automatically
- Permission-overwrite listing is a bounded ordinary read that reports exact role and member targets, known and unknown bits, and the inherited parent source for threads without persisting the result
- Permission-overwrite changes are disabled unless a separate toggle and non-empty exact channel allowlist are both configured; only direct guild channels can be mutation targets and thread-parent scope never grants mutation authority
- Updates accept named `allow`, `deny`, or `inherit` deltas for one exact role or member and preserve unspecified bits; explicit deletion is a separate reviewed action, while raw bitfields, bulk reset, copy, sync, and thread mutation are unavailable
- Planning binds the complete overwrite set, complete role inventory, exact target identity, parent-category synchronization, effective-access impact, connector authority, lockout checks, and one-shot operation-key hash into a process-keyed digest
- Every update proves the connector holds each outgoing permission and retains `VIEW_CHANNEL` plus `MANAGE_ROLES`; unknown or non-channel bits fail updates closed, while explicit deletion surfaces their removal as a warning
- Signed MCP elicitation, host write approval, a final fresh plan, a durable one-shot receipt, pending content-free activity, one non-retried PUT or DELETE, and full overwrite-set readback surround every permission-overwrite change
- Permission names, bitfields, role and member names, audit reasons, and raw operation keys are never persisted; uncertain outcomes spend the key and block queued same-channel changes in the process
- Attachment messages are disabled unless a separate toggle, non-empty exact channel allowlist, and one or more existing owned canonical directory roots are configured
- Attachment planning accepts one exact absolute local path only, rejects URL and base64 inputs, reads no more than the configured 10 MiB ceiling, and rejects path escapes, symlinks, hardlinks, non-regular files, foreign-owned files, empty files, and files that change while being read
- A keyed plan binds the stable file identity and bytes, exact channel and optional reply, message fields, explicit notification users, complete bot permission evidence, and a one-shot operation-key hash
- MCP host write approval, signed MCP elicitation, two fresh byte-matching plans, the shared interaction limiter, a durable one-shot receipt, pending content-free activity, one non-retried multipart POST, and exact message readback all surround attachment execution
- Attachment URLs, local paths, file properties, byte digests, message content, descriptions, filenames, notification user IDs, and raw operation keys are never persisted; uncertain sends are never retried or rolled back automatically
- Channel creation is disabled unless a separate toggle and non-empty exact guild allowlist are both configured
- Creation is additive-only and supports categories, text channels, and forum channels without permission overwrites, positioning, edits, deletion, rollback, or broad blueprint reconciliation
- A keyed plan binds the exact request, bot identity, guild and optional parent permission evidence, logical-name collision candidates, relevant role state, visible capacity, and one-shot operation key hash
- MCP host write approval, signed MCP elicitation, a final fresh plan match, a durable one-shot content-free receipt, pending activity journaling, and exact post-write readback all surround channel creation
- Visible channel inventory is explicitly treated as visibility-bounded, and a reserved operation key cannot be reused after a failed or uncertain attempt
- Guild scaffolds are disabled unless a separate toggle and non-empty exact guild allowlist are both configured
- A scaffold accepts only additive roles, categories, text channels, and forum channels in one bounded symbolic graph; it never edits, assigns, moves, reorders, deletes, rolls back, or creates permission overwrites
- One keyed plan binds the verified application and bot, exact guild and requested graph, complete role and visible channel inventories, permissions, hierarchy, capacities, durable checkpoints, execution limit, and ready dependency frontier
- Signed MCP elicitation, host write approval, a final fresh plan, persistent request binding, per-step one-shot receipts, pending activity, non-retried writes, and exact readbacks surround every frontier
- A newly created category always forces a fresh plan before any requested child can be created; resumes use the same scaffold operation key and fail closed on pending, failed, uncertain, or drifting checkpoints
- Forum-post creation is disabled unless a separate toggle and non-empty exact forum-channel allowlist are both configured
- The forum surface targets stable public forum channels only and accepts one exact title, one plain-text starter message, at most five exact available tag IDs, optional exact notification users, and bounded thread archive and slowmode settings
- A keyed plan binds the exact request, bot identity, full guild role and forum overwrite evidence, required and moderated tag rules, effective `View Channel`, `Read Message History`, `Send Messages`, and conditional `Manage Threads` permissions, and a one-shot operation-key hash
- MCP host write approval, signed MCP elicitation, a final fresh plan match, the shared interaction limiter, a durable one-shot receipt, pending content-free activity, one non-retried POST, and exact thread plus starter-message readback all surround forum-post execution
- Forum-post titles, content, tag IDs and names, notification user IDs, audit reasons, and raw operation keys are never persisted; uncertain outcomes are never retried, deleted, or rolled back automatically
- Role creation is disabled unless a separate toggle and non-empty exact guild allowlist are both configured
- Role reads normalize current solid colors, hierarchy, managed-role provenance, known permission names, and unknown future permission bits from a complete bounded inventory or one exact role endpoint
- Principal permission diagnostics fetch exact member or role identities and a complete bounded role inventory without listing guild members, then evaluate named permissions, channel actions, timeouts, thread access, and strict role hierarchy without writing or persisting profile data
- Channel-role audits evaluate every role against a bounded action set, page compact rows with exact role cursors, report full-inventory totals, and distinguish standalone role baselines from member-specific overwrites
- Guild audit-log reads use exact guild scope, bounded lookahead pagination, exact actor and action filters, strict response-order validation, and an exact-entry lookup that cannot substitute a neighboring entry
- Guild audit summaries omit Discord's embedded objects plus all change and option values, redact polymorphic non-snowflake targets, include reasons only by explicit opt-in, and are never cached, logged, journaled, or persisted
- Role creation is additive-only, accepts exact named permissions, forbids `ADMINISTRATOR`, and never edits, moves, assigns, deletes, rolls back, or creates role icons, emoji, or gradients
- A keyed plan binds the complete role inventory, exact request without the raw operation key, operation-key hash, bot identity, effective permissions, hierarchy, capacity, and logical-name collision candidates
- MCP host write approval, signed MCP elicitation, a final fresh plan match, a durable one-shot content-free receipt, pending activity journaling, a single non-retried POST, and exact post-write readback all surround role creation
- Member-role changes are disabled unless a separate toggle, non-empty exact guild allowlist, and non-empty exact role allowlist are all configured; protected users, the connector bot, guild owners, pending members, and actively timed-out members cannot be targeted
- Each plan verifies the complete guild role and direct-channel inventories, `MANAGE_ROLES`, strict bot and target hierarchy, the selected role's management state and permissions, exact before-and-after guild permission sets and deltas, and exact named permission impact for every supported direct guild channel
- Additions reject `ADMINISTRATOR`, unknown selected-role or overwrite bits, selected-role guild permissions outside the connector bot's effective guild set, and selected-role channel overwrite allowances or effective gains the bot does not itself hold in that channel; removals may de-escalate high-risk or unknown selected-role permissions and disclose them for review
- MCP host write approval, signed MCP elicitation, a final fresh plan match, a durable one-shot content-free receipt, pending activity journaling, one exact non-retried PUT or DELETE, and exact member readback surround every member-role change
- Member and role names, channel names, permission evidence, audit reasons, and raw operation keys are never persisted; active threads remain outside the direct-channel impact proof, and uncertain outcomes spend the key and block queued same-member changes in the process
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
- The bot token, webhook credentials and URLs, invite codes and URLs, Discord profiles, message content, content hashes, embeds, components, attachment URLs, emoji, guild-expression and scheduled-event names, descriptions, locations, tags, recurrence details, subscriber counts, local paths, image bytes and digests, uploader profiles, notification user IDs, raw idempotency or operation keys, forum titles or tags, channel names or topics, scaffold symbols, Discord audit-log reasons, profile names, role names, and Discord Interaction public key are never written to the activity log or operation receipts

Treat guild-expression changes, scheduled-event changes, webhook deletion, invite revocation, attachment messages, forum posts, message-pin changes, channel permission-overwrite changes, member-role changes, guild scaffolds, channel creation, role creation, message deletion, and member moderation as consequential even though the connector records only bounded identifiers and outcomes.

## Requirements

- Node.js 22 or newer
- A Discord application with a bot user
- The bot token available as `DISCORD_BOT_TOKEN`
- A distinct uppercase `DISCORD_*_TOKEN` environment variable may be selected when creating a named profile
- `View Channels` and `Read Message History` in every channel the connector should read
- The Message Content privileged intent enabled for full message bodies and native search; the optional content-free Gateway feed does not request it
- The Guild Members privileged intent enabled when opt-in member listing is needed; the optional content-free Gateway feed does not request it
- `Send Messages` only in channels where message sends or edits will be enabled
- `Attach Files`, `Read Message History`, and `Send Messages` or `Send Messages in Threads` only in exact channels or threads selected for attachment messages
- `View Channels`, `Read Message History`, and `Send Messages` only in exact forum channels selected for forum-post creation; add `Manage Threads` only when selecting moderated tags
- `Add Reactions` only in channels where reaction writes will be enabled
- `Manage Roles` and `View Channel` only in exact direct guild channels where permission-overwrite changes will be enabled
- `Manage Webhooks` and `View Channel` only in exact direct guild channels where credential-redacted webhook audit or reviewed cleanup will be enabled
- `Manage Guild` only in exact guilds where capability-safe invite inventory or reviewed invite revocation will be enabled
- `Manage Guild` and `Manage Roles` only in exact guilds where reviewed complete onboarding replacement will be enabled
- `Create Guild Expressions` only in exact guilds where the bot may create emojis or stickers it owns, and `Manage Guild Expressions` only where it must update or delete expressions created by another user
- `Create Events` only in exact guilds selected for scheduled-event administration, `Manage Events` only when cross-owner changes are required, and the documented channel permissions for each selected stage or voice event target
- `Manage Messages` only in channels where deletion will eventually be enabled
- `Manage Channels` and `View Channels` only in exact guilds and parent categories where additive channel creation or guild scaffolds will be enabled
- `Manage Roles` only in exact guilds where additive role creation, guild scaffolds, or member-role changes will be enabled, with the bot's own highest role above every created or assignable role and every eligible member
- `View Audit Log` only in guilds where privacy-minimized server audit history is needed
- `Kick Members`, `Ban Members`, or `Moderate Members` only in exact guilds where the corresponding member administration action will be enabled

Do not grant the bot `Administrator`. Restrict its Discord role at the category or channel level wherever possible.

The application public key is not used by the local REST or Gateway connections. It becomes relevant only if Discord Interaction webhooks or slash commands are added later.

## Discord bot setup

1. Open the application in the Discord Developer Portal.
2. On the Bot page, enable the Message Content privileged intent if full message bodies or native search are needed, and enable Guild Members only if the member directory will be configured.
3. On the Installation page, enable Guild Install and add the `bot` scope.
4. Select `View Channels` and `Read Message History` as the initial bot permissions.
5. Use the generated install link while signed in as a server administrator and add the bot to the intended server.
6. Restrict the bot role to the intended categories or channels.
7. Run `discord-mcp setup` and confirm that Discord reports the expected application, bot, and scoped guild access.

Add `Send Messages` and `Add Reactions` later only for exact channels selected for interactions. Add `Attach Files` and the applicable send permission only after selecting exact attachment channels and dedicated local attachment directories, and keep the local attachment toggle disabled until both scopes are configured. Add `View Channel`, `Read Message History`, and `Send Messages` only after selecting exact forum channels, add `Manage Threads` only when moderated tags are needed, and keep the local forum-post toggle disabled until those channel IDs are configured. Enable the Guild Members privileged intent only after selecting exact member-directory guilds, and keep the local member-directory toggle disabled until that allowlist is configured. Add `Ban Members` only after selecting exact guilds for ban audit or reviewed ban changes, and keep the local ban-audit toggle disabled until that guild allowlist is configured. Add `Pin Messages` only after selecting exact pin channels or threads, and keep the local pin-management toggle disabled until those IDs are configured. Add `Manage Webhooks` and retain `View Channel` only after selecting exact direct channels for webhook audit, and keep both webhook toggles disabled until those channel IDs are configured. Add `Manage Guild` only after selecting exact guilds for capability-safe invite audit or revocation, and keep both invite toggles disabled until those guild IDs are configured. Add `Manage Guild` plus `Manage Roles` only after selecting exact guilds for onboarding replacement, and keep onboarding audit and change toggles disabled until those guild IDs are configured. Add `Create Guild Expressions` only after selecting exact guilds for emoji or sticker creation, add `Manage Guild Expressions` only when cross-owner updates or deletions are required, configure dedicated local expression roots before creation, and keep both local expression toggles disabled until those scopes are configured. Add `Create Events` only after selecting exact scheduled-event guilds; add `Manage Events` only for cross-owner changes, add the documented stage or voice channel permissions only to exact hosting targets, configure dedicated local cover roots before image changes, and keep both local scheduled-event toggles disabled until those scopes are configured. Add `Manage Roles` and retain `View Channel` only after selecting exact direct guild channels for permission-overwrite changes, and keep the local permission-overwrite toggle disabled until those channel IDs are configured. Add `Manage Channels` only after selecting exact channel-creation or scaffold guilds and parent categories, and keep both local toggles disabled until those guild IDs are configured. Add `Manage Roles` only after selecting exact role-creation, scaffold, or member-role guilds; list every assignable role by exact ID, keep the bot's highest role above each role and target member, and keep every local toggle disabled until its narrower guild and role scopes are configured. Add `Manage Messages` only after selecting deletion channels. Add only the specific member permission needed for planned guild administration, keep the bot's highest role above eligible targets, and keep the local administration toggle disabled until exact guild and protected-user IDs are configured.

The optional real-time feed needs no additional privileged intent in the Developer Portal. Discord documents bot installation in its [getting started guide](https://docs.discord.com/developers/quick-start/getting-started), Gateway connection behavior in its [Gateway reference](https://docs.discord.com/developers/events/gateway), channel creation, role creation, member-role changes, and member moderation in its [guild resource reference](https://docs.discord.com/developers/resources/guild), invite behavior and revocation in its [invite resource reference](https://docs.discord.com/developers/resources/invite), scheduled-event behavior and permissions in its [guild scheduled event reference](https://docs.discord.com/developers/resources/guild-scheduled-event), permission-overwrite changes in its [channel resource reference](https://docs.discord.com/developers/resources/channel#edit-channel-permissions), and message deletion in its [message resource reference](https://docs.discord.com/developers/resources/message).

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
node dist/cli.js catalog --check
node dist/cli.js setup
node dist/cli.js setup --profile support-bot --token-env DISCORD_SUPPORT_BOT_TOKEN
node dist/cli.js profile list
node dist/cli.js doctor --profile support-bot --online
node dist/cli.js smoke --profile support-bot
node dist/cli.js smoke
```

`catalog` starts a separate credential-free stdio server that reuses the production registrations while disabling all tool execution. It reads no ambient token or policy, constructs no Discord client, opens no Gateway or telemetry exporter, and creates no activity record. Static safety guidance and validated prompts remain inspectable; every listed, invalid, disabled, discovery, or unknown tool call returns the same fixed `CATALOG_ONLY` result. Add `--check` to verify the exact tool, prompt, resource, and resource-template identities, every tool schema and risk annotation, static safety resource, and execution guard in process without contacting Discord. Add `--json` with `--check` for a versioned machine-readable report.

`doctor` checks the Node.js version, required token variable, configuration syntax, application and bot identity pins, local allowlists, exact MCP tool surface and toolsets, Gateway policy, observability policy, interaction policy, member-directory policy, ban-audit policy, invite-audit and revocation policy, onboarding-audit and replacement policy, member-role policy, attachment policy, forum-post policy, message-pin policy, webhook policy, guild-expression policy, scheduled-event policy, permission-overwrite policy, guild-scaffold policy, channel-creation policy, role-creation policy, deletion policy, and administration policy. Offline checks do not read attachment or cover files, contact Discord, open a Gateway connection, or start telemetry export. Add `--online` to verify the application, bot identity, Message Content and Guild Members intent flags, and first guild-membership page without listing guild members, guild bans, invites, onboarding, or channels, reading messages or reasons, reading local files, opening a Gateway connection, or starting telemetry export. Add `--profile NAME` to diagnose the saved identity and read boundary using its selected credential variable.

`setup` performs the same safe online identity check, requires at least one accessible guild inside local scope, and prints a portable credential-free stdio launch descriptor. When invoked through the built CLI, the descriptor points at that exact Node.js executable and CLI entrypoint. Without a profile, it pins the verified public application and bot IDs and names every environment variable that a host may forward. It never includes a bot token value.

Add `--profile NAME` to save a strict non-secret profile after verification. Profile setup requires an exact non-empty `DISCORD_MCP_ALLOWED_GUILD_IDS`; channel scope may remain empty to inherit the exact guild boundary. `--token-env DISCORD_NAME_TOKEN` selects a caller-owned credential variable, and `--force` replaces only a profile whose saved application and bot identities still match. Both options require `--profile`. Saved profiles intentionally omit tokens, Discord names and content, host brands, local paths, telemetry configuration, the member-directory, ban-audit, invite-audit, and onboarding-audit gates and allowlists, every reviewed-write toggle, and every write allowlist.

`profile list` and `profile show NAME` inspect saved contracts without reading a credential, contacting Discord, opening the Gateway, or starting telemetry. `profile remove NAME --confirm NAME` moves one validated profile into private recoverable trash and leaves its external credential active. `profile restore NAME --confirm NAME` restores the newest valid generation only when the active name is absent. Add `--json` to any profile lifecycle command for a versioned path-free report.

`smoke` connects an official MCP client to the real adapter over linked protocol transports, validates the configured tool, resource, resource-template, and prompt catalogs, checks every exposed tool's complete risk annotations, and exercises local discovery. For a progressive surface, it reveals every configured toolset inside the temporary smoke server and verifies the resulting exact tools. Identity verification uses `get_connector_status` when the connector toolset is exposed and the same read-only service status path otherwise. The command does not list Discord channels, read messages, open a Gateway connection, start telemetry export, or write to Discord. Add `--profile NAME` to smoke the saved contract.

Add `--json` to `setup`, `doctor`, `smoke`, or a profile lifecycle command, or use it with `catalog --check`, for a versioned machine-readable report. Run `node dist/cli.js help` for the complete command summary.

## Configuration

| Environment variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot authentication |
| `DISCORD_MCP_APPLICATION_ID` | Recommended | Reject a token belonging to a different application |
| `DISCORD_MCP_BOT_ID` | Recommended | Reject a token belonging to a different bot user |
| `DISCORD_MCP_ALLOWED_GUILD_IDS` | No | Comma- or whitespace-separated read guild allowlist |
| `DISCORD_MCP_ALLOWED_CHANNEL_IDS` | No | Comma- or whitespace-separated read channel allowlist |
| `DISCORD_MCP_TOOL_SURFACE` | No | `full` advertises every selected canonical tool; `progressive` initially advertises only exact-tool discovery; defaults to `full` |
| `DISCORD_MCP_TOOLSETS` | No | `all` or a comma-separated selection of `activity`, `attachments`, `audit-logs`, `automod`, `bans`, `channel-creation`, `connector`, `deletion`, `forum-posts`, `gateway`, `guild-expressions`, `guild-scaffolds`, `guilds`, `interactions`, `invites`, `member-roles`, `members`, `messages`, `moderation`, `observability`, `onboarding`, `permission-overwrites`, `permissions`, `pins`, `role-creation`, `roles`, `scheduled-events`, `threads`, and `webhooks`; defaults to `all` |
| `DISCORD_MCP_ALLOW_GATEWAY` | For real-time events | Must be exactly `true`; also requires application and bot IDs plus at least one exact read allowlist |
| `DISCORD_MCP_GATEWAY_EVENT_BUFFER_SIZE` | No | Process-local content-free event capacity from 1 to 1000; defaults to 100 |
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
| `DISCORD_MCP_PROTECTED_USER_IDS` | No | Exact user IDs that member administration and member-role changes must never target; defaults empty and is bounded to 100 configured IDs |
| `DISCORD_MCP_ALLOW_MEMBER_DIRECTORY` | For member reads | Must be exactly `true` to enable privacy-minimized exact, cursor, and prefix member reads |
| `DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS` | For member reads | Non-empty exact member-directory guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_BAN_AUDIT` | For guild ban audit | Must be exactly `true` to enable privacy-minimized exact and cursor ban reads |
| `DISCORD_MCP_BAN_AUDIT_GUILD_IDS` | For guild ban audit | Non-empty exact ban-audit guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES` | For member-role changes | Must be exactly `true` to enable reviewed exact role additions and removals |
| `DISCORD_MCP_MEMBER_ROLE_GUILD_IDS` | For member-role changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_MEMBER_ROLE_IDS` | For member-role changes | Non-empty exact role allowlist bounded to 100 configured IDs |
| `DISCORD_MCP_ALLOW_CHANNEL_CREATION` | For channel creation | Must be exactly `true` to enable reviewed additive channel creation |
| `DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS` | For channel creation | Non-empty exact channel-creation guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_FORUM_POSTS` | For forum posts | Must be exactly `true` to enable reviewed public forum-post creation |
| `DISCORD_MCP_FORUM_POST_CHANNEL_IDS` | For forum posts | Non-empty exact forum-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS` | For guild scaffolds | Must be exactly `true` to enable reviewed resumable additive guild scaffolds |
| `DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS` | For guild scaffolds | Non-empty exact scaffold-guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_ROLE_CREATION` | For role creation | Must be exactly `true` to enable reviewed additive role creation |
| `DISCORD_MCP_ROLE_CREATION_GUILD_IDS` | For role creation | Non-empty exact role-creation guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_INTERACTIONS` | For interactions | Must be exactly `true` to enable sends, own-message edits, or own-reaction adds |
| `DISCORD_MCP_INTERACTION_CHANNEL_IDS` | For interactions | Non-empty exact interaction-channel or thread allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_MENTION_USER_IDS` | No | Exact user IDs that interaction calls may explicitly notify; defaults empty and is bounded to 100 configured IDs |
| `DISCORD_MCP_INTERACTION_MAX_WRITES_PER_MINUTE` | No | Process-local rolling interaction budget from 1 to 60; defaults to 10 |
| `DISCORD_MCP_INTERACTION_MIN_WRITE_INTERVAL_MS` | No | Process-local spacing per interaction channel from 0 to 60000 milliseconds; defaults to 500 |
| `DISCORD_MCP_ALLOW_DELETIONS` | For deletion | Must be exactly `true` to enable deletion |
| `DISCORD_MCP_DELETE_CHANNEL_IDS` | For deletion | Non-empty deletion-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_PIN_MANAGEMENT` | For pin changes | Must be exactly `true` to enable reviewed pin and unpin changes |
| `DISCORD_MCP_PIN_CHANNEL_IDS` | For pin changes | Non-empty exact pin-channel or thread allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_WEBHOOK_AUDIT` | For webhook inventory | Must be exactly `true` to enable credential-redacted webhook reads |
| `DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS` | For webhook cleanup | Must be exactly `true` in addition to webhook audit to enable reviewed Incoming-webhook deletion |
| `DISCORD_MCP_WEBHOOK_CHANNEL_IDS` | For webhook audit or cleanup | Non-empty exact direct guild-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_INVITE_AUDIT` | For invite inventory | Must be exactly `true` to enable capability-safe guild invite reads |
| `DISCORD_MCP_ALLOW_INVITE_DELETIONS` | For invite revocation | Must be exactly `true` in addition to invite audit to enable reviewed invite deletion |
| `DISCORD_MCP_INVITE_GUILD_IDS` | For invite audit or revocation | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_ONBOARDING_AUDIT` | For guild onboarding inspection | Must be exactly `true` to enable privacy-minimized complete onboarding reads |
| `DISCORD_MCP_ALLOW_ONBOARDING_CHANGES` | For onboarding replacement | Must be exactly `true` in addition to onboarding audit to enable reviewed complete-state replacement |
| `DISCORD_MCP_ONBOARDING_GUILD_IDS` | For onboarding audit or replacement | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT` | For emoji or sticker inventory | Must be exactly `true` to enable privacy-safe guild-expression reads |
| `DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES` | For emoji or sticker changes | Must be exactly `true` in addition to expression audit to enable reviewed create, update, or delete |
| `DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS` | For expression audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_GUILD_EXPRESSION_ROOTS` | For expression creation | One absolute canonical owned directory, or a JSON array of such directories, containing eligible local emoji and sticker files; updates and deletions do not require roots |
| `DISCORD_MCP_ALLOW_AUTOMOD_AUDIT` | For AutoMod inventory | Must be exactly `true` to enable privacy-safe AutoMod rule reads |
| `DISCORD_MCP_ALLOW_AUTOMOD_CHANGES` | For AutoMod changes | Must be exactly `true` in addition to AutoMod audit to enable reviewed create, update, enable, disable, or delete |
| `DISCORD_MCP_AUTOMOD_GUILD_IDS` | For AutoMod audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_AUTOMOD_ALERT_CHANNEL_IDS` | For AutoMod alert actions | Exact text or announcement channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT` | For scheduled-event inventory | Must be exactly `true` to enable privacy-safe scheduled-event reads |
| `DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES` | For scheduled-event changes | Must be exactly `true` in addition to scheduled-event audit to enable reviewed create, update, transition, or delete |
| `DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS` | For scheduled-event audit or changes | Non-empty exact guild allowlist and a subset of the read guild allowlist when one exists |
| `DISCORD_MCP_SCHEDULED_EVENT_ROOTS` | For scheduled-event cover changes | One absolute canonical owned directory, or a JSON array of such directories, containing eligible JPEG or non-animated PNG covers; metadata-only changes do not require roots |
| `DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES` | For permission-overwrite changes | Must be exactly `true` to enable reviewed exact-target permission-overwrite updates or deletions |
| `DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS` | For permission-overwrite changes | Non-empty exact direct guild-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_AUDIT_FILE` | No | Activity JSONL path; attachment, AutoMod, channel, forum-post, guild-expression, guild-scaffold, invite-deletion, message-pin, onboarding-change, permission-overwrite, role, scheduled-event, and webhook-deletion operation receipts use an adjacent private directory; defaults under the user's local state directory |

An unset read allowlist means all guild channels Discord allows the bot to view. The bot's Discord role remains authoritative.

Run `node dist/cli.js setup --json` and map the returned `launch` object into the MCP host's stdio configuration. The descriptor supplies the server name, command, arguments, environment-variable names to forward, both verified public identity IDs to set, and recommended startup and tool timeouts. It also declares that the server should be required, writes should require host approval, and reviewed writes require MCP elicitation. Keep `DISCORD_BOT_TOKEN` in the host process environment or secret store and forward it by name; never copy its value into a static configuration file.

A profile-aware descriptor runs `serve --profile NAME`, forwards only the selected credential variable plus runtime settings outside the saved boundary, and sets no identity or read-policy environment values. Activation maps the credential into the canonical process variable, applies both saved identity pins, exact read scope, tool policy, and Gateway policy, and removes the alias from the cloned service environment. The member-directory, ban-audit, invite-audit, and onboarding-audit gates, reviewed-write gates, and their narrower allowlists remain ordinary forwarded environment variables, and the existing configuration loader requires them to fit inside the saved read scope.

When using the published package, configure the stdio command as `npx` with arguments `--yes`, `@j-256/discord-mcp@0.1.0`, and `serve`. Pinning the package version prevents an unreviewed update from replacing the executable. Host configuration formats differ, so the launch descriptor is intentionally typed data rather than a client-specific configuration fragment.

Restart or reload the MCP host after changing its configuration, inspect the negotiated server, and confirm that required-server behavior, write approval, elicitation, and timeouts match the descriptor before enabling reviewed write policies. A host without MCP elicitation can use read-only and plan-only capabilities but must not execute reviewed writes.

## Tools

The default `full` surface is recommended for clients with native deferred-tool search because the client can defer context while preserving each canonical tool's name, input schema, annotations, and approval identity. Set `DISCORD_MCP_TOOL_SURFACE=progressive` only for hosts that need a smaller initial catalog. Progressive mode initially lists `discover_discord_tools`; searching an exact name returns its complete contract and enables that canonical tool. Broader bounded searches can enable several exact matches. Discovery of either planning or execution tool in the attachments, AutoMod, forum-posts, guild-expressions, scheduled-events, onboarding, guild-scaffolds, channel-creation, role-creation, member-role, message-pin, webhook-deletion, invite-deletion, channel-permission-overwrite, deletion, or moderation reviewed workflow enables that complete plan-plus-execute pair, so a client never receives half of a reviewed workflow.

`DISCORD_MCP_TOOLSETS` is a callable-surface boundary, not an authorization substitute. It can remove tools but cannot override Discord permissions, local allowlists, feature toggles, planning, approval, confirmation, freshness, operation-key reservation, or journaling. The `members`, `bans`, `member-roles`, `audit-logs`, `permissions`, `permission-overwrites`, `pins`, `guild-expressions`, `automod`, `scheduled-events`, `onboarding`, `webhooks`, `invites`, `attachments`, `forum-posts`, `guild-scaffolds`, `channel-creation`, `role-creation`, `deletion`, and `moderation` sets are deliberately separate from `messages`, `guilds`, `roles`, and `interactions`. Omitted tools are absent from `tools/list`, rejected by direct calls, excluded from discovery, and have their dependent prompts omitted. Resources remain independently useful and continue to enforce their own policy.

| Tool | Access | Purpose |
| --- | --- | --- |
| `discover_discord_tools` | Local read | Search only the configured exact-tool catalog by capability, toolset, or risk and reveal canonical contracts in progressive mode without contacting Discord |
| `get_connector_status` | Discord read | Verify application and bot identity and report effective policy |
| `get_observability_status` | Local read | Report bounded operation aggregates, exporter health, and explicit telemetry privacy guarantees |
| `get_gateway_status` | Local read | Report optional Gateway health, intent privacy, reconnect and continuity-gap counters, and bounded-buffer state |
| `get_gateway_events` | Local read | Page through retained content-free events after an optional process-bound cursor |
| `list_guilds` | Discord read | List scoped bot guild memberships |
| `list_channels` | Discord read | List scoped channels, thread metadata, and forum configuration without message content |
| `list_roles` | Discord read | List the complete bounded role inventory with current colors, hierarchy, managed provenance, and arbitrary-width permission evidence |
| `get_role` | Discord read | Fetch and normalize one exact role through Discord's exact guild-role endpoint |
| `get_guild_member` | Discord read | Fetch one exact privacy-minimized member from a separately allowlisted guild |
| `list_guild_members` | Discord read | Page privacy-minimized members in strict ascending user-ID order with a bounded continuation cursor |
| `search_guild_members` | Discord read | Run one bounded username-or-nickname prefix search without fuzzy matching or name-to-write resolution |
| `list_guild_bans` | Discord read | Page privacy-minimized bans in strict ascending user-ID order with proven lookahead cursors and reasons omitted unless explicitly requested |
| `get_guild_ban` | Discord read | Fetch one exact privacy-minimized guild ban with a default-redacted optional reason and complete `BAN_MEMBERS` evidence |
| `list_guild_audit_entries` | Discord read | Page privacy-minimized guild audit history with exact actor, action, and before-entry filters plus proven lookahead cursors |
| `get_guild_audit_entry` | Discord read | Fetch one exact retained guild audit entry without scanning or substituting a neighboring entry |
| `list_active_threads` | Discord read | List a bounded set of active threads and forum posts, optionally beneath one parent |
| `list_archived_threads` | Discord read | Page through public, private, or joined-private archived threads with typed cursors |
| `explain_channel_access` | Discord read | Explain the current bot's effective permissions and evidence confidence |
| `explain_principal_permissions` | Discord read | Explain named permissions or one supported action for the connector, one exact member, or one exact role, including channel rules, timeout, private-thread membership, and hierarchy evidence |
| `audit_channel_role_access` | Discord read | Page compact standalone role baselines for bounded channel actions with deterministic exact-role cursors and full-inventory totals |
| `list_channel_permission_overwrites` | Discord read | Page one channel's normalized role and member overwrites with named known bits, unknown future bits, exact target cursors, and inherited thread-source evidence |
| `read_messages` | Discord read | Read a bounded page of normalized messages |
| `search_messages` | Discord read | Search indexed guild history with bounded official Discord filters and compact results |
| `get_message` | Discord read | Read one exact message |
| `list_message_pins` | Discord read | Page pinned messages with Discord's current timestamp cursor and no persistence |
| `list_channel_webhooks` | Discord read | Return one complete credential-redacted webhook inventory for an exact separately allowlisted direct guild channel |
| `get_channel_webhook` | Discord read | Resolve one exact webhook through that bounded credential-redacted channel inventory |
| `list_guild_invites` | Discord read | Page one complete capability-safe guild invite inventory through authenticated snapshot-bound cursors without exposing codes or URLs |
| `get_guild_invite` | Discord read | Resolve one process-local opaque invite reference through a fresh complete guild inventory |
| `get_guild_onboarding` | Discord read | Return one complete bounded guild onboarding audit with prompt and option text omitted unless explicitly requested for transient review |
| `list_guild_emojis` | Discord read | Return one complete bounded privacy-safe emoji inventory with ownership-aware permission evidence for an exact separately allowlisted guild |
| `get_guild_emoji` | Discord read | Resolve one exact emoji through that complete privacy-safe guild inventory |
| `list_guild_stickers` | Discord read | Return one complete bounded privacy-safe sticker inventory with ownership-aware permission evidence for an exact separately allowlisted guild |
| `get_guild_sticker` | Discord read | Resolve one exact sticker through that complete privacy-safe guild inventory |
| `list_automod_rules` | Discord read | Return a bounded privacy-safe AutoMod inventory with rule identity, action and trigger types, policy-entry counts, reference health, and complete permission evidence without policy strings |
| `get_automod_rule` | Discord read | Resolve one exact AutoMod rule with its complete transient policy, exact references, privacy guarantees, and complete permission evidence |
| `list_scheduled_events` | Discord read | Return one complete bounded privacy-safe scheduled-event inventory with entity-specific permission evidence and optional aggregate subscriber counts for an exact separately allowlisted guild |
| `get_scheduled_event` | Discord read | Resolve one exact privacy-safe scheduled event with optional aggregate subscriber count and complete entity-specific permission evidence |
| `send_message` | Discord write | Send one idempotent plain-text message or exact reply with notifications suppressed by default |
| `edit_own_message` | Discord write | Replace one exact non-webhook message owned by the verified bot |
| `add_reaction` | Discord write | Idempotently add the bot's own single reaction to one exact message |
| `plan_attachment_message` | Discord and local read | Verify one exact local file, channel, optional reply, notification set, and complete permission evidence and produce a byte-bound keyed plan |
| `execute_attachment_message` | Discord write | Confirm, re-read and revalidate, reserve the one-shot key, journal, upload once without retry, and verify the exact attachment message without returning its attachment URL |
| `plan_message_deletion` | Discord read | Prepare exact previews and a keyed deletion digest |
| `delete_messages` | Discord write | Confirm, revalidate, journal, and delete the reviewed IDs |
| `plan_message_pin` | Discord read | Verify one exact message's current and desired pin state, scope, identity, thread access, and complete read plus `PIN_MESSAGES` permission evidence and produce a content-bound keyed digest |
| `execute_message_pin` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, pin or unpin once without retry, and read back the exact message state |
| `plan_webhook_deletion` | Discord read | Verify one exact Incoming webhook against identity, complete credential-redacted inventory, scope, and channel-level `VIEW_CHANNEL` plus `MANAGE_WEBHOOKS` evidence and produce a keyed digest |
| `execute_webhook_deletion` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, delete once without retry, and verify exact absence through a fresh channel inventory |
| `plan_invite_deletion` | Discord read | Verify one opaque invite reference against identity, exact guild scope, complete invite, channel, and role inventories, and guild-level `MANAGE_GUILD` evidence and produce a keyed digest |
| `execute_invite_deletion` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, revoke once without retry, validate the returned target, and verify exact absence without exposing the invite capability |
| `plan_onboarding_change` | Discord read | Verify one exact complete onboarding replacement against identity, current ownership, future-field, permission, role, channel, emoji, enablement, privacy, and local-bound evidence and produce a keyed digest |
| `execute_onboarding_change` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, replace the complete state once without retry, validate authoritative response IDs, and verify a complete fresh readback |
| `plan_guild_expression_change` | Discord and optional local read | Verify one exact emoji or sticker create, update, or delete against identity, complete privacy-safe inventory, ownership-aware permissions, role references, collision and capacity evidence, and a validated local file when creating, then produce a keyed digest |
| `execute_guild_expression_change` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, mutate once without retry, and verify exact metadata or absence without exposing or persisting expression content |
| `plan_automod_change` | Discord read | Verify one strict AutoMod create, update, enable, disable, or delete request against identity, lifecycle, complete policy, permission, capacity, and exact reference evidence and produce a keyed digest |
| `execute_automod_change` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, mutate once without retry, and verify exact transient policy state or absence without persisting policy content |
| `plan_scheduled_event_change` | Discord and optional local read | Verify one exact event create, metadata update, lifecycle transition, or delete against identity, privacy-safe state, hosting, recurrence, timing, ownership, entity-specific permissions, visible capacity, and an optional validated local cover, then produce a keyed digest |
| `execute_scheduled_event_change` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, mutate once without retry, and verify exact privacy-safe state or absence without persisting event content |
| `plan_channel_permission_overwrite` | Discord read | Verify one exact role or member update or deletion against complete overwrite, role, authority, lockout, effective-access, and parent-synchronization evidence and produce a keyed digest |
| `execute_channel_permission_overwrite` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, update or delete one exact overwrite without retry, and read back the complete overwrite set |
| `plan_channel_creation` | Discord read | Verify one additive category, text, or forum target against live permission, collision, parent, and visible-capacity evidence and produce a keyed digest |
| `execute_channel_creation` | Discord write | Confirm, revalidate, reserve the one-shot key, journal, create once, and read back the reviewed channel without editing or rollback |
| `plan_forum_post` | Discord read | Verify one exact public forum, title, starter message, available tag set, thread settings, notifications, complete permission evidence, and one-shot intent and produce a keyed digest |
| `execute_forum_post` | Discord write | Confirm, revalidate, reserve the one-shot key, journal, create one thread and starter message without retry, and perform exact readback without editing, deletion, or rollback |
| `plan_guild_scaffold` | Discord read | Verify one bounded additive role and channel graph against identity, scope, collision, hierarchy, permission, capacity, dependency, and durable-checkpoint evidence and produce a keyed frontier digest |
| `execute_guild_scaffold` | Discord write | Confirm, revalidate, durably bind and resume the exact request, execute only the reviewed ready frontier with non-retried writes and exact readbacks, and pause for a fresh plan at dependencies or the step limit |
| `plan_member_role_change` | Discord read | Verify one exact allowlisted role add or remove against identity, protected-target, complete role and direct-channel, hierarchy, permission-escalation, and before-and-after impact evidence and produce a keyed digest |
| `execute_member_role_change` | Destructive Discord write | Confirm, revalidate, reserve the one-shot key, journal, add or remove one exact role without retry, and read back the exact member role state without replacing the full role array or rolling back |
| `plan_role_creation` | Discord read | Verify one additive role against complete inventory, collision, capacity, bot permission, hierarchy, and requested-permission-subset evidence and produce a keyed digest |
| `execute_role_creation` | Discord write | Confirm, revalidate, reserve the one-shot key, journal, create once without automatic retry, and read back the exact reviewed role without editing or rollback |
| `plan_member_moderation` | Discord read | Verify one exact target, permission and hierarchy evidence, action state, and keyed moderation digest |
| `execute_member_moderation` | Discord write | Confirm, revalidate, journal, and execute the reviewed exact-ID member action |
| `list_activity` | Local read | Read content-free attachment, AutoMod, channel-creation, forum-post, guild-expression, invite-deletion, onboarding-change, scheduled-event, scaffold-step, member-role, role-creation, message-pin, webhook-deletion, permission-overwrite, deletion, interaction, and member-moderation activity |

## Resources

MCP resource discovery lists only stable metadata. Listing resources or templates does not call the connector service or Discord. Fixed resources are:

| Resource | Source | Purpose |
| --- | --- | --- |
| `discord://connector/safety` | Static | Explain trust boundaries and reviewed workflows without identity or Discord data |
| `discord://connector/policy` | Local | Report effective scope and write policy without credentials or Discord access |
| `discord://connector/activity` | Local | Return a bounded content-free activity page without exposing the local file path |
| `discord://connector/observability` | Local | Return process-local operation aggregates, exporter health, and telemetry privacy guarantees |
| `discord://gateway/status` | Local | Report Gateway state, privacy guarantees, and content-free counters |
| `discord://gateway/events` | Gateway buffer | Return the most recent retained in-scope event kinds and identifiers |
| `discord://guilds` | Discord read | Return one bounded page of normalized in-scope guild metadata |

Live templates are non-enumerable and require exact IDs:

| Resource template | Purpose |
| --- | --- |
| `discord://guilds/{guildId}/channels` | Read normalized in-scope channel metadata for one guild |
| `discord://guilds/{guildId}/automod-rules` | Read the bounded privacy-safe AutoMod inventory, exact reference health, and complete permission evidence for one separately allowlisted guild without policy strings |
| `discord://guilds/{guildId}/emojis` | Read the complete bounded privacy-safe emoji inventory and ownership-aware permission evidence for one separately allowlisted guild |
| `discord://guilds/{guildId}/invites/{inviteRef}` | Resolve one process-local opaque invite reference through a fresh complete capability-safe guild inventory |
| `discord://guilds/{guildId}/onboarding` | Read one complete bounded privacy-minimized onboarding audit with member-facing text always omitted and unknown fields or enums represented only by counts |
| `discord://guilds/{guildId}/roles` | Read the complete normalized role inventory for one guild |
| `discord://guilds/{guildId}/roles/{roleId}` | Read one exact normalized role from one guild |
| `discord://guilds/{guildId}/scheduled-events` | Read the complete bounded privacy-safe scheduled-event inventory and entity-specific permission evidence for one separately allowlisted guild without subscriber counts |
| `discord://guilds/{guildId}/stickers` | Read the complete bounded privacy-safe sticker inventory and ownership-aware permission evidence for one separately allowlisted guild |
| `discord://guilds/{guildId}/members/{userId}` | Read one exact privacy-minimized member from a separately allowlisted guild |
| `discord://guilds/{guildId}/bans/{userId}` | Read one exact privacy-minimized ban from a separately allowlisted guild with the reason always omitted |
| `discord://channels/{channelId}/access` | Explain the verified bot's effective access to one channel or thread |
| `discord://channels/{channelId}/permission-overwrites` | Page normalized exact-target overwrites and inherited thread-source evidence for one channel or thread |
| `discord://channels/{channelId}/webhooks` | Read one complete credential-redacted webhook inventory for an exact separately allowlisted direct guild channel |
| `discord://channels/{channelId}/messages/{messageId}` | Read one exact message from one permitted channel |

Every Discord-backed JSON resource carries an `untrusted-external-data` classification and an instruction to treat returned strings as data. The exact-message resource is deliberately compact: it includes message content, author identity, timestamps, jump URL, compact attachment metadata, and counts while omitting attachment URLs and raw embeds, components, reactions, and mention payloads. Existing service checks still verify the bot identity, exact returned IDs, guild and channel scope, and fixed Discord API origin before the resource is returned.

Resource payloads and failures pass through the same recursive token-redaction boundary as tools. Live reads use private zero-lifetime cache hints. Only the identity-free static safety guide is eligible for shared caching.

## Real-time Gateway events

Set `DISCORD_MCP_ALLOW_GATEWAY=true` only after `DISCORD_MCP_APPLICATION_ID`, `DISCORD_MCP_BOT_ID`, and at least one exact guild or channel read allowlist are configured. The stdio server then opens one native WebSocket connection to Discord. Constructing the MCP adapter, running `doctor`, running `setup`, and running `smoke` never open that connection. Initial connections use Discord's fixed Gateway origin; resume URLs received from Discord are accepted only for credential-free `wss` hosts in Discord's Gateway host family.

The connection implements bounded connection and authentication deadlines, jittered heartbeats, acknowledgement timeouts, session resume, invalid-session delay, capped reconnect backoff, fatal close handling, idempotent shutdown on stdio termination, and a conservative process-local Identify budget. READY must identify the configured application and exact bot user before the feed accepts dispatches. Replayed dispatches received during a valid Resume are normalized instead of dropped. `get_gateway_status` distinguishes `disabled`, `connecting`, `authenticating`, `ready`, `reconnecting`, `failed`, and `stopped`, and reports only fixed error categories. It never returns the token, raw errors, WebSocket address, session ID, or Discord Gateway sequence.

The feed handles guild, channel, channel-pin, thread, role, message, bulk-deletion, reaction, and poll-vote lifecycle changes. A pin update is exposed only as a scoped `channel-pins-updated` invalidation event without message content or Discord's last-pin timestamp. Startup guild and thread synchronization records only a bounded ephemeral channel-to-parent identifier map so an allowlisted parent can grant read scope to child threads. Direct messages, out-of-scope guilds, unknown out-of-scope channels, malformed dispatches, and raw Discord strings are discarded. Public records contain a local receipt time, a fixed event kind, an opaque cursor, and only the relevant guild, channel, parent, role, or message IDs.

Opaque cursors belong to one running process and never reuse Discord's sequence. If a cursor belongs to another process, predates retained history, crosses a connection gap, is malformed, or points ahead of the local feed, `get_gateway_events` returns retained events with `resetRequired`, an exact reset reason, and a new cursor. A successful Resume preserves cursor continuity; fallback Identify, terminal failure, and stopping an established session rotate the cursor generation. Buffer overflow and connection gaps have separate content-free counters instead of pretending uninterrupted delivery.

Both Gateway resources are listed and readable even while the feature is disabled. When enabled, the server advertises resource subscription support. Legacy clients may subscribe to either exact URI through `resources/subscribe`; modern clients may include the URI in `subscriptions/listen`. Keyed leading-and-trailing coalescing limits notification traffic while preserving every retained event in the readable buffer. A notification contains only the resource URI and tells the client to read the bounded snapshot.

## Privacy-safe observability

Bounded aggregate observability is always available through `get_observability_status` and `discord://connector/observability`. It counts completed MCP tool and Discord REST operations, errors, retries, active calls, outcome classes, and fixed duration buckets. The snapshot is process-local, never persisted, and includes explicit machine-readable privacy claims. Unknown operation names collapse to `unknown` rather than creating unbounded or attacker-controlled labels.

Set `DISCORD_MCP_OBSERVABILITY_LOGS=true` to write compact JSON records for completed operations, exporter transitions, and export results to stderr. Records use only fixed tool or REST operation names, outcome and error categories, numeric HTTP status and retry data, durations, and timestamps. Standard connector diagnostics remain separate human-readable stderr lines.

Collector export remains inert unless `DISCORD_MCP_ALLOW_OBSERVABILITY_EXPORT=true`. The stdio runner then emits manually created OTLP/HTTP protobuf traces and metrics. MCP tool spans parent their Discord REST spans. The implementation does not install automatic HTTP, logging, or exception instrumentation and creates no span events or links. Tool arguments and results, Discord identifiers, raw routes and URLs, request or response bodies, headers, bot tokens, error text and stacks, plan digests, Gateway records, and activity records never enter spans, metrics, logs, or local aggregates.

The connector supports the standard OTLP endpoint, header, protocol, compression, timeout, service-name, and trace-sampler variables listed above, with explicitly configured per-signal settings taking precedence. Remote collectors require HTTPS. Plaintext HTTP is accepted only for `localhost`, `127.0.0.0/8`, or `[::1]`; URLs with credentials, query strings, or fragments are rejected. Header names and percent-decoded values are bounded, newline-free, and rejected if they contain the Discord token. Service names reject snowflake-like numeric identifiers. Runtime status reports only whether endpoints or headers were configured, never their values.

Exporter failures are observational: they update fixed health counters but never fail a Discord or MCP operation. The connector uses private trace and metric providers so a preloaded global OpenTelemetry SDK cannot redirect its telemetry or contribute unrelated spans and metrics. Shutdown performs a bounded final trace and metric flush. Constructing the adapter directly, and running `doctor`, `setup`, or `smoke`, never opens a collector connection even when export configuration is present; only the stdio runner owns exporter startup and shutdown.

## Prompts

MCP prompts are explicit user-selected workflow templates. Rendering a prompt performs no Discord, local-file, local-activity, planning, or write call. Arguments remain flat MCP strings but are strictly validated and converted into a one-line JSON input object so arbitrary text cannot escape into workflow instructions. The guild-scaffold prompt accepts bounded strict JSON arrays inside two flat string arguments, validates their complete graph locally, and then emits arrays in the literal tool input. The permission-overwrite prompt accepts bounded `PERMISSION:state` entries, validates every permission name and `allow`, `deny`, or `inherit` state locally, and emits only the named changes. The guild-expression prompt validates the action-specific flat fields, converts comma-separated role IDs to exact arrays, and rejects URLs, base64 payload fields, relative paths, duplicate IDs, and fields unrelated to the selected action. The AutoMod and onboarding prompts each accept one strict request JSON object because nested prompt arguments are not portable, validate the complete action-specific input locally, and emit only that exact validated input. The scheduled-event prompt validates action-specific hosting and lifecycle fields, canonical timestamps, local cover paths, and one strict recurrence JSON value. The invite-deletion prompt accepts only an exact guild ID, opaque process-local reference, bounded audit reason, and operation key; no invite code or URL field exists. Rendered prompts pass through the connector's token-redaction boundary before they are returned. Message prompts are listed only with the `messages` toolset, `find_guild_members` is listed only with `members`, `inspect_guild_ban` is listed only with `bans`, and each reviewed prompt is listed only with its matching `attachments`, `automod`, `forum-posts`, `guild-expressions`, `scheduled-events`, `onboarding`, `guild-scaffolds`, `channel-creation`, `member-roles`, `role-creation`, `pins`, `webhooks`, `invites`, `permission-overwrites`, `deletion`, or `moderation` toolset.

| Prompt | Workflow boundary |
| --- | --- |
| `summarize_channel` | Read one bounded message page, cite evidence, and make no search or write call |
| `search_guild_messages` | Run one bounded native content search, preserve indexing status, and make no write call |
| `find_guild_members` | Run one bounded prefix search, present exact user IDs and minimized fields, and stop before any member-targeting action |
| `inspect_guild_ban` | Read one exact privacy-minimized ban, optionally include its bounded reason, and stop before listing or moderation |
| `review_attachment_message` | Build and review one exact byte-bound local-file attachment plan, then stop before execution |
| `review_channel_creation` | Build and review one additive keyed channel-creation plan, then stop before execution |
| `review_forum_post` | Build and review one exact keyed public forum-post plan, then stop before execution |
| `review_guild_expression_change` | Build and review one exact privacy-safe emoji or sticker create, update, or delete plan, then stop before execution |
| `review_automod_change` | Build and review one strict privacy-safe AutoMod create, update, enable, disable, or delete plan, then stop before execution |
| `review_scheduled_event_change` | Build and review one exact privacy-safe event create, metadata update, lifecycle transition, or delete plan, then stop before execution |
| `review_guild_scaffold` | Build and review one bounded resumable additive scaffold frontier, then stop before execution |
| `review_member_role_change` | Build and review one exact allowlisted member-role add or remove plan with bounded direct-channel impact, then stop before execution |
| `review_role_creation` | Build and review one additive keyed role-creation plan with exact named permissions, then stop before execution |
| `review_message_deletion` | Build and review an exact keyed deletion plan, then stop before execution |
| `review_message_pin` | Build and review one exact content-bound pin-state plan, then stop before execution |
| `review_webhook_deletion` | Build and review one exact credential-free Incoming-webhook deletion plan, then stop before execution |
| `review_invite_deletion` | Build and review one capability-safe invite revocation plan from an opaque process-local reference, then stop before execution |
| `review_onboarding_change` | Build and review one exact complete guild onboarding replacement plan with all additions, removals, modifications, and safety evidence, then stop before execution |
| `review_channel_permission_overwrite` | Build and review one exact named-delta update or explicit overwrite-deletion plan, then stop before execution |
| `review_member_moderation` | Build and review one exact keyed moderation plan, then stop before execution |

The attachment, AutoMod, channel-creation, forum-post, guild-expression, scheduled-event, onboarding, guild-scaffold, member-role, role-creation, message-pin, webhook-deletion, invite-deletion, channel-permission-overwrite, deletion, and moderation prompts do not collapse approval stages. They explicitly forbid their execution tools, leaving client write approval, signed elicitation, fresh-plan verification, interactive confirmation, and pending content-free records on the separate write call.

## Search

`search_messages` uses Discord's native guild search endpoint rather than scanning a recent-message window. It requires at least one substantive filter and supports content, channel, author, mention, reply, attachment, embed, link, pin, message-ID, and sort filters. The connector accepts at most 25 filters of each list type through MCP and at most 25 returned messages per request, even where Discord permits larger filter arrays.

Search is scoped before the request leaves the process. If a local channel allowlist exists and the call omits `channelIds`, the connector injects the exact allowlist into Discord's request. A caller-supplied channel list must be an exact subset. If the configured allowlist exceeds Discord's channel-filter capacity, the caller must provide a bounded subset instead of falling back to guild-wide search.

Results include message content, author identity, jump URLs, counts, and compact attachment metadata. They omit attachment URLs, raw embeds, raw components, reactions, and Discord's member payload. Discord can report approximate totals, return fewer results than requested, or answer with an indexing status. The connector advances pagination by the requested page size and returns indexing progress plus a retry delay without sleeping inside an MCP call.

Discord restricts native search based on the application's Message Content privileged intent. `get_connector_status`, online `doctor`, and `setup` report whether the application flags confirm that intent. See Discord's [message search reference](https://docs.discord.com/developers/resources/message#search-guild-messages).

## Privacy-safe member directory

The `members` toolset is disabled at the policy layer until `DISCORD_MCP_ALLOW_MEMBER_DIRECTORY=true` and a non-empty `DISCORD_MCP_MEMBER_DIRECTORY_GUILD_IDS` allowlist are both present. That allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the outer read allowlist exists. Discord's `list_guild_members` endpoint additionally requires the Guild Members privileged intent at the application level, independently of the intents sent during Gateway Identify. The optional Gateway continues to identify with nonprivileged intents, and the directory uses bounded REST requests without adding a member cache.

`get_guild_member` accepts one exact guild and user ID. `list_guild_members` returns at most 100 records in strictly ascending user-ID order and accepts only the prior response's `nextAfterUserId`; a full page exposes a cursor but does not claim another page is guaranteed. `search_guild_members` returns at most 25 records from Discord's documented username-or-nickname prefix route. It does not claim fuzzy, substring, relevance-ranked, or exhaustive results. `find_guild_members` renders one single-search workflow and stops before any write or moderation call.

Every result contains only the exact user ID, bounded username, nullable global name and nickname, bot state, exact role IDs, nullable join time, nullable membership-screening state, and nullable timeout expiry. Avatar and banner data, decorations, collectibles, discriminator, presence, voice state, boost state, permissions, role names, flags, and raw payload fields are discarded before return. Responses and search queries are never cached, persisted, journaled, or used in telemetry. Discord names remain untrusted display data and can never substitute for an exact user ID in a write workflow. The exact `discord://guilds/{guildId}/members/{userId}` resource applies the same policy and minimization.

Identity pins and local scope are verified before each member request. Remote records must carry unique positive snowflakes, bounded valid text, consistent exact identities, valid timestamps, unique role IDs, and documented cursor ordering or the read fails closed. `get_connector_status`, online `doctor`, and `setup` report the application's Guild Members intent state without listing members, and diagnose a missing flag specifically as a member-listing failure. See Discord's [guild member reference](https://docs.discord.com/developers/resources/guild#guild-member-object), [list endpoint](https://docs.discord.com/developers/resources/guild#list-guild-members), and [search endpoint](https://docs.discord.com/developers/resources/guild#search-guild-members).

## Privacy-safe guild ban audit

The `bans` toolset is disabled at the policy layer until `DISCORD_MCP_ALLOW_BAN_AUDIT=true` and a non-empty `DISCORD_MCP_BAN_AUDIT_GUILD_IDS` allowlist are both present. That allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the outer read allowlist exists. Every request verifies the pinned application and bot identity, exact guild and owner, exact bot membership, complete bounded role inventory, and guild-level `BAN_MEMBERS` permission or guild ownership. Ban audit uses REST and does not require the Guild Members privileged intent or member-directory policy.

`list_guild_bans` returns at most 100 records in strictly ascending user-ID order. It accepts only an exact prior `nextAfterUserId` cursor and privately requests one additional record, so `hasMore` and the next cursor appear only when another page is proven. The default page size is 25. `get_guild_ban` uses Discord's exact guild-and-user route and reports a private `not-found` result for a valid missing target rather than substituting a neighboring record. The `inspect_guild_ban` prompt performs one exact read and stops before listing, moderation, or any write.

Each record contains only the exact user ID, bounded username, nullable global name, bot state, and whether a reason exists. Avatars, discriminators, decorations, banners, flags, and unknown raw fields are discarded. Reasons are bounded and omitted unless the caller explicitly sets `includeReasons` or `includeReason`; the exact `discord://guilds/{guildId}/bans/{userId}` resource never includes a reason. Profiles, reasons, raw payloads, and pagination results are never cached, persisted, journaled, or exported. Names and reasons remain untrusted display data and can never become a moderation target or instruction.

Malformed, duplicate, unordered, cursor-violating, oversized, mismatched, or invalid-Unicode Discord evidence fails closed, including malformed reasons that were not requested for display. This protects the privacy boundary from unknown response shapes instead of silently forwarding them. See Discord's [guild ban reference](https://docs.discord.com/developers/resources/guild#get-guild-bans) and [exact ban endpoint](https://docs.discord.com/developers/resources/guild#get-guild-ban).

## Threads and forums

`list_active_threads` returns a bounded view of active guild threads and can restrict results to one permitted parent. Forum and media posts are represented by Discord as public threads, so normalized results preserve their parent IDs and applied tag IDs. `list_channels` also preserves forum tag definitions, default reaction, layout, sort order, auto-archive duration, slowmode, and channel jump URLs.

`list_archived_threads` supports three views. `public` includes archived forum and media posts and uses an ISO 8601 timestamp cursor. `private` lists all private archived threads and additionally requires Discord's `Manage Threads` permission. `joined-private` lists only private threads joined by the bot and uses a thread-ID cursor. The result returns a visibility-tagged next cursor so callers cannot accidentally reuse the wrong cursor type.

An allowlisted parent grants local read scope to its child threads. This inheritance does not broaden deletion or pin management: a thread must still appear by its own exact ID in the corresponding write allowlist. Permission-overwrite mutation rejects threads entirely because Discord threads inherit their parent's overwrite set. Discord's [channel resource reference](https://docs.discord.com/developers/resources/channel) documents thread and forum behavior.

## Reviewed message pins

`list_message_pins` is a read-only current-state view under ordinary channel scope. It calls Discord's current `/channels/{channel.id}/messages/pins` endpoint, accepts an optional ISO 8601 `before` cursor and a bounded limit, and returns normalized messages paired with their `pinnedAt` timestamps plus an evidence-backed next cursor. It never uses the deprecated unpaginated channel-pins route and never persists a returned message.

Pin changes have no immediate-call path. Set `DISCORD_MCP_ALLOW_PIN_MANAGEMENT=true` and list every eligible channel or thread by its own exact ID in `DISCORD_MCP_PIN_CHANNEL_IDS`. The pin allowlist must be a subset of `DISCORD_MCP_ALLOWED_CHANNEL_IDS` when the read allowlist exists. Parent scope never grants pin authority to a child thread. Grant the bot `View Channel`, `Read Message History`, and Discord's dedicated `Pin Messages` permission in each selected target. Voice and stage channels also require `Connect` so the exact message state is readable. The planner does not accept legacy `Manage Messages` as a substitute for `Pin Messages`.

1. Call `plan_message_pin` with the exact channel, exact message, desired `pinned` or `unpinned` state, Discord audit-log reason, and unique one-shot operation key.
2. Review the verified application and bot IDs, exact guild and channel, untrusted message preview, current and desired states, permission source, private-thread evidence, warnings, operation-key hash, and keyed digest.
3. If the action is `none`, the message already has the requested state and no confirmation, reservation, or activity record is needed.
4. Call `execute_message_pin` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact identity, state, permission, warning, reason, operation-key hash, and digest remains intended.
6. Review the returned exact message state, review-snapshot match, jump URL, activity ID, and outcome before any follow-up.

Planning verifies the application and bot identity, mutation scope, exact target channel and message, guild, connector membership, complete bounded role evidence, permission-source overwrites, and private-thread membership when applicable. Threads inherit permission overwrites only from their exact validated parent. Missing, malformed, mismatched, partial, or insufficient evidence fails closed. Both pin and unpin are exposed through the same destructive MCP annotation and reviewed gates because unpin removes shared state.

The process-keyed HMAC digest binds the normalized request, operation-key hash, verified identities, exact guild and channel evidence, relevant roles and overwrites, current pin state, review-relevant message snapshot, and permission result. Full message content and attachment metadata enter only that opaque HMAC so an edit invalidates approval; they never enter activity records, receipts, diagnostics, telemetry, or errors. A connector restart invalidates the digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation.

Before one non-retried PUT or DELETE, execution atomically reserves the operation-key hash and appends a pending content-free activity record. It then fetches the exact message again and verifies both the requested `pinned` boolean and the review-relevant message snapshot. A fully matching readback is `completed`; a contradictory but valid pin state or a concurrent message edit is `completed-with-drift`. A known pre-write Discord 4xx is `failed`. Transport failures, Discord 5xx responses, or any failure after the mutation may have completed are `uncertain`. Every reserved key remains permanently spent, and no automatic retry or compensating rollback occurs.

Changes to the same channel and message serialize within one connector process and replan after a preceding determinate outcome. An uncertain result blocks queued same-target changes before they reserve another key. This does not provide cross-process exclusion, so do not run connector processes with overlapping pin-management scope. See Discord's [message pin endpoints](https://docs.discord.com/developers/resources/message#get-channel-pins) and [permission flags](https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags).

## Credential-redacted webhook audit and cleanup

`list_channel_webhooks` and `get_channel_webhook` expose one complete webhook inventory or one exact inventory member for a separately allowlisted direct guild channel. Set `DISCORD_MCP_ALLOW_WEBHOOK_AUDIT=true` and list every eligible channel by its own exact ID in `DISCORD_MCP_WEBHOOK_CHANNEL_IDS`. The webhook allowlist must be a subset of `DISCORD_MCP_ALLOWED_CHANNEL_IDS` when the read allowlist exists. Supported targets are text, announcement, forum, media, voice, and stage channels; categories, threads, direct messages, and group direct messages fail closed. Parent scope never grants webhook scope to a child thread.

Every inventory read verifies the application and bot identity, exact channel and guild, connector member, complete bounded role evidence, channel overwrites, and channel-level `VIEW_CHANNEL` plus `MANAGE_WEBHOOKS`. The service applies a fixed local safety ceiling to Discord's non-paginated response and requires unique exact IDs with matching channel and guild evidence. It derives creation time locally from each webhook snowflake rather than trusting an extra response field.

The REST client projects each raw webhook before returning it to the service. Results contain only webhook, guild, channel, application, and creator user IDs; type; creation time; and name. The channel envelope is independently reduced to its ID, guild ID, bounded name, parent ID, numeric type, and fixed type name; topics, forum metadata, message state, and raw overwrite bodies are omitted. Webhook credentials, execution URLs, avatars, full creator profiles, source guilds, source channels, and unknown future raw fields are dropped. The equivalent `discord://channels/{channelId}/webhooks` resource uses the same policy and projection. The MCP schema accepts no credential or webhook URL. Webhook creation, execution, editing, message posting, and credential-authenticated deletion are deliberately unavailable.

Incoming-webhook deletion has no immediate-call path. Keep `DISCORD_MCP_ALLOW_WEBHOOK_DELETIONS` disabled unless permanent cleanup is needed; enabling it also requires webhook audit to remain enabled and uses the same exact direct-channel allowlist. Channel-follower and application webhooks remain inventory-only because deleting them safely requires different ownership and lifecycle evidence.

1. Call `plan_webhook_deletion` with the exact channel ID, exact Incoming webhook ID, Discord audit-log reason, and unique one-shot operation key.
2. Review the verified application and bot IDs, exact guild and direct channel, credential-redacted target, type, creation time, permission source, complete permission and privacy evidence, warnings, operation-key hash, and keyed digest.
3. Call `execute_webhook_deletion` with identical inputs plus the digest.
4. Approve the signed MCP confirmation only if every exact identity, omission, permission, warning, audit reason, operation-key hash, and digest remains intended.
5. Review the returned exact webhook ID, verified-absence result, activity ID, and outcome before any follow-up.

The process-keyed HMAC digest binds the normalized request, one-shot operation-key hash, verified application and bot identities, exact guild and channel, full projected webhook inventory, connector member and relevant role state, overwrites, effective permission evidence, privacy projection, and warnings. A connector restart invalidates the digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation. Any renamed, added, removed, retyped, or rehomed webhook changes the reviewed snapshot.

Execution atomically reserves the operation-key hash and appends a pending content-free activity record before one bot-authenticated non-retried DELETE. It then fetches the full channel inventory and requires the exact webhook to be absent. Verified absence is `completed`; a valid inventory in which the target remains is `completed-with-drift`; a known pre-write Discord 4xx is `failed`; transport failure, Discord 5xx, failed readback, or any otherwise indeterminate post-write state is `uncertain`. Every reserved key remains permanently spent, and the connector performs no automatic retry, credential fallback, message execution, or compensating write.

Discord's bot-authenticated modify operation can move a webhook to another channel, while deletion is addressed by webhook ID rather than by channel and webhook together. The connector minimizes this unavoidable race with a complete fresh channel inventory immediately before deletion and exact absence readback immediately after it, but those calls are not atomic with the DELETE. Keep the bot's Discord-level `MANAGE_WEBHOOKS` permission denied outside the exact selected channels, and use an exclusive maintenance window or otherwise prevent concurrent webhook administration when deleting a high-risk integration.

Changes to the same exact webhook ID serialize within one connector process, including requests that identify different channels after a move. An uncertain result blocks queued same-target deletions before they reserve another key. This does not provide cross-process exclusion, so do not run connector processes with overlapping webhook-deletion scope. Activity and operation records contain only exact guild, channel, and webhook IDs, plan digest, operation-key hash, timestamps, fixed verification and outcome values, activity ID, and sanitized error category. See Discord's [webhook resource](https://docs.discord.com/developers/resources/webhook) and [permission flags](https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags).

## Capability-safe guild invite audit and revocation

`list_guild_invites` and `get_guild_invite` expose a bounded security inventory or one exact inventory member for a separately allowlisted guild. Set `DISCORD_MCP_ALLOW_INVITE_AUDIT=true` and list every eligible guild in `DISCORD_MCP_INVITE_GUILD_IDS`. The invite allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the outer read allowlist exists. Every read verifies the expected application and bot, exact guild and owner, connector membership, complete bounded role and channel inventories, and effective guild-level `MANAGE_GUILD` permission. The connector deliberately does not offer a reduced `VIEW_AUDIT_LOG` mode because Discord includes complete invite metadata only for callers with `MANAGE_GUILD`.

An invite code or URL is a bearer capability. The REST client therefore keeps the code only in transient private state and immediately projects every raw response to bounded metadata. MCP results expose a process-keyed HMAC reference, exact channel identity and type, inviter user ID without a profile, creation and expiration time, usage limits and counts, temporary-membership state, target kind and ID, known and unknown flags, and any granted role IDs with named, unknown, and high-risk permission evidence. Risk flags call out prior use because [Discord documents that deleting an invite does not remove roles granted by earlier uses](https://docs.discord.com/developers/tutorials/using-community-invites). Guild objects, invite URLs, inviter and target profiles, role names and visuals, scheduled-event and stage objects, application metadata, approximate counts, and unknown raw fields are omitted. The opaque reference cannot be converted back into a code and expires when the connector process restarts.

Discord's guild-invite endpoint is not documented as paginated. The connector fetches one complete inventory under a fixed local safety ceiling, validates every invite against the complete channel and role evidence, sorts the opaque references, and then pages locally. Each continuation cursor is authenticated and binds the exact guild, inventory digest, and next offset. Following a cursor fetches and validates another complete fresh inventory; any addition, removal, use-count change, metadata change, cursor edit, or process restart rejects the page and requires pagination to restart. Exact lookup likewise resolves a known opaque reference only through a complete fresh inventory. The exact `discord://guilds/{guildId}/invites/{inviteRef}` resource uses the same policy, validation, and projection.

Invite revocation has no immediate-call path. Keep `DISCORD_MCP_ALLOW_INVITE_DELETIONS` disabled unless permanent capability removal is needed; enabling it also requires invite audit to remain enabled and uses the same exact guild allowlist. The MCP schema accepts an opaque reference rather than a code or URL, and the audit reason rejects the target code and invite URLs before mutation.

1. Call `list_guild_invites` and identify the intended capability by its opaque reference, channel, lifetime, use limits, target, granted roles, permission evidence, and risk flags.
2. Call `plan_invite_deletion` with the exact guild ID, opaque reference, Discord audit-log reason, and unique one-shot operation key.
3. Review the verified application and bot IDs, exact guild and channel, target metadata, complete `MANAGE_GUILD` evidence, inventory bounds, privacy omissions, risk warnings, operation-key hash, and keyed digest.
4. Call `execute_invite_deletion` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact identity, omission, permission, risk, audit reason, operation-key hash, and digest remains intended.
6. Review the returned opaque reference, channel ID, verified-absence result, activity ID, and outcome before any follow-up.

The process-keyed HMAC digest binds the normalized request, one-shot operation-key hash, verified application and bot identities, exact guild and owner, complete projected invite inventory, complete channels and roles, connector membership, effective permission evidence, privacy projection, inventory bounds, and warnings. A connector restart invalidates both the reference and digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation. Normal invite use changes the reviewed snapshot, so an active invite may require a new plan rather than silently revoking state that no longer matches the review.

Execution atomically reserves the operation-key hash and appends a pending content-free activity record before one non-retried bot-authenticated DELETE. The code-bearing route is replaced with a fixed diagnostic route, response bodies and transport causes cannot enter errors, and observability receives only the fixed operation name. A successful response must identify the exact reviewed code, guild, channel, and invite type. The connector then fetches the complete inventory again and requires the opaque reference to be absent. Verified absence is `completed`; a valid inventory in which the reference remains is `completed-with-drift`; a known pre-write Discord 4xx is `failed`; transport failure, Discord 5xx, malformed success, failed identity validation, or failed readback is `uncertain`. Every reserved key remains permanently spent, and the connector performs no automatic retry, compensating write, or capability disclosure.

Discord deletes an invite by its secret code and offers no conditional deletion primitive that can atomically bind the preceding inventory review. The connector narrows this unavoidable race with a complete fresh inventory immediately before deletion, a plan digest covering that inventory, returned-target validation, and complete absence readback. Prevent concurrent invite administration during a high-risk revocation. Same-reference executions serialize within one service process, and an uncertain outcome permanently blocks later same-reference attempts in that process before another read, reservation, or write. This does not provide cross-process exclusion, so do not run connector processes with overlapping invite-deletion scope.

Activity and operation records contain only the exact guild and channel IDs, opaque invite reference, plan digest, operation-key hash, timestamps, fixed verification and outcome values, activity ID, and sanitized error category. Connector-derived invite codes, URLs, guild and user profiles, role names, channel names, audit reasons, raw operation keys, raw responses, and transport causes from code-bearing routes never enter MCP results, resources, persistent records, diagnostics, or telemetry. Tool and prompt schemas expose no invite-code or URL field. Operators must not paste a bearer capability into the free-text audit reason; the connector rejects invite URLs locally and rejects the exact target code after fresh lookup. See Discord's [invite resource](https://docs.discord.com/developers/resources/invite) and [permission flags](https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags).

## Privacy-minimized guild onboarding and reviewed replacement

`get_guild_onboarding` returns one complete bounded onboarding audit for a separately allowlisted guild. Set `DISCORD_MCP_ALLOW_ONBOARDING_AUDIT=true` and list every eligible guild in `DISCORD_MCP_ONBOARDING_GUILD_IDS`. This allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the outer read allowlist exists. The equivalent `discord://guilds/{guildId}/onboarding` resource applies the same policy and always omits member-facing text.

Every read verifies the expected application and bot, exact guild and owner, complete guild-feature evidence, connector membership, complete bounded roles, channels, permission overwrites, custom emojis, onboarding state, and effective permissions. Results identify whether the guild has Discord's `COMMUNITY` feature, current prompt and option structure, assignments, modes, enablement evidence, reference health, text lengths, unknown-field and unknown-enum counts, and the exact privacy projection. Prompt titles, option titles, descriptions, and Unicode emoji are omitted by default. Set `includeText=true` only when their transient review is necessary. Nothing from an onboarding read is cached, journaled, exported, or persisted.

Changes have no immediate-call path. Set `DISCORD_MCP_ALLOW_ONBOARDING_CHANGES=true` in addition to audit scope. The request is the complete desired state: enabled flag, mode, default channels, prompts, options, role and channel assignments, descriptions, and emoji. Omitted prompts, options, assignments, and default channels are deletions. Existing prompt IDs must belong to the fresh current configuration, and an existing option ID must remain under its fresh owning prompt. Omit an ID to request creation; the connector's required outbound prompt placeholders are transport-only and Discord's authoritative response IDs must replace them.

The connector requires complete guild-level `MANAGE_GUILD` and `MANAGE_ROLES` evidence, unless the connector bot is the exact guild owner. Every assignable role must exist, be standard rather than managed, carry zero permissions, and sit below the connector's highest role. Every referenced channel must exist as a direct guild channel and be visible to `@everyone`; a default channel must meet the same rule. When the desired configuration is enabled, the connector requires fresh `COMMUNITY` guild-feature evidence and conservatively proves Discord's default-channel visibility and sendability requirement in every mode. A reviewed disable remains available when the feature is absent. Custom emoji must be available and structurally valid, including any role restrictions. Administrator authority is allowed by Discord but appears as a least-privilege warning.

The request and audit surfaces use explicit connector-local safety bounds for text, prompts, options, references, and complete audit evidence. These values are returned in the plan and must not be interpreted as Discord platform limits. State outside those local bounds can still be audited when it fits the larger audit ceilings, but it cannot be copied into a replacement unless it satisfies the stricter write contract. Unknown response fields or enum values block replacement because a complete PUT could otherwise erase future state the connector does not understand.

1. Call `get_guild_onboarding` with text omitted to inspect structure, permission evidence, reference health, and unknown-field counts. Request transient text only if the member-facing copy itself must be reviewed.
2. Call `plan_onboarding_change` with the exact complete desired state, Discord audit-log reason, and unique one-shot operation key.
3. Review the verified application and bot IDs, exact guild, `COMMUNITY` feature state, complete current and desired state, additions, removals, modifications, role and channel safety, emoji health, enablement proof, unknown-field counts, local limits, privacy projection, risks, warnings, operation-key hash, and keyed digest.
4. If the plan reports `already-current`, no confirmation, reservation, activity record, or Discord write is needed.
5. Call `execute_onboarding_change` with identical inputs plus the digest.
6. Approve the signed MCP confirmation only if every identity, complete replacement field, deletion, permission, role, channel, emoji, audit reason, operation-key hash, risk, warning, and digest remains intended.
7. Review the exact outcome, activity ID, and verification result, then inspect the enabled join flow with a fresh non-staff member account.

The process-keyed HMAC digest binds the normalized complete request, one-shot operation-key hash, verified identities, exact guild, owner, and feature set, connector member roles, complete role, channel, overwrite, emoji, and current onboarding evidence, effective permissions, desired state, diff, local limits, privacy projection, risks, warnings, and verification boundary. A connector restart invalidates the digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation. Any identity, guild-feature, prompt, option, assignment, mode, enablement, permission, role, channel, overwrite, emoji, or unknown-field drift invalidates the reviewed plan.

Execution atomically reserves the operation-key hash and appends a pending content-free activity record before one non-retried complete-state PUT with an encoded Discord audit-log reason. The returned state must contain authoritative prompt and option IDs and must semantically match the desired state, including server-assigned IDs for new items. A second complete fresh read verifies the controlled state. Exact response and readback agreement is `completed`; valid semantic drift is `completed-with-drift`; a definite Discord client refusal is `failed`; transport failure, Discord server failure, malformed success, or failed verification is `uncertain`. Every reserved key remains permanently spent, with no automatic retry, rollback, or compensating replacement.

Changes to the same guild serialize within one connector process because every replacement shares the complete onboarding state, permission evidence, reference inventory, and capacity. An uncertain outcome permanently blocks later same-guild onboarding changes in that process before another read, reservation, or write. This does not provide cross-process exclusion, so do not run connector processes with overlapping onboarding-change scope.

Activity and operation records contain only exact guild, application, and bot IDs, plan digest, operation-key hash, timestamps, fixed verification and outcome values, activity ID, and sanitized error category. Prompt and option text, descriptions, Unicode emoji, guild, role, channel, and custom emoji names, permission evidence, audit reasons, raw operation keys, raw payloads, and transport causes never enter durable records, diagnostics, or telemetry. API response and fresh readback verify server-controlled state but cannot prove what a newly joining member sees in a Discord client, so the separate fresh non-staff client check remains part of the operator workflow. See Discord's [guild onboarding resource](https://docs.discord.com/developers/resources/guild#guild-onboarding-object) and [guild resource permissions](https://docs.discord.com/developers/resources/guild).

## Privacy-safe guild expressions and reviewed changes

`list_guild_emojis`, `get_guild_emoji`, `list_guild_stickers`, and `get_guild_sticker` expose complete bounded inventories or one exact inventory member for a separately allowlisted guild. Set `DISCORD_MCP_ALLOW_GUILD_EXPRESSION_AUDIT=true` and list every eligible guild in `DISCORD_MCP_GUILD_EXPRESSION_GUILD_IDS`. This allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the outer read allowlist exists. The equivalent `discord://guilds/{guildId}/emojis` and `discord://guilds/{guildId}/stickers` resources apply the same scope, projection, and permission evaluation.

Every inventory verifies the application and bot identity, exact guild and owner, connector membership, complete bounded role evidence, and effective guild permissions. Emoji results contain only exact ID, name, animation, availability, managed and colon requirements, creator user ID, and exact role restrictions. Sticker results contain only exact ID, guild ID, name, description, tags, format type, availability, and creator user ID. CDN URLs, image bytes, uploader profiles, and unknown raw fields are dropped before return, and inventory data is never cached or persisted.

Changes have no immediate-call path. Set `DISCORD_MCP_ALLOW_GUILD_EXPRESSION_CHANGES=true` in addition to audit scope. Creation also requires `DISCORD_MCP_GUILD_EXPRESSION_ROOTS` to contain one absolute canonical owned directory or a JSON array of such directories. Emoji creation accepts JPEG, PNG, GIF, WebP, or AVIF files up to 256 KiB. Sticker creation accepts 320 by 320 PNG, APNG, GIF, or Lottie JSON files up to 512 KiB, with animated content limited to five seconds. Lottie creation additionally requires fresh guild-feature evidence showing `VERIFIED` or `PARTNERED`. The planner inspects actual file structure rather than trusting a filename extension or caller-supplied media type.

The narrow action union supports emoji create with name and optional exact role IDs, emoji update with name or role IDs, sticker create with name, description and tags, sticker update with any changed metadata field, and exact-ID deletion for either kind. A zero-length role list deliberately removes emoji role restrictions, while a `null` sticker description deliberately clears it. Creation never accepts a URL, data URL, base64 payload, stream, or Discord CDN reference. Update and deletion never accept file input.

1. Call `plan_guild_expression_change` with the exact guild, kind, action-specific fields, Discord audit-log reason, and unique one-shot operation key.
2. Review the verified application and bot IDs, exact guild, current and desired privacy-safe metadata, ownership-aware permission evidence, role references, inventory count, privacy omissions, local file provenance when present, warnings, operation-key hash, and keyed digest.
3. If an update reports `already-current`, no confirmation, reservation, activity record, or Discord write is needed.
4. Call `execute_guild_expression_change` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact identity, metadata field, file property, permission, warning, audit reason, operation-key hash, and digest remains intended.
6. Review the returned expression ID, privacy-safe observed metadata or verified absence, activity ID, and outcome before any follow-up.

Discord requires `CREATE_GUILD_EXPRESSIONS` for creation. That permission also lets the bot update or delete an expression whose creator is that exact bot, while an expression owned by another user requires `MANAGE_GUILD_EXPRESSIONS`; guild ownership supplies both. Managed emojis cannot be mutated. Missing or duplicate role evidence, a role restriction absent from the complete guild inventory, a normalized name collision, local safety capacity, an absent target, incomplete permission evidence, or missing creator evidence when ownership is required blocks planning. Grant `MANAGE_GUILD_EXPRESSIONS` only when cross-owner administration is intentional.

For creation, planning opens the file without following the final symlink, verifies canonical containment, numeric process ownership, one hard link, regular-file type, exact bounded bytes, and stable metadata before and after the read. Format parsing validates container structure, dimensions where encoded, sticker dimensions, and animation duration. A process-keyed HMAC binds those bytes and stable file properties into the plan. The full plan digest also binds the normalized request, verified identities, exact guild and inventory, relevant role state, effective permission and ownership evidence, current and desired metadata, privacy projection, and warnings. A connector restart invalidates outstanding digests.

The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation. Execution atomically reserves the operation-key hash and appends a pending content-free activity record before exactly one non-retried Discord create, update, or delete. Creates and updates use an exact expression GET for readback; deletion requires exact absence from a fresh complete inventory. Matching metadata or absence is `completed`, valid server-adjusted state is `completed-with-drift`, a known pre-write Discord 4xx is `failed`, and transport failure, Discord 5xx, malformed success, or failed post-write verification is `uncertain`. Image bytes cannot be read back, so verification covers exact identity and stable metadata rather than pretending to compare Discord's stored pixels.

All expression changes in one guild serialize within one connector process because create, rename, and delete can affect the same collision and capacity evidence. An uncertain result blocks queued same-guild changes before they reserve another key. This does not provide cross-process exclusion, so do not run connector processes with overlapping guild-expression scope. Activity and operation records contain only exact guild and expression IDs, action and kind, plan digest, operation-key hash, timestamps, fixed verification and outcome values, activity ID, and sanitized error category. Names, descriptions, tags, role names, local paths, byte digests, image content, uploader profiles, audit reasons, and raw operation keys never enter durable records, diagnostics, or telemetry. See Discord's [emoji resource](https://docs.discord.com/developers/resources/emoji), [sticker resource](https://docs.discord.com/developers/resources/sticker), and [permission flags](https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags).

## Privacy-safe AutoMod rules and reviewed changes

`list_automod_rules` and `get_automod_rule` expose a bounded inventory or one exact AutoMod rule for a separately allowlisted guild. Set `DISCORD_MCP_ALLOW_AUTOMOD_AUDIT=true` and list every eligible guild in `DISCORD_MCP_AUTOMOD_GUILD_IDS`. This allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the outer read allowlist exists. The equivalent `discord://guilds/{guildId}/automod-rules` resource returns the same summary inventory.

Inventory deliberately exposes only each rule's exact ID, guild and creator IDs, name, enabled state, event and trigger types, action types, policy-entry and exemption counts, reference health, and complete permission evidence. Keyword filters, regex patterns, allow lists, preset selections, custom block messages, alert-channel IDs, timeout durations, and exact exemption IDs require `get_automod_rule` for one known rule. Exact policy is returned transiently for review but is never cached, journaled, exported, or copied into resource discovery. Both reads verify the application and bot identity, exact guild and owner, connector membership, complete bounded roles and channels, all referenced IDs, and `MANAGE_GUILD`.

Changes have no immediate-call path. Set `DISCORD_MCP_ALLOW_AUTOMOD_CHANGES=true` in addition to audit scope. The strict action union supports disabled creation, disabled-rule update, a separate enable or disable transition, and exact-ID deletion of a disabled rule. Create always sets `enabled` to false. An enabled rule must be disabled under its own reviewed plan before it can be edited or deleted, and Discord's immutable trigger type can change only through disabled deletion and a separately reviewed creation.

Supported triggers are keyword, keyword preset, spam, mention spam, and member profile. Supported actions are block message, send alert message, timeout, and block member interaction. Member-profile rules require block-member-interaction as their only action and cannot exempt channels; other triggers reject that action. Timeout is available only for keyword and mention-spam triggers, and creating, updating, or enabling a timeout-bearing rule requires `MODERATE_MEMBERS`. Rule names, policy strings, actions, exemptions, mention thresholds, timeout duration, and list sizes use strict closed schemas and Discord's documented bounds. Creation binds the complete inventory and enforces the connector safety ceiling plus per-trigger capacity: six keyword rules and one rule for each other trigger type.

Every desired exempt role and channel must resolve in the complete guild inventories, and the guild's `@everyone` role cannot be exempted. A send-alert action additionally requires its exact destination in `DISCORD_MCP_AUTOMOD_ALERT_CHANNEL_IDS`, an existing text or announcement channel, and complete effective `VIEW_CHANNEL` evidence for the connector. Alert actions can copy matched user content into that channel, so the destination allowlist is independent from general AutoMod guild scope and should remain narrow.

1. Call `plan_automod_change` with the exact guild, strict action-specific policy, Discord audit-log reason, and unique one-shot operation key.
2. Review the verified application and bot IDs, exact guild, existing and desired transient policy, lifecycle effect, complete permissions, capacity, reference health and names, privacy guarantees, warnings, operation-key hash, and keyed digest.
3. If the plan reports `already-current`, no confirmation, reservation, activity record, or Discord write is needed.
4. Call `execute_automod_change` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact identity, policy field, lifecycle effect, permission, reference, warning, audit reason, operation-key hash, and digest remains intended.
6. Review the returned exact transient policy state or verified absence, activity ID, and outcome before any follow-up.

The process-keyed HMAC digest binds the normalized request, verified identities, exact guild and owner, connector member and relevant roles, complete permission evidence, current and desired policy, selected channels and permission overwrites, exact reference evidence, creation capacity and inventory digest, privacy projection, operation-key hash, and warnings. A connector restart invalidates the digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation. Any policy, lifecycle, role, channel, permission, reference, or capacity drift invalidates the reviewed plan.

Execution atomically reserves the operation-key hash and appends a pending content-free activity record before one non-retried POST, PATCH, or DELETE. It then performs an exact rule GET for creation, update, or enable-state changes, and requires a not-found result from the exact rule GET after deletion. Matching controlled state or verified absence is `completed`; valid server-adjusted state or a target that remains after deletion is `completed-with-drift`; a known pre-write Discord client error is `failed`; transport failure, Discord server error, malformed success, or failed post-write verification is `uncertain`. The connector never retries or issues a compensating change.

All AutoMod changes in one guild serialize within one connector process because lifecycle, rule capacity, roles, channels, and alert destinations are shared evidence. An uncertain result blocks queued same-guild work before it reserves another key. This does not provide cross-process exclusion, so do not run connector processes with overlapping AutoMod scope. Activity and operation records contain only exact guild and rule IDs, action and trigger type, optional target enabled state, plan digest, operation-key hash, timestamps, fixed verification and outcome values, activity ID, and sanitized error category. Rule names, trigger strings, regex patterns, presets, custom messages, action settings, role and channel names, audit reasons, and raw operation keys never enter durable records, diagnostics, or telemetry. AutoMod action-execution Gateway dispatches are deliberately unsupported because their raw payloads can contain message content, matched content, and matched keywords. See Discord's [Auto Moderation resource](https://docs.discord.com/developers/resources/auto-moderation) and [permission flags](https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags).

## Privacy-safe scheduled events and reviewed changes

`list_scheduled_events` and `get_scheduled_event` expose one complete bounded inventory or one exact event for a separately allowlisted guild. Set `DISCORD_MCP_ALLOW_SCHEDULED_EVENT_AUDIT=true` and list every eligible guild in `DISCORD_MCP_SCHEDULED_EVENT_GUILD_IDS`. This allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the outer read allowlist exists. The equivalent `discord://guilds/{guildId}/scheduled-events` resource returns the same inventory without subscriber counts.

Every read verifies the application and bot identity, exact guild and owner, connector membership, complete bounded role and channel inventories, event and channel identities, channel type, and effective entity-specific permission evidence. Results contain exact event, guild, channel, creator, and entity IDs; name; description; location; hosting type; privacy level; status; timing; recurrence; cover presence; and an optional aggregate subscriber count. Subscriber identities, creator profiles, cover URLs and hashes, embedded objects, and unknown raw fields are dropped before return. Event strings remain untrusted Discord data, and no event result is cached or persisted.

Changes have no immediate-call path. Set `DISCORD_MCP_ALLOW_SCHEDULED_EVENT_CHANGES=true` in addition to audit scope. The strict action union supports creation, metadata update, status transition, and exact-ID deletion. Create accepts stage, voice, or external hosting, requires a future start, requires an end for external hosting, and can include a supported recurrence rule. Update accepts only the fields being changed; moving an event binds both its current authority and complete destination creation permissions. Active events permit only name, description, or cover changes, while completed and canceled events reject metadata updates. Changing the start of a recurring event requires an explicit recurrence replacement or removal so server-controlled recurrence fields are never guessed.

Supported recurrence is deliberately narrower than the raw Discord object: daily events use Discord's documented weekday sets, weekly events use one weekday with the documented interval choices, monthly events use one numbered weekday, and yearly events use one valid calendar date. Recurrence count, end, and year-day fields are readable but cannot be supplied because Discord controls them. Valid status transitions are scheduled to active, scheduled to canceled, and active to completed. An already-current update or transition returns without confirmation, reservation, activity, or write.

Discord requires `CREATE_EVENTS` to create an external event. Voice creation additionally requires channel-level `VIEW_CHANNEL` and `CONNECT`; stage creation requires the documented channel-management and voice-moderation permissions. Updating, transitioning, or deleting an event requires `MANAGE_EVENTS`, or exact bot ownership together with `CREATE_EVENTS`, plus the entity-specific channel permissions. A hosting move additionally proves the complete creation permissions at the destination. Missing creator evidence cannot satisfy ownership, malformed or incomplete permission evidence fails closed, and `ADMINISTRATOR` is surfaced as a least-privilege warning.

Cover creation, replacement, or removal is part of the same reviewed workflow. Configure `DISCORD_MCP_SCHEDULED_EVENT_ROOTS` only when local covers are needed. The planner accepts one exact absolute local JPEG or non-animated PNG path, never a URL, data URL, or base64 payload. It opens without following the final symlink, proves canonical containment, numeric process ownership, one hard link, regular-file type, stable bounded bytes, actual format, non-animation, and dimensions, then binds the file identity and bytes into the process-keyed plan. Removing a cover uses an explicit `null`; omitting the field preserves it.

1. Call `plan_scheduled_event_change` with the exact guild, action-specific event fields, Discord audit-log reason, and unique one-shot operation key.
2. Review the verified application and bot IDs, exact guild and event, current and desired privacy-safe state, hosting, timing, recurrence, permission and ownership evidence, visible capacity, local cover provenance when present, privacy omissions, warnings, operation-key hash, and keyed digest.
3. If the plan reports `already-current`, no confirmation, reservation, activity record, or Discord write is needed.
4. Call `execute_scheduled_event_change` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact identity, state, hosting target, recurrence, file property, permission, warning, audit reason, operation-key hash, and digest remains intended.
6. Review the returned exact event state or verified absence, activity ID, and outcome before any follow-up.

The plan digest binds the normalized request, verified identities, exact guild and owner, connector member and relevant roles, complete permission evidence, current and desired event state, visible inventory and capacity for creation, local cover snapshot when present, privacy projection, operation-key hash, and warnings. A connector restart invalidates the digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation. Any event, channel, role, ownership, permission, recurrence, timing, cover, or visible-capacity drift invalidates the reviewed plan.

Execution atomically reserves the operation-key hash and appends a pending content-free activity record before one non-retried POST, PATCH, or DELETE. It then performs an exact GET for created, updated, or transitioned events, or requires an exact `404` after deletion. Matching controlled state or verified absence is `completed`; valid server-adjusted state or an event that remains after deletion is `completed-with-drift`; a known pre-write Discord client error is `failed`; transport failure, Discord server error, malformed success, or failed post-write verification is `uncertain`. Cover readback verifies exact identity and cover presence because Discord does not expose stored image bytes.

All scheduled-event changes in one guild serialize within one connector process because creation capacity, role evidence, and event state are shared. An uncertain result blocks queued same-guild work before it reserves another key. This does not provide cross-process exclusion, so do not run connector processes with overlapping scheduled-event scope. Activity and operation records contain only exact guild and event IDs, entity type, action and transition target, plan digest, operation-key hash, timestamps, fixed verification and outcome values, activity ID, and sanitized error category. Names, descriptions, locations, recurrence, subscriber counts, roles, local paths, byte digests, image content, audit reasons, and raw operation keys never enter durable records, diagnostics, or telemetry. See Discord's [guild scheduled event reference](https://docs.discord.com/developers/resources/guild-scheduled-event) and [permission flags](https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags).

## Reviewed channel permission overwrites

`list_channel_permission_overwrites` is a bounded read-only inventory under ordinary channel scope. It sorts exact role and member targets deterministically, pages with an exact target-ID cursor, names every known allow and deny bit, preserves arbitrary-width bitfields, and reports unknown future bits separately. A thread request returns the validated parent's overwrite set, the requested thread, the exact source channel, and explicit inherited evidence because Discord threads do not carry independent overwrites. The equivalent `discord://channels/{channelId}/permission-overwrites` resource template performs the same scoped read and never persists the result.

Changes have no immediate-call path. Set `DISCORD_MCP_ALLOW_PERMISSION_OVERWRITES=true` and list every eligible direct guild channel by its own exact ID in `DISCORD_MCP_PERMISSION_OVERWRITE_CHANNEL_IDS`. The mutation allowlist must be a subset of `DISCORD_MCP_ALLOWED_CHANNEL_IDS` when the read allowlist exists. Categories, text, announcement, forum, media, voice, stage, and directory channels are accepted; thread and direct-message mutation is rejected. Grant the bot channel-level `VIEW_CHANNEL` and `MANAGE_ROLES` in every selected target without granting `ADMINISTRATOR`.

1. Call `plan_channel_permission_overwrite` with the exact channel, exact role or member target, `update` or `delete` mode, Discord audit-log reason, and unique one-shot operation key. An update supplies unique named channel permissions with an `allow`, `deny`, or `inherit` state; deletion supplies no changes.
2. Review the verified application and bot IDs, exact guild, channel and target, current and desired overwrite, effective-access impacts, connector permissions before and after, parent-category synchronization, warnings, operation-key hash, and keyed digest.
3. If the action is `none`, the exact overwrite already has the requested state and no confirmation, reservation, activity record, or Discord write is needed.
4. Call `execute_channel_permission_overwrite` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact identity, state transition, permission impact, synchronization warning, audit reason, operation-key hash, and digest remains intended.
6. Review the returned target overwrite, complete-set match, activity ID, and outcome before any follow-up.

Updates preserve every unspecified channel-scoped bit and can move a named permission among allow, deny, and inherit without exposing a raw-bitfield input. An update that produces empty allow and deny sets becomes an explicit reviewed DELETE. A requested `delete` removes the entire exact overwrite. Bulk reset, category-copy, permission sync, raw bitfields, channel creation, channel deletion, and automatic rollback are intentionally outside this workflow.

Planning verifies the application and bot identity, exact mutation scope, direct guild channel, guild owner, connector membership, complete bounded role inventory, full target overwrite set, optional parent category, and exact role or member target. Member targets require one exact member lookup rather than guild-member enumeration and reject the connector bot, guild owner, and configured protected users. The plan reports member-effective access or a standalone role baseline before and after for every changed permission. It also reports whether the channel exactly matches its parent category before and after, including a warning when the change breaks synchronization.

An update fails closed if the target overwrite carries unknown future bits or known permissions that are not channel-scoped, because rewriting its full bitfields could silently damage state the connector cannot safely represent. Explicit deletion remains available and warns when it will remove unknown bits. The connector must hold every permission placed in either outgoing bitfield and must retain both `VIEW_CHANNEL` and `MANAGE_ROLES` under the complete prospective overwrite set, preventing authority escalation and self-lockout. Incomplete, malformed, contradictory, over-capacity, or mismatched evidence fails planning before approval.

The process-keyed HMAC digest binds the normalized request, one-shot operation-key hash, verified identities, guild owner, exact channel and parent, complete overwrite set, complete role inventory, target member or role evidence, effective-access impact, connector authority before and after, parent synchronization, and warnings. Names and the audit reason can be reviewed in the plan, but only bounded identifiers and outcomes enter durable records. A connector restart invalidates the digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation.

Execution atomically reserves the operation-key hash and appends a pending content-free activity record before one non-retried PUT or DELETE. It then reads the direct channel again and compares both the exact target and the complete overwrite set with the reviewed prospective state. A full match is `completed`; valid concurrent change is `completed-with-drift`; a known pre-write Discord 4xx is `failed`; transport failure, Discord 5xx, or any post-write failure is `uncertain`. Every reserved key remains permanently spent, with no automatic retry or compensating write.

Changes to the same channel serialize within one connector process and replan after a preceding determinate outcome. An uncertain result blocks queued same-channel changes before they reserve another key. This does not provide cross-process exclusion, so do not run connector processes with overlapping permission-overwrite scope. Permission names, bitfields, role or member names, audit reasons, and raw operation keys never enter activity records, operation receipts, diagnostics, or telemetry. See Discord's [edit](https://docs.discord.com/developers/resources/channel#edit-channel-permissions) and [delete](https://docs.discord.com/developers/resources/channel#delete-channel-permission) endpoints plus its [permissions reference](https://docs.discord.com/developers/topics/permissions).

## Permission explanations

`explain_channel_access` evaluates only the authenticated connector bot. It unions the guild `@everyone` role with the bot's roles, applies channel overwrites in Discord's documented everyone, combined-role, and member order, and treats permission bitfields as arbitrary-width integers. `ADMINISTRATOR` bypasses channel overwrites, unknown future bits are preserved and reported, and incomplete role or overwrite evidence yields `partial` confidence instead of a false access claim.

Threads use their parent's overwrites. A successful lookup of a private thread is also reported as evidence that Discord exposed that thread to the bot. The explanation identifies required and missing read permissions, but it remains a diagnostic snapshot rather than a guarantee that a later Discord request will succeed. See Discord's [permissions reference](https://docs.discord.com/developers/topics/permissions).

`explain_principal_permissions` extends that model to the connector bot, one exact member, or one exact role in a permitted guild. It accepts either named permissions, one supported action, or both. Channel actions cover viewing, reading, sending, attaching files, adding reactions, pinning messages, deleting messages, and managing a channel or thread. Hierarchy actions cover assigning or removing one exact role and kicking, banning, or timing out one exact member. Hierarchy requests remain at guild scope and require an exact target plus a connector or member subject.

The service derives channel scope from the exact channel response, fetches members only through Discord's exact guild-member endpoint, and validates a complete bounded role inventory. It never invokes the guild-member listing endpoint. Decisions account for guild ownership, `ADMINISTRATOR`, Discord's overwrite order, channel and voice prerequisites, thread-specific send and management permissions, active member timeouts, strict role position, managed roles, protected guild owners, self-targeting, and administrator timeout immunity. Private-thread checks use the exact thread-member endpoint for member subjects; a `404` is explicit non-membership, while unavailable role membership stays `unknown`. Missing or contradictory evidence returns `partial` confidence and an `allowed: null` decision.

`audit_channel_role_access` evaluates every role in the complete guild inventory for up to five selected channel actions, then returns a bounded deterministic page keyed by an exact role ID. Full-inventory allow, deny, and unknown totals remain available even when rows are paged. Each row is a standalone role baseline: member-specific overwrites and timeouts do not belong to a role, so their count is disclosed and they are excluded. Private-thread membership is likewise unknown for a role unless `MANAGE_THREADS` supplies moderator access.

Both tools are read-only snapshots. They return Discord identifiers, role names, permission bitfields, decision traces, and warnings to the caller, but the connector does not persist those results or member profile data. A later Discord request can still fail if state changes between diagnosis and use.

## Privacy-safe guild audit logs

The `audit-logs` toolset is read-only and requires Discord's `View Audit Log` permission in each permitted guild. Discord retains audit entries for 45 days. `list_guild_audit_entries` returns at most 50 entries newest first, accepts exact actor and numeric action filters, and requests one private lookahead entry so `hasMore` and `nextBeforeEntryId` are evidence-backed rather than guessed. `get_guild_audit_entry` uses Discord's ascending `after` semantics with the exact predecessor snowflake, then requires an exact identifier match. A missing entry returns `found: false`; a neighboring entry is never returned as the requested one. See Discord's [audit log reference](https://docs.discord.com/developers/resources/audit-log).

Every entry exposes its ID, a timestamp derived locally from that snowflake, numeric action type, a known stable action name or `null` for a future value, nullable actor ID, safe bounded change and option keys, counts, and reason presence. Change values and option values are always omitted. Discord's response also embeds users, webhooks, integrations, threads, application commands, scheduled events, and AutoMod rules; the connector ignores all of them. Because `target_id` can hold an invite code or another non-snowflake identifier, only valid snowflake targets are returned and all other non-null targets are marked as redacted.

Reasons are Discord content and are absent unless `includeReasons` or `includeReason` is explicitly true. The result identifies the active privacy tier. Audit responses are not cached, written to the local activity log, stored in operation receipts, used as telemetry labels, or otherwise persisted. Strict bounds, unique IDs, documented sort order, cursor direction, and requested actor and action filters are validated before any result is returned. This Discord server history remains separate from `list_activity`, which reports only this connector's own content-free local write records.

## Reviewed additive channel creation

Channel creation has no immediate-call path. Set `DISCORD_MCP_ALLOW_CHANNEL_CREATION=true` and list every eligible guild in `DISCORD_MCP_CHANNEL_CREATION_GUILD_IDS`. The channel-creation guild allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the read allowlist is present. Grant the bot `Manage Channels` and `View Channels` at the guild and, when used, exact parent category. `View Channels` is required so the planner can collect the strongest available collision and capacity evidence.

The narrow surface creates only categories, text channels, and forum channels. A category accepts only its exact name. Text and forum channels may also specify an exact parent category ID, topic, NSFW flag, slowmode from 0 through 21600 seconds, and default thread archive duration of 60, 1440, 4320, or 10080 minutes. Every request requires a non-blank Discord audit-log reason whose URL-encoded form fits Discord's 512-character limit and a unique operation key containing 16 through 128 safe ASCII characters. The workflow never creates permission overwrites, moves channels, changes positions, edits existing channels, deletes channels, or performs rollback.

1. Call `plan_channel_creation` with the exact guild, channel kind, name, optional settings, audit reason, and one-shot operation key.
2. Review the exact guild and optional parent IDs, untrusted names, desired settings, guild and parent permission evidence, visibility-bounded inventory, warnings, hashed operation key, action, and keyed digest.
3. If the action is `none`, the exact visible channel already has the requested state and no confirmation or write is needed.
4. Call `execute_channel_creation` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact ID, setting, warning, reason, operation-key hash, and digest remains intended.
6. Review the returned channel ID, readback state, activity ID, and outcome before any follow-up.

Planning verifies the exact guild, connector bot membership, complete role evidence, effective guild permissions, the optional exact parent category and its overwrite evidence, logical-name collision candidates, visible guild capacity, and visible parent-child capacity. Logical matching normalizes Unicode compatibility forms, letter case, spaces, underscores, and hyphens. Multiple matches are ambiguous and fail closed. One matching channel with different settings is a conflict rather than an implicit edit. Discord channel inventories can omit channels that the bot cannot view, so every plan labels collision and capacity evidence as visibility-bounded.

The process-keyed digest covers the normalized request, raw operation key inside the keyed input, operation-key hash, bot identity and roles, effective permissions, relevant role state, guild owner, parent overwrites, logical-name candidates, visible child IDs, and visible channel count. A connector restart invalidates the digest. Immediately before approval, the MCP adapter rebuilds the plan. Immediately before mutation, the service rebuilds it again and requires the same digest.

Discord's create-channel endpoint has no idempotency token. Before the single POST, the connector atomically reserves the operation-key hash in a durable private receipt beside the configured activity file, then appends a pending content-free activity record. The raw key, channel name, topic, audit reason, role names, and other Discord content are absent from both records. A reserved key is permanently spent, including after a known failure or an uncertain timeout, transport error, or Discord 5xx response. Do not retry it. Inspect the exact guild and Discord audit log before considering a fresh reviewed request with a new key, especially after an uncertain result.

Within one connector process, executions for the same guild, parent, and normalized logical name are serialized across different operation keys and supported channel kinds. A queued execution rebuilds its plan after the preceding write, and it is blocked without reserving its key if that preceding write ends uncertain. This closes the in-process duplicate-name race without pretending that Discord supplies a uniqueness constraint.

After a successful POST, the connector validates the response identity and performs an exact channel GET. A matching readback returns `completed`; a safe identity with server-adjusted settings returns `completed-with-drift` and the observed values. A write whose receipt or final activity update fails reports that local recording failure without hiding the known channel ID. The connector never retries the POST and never deletes a newly created channel as compensation. See Discord's [create guild channel reference](https://docs.discord.com/developers/resources/guild#create-guild-channel).

## Reviewed forum posts

Forum-post creation has no immediate-call path. Set `DISCORD_MCP_ALLOW_FORUM_POSTS=true` and list every eligible forum by its own exact ID in `DISCORD_MCP_FORUM_POST_CHANNEL_IDS`. The forum allowlist must be a subset of `DISCORD_MCP_ALLOWED_CHANNEL_IDS` when the read allowlist is present. Parent or guild scope never grants forum-post authority to another channel.

The narrow surface targets stable `GUILD_FORUM` channels only. It creates one public thread with one plain-text starter message and accepts an exact title, up to five exact available tag IDs, optional archive duration and thread slowmode, optional exact notification user IDs with visible mentions, a Discord audit-log reason, and a unique one-shot operation key. It does not accept media channels, files, embeds, components, stickers, fuzzy tag names, standalone or private threads, edits, locks, archive actions, pins, tag administration, deletion, or rollback.

Grant the bot `View Channel`, `Read Message History`, and `Send Messages` in each selected forum. Discord ignores `Create Public Threads` for forum-post creation. Selecting a moderated tag additionally requires `Manage Threads`. Planning validates the complete bounded guild-role inventory, the forum's complete permission-overwrite evidence, its exact type and guild, every available tag definition, `REQUIRE_TAG`, moderated tags, settings, and notification policy before producing a digest.

1. Call `plan_forum_post` with the exact forum ID, title, starter content, tag IDs, optional settings and notification IDs, audit reason, and one-shot operation key.
2. Review the exact guild and forum IDs, untrusted names and content, selected tag properties, forum defaults, complete permission evidence, warnings, hashed operation key, and keyed digest.
3. Call `execute_forum_post` with identical inputs plus the digest.
4. Approve the signed MCP confirmation only if every exact ID, content field, setting, notification, warning, reason, operation-key hash, and digest remains intended.
5. Review the returned thread and starter-message IDs, jump URL, readback verification, drift fields, activity ID, and outcome before any follow-up.

The process-keyed digest excludes the raw operation key and binds its domain-separated hash, the normalized request, bot identity and roles, exact guild and forum state, permission evidence, available and selected tags, audit reason, title, content, settings, and notification IDs. A connector restart invalidates the digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it again before reserving the key.

Discord's forum-thread endpoint supplies no nonce or idempotency token. Before the one and only POST, the connector passes the shared anti-spam guard, atomically reserves the operation-key hash in a durable private receipt, and appends a pending content-free activity record. The title, content, tags, notifications, audit reason, and raw key are absent from both records. A reserved key remains spent after every outcome. A known Discord 4xx rejection without a thread ID is recorded as failed; a transport error, Discord 5xx response, malformed success, or any failure after a thread ID becomes visible is uncertain and may represent a completed write.

Executions for the same forum and normalized logical title are serialized within one connector process. If the leading execution ends uncertain, an already queued same-target write is blocked before reserving its key. This does not claim cross-process serialization or global title uniqueness, and Discord permits multiple posts with the same title.

After the POST, the connector validates Discord's returned thread and nested starter message, then performs exact thread and message GETs using the shared thread and starter-message ID. It verifies the guild, parent forum, public-thread type, bot ownership, title, content, tags, archive duration, slowmode, and unlocked active state. Safe server adjustment returns `completed-with-drift` and fixed drift-field names without echoing content. The connector never retries, edits, deletes, or compensates. After an uncertain outcome, inspect the exact forum and Discord audit log before deciding whether a new reviewed intent with a new key is appropriate. See Discord's [forum thread reference](https://docs.discord.com/developers/resources/channel#start-thread-in-forum-or-media-channel).

## Role inventory and reviewed additive role creation

`list_roles` returns a guild's complete bounded role inventory, while `get_role` uses Discord's exact guild-role endpoint. Both normalize Discord's solid `colors` object, hierarchy position, hoist and mention settings, icon and Unicode emoji fields, flags, managed-role provenance, known permission names, raw decimal permission bitfield, and unknown future permission bits. Inventory validation requires exactly one valid `@everyone` role and rejects duplicate IDs, malformed evidence, and a response above Discord's documented guild-role limit.

Role creation has no immediate-call path. Set `DISCORD_MCP_ALLOW_ROLE_CREATION=true` and list every eligible guild in `DISCORD_MCP_ROLE_CREATION_GUILD_IDS`. The role-creation guild allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the read allowlist is present. Grant the bot `Manage Roles`, keep its highest role above the default new-role position, and grant the bot only permissions this workflow may place on new roles. Do not grant the bot `Administrator`; the planner warns if it detects that permission.

The narrow surface accepts an exact role name, a unique list of official permission names, one solid RGB primary color, hoist and mentionable booleans, a Discord audit-log reason, and a unique one-shot operation key. Permission arrays are canonicalized into arbitrary-width decimal bitfields. `ADMINISTRATOR` is always rejected, every requested permission must be a subset of the connector bot's effective guild permissions, and a defined high-risk set receives an explicit plan warning. The workflow never edits, moves, assigns, deletes, rolls back, adds icons or emoji, or creates gradient roles.

1. Call `plan_role_creation` with the exact guild, name, named permissions, optional properties, audit reason, and one-shot operation key.
2. Review the exact guild and owner IDs, untrusted names, named permissions and bitfield, high-risk permissions, color and display settings, complete role count, bot effective permissions and hierarchy, warnings, hashed operation key, action, and keyed digest.
3. If the action is `none`, one exact standard role already has the requested state and no confirmation or write is needed.
4. Call `execute_role_creation` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact ID, permission, property, warning, reason, operation-key hash, and digest remains intended.
6. Review the returned role ID, exact readback state, activity ID, and outcome before any assignment or follow-up.

Planning fetches the exact guild, connector bot member, and complete role inventory together. It requires complete effective-permission evidence, guild-level `MANAGE_ROLES`, a connector role above `@everyone`, available capacity, and an unambiguous logical name. Logical matching normalizes Unicode compatibility forms, letter case, spaces, underscores, and hyphens. A managed role or a standard role with different properties at the logical name is a blocking conflict rather than an implicit edit.

The process-keyed digest covers the normalized request without the raw operation key, the operation-key hash, bot identity and role IDs, effective permissions and highest-role evidence, guild identity and features, every normalized role snapshot, logical-name candidates, action, and role limit. A connector restart invalidates the digest. The MCP adapter rebuilds the plan before approval, and the service rebuilds it immediately before mutation. Both require the exact same digest.

Discord's create-role endpoint has no idempotency token, so `execute_role_creation` is accurately annotated as non-idempotent even though the connector surrounds it with replay defenses. Before the single POST, the connector atomically reserves the operation-key hash in a durable private receipt and appends a pending content-free activity record. The raw key, role name, named permissions, audit reason, and other Discord content are absent from both records. A reserved key is permanently spent after a known failure or uncertain result. Do not retry it; inspect `get_role`, `list_roles`, and the Discord audit log before considering a new reviewed request with a new key.

Within one connector process, executions for the same guild and normalized logical role name are serialized across operation keys. A queued execution rebuilds its plan after the preceding write and is blocked without reserving its key if that write ends uncertain. Overlapping role-creation scope across multiple connector processes remains unsafe because Discord does not enforce logical-name uniqueness.

After the POST, the connector validates the returned role identity and performs an exact role GET. A matching readback returns `completed`; a safe identity with server-adjusted properties returns `completed-with-drift` and the observed role. Known Discord 4xx rejections before a role ID is known are `failed`; transport failures, Discord 5xx responses, or failed exact verification are `uncertain`. The connector never automatically retries the POST and never deletes a newly created role as compensation. See Discord's [role resource reference](https://docs.discord.com/developers/topics/permissions#role-object) and [create guild role reference](https://docs.discord.com/developers/resources/guild#create-guild-role).

## Reviewed resumable guild scaffolds

Guild scaffolds have no immediate-call path. Set `DISCORD_MCP_ALLOW_GUILD_SCAFFOLDS=true` and list every eligible guild in `DISCORD_MCP_GUILD_SCAFFOLD_GUILD_IDS`. The scaffold allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the read allowlist is present. This authority is independent of the standalone channel-creation and role-creation toggles and allowlists. Grant `Manage Channels`, `View Channels`, and, when roles are requested, `Manage Roles` only in selected scaffold guilds. Parent-category overwrites must preserve the required channel permissions.

The bounded input is an exact symbolic graph of additive roles, categories, text channels, and forum channels. Every resource has a globally unique safe key. A child `parentKey` can reference only a category in the same request, so a scaffold cannot smuggle in an arbitrary unreviewed parent ID. Role and channel properties reuse the standalone strict schemas, including named-permission subset checks and the permanent `ADMINISTRATOR` prohibition. The request must contain multiple resources and stays within separate role, channel, and total-resource bounds. It cannot edit, assign, move, reorder, delete, reconcile, roll back, or create permission overwrites.

Planning canonicalizes roles by key, then categories, then child channels by parent and key. One bounded evidence pass fetches the exact guild, exact connector member, complete role inventory, and visible channel inventory. The plan validates application and bot identity, dedicated local scope, logical-name collisions, exact existing-state matches, guild and parent permissions, bot hierarchy, requested role permissions, guild role and channel capacity, category child capacity, every durable checkpoint, and the dependency frontier. Its steps are explicitly labeled `already-current`, `completed`, `ready`, or `waiting-for-parent`, and the ordered zero-based `executionFrontier.stepIndexes` identifies the exact ready steps selected by `stepLimit`. Exact pre-existing resources are safe no-ops; ambiguous, managed, mismatched, incomplete, or drifting resources are blockers rather than implicit edits.

1. Call `plan_guild_scaffold` with the exact guild, roles, channels, audit reason, stable scaffold operation key, and bounded `stepLimit`.
2. Review the verified application, bot, guild, canonical steps, symbolic keys, resolved resource and parent IDs, exact settings and permissions, checkpoint states, ordered execution-frontier indexes, inventories, capacities, permission evidence, warnings, operation-key hash, durable request digest, and keyed plan digest.
3. If every resource is `already-current` and the operation is unreserved, no confirmation or durable record is needed.
4. Call `execute_guild_scaffold` with identical intent plus the digest.
5. Approve the signed MCP confirmation only if every identity, resource, parent, property, permission, checkpoint, warning, limit, and digest remains intended.
6. Review the executed steps and remaining frontier. For a `paused` result, request a fresh plan with the same operation key before approving another frontier.

The process-keyed plan digest binds the complete reviewed evidence and `stepLimit`, so a connector restart or operational-limit change requires a fresh review. A separate durable request digest binds the raw operation key as HMAC key to the verified application, bot, guild, audit reason, and canonical resource intent without storing any of those content fields. The execution limit is deliberately outside that persistent intent binding so an operator may reduce or increase a later frontier while the new plan digest and confirmation still bind the chosen limit. Reusing the operation key with any different identity or resource intent fails closed.

Before the first mutation, the connector reserves a private top-level receipt. It derives domain-separated one-shot keys for every canonical resource and delegates each ready step to the standalone creation service, preserving its pending activity journal, single non-retried POST, and exact readback. Completed per-step receipts are immutable restart-safe checkpoints. The top receipt remains pending across intentional pauses and becomes completed only after a fresh snapshot proves that no ready or dependency-blocked step remains.

Execution runs only the ordered ready-step indexes named by the approved plan. A requested child remains `waiting-for-parent` while its category is absent, so creating that category cannot cascade into child creation under the same approval. A fresh plan must resolve the exact category ID and re-evaluate its overwrites before the child becomes ready. Independent ready roles and categories remain bounded by the same reviewed frontier.

A pending checkpoint indicates another active or interrupted execution and blocks progress. A failure before a per-step receipt exists leaves the top operation pending and requires a fresh plan because no Discord write was authorized by that step reservation. A failed or uncertain checkpoint, an exact readback with drift, a completed receipt whose resource no longer matches, or a top-level identity mismatch permanently blocks that scaffold operation key. The connector never retries, skips, repairs, compensates, or rolls back such a step. Inspect Discord and the content-free receipts before deciding whether a genuinely new intent should use a new operation key.

Within one connector process, the standalone target locks also serialize logical role and channel targets across different scaffold and standalone operation keys. Persistent receipts prevent duplicate execution of the same derived step key across processes, but Discord does not enforce logical-name uniqueness across different operation keys. Do not run connector processes with overlapping scaffold, channel-creation, or role-creation scope.

The durable records contain only domain-separated hashes, Discord IDs, timestamps, fixed statuses, verification states, activity IDs, and sanitized error categories. They never contain the raw operation key, symbolic keys, role, category, or channel names, topics, named permissions, audit reason, overwrites, or raw Discord responses. Per-step activity entries follow the same content-free rules. A completed scaffold can be replayed as a verified no-op, while an entirely pre-existing exact scaffold creates no receipt at all.

## Reviewed local-file attachment messages

Attachment messages have no immediate-call path. Set `DISCORD_MCP_ALLOW_ATTACHMENTS=true`, list every eligible channel or thread by its own exact ID in `DISCORD_MCP_ATTACHMENT_CHANNEL_IDS`, and set `DISCORD_MCP_ATTACHMENT_ROOTS` to one absolute canonical owned directory or a JSON array of such directories. The channel allowlist must be a subset of `DISCORD_MCP_ALLOWED_CHANNEL_IDS` when the read allowlist exists. A parent channel never grants attachment scope to a child thread. With a channel read allowlist, a thread workflow requires both the parent and thread in read scope, plus the thread's own attachment-scope entry. Grant `View Channel`, `Read Message History`, `Attach Files`, and either `Send Messages` or `Send Messages in Threads` as applicable. Attachment-root configuration is rejected on runtimes without numeric process-ownership evidence; leave attachment roots unset to use the other capabilities there.

The narrow surface accepts one exact absolute local path, optional plain-text message content, an optional safe attachment filename, an optional accessibility description, an optional exact reply, explicit notification settings, and a unique one-shot operation key. It never accepts remote URLs, data URLs, base64 payloads, directories, multiple files, or streams. The configured byte ceiling defaults to and cannot exceed 10 MiB, matching Discord's default per-file limit rather than assuming boosted-guild limits.

1. Place the intended file inside a dedicated configured attachment root and ensure it has one hard link and is owned by the connector user.
2. Call `plan_attachment_message` with the exact channel, path, message fields, optional reply and notification settings, and one-shot operation key.
3. Review the exact guild and channel IDs, canonical path, stable file properties and byte size, filename and description, content, reply, notification users, required and effective permissions, warnings, operation-key hash, and keyed digest.
4. Call `execute_attachment_message` with identical inputs plus the digest.
5. Approve the signed MCP confirmation only if every exact ID, byte-bound file property, message field, permission, warning, hash, and digest remains intended.
6. Review the returned message ID, jump URL, attachment filename and size, activity ID, and verified outcome. The result never exposes Discord's attachment URL.

Each plan opens the file without following the final symlink, validates its identity and metadata before and after an exact bounded read, then checks the path again. Planning rejects path escapes, symlinks in the resolved path, hardlinks, foreign ownership, non-regular or empty files, oversized files, and files or paths that change while being read. A process-keyed HMAC of the bytes and stable device, inode, ownership, mode, size, and nanosecond timestamps are bound into the plan without exposing the byte digest. The MCP adapter plans again before elicitation, and the service reads and plans a third time immediately before mutation; any mismatch blocks execution.

Notification behavior matches plain-text sends: nobody is notified by default, every notified user must be locally allowlisted and visibly mentioned in the content, role and mass mentions stay disabled, and reply-author notification is a separate reviewed boolean whose exact author is checked. The planner also requires complete role and overwrite evidence for every permission. Threads use their parent's permission overwrites but still require their own exact attachment-channel allowlist entry.

After the final matching plan, execution consumes the shared process-local interaction budget, atomically reserves the operation-key hash in a durable private receipt, and appends a pending content-free activity record. It uploads the in-memory byte snapshot through one native multipart request with nonce enforcement and no automatic retry. The create response must match the nonce and complete reviewed message. An exact message GET must then match the verified bot, channel, guild, reply, content, and single attachment's filename, description, and size; an omitted optional nonce is accepted, but a conflicting nonce is not.

The raw key, local path, filename, description, file size and digest, message content, notification user IDs, and attachment URL never enter the activity log or operation receipt. A reserved key remains spent after known failure, uncertainty, or local recording failure. Transport errors, Discord 5xx responses, and any outcome after a message ID becomes known are `uncertain`; do not retry them. Inspect the exact channel and returned message ID when available before considering a fresh reviewed request with a new key. The connector never retries the multipart POST or deletes a message as rollback. See Discord's [message resource reference](https://docs.discord.com/developers/resources/message#create-message) for multipart files, attachment metadata, nonce enforcement, replies, and allowed mentions.

## Safe message interactions

Message interactions are a separate exact-ID policy boundary from reads and deletion. Set `DISCORD_MCP_ALLOW_INTERACTIONS=true` and list every writable channel or thread by its own ID in `DISCORD_MCP_INTERACTION_CHANNEL_IDS`. An allowlisted parent grants read access to its threads but never grants interaction access to them. MCP hosts should treat all three tools as writes and require approval before each call.

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

## Reviewed member-role changes

Member-role changes have no immediate-call path. Set `DISCORD_MCP_ALLOW_MEMBER_ROLE_CHANGES=true`, list every eligible guild in `DISCORD_MCP_MEMBER_ROLE_GUILD_IDS`, list every assignable role in `DISCORD_MCP_MEMBER_ROLE_IDS`, and place every ineligible operator, service account, and break-glass identity in `DISCORD_MCP_PROTECTED_USER_IDS`. The guild allowlist must be a subset of `DISCORD_MCP_ALLOWED_GUILD_IDS` when the read allowlist exists. The role allowlist is an explicit statement of operator intent, independent of the bot's Discord permissions, member-directory scope, moderation scope, role-creation scope, and permission-overwrite scope.

1. Call `plan_member_role_change` with exact guild, user, and role IDs, the `add` or `remove` action, a Discord audit-log reason, and a unique one-shot operation key.
2. Review the verified application and bot identities, exact target and selected role, role sets before and after, guild permission sets and delta, selected-role permissions, bot and target hierarchy, high-risk and unknown-bit warnings, every changed direct-channel permission decision, impact bounds, audit reason, operation-key hash, and keyed digest.
3. Call `execute_member_role_change` with identical intent plus the digest.
4. Approve the signed MCP confirmation only if every identity, role transition, permission effect, warning, reason, hash, and digest remains intended.
5. Review the exact readback state, activity ID, and outcome before any related operation.

Planning verifies the exact guild and owner, bot member, target member, complete bounded role inventory, and every supported direct guild channel and overwrite returned by Discord. The selected role must be a standard non-managed role other than `@everyone`, and both the role and target member must be strictly below the bot's unique highest role. The target cannot be the bot, guild owner, a protected user, a pending membership-screening member, or an actively timed-out member. Ambiguous hierarchy, unresolved member roles, malformed overwrites, missing `MANAGE_ROLES`, unsupported channel evidence, and incomplete permission evaluation fail closed.

An addition rejects `ADMINISTRATOR`, unknown future permission bits on the selected role or its direct-channel overwrites, selected-role guild permissions outside the bot's complete effective guild permission set, and every selected-role channel overwrite allowance or effective channel-permission gain the bot does not itself hold in that exact channel. Known non-channel permission bits in any channel overwrite are malformed evidence and fail closed. A removal may revoke a role carrying high-risk or unknown permissions because that operation removes role-derived authority, but the plan calls out those properties. Every plan shows the target's before-and-after effective guild permissions and exact named delta, separately calls out high-risk effective gains from either role bits or channel overwrites, discloses unknown permission bits elsewhere in the complete role and direct-channel overwrite inventories, and compares the target's named effective permissions before and after across every supported direct guild channel. If the changed-channel set exceeds the bounded result limit, planning fails instead of truncating the approval preview.

Discord's guild-channel inventory does not include active threads. Each plan therefore states that inherited or membership-specific thread access is outside its direct-channel proof. External role, channel, timeout, or membership changes after planning invalidate the fresh digest where they affect the bound evidence, but Discord offers no conditional role-assignment primitive for the narrow interval after the final read.

An already present `add` or already absent `remove` is a verified no-op that needs no confirmation, reservation, activity record, or Discord write. A real execution atomically reserves the operation-key hash, appends pending content-free activity, performs one exact non-retried PUT or DELETE, and fetches the exact member to verify both the selected role state and the complete proposed role snapshot. A concurrent unrelated role change therefore produces `completed-with-drift` even when the selected role reached its intended state. The workflow never replaces the full role array, retries, rolls back, or infers a member or role from a display name.

The raw operation key, member and role names, channel names, permission evidence, audit reason, and Discord payloads never enter the durable activity or receipt records. A reserved key remains spent after rejection, uncertainty, drift, or local recording failure. Same-member changes are serialized inside one connector process, and an uncertain result blocks work already queued for that member. Do not run connector processes with overlapping member-role write scope; inspect the exact member and Discord audit log before deciding whether a new intent should use a new operation key.

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

`pack:verify` rebuilds and packs twice under one npm toolchain, requires byte-identical archives, enforces the published-file allowlist, scans for sensitive environment values, installs the archive without lifecycle scripts, runs the installed credential-free catalog check without a token, exercises the packaged operational CLI, negotiates the installed MCP catalogs, and reads only the static safety resource. CI also requires byte-identical decompressed tar payloads across supported Node lines because npm patch releases can encode the same payload with different gzip bytes. Neither check contacts Discord.

Generate and validate an SPDX production-dependency SBOM with `npm run --silent sbom -- --output sbom.spdx.json`. The release workflow attests the verified archive with that SBOM.

After building, verify the compiled CLI without contacting Discord:

```sh
node dist/cli.js catalog --check
node dist/cli.js doctor
node dist/cli.js help
node dist/cli.js version
```

The online doctor and MCP smoke verify the token, expected application ID, bot identity, guild membership page, privileged-intent flags, content-free MCP catalogs, and read-only protocol path without listing guild members, guild bans, guild invites, guild onboarding, Discord channels, AutoMod rules, or scheduled events, reading messages, ban reasons, or local files, sending attachments, revoking invites, replacing onboarding, changing AutoMod rules, scheduled events, permission overwrites, or member roles, creating channels or roles, or performing member moderation:

```sh
node dist/cli.js doctor --online
node dist/cli.js smoke
```

`npm run probe:live` remains an alias for the online doctor JSON report. Operator reports print identifiers, counts, effective policy diagnostics, intent state, tool names, resource URIs, template URIs, and prompt names but never print the token. No default live command fetches member, ban, invite, onboarding, message, or search content, and the online doctor does not start the optional Gateway.

## Release integrity

The npm package, source constant, lockfile root, MCP Registry manifest, versioned icon URL, and release tag are checked as one identity. The same metadata gate scans every tracked and unignored repository file as raw bytes to prevent model- or harness-specific branding, including hidden binary metadata. Production and development dependencies are exactly pinned to the public npm registry. Dependency installation disables lifecycle scripts and explicitly rebuilds only the reviewed esbuild version. CI also audits known vulnerabilities and npm registry signatures.

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

Additional channel and role mutation should reuse the reviewed-plan core but remain separate from additive creation and exact permission-overwrite changes so edit, move, assignment, and deletion risks receive distinct policy and confirmation gates. Slash commands and Discord Interaction endpoints must verify Discord signatures with the application public key and should remain separate from the local stdio process.

## License

AGPL-3.0-only
