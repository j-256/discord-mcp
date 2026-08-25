import assert from "node:assert/strict"
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  JsonlActivityLog,
  type AnnouncementCrosspostActivity,
  type AnnouncementSubscriptionActivity,
  type ApplicationEmojiActivity,
  type ApplicationIntentActivity,
  type AttachmentMessageActivity,
  type AutoModerationActivity,
  type BulkGuildBanActivity,
  type ChannelCloneActivity,
  type ChannelCreationActivity,
  type ChannelDeletionActivity,
  type ChannelMetadataActivity,
  type VoiceChannelStatusActivity,
  type ChannelOrderingActivity,
  type ChannelPermissionOverwriteActivity,
  type ComponentMessageActivity,
  type DeletionActivity,
  type DirectMessageActivity,
  type ForumPostActivity,
  type ForumTagActivity,
  type GuildExpressionActivity,
  type GuildIncidentActivity,
  type GuildProfileActivity,
  type GuildPruneActivity,
  type GuildSettingsActivity,
  type GuildTemplateActivity,
  type IntegrationDeletionActivity,
  type InteractionActivity,
  type InviteCreationActivity,
  type InviteDeletionActivity,
  type MemberModerationActivity,
  type MemberNicknameActivity,
  type MemberRoleActivity,
  type MemberVoiceActivity,
  type MessagePinActivity,
  type MessageForwardActivity,
  type NativeInteractionActivity,
  type NativeInteractionCommandActivity,
  type OnboardingActivity,
  type PollActivity,
  type ReactionModerationActivity,
  type RoleCreationActivity,
  type RoleConfigurationActivity,
  type RoleDeletionActivity,
  type RoleOrderingActivity,
  type ScheduledEventActivity,
  type SoundboardActivity,
  type StageInstanceActivity,
  type ThreadCreationActivity,
  type ThreadGovernanceActivity,
  type WebhookChangeActivity,
  type WebhookCreationActivity,
  type WebhookDeletionActivity,
  type WebhookMessageActivity,
  type WelcomeScreenActivity,
  type WidgetSettingsActivity,
} from "../src/activity-log.js"
import { DISCORD_CHANNEL_TYPES } from "../src/constants.js"

function attachmentMessage(
  id: string,
  status: AttachmentMessageActivity["status"],
): AttachmentMessageActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status) ? "DiscordApiError.500.unknown" : null,
    guildId: "100",
    id,
    kind: "attachment-message-send",
    messageId: ["completed", "uncertain"].includes(status) ? "300" : null,
    operationKeyHash: `sha256:${"e".repeat(64)}`,
    planDigest: `hmac-sha256:${"f".repeat(64)}`,
    replyToMessageId: "400",
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function componentMessage(
  id: string,
  status: ComponentMessageActivity["status"],
  kind: ComponentMessageActivity["kind"] = "component-message-create",
): ComponentMessageActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status) ? "DiscordApiError.500.unknown" : null,
    guildId: "100",
    id,
    kind,
    messageId: ["completed", "uncertain"].includes(status) ? "300" : null,
    operationKeyHash: `sha256:${"a".repeat(64)}`,
    planDigest: `hmac-sha256:${"b".repeat(64)}`,
    replyToMessageId: kind === "component-message-create" ? "400" : null,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function activity(id: string, status: DeletionActivity["status"]): DeletionActivity {
  return {
    channelId: "200",
    deletedMessageIds: status === "completed" ? ["300"] : [],
    error: null,
    failedMessageId: null,
    guildId: "100",
    id,
    kind: "message-deletion",
    messageIds: ["300"],
    planDigest: "hmac-sha256:test",
    schemaVersion: 1,
    status,
    strategies: ["individual:1"],
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
  }
}

function interaction(id: string, status: InteractionActivity["status"]): InteractionActivity {
  return {
    channelId: "200",
    error: null,
    guildId: "100",
    id,
    kind: "message-send",
    messageId: status === "pending" ? null : "300",
    nonce: "stable-nonce",
    replyToMessageId: null,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
  }
}

function directMessageActivity(
  id: string,
  stage: DirectMessageActivity["stage"],
  status: DirectMessageActivity["status"],
): DirectMessageActivity {
  const dispatched = stage === "message-dispatched" || stage === "terminal"
  const channelReady = stage !== "reserved"
  return {
    action: "send",
    channelId: channelReady ? "200" : null,
    error: status === "failed" || status === "uncertain"
      ? "DiscordApiError.500.unknown"
      : null,
    id,
    kind: "direct-message-change",
    messageFormat: "text",
    messageId: dispatched ? "300" : null,
    operationKeyHash: `sha256:${"c".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    recipientId: "400",
    replyToMessageId: null,
    requestDigest: `hmac-sha256:${"e".repeat(64)}`,
    schemaVersion: 1,
    stage,
    status,
    timestamp: `2026-08-25T00:00:0${id.at(-1)}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function reactionModeration(
  id: string,
  status: ReactionModerationActivity["status"],
): ReactionModerationActivity {
  return {
    channelId: "200",
    customEmojiId: "500",
    emojiFingerprint: `hmac-sha256:${"a".repeat(64)}`,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "reaction-moderation",
    messageId: "300",
    operationKeyHash: `sha256:${"b".repeat(64)}`,
    planDigest: `hmac-sha256:${"c".repeat(64)}`,
    schemaVersion: 1,
    scope: "user",
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
    verification: status === "completed" ? "match" : null,
  }
}

function moderation(
  id: string,
  status: MemberModerationActivity["status"],
): MemberModerationActivity {
  return {
    action: "timeout",
    deleteMessageSeconds: null,
    durationMinutes: 60,
    error: null,
    guildId: "100",
    id,
    kind: "member-moderation",
    operationKeyHash: `sha256:${"a".repeat(64)}`,
    planDigest: `hmac-sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    status,
    timeoutUntil: status === "pending" ? null : "2026-08-14T01:00:00.000Z",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
    verification: status === "completed" ? "match" : null,
  }
}

function bulkGuildBan(
  id: string,
  status: BulkGuildBanActivity["status"],
): BulkGuildBanActivity {
  const response = status === "completed"
    ? { banned: ["400", "401"], failed: [] }
    : status === "completed-with-drift"
      ? { banned: ["400"], failed: ["401"] }
      : status === "partial"
        ? { banned: ["400"], failed: ["401"] }
        : status === "failed"
          ? { banned: [], failed: ["400", "401"] }
          : { banned: [], failed: [] }
  const observed = ["completed", "completed-with-drift"].includes(status)
    ? { banned: ["400", "401"], notBanned: [] }
    : ["partial", "partial-with-drift"].includes(status)
      ? { banned: ["400"], notBanned: ["401"] }
      : status === "failed"
        ? { banned: [], notBanned: ["400", "401"] }
        : status === "uncertain"
          ? { banned: ["400"], notBanned: [] }
          : { banned: [], notBanned: [] }
  return {
    deleteMessageSeconds: 3_600,
    error: ["failed", "partial", "partial-with-drift", "uncertain"].includes(status)
      ? "BulkGuildBanError.partial"
      : null,
    guildId: "100",
    id,
    kind: "bulk-guild-ban",
    observedBannedUserIds: observed.banned,
    observedNotBannedUserIds: observed.notBanned,
    operationKeyHash: `sha256:${"d".repeat(64)}`,
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
    requestedUserIds: ["400", "401"],
    responseBannedUserIds: response.banned,
    responseFailedUserIds: response.failed,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" || status === "partial" || status === "failed"
      ? "match"
      : status === "completed-with-drift" || status === "partial-with-drift"
        ? "drift"
        : null,
  }
}

function guildPrune(
  id: string,
  status: GuildPruneActivity["status"],
): GuildPruneActivity {
  const completed = status === "completed"
  const drift = status === "completed-with-drift"
  return {
    actualPrunedCount: completed ? 3 : drift ? 2 : null,
    days: 14,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    includeRoleIds: ["400", "401"],
    kind: "guild-prune",
    maximumEstimatedMemberCount: 10,
    operationKeyHash: `sha256:${"c".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    policyMaximumMemberCount: 25,
    reviewedEstimatedMemberCount: 3,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: completed ? "match" : drift ? "drift" : null,
  }
}

function channelCreation(
  id: string,
  status: ChannelCreationActivity["status"],
): ChannelCreationActivity {
  return {
    channelId: status.startsWith("completed") ? "250" : null,
    channelKind: "text",
    error: null,
    guildId: "100",
    id,
    kind: "channel-create",
    operationKeyHash: `sha256:${"a".repeat(64)}`,
    parentId: "200",
    planDigest: `hmac-sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function channelMetadataChange(
  id: string,
  status: ChannelMetadataActivity["status"],
): ChannelMetadataActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "channel-metadata-change",
    operationKeyHash: `sha256:${"d".repeat(64)}`,
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
    requestedFields: ["name", "topic"],
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function voiceChannelStatusChange(
  id: string,
  status: VoiceChannelStatusActivity["status"],
): VoiceChannelStatusActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "voice-channel-status-change",
    operationKeyHash: `sha256:${"f".repeat(64)}`,
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function roleCreation(
  id: string,
  status: RoleCreationActivity["status"],
): RoleCreationActivity {
  return {
    error: null,
    guildId: "100",
    id,
    kind: "role-create",
    operationKeyHash: `sha256:${"c".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    roleId: status.startsWith("completed") ? "350" : null,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function roleConfiguration(
  id: string,
  status: RoleConfigurationActivity["status"],
): RoleConfigurationActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "role-configuration",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    requestedFields: ["name", "grantPermissions", "roleIcon"],
    roleId: "350",
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function roleOrdering(
  id: string,
  status: RoleOrderingActivity["status"],
): RoleOrderingActivity {
  return {
    anchorRoleId: "351",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "role-ordering",
    operationKeyHash: `sha256:${"9".repeat(64)}`,
    placement: "above",
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
    roleId: "350",
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function channelOrdering(
  id: string,
  status: ChannelOrderingActivity["status"],
): ChannelOrderingActivity {
  return {
    anchorChannelId: "251",
    baselineRevision: 4,
    channelId: "250",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "channel-ordering",
    observedRevision: status === "completed" ? 5 : null,
    operationKeyHash: `sha256:${"8".repeat(64)}`,
    parentChannelId: "200",
    placement: "above",
    planDigest: `hmac-sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function channelDeletion(
  id: string,
  status: ChannelDeletionActivity["status"],
): ChannelDeletionActivity {
  const completed = status === "completed" || status === "completed-with-drift"
  return {
    baselineChannelCount: 8,
    baselineRevision: 4,
    channelId: "250",
    dependencyCount: 0,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "channel-deletion",
    observedRevision: completed ? 5 : null,
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"c".repeat(64)}`,
    schemaVersion: 1,
    status,
    targetKind: "text",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function roleDeletion(
  id: string,
  status: RoleDeletionActivity["status"],
): RoleDeletionActivity {
  const completed = status === "completed" || status === "completed-with-drift"
  return {
    baselineRoleCount: 8,
    blockerCount: 0,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "role-deletion",
    memberCount: 0,
    observedRoleCount: completed ? 7 : null,
    operationKeyHash: `sha256:${"8".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    roleId: "300",
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function channelClone(
  id: string,
  status: ChannelCloneActivity["status"],
): ChannelCloneActivity {
  return {
    baselineRevision: 4,
    channelType: DISCORD_CHANNEL_TYPES.text,
    createdChannelId: status === "completed" ? "252" : null,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "channel-clone",
    observedRevision: status === "completed" ? 5 : null,
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"c".repeat(64)}`,
    schemaVersion: 1,
    sourceChannelId: "250",
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function pollActivity(
  id: string,
  kind: PollActivity["kind"],
  status: PollActivity["status"],
): PollActivity {
  const terminalMessage = [
    "completed",
    "completed-with-drift",
  ].includes(status)
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind,
    messageId: terminalMessage || kind === "poll-end" && status === "pending"
      ? "300"
      : null,
    operationKeyHash: `sha256:${"9".repeat(64)}`,
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function memberRole(
  id: string,
  status: MemberRoleActivity["status"],
): MemberRoleActivity {
  return {
    action: "add",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "member-role-change",
    operationKeyHash: `sha256:${"5".repeat(64)}`,
    planDigest: `hmac-sha256:${"6".repeat(64)}`,
    roleId: "350",
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function memberNickname(
  id: string,
  status: MemberNicknameActivity["status"],
  targetKind: MemberNicknameActivity["targetKind"] = "member",
): MemberNicknameActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "member-nickname-change",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    targetKind,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function memberVoice(
  id: string,
  status: MemberVoiceActivity["status"],
): MemberVoiceActivity {
  return {
    action: "move",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "member-voice-change",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function threadGovernance(
  id: string,
  status: ThreadGovernanceActivity["status"],
): ThreadGovernanceActivity {
  return {
    action: "remove-member",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "thread-governance-change",
    operationKeyHash: `sha256:${"9".repeat(64)}`,
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
    schemaVersion: 1,
    status,
    targetUserId: "400",
    threadId: "300",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function forumPost(
  id: string,
  status: ForumPostActivity["status"],
): ForumPostActivity {
  const hasThread = [
    "completed",
    "completed-with-drift",
    "uncertain",
  ].includes(status)
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "forum-post-create",
    messageId: hasThread ? "300" : null,
    operationKeyHash: `sha256:${"1".repeat(64)}`,
    parentChannelId: "200",
    planDigest: `hmac-sha256:${"2".repeat(64)}`,
    schemaVersion: 1,
    status,
    threadId: hasThread ? "300" : null,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function forumTagChange(
  id: string,
  status: ForumTagActivity["status"],
): ForumTagActivity {
  return {
    action: "update-metadata",
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "forum-tag-change",
    operationKeyHash: `sha256:${"3".repeat(64)}`,
    planDigest: `hmac-sha256:${"4".repeat(64)}`,
    schemaVersion: 1,
    status,
    tagId: "350",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function threadCreation(
  id: string,
  status: ThreadCreationActivity["status"],
): ThreadCreationActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "thread-create",
    mode: "from-message",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    parentChannelId: "200",
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    sourceMessageId: "300",
    status,
    threadId: ["completed", "completed-with-drift", "uncertain"].includes(status)
      ? "300"
      : null,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function messagePin(
  id: string,
  status: MessagePinActivity["status"],
): MessagePinActivity {
  return {
    channelId: "200",
    desiredState: "pinned",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "message-pin",
    messageId: "300",
    operationKeyHash: `sha256:${"3".repeat(64)}`,
    planDigest: `hmac-sha256:${"4".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function announcementCrosspost(
  id: string,
  status: AnnouncementCrosspostActivity["status"],
): AnnouncementCrosspostActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "announcement-crosspost",
    messageId: "300",
    operationKeyHash: `sha256:${"5".repeat(64)}`,
    planDigest: `hmac-sha256:${"6".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : null,
  }
}

function messageForward(
  id: string,
  status: MessageForwardActivity["status"],
): MessageForwardActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    id,
    kind: "message-forward",
    nonce: "forward_nonce_0001",
    operationKeyHash: `sha256:${"a".repeat(64)}`,
    planDigest: `hmac-sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    sourceChannelId: "200",
    sourceGuildId: "100",
    sourceMessageId: "300",
    status,
    targetChannelId: "201",
    targetGuildId: "101",
    targetMessageId: status === "completed" ? "301" : null,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function announcementSubscription(
  id: string,
  status: AnnouncementSubscriptionActivity["status"],
): AnnouncementSubscriptionActivity {
  return {
    action: "subscribe",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "announcement-subscription",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    sourceChannelId: "201",
    sourceGuildId: "101",
    status,
    targetChannelId: "200",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
    webhookId: ["pending", "failed"].includes(status) ? null : "300",
  }
}

function nativeInteractionCommand(
  id: string,
  status: NativeInteractionCommandActivity["status"],
): NativeInteractionCommandActivity {
  return {
    action: "install",
    commandId: status === "completed" ? "300" : null,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "native-interaction-command-change",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function nativeInteraction(
  id: string,
  status: NativeInteractionActivity["status"],
): NativeInteractionActivity {
  const errorStatus = ["rejected", "response-failed", "response-uncertain"]
    .includes(status)
  return {
    channelId: "200",
    error: errorStatus ? "response-uncertain" : null,
    guildId: "100",
    id,
    interactionId: "300",
    kind: "native-interaction",
    referenceHash: `sha256:${"9".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    userId: "400",
  }
}

function webhookDeletion(
  id: string,
  status: WebhookDeletionActivity["status"],
): WebhookDeletionActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "webhook-deletion",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
    webhookId: "300",
  }
}

function webhookCreation(
  id: string,
  status: WebhookCreationActivity["status"],
): WebhookCreationActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "webhook-creation",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
    webhookId: ["completed", "completed-with-drift"].includes(status)
      ? "300"
      : null,
  }
}

function webhookChange(
  id: string,
  status: WebhookChangeActivity["status"],
): WebhookChangeActivity {
  return {
    channelId: "200",
    destinationChannelId: "201",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "webhook-change",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
    webhookId: "300",
  }
}

function webhookMessage(
  id: string,
  status: WebhookMessageActivity["status"],
  kind: WebhookMessageActivity["kind"] = "webhook-message-send",
): WebhookMessageActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind,
    messageId: kind === "webhook-message-send" && status === "pending"
      ? null
      : "400",
    operationKeyHash: `sha256:${"9".repeat(64)}`,
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
    webhookId: "300",
  }
}

function integrationDeletion(
  id: string,
  status: IntegrationDeletionActivity["status"],
): IntegrationDeletionActivity {
  return {
    associatedBotUserId: "500",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    integrationId: "300",
    kind: "integration-deletion",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    targetApplicationId: "400",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function inviteDeletion(
  id: string,
  status: InviteDeletionActivity["status"],
): InviteDeletionActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    inviteRef: `iref_hmac_sha256_${"6".repeat(64)}`,
    kind: "invite-deletion",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function inviteCreation(
  id: string,
  status: InviteCreationActivity["status"],
): InviteCreationActivity {
  return {
    capabilityFileWritten: status === "completed",
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    inviteRef: status === "completed"
      ? `iref_hmac_sha256_${"5".repeat(64)}`
      : null,
    kind: "invite-creation",
    operationKeyHash: `sha256:${"6".repeat(64)}`,
    planDigest: `hmac-sha256:${"7".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function guildTemplateChange(
  id: string,
  status: GuildTemplateActivity["status"],
): GuildTemplateActivity {
  return {
    action: "synchronize",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "guild-template-change",
    operationKeyHash: `sha256:${"9".repeat(64)}`,
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
    schemaVersion: 1,
    status,
    templateRef: status === "completed"
      ? `tref_hmac_sha256_${"b".repeat(64)}`
      : null,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function onboardingChange(
  id: string,
  status: OnboardingActivity["status"],
): OnboardingActivity {
  return {
    enabled: true,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "onboarding-change",
    operationKeyHash: `sha256:${"8".repeat(64)}`,
    planDigest: `hmac-sha256:${"9".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function welcomeScreenChange(
  id: string,
  status: WelcomeScreenActivity["status"],
): WelcomeScreenActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "welcome-screen-change",
    operationKeyHash: `sha256:${"a".repeat(64)}`,
    planDigest: `hmac-sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function widgetSettingsChange(
  id: string,
  status: WidgetSettingsActivity["status"],
): WidgetSettingsActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "widget-settings-change",
    operationKeyHash: `sha256:${"c".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function guildSettingsChange(
  id: string,
  status: GuildSettingsActivity["status"],
): GuildSettingsActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "guild-settings-change",
    operationKeyHash: `sha256:${"e".repeat(64)}`,
    planDigest: `hmac-sha256:${"f".repeat(64)}`,
    requestedFields: ["explicitContentFilter", "verificationLevel"],
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function guildIncidentChange(
  id: string,
  status: GuildIncidentActivity["status"],
): GuildIncidentActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "guild-incident-action-change",
    operationKeyHash: `sha256:${"0".repeat(64)}`,
    planDigest: `hmac-sha256:${"9".repeat(64)}`,
    requestedFields: ["directMessages", "invites"],
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function guildProfileChange(
  id: string,
  status: GuildProfileActivity["status"],
): GuildProfileActivity {
  return {
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "guild-profile-change",
    operationKeyHash: `sha256:${"1".repeat(64)}`,
    planDigest: `hmac-sha256:${"2".repeat(64)}`,
    requestedFields: ["description", "name"],
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function guildExpression(
  id: string,
  status: GuildExpressionActivity["status"],
): GuildExpressionActivity {
  return {
    action: "create",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    expressionId: ["completed", "completed-with-drift", "uncertain"]
      .includes(status)
      ? "300"
      : null,
    expressionKind: "emoji",
    guildId: "100",
    id,
    kind: "guild-expression-change",
    operationKeyHash: `sha256:${"9".repeat(64)}`,
    planDigest: `hmac-sha256:${"a".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function applicationEmoji(
  id: string,
  status: ApplicationEmojiActivity["status"],
): ApplicationEmojiActivity {
  return {
    action: "create",
    applicationId: "100",
    emojiId: ["completed", "completed-with-drift", "uncertain"].includes(status)
      ? "300"
      : null,
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    id,
    kind: "application-emoji-change",
    operationKeyHash: `sha256:${"d".repeat(64)}`,
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function applicationIntent(
  id: string,
  status: ApplicationIntentActivity["status"],
): ApplicationIntentActivity {
  return {
    applicationId: "100",
    botId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    id,
    intent: "guild-members",
    kind: "application-intent-enablement",
    operationKeyHash: `sha256:${"7".repeat(64)}`,
    planDigest: `hmac-sha256:${"8".repeat(64)}`,
    schemaVersion: 1,
    status,
    timestamp: `2026-08-24T00:00:0${id}.000Z`,
    verification: status === "completed" ? "match" : null,
  }
}

function scheduledEvent(
  id: string,
  status: ScheduledEventActivity["status"],
): ScheduledEventActivity {
  return {
    action: "transition",
    entityType: "voice",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    eventId: "300",
    guildId: "100",
    id,
    kind: "scheduled-event-change",
    operationKeyHash: `sha256:${"b".repeat(64)}`,
    planDigest: `hmac-sha256:${"c".repeat(64)}`,
    schemaVersion: 1,
    status,
    targetStatus: "active",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function soundboard(
  id: string,
  status: SoundboardActivity["status"],
): SoundboardActivity {
  return {
    action: "create",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "guild-soundboard-change",
    operationKeyHash: `sha256:${"c".repeat(64)}`,
    planDigest: `hmac-sha256:${"d".repeat(64)}`,
    schemaVersion: 1,
    soundId: ["completed", "completed-with-drift", "uncertain"]
      .includes(status)
      ? "300"
      : null,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function stageInstance(
  id: string,
  status: StageInstanceActivity["status"],
): StageInstanceActivity {
  return {
    action: "update",
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "stage-instance-change",
    operationKeyHash: `sha256:${"d".repeat(64)}`,
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
    schemaVersion: 1,
    stageInstanceId: ["completed", "completed-with-drift", "uncertain"]
      .includes(status)
      ? "300"
      : null,
    status,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function autoModeration(
  id: string,
  status: AutoModerationActivity["status"],
): AutoModerationActivity {
  return {
    action: "set-enabled",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "automod-change",
    operationKeyHash: `sha256:${"d".repeat(64)}`,
    planDigest: `hmac-sha256:${"e".repeat(64)}`,
    ruleId: "300",
    schemaVersion: 1,
    status,
    targetEnabled: true,
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    triggerType: "keyword",
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

function channelPermissionOverwrite(
  id: string,
  status: ChannelPermissionOverwriteActivity["status"],
): ChannelPermissionOverwriteActivity {
  return {
    channelId: "200",
    error: ["failed", "uncertain"].includes(status)
      ? "DiscordApiError.500.unknown"
      : null,
    guildId: "100",
    id,
    kind: "channel-permission-overwrite",
    mode: "update",
    operationKeyHash: `sha256:${"5".repeat(64)}`,
    planDigest: `hmac-sha256:${"6".repeat(64)}`,
    schemaVersion: 1,
    status,
    targetId: "300",
    targetType: "role",
    timestamp: `2026-08-14T00:00:0${id}.000Z`,
    verification: status === "completed"
      ? "match"
      : status === "completed-with-drift"
        ? "drift"
        : null,
  }
}

test("JSONL activity log appends privately and reads newest first", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "nested", "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(activity("1", "pending"))
  await store.append(activity("2", "completed"))
  const result = await store.list(10)
  const mode = (await stat(file)).mode & 0o777

  assert.equal(mode, 0o600)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 0)
  assert.equal(result.file, file)
})

test("JSONL activity log tolerates malformed historical lines", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  const legacy = activity("1", "completed") as Partial<DeletionActivity>
  delete legacy.kind
  await appendFile(file, `${JSON.stringify(legacy)}\n`, "utf8")
  await appendFile(
    file,
    `${JSON.stringify({ ...activity("2", "completed"), content: "private" })}\nnot-json\n{}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.doesNotMatch(JSON.stringify(result), /private/)
  assert.equal(result.entries.at(-1)?.kind, "message-deletion")
})

test("JSONL activity log accepts only exact content-free private-message lifecycle evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const pending = directMessageActivity("direct-message-1", "reserved", "pending")
  const completed = directMessageActivity(
    "direct-message-2",
    "terminal",
    "completed",
  )

  await store.append(pending)
  await store.append(completed)
  await assert.rejects(
    store.append({
      ...completed,
      content: "private message content",
    } as unknown as DirectMessageActivity),
    /invalid content-free shape/,
  )
  await assert.rejects(
    store.append({
      ...completed,
      schemaVersion: 2,
    }),
    /invalid content-free shape/,
  )
  await assert.rejects(
    store.append({
      ...completed,
      messageFormat: null,
    }),
    /invalid content-free shape/,
  )
  await assert.rejects(
    store.append({
      ...completed,
      messageFormat: "embed",
    } as unknown as DirectMessageActivity),
    /invalid content-free shape/,
  )
  await appendFile(file, `${JSON.stringify({
    ...completed,
    reviewReason: "private review reason",
  })}\n`, "utf8")

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(
    result.entries.map((entry) => entry.id),
    ["direct-message-2", "direct-message-1"],
  )
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(Object.keys(result.entries[0] || {}).sort(), [
    "action",
    "channelId",
    "error",
    "id",
    "kind",
    "messageFormat",
    "messageId",
    "operationKeyHash",
    "planDigest",
    "recipientId",
    "replyToMessageId",
    "requestDigest",
    "schemaVersion",
    "stage",
    "status",
    "timestamp",
    "verification",
  ])
  assert.doesNotMatch(persisted, /private message content/)
  assert.doesNotMatch(JSON.stringify(result), /private review reason/)
})

test("JSONL activity log keeps durable deletion evidence content-free and internally consistent", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const modern: DeletionActivity = {
    channelId: "200",
    deletedMessageIds: ["300"],
    error: "OperationStoreError",
    failedMessageId: null,
    guildId: "100",
    id: "activity-deletion-1",
    kind: "message-deletion",
    messageIds: ["300", "301"],
    observedAbsentMessageIds: ["300", "301"],
    observedPresentMessageIds: [],
    operationKeyHash: `sha256:${"a".repeat(64)}`,
    planDigest: `hmac-sha256:${"b".repeat(64)}`,
    schemaVersion: 1,
    status: "completed-with-drift",
    strategies: ["bulk:2"],
    timestamp: "2026-08-22T00:00:00.000Z",
    verification: "drift",
  }

  await appendFile(
    file,
    `${JSON.stringify({
      ...modern,
      auditReason: "private deletion reason",
      messageContent: "private message content",
      operationKey: "private deletion key",
      username: "private author",
    })}\n${JSON.stringify({
      ...modern,
      id: "activity-deletion-invalid-overlap",
      observedPresentMessageIds: ["300"],
    })}\n${JSON.stringify({
      ...modern,
      id: "activity-deletion-invalid-target",
      deletedMessageIds: ["999"],
    })}\n${JSON.stringify({
      ...modern,
      id: "activity-deletion-incomplete-modern",
      operationKeyHash: undefined,
    })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.equal(result.skippedLines, 3)
  assert.deepEqual(result.entries, [modern])
  assert.doesNotMatch(
    JSON.stringify(result),
    /private deletion reason|private message content|private deletion key|private author/,
  )
})

test("JSONL activity log accepts content-free interaction records without surfacing extra data", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(interaction("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({ ...interaction("2", "completed"), content: "must-not-surface", emoji: "secret" })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.doesNotMatch(JSON.stringify(result), /must-not-surface|secret/)
})

test("JSONL activity log retains only content-free reaction moderation evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(reactionModeration("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({
      ...reactionModeration("2", "completed"),
      auditReason: "private reason",
      emoji: "private emoji text",
      profile: { username: "private username" },
      rawOperationKey: "private operation key",
    })}\n`,
    "utf8",
  )
  await appendFile(
    file,
    `${JSON.stringify({
      ...reactionModeration("3", "completed"),
      emojiFingerprint: `sha256:${"d".repeat(64)}`,
    })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.doesNotMatch(
    JSON.stringify(result),
    /private reason|private emoji text|private username|private operation key/,
  )
  assert.equal(result.entries[0]?.kind, "reaction-moderation")
})

test("JSONL activity log rejects member moderation records with private fields", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const oldShape = { ...moderation("3", "completed") } as Record<string, unknown>
  delete oldShape.operationKeyHash
  delete oldShape.verification

  await store.append(moderation("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({
      ...moderation("2", "completed"),
      auditReason: "private reason",
      nickname: "private nickname",
      roleNames: ["private role"],
      username: "private username",
    })}\n${JSON.stringify(oldShape)}\n${JSON.stringify({
      ...moderation("4", "completed"),
      durationMinutes: 0,
    })}\n${JSON.stringify({
      ...moderation("5", "completed"),
      deleteMessageSeconds: 60,
    })}\n${JSON.stringify({
      ...moderation("6", "completed"),
      timeoutUntil: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["1"])
  assert.equal(result.skippedLines, 5)
  assert.doesNotMatch(
    JSON.stringify(result),
    /private reason|private nickname|private role|private username/,
  )
  assert.equal(result.entries[0]?.kind, "member-moderation")
})

test("JSONL activity log keeps exact bulk guild ban evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const statuses: BulkGuildBanActivity["status"][] = [
    "pending",
    "completed",
    "completed-with-drift",
    "partial",
    "partial-with-drift",
    "failed",
    "uncertain",
  ]
  for (const [index, status] of statuses.entries()) {
    await store.append(bulkGuildBan(String(index + 1), status))
  }
  await appendFile(
    file,
    `${JSON.stringify({
      ...bulkGuildBan("8", "completed"),
      auditReason: "private reason",
      profiles: [{ username: "private username" }],
      rawOperationKey: "private operation key",
      roleIds: ["private role"],
    })}\n${JSON.stringify({
      ...bulkGuildBan("9", "partial"),
      requestedUserIds: ["401", "400"],
    })}\n${JSON.stringify({
      ...bulkGuildBan("10", "completed"),
      responseFailedUserIds: ["401"],
    })}\n`,
    "utf8",
  )

  const result = await store.list()

  assert.deepEqual(
    result.entries.map((entry) => entry.id),
    ["7", "6", "5", "4", "3", "2", "1"],
  )
  assert.equal(result.skippedLines, 3)
  assert.doesNotMatch(
    JSON.stringify(result),
    /private reason|private username|private operation key|private role/,
  )
  assert.equal(result.entries[0]?.kind, "bulk-guild-ban")
})

test("JSONL activity log keeps non-exact guild prune evidence content-free and count-bound", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const statuses: GuildPruneActivity["status"][] = [
    "pending",
    "completed",
    "completed-with-drift",
    "failed",
    "uncertain",
  ]
  for (const [index, status] of statuses.entries()) {
    await store.append(guildPrune(String(index + 1), status))
  }
  await appendFile(
    file,
    `${JSON.stringify({
      ...guildPrune("6", "completed"),
      auditReason: "private reason",
      candidateMemberIds: ["private member"],
      profiles: [{ username: "private username" }],
      rawOperationKey: "private operation key",
    })}\n${JSON.stringify({
      ...guildPrune("7", "completed"),
      actualPrunedCount: 2,
    })}\n${JSON.stringify({
      ...guildPrune("8", "completed-with-drift"),
      actualPrunedCount: 3,
    })}\n${JSON.stringify({
      ...guildPrune("9", "pending"),
      actualPrunedCount: 0,
    })}\n${JSON.stringify({
      ...guildPrune("10", "completed"),
      includeRoleIds: ["401", "400"],
    })}\n`,
    "utf8",
  )

  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["5", "4", "3", "2", "1"])
  assert.equal(result.skippedLines, 5)
  assert.doesNotMatch(
    JSON.stringify(result),
    /private reason|private member|private username|private operation key/,
  )
  assert.equal(result.entries[0]?.kind, "guild-prune")
})

test("JSONL activity log strips channel content and raw operation keys from creation records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(channelCreation("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({
      ...channelCreation("2", "completed-with-drift"),
      auditReason: "private audit reason",
      name: "private-channel-name",
      operationKey: "private-operation-key",
      permissionOverwrites: [{ id: "private-role" }],
      topic: "private topic",
    })}\n${JSON.stringify({
      ...channelCreation("3", "failed"),
      error: "private error text with spaces",
      operationKeyHash: "private topic in a typed field",
    })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "channel-create")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private-channel|private-operation|private-role|private topic/,
  )
})

test("JSONL activity log strips role content and raw operation keys from creation records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(roleCreation("1", "pending"))
  await appendFile(
    file,
    `${JSON.stringify({
      ...roleCreation("2", "completed-with-drift"),
      auditReason: "private audit reason",
      name: "private-role-name",
      operationKey: "private-operation-key",
      permissions: ["private permission"],
    })}\n${JSON.stringify({
      ...roleCreation("3", "failed"),
      error: "private error text with spaces",
      operationKeyHash: "private role in a typed field",
    })}\n`,
    "utf8",
  )
  const result = await store.list()

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "role-create")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private-role|private-operation|private permission|private role/,
  )
})

test("JSONL activity log keeps role-configuration evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-role-name",
    "private-operation-key",
    "private-permission-data",
    "/private/role-icon.png",
    "private-role-icon-hash",
    "🩵",
  ]

  await store.append(roleConfiguration("1", "pending"))
  await store.append({
    ...roleConfiguration("2", "completed"),
    auditReason: privateValues[0],
    name: privateValues[1],
    operationKey: privateValues[2],
    permissions: privateValues[3],
    roleIconFile: privateValues[4],
    roleIconHash: privateValues[5],
    unicodeEmoji: privateValues[6],
  } as RoleConfigurationActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...roleConfiguration("3", "completed"),
      requestedFields: ["name", "privateFutureField"],
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "requestedFields",
      "roleId",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps role-ordering evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-role-name",
    "private-operation-key",
    "private-permission-data",
    "private-holder-counts",
  ]

  await store.append(roleOrdering("1", "pending"))
  await store.append({
    ...roleOrdering("2", "completed-with-drift"),
    auditReason: privateValues[0],
    holderCounts: privateValues[4],
    name: privateValues[1],
    operationKey: privateValues[2],
    permissions: privateValues[3],
  } as RoleOrderingActivity)
  await appendFile(
    file,
    [
      {
        ...roleOrdering("3", "completed"),
        placement: "sideways",
      },
      {
        ...roleOrdering("4", "completed"),
        anchorRoleId: "350",
      },
      {
        ...roleOrdering("5", "completed"),
        roleId: "0",
      },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 3)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "anchorRoleId",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "placement",
      "planDigest",
      "roleId",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps channel-clone evidence content-free and exact", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-operation-key",
    "private-overwrites",
    "private-topic",
  ]

  await store.append(channelClone("1", "pending"))
  await store.append({
    ...channelClone("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    operationKey: privateValues[2],
    overwrites: privateValues[3],
    topic: privateValues[4],
  } as ChannelCloneActivity)
  await appendFile(
    file,
    [
      {
        ...channelClone("3", "completed"),
        createdChannelId: "250",
      },
      {
        ...channelClone("4", "completed"),
        observedRevision: 4,
      },
      {
        ...channelClone("5", "completed"),
        channelType: DISCORD_CHANNEL_TYPES.directory,
      },
      {
        ...channelClone("6", "failed"),
        createdChannelId: "252",
      },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 4)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "baselineRevision",
      "channelType",
      "createdChannelId",
      "error",
      "guildId",
      "id",
      "kind",
      "observedRevision",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "sourceChannelId",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps channel-ordering evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-operation-key",
    "private-overwrites",
    "private-layout-payload",
  ]

  await store.append(channelOrdering("1", "pending"))
  await store.append({
    ...channelOrdering("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    operationKey: privateValues[2],
    overwrites: privateValues[3],
    rawLayout: privateValues[4],
  } as ChannelOrderingActivity)
  await appendFile(
    file,
    [
      {
        ...channelOrdering("3", "completed"),
        placement: "sideways",
      },
      {
        ...channelOrdering("4", "completed"),
        observedRevision: 4,
      },
      {
        ...channelOrdering("5", "completed"),
        anchorChannelId: "250",
      },
      {
        ...channelOrdering("6", "completed"),
        parentChannelId: "250",
      },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 4)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "anchorChannelId",
      "baselineRevision",
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "observedRevision",
      "operationKeyHash",
      "parentChannelId",
      "placement",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps channel-deletion evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-operation-key",
    "private-thread-id",
    "private-webhook-id",
  ]

  await store.append(channelDeletion("1", "pending"))
  await store.append({
    ...channelDeletion("2", "completed-with-drift"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    operationKey: privateValues[2],
    threadIds: [privateValues[3]],
    webhookIds: [privateValues[4]],
  } as ChannelDeletionActivity)
  await appendFile(
    file,
    [
      { ...channelDeletion("3", "completed"), targetKind: "announcement" },
      { ...channelDeletion("4", "completed"), observedRevision: 4 },
      { ...channelDeletion("5", "pending"), dependencyCount: -1 },
      { ...channelDeletion("6", "completed"), verification: "drift" },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 4)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "baselineChannelCount",
      "baselineRevision",
      "channelId",
      "dependencyCount",
      "error",
      "guildId",
      "id",
      "kind",
      "observedRevision",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "targetKind",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps role-deletion evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-role-name",
    "private-operation-key",
    "private-command-id",
  ]

  await store.append(roleDeletion("1", "pending"))
  await store.append({
    ...roleDeletion("2", "completed-with-drift"),
    auditReason: privateValues[0],
    commandIds: [privateValues[3]],
    operationKey: privateValues[2],
    roleName: privateValues[1],
  } as RoleDeletionActivity)
  await appendFile(
    file,
    [
      { ...roleDeletion("3", "completed"), observedRoleCount: null },
      { ...roleDeletion("4", "completed"), blockerCount: -1 },
      { ...roleDeletion("5", "pending"), observedRoleCount: 7 },
      { ...roleDeletion("6", "completed"), verification: "drift" },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 4)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "baselineRoleCount",
      "blockerCount",
      "error",
      "guildId",
      "id",
      "kind",
      "memberCount",
      "observedRoleCount",
      "operationKeyHash",
      "planDigest",
      "roleId",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log strips poll content and enforces pending identity shape", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private poll question",
    "private poll answer",
    "private-operation-key",
    "private voter identity",
  ]

  await store.append({
    ...pollActivity("1", "poll-create", "pending"),
    answers: [privateValues[1]],
    operationKey: privateValues[2],
    question: privateValues[0],
    voterUserIds: [privateValues[3]],
  } as PollActivity)
  await store.append({
    ...pollActivity("2", "poll-end", "completed-with-drift"),
    answers: [privateValues[1]],
    question: privateValues[0],
  } as PollActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...pollActivity("3", "poll-create", "pending"),
      messageId: "300",
    })}\n${JSON.stringify({
      ...pollActivity("4", "poll-end", "pending"),
      messageId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "messageId",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps member-role evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...memberRole("1", "pending"),
    auditReason: "must never reach disk",
    memberName: "must-not-persist",
  } as MemberRoleActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...memberRole("2", "completed-with-drift"),
      auditReason: "private audit reason",
      channelNames: ["private channel"],
      operationKey: "private-operation-key",
      permissionNames: ["private permission"],
      roleName: "private role",
      username: "private member",
    })}\n${JSON.stringify({
      ...memberRole("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "member-role-change")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private channel|private-operation|private permission|private role|private member/,
  )
})

test("JSONL activity log keeps member nickname evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...memberNickname("1", "pending", "current-bot"),
    auditReason: "must never reach disk",
    nickname: "must-not-persist",
  } as MemberNicknameActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...memberNickname("2", "completed-with-drift"),
      auditReason: "private audit reason",
      currentNickname: "private old nickname",
      nickname: "private new nickname",
      operationKey: "private-operation-key",
      roleNames: ["private role"],
      username: "private member",
    })}\n${JSON.stringify({
      ...memberNickname("3", "completed"),
      verification: null,
    })}\n${JSON.stringify({
      ...memberNickname("4", "pending"),
      targetKind: "everyone",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.equal(result.entries[0]?.kind, "member-nickname-change")
  assert.deepEqual(Object.keys(result.entries[0] || {}).sort(), [
    "error",
    "guildId",
    "id",
    "kind",
    "operationKeyHash",
    "planDigest",
    "schemaVersion",
    "status",
    "targetKind",
    "timestamp",
    "userId",
    "verification",
  ])
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private member|private new|private old|private-operation|private role/,
  )
})

test("JSONL activity log keeps member voice evidence and state content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...memberVoice("1", "pending"),
    destinationChannelId: "must-never-reach-disk",
    enabled: true,
    sourceChannelId: "must-not-persist",
  } as MemberVoiceActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...memberVoice("2", "completed-with-drift"),
      auditReason: "private audit reason",
      channelName: "private voice channel",
      destinationChannelId: "private destination",
      enabled: true,
      operationKey: "private-operation-key",
      permissionNames: ["private permission"],
      serverMuted: true,
      sourceChannelId: "private source",
      username: "private member",
    })}\n${JSON.stringify({
      ...memberVoice("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must-never-reach-disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "member-voice-change")
  assert.deepEqual(Object.keys(result.entries[0] || {}).sort(), [
    "action",
    "error",
    "guildId",
    "id",
    "kind",
    "operationKeyHash",
    "planDigest",
    "schemaVersion",
    "status",
    "timestamp",
    "userId",
    "verification",
  ])
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private destination|private member|private permission|private source|private voice|serverMuted/,
  )
})

test("JSONL activity log keeps thread-governance evidence content-free and action exact", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...threadGovernance("1", "pending"),
    auditReason: "must never reach disk",
    desiredName: "must-not-persist",
    memberName: "must-not-persist",
    threadName: "must-not-persist",
  } as ThreadGovernanceActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...threadGovernance("2", "completed-with-drift"),
      auditReason: "private audit reason",
      currentState: { archived: false, name: "private thread" },
      operationKey: "private-operation-key",
      parentName: "private parent",
      permissionNames: ["private permission"],
      username: "private member",
    })}\n${JSON.stringify({
      ...threadGovernance("3", "completed"),
      action: "rename",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "thread-governance-change")
  assert.deepEqual(Object.keys(result.entries[0] || {}).sort(), [
    "action",
    "error",
    "guildId",
    "id",
    "kind",
    "operationKeyHash",
    "planDigest",
    "schemaVersion",
    "status",
    "targetUserId",
    "threadId",
    "timestamp",
    "verification",
  ])
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private member|private-operation|private parent|private permission|private thread/,
  )
})

test("JSONL activity log strips all attachment and message content from attachment records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...attachmentMessage("1", "pending"),
    content: "must never reach disk",
    filePath: "/private/must-not-persist.txt",
  } as AttachmentMessageActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...attachmentMessage("2", "completed"),
      attachmentUrl: "https://cdn.discordapp.com/private",
      content: "private message",
      description: "private description",
      fileDigest: "private digest",
      filePath: "/private/report.txt",
      filename: "private-name.txt",
      notifyUserIds: ["private user"],
      operationKey: "private-operation-key",
      sizeBytes: 123,
    })}\n${JSON.stringify({
      ...attachmentMessage("3", "failed"),
      error: "private error text with spaces",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "attachment-message-send")
  assert.doesNotMatch(
    JSON.stringify(result),
    /cdn\.discordapp|private message|private description|private digest|private\/report|private-name|private user|private-operation|sizeBytes/,
  )
})

test("JSONL activity log strips component layouts and rejects edit replies", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...componentMessage("1", "pending"),
    components: [{ content: "must never reach disk", type: 10 }],
    notifyUserIds: ["private user"],
  } as ComponentMessageActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...componentMessage("2", "completed", "component-message-edit"),
      components: [{ content: "private component text", type: 10 }],
      nonce: "private deterministic nonce",
      operationKey: "private-operation-key",
    })}\n${JSON.stringify({
      ...componentMessage("3", "completed", "component-message-edit"),
      replyToMessageId: "400",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|private user/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "component-message-edit")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private component|private deterministic|private-operation|components|notifyUserIds|nonce/,
  )
})

test("JSONL activity log strips forum-post intent and rejects mismatched starter IDs", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...forumPost("1", "pending"),
    content: "must never reach disk",
    name: "must-not-persist",
  } as ForumPostActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...forumPost("2", "completed-with-drift"),
      appliedTagIds: ["private-tag"],
      auditReason: "private audit reason",
      content: "private starter content",
      name: "private forum title",
      notifyUserIds: ["private user"],
      operationKey: "private-operation-key",
    })}\n${JSON.stringify({
      ...forumPost("3", "completed"),
      messageId: "301",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "forum-post-create")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-tag|private audit|private starter|private forum|private user|private-operation/,
  )
})

test("JSONL activity log strips forum-tag metadata and rejects invalid create evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...forumTagChange("1", "pending"),
    auditReason: "must never reach disk",
    name: "must-not-persist",
    unicodeEmoji: "🚨",
  } as ForumTagActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...forumTagChange("2", "completed"),
      auditReason: "private audit reason",
      availableTags: [{ name: "private replacement" }],
      name: "private tag name",
      operationKey: "private-operation-key",
      unicodeEmoji: "🔒",
    })}\n${JSON.stringify({
      ...forumTagChange("3", "completed"),
      action: "create",
      tagId: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist|🚨/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "forum-tag-change")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private replacement|private tag|private-operation|🔒/,
  )
})

test("JSONL activity log keeps thread-creation evidence content-free and mode exact", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...threadCreation("1", "pending"),
    auditReason: "must never reach disk",
    name: "must-not-persist",
    sourceContent: "must-not-persist",
  } as ThreadCreationActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...threadCreation("2", "completed-with-drift"),
      auditReason: "private reason",
      name: "private thread name",
      operationKey: "private-operation-key",
      sourceProfile: "private profile",
    })}\n${JSON.stringify({
      ...threadCreation("3", "completed"),
      mode: "standalone-public",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "thread-create")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private reason|private thread|private-operation|private profile/,
  )
})

test("JSONL activity log keeps message pin evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...messagePin("1", "pending"),
    auditReason: "must never reach disk",
    content: "must-not-persist",
  } as MessagePinActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...messagePin("2", "completed-with-drift"),
      auditReason: "private audit reason",
      authorName: "private author",
      channelName: "private channel",
      content: "private message content",
      operationKey: "private-operation-key",
    })}\n${JSON.stringify({
      ...messagePin("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "message-pin")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private author|private channel|private message|private-operation/,
  )
})

test("JSONL activity log keeps announcement-crosspost evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...announcementCrosspost("1", "pending"),
    content: "must-not-persist",
    followerChannels: ["must-never-reach-disk"],
  } as AnnouncementCrosspostActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...announcementCrosspost("2", "completed"),
      authorName: "private author",
      channelName: "private channel",
      content: "private announcement",
      operationKey: "private-operation-key",
    })}\n${JSON.stringify({
      ...announcementCrosspost("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must-not-persist|must-never-reach-disk/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "announcement-crosspost")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private author|private channel|private announcement|private-operation/,
  )
})

test("JSONL activity log keeps message-forward evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await assert.rejects(
    () => store.append({
      ...messageForward("1", "pending"),
      attachmentUrl: "https://private.invalid/attachment",
      content: "must-not-persist",
      snapshot: { content: "must-never-reach-disk" },
    } as MessageForwardActivity),
    /invalid content-free shape/,
  )
  await store.append(messageForward("1", "pending"))
  await store.append(messageForward("2", "completed"))
  await appendFile(
    file,
    `${JSON.stringify({
      ...messageForward("3", "completed"),
      attachmentFilename: "private.txt",
      content: "private forwarded content",
      operationKey: "private-operation-key",
    })}\n${JSON.stringify({
      ...messageForward("4", "completed"),
      targetMessageId: null,
    })}\n${JSON.stringify({
      ...messageForward("5", "failed"),
      targetMessageId: "301",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must-not-persist|must-never-reach-disk|private.invalid/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 3)
  assert.equal(result.entries[0]?.kind, "message-forward")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private\.txt|private forwarded|private-operation/,
  )
})

test("JSONL activity log keeps announcement-subscription evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-operation-key",
    "private-webhook-name",
    "private-webhook-token",
    "private-webhook-url",
  ]

  await store.append(announcementSubscription("1", "pending"))
  await store.append({
    ...announcementSubscription("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    operationKey: privateValues[2],
    webhookName: privateValues[3],
    webhookToken: privateValues[4],
    webhookUrl: privateValues[5],
  } as AnnouncementSubscriptionActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...announcementSubscription("3", "completed"),
      sourceChannelId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "sourceChannelId",
      "sourceGuildId",
      "status",
      "targetChannelId",
      "timestamp",
      "verification",
      "webhookId",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps native Interaction command and response evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...nativeInteractionCommand("1", "pending"),
    commandDescription: "must-not-persist",
    operationKey: "must-never-reach-disk",
  } as NativeInteractionCommandActivity)
  await store.append({
    ...nativeInteraction("2", "accepted"),
    request: "private request text",
    response: "private response text",
    token: "private Interaction token",
  } as NativeInteractionActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...nativeInteractionCommand("3", "completed"),
      commandName: "private-command",
      fullInventory: ["private inventory"],
    })}\n${JSON.stringify({
      ...nativeInteraction("4", "response-completed"),
      request: "private historical request",
      token: "private historical token",
    })}\n${JSON.stringify({
      ...nativeInteraction("5", "response-completed"),
      error: "response-uncertain",
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must-not-persist|must-never-reach-disk|private request text|private response text|private Interaction token/)
  assert.deepEqual(result.entries.map(({ id }) => id), ["4", "3", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-command|private inventory|private historical request|private historical token/,
  )
})

test("JSONL activity log keeps permission-overwrite evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append({
    ...channelPermissionOverwrite("1", "pending"),
    auditReason: "must never reach disk",
    permission: "SEND_MESSAGES",
    rawOperationKey: "must-not-persist",
  } as ChannelPermissionOverwriteActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...channelPermissionOverwrite("2", "completed-with-drift"),
      allow: "private bitfield",
      auditReason: "private audit reason",
      channelName: "private channel",
      permissionName: "private permission",
      roleName: "private role",
    })}\n${JSON.stringify({
      ...channelPermissionOverwrite("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )
  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.doesNotMatch(persisted, /must never reach disk|must-not-persist/)
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.kind, "channel-permission-overwrite")
  assert.doesNotMatch(
    JSON.stringify(result),
    /private audit|private bitfield|private channel|private permission|private role/,
  )
})

test("JSONL activity log returns an empty result before the first deletion", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")

  const result = await new JsonlActivityLog(file).list()

  assert.deepEqual(result, {
    entries: [],
    file,
    skippedLines: 0,
  })
})

test("JSONL activity log keeps webhook deletion evidence credential-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-creator-profile",
    "private-operation-key",
    "private-webhook-name",
    "private-webhook-secret",
    "private-webhook-url",
  ]

  await store.append(webhookDeletion("1", "pending"))
  await store.append({
    ...webhookDeletion("2", "completed"),
    auditReason: privateValues[0],
    creatorProfile: privateValues[1],
    operationKey: privateValues[2],
    name: privateValues[3],
    token: privateValues[4],
    url: privateValues[5],
  } as WebhookDeletionActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...webhookDeletion("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
      "webhookId",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps webhook creation and changes credential-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-operation-key",
    "private-webhook-name",
    "private-webhook-secret",
    "private-webhook-url",
  ]

  await store.append(webhookCreation("1", "pending"))
  await store.append({
    ...webhookCreation("2", "completed"),
    auditReason: privateValues[0],
    operationKey: privateValues[1],
    name: privateValues[2],
    token: privateValues[3],
    url: privateValues[4],
  } as WebhookCreationActivity)
  await store.append({
    ...webhookChange("3", "completed-with-drift"),
    auditReason: privateValues[0],
    operationKey: privateValues[1],
    name: privateValues[2],
    token: privateValues[3],
    url: privateValues[4],
  } as WebhookChangeActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...webhookCreation("4", "completed"),
      webhookId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["3", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "destinationChannelId",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
      "webhookId",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps webhook message lifecycle evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-webhook-token",
    "private-webhook-url",
    "private-message-content",
    "private-content-hash",
    "private-notification-user",
    "private-review-reason",
    "private-operation-key",
    "private-credential-path",
  ]

  await store.append(webhookMessage("1", "pending"))
  await store.append({
    ...webhookMessage("2", "completed"),
    content: privateValues[2],
    contentHash: privateValues[3],
    credentialPath: privateValues[7],
    notifyUserIds: [privateValues[4]],
    operationKey: privateValues[6],
    reviewReason: privateValues[5],
    token: privateValues[0],
    url: privateValues[1],
  } as WebhookMessageActivity)
  await store.append(webhookMessage(
    "3",
    "completed-with-drift",
    "webhook-message-deletion",
  ))
  await appendFile(
    file,
    `${JSON.stringify({
      ...webhookMessage("4", "completed", "webhook-message-edit"),
      verification: "drift",
    })}\n${JSON.stringify({
      ...webhookMessage("5", "completed"),
      error: "DiscordApiError.500.unknown",
    })}\n${JSON.stringify({
      ...webhookMessage("6", "pending", "webhook-message-edit"),
      messageId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["3", "2", "1"])
  assert.equal(result.skippedLines, 3)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "messageId",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
      "webhookId",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps integration deletion evidence identity-safe", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-account-name",
    "private-application-name",
    "private-audit-reason",
    "private-integration-name",
    "private-operation-key",
    "private-user-profile",
  ]

  await store.append(integrationDeletion("1", "pending"))
  await store.append({
    ...integrationDeletion("2", "completed"),
    accountName: privateValues[0],
    applicationName: privateValues[1],
    auditReason: privateValues[2],
    integrationName: privateValues[3],
    operationKey: privateValues[4],
    userProfile: privateValues[5],
  } as IntegrationDeletionActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...integrationDeletion("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "associatedBotUserId",
      "error",
      "guildId",
      "id",
      "integrationId",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "targetApplicationId",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps invite creation evidence capability- and path-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-invite-code",
    "https://discord.gg/private-invite-code",
    "/private/capabilities/invite.json",
    "private-operation-key",
  ]

  await store.append(inviteCreation("1", "pending"))
  await store.append(inviteCreation("2", "completed"))
  await assert.rejects(
    () => store.append({
      ...inviteCreation("3", "completed"),
      auditReason: privateValues[0],
      code: privateValues[1],
      url: privateValues[2],
      outputFile: privateValues[3],
      operationKey: privateValues[4],
    } as InviteCreationActivity),
    /invalid content-free shape/,
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 0)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "capabilityFileWritten",
      "channelId",
      "error",
      "guildId",
      "id",
      "inviteRef",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps invite deletion evidence capability-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-invite-code",
    "private-invite-url",
    "private-inviter-profile",
    "private-operation-key",
  ]

  await store.append(inviteDeletion("1", "pending"))
  await store.append({
    ...inviteDeletion("2", "completed"),
    auditReason: privateValues[0],
    code: privateValues[1],
    url: privateValues[2],
    inviterProfile: privateValues[3],
    operationKey: privateValues[4],
  } as InviteDeletionActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...inviteDeletion("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "error",
      "guildId",
      "id",
      "inviteRef",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps Guild Template evidence content- and capability-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-template-code",
    "private-template-name",
    "private-template-description",
    "private-template-topic",
    "private-operation-key",
  ]

  await store.append(guildTemplateChange("1", "pending"))
  await store.append({
    ...guildTemplateChange("2", "completed"),
    code: privateValues[0],
    name: privateValues[1],
    description: privateValues[2],
    topic: privateValues[3],
    operationKey: privateValues[4],
  } as GuildTemplateActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...guildTemplateChange("3", "completed"),
      templateRef: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "templateRef",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps onboarding evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-onboarding-description",
    "private-onboarding-option",
    "private-onboarding-prompt",
    "private-operation-key",
    "private-role-name",
  ]

  await store.append(onboardingChange("1", "pending"))
  await store.append({
    ...onboardingChange("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    description: privateValues[2],
    optionTitle: privateValues[3],
    promptTitle: privateValues[4],
    operationKey: privateValues[5],
    roleName: privateValues[6],
  } as OnboardingActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...onboardingChange("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "enabled",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps Welcome Screen evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-id",
    "private-description",
    "private-emoji-name",
    "private-operation-key",
  ]

  await store.append(welcomeScreenChange("1", "pending"))
  await store.append({
    ...welcomeScreenChange("2", "completed"),
    auditReason: privateValues[0],
    channelId: privateValues[1],
    description: privateValues[2],
    emojiName: privateValues[3],
    operationKey: privateValues[4],
  } as WelcomeScreenActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...welcomeScreenChange("3", "completed-with-drift"),
      verification: "match",
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps widget-settings evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-id",
    "private-operation-key",
  ]

  await store.append(widgetSettingsChange("1", "pending"))
  await store.append({
    ...widgetSettingsChange("2", "completed"),
    auditReason: privateValues[0],
    channelId: privateValues[1],
    enabled: true,
    operationKey: privateValues[2],
  } as WidgetSettingsActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...widgetSettingsChange("3", "completed-with-drift"),
      verification: "match",
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log accepts only exact content-free guild-settings evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(guildSettingsChange("1", "pending"))
  await store.append(guildSettingsChange("2", "completed"))
  await assert.rejects(
    store.append({
      ...guildSettingsChange("3", "completed"),
      auditReason: "private-audit-reason",
      systemChannelId: "private-channel-id",
      verificationLevel: "private-setting-value",
    } as GuildSettingsActivity),
    /invalid content-free shape/,
  )
  await appendFile(
    file,
    `${JSON.stringify({
      ...guildSettingsChange("4", "completed"),
      requestedFields: ["verificationLevel", "explicitContentFilter"],
    })}\n${JSON.stringify({
      ...guildSettingsChange("5", "completed"),
      requestedFields: ["privateFutureField"],
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "requestedFields",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  assert.doesNotMatch(persisted, /private-audit-reason|private-channel-id|private-setting-value/)
})

test("JSONL activity log accepts only exact content-free guild-incident evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(guildIncidentChange("1", "pending"))
  await store.append(guildIncidentChange("2", "completed"))
  await assert.rejects(
    store.append({
      ...guildIncidentChange("3", "completed"),
      auditReason: "private-audit-reason",
      directMessagesDisabledUntil: "2026-08-15T00:00:00.000Z",
      invitesDisabledUntil: "2026-08-15T00:00:00.000Z",
    } as GuildIncidentActivity),
    /invalid content-free shape/,
  )
  await appendFile(
    file,
    `${JSON.stringify({
      ...guildIncidentChange("4", "completed"),
      requestedFields: ["invites", "directMessages"],
    })}\n${JSON.stringify({
      ...guildIncidentChange("5", "completed"),
      requestedFields: ["privateFutureField"],
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "requestedFields",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  assert.doesNotMatch(
    persisted,
    /private-audit-reason|2026-08-15T00:00:00.000Z/,
  )
})

test("JSONL activity log accepts only exact content-free guild-profile evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)

  await store.append(guildProfileChange("1", "pending"))
  await store.append(guildProfileChange("2", "completed"))
  await assert.rejects(
    store.append({
      ...guildProfileChange("3", "completed"),
      auditReason: "private-audit-reason",
      description: "private-description",
      name: "private-guild-name",
      operationKey: "private-operation-key",
    } as GuildProfileActivity),
    /invalid content-free shape/,
  )
  await appendFile(
    file,
    `${JSON.stringify({
      ...guildProfileChange("4", "completed"),
      requestedFields: ["name", "description"],
    })}\n${JSON.stringify({
      ...guildProfileChange("5", "completed"),
      requestedFields: ["privateFutureField"],
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 2)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "requestedFields",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  assert.doesNotMatch(
    persisted,
    /private-audit-reason|private-description|private-guild-name|private-operation-key/,
  )
})

test("JSONL activity log keeps channel metadata evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-channel-topic",
    "private-operation-key",
  ]

  await store.append(channelMetadataChange("1", "pending"))
  await store.append({
    ...channelMetadataChange("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    channelTopic: privateValues[2],
    operationKey: privateValues[3],
  } as ChannelMetadataActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...channelMetadataChange("3", "completed"),
      requestedFields: ["name", "privateFutureField"],
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "requestedFields",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps voice channel status text content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-current-status",
    "private-desired-status",
    "private-operation-key",
  ]

  await store.append(voiceChannelStatusChange("1", "pending"))
  await store.append({
    ...voiceChannelStatusChange("2", "completed"),
    auditReason: privateValues[0],
    currentStatus: privateValues[1],
    desiredStatus: privateValues[2],
    operationKey: privateValues[3],
  } as VoiceChannelStatusActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...voiceChannelStatusChange("3", "pending"),
      verification: "match",
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps guild expression evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-description",
    "private-expression-name",
    "private-file-path",
    "private-image-bytes",
    "private-operation-key",
    "private-sticker-tags",
    "private-uploader-profile",
  ]

  await store.append(guildExpression("1", "pending"))
  await store.append({
    ...guildExpression("2", "completed"),
    auditReason: privateValues[0],
    description: privateValues[1],
    name: privateValues[2],
    filePath: privateValues[3],
    imageBytes: privateValues[4],
    operationKey: privateValues[5],
    tags: privateValues[6],
    uploaderProfile: privateValues[7],
  } as GuildExpressionActivity)
  await store.append({
    ...guildExpression("4", "completed"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...guildExpression("3", "completed"),
      expressionId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "error",
      "expressionId",
      "expressionKind",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps application emoji evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-application-emoji-name",
    "private-application-emoji-path",
    "private-image-bytes",
    "private-operation-key",
    "private-uploader-profile",
  ]

  await store.append(applicationEmoji("1", "pending"))
  await store.append({
    ...applicationEmoji("2", "completed"),
    filePath: privateValues[1],
    imageBytes: privateValues[2],
    name: privateValues[0],
    operationKey: privateValues[3],
    uploaderProfile: privateValues[4],
  } as ApplicationEmojiActivity)
  await store.append({
    ...applicationEmoji("4", "completed"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...applicationEmoji("3", "completed"),
      emojiId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "applicationId",
      "emojiId",
      "error",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps application intent evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-review-reason",
    "private-operation-key",
    "private-raw-flags",
    "private-application-name",
  ]

  await store.append(applicationIntent("1", "pending"))
  await store.append({
    ...applicationIntent("2", "completed"),
    applicationName: privateValues[3],
    operationKey: privateValues[1],
    rawFlags: privateValues[2],
    reviewReason: privateValues[0],
  } as ApplicationIntentActivity)
  await appendFile(
    file,
    `${JSON.stringify({
      ...applicationIntent("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")
  assert.deepEqual(result.entries.map((entry) => entry.id), ["2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.deepEqual(Object.keys(result.entries[0] || {}).sort(), [
    "applicationId",
    "botId",
    "error",
    "id",
    "intent",
    "kind",
    "operationKeyHash",
    "planDigest",
    "schemaVersion",
    "status",
    "timestamp",
    "verification",
  ])
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps AutoMod evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-action-content",
    "private-alert-channel-name",
    "private-audit-reason",
    "private-custom-message",
    "private-keyword",
    "private-operation-key",
    "private-regex",
    "private-role-name",
    "private-rule-name",
  ]

  await store.append(autoModeration("1", "pending"))
  await store.append({
    ...autoModeration("2", "completed"),
    actionExecutionContent: privateValues[0],
    alertChannelName: privateValues[1],
    auditReason: privateValues[2],
    customMessage: privateValues[3],
    keywordFilter: [privateValues[4]],
    operationKey: privateValues[5],
    regexPatterns: [privateValues[6]],
    roleName: privateValues[7],
    ruleName: privateValues[8],
  } as AutoModerationActivity)
  await store.append({
    ...autoModeration("4", "uncertain"),
    error: "OperationStoreError",
  })
  await store.append({
    ...autoModeration("5", "completed"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...autoModeration("3", "completed"),
      targetEnabled: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["5", "4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "ruleId",
      "schemaVersion",
      "status",
      "targetEnabled",
      "timestamp",
      "triggerType",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps scheduled event evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-cover-path",
    "private-description",
    "private-event-name",
    "private-location",
    "private-operation-key",
    "private-subscriber-profile",
  ]

  await store.append(scheduledEvent("1", "pending"))
  await store.append({
    ...scheduledEvent("2", "completed"),
    auditReason: privateValues[0],
    coverImagePath: privateValues[1],
    description: privateValues[2],
    name: privateValues[3],
    location: privateValues[4],
    operationKey: privateValues[5],
    subscriberProfile: privateValues[6],
  } as ScheduledEventActivity)
  await store.append({
    ...scheduledEvent("4", "uncertain"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...scheduledEvent("3", "completed"),
      targetStatus: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "entityType",
      "error",
      "eventId",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "status",
      "targetStatus",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps soundboard evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-audio-bytes",
    "private-creator-profile",
    "private-file-path",
    "private-operation-key",
    "private-sound-name",
  ]

  await store.append(soundboard("1", "pending"))
  await store.append({
    ...soundboard("2", "completed"),
    auditReason: privateValues[0],
    audioBytes: privateValues[1],
    creatorProfile: privateValues[2],
    filePath: privateValues[3],
    operationKey: privateValues[4],
    name: privateValues[5],
  } as SoundboardActivity)
  await store.append({
    ...soundboard("4", "uncertain"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...soundboard("3", "completed"),
      soundId: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "soundId",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})

test("JSONL activity log keeps Stage-instance evidence content-free", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "discord-mcp-activity-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const file = join(root, "activity.jsonl")
  const store = new JsonlActivityLog(file)
  const privateValues = [
    "private-audit-reason",
    "private-channel-name",
    "private-guild-name",
    "private-operation-key",
    "private-stage-topic",
  ]

  await store.append(stageInstance("1", "pending"))
  await store.append({
    ...stageInstance("2", "completed"),
    auditReason: privateValues[0],
    channelName: privateValues[1],
    guildName: privateValues[2],
    operationKey: privateValues[3],
    topic: privateValues[4],
  } as StageInstanceActivity)
  await store.append({
    ...stageInstance("4", "uncertain"),
    error: "OperationStoreError",
  })
  await appendFile(
    file,
    `${JSON.stringify({
      ...stageInstance("3", "completed"),
      verification: null,
    })}\n`,
    "utf8",
  )

  const result = await store.list()
  const persisted = await readFile(file, "utf8")

  assert.deepEqual(result.entries.map((entry) => entry.id), ["4", "2", "1"])
  assert.equal(result.skippedLines, 1)
  assert.equal(result.entries[0]?.error, "OperationStoreError")
  assert.deepEqual(
    Object.keys(result.entries[0] || {}).sort(),
    [
      "action",
      "channelId",
      "error",
      "guildId",
      "id",
      "kind",
      "operationKeyHash",
      "planDigest",
      "schemaVersion",
      "stageInstanceId",
      "status",
      "timestamp",
      "verification",
    ],
  )
  for (const value of privateValues) {
    assert.equal(JSON.stringify(result).includes(value), false)
    assert.equal(persisted.includes(value), false)
  }
})
