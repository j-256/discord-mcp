export const GUILD_SCAFFOLD_AUTHORITY: unique symbol = Symbol(
  "discord-mcp-guild-scaffold-authority",
)

export type GuildScaffoldAuthority = typeof GUILD_SCAFFOLD_AUTHORITY

export function assertGuildScaffoldAuthority(
  authority: unknown,
): asserts authority is GuildScaffoldAuthority {
  if (authority !== GUILD_SCAFFOLD_AUTHORITY) {
    throw new TypeError("Discord guild scaffold authority is invalid")
  }
}
