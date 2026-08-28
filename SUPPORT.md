# Support

Discord MCP is self-hosted local stdio software. Its maintainers do not operate a shared bot, receive or store operator tokens, access operator guilds, monitor live Discord incidents, or provide emergency moderation. Check [product boundaries and host compatibility](docs/limitations.md) before filing a setup issue or enabling a write capability.

## Start with offline evidence

Follow the [first verified read and recovery guide](docs/getting-started.md), then search existing issues. Use the [complete reference](docs/reference.md) when the problem involves a specific policy or workflow. Prefer credential-free checks before opening a report:

```sh
discord-mcp config validate FILE
discord-mcp doctor --config FILE
discord-mcp catalog --check --json
```

If an MCP host reports that the connection closed during initialization, run `discord-mcp host --npx --config FILE --html PRIVATE_FILE` and choose the guide's common MCP JSON, Cursor, VS Code, or Gemini CLI projection. For terminal-only inspection, append the matching `--adapter ID`. Compare the host's exact command, ordered arguments, secret references, transport, requirements, and timeouts with that digest-bound projection. Do not attach the guide, adapter JSON, or Cursor install URI to an issue because they contain Discord identifiers and may contain local paths. `dist/index.js` is the package library entrypoint and does not run a server; direct execution fails with a fixed correction instead of closing silently. An operational source checkout must run `node dist/cli.js serve --config FILE`, while a pinned published launch uses `npx --yes @j-256/discord-mcp@VERSION serve --config FILE`. Then run `discord-mcp smoke --config FILE` outside the host to verify the same spawned stdio path without sharing a token or raw diagnostic output. The [ordered recovery ladder](docs/getting-started.md#recovery-ladder) separates policy, credential, Discord, stdio, and host failures.

Run `doctor --online` or another live probe only with a bot and guild you control and only when its documented Discord reads are acceptable. Do not publish raw probe output.

## Choose a route

- Use the operator-question form for setup, policy, Discord permission or intent, MCP host, diagnostic, recovery, package, or container questions
- Use the bug form for a reproducible product defect with a minimal synthetic reproduction
- Use the feature-proposal form for a new capability or authority boundary
- Use the verified-outcome form after a successful or blocked journey to share coarse setup time, first friction, repeat-use intent, and next-workflow demand without posting Discord evidence
- Use a [private GitHub Security Advisory](https://github.com/j-256/discord-mcp/security/advisories/new) for an undisclosed vulnerability, following [SECURITY.md](SECURITY.md)

## Share only privacy-safe evidence

Useful public evidence includes the exact package version or image tag, installation method, Node.js major version, operating-system family, architecture, MCP host family, public preset or recipe name, toolset or command name, fixed error code or category, sanitized counts, and an offline check's pass, warning, or failure state.

Never post a bot token, webhook credential, invite or template code, collector header, configuration file, secret-variable value, local path, raw log, raw Discord payload, message content, attachment URL, embed, component, audit-log reason, username, profile name, role name, channel name, topic, avatar, screenshot, recording, or private guild, channel, user, message, application, or webhook identifier. Replace paths and IDs with obvious synthetic values. Rotate any credential that may have been exposed.

## Support boundaries

Community support is best effort and has no response-time guarantee. Maintainers cannot administer an operator's Discord account, application, bot, guild, MCP host, or secret store. The connector's privacy guarantees do not govern retention by Discord, an MCP host, a model provider, the operating system, terminal capture, or operator-created infrastructure. For an active safety incident, use Discord's own moderation, account-security, and support controls first; a public project issue is not an incident-response channel.
