import {
  completable,
  type CompleteResourceTemplateCallback,
} from "@modelcontextprotocol/server"
import { z } from "zod"

import {
  DISCORD_SNOWFLAKE_MAX,
  DISCORD_SNOWFLAKE_PATTERN,
} from "./constants.js"
import {
  MCP_PROMPT_NAMES,
  MCP_RESOURCE_TEMPLATE_URIS,
  type McpPromptName,
} from "./mcp-guidance-catalog.js"
import type { PolicyDescription } from "./policy.js"

export const MCP_COMPLETION_VALUE_LIMIT = 100

const COMPLETION_PREFIX_PATTERN = /^[0-9]{0,20}$/

export type PolicyStringArrayField = {
  [Field in keyof PolicyDescription]-?: PolicyDescription[Field] extends readonly string[]
    ? Field
    : never
}[keyof PolicyDescription]

export interface McpPolicyCompletionBinding {
  argument: string
  kind: "prompt" | "resource-template"
  policyFields: readonly PolicyStringArrayField[]
  reference: string
}

function binding(
  kind: McpPolicyCompletionBinding["kind"],
  reference: string,
  argument: string,
  ...policyFields: PolicyStringArrayField[]
): McpPolicyCompletionBinding {
  return Object.freeze({
    argument,
    kind,
    policyFields: Object.freeze(policyFields),
    reference,
  })
}

function resourceBinding(
  reference: string,
  argument: string,
  ...policyFields: PolicyStringArrayField[]
): McpPolicyCompletionBinding {
  return binding("resource-template", reference, argument, ...policyFields)
}

function promptBinding(
  reference: McpPromptName,
  argument: string,
  ...policyFields: PolicyStringArrayField[]
): McpPolicyCompletionBinding {
  return binding("prompt", reference, argument, ...policyFields)
}

export const MCP_POLICY_COMPLETION_BINDINGS: readonly McpPolicyCompletionBinding[] = Object.freeze([
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.applicationCommands, "guildId", "allowedGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildChannels, "guildId", "allowedGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildRoles, "guildId", "allowedGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildVoiceRegions, "guildId", "allowedGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildChannelOrder, "guildId", "channelOrderingGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelDeletionReadiness, "guildId", "allowedGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelDeletionReadiness, "channelId", "channelDeletionIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildRoleOrder, "guildId", "roleOrderingGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.roleDeletionReadiness, "guildId", "allowedGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.roleDeletionReadiness, "roleId", "roleDeletionIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildEmojis, "guildId", "guildExpressionGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildStickers, "guildId", "guildExpressionGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildSoundboard, "guildId", "soundboardGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.exactGuildSoundboardSound, "guildId", "soundboardGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildAutomodRules, "guildId", "automodGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildOnboarding, "guildId", "onboardingGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildWelcomeScreen, "guildId", "welcomeScreenGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildWidgetSettings, "guildId", "widgetSettingsGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildSettings, "guildId", "guildSettingsGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildCommunity, "guildId", "guildCommunityGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildIncidentActions, "guildId", "guildIncidentGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildProfile, "guildId", "guildProfileGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildScheduledEvents, "guildId", "scheduledEventGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.exactRole, "guildId", "allowedGuildIds"),
  resourceBinding(
    MCP_RESOURCE_TEMPLATE_URIS.exactRole,
    "roleId",
    "roleConfigurationIds",
    "roleDeletionIds",
  ),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.exactMember, "guildId", "memberDirectoryGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.memberVoiceState, "guildId", "memberVoiceGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.threadState, "guildId", "threadGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.threadState, "threadId", "threadIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.threadMembership, "guildId", "threadGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.threadMembership, "threadId", "threadIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.threadMembership, "userId", "threadMemberUserIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.exactGuildBan, "guildId", "banAuditGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.exactGuildInvite, "guildId", "inviteGuildIds"),
  resourceBinding(
    MCP_RESOURCE_TEMPLATE_URIS.channelMetadata,
    "channelId",
    "allowedChannelIds",
    "channelMetadataIds",
  ),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelVoiceStatus, "guildId", "allowedGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelVoiceStatus, "channelId", "channelMetadataIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelForumTags, "channelId", "forumTagChannelIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildTemplates, "guildId", "guildTemplateGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildIntegrations, "guildId", "integrationGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.guildWebhooks, "guildId", "webhookGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelAccess, "channelId", "allowedChannelIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelStageInstance, "guildId", "allowedGuildIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelStageInstance, "channelId", "stageChannelIds"),
  resourceBinding(
    MCP_RESOURCE_TEMPLATE_URIS.channelPermissionOverwrites,
    "channelId",
    "allowedChannelIds",
    "permissionOverwriteChannelIds",
  ),
  resourceBinding(
    MCP_RESOURCE_TEMPLATE_URIS.channelAnnouncementSubscriptions,
    "channelId",
    "announcementSubscriptionTargetChannelIds",
  ),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.channelWebhooks, "channelId", "webhookChannelIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.exactMessage, "channelId", "allowedChannelIds"),
  resourceBinding(MCP_RESOURCE_TEMPLATE_URIS.messageReactions, "channelId", "allowedChannelIds"),

  promptBinding(MCP_PROMPT_NAMES.reviewApplicationCommands, "guildId", "allowedGuildIds"),
  promptBinding(
    MCP_PROMPT_NAMES.reviewApplicationMonetization,
    "subjectId",
    "applicationEntitlementGuildIds",
    "applicationEntitlementUserIds",
    "applicationSubscriptionUserIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewApplicationMonetization,
    "skuIds",
    "applicationMonetizationSkuIds",
  ),
  promptBinding(MCP_PROMPT_NAMES.findGuildMembers, "guildId", "memberDirectoryGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.inspectGuildBan, "guildId", "banAuditGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewAttachmentMessage, "channelId", "attachmentChannelIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewChannelCreation, "guildId", "channelCreationGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewForumPost, "channelId", "forumPostChannelIds"),
  promptBinding(MCP_PROMPT_NAMES.authorGuildBlueprint, "guildId", "allowedGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewGuildScaffold, "guildId", "guildScaffoldGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewMemberNicknameChange, "guildId", "nicknameGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewMemberRoleChange, "guildId", "memberRoleGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewMemberVoiceChange, "guildId", "memberVoiceGuildIds"),
  promptBinding(
    MCP_PROMPT_NAMES.reviewMemberVoiceChange,
    "destinationChannelId",
    "memberVoiceChannelIds",
  ),
  promptBinding(MCP_PROMPT_NAMES.reviewThreadChange, "guildId", "threadGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewThreadChange, "threadId", "threadIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewThreadChange, "userId", "threadMemberUserIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewRoleCreation, "guildId", "roleCreationGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.summarizeChannel, "channelId", "allowedChannelIds"),
  promptBinding(MCP_PROMPT_NAMES.searchGuildMessages, "guildId", "allowedGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewMessageDeletion, "channelId", "deleteChannelIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewMessagePin, "channelId", "pinChannelIds"),
  promptBinding(
    MCP_PROMPT_NAMES.reviewAnnouncementCrosspost,
    "channelId",
    "announcementCrosspostChannelIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewMessageForward,
    "sourceChannelId",
    "messageForwardSourceChannelIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewMessageForward,
    "targetChannelId",
    "messageForwardTargetChannelIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewAnnouncementSubscription,
    "sourceChannelId",
    "announcementSubscriptionSourceChannelIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewAnnouncementSubscription,
    "targetChannelId",
    "announcementSubscriptionTargetChannelIds",
  ),
  promptBinding(MCP_PROMPT_NAMES.reviewWebhookCreation, "channelId", "webhookChannelIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewWebhookChange, "channelId", "webhookChannelIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewWebhookChange, "destinationChannelId", "webhookChannelIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewWebhookDeletion, "channelId", "webhookChannelIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewGuildWebhooks, "guildId", "webhookGuildIds"),
  promptBinding(
    MCP_PROMPT_NAMES.reviewGuildIntegrationDeletion,
    "guildId",
    "integrationGuildIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewGuildIntegrationDeletion,
    "integrationId",
    "integrationIds",
  ),
  promptBinding(MCP_PROMPT_NAMES.reviewInviteDeletion, "guildId", "inviteGuildIds"),
  promptBinding(
    MCP_PROMPT_NAMES.reviewGuildExpressionChange,
    "guildId",
    "guildExpressionGuildIds",
  ),
  promptBinding(MCP_PROMPT_NAMES.reviewSoundboardChange, "guildId", "soundboardGuildIds"),
  promptBinding(
    MCP_PROMPT_NAMES.reviewScheduledEventChange,
    "guildId",
    "scheduledEventGuildIds",
  ),
  promptBinding(MCP_PROMPT_NAMES.reviewStageInstanceChange, "guildId", "allowedGuildIds"),
  promptBinding(MCP_PROMPT_NAMES.reviewStageInstanceChange, "channelId", "stageChannelIds"),
  promptBinding(
    MCP_PROMPT_NAMES.reviewChannelPermissionOverwrite,
    "channelId",
    "permissionOverwriteChannelIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewMemberModeration,
    "guildId",
    "administrationGuildIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewBulkGuildBan,
    "guildId",
    "bulkBanGuildIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewGuildPrune,
    "guildId",
    "guildPruneGuildIds",
  ),
  promptBinding(
    MCP_PROMPT_NAMES.reviewGuildPrune,
    "includeRoleIds",
    "guildPruneIncludeRoleIds",
  ),
].sort((left, right) => {
  const leftKey = `${left.kind}\u0000${left.reference}\u0000${left.argument}`
  const rightKey = `${right.kind}\u0000${right.reference}\u0000${right.argument}`
  return leftKey.localeCompare(rightKey)
}))

const BINDINGS_BY_REFERENCE = new Map<string, readonly McpPolicyCompletionBinding[]>()

for (const candidate of MCP_POLICY_COMPLETION_BINDINGS) {
  const key = `${candidate.kind}\u0000${candidate.reference}`
  const existing = BINDINGS_BY_REFERENCE.get(key) || []
  if (existing.some(({ argument }) => argument === candidate.argument)) {
    throw new Error(`Duplicate MCP completion binding for ${candidate.reference} ${candidate.argument}`)
  }
  BINDINGS_BY_REFERENCE.set(key, Object.freeze([...existing, candidate]))
}

function referenceBindings(
  kind: McpPolicyCompletionBinding["kind"],
  reference: string,
): readonly McpPolicyCompletionBinding[] {
  return BINDINGS_BY_REFERENCE.get(`${kind}\u0000${reference}`) || []
}

export function completePolicyIds(
  policy: PolicyDescription | undefined,
  policyFields: readonly PolicyStringArrayField[],
  prefix: string,
): string[] {
  if (!policy || !COMPLETION_PREFIX_PATTERN.test(prefix)) return []
  const matches = new Set<string>()
  for (const field of policyFields) {
    const values = policy[field] as readonly string[]
    for (const value of values) {
      if (
        DISCORD_SNOWFLAKE_PATTERN.test(value)
        && BigInt(value) >= 1n
        && BigInt(value) <= DISCORD_SNOWFLAKE_MAX
        && value.startsWith(prefix)
      ) {
        matches.add(value)
      }
    }
  }
  return [...matches].sort()
}

export function resourceTemplateCompletionCallbacks(
  uriTemplate: string,
  policy: PolicyDescription | undefined,
): {
  complete?: Record<string, CompleteResourceTemplateCallback>
  list: undefined
} {
  const complete = Object.fromEntries(
    referenceBindings("resource-template", uriTemplate).map((candidate) => [
      candidate.argument,
      (value: string) => completePolicyIds(policy, candidate.policyFields, value),
    ]),
  )
  return Object.keys(complete).length > 0
    ? { complete, list: undefined }
    : { list: undefined }
}

export function policyCompletablePromptSchema<
  Schema extends z.ZodObject<z.ZodRawShape>,
>(
  promptName: McpPromptName,
  schema: Schema,
  policy: PolicyDescription | undefined,
): Schema {
  const extension: Record<string, z.ZodType> = {}
  for (const candidate of referenceBindings("prompt", promptName)) {
    const field = schema.shape[candidate.argument]
    if (!field) {
      throw new Error(
        `MCP completion binding references absent ${promptName} argument ${candidate.argument}`,
      )
    }
    extension[candidate.argument] = completable(
      z.clone(field as z.ZodType),
      (value) => typeof value === "string"
        ? completePolicyIds(policy, candidate.policyFields, value)
        : [],
    )
  }
  return Object.keys(extension).length > 0
    ? schema.safeExtend(extension) as unknown as Schema
    : schema
}
