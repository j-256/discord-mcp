# Project guidance

## Scope

This repository implements a local stdio MCP server for Discord guild message access. Keep the transport, Discord REST client, scope policy, deletion planning, activity log, and MCP adapter separate so each can evolve independently.

## Safety invariants

Never print, persist, return, or commit a Discord bot token. Production code must use the fixed Discord API origin; only tests may inject another transport or origin.

Message deletion must remain exact-ID based and require every existing gate: the environment toggle, deletion-channel allowlist, destructive MCP annotation, MCP host write approval, a fresh matching keyed plan digest, signed MCP request state, interactive confirmation, a final fresh-plan check, and a pending content-free audit record. Do not weaken or bypass one gate because another exists.

Never persist message content, attachment URLs, embeds, or components. Activity records may contain Discord identifiers, timestamps, plan digests, strategies, and outcomes.

## Development

Target Node.js 22 or newer and TypeScript ESM. Keep production dependencies small and pinned exactly. Use native fetch for Discord REST calls.

Run npm run typecheck, npm test, and npm run build before committing. Live tests must be explicitly invoked, read-only by default, and must not fetch message content unless their command and documentation say so.

Use comments only when they explain a non-obvious invariant, and do not end comments with periods.
