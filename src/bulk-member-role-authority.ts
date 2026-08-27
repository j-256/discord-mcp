const AUTHORITY = Symbol("discord-mcp-bulk-member-role-authority")

export interface BulkMemberRoleAuthority {
  readonly authority: typeof AUTHORITY
}

export const BULK_MEMBER_ROLE_AUTHORITY: BulkMemberRoleAuthority = Object.freeze({
  authority: AUTHORITY,
})

export function assertBulkMemberRoleAuthority(
  value: BulkMemberRoleAuthority,
): void {
  if (value !== BULK_MEMBER_ROLE_AUTHORITY || value.authority !== AUTHORITY) {
    throw new TypeError("Discord bulk member-role authority is invalid")
  }
}
