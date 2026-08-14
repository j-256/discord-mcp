# Discord MCP

Discord MCP is a local stdio Model Context Protocol server that lets MCP host inspect Discord guild channels and messages through a dedicated bot. It includes a deliberately narrow deletion path for exact, reviewed message IDs and keeps the bot token and message content out of local activity storage.

## Safety model

The connector treats Discord permissions as its outer boundary and adds local policy inside that boundary.

- Production requests always target Discord API v10 at a fixed origin
- Direct-message channels are rejected
- Discord names, topics, message bodies, embeds, components, filenames, and URLs are treated as untrusted data rather than instructions
- Optional guild and channel allowlists can narrow read access
- Deletion is disabled unless an explicit environment toggle and deletion-channel allowlist are both present
- Deletion accepts exact message IDs rather than free-form filters
- A keyed snapshot digest detects message edits or replacements
- MCP host write approval and signed MCP elicitation both precede deletion
- The connector re-reads the plan immediately before writing
- A content-free pending activity record must succeed before deletion starts
- The bot token, message content, embeds, components, attachment URLs, and interaction public key are never written to the activity log

Treat message deletion as irreversible even though the connector records identifiers and outcomes.

## Requirements

- Node.js 22 or newer
- A Discord application with a bot user
- The bot token available as `DISCORD_BOT_TOKEN`
- `View Channels` and `Read Message History` in every channel the connector should read
- The Message Content privileged intent enabled for full message bodies
- `Manage Messages` only in channels where deletion will eventually be enabled

Do not grant the bot `Administrator`. Restrict its Discord role at the category or channel level wherever possible.

The application public key is not used by this local REST connector. It becomes relevant only if interaction webhooks or slash commands are added later.

## Discord bot setup

1. Open the application in the Discord Developer Portal.
2. On the Bot page, enable the Message Content privileged intent.
3. On the Installation page, enable Guild Install and add the `bot` scope.
4. Select `View Channels` and `Read Message History` as the initial bot permissions.
5. Use the generated install link while signed in as a server administrator and add the bot to the intended server.
6. Restrict the bot role to the intended categories or channels.
7. Run the live probe and confirm that Discord reports the expected guild membership.

Add `Manage Messages` later through the server role only after selecting deletion channels. Keep deletion disabled locally until those channel IDs are configured.

Discord documents bot installation in its [getting started guide](https://docs.discord.com/developers/quick-start/getting-started), message content access in its [Gateway reference](https://docs.discord.com/developers/events/gateway), and message deletion in its [message resource reference](https://docs.discord.com/developers/resources/message).

## Install

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The compiled entrypoint is `dist/mcp.js`.

## Configuration

| Environment variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot authentication |
| `DISCORD_MCP_APPLICATION_ID` | Recommended | Reject a token belonging to a different application |
| `DISCORD_MCP_ALLOWED_GUILD_IDS` | No | Comma- or whitespace-separated read guild allowlist |
| `DISCORD_MCP_ALLOWED_CHANNEL_IDS` | No | Comma- or whitespace-separated read channel allowlist |
| `DISCORD_MCP_ALLOW_DELETIONS` | For deletion | Must be exactly `true` to enable deletion |
| `DISCORD_MCP_DELETE_CHANNEL_IDS` | For deletion | Non-empty deletion-channel allowlist and a subset of the read channel allowlist when one exists |
| `DISCORD_MCP_AUDIT_FILE` | No | Activity JSONL path; defaults under the user's local state directory |

An unset read allowlist means all guild channels Discord allows the bot to view. The bot's Discord role remains authoritative.

Configure the MCP host with a local stdio server:

```toml
[mcp_servers.discord]
command = "node"
args = ["/absolute/path/to/discord-mcp/dist/mcp.js"]
env_vars = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_MCP_ALLOWED_GUILD_IDS",
  "DISCORD_MCP_ALLOWED_CHANNEL_IDS",
  "DISCORD_MCP_ALLOW_DELETIONS",
  "DISCORD_MCP_DELETE_CHANNEL_IDS",
  "DISCORD_MCP_AUDIT_FILE",
]
default_tools_approval_mode = "writes"
tool_timeout_sec = 180

[mcp_servers.discord.env]
DISCORD_MCP_APPLICATION_ID = "your-application-id"
```

Restart the local MCP host after changing MCP configuration. Use `/mcp` in the MCP host to inspect the connected server.

The [MCP documentation](https://modelcontextprotocol.io/docs) describes the shared local MCP host configuration and write-aware approval modes.

## Tools

| Tool | Access | Purpose |
| --- | --- | --- |
| `get_connector_status` | Discord read | Verify application and bot identity and report effective policy |
| `list_guilds` | Discord read | List scoped bot guild memberships |
| `list_channels` | Discord read | List scoped channels without message content |
| `read_messages` | Discord read | Read a bounded page of normalized messages |
| `get_message` | Discord read | Read one exact message |
| `plan_message_deletion` | Discord read | Prepare exact previews and a keyed deletion digest |
| `delete_messages` | Discord write | Confirm, revalidate, journal, and delete the reviewed IDs |
| `list_activity` | Local read | Read content-free deletion activity |

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

## Verification

The default suite uses injected transports and does not contact Discord:

```sh
npm run typecheck
npm test
npm run build
```

The live probe verifies the token, expected application ID, bot identity, and guild membership page without listing channels or reading messages:

```sh
DISCORD_MCP_APPLICATION_ID=your-application-id npm run probe:live
```

The probe prints identifiers, counts, and effective policy but never prints the token.

## Expansion

New Discord capabilities should follow the existing layers:

1. Add a narrow REST method to `DiscordClient`.
2. Apply guild and channel scope in `ScopePolicy`.
3. Normalize Discord data in the service layer.
4. Register an accurately annotated MCP tool.
5. Add transport, policy, service, and MCP contract tests.

Gateway subscriptions, archived-thread traversal, message search, slash commands, and a distributable MCP host integration can be added without changing the deletion safety path. Interaction endpoints must verify Discord signatures with the application public key and should remain separate from the local stdio process.

## License

AGPL-3.0-only
